/*
 * =============================================================================
 * SISTEMA INDUSTRIAL SCADA — CENTRO DE MANDO PRINCIPAL (ESP32 GC9A01)
 * =============================================================================
 * Hardware:
 *   - ESP32 DevKit V1 (30 pines) + Shield Expansión Jack DC 12V
 *   - Pantalla Redonda TFT 1.28" (GC9A01 240x240 SPI)
 *   - Botón Metálico Industrial Antivandálico 16mm (IP65) en pin 13
 *   - Tira LED WS2815 (12V) en pin 22
 *
 * Flujo Operativo FSM (5 Estados):
 *   1. STATE_SUPERVISOR:
 *      - Supervisión global multinodo. Anillo perimetral 360° dividido en N sectores.
 *      - NUNCA se bloquea ni se pinta en rojo completo. Cada sector refleja el
 *        estado individual de su máquina/grúa/operación/rack.
 *      - El centro muestra la disponibilidad global de la línea (% OEE / DISP).
 *   2. STATE_SELECT_MACHINE:
 *      - Clic corto para rotar entre máquinas (1 a N).
 *      - 2 segundos de inactividad confirman automáticamente la máquina seleccionada.
 *   3. STATE_SELECT_REASON:
 *      - Clic corto para rotar entre motivos de paro del catálogo editable.
 *      - Texto centrado en fuente grande y legible, adaptativo a la longitud.
 *      - 2 segundos de inactividad confirman y emiten la alerta de falla a Firestore.
 *   4. STATE_CONFIRM_RESOLVE:
 *      - Si la máquina seleccionada ya estaba en falla, permite resolverla y
 *        devolverla a estado operativo.
 *   5. STATE_FEEDBACK_FLASH:
 *      - Destello de confirmación de 1.5s ("✓ ALERTA ENVIADA" o "✓ RESUELTA"),
 *        retornando de inmediato al supervisor sin bloquear la línea.
 *
 * Resiliencia Offline:
 *   - Todos los motivos y lista de equipos persisten en memoria Flash NVS (Preferences).
 *   - Sincronización REST en segundo plano con Firestore (config/failure_reasons).
 * =============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <lwip/sockets.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_GC9A01A.h>
#include <FastLED.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include <esp_task_wdt.h>
#include <esp_now.h>
#include <esp_wifi.h>

// =============================================================================
// PROTOCOLO INDUSTRIAL ESP-NOW SCADA (HUB & SPOKE: MASTER <-> SATÉLITES)
// =============================================================================
#define SCADA_MAGIC "SCAD"

// Versión única: el panel de administración la lee de crane_devices y el comando INFO de
// serie la reporta; antes el INFO imprimía '3.2.0-GC9A01' fijado, lo que mostraba una
// versión distinta a la realmente flasheada.
const char* firmwareVersion = "3.4.2-GC9A01-ESPNOW";

// Canal de radio fijo. ESP-NOW solo escucha en el canal donde esta el receptor: si el
// C3 satellite esta sin Wi-Fi queda en el canal 1 y nunca oye al master. Ambos sketchs
// usan el mismo canal (cuando los dos estan asociados al mismo AP coinciden de forma
// natural; sin Wi-Fi se fuerza con esp_wifi_set_channel).
#define ESPNOW_CHANNEL 6

enum ScadaMsgType : uint8_t {
  MSG_STATUS_BROADCAST = 0x01,  // Centro de Mando -> Satélites (Actualiza LED y OLED)
  MSG_BUTTON_REPORT    = 0x02,  // Satélite C3 -> Centro de Mando (Operador reporta falla)
  MSG_BUTTON_RESOLVE   = 0x03,  // Satélite C3 -> Centro de Mando (Técnico resuelve falla)
  MSG_PING_HEARTBEAT   = 0x04   // Telemetría local
};

typedef struct __attribute__((packed)) {
  char magic[4];          // "SCAD" (Identificador de protocolo SCADA)
  uint8_t msgType;        // ScadaMsgType (0x01, 0x02, 0x03, 0x04)
  char craneId[8];        // "20A", "20B", "20C", "30A", etc.
  char status[12];        // "falla", "operativa", "reparacion"
  char reason[32];        // "Falla en leva", etc.
  uint32_t timestamp;     // Tiempo epoch o millis
  uint8_t reserved;       // Padding alineación 64 bytes
  uint16_t checksum;      // Validación básica de integridad
} ScadaEspNowPacket;

static uint16_t calcScadaChecksum(const ScadaEspNowPacket* p) {
  const uint8_t* raw = (const uint8_t*)p;
  uint16_t sum = 0;
  for (size_t i = 0; i < offsetof(ScadaEspNowPacket, checksum); i++) {
    sum += raw[i];
  }
  return sum;
}

#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSans9pt7b.h>

// --- PINES DE CONEXIÓN ---
#define TFT_CS    15
#define TFT_DC    2
#define TFT_RST   4
#define TFT_MOSI  23
#define TFT_SCLK  18
#define TFT_BL    21   // Control de retroiluminación de pantalla

#define BTN_PIN   13   // Botón metálico de 16mm (Normal Open a GND con INPUT_PULLUP)
#define LED_PIN   22   // Datos tira LED WS2815 local
#define NUM_LEDS  16   // Cantidad de píxeles LED en el centro de mando

// --- COLORES RGB565 EXACTOS DE LA WEB (EMULADOR) ---
#define COLOR_BG          0x0842  // Fondo oscuro (#07090e)
#define COLOR_PANEL       0x10A3  // Tarjeta gris oscuro (#10141a)
#define COLOR_OK          0x15D0  // Verde esmeralda (#10b981)
#define COLOR_FAIL        0xEA28  // Rojo alarma (#ef4444)
#define COLOR_WARN        0xF4E1  // Ámbar industrial (#f59e0b)
#define COLOR_CYAN        0x3DFF  // Cian / Azul cielo (#38bdf8)
#define COLOR_WHITE       0xFFFF  // Blanco puro
#define COLOR_MUTED       0x63B1  // Gris grafito (#64748b)
#define COLOR_CARD_TEXT   0x94D5  // Slate 400 (#94a3b8)

Adafruit_GC9A01A tft(TFT_CS, TFT_DC, TFT_RST);
CRGB leds[NUM_LEDS];
Preferences prefs;

// --- CONFIGURACIÓN DE RED Y CLOUD ---
String wifiSsid = "Totalplay-6DAB";
String wifiPass = "cgonz181";
String scadaServerHost = "192.168.100.34";
const int scadaServerPort = 8090;

// --- IDENTIDAD DE DISPOSITIVO (obligatoria desde las API rules de PocketBase) ---
// El nodo autentica contra PocketBase y envía el JWT en cada request.
// Crear la identidad con: python3 scripts/seed_admin_user.py --user centro_mando@scada.local --role device --status active --password <token>
// El token se guarda en NVS, así que sobrevive reinicios y reconexiones.
const char* pbDeviceEmail = "centro_mando@scada.local";
const char* pbDevicePassword = "<REPLACE_WITH_ESP32_TOKEN>";   // <-- token del nodo (ver .env)
String scadaToken = "";
String reportedIsoAtFailure = "";   // ISO del reporte (fallback del historial)

String pbAuthHeader() { return "Bearer " + scadaToken; }

bool pbLogin() {
  HTTPClient http;
  http.begin(String("http://") + scadaServerHost + ":" + String(scadaServerPort) +
             "/api/collections/users/auth-with-password");
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);
  String body = "{\"identity\":\"" + String(pbDeviceEmail) + "\",\"password\":\"" + String(pbDevicePassword) + "\"}";
  int code = http.POST(body);
  String res = http.getString();
  http.end();
  int idx = res.indexOf("\"token\":\"");
  if (code == 200 && idx >= 0) {
    res = res.substring(idx + 8);
    // PocketBase responde {"record":{...},"token":"..."}. substring(idx+8) cae sobre la
    // comilla de apertura, así que indexOf('"') devolvía 0 y el token quedaba con la comilla:
    // "Bearer \"eyJ..." -> HTTP 400 en las colecciones que exigen auth (crane_history).
    int end = res.indexOf('"', 1);
    scadaToken = (end > 1) ? res.substring(1, end) : res.substring(1);
    prefs.begin("scada_cfg", false);
    prefs.putString("pb_token", scadaToken);
    prefs.end();
    Serial.printf("[AUTH] Token PocketBase OK para %s\n", pbDeviceEmail);
    return true;
  }
  prefs.begin("scada_cfg", true);
  String cached = prefs.getString("pb_token", "");
  prefs.end();
  if (cached.length() > 0) {
    scadaToken = cached;
    Serial.println("[AUTH] Usando token NVS (el login falló; puede haber expirado)");
    return true;
  }
  Serial.printf("[AUTH] Login fallido (%d): %s\n", code, res.c_str());
  return false;
}
// Valida el token guardado en NVS. PocketBase rechaza los JWT expirados con
// HTTP 400 "Failed to create record.", que es exactamente lo que impedía escribir
// en crane_history: esa colección exige autenticación en createRule, a diferencia de
// crane_status/cranes/notifications, cuyas reglas de creación son públicas y por eso
// el resto del sincronizado funcionaba aunque el token estuviera vencido.
bool pbTokenValid() {
  if (scadaToken.length() == 0 || WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(String("http://") + scadaServerHost + ":" + String(scadaServerPort) +
             "/api/collections/crane_history/records?perPage=1");
  http.addHeader("Authorization", pbAuthHeader());
  http.setTimeout(6000);
  int code = http.GET();
  http.end();
  return code == HTTP_CODE_OK;
}

bool pbEnsureValidToken() {
  if (pbTokenValid()) return true;
  Serial.println("[AUTH] Token inválido/expirado, se renueva antes de escribir el historial");
  return pbLogin();
}

// Firebase ya no se usa: el proyecto operations-monitor-5a355 fue cerrado el 2026-10-25.
// El Centro de Mando sincroniza directamente contra PocketBase en el Xiaomi.
String assignedArea = "area10";

void initNodesForArea(const String& area);
void processSerialCommand(String line);

// --- PORTAL CAUTIVO WI-FI (CONFIGURACIÓN SIN CABLES) ---
bool inConfigPortal = false;
WebServer portalServer(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;

void startConfigPortal();
void handlePortalRoot();
void handlePortalSave();
void renderConfigPortalUI(const String& apName);
String getCleanMac();
void fetchCraneStatuses();
void fetchCloudConfig();
void registerDeviceHeartbeat();
String getIsoTimestamp();
String getShiftHistoryCollectionName();
static String jsonEscape(const String& s);
static time_t isoToEpoch(const String& iso);
static String chihuahuaDay(time_t epoch);
static String chihuahuaShift(time_t epoch);
// day/shift realmente escritos en el registro de crane_history (los calcula la web por estos
// campos, así que deben corresponder al momento del REPORTE, no al de la resolución).
String histDayAtReport = "";
String histShiftAtReport = "";
static String httpDateToIso(const String& h);
// HTTPClient sólo expone las cabeceras de RESPUESTA que se colectan explícitamente; sin esto
// http.header("Date") devolvía vacío y el reloj nunca se sincronizaba (lastSeen omitido y
// reportedAt en 1970).
static const char* kDateHeaderKeys[] = {"Date"};
static time_t httpDateToEpoch(const String& h);
static bool syncClockFromHttpDate(const String& dateHeader);
static bool pbSyncClock();
static String isoOrServerIso();
static String buildCraneHistoryPayload(JsonObject rec, const String& serverIso,
                                       const String& resolutionText,
                                       const String& resolvedByName,
                                       const String& areaCode);
void queueReport(String nodeId, String newStatus, String reasonText);
bool syncNodeStatusToCloud(String nodeId, String newStatus, String reasonText);
void backgroundCloudTask(void *pvParameters);
void initEspNowMaster();
void broadcastEspNowCraneState(const String& craneId, const String& status, const String& reason, uint8_t msgType = MSG_STATUS_BROADCAST);
void onEspNowDataRecvMaster(const esp_now_recv_info_t *info, const uint8_t *data, int len);
bool espNowMasterActive = false;
volatile bool flagUiRefresh = false;
volatile bool flagTriggerPortal = false;
volatile bool flagNeedCloudResync = false;

// --- COLA RESILIENTE OFFLINE (CERO PÉRDIDA DE EVENTOS) ---
#define MAX_PENDING_REPORTS 8
struct PendingReport {
  char nodeId[8];
  char status[12];
  char reason[64];
  uint8_t retries;
  unsigned long lastAttempt;
};
PendingReport pendingQueue[MAX_PENDING_REPORTS];
volatile int pendingCount = 0;
portMUX_TYPE queueMux = portMUX_INITIALIZER_UNLOCKED;

// --- MÁQUINA DE ESTADOS (FSM) ---
enum SystemState {
  STATE_SUPERVISOR,
  STATE_SELECT_MACHINE,
  STATE_SELECT_REASON,
  STATE_CONFIRM_RESOLVE,
  STATE_FEEDBACK_FLASH
};

SystemState currentState = STATE_SUPERVISOR;

// --- MODELO DE DATOS DE EQUIPOS SUPERVISADOS ---
struct NodeItem {
  String id;
  String name;
  String status;       // "operativa", "falla", "reparacion"
  String lastReason;
  unsigned long faultStartTime;
};

#define MAX_NODES 24
NodeItem nodes[MAX_NODES] = {
  { "30A", "GRUA 30A", "operativa", "", 0 },
  { "30B", "GRUA 30B", "operativa", "", 0 },
  { "30C", "GRUA 30C", "operativa", "", 0 },
  { "30D", "GRUA 30D", "operativa", "", 0 }
};
int totalNodes = 4;
int selectedMachineIndex = 0;

// --- CATÁLOGO DINÁMICO DE MOTIVOS DE PARO (GRÚAS) ---
#define MAX_REASONS 16
String failureReasons[MAX_REASONS] = {
  "1. Leva rota",
  "2. Fuga neumática",
  "3. Tornillería floja",
  "4. Componente roto",
  "5. Falla sensor",
  "6. Atasco mecánico"
};
int totalReasons = 6;
int selectedReasonIndex = 0;

// --- TEMPORIZADORES Y DEBOUNCE ---
const unsigned long INACTIVITY_TIMEOUT_MS = 5000; // 5 segundos sin presionar confirma o cancela acción
unsigned long lastButtonActivityTime = 0;
unsigned long lastClickTime = 0; // Para detección de doble clic
unsigned long feedbackStartTime = 0;
String feedbackTitle = "";
String feedbackSub = "";
String feedbackDetail = "";

bool lastBtnState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long DEBOUNCE_DELAY = 50;

unsigned long lastCloudSyncTime = 0;
const unsigned long CLOUD_SYNC_INTERVAL = 15000; // Sincronización cada 15s

// =============================================================================
// FUNCIONES AUXILIARES DE RENDERIZADO EN PANTALLA CIRCULAR 240x240
// =============================================================================

// Dibuja un arco circular continuo y denso (sector angular sin huecos)
void drawArcSegment(int cx, int cy, int r, int thickness, float startAngle, float endAngle, uint16_t color) {
  float step = 0.45; // Pasos finos para máxima densidad y cero líneas cortadas
  for (float a = startAngle; a < endAngle; a += step) {
    float rad = a * 0.0174532925;
    float cosA = cos(rad);
    float sinA = sin(rad);
    for (int t = 0; t < thickness; t++) {
      int px = cx + (int)((r - t) * cosA);
      int py = cy + (int)((r - t) * sinA);
      tft.drawPixel(px, py, color);
    }
  }
}

// Centra horizontal y verticalmente una línea de texto dentro de una caja delimitadora
void drawCenteredInBox(const String& text, int boxX, int boxY, int boxW, int boxH, uint8_t size, uint16_t color) {
  tft.setFont(); // Fuente estándar 5x7 nítida
  tft.setTextSize(size);
  tft.setTextColor(color);
  int16_t x1, y1;
  uint16_t w, h;
  tft.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  int x = boxX + (boxW - (int)w) / 2;
  int y = boxY + (boxH - (int)h) / 2;
  tft.setCursor(x, y);
  tft.print(text);
}

// Centra texto horizontalmente en pantalla (240px) y verticalmente sobre el eje centerY
void drawCenteredText(const String& text, int centerY, uint8_t size, uint16_t color) {
  tft.setFont(); // Fuente estándar 5x7 nítida
  tft.setTextSize(size);
  tft.setTextColor(color);
  int16_t x1, y1;
  uint16_t w, h;
  tft.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  int x = (240 - (int)w) / 2;
  if (x < 6) x = 6;
  int y = centerY - (int)h / 2;
  tft.setCursor(x, y);
  tft.print(text);
}

// Dibuja texto con tipografía vectorial moderna FreeSans centrado matemáticamente en (120, centerY)
void drawCenteredSans(const String& text, int centerY, const GFXfont* font, uint16_t color) {
  tft.setFont(font);
  tft.setTextColor(color);
  int16_t x1, y1;
  uint16_t w, h;
  tft.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  int x = 120 - (int)w / 2 - x1;
  if (x < 6) x = 6;
  int y = centerY - y1 - (int)h / 2;
  tft.setCursor(x, y);
  tft.print(text);
  tft.setFont(); // Restaurar para no afectar otros dibujos
}

// Dibuja el motivo de paro dentro de la tarjeta Hero central con centrado estricto y sin desborde
void drawAutoWrappedReason(const String& text, int centerY, uint16_t color) {
  String clean = text;
  clean.trim();
  int len = clean.length();
  if (len == 0) return;

  // Si es muy corto (<= 11 caracteres), cabe en tamaño 2 (cada char = 12px, máx 132px en caja de 156px)
  if (len <= 11) {
    drawCenteredText(clean, centerY, 2, color);
    return;
  }

  // Si tiene hasta 22 caracteres, cabe perfectamente en tamaño 1 en una sola línea (máx 132px)
  if (len <= 22) {
    drawCenteredText(clean, centerY, 1, color);
    return;
  }

  // Si tiene más de 22 caracteres, dividir inteligentemente por palabras en 2 líneas
  int splitIdx = -1;
  int mid = len / 2;
  for (int i = 0; i < len; i++) {
    if (clean.charAt(i) == ' ') {
      if (splitIdx == -1 || abs(i - mid) < abs(splitIdx - mid)) {
        if (i <= 23 && (len - i - 1) <= 23) {
          splitIdx = i;
        }
      }
    }
  }

  if (splitIdx > 0) {
    String l1 = clean.substring(0, splitIdx);
    String l2 = clean.substring(splitIdx + 1);
    l1.trim();
    l2.trim();
    drawCenteredText(l1, centerY - 6, 1, color);
    drawCenteredText(l2, centerY + 6, 1, color);
  } else {
    String trunc = clean.substring(0, 20) + "..";
    drawCenteredText(trunc, centerY, 1, color);
  }
}

// Actualiza los LEDs físicos WS2815 preservando el estado de cada grúa en sus LEDs dedicados
void updatePhysicalLeds(float progress = 0.0) {
  if (totalNodes <= 0) return;

  bool isFillingState = (currentState == STATE_SELECT_MACHINE || currentState == STATE_SELECT_REASON || currentState == STATE_CONFIRM_RESOLVE);
  bool isExit = (currentState == STATE_SELECT_REASON && selectedReasonIndex >= totalReasons);
  bool isResolve = (currentState == STATE_CONFIRM_RESOLVE || (currentState == STATE_SELECT_MACHINE && nodes[selectedMachineIndex].status == "falla"));
  unsigned long now = millis();

  if (totalNodes <= 4) {
    // Mapeo estándar de 19 LEDs: 4 grúas de 4 LEDs con 1 LED espaciador entre cada una
    for (int item = 0; item < 4; item++) {
      int startLed = item * 5;      // 0, 5, 10, 15
      int endLed   = startLed + 4;  // 4, 9, 14, 19
      int gapLed   = startLed + 4;  // 4, 9, 14

      if (gapLed < NUM_LEDS) {
        leds[gapLed] = CRGB::Black;
      }

      if (item >= totalNodes) {
        for (int p = startLed; p < endLed && p < NUM_LEDS; p++) {
          leds[p] = CRGB::Black;
        }
        continue;
      }

      bool isSelected = (isFillingState && item == selectedMachineIndex);

      if (isSelected) {
        if (progress > 0.0) {
          int fillCount = (int)(progress * 4.01);
          if (fillCount > 4) fillCount = 4;

          for (int p = startLed; p < endLed && p < NUM_LEDS; p++) {
            int offset = p - startLed;
            if (offset < fillCount) {
              if (isExit) {
                leds[p] = (offset == fillCount - 1) ? CRGB(255, 180, 180) : CRGB::Red;
              } else if (isResolve) {
                leds[p] = (offset == fillCount - 1) ? CRGB(160, 255, 200) : CRGB::Green;
              } else {
                leds[p] = (offset == fillCount - 1) ? CRGB(255, 180, 180) : CRGB::Red;
              }
            } else {
              leds[p] = CRGB(16, 12, 6);
            }
          }
        } else {
          uint8_t breath = 160 + (sin8(now / 4) * 95) / 255;
          for (int p = startLed; p < endLed && p < NUM_LEDS; p++) {
            leds[p] = CRGB(breath, (breath * 158) / 245, (breath * 11) / 245);
          }
        }
      } else {
        if (nodes[item].status == "falla") {
          bool flash = ((now / 200) % 2 == 0);
          for (int p = startLed; p < endLed && p < NUM_LEDS; p++) {
            leds[p] = flash ? CRGB::Red : CRGB(40, 0, 0);
          }
        } else if (nodes[item].status == "reparacion") {
          for (int p = startLed; p < endLed && p < NUM_LEDS; p++) {
            leds[p] = CRGB(245, 158, 11);
          }
        } else {
          uint8_t breath = 70 + (sin8(now / 5) * 110) / 255;
          for (int p = startLed; p < endLed && p < NUM_LEDS; p++) {
            leds[p] = CRGB(0, breath, (breath * 30) / 100);
          }
        }
      }
    }
  } else {
    // Mapeo dinámico para flotas ampliadas (e.g., 6 grúas en Área 20)
    int ledsPerCrane = NUM_LEDS / totalNodes;
    if (ledsPerCrane < 1) ledsPerCrane = 1;

    for (int item = 0; item < totalNodes; item++) {
      int startLed = item * ledsPerCrane;
      int endLed   = (item == totalNodes - 1) ? NUM_LEDS : (startLed + ledsPerCrane);
      if (startLed >= NUM_LEDS) break;
      if (endLed > NUM_LEDS) endLed = NUM_LEDS;
      int countForThis = endLed - startLed;

      bool isSelected = (isFillingState && item == selectedMachineIndex);

      if (isSelected) {
        if (progress > 0.0) {
          int fillCount = (int)(progress * ((float)countForThis + 0.01));
          if (fillCount > countForThis) fillCount = countForThis;

          for (int p = startLed; p < endLed; p++) {
            int offset = p - startLed;
            if (offset < fillCount) {
              if (isExit) {
                leds[p] = (offset == fillCount - 1) ? CRGB(255, 180, 180) : CRGB::Red;
              } else if (isResolve) {
                leds[p] = (offset == fillCount - 1) ? CRGB(160, 255, 200) : CRGB::Green;
              } else {
                leds[p] = (offset == fillCount - 1) ? CRGB(255, 180, 180) : CRGB::Red;
              }
            } else {
              leds[p] = CRGB(16, 12, 6);
            }
          }
        } else {
          uint8_t breath = 160 + (sin8(now / 4) * 95) / 255;
          for (int p = startLed; p < endLed; p++) {
            leds[p] = CRGB(breath, (breath * 158) / 245, (breath * 11) / 245);
          }
        }
      } else {
        if (nodes[item].status == "falla") {
          bool flash = ((now / 200) % 2 == 0);
          for (int p = startLed; p < endLed; p++) {
            leds[p] = flash ? CRGB::Red : CRGB(40, 0, 0);
          }
        } else if (nodes[item].status == "reparacion") {
          for (int p = startLed; p < endLed; p++) {
            leds[p] = CRGB(245, 158, 11);
          }
        } else {
          uint8_t breath = 70 + (sin8(now / 5) * 110) / 255;
          for (int p = startLed; p < endLed; p++) {
            leds[p] = CRGB(0, breath, (breath * 30) / 100);
          }
        }
      }
    }
  }
  FastLED.show();
}

// =============================================================================
// RENDERIZADO DE INTERFACES SEGÚN EL ESTADO ACTIVO
// =============================================================================

// Estado 1: SUPERVISOR GLOBAL (Fidelidad 100% al diseño del Emulador Web)
void renderSupervisorUI() {
  tft.fillScreen(COLOR_BG);

  // 1. Anillo Perimetral Circular (Radio 109, grosor 5, con inicio en la parte superior: -90°)
  float sliceAngle = 360.0 / (float)totalNodes;
  int faultsCount = 0;

  for (int i = 0; i < totalNodes; i++) {
    float startA = (i * sliceAngle) - 90.0 + 3.0;
    float endA = ((i + 1) * sliceAngle) - 90.0 - 3.0;
    uint16_t sliceColor = COLOR_OK;
    if (nodes[i].status == "falla") {
      sliceColor = COLOR_FAIL;
      faultsCount++;
    } else if (nodes[i].status == "reparacion") {
      sliceColor = COLOR_WARN;
    }
    drawArcSegment(120, 120, 109, 5, startA, endA, sliceColor);
  }

  // 2. Encabezado Superior (Centrado matemático en ejes 36 y 49 para margen con anillo)
  drawCenteredText(WiFi.status() == WL_CONNECTED ? "ONLINE CLOUD" : "OFFLINE NVS", 36, 1, WiFi.status() == WL_CONNECTED ? COLOR_CYAN : COLOR_WARN);
  String secName = assignedArea;
  secName.toUpperCase();
  if (secName.startsWith("AREA")) {
    secName = "AREA " + secName.substring(4) + " - FLOTA";
  } else {
    secName = secName + " - FLOTA";
  }
  drawCenteredText(secName, 49, 1, COLOR_MUTED);

  // 3. Tarjeta Hero Central (X:42, Y:66, W:156, H:86, Radio:10)
  uint16_t heroBorder = (faultsCount > 0) ? COLOR_WARN : COLOR_OK;
  tft.fillRoundRect(42, 66, 156, 86, 10, COLOR_PANEL);
  tft.drawRoundRect(42, 66, 156, 86, 10, heroBorder);
  tft.drawRoundRect(43, 67, 154, 84, 9, heroBorder);

  drawCenteredText("SUPERVISOR SCADA", 76, 1, COLOR_CARD_TEXT);

  // Disponibilidad % (OEE) con tipografía vectorial FreeSans Bold centrada
  float availability = ((float)(totalNodes - faultsCount) / (float)totalNodes) * 100.0;
  String dispStr = String((int)availability) + "% DISP";
  drawCenteredSans(dispStr, 96, &FreeSansBold9pt7b, (faultsCount == 0) ? COLOR_OK : COLOR_WARN);

  // Contadores de Salud (Y=114)
  String countStr = String(totalNodes - faultsCount) + " OK  |  " + String(faultsCount) + " PARO";
  drawCenteredText(countStr, 114, 1, COLOR_WHITE);

  // Estado de Línea (Y=128)
  if (faultsCount > 0) {
    for (int i = 0; i < totalNodes; i++) {
      if (nodes[i].status == "falla") {
        String alertText = "PARO: " + nodes[i].name;
        if (alertText.length() > 22) alertText = alertText.substring(0, 20) + "..";
        drawCenteredText(alertText, 128, 1, COLOR_FAIL);
        break;
      }
    }
  } else {
    drawCenteredText("LINEA EN OPERACION", 128, 1, COLOR_CYAN);
  }

  // 4. Pie de pantalla (Centrado: Y=174 y Y=188 para no invadir el anillo de R=104)
  drawCenteredText("PULSAR: REPORTAR PARO", 174, 1, COLOR_WHITE);
  drawCenteredText("SUPERVISION EN VIVO", 188, 1, COLOR_MUTED);
}

// Dibuja una barra de progreso que se va llenando suavemente
void drawProgressBar(int x, int y, int w, int h, float progress, uint16_t color) {
  tft.drawRoundRect(x, y, w, h, 3, COLOR_MUTED);
  int maxFill = w - 4;
  int fillW = (int)(maxFill * progress);
  if (fillW > maxFill) fillW = maxFill;
  if (fillW < 0) fillW = 0;
  if (fillW > 0) {
    tft.fillRoundRect(x + 2, y + 2, fillW, h - 4, 2, color);
  }
  if (fillW < maxFill) {
    tft.fillRect(x + 2 + fillW, y + 2, maxFill - fillW, h - 4, COLOR_BG);
  }
}

void renderHoldProgress(float progress) {
  if (currentState != STATE_SELECT_MACHINE && currentState != STATE_SELECT_REASON && currentState != STATE_CONFIRM_RESOLVE) {
    return;
  }
  NodeItem& current = nodes[selectedMachineIndex];
  bool isResolve = (currentState == STATE_CONFIRM_RESOLVE || (currentState == STATE_SELECT_MACHINE && current.status == "falla"));
  // Reporte de falla o salida -> LLENADO EN ROJO (#ef4444); Resolución -> LLENADO EN VERDE (#10b981)
  uint16_t barCol = isResolve ? COLOR_OK : COLOR_FAIL;
  drawProgressBar(45, 156, 150, 8, progress, barCol);
}

// Estado 2: SELECCIONAR GRÚA (CURSOR Y SELECCIÓN SIEMPRE EN ÁMBAR INDUSTRIAL #f59e0b)
void renderSelectMachineUI() {
  tft.fillScreen(COLOR_BG);
  bool isLast = (selectedMachineIndex == totalNodes - 1);
  NodeItem& current = nodes[selectedMachineIndex];
  bool isFault = (current.status == "falla");

  // Anillo perimetral: Grúa seleccionada SIEMPRE en ÁMBAR (#f59e0b) para indicar cursor activo
  float sliceAngle = 360.0 / (float)totalNodes;
  for (int i = 0; i < totalNodes; i++) {
    float startA = (i * sliceAngle) - 90.0 + 3.0;
    float endA = ((i + 1) * sliceAngle) - 90.0 - 3.0;
    uint16_t col = (i == selectedMachineIndex) ? COLOR_WARN : ((nodes[i].status == "falla") ? COLOR_FAIL : COLOR_OK);
    drawArcSegment(120, 120, 109, (i == selectedMachineIndex) ? 7 : 4, startA, endA, col);
  }

  // Encabezado SIEMPRE en ÁMBAR indicando selección activa
  drawCenteredText("SELECCIONAR GRUA", 36, 1, COLOR_WARN);
  String idxStr = "[ " + String(selectedMachineIndex + 1) + " / " + String(totalNodes) + (isLast ? " - SALIR ]" : " ]");
  drawCenteredText(idxStr, 49, 1, COLOR_MUTED);

  // Tarjeta Hero Central con borde Ámbar (#f59e0b)
  tft.fillRoundRect(42, 67, 156, 86, 10, 0x1221); // #14120e
  tft.drawRoundRect(42, 67, 156, 86, 10, COLOR_WARN);
  tft.drawRoundRect(43, 68, 154, 84, 9, COLOR_WARN);

  // Nombre de la Grúa en tipografía grande centrada
  drawCenteredSans(current.name, 89, &FreeSansBold9pt7b, COLOR_WHITE);

  if (isFault) {
    // Si la grúa seleccionada está en falla: Opción de resolver en Verde
    drawCenteredText("EQUIPO EN PARO", 107, 1, COLOR_FAIL);

    tft.fillRoundRect(52, 122, 136, 22, 5, 0x0563); // #062b1b
    tft.drawRoundRect(52, 122, 136, 22, 5, COLOR_OK);
    drawCenteredInBox("PASAR A OPERATIVA", 52, 122, 136, 22, 1, 0xAF7A); // #a7f3d0

    drawCenteredText("MANTENER: RESOLVER", 174, 1, COLOR_OK);
    drawCenteredText(isLast ? "CLIC: SALIR" : "CLIC: SIGUIENTE", 188, 1, isLast ? COLOR_FAIL : COLOR_MUTED);
  } else {
    // Si la grúa está operativa: Opción de reportar falla en Rojo
    tft.fillRoundRect(52, 118, 136, 24, 6, COLOR_WARN);
    drawCenteredInBox("OPERATIVA", 52, 118, 136, 24, 1, 0x0000);

    drawCenteredText("MANTENER: REPORTAR", 174, 1, COLOR_FAIL);
    drawCenteredText(isLast ? "CLIC: SALIR" : "CLIC: SIGUIENTE", 188, 1, isLast ? COLOR_FAIL : COLOR_MUTED);
  }
}

// Estado 3: SELECCIONAR MOTIVO DE PARO (FIDELIDAD 100% AL EMULADOR WEB)
void renderSelectReasonUI() {
  tft.fillScreen(COLOR_BG);
  int totalReasonOptions = totalReasons + 1; // N motivos + opción de SALIR
  bool isExit = (selectedReasonIndex >= totalReasons);
  NodeItem& current = nodes[selectedMachineIndex];

  // Anillo de 360° en Rojo (si es salir) o en Ámbar (si es motivo)
  drawArcSegment(120, 120, 109, 4, 0, 360, isExit ? COLOR_FAIL : COLOR_WARN);

  if (isExit) {
    // MENÚ DE SALIR / CANCELAR
    drawCenteredText("CANCELAR REPORTE", 36, 1, COLOR_FAIL);
    String idxStr = "[ " + String(totalReasonOptions) + " / " + String(totalReasonOptions) + " - SALIR ]";
    drawCenteredText(idxStr, 49, 1, COLOR_MUTED);

    tft.fillRoundRect(42, 67, 156, 86, 10, 0x1882); // #1c0f12
    tft.drawRoundRect(42, 67, 156, 86, 10, COLOR_FAIL);
    tft.drawRoundRect(43, 68, 154, 84, 9, COLOR_FAIL);

    drawCenteredText("X CANCELAR / SALIR", 82, 1, COLOR_FAIL);
    drawCenteredText("VOLVER AL MONITOR", 100, 1, 0xCE7C);

    tft.fillRoundRect(52, 122, 136, 22, 5, 0x28A2); // #291417
    tft.drawRoundRect(52, 122, 136, 22, 5, COLOR_FAIL);
    drawCenteredInBox("NO SE ENVIARA ALERTA", 52, 122, 136, 22, 1, 0xFD34);

    drawCenteredText("MANTENER: CANCELAR", 174, 1, COLOR_FAIL);
    drawCenteredText("CLIC: VOLVER A LISTA", 188, 1, COLOR_CYAN);
  } else {
    String currentReason = failureReasons[selectedReasonIndex];

    drawCenteredText("MOTIVO DE PARO", 36, 1, COLOR_WARN);
    String idxStr = "[ " + String(selectedReasonIndex + 1) + " / " + String(totalReasonOptions) + " ]";
    drawCenteredText(idxStr, 49, 1, COLOR_MUTED);

    tft.fillRoundRect(42, 67, 156, 86, 10, 0x1221); // #14120e
    tft.drawRoundRect(42, 67, 156, 86, 10, COLOR_WARN);
    tft.drawRoundRect(43, 68, 154, 84, 9, COLOR_WARN);

    drawCenteredText(current.name, 79, 1, COLOR_WARN);

    // Auto-wrap adaptativo sin desbordes para cualquier motivo proveniente de la Web
    drawAutoWrappedReason(currentReason, 100, COLOR_WHITE);

    tft.fillRoundRect(52, 122, 136, 22, 5, 0x2341); // #261b0c
    tft.drawRoundRect(52, 122, 136, 22, 5, COLOR_WARN);
    drawCenteredInBox("PARO NO PROGRAMADO", 52, 122, 136, 22, 1, 0xFEA9);

    drawCenteredText("MANTENER: REPORTAR", 174, 1, COLOR_FAIL);
    drawCenteredText("CLIC: SIGUIENTE", 188, 1, COLOR_MUTED);
  }
}

// Estado 4: CONFIRMAR RESOLUCIÓN DE PARO
void renderConfirmResolveUI() {
  tft.fillScreen(COLOR_BG);
  NodeItem& current = nodes[selectedMachineIndex];

  drawArcSegment(120, 120, 109, 5, 0, 360, COLOR_OK);

  drawCenteredText("RESOLVER PARO", 36, 1, COLOR_CYAN);
  drawCenteredText(current.name, 49, 1, COLOR_WHITE);

  tft.fillRoundRect(42, 67, 156, 86, 10, COLOR_PANEL);
  tft.drawRoundRect(42, 67, 156, 86, 10, COLOR_OK);
  tft.drawRoundRect(43, 68, 154, 84, 9, COLOR_OK);

  drawCenteredText("¿EQUIPO REPARADO?", 82, 1, COLOR_OK);
  drawCenteredSans(current.name, 103, &FreeSansBold9pt7b, COLOR_WHITE);

  tft.fillRoundRect(52, 122, 136, 22, 5, 0x0563);
  tft.drawRoundRect(52, 122, 136, 22, 5, COLOR_OK);
  drawCenteredInBox("PASAR A OPERATIVA", 52, 122, 136, 22, 1, 0xAF7A);

  drawCenteredText("MANTENER: CONFIRMAR", 174, 1, COLOR_OK);
  drawCenteredText("CLIC: CANCELAR", 188, 1, COLOR_MUTED);
}

// Estado 5: DESTELLO DE CONFIRMACIÓN (1.5 segundos)
void renderFeedbackFlashUI() {
  tft.fillScreen(COLOR_BG);

  uint16_t ringCol = (feedbackTitle.indexOf("ALERTA") >= 0 || feedbackTitle.indexOf("PARO") >= 0) ? COLOR_FAIL : COLOR_OK;
  drawArcSegment(120, 120, 109, 6, 0, 360, ringCol);

  tft.fillRoundRect(42, 67, 156, 86, 10, COLOR_PANEL);
  tft.drawRoundRect(42, 67, 156, 86, 10, ringCol);
  tft.drawRoundRect(43, 68, 154, 84, 9, ringCol);

  drawCenteredText(feedbackTitle, 80, 1, ringCol);
  drawCenteredSans(feedbackSub, 103, &FreeSansBold9pt7b, COLOR_WHITE);

  tft.fillRoundRect(52, 122, 136, 22, 5, 0x0A24);
  drawCenteredInBox(feedbackDetail, 52, 122, 136, 22, 1, COLOR_MUTED);

  drawCenteredText("NOTIFICANDO SCADA", 174, 1, ringCol);
  drawCenteredText("RETORNANDO...", 188, 1, COLOR_MUTED);
}

void renderCurrentUI() {
  switch (currentState) {
    case STATE_SUPERVISOR:
      renderSupervisorUI();
      break;
    case STATE_SELECT_MACHINE:
      renderSelectMachineUI();
      break;
    case STATE_SELECT_REASON:
      renderSelectReasonUI();
      break;
    case STATE_CONFIRM_RESOLVE:
      renderConfirmResolveUI();
      break;
    case STATE_FEEDBACK_FLASH:
      renderFeedbackFlashUI();
      break;
  }
  updatePhysicalLeds();
}

// =============================================================================
// PERSISTENCIA EN MEMORIA FLASH NVS (PREFERENCES)
// =============================================================================
void initNodesForArea(const String& area) {
  assignedArea = area;
  if (area.indexOf("10") != -1) {
    totalNodes = 4;
    nodes[0] = { "10A", "GRUA 10A", "operativa", "", 0 };
    nodes[1] = { "10B", "GRUA 10B", "operativa", "", 0 };
    nodes[2] = { "10C", "GRUA 10C", "operativa", "", 0 };
    nodes[3] = { "10D", "GRUA 10D", "operativa", "", 0 };
  } else if (area.indexOf("20") != -1) {
    totalNodes = 6;
    nodes[0] = { "20A", "GRUA 20A", "operativa", "", 0 };
    nodes[1] = { "20B", "GRUA 20B", "operativa", "", 0 };
    nodes[2] = { "20C", "GRUA 20C", "operativa", "", 0 };
    nodes[3] = { "20D", "GRUA 20D", "operativa", "", 0 };
    nodes[4] = { "20E", "GRUA 20E", "operativa", "", 0 };
    nodes[5] = { "20F", "GRUA 20F", "operativa", "", 0 };
  } else {
    totalNodes = 4;
    nodes[0] = { "30A", "GRUA 30A", "operativa", "", 0 };
    nodes[1] = { "30B", "GRUA 30B", "operativa", "", 0 };
    nodes[2] = { "30C", "GRUA 30C", "operativa", "", 0 };
    nodes[3] = { "30D", "GRUA 30D", "operativa", "", 0 };
  }
}

void loadCatalogFromNvs() {
  prefs.begin("scada_cfg", false);
  wifiSsid = prefs.getString("wifi_ssid", "Totalplay-6DAB");
  wifiPass = prefs.getString("wifi_pass", "cgonz181");
  assignedArea = prefs.getString("area", "area10");
  scadaServerHost = prefs.getString("pb_host", "192.168.100.34");
  if (scadaServerHost.length() == 0 || scadaServerHost == "192.168.100.33" || scadaServerHost == "null") {
    scadaServerHost = "192.168.100.34";
    prefs.putString("pb_host", scadaServerHost);
  }

  wifiSsid.trim();
  wifiPass.trim();

  // Auto-sanación: Si la clave en NVS quedó vacía, corrupta o en "TU_WIFI_SSID", restaurar credencial funcional
  if (wifiSsid.length() == 0 || wifiSsid == "TU_WIFI_SSID" || wifiSsid == "KEEP" || wifiSsid == "null") {
    wifiSsid = "Totalplay-6DAB";
    wifiPass = "cgonz181";
    prefs.putString("wifi_ssid", wifiSsid);
    prefs.putString("wifi_pass", wifiPass);
    Serial.printf("[NVS Auto-Fix] Credenciales Wi-Fi restauradas a defecto: %s\n", wifiSsid.c_str());
  } else if (wifiSsid == "Totalplay-6DAB" && (wifiPass.length() == 0 || wifiPass == "null")) {
    wifiPass = "cgonz181";
    prefs.putString("wifi_pass", wifiPass);
  }

  if (assignedArea.length() == 0 || assignedArea == "KEEP") {
    assignedArea = "area10";
    prefs.putString("area", assignedArea);
  }
  prefs.end();

  Serial.printf("[NVS] Red Wi-Fi recuperada de Flash: %s\n", wifiSsid.c_str());
  Serial.printf("[NVS] Seccion/Area asignada: %s\n", assignedArea.c_str());

  prefs.begin("scada_cfg", true);
  int savedReasonsCount = prefs.getInt("r_count", 0);
  if (savedReasonsCount > 0 && savedReasonsCount <= MAX_REASONS) {
    totalReasons = savedReasonsCount;
    for (int i = 0; i < totalReasons; i++) {
      String key = "r_" + String(i);
      failureReasons[i] = prefs.getString(key.c_str(), failureReasons[i]);
    }
    Serial.printf("[NVS] Cargados %d motivos de paro desde Flash.\n", totalReasons);
  } else {
    Serial.println("[NVS] Usando motivos por defecto de fábrica.");
  }

  int savedNodesCount = prefs.getInt("n_count", 0);
  if (savedNodesCount > 0 && savedNodesCount <= MAX_NODES) {
    totalNodes = savedNodesCount;
    for (int i = 0; i < totalNodes; i++) {
      String keyId = "nid_" + String(i);
      String keyNm = "nnm_" + String(i);
      String kSt = "nst_" + String(i);
      String kRe = "nre_" + String(i);
      nodes[i].id = prefs.getString(keyId.c_str(), nodes[i].id);
      nodes[i].name = prefs.getString(keyNm.c_str(), nodes[i].name);
      nodes[i].status = prefs.getString(kSt.c_str(), nodes[i].status);
      nodes[i].lastReason = prefs.getString(kRe.c_str(), nodes[i].lastReason);
    }
    Serial.printf("[NVS] Cargados %d equipos con su ultimo estado desde Flash.\n", totalNodes);
  } else {
    initNodesForArea(assignedArea);
    Serial.printf("[NVS] Inicializados 4 equipos por defecto para %s.\n", assignedArea.c_str());
  }
  prefs.end();
}

void saveStatusesToNvs() {
  prefs.begin("scada_cfg", false);
  prefs.putInt("n_count", totalNodes);
  for (int i = 0; i < totalNodes; i++) {
    String keyId = "nid_" + String(i);
    String keyNm = "nnm_" + String(i);
    String kSt = "nst_" + String(i);
    String kRe = "nre_" + String(i);
    prefs.putString(keyId.c_str(), nodes[i].id);
    prefs.putString(keyNm.c_str(), nodes[i].name);
    prefs.putString(kSt.c_str(), nodes[i].status);
    prefs.putString(kRe.c_str(), nodes[i].lastReason);
  }
  prefs.end();
}

void saveReasonsToNvs() {
  prefs.begin("scada_cfg", false);
  prefs.putInt("r_count", totalReasons);
  for (int i = 0; i < totalReasons; i++) {
    String key = "r_" + String(i);
    prefs.putString(key.c_str(), failureReasons[i]);
  }
  prefs.end();
  Serial.println("[NVS] Motivos de paro actualizados en Flash NVS.");
}

// =============================================================================
// SINCRONIZACIÓN CON FIRESTORE CLOUD (REST API)
// =============================================================================

// Descarga catálogo de motivos de paro y lista de equipos activos desde PocketBase
void fetchCloudConfig() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClient client;
  client.setTimeout(4000);
  HTTPClient http;
  http.setTimeout(4000);

  // 1. Descargar motivos de paro editables desde PocketBase config/failure_reasons
  String urlReasons = String("http://") + scadaServerHost + ":" + scadaServerPort +
                      "/api/collections/config/records?filter=(key='failure_reasons')";

  if (http.begin(client, urlReasons)) {
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
      String payload = http.getString();
      DynamicJsonDocument doc(4096);
      DeserializationError err = deserializeJson(doc, payload);
      if (!err && doc.containsKey("items") && doc["items"].size() > 0) {
        JsonArray arr = doc["items"][0]["value"].as<JsonArray>();
        if (arr.size() > 0) {
          bool reasonsChanged = (arr.size() != (size_t)totalReasons);
          int idx = 0;
          for (JsonVariant val : arr) {
            if (idx < MAX_REASONS) {
              String rStr = val.as<String>();
              if (idx >= totalReasons || failureReasons[idx] != rStr) {
                reasonsChanged = true;
              }
              failureReasons[idx++] = rStr;
            }
          }
          totalReasons = idx;
          if (reasonsChanged) {
            saveReasonsToNvs();
            Serial.printf("[SCADA PB] Catálogo de motivos actualizado desde Xiaomi: %d elementos.\n", totalReasons);
          }
        }
      }
    }
    http.end();
  }

  // 2. Descargar flota de grúas configurada para el área asignada desde config/cranes_config
  String urlCranes = String("http://") + scadaServerHost + ":" + scadaServerPort +
                     "/api/collections/config/records?filter=(key='cranes_config')";

  if (http.begin(client, urlCranes)) {
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
      String payload = http.getString();
      DynamicJsonDocument doc(4096);
      DeserializationError err = deserializeJson(doc, payload);
      if (!err && doc.containsKey("items") && doc["items"].size() > 0) {
        JsonObject cfg = doc["items"][0]["value"].as<JsonObject>();
        if (cfg.containsKey(assignedArea)) {
          JsonArray arr = cfg[assignedArea].as<JsonArray>();
          if (arr.size() > 0) {
            String newCranes[MAX_NODES];
            int newCount = 0;
            for (JsonVariant val : arr) {
              if (newCount < MAX_NODES) {
                newCranes[newCount++] = val.as<String>();
              }
            }

            bool cranesChanged = (newCount != totalNodes);
            if (!cranesChanged) {
              for (int i = 0; i < newCount; i++) {
                if (nodes[i].id != newCranes[i]) {
                  cranesChanged = true;
                  break;
                }
              }
            }

            if (cranesChanged && newCount > 0) {
              NodeItem updatedNodes[MAX_NODES];
              for (int i = 0; i < newCount; i++) {
                updatedNodes[i].id = newCranes[i];
                updatedNodes[i].name = "GRUA " + newCranes[i];
                updatedNodes[i].status = "operativa";
                updatedNodes[i].lastReason = "";
                updatedNodes[i].faultStartTime = 0;

                for (int j = 0; j < totalNodes; j++) {
                  if (nodes[j].id.equalsIgnoreCase(newCranes[i])) {
                    updatedNodes[i].status = nodes[j].status;
                    updatedNodes[i].lastReason = nodes[j].lastReason;
                    updatedNodes[i].faultStartTime = nodes[j].faultStartTime;
                    break;
                  }
                }
              }

              totalNodes = newCount;
              for (int i = 0; i < totalNodes; i++) {
                nodes[i] = updatedNodes[i];
              }

              if (selectedMachineIndex >= totalNodes) {
                selectedMachineIndex = 0;
              }

              saveStatusesToNvs();
              flagUiRefresh = true;
              Serial.printf("[SCADA PB] Flota de grúas actualizada para %s (%d equipos).\n",
                            assignedArea.c_str(), totalNodes);
            }
          }
        }
      }
    }
    http.end();
  }
}

// Consulta en tiempo real el estado de las grúas monitoreadas únicamente en crane_status/ (Ahorro 50% Cuota)
void fetchCraneStatuses() {
  // Ya no se bloquea cuando hay reportes en cola: un embotellamiento
  // de la cola dejaba al mando con un estado viejo y a los nodos enclavados.
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClient client;
  client.setTimeout(4000);
  HTTPClient http;
  http.setTimeout(4000);

  String url = String("http://") + scadaServerHost + ":" + scadaServerPort +
               "/api/collections/crane_status/records?perPage=50";

  if (http.begin(client, url)) {
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
      String payload = http.getString();
      DynamicJsonDocument doc(4096);
      DeserializationError err = deserializeJson(doc, payload);
      if (!err && doc.containsKey("items")) {
        JsonArray items = doc["items"].as<JsonArray>();
        String newStatuses[MAX_NODES];
        String newReasons[MAX_NODES];
        for (int i = 0; i < totalNodes; i++) {
          newStatuses[i] = "operativa";
          newReasons[i] = "";
        }

        for (JsonObject item : items) {
          String craneId = item["craneId"] | "";
          String est = item["estado"] | "";
          String mot = item["motivo"] | "";
          est.toLowerCase();

          for (int i = 0; i < totalNodes; i++) {
            if (nodes[i].id.equalsIgnoreCase(craneId)) {
              if (est == "en falla" || est == "falla" || est == "active" || est == "failure") {
                newStatuses[i] = "falla";
                newReasons[i] = (mot.length() > 0) ? mot : "Falla detectada";
              } else if (est == "reparacion" || est == "en reparacion" || est == "maintenance") {
                newStatuses[i] = "reparacion";
                newReasons[i] = (mot.length() > 0) ? mot : "En Mantenimiento";
              } else {
                newStatuses[i] = "operativa";
                newReasons[i] = "";
              }
              break;
            }
          }
        }

        bool changed = false;
        for (int i = 0; i < totalNodes; i++) {
          if (nodes[i].status != newStatuses[i]) {
            changed = true;
            if (newStatuses[i] == "falla" && nodes[i].status == "operativa") {
              nodes[i].faultStartTime = millis();
#ifdef BUZZER_PIN
              tone(BUZZER_PIN, 2400, 250);
#endif
            }
            nodes[i].status = newStatuses[i];
            nodes[i].lastReason = newReasons[i];
            broadcastEspNowCraneState(nodes[i].id, nodes[i].status, nodes[i].lastReason, MSG_STATUS_BROADCAST);
          }
        }

        if (changed) {
          saveStatusesToNvs();
          flagUiRefresh = true;
        }
      }
    }
    http.end();
  }
}

// =============================================================================
// CONTROLADOR MAESTRO ESP-NOW (HUB & SPOKE: MASTER <-> SATÉLITES)
// =============================================================================
static uint8_t scadaBroadcastMac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

void onEspNowDataRecvMaster(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len < (int)sizeof(ScadaEspNowPacket)) return;
  ScadaEspNowPacket pkt;
  memcpy(&pkt, data, sizeof(pkt));

  if (memcmp(pkt.magic, SCADA_MAGIC, 4) != 0) return;
  if (pkt.checksum != calcScadaChecksum(&pkt)) return;

  // Protección contra bucles y ecos: el Master procesa reportes, resoluciones y pings
  // de estado de los satélites. El ping es la solicitud de resincronización (un satélite
  // que arrancó después de la falla no recibe broadcast hasta el próximo cambio).
  if (pkt.msgType != MSG_BUTTON_REPORT && pkt.msgType != MSG_BUTTON_RESOLVE &&
      pkt.msgType != MSG_PING_HEARTBEAT) {
    return;
  }

  String craneId = String(pkt.craneId);
  String status  = String(pkt.status);
  String reason  = String(pkt.reason);
  craneId.trim();
  status.trim();
  status.toLowerCase();

  Serial.printf("[%lu] [ESP-NOW RX MASTER] Satelite -> Master: Grua=%s | Tipo=0x%02X | Estado=%s | Motivo=%s\n",
                millis(), craneId.c_str(), pkt.msgType, status.c_str(), reason.c_str());

  // Buscar si la grúa pertenece a este Centro de Mando
  bool foundLocal = false;

  if (pkt.msgType == MSG_PING_HEARTBEAT) {
    for (int i = 0; i < totalNodes; i++) {
      if (nodes[i].id.equalsIgnoreCase(craneId)) {
        broadcastEspNowCraneState(nodes[i].id, nodes[i].status, nodes[i].lastReason, MSG_STATUS_BROADCAST);
        break;
      }
    }
    return;  // el ping nunca genera reporte ni historial
  }
  for (int i = 0; i < totalNodes; i++) {
    if (nodes[i].id.equalsIgnoreCase(craneId)) {
      foundLocal = true;
      if (nodes[i].status != status || nodes[i].lastReason != reason) {
        nodes[i].status = status;
        nodes[i].lastReason = reason;
        if (status == "falla") {
          nodes[i].faultStartTime = millis();
#ifdef BUZZER_PIN
          tone(BUZZER_PIN, 2400, 250);
#endif
        } else if (status == "operativa") {
          nodes[i].faultStartTime = 0;
#ifdef BUZZER_PIN
          tone(BUZZER_PIN, 1800, 100);
#endif
        }
        saveStatusesToNvs();
        flagUiRefresh = true;
        // Encolar reporte para sincronizar en Cloud Firestore y notificar por WhatsApp
        queueReport(nodes[i].id, status, reason);
      }
      break;
    }
  }

  // 🛡️ GATEWAY UNIVERSAL SCADA (Misión Crítica):
  // Si la grúa pertenece a otra bahía (ej. 20C escuchada por Master Área 10),
  // NUNCA descartar el reporte de paro; actuar como Gateway y encolar de inmediato a Firestore y WhatsApp.
  if (!foundLocal) {
    Serial.printf("[ESP-NOW GATEWAY UNIVERSAL] Grúa %s recibida de otra bahía. Retransmitiendo a Nube y WhatsApp...\n", craneId.c_str());
    queueReport(craneId, status, reason);
  }
}

void initEspNowMaster() {
  if (espNowMasterActive) return;
  if (esp_now_init() != ESP_OK) {
    Serial.println(F("[ESP-NOW MASTER] Error al inicializar subsistema"));
    return;
  }
  esp_now_peer_info_t peerInfo;
  memset(&peerInfo, 0, sizeof(peerInfo));
  memcpy(peerInfo.peer_addr, scadaBroadcastMac, 6);
  peerInfo.channel = ESPNOW_CHANNEL;  // canal fijo compartido con los satelites // Canal activo Wi-Fi
  peerInfo.encrypt = false;
  if (esp_now_add_peer(&peerInfo) == ESP_OK) {
    espNowMasterActive = true;
    esp_now_register_recv_cb(onEspNowDataRecvMaster);
    Serial.println(F("[ESP-NOW MASTER] Red Mesh Local SCADA activa (Broadcast FF:FF:FF:FF:FF:FF)"));
  } else {
    Serial.println(F("[ESP-NOW MASTER] Error registrando peer broadcast"));
  }
}

void broadcastEspNowCraneState(const String& craneId, const String& status, const String& reason, uint8_t msgType) {
  if (!espNowMasterActive) initEspNowMaster();
  if (!espNowMasterActive) return;

  ScadaEspNowPacket pkt;
  memset(&pkt, 0, sizeof(pkt));
  memcpy(pkt.magic, SCADA_MAGIC, 4);
  pkt.msgType = msgType;
  strncpy(pkt.craneId, craneId.c_str(), sizeof(pkt.craneId) - 1);
  strncpy(pkt.status, status.c_str(), sizeof(pkt.status) - 1);
  strncpy(pkt.reason, reason.c_str(), sizeof(pkt.reason) - 1);
  pkt.timestamp = millis();
  pkt.checksum = calcScadaChecksum(&pkt);

  esp_err_t res = esp_now_send(scadaBroadcastMac, (uint8_t*)&pkt, sizeof(pkt));
  if (res == ESP_OK) {
    Serial.printf("[%lu] [ESP-NOW TX MASTER] -> Satelites: %s | Estado: %s | Motivo: %s\n",
                  millis(), pkt.craneId, pkt.status, pkt.reason);
  } else {
    Serial.printf("[ESP-NOW TX MASTER] Error de envio: %d\n", res);
  }
}

// =============================================================================
// FUNCIONES DE COLA RESILIENTE OFFLINE
// =============================================================================

void queueReport(String nodeId, String newStatus, String reasonText) {
  // Transmisión inmediata por ESP-NOW al nodo satélite de la grúa (< 5ms)
  broadcastEspNowCraneState(nodeId, newStatus, reasonText);

  int currentPending = 0;
  portENTER_CRITICAL(&queueMux);
  // Deduplicación en cola: si ya existe reporte idéntico pendiente, evitar duplicados
  for (int i = 0; i < pendingCount; i++) {
    if (strcmp(pendingQueue[i].nodeId, nodeId.c_str()) == 0 &&
        strcmp(pendingQueue[i].status, newStatus.c_str()) == 0) {
      portEXIT_CRITICAL(&queueMux);
      return;
    }
  }

  if (pendingCount < MAX_PENDING_REPORTS) {
    memset(&pendingQueue[pendingCount], 0, sizeof(PendingReport));
    strncpy(pendingQueue[pendingCount].nodeId, nodeId.c_str(), sizeof(pendingQueue[pendingCount].nodeId) - 1);
    strncpy(pendingQueue[pendingCount].status, newStatus.c_str(), sizeof(pendingQueue[pendingCount].status) - 1);
    strncpy(pendingQueue[pendingCount].reason, reasonText.c_str(), sizeof(pendingQueue[pendingCount].reason) - 1);
    pendingQueue[pendingCount].retries = 0;
    pendingQueue[pendingCount].lastAttempt = 0;
    pendingCount++;
    currentPending = pendingCount;
  }
  portEXIT_CRITICAL(&queueMux);

  if (currentPending > 0) {
    Serial.printf("[OFFLINE QUEUE] Evento guardado en buffer: %s -> %s (Total en cola: %d)\n", nodeId.c_str(), newStatus.c_str(), currentPending);
  }
}

void flushPendingReportsCore0() {
  if (WiFi.status() != WL_CONNECTED || pendingCount == 0) return;
  PendingReport item;
  
  portENTER_CRITICAL(&queueMux);
  if (pendingCount == 0) {
    portEXIT_CRITICAL(&queueMux);
    return;
  }
  // Backoff mínimo de 5s entre reintentos para evitar saturación de la nube y bucles de bot
  if (pendingQueue[0].lastAttempt != 0 && (millis() - pendingQueue[0].lastAttempt < 5000)) {
    portEXIT_CRITICAL(&queueMux);
    return;
  }
  pendingQueue[0].lastAttempt = millis();
  item = pendingQueue[0];
  portEXIT_CRITICAL(&queueMux);

  Serial.printf("[Core 0 NetTask] Sincronizando evento en cola: %s -> %s (%s) [Intento %d/3]. En cola: %d\n",
                item.nodeId, item.status, item.reason, item.retries + 1, pendingCount);

  bool ok = syncNodeStatusToCloud(String(item.nodeId), String(item.status), String(item.reason));

  int remaining = 0;
  bool discarded = false;
  int currentRetries = 0;

  portENTER_CRITICAL(&queueMux);
  if (ok) {
    for (int i = 0; i < pendingCount - 1; i++) {
      pendingQueue[i] = pendingQueue[i + 1];
    }
    pendingCount--;
    remaining = pendingCount;
  } else {
    pendingQueue[0].retries++;
    currentRetries = pendingQueue[0].retries;
    if (pendingQueue[0].retries >= 3) {
      discarded = true;
      for (int i = 0; i < pendingCount - 1; i++) {
        pendingQueue[i] = pendingQueue[i + 1];
      }
      pendingCount--;
      remaining = pendingCount;
    }
  }
  portEXIT_CRITICAL(&queueMux);

  if (ok) {
    Serial.printf("[Core 0 NetTask] Evento confirmado y liberado de cola: %s. Restantes: %d\n", item.nodeId, remaining);
  } else if (discarded) {
    Serial.printf("[Core 0 NetTask] Maximo de reintentos (3) alcanzado para %s. Descartando reporte.\n", item.nodeId);
  } else {
    Serial.printf("[Core 0 NetTask] Fallo al sincronizar %s con Firestore. Se retiene para reintento (%d/3).\n", item.nodeId, currentRetries);
  }
}

// Genera timestamp ISO 8601 (UTC) para Firestore
String getIsoTimestamp() {
  time_t now = time(nullptr);
  struct tm ti;
  gmtime_r(&now, &ti);
  char buf[30];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &ti);
  return String(buf);
}

// Genera nombre de colección de historial según fecha y jornada industrial de Chihuahua (UTC-6)
String getShiftHistoryCollectionName() {
  time_t now = time(nullptr);
  // Mismo criterio que la web (window.SHIFTS): A/B 6AM-6PM, C/D 6PM-6AM, y el domingo antes de
  // las 6 AM pertenece a la Jornada D.
  return "crane_history_" + chihuahuaDay(now) + "_" + chihuahuaShift(now);
}

// Reporta cambio de estado de máquina a Firestore con transaccionalidad estricta y sockets dedicados
bool syncNodeStatusToCloud(String nodeId, String newStatus, String reasonText) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  pbSyncClock();  // reloj del nodo desde la cabecera Date de PocketBase
  WiFiClient client;
  client.setTimeout(4000);
  HTTPClient http;
  http.setTimeout(4000);

  String cleanArea = assignedArea;
  cleanArea.replace("area", "");
  cleanArea.replace("AREA", "");
  cleanArea.trim();
  if (cleanArea.length() == 0) cleanArea = assignedArea;

  // 1. Obtener id de registro en crane_status para este craneId
  String findUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                   "/api/collections/crane_status/records?filter=(craneId='" + nodeId + "')";
  String pbRecordId = "";
  if (http.begin(client, findUrl)) {
    if (http.GET() == HTTP_CODE_OK) {
      DynamicJsonDocument fDoc(1024);
      deserializeJson(fDoc, http.getString());
      if (fDoc.containsKey("items") && fDoc["items"].size() > 0) {
        pbRecordId = fDoc["items"][0]["id"].as<String>();
      }
    }
    http.end();
  }

  // 1b. El firmware NO crea registros: el panel de administración es el creador de las
  //     áreas, las grúas y su fila espejo en crane_status. Si la fila no existe, el ESP32
  //     avisa y no escribe (evita registros inventados por el hardware).
  if (pbRecordId.length() == 0) {
    Serial.printf("[SCADA PB] crane_status/%s no existe. Debe crearla el panel de administración; no se escribe.\n", nodeId.c_str());
    client.stop();
    return false;
  }

  bool success = true;

  if (newStatus == "falla") {
    reportedIsoAtFailure = isoOrServerIso();  // snapshot del reporte para el historial
    // 2. Actualizar crane_status a 'En Falla'
    if (pbRecordId.length() > 0) {
      String patchUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                        "/api/collections/crane_status/records/" + pbRecordId;
      if (http.begin(client, patchUrl)) {
        http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", pbAuthHeader());
        String b = String("{\"estado\":\"En Falla\",\"motivo\":\"") + reasonText + "\",\"source\":\"esp32\"}";
        int code = http.PATCH(b);
        Serial.printf("[SCADA PB] crane_status %s -> HTTP %d\n", nodeId.c_str(), code);
        http.end();
        if (code != HTTP_CODE_OK && code != 200 && code != 204) success = false;
      }
    }

    // 3. Registrar ticket en cranes
    String cranesUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                       "/api/collections/cranes/records";
    if (http.begin(client, cranesUrl)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", pbAuthHeader());
      String reportIso = getIsoTimestamp();
      // El ticket físico necesita su entrada 'failed' en statusHistory: el Historial de Grúas
      // de la web (public/app.js, analisis-detallado.js) calcula los tiempos ANDON leyendo
      // statusHistory, y sin esta entrada el historial de un reporte por botón quedaba vacío.
      String histEntry = "[{\"status\":\"failed\",\"at\":\"" + jsonEscape(reportIso) +
                         "\",\"by\":\"esp32\",\"byName\":\"Centro de Mando\",\"note\":\"" + jsonEscape(reasonText) + "\"}]";
      String cb = String("{\"craneId\":\"") + nodeId + "\",\"status\":\"active\",\"description\":\"" + reasonText +
                  "\",\"area\":\"" + cleanArea + "\",\"source\":\"esp32\",\"reportedBy\":\"Boton fisico\"" +
                  ",\"reportedAt\":\"" + jsonEscape(reportIso) + "\",\"statusHistory\":" + histEntry + "}";
      http.POST(cb);
      http.end();
    }

    // 4. Registrar notificación
    String notifUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                      "/api/collections/notifications/records";
    if (http.begin(client, notifUrl)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", pbAuthHeader());
      String nb = String("{\"type\":\"crane_failure\",\"status\":\"pending\",\"craneId\":\"") + nodeId +
                  "\",\"area\":\"" + cleanArea + "\",\"description\":\"" + reasonText +
                  "\",\"reportedBy\":\"Centro de Mando (" + assignedArea + ")\",\"message\":\"Falla en grúa " + nodeId + ": " + reasonText + "\",\"source\":\"esp32\"}";
      http.POST(nb);
      http.end();
    }
  } else {
    // newStatus == "operativa"
    // 2. Actualizar crane_status a 'operativa'
    if (pbRecordId.length() > 0) {
      String patchUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                        "/api/collections/crane_status/records/" + pbRecordId;
      if (http.begin(client, patchUrl)) {
        http.addHeader("Content-Type", "application/json");
        http.addHeader("Authorization", pbAuthHeader());
        String b = "{\"estado\":\"operativa\",\"motivo\":\"\",\"source\":\"esp32\"}";
        int code = http.PATCH(b);
        Serial.printf("[SCADA PB] crane_status %s (Operativa) -> HTTP %d\n", nodeId.c_str(), code);
        http.end();
        if (code != HTTP_CODE_OK && code != 200 && code != 204) success = false;
      }
    }

    // 2b. Eliminar tickets activos en la colección cranes para esta grúa y archivar el
    //     evento en crane_history antes de borrarlos (el historial necesita reportedAt
    //     y la entrada 'maintenance' de statusHistory para los 3 tiempos ANDON).
    String serverIso = "";
    String histPayload = "";
    String findActUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                        "/api/collections/cranes/records?filter=(craneId='" + nodeId + "')";
    if (http.begin(client, findActUrl)) {
      http.addHeader("Authorization", pbAuthHeader());
      http.collectHeaders(kDateHeaderKeys, 1);
      if (http.GET() == HTTP_CODE_OK) {
        String dateHeader = http.header("Date");
        if (syncClockFromHttpDate(dateHeader)) serverIso = getIsoTimestamp();
        else serverIso = httpDateToIso(dateHeader);

        DynamicJsonDocument aDoc(2048);
        String bodyTxt = http.getString();
        if (!deserializeJson(aDoc, bodyTxt) && aDoc.containsKey("items")) {
          JsonArray items = aDoc["items"].as<JsonArray>();
          if (items.size() > 0) {
            histPayload = buildCraneHistoryPayload(items[0].as<JsonObject>(), serverIso,
                                                   "Resuelta en Centro de Mando",
                                                   "Centro de Mando", cleanArea);
          }
          http.end();
          for (JsonObject it : items) {
            String cid = it["id"].as<String>();
            if (cid.length() > 0) {
              String delUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                              "/api/collections/cranes/records/" + cid;
              if (http.begin(client, delUrl)) {
                http.addHeader("Authorization", pbAuthHeader());
                http.sendRequest("DELETE");
                http.end();
              }
            }
          }
        } else {
          http.end();
        }
      } else {
        http.end();
      }
    }

    if (histPayload.length() > 0) {
      String histUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                       "/api/collections/crane_history/records";
      if (http.begin(client, histUrl)) {
        http.addHeader("Content-Type", "application/json");
        http.addHeader("Authorization", pbAuthHeader());
        int hCode = http.POST(histPayload);
        if ((hCode == 400 || hCode == 401) && pbEnsureValidToken()) {
          Serial.println("[HISTORIAL] reintento con token renovado...");
          hCode = http.POST(histPayload);
        }
        Serial.printf("[HISTORIAL] crane_history %s -> HTTP %d (%s/%s)\n",
                      nodeId.c_str(), hCode, histDayAtReport.c_str(), histShiftAtReport.c_str());
        http.end();
      }
    }

    // 3. Registrar notificación de resolución
    String notifUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                      "/api/collections/notifications/records";
    if (http.begin(client, notifUrl)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", pbAuthHeader());
      String nb = String("{\"type\":\"crane_resolved\",\"status\":\"pending\",\"craneId\":\"") + nodeId +
                  "\",\"area\":\"" + cleanArea + "\",\"description\":\"Falla resuelta\",\"resolvedBy\":\"Centro de Mando\",\"resolution\":\"Resuelta en Centro de Mando\",\"message\":\"Grúa " + nodeId + " operativa (confirmado en botón)\",\"source\":\"esp32\"}";
      http.POST(nb);
      http.end();
    }
  }

  return success;
}

// =============================================================================
// GESTIÓN DE RED WI-FI Y PORTAL CAUTIVO
// =============================================================================
#include <esp_mac.h>
String getCleanMac() {
  uint8_t baseMac[6];
  esp_read_mac(baseMac, ESP_MAC_WIFI_STA);
  char buf[13];
  snprintf(buf, sizeof(buf), "%02X%02X%02X%02X%02X%02X", baseMac[0], baseMac[1], baseMac[2], baseMac[3], baseMac[4], baseMac[5]);
  return String(buf);
}

String getFormattedMac() {
  uint8_t baseMac[6];
  esp_read_mac(baseMac, ESP_MAC_WIFI_STA);
  char buf[18];
  snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X", baseMac[0], baseMac[1], baseMac[2], baseMac[3], baseMac[4], baseMac[5]);
  return String(buf);
}

// Envía latido (heartbeat) periódico a crane_devices/{mac} en PocketBase para aparecer en línea en la Web (admin.html)
// y sincroniza atómicamente cualquier cambio remoto de área/sección asignado desde el dashboard
// Fallback de reloj: cuando NTP (UDP 123) está bloqueado en la red, el reloj del ESP32
// queda en 1970 y el panel muestra el nodo "caído" aunque el latido sea HTTP 200.
// Se sincroniza usando la cabecera "Date" de la respuesta HTTP de PocketBase.
static time_t epochFromTmUtc(const struct tm* t) {
  static const int mdays[12] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
  int y = t->tm_year + 1900;
  long days = (long)(y - 1970) * 365 + (y - 1969) / 4 - (y - 1901) / 100 + (y - 1601) / 400;
  int m = t->tm_mon;
  days += mdays[m];
  if (m > 1 && (y % 4 == 0) && (y % 100 != 0 || y % 400 == 0)) days += 1;
  days += t->tm_mday - 1;
  return (time_t)days * 86400 + t->tm_hour * 3600 + t->tm_min * 60 + t->tm_sec;
}

static time_t httpDateToEpoch(const String& h) {
  if (h.length() < 29) return 0;
  static const char* mn[12] = {"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"};
  int mo = -1;
  for (int i = 0; i < 12; i++) {
    if (h.substring(8, 11) == mn[i]) { mo = i; break; }
  }
  if (mo < 0) return 0;
  int d  = h.substring(5, 7).toInt();
  int y  = h.substring(12, 16).toInt();
  int hh = h.substring(17, 19).toInt();
  int mi = h.substring(20, 22).toInt();
  int ss = h.substring(23, 25).toInt();
  if (y < 2024 || d < 1 || d > 31) return 0;
  struct tm t;
  memset(&t, 0, sizeof(t));
  t.tm_year = y - 1900;
  t.tm_mon = mo;
  t.tm_mday = d;
  t.tm_hour = hh;
  t.tm_min = mi;
  t.tm_sec = ss;
  return epochFromTmUtc(&t);
}

static bool syncClockFromHttpDate(const String& dateHeader) {
  // strptime() no resuelve los nombres de día/mes en la newlib del ESP32, así que el reloj
  // quedaba en 1970 y los tickets de 'cranes' salían con reportedAt:"1970-01-01T00:00:xxZ"
  // (inflando los tiempos ANDON del Historial de Grúas). Se parsea RFC 1123 por posiciones.
  time_t utc = httpDateToEpoch(dateHeader);
  if (utc < 1700000000) return false;
  struct timeval tv;
  tv.tv_sec = utc;
  tv.tv_usec = 0;
  settimeofday(&tv, nullptr);
  return true;
}

// Parser manual de la cabecera HTTP "Date": strptime() no resuelve los nombres de día/mes en
// newlib de ESP32 y, con UDP 123 bloqueado en la red, el reloj quedaba en 1970. Se parsean las
// posiciones fijas de RFC 1123 para poder escribir lastSeen aunque el reloj local no esté synced.

// Sincroniza el reloj del nodo usando la cabecera "Date" de PocketBase. NTP (UDP 123) está
// bloqueado en esta red, así que sin esto el reloj queda en 1970 y el historial se llena con
// reportedAt:"1970-01-01T00:00:xxZ", lo que infla los tiempos ANDON.
static bool pbSyncClock() {
  HTTPClient h;
  h.begin(String("http://") + scadaServerHost + ":" + String(scadaServerPort) + "/health");
  h.setTimeout(6000);
  h.collectHeaders(kDateHeaderKeys, 1);
  if (h.GET() != HTTP_CODE_OK) { h.end(); return false; }
  String dh = h.header("Date");
  bool ok = syncClockFromHttpDate(dh);
  if (!ok) Serial.printf("[RELOJ] No sincronizado. Cabecera Date: '%s'\n", dh.c_str());
  h.end();
  return ok;
}

// ISO del momento actual. Si el reloj local sigue en 1970 (NTP bloqueado y settimeofday no
// aplicado), se usa la cabecera "Date" del servidor como timestamp: sin esto el ticket de
// 'cranes' y el historial salían con reportedAt:"1970-01-01T00:00:xxZ" y los tiempos ANDON
// se inflaban.
static String isoOrServerIso() {
  if (time(nullptr) >= 1700000000) return getIsoTimestamp();
  HTTPClient h;
  h.begin(String("http://") + scadaServerHost + ":" + String(scadaServerPort) + "/health");
  h.setTimeout(6000);
  h.collectHeaders(kDateHeaderKeys, 1);
  if (h.GET() != HTTP_CODE_OK) { h.end(); return ""; }
  String iso = httpDateToIso(h.header("Date"));
  h.end();
  return iso;
}

static String httpDateToIso(const String& h) {
  if (h.length() < 29) return "";
  static const char* mn[12] = {"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"};
  int mo = -1;
  for (int i = 0; i < 12; i++) {
    if (h.substring(8, 11) == mn[i]) { mo = i; break; }
  }
  if (mo < 0) return "";
  int d = h.substring(5, 7).toInt();
  int y = h.substring(12, 16).toInt();
  int hh = h.substring(17, 19).toInt();
  int mi = h.substring(20, 22).toInt();
  int ss = h.substring(23, 25).toInt();
  if (y < 2024 || d < 1 || d > 31) return "";
  char buf[25];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ", y, mo + 1, d, hh, mi, ss);
  return String(buf);
}


// =============================================================================
// ARCHIVO DE HISTORIAL (crane_history) DESDE EL BOTÓN FÍSICO
// =============================================================================
// Igual que en los nodos satélite: sin esto el Centro de Mando sólo escribe
// crane_status/cranes/notifications y el Historial de Grúas de la web queda vacío para
// los eventos físicos. day/shift se escriben con el mismo formato que espera
// public/pocketbase-adapter.js (day='YYYY-MM-DD' && shift='JornadaA').
static String jsonEscape(const String& s) {
  String out;
  out.reserve(s.length() + 8);
  for (unsigned int i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else if ((unsigned char)c < 32) continue;
    else out += c;
  }
  return out;
}

// PocketBase devuelve "" para un texto vacío y ArduinoJson devuelve la cadena "null"
// para un JSON null, por eso se normaliza aquí: sin esto el historial se llenaba con
// reportedAt:"null" y los tiempos ANDON salían absurdos.
static String jsonText(JsonVariant v) {
  if (v.isNull()) return "";
  if (v.is<const char*>()) return v.as<String>();
  return v.as<String>();
}

static time_t isoToEpoch(const String& iso) {
  if (iso.length() < 20) return 0;
  int y = iso.substring(0, 4).toInt();
  int mo = iso.substring(5, 7).toInt();
  int d = iso.substring(8, 10).toInt();
  int hh = iso.substring(11, 13).toInt();
  int mi = iso.substring(14, 16).toInt();
  int ss = iso.substring(17, 19).toInt();
  if (y < 1970 || mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
  long long days = (long long)(y - 1970) * 365;
  for (int yy = 1970; yy < y; yy++) {
    if (yy % 4 == 0 && (yy % 100 != 0 || yy % 400 == 0)) days += 1;
  }
  static const int mdays[12] = {31,28,31,30,31,30,31,31,30,31,30,31};
  for (int m = 1; m < mo; m++) {
    days += mdays[m - 1];
    if (m == 2 && (y % 4 == 0) && (y % 100 != 0 || y % 400 == 0)) days += 1;
  }
  days += d - 1;
  return (time_t)(days * 86400LL + (long long)hh * 3600 + (long long)mi * 60 + ss);
}

static String chihuahuaDay(time_t epoch) {
  time_t chihTime = epoch - (6 * 3600);
  struct tm ti;
  gmtime_r(&chihTime, &ti);
  char buf[16];
  strftime(buf, sizeof(buf), "%Y-%m-%d", &ti);
  return String(buf);
}

static String chihuahuaShift(time_t epoch) {
  time_t chihTime = epoch - (6 * 3600);
  struct tm ti;
  gmtime_r(&chihTime, &ti);
  int day = ti.tm_wday;
  int hour = ti.tm_hour;
  if (hour >= 6 && hour < 18) return (day <= 2) ? "JornadaA" : "JornadaB";
  // El domingo antes de las 6 AM pertenece a la Jornada D (igual que window.SHIFTS en la web),
  // no a la C: si no, el Historial de Grúas agrupa el evento en la jornada equivocada.
  if (day == 0 && hour < 6) return "JornadaD";
  return (day <= 2) ? "JornadaC" : "JornadaD";
}

static String buildCraneHistoryPayload(JsonObject rec, const String& serverIso,
                                       const String& resolutionText,
                                       const String& resolvedByName,
                                       const String& areaCode) {
  String reportedIso = jsonText(rec["reportedAt"]);
  if (reportedIso.length() == 0) reportedIso = jsonText(rec["timestamp"]);
  if (reportedIso.length() == 0) reportedIso = reportedIsoAtFailure;  // snapshot del reporte
  if (reportedIso.length() == 0) reportedIso = serverIso;
  // Un reportedAt de 1970 (reloj sin sincronizar) o "null" invalida las métricas ANDON.
  if (reportedIso.substring(0, 4).toInt() < 2020) reportedIso = serverIso;
  if (reportedIso.substring(0, 4).toInt() < 2020) return "";

  time_t resolvedEpoch = (time(nullptr) >= 1700000000) ? time(nullptr) : isoToEpoch(serverIso);
  if (resolvedEpoch < 1700000000 || reportedIso.length() == 0) return "";

  long long totalTime = (long long)(resolvedEpoch - isoToEpoch(reportedIso));
  if (totalTime < 0) totalTime = 0;

  long long responseTime = 0;
  long long repairTime = totalTime;
  String maintIso = "";
  if (rec.containsKey("statusHistory") && rec["statusHistory"].is<JsonArray>()) {
    for (JsonObject e : rec["statusHistory"].as<JsonArray>()) {
      if (e.containsKey("status") && e["status"].as<String>() == "maintenance" && e.containsKey("at")) {
        maintIso = e["at"].as<String>();
        break;
      }
    }
  }
  if (maintIso.length() > 0) {
    time_t maintEpoch = isoToEpoch(maintIso);
    if (maintEpoch >= 1700000000) {
      responseTime = (long long)(maintEpoch - isoToEpoch(reportedIso));
      repairTime = (long long)(resolvedEpoch - maintEpoch);
      if (responseTime < 0) responseTime = 0;
      if (repairTime < 0) repairTime = 0;
    }
  }

  String techName = rec.containsKey("technicianName") ? rec["technicianName"].as<String>() : "Boton fisico";
  if (techName.length() == 0) techName = "Boton fisico";
  String desc = rec.containsKey("description") ? rec["description"].as<String>() : "Falla reportada desde Boton fisico";
  if (desc.length() == 0) desc = "Falla reportada desde Boton fisico";
  String reporter = rec.containsKey("reportedBy") ? rec["reportedBy"].as<String>() : "Boton fisico";
  if (reporter.length() == 0) reporter = "Boton fisico";
  String area = (areaCode.length() > 0) ? areaCode : (rec.containsKey("area") ? rec["area"].as<String>() : "");
  // day/shift se calculan sobre reportedAt (el momento del reporte), no sobre el instante de la
  // resolución: la web (Análisis Detallado / Historial de Grúas) agrupa los registros por estos
  // campos, así que una falla reportada en una jornada y resuelta en otra debe quedar en la
  // jornada donde se reportó.
  time_t repEpoch = isoToEpoch(reportedIso);
  if (repEpoch < 1700000000) repEpoch = (time(nullptr) >= 1700000000) ? time(nullptr) : isoToEpoch(serverIso);
  String dayStr = chihuahuaDay(repEpoch);
  String shiftStr = chihuahuaShift(repEpoch);
  histDayAtReport = dayStr;
  histShiftAtReport = shiftStr;
  String nowIso = (time(nullptr) >= 1700000000) ? getIsoTimestamp() : serverIso;

  String statusHist;
  if (rec.containsKey("statusHistory") && rec["statusHistory"].is<JsonArray>()) {
    DynamicJsonDocument histDoc(1024);
    histDoc.set(rec["statusHistory"]);
    serializeJson(histDoc, statusHist);
  }
  if (statusHist.length() == 0) {
    // Ticket creado antes de la entrada 'failed' (o creado por la web sin historial): se
    // sintetiza a partir de reportedAt para que el Historial de Grúas muestre la línea de
    // tiempo completa del evento físico.
    statusHist = "[{\"status\":\"failed\",\"at\":\"" + jsonEscape(reportedIso) +
                 "\",\"by\":\"esp32\",\"byName\":\"Centro de Mando\",\"note\":\"Boton fisico\"}]";
  }
  // Se cierra la línea de tiempo con la entrada 'resolved' (el Historial de Grúas de la web
  // recorre statusHistory para pintar el evento; sin ella sólo se veía el reporte).
  if (statusHist.endsWith("]")) {
    String resolvedEntry = "{\"status\":\"resolved\",\"at\":\"" + jsonEscape(nowIso) +
                           "\",\"by\":\"esp32\",\"byName\":\"" + jsonEscape(resolvedByName) +
                           "\",\"note\":\"" + jsonEscape(resolutionText) + "\"}";
    statusHist = statusHist.substring(0, statusHist.length() - 1) + "," + resolvedEntry + "]";
  }

  String p = "{";
  p += "\"craneId\":\"" + jsonEscape(rec.containsKey("craneId") ? rec["craneId"].as<String>() : "") + "\",";
  p += "\"status\":\"resolved\",";
  p += "\"description\":\"" + jsonEscape(desc) + "\",";
  p += "\"area\":\"" + jsonEscape(area) + "\",";
  p += "\"reportedBy\":\"" + jsonEscape(reporter) + "\",";
  p += "\"reportedAt\":\"" + jsonEscape(reportedIso) + "\",";
  p += "\"resolvedAt\":\"" + jsonEscape(nowIso) + "\",";
  p += "\"resolvedBy\":\"" + jsonEscape(resolvedByName) + "\",";
  p += "\"technicianName\":\"" + jsonEscape(techName) + "\",";
  p += "\"resolution\":\"" + jsonEscape(resolutionText) + "\",";
  p += "\"day\":\"" + dayStr + "\",";
  p += "\"shift\":\"" + shiftStr + "\",";
  p += "\"shiftStart\":\"" + jsonEscape(reportedIso) + "\",";
  p += "\"shiftEnd\":\"" + jsonEscape(nowIso) + "\",";
  p += "\"timeFailed\":" + String(responseTime) + ",";
  p += "\"timeMaintenance\":" + String(repairTime) + ",";
  p += "\"totalTime\":" + String(totalTime) + ",";
  p += "\"tiempoRespuestaSegundos\":" + String(responseTime) + ",";
  p += "\"tiempoReparacionSegundos\":" + String(repairTime) + ",";
  p += "\"downtimeTotalSegundos\":" + String(totalTime) + ",";
  p += "\"downtimeSeconds\":" + String(totalTime) + ",";
  p += "\"durationSeconds\":" + String(totalTime) + ",";
  p += "\"durationMinutes\":" + String(totalTime / 60) + ",";
  p += "\"downtimeMinutes\":" + String(totalTime / 60) + ",";
  p += "\"statusHistory\":" + statusHist + ",";
  p += "\"source\":\"esp32\"";
  p += "}";
  return p;
}


// Validación de destino: un Centro de Mando sólo admite un área (area10/area20/area30).
// Se comparte entre el hot-swap OTA (Web Admin) y el comando serie SET_CONFIG, de forma que
// el panel y el firmware rechazan exactamente lo mismo.
static bool isAreaTarget(const String& t) {
  String s = t;
  s.trim();
  if (s.length() < 5) return false;
  if (!(s.startsWith("area") || s.startsWith("AREA"))) return false;
  for (unsigned int i = 4; i < s.length(); i++) {
    if (!isdigit(s[i])) return false;
  }
  return true;
}

void registerDeviceHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  time_t tNow = time(nullptr);
  bool clockSynced = (tNow >= 1700000000);
  if (!clockSynced) {
    // Reintentar la sincronización NTP en lugar de bloquear el latido para siempre.
    static bool ntpStarted = false;
    static unsigned long lastNtpRetry = 0;
    if (!ntpStarted) {
      ntpStarted = true;
      configTime(-6 * 3600, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
    } else if (millis() - lastNtpRetry >= 60000) {
      lastNtpRetry = millis();
      configTime(-6 * 3600, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
    }
    Serial.println(F("[HEARTBEAT] Reloj sin sincronizar NTP; se omite lastSeen para no marcar el nodo como caído."));
  }

  String cleanMac = getCleanMac();
  cleanMac.toLowerCase();

  String nowIso = getIsoTimestamp();
  String serverIso = "";
  String ipStr = WiFi.localIP().toString();
  String areaNum = assignedArea;
  areaNum.replace("area", "");
  areaNum.replace("AREA", "");
  areaNum.trim();
  if (areaNum.length() == 0) areaNum = assignedArea;

  WiFiClient client;
  client.setTimeout(4000);
  HTTPClient http;
  http.setTimeout(4000);

  // 1. Buscar si ya existe el registro en crane_devices de PocketBase
  //    Orden descendente por creación: con dos registros de la misma MAC el orden del
  //    servidor no es estable y el PATCH fallaba con "resource wasn't found".
  String queryUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                    "/api/collections/crane_devices/records?filter=(cleanMac='" + cleanMac + "'||mac='" + cleanMac + "')&sort=-created";
  
  String devRecordId = "";
  String remoteAssignedArea = "";
  String remoteAssignedRole = "";
  String dupIds[4];
  int dupCount = 0;

  if (http.begin(client, queryUrl)) {
    http.collectHeaders(kDateHeaderKeys, 1);
    int qCode = http.GET();
    if (qCode == HTTP_CODE_OK) {
      DynamicJsonDocument qDoc(2048);
      DeserializationError err = deserializeJson(qDoc, http.getString());
      if (!err && qDoc.containsKey("items") && qDoc["items"].size() > 0) {
        if (qDoc["items"].size() > 1) {
          Serial.printf("[HEARTBEAT] AVISO: %d registros con la MAC %s. Se usa el más reciente y se limpian los duplicados.\n",
                        (int)qDoc["items"].size(), cleanMac.c_str());
        }
        JsonObject item = qDoc["items"][0].as<JsonObject>();
        devRecordId = item["id"].as<String>();
        if (item.containsKey("assignedArea")) {
          remoteAssignedArea = item["assignedArea"].as<String>();
        }
        if (item.containsKey("assignedRole")) {
          remoteAssignedRole = item["assignedRole"].as<String>();
        }
        // Autocura: los duplicados de la misma MAC (creados por versiones antiguas del
        // firmware) hacen que el panel muestre el nodo duplicado/caído según qué registro
        // consulte, así que se eliminan conservando sólo el más reciente.
        for (unsigned int i = 1; i < qDoc["items"].size() && dupCount < 4; i++) {
          dupIds[dupCount++] = qDoc["items"][i]["id"].as<String>();
        }
      }
    }
    String dateHeader = http.header("Date");
    if (!clockSynced && syncClockFromHttpDate(dateHeader)) {
      clockSynced = true;
      Serial.printf("[HEARTBEAT] Reloj sincronizado por cabecera HTTP Date: %s\n", getIsoTimestamp().c_str());
    }
    if (!clockSynced) serverIso = httpDateToIso(dateHeader);
    http.end();
  }
  if (clockSynced) nowIso = getIsoTimestamp();

  // 1b. Eliminar los registros duplicados de esta MAC.
  for (int i = 0; i < dupCount; i++) {
    String delUrl = String("http://") + scadaServerHost + ":" + String(scadaServerPort) +
                    "/api/collections/crane_devices/records/" + dupIds[i];
    if (http.begin(client, delUrl)) {
      http.addHeader("Authorization", pbAuthHeader());
      int dCode = http.sendRequest("DELETE", "");
      Serial.printf("[HEARTBEAT] Limpieza duplicado %s -> HTTP %d\n", dupIds[i].c_str(), dCode);
      http.end();
    }
  }

  // 2. Preparamos payload JSON para PocketBase
  StaticJsonDocument<512> doc;
  doc["cleanMac"] = cleanMac;
  doc["mac"] = WiFi.macAddress();
  doc["currentArea"] = assignedArea;
  doc["role"] = "cranes";
  // v3.4.2: el heartbeat NO escribe assignedRole/assignedArea: la asignación la define el panel
  // de administración (Topología). El mando sólo reporta telemetría; si escribiera su valor
  // local, la asignación hecha desde la web se sobrescribiría.
  doc["roleLabel"] = "Centro de Mando SCADA (Área " + areaNum + ")";
  doc["firmwareVersion"] = firmwareVersion;
  doc["status"] = "online";
  doc["ip"] = ipStr;
  if (clockSynced) doc["lastSeen"] = nowIso;
  else if (serverIso.length()) doc["lastSeen"] = serverIso;

  String body;
  serializeJson(doc, body);

  int code = 0;
  if (devRecordId.length() > 0) {
    // PATCH al registro existente
    String patchUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                      "/api/collections/crane_devices/records/" + devRecordId;
    if (http.begin(client, patchUrl)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", pbAuthHeader());
      code = http.PATCH(body);
      http.end();
    }
  } else {
    // El firmware NO crea registros de dispositivo. La WEB es la creadora: Panel de
    // Administración > Topología (alta manual del ESP32 o detección por USB). Si la placa
    // no está registrada, el heartbeat avisa y no escribe.
    Serial.printf("[HEARTBEAT] crane_devices/%s no existe. Registralo en el panel de Topologia; no se escribe.\n", cleanMac.c_str());
  }

  Serial.printf("[HEARTBEAT] Telemetria crane_devices/%s (%s) -> HTTP %d\n", cleanMac.c_str(), assignedArea.c_str(), code);

  // 3. Hot-swap si se cambió de área remotamente desde el dashboard admin
  if (remoteAssignedRole.length() > 0 && remoteAssignedRole != "cranes") {
    Serial.printf("[HOT-SWAP] AVISO: rol asignado en Web (%s) no coincide con este dispositivo (cranes / Centro de Mando).\n",
                  remoteAssignedRole.c_str());
  }

  if (remoteAssignedArea.length() > 0 && remoteAssignedArea != assignedArea) {
    if (!isAreaTarget(remoteAssignedArea)) {
      Serial.printf("[HOT-SWAP] Descartado '%s': un Centro de Mando necesita un area (area10/area20/area30), no un ID de grua.\n",
                    remoteAssignedArea.c_str());
      return;
    }
    Serial.printf("[HOT-SWAP] Nueva seccion detectada en PocketBase: %s (actual: %s)\n",
                  remoteAssignedArea.c_str(), assignedArea.c_str());
    assignedArea = remoteAssignedArea;
    prefs.begin("scada_cfg", false);
    prefs.putString("area", assignedArea);
    prefs.remove("n_count");
    prefs.end();
    initNodesForArea(assignedArea);
    flagUiRefresh = true;
    flagNeedCloudResync = true;

    // Confirmar en PocketBase actualizando currentArea
    if (devRecordId.length() > 0) {
      String confUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                       "/api/collections/crane_devices/records/" + devRecordId;
      if (http.begin(client, confUrl)) {
        http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", pbAuthHeader());
        StaticJsonDocument<256> cDoc;
        cDoc["currentArea"] = assignedArea;
        String newAreaNum = assignedArea;
        newAreaNum.replace("area", "");
        newAreaNum.replace("AREA", "");
        newAreaNum.trim();
        if (newAreaNum.length() == 0) newAreaNum = assignedArea;
        cDoc["roleLabel"] = "Centro de Mando SCADA (Área " + newAreaNum + ")";
        if (clockSynced) cDoc["lastSeen"] = nowIso;
        else if (serverIso.length()) cDoc["lastSeen"] = serverIso;
        String cBody;
        serializeJson(cDoc, cBody);
        int confCode = http.PATCH(cBody);
        Serial.printf("[HOT-SWAP] Confirmacion enviada a PocketBase -> HTTP %d\n", confCode);
        http.end();
      }
    }
  }
}

void renderConfigPortalUI(const String& apName) {
  tft.fillScreen(COLOR_BG);
  drawArcSegment(120, 120, 109, 5, 0, 360, COLOR_CYAN);

  drawCenteredText("MODO CONFIGURACION", 36, 1, COLOR_CYAN);
  drawCenteredText("PORTAL CAUTIVO WI-FI", 49, 1, COLOR_MUTED);

  // Hero Card Central (W:156, H:86 centrado en X:42)
  tft.fillRoundRect(42, 66, 156, 86, 10, COLOR_PANEL);
  tft.drawRoundRect(42, 66, 156, 86, 10, COLOR_CYAN);
  tft.drawRoundRect(43, 67, 154, 84, 9, COLOR_CYAN);

  drawCenteredText("CONECTATE AL WI-FI:", 78, 1, COLOR_CARD_TEXT);
  drawCenteredSans(apName, 100, &FreeSans9pt7b, COLOR_WHITE);

  tft.fillRoundRect(52, 122, 136, 22, 5, 0x098F);
  drawCenteredInBox("IP: 192.168.4.1", 52, 122, 136, 22, 1, COLOR_CYAN);

  // Zona Inferior
  drawCenteredText("ABRE EN CELULAR O PC", 174, 1, COLOR_WHITE);
  drawCenteredText("MANTENER: REINICIAR", 188, 1, COLOR_WARN);
}

void handlePortalRoot() {
  String cleanMac = getCleanMac();
  String html = F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Centro de Mando SCADA</title>"
    "<style>"
    "body{background:#07090e;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:20px;}"
    ".box{max-width:400px;margin:0 auto;background:#10141a;padding:24px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.6);border:1px solid #1e293b;}"
    "h2{margin-top:0;color:#38bdf8;font-size:1.3rem;text-align:center;}"
    "p.sub{text-align:center;color:#94a3b8;font-size:0.85rem;margin-bottom:20px;}"
    "label{display:block;margin-top:12px;font-size:0.85rem;color:#cbd5e1;font-weight:600;}"
    "input,select{width:100%;padding:10px;margin-top:5px;border-radius:6px;border:1px solid #334155;background:#0b0f19;color:#fff;font-size:0.95rem;box-sizing:border-box;}"
    "button{width:100%;margin-top:20px;padding:12px;border:none;border-radius:6px;background:#0284c7;color:#fff;font-size:1rem;font-weight:bold;cursor:pointer;}"
    "button:hover{background:#0369a1;}"
    ".badge{background:#1e293b;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:0.75rem;color:#38bdf8;display:inline-block;margin-top:15px;}"
    "</style></head><body><div class='box'>"
    "<h2>&#9881; Centro de Mando SCADA</h2>"
    "<p class='sub'>Configuracion de Red Wi-Fi (Pantalla Circular GC9A01)</p>"
    "<form method='POST' action='/save'>");

  int n = WiFi.scanNetworks();
  if (n > 0) {
    html += F("<label>Redes Wi-Fi Detectadas</label><select onchange=\"document.getElementById('ssid').value=this.value;\">");
    html += F("<option value=''>-- Seleccionar Red Wi-Fi --</option>");
    for (int i = 0; i < n; ++i) {
      html += "<option value='" + WiFi.SSID(i) + "'>" + WiFi.SSID(i) + " (" + String(WiFi.RSSI(i)) + " dBm)</option>";
    }
    html += F("</select>");
  }

  html += F("<label>Nombre de Red (SSID)</label>");
  html += "<input type='text' id='ssid' name='ssid' value='" + (wifiSsid == "TU_WIFI_SSID" ? "" : wifiSsid) + "' placeholder='Nombre de red Wi-Fi' required>";

  html += F("<label>Contrasena Wi-Fi</label>");
  html += "<input type='password' name='pass' value='" + (wifiPass == "TU_WIFI_PASS" ? "" : wifiPass) + "' placeholder='Contrasena Wi-Fi'>";

  html += F("<button type='submit'>&#128190; Guardar y Conectar</button></form>");
  html += "<div style='text-align:center;'><span class='badge'>MAC: " + cleanMac + " | GC9A01 v3.0.0</span></div>";
  html += F("</div></body></html>");

  portalServer.send(200, "text/html", html);
}

void handlePortalSave() {
  String newSsid = portalServer.arg("ssid");
  String newPass = portalServer.arg("pass");

  if (newSsid.length() > 0) {
    prefs.begin("scada_cfg", false);
    prefs.putString("wifi_ssid", newSsid);
    prefs.putString("wifi_pass", newPass);
    prefs.end();

    String html = F("<!DOCTYPE html><html><head><meta charset='utf-8'>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'><style>"
      "body{background:#07090e;color:#fff;font-family:sans-serif;text-align:center;padding:40px;}"
      ".card{background:#10141a;padding:30px;border-radius:12px;max-width:350px;margin:0 auto;border:1px solid #10b981;}"
      "h2{color:#34d399;}"
      "</style></head><body><div class='card'>"
      "<h2>&#9989; Guardado Exitoso</h2>"
      "<p>Conectando a: <b>");
    html += newSsid;
    html += F("</b></p><p style='color:#94a3b8;'>Reiniciando el Centro de Mando en 2 segundos...</p></div></body></html>");

    portalServer.send(200, "text/html", html);
    delay(2000);
    ESP.restart();
  } else {
    portalServer.send(400, "text/plain", "SSID requerido");
  }
}

void startConfigPortal() {
  inConfigPortal = true;
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_AP);

  String cleanMac = getCleanMac();
  String apSuffix = cleanMac.length() >= 4 ? cleanMac.substring(cleanMac.length() - 4) : "SCADA";
  String apName = "ESP32-SCADA-" + apSuffix;

  IPAddress apIP(192, 168, 4, 1);
  IPAddress netMsk(255, 255, 255, 0);
  WiFi.softAPConfig(apIP, apIP, netMsk);
  WiFi.softAP(apName.c_str());

  dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  dnsServer.start(DNS_PORT, "*", apIP);

  portalServer.on("/", HTTP_GET, handlePortalRoot);
  portalServer.on("/save", HTTP_POST, handlePortalSave);
  portalServer.on("/hotspot-detect.html", HTTP_GET, handlePortalRoot);
  portalServer.on("/generate_204", HTTP_GET, handlePortalRoot);
  portalServer.on("/gen_204", HTTP_GET, handlePortalRoot);
  portalServer.on("/ncsi.txt", HTTP_GET, handlePortalRoot);
  portalServer.onNotFound(handlePortalRoot);
  portalServer.begin();

  Serial.println(F("\n======================================================="));
  Serial.print(F("  [PORTAL ACTIVADO] Conectate a la red Wi-Fi: "));
  Serial.println(apName);
  Serial.print(F("  Abre en tu navegador o celular: http://"));
  Serial.println(WiFi.softAPIP());
  Serial.println(F("=======================================================\n"));

  renderConfigPortalUI(apName);

  fill_solid(leds, NUM_LEDS, CRGB(0, 40, 80));
  FastLED.show();
}

// =============================================================================
// TAREA EN SEGUNDO PLANO (CORE 0): WI-FI Y SINCRONIZACIÓN FIRESTORE
// =============================================================================
void backgroundCloudTask(void *pvParameters) {
  WiFi.mode(WIFI_STA);
  initEspNowMaster();

  if (wifiSsid.length() > 0 && wifiSsid != "TU_WIFI_SSID") {
    Serial.printf("[Core 0 NetTask] Iniciando Wi-Fi STA: %s\n", wifiSsid.c_str());
    WiFi.setSleep(false);
    WiFi.setAutoReconnect(true);
    WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  }

  unsigned long lastSync = 0;
  unsigned long lastConfigSync = 0;
  unsigned long lastReconnectAttempt = 0;
  bool wasConnected = false;

  esp_task_wdt_add(NULL);

  for (;;) {
    esp_task_wdt_reset();
    if (inConfigPortal) {
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }

    bool isConnected = (WiFi.status() == WL_CONNECTED);

    if (isConnected && !wasConnected) {
      wasConnected = true;
      Serial.printf("[Core 0 NetTask] Wi-Fi conectado! IP: %s\n", WiFi.localIP().toString().c_str());
      String liveMac = getFormattedMac();
      Serial.println("INFO:MAC=" + liveMac + ",IP=" + WiFi.localIP().toString() + ",ROLE=cranes,TARGET=" + assignedArea + ",SSID=" + wifiSsid + ",ITEMS=" + String(totalNodes) + ",VER=" + firmwareVersion + ",LABEL=Centro de Mando SCADA (" + assignedArea + ")");
      configTime(-6 * 3600, 0, "pool.ntp.org", "time.google.com");
      for (int i = 0; i < 12; i++) {
        vTaskDelay(pdMS_TO_TICKS(250));
        if (time(nullptr) >= 1700000000) break;
      }
      Serial.printf("[Core 0 NetTask] Hora sincronizada: %s\n", getIsoTimestamp().c_str());
      flagUiRefresh = true;
      pbLogin();
      registerDeviceHeartbeat();
      fetchCraneStatuses();
      fetchCloudConfig();
      // Sincronizar por ESP-NOW a todos los nodos satélite de grúa en la bahía
      for (int k = 0; k < totalNodes; k++) {
        broadcastEspNowCraneState(nodes[k].id, nodes[k].status, nodes[k].lastReason);
      }
      lastSync = millis();
      lastConfigSync = millis();
    } else if (!isConnected && wasConnected) {
      wasConnected = false;
      Serial.println(F("[Core 0 NetTask] Wi-Fi desconectado. Modo offline NVS activo."));
      flagUiRefresh = true;
    }

    static int wifiFailCount = 0;
    if (!isConnected && (millis() - lastReconnectAttempt >= 8000)) {
      lastReconnectAttempt = millis();
      wifiFailCount++;
      Serial.printf("[Core 0 NetTask] Reintentando asociacion Wi-Fi STA (%d)...\n", wifiFailCount);
      WiFi.disconnect(false);
      vTaskDelay(pdMS_TO_TICKS(100));
      WiFi.mode(WIFI_STA);
      WiFi.setSleep(false);
      WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
    } else if (isConnected) {
      wifiFailCount = 0;
    }

    if (isConnected && pendingCount > 0) {
      flushPendingReportsCore0();
    }

    unsigned long now = millis();

    // Comprobar si hay incidentes activos en la flota (falla o reparación)
    bool hasActiveIncident = false;
    for (int i = 0; i < totalNodes; i++) {
      if (nodes[i].status == "falla" || nodes[i].status == "reparacion") {
        hasActiveIncident = true;
        break;
      }
    }
    // Resincronización secuencial aislada tras Hot-Swap de área
    if (isConnected && flagNeedCloudResync) {
      flagNeedCloudResync = false;
      Serial.println(F("[Core 0 NetTask] Ejecutando resincronizacion secuencial tras Hot-Swap de area..."));
      vTaskDelay(pdMS_TO_TICKS(150));
      fetchCloudConfig();
      vTaskDelay(pdMS_TO_TICKS(150));
      fetchCraneStatuses();
      flagUiRefresh = true;
    }

    // Polling adaptativo: 20s con paro activo (alta reactividad); 35s en operación normal (ahorro cuota Spark)
    unsigned long syncInterval = 5000;  // Ronda 4: polling a PocketBase cada 5 s (web -> anillo en <5 s)

    // Sincronización periódica adaptativa de estado de grúas
    if (isConnected && (now - lastSync >= syncInterval)) {
      lastSync = now;
      fetchCraneStatuses();
    }

    // Latido (heartbeat) periódico a crane_devices cada 45 segundos
    static unsigned long lastHeartbeat = 0;
    if (isConnected && (now - lastHeartbeat >= 45000 || lastHeartbeat == 0)) {
      lastHeartbeat = now;
      registerDeviceHeartbeat();
    }

    // Resync por ESP-NOW cada 60s: garantiza que un satélite que se conectó tarde,
    // perdió un paquete o cambió de canal reciba el estado real de su grúa.
    static unsigned long lastEspNowResync = 0;
    if (espNowMasterActive && (now - lastEspNowResync >= 15000 || lastEspNowResync == 0)) {  // Ronda 3: resync cada 15 s
      lastEspNowResync = now;
      for (int k = 0; k < totalNodes; k++) {
        broadcastEspNowCraneState(nodes[k].id, nodes[k].status, nodes[k].lastReason, MSG_STATUS_BROADCAST);
      }
    }

    // Sincronización periódica de catálogo de motivos y flota de grúas cada 5 minutos (300 segundos)
    if (isConnected && (now - lastConfigSync >= 300000)) {
      lastConfigSync = now;
      fetchCloudConfig();
    }

    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

// =============================================================================
// SETUP (Core 1: Pantalla, LEDs, Botón - Inicio Instantáneo < 200ms)
// =============================================================================
void setup() {
  Serial.begin(115200);

  // Inicializar Task Watchdog Timer (30s) para autorecuperación automática SCADA
  esp_task_wdt_config_t twdt_config = {
      .timeout_ms = 30000,
      .idle_core_mask = 0,
      .trigger_panic = true
  };
  if (esp_task_wdt_init(&twdt_config) != ESP_OK) {
    esp_task_wdt_reconfigure(&twdt_config);
  }
  esp_task_wdt_add(NULL);

  pinMode(BTN_PIN, INPUT_PULLUP);
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);

  // Iniciar Tira LED WS2815
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
  fill_solid(leds, NUM_LEDS, CRGB::Blue);
  FastLED.show();

  // Iniciar Pantalla Circular GC9A01 con Hardware SPI de alta velocidad (40 MHz)
  tft.begin(40000000);
  tft.setRotation(0);
  tft.fillScreen(COLOR_BG);

  // Cargar configuración y últimos estados reales de memoria flash NVS
  loadCatalogFromNvs();

  // Informar identidad industrial a Web Serial de admin.html
  String initMac = getFormattedMac();
  Serial.println("INFO:MAC=" + initMac + ",IP=0.0.0.0,ROLE=cranes,TARGET=" + assignedArea + ",SSID=" + wifiSsid + ",ITEMS=" + String(totalNodes) + ",VER=" + firmwareVersion + ",LABEL=Centro de Mando SCADA (" + assignedArea + ")");

  // Splash Screen ultra-rápido (150ms)
  drawCenteredText("SCADA MASTER", 80, 2, COLOR_CYAN);
  drawCenteredText("CENTRO DE MANDO", 112, 1, COLOR_WHITE);
  drawCenteredText("INICIANDO HARDWARE...", 140, 1, COLOR_MUTED);
  delay(150);

  // Iniciar interfaz SCADA INMEDIATAMENTE con el estado real guardado en NVS
  renderCurrentUI();
  updatePhysicalLeds(0.0);

  // Lanzar tarea de red no bloqueante en Core 0 con stack suficiente para TLS (20 KB)
  xTaskCreatePinnedToCore(
    backgroundCloudTask,
    "CloudTask",
    20480,
    NULL,
    1,
    NULL,
    0 // Core 0
  );
}

void handleShortClick() {
  switch (currentState) {
    case STATE_SUPERVISOR:
      currentState = STATE_SELECT_MACHINE;
      selectedMachineIndex = 0;
      Serial.println(F("[BOTON] Clic corto -> Entrando a SELECCION DE GRUA (30A) en AMBAR"));
      renderCurrentUI();
      updatePhysicalLeds(0.0);
      break;

    case STATE_SELECT_MACHINE:
      selectedMachineIndex++;
      if (selectedMachineIndex >= totalNodes) {
        currentState = STATE_SUPERVISOR;
        selectedMachineIndex = 0;
        Serial.println(F("[BOTON] Fin de ciclo -> Cancelacion. Regreso a SUPERVISOR."));
      } else {
        Serial.printf("[BOTON] Clic corto -> Grua seleccionada: %s (%s)\n", nodes[selectedMachineIndex].name.c_str(), nodes[selectedMachineIndex].status.c_str());
      }
      renderCurrentUI();
      updatePhysicalLeds(0.0);
      break;

    case STATE_SELECT_REASON:
      selectedReasonIndex++;
      if (selectedReasonIndex > totalReasons) {
        selectedReasonIndex = 0;
        Serial.println(F("[BOTON] Bucle continuo -> Regreso al primer motivo"));
      } else if (selectedReasonIndex == totalReasons) {
        Serial.println(F("[BOTON] Clic corto -> Opcion [SALIR / CANCELAR]"));
      } else {
        Serial.printf("[BOTON] Clic corto -> Motivo %d: %s\n", selectedReasonIndex + 1, failureReasons[selectedReasonIndex].c_str());
      }
      renderCurrentUI();
      updatePhysicalLeds(0.0);
      break;

    case STATE_CONFIRM_RESOLVE:
      currentState = STATE_SUPERVISOR;
      Serial.println(F("[BOTON] Clic corto -> Resolucion cancelada. Regreso a SUPERVISOR."));
      renderCurrentUI();
      updatePhysicalLeds(0.0);
      break;

    case STATE_FEEDBACK_FLASH:
      break;
  }
}

void executeConfirmAction(unsigned long now) {
  if (currentState == STATE_SELECT_MACHINE) {
    NodeItem& current = nodes[selectedMachineIndex];
    if (current.status == "falla") {
      // Mantenido sobre grúa en falla -> RESOLVER A OPERATIVA
      current.status = "operativa";
      current.faultStartTime = 0;
      current.lastReason = "";
      saveStatusesToNvs();
      feedbackTitle = "✓ FALLA RESUELTA";
      feedbackSub = current.name;
      feedbackDetail = "OPERATIVA (PUESTA EN MARCHA)";
      feedbackStartTime = millis();
      currentState = STATE_FEEDBACK_FLASH;
      Serial.printf("[BOTON 4s] Falla resuelta en %s -> OPERATIVA\n", current.name.c_str());
      renderCurrentUI();
      updatePhysicalLeds(0.0);
      queueReport(current.id, "operativa", "Resuelta en Centro de Mando");
    } else {
      // Mantenido sobre grúa operativa -> PASAR A SELECCIÓN DE MOTIVO
      currentState = STATE_SELECT_REASON;
      selectedReasonIndex = 0;
      lastButtonActivityTime = millis();
      Serial.printf("[BOTON 4s] Grúa %s confirmada para reporte -> Seleccionando motivo\n", current.name.c_str());
      renderCurrentUI();
      updatePhysicalLeds(0.0);
    }
  } else if (currentState == STATE_SELECT_REASON) {
    if (selectedReasonIndex >= totalReasons) {
      // Opción de Salir confirmada
      currentState = STATE_SUPERVISOR;
      lastButtonActivityTime = millis();
      Serial.println(F("[BOTON 4s] Cancelar confirmado tras 4s. Regreso a SUPERVISOR."));
      renderCurrentUI();
      updatePhysicalLeds(0.0);
    } else {
      NodeItem& current = nodes[selectedMachineIndex];
      String reason = failureReasons[selectedReasonIndex];
      current.status = "falla";
      current.lastReason = reason;
      current.faultStartTime = millis();
      saveStatusesToNvs();
      feedbackTitle = "! PARO REPORTADO";
      feedbackSub = current.name;
      feedbackDetail = reason;
      feedbackStartTime = millis();
      currentState = STATE_FEEDBACK_FLASH;
      Serial.printf("[BOTON 4s] Alerta enviada para %s: %s\n", current.name.c_str(), reason.c_str());
      renderCurrentUI();
      updatePhysicalLeds(0.0);
      queueReport(current.id, "falla", reason);
      // Se anade el broadcast inmediato: sin esto el nodo espera a su proximo ping.
      broadcastEspNowCraneState(current.id, current.status, current.lastReason, MSG_STATUS_BROADCAST);
    }
  } else if (currentState == STATE_CONFIRM_RESOLVE) {
    NodeItem& current = nodes[selectedMachineIndex];
    current.status = "operativa";
    current.faultStartTime = 0;
    current.lastReason = "";
    saveStatusesToNvs();
    feedbackTitle = "✓ FALLA RESUELTA";
    feedbackSub = current.name;
    feedbackDetail = "OPERATIVA";
    feedbackStartTime = millis();
    currentState = STATE_FEEDBACK_FLASH;
    Serial.printf("[BOTON 4s] Confirmacion resolucion: %s -> OPERATIVA\n", current.name.c_str());
    renderCurrentUI();
    updatePhysicalLeds(0.0);
    queueReport(current.id, "operativa", "Resuelta en Centro de Mando");
  }
}

// =============================================================================
// PROCESAMIENTO DE COMANDOS POR PUERTO SERIE (Web Serial y Administracion)
// =============================================================================
void processSerialCommand(String line) {
  line.trim();
  if (line.length() == 0) return;

  if (line.startsWith("SET_CONFIG:")) {
    // Formato enviado por admin.js: SET_CONFIG:role:target:ssid:pass
    int p1 = line.indexOf(':', 11);
    int p2 = (p1 != -1) ? line.indexOf(':', p1 + 1) : -1;
    int p3 = (p2 != -1) ? line.indexOf(':', p2 + 1) : -1;

    String role   = (p1 != -1) ? line.substring(11, p1) : "";
    String target = (p1 != -1 && p2 != -1) ? line.substring(p1 + 1, p2) : "";
    String ssid   = (p2 != -1 && p3 != -1) ? line.substring(p2 + 1, p3) : ((p2 != -1) ? line.substring(p2 + 1) : "");
    String pass   = (p3 != -1) ? line.substring(p3 + 1) : "";

    target.trim();
    ssid.trim();
    pass.trim();

    // El rol es físico (este sketch es Centro de Mando). El panel sólo puede reasignar el área.
    if (role.length() > 0 && role != "cranes") {
      Serial.printf("[SERIAL] AVISO: rol '%s' no aplicable: este tablero es Centro de Mando (cranes).\n", role.c_str());
    }
    if (target.length() > 0 && target != "KEEP" && !isAreaTarget(target)) {
      Serial.println(F("ERROR:SET_CONFIG_TARGET_INVALID (un Centro de Mando necesita un area, ej. area20)"));
      return;
    }

    prefs.begin("scada_cfg", false);
    if (ssid.length() > 0 && ssid != "KEEP" && ssid != "null") {
      prefs.putString("wifi_ssid", ssid);
      prefs.putString("wifi_pass", pass);
      wifiSsid = ssid;
      wifiPass = pass;
    }
    if (target.length() > 0 && target != "KEEP") {
      prefs.putString("area", target);
      assignedArea = target;
      prefs.remove("n_count");
      initNodesForArea(target);
    }
    prefs.end();

    Serial.println(F("OK:CONFIG_SAVED"));
    Serial.printf("[NVS] Configuracion guardada: Area=%s, SSID=%s. Reiniciando...\n", assignedArea.c_str(), wifiSsid.c_str());
    delay(400);
    ESP.restart();
  } else if (line.startsWith("SET_CRANES:")) {
    String list = line.substring(11);
    list.trim();
    int idx = 0;
    int start = 0;
    while (start < list.length() && idx < MAX_NODES) {
      int comma = list.indexOf(',', start);
      String cId = (comma == -1) ? list.substring(start) : list.substring(start, comma);
      cId.trim();
      if (cId.length() > 0) {
        nodes[idx] = { cId, "GRUA " + cId, "operativa", "", 0 };
        idx++;
      }
      if (comma == -1) break;
      start = comma + 1;
    }
    if (idx > 0) {
      totalNodes = idx;
      saveStatusesToNvs();
    }
    Serial.println(F("OK:CRANES_SET"));
    flagUiRefresh = true;
  } else if (line.startsWith("TEST_LEDS:")) {
    int p1 = line.indexOf(':', 10);
    int p2 = (p1 != -1) ? line.indexOf(':', p1 + 1) : -1;
    if (p1 != -1 && p2 != -1) {
      int r = line.substring(10, p1).toInt();
      int g = line.substring(p1 + 1, p2).toInt();
      int b = line.substring(p2 + 1).toInt();
      fill_solid(leds, NUM_LEDS, CRGB(r, g, b));
      FastLED.show();
      Serial.println(F("OK:TEST_LEDS"));
    }
  } else if (line == "RESET_SIM") {
    updatePhysicalLeds(0.0);
    Serial.println(F("OK:RESET_SIM"));
  } else if (line.equalsIgnoreCase("BTN_CLICK") || line.equalsIgnoreCase("PRESS_BUTTON")) {
    Serial.println(F("[HIL SIM MASTER] Simulando pulsacion corta de boton..."));
    handleShortClick();
    Serial.println(F("OK:BTN_CLICK_PROCESSED"));
  } else if (line.equalsIgnoreCase("BTN_HOLD") || line.equalsIgnoreCase("HOLD_BUTTON")) {
    Serial.println(F("[HIL SIM MASTER] Simulando retencion de 4s (CONFIRMAR ACCION)..."));
    executeConfirmAction(millis());
    Serial.println(F("OK:BTN_HOLD_PROCESSED"));
  } else if (line.startsWith("TRIGGER_FALLA:")) {
    // Formato: TRIGGER_FALLA:craneId:reason
    int p1 = line.indexOf(':', 14);
    String cId = (p1 != -1) ? line.substring(14, p1) : line.substring(14);
    String rsn = (p1 != -1) ? line.substring(p1 + 1) : "Paro de emergencia SCADA";
    cId.trim();
    rsn.trim();
    bool found = false;
    for (int i = 0; i < totalNodes; i++) {
      if (nodes[i].id.equalsIgnoreCase(cId)) {
        nodes[i].status = "falla";
        nodes[i].lastReason = rsn;
        nodes[i].faultStartTime = millis();
        found = true;
        break;
      }
    }
    saveStatusesToNvs();
    flagUiRefresh = true;
    queueReport(cId, "falla", rsn);
    Serial.printf("[HIL MASTER] TRIGGER_FALLA en %s (%s) ejecutado y transmitido por ESP-NOW\n", cId.c_str(), rsn.c_str());
    Serial.println(F("OK:TRIGGER_FALLA_PROCESSED"));
  } else if (line.startsWith("TRIGGER_RESOLVE:")) {
    // Formato: TRIGGER_RESOLVE:craneId
    String cId = line.substring(16);
    cId.trim();
    for (int i = 0; i < totalNodes; i++) {
      if (nodes[i].id.equalsIgnoreCase(cId)) {
        nodes[i].status = "operativa";
        nodes[i].lastReason = "";
        nodes[i].faultStartTime = 0;
        break;
      }
    }
    saveStatusesToNvs();
    flagUiRefresh = true;
    queueReport(cId, "operativa", "Resuelta en Centro de Mando");
    Serial.printf("[HIL MASTER] TRIGGER_RESOLVE en %s ejecutado y transmitido por ESP-NOW\n", cId.c_str());
    Serial.println(F("OK:TRIGGER_RESOLVE_PROCESSED"));
  } else if (line.startsWith("SET_SERVER:")) {
    String srv = line.substring(11);
    srv.trim();
    if (srv.length() > 0) {
      scadaServerHost = srv;
      prefs.begin("scada_cfg", false);
      prefs.putString("pb_host", scadaServerHost);
      prefs.end();
      Serial.printf("OK:SERVER_SET=%s\n", scadaServerHost.c_str());
    }
  } else if (line.equalsIgnoreCase("GET_INFO") || line.equalsIgnoreCase("INFO")) {
    String mac = getFormattedMac();
    String ip = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "OFFLINE";
    Serial.println("INFO:MAC=" + mac + ",IP=" + ip + ",ROLE=cranes,TARGET=" + assignedArea + ",SSID=" + wifiSsid + ",ITEMS=" + String(totalNodes) + ",VER=" + firmwareVersion + ",LABEL=Centro de Mando SCADA (" + assignedArea + ")");
  } else if (line == "REBOOT") {
    Serial.println(F("OK:REBOOTING"));
    delay(300);
    ESP.restart();
  } else if (line == "s" || line == "?") {
    int fc = 0;
    for (int i = 0; i < totalNodes; i++) {
      if (nodes[i].status == "falla") fc++;
    }
    Serial.println(F("\n--- ESTADO ACTUAL DE GRUAS ---"));
    for (int i = 0; i < totalNodes; i++) {
      Serial.printf("  %s (%s): [%s] Motivo: '%s'\n", nodes[i].name.c_str(), nodes[i].id.c_str(), nodes[i].status.c_str(), nodes[i].lastReason.c_str());
    }
    int disp = (int)(((float)(totalNodes - fc) / (float)totalNodes) * 100.0);
    Serial.printf("Salud: %d OK | %d PARO -> %d%% DISP | IP: %s | State: %d | Pin13: %d\n",
                  totalNodes - fc, fc, disp, WiFi.localIP().toString().c_str(), currentState, digitalRead(BTN_PIN));
    Serial.println(F("------------------------------\n"));
  }
}

// =============================================================================
// LOOP PRINCIPAL (Core 1: 100% No Bloqueante, Dedicado a UI y Botón)
// =============================================================================
void loop() {
  esp_task_wdt_reset();
  unsigned long now = millis();

  // El JWT de PocketBase expira (los tokens de auth duran ~5 días). Cuando el token
  // guardado en NVS está vencido, PocketBase responde 400 "Failed to create record."
  // a todo lo que exige autenticación; por eso el nodo seguía escribiendo en
  // crane_status/notifications (reglas de creación públicas) pero no en crane_history.
  // Se valida una vez por minuto y se renueva el token.
  static unsigned long lastTokenCheck = 0;
  if (WiFi.status() == WL_CONNECTED && (now - lastTokenCheck >= 60000 || lastTokenCheck == 0)) {
    lastTokenCheck = now;
    if (!pbTokenValid()) pbLogin();
  }

  // 0. Auto-apertura de Portal Cautivo si la red es inaccesible
  if (flagTriggerPortal && !inConfigPortal) {
    flagTriggerPortal = false;
    startConfigPortal();
  }

  // 0. Manejo del Portal Cautivo si está activo
  if (inConfigPortal) {
    dnsServer.processNextRequest();
    portalServer.handleClient();

    // Botón en portal: Clic para salir, o sostenido 5s para reiniciar
    static unsigned long portalBtnStart = 0;
    if (digitalRead(BTN_PIN) == LOW) {
      if (portalBtnStart == 0) portalBtnStart = millis();
      else if (millis() - portalBtnStart >= 5000) {
        Serial.println(F("[PORTAL] Boton presionado 5s. Reiniciando ESP32..."));
        ESP.restart();
      }
    } else {
      if (portalBtnStart > 0 && millis() - portalBtnStart >= 50 && millis() - portalBtnStart < 3000) {
        Serial.println(F("[PORTAL] Clic detectado. Saliendo del portal..."));
        inConfigPortal = false;
        WiFi.softAPdisconnect(true);
        renderCurrentUI();
        return;
      }
      portalBtnStart = 0;
    }
    delay(5);
    return;
  }

  // Refrescar UI si Core 0 sincronizó nuevos estados desde la nube
  if (flagUiRefresh) {
    flagUiRefresh = false;
    if (currentState == STATE_SUPERVISOR && digitalRead(BTN_PIN) == HIGH) {
      renderCurrentUI();
      updatePhysicalLeds(0.0);
    }
  }

  // =========================================================================
  // 1. LECTURA Y DETECCIÓN DEL BOTÓN METÁLICO (DEBOUNCE 25ms ROBUSTO)
  // =========================================================================
  static bool lastStableBtn = HIGH;
  static bool lastFlickerBtn = HIGH;
  static unsigned long lastFlickerTime = 0;
  static unsigned long btnDownTime = 0;
  static unsigned long lastClickTime = 0;
  static bool holdFired = false;
  static bool portalForcedTriggered = false;
  static bool pressHandledOnDown = false;

  bool rawBtn = digitalRead(BTN_PIN);
  if (rawBtn != lastFlickerBtn) {
    lastFlickerTime = now;
    lastFlickerBtn = rawBtn;
  }

  bool btnJustPressed = false;
  bool btnJustReleased = false;

  if ((now - lastFlickerTime) >= 25) {
    if (rawBtn != lastStableBtn) {
      lastStableBtn = rawBtn;
      if (lastStableBtn == LOW) {
        btnJustPressed = true;
      } else {
        btnJustReleased = true;
      }
    }
  }

  // --- EVENTO: BOTÓN PRESIONADO HACIA ABAJO (FLANCO DE BAJADA) ---
  if (btnJustPressed) {
    btnDownTime = now;
    holdFired = false;
    portalForcedTriggered = false;
    pressHandledOnDown = false;
    lastButtonActivityTime = now;

    if (currentState == STATE_SUPERVISOR) {
      // En modo Supervisor, el primer toque entra DIRECTO e INSTANTÁNEO a la Selección de Grúas (30A)
      handleShortClick();
      pressHandledOnDown = true; // No volver a rotar en la suelta de este toque inicial
      lastClickTime = now + 150; // Bloquea rebotes mecánicos inmediatos
    }
  }

  // --- BOTÓN MANTENIDO PRESIONADO (LOW) ---
  if (lastStableBtn == LOW) {
    unsigned long holdDuration = now - btnDownTime;

    // A) 20s: Forzar apertura de Portal Cautivo
    if (!portalForcedTriggered && holdDuration >= 20000) {
      portalForcedTriggered = true;
      Serial.println(F("[PORTAL] Activacion forzada por boton sostenido 20s..."));
      startConfigPortal();
      return;
    }

    // B) 1.5s: Confirmación de acción rápida y ergonómica (Reportar o Resolver) en menús interactivos
    if (!holdFired && holdDuration >= 1500) {
      if (currentState == STATE_SELECT_MACHINE || currentState == STATE_SELECT_REASON || currentState == STATE_CONFIRM_RESOLVE) {
        holdFired = true;
        lastButtonActivityTime = now;
        lastClickTime = now + 250; // Bloquea clics accidentales al soltar tras retención
        Serial.println(F("[BOTON 1.5s] Retención confirmada. Ejecutando acción..."));
        executeConfirmAction(now);
      }
    }

    // C) Mientras se mantiene (< 1.5s), renderizar barra de progreso y LEDs
    if (!holdFired && holdDuration >= 60 && (currentState == STATE_SELECT_MACHINE || currentState == STATE_SELECT_REASON || currentState == STATE_CONFIRM_RESOLVE)) {
      float prog = (float)holdDuration / 1500.0;
      if (prog > 1.0) prog = 1.0;
      renderHoldProgress(prog);
      updatePhysicalLeds(prog);
    }
  } else {
    // Si no está presionado, actualizar LEDs de respiración cada 40ms
    static unsigned long lastLedTick = 0;
    if (now - lastLedTick >= 40) {
      lastLedTick = now;
      updatePhysicalLeds(0.0);
    }
  }

  // --- EVENTO: BOTÓN SOLTADO HACIA ARRIBA (FLANCO DE SUBIDA) ---
  if (btnJustReleased) {
    updatePhysicalLeds(0.0);
    if (pressHandledOnDown) {
      pressHandledOnDown = false;
    } else if (holdFired || portalForcedTriggered) {
      holdFired = false;
      portalForcedTriggered = false;
    } else {
      unsigned long pressDuration = now - btnDownTime;
      if (pressDuration >= 20 && pressDuration < 1450) {
        if (now - lastClickTime >= 200) {
          lastClickTime = now;
          lastButtonActivityTime = now;
          handleShortClick();
        }
      }
    }
  }

  // =========================================================================
  // 2. TEMPORIZADOR DE INACTIVIDAD (15s RETORNO SEGURO A SUPERVISOR)
  // =========================================================================
  if (currentState == STATE_SELECT_MACHINE || currentState == STATE_SELECT_REASON || currentState == STATE_CONFIRM_RESOLVE) {
    if (lastStableBtn == HIGH && (now - lastButtonActivityTime >= 15000)) {
      Serial.println(F("[INACTIVIDAD] 15 segundos sin toque. Regresando a SUPERVISOR de forma segura."));
      currentState = STATE_SUPERVISOR;
      selectedMachineIndex = 0;
      selectedReasonIndex = 0;
      renderCurrentUI();
      updatePhysicalLeds(0.0);
    }
  } else if (currentState == STATE_FEEDBACK_FLASH) {
    if (now - feedbackStartTime >= 1500) {
      currentState = STATE_SUPERVISOR;
      renderCurrentUI();
      updatePhysicalLeds(0.0);
    }
  }

  // =========================================================================
  // 3. COMANDOS POR PUERTO SERIE (Web Serial y Diagnostico)
  // =========================================================================
  static String serialBuffer = "";
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBuffer.length() > 0) {
        processSerialCommand(serialBuffer);
        serialBuffer = "";
      }
    } else {
      if (serialBuffer.length() < 256) {
        serialBuffer += c;
      }
    }
  }
}

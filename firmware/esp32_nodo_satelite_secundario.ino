/*
 * =============================================================================
 * SISTEMA INDUSTRIAL SCADA — NODO SATÉLITE SECUNDARIO (1 GRÚA POR NODO)
 * =============================================================================
 * Arquitectura:
 *   - 1 Grúa específica asignada por nodo (ej. 30A, 30B, 30C, 30D, 10A, 20A, etc.)
 *   - Compatible con ESP32 Clásico DevKit (30 Pines) y ESP32-C3 SuperMini RISC-V
 *   - Tira LED WS2815 / WS2812B: Barra de tiempo Andon / Estrobo de escalamiento (>5 min)
 *   - Botón físico único:
 *       • En OPERATIVA: Pulsar para REPORTAR FALLA (dispara WhatsApp a técnicos)
 *       • En FALLA: Mantener 4s con barra de progreso para RESOLVER (pasa a verde)
 *       • Mantener 20s: Abre Portal Cautivo Wi-Fi para reasignar grúa o red
 *   - Pantalla OLED I2C (Opcional, autodetección 0.42" 72x40 o 0.96" 128x64)
 *   - Sincronización REST en tiempo real con Firestore y Bot de WhatsApp (Chihuahua UTC-6)
 * =============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_SSD1306_72x40.h>
#include <FastLED.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include <lwip/sockets.h>
#include <esp_task_wdt.h>
#include <esp_now.h>
#include <esp_wifi.h>

// =============================================================================
// PROTOCOLO INDUSTRIAL ESP-NOW SCADA (HUB & SPOKE: MASTER <-> SATÉLITES)
// =============================================================================
#define SCADA_MAGIC "SCAD"

// =============================================================================
// MODO ESP-NOW EXCLUSIVO (arquitectura Hub & Spoke)
// =============================================================================
// El Centro de Mando es el unico dispositivo que habla con la Web/PocketBase y con el
// bot de WhatsApp. El nodo satelite C3 es un simple actuador de campo:
//   - recibe el estado de SU grúa por ESP-NOW (MSG_STATUS_BROADCAST)
//   - envia el pulsador por ESP-NOW (MSG_BUTTON_REPORT / MSG_BUTTON_RESOLVE)
//   - y mantiene el heartbeat de presencia para el panel de administracion.
// Con ESPNOW_ONLY_MODE = 1 el satelite NO consulta ni escribe la nube para el estado:
// el historial (crane_history), el ticket (cranes), crane_status y las notificaciones
// los genera el Centro de Mando. Si el envio ESP-NOW falla (mando central apagado),
// se usa el fallback directo a PocketBase para no perder el evento.
#define ESPNOW_ONLY_MODE 1

// Canal de radio fijo. ESP-NOW comunica solo entre dispositivos que estan en el mismo
// canal WiFi; cada board elige el canal del AP al asociarse, y un C3 sin credenciales
// queda en el canal 1. Fijar el canal en ambos sketchs es lo que garantiza el enlace.
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

// =============================================================================
// DEFINICIÓN DE PINES SEGÚN ARQUITECTURA DEL CHIP
// =============================================================================
#if defined(CONFIG_IDF_TARGET_ESP32C3) || defined(ARDUINO_ESP32C3_DEV)
  // ESP32-C3 SuperMini
  #define BTN_PIN       4   // Pulsador arcade / metálico a GND (INPUT_PULLUP)
  #define BTN_ALT_PIN   9   // Botón BOOT onboard como pulsador secundario
  #define LED_PIN       2   // Salida datos WS2815 (conector JST-SM)
  #define I2C_SDA       5   // Bus I2C para OLED
  #define I2C_SCL       6
#else
  // ESP32 Clásico DevKit V1 (30 Pines)
  #define BTN_PIN       13  // Pulsador a GND (INPUT_PULLUP)
  #define BTN_ALT_PIN   4   // Alternativo D4
  #define LED_PIN       22  // Salida datos WS2815
  #define I2C_SDA       21  // Bus I2C estándar
  #define I2C_SCL       22  // Nota: si LED_PIN usa 22, I2C usa pines alternativos o desactiva OLED
#endif

#define NUM_LEDS        16  // Cantidad de LEDs locales de máquina

#if defined(CONFIG_IDF_TARGET_ESP32C3) || defined(ARDUINO_ESP32C3_DEV)
  #define SCREEN_W        72
  #define SCREEN_H        40
  Adafruit_SSD1306_72x40 display(I2C_SDA, I2C_SCL);
#else
  #define SCREEN_W        128
  #define SCREEN_H        64
  #define OLED_RESET      -1
  Adafruit_SSD1306 display(SCREEN_W, SCREEN_H, &Wire, OLED_RESET);
#endif

bool oledAvailable = false;
CRGB leds[NUM_LEDS];
Preferences prefs;

// =============================================================================
// IDENTIDAD Y PARÁMETROS NVS (1 GRÚA POR NODO)
// =============================================================================
String assignedCrane = "20C";       // Grúa asignada por defecto (ej. 20C)
String assignedArea  = "20";        // Área por defecto (10, 20, 30)
String wifiSsid      = "Totalplay-6DAB";
String wifiPass      = "cgonz181";
String scadaServerHost = "192.168.100.34";
const int scadaServerPort = 8090;
const char* firmwareVersion = "3.4.2-SATELLITE-ESPNOW";

// --- IDENTIDAD DE DISPOSITIVO (obligatoria desde las API rules de PocketBase) ---
// El nodo autentica contra PocketBase y envía el JWT en cada request.
// Crear la identidad con: python3 scripts/seed_admin_user.py --user nodo_<mac>@scada.local --role device --status active --password <token>
const char* pbDeviceEmail = "nodo_satelite@scada.local";
const char* pbDevicePassword = "<REPLACE_WITH_ESP32_TOKEN>";   // <-- poner el token del nodo
String scadaToken = "";

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
    prefs.begin("scada_sat", false);
    prefs.putString("pb_token", scadaToken);
    prefs.end();
    Serial.printf("[AUTH] Token PocketBase OK para %s\n", pbDeviceEmail);
    return true;
  }
  prefs.begin("scada_sat", true);
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



// Estados operativos
String currentStatus   = "operativa"; // "operativa", "falla", "reparacion"
String currentReason   = "";
unsigned long failureStartTime = 0;   // Timestamp millis cuando comenzó la falla
String reportedIsoAtFailure = "";   // ISO del reporte (fallback del historial)
volatile bool flagStatusChanged = false;
volatile unsigned long lastMasterRx = 0;   // ultimo broadcast recibido del mando
uint8_t oledRotation   = 0;           // 0 = Normal, 2 = Rotación 180° Invertida

// Parpadeos y cadencia
unsigned long lastBlinkTime = 0;
bool blinkState = false;

void updateLeds(float holdProgress = 0.0);
void renderOled(float holdProgress = 0.0);

// =============================================================================
// PORTAL CAUTIVO WI-FI Y REASIGNACIÓN DE GRÚA
// =============================================================================
bool inConfigPortal = false;
WebServer portalServer(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;

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

void renderPortalUI(const String& apName) {
  String html = F("<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1.0'>"
    "<title>SCADA Nodo Satélite</title>"
    "<style>"
    "*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;}"
    "body{background:#0a0e17;color:#f8fafc;padding:20px;display:flex;justify-content:center;align-items:center;min-height:100vh;}"
    ".card{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:24px;width:100%;max-width:400px;box-shadow:0 10px 25px rgba(0,0,0,0.5);}"
    ".header{text-align:center;margin-bottom:20px;}"
    ".badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:1px;background:#059669;color:#fff;margin-bottom:8px;}"
    "h2{font-size:20px;font-weight:700;color:#f8fafc;margin-bottom:4px;}"
    "p{font-size:13px;color:#94a3b8;line-height:1.4;}"
    ".field{margin-bottom:16px;text-align:left;}"
    "label{display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;}"
    "input,select{width:100%;padding:12px;border:1px solid #374151;border-radius:8px;background:#1f2937;color:#fff;font-size:14px;outline:none;transition:border-color 0.2s;}"
    "input:focus,select:focus{border-color:#38bdf8;}"
    "button{width:100%;padding:14px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px;box-shadow:0 4px 12px rgba(37,99,235,0.4);}"
    ".footer{text-align:center;margin-top:20px;font-size:11px;color:#64748b;}"
    "</style></head><body><div class='card'>"
    "<div class='header'>"
    "<span class='badge'>SCADA SATELLITE NODE</span>"
    "<h2>Nodo Sat&eacute;lite</h2>"
    "<p>1 Gr&uacute;a asignada por dispositivo f&iacute;sico</p>"
    "</div>"
    "<form method='POST' action='/save'>"
    "<div class='field'>"
    "<label>Gr&uacute;a Asignada (1 por Nodo):</label>"
    "<select name='crane'>"
    "<optgroup label='Secci&oacute;n 30'>"
    "<option value='30A'>Gr&uacute;a 30A</option>"
    "<option value='30B'>Gr&uacute;a 30B</option>"
    "<option value='30C'>Gr&uacute;a 30C</option>"
    "<option value='30D'>Gr&uacute;a 30D</option>"
    "</optgroup>"
    "<optgroup label='Secci&oacute;n 10'>"
    "<option value='10A'>Gr&uacute;a 10A</option>"
    "<option value='10B'>Gr&uacute;a 10B</option>"
    "<option value='10C'>Gr&uacute;a 10C</option>"
    "<option value='10D'>Gr&uacute;a 10D</option>"
    "</optgroup>"
    "<optgroup label='Secci&oacute;n 20'>"
    "<option value='20A'>Gr&uacute;a 20A</option>"
    "<option value='20B'>Gr&uacute;a 20B</option>"
    "<option value='20C'>Gr&uacute;a 20C</option>"
    "<option value='20D'>Gr&uacute;a 20D</option>"
    "</optgroup>"
    "</select>"
    "</div>"
    "<div class='field'>"
    "<label>Red Wi-Fi (SSID):</label>"
    "<input type='text' name='ssid' placeholder='Nombre de la red' required value=''>"
    "</div>"
    "<div class='field'>"
    "<label>Contrase&ntilde;a Wi-Fi:</label>"
    "<input type='password' name='pass' placeholder='Contrase&ntilde;a'>"
    "</div>"
    "<button type='submit'>Guardar y Conectar</button>"
    "</form>"
    "<div class='footer'>MAC: ");
  html += getFormattedMac() + F(" &bull; FW: ");
  html += firmwareVersion;
  html += F("</div></div></body></html>");

  portalServer.send(200, "text/html", html);
}

void startConfigPortal() {
  inConfigPortal = true;
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP);

  String apName = "SCADA-Nodo-" + assignedCrane + "-" + getCleanMac().substring(8);
  WiFi.softAP(apName.c_str(), "scada1234");
  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

  dnsServer.start(DNS_PORT, "*", apIP);

  portalServer.on("/", [apName]() { renderPortalUI(apName); });
  portalServer.on("/save", []() {
    String newCrane = portalServer.arg("crane");
    String newSsid  = portalServer.arg("ssid");
    String newPass  = portalServer.arg("pass");

    prefs.begin("scada_sat", false);
    if (newCrane.length() > 0) {
      newCrane.trim();
      newCrane.toUpperCase();
      assignedCrane = newCrane;
      assignedArea = newCrane.substring(0, 2);
      prefs.putString("crane_id", assignedCrane);
      prefs.putString("area", assignedArea);
    }
    if (newSsid.length() > 0) {
      wifiSsid = newSsid;
      wifiPass = newPass;
      prefs.putString("wifi_ssid", wifiSsid);
      prefs.putString("wifi_pass", wifiPass);
    }
    prefs.end();

    String resp = F("<!DOCTYPE html><html><body style='background:#0a0e17;color:#fff;font-family:sans-serif;padding:30px;text-align:center;'>"
      "<h2>Configuracion Guardada</h2>"
      "<p>Grua asignada: <strong>");
    resp += assignedCrane + F("</strong></p>"
      "<p>Conectando a red Wi-Fi... El nodo se reiniciara en 3 segundos.</p>"
      "</body></html>");
    portalServer.send(200, "text/html", resp);
    delay(2500);
    ESP.restart();
  });

  portalServer.onNotFound([]() {
    portalServer.sendHeader("Location", "/", true);
    portalServer.send(302, "text/plain", "");
  });

  portalServer.begin();
  Serial.printf("[PORTAL] AP Activo: %s en 192.168.4.1\n", apName.c_str());

  // Indicador visual en tira LED: Púrpura pulsante
  fill_solid(leds, NUM_LEDS, CRGB::Purple);
  FastLED.show();
}

// =============================================================================
// NVS FLASH: CARGA Y PERSISTENCIA
// =============================================================================
void loadNodeConfig() {
  prefs.begin("scada_sat", false);
  assignedCrane = prefs.getString("crane_id", "20C");
  assignedArea  = prefs.getString("area", "20");
  wifiSsid      = prefs.getString("wifi_ssid", "Totalplay-6DAB");
  wifiPass      = prefs.getString("wifi_pass", "cgonz181");
  oledRotation  = prefs.getUChar("oled_rot", 0);
  scadaServerHost = prefs.getString("pb_host", "192.168.100.34");
  if (scadaServerHost.length() == 0 || scadaServerHost == "192.168.100.33" || scadaServerHost == "null") {
    scadaServerHost = "192.168.100.34";
    prefs.putString("pb_host", scadaServerHost);
  }

  // Auto-sanación de credenciales: Si están vacías o en blanco, forzar Totalplay-6DAB / cgonz181
  if (wifiSsid.length() == 0 || wifiSsid == "TU_RED_WIFI" || wifiSsid == "null" || wifiSsid == "KEEP") {
    wifiSsid = "Totalplay-6DAB";
    wifiPass = "cgonz181";
    prefs.putString("wifi_ssid", wifiSsid);
    prefs.putString("wifi_pass", wifiPass);
  }
  if (wifiPass.length() == 0 || wifiPass == "null") {
    wifiPass = "cgonz181";
    prefs.putString("wifi_pass", wifiPass);
  }
  prefs.end();

  Serial.printf("[NVS] Nodo Satelite Configurado: Grua=%s, Area=%s, SSID=%s, PassLen=%d\n",
                assignedCrane.c_str(), assignedArea.c_str(), wifiSsid.c_str(), wifiPass.length());
}

// =============================================================================
// SINCRONIZACIÓN CLOUD FIRESTORE (CHIP EN MODO SATELLITE)
// =============================================================================
String getIsoTimestamp() {
  time_t now = time(nullptr);
  struct tm ti;
  gmtime_r(&now, &ti);
  char buf[30];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &ti);
  return String(buf);
}

String getShiftHistoryCollectionName() {
  time_t now = time(nullptr);
  time_t chihTime = now - (6 * 3600);
  struct tm ti;
  gmtime_r(&chihTime, &ti);
  char dateBuf[16];
  strftime(dateBuf, sizeof(dateBuf), "%Y-%m-%d", &ti);

  int day = ti.tm_wday;
  int hour = ti.tm_hour;
  String shift = "JornadaD";
  if (hour >= 6 && hour < 18) {
    shift = (day <= 2) ? "JornadaA" : "JornadaB";
  } else if (day == 0 && hour < 6) {
    shift = "JornadaD";   // domingo antes de las 6 AM: pertenece a D, como en la web
  } else {
    shift = (day <= 2) ? "JornadaC" : "JornadaD";
  }
  return "crane_history_" + String(dateBuf) + "_" + shift;
}

// =============================================================================
// COMUNICACIÓN RADIAL ESP-NOW SCADA (NODO SATÉLITE SECUNDARIO)
// =============================================================================
bool espNowSatelliteActive = false;
uint8_t espNowChannel = 0;
static uint8_t scadaBroadcastMac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

void onEspNowDataRecvSatellite(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len < (int)sizeof(ScadaEspNowPacket)) return;
  ScadaEspNowPacket pkt;
  memcpy(&pkt, data, sizeof(pkt));

  if (memcmp(pkt.magic, SCADA_MAGIC, 4) != 0) return;
  if (pkt.checksum != calcScadaChecksum(&pkt)) return;

  // Filtrar si el mensaje corresponde a la grúa asignada a este nodo
  if (!assignedCrane.equalsIgnoreCase(String(pkt.craneId))) {
    return; // El mensaje es para otra grúa de la bahía
  }

  String newStatus = String(pkt.status);
  newStatus.trim();
  newStatus.toLowerCase();

  lastMasterRx = millis();  // alimenta el watchdog del loop

  Serial.printf("[ESP-NOW RX C3] Master -> Esta Grua (%s): Estado=%s | Motivo=%s | Tipo=0x%02X\n",
                pkt.craneId, newStatus.c_str(), pkt.reason, pkt.msgType);

  if (newStatus == "falla" || newStatus == "en falla") {
    if (currentStatus != "falla") {
      failureStartTime = millis();
    }
    currentStatus = "falla";
    currentReason = String(pkt.reason);
  } else if (newStatus == "reparacion" || newStatus == "en reparacion") {
    currentStatus = "reparacion";
    currentReason = String(pkt.reason);
  } else {
    currentStatus = "operativa";
    currentReason = "";
    failureStartTime = 0;
  }

  updateLeds();
  renderOled();
}

// Fuerza el canal de radio cuando el C3 esta sin Wi-Fi (modo directo ESP-NOW).
// Con los dos boards asociados al mismo AP el canal coincide de forma natural; si el
// router esta en otro canal se avisa, porque ESP-NOW solo escucha en el canal actual.
void syncEspNowChannel() {
  if (WiFi.status() == WL_CONNECTED) {
    int ch = WiFi.channel();
    if (ch != ESPNOW_CHANNEL) {
      Serial.printf("[ESP-NOW C3] Canal del router = %d (!= %d). El Centro de Mando debe estar en %d "
                    "o en este mismo canal para que el enlace funcione.\n", ch, ESPNOW_CHANNEL, ESPNOW_CHANNEL);
    } else {
      Serial.printf("[ESP-NOW C3] Canal de radio confirmado: %d\n", ch);
    }
    return;
  }
  esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_get_channel(&espNowChannel, NULL);
  Serial.printf("[ESP-NOW C3] Sin Wi-Fi: canal fijado a %d (confirmado: %d)\n", ESPNOW_CHANNEL, espNowChannel);
}

void initEspNowSatellite() {
  if (espNowSatelliteActive) return;
  if (esp_now_init() != ESP_OK) {
    Serial.println(F("[ESP-NOW C3] Error al inicializar subsistema"));
    return;
  }
  esp_now_peer_info_t peerInfo;
  memset(&peerInfo, 0, sizeof(peerInfo));
  memcpy(peerInfo.peer_addr, scadaBroadcastMac, 6);
  peerInfo.channel = ESPNOW_CHANNEL;  // canal fijo compartido con el Centro de Mando
  peerInfo.encrypt = false;
  if (esp_now_add_peer(&peerInfo) == ESP_OK) {
    espNowSatelliteActive = true;
    esp_now_register_recv_cb(onEspNowDataRecvSatellite);
    Serial.println(F("[ESP-NOW C3] Enlace radial SCADA satelite activo (Broadcast FF:FF:FF:FF:FF:FF)"));
  } else {
    Serial.println(F("[ESP-NOW C3] Error registrando peer broadcast"));
  }
}

void broadcastEspNowFromSatellite(const String& craneId, const String& status, const String& reason, uint8_t msgType) {
  if (!espNowSatelliteActive) initEspNowSatellite();
  if (!espNowSatelliteActive) return;

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
    Serial.printf("[ESP-NOW TX C3] -> Master: Grua=%s | Tipo=0x%02X | Estado=%s | Motivo=%s\n",
                  pkt.craneId, pkt.msgType, pkt.status, pkt.reason);
  } else {
    Serial.printf("[ESP-NOW TX C3] Error de envio: %d\n", res);
  }
}

// Consulta de estado exclusivamente desde PocketBase crane_status/{assignedCrane}
void fetchStatusFromCloud() {
  if (WiFi.status() != WL_CONNECTED || inConfigPortal) return;

  WiFiClient client;
  client.setTimeout(3000);
  HTTPClient http;
  http.setTimeout(3000);

  String urlStatus = String("http://") + scadaServerHost + ":" + scadaServerPort +
                     "/api/collections/crane_status/records?filter=(craneId='" + assignedCrane + "')";

  if (http.begin(client, urlStatus)) {
    int codeStatus = http.GET();
    if (codeStatus == 200) {
      String payloadStatus = http.getString();
      DynamicJsonDocument docStatus(2048);
      if (!deserializeJson(docStatus, payloadStatus)) {
        if (docStatus.containsKey("items") && docStatus["items"].size() > 0) {
          JsonObject item = docStatus["items"][0].as<JsonObject>();
          String est = item["estado"] | "";
          String mot = item["motivo"] | "";
          est.toLowerCase();

          String newStatus = "operativa";
          String newReason = "";

          if (est == "en falla" || est == "falla" || est == "active" || est == "failure") {
            newStatus = "falla";
            newReason = mot.length() > 0 ? mot : "Falla detectada";
          } else if (est == "reparacion" || est == "en reparacion" || est == "maintenance") {
            newStatus = "reparacion";
            newReason = mot.length() > 0 ? mot : "En Mantenimiento";
          } else {
            newStatus = "operativa";
            newReason = "";
          }

          if (newStatus != currentStatus) {
            if (newStatus == "falla" && currentStatus != "falla") {
              failureStartTime = millis();
            } else if (newStatus == "operativa") {
              failureStartTime = 0;
            }
            currentStatus = newStatus;
            currentReason = newReason;
            flagStatusChanged = true;
            Serial.printf("[CLOUD SYNC PB] Grua %s -> %s (%s)\n", assignedCrane.c_str(), currentStatus.c_str(), currentReason.c_str());
          }
        }
      }
    }
    http.end();
  }
}

// Limpia órdenes remotas de un solo uso tras ser ejecutadas
void clearRemoteCommand(const String& cleanMac, const String& recId) {
  if (recId.length() == 0) return;
  WiFiClient cClient;
  cClient.setTimeout(3000);
  HTTPClient cHttps;
  cHttps.setTimeout(3000);
  String url = String("http://") + scadaServerHost + ":" + scadaServerPort +
               "/api/collections/crane_devices/records/" + recId;
  if (cHttps.begin(cClient, url)) {
    cHttps.addHeader("Content-Type", "application/json");
    cHttps.addHeader("Authorization", pbAuthHeader());
    cHttps.PATCH("{\"remoteCommand\":\"\"}");
    cHttps.end();
  }
}

// Envía presencia periódica a crane_devices/{cleanMac} para aparecer ONLINE en admin.html
// y recibe reasignación de grúa (Hot-Swap) y rotación de pantalla Over-The-Air desde la Web
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
  // strptime() no resuelve nombres de día/mes en la newlib del ESP32: el reloj quedaba en 1970
  // y los tickets/historial salían con reportedAt:"1970-01-01T00:00:xxZ". Se parsea RFC 1123
  // por posiciones fijas y sí se aplica settimeofday().
  time_t utc = httpDateToEpoch(dateHeader);
  if (utc < 1700000000) return false;
  struct timeval tv;
  tv.tv_sec = utc;
  tv.tv_usec = 0;
  settimeofday(&tv, nullptr);
  return true;
}

// Parser manual de la cabecera HTTP "Date". strptime() no resuelve los nombres de día/mes en
// newlib de ESP32 (medido: el nodo 30A nunca llegó a sincronizar porque UDP 123 está bloqueado
// en la red y el fallback con strptime devolvía false), así que lastSeen quedaba vacío y el
// panel mostraba el nodo caído aunque el latido fuera HTTP 200. Se parsean las posiciones fijas
// de RFC 1123 y se genera el ISO directamente, sin depender de settimeofday().

// HTTPClient sólo expone las cabeceras de RESPUESTA que se colectan explícitamente; sin esto
// http.header("Date") devolvía vacío y el reloj nunca se sincronizaba.
static const char* kDateHeaderKeys[] = {"Date"};

// Sincroniza el reloj del nodo usando la cabecera "Date" de PocketBase. NTP (UDP 123) está
// bloqueado en esta red, así que sin esto el reloj queda en 1970 y el historial se llena con
// reportedAt:"1970-01-01T00:00:xxZ", lo que infla los tiempos ANDON.
static bool pbSyncClock() {
  HTTPClient h;
  h.begin(String("http://") + scadaServerHost + ":" + String(scadaServerPort) + "/health");
  h.setTimeout(6000);
  h.collectHeaders(kDateHeaderKeys, 1);
  if (h.GET() != HTTP_CODE_OK) { h.end(); return false; }
  bool ok = syncClockFromHttpDate(h.header("Date"));
  h.end();
  return ok;
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

// ISO del momento actual; si el reloj sigue en 1970 se usa la cabecera "Date" del servidor,
// para que el ticket/historial no salgan con reportedAt:"1970-01-01T00:00:xxZ".
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


// Un satélite sólo acepta un ID de grúa como objetivo asignado desde el panel (formato '20F',
// '10A'): dos dígitos + letra. Los nombres de área ('area20') son para los mandos centrales.
static bool isCraneIdTarget(const String& t) {
  String s = t;
  s.trim();
  s.toUpperCase();
  if (s.length() < 3) return false;
  int i = 0;
  while (i < (int)s.length() && isDigit(s[i])) i++;
  if (i == 0 || i >= (int)s.length()) return false;
  return (int)s.length() - i == 1 && isAlpha(s[i]);
}

void registerDeviceHeartbeat() {
  if (WiFi.status() != WL_CONNECTED || inConfigPortal) return;

  // Guard de reloj: sin NTP sincronizado, time(nullptr) devuelve ~0 y lastSeen se escribe
  // como 1970-01-01, lo que hace que el panel muestre el nodo como caído. Se reintenta NTP
  // y, mientras no esté sincronizado, se omite lastSeen (el panel marca "En vivo" por status).
  bool clockSynced = (time(nullptr) >= 1700000000);
  if (!clockSynced) {
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

  WiFiClient client;
  client.setTimeout(3000);
  HTTPClient http;
  http.setTimeout(3000);

  // 1. Buscar si ya existe el registro en crane_devices de PocketBase
  //    Se ordena por creación descendente para que la resolución sea determinista: con dos
  //    registros de la misma MAC, sin sort el servidor podía devolverlos en distinto orden y
  //    el PATCH fallaba con "resource wasn't found".
  String queryUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                    "/api/collections/crane_devices/records?filter=(cleanMac='" + cleanMac + "'||mac='" + cleanMac + "')&sort=-created";
  
  String devRecordId = "";
  String remoteTarget = "";
  int remoteRot = -1;
  String remoteCmd = "";
  String remoteRole = "";
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
          Serial.printf("[HEARTBEAT] AVISO: %d registros con la MAC %s. Se usa el más reciente; limpia los duplicados.\n",
                        (int)qDoc["items"].size(), cleanMac.c_str());
        }
        JsonObject item = qDoc["items"][0].as<JsonObject>();
        devRecordId = item["id"].as<String>();
        if (item.containsKey("assignedArea")) {
          remoteTarget = item["assignedArea"].as<String>();
        }
        if (item.containsKey("assignedRole")) {
          remoteRole = item["assignedRole"].as<String>();
        }
        if (item.containsKey("oledRotation")) {
          remoteRot = item["oledRotation"].as<int>();
        }
        if (item.containsKey("remoteCommand")) {
          remoteCmd = item["remoteCommand"].as<String>();
        }
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

  // 1b. Eliminar los registros duplicados de esta MAC (los crearon versiones antiguas del
  //     firmware y hacen que el panel de admin muestre el nodo duplicado o "caído").
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
  doc["mac"] = getFormattedMac();
  doc["currentArea"] = assignedCrane;
  doc["role"] = "satellite_crane";
  // v3.4.2: el heartbeat NO escribe assignedRole/assignedArea. Esas columnas las define el
  // panel de administración (Topología); el nodo sólo reporta telemetría. Escribirlas desde el
  // NVS hacía que el nodo se reasignara a sí mismo y peleara con la asignación del panel.
  if (remoteRole.length() > 0 && remoteRole != "satellite_crane" && remoteRole != "satellite") {
    Serial.printf("[HOT-SWAP] AVISO: rol asignado en Web (%s) no coincide con este nodo (satellite_crane).\n", remoteRole.c_str());
  }
  doc["roleLabel"] = "Grúa " + assignedCrane + " (Satélite)";
  doc["ip"] = ipStr;
  doc["status"] = "online";
  doc["firmwareVersion"] = firmwareVersion;
  if (clockSynced) doc["lastSeen"] = nowIso;
  else if (serverIso.length()) doc["lastSeen"] = serverIso;

  String body;
  serializeJson(doc, body);

  int patchCode = 0;
  if (devRecordId.length() > 0) {
    String patchUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                      "/api/collections/crane_devices/records/" + devRecordId;
    if (http.begin(client, patchUrl)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", pbAuthHeader());
      patchCode = http.PATCH(body);
      http.end();
    }
  } else {
    // El firmware NO crea registros de dispositivo. La WEB es la creadora: Panel de
    // Administración > Topología (alta manual del ESP32 o detección por USB). Si la placa
    // no está registrada, el heartbeat avisa y no escribe.
    Serial.printf("[HEARTBEAT] crane_devices/%s no existe. Registralo en el panel de Topologia; no se escribe.\n", cleanMac.c_str());
  }

  Serial.printf("[HEARTBEAT] Telemetria crane_devices/%s (%s) -> HTTP %d\n", cleanMac.c_str(), assignedCrane.c_str(), patchCode);

  // 1. Hot-Swap de Grúa asignada desde la Web (admin.html)
  //    Validación: un satélite sólo puede recibir un ID de grúa (ej. '20F'). Si el panel envía
  //    un área ('area20') el nodo no puede convertirse en mando central (el rol es físico, del
  //    sketch), y 'substring(0,2)' producía un área inválida ('ar').
  if (remoteTarget.length() > 0 && !remoteTarget.equalsIgnoreCase(assignedCrane)) {
    if (!isCraneIdTarget(remoteTarget)) {
      Serial.printf("[HOT-SWAP OTA] Descartado '%s': un nodo satélite necesita un ID de grúa (ej. 20F), no un área.\n",
                    remoteTarget.c_str());
    } else {
    Serial.printf("[HOT-SWAP OTA] Reasignando grúa desde Web Admin: %s -> %s\n",
                  assignedCrane.c_str(), remoteTarget.c_str());
    assignedCrane = remoteTarget;
    assignedArea  = (remoteTarget.length() >= 2) ? remoteTarget.substring(0, 2) : "10";
    prefs.begin("scada_sat", false);
    prefs.putString("crane_id", assignedCrane);
    prefs.putString("area", assignedArea);
    prefs.end();
    flagStatusChanged = true;
    renderOled();
    updateLeds();
    }
  }

  // 2. Rol asignado en el panel: el rol es físico (este sketch ES un satélite). Si el panel lo
  //    cambia a otro rol se avisa en vez de fingir que el nodo cambió.
  if (remoteRole.length() > 0 && remoteRole != "satellite_crane" && remoteRole != "satellite") {
    Serial.printf("[HOT-SWAP OTA] AVISO: rol asignado en Web (%s) no coincide con este nodo (satellite_crane).\n",
                  remoteRole.c_str());
  }

  // 2. Rotación de pantalla OLED (180° / 0°) desde la Web
  if (remoteRot >= 0 && remoteRot != (int)oledRotation) {
    oledRotation = (remoteRot == 2) ? 2 : 0;
    prefs.begin("scada_sat", false);
    prefs.putUChar("oled_rot", oledRotation);
    prefs.end();
    if (oledAvailable) {
      display.setRotation(oledRotation);
      renderOled();
    }
    Serial.printf("[HOT-SWAP OTA] Rotación de pantalla OLED actualizada: %d\n", oledRotation);
  }

  // 3. Comando remoto desde la Web (ej: TEST_OLED)
  if (remoteCmd.equalsIgnoreCase("test_oled") || remoteCmd.equalsIgnoreCase("test_display")) {
    Serial.println(F("[HOT-SWAP OTA] Ejecutando orden remota: TEST_OLED"));
    if (oledAvailable) {
      display.clearDisplay();
      display.drawRect(0, 0, SCREEN_W, SCREEN_H, SSD1306_WHITE);
      display.setTextSize(1);
      display.setCursor(6, 4);
      display.print("TEST OLED");
      int charW = assignedCrane.length() * 12;
      int startX = max(0, (SCREEN_W - charW) / 2);
      display.setTextSize(2);
      display.setCursor(startX, 18);
      display.print(assignedCrane);
      display.display();
      delay(1500);
      renderOled();
    }
    clearRemoteCommand(cleanMac, devRecordId);
  }
}

// =============================================================================
// ARCHIVO DE HISTORIAL (crane_history) DESDE EL BOTÓN FÍSICO
// =============================================================================
// Antes de PocketBase el Historial de Grúas se llenaba porque el botón llamaba al bot
// (POST /api/esp32/crane), que archivaba la resolución. Con la ruta directa contra
// PocketBase el nodo solo escribe crane_status/cranes/notifications, así que los eventos
// físicos nunca llegaban al historial (medido: 119 notificaciones de esp32 y sólo 3
// registros de crane_history, todos de pruebas). Aquí se reconstruye ese archivo con las
// mismas métricas (tiempo de falla, respuesta y reparación) y los campos day/shift que
// usa public/pocketbase-adapter.js para filtrar el historial por día y jornada.
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

// "2026-10-26T16:04:09Z" -> epoch. Se necesita porque el reloj local del nodo puede no
// estar sincronizado (NTP/UDP 123 está bloqueado en esta red) y entonces se usa la
// cabecera "Date" de PocketBase como fuente de hora.
static time_t isoToEpoch(const String& iso) {
  if (iso.length() < 20) return 0;
  struct tm t;
  memset(&t, 0, sizeof(t));
  t.tm_year = iso.substring(0, 4).toInt() - 1900;
  t.tm_mon = iso.substring(5, 7).toInt() - 1;
  t.tm_mday = iso.substring(8, 10).toInt();
  t.tm_hour = iso.substring(11, 13).toInt();
  t.tm_min = iso.substring(14, 16).toInt();
  t.tm_sec = iso.substring(17, 19).toInt();
  return epochFromTmUtc(&t);
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
  // El domingo antes de las 6 AM pertenece a la Jornada D (igual que window.SHIFTS en la web).
  if (day == 0 && hour < 6) return "JornadaD";
  return (day <= 2) ? "JornadaC" : "JornadaD";
}

// day/shift escritos en el registro de crane_history: la web agrupa el Historial de Grúas por
// estos campos, así que deben corresponder al momento del REPORTE (reportedAt).
String histDayAtReport = "";
String histShiftAtReport = "";

// Payload para POST /api/collections/crane_history/records. `rec` es el registro activo
// de la colección `cranes` (todavía no borrado), de donde se toma reportedAt y la
// entrada 'maintenance' de statusHistory para desglosar los 3 tiempos ANDON.
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
  // day/shift sobre reportedAt (momento del reporte), no sobre el instante de la resolución:
  // la web agrupa el Historial de Grúas por estos campos.
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
    statusHist = "[{\"status\":\"failed\",\"at\":\"" + jsonEscape(reportedIso) +
                 "\",\"by\":\"esp32\",\"byName\":\"Pulsador Cabina\",\"note\":\"Boton fisico\"}]";
  }
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

// =============================================================================
// ACCIONES DESDE EL BOTÓN FÍSICO LOCAL (1 GRÚA POR NODO) + FALLBACK DIRECTO POCKETBASE
// =============================================================================
void syncDirectToPocketBase(const String& craneId, const String& status, const String& reason) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[FALLBACK PB] Wi-Fi desconectado, reporte respaldado por ESP-NOW"));
    return;
  }

  pbSyncClock();  // reloj del nodo desde la cabecera Date de PocketBase
  WiFiClient client;
  client.setTimeout(3000);
  HTTPClient http;
  http.setTimeout(3000);

  // 1. Buscar id de registro en crane_status
  String findUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                   "/api/collections/crane_status/records?filter=(craneId='" + craneId + "')";
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

  // 1b. El firmware NO crea registros: el panel de administración crea las áreas, las grúas y
  //     su fila espejo en crane_status. Si la fila falta, el nodo avisa y no escribe.
  if (pbRecordId.length() == 0) {
    Serial.printf("[FALLBACK PB DIRECTO] crane_status/%s no existe. Debe crearla el panel de administración; no se escribe.\n", craneId.c_str());
    client.stop();
    return;
  }

  if (pbRecordId.length() > 0) {
    String patchUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                      "/api/collections/crane_status/records/" + pbRecordId;
    if (http.begin(client, patchUrl)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", pbAuthHeader());
      String b = String("{\"estado\":\"") + ((status == "falla") ? "En Falla" : "operativa") +
                 "\",\"motivo\":\"" + reason + "\",\"source\":\"Boton satelite\"}";
      int code = http.PATCH(b);
      Serial.printf("[FALLBACK PB DIRECTO] crane_status/%s -> %s (HTTP %d)\n", craneId.c_str(), status.c_str(), code);
      http.end();
    }
  }

  // 2. Registro en cranes y notificación en PocketBase para sincronización total con Web y Bot de WhatsApp
  if (status == "falla") {
    String cranesUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                       "/api/collections/cranes/records";
    if (http.begin(client, cranesUrl)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", pbAuthHeader());
      String reportIso = getIsoTimestamp();
      String histEntry = "{\"status\":\"failed\",\"at\":\"" + jsonEscape(reportIso) +
                         "\",\"by\":\"esp32\",\"byName\":\"Pulsador Cabina\",\"note\":\"" + jsonEscape(reason) + "\"}";
      String cb = String("{\"craneId\":\"") + craneId + "\",\"status\":\"active\",\"description\":\"" + reason +
                  "\",\"area\":\"" + assignedArea + "\",\"source\":\"esp32\",\"reportedBy\":\"Pulsador Cabina (" + craneId +
                  ")\",\"reportedAt\":\"" + jsonEscape(reportIso) +
                  "\",\"statusHistory\":[" + histEntry + "]}";
      http.POST(cb);
      http.end();
    }

    String notifUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                      "/api/collections/notifications/records";
    if (http.begin(client, notifUrl)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", pbAuthHeader());
      String nb = String("{\"type\":\"crane_failure\",\"craneId\":\"") + craneId +
                  "\",\"area\":\"" + assignedArea + "\",\"status\":\"pending\",\"source\":\"esp32\",\"reportedBy\":\"Pulsador Cabina (" +
                  craneId + ")\",\"description\":\"" + reason + "\"}";
      int nCode = http.POST(nb);
      Serial.printf("[FALLBACK PB DIRECTO] notifications %s -> HTTP %d\n", craneId.c_str(), nCode);
      http.end();
    }
  } else {
    // Eliminar tickets activos en cranes para esta grúa y archivar el evento en
    // crane_history (Historial de Grúas) antes de borrarlos, porque el histórico se
    // calcula con reportedAt y la entrada 'maintenance' de statusHistory.
    String serverIso = "";
    String histPayload = "";
    String findActUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                        "/api/collections/cranes/records?filter=(craneId='" + craneId + "')";
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
                                                   reason, "Pulsador Cabina (" + craneId + ")", assignedArea);
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
        int code = http.POST(histPayload);
        if ((code == 400 || code == 401) && pbEnsureValidToken()) {
          Serial.println("[HISTORIAL] reintento con token renovado...");
          code = http.POST(histPayload);
        }
        Serial.printf("[HISTORIAL] crane_history %s -> HTTP %d (%s/%s)\n",
                      craneId.c_str(), code, histDayAtReport.c_str(), histShiftAtReport.c_str());
        if (code >= 400) Serial.printf("[HISTORIAL respuesta] %s\n", http.getString().c_str());
        http.end();
      }
    }

    String notifUrl = String("http://") + scadaServerHost + ":" + scadaServerPort +
                      "/api/collections/notifications/records";
    if (http.begin(client, notifUrl)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", pbAuthHeader());
      String nb = String("{\"type\":\"crane_resolved\",\"status\":\"pending\",\"craneId\":\"") + craneId +
                  "\",\"area\":\"" + assignedArea + "\",\"description\":\"Falla resuelta\",\"resolvedBy\":\"Pulsador Cabina (" + craneId + ")\",\"resolution\":\"" + reason + "\",\"source\":\"esp32\"}";
      http.POST(nb);
      http.end();
    }
  }
}

void reportFailureFromButton() {
  currentStatus = "falla";
  failureStartTime = millis();
  reportedIsoAtFailure = isoOrServerIso();  // se usa como reportedAt del ticket y del historial
  currentReason = "Reportado en cabina satelite";
  flagStatusChanged = true;

  updateLeds();
  renderOled();

  // 1. Transmisión inmediata vía ESP-NOW al Centro de Mando (< 5ms)
  broadcastEspNowFromSatellite(assignedCrane, "falla", "Reportado en cabina satelite", MSG_BUTTON_REPORT);
  Serial.printf("[%lu] [ACCION BOTON C3] Grua %s -> EN PARO enviada a Centro de Mando por ESP-NOW\n",
          millis(), assignedCrane.c_str());

  // 2. Fallback: solo si el enlace ESP-NOW no entregó el evento se escribe directo.
  //    En modo exclusivo quien registra crane_status/cranes/crane_history/notifications
  //    es el Centro de Mando, no el satélite.
#if ESPNOW_ONLY_MODE
  if (!espNowSatelliteActive) syncDirectToPocketBase(assignedCrane, "falla", "Reportado en cabina satelite");
#else
  syncDirectToPocketBase(assignedCrane, "falla", "Reportado en cabina satelite");
#endif
}

void resolveFailureFromButton() {
  currentStatus = "operativa";
  failureStartTime = 0;
  currentReason = "";
  flagStatusChanged = true;

  updateLeds();
  renderOled();

  // 1. Transmisión inmediata vía ESP-NOW al Centro de Mando (< 5ms)
  broadcastEspNowFromSatellite(assignedCrane, "operativa", "Resuelta en cabina satelite", MSG_BUTTON_RESOLVE);
  Serial.printf("[ACCION BOTON C3] Grua %s -> OPERATIVA enviada a Centro de Mando por ESP-NOW\n", assignedCrane.c_str());

#if ESPNOW_ONLY_MODE
  if (!espNowSatelliteActive) syncDirectToPocketBase(assignedCrane, "operativa", "Resuelta en cabina satelite");
#else
  syncDirectToPocketBase(assignedCrane, "operativa", "Resuelta en cabina satelite");
#endif
}

// =============================================================================
// RENDERIZADO LEDS Y DISPLAY OLED
// =============================================================================
void updateLeds(float holdProgress) {
  if (inConfigPortal) {
    fill_solid(leds, NUM_LEDS, CRGB::Purple);
    FastLED.show();
    return;
  }

  if (holdProgress > 0.0) {
    // Si se está manteniendo el botón para resolver o portal
    int fillCount = (int)(NUM_LEDS * holdProgress);
    CRGB color = (currentStatus == "falla") ? CRGB::Green : CRGB::Red;
    for (int i = 0; i < NUM_LEDS; i++) {
      leds[i] = (i < fillCount) ? color : CRGB(15, 15, 15);
    }
    FastLED.show();
    return;
  }

  if (currentStatus == "falla") {
    unsigned long elapsedSec = (failureStartTime > 0) ? (millis() - failureStartTime) / 1000 : 0;
    if (elapsedSec >= 300) {
      // Alerta escalada (> 5 min): Estrobo alternado Rojo y Blanco
      fill_solid(leds, NUM_LEDS, blinkState ? CRGB::Red : CRGB::White);
    } else {
      // Barra de tiempo Andon de 0 a 300s
      int activeLeds = map(constrain(elapsedSec, 0, 300), 0, 300, 1, NUM_LEDS);
      for (int i = 0; i < NUM_LEDS; i++) {
        if (i < activeLeds - 1) {
          leds[i] = CRGB(255, 60, 0); // Ámbar/Naranja
        } else if (i == activeLeds - 1) {
          leds[i] = blinkState ? CRGB::Red : CRGB(40, 10, 0);
        } else {
          leds[i] = CRGB::Black;
        }
      }
    }
  } else if (currentStatus == "reparacion") {
    fill_solid(leds, NUM_LEDS, CRGB(255, 120, 0));
    int cursor = (millis() / 120) % NUM_LEDS;
    leds[cursor] = CRGB::Cyan;
  } else {
    // Operativa normal: Verde industrial continuo
    fill_solid(leds, NUM_LEDS, CRGB::Green);
  }
  FastLED.show();
}

void renderOled(float holdProgress) {
  if (!oledAvailable) return;
  display.clearDisplay();

  int charW = assignedCrane.length() * 12;
  int startX = max(0, (SCREEN_W - charW) / 2);

  if (inConfigPortal) {
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(2, 2);
    display.print("PORTAL AP");
    display.setCursor(2, 14);
    display.print("192.168.4.1");
    display.setTextSize(2);
    display.setCursor(startX, 24);
    display.print(assignedCrane);
    display.display();
    return;
  }

  if (holdProgress > 0.0) {
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(2, 4);
    display.print(currentStatus == "falla" ? "RESOLVIENDO" : "REPORTANDO");
    display.drawRect(2, 20, SCREEN_W - 4, 12, SSD1306_WHITE);
    int barW = (int)((SCREEN_W - 8) * holdProgress);
    display.fillRect(4, 22, barW, 8, SSD1306_WHITE);
    display.display();
    return;
  }

  if (currentStatus == "falla") {
    unsigned long elapsedSec = (failureStartTime > 0) ? (millis() - failureStartTime) / 1000 : 0;
    int m = elapsedSec / 60;
    int s = elapsedSec % 60;

    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(2);
    display.setCursor(startX, 2);
    display.print(assignedCrane);

    display.setTextSize(1);
    display.setCursor(14, 18);
    display.print("EN PARO");

    // Cronómetro centrado abajo: "00:00"
    display.setCursor(20, 28);
    if (m < 10) display.print("0");
    display.print(m); display.print(":");
    if (s < 10) display.print("0");
    display.print(s);

  } else if (currentStatus == "reparacion") {
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(2);
    display.setCursor(startX, 2);
    display.print(assignedCrane);

    display.setTextSize(1);
    display.setCursor(6, 18);
    display.print("MANTTO TEC");
    display.setCursor(10, 28);
    display.print("EN ATENCION");
  } else {
    // Modo normal: Grúa grande en el centro superior y OPERATIVA abajo
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(2);
    display.setCursor(startX, 4);
    display.print(assignedCrane);

    display.setTextSize(1);
    display.setCursor(10, 24);
    display.print("OPERATIVA");
  }

  display.display();
}

// =============================================================================
// PROCESAMIENTO DE COMANDOS SERIALES USB (WEB SERIAL)
// =============================================================================
void processSerialCommands() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  if (line.equalsIgnoreCase("INFO") || line.equalsIgnoreCase("GET_INFO")) {
    String mac = getFormattedMac();
    String ip  = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "0.0.0.0";
    Serial.printf("INFO:MAC=%s,IP=%s,ROLE=satellite_crane,TARGET=%s,CRANE=%s,AREA=%s,SSID=%s,STATUS=%s,VER=%s,OLED=%d,ROT=%d\n",
                  mac.c_str(), ip.c_str(), assignedCrane.c_str(), assignedCrane.c_str(), assignedArea.c_str(),
                  wifiSsid.c_str(), currentStatus.c_str(), firmwareVersion, (oledAvailable ? 1 : 0), (int)oledRotation);
  } else if (line.startsWith("SET_CRANE:")) {
    String newC = line.substring(10);
    newC.trim();
    newC.toUpperCase();
    if (newC.length() > 0) {
      assignedCrane = newC;
      assignedArea = newC.substring(0, 2);
      prefs.begin("scada_sat", false);
      prefs.putString("crane_id", assignedCrane);
      prefs.putString("area", assignedArea);
      prefs.end();
      Serial.printf("OK:CRANE_SET=%s\n", assignedCrane.c_str());
      flagStatusChanged = true;
      renderOled();
    }
  } else if (line.startsWith("SET_CONFIG:")) {
    // Formato enviado por admin.js: SET_CONFIG:role:target:ssid:pass
    // o legacy: SET_CONFIG:target:ssid:pass
    int p1 = line.indexOf(':', 11);
    int p2 = (p1 != -1) ? line.indexOf(':', p1 + 1) : -1;
    int p3 = (p2 != -1) ? line.indexOf(':', p2 + 1) : -1;

    String field1 = (p1 != -1) ? line.substring(11, p1) : line.substring(11);
    String field2 = (p1 != -1 && p2 != -1) ? line.substring(p1 + 1, p2) : ((p1 != -1) ? line.substring(p1 + 1) : "");
    String field3 = (p2 != -1 && p3 != -1) ? line.substring(p2 + 1, p3) : ((p2 != -1) ? line.substring(p2 + 1) : "");
    String field4 = (p3 != -1) ? line.substring(p3 + 1) : "";

    String target = "";
    String ssid = "";
    String pass = "";

    String roleField = "";
    if (field1.equalsIgnoreCase("satellite_crane") || field1.equalsIgnoreCase("satellite") || field1.equalsIgnoreCase("cranes")) {
      roleField = field1;
      target = field2;
      ssid   = field3;
      pass   = field4;
    } else {
      target = field1;
      ssid   = field2;
      pass   = field3;
    }

    target.trim();
    target.toUpperCase();
    ssid.trim();
    pass.trim();

    // El rol es físico (este sketch es nodo satélite C3 mini); el panel sólo puede reasignar la grúa.
    if (roleField.length() > 0 && roleField != "satellite_crane" && roleField != "satellite") {
      Serial.printf("[SERIAL] AVISO: rol '%s' no aplicable: este tablero es Nodo Satelite (satellite_crane).\n", roleField.c_str());
    }
    if (target.length() > 0 && target != "KEEP" && !isCraneIdTarget(target)) {
      Serial.println(F("ERROR:SET_CONFIG_TARGET_INVALID (un nodo satélite necesita un ID de grua, ej. 20F)"));
      return;
    }

    prefs.begin("scada_sat", false);
    if (target.length() > 0 && target != "KEEP") {
      assignedCrane = target;
      assignedArea = target.substring(0, 2);
      prefs.putString("crane_id", assignedCrane);
      prefs.putString("area", assignedArea);
    }
    if (ssid.length() > 0 && ssid != "KEEP" && ssid != "null") {
      wifiSsid = ssid;
      wifiPass = pass;
      prefs.putString("wifi_ssid", wifiSsid);
      prefs.putString("wifi_pass", wifiPass);
    }
    prefs.end();

    Serial.println(F("OK:CONFIG_SAVED"));
    Serial.printf("[NVS SAT] Configuracion guardada: Grua=%s, Area=%s, SSID=%s. Reiniciando...\n",
                  assignedCrane.c_str(), assignedArea.c_str(), wifiSsid.c_str());
    delay(400);
    ESP.restart();
  } else if (line.equalsIgnoreCase("BTN_CLICK") || line.equalsIgnoreCase("PRESS_BUTTON") || line.equalsIgnoreCase("FAIL")) {
    Serial.println(F("[HIL SIM] Simulando pulsacion corta de boton (REPORTAR FALLA)..."));
    reportFailureFromButton();
    Serial.println(F("OK:BTN_CLICK_PROCESSED"));
  } else if (line.equalsIgnoreCase("BTN_HOLD") || line.equalsIgnoreCase("RESOLVE_BUTTON") || line.equalsIgnoreCase("RESOLVE")) {
    Serial.println(F("[HIL SIM] Simulando pulsacion 4s de boton (RESOLVER FALLA)..."));
    resolveFailureFromButton();
    Serial.println(F("OK:BTN_HOLD_PROCESSED"));
  } else if (line.startsWith("SET_OLED_ROTATION:")) {
    int rot = line.substring(18).toInt();
    oledRotation = (rot == 2) ? 2 : 0;
    prefs.begin("scada_sat", false);
    prefs.putUChar("oled_rot", oledRotation);
    prefs.end();
    if (oledAvailable) {
      display.setRotation(oledRotation);
      renderOled();
    }
    Serial.printf("OK:OLED_ROTATION_SET=%d\n", oledRotation);
  } else if (line.equalsIgnoreCase("TEST_OLED")) {
    if (oledAvailable) {
      display.clearDisplay();
      display.drawRect(0, 0, SCREEN_W, SCREEN_H, SSD1306_WHITE);
      display.setTextSize(1);
      display.setCursor(6, 4);
      display.print("TEST OLED");
      int charW = assignedCrane.length() * 12;
      int startX = max(0, (SCREEN_W - charW) / 2);
      display.setTextSize(2);
      display.setCursor(startX, 18);
      display.print(assignedCrane);
      display.display();
      delay(1500);
      renderOled();
    }
    Serial.println(F("OK:OLED_TEST_COMPLETED"));
  } else if (line.startsWith("SET_SERVER:")) {
    String srv = line.substring(11);
    srv.trim();
    if (srv.length() > 0) {
      scadaServerHost = srv;
      prefs.begin("scada_sat", false);
      prefs.putString("pb_host", scadaServerHost);
      prefs.end();
      Serial.printf("OK:SERVER_SET=%s\n", scadaServerHost.c_str());
    }
  } else if (line.equalsIgnoreCase("STATUS")) {
    Serial.printf("STATUS:CRANE=%s,AREA=%s,ESTADO=%s,CANAL=%d,ESPNOW=%s,WIFI=%s\n",
                  assignedCrane.c_str(), assignedArea.c_str(), currentStatus.c_str(),
                  espNowChannel, (espNowSatelliteActive ? "OK" : "INACTIVO"),
                  (WiFi.status() == WL_CONNECTED ? "ON" : "OFF"));
  } else if (line.equalsIgnoreCase("TEST_REPORT")) {
    // Simula el pulsador físico sin tocar el hardware: mismo camino (ESP-NOW -> Master)
    reportFailureFromButton();
  } else if (line.equalsIgnoreCase("TEST_RESOLVE")) {
    resolveFailureFromButton();
  } else if (line.equalsIgnoreCase("HEAP") || line.equalsIgnoreCase("MEM")) {
    Serial.printf("HEAP:FREE=%d,MIN=%d,STATUS=%s,IP=%s\n",
                  ESP.getFreeHeap(), ESP.getMinFreeHeap(),
                  currentStatus.c_str(), WiFi.localIP().toString().c_str());
  }
}

// =============================================================================
// INTERRUPCIONES HARDWARE DE ALTA PRECISIÓN PARA BOTÓN FÍSICO
// =============================================================================
volatile bool isrBtnRawState = false;
volatile unsigned long isrBtnLastEdgeTime = 0;
volatile bool isrClickPending = false;
volatile unsigned long isrClickDuration = 0;

void IRAM_ATTR isrButtonHandler() {
  bool pressed = (digitalRead(BTN_PIN) == LOW);
#ifdef BTN_ALT_PIN
  if (digitalRead(BTN_ALT_PIN) == LOW) pressed = true;
#endif
  unsigned long nowMs = millis();

  if (pressed && !isrBtnRawState) {
    // Flanco de bajada (presionado)
    isrBtnRawState = true;
    isrBtnLastEdgeTime = nowMs;
  } else if (!pressed && isrBtnRawState) {
    // Flanco de subida (soltado)
    isrBtnRawState = false;
    unsigned long dur = nowMs - isrBtnLastEdgeTime;
    if (dur >= 25 && dur <= 6000) {
      isrClickDuration = dur;
      isrClickPending = true;
    }
  }
}

// =============================================================================
// SETUP & LOOP PRINCIPAL
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
  attachInterrupt(digitalPinToInterrupt(BTN_PIN), isrButtonHandler, CHANGE);
#ifdef BTN_ALT_PIN
  pinMode(BTN_ALT_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(BTN_ALT_PIN), isrButtonHandler, CHANGE);
#endif

  // Cargar configuración de grúa asignada
  loadNodeConfig();

  // Iniciar Tira LED
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
  fill_solid(leds, NUM_LEDS, CRGB::Blue);
  FastLED.show();

  // Iniciar OLED si está conectado
#if defined(CONFIG_IDF_TARGET_ESP32C3) || defined(ARDUINO_ESP32C3_DEV)
  if (display.begin()) {
    oledAvailable = true;
    display.setRotation(oledRotation);
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(2);
    int charW = assignedCrane.length() * 12;
    int startX = max(0, (SCREEN_W - charW) / 2);
    display.setCursor(startX, 4);
    display.print(assignedCrane);
    display.setTextSize(1);
    display.setCursor(10, 24);
    display.print("OPERATIVA");
    display.display();
    Serial.println(F("[OLED] Pantalla 0.42\" (72x40) activa con offset 28px"));
  } else {
    Serial.println(F("[OLED] Pantalla 0.42\" no detectada en I2C SDA=5, SCL=6"));
  }
#else
  Wire.begin(I2C_SDA, I2C_SCL);
  if (display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    oledAvailable = true;
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(4, 12);
    display.print("NODO SCADA:");
    display.setTextSize(2);
    display.setCursor(4, 26);
    display.print(assignedCrane);
    display.display();
    delay(200);
  }
#endif

  // Iniciar modo Wi-Fi STA y enlace radial ESP-NOW
  WiFi.mode(WIFI_STA);
  initEspNowSatellite();
  syncEspNowChannel();

  // Conectar Wi-Fi si hay credenciales para sincronizar canal de radio con el Master
  if (wifiSsid.length() > 0 && wifiSsid != "TU_WIFI_SSID") {
    Serial.printf("[WIFI] Conectando a %s (pass len=%d)...\n", wifiSsid.c_str(), wifiPass.length());
    WiFi.setSleep(false);
    WiFi.setAutoReconnect(true);
    WiFi.setTxPower(WIFI_POWER_19_5dBm);
    WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  } else {
    Serial.println(F("[WIFI] Sin credenciales. Mantén 20s el botón para abrir Portal Cautivo."));
  }

  updateLeds();
  renderOled();
}

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

  // Procesar comandos Web Serial
  processSerialCommands();

  // Manejar Portal Cautivo si está activo
  if (inConfigPortal) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    delay(5);
    return;
  }

  // Auto-reconexión a red local para mantener canal RF sincronizado
  bool isConnected = (WiFi.status() == WL_CONNECTED);
  static unsigned long lastReconnectAttempt = 0;
  static int wifiFailCount = 0;
  static bool wasConnected = false;
  static unsigned long lastHeartbeatTime = 0;

  if (isConnected && !wasConnected) {
    wasConnected = true;
    wifiFailCount = 0;
    Serial.printf("[WIFI] Canal RF sincronizado exitosamente! IP: %s | Canal: %d\n",
                  WiFi.localIP().toString().c_str(), WiFi.channel());
    configTime(-6 * 3600, 0, "pool.ntp.org", "time.google.com");
    espNowChannel = WiFi.channel();
    initEspNowSatellite();
    pbLogin();
    registerDeviceHeartbeat();
    lastHeartbeatTime = now;
  } else if (!isConnected && wasConnected) {
    wasConnected = false;
    Serial.println(F("[WIFI] Desconectado de router. Operando en modo directo ESP-NOW."));
  }

  // Sincronización periódica con la nube (PocketBase) cada 10 segundos para reflejar cambios hechos en la Web
  static unsigned long lastCloudStatusSync = 0;
#if ESPNOW_ONLY_MODE
  // El unico dueño del estado es el Centro de Mando: cada 30s el satelite solicita su
  // estado y el master responde con MSG_STATUS_BROADCAST para SU grúa.
  static unsigned long lastStateRequest = 0;
  if (espNowSatelliteActive && (now - lastStateRequest >= 10000 || lastStateRequest == 0)) {  // Ronda 3: ping cada 10 s
    lastStateRequest = now;
    broadcastEspNowFromSatellite(assignedCrane, currentStatus, currentReason, MSG_PING_HEARTBEAT);
  }

  // Watchdog de estado: si el nodo lleva 45 s sin escuchar al Centro de Mando
  // (broadcast perdido, mando apagado o cambio de canal) se auto-resincroniza
  // leyendo crane_status, para no quedar enclavado mostrando "EN PARO".
  // lastMasterRx es global y la alimenta el callback ESP-NOW.
  if (isConnected && espNowSatelliteActive && (now - lastMasterRx >= 30000)) {  // Ronda 3: watchdog 30 s
    lastMasterRx = now;
    Serial.println(F("[WATCHDOG C3] Sin noticias del Centro de Mando. Resincronizando desde la nube..."));
    fetchStatusFromCloud();
  }
#else
  if (isConnected && (now - lastCloudStatusSync >= 10000 || lastCloudStatusSync == 0)) {
    lastCloudStatusSync = now;
    fetchStatusFromCloud();
  }
#endif

  // Heartbeat periódico cada 30 segundos para presencia en Admin Web y Hot-Swap OTA
  if (isConnected && (now - lastHeartbeatTime >= 30000)) {
    lastHeartbeatTime = now;
    registerDeviceHeartbeat();
  }

  if (!isConnected && (now - lastReconnectAttempt >= 10000)) {
    lastReconnectAttempt = now;
    wifiFailCount++;
    WiFi.disconnect(false);
    WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  }

  // Cadencia de parpadeos cada 400 ms
  if (now - lastBlinkTime >= 400) {
    lastBlinkTime = now;
    blinkState = !blinkState;
    updateLeds();
    renderOled();
  }

  // =========================================================================
  // DETECCIÓN INTELIGENTE DEL BOTÓN FÍSICO (ISR + POLLING HÍBRIDO)
  // =========================================================================
  bool isPressed = (digitalRead(BTN_PIN) == LOW);
#ifdef BTN_ALT_PIN
  if (digitalRead(BTN_ALT_PIN) == LOW) isPressed = true;
#endif
  bool activePressed = isPressed || isrBtnRawState;

  static bool lastBtnState = false;
  static unsigned long btnPressStart = 0;
  static bool actionExecuted = false;

  if (activePressed && !lastBtnState) {
    // Flanco de bajada (inicio de pulsación)
    btnPressStart = now;
    lastBtnState = true;
    actionExecuted = false;

    // Reporte inmediato al inicio de la pulsacion. Antes se esperaba a la suelta
    // y solo si duraba <5 s, de modo que una pulsacion larga no reportaba nada.
    if (currentStatus != "falla") {
      actionExecuted = true;
      isrClickPending = false;
      reportFailureFromButton();
      updateLeds();
      renderOled();
    }
  } else if (activePressed && lastBtnState) {
    unsigned long duration = now - btnPressStart;

    // A) 15 Segundos: Apertura forzada de Portal Cautivo
    if (duration >= 15000 && !actionExecuted) {
      actionExecuted = true;
      Serial.println(F("[BOTON 15s] Activando Portal Cautivo..."));
      startConfigPortal();
      return;
    }

    // B) Si la grúa está en FALLA: Mantener 2.0s para RESOLVER
    if (currentStatus == "falla") {
      float progress = (float)duration / 2000.0;
      if (progress > 1.0) progress = 1.0;
      updateLeds(progress);
      renderOled(progress);

      // Guardad: no resolver si la falla se acaba de reportar (evita resolver
      // por accidente al mantener el boton justo despues del reporte inmediato).
      if (duration >= 2000 && !actionExecuted && (millis() - failureStartTime) >= 3000) {
        actionExecuted = true;
        isrClickPending = false;
        resolveFailureFromButton();
        updateLeds();
        renderOled();
      }
    }
  } else if (!activePressed && lastBtnState) {
    // Flanco de subida (botón soltado)
    unsigned long duration = now - btnPressStart;
    lastBtnState = false;

    // Si la grúa estaba OPERATIVA y se pulsó (>25ms y <5000ms): REPORTAR FALLA
    if (currentStatus != "falla" && !actionExecuted && duration >= 25 && duration < 5000) {
      actionExecuted = true;
      isrClickPending = false;
      reportFailureFromButton();
      updateLeds();
      renderOled();
    } else {
      updateLeds();
      renderOled();
    }
    actionExecuted = false;
  }

  // Backup por si la pulsación ocurrió en microsegundos durante un handshake de red
  if (isrClickPending && !actionExecuted) {
    isrClickPending = false;
    if (currentStatus != "falla") {
      actionExecuted = true;
      Serial.println(F("[BOTON ISR BACKUP] Evento de pulsación capturado por interrupción hardware!"));
      reportFailureFromButton();
      updateLeds();
      renderOled();
      actionExecuted = false;
    }
  }

  delay(10);
}

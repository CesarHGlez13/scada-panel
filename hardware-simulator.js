// 🛡️ HELPER DE SEGURIDAD DOM SEGURO (Elimina DOM XSS)
function setSafeDOM(element, htmlString) {
    if (!element) return;
    if (!htmlString) {
        element.replaceChildren();
        return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    const fragment = range.createContextualFragment(htmlString);
    fragment.querySelectorAll('script, iframe, object, embed').forEach(el => el.remove());
    fragment.querySelectorAll('*').forEach(el => {
        for (let i = el.attributes.length - 1; i >= 0; i--) {
            const attr = el.attributes[i];
            if (attr && attr.name && attr.name.toLowerCase().startsWith('on')) {
                el.removeAttribute(attr.name);
            }
        }
    });
    element.replaceChildren(fragment);
}

/*
 * =============================================================================
 * EMULADOR DE HARDWARE INDUSTRIAL SCADA — ESP32 GC9A01 & 4 NODOS C3 (30s)
 * =============================================================================
 * Simula con precisión milimétrica la lógica de firmware en C++:
 *   - Selección en color Ámbar de grúa/módulo activo en diagrama, tira y pantalla.
 *   - Botón de 5s presionado (Hold-to-Report) y barra verde que se va llenando.
 *   - Menú de Salir explícito dentro del catálogo de selección de fallas.
 *   - Centro de Mando Master: Pantalla circular 240x240, botón 16mm, dial 360°,
 *     tira WS2815 de 19 LEDs (16 activos + 3 espaciadores físicos).
 *   - 4 Nodos Secundarios C3 (Área 30: 30A, 30B, 30C, 30D) con OLED 0.42" y tiras locales.
 * =============================================================================
 */

// --- AUDIO SINTETIZADO INDUSTRIAL (Clic de botón metálico antivandálico) ---
let audioCtx = null;
function playIndustrialClickSound(pitch = 140) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.055);
  } catch(e) {}
}

function playConfirmChime() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, audioCtx.currentTime);
    osc.frequency.setValueAtTime(780, audioCtx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.26);
  } catch(e) {}
}

// --- ESTADOS FSM ---
const STATE_SUPERVISOR = 0;
const STATE_SELECT_MACHINE = 1;
const STATE_SELECT_REASON = 2;
const STATE_CONFIRM_RESOLVE = 3;
const STATE_FEEDBACK_FLASH = 4;

let currentState = STATE_SUPERVISOR;

// --- MODELO DE DATOS DE LA FLOTA 30s (4 GRÚAS) ---
let nodes = [
  { id: "30A", name: "GRÚA 30A", status: "operativa", reason: "", faultStartTime: 0 },
  { id: "30B", name: "GRÚA 30B", status: "operativa", reason: "", faultStartTime: 0 },
  { id: "30C", name: "GRÚA 30C", status: "operativa", reason: "", faultStartTime: 0 },
  { id: "30D", name: "GRÚA 30D", status: "operativa", reason: "", faultStartTime: 0 }
];
let selectedMachineIndex = 0;

// --- CATÁLOGO DE MOTIVOS DE PARO (GRÚAS) ---
let failureReasons = [
  "1. Leva rota",
  "2. Fuga neumática",
  "3. Tornillería floja",
  "4. Componente roto",
  "5. Falla sensor",
  "6. Atasco mecánico"
];
let selectedReasonIndex = 0;

// --- TEMPORIZADORES Y DETECCIÓN DE BOTÓN PRESIONADO 5S ---
const INACTIVITY_TIMEOUT_MS = 5000; // 5 segundos para auto-confirmar o llenar barra
let lastButtonActivityTime = 0;
let isButtonHeld = false;
let buttonHoldStartTime = 0;
let feedbackStartTime = 0;
let feedbackTitle = "";
let feedbackSub = "";
let feedbackDetail = "";

let isOnline = true;
const NUM_MASTER_LEDS = 19;     // 16 LEDs de grúas + 3 espaciadores físicos
const NUM_SATELLITE_LEDS = 8;   // 8 LEDs por cada nodo secundario C3

// Contexto de pantalla circular GC9A01
let gcCanvas, gcCtx;

// =============================================================================
// INICIALIZACIÓN
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  gcCanvas = document.getElementById('gc9a01Canvas');
  if (gcCanvas) {
    gcCtx = gcCanvas.getContext('2d');
  }

  initWs2815Bars();
  renderReasonsBadges();
  initFirestoreSync();
  setupButtonListeners();

  // Soporte de pruebas visuales por parámetro de URL
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('test') === 'select_machine') {
    currentState = STATE_SELECT_MACHINE;
    selectedMachineIndex = 1; // Grúa 30B en ámbar
    lastButtonActivityTime = Date.now();
  } else if (urlParams.get('test') === 'cancel_machine') {
    currentState = STATE_SELECT_MACHINE;
    selectedMachineIndex = nodes.length - 1; // Grúa 30D
    lastButtonActivityTime = Date.now();
  } else if (urlParams.get('test') === 'cancel_reason') {
    currentState = STATE_SELECT_REASON;
    selectedMachineIndex = 0;
    selectedReasonIndex = failureReasons.length; // Opción SALIR
    lastButtonActivityTime = Date.now();
  } else if (urlParams.get('test') === 'fault') {
    nodes[1].status = 'falla';
    nodes[1].reason = 'Fuga neumática';
    nodes[1].faultStartTime = Date.now();
  }

  // Bucle de animación 60 FPS
  requestAnimationFrame(simulationLoop);

  logSerial("[BOOT] SCADA Master ESP32 inicializado. Bus WS2815 (GPIO 4/16) listo.");
  logSerial("[NVS] 6 motivos de paro sincronizados en memoria Flash virtual.");
  logSerial("[DIAGRAMA] 4 Nodos Secundarios C3 enlazados (Flota 30s). Selección en Ámbar activa.");
});

// =============================================================================
// CONFIGURACIÓN DE EVENTOS DEL BOTÓN FÍSICO 16MM (HOLD 5S + CLICK CORTO)
// =============================================================================
function setupButtonListeners() {
  const btn = document.getElementById('btn16mmPhysical');
  if (!btn) return;

  const startHold = (e) => {
    e.preventDefault();
    isButtonHeld = true;
    buttonHoldStartTime = Date.now();
    playIndustrialClickSound(180);

    const halo = document.getElementById('btnRingHalo');
    if (halo) {
      halo.style.borderColor = '#10b981';
      halo.style.boxShadow = '0 0 22px #10b981, inset 0 0 10px #10b981';
      halo.style.color = '#10b981';
    }
  };

  const endHold = (e) => {
    if (!isButtonHeld) return;
    const now = Date.now();
    const duration = now - buttonHoldStartTime;
    isButtonHeld = false;

    // Restaurar halo
    const halo = document.getElementById('btnRingHalo');
    if (halo) {
      halo.style.borderColor = (currentState === STATE_SELECT_MACHINE || currentState === STATE_SELECT_REASON) ? '#f59e0b' : '#38bdf8';
      halo.style.boxShadow = (currentState === STATE_SELECT_MACHINE || currentState === STATE_SELECT_REASON) ? '0 0 14px #f59e0b' : '0 0 12px #38bdf8';
      halo.style.color = (currentState === STATE_SELECT_MACHINE || currentState === STATE_SELECT_REASON) ? '#f59e0b' : '#38bdf8';
    }

    if (duration < 500) {
      // Toque corto: rotar de opción
      handleShortClick();
    } else if (duration < 5000) {
      // Soltado antes de 5 segundos: advertencia
      logSerial(`[BOTÓN 16MM] Soltado a los ${(duration/1000).toFixed(1)}s (antes de 5s). Acción no confirmada.`, 'warn');
      lastButtonActivityTime = now; // Reiniciar contador de inactividad
    }
  };

  btn.addEventListener('mousedown', startHold);
  btn.addEventListener('mouseup', endHold);
  btn.addEventListener('mouseleave', endHold);

  btn.addEventListener('touchstart', startHold, { passive: false });
  btn.addEventListener('touchend', endHold, { passive: false });
  btn.addEventListener('touchcancel', endHold, { passive: false });
}

// Inicialización de la tira Master (19 LEDs) y las 4 tiras secundarias (8 LEDs c/u)
function initWs2815Bars() {
  // 1. Tira Master de 19 LEDs (4 LEDs 30A + 1 Espaciador + 4 LEDs 30B + 1 Esp + 4 LEDs 30C + 1 Esp + 4 LEDs 30D)
  const masterBar = document.getElementById('masterWs2815Bar');
  if (masterBar) {
    masterBar.replaceChildren();
    for (let i = 0; i < NUM_MASTER_LEDS; i++) {
      const px = document.createElement('div');
      if (i === 4 || i === 9 || i === 14) {
        // Espaciador de 1 LED físico
        px.className = 'ws2815-pixel-spacer';
        px.id = `masterPixel_${i}`;
        px.title = `Espaciador de 1 LED físico (Separación de Grúas)`;
      } else {
        px.className = 'ws2815-pixel-master';
        px.id = `masterPixel_${i}`;
        const craneName = i < 4 ? 'GRÚA 30A' : (i < 9 ? 'GRÚA 30B' : (i < 14 ? 'GRÚA 30C' : 'GRÚA 30D'));
        px.title = `LED Master ${i} • ${craneName}`;
      }
      masterBar.appendChild(px);
    }
  }

  // 2. Tiras Secundarias Locales de los 4 Nodos C3
  nodes.forEach(n => {
    const bar = document.getElementById(`satWs2815Bar_${n.id}`);
    if (bar) {
      bar.replaceChildren();
      for (let p = 0; p < NUM_SATELLITE_LEDS; p++) {
        const px = document.createElement('div');
        px.className = 'ws2815-pixel-sat';
        px.id = `satPixel_${n.id}_${p}`;
        px.title = `${n.name} • LED Local ${p + 1}/8`;
        bar.appendChild(px);
      }
    }
  });
}

// =============================================================================
// BUCLE PRINCIPAL DE SIMULACIÓN (60 FPS)
// =============================================================================
function simulationLoop(timestamp) {
  const now = Date.now();

  // 1. Cálculo de progreso de la barra verde (Por botón presionado o por inactividad de 5s)
  let currentProgress = 0;

  if (isButtonHeld) {
    const holdElapsed = now - buttonHoldStartTime;
    currentProgress = Math.min(1.0, holdElapsed / 5000.0);
    if (holdElapsed >= 5000) {
      isButtonHeld = false;
      playConfirmChime();
      logSerial("[BOTÓN 5s] Mantención de 5s completada. Ejecutando confirmación...", "cloud");
      executeConfirmAction();
    }
  } else if (currentState === STATE_SELECT_MACHINE || currentState === STATE_SELECT_REASON || currentState === STATE_CONFIRM_RESOLVE) {
    const elapsed = now - lastButtonActivityTime;
    currentProgress = Math.min(1.0, elapsed / INACTIVITY_TIMEOUT_MS);
    if (elapsed >= INACTIVITY_TIMEOUT_MS) {
      playConfirmChime();
      executeConfirmAction();
    }
  } else if (currentState === STATE_FEEDBACK_FLASH) {
    if (now - feedbackStartTime >= 1500) {
      currentState = STATE_SUPERVISOR;
      logSerial(`[FSM] Destello de confirmación completado. Retornando a STATE_SUPERVISOR.`);
    }
  }

  // 2. Actualizar estado y badge del llenado en la interfaz web
  updateHtmlProgressBar(currentProgress);

  // 3. Renderizar Pantalla Circular GC9A01 Master (Limpia, dial industrial sin barras superpuestas)
  renderGc9a01Screen(now, currentProgress);

  // 4. Renderizar las 4 Pantallas OLED 0.42" y estado Ámbar de los Nodos C3
  renderAllOledC3Screens(now);

  // 5. Renderizar Barra LED WS2815 Física con Efecto de Llenado Progresivo LED a LED (0 a 19 LEDs)
  updateWs2815Pixels(now, currentProgress);

  requestAnimationFrame(simulationLoop);
}

// Actualiza el badge de estado y el mensaje del botón en la interfaz web
function updateHtmlProgressBar(progress) {
  const badge = document.getElementById('ledFillStatusBadge');
  const hintLabel = document.getElementById('btnActionHint');

  const currentMachine = nodes[selectedMachineIndex];
  const isMachineInFault = (currentMachine && currentMachine.status === 'falla');
  const isExit = (currentState === STATE_SELECT_REASON && selectedReasonIndex >= failureReasons.length);
  const isResolve = (currentState === STATE_CONFIRM_RESOLVE || (currentState === STATE_SELECT_MACHINE && isMachineInFault));
  const isFillingState = (currentState === STATE_SELECT_MACHINE || currentState === STATE_SELECT_REASON || currentState === STATE_CONFIRM_RESOLVE);

  if (badge) {
    if (!isFillingState || progress <= 0) {
      badge.className = 'badge bg-dark border border-secondary text-secondary font-monospace';
      badge.textContent = (currentState === STATE_SUPERVISOR) ? 'STANDBY' : (isResolve ? `RESOLVER: ${currentMachine.id}` : `SELECCIÓN: ${currentMachine.id}`);
    } else {
      const pct = Math.floor(progress * 100);
      const sec = (progress * 5.0).toFixed(1);
      if (isExit) {
        badge.className = 'badge bg-danger text-white font-monospace';
        badge.textContent = `CANCELANDO: ${sec}s / 5.0s (${pct}%)`;
      } else if (isResolve) {
        badge.className = 'badge bg-success text-white font-monospace fw-bold';
        badge.textContent = `RESOLVIENDO ${currentMachine.id}: ${sec}s / 5.0s (${pct}%)`;
      } else {
        badge.className = 'badge bg-warning text-dark font-monospace fw-bold';
        badge.textContent = `REPORTANDO ${currentMachine.id}: ${sec}s / 5.0s (${pct}%)`;
      }
    }
  }

  if (hintLabel) {
    if (currentState === STATE_SUPERVISOR) {
      setSafeDOM(hintLabel, '<i class="bi bi-hand-index-thumb"></i> PULSAR BOTÓN: SELECCIONAR');
    } else if (isButtonHeld) {
      const sec = (progress * 5.0).toFixed(1);
      if (isExit) {
        setSafeDOM(hintLabel, `<span class="text-danger fw-bold"><i class="bi bi-x-octagon"></i> CANCELANDO (${sec}s)...</span>`);
      } else if (isResolve) {
        setSafeDOM(hintLabel, `<span class="text-success fw-bold"><i class="bi bi-tools"></i> RESOLVIENDO A OPERATIVA (${sec}s)...</span>`);
      } else {
        setSafeDOM(hintLabel, `<span class="text-warning fw-bold"><i class="bi bi-hourglass-split"></i> REPORTANDO (${sec}s)...</span>`);
      }
    } else if (currentState === STATE_SELECT_MACHINE) {
      const isLast = (selectedMachineIndex === nodes.length - 1);
      if (isMachineInFault) {
        setSafeDOM(hintLabel, `<span class="text-success fw-bold"><i class="bi bi-tools"></i> MANTÉN 5s: RESOLVER (VERDE) | CLIC: ROTAR</span>`);
      } else if (isLast) {
        setSafeDOM(hintLabel, `<span class="text-danger"><i class="bi bi-x-circle"></i> CLIC: CANCELAR | MANTÉN 5s: OK</span>`);
      } else {
        setSafeDOM(hintLabel, `<span class="text-warning"><i class="bi bi-hand-index-thumb"></i> CLIC: SIGUIENTE | MANTÉN 5s: OK</span>`);
      }
    } else if (currentState === STATE_SELECT_REASON) {
      if (isExit) {
        setSafeDOM(hintLabel, `<span class="text-info"><i class="bi bi-arrow-repeat"></i> CLIC: LEVAS | MANTÉN 5s: SALIR</span>`);
      } else {
        setSafeDOM(hintLabel, `<span class="text-warning"><i class="bi bi-hand-index-thumb"></i> CLIC: MOTIVO | MANTÉN 5s: REPORTAR</span>`);
      }
    } else if (currentState === STATE_CONFIRM_RESOLVE) {
      setSafeDOM(hintLabel, `<span class="text-success"><i class="bi bi-tools"></i> CLIC: CANCELAR | MANTÉN 5s: RESOLVER</span>`);
    }
  }
}

// =============================================================================
// ACCIONES DE CONFIRMACIÓN (POR MANTENER 5S O TEMPORIZADOR DE 5S)
// =============================================================================
function executeConfirmAction() {
  const now = Date.now();
  lastButtonActivityTime = now;

  if (currentState === STATE_SELECT_MACHINE) {
    const current = nodes[selectedMachineIndex];
    if (current.status === 'falla') {
      current.status = 'operativa';
      current.reason = '';
      current.faultStartTime = 0;

      feedbackTitle = "✓ FALLA RESUELTA";
      feedbackSub = current.name;
      feedbackDetail = "OPERATIVA (PUESTA EN MARCHA)";
      feedbackStartTime = now;
      currentState = STATE_FEEDBACK_FLASH;

      logSerial(`[FALLA RESUELTA] ${current.name} puesta en marcha (OPERATIVA) tras confirmación 5s en VERDE.`, 'cloud');
      syncNodeToCloud(current.id, 'operativa', 'Solucionado en piso desde Boton fisico');
      return;
    } else {
      currentState = STATE_SELECT_REASON;
      selectedReasonIndex = 0;
      logSerial(`[FSM] Confirmada ${current.name}. Pasando a SELECCIÓN DE MOTIVO.`);
    }
  } else if (currentState === STATE_SELECT_REASON) {
    // Si está en la opción de Salir del menú de motivos
    if (selectedReasonIndex >= failureReasons.length) {
      currentState = STATE_SUPERVISOR;
      logSerial(`[CANCELAR] Menú de Salir confirmado por operador. Reporte cancelado. Retorno a SUPERVISOR.`, 'warn');
      return;
    }

    // Confirma motivo y emite la alerta al entorno de emulación local (Sandbox)
    const current = nodes[selectedMachineIndex];
    const reason = failureReasons[selectedReasonIndex];
    current.status = 'falla';
    current.reason = reason;
    current.faultStartTime = now;

    feedbackTitle = "✓ ALERTA ENVIADA";
    feedbackSub = current.name;
    feedbackDetail = reason;
    feedbackStartTime = now;
    currentState = STATE_FEEDBACK_FLASH;

    logSerial(`[ALERTA EMITIDA] ${current.name} -> PARO POR: ${reason}`, 'fail');
    syncNodeToCloud(current.id, 'falla', reason);
  } else if (currentState === STATE_CONFIRM_RESOLVE) {
    const current = nodes[selectedMachineIndex];
    current.status = 'operativa';
    current.reason = '';
    current.faultStartTime = 0;

    feedbackTitle = "✓ FALLA RESUELTA";
    feedbackSub = current.name;
    feedbackDetail = "OPERATIVA";
    feedbackStartTime = now;
    currentState = STATE_FEEDBACK_FLASH;

    logSerial(`[FALLA RESUELTA] ${current.name} puesta en marcha (OPERATIVA).`, 'cloud');
    syncNodeToCloud(current.id, 'operativa', 'Solucionado en piso desde Boton fisico');
  }
}

// =============================================================================
// RENDERIZADOR EXACTO PANTALLA CIRCULAR GC9A01 (240x240)
// =============================================================================
function renderGc9a01Screen(now, progress) {
  if (!gcCtx) return;
  const ctx = gcCtx;
  const w = 240, h = 240;
  const cx = 120, cy = 120;

  ctx.clearRect(0, 0, w, h);

  // Fondo Circular
  ctx.fillStyle = '#07090e';
  ctx.beginPath();
  ctx.arc(cx, cy, 119, 0, Math.PI * 2);
  ctx.fill();

  const totalNodes = nodes.length;
  const sliceAngle = (Math.PI * 2) / totalNodes;
  const anyFault = nodes.filter(n => n.status === 'falla').length;

  if (currentState === STATE_SUPERVISOR) {
    // 1. Anillo Perimetral 360° con arcos individuales por máquina
    for (let i = 0; i < totalNodes; i++) {
      const startA = i * sliceAngle - Math.PI / 2 + 0.05;
      const endA = (i + 1) * sliceAngle - Math.PI / 2 - 0.05;
      const isFault = nodes[i].status === 'falla';
      
      ctx.beginPath();
      ctx.arc(cx, cy, 109, startA, endA);
      ctx.lineWidth = 5;
      ctx.strokeStyle = isFault ? '#ef4444' : '#10b981';
      ctx.stroke();
    }

    // 2. Encabezado Superior (Centrado armónico, alejado del anillo circular)
    ctx.fillStyle = isOnline ? '#38bdf8' : '#f59e0b';
    ctx.font = '700 10.5px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isOnline ? 'ONLINE CLOUD' : 'OFFLINE NVS', cx, 44);
    ctx.fillStyle = '#64748b';
    ctx.font = '600 9px Outfit, sans-serif';
    ctx.fillText('FLOTA SECCIÓN 30s', cx, 57);

    // 3. Tarjeta Hero Central (Centrada verticalmente: Y=69 a Y=155)
    const cardBorder = anyFault > 0 ? '#f59e0b' : '#10b981';
    roundRect(ctx, 42, 69, 156, 86, 10, '#10141a', cardBorder, 2);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 9.5px Outfit, sans-serif';
    ctx.fillText('SUPERVISOR SCADA', cx, 84);

    // Disponibilidad % (OEE)
    const avail = Math.round(((totalNodes - anyFault) / totalNodes) * 100);
    ctx.fillStyle = anyFault === 0 ? '#10b981' : '#f59e0b';
    ctx.font = '800 21px Outfit, sans-serif';
    ctx.fillText(`${avail}% DISP`, cx, 106);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 10.5px Outfit, sans-serif';
    ctx.fillText(`${totalNodes - anyFault} OK  |  ${anyFault} PARO`, cx, 125);

    if (anyFault > 0) {
      const firstFault = nodes.find(n => n.status === 'falla');
      ctx.fillStyle = '#ef4444';
      ctx.font = '700 10px Outfit, sans-serif';
      ctx.fillText(`ALERTA: ${firstFault.name}`, cx, 142);
    } else {
      ctx.fillStyle = '#38bdf8';
      ctx.font = '600 10px Outfit, sans-serif';
      ctx.fillText('LÍNEA EN OPERACIÓN', cx, 142);
    }

    // 4. Zona Inferior (Centrada y equilibrada)
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 10px Outfit, sans-serif';
    ctx.fillText('PULSAR BOTÓN: REPORTAR', cx, 175);
    ctx.fillStyle = '#64748b';
    ctx.font = '600 9px Outfit, sans-serif';
    ctx.fillText('SUPERVISIÓN MULTINODO', cx, 192);

  } else if (currentState === STATE_SELECT_MACHINE) {
    const isLast = (selectedMachineIndex === totalNodes - 1);
    const current = nodes[selectedMachineIndex];
    const isFault = (current.status === 'falla');

    // Anillo perimetral: Grúa seleccionada en VERDE (#10b981) si está en falla (para resolver), o en ÁMBAR (#f59e0b) si está operativa (para reportar)
    const selectColor = isFault ? '#10b981' : '#f59e0b';

    for (let i = 0; i < totalNodes; i++) {
      const startA = i * sliceAngle - Math.PI / 2 + 0.05;
      const endA = (i + 1) * sliceAngle - Math.PI / 2 - 0.05;
      const isSelected = (i === selectedMachineIndex);
      const nodeFault = (nodes[i].status === 'falla');

      ctx.beginPath();
      ctx.arc(cx, cy, 109, startA, endA);
      ctx.lineWidth = isSelected ? 7 : 4;
      ctx.strokeStyle = isSelected ? selectColor : (nodeFault ? '#ef4444' : '#10b981');
      ctx.stroke();
    }

    if (isFault) {
      // =======================================================================
      // MODO RESOLUCIÓN: Grúa seleccionada ya está en falla -> SE RESUELVE EN VERDE
      // =======================================================================
      ctx.fillStyle = '#10b981';
      ctx.font = '700 10.5px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('RESOLVER PARO', cx, 44);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 9px Outfit, sans-serif';
      ctx.fillText(`[ ${selectedMachineIndex + 1} / ${totalNodes}${isLast ? ' • SALIR' : ''} ]`, cx, 57);

      roundRect(ctx, 42, 69, 156, 86, 10, '#10141a', '#10b981', 2);

      ctx.fillStyle = '#ffffff';
      ctx.font = '800 19px Outfit, sans-serif';
      ctx.fillText(current.name, cx, 91);

      ctx.fillStyle = '#10b981';
      ctx.font = '800 13px Outfit, sans-serif';
      ctx.fillText('¿EQUIPO REPARADO?', cx, 110);

      roundRect(ctx, 52, 124, 136, 21, 5, '#062b1b', '#10b981', 1);
      ctx.fillStyle = '#a7f3d0';
      ctx.font = '700 9.5px Outfit, sans-serif';
      ctx.fillText('PASAR A OPERATIVA', cx, 138);

      // Zona Inferior en VERDE
      ctx.fillStyle = '#10b981';
      ctx.font = '700 10px Outfit, sans-serif';
      ctx.fillText('MANTÉN 5s: RESOLVER (VERDE)', cx, 175);

      ctx.font = '600 9px Outfit, sans-serif';
      if (isLast) {
        ctx.fillStyle = '#ef4444';
        ctx.fillText('CLIC: CANCELAR (SALIR)', cx, 192);
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('CLIC: SIGUIENTE GRÚA', cx, 192);
      }

    } else {
      // =======================================================================
      // MODO REPORTE: Grúa operativa -> SE REPORTA FALLA EN ÁMBAR
      // =======================================================================
      ctx.fillStyle = '#f59e0b';
      ctx.font = '700 10.5px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('REPORTAR FALLA', cx, 44);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 9px Outfit, sans-serif';
      ctx.fillText(`[ ${selectedMachineIndex + 1} / ${totalNodes}${isLast ? ' • SALIR' : ''} ]`, cx, 57);

      roundRect(ctx, 42, 69, 156, 86, 10, '#14120e', '#f59e0b', 2);

      ctx.fillStyle = '#ffffff';
      ctx.font = '800 21px Outfit, sans-serif';
      ctx.fillText(current.name, cx, 98);

      roundRect(ctx, 54, 116, 132, 24, 6, '#f59e0b', '#f59e0b', 0);
      ctx.fillStyle = '#000000';
      ctx.font = '800 11px Outfit, sans-serif';
      ctx.fillText('OPERATIVA', cx, 132);

      // Zona Inferior en ÁMBAR
      ctx.fillStyle = '#f59e0b';
      ctx.font = '700 10px Outfit, sans-serif';
      ctx.fillText('MANTÉN 5s: REPORTAR (ÁMBAR)', cx, 175);

      ctx.font = '600 9px Outfit, sans-serif';
      if (isLast) {
        ctx.fillStyle = '#ef4444';
        ctx.fillText('CLIC: CANCELAR (SALIR)', cx, 192);
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('CLIC: SIGUIENTE GRÚA', cx, 192);
      }
    }

  } else if (currentState === STATE_SELECT_REASON) {
    const totalReasonOptions = failureReasons.length + 1; // 6 motivos + opción de SALIR
    const isExitOption = (selectedReasonIndex >= failureReasons.length);
    const current = nodes[selectedMachineIndex];

    if (isExitOption) {
      // =======================================================================
      // MENÚ DE SALIR / CANCELAR DENTRO DE LA SELECCIÓN DE FALLA
      // =======================================================================
      ctx.beginPath();
      ctx.arc(cx, cy, 109, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ef4444';
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.font = '700 10.5px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CANCELAR REPORTE', cx, 44);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 9px Outfit, sans-serif';
      ctx.fillText(`[ ${totalReasonOptions} / ${totalReasonOptions} • SALIR ]`, cx, 57);

      // Hero Card Roja de Cancelar
      roundRect(ctx, 42, 69, 156, 86, 10, '#1c0f12', '#ef4444', 2);

      ctx.fillStyle = '#ef4444';
      ctx.font = '800 15px Outfit, sans-serif';
      ctx.fillText('✕ SALIR / CANCELAR', cx, 92);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '700 10.5px Outfit, sans-serif';
      ctx.fillText('VOLVER AL MONITOR', cx, 110);

      roundRect(ctx, 52, 124, 136, 21, 5, '#291417', '#ef4444', 1);
      ctx.fillStyle = '#fca5a5';
      ctx.font = '700 9px Outfit, sans-serif';
      ctx.fillText('NO SE ENVIARÁ ALERTA', cx, 138);

      // Zona Inferior (Exactamente 2 líneas nítidas)
      ctx.fillStyle = '#ef4444';
      ctx.font = '700 10px Outfit, sans-serif';
      ctx.fillText('MANTÉN 5s: SALIR AL MONITOR', cx, 175);

      ctx.fillStyle = '#38bdf8';
      ctx.font = '600 9px Outfit, sans-serif';
      ctx.fillText('CLIC: VOLVER A LEVAS ROTA', cx, 192);

    } else {
      // MOTIVO SELECCIONADO (1 AL 6)
      const currentReason = failureReasons[selectedReasonIndex];

      ctx.beginPath();
      ctx.arc(cx, cy, 109, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#f59e0b';
      ctx.stroke();

      ctx.fillStyle = '#f59e0b';
      ctx.font = '700 10.5px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('MOTIVO DE PARO', cx, 44);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 9px Outfit, sans-serif';
      ctx.fillText(`[ ${selectedReasonIndex + 1} / ${totalReasonOptions} ]`, cx, 57);

      roundRect(ctx, 42, 69, 156, 86, 10, '#14120e', '#f59e0b', 2);

      // Encabezado interno con nombre de la grúa
      ctx.fillStyle = '#f59e0b';
      ctx.font = '700 10.5px Outfit, sans-serif';
      ctx.fillText(current.name, cx, 86);

      // Texto de Motivo Centrado y Nítido
      ctx.fillStyle = '#ffffff';
      if (currentReason.length > 20) {
        ctx.font = '700 12.5px Outfit, sans-serif';
        ctx.fillText(currentReason, cx, 107);
      } else if (currentReason.length > 15) {
        ctx.font = '700 14px Outfit, sans-serif';
        ctx.fillText(currentReason, cx, 108);
      } else {
        ctx.font = '800 17px Outfit, sans-serif';
        ctx.fillText(currentReason, cx, 108);
      }

      // Badge informativo
      roundRect(ctx, 52, 124, 136, 21, 5, '#261b0c', '#f59e0b', 1);
      ctx.fillStyle = '#fcd34d';
      ctx.font = '700 9px Outfit, sans-serif';
      ctx.fillText('PARO NO PROGRAMADO', cx, 138);

      // Zona Inferior (Exactamente 2 líneas nítidas)
      ctx.fillStyle = '#f59e0b';
      ctx.font = '700 10px Outfit, sans-serif';
      ctx.fillText('MANTÉN 5s: REPORTAR ALERTA', cx, 175);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 9px Outfit, sans-serif';
      ctx.fillText('CLIC: SIGUIENTE MOTIVO', cx, 192);
    }

  } else if (currentState === STATE_CONFIRM_RESOLVE) {
    ctx.beginPath();
    ctx.arc(cx, cy, 109, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#10b981';
    ctx.stroke();

    const current = nodes[selectedMachineIndex];
    ctx.fillStyle = '#38bdf8';
    ctx.font = '700 10.5px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RESOLVER PARO', cx, 44);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 9px Outfit, sans-serif';
    ctx.fillText(current.name, cx, 57);

    roundRect(ctx, 42, 69, 156, 86, 10, '#10141a', '#10b981', 2);

    ctx.fillStyle = '#10b981';
    ctx.font = '800 15px Outfit, sans-serif';
    ctx.fillText('¿EQUIPO REPARADO?', cx, 91);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '700 11px Outfit, sans-serif';
    ctx.fillText(current.name, cx, 110);

    roundRect(ctx, 52, 124, 136, 21, 5, '#062b1b', '#10b981', 1);
    ctx.fillStyle = '#a7f3d0';
    ctx.font = '700 9px Outfit, sans-serif';
    ctx.fillText('PASAR A OPERATIVA', cx, 138);

    // Zona Inferior (Exactamente 2 líneas nítidas)
    ctx.fillStyle = '#10b981';
    ctx.font = '700 10px Outfit, sans-serif';
    ctx.fillText('MANTÉN 5s: CONFIRMAR', cx, 175);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 9px Outfit, sans-serif';
    ctx.fillText('CLIC: CANCELAR', cx, 192);

  } else if (currentState === STATE_FEEDBACK_FLASH) {
    const isAlerta = feedbackTitle.indexOf('ALERTA') >= 0;
    const col = isAlerta ? '#ef4444' : '#10b981';

    ctx.beginPath();
    ctx.arc(cx, cy, 109, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = col;
    ctx.stroke();

    roundRect(ctx, 42, 69, 156, 86, 10, '#10141a', col, 2);

    ctx.fillStyle = col;
    ctx.font = '800 15px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(feedbackTitle, cx, 92);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 19px Outfit, sans-serif';
    ctx.fillText(feedbackSub, cx, 114);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 10px Outfit, sans-serif';
    ctx.fillText(feedbackDetail, cx, 136);

    ctx.fillStyle = '#64748b';
    ctx.font = '500 9.5px Outfit, sans-serif';
    ctx.fillText('RETORNANDO AL MONITOR...', cx, 185);
  }
}

// Función auxiliar para dibujar la barra verde que se llena en el canvas GC9A01
function renderCanvasProgressBar(ctx, x, y, width, height, progress, fillColor = '#10b981') {
  // Fondo de la barra
  roundRect(ctx, x, y, width, height, height / 2, '#060a10', '#1e293b', 1);

  // Relleno que avanza de 0% a 100%
  const fillWidth = Math.max(0, Math.min(width - 4, (width - 4) * progress));
  if (fillWidth > 2) {
    roundRect(ctx, x + 2, y + 2, fillWidth, height - 4, (height - 4) / 2, fillColor, null, 0);
  }

  // Porcentaje y cronómetro en texto sobre la barra
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 8.5px Outfit, sans-serif';
  ctx.textAlign = 'center';
  const pct = Math.floor(progress * 100);
  const sec = (progress * 5.0).toFixed(1);
  ctx.fillText(`[ ${pct}% ]  ${sec}s / 5.0s`, x + width / 2, y + height - 3);
}

// =============================================================================
// RENDERIZADOR DE LAS 4 PANTALLAS OLED 0.42" Y RESALTE EN COLOR ÁMBAR
// =============================================================================
function renderAllOledC3Screens(now) {
  nodes.forEach((n, idx) => {
    const canvas = document.getElementById(`oledC3Canvas_${n.id}`);
    const isSelected = (idx === selectedMachineIndex && (currentState === STATE_SELECT_MACHINE || currentState === STATE_SELECT_REASON || currentState === STATE_CONFIRM_RESOLVE));
    const isFault = (n.status === 'falla');

    // 1. Resaltar Gabinete Secundario en Color ÁMBAR (#f59e0b)
    const caseEl = document.getElementById(`caseNodo_${n.id}`);
    const badgeEl = document.getElementById(`nodeBadge_${n.id}`);

    if (caseEl) {
      caseEl.classList.remove('seleccionada', 'falla');
      if (isSelected) {
        caseEl.classList.add('seleccionada');
      } else if (isFault) {
        caseEl.classList.add('falla');
      }
    }

    if (badgeEl) {
      if (isSelected) {
        badgeEl.className = 'badge bg-warning text-dark fw-bold';
        setSafeDOM(badgeEl, `<i class="bi bi-cursor-fill me-1"></i>${n.name} (SELECCIÓN)`);
      } else if (isFault) {
        badgeEl.className = 'badge bg-danger text-white fw-bold';
        setSafeDOM(badgeEl, n.name);
      } else {
        badgeEl.className = 'badge bg-primary text-white fw-bold';
        setSafeDOM(badgeEl, n.name);
      }
    }

    // 2. Renderizar contenido en canvas OLED 0.42"
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = 72, h = 40;

    ctx.fillStyle = '#010204';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';

    // Barra superior: Nombre de la grúa (o resaltado si está seleccionada)
    if (isSelected) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 7px monospace';
      ctx.fillText(`★ ${n.name} ★`, 36, 9);
      ctx.strokeStyle = '#f59e0b';
    } else {
      ctx.font = 'bold 7px monospace';
      ctx.fillText(n.name, 36, 9);
      ctx.strokeStyle = '#334155';
    }

    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4, 12);
    ctx.lineTo(68, 12);
    ctx.stroke();

    if (isFault) {
      // Parpadeo estroboscópico de alerta
      const blink = Math.floor(now / 400) % 2 === 0;
      if (blink) {
        ctx.fillRect(4, 15, 64, 13);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 8px monospace';
        ctx.fillText('! PARO !', 36, 25);
      } else {
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 8px monospace';
        ctx.fillText('! PARO !', 36, 25);
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = '6px monospace';
      const reasonText = (n.reason || 'Falla').substring(0, 12);
      ctx.fillText(reasonText, 36, 36);
    } else if (isSelected) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 8px monospace';
      ctx.fillText('ACTIVA', 36, 24);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '6px monospace';
      ctx.fillText('EN DIAL MASTER', 36, 35);
    } else {
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 8px monospace';
      ctx.fillText('OPERATIVA', 36, 24);

      ctx.fillStyle = '#64748b';
      ctx.font = '6px monospace';
      const ipSuffix = 130 + (n.id.charCodeAt(2) || 1);
      ctx.fillText(isOnline ? `192.168.1.${ipSuffix}` : 'OFFLINE NVS', 36, 35);
    }
  });
}

// =============================================================================
// RENDERIZADOR EXACTO TIRAS LED WS2815 A 12V (CON EFECTO DE LLENADO PROGRESIVO)
// =============================================================================
function updateWs2815Pixels(now, progress = 0) {
  const currentMachine = nodes[selectedMachineIndex];
  const isMachineInFault = (currentMachine && currentMachine.status === 'falla');
  const isExitOption = (currentState === STATE_SELECT_REASON && selectedReasonIndex >= failureReasons.length);
  const isResolveOption = (currentState === STATE_CONFIRM_RESOLVE || (currentState === STATE_SELECT_MACHINE && isMachineInFault));
  const isFillingState = (currentState === STATE_SELECT_MACHINE || currentState === STATE_SELECT_REASON || currentState === STATE_CONFIRM_RESOLVE);
  const isProgressActive = (progress > 0 || isButtonHeld);

  // Determinar color de llenado para la grúa seleccionada:
  // - ROJO: si está en Menú de Salir / Cancelar
  // - VERDE: SI ESTÁ RESOLVIENDO FALLA A OPERATIVA (Comportamiento industrial original: Verde #10b981)
  // - ÁMBAR: al reportar falla en grúa operativa
  let fillColorType = 'amber';
  if (isExitOption) {
    fillColorType = 'red';
  } else if (isResolveOption) {
    fillColorType = 'green';
  } else {
    fillColorType = 'amber';
  }

  // 1. Tira del Centro de Mando Master (19 LEDs: 4x 30A + 1 Esp + 4x 30B + 1 Esp + 4x 30C + 1 Esp + 4x 30D)
  // CADA GRÚA TIENE SUS 4 LEDs DEDICADOS.
  // Las grúas NO seleccionadas muestran SIEMPRE su estado real:
  // - En falla: ROJO con parpadeo estroboscópico de alarma
  // - Operativa: VERDE brillante con atenuación suave / respiración saludable
  // La grúa SELECCIONADA:
  // - Si está llenando: sus 4 LEDs locales avanzan de 1 a 4 en VERDE (resolver), ÁMBAR (reportar), o ROJO (salir)
  // - Si está en espera: sus 4 LEDs pulsan en VERDE (resolver) o ÁMBAR (reportar)
  for (let c = 0; c < 4; c++) {
    const startLed = c * 5; // 0, 5, 10, 15
    const endLed = startLed + 4; // 4, 9, 14, 19
    const gapLed = startLed + 4; // 4, 9, 14
    const n = nodes[c];
    const isThisSelected = (isFillingState && c === selectedMachineIndex);

    // Apagar LED físico espaciador
    if (gapLed < NUM_MASTER_LEDS) {
      const gapEl = document.getElementById(`masterPixel_${gapLed}`);
      if (gapEl) {
        gapEl.style.backgroundColor = '#06090f';
        gapEl.style.boxShadow = 'none';
      }
    }

    if (isThisSelected) {
      // Grúa seleccionada
      if (isProgressActive) {
        const fillCraneCount = Math.min(4, Math.floor(progress * 4.01));
        for (let p = 0; p < 4; p++) {
          const el = document.getElementById(`masterPixel_${startLed + p}`);
          if (!el) continue;

          if (p < fillCraneCount) {
            if (fillColorType === 'red') {
              if (p === fillCraneCount - 1) {
                el.style.backgroundColor = '#fca5a5';
                el.style.boxShadow = '0 0 16px #ef4444, inset 0 0 4px #ffffff';
              } else {
                el.style.backgroundColor = '#ef4444';
                el.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.9)';
              }
            } else if (fillColorType === 'green') {
              if (p === fillCraneCount - 1) {
                el.style.backgroundColor = '#a7f3d0';
                el.style.boxShadow = '0 0 16px #10b981, inset 0 0 4px #ffffff';
              } else {
                el.style.backgroundColor = '#10b981';
                el.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.9)';
              }
            } else {
              // Ámbar (#f59e0b)
              if (p === fillCraneCount - 1) {
                el.style.backgroundColor = '#fef3c7';
                el.style.boxShadow = '0 0 16px #f59e0b, inset 0 0 4px #ffffff';
              } else {
                el.style.backgroundColor = '#f59e0b';
                el.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.95)';
              }
            }
          } else {
            // Fondo tenue de espera para los LEDs aún no alcanzados
            el.style.backgroundColor = '#16120c';
            el.style.boxShadow = 'none';
          }
        }
      } else {
        // En espera de selección:
        if (isResolveOption) {
          // Grúa en falla seleccionada: 4 LEDs en Verde pulsante brillante (Listo para resolver en VERDE)
          const greenPulse = 0.75 + 0.25 * Math.sin(now / 180.0);
          for (let p = 0; p < 4; p++) {
            const el = document.getElementById(`masterPixel_${startLed + p}`);
            if (!el) continue;
            el.style.backgroundColor = `rgba(16, 185, 129, ${greenPulse})`;
            el.style.boxShadow = `0 0 14px rgba(16, 185, 129, ${greenPulse * 0.9})`;
          }
        } else {
          // Grúa operativa seleccionada: 4 LEDs en Ámbar pulsante brillante (Listo para reportar en ÁMBAR)
          const amberPulse = 0.75 + 0.25 * Math.sin(now / 180.0);
          for (let p = 0; p < 4; p++) {
            const el = document.getElementById(`masterPixel_${startLed + p}`);
            if (!el) continue;
            el.style.backgroundColor = `rgba(245, 158, 11, ${amberPulse})`;
            el.style.boxShadow = `0 0 14px rgba(245, 158, 11, ${amberPulse * 0.9})`;
          }
        }
      }
    } else {
      // Grúa NO seleccionada: MOSTRAR SU ESTADO REAL CON MÁXIMA NITIDEZ
      if (n.status === 'falla') {
        // Alarma de paro: Rojo con parpadeo estroboscópico de emergencia
        const flash = (Math.floor(now / 200) % 2 === 0);
        for (let p = 0; p < 4; p++) {
          const el = document.getElementById(`masterPixel_${startLed + p}`);
          if (!el) continue;
          el.style.backgroundColor = flash ? '#ef4444' : '#320606';
          el.style.boxShadow = flash ? '0 0 14px #ef4444' : 'none';
        }
      } else if (n.status === 'reparacion') {
        for (let p = 0; p < 4; p++) {
          const el = document.getElementById(`masterPixel_${startLed + p}`);
          if (!el) continue;
          el.style.backgroundColor = '#f59e0b';
          el.style.boxShadow = '0 0 8px #f59e0b';
        }
      } else {
        // Operativa saludable: Verde brillante con respiración suave
        const breath = 0.65 + 0.35 * Math.sin(now / 350.0);
        for (let p = 0; p < 4; p++) {
          const el = document.getElementById(`masterPixel_${startLed + p}`);
          if (!el) continue;
          el.style.backgroundColor = `rgba(16, 185, 129, ${breath})`;
          el.style.boxShadow = `0 0 8px rgba(16, 185, 129, ${breath * 0.75})`;
        }
      }
    }
  }

  // 2. Tiras Locales de los 4 Nodos Secundarios C3 (8 LEDs cada uno)
  nodes.forEach((n, idx) => {
    const isThisSelected = (isFillingState && idx === selectedMachineIndex);

    for (let p = 0; p < NUM_SATELLITE_LEDS; p++) {
      const el = document.getElementById(`satPixel_${n.id}_${p}`);
      if (!el) continue;

      if (isThisSelected) {
        if (isProgressActive) {
          // Llenado de 0 a 8 LEDs en sincronía
          const fillSatCount = Math.min(NUM_SATELLITE_LEDS, Math.floor(progress * NUM_SATELLITE_LEDS * 1.01));
          if (p < fillSatCount) {
            if (fillColorType === 'red') {
              if (p === fillSatCount - 1) {
                el.style.backgroundColor = '#fca5a5';
                el.style.boxShadow = '0 0 16px #ef4444, inset 0 0 4px #ffffff';
              } else {
                el.style.backgroundColor = '#ef4444';
                el.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.9)';
              }
            } else if (fillColorType === 'green') {
              if (p === fillSatCount - 1) {
                el.style.backgroundColor = '#a7f3d0';
                el.style.boxShadow = '0 0 16px #10b981, inset 0 0 4px #ffffff';
              } else {
                el.style.backgroundColor = '#10b981';
                el.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.9)';
              }
            } else {
              // Ámbar
              if (p === fillSatCount - 1) {
                el.style.backgroundColor = '#fef3c7';
                el.style.boxShadow = '0 0 16px #f59e0b, inset 0 0 4px #ffffff';
              } else {
                el.style.backgroundColor = '#f59e0b';
                el.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.95)';
              }
            }
          } else {
            el.style.backgroundColor = '#16120c';
            el.style.boxShadow = 'none';
          }
        } else {
          // Nodo seleccionado en espera:
          if (isResolveOption) {
            const greenPulse = 0.75 + 0.25 * Math.sin(now / 180.0);
            el.style.backgroundColor = `rgba(16, 185, 129, ${greenPulse})`;
            el.style.boxShadow = `0 0 12px rgba(16, 185, 129, ${greenPulse * 0.9})`;
          } else {
            const satPulse = 0.75 + 0.25 * Math.sin(now / 180.0);
            el.style.backgroundColor = `rgba(245, 158, 11, ${satPulse})`;
            el.style.boxShadow = `0 0 12px rgba(245, 158, 11, ${satPulse * 0.9})`;
          }
        }
      } else {
        // Nodos secundarios no seleccionados: estado real
        if (n.status === 'falla') {
          const flash = (Math.floor(now / 200) % 2 === 0);
          el.style.backgroundColor = flash ? '#ef4444' : '#320606';
          el.style.boxShadow = flash ? '0 0 12px #ef4444' : 'none';
        } else if (n.status === 'reparacion') {
          el.style.backgroundColor = '#f59e0b';
          el.style.boxShadow = '0 0 8px #f59e0b';
        } else {
          // Verde operativo saludable
          const breath = 0.65 + 0.35 * Math.sin(now / 350.0);
          el.style.backgroundColor = `rgba(16, 185, 129, ${breath})`;
          el.style.boxShadow = `0 0 8px rgba(16, 185, 129, ${breath * 0.75})`;
        }
      }
    }
  });
}

// =============================================================================
// INTERACCIÓN CON CLIC CORTO (ROTACIÓN DE GRÚAS Y MOTIVOS)
// =============================================================================
function handleShortClick() {
  playIndustrialClickSound(220);
  const now = Date.now();
  lastButtonActivityTime = now;

  switch (currentState) {
    case STATE_SUPERVISOR:
      currentState = STATE_SELECT_MACHINE;
      selectedMachineIndex = 0;
      logSerial(`[BOTÓN 16MM] Pulsado -> Entrando a SELECCIÓN DE GRÚAS (Ámbar: ${nodes[0].name}).`);
      break;

    case STATE_SELECT_MACHINE:
      // Rotar entre grúas. Al superar la última grúa (el último toque), cancela automáticamente
      selectedMachineIndex++;
      if (selectedMachineIndex >= nodes.length) {
        currentState = STATE_SUPERVISOR;
        selectedMachineIndex = 0;
        logSerial(`[BOTÓN 16MM] Último toque -> Selección cancelada automáticamente. Regreso a SUPERVISOR.`, 'warn');
      } else {
        logSerial(`[BOTÓN 16MM] Clic -> Grúa seleccionada en Ámbar: ${nodes[selectedMachineIndex].name}`);
      }
      break;

    case STATE_SELECT_REASON: {
      // Rotar continuamente entre motivos (0..5) y opción 6 (SALIR) en bucle infinito
      // Al dar clic sobre SALIR, regresa al índice 0 (Leva rota) sin salirse accidentalmente
      const totalOptions = failureReasons.length + 1; // 6 motivos + opción de SALIR (7 total)
      selectedReasonIndex = (selectedReasonIndex + 1) % totalOptions;
      if (selectedReasonIndex === failureReasons.length) {
        logSerial(`[BOTÓN 16MM] Clic -> [ ❌ MENÚ DE SALIR / CANCELAR ] (Mantén presionado 5s para salir o clic para volver a Levas)`, 'warn');
      } else {
        logSerial(`[BOTÓN 16MM] Clic -> Motivo ${selectedReasonIndex + 1}/${totalOptions}: ${failureReasons[selectedReasonIndex]}`);
      }
      break;
    }

    case STATE_CONFIRM_RESOLVE:
      // Si se pulsa durante confirmación de resolución, cancela de inmediato y regresa al supervisor
      currentState = STATE_SUPERVISOR;
      logSerial(`[BOTÓN 16MM] Clic -> Cancelando resolución. Regreso a SUPERVISOR.`, 'warn');
      break;

    case STATE_FEEDBACK_FLASH:
      // Ignorar durante destello de confirmación
      break;
  }
}

// Función auxiliar para cancelar desde el banco de pruebas o atajo
function cancelCurrentSimSelection() {
  if (currentState !== STATE_SUPERVISOR) {
    currentState = STATE_SUPERVISOR;
    lastButtonActivityTime = Date.now();
    logSerial("[CANCELAR] Menú actual cancelado de inmediato. Regreso a SUPERVISOR.", "warn");
  }
}

// =============================================================================
// DISPARADORES DE PRUEBA RÁPIDA (LABORATORIO)
// =============================================================================
function triggerSimulatedFault(reasonName) {
  const current = nodes[selectedMachineIndex];
  current.status = 'falla';
  current.reason = reasonName;
  current.faultStartTime = Date.now();
  logSerial(`[DISPARADOR] Falla inyectada en ${current.name}: ${reasonName}`, 'fail');
  syncNodeToCloud(current.id, 'falla', reasonName);
}

function resolveCurrentSimulatedFault() {
  const current = nodes[selectedMachineIndex];
  current.status = 'operativa';
  current.reason = '';
  current.faultStartTime = 0;
  logSerial(`[DISPARADOR] Falla resuelta en ${current.name} (OPERATIVA).`, 'cloud');
  syncNodeToCloud(current.id, 'operativa', 'Resuelta desde banco de pruebas');
}

function triggerFaultOnNode(nodeId, reasonName) {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;
  node.status = 'falla';
  node.reason = reasonName;
  node.faultStartTime = Date.now();
  logSerial(`[DISPARADOR NODO] Falla directa en ${node.name}: ${reasonName}`, 'fail');
  syncNodeToCloud(node.id, 'falla', reasonName);
}

function resolveFaultOnNode(nodeId) {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;
  node.status = 'operativa';
  node.reason = '';
  node.faultStartTime = 0;
  logSerial(`[DISPARADOR NODO] ${node.name} resuelta (OPERATIVA).`, 'cloud');
  syncNodeToCloud(node.id, 'operativa', 'Resuelta desde nodo');
}

function addNewMachineToSim() {
  const input = document.getElementById('newMachineNameInput');
  if (!input) return;
  const name = input.value.trim().toUpperCase();
  if (!name) return;

  const newId = `node_${String(nodes.length + 1).padStart(2, '0')}`;
  nodes.push({
    id: newId,
    name: name,
    status: 'operativa',
    reason: '',
    faultStartTime: 0
  });

  input.value = '';
  logSerial(`[DINÁMICO] Equipo agregado: ${name} (${newId}). Dial 360 recalculado a ${nodes.length} sectores.`, 'warn');
}

// =============================================================================
// ENTORNO DE EMULACIÓN SANDBOX (CERO ESCRITURAS EN FIRESTORE / BOT)
// =============================================================================
function initFirestoreSync() {
  logSerial("[SANDBOX] Emulador hardware autónomo activo. Operando 100% en memoria local y canvas virtual (Cero escrituras en producción).", 'cloud');
}

function syncNodeToCloud(nodeId, newStatus, reasonText) {
  const desc = reasonText || (newStatus === 'falla' ? 'Falla reportada en simulador' : 'Operación normal');
  
  if (!isOnline) {
    logSerial(`[EMULADOR OFFLINE] Evento guardado en buffer Flash NVS virtual (${nodeId} -> ${newStatus.toUpperCase()}: ${desc}).`, 'warn');
  } else {
    logSerial(`[EMULADOR SANDBOX] Máquina ${nodeId} -> ${newStatus.toUpperCase()}: ${desc}. Simulación en memoria local (0 escrituras en Firebase).`, newStatus === 'falla' ? 'fail' : 'cloud');
  }
}

function toggleSimWifi(checked) {
  isOnline = checked;
  const label = document.getElementById('simWifiLabel');
  if (label) {
    setSafeDOM(label, isOnline 
      ? '<span class="badge bg-success-subtle text-success border border-success"><i class="bi bi-shield-check"></i> Sandbox Aislado</span>'
      : '<span class="badge bg-warning-subtle text-warning border border-warning"><i class="bi bi-hdd-fill"></i> Modo NVS Offline</span>');
  }
  logSerial(`[EMULADOR RED] Wi-Fi virtual ${isOnline ? 'ENLACE ACTIVO (Buffer RAM)' : 'DESCONECTADO (Buffer Flash NVS)'}`, isOnline ? 'cloud' : 'warn');
}

function renderReasonsBadges() {
  const container = document.getElementById('simReasonsBadges');
  if (!container) return;
  setSafeDOM(container, failureReasons.map(r => `
    <span class="badge bg-secondary border border-secondary border-opacity-50 px-2 py-1" style="font-size: 0.72rem;">
      ${r}
    </span>
  `).join(''));
}

function openAdminReasonsTab() {
  window.open('admin.html#failure-reasons', '_blank');
}

// =============================================================================
// CONSOLA SERIAL
// =============================================================================
function logSerial(msg, type = '') {
  const term = document.getElementById('serialTerminalLog');
  if (!term) return;

  const now = new Date();
  const timeStr = `[${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}]`;

  let cls = '';
  if (type === 'cloud') cls = 'serial-cloud';
  else if (type === 'fail') cls = 'serial-fail';
  else if (type === 'warn') cls = 'serial-warn';

  const line = document.createElement('div');
  line.className = 'serial-log-line';
  setSafeDOM(line, `<span class="serial-time">${timeStr}</span> <span class="${cls}">${msg}</span>`);
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

function clearSerialLog() {
  const term = document.getElementById('serialTerminalLog');
  if (term) term.replaceChildren();
}

// Helper canvas rect redondeado
function roundRect(ctx, x, y, width, height, radius, fill, stroke, strokeWidth = 1) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke && strokeWidth > 0) {
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// Exponer en window para eventos HTML
window.handleShortClick = handleShortClick;
window.cancelCurrentSimSelection = cancelCurrentSimSelection;
window.triggerSimulatedFault = triggerSimulatedFault;
window.resolveCurrentSimulatedFault = resolveCurrentSimulatedFault;
window.triggerFaultOnNode = triggerFaultOnNode;
window.resolveFaultOnNode = resolveFaultOnNode;
window.addNewMachineToSim = addNewMachineToSim;
window.toggleSimWifi = toggleSimWifi;
window.clearSerialLog = clearSerialLog;
window.openAdminReasonsTab = openAdminReasonsTab;

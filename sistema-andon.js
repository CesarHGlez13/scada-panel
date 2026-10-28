/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SCADA ANDON 4.0 PRO — ENTERPRISE CINEMATIC ENGINE
 * Misión Crítica Siderúrgica • Arquitectura por Cesar + Antigravity + Hermes
 * Suite: Scrollytelling 60FPS Lerp, Web Audio API Sintético, Háptica Móvil,
 * Tipografía Cinética, Universal Word Scrubbing, Simulador Andon y Calculadora ROI
 * ═══════════════════════════════════════════════════════════════════════════
 */

// 🛡️ HELPER DE SEGURIDAD DOM SEGURO (Elimina DOM XSS)
if (!window.setSafeDOM) window.setSafeDOM = function setSafeDOM(element, htmlString) {
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

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR ACÚSTICO INDUSTRIAL SINTÉTICO (Web Audio API puro, 0 KB de red)
// ═══════════════════════════════════════════════════════════════════════════
const IndustrialAudio = (function () {
  let audioCtx = null;
  let isEnabled = localStorage.getItem('scada_audio_enabled') !== 'false';

  function getContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  return {
    toggle() {
      isEnabled = !isEnabled;
      localStorage.setItem('scada_audio_enabled', isEnabled);
      if (isEnabled) {
        this.playRelayClick();
      }
      return isEnabled;
    },
    isEnabled() {
      return isEnabled;
    },
    // 1. Clic Mecánico de Relé Industrial / Pulsador Arcade (Impulso cuadrado amortiguado)
    playRelayClick() {
      if (!isEnabled) return;
      try {
        const ctx = getContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(35, now + 0.04);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);
        filter.frequency.linearRampToValueAtTime(100, now + 0.04);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.05);
      } catch (e) {}
    },
    // 2. Chirp Piezoeléctrico de Alarma Andon Crítica (Tono dual pulsante de advertencia)
    playAlarmChirp() {
      if (!isEnabled) return;
      try {
        const ctx = getContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sawtooth';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);
        osc1.frequency.linearRampToValueAtTime(1760, now + 0.12);
        osc2.frequency.setValueAtTime(440, now);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.23);
        osc2.stop(now + 0.23);
      } catch (e) {}
    },
    // 3. Chime Armónico de Resolución de Falla (Tríada mayor ascendente: C5 - E5 - G5)
    playSuccessChime() {
      if (!isEnabled) return;
      try {
        const ctx = getContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        const freqs = [523.25, 659.25, 783.99]; // Do5, Mi5, Sol5
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteStart = now + idx * 0.07;

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, noteStart);

          gain.gain.setValueAtTime(0, noteStart);
          gain.gain.linearRampToValueAtTime(0.14, noteStart + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.45);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(noteStart);
          osc.stop(noteStart + 0.46);
        });
      } catch (e) {}
    },
    // 4. Keynote Chime sutil al navegar fases de Scrollytelling
    playKeynoteChime(idx) {
      if (!isEnabled) return;
      try {
        const ctx = getContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        const baseNotes = [440.00, 493.88, 554.37, 659.25, 739.99, 880.00];
        const freq = baseNotes[idx % baseNotes.length] || 554.37;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.25);
      } catch (e) {}
    }
  };
})();

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DE RETROALIMENTACIÓN HÁPTICA MÓVIL
// ═══════════════════════════════════════════════════════════════════════════
const HapticEngine = {
  vibrateAlert() {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([70, 50, 110]); } catch (e) {}
    }
  },
  vibrateAck() {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([35, 25, 35]); } catch (e) {}
    }
  },
  vibrateSuccess() {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([45, 35, 70]); } catch (e) {}
    }
  },
  vibrateClick() {
    if ('vibrate' in navigator) {
      try { navigator.vibrate(15); } catch (e) {}
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN GLOBAL AL CARGAR EL DOM
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initReadingProgress();
  initKineticHeadlines();
  initUniversalWordScrubbing();
  initRevealAnimations();
  initScrollytellingTrack();
  initAndonSimulator();
  initRoiCalculator();
  initMobileDock();
  setupAudioToggle();
});

// ─── 1. BARRA DE LECTURA APPLE STYLE (Gradiente 3px Superior) ───
function initReadingProgress() {
  const bar = document.getElementById('appleReadingBar');
  if (!bar) return;

  let ticking = false;
  function updateBar() {
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? Math.min(1, Math.max(0, window.scrollY / docHeight)) : 0;
    bar.style.transform = `scaleX(${progress})`;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateBar);
    }
  }, { passive: true });
  updateBar();
}

// ─── 2. TIPOGRAFÍA CINÉTICA APPLE CON MÁSCARAS 3D ───
function initKineticHeadlines() {
  const titles = document.querySelectorAll('.hero-title, .section-title, .callout-heading');
  if (!titles.length) return;

  titles.forEach(title => {
    if (title.classList.contains('kinetic-ready')) return;
    title.classList.add('kinetic-ready');

    const rawText = title.innerText.trim();
    if (!rawText) return;
    const words = rawText.split(/\s+/);

    setSafeDOM(title, words.map((w, i) => {
      const delay = Math.min(i * 35, 450);
      return `<span class="apple-word-wrap"><span class="apple-word" style="--word-delay: ${delay}ms;">${w}</span></span>`;
    }).join(' '));
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('kinetic-revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -20px 0px' });

  document.querySelectorAll('.kinetic-ready').forEach(el => observer.observe(el));

  // Revelado inmediato de titulares visibles en el hero
  setTimeout(() => {
    document.querySelectorAll('.hero-title, .section-title').forEach(el => el.classList.add('kinetic-revealed'));
  }, 100);
}

// ─── 3. UNIVERSAL WORD-BY-WORD SCRUBBING (Iluminación al Scroll) ───
function initUniversalWordScrubbing() {
  const containers = document.querySelectorAll('.hero-subtitle, .apple-scrub-text, .bento-desc, .callout-body');
  if (!containers.length) return;

  const wordSpans = [];

  containers.forEach(container => {
    if (container.classList.contains('scrub-ready')) return;
    container.classList.add('scrub-ready');

    const rawText = container.innerText.trim();
    if (!rawText) return;
    const words = rawText.split(/\s+/);
    setSafeDOM(container, words.map(w => `<span class="scrub-word">${w}</span>`).join(' '));
    container.querySelectorAll('.scrub-word').forEach(s => wordSpans.push(s));
  });

  let ticking = false;
  function updateScrub() {
    const vh = window.innerHeight;
    const triggerY = vh * 0.72;

    wordSpans.forEach(span => {
      const rect = span.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > vh) return;

      const p = Math.min(1, Math.max(0, (vh - rect.top) / (vh - triggerY)));
      const opacity = 0.24 + 0.76 * p;
      span.style.opacity = opacity.toFixed(2);
      if (p >= 0.92) {
        span.classList.add('illuminated');
      } else {
        span.classList.remove('illuminated');
      }
    });
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateScrub);
    }
  }, { passive: true });
  updateScrub();
}

// ─── 4. REVELADO SUAVE DE COMPONENTES [data-reveal] ───
function initRevealAnimations() {
  const revealEls = document.querySelectorAll('[data-reveal]');
  if (!revealEls.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  revealEls.forEach(el => observer.observe(el));
}

// ─── 5. MASTER SCROLLYTELLING TRACK (6 FASES CONTINUAS A 60 FPS) ───
function initScrollytellingTrack() {
  const track = document.getElementById('scrollyStage');
  if (!track) return;

  const visualItems = document.querySelectorAll('.visual-phase-item');
  const callouts = document.querySelectorAll('.scrolly-callout');
  const phaseTag = document.getElementById('stagePhaseTag');
  const phaseSubtext = document.getElementById('stagePhaseSubtext');
  const windowTitle = document.getElementById('windowTitleText');
  const btnPrev = document.getElementById('btnScrollyPrev');
  const btnNext = document.getElementById('btnScrollyNext');
  const btnAutoplay = document.getElementById('btnScrollyAutoplay');

  const phaseMetadata = [
    {
      tag: 'FASE 1 DE 6',
      subtext: 'Hardware Primario • Centro de Mando GC9A01',
      title: '<i class="bi bi-cpu text-info"></i> Centro de Mando Circular • ESP32 GC9A01'
    },
    {
      tag: 'FASE 2 DE 6',
      subtext: 'Hardware Satélite • ESP32-C3 + WS2815 12V',
      title: '<i class="bi bi-broadcast text-warning"></i> Nodo Satélite C3 • WS2815 + OLED'
    },
    {
      tag: 'FASE 3 DE 6',
      subtext: 'Notificación 24/7 • WhatsApp Bot SCADA Pro',
      title: '<i class="bi bi-whatsapp text-success"></i> WhatsApp Bot SCADA • Escalamiento Nube'
    },
    {
      tag: 'FASE 4 DE 6',
      subtext: 'Gemelo Digital 2.5D • Pistas de Rodadura ISA-101',
      title: '<i class="bi bi-diagram-3-fill text-info"></i> Gemelo Digital ISA-101 • Áreas 10 y 20'
    },
    {
      tag: 'FASE 5 DE 6',
      subtext: 'Almacén Industrial • Deducción Atómica de Refacciones',
      title: '<i class="bi bi-box-seam text-primary"></i> inventory.html • Transacciones Firestore'
    },
    {
      tag: 'FASE 6 DE 6',
      subtext: 'Auditoría SCADA • 3 Tiempos Andon & Retorno de Inversión',
      title: '<i class="bi bi-clock-history text-danger"></i> Auditoría 3 Tiempos Andon & MTTR'
    }
  ];

  const phaseCenters = [0.08, 0.25, 0.42, 0.58, 0.75, 0.92];
  let currentProgress = 0;
  let targetProgress = 0;
  let activePhase = -1;
  let autoplayInterval = null;

  function onScroll() {
    const trackRect = track.getBoundingClientRect();
    const scrollableDistance = track.offsetHeight - window.innerHeight;
    if (scrollableDistance <= 0) return;

    const scrolled = -trackRect.top;
    const p = Math.min(1, Math.max(0, scrolled / scrollableDistance));
    targetProgress = p;
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Bucle de renderizado continuo a 60 FPS con LERP
  function tick() {
    currentProgress += (targetProgress - currentProgress) * 0.14;

    let nearestPhase = 0;
    let minDistance = 999;
    phaseCenters.forEach((center, idx) => {
      const dist = Math.abs(currentProgress - center);
      if (dist < minDistance) {
        minDistance = dist;
        nearestPhase = idx;
      }
    });

    if (nearestPhase !== activePhase) {
      activePhase = nearestPhase;
      setPhase(activePhase);
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function setPhase(idx) {
    visualItems.forEach((item, i) => {
      if (i === idx) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    callouts.forEach((callout, i) => {
      if (i === idx) {
        callout.classList.add('active-callout');
        callout.style.display = 'block';
        callout.querySelectorAll('.callout-heading').forEach(h => h.classList.add('kinetic-revealed'));
      } else {
        callout.classList.remove('active-callout');
        callout.style.display = 'none';
      }
    });

    if (phaseMetadata[idx]) {
      if (phaseTag) phaseTag.textContent = phaseMetadata[idx].tag;
      if (phaseSubtext) phaseSubtext.textContent = phaseMetadata[idx].subtext;
      if (windowTitle) setSafeDOM(windowTitle, phaseMetadata[idx].title);
    }

    IndustrialAudio.playKeynoteChime(idx);
    HapticEngine.vibrateClick();
  }

  function scrollToPhase(idx) {
    const targetP = phaseCenters[idx] || 0;
    const scrollableDistance = track.offsetHeight - window.innerHeight;
    const trackTop = track.offsetTop;
    window.scrollTo({
      top: trackTop + targetP * scrollableDistance,
      behavior: 'smooth'
    });
  }

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      const prev = Math.max(0, activePhase - 1);
      scrollToPhase(prev);
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      const next = Math.min(phaseCenters.length - 1, activePhase + 1);
      scrollToPhase(next);
    });
  }

  if (btnAutoplay) {
    btnAutoplay.addEventListener('click', () => {
      if (autoplayInterval) {
        clearInterval(autoplayInterval);
        autoplayInterval = null;
        btnAutoplay.classList.remove('btn-info');
        btnAutoplay.classList.add('btn-outline-info');
        setSafeDOM(btnAutoplay, '<i class="bi bi-play-fill me-1"></i><span>Presentación</span>');
      } else {
        btnAutoplay.classList.remove('btn-outline-info');
        btnAutoplay.classList.add('btn-info');
        setSafeDOM(btnAutoplay, '<i class="bi bi-pause-fill me-1"></i><span>Pausar</span>');
        let current = activePhase;
        autoplayInterval = setInterval(() => {
          current = (current + 1) % phaseCenters.length;
          scrollToPhase(current);
        }, 5000);
      }
    });
  }

  window.goToScrollyPhase = scrollToPhase;
}

// ─── 6. SIMULADOR ANDON INTERACTIVO MULTI-NODO ───
let simState = 'operational';
let simStartMs = 0;
let simTimerInterval = null;

function initAndonSimulator() {
  const btnFail = document.getElementById('btn-sim-fail');
  const btnTake = document.getElementById('btn-sim-take');
  const btnResolve = document.getElementById('btn-sim-resolve');
  const btnReset = document.getElementById('btn-sim-reset');

  if (btnFail) btnFail.addEventListener('click', simTriggerFail);
  if (btnTake) btnTake.addEventListener('click', simTakeFailure);
  if (btnResolve) btnResolve.addEventListener('click', simResolveFailure);
  if (btnReset) btnReset.addEventListener('click', simReset);

  // Botones de acción dentro del Mockup de WhatsApp
  const waBtnTake = document.getElementById('wa-btn-take');
  const waBtnResolve = document.getElementById('wa-btn-resolve');
  if (waBtnTake) waBtnTake.addEventListener('click', simTakeFailure);
  if (waBtnResolve) waBtnResolve.addEventListener('click', simResolveFailure);
}

function appendSimLog(msg) {
  const consoleEl = document.getElementById('sim-console');
  if (!consoleEl) return;
  const time = new Date().toLocaleTimeString('es-MX', { hour12: false });
  const entry = document.createElement('div');
  entry.textContent = `[${time}] ${msg}`;
  consoleEl.appendChild(entry);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function simTriggerFail() {
  if (simState !== 'operational') return;
  simState = 'failed';
  simStartMs = Date.now();

  IndustrialAudio.playAlarmChirp();
  HapticEngine.vibrateAlert();

  // Actualizar nodo visual en tablero
  const node = document.getElementById('node-30A');
  const badge = document.getElementById('badge-status-30A');
  const info = document.getElementById('info-30A');
  if (node) {
    node.className = 'station-node state-failed failure-glow';
  }
  if (badge) {
    badge.className = 'badge bg-danger pulse-badge font-mono';
    badge.textContent = 'FALLA ACTIVA';
  }
  if (info) {
    info.className = 'small text-danger fw-bold mb-2';
    info.textContent = '🚨 Paro reportado por operador (Falla en leva)';
  }

  // Actualizar Pista de Rodadura Digital Twin
  const craneNode = document.getElementById('map-crane-30A-sim');
  const bayBadge = document.getElementById('bay-badge-30-sim');
  if (craneNode) craneNode.className = 'scada-runway-crane-node failure';
  if (bayBadge) {
    bayBadge.className = 'bay-status-badge font-mono text-danger';
    bayBadge.textContent = '🔴 PARO CRÍTICO';
  }

  // Actualizar Botones de Control
  document.getElementById('btn-sim-fail').disabled = true;
  document.getElementById('btn-sim-take').disabled = false;
  document.getElementById('btn-sim-resolve').disabled = false;

  // Actualizar Mockup de WhatsApp
  const waAlertBubble = document.getElementById('wa-live-alert');
  const waAckBubble = document.getElementById('wa-live-ack');
  if (waAlertBubble) waAlertBubble.style.display = 'block';
  if (waAckBubble) waAckBubble.style.display = 'none';

  appendSimLog('🚨 Pulsador Físico accionado en Grúa 30A. Evento emitido al bus ESP-NOW.');
  appendSimLog('📲 Webhook Cloud Functions despachado a WhatsApp en 1.4s.');

  if (simTimerInterval) clearInterval(simTimerInterval);
  simTimerInterval = setInterval(updateSimTimer, 1000);
  updateSimTimer();
}

function simTakeFailure() {
  if (simState !== 'failed') return;
  simState = 'maintenance';

  IndustrialAudio.playRelayClick();
  HapticEngine.vibrateAck();

  const node = document.getElementById('node-30A');
  const badge = document.getElementById('badge-status-30A');
  const info = document.getElementById('info-30A');
  if (node) {
    node.className = 'station-node state-maintenance';
  }
  if (badge) {
    badge.className = 'badge bg-warning text-dark font-mono';
    badge.textContent = 'EN ATENCIÓN';
  }
  if (info) {
    info.className = 'small text-warning fw-bold mb-2';
    info.textContent = '🔧 Técnico en camino • Acuse confirmado';
  }

  const craneNode = document.getElementById('map-crane-30A-sim');
  const bayBadge = document.getElementById('bay-badge-30-sim');
  if (craneNode) craneNode.className = 'scada-runway-crane-node maintenance';
  if (bayBadge) {
    bayBadge.className = 'bay-status-badge font-mono text-warning';
    bayBadge.textContent = '🟡 EN ATENCIÓN';
  }

  document.getElementById('btn-sim-take').disabled = true;
  document.getElementById('btn-sim-resolve').disabled = false;

  // Actualizar WhatsApp Mockup con confirmación
  const waAckBubble = document.getElementById('wa-live-ack');
  if (waAckBubble) {
    waAckBubble.style.display = 'block';
    const nowStr = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    const timeEl = waAckBubble.querySelector('.wa-time-stamp span');
    if (timeEl) timeEl.textContent = nowStr;
  }

  appendSimLog('✅ Técnico tomó la falla desde el celular. T1 (Reacción) cerrado.');
  appendSimLog('📦 Verificación de stock de Levas en almacén: 997 disponibles.');
  updateSimTimer();
}

function simResolveFailure() {
  if (simState === 'operational') return;
  simState = 'operational';

  if (simTimerInterval) {
    clearInterval(simTimerInterval);
    simTimerInterval = null;
  }

  IndustrialAudio.playSuccessChime();
  HapticEngine.vibrateSuccess();

  const node = document.getElementById('node-30A');
  const badge = document.getElementById('badge-status-30A');
  const info = document.getElementById('info-30A');
  const timer = document.getElementById('timer-30A');
  const oled = document.getElementById('oled-30A');

  if (node) node.className = 'station-node state-operational';
  if (badge) {
    badge.className = 'badge bg-success font-mono';
    badge.textContent = 'OPERATIVA';
  }
  if (info) {
    info.className = 'small text-secondary mb-2';
    info.textContent = 'Operación normal en nave';
  }
  if (timer) {
    timer.className = 'font-mono fs-4 fw-bold mb-1 text-success';
    timer.textContent = '00:00';
  }
  if (oled) oled.textContent = 'OLED: GRUA 30A • NORMAL';

  const craneNode = document.getElementById('map-crane-30A-sim');
  const bayBadge = document.getElementById('bay-badge-30-sim');
  if (craneNode) craneNode.className = 'scada-runway-crane-node operational';
  if (bayBadge) {
    bayBadge.className = 'bay-status-badge font-mono text-success';
    bayBadge.textContent = '🟢 NORMAL';
  }

  // Restablecer LEDs a verde sólido
  const strip = document.getElementById('strip-30A');
  if (strip) {
    strip.replaceChildren();
    for (let i = 0; i < 12; i++) {
      const led = document.createElement('div');
      led.className = 'ws2815-led lit-green';
      strip.appendChild(led);
    }
  }

  document.getElementById('btn-sim-fail').disabled = false;
  document.getElementById('btn-sim-take').disabled = true;
  document.getElementById('btn-sim-resolve').disabled = true;

  appendSimLog('🎉 Falla resuelta. Línea liberada. Registro asentado en tablaFallas (11 cols).');
  appendSimLog('📊 Transacción Firestore cerrada: MTTR calculado con éxito.');
}

function simReset() {
  simResolveFailure();
  const consoleEl = document.getElementById('sim-console');
  if (consoleEl) {
    consoleEl.textContent = '[00:00.000] Sistema SCADA Andon 4.0 reinicializado. Red industrial estable.';
  }
}

function updateSimTimer() {
  if (simState === 'operational') return;
  const elapsedSec = Math.floor((Date.now() - simStartMs) / 1000);
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const timer = document.getElementById('timer-30A');
  if (timer) timer.textContent = timeStr;

  const strip = document.getElementById('strip-30A');
  if (strip) {
    strip.replaceChildren();

    if (simState === 'failed') {
      if (timer) timer.className = 'font-mono fs-4 fw-bold mb-1 text-danger';
      // Llenado acelerado para la experiencia interactiva (12 leds en 15s)
      const litCount = Math.max(1, Math.min(12, Math.round((elapsedSec / 15) * 12)));
      for (let i = 0; i < 12; i++) {
        const led = document.createElement('div');
        led.className = i < litCount ? 'ws2815-led lit-red' : 'ws2815-led';
        strip.appendChild(led);
      }
      const oled = document.getElementById('oled-30A');
      if (oled) oled.textContent = `OLED: ! ALERTA ANDON ! ${timeStr}`;
    } else if (simState === 'maintenance') {
      if (timer) timer.className = 'font-mono fs-4 fw-bold mb-1 text-warning';
      const cursorIdx = Math.floor(Date.now() / 180) % 12;
      for (let i = 0; i < 12; i++) {
        const led = document.createElement('div');
        led.className = (i === cursorIdx) ? 'ws2815-led lit-cyan' : 'ws2815-led lit-amber';
        strip.appendChild(led);
      }
      const oled = document.getElementById('oled-30A');
      if (oled) oled.textContent = `OLED: ! EN ATENCION ! ${timeStr}`;
    }
  }
}

// ─── 7. CALCULADORA DE TIEMPO Y ROI INDUSTRIAL CON HÁPTICA ───
function initRoiCalculator() {
  const sliders = ['calc-calls', 'calc-wait', 'calc-cost', 'calc-shifts'];
  sliders.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        runCalculator();
        HapticEngine.vibrateClick();
      });
    }
  });
  runCalculator();
}

function runCalculator() {
  const callsEl = document.getElementById('calc-calls');
  const waitEl = document.getElementById('calc-wait');
  const costEl = document.getElementById('calc-cost');
  const shiftsEl = document.getElementById('calc-shifts');

  if (!callsEl || !waitEl || !costEl || !shiftsEl) return;

  const calls = parseInt(callsEl.value, 10);
  const wait = parseInt(waitEl.value, 10);
  const cost = parseInt(costEl.value, 10);
  const shifts = parseInt(shiftsEl.value, 10);

  document.getElementById('calc-calls-val').textContent = `${calls} paros`;
  document.getElementById('calc-wait-val').textContent = `${wait} min`;
  document.getElementById('calc-cost-val').textContent = `$${cost.toLocaleString()} USD / h`;
  document.getElementById('calc-shifts-val').textContent = `${shifts} turnos (${shifts * 8}h)`;

  const DAYS_PER_YEAR = 260; // 5 días x 52 semanas laborales
  const totalHoursYear = Math.round((calls * wait * shifts * DAYS_PER_YEAR) / 60);
  const totalMoneyYear = Math.round(totalHoursYear * cost);

  const savedHours = Math.round(totalHoursYear * 0.52);
  const savedMoney = Math.round(totalMoneyYear * 0.52);

  document.getElementById('calc-total-hours').textContent = totalHoursYear.toLocaleString();
  document.getElementById('calc-total-money').textContent = `$${totalMoneyYear.toLocaleString()} USD`;

  const savingsText = document.getElementById('calc-savings-text');
  if (savingsText) {
    savingsText.innerHTML =
      `Reduciendo el tiempo de respuesta a la mitad con SCADA Andon 4.0, su planta recupera <strong>${savedHours.toLocaleString()} horas de producción</strong> equivalentes a <strong>$${savedMoney.toLocaleString()} USD netos al año</strong>.`;
  }
}

// ─── 8. DOCK DE NAVEGACIÓN MÓVIL REACTIVO ───
function initMobileDock() {
  const dockLinks = document.querySelectorAll('.mobile-quick-dock .dock-btn');
  if (!dockLinks.length) return;

  const sections = ['hero', 'scrollyStage', 'demo-interactiva', 'hardware-sec', 'calculadora-roi'];

  window.addEventListener('scroll', () => {
    const scrollPos = window.scrollY + 200;
    sections.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const top = el.offsetTop;
        const height = el.offsetHeight;
        if (scrollPos >= top && scrollPos < top + height) {
          dockLinks.forEach(link => {
            if (link.getAttribute('href') === `#${id}`) {
              link.classList.add('active');
            } else {
              link.classList.remove('active');
            }
          });
        }
      }
    });
  }, { passive: true });
}

// ─── 9. CONTROLADOR DE AUDIO SINTÉTICO (SWITCH ON/OFF) ───
function setupAudioToggle() {
  const btnScrollyAudio = document.getElementById('btnScrollyAudio');
  if (!btnScrollyAudio) return;

  function updateAudioButton(enabled) {
    const icon = document.getElementById('audioBtnIcon');
    if (icon) {
      if (enabled) {
        icon.className = 'bi bi-volume-up-fill text-info';
      } else {
        icon.className = 'bi bi-volume-mute-fill text-muted';
      }
    }
  }

  btnScrollyAudio.addEventListener('click', () => {
    const isNowOn = IndustrialAudio.toggle();
    updateAudioButton(isNowOn);
    HapticEngine.vibrateClick();
  });

  updateAudioButton(IndustrialAudio.isEnabled());
}

// Exportar globalmente para eventos en HTML inline
window.simTriggerFail = simTriggerFail;
window.simTakeFailure = simTakeFailure;
window.simResolveFailure = simResolveFailure;
window.simReset = simReset;
window.runCalculator = runCalculator;

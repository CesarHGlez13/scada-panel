/**
 * ============================================================================
 * SISTEMA ANDON 4.0 — MOTOR CINEMÁTICO INTERACTIVO KEYNOTE
 * Scrollytelling a 60FPS, Tipografía Cinética, Web Audio Synthesizer,
 * Laboratorio Háptico de Hardware y Calculadora de ROI en Tiempo Real.
 * Desarrollado para Cesar • Operations Monitor SCADA PRO
 * ============================================================================
 */

(function () {
  'use strict';

  // 🛡️ Helper DOM Seguro
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
    element.replaceChildren(fragment);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initReadingProgress();
    initKineticHeadlines();
    initUniversalWordScrubbing();
    initRevealAnimations();
    initScrollytellingTrack();
    initSandboxLab();
    initLiveTimers();
    if (typeof updateRoiCalc === 'function') updateRoiCalc();
  });

  // ─── 1. BARRA DE LECTURA SUPERIOR APPLE PRO (2.5PX) ───
  function initReadingProgress() {
    const bar = document.getElementById('appleReadingBar');
    if (!bar) return;

    window.addEventListener('scroll', () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const p = h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
      bar.style.transform = `scaleX(${p})`;
    }, { passive: true });
  }

  // ─── 2. TIPOGRAFÍA CINÉTICA APPLE (WORD LIFT & MASK) ───
  function initKineticHeadlines() {
    const titles = document.querySelectorAll('.guia-hero-title, .section-title');
    if (!titles.length) return;

    titles.forEach(title => {
      const rawText = title.textContent.trim().replace(/\s+/g, ' ');
      const words = rawText.split(' ');
      title.replaceChildren();

      words.forEach((w, i) => {
        const wrap = document.createElement('span');
        wrap.className = 'apple-word-wrap';
        const span = document.createElement('span');
        span.className = 'apple-word';
        span.textContent = w;
        span.style.setProperty('--word-delay', `${i * 35}ms`);
        wrap.appendChild(span);
        title.appendChild(wrap);
      });

      requestAnimationFrame(() => title.classList.add('kinetic-revealed'));
    });
  }

  // ─── 3. SCRUBBING UNIVERSAL DE TEXTO (APPLE AIRPODS PRO GLOW) ───
  function initUniversalWordScrubbing() {
    const targets = document.querySelectorAll('.apple-scrub-text');
    if (!targets.length) return;

    targets.forEach(el => {
      const text = el.textContent.trim().replace(/\s+/g, ' ');
      if (!text) return;
      const words = text.split(' ');
      el.replaceChildren();

      words.forEach(w => {
        const s = document.createElement('span');
        s.className = 'scrub-word';
        s.textContent = w + ' ';
        el.appendChild(s);
      });
    });

    const scrubObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const spans = entry.target.querySelectorAll('.scrub-word');
          spans.forEach((s, idx) => {
            setTimeout(() => s.classList.add('illuminated'), idx * 22);
          });
          scrubObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    targets.forEach(t => scrubObserver.observe(t));
  }

  // ─── 4. REVEAL ANIMATIONS (INTERSECTION OBSERVER) ───
  function initRevealAnimations() {
    const revealEls = document.querySelectorAll('[data-reveal]');
    if (!revealEls.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    revealEls.forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      el.style.transition = 'all 0.65s cubic-bezier(0.16, 1, 0.3, 1)';
      observer.observe(el);
    });
  }

  // ─── 5. SINTETIZADOR WEB AUDIO PARA EFECTOS KEYNOTE ───
  let audioContext = null;
  let audioEnabled = true;

  function playKeynoteChime(idx) {
    if (!audioEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContext) audioContext = new AudioCtx();
      if (audioContext.state === 'suspended') audioContext.resume();

      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const baseFreqs = [523.25, 587.33, 659.25, 783.99, 880.00, 987.77, 1046.50];
      const freq = baseFreqs[idx % baseFreqs.length] || 659.25;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioContext.currentTime);

      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(audioContext.destination);

      osc.start();
      osc.stop(audioContext.currentTime + 0.36);
    } catch (e) {}
  }
  window.playKeynoteChime = playKeynoteChime;

  // ─── 6. MASTER SCROLLYTELLING TRACK (5 FASES ANDON CONTINUOUS LERP) ───
  let triggerHeroKeynoteFn = null;

  function initScrollytellingTrack() {
    const track = document.getElementById('scrollyStage');
    if (!track) return;

    const visualItems = document.querySelectorAll('.visual-phase-item');
    const callouts = document.querySelectorAll('.scrolly-callout');
    const phaseTag = document.getElementById('stagePhaseTag');
    const phaseSubtext = document.getElementById('stagePhaseSubtext');
    const windowTitle = document.getElementById('windowTitleText');

    const phaseMetadata = [
      {
        tag: 'FASE 1 DE 7',
        subtext: 'Hardware en Cabina • Gabinetes 3D GC9A01 & C3',
        title: '<i class="bi bi-cpu text-info"></i> Hardware en Cabina • Gabinetes CAD y Pulsador'
      },
      {
        tag: 'FASE 2 DE 7',
        subtext: 'Visibilidad a 50 Metros • Tiras LED WS2815 y Estrobos',
        title: '<i class="bi bi-brightness-high text-warning"></i> Barra de Tiempo LED WS2815 • Nave Industrial'
      },
      {
        tag: 'FASE 3 DE 7',
        subtext: 'Pizarrón SCADA ISA-101 • Bahías Operativas',
        title: '<i class="bi bi-speedometer2 text-success"></i> Pizarrón Reactivo ISA-101 • Grúas Reales'
      },
      {
        tag: 'FASE 4 DE 7',
        subtext: 'WhatsApp Bot 24/7 • Despacho Inmediato y Escalamiento',
        title: '<i class="bi bi-whatsapp text-success"></i> WhatsApp Bot Autónomo • Oracle Cloud'
      },
      {
        tag: 'FASE 5 DE 7',
        subtext: 'Almacén de Refacciones • Deducción Atómica en Paro',
        title: '<i class="bi bi-box-seam text-primary"></i> Control de Stock y Kardex • warehouse.html'
      },
      {
        tag: 'FASE 6 DE 7',
        subtext: 'Matriz de Turnos • Jornadas A, B, C, D (12 Horas)',
        title: '<i class="bi bi-people text-info"></i> Coordinación Operativa • Turnos Rotativos UTC-6'
      },
      {
        tag: 'FASE 7 DE 7',
        subtext: 'Auditoría SCADA • 11 Columnas y Andon TV 4K TTS',
        title: '<i class="bi bi-clock-history text-danger"></i> Tiempos Andon, MTTR y Síntesis de Voz 4K'
      }
    ];

    const phaseCenters = [0.07, 0.21, 0.35, 0.49, 0.63, 0.77, 0.92];
    const boundaries = [
      { solidStart: 0.00, solidEnd: 0.11, transEnd: 0.14 }, // Fase 0: Hardware 3D
      { solidStart: 0.14, solidEnd: 0.25, transEnd: 0.28 }, // Fase 1: Barra LED WS2815
      { solidStart: 0.28, solidEnd: 0.39, transEnd: 0.42 }, // Fase 2: Pizarrón SCADA ISA-101
      { solidStart: 0.42, solidEnd: 0.53, transEnd: 0.56 }, // Fase 3: WhatsApp Bot 24/7
      { solidStart: 0.56, solidEnd: 0.67, transEnd: 0.70 }, // Fase 4: Almacén y Refacciones
      { solidStart: 0.70, solidEnd: 0.81, transEnd: 0.84 }, // Fase 5: Matriz de Turnos
      { solidStart: 0.84, solidEnd: 1.00, transEnd: 1.00 }  // Fase 6: Auditoría 11 Cols & TV
    ];

    let currentProgress = 0;
    let targetProgress = 0;
    let activePhase = -1;

    function onScroll() {
      const rect = track.getBoundingClientRect();
      const trackHeight = track.offsetHeight;
      const windowHeight = window.innerHeight;
      const scrollableDistance = trackHeight - windowHeight;

      if (scrollableDistance <= 0) return;
      const rawProgress = -rect.top / scrollableDistance;
      targetProgress = Math.min(1, Math.max(0, rawProgress));
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    // Bucle continuo a 60FPS con interpolación lineal (Lerp)
    function renderLoop() {
      const diff = targetProgress - currentProgress;
      if (Math.abs(diff) > 0.0005) {
        currentProgress += diff * 0.12; // Suavizado continuo
        applyProgress(currentProgress);
      }
      requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);

    function applyProgress(p) {
      let domIdx = 0;
      for (let i = 0; i < boundaries.length; i++) {
        if (p <= boundaries[i].transEnd || i === boundaries.length - 1) {
          domIdx = i;
          break;
        }
      }

      if (domIdx !== activePhase) {
        activePhase = domIdx;
        const meta = phaseMetadata[activePhase];
        if (meta) {
          if (phaseTag) phaseTag.textContent = meta.tag;
          if (phaseSubtext) phaseSubtext.textContent = meta.subtext;
          if (windowTitle) setSafeDOM(windowTitle, meta.title);
        }
        playKeynoteChime(activePhase);
      }

      const b = boundaries[domIdx];
      let transT = 0;
      let transitioning = false;

      if (p > b.solidEnd && domIdx < boundaries.length - 1) {
        transitioning = true;
        transT = (p - b.solidEnd) / (b.transEnd - b.solidEnd);
        transT = Math.max(0, Math.min(1, transT));
      }

      callouts.forEach((callout, idx) => {
        const visual = visualItems[idx];

        if (!transitioning) {
          if (idx === domIdx) {
            callout.style.opacity = '1';
            callout.style.transform = 'translate3d(0, 0, 0)';
            callout.classList.add('active');
            if (visual) {
              visual.style.display = 'flex';
              visual.style.opacity = '1';
              visual.classList.add('active');
            }
          } else {
            callout.style.opacity = '0';
            callout.style.transform = idx < domIdx ? 'translate3d(0, -20px, 0)' : 'translate3d(0, 20px, 0)';
            callout.classList.remove('active');
            if (visual) {
              visual.style.display = 'none';
              visual.style.opacity = '0';
              visual.classList.remove('active');
            }
          }
        } else {
          const nextIdx = domIdx + 1;
          const eased = Math.sin((transT * Math.PI) / 2);

          if (idx === domIdx) {
            const op = Math.max(0, 1 - eased);
            callout.style.opacity = op.toFixed(3);
            callout.style.transform = `translate3d(0, ${(-eased * 20).toFixed(1)}px, 0)`;
            if (visual) {
              visual.style.display = op > 0.05 ? 'flex' : 'none';
              visual.style.opacity = op.toFixed(3);
            }
          } else if (idx === nextIdx) {
            const op = Math.max(0, eased);
            callout.style.opacity = op.toFixed(3);
            callout.style.transform = `translate3d(0, ${((1 - eased) * 20).toFixed(1)}px, 0)`;
            if (visual) {
              visual.style.display = op > 0.05 ? 'flex' : 'none';
              visual.style.opacity = op.toFixed(3);
            }
          } else {
            callout.style.opacity = '0';
            if (visual) {
              visual.style.display = 'none';
              visual.style.opacity = '0';
            }
          }
        }
      });
    }

    function scrollToPhase(idx) {
      if (idx < 0 || idx >= phaseCenters.length) return;
      const scrollableDistance = track.offsetHeight - window.innerHeight;
      const targetY = track.offsetTop + phaseCenters[idx] * scrollableDistance;
      window.scrollTo({ top: targetY, behavior: 'smooth' });
      playKeynoteChime(idx);
    }

    // Botones Prev / Next
    const prevBtn = document.getElementById('btnScrollyPrev');
    const nextBtn = document.getElementById('btnScrollyNext');
    if (prevBtn) prevBtn.onclick = () => scrollToPhase(Math.max(0, activePhase - 1));
    if (nextBtn) nextBtn.onclick = () => scrollToPhase(Math.min(boundaries.length - 1, activePhase + 1));

    // Botón Audio
    const audioBtn = document.getElementById('btnScrollyAudio');
    if (audioBtn) {
      audioBtn.onclick = () => {
        audioEnabled = !audioEnabled;
        const icon = document.getElementById('audioBtnIcon');
        if (icon) icon.className = audioEnabled ? 'bi bi-volume-up-fill text-info' : 'bi bi-volume-mute-fill text-muted';
      };
    }

    // Autoplay Keynote Presentation
    let isAutoplaying = false;
    let autoplayTimer = null;
    let autoplayStep = 0;

    function startAutoplay() {
      if (autoplayTimer) {
        clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
      isAutoplaying = true;
      const btn = document.getElementById('btnScrollyAutoplay');
      const icon = document.getElementById('autoplayBtnIcon');
      const text = document.getElementById('autoplayBtnText');
      if (btn) btn.classList.add('btn-info');
      if (icon) icon.className = 'bi bi-pause-fill me-1';
      if (text) text.textContent = 'Pausar';

      autoplayStep = activePhase >= boundaries.length - 1 ? 0 : Math.max(0, activePhase);
      scrollToPhase(autoplayStep);

      autoplayTimer = setInterval(() => {
        autoplayStep++;
        if (autoplayStep > boundaries.length - 1) {
          stopAutoplay();
          return;
        }
        scrollToPhase(autoplayStep);
      }, 5500);
    }

    function stopAutoplay() {
      isAutoplaying = false;
      if (autoplayTimer) {
        clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
      const btn = document.getElementById('btnScrollyAutoplay');
      const icon = document.getElementById('autoplayBtnIcon');
      const text = document.getElementById('autoplayBtnText');
      if (btn) btn.classList.remove('btn-info');
      if (icon) icon.className = 'bi bi-play-fill me-1';
      if (text) text.textContent = 'Presentación';
    }

    const autoplayBtn = document.getElementById('btnScrollyAutoplay');
    if (autoplayBtn) {
      autoplayBtn.onclick = () => {
        if (isAutoplaying) stopAutoplay();
        else startAutoplay();
      };
    }

    let isStartingAndonTour = false;
    triggerHeroKeynoteFn = () => {
      if (isStartingAndonTour) return;
      isStartingAndonTour = true;
      setTimeout(() => { isStartingAndonTour = false; }, 1200);
      stopAutoplay();
      startAutoplay();
    };
  }

  window.triggerHeroKeynote = function () {
    if (typeof triggerHeroKeynoteFn === 'function') triggerHeroKeynoteFn();
    else {
      const target = document.getElementById('scrollyStage');
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // ─── 7. LABORATORIO HÁPTICO DE HARDWARE (SANDBOX EN VIVO) ───
  let simState = 'operational';
  let simTimer = null;
  let simSeconds = 0;

  function initSandboxLab() {
    renderSimLeds('green');
  }

  function renderSimLeds(mode) {
    const bar = document.getElementById('simLedBar');
    if (!bar) return;
    bar.replaceChildren();

    for (let i = 0; i < 10; i++) {
      const pix = document.createElement('div');
      pix.className = `led-pixel ${mode}`;
      bar.appendChild(pix);
    }
  }

  function logSim(msg) {
    const box = document.getElementById('simConsoleLog');
    if (!box) return;
    const now = new Date().toLocaleTimeString();
    const d = document.createElement('div');
    d.innerHTML = `[${now}] ${msg}`;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  window.triggerSimParo = function () {
    if (simState === 'failed') return;
    simState = 'failed';
    simSeconds = 0;
    playKeynoteChime(3);

    const badge = document.getElementById('simGlobalBadge');
    const oledStatus = document.getElementById('simOledStatus');
    const oledSub = document.getElementById('simOledSub');
    const reason = document.getElementById('simReasonSelect').value;

    if (badge) {
      badge.className = 'badge bg-danger pulse-badge';
      badge.textContent = 'PARO ACTIVO';
    }
    if (oledStatus) {
      oledStatus.className = 'text-danger fs-4 fw-bold my-1';
      oledStatus.textContent = '! ALERTA ANDON !';
    }
    if (oledSub) oledSub.textContent = `PARO: ${reason}`;

    document.getElementById('btnSimTrigger').disabled = true;
    document.getElementById('btnSimAttend').disabled = false;
    document.getElementById('btnSimResolve').disabled = true;

    renderSimLeds('red-strobe');
    logSim(`<strong class="text-danger">🚨 ALERTA:</strong> Operador pulsa botón arcade Pin D4. Motivo: "${reason}". Notificación despachada por WhatsApp a Ing. Carlos Morales.`);

    if (simTimer) clearInterval(simTimer);
    simTimer = setInterval(() => {
      simSeconds++;
      const timerEl = document.getElementById('simOledTimer');
      if (timerEl) timerEl.textContent = formatTime(simSeconds);

      if (simSeconds === 300) {
        logSim(`<strong class="text-danger">⚠️ ESCALACIÓN:</strong> 300 segundos sin acuse. Escalamiento automático a Supervisor de Mantenimiento.`);
      }
    }, 1000);
  };

  window.triggerSimAttend = function () {
    if (simState !== 'failed') return;
    simState = 'maintenance';
    playKeynoteChime(1);

    const badge = document.getElementById('simGlobalBadge');
    const oledStatus = document.getElementById('simOledStatus');
    const oledSub = document.getElementById('simOledSub');

    if (badge) {
      badge.className = 'badge bg-warning text-dark';
      badge.textContent = 'EN ATENCIÓN';
    }
    if (oledStatus) {
      oledStatus.className = 'text-warning fs-4 fw-bold my-1';
      oledStatus.textContent = '! EN ATENCIÓN !';
    }
    if (oledSub) oledSub.textContent = 'Técnico Ing. Carlos Morales en bahía';

    document.getElementById('btnSimAttend').disabled = true;
    document.getElementById('btnSimResolve').disabled = false;

    renderSimLeds('amber');
    logSim(`<strong class="text-warning">⚡ ASISTENCIA:</strong> Técnico llega a grúa. T_reacción registrado: ${formatTime(simSeconds)}. Comienza diagnóstico y llave en mano.`);
  };

  window.triggerSimResolve = function () {
    simState = 'operational';
    if (simTimer) clearInterval(simTimer);
    playKeynoteChime(4);

    const badge = document.getElementById('simGlobalBadge');
    const oledStatus = document.getElementById('simOledStatus');
    const oledSub = document.getElementById('simOledSub');
    const timerEl = document.getElementById('simOledTimer');

    if (badge) {
      badge.className = 'badge bg-success';
      badge.textContent = 'OPERATIVA';
    }
    if (oledStatus) {
      oledStatus.className = 'text-white fs-4 fw-bold my-1';
      oledStatus.textContent = '! GRÚA 30A OPERATIVA !';
    }
    if (oledSub) oledSub.textContent = 'Falla resuelta • En producción';
    if (timerEl) timerEl.textContent = '00:00:00';

    document.getElementById('btnSimTrigger').disabled = false;
    document.getElementById('btnSimAttend').disabled = true;
    document.getElementById('btnSimResolve').disabled = true;

    renderSimLeds('green');
    logSim(`<strong class="text-success">✅ RESUELTO:</strong> Falla superada. Tiempo total de paro: ${formatTime(simSeconds)}. Registro de 11 columnas archivado en SCADA e incidencia cerrada en WhatsApp.`);
  };

  window.resetSimSandbox = function () {
    if (simTimer) clearInterval(simTimer);
    simState = 'operational';
    simSeconds = 0;

    const badge = document.getElementById('simGlobalBadge');
    const oledStatus = document.getElementById('simOledStatus');
    const oledSub = document.getElementById('simOledSub');
    const timerEl = document.getElementById('simOledTimer');

    if (badge) {
      badge.className = 'badge bg-success';
      badge.textContent = 'OPERATIVA';
    }
    if (oledStatus) {
      oledStatus.className = 'text-white fs-4 fw-bold my-1';
      oledStatus.textContent = '! GRÚA 30A OPERATIVA !';
    }
    if (oledSub) oledSub.textContent = 'Presione el botón para reportar';
    if (timerEl) timerEl.textContent = '00:00:00';

    document.getElementById('btnSimTrigger').disabled = false;
    document.getElementById('btnSimAttend').disabled = true;
    document.getElementById('btnSimResolve').disabled = true;

    renderSimLeds('green');
    logSim(`[RESET] Laboratorio de Hardware reiniciado a estado base operativo.`);
  };

  // ─── 8. CALCULADORA DINÁMICA DE ROI ANDON 4.0 ───
  window.updateRoiCalc = function () {
    const cranes = parseInt(document.getElementById('rangeCranes')?.value || 12, 10);
    const stops = parseInt(document.getElementById('rangeStops')?.value || 5, 10);
    const costPerHour = parseInt(document.getElementById('rangeCost')?.value || 2500, 10);

    const elValCranes = document.getElementById('valCranes');
    const elValStops = document.getElementById('valStops');
    const elValCost = document.getElementById('valCost');
    const elResLoss = document.getElementById('resLoss');
    const elResSavings = document.getElementById('resSavings');

    if (elValCranes) elValCranes.textContent = `${cranes} grúas`;
    if (elValStops) elValStops.textContent = `${stops} paros/día`;
    if (elValCost) elValCost.textContent = `$${costPerHour.toLocaleString()} USD/h`;

    // 250 días hábiles por año
    // Sin Andon: 15 min de demora promedio por aviso desatendido (0.25 hrs)
    // Con Andon: 5 min de reacción cronometrada (ahorro de 10 min por paro = 0.166 hrs)
    const annualStops = cranes * stops * 250;
    const hoursLostWithout = annualStops * (15 / 60);
    const annualLoss = hoursLostWithout * costPerHour;
    const hoursSaved = annualStops * (10 / 60);
    const annualSavings = hoursSaved * costPerHour;

    if (elResLoss) elResLoss.textContent = `$${Math.round(annualLoss).toLocaleString()} USD`;
    if (elResSavings) elResSavings.textContent = `$${Math.round(annualSavings).toLocaleString()} USD`;
  };

  // ─── 9. CRONÓMETROS TICKING SCROLLYTELLING ───
  function initLiveTimers() {
    let baseSec = 222;
    setInterval(() => {
      baseSec++;
      const m = Math.floor(baseSec / 60);
      const s = baseSec % 60;
      const str = `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      document.querySelectorAll('.scrolly-live-timer').forEach(el => {
        el.textContent = str;
      });
    }, 1000);
  }

})();

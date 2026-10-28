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

/**
 * ============================================================================
 * GUÍA INTERACTIVA SCROLLYTELLING APPLE AIRPODS PRO (v7.5)
 * Motor de Cinemática de Scroll, Tipografía Cinética y Componentes Reales
 * Desarrollado por Cesar + Antigravity
 * ============================================================================
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    initReadingProgress();
    initKineticHeadlines();
    initUniversalWordScrubbing();
    initRevealAnimations();
    initScrollytellingTrack();
    initSandboxLab();
    initLiveTimers();
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

  // ─── 2. APPLE KINETIC HEADLINE REVEAL ENGINE (Word Lift & Mask) ───
  function initKineticHeadlines() {
    const titles = document.querySelectorAll('.guia-hero-title, .section-title');
    if (!titles.length) return;

    titles.forEach(title => {
      if (title.classList.contains('kinetic-ready')) return;
      title.classList.add('kinetic-ready');

      const text = title.innerText.trim();
      if (!text) return;
      const words = text.split(/\s+/);
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
    }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });

    document.querySelectorAll('.kinetic-ready').forEach(el => observer.observe(el));
    // Inmediatamente revelar títulos visibles en viewport inicial
    setTimeout(() => {
      document.querySelectorAll('.guia-hero-title, .section-title').forEach(el => el.classList.add('kinetic-revealed'));
    }, 80);
  }

  // ─── 3. UNIVERSAL WORD-BY-WORD READING LIGHT (Apple Scrubbing) ───
  function initUniversalWordScrubbing() {
    const scrubSelectors = [
      '.apple-scrub-text',
      '.guia-hero-subtitle',
      '.section-subtitle',
      '.bento-desc'
    ];

    const containers = document.querySelectorAll(scrubSelectors.join(', '));
    if (!containers.length) return;

    const wordSpans = [];

    containers.forEach(container => {
      if (container.classList.contains('scrub-ready')) return;
      container.classList.add('scrub-ready');

      const text = container.innerText.trim();
      if (!text) return;
      const words = text.split(/\s+/);
      setSafeDOM(container, words.map(w => `<span class="scrub-word">${w}</span>`).join(' '));
      container.querySelectorAll('.scrub-word').forEach(span => wordSpans.push(span));
    });

    let ticking = false;
    function updateScrubbing() {
      const vh = window.innerHeight;
      const triggerY = vh * 0.72;

      wordSpans.forEach(span => {
        const rect = span.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > vh) return;

        const p = Math.min(1, Math.max(0, (vh - rect.top) / (vh - triggerY)));
        const opacity = 0.22 + 0.78 * p;
        span.style.opacity = opacity.toFixed(2);
        if (p >= 0.94) {
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
        requestAnimationFrame(updateScrubbing);
      }
    }, { passive: true });

    updateScrubbing();
  }

  // ─── 4. REVELADO SUAVE [data-reveal] ───
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
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach(el => observer.observe(el));
  }

  // ─── 5. MASTER SCROLLYTELLING TRACK (6 PHASES CONTINUOUS 60FPS ENGINE) ───
  function initScrollytellingTrack() {
    const track = document.getElementById('scrollyStage');
    if (!track) return;

    const visualItems = document.querySelectorAll('.visual-phase-item');
    const callouts = document.querySelectorAll('.scrolly-callout');
    const pills = document.querySelectorAll('.scrolly-pill-btn');
    const progressFill = document.getElementById('scrollyProgressFill');
    const phaseTag = document.getElementById('stagePhaseTag');
    const phaseSubtext = document.getElementById('stagePhaseSubtext');
    const windowTitle = document.getElementById('windowTitleText');

    const phaseMetadata = [
      {
        tag: 'FASE 1 DE 8',
        subtext: 'Pizarrón de Grúas • Área 10',
        title: '<i class="bi bi-speedometer2 text-primary"></i> cranes.html • Pizarrón Reactivo'
      },
      {
        tag: 'FASE 2 DE 8',
        subtext: 'Hardware en Nave • ESP32 + WS2815',
        title: '<i class="bi bi-cpu text-info"></i> esp32-crane-button.ino • Pulsador Piso D4'
      },
      {
        tag: 'FASE 3 DE 8',
        subtext: 'Notificación 24/7 • Servidor Cloud Dedicado',
        title: '<i class="bi bi-whatsapp text-success"></i> WhatsApp Bot SCADA • Despacho Inmediato'
      },
      {
        tag: 'FASE 4 DE 8',
        subtext: 'Auditoría SCADA • 11 Columnas y MTTR',
        title: '<i class="bi bi-clock-history text-warning"></i> AnalisisDetallado.html • Telemetría'
      },
      {
        tag: 'FASE 5 DE 8',
        subtext: 'Almacén • Deducción Atómica de Refacciones',
        title: '<i class="bi bi-box-seam text-primary"></i> inventory.html • Transacciones Firestore'
      },
      {
        tag: 'FASE 6 DE 8',
        subtext: 'Gestión Operativa • Matriz de Turnos UTC-6',
        title: '<i class="bi bi-people text-info"></i> Jornadas Rotativas A-B-C-D'
      },
      {
        tag: 'FASE 7 DE 8',
        subtext: 'Gemelo Digital 2.5D • Pistas de Rodadura ISA-101',
        title: '<i class="bi bi-diagram-3-fill text-info"></i> plant-map.js • Viga Carrilera Vectorial'
      },
      {
        tag: 'FASE 8 DE 8',
        subtext: 'Sala de Control Andon 4K • Megafonía por Voz',
        title: '<i class="bi bi-display text-warning"></i> andon-tv.js • Videowall & Audio TTS'
      }
    ];

    // Segmentos y centros óptimos para las 8 fases (transición ajustada sin zonas muertas)
    const phaseCenters = [0.06, 0.19, 0.32, 0.45, 0.58, 0.71, 0.84, 0.96];
    const boundaries = [
      { solidStart: 0.00, solidEnd: 0.10, transEnd: 0.14 }, // 0 -> 1
      { solidStart: 0.14, solidEnd: 0.23, transEnd: 0.27 }, // 1 -> 2
      { solidStart: 0.27, solidEnd: 0.36, transEnd: 0.40 }, // 2 -> 3
      { solidStart: 0.40, solidEnd: 0.49, transEnd: 0.53 }, // 3 -> 4
      { solidStart: 0.53, solidEnd: 0.62, transEnd: 0.66 }, // 4 -> 5
      { solidStart: 0.66, solidEnd: 0.75, transEnd: 0.79 }, // 5 -> 6
      { solidStart: 0.79, solidEnd: 0.88, transEnd: 0.92 }, // 6 -> 7
      { solidStart: 0.92, solidEnd: 1.00, transEnd: 1.00 }  // 7 final
    ];

    let currentProgress = 0;
    let targetProgress = 0;
    let activePhase = -1;

    // Web Audio Synthesizer para efectos de Keynote
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
        const baseFreqs = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];
        const freq = baseFreqs[idx % baseFreqs.length] || 659.25;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioContext.currentTime);

        gain.gain.setValueAtTime(0.04, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.22);

        osc.connect(gain);
        gain.connect(audioContext.destination);

        osc.start();
        osc.stop(audioContext.currentTime + 0.23);
      } catch (e) {}
    }

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

    // Loop a 60fps con Lerp fluido
    function tick() {
      const diff = targetProgress - currentProgress;
      if (Math.abs(diff) > 0.0003) {
        currentProgress += diff * 0.14;
        renderScrollyFrame(currentProgress);
      } else if (Math.abs(diff) > 0) {
        currentProgress = targetProgress;
        renderScrollyFrame(currentProgress);
      }
      requestAnimationFrame(tick);
    }
    tick();

    // Render de cinemática continua sin zonas borrosas ni colisiones
    function renderScrollyFrame(p) {
      if (progressFill) {
        progressFill.style.width = (p * 100).toFixed(1) + '%';
      }

      // Determinar fase dominante
      let domIdx = 0;
      for (let i = 0; i < boundaries.length; i++) {
        if (p < boundaries[i].transEnd || i === boundaries.length - 1) {
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

        // Actualizar píldoras activas y scroll suave
        pills.forEach((pill, i) => {
          pill.classList.toggle('active', i === activePhase);
        });
        const activePill = pills[activePhase];
        if (activePill && activePill.parentElement) {
          const parent = activePill.parentElement;
          const scrollLeft = activePill.offsetLeft - (parent.offsetWidth / 2) + (activePill.offsetWidth / 2);
          parent.scrollTo({ left: scrollLeft, behavior: 'smooth' });
        }
      }

      // Cálculo de transición exacta entre fase domIdx y la siguiente
      const b = boundaries[domIdx];
      let transT = 0; // 0 = sólido domIdx, 1 = sólido domIdx + 1
      let transitioning = false;

      if (p > b.solidEnd && domIdx < 7) {
        transitioning = true;
        transT = (p - b.solidEnd) / (b.transEnd - b.solidEnd);
        transT = Math.max(0, Math.min(1, transT));
      }

      // Aplicar estados a las 8 tarjetas y 8 interfaces visuales
      callouts.forEach((callout, idx) => {
        const visual = visualItems[idx];

        if (!transitioning) {
          // Estado de reposo sólido
          if (idx === domIdx) {
            callout.style.opacity = '1';
            callout.style.transform = 'translate3d(0, 0, 0) scale(1)';
            callout.style.filter = 'none';
            callout.style.pointerEvents = 'auto';
            callout.classList.add('active');

            if (visual) {
              visual.style.display = 'flex';
              visual.style.opacity = '1';
              visual.style.transform = 'scale(1)';
              visual.style.zIndex = '3';
              visual.classList.add('active');
            }
          } else {
            callout.style.opacity = '0';
            callout.style.transform = idx < domIdx ? 'translate3d(0, -28px, 0) scale(0.96)' : 'translate3d(0, 28px, 0) scale(0.96)';
            callout.style.filter = 'none';
            callout.style.pointerEvents = 'none';
            callout.classList.remove('active');

            if (visual) {
              visual.style.display = 'none';
              visual.style.opacity = '0';
              visual.classList.remove('active');
            }
          }
        } else {
          // Estado de transición suave entre domIdx y domIdx + 1
          const nextIdx = domIdx + 1;
          const eased = Math.sin((transT * Math.PI) / 2); // Easing sinusoidal

          if (idx === domIdx) {
            // Fase saliente: sube suavemente y se desvanece
            const op = Math.max(0, 1 - eased);
            callout.style.opacity = op.toFixed(3);
            callout.style.transform = `translate3d(0, ${(-eased * 24).toFixed(1)}px, 0) scale(${(1.0 - 0.03 * eased).toFixed(3)})`;
            callout.style.filter = 'none';
            callout.style.pointerEvents = op > 0.5 ? 'auto' : 'none';
            callout.classList.toggle('active', op > 0.5);

            if (visual) {
              visual.style.display = op > 0.02 ? 'flex' : 'none';
              visual.style.opacity = op.toFixed(3);
              visual.style.transform = `scale(${(1.0 - 0.02 * eased).toFixed(3)})`;
              visual.style.zIndex = '2';
            }
          } else if (idx === nextIdx) {
            // Fase entrante: asciende desde abajo y gana opacidad completa
            const op = Math.max(0, eased);
            callout.style.opacity = op.toFixed(3);
            callout.style.transform = `translate3d(0, ${((1 - eased) * 24).toFixed(1)}px, 0) scale(${(0.97 + 0.03 * eased).toFixed(3)})`;
            callout.style.filter = 'none';
            callout.style.pointerEvents = op > 0.5 ? 'auto' : 'none';
            callout.classList.toggle('active', op > 0.5);

            if (visual) {
              visual.style.display = op > 0.02 ? 'flex' : 'none';
              visual.style.opacity = op.toFixed(3);
              visual.style.transform = `scale(${(0.98 + 0.02 * eased).toFixed(3)})`;
              visual.style.zIndex = '3';
            }
          } else {
            // Otras fases completamente inactivas
            callout.style.opacity = '0';
            callout.style.filter = 'none';
            callout.style.pointerEvents = 'none';
            callout.classList.remove('active');

            if (visual) {
              visual.style.display = 'none';
              visual.style.opacity = '0';
              visual.classList.remove('active');
            }
          }
        }
      });
    }

    // ─── CONTROLADOR MAESTRO DE NAVEGACIÓN Y AUTOPLAY KEYNOTE ───
    let isAutoplaying = false;
    let autoplayTimer = null;
    let autoplayStep = 0;

    function scrollToPhase(idx) {
      if (idx < 0 || idx >= phaseCenters.length) return;
      const scrollableDistance = track.offsetHeight - window.innerHeight;
      const targetY = track.offsetTop + phaseCenters[idx] * scrollableDistance;

      window.scrollTo({ top: targetY, behavior: 'smooth' });
      playKeynoteChime(idx);
      // Háptico solo en app nativa
      if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.Haptics) {
        window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' });
      }
    }

    function startAutoplay(forcedPhase) {
      // Garantizar que no existan temporizadores previos corriendo en paralelo
      if (autoplayTimer) {
        clearTimeout(autoplayTimer);
        autoplayTimer = null;
      }

      isAutoplaying = true;
      const btn = document.getElementById('btnScrollyAutoplay');
      const icon = document.getElementById('autoplayBtnIcon');
      const text = document.getElementById('autoplayBtnText');
      if (btn) btn.classList.add('playing');
      if (icon) icon.className = 'bi bi-pause-fill me-1';
      if (text) text.textContent = 'Pausar';

      if (typeof forcedPhase === 'number') {
        autoplayStep = forcedPhase;
      } else {
        autoplayStep = (activePhase >= 0 && activePhase < phaseCenters.length - 1) ? activePhase : 0;
      }
      runAutoplayStep();
    }

    function pauseAutoplay() {
      isAutoplaying = false;
      if (autoplayTimer) {
        clearTimeout(autoplayTimer);
        autoplayTimer = null;
      }
      const btn = document.getElementById('btnScrollyAutoplay');
      const icon = document.getElementById('autoplayBtnIcon');
      const text = document.getElementById('autoplayBtnText');
      if (btn) btn.classList.remove('playing');
      if (icon) icon.className = 'bi bi-play-fill me-1';
      if (text) text.textContent = 'Presentación';
    }

    function toggleAutoplay() {
      if (isAutoplaying) {
        pauseAutoplay();
      } else {
        startAutoplay();
      }
    }

    function runAutoplayStep() {
      if (!isAutoplaying) return;
      if (autoplayTimer) {
        clearTimeout(autoplayTimer);
        autoplayTimer = null;
      }

      scrollToPhase(autoplayStep);

      autoplayTimer = setTimeout(() => {
        if (!isAutoplaying) return;
        autoplayStep++;
        if (autoplayStep >= phaseCenters.length) {
          pauseAutoplay();
          return;
        }
        runAutoplayStep();
      }, 5500);
    }

    // Botones Anterior y Siguiente
    const prevBtn = document.getElementById('btnScrollyPrev');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (isAutoplaying) pauseAutoplay();
        const prevIdx = Math.max(0, (activePhase >= 0 ? activePhase : 0) - 1);
        scrollToPhase(prevIdx);
      });
    }

    const nextBtn = document.getElementById('btnScrollyNext');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (isAutoplaying) pauseAutoplay();
        const nextIdx = Math.min(phaseCenters.length - 1, (activePhase >= 0 ? activePhase : 0) + 1);
        scrollToPhase(nextIdx);
      });
    }

    const autoplayBtn = document.getElementById('btnScrollyAutoplay');
    if (autoplayBtn) {
      autoplayBtn.addEventListener('click', toggleAutoplay);
    }

    const audioBtn = document.getElementById('btnScrollyAudio');
    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        audioEnabled = !audioEnabled;
        const icon = document.getElementById('audioBtnIcon');
        if (icon) {
          icon.className = audioEnabled ? 'bi bi-volume-up-fill text-info' : 'bi bi-volume-mute-fill text-secondary';
        }
        if (audioEnabled) playKeynoteChime(activePhase >= 0 ? activePhase : 0);
      });
    }

    // Exponer API global a window
    window.startKeynoteTour = function(phase) {
      startAutoplay(typeof phase === 'number' ? phase : 0);
    };
    window.scrollToScrollyPhase = function(idx) {
      if (isAutoplaying) pauseAutoplay();
      scrollToPhase(idx);
    };

    let isKeynoteStarting = false;
    function handleHeroKeynoteClick() {
      if (isKeynoteStarting) return;
      isKeynoteStarting = true;
      setTimeout(() => { isKeynoteStarting = false; }, 1200);

      // Limpiar de forma atómica cualquier ciclo previo
      pauseAutoplay();

      const btn = document.getElementById('btnHeroKeynote');
      if (btn) {
        btn.classList.add('active-tap');
        btn.classList.add('pulse-glow');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-chevron-double-down me-2"></i> Iniciando Recorrido...';
        setTimeout(() => {
          btn.innerHTML = orig;
          btn.classList.remove('active-tap');
          btn.classList.remove('pulse-glow');
        }, 2200);
      }
      if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.Haptics) {
        window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' });
      }
      playKeynoteChime(0);

      // Iniciar el tour en la Fase 0 (Pizarrón) con sincronización atómica
      startAutoplay(0);
    }

    window.triggerHeroKeynote = handleHeroKeynoteClick;

    const heroBtn = document.getElementById('btnHeroKeynote');
    if (heroBtn) {
      heroBtn.onclick = (e) => {
        e.preventDefault();
        handleHeroKeynoteClick();
      };
    }

    // ─── 3D GYROSCOPIC / MOUSE TILT ENGINE ───
    (function init3DTilt() {
      const frame = document.querySelector('.stage-window-frame');
      const windowWrapper = document.querySelector('.scrolly-visual-window');
      if (!frame || !windowWrapper) return;

      let targetRotX = 0;
      let targetRotY = 0;
      let curRotX = 0;
      let curRotY = 0;

      windowWrapper.addEventListener('mousemove', (e) => {
        const rect = windowWrapper.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        targetRotY = ((x - centerX) / centerX) * 6;
        targetRotX = -((y - centerY) / centerY) * 6;

        const mouseXPercent = (x / rect.width * 100).toFixed(1);
        const mouseYPercent = (y / rect.height * 100).toFixed(1);
        frame.style.setProperty('--mouse-x', `${mouseXPercent}%`);
        frame.style.setProperty('--mouse-y', `${mouseYPercent}%`);
      });

      windowWrapper.addEventListener('mouseleave', () => {
        targetRotX = 0;
        targetRotY = 0;
      });

      function renderTilt() {
        curRotX += (targetRotX - curRotX) * 0.12;
        curRotY += (targetRotY - curRotY) * 0.12;
        if (Math.abs(curRotX) > 0.01 || Math.abs(curRotY) > 0.01) {
          frame.style.transform = `perspective(1000px) rotateX(${curRotX.toFixed(2)}deg) rotateY(${curRotY.toFixed(2)}deg)`;
        } else {
          frame.style.transform = 'none';
        }
        requestAnimationFrame(renderTilt);
      }
      renderTilt();
    })();

    // Clic en píldoras con scroll suave y háptico
    pills.forEach((pill) => {
      pill.addEventListener('click', () => {
        if (isAutoplaying) pauseAutoplay();
        const idx = parseInt(pill.getAttribute('data-phase-target') || '0', 10);
        scrollToPhase(idx);
      });
    });
  }

  // ─── 6. LABORATORIO EN VIVO (SANDBOX CON HARDWARE REAL) ───
  function initSandboxLab() {
    const btn = document.getElementById('labMetallicBtn');
    const badge = document.getElementById('labCraneBadge');
    const title = document.getElementById('labCraneTitle');
    const desc = document.getElementById('labCraneDesc');
    const prompt = document.getElementById('labBtnPrompt');
    const dialText = document.getElementById('labDialText');
    const dialBadge = document.getElementById('labDialBadge');
    const oledPrev = document.getElementById('labOledPreview');
    const triggerBtn = document.getElementById('labTriggerFaultBtn');
    const resolveBtn = document.getElementById('labResolveFaultBtn');

    if (!btn) return;

    let isFault = false;
    let selectedReasonIdx = 0;
    const labReasons = ["1. Leva rota", "2. Fuga neumática", "3. Tornillería floja", "4. Componente roto"];
    let labInactivityTimer = null;

    function renderLabUI() {
      if (isFault) {
        if (badge) {
          badge.className = 'badge bg-danger pulse-badge';
          badge.textContent = 'Falla';
        }
        if (title) title.textContent = 'Grúa 10C (Área 10)';
        if (desc) {
          desc.className = 'small text-danger fw-medium';
          desc.textContent = `${labReasons[selectedReasonIdx]} (reportada)`;
        }
        if (dialText) dialText.textContent = '1 FALLA (83% DISP)';
        if (dialBadge) {
          dialBadge.className = 'badge bg-warning text-dark';
          dialBadge.textContent = 'SUPERVISIÓN';
        }
        if (oledPrev) {
          oledPrev.className = 'font-monospace text-danger fw-bold mt-1';
          oledPrev.textContent = `[ GRÚA 10C • ! PARO ! • ${labReasons[selectedReasonIdx]} ]`;
        }
        if (prompt) prompt.textContent = 'Falla activa. Pulsa el botón metálico para resolver o abre el emulador.';
      } else {
        if (badge) {
          badge.className = 'badge bg-success';
          badge.textContent = 'Operativa';
        }
        if (title) title.textContent = 'Grúa 10C (Área 10)';
        if (desc) {
          desc.className = 'small text-success fw-medium';
          desc.textContent = 'Operativa • Línea al 100%';
        }
        if (dialText) dialText.textContent = 'LÍNEA 100% DISP';
        if (dialBadge) {
          dialBadge.className = 'badge bg-success';
          dialBadge.textContent = 'OPERATIVA';
        }
        if (oledPrev) {
          oledPrev.className = 'font-monospace text-info fw-bold mt-1';
          oledPrev.textContent = '[ GRÚA 10C • OPERATIVA • 192.168.1.146 ]';
        }
        if (prompt) prompt.textContent = '1 clic para rotar • 2s sin presionar confirman automáticamente.';
      }
    }

    window.handleLabSimClick = function() {
      if (isFault) {
        // En falla: resolver
        isFault = false;
        renderLabUI();
        return;
      }

      // Rotar motivos de falla
      selectedReasonIdx = (selectedReasonIdx + 1) % labReasons.length;
      if (dialText) dialText.textContent = labReasons[selectedReasonIdx];
      if (dialBadge) {
        dialBadge.className = 'badge bg-warning text-dark';
        dialBadge.textContent = 'CONFIRMANDO...';
      }
      if (prompt) prompt.textContent = `Seleccionado: ${labReasons[selectedReasonIdx]}. Espera 2s para emitir paro...`;

      if (labInactivityTimer) clearTimeout(labInactivityTimer);
      labInactivityTimer = setTimeout(() => {
        isFault = true;
        renderLabUI();
      }, 2000);
    };

    triggerBtn?.addEventListener('click', () => {
      isFault = true;
      renderLabUI();
    });

    resolveBtn?.addEventListener('click', () => {
      isFault = false;
      renderLabUI();
    });

    const ttsBtn = document.getElementById('labTtsTestBtn');
    if (ttsBtn) {
      ttsBtn.addEventListener('click', () => {
        const text = "Atención nave 10: Grúa 10C reporta leva rota. Sistema de monitoreo SCADA en línea.";
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'es-MX';
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          window.speechSynthesis.speak(utterance);
        } else {
          alert(text);
        }
        if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.Haptics) {
          window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' });
        }
      });
    }

    const keynoteBtn = document.getElementById('labKeynoteScrollBtn');
    if (keynoteBtn) {
      keynoteBtn.addEventListener('click', () => {
        handleHeroKeynoteClick();
      });
    }

    renderLabUI();
  }

  // ─── 7. LIVE TIMERS ───
  function initLiveTimers() {
    let secs = 4 * 60 + 12;
    setInterval(() => {
      secs++;
      const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
      const s = String(secs % 60).padStart(2, '0');
      const formatted = `00:${m}:${s}`;

      document.querySelectorAll('.scrolly-live-timer').forEach(el => {
        el.textContent = formatted;
      });
    }, 1000);
  }

})();

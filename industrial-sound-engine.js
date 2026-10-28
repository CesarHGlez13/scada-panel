/**
 * ============================================================================
 * SCADA PRO 4.0 - INDUSTRIAL WEBAUDIO & HAPTIC FEEDBACK ENGINE + VOICE PA
 * Sintetizador analógico por osciladores matemáticos (ISA-18.2 & OpenBridge)
 * Megafonía Industrial TTS (Web Speech API es-MX) para Paros Críticos y Despejes
 * Desarrollado para Cesar • Cero dependencias externas • 100% Resiliente Offline
 * ============================================================================
 */

(function (window) {
  'use strict';

  let audioCtx = null;
  let isMuted = localStorage.getItem('hermes_sound_muted') === 'true';
  let isVoiceEnabled = localStorage.getItem('hermes_voice_enabled') !== 'false';
  let cachedVoice = null;
  let hasUserInteracted = false;

  function canUseGestures() {
    if (typeof navigator !== 'undefined' && navigator.userActivation) {
      return navigator.userActivation.hasBeenActive;
    }
    return hasUserInteracted;
  }

  function getAudioContext() {
    if (!canUseGestures()) {
      return null;
    }
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Desbloqueo pasivo en primera interacción táctil o clic
  function unlockAudio() {
    hasUserInteracted = true;
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => {
        console.log('🔊 WebAudio Industrial inicializado y activo.');
      }).catch(() => {});
    }
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('click', unlockAudio);
  }
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });
  window.addEventListener('click', unlockAudio, { passive: true });

  // Selección de voz industrial (es-MX / es-US / es-*)
  function loadBestVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;
    cachedVoice = voices.find(v => v.lang === 'es-MX') ||
                  voices.find(v => v.lang.startsWith('es-419')) ||
                  voices.find(v => v.lang.startsWith('es-US')) ||
                  voices.find(v => v.lang.startsWith('es')) ||
                  voices[0];
    return cachedVoice;
  }

  if ('speechSynthesis' in window) {
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadBestVoice;
    }
    loadBestVoice();
  }

  const IndustrialAudio = {
    isMuted() {
      return isMuted;
    },

    toggleMute() {
      isMuted = !isMuted;
      localStorage.setItem('hermes_sound_muted', isMuted);
      this.updateMuteUI();
      if (!isMuted) {
        this.playClick();
      }
      return isMuted;
    },

    setMute(state) {
      isMuted = !!state;
      localStorage.setItem('hermes_sound_muted', isMuted);
      this.updateMuteUI();
    },

    updateMuteUI() {
      document.querySelectorAll('.scada-sound-toggle-btn').forEach(btn => {
        if (isMuted) {
          btn.classList.add('muted');
          btn.innerHTML = '<i class="bi bi-volume-mute-fill"></i>';
          btn.title = 'Sonido Industrial Silenciado (Click para activar)';
        } else {
          btn.classList.remove('muted');
          btn.innerHTML = '<i class="bi bi-volume-up-fill"></i>';
          btn.title = 'Sonido Industrial Activo (Click para silenciar)';
        }
      });
    },

    isVoiceActive() {
      return isVoiceEnabled;
    },

    toggleVoice() {
      isVoiceEnabled = !isVoiceEnabled;
      localStorage.setItem('hermes_voice_enabled', isVoiceEnabled);
      this.updateVoiceUI();
      if (isVoiceEnabled) {
        this.speakAlert('Voz industrial activada');
      }
      return isVoiceEnabled;
    },

    setVoice(state) {
      isVoiceEnabled = !!state;
      localStorage.setItem('hermes_voice_enabled', isVoiceEnabled);
      this.updateVoiceUI();
    },

    updateVoiceUI() {
      document.querySelectorAll('.scada-voice-toggle-btn').forEach(btn => {
        if (!isVoiceEnabled) {
          btn.classList.add('muted');
          btn.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
          btn.title = 'Voz Industrial Desactivada (Click para activar)';
        } else {
          btn.classList.remove('muted');
          btn.innerHTML = '<i class="bi bi-megaphone-fill"></i>';
          btn.title = 'Voz Industrial Activa (Click para desactivar)';
        }
      });
    },

    triggerHaptic(pattern = 30) {
      // Exclusivo para la app móvil nativa (Capacitor/Android).
      // Jamás en PC, pantallas industriales ni Smart TV donde no existe vibrador.
      if (!window.Capacitor?.isNativePlatform?.()) return;
      try {
        const haptics = window.Capacitor?.Plugins?.Haptics;
        if (haptics) {
          if (typeof haptics.impact === 'function') {
            haptics.impact({ style: 'LIGHT' });
          } else if (typeof haptics.vibrate === 'function') {
            haptics.vibrate({ duration: typeof pattern === 'number' ? pattern : 40 });
          }
        }
      } catch (e) {}
    },

    // ── 0. Megafonía Sintetizada Industrial (Web Speech API) ───────────────
    speakAlert(text, priority = false) {
      if (isMuted || !isVoiceEnabled) return;
      if (!canUseGestures()) return;
      if (!('speechSynthesis' in window)) return;
      try {
        if (priority) {
          window.speechSynthesis.cancel();
        }
        const utter = new SpeechSynthesisUtterance(text);
        if (!cachedVoice) loadBestVoice();
        if (cachedVoice) utter.voice = cachedVoice;
        utter.lang = (cachedVoice && cachedVoice.lang) || 'es-MX';
        utter.rate = 1.05;
        utter.pitch = 0.95;
        utter.volume = 0.92;
        window.speechSynthesis.speak(utter);
      } catch (e) {
        console.warn('SpeechSynthesis Industrial:', e);
      }
    },

    // ── 1. Clic Táctil Metálico Ultracorto (15ms) ───────────────────────────
    playClick() {
      this.triggerHaptic(15);
      if (isMuted) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1400, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.02);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.025);
      } catch (e) {}
    },

    // ── 2. Chime de Atención N1 (520Hz -> 650Hz Campana) ────────────────────
    playN1Chime() {
      this.triggerHaptic([40, 30, 40]);
      if (isMuted) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        [520, 650].forEach((freq, idx) => {
          const t = now + idx * 0.12;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t);

          gain.gain.setValueAtTime(0.18, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(t);
          osc.stop(t + 0.3);
        });
      } catch (e) {}
    },

    // ── 3. Alarma N2 Supervisor (Doble Pulso 880Hz Warble) ─────────────────
    playN2Warble() {
      this.triggerHaptic([80, 40, 80]);
      if (isMuted) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        [0, 0.16].forEach(delay => {
          const t = now + delay;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(880, t);
          osc.frequency.exponentialRampToValueAtTime(720, t + 0.12);

          gain.gain.setValueAtTime(0.22, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(t);
          osc.stop(t + 0.15);
        });
      } catch (e) {}
    },

    // ── 4. Alarma N3 Crítica Gerencial (Barrido de Sirena 1200Hz-800Hz) ──────
    playN3Siren() {
      this.triggerHaptic([150, 60, 150, 60, 200]);
      if (isMuted) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.linearRampToValueAtTime(1300, now + 0.25);
        osc.frequency.linearRampToValueAtTime(800, now + 0.5);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.52);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.55);
      } catch (e) {}
    },

    // ── 5. Resolución Exitosa / Despeje de Falla (Acorde Mayor C5-E5-G5) ─────
    playResolveSuccess() {
      this.triggerHaptic([50, 30, 80]);
      if (isMuted) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        const notes = [523.25, 659.25, 783.99]; // Do, Mi, Sol
        notes.forEach((freq, idx) => {
          const t = now + idx * 0.08;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t);

          gain.gain.setValueAtTime(0.2, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(t);
          osc.stop(t + 0.38);
        });
      } catch (e) {}
    },

    // Enrutador inteligente de alarmas sonoras y por voz
    playAlarmForLevel(level, announcementText = null) {
      if (level === 'n3' || level === 'critical') {
        this.playN3Siren();
        if (announcementText) {
          setTimeout(() => this.speakAlert(announcementText, true), 600);
        }
      } else if (level === 'n2' || level === 'late') {
        this.playN2Warble();
        if (announcementText) {
          setTimeout(() => this.speakAlert(announcementText), 500);
        }
      } else if (level === 'resolve') {
        this.playResolveSuccess();
        if (announcementText) {
          setTimeout(() => this.speakAlert(announcementText), 450);
        }
      } else {
        this.playN1Chime();
        if (announcementText) {
          setTimeout(() => this.speakAlert(announcementText), 400);
        }
      }
    }
  };

  // ─── 6. MONITOREO REACTIVO DE TRANSICIONES DE ESTADO (ANDONSTATE) ───────────
  let isFirstAndonState = true;
  const previousCraneStates = new Map();
  const previousOpStates = new Map();

  function handleAndonStateChange(e) {
    const detail = e.detail;
    if (!detail) return;

    const cranes = detail.cranes || [];
    const ops = detail.operations || [];

    if (isFirstAndonState) {
      cranes.forEach(c => previousCraneStates.set(c.id, c.status));
      ops.forEach(o => previousOpStates.set(o.id, o.status));
      isFirstAndonState = false;
      return;
    }

    // Monitoreo de Grúas
    cranes.forEach(crane => {
      const prev = previousCraneStates.get(crane.id);
      const curr = crane.status;
      if (prev !== undefined && prev !== curr) {
        if (curr === 'failed') {
          IndustrialAudio.playAlarmForLevel('n3', `Atención: Falla detectada en Grúa ${crane.id}, Área ${crane.area || ''}`);
        } else if (curr === 'operational' && (prev === 'failed' || prev === 'maintenance')) {
          IndustrialAudio.playAlarmForLevel('resolve', `Grúa ${crane.id} restablecida a operativa`);
        } else if (curr === 'maintenance') {
          IndustrialAudio.playAlarmForLevel('n1', `Grúa ${crane.id} en mantenimiento`);
        }
      }
      previousCraneStates.set(crane.id, curr);
    });

    // Monitoreo de Puestos de Operación
    ops.forEach(op => {
      const prev = previousOpStates.get(op.id);
      const curr = op.status;
      if (prev !== undefined && prev !== curr) {
        const opName = op.name || op.id;
        if (curr === 'failed') {
          IndustrialAudio.playAlarmForLevel('n2', `Alerta: Falla en operación ${opName}`);
        } else if (curr === 'operational' && prev === 'failed') {
          IndustrialAudio.playAlarmForLevel('resolve', `Operación ${opName} restablecida`);
        }
      }
      previousOpStates.set(op.id, curr);
    });
  }

  window.addEventListener('andonstate', handleAndonStateChange);

  window.IndustrialAudio = IndustrialAudio;

  document.addEventListener('DOMContentLoaded', () => {
    IndustrialAudio.updateMuteUI();
    IndustrialAudio.updateVoiceUI();

    // Enlazar sonido táctil automáticamente a todos los botones industriales
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button, .btn, .mobile-nav-item, .scada-kpi-pill, .scada-faceplate-card');
      if (btn && !btn.classList.contains('scada-sound-toggle-btn') && !btn.classList.contains('scada-voice-toggle-btn')) {
        IndustrialAudio.playClick();
      }
    }, { passive: true });
  });

})(window);

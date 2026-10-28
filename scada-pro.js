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
 * SCADA PRO ENGINE v2.0 (Modo Andon TV, WebAudio Industrial Alarm, Filter Chips, CSV Export, WakeLock)
 * Desarrollado por Cesar + Antigravity
 * ============================================================================
 */

(function () {
  'use strict';

  // ─── 1. MOTOR DE AUDIO INDUSTRIAL SINTETIZADO (WEB AUDIO API) ───
  let audioCtx = null;
  let alarmStyle = localStorage.getItem('scada_andon_alarm_style') || 'silencio';
  let prevFailedCount = null;

  function ensureAudioCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playIndustrialTone(styleOverride) {
    const mode = styleOverride || alarmStyle;
    if (mode === 'silencio') return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;

    const now = ctx.currentTime;

    if (mode === 'sirena') {
      // Doble barrido táctico industrial
      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        const t0 = now + i * 0.48;
        osc.frequency.setValueAtTime(480, t0);
        osc.frequency.linearRampToValueAtTime(760, t0 + 0.22);
        osc.frequency.linearRampToValueAtTime(480, t0 + 0.44);
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.46);
      }
    } else if (mode === 'campana') {
      // Campana armónica Andon (660Hz + 880Hz)
      [660, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const t0 = now + idx * 0.22;
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.75);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.78);
      });
    } else if (mode === 'pitido') {
      // Triple pulso de telemetría
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const t0 = now + i * 0.18;
        osc.frequency.setValueAtTime(720, t0);
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.14);
      }
    }
  }

  // ─── 2. MODO ANDON TV + SCREEN WAKE LOCK ───
  let wakeLockSentinel = null;

  async function requestScreenWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      }
    } catch (err) {
      // WakeLock puede fallar silenciosamente en HTTP sin interacción previa
    }
  }

  function releaseScreenWakeLock() {
    if (wakeLockSentinel) {
      wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  }

  let andonClockInterval = null;

  function detectDefaultAndonView() {
    const hasCranes = !!document.getElementById('cranes-grid') || !!document.getElementById('cranesContainer');
    const hasOps = !!document.getElementById('operations-grid') || !!document.getElementById('operations-container') || !!document.getElementById('operationsContainer');
    if (hasOps && !hasCranes) return 'operations';
    return 'cranes';
  }

  function createOrUpdateAndonHUD() {
    let hud = document.getElementById('scada-andon-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'scada-andon-hud';
      hud.className = 'scada-andon-hud';
      setSafeDOM(hud, `
        <div class="scada-andon-hud-title">
          <span style="display:inline-flex;align-items:center;color:#ef4444;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>
          <span>ANDON SCADA</span>
          <span class="scada-andon-hud-shift" id="andon-hud-shift">JORNADA ACTIVA</span>
          <span class="scada-andon-hud-clock" id="andon-hud-clock">--:--:--</span>
        </div>
        <div class="scada-andon-hud-metrics">
          <div class="scada-andon-metric-pill failed">
            <span class="scada-led led-red" style="width:7px;height:7px;"></span>
            <span>Fallas: <strong id="andon-hud-failures">0</strong></span>
          </div>
          <div class="scada-andon-metric-pill late" style="background:rgba(245,158,11,0.18);border:1px solid rgba(245,158,11,0.45);color:#fcd34d;">
            <span class="scada-led led-amber" style="width:7px;height:7px;"></span>
            <span>Tardías (>5m): <strong id="andon-hud-late">0</strong></span>
          </div>
          <div class="scada-andon-metric-pill maint">
            <span class="scada-led led-amber" style="width:7px;height:7px;"></span>
            <span>Mant: <strong id="andon-hud-maint">0</strong></span>
          </div>
          <div class="scada-andon-metric-pill operational">
            <span class="scada-led led-green" style="width:7px;height:7px;"></span>
            <span>Operativas: <strong id="andon-hud-operational">0</strong></span>
          </div>
          <div class="scada-andon-metric-pill avail">
            <span>Disponibilidad: <strong id="andon-hud-avail">100%</strong></span>
          </div>
        </div>
        <div class="scada-andon-hud-controls">
          <a href="andon-tv.html" target="_blank" class="scada-andon-tab-btn" style="color:#ef4444;border:1px solid rgba(239,68,68,0.4);text-decoration:none;" title="Abrir página dedicada Smart TV 4K">📺 TV 4K</a>
          <div class="scada-andon-view-toggle" id="scada-andon-toggle-wrap" style="display:none;">
            <button class="scada-andon-tab-btn active" id="andon-tab-cranes">🏭 Grúas</button>
            <button class="scada-andon-tab-btn" id="andon-tab-ops">⚙️ Operaciones</button>
          </div>
          <div class="scada-andon-audio-wrap">
            <select class="scada-andon-audio-select" id="andon-audio-select" title="Tono de alarma en falla">
              <option value="silencio">🔇 Silencio</option>
              <option value="sirena">🚨 Sirena</option>
              <option value="campana">🔔 Campana</option>
              <option value="pitido">📢 Pitido</option>
            </select>
            <button type="button" class="scada-andon-audio-test" id="andon-audio-test" title="Probar sonido de alarma">🔊</button>
          </div>
          <button class="scada-andon-exit-btn" id="andon-exit-hud-btn" title="Presiona Esc para salir">
            <span>✕</span> Salir Andon TV
          </button>
        </div>
      `);
      document.body.prepend(hud);

      const audioSelect = hud.querySelector('#andon-audio-select');
      if (audioSelect) {
        audioSelect.value = alarmStyle;
        audioSelect.addEventListener('change', () => {
          alarmStyle = audioSelect.value;
          localStorage.setItem('scada_andon_alarm_style', alarmStyle);
          if (alarmStyle !== 'silencio') playIndustrialTone(alarmStyle);
        });
      }

      const audioTest = hud.querySelector('#andon-audio-test');
      if (audioTest) {
        audioTest.addEventListener('click', () => {
          const styleToTest = alarmStyle === 'silencio' ? 'campana' : alarmStyle;
          playIndustrialTone(styleToTest);
        });
      }

      const hasBoth = !!document.getElementById('cranes-grid') && !!document.getElementById('operations-grid');
      const toggleWrap = hud.querySelector('#scada-andon-toggle-wrap');
      if (hasBoth && toggleWrap) {
        toggleWrap.style.display = 'flex';
        const tabCranes = hud.querySelector('#andon-tab-cranes');
        const tabOps = hud.querySelector('#andon-tab-ops');
        tabCranes.onclick = () => {
          document.body.classList.add('andon-view-cranes');
          document.body.classList.remove('andon-view-operations');
          tabCranes.classList.add('active');
          tabOps.classList.remove('active');
          refreshHUDData();
        };
        tabOps.onclick = () => {
          document.body.classList.add('andon-view-operations');
          document.body.classList.remove('andon-view-cranes');
          tabOps.classList.add('active');
          tabCranes.classList.remove('active');
          refreshHUDData();
        };
      }

      const exitBtn = hud.querySelector('#andon-exit-hud-btn');
      if (exitBtn) {
        exitBtn.onclick = (e) => {
          e.preventDefault();
          window.toggleAndonTvMode();
        };
      }
    }

    function refreshHUDData() {
      const now = new Date();
      const clockEl = document.getElementById('andon-hud-clock');
      if (clockEl) {
        clockEl.textContent = now.toLocaleTimeString('es-MX', { hour12: false });
      }

      const shiftEl = document.getElementById('andon-hud-shift');
      if (shiftEl && typeof window.getCurrentShift === 'function') {
        try {
          const sh = window.getCurrentShift();
          if (sh && sh.name) {
            shiftEl.textContent = String(sh.name).toUpperCase();
          }
        } catch (e) {}
      }

      const isViewingOps = document.body.classList.contains('andon-view-operations');
      const scopeRoot = document.querySelector(
        isViewingOps
          ? '#operations-grid, #operations-container, #operationsContainer'
          : '#cranes-grid, #cranesContainer'
      ) || document;

      const failedCards = scopeRoot.querySelectorAll(
        '.operation-card.failure, .operation-card.failed, .card.border-danger, .card.failure'
      );
      const maintCards = scopeRoot.querySelectorAll(
        '.operation-card.maintenance, .card.border-warning, .card.maintenance'
      );
      const opCards = scopeRoot.querySelectorAll(
        '.operation-card.operational, .card.border-success, .card.operational'
      );

      const failCount = failedCards.length;
      const maintCount = maintCards.length;
      const opCount = opCards.length;
      const total = failCount + maintCount + opCount;
      const availPct = total > 0 ? Math.round((opCount / total) * 100) : 100;

      const lateCards = scopeRoot.querySelectorAll(
        '.operation-card.late-escalated, .crane-card.late-escalated, .badge-late-andon, .badge-critical-andon'
      );
      const lateCount = lateCards.length;

      const failEl = document.getElementById('andon-hud-failures');
      const lateEl = document.getElementById('andon-hud-late');
      const maintEl = document.getElementById('andon-hud-maint');
      const opEl = document.getElementById('andon-hud-operational');
      const availEl = document.getElementById('andon-hud-avail');

      if (failEl) failEl.textContent = failCount;
      if (lateEl) lateEl.textContent = lateCount;
      if (maintEl) maintEl.textContent = maintCount;
      if (opEl) opEl.textContent = opCount;
      if (availEl) availEl.textContent = `${availPct}%`;

      if (prevFailedCount !== null && failCount > prevFailedCount) {
        playIndustrialTone();
      }
      prevFailedCount = failCount;
    }

    refreshHUDData();
    if (andonClockInterval) clearInterval(andonClockInterval);
    andonClockInterval = setInterval(refreshHUDData, 1000);
  }

  function removeAndonHUD() {
    if (andonClockInterval) {
      clearInterval(andonClockInterval);
      andonClockInterval = null;
    }
    prevFailedCount = null;
    const hud = document.getElementById('scada-andon-hud');
    if (hud) hud.remove();
  }

  window.toggleAndonTvMode = async function () {
    const isAndon = document.body.classList.toggle('andon-tv-mode');
    if (isAndon) {
      const defaultView = detectDefaultAndonView();
      if (defaultView === 'operations') {
        document.body.classList.add('andon-view-operations');
        document.body.classList.remove('andon-view-cranes');
      } else {
        document.body.classList.add('andon-view-cranes');
        document.body.classList.remove('andon-view-operations');
      }
      createOrUpdateAndonHUD();
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch (e) {
        // Ignorar si el navegador bloquea fullscreen
      }
      await requestScreenWakeLock();
      showToast('Modo Andon TV Activado • Vista Industrial de Pantalla Completa');
    } else {
      document.body.classList.remove('andon-view-cranes', 'andon-view-operations');
      removeAndonHUD();
      if (document.fullscreenElement && document.exitFullscreen) {
        try { await document.exitFullscreen(); } catch (e) {}
      }
      releaseScreenWakeLock();
      showToast('Modo Andon TV Desactivado');
    }
  };

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('andon-tv-mode')) {
      document.body.classList.remove('andon-tv-mode', 'andon-view-cranes', 'andon-view-operations');
      removeAndonHUD();
      releaseScreenWakeLock();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('andon-tv-mode')) {
      window.toggleAndonTvMode();
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && document.body.classList.contains('andon-tv-mode')) {
      await requestScreenWakeLock();
    }
  });

  // ─── 3. SINCRONIZACIÓN BIDIRECCIONAL DE FILTER CHIPS CON <SELECT> ───
  function initFilterChipsSync(selectId, containerId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.className = 'scada-filter-group mb-2';
      select.parentNode.insertBefore(container, select);
      select.classList.add('visually-hidden');
    }

    function renderChips() {
      container.replaceChildren();
      Array.from(select.options).forEach((opt) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'scada-chip' + (opt.selected ? ' active' : '');
        chip.textContent = opt.text || opt.value;
        chip.dataset.val = opt.value;
        chip.addEventListener('click', () => {
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          renderChips();
        });
        container.appendChild(chip);
      });
    }

    select.addEventListener('change', () => {
      Array.from(container.children).forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.val === select.value);
      });
    });

    renderChips();
  }

  // ─── 4. EXPORTAR TABLAS DE ALTA DENSIDAD A CSV ───
  window.exportTableToCSV = function (tableId, filename = 'auditoria_scada.csv') {
    const el = document.getElementById(tableId);
    if (!el) return;
    const table = el.tagName === 'TBODY' ? (el.closest('table') || el) : el;

    const rows = Array.from(table.querySelectorAll('tr'));
    const csvContent = rows
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        return cells.map((cell) => `"${cell.textContent.trim().replace(/"/g, '""')}"`).join(',');
      })
      .join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Exportación CSV completada exitosamente');
  };

  // ─── 5. TOAST SUTIL TIPO LINEAR ───
  function showToast(msg) {
    let toast = document.getElementById('scadaProToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'scadaProToast';
      toast.style.cssText =
        'position: fixed; bottom: 24px; right: 24px; z-index: 99999; background: rgba(15, 23, 42, 0.95); color: #fff; padding: 10px 18px; border-radius: 99px; border: 1px solid rgba(255,255,255,0.15); font-size: 0.85rem; font-weight: 500; box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(12px); opacity: 0; transition: opacity 0.25s ease, transform 0.25s ease; transform: translateY(10px); pointer-events: none;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 2800);
  }

  // ─── 6. INICIALIZADOR AL CARGAR EL DOM ───
  
// ─── 7. ROTACIÓN AUTOMÁTICA POR ÁREA (Andón TV) ───
const AREA_CYCLE = ['10', '20', '30', '5', '35'];
const andonActive = () => window._andonTvActive || document.body.classList.contains('andon-tv-mode');
let DWELL_MS = 15000;
let autoIdx = 0, autoPaused = false, autoTick = null, phaseStart = 0, programmatic = false;

const areaLabel = (a) => (a === '35' ? 'ÁREA 35+' : 'ÁREA ' + a);

function setFilter(selectId, value) {
  const sel = document.getElementById(selectId);
  if (!sel) return false;
  const has = Array.from(sel.options).some(o => o.value === value);
  programmatic = true;
  sel.value = has ? value : 'all';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  programmatic = false;
  return has;
}

function phaseCounts(area) {
  const cards = Array.from(document.querySelectorAll('.operation-card[data-area]'));
  const inArea = cards.filter(c => c.getAttribute('data-area') === area);
  const gruas = inArea.filter(c => /^[0-9]{2}[A-Z]/.test(c.getAttribute('data-id') || ''));
  const figuras = inArea.filter(c => !/^[0-9]{2}[A-Z]/.test(c.getAttribute('data-id') || ''));
  const activas = (arr) => arr.filter(c => c.classList.contains('failure') || c.classList.contains('maintenance')).length;
  return { gruas: gruas.length, figuras: figuras.length, activas: activas(gruas) + activas(figuras) };
}

function buildAreaStrip() {
  const hud = document.getElementById('scadaAndonHud') || document.getElementById('scada-andon-hud');
  if (!hud || document.getElementById('andonAreaStrip')) return;
  const strip = document.createElement('div');
  strip.className = 'scada-andon-strip';
  strip.id = 'andonAreaStrip';
  setSafeDOM(strip, `
    <span class="scada-andon-strip-title">ROTACIÓN POR ÁREA</span>
    <span class="scada-andon-strip-now" id="andonStripNow">—</span>
    <span class="scada-andon-strip-count" id="andonStripCount">—</span>
    <div class="scada-andon-strip-chips" id="andonStripChips"></div>
    <button class="scada-andon-auto" id="andonAutoBtn">AUTO</button>
    <div class="scada-andon-strip-bar"><i id="andonStripFill"></i></div>`);
  hud.appendChild(strip);
  const chips = document.getElementById('andonStripChips');
  AREA_CYCLE.forEach((a) => {
    const c = document.createElement('span');
    c.className = 'scada-andon-strip-chip';
    c.dataset.area = a;
    c.textContent = a === '35' ? '35+' : a;
    chips.appendChild(c);
  });
  document.getElementById('andonAutoBtn').addEventListener('click', () => {
    autoPaused = !autoPaused;
    const b = document.getElementById('andonAutoBtn');
    b.classList.toggle('paused', autoPaused);
    b.textContent = autoPaused ? 'PAUSADO' : 'AUTO';
    if (!autoPaused) { phaseStart = Date.now(); applyPhase(); }
  });
}

function paintStrip(area, counts) {
  const now = document.getElementById('andonStripNow');
  const cnt = document.getElementById('andonStripCount');
  if (now) now.textContent = areaLabel(area);
  if (cnt) cnt.textContent = `${counts.gruas} GRÚAS · ${counts.figuras} FIGURAS · ${counts.activas} ACTIVA${counts.activas === 1 ? '' : 'S'}`;
  document.querySelectorAll('.scada-andon-strip-chip').forEach(c => c.classList.toggle('active', c.dataset.area === area));
}

function applyPhase() {
  const area = AREA_CYCLE[autoIdx];
  setFilter('crane-area-filter', area);
  setFilter('area-filter', area);
  paintStrip(area, phaseCounts(area));
  ['cranes-grid', 'operations-grid'].forEach((id) => {
    const g = document.getElementById(id);
    if (!g) return;
    g.classList.remove('andon-phase-in');
    void g.offsetWidth;
    g.classList.add('andon-phase-in');
  });
  phaseStart = Date.now();
}

function startRotation() {
  if (!andonActive()) return;
  buildAreaStrip();
  if (autoTick) return;
  autoIdx = 0; autoPaused = false; phaseStart = Date.now();
  applyPhase();
  autoTick = setInterval(() => {
    if (autoPaused) return;
    const fill = document.getElementById('andonStripFill');
    const el = Date.now() - phaseStart;
    if (fill) fill.style.width = Math.min(100, (el / DWELL_MS) * 100) + '%';
    if (el >= DWELL_MS) {
      autoIdx = (autoIdx + 1) % AREA_CYCLE.length;
      applyPhase();
    }
  }, 250);
}

function stopRotation() {
  if (autoTick) { clearInterval(autoTick); autoTick = null; }
  programmatic = true;
  ['crane-area-filter', 'area-filter'].forEach((id) => {
    const sel = document.getElementById(id);
    if (sel) { sel.value = 'all'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  programmatic = false;
}

function watchManualOverride() {
  ['crane-area-filter', 'area-filter'].forEach((id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.addEventListener('change', () => {
      if (programmatic || !andonActive()) return;
      autoPaused = true;
      const b = document.getElementById('andonAutoBtn');
      if (b) { b.classList.add('paused'); b.textContent = 'PAUSADO'; }
      const now = document.getElementById('andonStripNow');
      if (now) now.textContent = 'MANUAL — ' + (sel.value === 'all' ? 'TODAS' : 'ÁREA ' + sel.value);
    });
  });
}

window.__andonRotation = {
  cycle: AREA_CYCLE,
  get dwell() { return DWELL_MS; },
  setDwell: (ms) => { DWELL_MS = ms; },
  get paused() { return autoPaused; },
  get index() { return autoIdx; },
  start: startRotation,
  stop: stopRotation,
  next: () => { autoIdx = (autoIdx + 1) % AREA_CYCLE.length; applyPhase(); },
};

function hookAndonToggle() {
  const orig = window.toggleAndonTvMode;
  if (typeof orig !== 'function') return;
  window.toggleAndonTvMode = async function () {
    await orig();
    if (andonActive()) startRotation(); else stopRotation();
  };
}

document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('scada-pro-theme');

    // Sincronizar filtros de Operaciones si existen
    if (document.getElementById('area-filter')) {
      initFilterChipsSync('area-filter', 'areaFilterChips');
    }
    if (document.getElementById('status-filter')) {
      initFilterChipsSync('status-filter', 'statusFilterChips');
    }

    // Sincronizar filtros de Grúas si existen
    if (document.getElementById('crane-area-filter')) {
      initFilterChipsSync('crane-area-filter', 'craneAreaFilterChips');
    }
    if (document.getElementById('crane-status-filter')) {
      initFilterChipsSync('crane-status-filter', 'craneStatusFilterChips');
    }

    watchManualOverride();
    hookAndonToggle();
    if (andonActive()) startRotation();

    // Inyectar botón Modo Andon TV solo en páginas con tablero de grúas u operaciones
    const isMonitorBoard =
      !!document.getElementById('cranes-grid') ||
      !!document.getElementById('cranesContainer') ||
      !!document.getElementById('operations-grid') ||
      !!document.getElementById('operations-container');

    const navRight = document.getElementById('siteNavbarRight') || document.querySelector('.navbar .container-fluid');
    if (isMonitorBoard && navRight && !document.getElementById('btnAndonTv')) {
      const andonBtn = document.createElement('button');
      andonBtn.id = 'btnAndonTv';
      andonBtn.type = 'button';
      andonBtn.className = 'scada-andon-nav-btn d-none d-md-inline-flex align-items-center gap-2 me-2';
      setSafeDOM(andonBtn, '<i class="bi bi-display"></i> <span>Modo Andon TV</span>');
      andonBtn.title = 'Activar pantalla completa para monitores industriales';
      andonBtn.addEventListener('click', window.toggleAndonTvMode);
      navRight.insertBefore(andonBtn, navRight.firstChild);
    }
  });
})();

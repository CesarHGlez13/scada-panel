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

/* ═══════════════════════════════════════════════════════════════
   scada-ui.js — helper de la capa visual SCADA.
   No toca la logica de datos: solo enriquece el DOM que ya generan
   app.js / cranes.js. Antigravity lo integra como modulo aparte.
   ═══════════════════════════════════════════════════════════════ */

const SCADA = {
  // SLA por tipo de operacion (horas). Ajustar al contrato real.
  SLA_HOURS: { default: 8, critical: 4 },

  TONE: { fault: 'fault', active: 'ok', alert: 'warn', resolved: 'info', inactive: 'idle' },

  // Anillos de KPI: pinta el arco segun el valor ya renderizado.
  paintRing(el, pct) {
    const p = Math.max(0, Math.min(1, Number(pct) || 0));
    el.style.setProperty('--pct', p);
    const val = el.querySelector('.value');
    if (val) val.setAttribute('stroke-dashoffset', 213.6 * (1 - p));
  },

  // Convierte "HH:MM:SS" del timer en fraccion de SLA.
  parseClock(text) {
    const m = String(text || '').match(/(\d+):(\d+):(\d+)/);
    if (!m) return null;
    return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / 3600;
  },

  // Aplica estado + barra de SLA a una tarjeta existente.
  decorateCard(card, { state, slaHours = this.SLA_HOURS.default } = {}) {
    if (!card) return;
    card.classList.add('sc-card');
    if (state) card.dataset.state = state;

    const clock = card.querySelector('.timer, .failed-timer-val, .maintenance-timers span');
    const hours = clock ? this.parseClock(clock.textContent) : null;
    if (hours === null) return;

    const pct = Math.min(1, hours / slaHours);
    let bar = card.querySelector('.sc-sla');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'sc-sla';
      setSafeDOM(bar, '<div class="sc-sla__fill"></div>');
      card.appendChild(bar);
    }
    bar.querySelector('.sc-sla__fill').style.setProperty('--pct', pct);

    const timer = card.querySelector('.timer');
    if (timer && pct >= 0.8) timer.dataset.critical = 'true';
  },

  // Decora tarjetas existentes y las que se creen despues (Firestore live updates).
  decorateCards(root = document) {
    root.querySelectorAll('.card').forEach((c) => this.decorateCard(c));
  },

  // Metas de cada KPI para calcular el arco (ajustar al contrato real de SLA).
  KPI_TARGETS: { 'active-failures': 10, 'avg-resolution-time': 6, 'resolved-today': 30 },

  // index.html no trae anillos SVG: se inyectan aqui, sin tocar el HTML.
  injectRings(root = document) {
    const map = [['active-failures', 'fault'], ['avg-resolution-time', 'info'], ['resolved-today', 'ok']];
    for (const [id, tone] of map) {
      const host = root.getElementById ? root.getElementById(id) : document.getElementById(id);
      if (!host) continue;
      const kpi = host.closest('.stats-item');
      if (!kpi) continue;
      kpi.dataset.tone = tone;
      kpi.classList.add('sc-kpi');
      let ring = kpi.querySelector('.sc-kpi__ring');
      if (!ring) {
        ring = document.createElement('div');
        ring.className = 'sc-kpi__ring';
        setSafeDOM(ring, '<svg viewBox="0 0 74 74">' +
          '<circle class="track" cx="37" cy="37" r="34"/>' +
          '<circle class="value" cx="37" cy="37" r="34"/></svg>' +
          '<div class="sc-kpi__core"></div>');
        kpi.insertBefore(ring, kpi.firstChild);
      }
      // El numero vive DENTRO del anillo; el texto (label) ya esta AFUERA.
      const core = ring.querySelector('.sc-kpi__core');
      if (core && host.parentNode !== core) {
        host.classList.add('sc-kpi__num');
        core.appendChild(host);
        const sub = core.querySelector('.sc-kpi__sub');
        if (sub) sub.remove();
      }
      this.fitNum(host);
      this.paintRing(ring, this.kpiPct(host));
    }
  },

  // Auto-ajuste del numero: cuanto mas digitos, menor cuerpo, para que quepa
  // dentro del anillo (diametro interior util ~62 px con r=34, stroke=6).
  fitNum(host) {
    const core = host.closest('.sc-kpi__core');
    if (!core) return;
    const inner = 2 * (34 - 3);            // diametro interior util del anillo
    const avail = Math.max(24, Math.min(inner, core.clientWidth - 6));
    const len = String(host.textContent || '').trim().length;
    let size = len <= 3 ? 20 : len <= 5 ? 17 : len <= 7 ? 14 : len <= 9 ? 12 : 11;
    host.style.setProperty('--num-size', size + 'px');
    host.style.setProperty('--num-scale', '1');
    // Medir el ANCHO REAL del texto (scrollWidth incluye el max-width de la caja).
    const c = host.cloneNode(true);
    c.style.maxWidth = 'none'; c.style.display = 'inline-block';
    c.style.transform = 'none'; c.style.position = 'absolute'; c.style.left = '-9999px';
    document.body.appendChild(c);
    const real = c.getBoundingClientRect().width;
    c.remove();
    // Ajuste fino: reducir cuerpo hasta que el texto quepa dentro del anillo.
    while (size > 8 && real * (size / parseFloat(getComputedStyle(host).fontSize)) > avail) {
      size -= 1;
      host.style.setProperty('--num-size', size + 'px');
    }
    // Escala final si aun desborda (valores muy largos).
    const w = real * (size / parseFloat(getComputedStyle(host).fontSize));
    const scale = w > avail ? +((avail - 1) / w).toFixed(3) : 1;
    host.style.setProperty('--num-scale', String(Math.max(0.6, scale)));
  },

  // Valor ya renderizado por app.js -> fraccion de la meta.
  kpiPct(host) {
    const raw = String(host.textContent || '').trim();
    const n = Number(raw.match(/\d+/)?.[0] ?? 0);
    const target = this.KPI_TARGETS[host.id] || 1;
    return Math.max(0, Math.min(1, n / target));
  },

  // Refresca los anillos cuando app.js actualiza los numeros por onSnapshot.
  refreshKpis(root = document) {
    this.injectRings(root);
  },

  // Control segmentado: mantiene la clase .active que ya usa el JS del panel.
  initSegmented(container) {
    if (!container) return;
    container.classList.add('sc-segmented');
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      container.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    });
  },
};

// Arranque defensivo: no rompe si el DOM aun no existe.
// El panel carga scripts classicos (no modules), asi que se expone en window.
window.SCADA = SCADA;
document.addEventListener('DOMContentLoaded', () => {
  SCADA.refreshKpis();
  SCADA.decorateCards();
  document.querySelectorAll('.btn-group').forEach(SCADA.initSegmented);

  // Las tarjetas se crean por onSnapshot de Firestore: observar y decorar.
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.classList && n.classList.contains('card')) SCADA.decorateCard(n);
        n.querySelectorAll && n.querySelectorAll('.card').forEach((c) => SCADA.decorateCard(c));
      }
      // Los numeros de KPI cambian por texto: repintar el arco y reajustar cuerpo.
      if (m.target && m.target.id && SCADA.KPI_TARGETS[m.target.id]) {
        const host = m.target.id === m.target.id ? m.target : document.getElementById(m.target.id);
        const ring = host && host.closest('.stats-item')?.querySelector('.sc-kpi__ring');
        if (ring) { SCADA.fitNum(host); SCADA.paintRing(ring, SCADA.kpiPct(host)); }
      } else if (m.target && m.target.closest) {
        const host = m.target.closest('[id]');
        if (host && SCADA.KPI_TARGETS[host.id]) {
          const ring = host.closest('.stats-item')?.querySelector('.sc-kpi__ring');
          if (ring) SCADA.paintRing(ring, SCADA.kpiPct(host));
        }
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
});

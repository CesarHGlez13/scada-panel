/**
 * PREDICTIVE MAINTENANCE & RECURRENT FAILURE DETECTOR
 * Operations Monitor Industrial SCADA
 * 
 * Analiza en tiempo real la tasa de fallas de grúas en las últimas 72 horas.
 * Si un equipo presenta 3 o más paros recientes o tiempo acumulado excesivo,
 * emite una recomendación preventiva antes de que ocurra una falla catastrófica.
 */

(function () {
  'use strict';

  async function checkRecurrentFailures() {
    if (typeof db === 'undefined' || !db) {
      setTimeout(checkRecurrentFailures, 1200);
      return;
    }

    try {
      // 1. Obtener fallas históricas recientes (hasta 60 registros)
      const now = new Date();
      const cutoff = new Date(now.getTime() - (72 * 60 * 60 * 1000)); // 72 horas

      let events = [];

      // Consulta de eventos en crane_events
      try {
        const eventsSnap = await db.collection('crane_events')
          .where('timestamp', '>=', cutoff)
          .limit(100)
          .get();
        eventsSnap.forEach(doc => events.push(doc.data()));
      } catch (e) {
        // Fallback a consulta sin filtro de timestamp
        try {
          const fallbackSnap = await db.collection('crane_events').limit(50).get();
          fallbackSnap.forEach(doc => events.push(doc.data()));
        } catch (err) {}
      }

      // Si hay pocos eventos en crane_events, verificar colecciones por fecha de los últimos 3 días
      if (events.length < 5) {
        const shifts = ['A', 'B', 'C', 'D'];
        for (let i = 0; i < 3; i++) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split('T')[0];
          for (const s of shifts) {
            try {
              const hSnap = await db.collection(`crane_history_${dateStr}_Jornada${s}`).limit(15).get();
              hSnap.forEach(doc => events.push(doc.data()));
            } catch (err) {}
          }
        }
      }

      // 2. Agrupar por Grúa
      const craneCounts = {};
      events.forEach(ev => {
        const cId = ev.craneId || ev.id;
        if (!cId) return;
        if (!craneCounts[cId]) {
          craneCounts[cId] = { count: 0, totalDowntimeSec: 0, area: ev.area || 'N/A' };
        }
        craneCounts[cId].count++;
        craneCounts[cId].totalDowntimeSec += (ev.downtimeSeconds || ev.durationSeconds || 300);
      });

      // 3. Filtrar las que tienen >= 3 fallas en 72h
      const criticalCranes = Object.entries(craneCounts)
        .filter(([id, data]) => data.count >= 3 || data.totalDowntimeSec >= 5400) // 3 fallas o 90 min acumulados
        .map(([id, data]) => ({ id, ...data }));

      if (criticalCranes.length > 0) {
        renderPredictiveBanner(criticalCranes);
        if (window.PlantMapEngine && typeof window.PlantMapEngine.setPredictiveWarnings === 'function') {
          window.PlantMapEngine.setPredictiveWarnings(criticalCranes.map(c => c.id));
        }
      }
    } catch (err) {
      console.warn('[PredictiveAlerts] Chequeo completado:', err.message);
    }
  }

  function renderPredictiveBanner(criticalCranes) {
    let container = document.getElementById('predictiveAlertsBanner');
    if (!container) {
      const parent = document.querySelector('.container, .container-fluid, main') || document.body;
      container = document.createElement('div');
      container.id = 'predictiveAlertsBanner';
      container.style.cssText = `
        margin: 12px auto;
        padding: 10px 16px;
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.2));
        border: 1px solid rgba(245, 158, 11, 0.5);
        border-radius: 12px;
        color: #fef3c7;
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 18px rgba(245, 158, 11, 0.2);
      `;
      parent.prepend(container);
    }

    const first = criticalCranes[0];
    const moreText = criticalCranes.length > 1 ? ` (+${criticalCranes.length - 1} más)` : '';

    container.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 1.3rem;">⚠️</span>
        <div>
          <b>Alerta Preventiva SCADA:</b> La Grúa <span class="badge bg-warning text-dark fw-bold">${first.id}</span>
          ha registrado <b>${first.count} paros</b> recientes (${Math.round(first.totalDowntimeSec / 60)} min fuera).
          ${moreText}
          <span class="d-none d-md-inline text-amber-200">Recomendación: Inspección preventiva de cableado / contactores.</span>
        </div>
      </div>
      <div style="display: flex; gap: 8px;">
        <a href="cranes.html" class="btn btn-warning btn-sm fw-bold px-3 py-1" style="font-size: 0.78rem;">
          Ver Grúas →
        </a>
        <button type="button" class="btn btn-outline-warning btn-sm py-1" onclick="document.getElementById('predictiveAlertsBanner').style.display='none'">
          ✕
        </button>
      </div>
    `;
    container.style.display = 'flex';
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkRecurrentFailures, 2000);
  });
})();

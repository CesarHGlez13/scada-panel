/**
 * SCADA Network Health & Latency Heartbeat Indicator
 * Operations Monitor Industrial SCADA
 * 
 * Monitorea continuamente la salud del enlace con Firestore y la latencia en milisegundos,
 * mostrando un indicador pulsante en la cabecera para garantizar que la pantalla no esté congelada.
 */

(function () {
  'use strict';

  let lastPingMs = 0;
  let lastSyncTime = Date.now();
  let disconnectCount = 0;
  let isChecking = false;

  function createOrGetPill() {
    let pill = document.getElementById('scadaNetworkHealthPill');
    if (!pill) {
      // Intentar colocar en el contenedor derecho de siteNavbar o crear uno flotante
      const navRight = document.getElementById('siteNavbarRight') || document.querySelector('.navbar .container, .navbar .container-fluid');
      pill = document.createElement('div');
      pill.id = 'scadaNetworkHealthPill';
      pill.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(15, 23, 42, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.12);
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 0.75rem;
        font-family: monospace;
        color: #94a3b8;
        cursor: pointer;
        user-select: none;
        transition: all 0.3s ease;
      `;
      if (navRight) {
        navRight.prepend(pill);
      } else {
        pill.style.position = 'fixed';
        pill.style.top = '12px';
        pill.style.right = '12px';
        pill.style.zIndex = '9999';
        document.body.appendChild(pill);
      }
    }
    return pill;
  }

  function updatePillUI(status, latencyMs, text) {
    const pill = createOrGetPill();
    if (!pill) return;

    let dotColor = '#10b981';
    let borderColor = 'rgba(16, 185, 129, 0.3)';
    let statusText = `${latencyMs}ms`;

    if (status === 'degraded') {
      dotColor = '#f59e0b';
      borderColor = 'rgba(245, 158, 11, 0.4)';
    } else if (status === 'offline') {
      dotColor = '#ef4444';
      borderColor = 'rgba(239, 68, 68, 0.6)';
      statusText = 'OFFLINE';
    }

    pill.style.borderColor = borderColor;
    pill.innerHTML = `
      <span style="width: 8px; height: 8px; border-radius: 50%; background: ${dotColor}; box-shadow: 0 0 8px ${dotColor}; display: inline-block;"></span>
      <span style="color: ${dotColor}; font-weight: 700;">${statusText}</span>
      <span class="d-none d-md-inline" style="color: #64748b; font-size: 0.7rem;">${text || 'SCADA Live'}</span>
    `;
    pill.title = `Estado de enlace: ${status.toUpperCase()} (${latencyMs}ms). Clic para forzar comprobación.`;
    pill.onclick = () => pingNetwork(true);
  }

  async function pingNetwork(manual = false) {
    if (isChecking) return;
    isChecking = true;

    const start = performance.now();
    try {
      if (typeof db !== 'undefined' && db) {
        // Heartbeat ultra ligero contra el documento de estado global
        await db.collection('config').doc('global').get();
        const latency = Math.round(performance.now() - start);
        lastPingMs = latency;
        lastSyncTime = Date.now();
        disconnectCount = 0;

        if (latency < 250) {
          updatePillUI('online', latency, 'Enlace Óptimo');
        } else {
          updatePillUI('degraded', latency, 'Latencia Alta');
        }
      } else {
        // Fallback fetch básico
        await fetch('/favicon.ico?_h=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
        const latency = Math.round(performance.now() - start);
        updatePillUI('online', latency, 'Online');
      }
    } catch (e) {
      disconnectCount++;
      const latency = Math.round(performance.now() - start);
      if (disconnectCount >= 2) {
        updatePillUI('offline', latency, 'Sin Enlace');
      } else {
        updatePillUI('degraded', latency, 'Reintentando...');
      }
    } finally {
      isChecking = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      pingNetwork();
      setInterval(() => pingNetwork(), 20000);
    }, 1200);
  });

  window.getScadaNetworkStatus = function () {
    return {
      latencyMs: lastPingMs,
      lastSync: lastSyncTime,
      isOnline: disconnectCount < 2
    };
  };
})();

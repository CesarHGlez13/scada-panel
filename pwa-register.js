/**
 * PWA Service Worker Registration & Offline Banner
 * Operations Monitor Industrial SCADA
 */

(function () {
  'use strict';

  // Registrar Service Worker si el navegador lo soporta y estamos en protocolo seguro o localhost
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .then(reg => {
          console.log('[PWA] Service Worker registrado con éxito. Scope:', reg.scope);
          reg.update().catch(() => {});
        })
        .catch(err => {
          console.warn('[PWA] Fallo registro Service Worker:', err.message);
        });
    });
  }

  // Notificador visual si se pierde conexión de red
  function updateOnlineStatus() {
    let banner = document.getElementById('scadaOfflineStatusBanner');
    if (!navigator.onLine) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'scadaOfflineStatusBanner';
        banner.style.cssText = `
          position: fixed;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(220, 38, 38, 0.95);
          color: #ffffff;
          padding: 8px 18px;
          border-radius: 30px;
          font-size: 0.82rem;
          font-weight: 700;
          z-index: 10080;
          display: flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.6);
          backdrop-filter: blur(8px);
          animation: pulseOffline 1.5s infinite alternate;
        `;
        banner.innerHTML = `<span class="spinner-grow spinner-grow-sm" role="status"></span> <span>Sin conexión Wi-Fi · Modo Resiliente Offline</span>`;
        document.body.appendChild(banner);
      }
      banner.style.display = 'flex';
    } else if (banner) {
      banner.innerHTML = `<span>✓</span> <span>Conexión restablecida</span>`;
      banner.style.background = 'rgba(16, 185, 129, 0.95)';
      setTimeout(() => { if (banner) banner.style.display = 'none'; }, 2500);
    }
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
})();

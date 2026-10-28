/**
 * Service Worker - Operations Monitor Industrial SCADA
 * Proporciona resiliencia offline y soporte PWA ante microcortes de Wi-Fi de planta
 */

const CACHE_NAME = 'operations-scada-cache-v31';
const CORE_ASSETS = [
  '/',
  'index.html',
  'cranes.html',
  'operations.html',
  'andon-tv.html',
  'warehouse.html',
  'inventory.html',
  'AnalisisDetallado.html',
  'mobile.html',
  'guia.html',
  'sistema-andon.html',
  'styles.css',
  'mobile.css',
  'scada-pro.css',
  'guia.css',
  'site-nav.js',
  'mobile-nav.js',
  'global-config.js',
  'scada-config.js',
  'pocketbase-adapter.js',
  'cranes.js',
  'operations.js',
  'admin.js',
  'auth-system.js',
  'admin-users.js',
  'sistema-andon-sim.js',
  'scada-pro.js',
  'technician-alerts.js',
  'shift-handover.js',
  'network-health.js',
  'predictive-alerts.js',
  'command-palette.js',
  'industrial-sound-engine.js',
  'plant-map.js',
  'technician-roster.js',
  'shift-timeline.js',
  'pwa-register.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js'
];

// Instalación del Service Worker: limpia todas las cachés previas y toma control inmediato
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => caches.open(CACHE_NAME))
      .then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  );
});

// Activación: limpia cachés antiguos y recarga clientes que tuvieran código v4.2 en caché
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        clients.forEach((client) => {
          if (client.url && typeof client.navigate === 'function') {
            client.navigate(client.url).catch(() => {});
          }
        });
      })
  );
});

// Estrategia Network-First SIEMPRE (red primero, caché solo si no hay red)
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;
  if (req.url.includes('/api/') ||
      req.url.includes('google.com/recaptcha') ||
      req.url.includes('fonts.gstatic.com') ||
      req.url.includes('fonts.googleapis.com')) {
    return;
  }

  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkRes;
      })
      .catch(() => {
        return caches.match(req, { ignoreSearch: true }).then((cachedRes) => {
          if (cachedRes) return cachedRes;
          if (req.mode === 'navigate' || req.destination === 'document') {
            return caches.match('/index.html');
          }
          throw new Error('Offline resource not in cache');
        });
      })
  );
});

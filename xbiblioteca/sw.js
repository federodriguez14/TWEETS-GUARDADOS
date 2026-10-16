// Service worker: permite abrir la app sin conexión.
// Solo guarda en caché los archivos de la app; nunca las respuestas de Supabase.
const VERSION = 'xb-v1.0.0';
const SHELL = [
  './', './index.html', './config.js', './manifest.webmanifest', './css/styles.css',
  './js/app.js', './js/util.js', './js/db.js', './js/cloud.js', './js/sync.js',
  './js/xmeta.js', './js/search.js', './js/backup.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase y X: directo a la red

  // Navegación (incluye ?url=… del "Compartir"): red primero, caché si no hay conexión.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html', { ignoreSearch: true })));
    return;
  }
  // Archivos estáticos: caché y actualización en segundo plano.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => {
    const net = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => cached);
    return cached || net;
  }));
});

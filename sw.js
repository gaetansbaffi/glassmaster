/*
 * Glass Lab — service worker : cache-first des fichiers locaux, jeu jouable hors ligne après le premier
 * chargement. Changer VERSION pour publier une mise à jour : l'ancien cache est supprimé à l'activation.
 */
const VERSION = 'glasslab-v3.2.0';
const FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/three@0.170.0/three.module.min.js',
  './src/main.js',
  './src/render.js',
  './src/input.js',
  './src/hud.js',
  './src/audio.js',
  './src/settings.js',
  './src/storage.js',
  './src/core/physics.js',
  './src/core/geometry.js',
  './src/core/config.js',
  './src/core/quality.js',
  './src/core/shotgen.js',
  './src/core/rally.js',
  './src/core/stats.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Ouverture de la page (avec ou sans ?seed=, ?debug=…) : la page en cache
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(caches.match('./index.html').then((hit) => hit || fetch(req)));
    return;
  }
  // Cache d'abord ; sinon réseau, et mise en cache à l'exécution (y compris hors liste)
  event.respondWith(
    caches.match(req, { ignoreSearch: url.origin === self.location.origin }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
    )
  );
});

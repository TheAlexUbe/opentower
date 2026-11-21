// OpenTower service worker: offline shell for the free simulator.
const CACHE = 'opentower-v8';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './favicon.svg',
  './manifest.webmanifest',
  './src/config.js',
  './src/airport.js',
  './src/phraseology.js',
  './src/engine.js',
  './src/render.js',
  './src/main.js',
  './src/weather.js',
  './src/scenarios.js',
  './src/scenario-state.js',
  './src/voice.js',
  './src/tracon.js',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {})))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // live weather goes to the network

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    }),
  );
});

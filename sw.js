// OpenTower service worker: offline shell for the free simulator.
const CACHE = 'opentower-v9';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './favicon.svg',
  './manifest.webmanifest',
  './src/config.js',
  './src/airport.js',
  './src/phraseology.js',
  './src/i18n.js',
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
  './icon-maskable-192.png',
  './icon-maskable-512.png',
];

const OFFLINE_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OpenTower offline</title><body style="margin:0;background:#05080d;color:#dbe6f1;font:16px system-ui;display:grid;place-items:center;height:100vh"><main style="max-width:34rem;padding:2rem"><h1>OpenTower</h1><p>You are offline and the cached shell is not available.</p><p>Reconnect and reload to start a shift.</p></main>';

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

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // live weather goes to the network

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .catch(() => caches.match('./index.html'))
        .then((res) => res || offlineResponse())
        .catch(() => offlineResponse()),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => new Response('', { status: 503, statusText: 'Offline' }));
    }).catch(() => new Response('', { status: 503, statusText: 'Offline' })),
  );
});

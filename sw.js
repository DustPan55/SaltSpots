/* Salt Spots service worker — offline app shell + best-effort data cache */
const CACHE = 'saltspots-v8';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(async u => {
      try {
        const cross = u.startsWith('http') && !u.includes(self.location.host);
        const r = await fetch(u, cross ? { mode: 'no-cors' } : {});
        await c.put(u, r);
      } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isShell = url.origin === self.location.origin ||
    url.host.includes('unpkg.com') || url.host.includes('jsdelivr.net');

  if (isShell) {
    // cache-first for the app shell (instant launch, works offline)
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp).catch(() => {}));
      return r;
    }).catch(() => caches.match('./index.html'))));
  } else {
    // network-first for tides/weather/habitat/tiles; fall back to last cached
    e.respondWith(fetch(req).then(r => {
      const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp).catch(() => {}));
      return r;
    }).catch(() => caches.match(req)));
  }
});

/* ============================================================
   RAKSHA — sw.js (Service Worker) v10
   Strategies:
   • App shell (js, vendor, icons, fonts, manifest): CACHE-FIRST
   • Page navigations & .html: NETWORK-FIRST (fresh when online),
     falling back to the CACHE.
   • /api/*: NEVER intercepted — offline data comes from IndexedDB.
   Bump CACHE_VERSION to force a cache refresh.
   ============================================================ */
const CACHE_VERSION = 'raksha-static-v14';
const PRECACHE_URLS = [
  './',
  './index.html',
  './dashboard.html',
  './inventory.html',
  './resources.html',
  './simulator.html',
  './results.html',
  './offline-plan.html',
  './js/offline.js',
  './js/sync.js',
  './vendor/chart.umd.js',
  './icons/icon.svg',
  './manifest.json',
  './fonts/sora-600.woff2',
  './fonts/sora-700.woff2',
  './fonts/public-sans-400.woff2',
  './fonts/public-sans-500.woff2',
  './fonts/public-sans-600.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const results = await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.warn('[RAKSHA SW] Could not precache (non-fatal):', PRECACHE_URLS[i]);
    });
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n !== CACHE_VERSION ? caches.delete(n) : null)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.split('/').includes('api')) return;

  const isShell =
    url.pathname.startsWith('/js/') || url.pathname.startsWith('/vendor/') ||
    url.pathname.startsWith('/icons/') || url.pathname.startsWith('/fonts/') ||
    url.pathname.endsWith('manifest.json');

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);

    if (isShell) {
      const cached = await cache.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    }

    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const cached = await cache.match(req, req.mode === 'navigate' ? { ignoreSearch: true } : undefined);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./dashboard.html');
        if (shell) return shell;
      }
      return new Response('Offline and not cached.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
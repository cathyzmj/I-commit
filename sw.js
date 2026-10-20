// Offline cache. Bump CACHE when you add or rename files so old caches are cleared.
const CACHE = 'wct-v49';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './xlsx.js', './ics.js', './widget/commitments-widget.js', './vendor/supabase.js', './manifest.webmanifest',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first: when online you always get the newest version (and the cache is refreshed);
// the cached copy is used when offline or if the network takes longer than a few seconds.
const NETWORK_TIMEOUT_MS = 4000;
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Only the app's own files are cached; server functions (/api/…) always go to the network.
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
    try {
      const res = await Promise.race([network, timeout]);
      if (res && res.ok) return res;
      // An error page (e.g. "Site not available" if hosting is paused) shouldn't replace the app.
      if (res) { const cached = await cache.match(req, { ignoreSearch: true }); return cached || res; }
    } catch { /* offline: fall through to the cache */ }
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) { e.waitUntil(network.catch(() => {})); return cached; }
    return network; // nothing cached yet: wait for the network after all
  })());
});

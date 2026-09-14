// Service worker for the worker phone, scope /w/ (API.md clarification 12). Network-first for the page and its own files:
// online it fetches with a 3-second timeout and refreshes the cache; with no answer in time, or no signal, it serves the cache.
// So a fixed queue.js reaches installed phones on their next load with signal. Precaching adds files one at a time and
// tolerates a missing optional file (the mock files), so a deploy without them still installs. Never touches /api/*.
const VERSION = 'hcv-w-v2';
const REQUIRED = ['/w/', '/w/app.js', '/w/queue.js', '/api.js', '/time.js', '/theme.css', '/style.css', '/icons/icon.svg'];
const OPTIONAL = ['/api.mock.js', '/mock-data.js'];
const FILES = [...REQUIRED, ...OPTIONAL];
const TIMEOUT_MS = 3000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    for (const file of REQUIRED) await cache.add(file);
    for (const file of OPTIONAL) {
      try { await cache.add(file); } catch { /* not deployed: the page still works without it */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('hcv-w-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(url, path) {
  const cache = await caches.open(VERSION);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' });
    if (res.ok && !res.redirected) await cache.put(path, res.clone());
    return res;
  } catch {
    return (await cache.match(path)) || Response.error();
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const path = url.pathname === '/w/index.html' ? '/w/' : url.pathname;
  if (!FILES.includes(path)) return;
  // The page is cached as /w/ without its ?k= so every worker link opens offline.
  event.respondWith(networkFirst(url.href, path));
});

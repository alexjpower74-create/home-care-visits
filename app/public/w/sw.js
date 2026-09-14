// Service worker for the worker phone, scope /w/. Cache-first for the page and its files so the list opens with no signal.
// Never touches /api/* (those go straight to the network). Bump VERSION whenever a cached file changes.
const VERSION = 'hcv-w-v1';
const FILES = [
  '/w/', '/w/app.js', '/w/queue.js', '/api.js', '/api.mock.js', '/mock-data.js', '/time.js',
  '/theme.css', '/style.css', '/icons/icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('hcv-w-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const path = url.pathname === '/w/index.html' ? '/w/' : url.pathname;
  if (!FILES.includes(path)) return;
  // The page is cached as /w/ without its ?k= so every worker link opens offline.
  event.respondWith(caches.open(VERSION).then(c => c.match(path)).then(hit => hit || fetch(event.request)));
});

// Service worker for the worker phone, scope /w/ (API.md clarifications 12 and 16).
// - Only the real page is cached: 200, not redirected, the right Content-Type, and /w/ must carry the hcv-page marker. A Wi-Fi
//   login page answering every GET with 200 HTML can never replace the worker page.
// - The page files are one set. On a navigation the service worker fetches all of them; only when every required file arrives
//   and passes does it store them as a new set. A page is served from one set, and its modules from that same set.
// - With a cached set the network gets 3 seconds before the cached page is used; with no cached set it waits for the network.
// - It never touches /api/*.
const PREFIX = 'hcv-w-set-';
const MARKER = '<meta name="hcv-page" content="worker">';
const REQUIRED = {
  '/w/': 'text/html', '/w/app.js': 'javascript', '/w/queue.js': 'javascript', '/api.js': 'javascript', '/time.js': 'javascript',
  '/theme.css': 'text/css', '/style.css': 'text/css', '/icons/icon.svg': 'image/svg+xml',
};
const OPTIONAL = { '/api.mock.js': 'javascript', '/mock-data.js': 'javascript' };
const TYPES = { ...REQUIRED, ...OPTIONAL };
const TIMEOUT_MS = 3000;
const pins = new Map(); // page client id → the set it was served from

const typeMatches = (path, res) => (res.headers.get('content-type') || '').toLowerCase().includes(TYPES[path]);

async function checked(path, res) {
  if (res.status !== 200 || res.redirected || !typeMatches(path, res)) return null;
  const buf = await res.arrayBuffer();
  if (path === '/w/' && !new TextDecoder().decode(buf).includes(MARKER)) return null;
  return { buf, type: res.headers.get('content-type') || '' };
}

async function fetchChecked(path) {
  try {
    return await checked(path, await fetch(path, { cache: 'no-store', credentials: 'same-origin' }));
  } catch {
    return null;
  }
}

async function fetchSet() {
  const required = await Promise.all(Object.keys(REQUIRED).map(async p => [p, await fetchChecked(p)]));
  if (required.some(([, entry]) => !entry)) return null;
  const optional = await Promise.all(Object.keys(OPTIONAL).map(async p => [p, await fetchChecked(p)]));
  return new Map([...required, ...optional.filter(([, entry]) => entry)]);
}

const toResponse = entry => new Response(entry.buf, { status: 200, headers: { 'Content-Type': entry.type } });
const setNames = async () => (await caches.keys()).filter(k => k.startsWith(PREFIX)).sort();

async function storeSet(set) {
  const name = `${PREFIX}${Date.now()}`;
  const cache = await caches.open(name);
  for (const [path, entry] of set) await cache.put(path, toResponse(entry));
  // Keep this set and the one before it: a page opened a moment ago still loads its modules from its own set.
  for (const old of (await setNames()).filter(k => k < name).slice(0, -1)) await caches.delete(old);
  return name;
}

async function refresh() {
  const set = await fetchSet();
  return set ? storeSet(set) : null;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (!(await refresh())) throw new Error('The worker page did not come through, so nothing was cached.');
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('hcv-w-v')).map(k => caches.delete(k)))) // the single caches before M3b
    .then(() => self.clients.claim()));
});

async function servePage(event, refreshing) {
  let name = (await setNames()).at(-1) ?? null;
  if (!name) {
    name = await refreshing; // no copy: wait for the network, with no time limit
    if (!name) return fetch(event.request); // not the real page (a login page): show it, cache nothing
  } else {
    const fresh = await Promise.race([refreshing, new Promise(resolve => setTimeout(() => resolve(null), TIMEOUT_MS))]);
    if (fresh) name = fresh;
  }
  if (event.resultingClientId) pins.set(event.resultingClientId, name);
  return (await (await caches.open(name)).match('/w/')) ?? fetch(event.request);
}

async function serveFile(event, path) {
  const name = pins.get(event.clientId) ?? (await setNames()).at(-1);
  if (name) {
    const hit = await (await caches.open(name)).match(path);
    if (hit) return hit;
  }
  return fetch(event.request); // no copy: the network, with no time limit
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const path = url.pathname === '/w/index.html' ? '/w/' : url.pathname;
  if (!(path in TYPES)) return;
  if (event.request.mode === 'navigate' && path === '/w/') {
    const refreshing = refresh().catch(() => null);
    event.waitUntil(refreshing);
    event.respondWith(servePage(event, refreshing));
  } else {
    event.respondWith(serveFile(event, path));
  }
});

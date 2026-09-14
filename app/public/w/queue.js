// The phone's offline queue (PLAN.md, hc2 M1, "Offline queue", rules 1–6).
// IndexedDB `home-care-visits`: store `queue` (autoincrement `seq`, oldest first) and store `refused`.
// An item: { seq, event, key, worker_id, client_name, time_label, office_phone, tz, saved_at, key_refused }.
const DB_NAME = 'home-care-visits';
const BACKOFF_MS = [5000, 15000, 30000, 60000];
const TICK_MS = 20000;
const TIMEOUT_MS = 30000;

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'seq', autoIncrement: true });
      if (!db.objectStoreNames.contains('refused')) db.createObjectStore('refused', { keyPath: 'seq' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const txDone = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
});
const reqValue = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

function timeoutSignal(ms) {
  if (AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/**
 * send(key, event, signal) → { status, data } (throws on a network error or timeout).
 * onChange() after anything the page should redraw; onSent() after the office accepted or refused something.
 */
export function createQueue({ send, onChange = () => {}, onSent = () => {} }) {
  const ready = openDb();
  let pageKey = null, pageWorkerId = null, pageKeyRefused = false;
  let failures = 0, retryAt = 0, retryTimer = null, tick = null;
  let running = false, again = false;

  // Rule 5: an item whose own key is refused goes out with the page's key only for the worker that key loaded.
  const canRekey = item => !!pageKey && pageWorkerId != null && !pageKeyRefused && item.worker_id === pageWorkerId;

  async function contents() {
    const db = await ready;
    const tx = db.transaction(['queue', 'refused']);
    const [queue, refused] = await Promise.all([reqValue(tx.objectStore('queue').getAll()), reqValue(tx.objectStore('refused').getAll())]);
    return { queue, refused };
  }

  // Rule 1: the event is on disk (transaction complete) before any network call is made for it.
  async function add(event, meta) {
    const db = await ready;
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').add({ event, key: meta.key, worker_id: meta.worker_id, client_name: meta.client_name ?? '',
      time_label: meta.time_label ?? '', office_phone: meta.office_phone ?? '', tz: meta.tz ?? '', saved_at: Date.now(), key_refused: false });
    await txDone(tx);
    onChange();
    kick();
  }

  // One readwrite transaction: read the item, and only if it is still there apply fn(store, item).
  async function withItem(stores, seq, fn) {
    const db = await ready;
    const tx = db.transaction(stores, 'readwrite');
    const q = tx.objectStore('queue');
    const g = q.get(seq);
    g.onsuccess = () => { if (g.result) fn(tx, g.result); };
    await txDone(tx);
  }
  // Rule 3, 200/201: delete in the same transaction that confirms the item is still queued.
  const confirmSent = seq => withItem(['queue'], seq, tx => tx.objectStore('queue').delete(seq));
  // Rule 3, 400/404/409: move to `refused` with the server's words; never retried, never dropped.
  const moveToRefused = (seq, data) => withItem(['queue', 'refused'], seq, (tx, item) => {
    tx.objectStore('queue').delete(seq);
    tx.objectStore('refused').put({ ...item, error: data?.error || 'The office did not accept this.', code: data?.code ?? null, refused_at: Date.now() });
  });
  const patch = (seq, fields) => withItem(['queue'], seq, (tx, item) => tx.objectStore('queue').put({ ...item, ...fields }));

  async function post(key, event) {
    try { return await send(key, event, timeoutSignal(TIMEOUT_MS)); } catch { return null; }
  }

  // → 'sent' | 'refused' | 'held' | 'retry'
  async function sendItem(item) {
    let key = item.key;
    if (item.key_refused) {
      if (!canRekey(item)) return 'held';
      key = pageKey;
      await patch(item.seq, { key, key_refused: false });
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await post(key, item.event);
      const s = res?.status;
      if (s === 200 || s === 201) { await confirmSent(item.seq); return 'sent'; }
      if (s === 400 || s === 404 || s === 409) { await moveToRefused(item.seq, res.data); return 'refused'; }
      if (s !== 401) return 'retry'; // 429, 5xx, network error, timeout, anything unexpected: keep it
      if (key === pageKey) { pageKeyRefused = true; return 'held'; }
      await patch(item.seq, { key_refused: true });
      if (!canRekey(item)) return 'held';
      key = pageKey;
      await patch(item.seq, { key, key_refused: false });
    }
    return 'held';
  }

  // Rule 2: oldest first; a visit's later event waits while an earlier one for it is still queued.
  async function drain() {
    if (!navigator.onLine) return;
    const { queue } = await contents();
    const waiting = new Set();
    let answered = false;
    for (const item of queue) {
      const visit = item.event.visit_id;
      if (waiting.has(visit)) continue;
      const result = await sendItem(item);
      if (result === 'retry') {
        failures += 1;
        retryAt = Date.now() + BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => kick(false), retryAt - Date.now());
        if (answered) onSent();
        return;
      }
      if (result === 'held') waiting.add(visit);
      else answered = true;
    }
    failures = 0;
    retryAt = 0;
    clearTimeout(retryTimer);
    if (answered) onSent();
  }

  function withLock(fn) {
    if (!navigator.locks?.request) return fn();
    const opts = document.visibilityState === 'hidden' ? { ifAvailable: true } : {};
    return navigator.locks.request('hcv-send', opts, async lock => { if (lock) await fn(); });
  }

  async function run() {
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        try { await withLock(drain); } catch (e) { console.warn('queue send failed', e); }
      } while (again);
      // Rule 4: every 20 s while anything is queued.
      const { queue } = await contents();
      if (queue.length && !tick) tick = setInterval(() => kick(false), TICK_MS);
      if (!queue.length && tick) { clearInterval(tick); tick = null; }
    } catch (e) {
      console.warn('queue', e);
    } finally {
      running = false;
      onChange();
    }
  }

  /** force: a new event, `online` or a visible tab try at once; the timers respect the backoff. */
  function kick(force = true) {
    if (!force && Date.now() < retryAt) return;
    run();
  }

  function start() {
    addEventListener('online', () => kick());
    addEventListener('offline', () => onChange());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
    kick();
  }

  return {
    ready, contents, add, kick, start,
    /** The page's key loaded the visits of workerId (live: just now from the server, so the key works). */
    setPage(key, workerId, { live = false } = {}) {
      pageKey = key;
      pageWorkerId = workerId;
      if (live) pageKeyRefused = false;
      kick();
    },
    setPageKeyRefused() { pageKeyRefused = true; onChange(); },
    status: () => ({ failures, retryAt, pageKeyRefused }),
    /** Saved under a key that is refused and cannot be re-sent with the page's key. */
    isHeld: item => !!item.key_refused && !canRekey(item),
    async removeRefused(seq) {
      const db = await ready;
      const tx = db.transaction('refused', 'readwrite');
      tx.objectStore('refused').delete(seq);
      await txDone(tx);
      onChange();
    },
    async removeHeld(seq) {
      await withItem(['queue'], seq, (tx, item) => { if (item.key_refused) tx.objectStore('queue').delete(seq); });
      onChange();
    },
  };
}

// Worker phone: today's visits, Navigate, Check in (location never blocks), tasks + note, Check out, offline queue.
import { workerVisits, postWorkerEvent, getAgency } from '../api.js';
import { createQueue } from './queue.js';
import { TZ, timeLabel, localDate, esc, telHref } from '../time.js';

const key = new URLSearchParams(location.search).get('k') || '';
const CACHE_PREFIX = 'hcv:visits:';
const DRAFT_PREFIX = 'hcv:draft:';
const $ = id => document.getElementById(id);

const S = {
  answer: null, agency: null, savedAt: null, stale: false, noList: false, keyRefused: false,
  loading: false, reloadAgain: false, items: [], refused: [], openId: null, openChosen: false,
  locating: null, sheetFor: null, sheetOpened: false, confirming: false, error: null,
};
let skipLocation = null;

const queue = createQueue({
  send: (k, event, signal) => postWorkerEvent(k, event, signal),
  onChange: () => refreshQueue(),
  onSent: () => load(),
});

const tz = () => S.answer?.agency?.timezone || TZ;
const agencyInfo = () => S.answer?.agency || S.agency;

/* ---------- storage ---------- */
function ls(fn, fallback = null) { try { return fn(localStorage); } catch { return fallback; } }

function saveList(answer) {
  ls(s => s.setItem(`${CACHE_PREFIX}${answer.worker.id}:${answer.date}`, JSON.stringify({ saved_at: Date.now(), key, answer })));
  const oldest = localDate(Date.now() - 8 * 86400000, answer.agency.timezone || TZ);
  ls(s => {
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i);
      if (k?.startsWith(CACHE_PREFIX) && k.slice(-10) < oldest) s.removeItem(k);
    }
  });
}

function readSavedList() {
  return ls(s => {
    let best = null;
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k?.startsWith(CACHE_PREFIX)) continue;
      try {
        const rec = JSON.parse(s.getItem(k));
        const today = localDate(Date.now(), rec.answer?.agency?.timezone || TZ);
        if (rec.key === key && rec.answer?.date === today && (!best || rec.saved_at > best.saved_at)) best = rec;
      } catch { /* a damaged entry is ignored */ }
    }
    return best;
  });
}

const draftOf = id => ls(s => JSON.parse(s.getItem(DRAFT_PREFIX + id)), null) || { done: {}, note: '' };
const saveDraft = (id, d) => ls(s => s.setItem(DRAFT_PREFIX + id, JSON.stringify(d)));
const clearDraft = id => ls(s => s.removeItem(DRAFT_PREFIX + id));

/** Trimmed at send time; while typing: \r\n → \n, at most 2 lines, at most 200 characters. */
function clampNote(s) {
  let t = s.replace(/\r\n?/g, '\n');
  const lines = t.split('\n');
  if (lines.length > 2) t = `${lines[0]}\n${lines.slice(1).join(' ')}`;
  return t.slice(0, 200);
}

/* ---------- loading ---------- */
async function load() {
  if (!key) { await loadAgency(); render(); return; }
  if (S.loading) { S.reloadAgain = true; return; }
  S.loading = true;
  try {
    const r = await workerVisits(key);
    if (r.status === 200) {
      Object.assign(S, { answer: r.data, savedAt: Date.now(), stale: false, noList: false, keyRefused: false });
      saveList(r.data);
      queue.setPage(key, r.data.worker.id, { live: true });
    } else if (r.status === 401) {
      S.keyRefused = true;
      queue.setPageKeyRefused();
      await loadAgency();
    } else {
      throw new Error(`visits answered ${r.status}`);
    }
  } catch {
    if (!S.answer) {
      const rec = readSavedList();
      if (rec) {
        Object.assign(S, { answer: rec.answer, savedAt: rec.saved_at });
        queue.setPage(key, rec.answer.worker.id);
      }
    }
    S.stale = !!S.answer;
    S.noList = !S.answer;
  } finally {
    S.loading = false;
  }
  render();
  if (S.reloadAgain) { S.reloadAgain = false; load(); }
}

async function loadAgency() {
  if (S.agency) return;
  try { const r = await getAgency(); if (r.ok) S.agency = r.data; } catch { /* header stays generic */ }
}

async function refreshQueue() {
  try {
    const { queue: items, refused } = await queue.contents();
    S.items = items;
    S.refused = refused;
  } catch {
    S.error = "This phone can't save visits right now (storage is blocked). Check in with the office by phone.";
  }
  render();
}

/* ---------- visit state = the answer plus the queue ---------- */
function view(v) {
  const mine = S.items.filter(i => i.event.visit_id === v.id);
  const qIn = mine.find(i => i.event.kind === 'check_in');
  const qOut = mine.find(i => i.event.kind === 'check_out');
  const cin = v.check_in ? { label: v.check_in.at_label, where: v.check_in.location_label, saved: false }
    : qIn ? { label: timeLabel(qIn.event.at, tz()), where: 'saved on this phone', saved: true } : null;
  const cout = v.check_out ? { label: v.check_out.at_label, saved: false }
    : qOut ? { label: timeLabel(qOut.event.at, tz()), saved: true } : null;
  const status = cout ? 'done' : cin ? 'in' : v.cancelled ? 'cancelled' : 'todo';
  const tasksDone = v.check_out ? v.tasks_done : qOut ? qOut.event.tasks : [];
  const note = v.check_out ? v.note?.text : qOut?.event.note;
  return { v, cin, cout, status, tasksDone: tasksDone.filter(t => t.done), note };
}

function statusLine(x) {
  if (x.status === 'done') return `Done ${x.cin?.label ?? ''} – ${x.cout.label}${x.cin?.saved || x.cout.saved ? ' · saved on this phone' : ''}`;
  if (x.status === 'in') return `Checked in ${x.cin.label} · ${x.cin.where}`;
  if (x.status === 'cancelled') return 'Cancelled by the office';
  return '';
}

const isApple = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const navigateHref = v => (isApple()
  ? `https://maps.apple.com/?daddr=${v.lat},${v.lng}&dirflg=d`
  : `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`);
const TICK = '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ---------- rendering ---------- */
function bodyHtml(x) {
  const { v } = x;
  if (x.status === 'todo') {
    const gettingIn = v.entry_notes ? `<div class="getting-in"><h3>Getting in</h3><p>${esc(v.entry_notes)}</p></div>` : '';
    const action = S.locating === v.id
      ? `<div class="locating" role="status"><p>Getting location…</p><button type="button" class="btn btn-outline" data-act="skip-location">Skip location</button></div>`
      : `<button type="button" class="btn btn-big btn-check-in" data-act="check-in" data-visit="${v.id}">Check in</button>`;
    return `${gettingIn}<a class="btn btn-outline" href="${esc(navigateHref(v))}" target="_blank" rel="noopener noreferrer">Navigate</a>${action}`;
  }
  if (x.status === 'in') {
    const d = draftOf(v.id);
    const tasks = v.tasks.map(t => `<label class="task"><input type="checkbox" data-act="task" data-visit="${v.id}" data-task="${t.id}"${d.done[t.id] ? ' checked' : ''}>
      <span class="task-text"><span class="task-label">${esc(t.label)}</span>${t.detail ? `<span class="task-detail">${esc(t.detail)}</span>` : ''}${t.kind === 'medication_reminder' ? '<span class="task-note">Reminder only. This app doesn\'t record medication given.</span>' : ''}</span></label>`).join('');
    return `<fieldset class="tasks"><legend>Tasks</legend>${tasks}</fieldset>
      <div class="field"><label for="note-${v.id}">Note (two short lines)</label>
      <textarea id="note-${v.id}" data-act="note" data-visit="${v.id}" rows="2" maxlength="200" autocomplete="off">${esc(d.note)}</textarea>
      <p class="counter" id="count-${v.id}">${d.note.length} / 200</p></div>
      <button type="button" class="btn btn-big btn-check-out" data-act="check-out" data-visit="${v.id}">Check out</button>`;
  }
  if (x.status === 'done') {
    const ticks = x.tasksDone.length ? `<ul class="ticks">${x.tasksDone.map(t => `<li>${TICK}<span>${esc(t.label)}</span></li>`).join('')}</ul>` : '<p class="muted">No tasks ticked.</p>';
    return `${ticks}${x.note ? `<blockquote class="quote">${esc(x.note)}</blockquote>` : ''}`;
  }
  return '';
}

function cardHtml(x) {
  const { v } = x;
  const open = S.openId === v.id && x.status !== 'cancelled';
  const town = (v.address || '').split(',')[0];
  const line = statusLine(x);
  return `<li class="visit visit--${x.status}${open ? ' is-open' : ''}" data-visit="${v.id}">
    <button type="button" class="visit-head" data-act="toggle" data-visit="${v.id}" aria-expanded="${open}">
      <span class="visit-time">${esc(v.time_label)}</span>
      <span class="visit-who"><span class="avatar" aria-hidden="true">${esc(v.client_initials)}</span><span class="visit-name">${esc(v.client_name)}</span></span>
      <span class="visit-town">${esc(town)}</span>
      ${line ? `<span class="visit-status">${esc(line)}</span>` : ''}
    </button>
    ${open ? `<div class="visit-body">${bodyHtml(x)}</div>` : ''}
  </li>`;
}

const kindWord = k => (k === 'check_in' ? 'Check-in' : 'Check-out');

function refusedHtml() {
  if (!S.refused.length) return '';
  return `<section class="panel panel-bad" aria-labelledby="refused-h"><h2 id="refused-h">Not accepted by the office</h2><ul class="plain">${
    S.refused.map(i => `<li class="refused-item">
      <p><strong>${kindWord(i.event.kind)}</strong> for ${esc(i.client_name)}, tapped at ${esc(timeLabel(i.event.at, i.tz || tz()))}</p>
      <p class="server-words">${esc(i.error)}</p>
      <p>Ask the office to fix it${i.office_phone ? `: <a href="${telHref(i.office_phone)}">${esc(i.office_phone)}</a>` : '.'}</p>
      <button type="button" class="btn btn-outline" data-act="remove-refused" data-seq="${i.seq}">Remove</button></li>`).join('')}</ul></section>`;
}

function heldHtml() {
  const held = S.items.filter(i => queue.isHeld(i));
  if (!held.length) return '';
  return `<section class="panel panel-bad" aria-labelledby="held-h"><h2 id="held-h">Saved under an old link for another worker</h2><ul class="plain">${
    held.map(i => `<li><p><strong>${kindWord(i.event.kind)}</strong> for ${esc(i.client_name)}, tapped at ${esc(timeLabel(i.event.at, i.tz || tz()))}</p>
      <p>This link can't send it. Ask the office${i.office_phone ? ` (<a href="${telHref(i.office_phone)}">${esc(i.office_phone)}</a>)` : ''} what to do, then remove it.</p>
      <button type="button" class="btn btn-outline" data-act="remove-held" data-seq="${i.seq}">Remove</button></li>`).join('')}</ul></section>`;
}

function mainHtml() {
  const out = [];
  if (S.error) out.push(`<div class="notice notice-bad" role="alert">${esc(S.error)}</div>`);
  const refusedKey = S.keyRefused || queue.status().pageKeyRefused;
  if (!key) out.push('<div class="notice notice-bad" role="alert">This page needs the link the office gave you. Ask the office for your link.</div>');
  else if (refusedKey) out.push(`<div class="notice notice-bad" role="alert">This link doesn't work any more. Ask the office for a new one.</div>`);
  else if (S.answer) {
    if (S.stale) out.push(`<p class="notice notice-saved">Saved list from ${esc(timeLabel(S.savedAt, tz()))}</p>`);
    const xs = S.answer.visits.map(view);
    if (!S.openChosen) S.openId = (xs.find(x => x.status === 'in') || xs.find(x => x.status === 'todo'))?.v.id ?? null;
    out.push(xs.length ? `<ol class="visits">${xs.map(cardHtml).join('')}</ol>` : '<p class="empty">No visits for you today.</p>');
  } else if (S.noList) {
    out.push("<p class=\"notice notice-saved\">No saved list on this phone yet. Find signal once to load today's visits.</p>");
  } else {
    out.push("<p class=\"empty\">Loading today's visits…</p>");
  }
  out.push(heldHtml(), refusedHtml());
  return out.join('');
}

function stripState() {
  const n = S.items.length;
  const q = queue.status();
  let state, text;
  if (!navigator.onLine) {
    state = 'offline';
    text = n ? `No signal. ${n} saved on this phone. They send when signal comes back and keep the time you tapped.` : 'No signal. Nothing is waiting to send.';
  } else if (!n) {
    [state, text] = ['sent', 'All sent'];
  } else if (q.failures) {
    [state, text] = ['waiting', `${n} saved on this phone. Trying again soon. They keep the time you tapped.`];
  } else {
    [state, text] = ['sending', `Sending ${n} saved on this phone…`];
  }
  if (S.refused.length) text = `${text.replace(/[.…]$/, '')}. ${S.refused.length} not accepted by the office.`;
  return { state, text };
}

function sheetHtml() {
  const v = S.answer?.visits.find(x => x.id === S.sheetFor);
  if (!v) return '';
  const d = draftOf(v.id);
  const ticked = v.tasks.filter(t => d.done[t.id]).length;
  const note = clampNote(d.note).trim();
  return `<div class="sheet-back" data-act="sheet-back"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <h2 id="sheet-title" tabindex="-1">Check out now?</h2>
    <p><strong>${esc(v.client_name)}</strong></p>
    <p>${ticked} of ${v.tasks.length} tasks ticked</p>
    ${note ? `<blockquote class="quote">${esc(note)}</blockquote>` : '<p class="muted">No note</p>'}
    <button type="button" class="btn btn-big btn-check-out" data-act="confirm-check-out"${S.confirming ? ' disabled' : ''}>Yes, check out</button>
    <button type="button" class="btn btn-outline" data-act="sheet-cancel">Not yet</button>
  </div></div>`;
}

// Only touch the DOM when the markup changed: a redraw on every queue tick would pull a button out from under a finger.
const drawn = new WeakMap();
function setHtml(el, html) {
  if (drawn.get(el) === html) return false;
  drawn.set(el, html);
  el.innerHTML = html;
  return true;
}

function render() {
  const a = agencyInfo();
  $('agency').textContent = a?.name || 'Home Care Visits';
  $('badge').hidden = !a?.sample;
  $('today').textContent = S.answer ? `Today, ${S.answer.date_label}` : '';
  const me = $('me');
  me.hidden = !S.answer;
  if (S.answer) { me.textContent = S.answer.worker.initials; me.title = S.answer.worker.name; }

  const strip = stripState();
  $('strip').dataset.state = strip.state;
  if ($('strip-text').textContent !== strip.text) $('strip-text').textContent = strip.text;

  // Redraw without losing the note the worker is typing.
  const active = document.activeElement;
  const focusId = active?.id && active.tagName === 'TEXTAREA' ? active.id : null;
  const sel = focusId ? [active.selectionStart, active.selectionEnd] : null;
  if (setHtml($('main'), mainHtml()) && focusId && $(focusId)) { $(focusId).focus(); $(focusId).setSelectionRange(...sel); }

  const phone = a?.office_phone;
  // The answer has no legs list; a leg exists once the server holds two check-ins today (DECISIONS 22).
  const legs = (S.answer?.visits.filter(v => v.check_in).length ?? 0) - 1;
  const mileage = legs >= 1 ? S.answer.mileage : null;
  setHtml($('foot'), `${mileage ? `<p>${esc(mileage.km)} km between visits today (straight line)</p>` : ''}${phone ? `<p>Office: <a href="${telHref(phone)}">${esc(phone)}</a></p>` : ''}`);

  setHtml($('sheet-root'), sheetHtml());
  if (S.sheetOpened && S.sheetFor) { S.sheetOpened = false; $('sheet-title')?.focus(); }
}

/* ---------- actions ---------- */
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const findVisit = id => S.answer?.visits.find(v => v.id === id);
const metaFor = v => ({ key, worker_id: S.answer.worker.id, client_name: v.client_name, time_label: v.time_label,
  office_phone: S.answer.agency.office_phone, tz: tz() });

/** Resolves with { lat, lng, accuracy_m } or null (denied, error, timeout, Skip). Never rejects, never blocks the visit. */
function getLocation() {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; skipLocation = null; resolve(value); } };
    skipLocation = () => finish(null);
    if (!navigator.geolocation) return finish(null);
    try {
      navigator.geolocation.getCurrentPosition(
        p => finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) }),
        () => finish(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
      // The 8 s timeout only starts once permission is given; a prompt nobody answers must not hold the visit either.
      setTimeout(() => finish(null), 10000);
    } catch { finish(null); }
  });
}

async function checkIn(id) {
  const v = findVisit(id);
  if (!v || S.locating != null || view(v).status !== 'todo') return;
  const at = new Date().toISOString(); // the time the worker tapped
  S.locating = id;
  render();
  const location = await getLocation();
  try {
    await queue.add({ id: uuid(), visit_id: id, kind: 'check_in', at, location }, metaFor(v));
  } catch {
    S.error = "This phone couldn't save the check-in. Try again, or call the office.";
  } finally {
    S.locating = null;
  }
  // The visit just checked in stays open for its tasks, even if an earlier one is also checked in.
  S.openId = id;
  S.openChosen = true;
  await refreshQueue();
}

async function confirmCheckOut() {
  const v = findVisit(S.sheetFor);
  if (!v || S.confirming) return;
  const at = new Date().toISOString(); // taken at "Yes, check out"
  S.confirming = true;
  const d = draftOf(v.id);
  const event = { id: uuid(), visit_id: v.id, kind: 'check_out', at,
    tasks: v.tasks.map(t => ({ task_id: t.id, kind: t.kind, label: t.label, done: !!d.done[t.id] })) };
  const note = clampNote(d.note).trim();
  if (note) event.note = note;
  try {
    await queue.add(event, metaFor(v));
    clearDraft(v.id);
    S.sheetFor = null;
    S.openChosen = false;
  } catch {
    S.error = "This phone couldn't save the check-out. Try again, or call the office.";
  } finally {
    S.confirming = false;
  }
  await refreshQueue();
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const id = Number(t.dataset.visit);
  switch (t.dataset.act) {
    case 'toggle':
      S.openId = S.openId === id ? null : id;
      S.openChosen = true;
      render();
      break;
    case 'check-in': checkIn(id); break;
    case 'skip-location': skipLocation?.(); break;
    case 'check-out': S.sheetFor = id; S.sheetOpened = true; render(); break;
    case 'sheet-cancel': S.sheetFor = null; render(); break;
    case 'sheet-back': if (e.target === t) { S.sheetFor = null; render(); } break;
    case 'confirm-check-out': confirmCheckOut(); break;
    case 'remove-refused': queue.removeRefused(Number(t.dataset.seq)); break;
    case 'remove-held': queue.removeHeld(Number(t.dataset.seq)); break;
    default: break;
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset?.act !== 'task') return;
  const id = Number(t.dataset.visit);
  const d = draftOf(id);
  d.done[t.dataset.task] = t.checked;
  saveDraft(id, d);
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset?.act !== 'note') return;
  const clamped = clampNote(t.value);
  if (clamped !== t.value) t.value = clamped;
  const id = Number(t.dataset.visit);
  saveDraft(id, { ...draftOf(id), note: t.value });
  $(`count-${id}`).textContent = `${t.value.length} / 200`;
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheetFor) { S.sheetFor = null; render(); }
});

addEventListener('online', () => { render(); load(); });
addEventListener('offline', () => render());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/w/sw.js', { scope: '/w/' }).catch(() => {});
refreshQueue();
load();
queue.start();

// Today board. The late/missed rule runs on the page's own clock: every 15 s (with a reload of the day), after every load,
// and exactly at the next 15- or 30-minute mark of any visit, so amber appears at 15:00 without waiting for a tick.
import { office, errorText, esc, telHref } from './core.js';
import { openVisitSheet } from './sheet.js';
import { alertFor, nextAlertChange } from '../rules.js';
import { localDate, TZ } from '../time.js';

const WORDS = {
  late: 'Late: not checked in 15 minutes after the start',
  missed: 'Missed: not checked in 30 minutes after the start',
};
const TICK_MS = 15000;

export function mount(el, ctx) {
  const tz = ctx.agency.timezone || TZ;
  let data = null;
  let error = '';
  let alive = true;
  let boundary = null;

  el.innerHTML = `<section class="board" aria-labelledby="board-title">
    <div class="view-head"><h1 id="board-title">Today</h1><p class="muted" id="board-date"></p></div>
    <p class="notice notice-bad" id="board-error" role="alert" hidden></p>
    <ul class="counts plain" id="board-counts"></ul>
    <ol class="board-rows plain" id="board-rows"><li class="empty">Loading today's visits…</li></ol>
  </section>`;
  const q = s => el.querySelector(s);

  async function load() {
    const r = await office('GET', `/api/office/day?date=${localDate(Date.now(), tz)}`);
    if (!alive) return;
    if (r.ok) { data = r.data; error = ''; } else if (r.status !== 401) error = errorText(r);
    paint();
  }

  function rowHtml({ v, alert }) {
    const worker = v.worker_name ? esc(v.worker_name) : 'No worker assigned';
    let status;
    if (alert !== 'none') {
      const call = v.worker_name && v.worker_phone
        ? `<a class="call" href="${telHref(v.worker_phone)}">Call ${esc(v.worker_name)}: ${esc(v.worker_phone)}</a>`
        : '<span class="call">No worker assigned</span>';
      status = `<span class="row-status"><strong>${WORDS[alert]}</strong></span>${call}`;
    } else {
      const extra = [v.late_label, v.visited_after_cancel ? 'Visited after it was cancelled' : null].filter(Boolean).map(esc);
      status = `<span class="row-status">${esc(v.status_label)}${extra.length ? ` · ${extra.join(' · ')}` : ''}</span>`;
    }
    return `<li class="board-row" data-visit-id="${v.id}" data-alert="${alert}" data-status="${esc(v.status)}">
      <span class="row-time${v.cancelled ? ' is-cancelled' : ''}">${esc(v.time_label)}</span>
      <button type="button" class="row-client" data-open-visit="${v.id}">${esc(v.client_name)}</button>
      <span class="row-worker">${worker}</span>${status}</li>`;
  }

  function paint() {
    if (!alive) return;
    const now = Date.now();
    clearTimeout(boundary);
    q('#board-error').hidden = !error;
    q('#board-error').textContent = error;
    if (!data) return;
    q('#board-date').textContent = data.date_label;
    const rows = data.visits.map(v => ({ v, alert: alertFor(v, now) }));
    const count = fn => rows.filter(fn).length;
    const counts = [
      ['Missed', count(r => r.alert === 'missed')],
      ['Late', count(r => r.alert === 'late')],
      ['Checked in', count(r => r.v.status === 'checked_in')],
      ['Done', count(r => r.v.status === 'checked_out')],
      ['Upcoming', count(r => r.alert === 'none' && (r.v.status === 'scheduled' || r.v.status === 'unassigned'))],
    ];
    q('#board-counts').innerHTML = counts.map(([label, n]) =>
      `<li data-count="${label}"><span class="count-n">${n}</span>${label}</li>`).join('');
    q('#board-rows').innerHTML = rows.length ? rows.map(rowHtml).join('') : '<li class="empty">No visits today.</li>';
    const next = nextAlertChange(data.visits, now);
    if (next !== Infinity) boundary = setTimeout(paint, next - now);
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-open-visit]');
    const v = b && data?.visits.find(x => x.id === Number(b.dataset.openVisit));
    if (v) openVisitSheet(v, load);
  });

  load();
  const tick = setInterval(load, TICK_MS);
  return () => {
    alive = false;
    clearInterval(tick);
    clearTimeout(boundary);
  };
}

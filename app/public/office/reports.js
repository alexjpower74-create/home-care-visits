// Reports: Payroll (per-client rows and the incomplete list), Billing by funder, Missed and late, Mileage (straight line).
// Every number shown is the Worker's; the page adds nothing up. Download CSV fetches the Worker's own bytes with the token.
import { office, errorText, esc, getToken, endSession, showErrors, NETWORK } from './core.js';
import { localDate, addDays, mondayOf, TZ } from '../time.js';

const KINDS = [['payroll', 'Payroll'], ['billing', 'Billing'], ['missed', 'Missed and late'], ['mileage', 'Mileage']];
// Scheduled minutes as decimal hours, with the API's rounding (half up, from whole seconds).
const scheduledHours = minutes => (Math.floor((minutes * 60 * 100 + 1800) / 3600) / 100).toFixed(2);
const table = (id, head, body, foot = '') => `<div class="table-scroll"><table class="report" id="${id}">
  <thead><tr>${head.map(([label, cls]) => `<th scope="col"${cls ? ` class="${cls}"` : ''}>${label}</th>`).join('')}</tr></thead>
  <tbody>${body}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div>`;

function payrollHtml(d) {
  const totalHours = d.total.hours;
  const body = d.rows.map(w => `<tr class="row-worker" data-worker-id="${w.worker_id}"><th scope="row">${esc(w.worker_name)}</th>
      <td class="num">${w.visits}</td><td class="num hours">${esc(w.hours)}</td><td class="num">${esc(w.hm_label)}</td></tr>${
    w.clients.map(c => `<tr class="row-sub" data-worker-id="${w.worker_id}" data-client-id="${c.client_id}"><td class="indent">${esc(c.client_name)}</td>
      <td class="num">${c.visits}</td><td class="num hours">${esc(c.hours)}</td><td class="num">${esc(c.hm_label)}</td></tr>`).join('')}`).join('');
  const foot = `<tr id="payroll-total"><th scope="row">Total</th><td class="num">${d.total.visits}</td>
    <td class="num hours">${esc(totalHours)}</td><td class="num">${esc(d.total.hm_label)}</td></tr>`;
  const incomplete = d.incomplete.length
    ? `<ul class="plain incomplete" id="payroll-incomplete">${d.incomplete.map(i => `<li data-visit-id="${i.visit_id}">${esc(i.worker_name)} · ${esc(i.client_name)} · ${esc(i.date_label)}, checked in ${esc(i.check_in_label)}</li>`).join('')}</ul>`
    : '<p class="muted" id="payroll-incomplete">None.</p>';
  return `<p class="muted report-note">${esc(d.note)}</p>
    ${d.rows.length ? table('payroll-table', [['Worker and client'], ['Visits', 'num'], ['Hours', 'num'], ['Hours and minutes', 'num']], body, foot)
    : '<p class="empty">No finished visits in this period.</p>'}
    <h2 class="report-sub">Checked in, not checked out</h2>${incomplete}`;
}

function billingHtml(d) {
  const body = d.funders.map(f => {
    const minutes = f.clients.reduce((sum, c) => sum + c.scheduled_minutes, 0);
    return `<tr class="row-funder" data-funder-id="${f.funder_id}"><th scope="row">${esc(f.funder_name)}</th><td class="num">${f.visits}</td>
      <td class="num">${scheduledHours(minutes)}</td><td class="num hours">${esc(f.hours)}</td><td class="num">${esc(f.hm_label)}</td></tr>${
      f.clients.map(c => `<tr class="row-sub" data-client-id="${c.client_id}"><td class="indent">${esc(c.client_name)}</td><td class="num">${c.visits}</td>
        <td class="num">${scheduledHours(c.scheduled_minutes)}</td><td class="num hours">${esc(c.hours)}</td><td class="num">${esc(c.hm_label)}</td></tr>`).join('')}`;
  }).join('');
  const foot = `<tr id="billing-total"><th scope="row">Total</th><td class="num">${d.total.visits}</td><td class="num"></td>
    <td class="num hours">${esc(d.total.hours)}</td><td class="num">${esc(d.total.hm_label)}</td></tr>`;
  return `<p class="muted report-note">${esc(d.note)}</p>${d.funders.length
    ? table('billing-table', [['Funder and client'], ['Visits', 'num'], ['Scheduled hours', 'num'], ['Hours worked', 'num'], ['Hours and minutes', 'num']], body, foot)
    : '<p class="empty">No finished visits in this period.</p>'}`;
}

function missedHtml(d) {
  const body = d.rows.map(r => `<tr data-visit-id="${r.visit_id}" data-what="${esc(r.what)}"><td>${esc(r.date_label)}</td><td>${esc(r.time_label)}</td>
    <td>${esc(r.client_name)}</td><td>${esc(r.worker_name ?? 'No worker')}</td><td class="what-${esc(r.what)}">${esc(r.what_label)}</td></tr>`).join('');
  return d.rows.length
    ? table('missed-table', [['Date'], ['Scheduled'], ['Client'], ['Worker'], ['What happened']], body)
    : '<p class="empty">No missed or late visits in this period.</p>';
}

function mileageHtml(d) {
  const days = d.rows.map(r => `<section class="mileage-day" data-mileage-worker="${r.worker_id}" data-date="${esc(r.date)}">
    <h3>${esc(r.worker_name)} · ${esc(r.date_label)} · ${esc(r.km)} km</h3>
    <ul class="plain">${r.legs.map(l => `<li>${esc(l.from_client)} to ${esc(l.to_client)}: ${esc(l.km)} km</li>`).join('')}</ul></section>`).join('');
  const totals = d.total.length
    ? `<h2 class="report-sub">Totals</h2><ul class="plain" id="mileage-total">${d.total.map(t => `<li data-worker-id="${t.worker_id}">${esc(t.worker_name)}: ${esc(t.km)} km (straight line)</li>`).join('')}</ul>`
    : '';
  return `<p class="muted report-note">${esc(d.note)}</p>${days || '<p class="empty">No day with two check-ins in this period.</p>'}${totals}`;
}

const RENDER = { payroll: payrollHtml, billing: billingHtml, missed: missedHtml, mileage: mileageHtml };

export function mount(el, ctx) {
  const tz = ctx.agency.timezone || TZ;
  const today = localDate(Date.now(), tz);
  const monday = mondayOf(today);
  const PRESETS = {
    'this-week': [monday, addDays(monday, 6)],
    'last-week': [addDays(monday, -7), addDays(monday, -1)],
    'last-14': [addDays(today, -13), today],
  };
  let [from, to] = PRESETS['this-week'];
  let kind = 'payroll';
  let alive = true;
  let seq = 0;

  el.innerHTML = `<div class="view-head"><h1>Reports</h1></div>
    <form id="rp-period" class="report-period" novalidate>
      <div class="field"><label for="rp-from">From</label><input type="date" id="rp-from"></div>
      <div class="field"><label for="rp-to">To</label><input type="date" id="rp-to"></div>
      <button type="submit" class="btn btn-accent btn-inline">Show</button>
      <div class="preset-row">
        <button type="button" class="btn btn-outline btn-inline" data-preset="this-week">This week</button>
        <button type="button" class="btn btn-outline btn-inline" data-preset="last-week">Last week</button>
        <button type="button" class="btn btn-outline btn-inline" data-preset="last-14">Last 14 days</button>
      </div>
      <p class="field-error" data-error-for="to" role="alert"></p>
      <p class="field-error" data-error-for="_" role="alert"></p>
    </form>
    <div class="day-tabs report-tabs" role="tablist" aria-label="Report">${KINDS.map(([k, label]) =>
      `<button type="button" role="tab" class="day-tab" data-kind="${k}" aria-selected="${k === kind}">${label}</button>`).join('')}</div>
    <div class="report-actions"><p class="muted" id="rp-label"></p>
      <button type="button" class="btn btn-outline btn-inline" id="rp-csv">Download CSV</button></div>
    <p class="field-error" id="rp-csv-error" role="alert"></p>
    <div id="rp-body"><p class="empty">Loading…</p></div>`;
  const q = s => el.querySelector(s);
  const form = q('#rp-period');

  async function load() {
    const mine = ++seq;
    q('#rp-from').value = from;
    q('#rp-to').value = to;
    el.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.kind === kind)));
    const r = await office('GET', `/api/office/reports/${kind}?from=${from}&to=${to}`);
    if (!alive || mine !== seq) return;
    showErrors(form, r.ok || r.status === 401 ? null : r);
    if (!r.ok) { q('#rp-body').innerHTML = ''; return; }
    q('#rp-label').textContent = r.data.period_label;
    q('#rp-body').innerHTML = RENDER[kind](r.data);
  }

  el.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.preset) {
      [from, to] = PRESETS[b.dataset.preset];
      load();
    } else if (b.dataset.kind) {
      kind = b.dataset.kind;
      load();
    } else if (b.id === 'rp-csv') {
      await download(b);
    }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    from = q('#rp-from').value;
    to = q('#rp-to').value;
    load();
  });

  async function download(button) {
    const err = q('#rp-csv-error');
    err.textContent = '';
    button.disabled = true;
    try {
      let res;
      try {
        res = await fetch(`/api/office/reports/${kind}.csv?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${getToken()}` }, cache: 'no-store' });
      } catch {
        err.textContent = NETWORK;
        return;
      }
      if (!res.ok) {
        let data = null;
        try { data = await res.json(); } catch { data = null; }
        if (res.status === 401 && !data?.field) { endSession(errorText({ data })); return; }
        err.textContent = errorText({ data });
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || `home-care-${kind}-${from}-to-${to}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } finally {
      button.disabled = false;
    }
  }

  load();
  return () => { alive = false; };
}

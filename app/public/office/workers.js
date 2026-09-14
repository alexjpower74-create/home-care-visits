// Workers: list and form (phone, travel zones, availability per weekday, weekly hours), Copy worker link.
import { office, showErrors, copyText, esc, errorText } from './core.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function mount(el, ctx) {
  const zones = ctx.agency.zones;
  let workers = [];
  let draft = null;
  let msg = '';
  let alive = true;

  async function load() {
    const r = await office('GET', '/api/office/workers');
    if (!alive) return;
    if (r.ok) workers = r.data.workers; else if (r.status !== 401) msg = errorText(r);
    if (!draft) list();
  }

  function list() {
    draft = null;
    el.innerHTML = `<div class="view-head"><h1>Workers</h1><button type="button" class="btn btn-accent btn-inline" data-act="new">Add worker</button></div>
      ${msg ? `<p class="notice" role="status">${esc(msg)}</p>` : ''}
      <ul class="plain entity-list" id="worker-list">${workers.map(w => `<li><button type="button" class="entity" data-act="edit" data-id="${w.id}">
        <span class="avatar" aria-hidden="true">${esc(w.initials)}</span><span class="entity-text"><span class="entity-name">${esc(w.name)}</span>
        <span class="muted">${esc(w.phone)} · ${esc(w.zone_names.join(', '))}</span>
        <span class="muted">${esc(w.availability_label)} · up to ${esc(w.max_week_label)} a week</span></span></button></li>`).join('')}</ul>`;
  }

  function edit(id) {
    const w = workers.find(x => x.id === id);
    draft = w
      ? { id: w.id, name: w.name, phone: w.phone, zone_ids: [...w.zone_ids], availability: structuredClone(w.availability),
        hours: String(w.max_week_minutes / 60), active: w.active, worker_url: w.worker_url }
      : { id: null, name: '', phone: '', zone_ids: [], hours: '37.5', active: true,
        availability: Object.fromEntries(DAYS.map((_, i) => [String(i + 1), i < 5 ? { start: '08:00', end: '16:00' } : null])) };
    msg = '';
    form();
  }

  function form() {
    const d = draft;
    const avail = DAYS.map((name, i) => {
      const k = String(i + 1);
      const win = d.availability[k];
      return `<div class="avail-row" data-day="${k}">
        <label class="check"><input type="checkbox" data-avail-on="${k}"${win ? ' checked' : ''}> ${name}</label>
        <label class="sr-only" for="wf-${k}-start">${name} from</label><input type="time" id="wf-${k}-start" data-avail-start="${k}" value="${esc(win?.start ?? '08:00')}">
        <label class="sr-only" for="wf-${k}-end">${name} until</label><input type="time" id="wf-${k}-end" data-avail-end="${k}" value="${esc(win?.end ?? '16:00')}">
      </div>`;
    }).join('');
    el.innerHTML = `<form id="worker-form" class="office-form narrow" novalidate>
      <div class="view-head"><h1>${d.id ? esc(d.name) : 'Add a worker'}</h1></div>
      <p class="field-error" data-error-for="_" role="alert"></p>
      <div class="field"><label for="wf-name">Name</label><input id="wf-name" maxlength="40" value="${esc(d.name)}" autocomplete="off">
        <p class="field-error" data-error-for="name" role="alert"></p></div>
      <div class="field"><label for="wf-phone">Phone</label><input type="tel" id="wf-phone" value="${esc(d.phone)}" autocomplete="off">
        <p class="field-error" data-error-for="phone" role="alert"></p></div>
      <fieldset class="group"><legend>Travel zones</legend>${zones.map(z => `<label class="check"><input type="checkbox" data-zone="${z.id}"${d.zone_ids.includes(z.id) ? ' checked' : ''}> ${esc(z.name)}</label>`).join('')}
        <p class="field-error" data-error-for="zone_ids" role="alert"></p></fieldset>
      <fieldset class="group"><legend>Available</legend>${avail}<p class="field-error" data-error-for="availability" role="alert"></p></fieldset>
      <div class="field"><label for="wf-hours">Most hours a week</label><input type="number" id="wf-hours" min="1" max="80" step="0.5" value="${esc(d.hours)}">
        <p class="field-error" data-error-for="max_week_minutes" role="alert"></p></div>
      <label class="check"><input type="checkbox" id="wf-active"${d.active ? ' checked' : ''}> Active worker</label>
      ${d.id ? `<div class="field"><span class="label">Worker link</span>
        <p class="muted">The worker opens this link on their own phone. Nothing is sent: copy it and give it to them.</p>
        <button type="button" class="btn btn-outline btn-inline" data-act="copy-worker">Copy worker link</button></div>` : ''}
      <div class="form-actions"><button type="submit" class="btn btn-accent btn-inline">Save worker</button>
        <button type="button" class="btn btn-outline btn-inline" data-act="cancel">Cancel</button></div>
    </form>`;
  }

  function body() {
    const f = el.querySelector('#worker-form');
    const availability = {};
    for (let k = 1; k <= 7; k++) {
      availability[k] = f.querySelector(`[data-avail-on="${k}"]`).checked
        ? { start: f.querySelector(`[data-avail-start="${k}"]`).value, end: f.querySelector(`[data-avail-end="${k}"]`).value } : null;
    }
    const hours = Number(f.querySelector('#wf-hours').value);
    return {
      name: f.querySelector('#wf-name').value, phone: f.querySelector('#wf-phone').value,
      zone_ids: [...f.querySelectorAll('[data-zone]:checked')].map(x => Number(x.dataset.zone)),
      availability, max_week_minutes: Number.isFinite(hours) ? Math.round(hours * 60) : null, active: f.querySelector('#wf-active').checked,
    };
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'new') edit(null);
    else if (b.dataset.act === 'edit') edit(Number(b.dataset.id));
    else if (b.dataset.act === 'cancel') list();
    else if (b.dataset.act === 'copy-worker') copyText(b, draft.worker_url);
  });

  el.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const r = draft.id ? await office('PUT', `/api/office/workers/${draft.id}`, body()) : await office('POST', '/api/office/workers', body());
    if (r.ok) {
      msg = `Saved ${r.data.name}.`;
      draft = null;
      await load();
    } else if (r.status !== 401) {
      showErrors(f, r);
    }
  });

  el.innerHTML = '<p class="empty">Loading workers…</p>';
  load();
  return () => { alive = false; };
}

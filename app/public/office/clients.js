// Clients: list + Leaflet map; the form places the pin by clicking the map; tasks, visit times (patterns) with the rebuild
// warning, family contacts, Copy family link.
import { office, showErrors, copyText, esc, errorText } from './core.js';

const KINDS = [['personal_care', 'Personal care'], ['meal_prep', 'Meal preparation'], ['medication_reminder', 'Medication reminder'],
  ['housekeeping', 'Light housekeeping'], ['laundry', 'Laundry'], ['companionship', 'Companionship'],
  ['errands', 'Errands and shopping'], ['other', 'Other']];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const REBUILD = "Changing visit times rebuilds this client's upcoming visits. One-off changes to those visits will be replaced.";
const num = v => (v === '' || v == null ? null : Number(v));
const round5 = n => Math.round(n * 1e5) / 1e5;

export function mount(el, ctx) {
  const a = ctx.agency;
  let clients = [];
  let workers = [];
  let draft = null;
  let msg = '';
  let alive = true;

  el.innerHTML = `<div class="split">
    <section class="split-main" id="cl-main"></section>
    <section class="split-map" aria-label="Map of clients">
      <div id="cl-map" class="map"></div>
      <p class="muted small" id="cl-map-hint">Each pin is a client's map point. Straight-line distances only.</p>
    </section></div>`;
  const main = el.querySelector('#cl-main');
  const hint = el.querySelector('#cl-map-hint');

  const map = L.map(el.querySelector('#cl-map'), { center: [a.office.lat, a.office.lng], zoom: 9 });
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const pins = L.layerGroup().addTo(map);
  let draftPin = null;
  const icon = (text, extra = '') => L.divIcon({ className: `pin ${extra}`, html: `<span>${esc(text)}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] });

  function drawPins() {
    pins.clearLayers();
    // While a client is open its own marker gives way to the draggable-by-click draft pin.
    for (const c of clients.filter(x => x.active && x.id !== draft?.id)) {
      L.marker([c.lat, c.lng], { title: c.name, alt: c.name, icon: icon(c.initials) })
        .on('click', () => { if (!draft) edit(c.id); })
        .addTo(pins);
    }
  }
  function drawDraftPin() {
    draftPin?.remove();
    draftPin = draft?.lat != null ? L.marker([draft.lat, draft.lng], { title: 'Pin for this client', icon: icon('Pin', 'pin-new'), interactive: false }).addTo(map) : null;
  }
  const pinText = () => (draft?.lat != null ? `Pin at ${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}. Click the map again to move it.` : 'Click the map where the client lives to put the pin.');

  map.on('click', e => {
    if (!draft) return;
    collect();
    draft.lat = round5(e.latlng.lat);
    draft.lng = round5(e.latlng.lng);
    drawDraftPin();
    const p = main.querySelector('#cf-pin');
    if (p) p.textContent = pinText();
    const err = main.querySelector('[data-error-for="lat"]');
    if (err) err.textContent = '';
  });

  async function load() {
    // ?all=1 (clarification 15): an inactive client stays openable (reactivate, replace the family link).
    const [cr, wr] = await Promise.all([office('GET', '/api/office/clients?all=1'), office('GET', '/api/office/workers')]);
    if (!alive) return;
    if (cr.ok) clients = cr.data.clients; else if (cr.status !== 401) msg = errorText(cr);
    if (wr.ok) workers = wr.data.workers;
    drawPins();
    if (!draft) list();
  }

  function list() {
    draft = null;
    drawPins();
    drawDraftPin();
    hint.textContent = "Each pin is a client's map point. Straight-line distances only.";
    const entry = c => `<li><button type="button" class="entity" data-act="edit" data-id="${c.id}">
      <span class="avatar" aria-hidden="true">${esc(c.initials)}</span><span class="entity-text"><span class="entity-name">${esc(c.name)}</span>
      <span class="muted">${esc(c.zone_name)} · ${esc(c.funder_name)}</span>
      <span class="muted">${c.patterns.length ? c.patterns.map(p => `${esc(p.days_label)} ${esc(p.time_label)}`).join('; ') : 'No visit times'}</span></span></button></li>`;
    const inactive = clients.filter(c => !c.active);
    main.innerHTML = `<div class="view-head"><h1>Clients</h1><button type="button" class="btn btn-accent btn-inline" data-act="new">Add client</button></div>
      ${msg ? `<p class="notice" role="status" id="cl-msg">${esc(msg)}</p>` : ''}
      <ul class="plain entity-list" id="client-list">${clients.filter(c => c.active).map(entry).join('')}</ul>
      ${inactive.length ? `<h2 class="list-subhead">Inactive</h2><ul class="plain entity-list" id="client-list-inactive">${inactive.map(entry).join('')}</ul>` : ''}`;
    setTimeout(() => map.invalidateSize(), 0);
  }

  const blank = {
    task: () => ({ id: null, kind: 'personal_care', detail: '' }),
    pattern: () => ({ id: null, days: [], start: '09:00', end: '10:00', worker_id: null }),
    family: () => ({ name: '', relationship: '', phone: '' }),
  };

  async function edit(id) {
    let c = null;
    if (id) {
      const r = await office('GET', `/api/office/clients/${id}`);
      if (!r.ok) { if (r.status !== 401) { msg = errorText(r); list(); } return; }
      c = r.data;
    }
    draft = c
      ? { id: c.id, name: c.name, address: c.address, lat: c.lat, lng: c.lng, zone_id: c.zone_id, funder_id: c.funder_id,
        entry_notes: c.entry_notes, active: c.active, family_url: c.family_url,
        tasks: c.tasks.map(t => ({ id: t.id, kind: t.kind, detail: t.detail || '' })),
        patterns: c.patterns.map(p => ({ id: p.id, days: [...p.days], start: p.start, end: p.end, worker_id: p.worker_id })),
        family_contacts: c.family_contacts.map(f => ({ name: f.name, relationship: f.relationship || '', phone: f.phone })) }
      : { id: null, name: '', address: '', lat: null, lng: null, zone_id: '', funder_id: '', entry_notes: '', active: true,
        tasks: [blank.task()], patterns: [], family_contacts: [] };
    msg = '';
    form();
    drawPins();
    drawDraftPin();
    hint.textContent = 'Click the map to put or move the pin for this client.';
    if (c) map.setView([c.lat, c.lng], 12);
    setTimeout(() => map.invalidateSize(), 0);
  }

  const options = (items, selected, placeholder) => `${placeholder != null ? `<option value="">${esc(placeholder)}</option>` : ''}${
    items.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`).join('')}`;
  const input = (id, label, value, field, max, type = 'text') => `<div class="field"><label for="${id}">${label}</label>
    <input type="${type}" id="${id}" value="${esc(value)}"${max ? ` maxlength="${max}"` : ''} autocomplete="off">
    <p class="field-error" data-error-for="${field}" role="alert"></p></div>`;

  const taskRow = (t, i) => `<div class="row-edit" data-row="task"><input type="hidden" data-f="id" value="${t.id ?? ''}">
    <div class="field"><label for="cf-task-${i}-kind">Task</label><select id="cf-task-${i}-kind" data-f="kind">${options(KINDS, t.kind)}</select></div>
    <div class="field"><label for="cf-task-${i}-detail">Detail (the worker sees this)</label><input id="cf-task-${i}-detail" data-f="detail" maxlength="80" value="${esc(t.detail)}" autocomplete="off"></div>
    <button type="button" class="btn btn-outline btn-inline" data-act="remove-task" data-i="${i}">Remove</button></div>`;

  const patternRow = (p, i) => `<div class="row-edit" data-row="pattern"><input type="hidden" data-f="id" value="${p.id ?? ''}">
    <div class="days" role="group" aria-label="Days">${DAYS.map((d, j) => `<label class="day-toggle"><input type="checkbox" data-day="${j + 1}"${p.days.includes(j + 1) ? ' checked' : ''}><span>${d}</span></label>`).join('')}</div>
    <div class="field-pair">
      <div class="field"><label for="cf-pat-${i}-start">Start</label><input type="time" id="cf-pat-${i}-start" data-f="start" value="${esc(p.start)}"></div>
      <div class="field"><label for="cf-pat-${i}-end">End</label><input type="time" id="cf-pat-${i}-end" data-f="end" value="${esc(p.end)}"></div>
    </div>
    <div class="field"><label for="cf-pat-${i}-worker">Worker</label><select id="cf-pat-${i}-worker" data-f="worker_id">${options(workers.map(w => [w.id, w.name]), p.worker_id, 'No worker yet')}</select></div>
    <button type="button" class="btn btn-outline btn-inline" data-act="remove-pattern" data-i="${i}">Remove</button></div>`;

  const familyRow = (f, i) => `<div class="row-edit" data-row="family">
    <div class="field"><label for="cf-fam-${i}-name">Name</label><input id="cf-fam-${i}-name" data-f="name" maxlength="60" value="${esc(f.name)}" autocomplete="off"></div>
    <div class="field"><label for="cf-fam-${i}-rel">Relationship</label><input id="cf-fam-${i}-rel" data-f="relationship" maxlength="30" value="${esc(f.relationship)}" autocomplete="off"></div>
    <div class="field"><label for="cf-fam-${i}-phone">Phone</label><input type="tel" id="cf-fam-${i}-phone" data-f="phone" value="${esc(f.phone)}" autocomplete="off"></div>
    <button type="button" class="btn btn-outline btn-inline" data-act="remove-family" data-i="${i}">Remove</button></div>`;

  function form() {
    const d = draft;
    main.innerHTML = `<form id="client-form" class="office-form" novalidate>
      <div class="view-head"><h1>${d.id ? esc(d.name) : 'Add a client'}</h1></div>
      <p class="field-error" data-error-for="_" role="alert"></p>
      ${input('cf-name', 'Name', d.name, 'name', 60)}
      ${input('cf-address', 'Where the client lives (the town is enough)', d.address, 'address', 120)}
      <div class="field"><span class="label">Map pin</span><p id="cf-pin">${esc(pinText())}</p><p class="field-error" data-error-for="lat" role="alert"></p></div>
      <div class="field"><label for="cf-zone">Zone</label><select id="cf-zone">${options(a.zones.map(z => [z.id, z.name]), d.zone_id, 'Pick a zone')}</select>
        <p class="field-error" data-error-for="zone_id" role="alert"></p></div>
      <div class="field"><label for="cf-funder">Who pays for the visits</label><select id="cf-funder">${options(a.funders.map(f => [f.id, f.name]), d.funder_id, 'Pick who pays')}</select>
        <p class="field-error" data-error-for="funder_id" role="alert"></p></div>
      <div class="field"><label for="cf-entry">Getting in (entry and key-safe notes)</label><textarea id="cf-entry" rows="3" maxlength="300">${esc(d.entry_notes)}</textarea>
        <p class="field-error" data-error-for="entry_notes" role="alert"></p></div>
      <label class="check"><input type="checkbox" id="cf-active"${d.active ? ' checked' : ''}> Active client</label>
      <p class="field-error" data-error-for="active" role="alert"></p>
      <fieldset class="group"><legend>Care tasks</legend>
        <p class="muted small">Medication is a reminder only. This app never records medication given.</p>
        <div id="cf-task-rows">${d.tasks.map(taskRow).join('')}</div>
        <button type="button" class="btn btn-outline btn-inline" data-act="add-task">Add a task</button>
        <p class="field-error" data-error-for="tasks" role="alert"></p></fieldset>
      <fieldset class="group"><legend>Visit times</legend>
        ${d.id ? `<p class="warn">${REBUILD}</p>` : ''}
        <div id="cf-pattern-rows">${d.patterns.map(patternRow).join('')}</div>
        <button type="button" class="btn btn-outline btn-inline" data-act="add-pattern">Add visit times</button>
        <p class="field-error" data-error-for="patterns" role="alert"></p></fieldset>
      <fieldset class="group"><legend>Family contacts</legend>
        <div id="cf-family-rows">${d.family_contacts.map(familyRow).join('')}</div>
        <button type="button" class="btn btn-outline btn-inline" data-act="add-family">Add a family contact</button>
        <p class="field-error" data-error-for="family_contacts" role="alert"></p></fieldset>
      ${d.id ? `<div class="field"><span class="label">Family link</span>
        <p class="muted">The family sees today's and this week's visits. Nothing is sent: copy the link and give it to them.</p>
        <button type="button" class="btn btn-outline btn-inline" data-act="copy-family">Copy family link</button></div>` : ''}
      <div class="form-actions"><button type="submit" class="btn btn-accent btn-inline">Save client</button>
        <button type="button" class="btn btn-outline btn-inline" data-act="cancel">Cancel</button></div>
    </form>`;
  }

  function collect() {
    const f = main.querySelector('#client-form');
    if (!f || !draft) return;
    const val = s => f.querySelector(s).value;
    const rows = kind => [...f.querySelectorAll(`[data-row="${kind}"]`)];
    const get = (row, name) => row.querySelector(`[data-f="${name}"]`).value;
    Object.assign(draft, { name: val('#cf-name'), address: val('#cf-address'), zone_id: val('#cf-zone'), funder_id: val('#cf-funder'),
      entry_notes: val('#cf-entry'), active: f.querySelector('#cf-active').checked });
    draft.tasks = rows('task').map(r => ({ id: num(get(r, 'id')), kind: get(r, 'kind'), detail: get(r, 'detail') }));
    draft.patterns = rows('pattern').map(r => ({ id: num(get(r, 'id')), days: [...r.querySelectorAll('[data-day]:checked')].map(x => Number(x.dataset.day)),
      start: get(r, 'start'), end: get(r, 'end'), worker_id: num(get(r, 'worker_id')) }));
    draft.family_contacts = rows('family').map(r => ({ name: get(r, 'name'), relationship: get(r, 'relationship'), phone: get(r, 'phone') }));
  }

  const body = () => ({
    name: draft.name, address: draft.address, lat: draft.lat, lng: draft.lng, zone_id: num(draft.zone_id), entry_notes: draft.entry_notes,
    funder_id: num(draft.funder_id), active: draft.active,
    tasks: draft.tasks.map(t => ({ ...(t.id ? { id: t.id } : {}), kind: t.kind, detail: t.detail })),
    patterns: draft.patterns.map(p => ({ ...(p.id ? { id: p.id } : {}), days: p.days, start: p.start, end: p.end, worker_id: p.worker_id })),
    family_contacts: draft.family_contacts,
  });

  main.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'new') return edit(null);
    if (act === 'edit') return edit(Number(b.dataset.id));
    if (act === 'cancel') { msg = ''; list(); return undefined; }
    if (act === 'copy-family') return copyText(b, draft.family_url);
    collect();
    const i = Number(b.dataset.i);
    if (act === 'add-task') draft.tasks.push(blank.task());
    else if (act === 'remove-task') draft.tasks.splice(i, 1);
    else if (act === 'add-pattern') draft.patterns.push(blank.pattern());
    else if (act === 'remove-pattern') draft.patterns.splice(i, 1);
    else if (act === 'add-family') draft.family_contacts.push(blank.family());
    else if (act === 'remove-family') draft.family_contacts.splice(i, 1);
    else return undefined;
    form();
    return undefined;
  });

  main.addEventListener('submit', async e => {
    e.preventDefault();
    collect();
    const f = e.target;
    const btn = f.querySelector('[type="submit"]');
    btn.disabled = true;
    const r = draft.id ? await office('PUT', `/api/office/clients/${draft.id}`, body()) : await office('POST', '/api/office/clients', body());
    btn.disabled = false;
    if (r.ok) {
      msg = `Saved ${r.data.name}.${r.data.rebuilt_visits ? ` ${r.data.rebuilt_visits} upcoming visits were rebuilt.` : ''}`;
      draft = null;
      await load();
    } else if (r.status !== 401) {
      showErrors(f, r);
    }
  });

  list();
  load();
  return () => {
    alive = false;
    map.remove();
  };
}

// Week planner. Wide screens: a grid (worker rows + "No worker", day columns); a chip is dragged with the mouse to another
// worker's row on the same day (pointer events, so a real mouse drag works in every engine). Narrow screens: day tabs,
// visits grouped by worker, "Assign to" + Save. The conflict list sits above; choosing a conflict highlights its chips.
import { office, errorText, esc } from './core.js';
import { openVisitSheet } from './sheet.js';
import { localDate, mondayOf, addDays, TZ } from '../time.js';

const WIDE = '(min-width: 900px)';

export function mount(el, ctx) {
  const tz = ctx.agency.timezone || TZ;
  const today = localDate(Date.now(), tz);
  let start = mondayOf(today);
  let day = today;
  let data = null;
  let msg = '';
  let highlight = null; // index into data.conflicts
  let alive = true;
  let drag = null;
  const wide = matchMedia(WIDE);

  async function load() {
    const r = await office('GET', `/api/office/week?start=${start}`);
    if (!alive) return;
    if (r.ok) {
      data = r.data;
      if (day < data.week_start || day > addDays(data.week_start, 6)) day = data.week_start;
    } else if (r.status !== 401) {
      msg = errorText(r);
    }
    render();
  }

  function severities() {
    const m = new Map();
    for (const c of data.conflicts) for (const id of c.visit_ids) {
      m.set(id, c.severity === 'problem' || m.get(id) === 'problem' ? 'problem' : 'warning');
    }
    return m;
  }

  const lit = () => new Set(highlight != null ? data.conflicts[highlight]?.visit_ids ?? [] : []);

  function conflictsHtml() {
    const list = data.conflicts.map((c, i) => `<li><button type="button" class="conflict" data-conflict-index="${i}" data-kind="${esc(c.kind)}"
        data-severity="${esc(c.severity)}" data-date="${esc(c.date ?? '')}" aria-pressed="${highlight === i}">
        <span class="conflict-label">${esc(c.label)}</span><span class="conflict-sev">${c.severity === 'problem' ? 'Problem' : 'Warning'}</span>
        <span class="conflict-msg">${esc(c.message)}</span></button></li>`).join('');
    return `<section class="conflicts" aria-labelledby="conflicts-h"><h2 id="conflicts-h">Conflicts</h2>
      <p class="muted">${esc(data.distance_note)}</p>
      ${data.conflicts.length ? `<ul class="plain">${list}</ul>` : '<p>No conflicts this week.</p>'}</section>`;
  }

  function chipHtml(v, sev, on) {
    return `<div class="chip${v.cancelled ? ' is-cancelled' : ''}" data-visit-id="${v.id}" data-conflict="${sev ?? ''}"${on ? ' data-highlight' : ''}
        role="button" tabindex="0" aria-label="${esc(`${v.client_name}, ${v.time_label}${sev ? ', conflict' : ''}`)}">
      <span class="avatar avatar-sm" aria-hidden="true">${esc(v.client_initials)}</span>
      <span class="chip-text"><span class="chip-client">${esc(v.client_name)}</span><span class="chip-time">${esc(v.time_label)}</span>
      ${sev ? '<span class="chip-flag">Conflict</span>' : ''}</span></div>`;
  }

  const rows = () => [...data.workers, { id: null, name: 'No worker', hours_label: '' }];

  function gridHtml() {
    const sev = severities();
    const on = lit();
    const head = `<div class="grid-corner"></div>${data.days.map(d => `<div class="grid-day${d.date === today ? ' is-today' : ''}">${esc(d.date_label)}</div>`).join('')}`;
    const body = rows().map(w => `<div class="grid-worker">${esc(w.name)}<span class="muted">${esc(w.hours_label)}</span></div>${
      data.days.map(d => `<div class="cell" data-worker-id="${w.id ?? 'none'}" data-date="${d.date}">${
        data.visits.filter(v => v.date === d.date && (v.worker_id ?? null) === w.id).map(v => chipHtml(v, sev.get(v.id), on.has(v.id))).join('')
      }</div>`).join('')}`).join('');
    return `<div class="grid-scroll"><div class="grid">${head}${body}</div></div>`;
  }

  function phoneHtml() {
    const sev = severities();
    const on = lit();
    const tabs = `<div class="day-tabs" role="tablist" aria-label="Day">${data.days.map(d => `<button type="button" role="tab" class="day-tab"
        data-day="${d.date}" aria-selected="${d.date === day}">${esc(d.date_label)}</button>`).join('')}</div>`;
    const workerOptions = sel => [`<option value=""${sel == null ? ' selected' : ''}>No worker</option>`,
      ...data.workers.map(w => `<option value="${w.id}"${w.id === sel ? ' selected' : ''}>${esc(w.name)}</option>`)].join('');
    const groups = rows().map(w => {
      const vs = data.visits.filter(v => v.date === day && (v.worker_id ?? null) === w.id);
      if (!vs.length) return '';
      return `<section class="wgroup" data-worker-id="${w.id ?? 'none'}"><h3>${esc(w.name)} <span class="muted">${esc(w.hours_label)}</span></h3>${
        vs.map(v => `<article class="vcard" data-visit-id="${v.id}" data-conflict="${sev.get(v.id) ?? ''}"${on.has(v.id) ? ' data-highlight' : ''}>
          <button type="button" class="vcard-open" data-open-visit="${v.id}"><span class="vcard-client">${esc(v.client_name)}</span>
            <span class="${v.cancelled ? 'is-cancelled' : ''}">${esc(v.time_label)}</span></button>
          <p class="vcard-status">${esc(v.status_label)}${sev.get(v.id) ? ' · <strong class="chip-flag">Conflict</strong>' : ''}</p>
          <div class="assign"><label for="assign-${v.id}">Assign to</label>
            <select id="assign-${v.id}" data-assign="${v.id}">${workerOptions(v.worker_id ?? null)}</select>
            <button type="button" class="btn btn-accent btn-inline" data-save-assign="${v.id}">Save</button></div>
        </article>`).join('')}</section>`;
    }).join('');
    return `${tabs}${groups || '<p class="empty">No visits on this day.</p>'}`;
  }

  function render() {
    if (!alive) return;
    const head = `<div class="view-head"><h1>${esc(data?.week_label ?? 'Week')}</h1>
      <div class="week-nav"><button type="button" class="btn btn-outline btn-inline" data-week="-1">Previous week</button>
      <button type="button" class="btn btn-outline btn-inline" data-week="0">This week</button>
      <button type="button" class="btn btn-outline btn-inline" data-week="1">Next week</button></div></div>
      <p class="notice notice-bad" id="week-msg" role="alert"${msg ? '' : ' hidden'}>${esc(msg)}</p>`;
    el.innerHTML = data ? `${head}${conflictsHtml()}${wide.matches ? gridHtml() : phoneHtml()}` : `${head}<p class="empty">Loading the week…</p>`;
    if (msg) el.querySelector('#week-msg').scrollIntoView({ block: 'nearest' });
  }

  async function assign(v, workerId) {
    const r = await office('PUT', `/api/office/visits/${v.id}`, { worker_id: workerId, date: v.date, start: v.start, end: v.end, version: v.version });
    if (r.ok) { msg = ''; await load(); } else if (r.status !== 401) { msg = errorText(r); render(); }
  }

  const visitOf = id => data?.visits.find(v => v.id === Number(id));
  const open = id => { const v = visitOf(id); if (v) openVisitSheet(v, load); };

  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !data) return;
    if (b.dataset.week != null) {
      start = b.dataset.week === '0' ? mondayOf(today) : addDays(start, 7 * Number(b.dataset.week));
      day = start === mondayOf(today) ? today : start;
      highlight = null;
      msg = '';
      load();
    } else if (b.dataset.conflictIndex != null) {
      const i = Number(b.dataset.conflictIndex);
      highlight = highlight === i ? null : i;
      render();
    } else if (b.dataset.day) {
      day = b.dataset.day;
      render();
    } else if (b.dataset.openVisit) {
      open(b.dataset.openVisit);
    } else if (b.dataset.saveAssign) {
      const v = visitOf(b.dataset.saveAssign);
      const value = el.querySelector(`[data-assign="${v.id}"]`).value;
      assign(v, value ? Number(value) : null);
    }
  });

  el.addEventListener('keydown', e => {
    const chip = e.target.closest?.('.chip');
    if (chip && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(chip.dataset.visitId); }
  });

  // Mouse drag on the grid.
  const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('.cell') ?? null;
  const clearOver = () => el.querySelectorAll('.cell.is-over').forEach(c => c.classList.remove('is-over'));
  el.addEventListener('pointerdown', e => {
    const chip = e.target.closest('.chip');
    if (!chip || e.button !== 0) return;
    e.preventDefault();
    drag = { chip, id: chip.dataset.visitId, x: e.clientX, y: e.clientY, moved: false, ghost: null };
  });
  const onMove = e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.ghost = drag.chip.cloneNode(true);
      drag.ghost.removeAttribute('data-visit-id');
      drag.ghost.classList.add('chip-ghost');
      document.body.append(drag.ghost);
      drag.chip.classList.add('is-dragging');
    }
    drag.ghost.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`;
    clearOver();
    cellAt(e.clientX, e.clientY)?.classList.add('is-over');
  };
  const onUp = e => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) { open(d.id); return; }
    d.ghost.remove();
    d.chip.classList.remove('is-dragging');
    clearOver();
    const cell = cellAt(e.clientX, e.clientY);
    const v = visitOf(d.id);
    if (!cell || !v) return;
    const workerId = cell.dataset.workerId === 'none' ? null : Number(cell.dataset.workerId);
    if (cell.dataset.date !== v.date) {
      msg = 'Drag a visit to another worker on the same day. To change the day, open the visit.';
      render();
    } else if ((v.worker_id ?? null) !== workerId) {
      assign(v, workerId);
    }
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  wide.addEventListener('change', render);

  render();
  load();
  return () => {
    alive = false;
    drag?.ghost?.remove();
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    wide.removeEventListener('change', render);
  };
}

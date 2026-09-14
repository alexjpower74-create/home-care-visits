// The visit edit sheet: worker, date, start, end; Cancel visit (reason) / Restore; Fix times (NL time, reason);
// "Family can see this note". Every refusal shows the API's words.
import { office, openSheet, closeSheet, showErrors, esc } from './core.js';
import { TZ, localToUtcMs, localHm, addDays } from '../time.js';

const eventText = e => (e
  ? `${e.at_label} (${e.source === 'office' ? `set by the office: ${e.correction_reason}` : `from the phone${e.location_label ? `, ${e.location_label}` : ''}`})`
  : 'none yet');
const workedText = s => `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
const isoOf = ms => (ms == null ? null : new Date(ms).toISOString());

export async function openVisitSheet(visit, onChanged) {
  const wr = await office('GET', '/api/office/workers');
  const workers = wr.ok ? wr.data.workers : [];
  let v = visit;
  let shareNote = '';
  let timesNote = '';

  const html = () => {
    // Clarification 15: the visit's current worker is always an option, so saving another change never unassigns the visit.
    const inactive = v.worker_id != null && !workers.some(w => w.id === v.worker_id)
      ? `<option value="${v.worker_id}" selected>${esc(`${v.worker_name} (inactive)`)}</option>` : '';
    const workerOptions = [`<option value="">No worker</option>`, inactive, ...workers.map(w =>
      `<option value="${w.id}"${w.id === v.worker_id ? ' selected' : ''}>${esc(w.name)}</option>`)].join('');
    const cancel = v.cancelled
      ? `<p><strong>Cancelled:</strong> ${esc(v.cancel_reason || '')}</p>
         <button type="button" class="btn btn-outline" id="vs-restore">Restore visit</button>`
      : `<div class="field"><label for="vs-reason">Why is the visit cancelled?</label><input id="vs-reason" maxlength="120" autocomplete="off">
         <p class="field-error" data-error-for="reason" role="alert"></p></div>
         <button type="button" class="btn btn-outline btn-danger" id="vs-cancel">Cancel visit</button>`;
    const note = v.note
      ? `<blockquote class="quote">${esc(v.note.text)}</blockquote>
         <label class="check"><input type="checkbox" id="vs-share"${v.note.shareable ? ' checked' : ''}> Family can see this note</label>
         <p class="muted" id="vs-share-status" role="status">${esc(shareNote)}</p>`
      : '<p class="muted">No note yet. The note comes with the check-out.</p>';
    const times = `<h3>Times</h3>
      <div id="vs-times-now"><p>Check-in: ${esc(eventText(v.check_in))}</p><p>Check-out: ${esc(eventText(v.check_out))}</p>
        ${v.worked_seconds != null ? `<p>Worked: ${esc(workedText(v.worked_seconds))}</p>` : ''}</div>
      <p class="muted" id="vs-times-status" role="status">${esc(timesNote)}</p>
      <form id="vs-times" class="sheet-form" novalidate>
        <div class="field-pair">
          <div class="field"><label for="vs-fix-in">Check-in (NL time)</label>
            <input type="time" id="vs-fix-in" value="${v.check_in ? localHm(v.check_in.at, TZ) : ''}">
            <p class="field-error" data-error-for="check_in_at" role="alert"></p></div>
          <div class="field"><label for="vs-fix-out">Check-out (NL time)</label>
            <input type="time" id="vs-fix-out" value="${v.check_out ? localHm(v.check_out.at, TZ) : ''}">
            <p class="field-error" data-error-for="check_out_at" role="alert"></p></div>
        </div>
        <div class="field"><label for="vs-fix-reason">Why the time is being fixed</label><input id="vs-fix-reason" maxlength="120" autocomplete="off">
          <p class="field-error" data-error-for="reason" role="alert"></p></div>
        <button type="submit" class="btn btn-outline">Fix times</button>
      </form>`;
    return `<h2 id="sheet-title" tabindex="-1">${esc(v.client_name)}</h2>
      <p class="muted">${esc(v.date_label)} · ${esc(v.time_label)} · ${esc(v.status_label)}</p>
      <p class="field-error" data-error-for="_" role="alert"></p>
      <form id="vs-form" class="sheet-form" novalidate>
        <div class="field"><label for="vs-worker">Worker</label><select id="vs-worker">${workerOptions}</select>
          <p class="field-error" data-error-for="worker_id" role="alert"></p></div>
        <div class="field"><label for="vs-date">Date</label><input type="date" id="vs-date" value="${esc(v.date)}">
          <p class="field-error" data-error-for="date" role="alert"></p></div>
        <div class="field-pair">
          <div class="field"><label for="vs-start">Start</label><input type="time" id="vs-start" value="${esc(v.start)}">
            <p class="field-error" data-error-for="start" role="alert"></p></div>
          <div class="field"><label for="vs-end">End</label><input type="time" id="vs-end" value="${esc(v.end)}">
            <p class="field-error" data-error-for="end" role="alert"></p></div>
        </div>
        <button type="submit" class="btn btn-accent">Save changes</button>
      </form>
      <section class="sheet-section" aria-label="Times">${times}</section>
      <section class="sheet-section" aria-label="Cancel or restore">${cancel}</section>
      <section class="sheet-section" aria-label="Note"><h3>Note</h3>${note}</section>
      <button type="button" class="btn btn-outline" data-sheet-close>Close</button>`;
  };

  const draw = () => {
    const sheet = openSheet(html());
    const q = s => sheet.querySelector(s);
    const done = async r => {
      if (r.ok) { v = r.data; return true; }
      if (r.status !== 401) showErrors(sheet, r);
      return false;
    };
    q('#vs-form').addEventListener('submit', async e => {
      e.preventDefault();
      const worker = q('#vs-worker').value;
      const r = await office('PUT', `/api/office/visits/${v.id}`, {
        worker_id: worker ? Number(worker) : null, date: q('#vs-date').value, start: q('#vs-start').value, end: q('#vs-end').value, version: v.version,
      });
      if (await done(r)) { closeSheet(); onChanged(v); }
    });
    q('#vs-times').addEventListener('submit', async e => {
      e.preventDefault();
      // Only a changed time is sent, so a phone's time (with its seconds) is never replaced by the same minute.
      const inHm = q('#vs-fix-in').value;
      const outHm = q('#vs-fix-out').value;
      const checkIn = inHm && inHm !== (v.check_in ? localHm(v.check_in.at, TZ) : '') ? localToUtcMs(v.date, inHm, TZ) : null;
      const inMs = checkIn ?? (v.check_in ? Date.parse(v.check_in.at) : null);
      let checkOut = outHm && outHm !== (v.check_out ? localHm(v.check_out.at, TZ) : '') ? localToUtcMs(v.date, outHm, TZ) : null;
      // A check-out earlier on the clock than the check-in is after midnight.
      if (checkOut != null && inMs != null && checkOut <= inMs) checkOut = localToUtcMs(addDays(v.date, 1), outHm, TZ);
      const r = await office('PUT', `/api/office/visits/${v.id}/times`, {
        check_in_at: isoOf(checkIn), check_out_at: isoOf(checkOut), reason: q('#vs-fix-reason').value, version: v.version,
      });
      if (await done(r)) { timesNote = 'Times saved.'; draw(); onChanged(v); }
    });
    q('#vs-cancel')?.addEventListener('click', async () => {
      const r = await office('POST', `/api/office/visits/${v.id}/cancel`, { reason: q('#vs-reason').value, version: v.version });
      if (await done(r)) { draw(); onChanged(v); }
    });
    q('#vs-restore')?.addEventListener('click', async () => {
      const r = await office('POST', `/api/office/visits/${v.id}/restore`, { version: v.version });
      if (await done(r)) { draw(); onChanged(v); }
    });
    q('#vs-share')?.addEventListener('change', async e => {
      const want = e.target.checked;
      const r = await office('PUT', `/api/office/visits/${v.id}/note`, { shareable: want });
      if (await done(r)) {
        shareNote = want ? 'Saved. The family can see this note.' : "Saved. The family can't see this note.";
        draw();
        onChanged(v);
      } else {
        e.target.checked = !want;
      }
    });
  };
  draw();
}

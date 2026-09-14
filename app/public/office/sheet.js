// The visit edit sheet: worker, date, start, end; Cancel visit (reason) / Restore; Fix times (NL time, reason);
// "Family can see this note". Every refusal shows the API's words.
import { office, openSheet, closeSheet, showErrors, esc } from './core.js';
import { TZ, localToUtcMs, localHm, localDate, addDays } from '../time.js';

const GAP_WORDS = "That time doesn't exist on the day the clocks change.";

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
        <label class="check" id="vs-in-overnight-row" hidden><input type="checkbox" id="vs-fix-in-overnight"> The check-in was after midnight</label>
        <label class="check" id="vs-overnight-row" hidden><input type="checkbox" id="vs-fix-overnight"> The check-out was after midnight</label>
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
    // Clarification 19: a typed check-in is dated from the visit's date (the next day when "The check-in was after midnight" is
    // ticked); a typed check-out from the check-in's own NL date (the next day when "The check-out was after midnight" is ticked).
    const timeDates = () => {
      const inHm = q('#vs-fix-in').value;
      const outHm = q('#vs-fix-out').value;
      const inDate = q('#vs-fix-in-overnight').checked ? addDays(v.date, 1) : v.date;
      const inMs = inHm ? localToUtcMs(inDate, inHm, TZ) : (v.check_in ? Date.parse(v.check_in.at) : null);
      const baseDate = inMs != null ? localDate(inMs, TZ) : v.date;
      const outDate = q('#vs-fix-overnight').checked ? addDays(baseDate, 1) : baseDate;
      return { inHm, outHm, inDate, inMs, baseDate, outDate };
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
      const { inHm, outHm, inDate, outDate } = timeDates();
      const unchanged = (e, date, hm) => !!e && localHm(e.at, TZ) === hm && localDate(e.at, TZ) === date;
      const checkIn = inHm && !unchanged(v.check_in, inDate, inHm) ? localToUtcMs(inDate, inHm, TZ) : null;
      const checkOut = outHm && !unchanged(v.check_out, outDate, outHm) ? localToUtcMs(outDate, outHm, TZ) : null;
      // Clarification 17: a time in the spring-forward gap does not exist on that day. It is refused here and not sent.
      showErrors(sheet, null);
      for (const [ms, date, hm, field] of [[checkIn, inDate, inHm, 'check_in_at'], [checkOut, outDate, outHm, 'check_out_at']]) {
        if (ms != null && (localDate(ms, TZ) !== date || localHm(ms, TZ) !== hm)) {
          showErrors(sheet, { ok: false, data: { field, error: GAP_WORDS } });
          return;
        }
      }
      const r = await office('PUT', `/api/office/visits/${v.id}/times`, {
        check_in_at: isoOf(checkIn), check_out_at: isoOf(checkOut), reason: q('#vs-fix-reason').value, version: v.version,
      });
      if (await done(r)) { timesNote = 'Times saved.'; draw(); onChanged(v); }
    });
    // Clarification 19: "The check-in was after midnight" is offered when the typed check-in is earlier than the visit's start;
    // "The check-out was after midnight" when the check-out instant would be at or before the check-in instant. Each starts ticked
    // when the stored event is already on a later date.
    const inBox = q('#vs-fix-in-overnight');
    const outBox = q('#vs-fix-overnight');
    inBox.checked = !!v.check_in && localDate(v.check_in.at, TZ) > v.date;
    outBox.checked = !!(v.check_in && v.check_out) && localDate(v.check_out.at, TZ) > localDate(v.check_in.at, TZ);
    const syncOvernight = () => {
      const typedIn = q('#vs-fix-in').value;
      const showIn = !!typedIn && typedIn < v.start;
      q('#vs-in-overnight-row').hidden = !showIn;
      if (!showIn) inBox.checked = false;
      const { outHm, inMs, baseDate } = timeDates();
      const atOrBefore = !!outHm && inMs != null && localToUtcMs(baseDate, outHm, TZ) <= inMs;
      q('#vs-overnight-row').hidden = !(atOrBefore || outBox.checked);
    };
    for (const el of [inBox, outBox, q('#vs-fix-in'), q('#vs-fix-out')]) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', syncOvernight);
    syncOvernight();
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

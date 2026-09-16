// Proofs that each page and office fix's assertion fails without the fix (M2c, extended in M3b). Same copy-and-break harness as
// the lettered controls: the unbroken copy passes first, then the broken copy must go red. One break per fix, one spec test
// each. Exit 0 only if every proof is red.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

const app = (copy, file) => path.join(copy, 'app', 'public', file)
const EARLIER_LOOP = '  for (let d = EARLIER_DAYS; d >= 1; d--) {'
const FORGET_LINE = '      if (rec?.key === key) s.removeItem(k)'

const inactive = (project) => [
  {
    name: `proof-inactive-list-${project}`,
    what: 'clarification 15 removed: the Workers screen lists active workers only',
    args: ['office.spec.mjs', '--project', project, '-g', 'deactivated worker'],
    breakIt: (copy) =>
      replaceOnce(
        app(copy, 'office/workers.js'),
        "office('GET', '/api/office/workers?all=1')",
        "office('GET', '/api/office/workers') /* PROOF */",
      ),
  },
  {
    name: `proof-inactive-sheet-${project}`,
    what: "clarification 15 removed: the edit sheet leaves out the visit's inactive current worker",
    args: ['office.spec.mjs', '--project', project, '-g', 'deactivated worker'],
    breakIt: (copy) =>
      replaceOnce(
        app(copy, 'office/sheet.js'),
        '    const inactive =\n      v.worker_id != null && !workers.some((w) => w.id === v.worker_id)',
        '    const inactive =\n      false /* PROOF */ && v.worker_id != null && !workers.some((w) => w.id === v.worker_id)',
      ),
  },
  {
    name: `proof-inactive-row-${project}`,
    what: 'clarification 15 removed: the week has no row (1280) or group (390) for an inactive worker named on a visit',
    args: ['office.spec.mjs', '--project', project, '-g', 'deactivated worker'],
    breakIt: (copy) =>
      replaceOnce(
        app(copy, 'office/week.js'),
        '      if (v.worker_id != null && !active.has(v.worker_id) && !inactive.has(v.worker_id)) {',
        '      if (false /* PROOF */ && v.worker_id != null && !active.has(v.worker_id) && !inactive.has(v.worker_id)) {',
      ),
  },
]

const PROOFS = [
  {
    name: 'proof-yesterday',
    what: 'clarifications 9/16 removed: w/app.js never loads an earlier day',
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', 'visit still open after midnight shows'],
    breakIt: (copy) =>
      replaceOnce(app(copy, 'w/app.js'), EARLIER_LOOP, '  for (let d = EARLIER_DAYS; d >= 99; d--) { // PROOF: no earlier day'),
  },
  {
    name: 'proof-queued-midnight',
    what: 'clarification 16 removed: a check-in still in the queue does not open an earlier day',
    // Not "still queued across midnight": there yesterday's saved list also holds the visit, so that spec can't tell (it stayed
    // green at 15:01Z). Here the new link has no saved list for yesterday; only the queue knows.
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', 'queued before midnight under an old link'],
    breakIt: (copy) =>
      replaceOnce(
        app(copy, 'w/app.js'),
        "    const queuedIn = queued.some((i) => i.event.kind === 'check_in')",
        '    const queuedIn = false // PROOF',
      ),
  },
  {
    name: 'proof-earlier-days',
    what: 'clarification 16 (item 4) removed: only yesterday is looked at, not 7 days back',
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', 'Still open from Sat Sep 12'],
    breakIt: (copy) => replaceOnce(app(copy, 'w/app.js'), EARLIER_LOOP, '  for (let d = 1; d >= 1; d--) { // PROOF: yesterday only'),
  },
  {
    name: 'proof-earlier-without-today',
    what: "clarification 16 (item 4) removed: earlier days are looked at only when today's list loaded",
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', 'Still open from Sat Sep 12'],
    breakIt: (copy) =>
      replaceOnce(
        app(copy, 'w/app.js'),
        '    await loadEarlier(S.answer?.date ?? localDate(Date.now(), TZ), true)',
        '    if (S.answer) await loadEarlier(S.answer.date, true); // PROOF',
      ),
  },
  {
    name: 'proof-forget',
    what: 'clarification 10 removed: a refused key leaves its saved lists and drafts on the phone',
    args: ['offline.spec.mjs', '--project', 'chromium-390', '-g', 'a refused link takes the saved lists'],
    breakIt: (copy) => replaceOnce(app(copy, 'w/app.js'), FORGET_LINE, '      // PROOF: nothing removed'),
  },
  {
    name: 'proof-draft-key',
    what: "clarification 16 (item 5) removed: a refused key deletes every link's saved lists and drafts",
    args: ['offline.spec.mjs', '--project', 'chromium-390', '-g', 'two links on one phone'],
    breakIt: (copy) => replaceOnce(app(copy, 'w/app.js'), FORGET_LINE, '      s.removeItem(k); // PROOF: every link'),
  },
  {
    name: 'proof-refusedcard',
    what: 'clarification 11 removed: a refused check-in is not shown on its card',
    args: ['offline.spec.mjs', '--project', 'chromium-390', '-g', 'Fix times stays on its card'],
    breakIt: (copy) =>
      replaceOnce(
        app(copy, 'w/app.js'),
        "  const refusedIn = S.refused.filter((i) => i.event.visit_id === v.id && i.event.kind === 'check_in').at(-1) ?? null",
        '  const refusedIn = null // PROOF',
      ),
  },
  {
    name: 'proof-check-in-again',
    what: 'clarification 11 removed: a refused check-in with no other check-in does not offer "Check in again"',
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', 'offers "Check in again"'],
    breakIt: (copy) =>
      replaceOnce(
        app(copy, 'w/app.js'),
        "  const status = cout ? 'done' : cin ? 'in' : v.cancelled ? 'cancelled' : refusedIn ? 'refused' : 'todo'",
        "  const status = cout ? 'done' : cin ? 'in' : v.cancelled ? 'cancelled' : 'todo'; // PROOF",
      ),
  },
  {
    name: 'proof-notecheck',
    what: 'clarification 8 (typing) removed: the page does not check the note for health card numbers',
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', '12-digit number in the note'],
    breakIt: (copy) =>
      replaceOnce(app(copy, 'w/app.js'), '  if (HEALTH_CARD.test(t)) return NOTE_CARD', '  // PROOF: no health card check'),
  },
  {
    name: 'proof-without-note',
    what: 'clarification 16 (item 6) removed: no "Check out without the note" next to the disabled button',
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', 'Check out without the note'],
    breakIt: (copy) =>
      replaceOnce(
        app(copy, 'w/app.js'),
        '    ${problem ? \'<button type="button" class="btn btn-outline" data-act="check-out-without-note">Check out without the note</button>\' : \'\'}',
        '    <!-- PROOF: no way out but fixing the note -->',
      ),
  },
  {
    name: 'proof-notice',
    what: 'clarification 8 (answer) removed: the page ignores note_refused / tasks_refused',
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', 'note refused on its way out'],
    breakIt: (copy) =>
      replaceOnce(
        app(copy, 'w/app.js'),
        '  onSent: (answers) => {\n    rememberRefusals(answers)\n    load()\n  },',
        '  onSent: () => {\n    load()\n  }, // PROOF',
      ),
  },
  {
    name: 'proof-retry-timing',
    what: 'clarification 17 (item 5): the queue waits 30 s after its first failure instead of 5 s',
    args: ['offline.spec.mjs', '--project', 'chromium-390', '-g', "not the Worker's answer"],
    breakIt: (copy) =>
      replaceOnce(
        app(copy, 'w/queue.js'),
        'const BACKOFF_MS = [5000, 15000, 30000, 60000]',
        'const BACKOFF_MS = [30000, 30000, 30000, 60000]; // PROOF: a slow retry schedule',
      ),
  },
  {
    name: 'proof-webgl-fallback',
    what: 'clarification 20 (no WebGL) removed: office/clients.js adds the MapLibre layer whether or not WebGL works',
    args: ['office.spec.mjs', '--project', 'chromium-1280', '-g', 'office PC without WebGL'],
    breakIt: (copy) => {
      const file = app(copy, 'office/clients.js')
      replaceOnce(file, "  if (!window.maplibregl || !L.maplibreGL || !webgl()) return 'plain'", '  // PROOF: no WebGL check')
      replaceOnce(file, '  try {\n    layer.addTo(map)\n  } catch {', '  layer.addTo(map) // PROOF: no fallback\n  try {\n  } catch {')
    },
  },
  {
    name: 'proof-card-kept',
    what: 'M3h removed: every redraw replaces all of the worker page, so an unchanged card becomes a new node',
    args: ['worker.spec.mjs', '--project', 'chromium-1280', '-g', 'still queued across midnight'],
    breakIt: (copy) =>
      replaceOnce(
        app(copy, 'w/app.js'),
        '  patchChildren(el, next)\n  return true',
        '  el.innerHTML = html; // PROOF: replace everything\n  return true;',
      ),
  },
  {
    name: 'proof-webgl-required',
    what: 'DECISIONS 54: office/clients.js never finds WebGL, so every browser gets the plain background',
    args: ['office.spec.mjs', '--project', 'chromium-1280', '-g', 'the OpenFreeMap attribution and its three links'],
    breakIt: (copy) => replaceOnce(app(copy, 'office/clients.js'), '    return !!gl', '    return false; // PROOF: no browser has WebGL'),
  },
  ...inactive('chromium-1280'),
  ...inactive('chromium-390'),
]

// PROOF=<name> runs one proof.
const only = process.env.PROOF
let failed = 0
for (const p of PROOFS.filter((x) => !only || x.name === only)) {
  const code = control(p)
  console.log(`${p.name}: ${code === 0 ? 'red as required' : code === 2 ? 'VOID' : 'STAYED GREEN'}`)
  if (code !== 0) failed += 1
}
process.exit(failed ? 1 : 0)

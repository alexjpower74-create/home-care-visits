// M2c proofs: each fix's assertion fails without the fix. Same copy-and-break harness as the lettered controls (the unbroken
// copy passes first, then the broken copy must go red); one break per fix, one spec test each. Exit 0 only if every proof is red.
import path from 'node:path';
import { control, replaceOnce } from './negative-lib.mjs';

const app = (copy, file) => path.join(copy, 'app', 'public', file);

const PROOFS = [
  {
    name: 'proof-yesterday',
    what: 'clarification 9 removed: w/app.js never loads yesterday',
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', 'Still open from yesterday'],
    breakIt: copy => replaceOnce(app(copy, 'w/app.js'),
      '  if (!queuedIn && !known?.visits.map(view).some(stillOpen)) { S.yesterday = null; return; }',
      '  S.yesterday = null; return; // PROOF: yesterday is never loaded'),
  },
  {
    name: 'proof-forget',
    what: 'clarification 10 removed: a refused key leaves the saved lists and drafts on the phone',
    args: ['offline.spec.mjs', '--project', 'chromium-390', '-g', 'a refused link takes the saved lists'],
    breakIt: copy => {
      replaceOnce(app(copy, 'w/app.js'), '      if (k.startsWith(DRAFT_PREFIX)) { s.removeItem(k); continue; }', '      if (k.startsWith(DRAFT_PREFIX)) continue; // PROOF');
      replaceOnce(app(copy, 'w/app.js'), '      if (!rec || rec.key === key) s.removeItem(k);', '      // PROOF: saved lists are kept');
    },
  },
  {
    name: 'proof-refusedcard',
    what: 'clarification 11 removed: a refused check-in is not shown on its card',
    args: ['offline.spec.mjs', '--project', 'chromium-390', '-g', 'Fix times stays on its card'],
    breakIt: copy => replaceOnce(app(copy, 'w/app.js'),
      "  const refusedIn = S.refused.filter(i => i.event.visit_id === v.id && i.event.kind === 'check_in').at(-1) ?? null;",
      '  const refusedIn = null; // PROOF'),
  },
  {
    name: 'proof-notecheck',
    what: 'clarification 8 (typing) removed: the page does not check the note for health card numbers',
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', '12-digit number in the note'],
    breakIt: copy => replaceOnce(app(copy, 'w/app.js'), '  if (HEALTH_CARD.test(t)) return NOTE_CARD;', '  // PROOF: no health card check'),
  },
  {
    name: 'proof-notice',
    what: "clarification 8 (answer) removed: the page ignores note_refused / tasks_refused",
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', 'note refused on its way out'],
    breakIt: copy => replaceOnce(app(copy, 'w/app.js'), '  onSent: answers => { rememberRefusals(answers); load(); },', '  onSent: () => { load(); }, // PROOF'),
  },
  {
    name: 'proof-inactive-list',
    what: 'clarification 15 removed: the Workers screen lists active workers only',
    args: ['office.spec.mjs', '--project', 'chromium-1280', '-g', 'deactivated worker'],
    breakIt: copy => replaceOnce(app(copy, 'office/workers.js'), "office('GET', '/api/office/workers?all=1')", "office('GET', '/api/office/workers') /* PROOF */"),
  },
  {
    name: 'proof-inactive-sheet',
    what: "clarification 15 removed: the edit sheet leaves out the visit's inactive current worker",
    args: ['office.spec.mjs', '--project', 'chromium-1280', '-g', 'deactivated worker'],
    breakIt: copy => replaceOnce(app(copy, 'office/sheet.js'),
      '    const inactive = v.worker_id != null && !workers.some(w => w.id === v.worker_id)',
      '    const inactive = false /* PROOF */ && v.worker_id != null && !workers.some(w => w.id === v.worker_id)'),
  },
  {
    name: 'proof-inactive-row',
    what: 'clarification 15 removed: the week has no row for an inactive worker named on a visit',
    args: ['office.spec.mjs', '--project', 'chromium-1280', '-g', 'deactivated worker'],
    breakIt: copy => replaceOnce(app(copy, 'office/week.js'),
      '      if (v.worker_id != null && !active.has(v.worker_id) && !inactive.has(v.worker_id)) {',
      '      if (false /* PROOF */ && v.worker_id != null && !active.has(v.worker_id) && !inactive.has(v.worker_id)) {'),
  },
];

let failed = 0;
for (const p of PROOFS) {
  const code = control(p);
  console.log(`${p.name}: ${code === 0 ? 'red as required' : code === 2 ? 'VOID' : 'STAYED GREEN'}`);
  if (code !== 0) failed += 1;
}
process.exit(failed ? 1 : 0);

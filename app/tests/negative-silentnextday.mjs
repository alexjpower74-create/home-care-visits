// Negative control (i): the copy's Fix times moves a check-out typed earlier than the check-in to the next day silently, without
// the "The check-out was after midnight" box. sheet.spec must go red (the first try is stored instead of refused).
import path from 'node:path';
import { control, replaceOnce } from './negative-lib.mjs';

process.exit(control({
  name: 'silentnextday',
  what: 'office/sheet.js sends an earlier check-out on the next day without the office ticking the box',
  args: ['sheet.spec.mjs', '--project', 'chromium-1280', '-g', 'after midnight'],
  breakIt: copy => replaceOnce(path.join(copy, 'app', 'public', 'office', 'sheet.js'),
    "      const outDate = q('#vs-fix-overnight').checked ? addDays(v.date, 1) : v.date;",
    "      const outDate = outHm && outHm <= (inHm || (v.check_in ? localHm(v.check_in.at, TZ) : '')) ? addDays(v.date, 1) : v.date; // NEGATIVE CONTROL (i)"),
}));

// Negative control (i): the copy's Fix times moves a check-out whose instant is at or before the check-in to the next day
// silently, without the "The check-out was after midnight" box. sheet.spec must go red (the first try is stored, not refused).
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(
  control({
    name: 'silentnextday',
    what: 'office/sheet.js sends an earlier check-out on the next day without the office ticking the box',
    args: ['sheet.spec.mjs', '--project', 'chromium-1280', '-g', 'refused unless "The check-out was after midnight"'],
    breakIt: (copy) =>
      replaceOnce(
        path.join(copy, 'app', 'public', 'office', 'sheet.js'),
        "      const outDate = q('#vs-fix-overnight').checked ? addDays(baseDate, 1) : baseDate",
        '      const outDate = outHm && inMs != null && localToUtcMs(baseDate, outHm, TZ) <= inMs ? addDays(baseDate, 1) : baseDate; // NEGATIVE CONTROL (i)',
      ),
  }),
)

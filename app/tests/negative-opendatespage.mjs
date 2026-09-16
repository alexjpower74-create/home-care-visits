// Negative control (l): the copy's worker page ignores the answer's open_dates. worker.spec's lost-phone test must go red: a
// visit checked in three days ago from another phone gets no "Still open from …" section on a clean phone.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(
  control({
    name: 'opendatespage',
    what: 'w/app.js does not load the dates the Worker names in open_dates',
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', 'lost phone three days ago'],
    breakIt: (copy) =>
      replaceOnce(
        path.join(copy, 'app', 'public', 'w', 'app.js'),
        '    const named = openDates.includes(date)',
        '    const named = false; // NEGATIVE CONTROL (l)',
      ),
  }),
)

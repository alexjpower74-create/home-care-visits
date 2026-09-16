// Negative control (k): the copy's worker page renders only after the visits GET answers (no saved list first). offline.spec's
// "never answers" test must go red: nothing is on screen within 1 s.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(
  control({
    name: 'savedfirst',
    what: 'w/app.js waits for GET /api/worker/visits before drawing the saved list',
    args: ['offline.spec.mjs', '--project', 'chromium-390', '-g', 'never answers'],
    breakIt: (copy) =>
      replaceOnce(
        path.join(copy, 'app', 'public', 'w', 'app.js'),
        'refreshQueue().then(showSaved).then(load)',
        'refreshQueue().then(load); // NEGATIVE CONTROL (k): the network first',
      ),
  }),
)

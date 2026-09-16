// Negative control (e): a transparent element over Check in, in a copy of the worker page. The tap() hit-test in
// worker.spec.mjs must go red (a rectangle check would still call the button fine).
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(
  control({
    name: 'overlay',
    what: 'w/app.js wraps Check in with a transparent element laid over it',
    args: ['worker.spec.mjs', '--project', 'chromium-390', '-g', 'check in near the client'],
    breakIt: (copy) =>
      replaceOnce(
        path.join(copy, 'app', 'public', 'w', 'app.js'),
        '`<button type="button" class="btn btn-big btn-check-in" data-act="check-in" data-visit="${v.id}">${x.status === \'refused\' ? \'Check in again\' : \'Check in\'}</button>`',
        '`<div style="position:relative"><button type="button" class="btn btn-big btn-check-in" data-act="check-in" data-visit="${v.id}">${x.status === \'refused\' ? \'Check in again\' : \'Check in\'}</button><div style="position:absolute;inset:0;background:transparent"></div></div>` /* NEGATIVE CONTROL (e) */',
      ),
  }),
)

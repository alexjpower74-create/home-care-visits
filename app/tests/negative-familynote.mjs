// Negative control (d): the copied WORKER's family answer includes every note whatever `shareable` says (the page is not
// touched). family.spec.mjs's "the note is not on the page" step must go red.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(
  control({
    name: 'familynote',
    what: 'worker/src/index.js family answer returns the note text even when it is not shareable',
    args: ['family.spec.mjs', '--project', 'chromium-1280'],
    breakIt: (copy) =>
      replaceOnce(
        path.join(copy, 'worker', 'src', 'index.js'),
        'note: checkOut && note && note.shareable ? note.text : null',
        'note: checkOut && note ? note.text : null // NEGATIVE CONTROL (d)',
      ),
  }),
)

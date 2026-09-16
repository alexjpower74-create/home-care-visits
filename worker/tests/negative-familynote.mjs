// npm run negative:familynote — the copy's family answer includes the note text whatever `shareable` says.
// The family privacy test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:familynote',
  testFile: 'tests/api.test.mjs',
  tests: ['family privacy: a checked-out visit with a non-shareable note'],
  api: true,
  breaks: [
    {
      file: 'src/index.js',
      find: 'note: checkOut && note && note.shareable ? note.text : null',
      replace: 'note: checkOut && note ? note.text : null',
    },
  ],
  describe: 'the family answer carries a note the office has not marked shareable',
})

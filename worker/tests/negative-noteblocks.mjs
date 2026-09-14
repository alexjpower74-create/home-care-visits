// npm run negative:noteblocks — the copy refuses the whole check-out when its note breaks a rule (API.md clarification 8).
// The test that a note never costs a check-out must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:noteblocks',
  testFile: 'tests/api.test.mjs',
  tests: ['check-out: a note or a task list that breaks a rule never costs the check-out'],
  api: true,
  breaks: [{ file: 'src/index.js', find: '    out.note_refused = e.body.error\n', replace: '    throw e\n' }],
  describe: 'a note that breaks a rule refuses the check-out with it'
})

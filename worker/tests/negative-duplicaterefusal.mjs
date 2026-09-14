// npm run negative:duplicaterefusal — the copy's 200 duplicate answer drops the refusal stored on the check-out
// (API.md clarification 16). A resend after a lost 201 then never tells the worker the note was not saved: the test goes red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:duplicaterefusal',
  testFile: 'tests/api.test.mjs',
  tests: ['check-out: a note or a task list that breaks a rule never costs the check-out'],
  api: true,
  breaks: [{ file: 'src/index.js', find: ', ...storedRefusals(stored) })', replace: ' })' }],
  describe: "a resend's duplicate answer forgets the refusal stored on the check-out"
})

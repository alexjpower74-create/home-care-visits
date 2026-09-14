// npm run negative:time — the copy stores server now instead of the phone's `at`. The original-time test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:time',
  testFile: 'tests/api.test.mjs',
  tests: ['events: original time kept'],
  api: true,
  breaks: [{ file: 'src/rules.js', find: 'return { atMs: at, adjusted: false }', replace: 'return { atMs: now, adjusted: false }' }],
  describe: 'the Worker stores the time the event arrived instead of the time the worker tapped'
})

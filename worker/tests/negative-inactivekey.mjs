// npm run negative:inactivekey — the copy refuses the key of an inactive worker (API.md clarification 5). The test of a
// departed worker's saved check-out must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:inactivekey',
  testFile: 'tests/api.test.mjs',
  tests: ['worker key: deactivating a worker keeps their link'],
  api: true,
  breaks: [{ file: 'src/index.js', find: "'SELECT * FROM workers WHERE worker_key = ?1'", replace: "'SELECT * FROM workers WHERE worker_key = ?1 AND active = 1'" }],
  describe: 'an inactive worker\'s link stops working before anyone makes a new one'
})

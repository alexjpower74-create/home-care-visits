// npm run negative:reassignedlist — the copy's worker list returns only the visits currently assigned to the worker (API.md
// clarification 21). A worker who checked in just before the office moved the visit loses the card: the test goes red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:reassignedlist',
  testFile: 'tests/api.test.mjs',
  tests: ['worker visits: a visit this worker checked in to stays on their list after a reassignment'],
  api: true,
  breaks: [
    {
      file: 'src/index.js',
      find: " OR EXISTS (SELECT 1 FROM events ce WHERE ce.visit_id = v.id AND ce.kind = 'check_in' AND ce.voided_at IS NULL AND ce.worker_id = ?2))",
      replace: ')',
    },
  ],
  describe: "the worker's list leaves out a visit they checked in to once the office gives it to someone else",
})

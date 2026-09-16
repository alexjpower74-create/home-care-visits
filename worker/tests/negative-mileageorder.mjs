// npm run negative:mileageorder — the copy orders a day's legs by the scheduled start instead of the check-in. The
// check-in-order test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:mileageorder',
  testFile: 'tests/api.test.mjs',
  tests: ['reports: mileage follows check-in order'],
  api: true,
  breaks: [
    {
      file: 'src/reports.js',
      find: 'list.sort((a, b) => a.at.localeCompare(b.at) || a.visit_id - b.visit_id)',
      replace: 'list.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.visit_id - b.visit_id)',
    },
  ],
  describe: 'mileage legs follow the schedule instead of the order the worker checked in',
})

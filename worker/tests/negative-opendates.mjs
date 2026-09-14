// npm run negative:opendates — the copy's open_dates look back only to yesterday (API.md clarification 18). A visit left open
// 3 days ago is then never offered to a new phone: the open_dates test goes red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:opendates',
  testFile: 'tests/api.test.mjs',
  tests: ['worker visits: open_dates lists the earlier days'],
  api: true,
  breaks: [{ file: 'src/index.js', find: '.bind(worker.id, addDays(today, -7), today).all()', replace: '.bind(worker.id, addDays(today, -1), today).all()' }],
  describe: 'open_dates leave out days older than yesterday'
})

// npm run negative:missedcancel — the copy counts cancelled visits as missed. The missed test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:missedcancel',
  testFile: 'tests/api.test.mjs',
  tests: ['reports: missed excludes cancelled visits'],
  api: true,
  breaks: [{ file: 'src/reports.js', find: '} else if (!v.cancelled && Date.parse(v.starts_at) + MISSED_MS <= nowMs) {', replace: '} else if (Date.parse(v.starts_at) + MISSED_MS <= nowMs) {' }],
  describe: 'a cancelled visit with no check-in is reported as missed'
})

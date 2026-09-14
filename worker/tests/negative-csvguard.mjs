// npm run negative:csvguard — the copy drops the CSV formula guard. The CSV test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:csvguard',
  testFile: 'tests/api.test.mjs',
  tests: ['reports: CSV'],
  api: true,
  breaks: [{ file: 'src/reports.js', find: "  if (FORMULA.test(s)) s = `'${s}`\n", replace: '' }],
  describe: 'a text cell starting with = is written as is'
})

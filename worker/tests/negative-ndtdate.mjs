// npm run negative:ndtdate — the copy dates a check-in by its UTC date instead of its NL date. The 23:50 NDT test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:ndtdate',
  testFile: 'tests/api.test.mjs',
  tests: ['reports: payroll period uses the NL date of the check-in'],
  api: true,
  breaks: [{ file: 'src/reports.js', find: '  const date = nlDate(atIso)\n', replace: '  const date = atIso.slice(0, 10)\n' }],
  describe: 'the period uses the UTC date of the check-in'
})

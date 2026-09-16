// npm run negative:payrollround — the copy rounds each visit's hours and adds the rounded values. The exactness test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:payrollround',
  testFile: 'tests/api.test.mjs',
  tests: ['reports: payroll exactness'],
  api: true,
  breaks: [
    {
      file: 'src/reports.js',
      find: 'hours: decimalHours(seconds)',
      replace: 'hours: (list.reduce((h, v) => h + Math.floor((v.seconds * 100 + 1800) / 3600), 0) / 100).toFixed(2)',
    },
  ],
  describe: 'hours are rounded per visit and then added',
})

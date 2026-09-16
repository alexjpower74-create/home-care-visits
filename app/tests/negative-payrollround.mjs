// Negative control (g) (PLAN.md's M3 control; "(f)" there, lettered (g) because (f) is the captive portal): the copy's Payroll
// screen shows the rows' rounded hours added up instead of the Worker's total. reports.spec must go red (2.02 instead of 2.01).
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(
  control({
    name: 'payrollround',
    what: "office/reports.js Payroll total = the rounded rows added up (not the Worker's total)",
    args: ['reports.spec.mjs', '--project', 'chromium-1280'],
    breakIt: (copy) =>
      replaceOnce(
        path.join(copy, 'app', 'public', 'office', 'reports.js'),
        '  const totalHours = d.total.hours;',
        '  const totalHours = d.rows.reduce((sum, w) => sum + Number(w.hours), 0).toFixed(2); // NEGATIVE CONTROL (g)',
      ),
  }),
)

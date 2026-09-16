// Negative control (j): the copy's report presets are computed once, when the Reports tab opens. reports.spec's preset test must
// go red: three days later "Last week" still shows the week before the tab was opened.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(
  control({
    name: 'presetsmount',
    what: 'office/reports.js computes This week / Last week / Last 14 days at mount, not when pressed',
    args: ['reports.spec.mjs', '--project', 'chromium-1280', '-g', 'presets read the page clock when pressed'],
    breakIt: (copy) => {
      const file = path.join(copy, 'app', 'public', 'office', 'reports.js')
      replaceOnce(
        file,
        "  let [from, to] = presetRange('this-week');",
        "  const MOUNT_PRESETS = Object.fromEntries(['this-week', 'last-week', 'last-14'].map(n => [n, presetRange(n)])); // NEGATIVE CONTROL (j)\n  let [from, to] = presetRange('this-week');",
      )
      replaceOnce(
        file,
        '      [from, to] = presetRange(b.dataset.preset);',
        '      [from, to] = MOUNT_PRESETS[b.dataset.preset]; // NEGATIVE CONTROL (j)',
      )
    },
  }),
)

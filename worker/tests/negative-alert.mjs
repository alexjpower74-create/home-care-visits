// npm run negative:alert — the copy's late rule uses > instead of ≥ at 15 minutes. The boundary test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:alert',
  testFile: 'tests/unit.test.mjs',
  tests: ['late/missed rule at the boundaries'],
  breaks: [
    { file: 'src/rules.js', find: "if (nowMs >= start + LATE_MS) return 'late'", replace: "if (nowMs > start + LATE_MS) return 'late'" },
  ],
  describe: 'a visit exactly 15:00.000 after its start is not yet late',
})

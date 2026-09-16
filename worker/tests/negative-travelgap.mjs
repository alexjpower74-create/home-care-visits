// npm run negative:travelgap — the copy needs only the straight-line minutes, without the 1.3 road factor.
// The travel-gap boundary and the SAMPLE base-week conflicts must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:travelgap',
  testFile: 'tests/conflicts.test.mjs',
  tests: ['conflicts: travel-gap boundary', 'conflicts: the SAMPLE base week', 'conflicts: a hand-built week'],
  breaks: [{ file: 'src/conflicts.js', find: 'Math.ceil((metres * 1.3) / 1000)', replace: 'Math.ceil(metres / 1000)' }],
  describe: 'the needed travel time drops the 1.3 factor on the straight-line distance',
})

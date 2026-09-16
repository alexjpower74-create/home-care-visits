// npm run negative:rebuilddelete — the copy hard-deletes a rebuilt pattern's future visits instead of soft-removing them
// (API.md clarification 7). A check-in the phone tapped before the change then has no visit: the late check-in test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:rebuilddelete',
  testFile: 'tests/api.test.mjs',
  tests: ['soft-remove: a check-in tapped before the pattern changed'],
  api: true,
  breaks: [
    {
      file: 'src/index.js',
      find: 'UPDATE visits SET removed_at = ?1, removed_reason = ?${ending.length + 2} WHERE id IN (${doomed}) RETURNING id',
      replace: 'DELETE FROM visits WHERE id IN (${doomed}) AND ?${ending.length + 2} IS NOT NULL RETURNING id',
    },
  ],
  describe: 'rebuilt visits are deleted, so a check-in tapped before the change is refused',
})

// npm run negative:pinsessions — the copy changes the PIN but keeps every other office session (API.md clarification 17).
// A browser signed in before the change keeps working: the PIN session test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:pinsessions',
  testFile: 'tests/api.test.mjs',
  tests: ['office PIN: a successful change ends every other session'],
  api: true,
  breaks: [{ file: 'src/index.js', find: ",\n    db.prepare('DELETE FROM sessions WHERE token_hash <> ?1').bind(ctx.tokenHash)\n  ])", replace: '\n  ])' }],
  describe: 'a PIN change leaves other signed-in browsers working'
})

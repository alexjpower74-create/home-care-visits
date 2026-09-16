// npm run negative:idempotent — in the copy, events.id is no PRIMARY KEY (its migration) and the event insert no longer
// finds a stored id first. A resent id then lands as a second row: the same-id test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:idempotent',
  testFile: 'tests/api.test.mjs',
  tests: ['events: the same id again answers 200 duplicate and the database still holds exactly one row'],
  api: true,
  breaks: [
    {
      file: 'migrations/0001_init.sql',
      find: '  id TEXT PRIMARY KEY,\n  visit_id INTEGER NOT NULL',
      replace: '  id TEXT NOT NULL,\n  visit_id INTEGER NOT NULL',
    },
    {
      file: 'src/index.js',
      find: "'SELECT * FROM events WHERE id = ?1 LIMIT 1'",
      replace: "'SELECT * FROM events WHERE id = ?1 AND 0 LIMIT 1'",
    },
  ],
  describe: 'events.id is not a primary key and the insert ignores an id that is already stored',
})

// Negative control (b): the copy stamps `at` when the item is sent instead of when the worker tapped. The original-time
// assertions of offline.spec.mjs's no-signal test must go red (the send happens 40 minutes after the check-out).
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(
  control({
    name: 'time',
    what: 'w/queue.js posts each event with at = the send time instead of the time tapped',
    args: ['offline.spec.mjs', '--project', 'chromium-390', '-g', 'no signal: check-in and check-out are saved'],
    breakIt: (copy) =>
      replaceOnce(
        path.join(copy, 'app', 'public', 'w', 'queue.js'),
        '      return await send(key, event, timeoutSignal(TIMEOUT_MS))',
        '      return await send(key, { ...event, at: new Date().toISOString() }, timeoutSignal(TIMEOUT_MS)) // NEGATIVE CONTROL (b)',
      ),
  }),
)

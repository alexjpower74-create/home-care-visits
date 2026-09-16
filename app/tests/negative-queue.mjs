// Negative control (a): the copy's queue deletes an item BEFORE the server answers. offline.spec.mjs's 500-once test must go
// red: the first send is answered 500, the item is already gone, so that visit's event never reaches the server.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(
  control({
    name: 'queue',
    what: 'w/queue.js deletes the item from IndexedDB before posting it, whatever the server answers',
    args: ['offline.spec.mjs', '--project', 'chromium-390', '-g', 'a 500 when signal comes back'],
    breakIt: (copy) =>
      replaceOnce(
        path.join(copy, 'app', 'public', 'w', 'queue.js'),
        '      const res = await post(key, item.event)\n',
        '      await confirmSent(item.seq); // NEGATIVE CONTROL (a): removed before the server answers\n      const res = await post(key, item.event)\n',
      ),
  }),
)

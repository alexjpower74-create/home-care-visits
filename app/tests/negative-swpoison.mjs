// Negative control (h): the copy's service worker caches any 200 for the worker page's files (no Content-Type check, no page
// marker). offline.spec's Wi-Fi login page test must go red: the login page replaces the worker page in the cache.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(
  control({
    name: 'swpoison',
    what: 'w/sw.js caches any 200 (no Content-Type check, no hcv-page marker)',
    args: ['offline.spec.mjs', '--project', 'chromium-390', '-g', "Wi-Fi login page answering the worker page's files"],
    breakIt: (copy) => {
      const sw = path.join(copy, 'app', 'public', 'w', 'sw.js')
      replaceOnce(
        sw,
        '  if (res.status !== 200 || res.redirected || !typeMatches(path, res)) return null',
        '  if (res.status !== 200) return null; // NEGATIVE CONTROL (h)',
      )
      replaceOnce(
        sw,
        "  if (path === '/w/' && !new TextDecoder().decode(buf).includes(MARKER)) return null",
        '  // NEGATIVE CONTROL (h): no page marker',
      )
    },
  }),
)

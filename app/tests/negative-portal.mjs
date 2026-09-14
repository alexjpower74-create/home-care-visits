// Negative control (f): the copy's queue confirms an event on any 200, without checking that the answer names the event
// (clarification 6). offline.spec.mjs's captive-portal test must go red: the Wi-Fi login page's 200 deletes the check-in.
import path from 'node:path';
import { control, replaceOnce } from './negative-lib.mjs';

process.exit(control({
  name: 'portal',
  what: "w/queue.js treats any 200/201 as sent, whatever the body (a Wi-Fi login page's 200 deletes the event)",
  args: ['offline.spec.mjs', '--project', 'chromium-390', '-g', "not the Worker's answer"],
  breakIt: copy => replaceOnce(path.join(copy, 'app', 'public', 'w', 'queue.js'),
    '      if ((s === 200 || s === 201) && answeredFor(res, item)) {\n',
    '      if (s === 200 || s === 201) { // NEGATIVE CONTROL (f): any 200 counts as sent\n'),
}));

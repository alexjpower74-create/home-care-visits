// Negative control (c): the copy's board rule turns late at 16 minutes. board.spec.mjs's 09:15:00 assertion must go red.
import path from 'node:path';
import { control, replaceOnce } from './negative-lib.mjs';

process.exit(control({
  name: 'board',
  what: 'public/rules.js turns a visit late 16 minutes after its start instead of 15',
  args: ['board.spec.mjs', '--project', 'chromium-1280'],
  breakIt: copy => replaceOnce(path.join(copy, 'app', 'public', 'rules.js'),
    'export const LATE_AFTER_MS = 15 * 60000;',
    'export const LATE_AFTER_MS = 16 * 60000; // NEGATIVE CONTROL (c)'),
}));

// npm run negative: every app/tests/negative-*.mjs except the shared library, one at a time in name order. Each control and the
// proofs script exits 0 only when its checks went red on their broken copies; this exits non-zero if any did not.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = path.dirname(fileURLToPath(import.meta.url));
const scripts = readdirSync(TESTS).filter(f => /^negative-.+\.mjs$/.test(f) && f !== 'negative-lib.mjs').sort();
const failed = [];
for (const script of scripts) {
  console.log(`\n=== ${script}`);
  const r = spawnSync(process.execPath, [path.join(TESTS, script)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(`${script} (exit ${r.status})`);
}
console.log(failed.length ? `\nNOT ALL RED: ${failed.join(', ')}` : `\nAll ${scripts.length} negative-control scripts went red as required.`);
process.exit(failed.length ? 1 : 0);

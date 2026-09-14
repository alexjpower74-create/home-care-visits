// Playwright webServer: a fresh local Worker for the e2e suite. From ../worker (or E2E_WORKER_DIR, a copy for negative
// controls) it wipes app/tests/.state-<port>, applies the D1 migrations into it (--local), then runs wrangler dev on
// E2E_PORT (inspector +10) with TEST_MODE=1. Local only: never --remote, never deploy.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.resolve(process.env.E2E_WORKER_DIR || path.join(APP, '..', 'worker'));
const PORT = Number(process.env.E2E_PORT || 7903);
const STATE = path.join(APP, 'tests', `.state-${PORT}`);
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };

if (!existsSync(path.join(WORKER, 'wrangler.toml'))) {
  console.error(`start-worker: no wrangler.toml in ${path.relative(APP, WORKER)} (is hc1's Worker merged into this branch?)`);
  process.exit(1);
}

rmSync(STATE, { recursive: true, force: true });
const migrate = spawnSync('wrangler', ['d1', 'migrations', 'apply', 'home-care-visits', '--local', '--persist-to', STATE], {
  cwd: WORKER, stdio: ['ignore', 'inherit', 'inherit'], env,
});
if (migrate.status !== 0) {
  console.error(`start-worker: migrations failed (exit ${migrate.status})`);
  process.exit(migrate.status || 1);
}

const dev = spawn('wrangler', ['dev', '--local', '--port', String(PORT), '--inspector-port', String(PORT + 10),
  '--persist-to', STATE, '--var', 'TEST_MODE:1', '--show-interactive-dev-session=false'], {
  cwd: WORKER, stdio: ['ignore', 'inherit', 'inherit'], env,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => dev.kill(signal));
dev.on('exit', code => process.exit(code ?? 0));

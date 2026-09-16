// Home Care Visits end-to-end suite. Every spec runs against the real Worker (it serves app/public too), started fresh by
// tests/start-worker.mjs on E2E_PORT (default 7903, inspector +10) with TEST_MODE=1. One worker: the specs share one D1.
// E2E_WORKER_DIR points it at a copy (negative controls, port 7906).
// @phone tests do not run on the 1280 projects and @desktop tests do not run on the 390 projects: filtered, never skipped.
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT || 7903)

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: './tests/results',
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/start-worker.mjs',
    url: `http://127.0.0.1:${PORT}/api/agency`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...process.env, E2E_PORT: String(PORT) },
  },
  projects: [
    {
      name: 'chromium-390',
      grepInvert: /@desktop/,
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    },
    { name: 'chromium-1280', grepInvert: /@phone/, use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'webkit-390', grepInvert: /@desktop/, use: { ...devices['iPhone 14'], browserName: 'webkit' } },
    { name: 'webkit-1280', grepInvert: /@phone/, use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } } },
  ],
})

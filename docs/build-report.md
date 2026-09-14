# Build report: Home Care Visits (lead)

Overnight build 2026-09-14. Lead `hc-lead` (Opus 5, xhigh), slices `hc1` (Worker, D1, rules, reports) and `hc2` (worker phone,
family link, office, Playwright), both Opus 5 medium. Every number below comes from a QA worktree pinned to the named sha on
port 7909 (`rig qa --ref <sha>`), never from a slice's tree. The slices' own reports are `docs/build-report-hc1.md` and
`docs/build-report-hc2.md`.

## QA history (lead's pinned runs)

| when | sha | what | result |
|---|---|---|---|
| 10:31 | `7d50ed2` (hc1 M1) | Worker `npm test` | unit 23/0/0 · API 48/0/0 |
| 10:56 | `f74b413` (hc1 M2) | Worker `npm test` | unit 23/0/0 · API 62/0/0 |
| 11:04 | `f367d7d` (hc1 M3) | Worker `npm test` | unit 23/0/0 · API 66/0/0 |
| 11:22 | `866ee71` (main: hc1 M3 + hc2 M2 part B) | Playwright, 4 projects | **64 passed / 2 failed / 0 skipped** (below) |
| 11:45 | `0c33594` (main: + hc2 M2c) | Playwright, 4 projects | **98 passed / 0 failed / 0 skipped** (2.9 min; the two timing-sensitive specs still await hc2's fix, DECISIONS 36) |
| 11:53 | `a9e0f96` (hc1 M4) | Worker `npm test` | unit 23/0/0 · API 66/0/0 |
| 12:22 | `5bac755` (main: + hc1 M4 + hc2 M3) | Playwright, 4 projects | **130 passed / 0 failed / 0 skipped** (5.9 min; timing fixes in, DECISIONS 36 closed) |
| 12:25 | `6e6fa1c` (hc1 M5) | Worker `npm test` | unit 23/0/0 · API 68/0/0 |
| 12:58 | `5883591` (main: + hc1 M5 + hc2 M3b) | Playwright, 4 projects | **166 passed / 0 failed / 4 skipped** (7.8 min) |
| 13:02 | `bbf034b` (hc1 M6) | Worker `npm test` | unit 23/0/0 · API 69/0/0 |

### The two failures at `866ee71`, and why they are spec defects, not flakes to re-run
1. `board.spec.mjs` on webkit-390: at "09:29:59" the row was already `missed`. The spec calls `page.clock.install({ time })`,
   which leaves the page clock **running in real time**; each `runFor` adds on top of the seconds the machine spent between steps.
   With another crew and hc2's own suite running, those seconds pushed 09:29:59 past 09:30:00. A clock check that depends on
   machine speed can pass or fail for the wrong reason. Fix: `page.clock.pauseAt(...)` right after `install`, so only `runFor`
   moves time.
2. `offline.spec.mjs` › "a check-out the office already has…" on chromium-1280: no 409 within 90 s. The spec freezes `Date.now()`
   with `setFixedTime(T + 5 min)`; wrangler's local proxy dropped one event POST ("Network connection lost") after that, so the
   queue backed off to a due time later than the frozen clock can ever reach, and its 20 s tick respects the backoff. A real
   phone's clock moves, so the product is right; the spec cannot survive one transient failure. Fix: advance the page clock in
   steps (e.g. `runFor(5000)` in a loop) until the 409 arrives, as the 500-once test already does.

Both go to hc2 before M3 (DECISIONS 36).

## Cross-review findings so far
- hc1 → hc2 (M1 pages, 10:54): 7 findings, 2 DATA LOSS (captive-portal 200 deletes a queued check-out; a pattern rebuild deletes
  a visit a phone already checked in to), 2 PAYROLL, 1 PRIVACY, 1 PAYROLL (low), 1 OTHER → API.md clarifications 6-12.
- hc2 → hc1 (M1 Worker, 11:07): 1 contract gap (inactive worker's key), already fixed by hc1 M2 (clarification 5); 1 route
  called before it existed (fallback to be removed).
- hc1 → hc2 (office pages at `7bbd204`, 11:07): 9 findings (2 SECURITY, 1 DATA LOSS still open from R1, 2 PAYROLL, 1 PRIVACY,
  3 OTHER) and 5 spec gaps where a broken product would still pass → API.md clarification 15 and hc2's M2c.

## Negative controls recorded by the slices (the lead re-runs all of them in the final QA)
- Worker (hc1): (a) idempotent, (b) original time, (c) family note, (d) alert boundary, (e) travel-gap factor, (f) payroll
  rounding, (g) mileage order, (h) CSV formula guard, (i) missed excludes cancelled, (j) NL date of check-in, (k) inactive worker
  key, (l) rebuild hard-delete, (m) note blocks check-out.
- App (hc2): (a) queue deletes before the answer, (b) `at` stamped at send, (c) board late at 16 min, (d) Worker family answer
  leaks every note, (e) overlay over Check in.

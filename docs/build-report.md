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
| 13:30 | `6cb9e81` (main: + hc1 M6 + hc2 M3c) | Playwright, 4 projects | **189 passed / 1 failed / 4 skipped**: `targets.spec` on webkit-390 failed the fixture's no-uncaught-page-errors check, not contrast. The worker page's `GET /api/worker/visits` was still in flight when the test navigated to the office, and WebKit reported the aborted fetch as an uncaught rejection. A real defect: a dropped visits request must never surface uncaught. Sent to hc2 with M3d (API.md 18). |
| 14:37 | `d9a7401` (hc1 M7) | Worker `npm test` | unit 23/0/0 · API 71/0/0 |
| 16:32 | `b51d4b1` (main: every milestone; final QA, attempt 1) | Worker suite, 17 Worker controls, Playwright, every app control | unit 23/0/0 · API 71/0/0 · 17/17 Worker controls red · **Playwright 223 passed / 1 failed / 4 skipped** · 14/14 app control scripts red (all proofs included). The red: `worker.spec` across-midnight test on chromium-1280 tapped Check out while the card was redrawn from the saved list to the network answer ("Element is not attached to the DOM"). Sent to hc2 as M3h; not re-run. |
| 17:23 | `ab47a00` (main: + hc2 M3h; final QA, attempt 2) | Worker suite, Playwright, every app control (Worker controls carried over) | unit 23/0/0 · API 71/0/0 · **Playwright 224 passed / 0 failed / 4 skipped** · 14/14 app control scripts red · 17/17 Worker controls red at `b51d4b1`, `git diff b51d4b1 ab47a00 -- worker/` empty |

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

## Final QA
**Green at `ab47a00`** (17:23), one pinned run, nothing re-run to green:
- Worker `npm test`: unit 23 passed / 0 failed / 0 skipped; API 71 / 0 / 0.
- Playwright, 4 projects (chromium-390, chromium-1280, webkit-390 iPhone 14, webkit-1280): **224 passed / 0 failed / 4 skipped**.
  The 4 skips are `offline.spec` "with no signal after midnight, a reload still shows yesterday's open visit and checks it out" and
  "a Wi-Fi login page answering the worker page's files never replaces them in the cache" on webkit-390 and webkit-1280: Playwright's
  WebKit cannot reload a page while offline. Both run in Chromium.
- App negative controls: 14 of 14 scripts red, (a)-(m) and the proofs script with every proof red.
- Worker negative controls: 17 of 17 red at `b51d4b1`. They carry over because `git diff b51d4b1 ab47a00 -- worker/` is empty.
- Attempt 1 at `b51d4b1` had one red Playwright test (a spec tapping a card mid-redraw). It was fixed in the spec and in the page (a
  redraw keeps unchanged nodes), not re-run (DECISIONS 55).

## Cross-review: every defect crossed the slice boundary
The two slices reviewed each other read-only after every milestone (from committed branches, never the other's worktree). Self-tests
found none of the findings below; each became a numbered clarification in `docs/API.md` and a test that fails without its fix.

| round | reviewer → reviewed | findings | worst | became |
|---|---|---|---|---|
| 10:54 | hc1 → hc2 M1 (phone, family) | 7 | DATA LOSS: a Wi-Fi login page's 200 deleted a queued check-out; a pattern rebuild deleted a visit a phone had checked in to | API 6-12 |
| 11:07 | hc2 → hc1 M1 (Worker) | 2 | a deactivated worker's link refused (already fixed by hc1 M2) | API 5 |
| 11:07 | hc1 → hc2 office (early, `7bbd204`) | 9 + 5 spec gaps | SECURITY: an inactive worker vanished with no screen to stop their link; specs that passed a check-out stamped at check-in time | API 15 |
| 11:46 | hc1 → hc2 M2c | 10 | DATA LOSS: the service worker cached a login page as the worker page; a refused old link deleted drafts typed under the new one | API 16 |
| 12:15 | hc1 → hc2 M3 (office) | 8 | PAYROLL: an AM/PM slip stored as a 14-hour overnight shift; SECURITY: a PIN change left other sessions signed in | API 17 |
| 12:53 | hc1 → hc2 M3b | 3 + known gaps | PAYROLL: a slow line hid the saved list; Dismiss deleted the refused tap; a lost phone's open visit could not be checked out | API 18 |
| 13:01 | hc1 → hc2 M3c (early) | 1 + small | PAYROLL: Fix times could not complete a visit whose check-in was after midnight | API 19 |
| 14:28 | hc1 → hc2 M3d | 1 + known gaps | PAYROLL: a visit reassigned after an offline check-in could not be checked out by anyone | API 21 (Worker) |
| 15:27 | hc1 → hc2 M3e (maps) | 0 + 4 known gaps | two checks that could not fail (map fallback, unanswered tile request) | M3g |

Lead QA findings: at `866ee71` two spec timing defects (a running page clock, a frozen clock stalling a retry; DECISIONS 36); at
`6cb9e81` one WebKit-only red that hc1 traced to WebKit logging a handled, cancelled fetch as a page error during navigation
(DECISIONS 49; fixed in the spec, never filtered). A mid-sprint rule moved the maps to OpenFreeMap (DECISIONS 50, API 20).

## Negative controls (each breaks a copy, must pass unbroken first, then go red)
- **Worker (hc1), 17:** (a) idempotent event ids, (b) original tap time, (c) family note privacy, (d) late boundary at 15:00,
  (e) travel-gap road factor, (f) payroll rounded once, (g) mileage in check-in order, (h) CSV formula guard, (i) missed excludes
  cancelled, (j) NL date of the check-in, (k) inactive worker's link, (l) rebuild soft-removes, (m) a note never blocks a check-out,
  (n) a duplicate repeats the refusal, (o) PIN change ends other sessions, (p) open_dates reach 7 days, (q) the list keeps reassigned
  checked-in visits.
- **App (hc2):** (a) queue deletes before the answer, (b) time stamped at send, (c) board late at 16 minutes, (d) family note leak,
  (e) overlay over Check in, (f) captive-portal 200, (g) payroll total from rounded rows, (h) service worker caches a login page,
  (i) silent next-day check-out, (j) presets computed at mount, (k) network before the saved list, (l) open_dates ignored,
  (m) missing map attribution, plus the proofs in `app/tests/negative-m2c-proofs.mjs` (earlier days, refused link, refused check-in
  card, note check and notice, inactive list/sheet/row at 390 and 1280, Dismiss, WebGL fallback and required MapLibre, and more).

## Known gaps
Listed in README.md ("Where to pick this up"), with the reasoning in DECISIONS 45, 52 and 54.

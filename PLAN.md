# Home Care Visits: build contract

One plan file. It is the contract, and it lives at the repo root so every agent reads the same copy.
Then read `docs/API.md` (the contract between slices) and `DECISIONS.md`. `BRIEF.md` is the original brief. `AGENTS.md` has ports.

## The brief (Onyx for Alexander, 2026-09-14)
For a small home support agency in Newfoundland: the visit schedule for home support workers, check-in and check-out at the
client's home, a short visit note from a task checklist, a family link showing that today's visits happened, and hours per
worker per client for payroll and for billing the funder. Rural NL: bad signal, long drives, workers on their own phones.

- **Office (PIN):** clients (name, a map pin, entry/key-safe notes, care tasks, visit pattern like Mon/Wed/Fri 9:00–10:30,
  family contacts, funder); workers (phone, availability, travel zones, weekly hours); a **week planner** where visits are
  dragged onto workers with conflicts shown (double-booked, travel gap too short by straight-line distance, over weekly hours,
  plus outside availability and outside travel zone as warnings); a **Today board** where a visit not checked in 15 minutes after its
  start turns amber and at 30 minutes red, with the worker's phone number to call; reports (hours per worker for payroll,
  hours per client per funder for billing, missed and late visits, mileage) with CSV export.
- **Worker phone:** today's visits in order, **Navigate**, **Check in** (time + an optional location check that never blocks),
  the task checklist, a two-line note, **Check out**. **Works offline**: a queue on the phone that keeps the original times.
  Mileage between visits from the check-in order.
- **Family link:** unguessable, per client: today's and this week's visits (scheduled, arrived, left, tasks done). No note
  text unless the office marks the note shareable. Nothing is sent: the office copies the link.
- **Privacy:** SAMPLE agency and people only, labelled SAMPLE, initials for avatars. No health card numbers, no diagnoses,
  medication **reminder** only (the app never records medication given).
- **Data:** `data/sample-agency.json` (the lead built it; `tools/build-sample-agency.py`): "SAMPLE Exploits Home Support (demo)",
  3 zones, 3 funders, 5 SAMPLE workers, 12 SAMPLE clients pinned at stated offsets from real community points (NRCan), no street
  addresses, 36 visits a week from patterns. Its `expected_base_week_conflicts` lists the only conflicts a base week has: Terry O.
  (SAMPLE) on Saturday and Sunday, George N. → Mary D., 15 min gap, 38 min needed, 29 194 m.

## Design
Daylight and calm: a coordinator's desk and a worker's phone on a doorstep. Warm, plain, readable, never clinical-cold.
- Tokens (`app/public/theme.css`): ground `#f6f4ef`, surface `#ffffff`, raised `#fbfaf7`, line `#e2ddd2`, ink `#1d2733`, muted
  `#5b6573`, accent teal `#0e6b6b` (white text). **Check in** `#17663a` white text · **Check out** `#0e6b6b` white text ·
  **Navigate** outline teal. Status: done bg `#dcefe2` text `#17663a`; **late** bg `#fdecc8`, edge `#d97706`, text `#7a4204`;
  **missed** bg `#fbdada`, edge `#dc2626`, text `#8f1d1d`; cancelled muted with a line-through time. SAMPLE badge: text `#8a4b00`
  on `#fff4dc`, border `#d97706`. Radius 12 px. Focus ring 3 px teal, 2 px offset. Every text/background pair ≥ 4.5 : 1 (a test
  checks the action buttons and the late/missed rows). Alerts never rely on colour alone: the words are always there.
- System font stack only (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`); no web
  fonts. No emoji as icons (inline SVG where an icon helps). Avatars are initials in a circle.
- **Worker phone (390 first):** header with the agency, SAMPLE badge, the worker's initials and "Today, Mon Sep 14"; a sync strip
  always visible under it ("All sent" / "No signal. 2 saved on this phone. They send when signal comes back and keep the time
  you tapped."). Visits in order as cards: time (22 px), client name (24 px bold) with initials, town (17 px). The next
  unfinished visit is open: "Getting in" box (raised, amber left edge) with the entry notes, **Navigate** (48 px), **Check in**
  (full width, 56 px). After check-in: "Checked in 9:04 AM · Within 250 m of the client", the task checklist (48 px rows, big
  boxes; the medication task reads "Medication reminder" with the line "Reminder only. This app doesn't record medication
  given."), "Note (two short lines)" with a counter, **Check out** (56 px) → "Check out now?" sheet with the ticked count and
  the note → "Yes, check out" / "Not yet". Done cards fold to "Done 9:04 AM – 10:31 AM". Cancelled cards: "Cancelled by the
  office". Footer: today's mileage "14.2 km between visits today (straight line)" and "Office: 709-555-0100" as a `tel:` link.
- **Office (usable at 390, comfortable at 1280):** tabs Today · Week · Clients · Workers · Reports · Settings. **Today**: counts
  (Missed, Late, Checked in, Done, Upcoming) and every visit by start time; late/missed rows coloured with their words and
  "Call Jo W. (SAMPLE): 709-555-0131". **Week** at 1280: a grid, one row per worker plus "No worker", one column per day; visit
  chips (initials, client, time) dragged with the mouse to another worker's row in the same day; a chip in a conflict has a
  red (problem) or amber (warning) edge and the word "Conflict"; the conflict list sits above the grid with the distance note;
  choosing a conflict highlights its chips. At 390: day tabs, visits grouped by worker, each with an "Assign to" select and
  Save. A visit opens an edit sheet: worker, date, start, end, Cancel visit (reason) / Restore, Fix times (reason), "Family
  can see this note" toggle. **Clients**: list + map side by side at 1280, a form where the pin is placed by clicking the map,
  tasks, patterns (day toggles, start, end, worker), family contacts, "Copy family link", "New family link" (inline confirm:
  the old link stops working). **Workers**: list and form (zones, availability per weekday, weekly hours), "Copy worker
  link", "New link". **Reports**: from/to with "This week", "Last week", "Last 14 days"; Payroll · Billing · Missed ·
  Mileage tables with their notes; "Download CSV".
- **Family (390 first):** one column, large type, the agency with SAMPLE badge, "Visits for Walter G. (SAMPLE)", Today's
  visits as cards (the status words big, tasks done as a ticked list, a shareable note in a quote box), then "This week" by day,
  "Updated 10:40 AM". No map, no phone numbers except the agency's.
- Plain English for Newfoundland: "Today", "Navigate", "Check in", "Getting location… (Skip)", "Skip location",
  "Check out", "Check out now?", "Yes, check out", "Not yet", "Saved on this phone", "All sent", "Not accepted by the office",
  "Ask the office to fix it", "Late: not checked in 15 minutes after the start", "Missed: not checked in 30 minutes after the
  start", "Copy link", "Copied", "New link", "Family can see this note", "Fix times", "Download CSV".
- Everything quiet under `prefers-reduced-motion`.

## Stack
- `worker/`: Cloudflare Worker, plain JS ESM, no build, **no npm dependencies** (the `wrangler` on PATH, 4.131+).
  `worker/wrangler.toml`: name `home-care-visits`, `main = "src/index.js"`, `compatibility_date = "2026-09-01"`, D1 binding `DB`
  (`database_name = "home-care-visits"`, `database_id = "00000000-0000-0000-0000-000000000000"` with a comment that a deploy
  replaces it, `migrations_dir = "migrations"`), `[assets] directory = "../app/public"`, `run_worker_first = ["/api/*"]`.
  **No `TEST_MODE` in `[vars]`, ever.**
- `app/public/`: plain HTML/JS/CSS served by the same Worker (`/`, `/office/`, `/w/`, `/f/`). Leaflet 1.9.4 is installed in
  `app/node_modules/leaflet`: copy `dist/leaflet.js`, `dist/leaflet.css`, `dist/images/` and its LICENSE into
  `app/public/vendor/leaflet/` (no CDN: offices in rural NL have bad signal too).
- `app/tests/`: Playwright 1.63 (`app/node_modules` is installed on main; the lead symlinks it into your worktree).
- Local dev everywhere: `wrangler dev --local --port <p> --inspector-port <p+10> --persist-to <dir>`; tests add
  `--var TEST_MODE:1`. Migrations: `wrangler d1 migrations apply home-care-visits --local --persist-to <dir>` (from `worker/`).
- **Reference, read only, never write or run from them:** `~/Projects/Snow Route` is a finished sibling with the same shape
  (a Worker + D1 serving a static app, an offline phone queue in IndexedDB with a service worker, status links, billing CSV).
  Its `worker/tests/run.mjs`, `worker/tests/negative-lib.mjs` + `negative-*.mjs` (copy the Worker into `.negative/`, break the
  copy, expect red), `app/tests/start-worker.mjs`, `app/playwright.config.mjs`, `app/tests/helpers.mjs` (`tap()`, `tapAt()`,
  the network guard, generated images) and `app/public/d/queue.js` + `sw.js` are good patterns to copy and adapt. Its
  `docs/API.md` clarifications 1–53 list what went wrong on the phone queue; this contract avoids most of it by having no
  phone-side Undo (DECISIONS 8).
- **Ports (never use another):** hc1 Worker 7902 (inspector 7912), hc1 negative-control Workers 7905 (inspector 7915).
  hc2 dev Worker 7901 (inspector 7911), e2e Worker 7903 (inspector 7913), app negative controls 7906 (inspector 7916).
  QA (lead) 7909 (inspector 7919). Other crews run wrangler on this machine; the default inspector port 9229 collides.

## Rules
- You own the files listed under your id and **nothing else**. If you need a change in someone else's file, say so in your
  report; do not reach in. `rig guard` enforces this. The lead owns `docs/API.md`: if the contract is wrong or unclear, write
  the question in your report and end your turn; do not invent a different contract.
- Verify, then commit, then report. Never leave a verified step uncommitted: a usage-limit pause lands mid-task with no warning.
- Your report goes in `docs/build-report-<your id>.md`, committed with your work: tests passed/failed/skipped, every negative
  control with the exact break and the red output, known gaps, anything you want the lead to decide.
- Commit only your own paths: `git commit -- <paths>`. Never grade the shared tree; the lead's numbers come from `rig qa --ref <sha>`.
- A check that cannot fail measured nothing. Every task below names its negative controls: make each red once, record it,
  restore. Controls break a **copy** (in `.negative/`, git-ignored), never the shipped code, and the shipped code has no switch
  that turns a guard off. **Before trusting a control, run its check against an unbroken copy and see it pass**, so a red means
  the break and not a broken harness. A negative-control log never holds absolute machine paths (replace the repo root with `<repo>`).
- **Milestones.** Finish the milestone, commit, update your report, and end your turn with a one-paragraph summary. The lead
  merges, sends a cross-review, then prompts you for the next milestone. Do not start the next one before that prompt.
- Local only: no deploy, no `--remote`, no `d1 create`, no `secret put`. Nothing is sent anywhere. If auto mode denies
  something, do not work around it; note it in your report and carry on.
- No devils or demons, no emoji icons, SAMPLE on every screen, no real businesses, no real people, no street addresses.
- No request to a real third-party host from any test (tiles go to a local placeholder; a test asserts nothing left 127.0.0.1).
- **Shell gotchas (this machine's shell is zsh):** `PIPESTATUS` is empty and a pipe into `tail` hides a failing exit code (use
  `set -o pipefail` or `echo EXIT=$?` inside the command); an unquoted `$VAR` holding several pids is not word-split (`${=VAR}`);
  `pkill -f <pattern>` kills your own shell when the pattern is in your command line: stop servers by exact pid and re-check the port.
- **Playwright gotchas (found on sibling builds tonight):** (1) on chromium with `hasTouch`, `page.keyboard.type` right after a
  touch tap silently drops keys: on touch projects type with `page.keyboard.insertText` and always assert the field's value;
  (2) WebKit moves a tap a few px beside a control onto the control: never tap a map within 16 px of `.leaflet-control`;
  (3) full-page screenshots misplace sticky/fixed bars: take viewport screenshots; (4) a strip that already says "All sent"
  proves nothing: wait for the POST's own response (`waitForResponse`) before checking the server.

## Agents

### hc1 — Worker, D1, rules, reports
Owns:
- worker/**

Report: docs/build-report-hc1.md

Task:
Implement `docs/API.md` exactly, in `worker/src/` (suggested split: `index.js` router + handlers, `auth.js` PIN/tokens/keys/guards,
`time.js` NL local↔UTC, labels, weeks, `geo.js` haversine + location status, `rules.js` the late/missed rule, `conflicts.js`,
`generate.js` patterns → visits, `reports.js` pure payroll/billing/missed/mileage + CSV, `privacy.js` the two text guards,
`clock.js` now/IP with the TEST_MODE rule, `sample.js` + generated `sample-data.js`). `worker/tools/build-sample-data.mjs` reads
`../data/sample-agency.json` and writes `src/sample-data.js` (commit the output; the Worker never reads outside `worker/`).
`npm test` = `node tests/run.mjs`: pure unit tests first, then wipe `worker/.state-<PORT>`, apply migrations there, start
`wrangler dev --local` with `--var TEST_MODE:1` on `PORT` (default 7902, inspector +10) if nothing answers, run
`node --test tests/api.test.mjs`, stop what it started. When `app/public` does not exist in your worktree, serve an empty assets
folder (Snow Route's `run.mjs` shows how). `npm run negative` runs every negative control; each appends its output to
`tests/negative-control.log` and exits 0 only if its check went red. `npm run dev` = migrate + wrangler dev on 7902.

**M1 (commit as soon as it is green, then stop):** `wrangler.toml`; `migrations/0001_init.sql` (agency single row, zones,
funders, sessions, signin_attempts, family_lookups, workers, worker_zones, clients, client_tasks, family_contacts, patterns with
`valid_from_at`/`ended_at`, visits with `UNIQUE(pattern_id, pattern_date)` and `version`, visit_workers history, events with
`id TEXT PRIMARY KEY`, `voided_at`, and the two partial unique indexes `(visit_id) WHERE kind='check_in' AND voided_at IS NULL`
/ `… 'check_out' …`, visit_tasks, visit_notes with `shareable`); `migrations/0002_agency.sql` (the SAMPLE agency row, zones,
funders, PIN 4826 as a PBKDF2 hash + salt; workers and clients come from `/api/test/reset`). Routes: `GET /api/agency`; office
`signin`, `signout`, `GET/POST/PUT clients` (+ `GET clients/:id`), `GET/POST/PUT workers`, `GET week`, `GET day`, `POST visits`,
`PUT visits/:id`, `POST visits/:id/cancel`, `POST visits/:id/restore`, `PUT visits/:id/note`; worker `GET visits`,
`POST events`; `GET /api/family/:key`; `POST /api/test/reset`, `GET /api/test/events`.
M1 tests. Pure (`tests/unit.test.mjs`, `tests/conflicts.test.mjs`, `tests/time.test.mjs`):
- **the late/missed rule at the boundaries:** start + 14:59.999 → none, + 15:00.000 → late, + 29:59.999 → late,
  + 30:00.000 → missed; a checked-in or cancelled visit → none at + 2 h;
- **time:** `2026-07-14 09:00` ↔ `2026-07-14T11:30:00.000Z`, `2026-01-12 09:00` ↔ `2026-01-12T12:30:00.000Z`, the
  spring-forward gap refused, labels with a plain space before AM/PM, the Monday of a week across a month and a year end;
- haversine against a pair computed in the test with the formula written out; the location status at 250 m (near), 251 m
  (far, "251 m"), 1 250 m ("1.3 km"), null (not shared);
- **conflicts:** a hand-built week with exactly one of each kind and the exact message text for each; the travel-gap boundary
  (gap = needed → no conflict, gap = needed − 1 → conflict); over-hours `visit_ids` from the visit that passes the limit;
  unassigned and cancelled visits never conflict; deterministic order; **the SAMPLE base week gives exactly
  `expected_base_week_conflicts`** from `data/sample-agency.json` (via `sample-data.js`);
- privacy guards: 12 digits with spaces/dashes refused, 11 digits allowed, a phone number allowed; the medication wording
  table (at least 6 refused and 6 allowed phrases, including "Morning pills from the blister pack", "Help with bath",
  "Give her pills", "5 mg", "insulin", "give him a minute").
API (`tests/api.test.mjs`, every test resets first):
- agency shape; wrong PIN 401 field `pin`, right PIN → token, no token → 401, signout kills the token;
- clients: 12 SAMPLE clients; POST validation, one test per field in the table plus both privacy guards; a good POST and PUT;
- **pattern edits:** GET a week twice → same visit count (idempotent); PUT a client changing a pattern's time with
  `X-Test-Now` mid-week → past and started visits untouched, future unstarted ones rebuilt at the new time, `rebuilt_visits`
  right; a pattern added on a Wednesday creates no Monday/Tuesday visits; deactivating a client removes its future unstarted
  visits and no started one;
- week: 36 SAMPLE visits, 7 days, the base conflicts; `start` not a Monday → 400; drag equivalent: `PUT visits/:id` to another
  worker → 200, version + 1, the conflict list changes as expected (make a double-booking on purpose and see it); a stale
  version → 409 `stale`; a visit with a check-in → 409 `bad_state`; cancel/restore;
- day: the board visits with `alert` from `X-Test-Now` at start + 15 min (late) and + 30 min (missed);
- **events:** check-in → 201 with `location: near` and `distance_m`; **the same id again → 200 `duplicate: true` and still
  exactly one row** (via `/api/test/events`); a different id → 409 `already_checked_in` with `event`; check-out before
  check-in → 409 `bad_state`; check-out → 201 and `worked_seconds` exact; **original time kept:** `at` = T, `X-Test-Now` = T +
  45 min → stored T, `at_adjusted` false; `at` 2 h ahead → adjusted; a check-out earlier than its check-in → clamped and
  flagged; a reassigned visit still accepts the first worker's check-in; a cancelled visit accepts events and shows
  `visited_after_cancel`; a stranger worker → 404; a note of 3 lines → 400;
- worker visits: only this worker's visits for the date, in order, with entry notes, and the raw JSON never contains a family
  contact's phone or a funder name;
- **family privacy:** a checked-out visit with a non-shareable note → the family answer's raw text contains neither the note
  text nor the entry notes, address, any worker/family phone, `distance`, `location`, the cancel reason; after `PUT note
  {shareable: true}` it contains the note text; status labels for scheduled / not checked in yet / arrived / left / cancelled;
  unknown key 404.
M1 negative controls: (a) `negative:idempotent` — the copy's event insert ignores the id conflict and the table has no
PRIMARY KEY (in the copy's migration) → the same-id test shows two rows and goes red; (b) `negative:time` — the copy stores
server now instead of `at` → the original-time test goes red; (c) `negative:familynote` — the copy's family answer includes the
note text whatever `shareable` says → the family privacy test goes red; (d) `negative:alert` — the copy's rule uses `>` instead of
`≥` at 15 minutes → the boundary test goes red; (e) `negative:travelgap` — the copy compares the gap with the straight-line
minutes without the 1.3 factor → the conflicts test goes red.

**M2 (after the lead's prompt):** every remaining route: office `PUT pin`, `GET/PUT agency`, clients and workers `new-link`,
`PUT visits/:id/times`, the four reports and their CSV; the PIN guard and the family-link guard; `POST /api/test/seed
{scenario: "demo"}`. **Demo scenario** (relative to server now; deterministic for a given now): the base data; every visit of
last week and of this week before today checked in 0–9 min after its start and out 0–9 min either side of its end (derived from
the visit id, not `Math.random`), locations mostly near, one far, one not shared; notes on about half, a third of those shareable;
today: every visit whose start + 30 min has passed is done except exactly one left **missed**, plus a one-off visit for Sam R.
starting 20 minutes before now (so it is **late**), one visit checked in and not yet out, and a one-off double-booking for Chris M.
later this week; last week's Friday unassigned visit for Edna F. assigned and done. Seed answers the reset shape plus `office_url`.
Tests: every route's happy path and its main refusals; new-link makes the old worker key 401 and the old family key 404;
**payroll exactness:** three visits of 1:00:20, 0:45:20 and 2:10:20 → worker seconds 14 160, hours `"3.93"` (rounding each
visit would give 3.94), `hm_label` `"3 h 56 min"`, total = sum of worker seconds with its own rounding; a visit with no
check-out is in `incomplete` and not in the hours; the check-in's NL date decides the period (a check-in at 23:50 NDT on the
last day counts, one at 00:10 the next day does not); **billing** grouped by funder with scheduled minutes; **missed** excludes
cancelled visits and includes a no-worker visit, late at exactly 15 min; **mileage** follows check-in order, not schedule order
(check in to the Botwood client before the Grand Falls-Windsor one against the schedule and see the legs follow the taps);
**fix times:** a missing check-out set by the office → worked seconds, `source: "office"`, the phone's later check-out with its own
id → 409 `already_checked_out`; the voided phone event still in `/api/test/events`; CSV header exact for all four, CRLF, quoting of
a name with a comma and a quote, formula guard on a client named `=SUM(A1) (SAMPLE)`, filename; rate guards with `X-Test-IP`
(5 wrong → 429 even for the right PIN; 30 unknown family keys → 429 even for a known key); the demo seed gives at least one late
and one missed visit on `GET day` at seed time and non-empty payroll for the last 14 days.
M2 negative controls: (f) `negative:payrollround` — the copy rounds each visit's hours and adds them → the exactness test goes red;
(g) `negative:mileageorder` — the copy orders legs by `starts_at` → the check-in-order test goes red; (h) `negative:csvguard` —
the copy drops the formula guard → the CSV test goes red; (i) `negative:missedcancel` — the copy counts cancelled visits as missed
→ the missed test goes red; (j) `negative:ndtdate` — the copy uses the UTC date of the check-in for the period → the 23:50 test goes red.

### hc2 — Worker phone (offline), family link, office, Playwright
Owns:
- app/**

Report: docs/build-report-hc2.md

Task:
Build the pages per the brief and Design, talking only to the API in `docs/API.md` through `app/public/api.js` (same-origin
`fetch('/api/…')`; errors surface the API's `error` text as is). Every screen shows the agency name and a visible **SAMPLE**
badge while `sample` is true. Until hc1's M1 is merged into your branch you may develop against `app/public/api.mock.js`
(`?mock=1`, in-memory, same shapes as API.md), but **every Playwright test runs against the real Worker**.
Playwright (`app/playwright.config.mjs`): projects `chromium-390` (390×844, hasTouch, isMobile), `chromium-1280` (1280×800),
`webkit-390` (iPhone 14 device), `webkit-1280`; `workers: 1`; `webServer` = `node tests/start-worker.mjs` (from `../worker`:
wipe `app/tests/.state-<port>`, migrate `--local --persist-to` it, `wrangler dev` on `E2E_PORT` default 7903, inspector +10,
`--var TEST_MODE:1`; `E2E_WORKER_DIR` may point it at a copy for negative controls); `baseURL` = that Worker. Every test
starts with `POST /api/test/reset`. A shared fixture routes `https://tile.openstreetmap.org/**` to a local placeholder PNG and
fails the test if any request goes to a host other than 127.0.0.1. **Real input only:** taps/clicks through a `tap()` helper that
hit-tests the target's centre with `elementFromPoint` first, typing via `page.keyboard` (`insertText` on touch projects, then
assert the value), drags via `page.mouse`; never set app state with `evaluate`. Allowed exceptions: native `<select>` and
`<input type="date|time">` values via `selectOption`/`fill`, and `context.setGeolocation`. Tests tagged `@phone` / `@desktop` are
filtered by project (`grepInvert`), never counted as skipped.

**M1 (commit when green, then stop):** `theme.css` + `style.css`; vendored Leaflet; `/` landing; **worker page `/w/?k=`**:
loads `GET /api/worker/visits` and caches the answer (`hcv:visits:<worker id>:<date>`); when offline or failing it shows the
cached list with "Saved list from 7:02 AM" (or "No saved list on this phone yet. Find signal once to load today's visits.").
Visits and their states per Design, computed from the answer **plus** the queue (a queued check-in shows "Checked in 9:04 AM ·
saved on this phone"). **Navigate** per API.md. **Check in:** take `at` at the tap; ask `navigator.geolocation.getCurrentPosition`
(`enableHighAccuracy: true, timeout: 8000, maximumAge: 60000`) while showing "Getting location…" with a **Skip location** button;
on a position, an error, a denial, the timeout or Skip, write the event to the queue with `location` or `null`. **Check out:**
the ticked tasks as a snapshot (every task with `done`), the note (trimmed, ≤ 200 characters, ≤ 2 lines, counter), confirm sheet,
then queue it with `at` taken at "Yes, check out". **Offline queue** (`app/public/w/queue.js`), exactly:
1. every event is written to IndexedDB (`home-care-visits` / `queue`, ordered by an autoincrement `seq`) **before** any network
   call, holding the worker key and the worker id it was made under;
2. a sender posts oldest first inside `navigator.locks.request('hcv-send', …)` (`{ ifAvailable: true }` when the tab is hidden);
   an event waits while an earlier event for the same visit is still queued;
3. answers: 200/201 → delete the item in the same transaction that confirms it is still there; 400/404/409 → move it to the
   `refused` store with the server's `error` text, shown under "Not accepted by the office" with "Ask the office to fix it:
   <office phone>" and a Remove button (never retried, never silently dropped); 401 → keep it, and when the page's own key is
   refused show "This link doesn't work any more. Ask the office for a new one."; 429, 5xx, a network error or a 30-second
   timeout (`AbortSignal.timeout(30000)`) → keep it and retry with backoff (5 s, 15 s, 30 s, then every 60 s);
4. the sender runs on each new event, on `online`, on `visibilitychange` to visible, and every 20 s while anything is queued;
5. an item saved under a key that now answers 401 is re-sent with the page's own key **only** when the page's key loaded the
   visits of the same worker id; otherwise it stays listed as "Saved under an old link for another worker" with Remove;
6. the sync strip per Design, from the queue's real contents.
**Service worker** `app/public/w/sw.js` (scope `/w/`): caches the worker page, its JS/CSS, theme and icons on install, serves
them cache-first with a versioned cache name, never touches `/api/*`. **Family page `/f/?k=`** per Design, refreshes every 60 s
and on `visibilitychange`, a plain message for a bad link (and it stops refreshing). Screenshots (viewport) of the worker page
(a visit open, checked in with tasks, the check-out sheet, offline strip with 2 saved, a refused item) and the family page (today
with a shareable note, the week) at 390 and 1280 into `app/tests/shots/`.

**M2 (after the lead's prompt; `git rebase main` first, hc1 M1 is merged by then):** the Playwright suite for everything so far,
against the real Worker, plus the office side on M1 routes. Office `/office/`: PIN sign-in (token in `localStorage`
`hcv:office-token`; sign out; a 401 **without** `field` means the session ended), **Today** board per Design with the late/missed
rule from API.md recomputed from `Date.now()` every 15 s, **Week** planner per Design (mouse drag at 1280, "Assign to" at 390,
the conflict list, the edit sheet with cancel/restore and the note toggle), **Clients** (list, Leaflet map, form with the map pin,
tasks, patterns with the rebuild warning "Changing visit times rebuilds this client's upcoming visits. One-off changes to those
visits will be replaced.", family contacts, Copy family link), **Workers** (list, form, Copy worker link). Specs:
- `worker.spec.mjs` — open Sam R.'s link on a day with visits → visits in order; Navigate's href is the maps URL with the pin;
  with geolocation granted at the client's pin, Check in → "Within 250 m of the client"; with geolocation denied → "Location not
  shared" and the visit is still checked in; tick tasks, type a note (the value asserted), Check out → confirm → done; the office
  day API shows both events, `tasks_done` and the note;
- `offline.spec.mjs` — **the queue:** load online; `context.setOffline(true)`; with `page.clock` at T check in, and at T + 1:32:10
  check out with 2 tasks and a note; the strip says 2 saved; reload offline and the list and "2 saved" are still there (chromium;
  on webkit skip only the reload step with a written reason if its service worker cannot do it under Playwright); advance the page
  clock 40 minutes; go online → wait for both POST responses → the API shows `check_in.at` = T and `check_out.at` = T + 1:32:10
  (to the second), `worked_seconds` 5 530, `at_adjusted` false; also: the Worker answering 500 once (Playwright routing) leaves
  both queued and they send on the next try; a check-out for a visit that the office's API already has a check-out for lands in
  "Not accepted by the office" with the server's words;
- `family.spec.mjs` — the family link shows "Arrived …, left …" and the ticked task labels after a worker journey; the note is
  **not** on the page; the office marks it shareable in the edit sheet (real taps) → reload the family page → the note is there;
  a bad link shows the plain message;
- `board.spec.mjs` — **the brief's clock test:** the office creates a visit for today at 09:00 through the API (for the page
  clock's NL date); `page.clock.install` at 09:14:59 NL time; the row is not late; `page.clock.runFor` to 09:15:00 → the row
  is late (the words, `data-alert="late"`, and its computed background equals the late token); 09:29:59 still late; 09:30:00 →
  missed with "Call Sam R. (SAMPLE): 709-555-0132" as a `tel:` link; check in through the worker API → the row turns done on the
  next refresh; a cancelled visit at 09:00 is never late;
- `planner.spec.mjs` — 1280 `@desktop`: a real mouse drag of one of Terry O.'s Saturday chips onto Jo W.'s row → the travel-gap
  conflict disappears from the list, the reload keeps it; drag a visit onto a worker who already has one at that time → "Double-booked"
  appears with its message and both chips edged; 390 `@phone`: "Assign to" does the same; a stale edit (changed through the API
  between load and save) shows "This visit was changed on another screen. Reload and try again.";
- `office.spec.mjs` — wrong PIN "That PIN is not right." **and** the sign-in response is 401 (`waitForResponse`); add a client by
  typing and clicking the map (not within 16 px of a Leaflet control) with one task and a Mon/Wed pattern → it is in the list, on
  the map and its visits show in the week; a task "Give her pills" shows the API's medication message by the tasks field; the map
  attribution "OpenStreetMap" is visible; add a worker;
- `targets.spec.mjs` — every worker-page button ≥ 48 px (Check in / Check out ≥ 56 px) and hit-testing to itself at 390 in both
  engines; the SAMPLE badge visible on `/`, `/office/`, `/w/`, `/f/`; no horizontal scroll at 390 on any page; Check in, Check
  out, and the late and missed row text meet 4.5 : 1.
M2 negative controls: (a) `app/tests/negative-queue.mjs` — copy `app/public` + `worker` into `app/.negative/queue/`, change the
copy's queue to delete an item **before** the server answers, start that copy on 7906, run `offline.spec.mjs` against it (with the
500-once step) → it must go red because a visit's event never reached the server; exit 0 only if red; append to
`app/tests/negative-control.log`; (b) `negative-time.mjs` — the copy stamps `at` when the item is sent instead of when it was
tapped → the original-time assertion goes red; (c) `negative-board.mjs` — the copy's board rule turns late at 16 minutes → the
09:15:00 assertion goes red; (d) `negative-familynote.mjs` — the copied **Worker**'s family answer includes every note whatever
`shareable` says (break the copied Worker, not the page) → the "note is not on the page" step of `family.spec` goes red;
(e) a transparent overlay over Check in in a copy → the `tap()` hit-test goes red. Record all five with the red output.

**M3 (after the lead's prompt; rebase on main, hc1 M2 merged):** the rest of the office: **Reports** per Design (Payroll with
per-client rows and the incomplete list, Billing by funder, Missed/late, Mileage with its note), "Download CSV" (fetch with the
token → blob download of the Worker's bytes), **Fix times** in the edit sheet (check-in/check-out time inputs in NL time, reason),
"New link" for workers and clients (inline confirm saying the old link stops working), Copy link buttons ("Copied"), **Settings**
(agency name, office phone, change PIN with the 401-with-field rule). Specs: `reports.spec.mjs` (drive two real worker journeys
through the worker page with the page clock, fix one missing check-out through the edit sheet → Payroll shows the exact hours the
API gives and the CSV download's bytes equal `GET /api/office/reports/payroll.csv` for the same period; Billing groups by funder;
Missed lists the missed visit; Mileage shows the straight-line note), `links.spec.mjs` (New link → the old worker link shows "This
link doesn't work any more…", the old family link the bad-link message; Copy link puts the exact URL on the clipboard in chromium
with clipboard permissions, and on webkit asserts "Copied" and skips only the read with a written reason), `settings.spec.mjs`
(wrong current PIN keeps the session and shows the message by the field). M3 negative control: (f) in a copy, the Payroll screen
adds up the rows' rounded hours for its total instead of showing the API's total → `reports.spec` goes red. Final viewport
screenshots of every screen per project into `app/tests/shots/`.

## Main (hc-lead, not a slice)
Owns PLAN.md, AGENTS.md, DECISIONS.md, BRIEF.md, docs/API.md, docs/DEPLOY.md, docs/build-report.md, docs/shots/**, data/**,
tools/**, README.md, package.json, demo.mjs, .gitignore, .rig/config.json. Merges each milestone after reading the diff, sends
cross-reviews (hc2 reviews hc1's M1 against API.md before starting M2; hc1 reviews hc2's M2 API calls and queue read-only after
its own M2), runs `rig qa --ref <sha>` on 7909 for the Worker suite, every negative control and the Playwright suite, takes `pwshot`
screenshots into `docs/shots/` from `npm run demo`, writes README / DEPLOY / build report, pushes the private repo, closes the slice
tabs by id, removes worktrees, writes the status file.

## Open questions
None blocking. Anything that needs Alexander goes under NEEDS ALEXANDER in the status file.

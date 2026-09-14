# Build report: hc2 (worker phone, family link, office, Playwright)

## M1: worker page, offline queue, service worker, family page (2026-09-14)

Status: **DONE**, committed on `rig/hc2`. hc1 had no commits when M1 was built, so there was no Worker to run. The pages were
built and exercised against `app/public/api.mock.js` (`?mock=1`), which the brief allows until hc1 M1 is merged. **Nothing
here has run against the real Worker yet**; that is the first job of M2 (the Playwright suite).

### What was built (all under `app/`)
- `public/theme.css` (the Design tokens) and `public/style.css` (header, SAMPLE badge, sync strip, cards, checklist, sheet,
  family page, landing). System fonts only; inline SVG ticks, no emoji; quiet under `prefers-reduced-motion`.
- `public/vendor/leaflet/`: `leaflet.js`, `leaflet.css`, `images/`, `LICENSE`, copied from `node_modules/leaflet` 1.9.4
  (not used by any page yet; the office map is M2).
- `public/index.html`: `/` with the agency name, SAMPLE badge, "Office sign-in" and the one line from API.md.
  `public/office/index.html` is a placeholder until M2.
- `public/api.js`: the only API client; `{ status, ok, data }`; `?mock=1` routes to `api.mock.js`.
  `public/time.js`: NL labels with the API.md `Intl` call in `America/St_Johns` (U+202F/U+2009 → space), local↔UTC, initials,
  haversine.
- `public/w/` (worker phone), `index.html` + `app.js`:
  - `GET /api/worker/visits`, saved as `hcv:visits:<worker id>:<date>` `{ saved_at, key, answer }` (older than 8 days pruned).
    When the load fails it shows today's saved list for this key with "Saved list from 10:40 AM", or "No saved list on this
    phone yet. Find signal once to load today's visits."
  - The state of each card comes from the answer **plus** the queue: "Checked in 10:40 AM · saved on this phone", "Done … · saved
    on this phone", "Cancelled by the office". The next unfinished visit is open: "Getting in" box, Navigate (Apple Maps on
    iPhone/iPad, Google elsewhere, pin coordinates, `target=_blank`), Check in (56 px).
  - Check in: `at` taken at the tap, then `getCurrentPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })`
    with "Getting location…" and **Skip location**. A position, an error, a denial, the timeout or Skip all write the event,
    with `location` or `null`.
  - Checked in: the task checklist (the medication task has "Reminder only. This app doesn't record medication given."),
    "Note (two short lines)" with a counter (≤ 200 characters, ≤ 2 lines while typing, trimmed at send), Check out → "Check out
    now?" sheet (ticked count, the note) → "Yes, check out" (`at` taken here) / "Not yet". `tasks` is every task with `done`.
  - Footer: "<km> km between visits today (straight line)" and "Office: 709-555-0100" as a `tel:` link.
- `public/w/queue.js`, rules 1–6 of the brief:
  1. `add()` resolves only after the IndexedDB transaction completes (`home-care-visits` / `queue`, autoincrement `seq`). Each
     item holds the event, `key`, `worker_id`, and the client name and office phone for display.
  2. `drain()` runs inside `navigator.locks.request('hcv-send', …)` (`ifAvailable` when the tab is hidden) and posts oldest
     first. A visit whose earlier event is still queued (held or retrying) gets its later events skipped.
  3. 200/201 → one readwrite transaction `get(seq)` then `delete` only if present. 400/404/409 → one transaction over `queue` +
     `refused` moves it with the server's `error` text. 401 → kept; if it was the page's own key, "This link doesn't work any
     more. Ask the office for a new one.". 429/5xx/network error/`AbortSignal.timeout(30000)`/any other status → kept, backoff
     5 s, 15 s, 30 s, then 60 s.
  4. Runs on each new event, `online`, `visibilitychange` → visible, and every 20 s while anything is queued.
  5. An item whose own key answers 401 is patched to the page's key and re-sent only when the page's key loaded visits for the
     same worker id (live, or the saved list for that key). Otherwise it is listed under "Saved under an old link for another
     worker" with Remove.
  6. The strip: "All sent" / "No signal. 2 saved on this phone. They send when signal comes back and keep the time you tapped."
     / "Sending 2 saved on this phone…" / "2 saved on this phone. Trying again soon…", plus ". N not accepted by the office."
- `public/w/sw.js`: scope `/w/`, versioned cache `hcv-w-v1`, precaches the page (as `/w/`, so any `?k=` opens offline), its JS,
  CSS, `time.js`, `api.js` (+ mock files) and the icon. Cache-first for exactly those paths; returns without `respondWith` for
  `/api/*`, non-GET and other origins.
- `public/f/` (family): "Visits for <client>", Today cards (status words large, "With <first name>", ticked tasks, a shareable
  note in a quote box), "This week" by day, "Updated 10:40 AM", the agency phone only. Refreshes every 60 s and on
  `visibilitychange`. A 404 shows the API's message ("This link doesn't work. Ask the agency for a new one.") and stops the
  timer. A failed refresh keeps the page and says so.
- `dev-server.mjs` (static `app/public` on 7901, `ROOT`/`PORT` for copies), `tools/build-mock-data.mjs` → `public/mock-data.js`
  (from `data/sample-agency.json`), `tests/shots-m1.mjs` (the screenshots).

### Verified, and how it could have failed
- `node app/tests/shots-m1.mjs` against `app/public` on 7901: **GREEN on chromium-390, chromium-1280, webkit-390 (iPhone 14),
  webkit-1280.** Each project drives real clicks with the page clock at Mon Sep 14 10:40 AM NDT and waits for the exact words
  before taking each picture:
  - check in with geolocation granted at Ruby T.'s pin → "Checked in 10:40 AM · Within 250 m of the client" and "All sent";
  - two ticks and a typed note (counter asserted) → sheet "2 of 2 tasks ticked" → "Done 10:40 AM – 10:40 AM";
  - fresh context, `setOffline(true)` → check in + out → the exact 2-saved strip text and "· saved on this phone";
  - the office sets both times, then `setOffline(false)` → "Not accepted by the office" with both server messages, and the strip
    reads "All sent. 2 not accepted by the office.";
  - the family page shows the shareable note and "Arrived …, left …"; a bad key shows the plain message;
  - any request to a host other than 127.0.0.1 and any page error make the project red.
- **Negative control (M1, recorded in `app/tests/negative-control.log`):** a copy of `app/public` in `app/.negative/refused-m1`
  whose `moveToRefused` deletes a refused event instead of storing it, served on 7906 → the same script is **RED** on
  chromium-390 (it times out waiting for "Not accepted by the office"). The unbroken tree was green in an earlier run of the
  same script. The chromium-390 screenshots were then retaken from the unbroken tree.
- `rig guard`: all files inside the slice.
- Viewed the screenshots: `app/tests/shots/<screen>-<project>.png` for worker-visit-open, worker-checked-in,
  worker-checkout-sheet, worker-offline-2-saved, worker-refused, family-today, family-week (28 files).

### Not verified in M1 (M2 covers it against the real Worker)
- Anything against hc1's Worker: real status codes, labels, `location_label`, the family privacy allow-list.
- A reload with no signal (the service worker path). The mock's memory is lost on reload, so it could not be shown
  honestly. `offline.spec.mjs` does it on the Worker.
- The 401 / re-key paths (rule 5), the 500-then-retry backoff, the 30 s timeout, the two-tab lock. The code is written but no
  run has driven these paths yet.
- 48/56 px targets with `elementFromPoint`, contrast ratios, no horizontal scroll (`targets.spec.mjs`).

### Calls made (tell me if any is wrong)
1. **Backoff is one shared state for the queue**, not per item: a transient failure stops the pass (the network or the Worker
   is the problem, not the event). A new event, `online` or a visible tab tries at once; the timers respect the backoff.
2. **Unsent ticks and note are kept in `localStorage` `hcv:draft:<visit id>`**, so a reload in a dead zone doesn't lose them.
   API.md's storage list doesn't name this key. It is removed when the check-out is queued.
3. After the office accepts or refuses anything, the page reloads the visits so server labels replace "saved on this phone".
4. A check-in/check-out saved with a key that later answers 401, **for the page's own key**, stays in the queue (not
   `refused`) and the banner shows. It will send if the key starts working again. It is never dropped.
5. `api.mock.js` and `mock-data.js` ship in `app/public` and are precached (a few KB) so `?mock=1` also opens offline. They are
   only loaded with `?mock=1`.

### Needs from other slices
- Nothing blocking. M2 starts with `git rebase main` once hc1 M1 is merged.

## M2 part A: office pages, Playwright harness, specs (2026-09-14)

Status: **written, committed, NOT RUN.** hc1's M1 is not merged, so there is no Worker. Nothing in part A has run against
anything; per the lead's instruction nothing ran against the mock either. The only checks so far: `node --check` passes on
every page module, helper and spec, and `npx playwright test --list` lists 62 tests in 7 files. The `@phone` and `@desktop`
tests are filtered out by project, not skipped. Part B runs the suite, fixes what fails, and runs negative controls (a)–(e).

### Built
- **Design fixes (DECISIONS 22):**
  - On `/w/`, only the sync strip is sticky; the header scrolls away.
  - The mileage line shows only once the server's answer has two check-ins today, which is at least one leg. The answer
    has no `legs` list.
- **Worker page:** besides the 8 s timeout, a 10 s fallback resolves the location to `null`. The API timeout starts only once
  permission is given, so a prompt nobody answers would otherwise hold the check-in.
- `public/rules.js`: `alertFor` (the API.md rule) and `nextAlertChange`.
- **Office `/office/`:**
  - `core.js`: token in `hcv:office-token`; a 401 without `field` ends the session ("Your session ended. Sign in again.");
    field errors go by `data-error-for`; Copy link shows "Copied"; the edit sheet host.
  - `app.js`: PIN sign-in, tabs by hash, Sign out. Reports and Settings are placeholders for M3.
  - `board.js`: counts and rows. The rule runs on `Date.now()` every 15 s with a reload of the day, after every load, and
    on a timer set for the next exact 15:00 or 30:00 mark. That timer is what lets `page.clock.runFor(1000)` go from 09:14:59
    to 09:15:00 with no reload.
  - `week.js`: grid at ≥ 900 px, where a chip is dragged with pointer events (a real `page.mouse` drag works in both engines)
    to another worker on the same day. Day tabs + "Assign to" + Save below 900 px. The conflict list sits above; choosing a
    conflict highlights its chips.
  - `sheet.js`: worker, date, start, end; Cancel visit (reason) / Restore; "Family can see this note".
  - `clients.js`: list + Leaflet map (OSM tiles, "© OpenStreetMap contributors"). The form places the pin by clicking the map,
    and has tasks, visit times with the rebuild warning (existing clients), family contacts, Copy family link.
  - `workers.js`: zones, availability per weekday, weekly hours, Copy worker link.
- **Harness:**
  - `playwright.config.mjs`: 4 projects, one test worker, webServer `tests/start-worker.mjs`, Worker on 7903, inspector 7913,
    `E2E_WORKER_DIR`.
  - `helpers.mjs`:
    - the reset fixture, and the tile route plus the outside-host guard;
    - `tap`/`tapAt`/`drag`, each hit-testing with `elementFromPoint`;
    - `typeInto`, which uses `insertText` on touch projects and asserts the value;
    - `mapPoint`, a point ≥ 16 px from any Leaflet control and not on a marker.
- **Time in the specs:** every spec runs on **Mon Sep 14, 10:30 AM NDT**. `X-Test-Now` goes on the page's requests and API
  calls, and `page.clock` gets the same instant, so the server's and the page's "today" agree whatever day the suite runs.
  The pattern comes from Snow Route's offline spec.
- **Specs:** worker, offline (including the 500-once and refused tests with the service worker blocked), family, board,
  planner, office, targets.

### Known risks for part B (unverified guesses, listed so they are checked, not assumed)
- Office DOM against real answers: labels such as `hours_label`, `zone_names`, `conflict.date` and field names come from
  API.md only.
- WebKit: whether `context.setOffline` fires `online`, whether the service worker takes control under Playwright (the
  offline spec skips only the reload step, with a written reason, when it does not), and whether `clearPermissions` denies
  geolocation or leaves the prompt hanging (the 10 s fallback covers that).
- The planner drag needs Terry O.'s and Jo W.'s rows on screen together at 800 px high. `drag()` fails with a message if
  the drop cell is off screen.
- `targets.spec` checks every visible button on the worker page at 390, including the visit-card headers and the footer
  `tel:` link.

## M2 part B: the suite against hc1's Worker, review, negative controls (2026-09-14)

Rebased on main at 4c91521 (hc1 M1 merged at f26d2f2; API.md clarifications 3–5 read).

### Review of hc1 M1
I read every handler the pages call in `worker/src/index.js` (worker visits and events, family, and the office routes for
sign-in, day, week, visits, clients and workers) against docs/API.md, including clarifications 1–5, and against what the pages
send and read.

1. **Worker off the contract: a deactivated worker's link stops working.** `worker/src/index.js:832` `requireWorker` selects
   `WHERE worker_key = ?1 AND active = 1`, so an inactive worker's key answers 401 on both `GET /api/worker/visits` and
   `POST /api/worker/events`. Clarification 5 says it must answer 200 and accept events under the usual who-may-send rule.
   Clarification 5 postdates hc1's M1 (it overrules hc1 call 6), so this is for hc1 to change. The page is unchanged: a 401
   on the page's own key already keeps queued events in `queue` with "This link doesn't work any more…", and they send once
   the key answers again. No spec covers deactivation yet.
2. **My page off the milestone (fixed): the office called an M2 route.** The Worker's router (`worker/src/index.js:1072–1095`)
   has no `GET /api/office/agency`. That route is on hc1's M2 list in PLAN.md, and my office shell needed it for zones,
   funders and the map centre. On a 404, `app/public/office/app.js` now builds the same shape from M1 routes: `GET
   /api/agency`, zones and funders named on `GET /api/office/clients?all=1` and `/workers?all=1`, and the map centred on the
   mean of the client pins. The real route is used as soon as it answers. Until then a funder with no clients is missing from
   the form's list.
3. **My page off the contract (fixed): the session-ended message.** `worker/src/index.js:115` answers "Your session has
   ended. Sign in again." (401, no `field`). The page showed its own wording, but the contract says errors show the API's
   `error` text as is. `office/core.js` now passes the API's words to the sign-in screen.
4. **Matches, checked:**
   - events: stored id → validation → 404 → 409s (`:913–989`), the worker-view event shape (clarification 3), UUID v4 ids,
     `location` null → `not_shared`, and `tasks` required on a check-out;
   - `PUT visits/:id`: `stale` checked before `bad_state` (`:782`);
   - `PUT visits/:id/note` needs a boolean (`:822`);
   - family: note only when shareable (`:1024`), first name of the check-in's worker (`:1018`);
   - week: `conflict.date` null for `over_hours`, worker `hours_label` (`:707`);
   - day: `server_now` (`:726`);
   - client validation fields and messages, including the medication guard on `tasks` (`:249`), which office.spec checks.

### Fixes found by running against the Worker
- **Office:** `paintAgency` was still passed the 404 answer after the fallback edit and threw. This was the only cause of 9
  sign-in failures, found in the trace's page error. Every test now also fails on any uncaught page error.
- **Worker page:**
  - the visit just checked in stays open, where before the page re-opened an earlier checked-in card;
  - `render()` now writes only markup that changed. A full redraw on every queue tick detached buttons mid-tap.
- **Office CSS:** at 390 the availability and start/end time inputs ran past the right edge, and Save worker hit-tested to the
  "Active worker" label. The no-sideways-scroll test now also opens the worker form.
- **Specs:**
  - denied and granted geolocation are separate tests with the permission set before the page loads. WebKit keeps a page's
    first answer, and Chromium's `clearPermissions` mid-page is not a denial;
  - the 500-once step runs the page clock 1 s at a time;
  - the refused test moves the fixed clock past the backoff;
  - the check-out sheet state checks only the sheet's buttons;
  - specs wait for loaded lists.
- **The only skip:** the reload-with-no-signal step of the no-signal offline test, on webkit-390 and webkit-1280.
  `page.reload()` with the context offline throws "WebKit encountered an internal error". The reason is in the test's
  annotation, and every other step of that test, including the send with the original times, runs in WebKit.

### Office screenshots (viewport, looked at)
- `app/tests/shots/office-today-<project>.png`: the board at 9:20 AM on Mon Sep 14 (NDT): counts, Margaret P. "Missed: not
  checked in 30 minutes after the start" with "Call Jo W. (SAMPLE): 709-555-0131", and Bill S. and Walter G. late.
- `office-week-conflict-<project>.png`: the conflict list (the two Terry O. travel gaps) with the grid at 1280, and Saturday's
  cards at 390.
- `office-client-form-<project>.png`: Walter G.'s form with the map, the draft pin and "© OpenStreetMap contributors".

Made by `npx playwright test -c playwright.shots.config.mjs` (`tests/shots-office.mjs`), outside the suite's counts, on all
four projects. Looking at them turned up the client's own marker sitting under the draft pin (now hidden while editing) and
the 390 week picture missing the cards (now scrolled to the day tabs).

### Results (full suite run alone, `npx playwright test`, Worker on 7903/7913, 2026-09-14)
| project | passed | failed | skipped |
|---|---|---|---|
| chromium-390 | 17 | 0 | 0 |
| chromium-1280 | 16 | 0 | 0 |
| webkit-390 | 17 | 0 | 0 |
| webkit-1280 | 16 | 0 | 0 |
| **total** | **66** | **0** | **0** |

`@phone` and `@desktop` tests are filtered out by project, not skipped. No test is skipped. One step inside one test is skipped
on WebKit only, with its reason in the test's annotation: the reload with no signal in `offline.spec.mjs`, where
`page.reload()` with the context offline throws "WebKit encountered an internal error". No route is missing behind it; the
rest of that test runs in both engines.

### Negative controls (a)–(e), `app/tests/negative-*.mjs` on 7906/7916, recorded in `app/tests/negative-control.log`
For each control, the unbroken copy passed first, then the broken copy went red. Artifacts stay inside each copy.
- **(a) queue** (`offline.spec` 500-once, chromium-390). Break: `w/queue.js` deletes the item before posting it. Red:
  `expect(card.locator('.visit-status')).toHaveText(/ · saved on this phone$/)` → element(s) not found. The check-in was erased
  on its first failed send and never reached the server.
- **(b) time** (`offline.spec` no signal, chromium-390). Break: each event is posted with `at` = the send time. Red:
  "check-in keeps the time tapped", expected `"2026-09-14T13:00:00.000Z"`, received `"2026-09-14T15:12:10.000Z"`.
- **(c) board** (`board.spec`, chromium-1280). Break: `public/rules.js` goes late at 16 minutes. Red: at 09:15:00
  `toHaveAttribute('data-alert', 'late')`, received `"none"`.
- **(d) familynote** (`family.spec`, chromium-1280). Break: the copied **Worker** returns the note text whatever `shareable`
  says. Red: "the note is not on the page", expected 0, received 1.
- **(e) overlay** (`worker.spec` near journey, chromium-390). Break: a transparent `div` laid over Check in. Red:
  `tap(Check in) hit-test at 195,476: something else is on top`, received `<div style="position:absolute;inset:0;background:transparent"></div>`.

The log also keeps two voided rounds, with notes saying why:
- I first ran the controls while the suite was running, and both used `app/tests/results`, so each emptied the other's
  artifacts;
- then (b)'s break commented out a `catch` (a syntax error, not the break), and (a) went red only as a 120 s timeout.

The reruns above replace them.

### Known gaps
- A deactivated worker's link answers 401 on the Worker today (review item 1). Nothing tests clarification 5 until hc1
  changes it.
- The office agency comes from M1 routes until `GET /api/office/agency` exists, so a funder with no clients is not offered.
- The `@desktop` drag uses pointer events; touch drag on a tablet-sized planner is not built ("Assign to" is the touch path).
- Reports, Settings, Fix times and New link are M3.

## M2c: hc1's review findings and clarifications 6–15 (2026-09-14)

Rebased on main at 866ee71 (API.md clarifications 6–15; hc1 M2 and M3 merged). Every finding in hc1's two read-only reviews
(docs/build-report-hc1.md) is fixed below. Each fix has an assertion that fails without it, proven by breaking a copy:
negative control (f) for the queue, and the M2c proofs for the rest.

### Phone
1. **Clarification 6 (R1, data loss).**
   - Change: `w/queue.js` counts a 200/201 as sent only when `data.event.id` equals the queued id, lower-cased. Any other
     200/201 is kept and retried with the backoff. `api.js` sends the event POST with `redirect: 'error'`.
   - Spec (`offline.spec`): `page.route` fulfils the first event POST with `200 text/html` (a Wi-Fi login page). The strip
     still says "1 saved on this phone", the card still says "saved on this phone" and `/api/test/events` is empty. The next
     try lands, and exactly one check-in is stored.
   - Negative control (f), `negative-portal.mjs`: the copy confirms on any 200.
2. **Clarification 8, page side.**
   - While typing: the note is checked against the Worker's rules (≤ 200 characters, ≤ 2 lines, `/\d(?:[ -]?\d){11,}/`).
     The words show under the note and in the sheet, and "Yes, check out" is disabled.
   - After the answer: a 201 carrying `note_refused`/`tasks_refused` is kept in `localStorage` `hcv:notice:<visit id>`
     (the Worker's message only, never entry notes). It shows on the visit as "Checked out. The note wasn't saved: …"
     until OK is tapped.
   - Specs (`worker.spec`): two phone numbers in a row disable "Yes, check out" with "Don't put health card numbers in this
     app.", and a clean note enables it again. `page.route` rewrites the check-out's note on its way out: the 201 has
     `note_refused`, the card says "The note wasn't saved: …", and the office has `worked_seconds` 2 700 and `note: null`.
3. **Clarification 9 (R4, payroll).**
   - Change: after today's list, the page also loads `?date=<yesterday>` when yesterday's saved list or the queue (items now
     carry `visit_date`) holds a visit that is checked in and not checked out. Those visits show first under "Still open
     from yesterday", with their Check out.
   - Spec (`worker.spec`): a one-off 23:15–23:55 visit is checked in at 23:20. The page clock moves to 00:20 the next day
     and the page reloads. The section shows it; the check-out lands with `check_out.at` 00:20 and `worked_seconds` 3 600.
4. **Clarification 10 (R5, privacy).**
   - Change: a 401 on the page's own key, from the visits load or from the queue (`onKeyRefused`), removes every
     `hcv:visits:*` saved under that key and every `hcv:draft:*`. The `queue` and `refused` stores stay.
   - Spec (`offline.spec`): New link through the API, then reload. The storage keys go from present to `[]`, the entry notes
     are not in the page, and IndexedDB still holds the check-in.
5. **Clarification 11 (R6, payroll).**
   - Change: a refused check-in stays on its card: "Not accepted by the office: check-in tapped at 10:30 AM. Call the
     office: 709-555-0100", with the server's words. "Check in again" shows while the visit has no other check-in.
   - Spec (`offline.spec`): the office sets the check-in with Fix times while the phone's check-in waits for signal. The
     phone's 409 shows on the card, and the card shows the office's "Checked in 10:10 AM".
6. **Clarification 12 (R7).**
   - Change: `w/sw.js` is network-first for its own files, with a 3 s timeout, refreshing the cache and falling back to it.
     Required files are cached one at a time; the mock files are optional. The cache name is `hcv-w-v2`.
   - **No spec, and why:**
     - Showing network-first honestly means changing a file the Worker serves while a controlled page is open, which would
       touch the shipped tree mid-run.
     - Playwright does not reliably route a service worker's own fetches, so faking it through `page.route` would measure
       the route, not the service worker.
     - The precache tolerance would need a deploy without the mock files, which is a copy of the Worker's assets folder,
       not a browser behaviour.
   - What still guards it: the Chromium offline reload in `offline.spec` exercises the cache fallback on every run.

### Office (clarification 15)
7. **Workers and Clients load `?all=1`** and list inactive entries under an "Inactive" heading (`#worker-list-inactive`,
   `#client-list-inactive`), still openable.
   - The edit sheet (and the 390 "Assign to") always offers the visit's current worker, as "<name> (inactive)" when needed.
   - The week grid and day view add a "<name> (inactive)" row for any worker on a visit who is not in `workers`.
   - Sign out says "Signed out on this computer. The session couldn't be closed at the office. …" when signout doesn't
     answer 200.
   - `agencyFromM1Routes` is removed; a failing office route shows the API's words.
   - Specs (`office.spec`): Terry O. is deactivated in the form, then listed under Inactive and reopened. His earlier 8:00
     visit opens from his "(inactive)" week row with his name selected, and saves with `worker_id` kept. A sign-out that
     can't reach the office shows the message and clears the token.

### Spec gaps from hc1's early review
8. `worker.spec` and `family.spec` move the page clock (and `X-Test-Now`) 47 minutes between check-in and check-out. They
   assert "Done 10:30 AM – 11:17 AM", `check_out.at`, `worked_seconds` 2 820 and "Arrived 10:30 AM, left 11:17 AM".
9. `office.spec`:
   - the new client's pattern is stored with Alex B., and its chips sit in Alex B.'s row (1280) or group (390), not "No
     worker";
   - the worker test unticks Friday and ticks Saturday 9:00–1:00, and asserts the stored `availability` exactly.
10. `planner.spec`:
    - both chips (1280) or cards (390) have the computed left border colour of `--missed-edge` and the word "Conflict";
    - after the stale 409, exactly one PUT was sent, and the other screen's change stands.
11. `targets.spec`: the "Call …" link on the late and the missed row meet 4.5 : 1.

### Results (full suite run alone, 2026-09-14)
| project | passed | failed | skipped |
|---|---|---|---|
| chromium-390 | 25 | 0 | 0 |
| chromium-1280 | 24 | 0 | 0 |
| webkit-390 | 25 | 0 | 0 |
| webkit-1280 | 24 | 0 | 0 |
| **total** | **98** | **0** | **0** |

The only step skipped is still the WebKit offline reload in `offline.spec`, with its reason in the test.

### Negative controls (a)–(f) and M2c proofs (run one at a time on 7906/7916, nothing else running; `app/tests/negative-control.log`)
Each passed on its unbroken copy first, then went red at the named assertion.

| check | break (copy only) | red with |
|---|---|---|
| (a) queue | `w/queue.js` deletes the item before posting | `.visit-status` `/ · saved on this phone$/`: element(s) not found (the check-in was erased on its first failed send) |
| (b) time | events posted with `at` = send time | "check-in keeps the time tapped": expected `2026-09-14T13:00:00.000Z`, received `2026-09-14T15:12:10.000Z` |
| (c) board | late at 16 min | at 09:15:00 `data-alert` expected `"late"`, received `"none"` |
| (d) familynote | the copied **Worker** returns every note | "the note is not on the page": expected 0, received 1 |
| (e) overlay | transparent `div` over Check in | `tap(Check in) hit-test at 195,476: something else is on top` |
| **(f) portal** (new) | `w/queue.js` confirms on any 200 | "the check-in is still saved on the phone": expected `/^1 saved on this phone\./`, received `"All sent"` |
| proof-yesterday | yesterday never loaded | heading "Still open from yesterday": element(s) not found |
| proof-forget | a refused key keeps saved lists and drafts | "no hcv:visits or hcv:draft keys left": received 4 keys |
| proof-refusedcard | a refused check-in not on its card | "Not accepted by the office: check-in tapped at 10:30 AM. Call the office: 709-555-0100": element(s) not found |
| proof-notecheck | no health card check while typing | `.note-error` expected "Don't put health card numbers in this app.", received `""` |
| proof-notice | `note_refused` ignored | "Checked out. The note wasn't saved: …": element(s) not found |
| proof-inactive-list | Workers loads active only | heading "Inactive": element(s) not found |
| proof-inactive-sheet | the sheet leaves out the inactive current worker | "the sheet keeps the inactive worker": expected `"5"`, received `""` |
| proof-inactive-row | no week row for an inactive worker | `.grid-worker` "Terry O. (SAMPLE) (inactive)": element(s) not found |

Controls: `node app/tests/negative-<queue|time|board|familynote|overlay|portal>.mjs`. Proofs: `node app/tests/negative-m2c-proofs.mjs`.
Control (e)'s anchor was updated for the "Check in again" label. The (d) anchor was checked against hc1's current Worker.

Not proven by a broken copy: the sign-out message, the planner's edge colour / single PUT, the Call-link contrast and the
advanced-clock assertions. These are new assertions on behaviour that was already right, so there is no fix to remove. Each
fails if that behaviour regresses.

## Before M3: the two spec timing defects from the lead's pinned QA of 866ee71 (DECISIONS 36)

1. **`board.spec`, clock left running.** The page clock is installed a second before 09:14:59 and `pauseAt(09:14:59)`, so only
   `runFor` moves it; 15:00, 29:59 and 30:00 no longer depend on the machine's speed. `setNow(..., { mode: 'install' })` in
   `helpers.mjs` does the same for every other installed clock. The other exact-boundary checks already used a fixed clock
   with no running between assertions: `targets.spec` contrast at 9:20, and the labels in offline, worker, family and reports.
2. **`offline.spec`, frozen clock stalling the queue.** `waitEvent` now steps the page clock 5 s every 400 ms of real time until
   its answer arrives (`untilAnswer`: `runFor` on an installed clock, `setFixedTime` on a fixed one), so a backoff after a
   dropped send always comes due. Every spec that waits on the queue goes through `waitEvent`: offline, worker, family,
   reports.
   - **Proof, kept in the suite for good:** "a check-out the office already has…" and "a check-in the office already set with
     Fix times…" abort the first event POST after signal comes back (`route.abort('connectionreset')`, the failure QA saw).
     Each asserts `dropped === 1` and must still get its 409. Both pass in all four projects.

## M3: Reports, Fix times, New link, Settings, chip polish (2026-09-14)

Rebased on main at 0c33594.

### Built
- **Reports** (`office/reports.js`).
  - Period: From/To dates, with "This week", "Last week" and "Last 14 days" from the page clock in NL time, and tabs Payroll ·
    Billing · Missed and late · Mileage.
  - **Payroll:** worker rows with their client rows, the Worker's own `total` (the page adds nothing up), and "Checked in,
    not checked out" from `incomplete`.
  - **Billing:** funder rows with their client rows. Scheduled hours use the API's rounding from `scheduled_minutes`.
  - **Missed and late:** one row per visit with `what_label`.
  - **Mileage:** each worker's day with its legs and km, the totals, and the straight-line note.
  - **Download CSV:** `fetch` with the Bearer token → a blob → a download named from `Content-Disposition`. A 401 without
    `field` ends the session; any other refusal shows the API's words.
- **Fix times** in the edit sheet (`office/sheet.js`).
  - The times section shows each event with its source: "8:30 AM (from the phone, Within 250 m of the client)" or "9:31 AM
    (set by the office: <correction_reason>)", plus the worked time.
  - The inputs are NL time. Only a changed time is sent, so the phone's seconds are never overwritten by the same minute. A
    check-out earlier on the clock than the check-in counts as the next day. A reason is required.
  - Clarification 14's restore refusal shows in the sheet with the API's words.
- **New link** on the worker and client forms (`linkBlock` in `office/core.js`).
  - An inline confirm: "The old link stops working at once. <who> will need the new one." with "Make a new link" and "Keep
    the old link".
  - It works on inactive workers and clients, opened from Inactive. Copy link shows "Copied".
- **Settings** (`office/settings.js`): agency name and office phone (`PUT /api/office/agency`, and the header repaints), and
  change PIN (`PUT /api/office/pin`). A 401 with `field: "current"` shows by that field and the session stays.
- **Planner chips:** the name wraps to two lines (no more "Walter G. (S…"), and the time is compact ("9:00–10:00 AM",
  `compactRange` in `time.js`). Full names and the full time stay in the sheet.

### Specs
- **`reports.spec`:**
  - Two real phone journeys with the page clock. Sam R.: Bill S. 9:00:00–10:00:18, then Ruby T. checked in and left open.
    Jo W.: Margaret P. checked in at 8:30:42, with no check-out.
  - Payroll first lists Margaret P. as incomplete. Her check-out is then fixed to 9:31 in the edit sheet, and the sheet shows
    "set by the office: <reason>".
  - Each worker's visit is exactly 3 618 s, so the API rows are "1.01" and "1.01" and the total is "2.01" (7 236 s). The page
    shows each row, each client row and the total exactly as the API does; the rows added up would be "2.02".
  - The CSV download's bytes equal `GET /api/office/reports/payroll.csv` for the same period, with the expected filename.
  - Billing's funder rows and hours match the API. Missed lists the API's rows. Mileage shows Sam's Bill S. to Ruby T. leg,
    its km, and the straight-line note. The period buttons set the dates.
- **`links.spec`:**
  - New link on Sam R. ("Keep the old link" first changes nothing): the old link says "This link doesn't work any more…" and
    the new one loads.
  - New link on Terry O. after he is made inactive, opened from Inactive: the old link is refused.
  - New family link on Walter G.: the old family link shows the bad-link message and the new one works.
  - Copy worker link reads back the exact link from the clipboard in Chromium. WebKit asserts "Copied" and skips only the
    read, with the reason.
- **`settings.spec`:**
  - A wrong current PIN answers 401 `field: "current"`, the words show by the field, the session keeps working, and the PIN
    is unchanged.
  - A PIN change: the new PIN signs in and the old one doesn't.
  - Agency name and phone are saved, and the header shows the new name with the SAMPLE badge.
- **`planner.spec`, clarification 14:** Walter G.'s pattern moves to 10:00, which soft-removes Tuesday 9:00. Alex's phone then
  checks in to it. The sheet shows "Removed when the visit pattern changed.", and Restore shows "This visit was removed from
  the schedule, so it can't be restored." (409).

### Results (full suite run alone, 2026-09-14)
| project | passed | failed | skipped |
|---|---|---|---|
| chromium-390 | 33 | 0 | 0 |
| chromium-1280 | 32 | 0 | 0 |
| webkit-390 | 33 | 0 | 0 |
| webkit-1280 | 32 | 0 | 0 |
| **total** | **130** | **0** | **0** |

Steps skipped inside tests, WebKit only, each with its written reason: the offline reload (`offline.spec`) and the clipboard
read-back (`links.spec`).

### Negative controls (a)–(g) and proofs, run alone after M3 (2026-09-14 14:27–14:32Z, `app/tests/negative-control.log`)
Each passed on its unbroken copy first, then went red at the named assertion.

| check | break (copy only) | red with |
|---|---|---|
| (a) queue | deletes before posting | `/ · saved on this phone$/`: element(s) not found |
| (b) time | `at` = send time | "check-in keeps the time tapped": expected `…13:00:00.000Z`, received `…15:12:10.000Z` |
| (c) board | late at 16 min | at 09:15:00 `data-alert` expected `"late"`, received `"none"` |
| (d) familynote | the copied Worker returns every note | "the note is not on the page": expected 0, received 1 |
| (e) overlay | transparent `div` over Check in | `tap(Check in) hit-test at 195,476: something else is on top` |
| (f) portal | any 200 counts as sent | "the check-in is still saved on the phone": received `"All sent"` |
| **(g) payrollround** (new) | Payroll total = rounded rows added up | "the Worker's total, not the rounded rows added up (2.02)": expected `"2.01"`, received `"2.02"` |
| proofs (8) | clarifications 8–11 and 15 removed one at a time | each red at its targeted assertion, the same as at M2c |

Run: `node app/tests/negative-<queue|time|board|familynote|overlay|portal|payrollround>.mjs` and `node app/tests/negative-m2c-proofs.mjs`.

### Office screenshots (viewport, all four projects, looked at)
`app/tests/shots/office-<screen>-<project>.png`, from the demo scenario at Mon Sep 14, 10:30 AM:
- today, visit-sheet (the Times section with sources and Fix times), week-conflict;
- clients, client-form, workers, worker-form-new-link;
- report-payroll, report-billing, report-missed, report-mileage;
- settings.

Made with `npx playwright test -c playwright.shots.config.mjs`. The first look at the 1280 week showed a chip still cut off
when its time crosses noon ("10:30 AM–12:00 P"). The chip time now wraps as well, and the avatar is smaller.

After the chip-time CSS change, the full suite ran alone once more: **130 passed, 0 failed, 0 skipped** (33/32/33/32). The office
screenshots were retaken (4 passed); the 1280 week shows "Irene C. (SAMPLE)" and "10:30 AM–12:00 PM" wrapped inside the cell.

## M3b: the page side of clarification 16 and hc1's proof gaps (2026-09-14)

Rebased on main at 5bac755 (hc1 M4: the 7-day visits range, and refusals repeated on a 200 duplicate).

### Built
1. **The service worker caches only the real page** (`w/sw.js`, rewritten).
   - A response is kept only when it is 200, not redirected, and has the right `Content-Type`: `text/html`, JavaScript,
     `text/css` or `image/svg+xml`.
   - `/w/` must also contain `<meta name="hcv-page" content="worker">`, now in `w/index.html`.
   - The same checks run at install, and install fails rather than cache a login page.
2. **One set.** On a navigation the service worker fetches every file. Only when all required files pass does it store them
   as a new cache `hcv-w-set-<time>`, keeping the one before. The page's client id is pinned to the set it was served from,
   and its module requests are answered from that set.
3. **No 3-second race without a copy.** The 3 s race against the cached page runs only when a set exists. With none, it
   waits for the network, and a response that fails the checks is shown but never cached. The single `hcv-w-v*` caches from
   before M3b are deleted.
4. **Open visits from the last 7 days** (`loadEarlier`).
   - Every date up to 7 days back is checked, oldest first, where the saved lists or the queue hold a visit checked in and
     not checked out.
   - This happens whether or not today's list loaded. Online the date is fetched (`?date=`); with no signal it is rebuilt
     from the saved list and the queue.
   - A queued visit missing from any list still gets a card built from the queued item.
   - Headings: "Still open from yesterday" / "Still open from Sat Sep 12".
5. **Drafts `{ key, done, note }`.** A refused key removes only `hcv:visits:*` and `hcv:draft:*` entries whose stored `key` is
   that key.
6. **"Check out without the note"** sits next to the disabled "Yes, check out". It takes the check-out time at that tap and
   sends no note.
7. **A refusal on a 200 duplicate** reaches the same "The note wasn't saved: …" notice. The queue already confirmed a
   duplicate by its event id, and hc1's M4 now repeats the refusal.
8. **An earlier refused check-in** reads "An earlier check-in at 9:04 AM wasn't accepted by the office." with Dismiss (which
   removes it from `refused`) once the card has an accepted or queued check-in. With no other check-in, it keeps the red
   notice and "Check in again".
9. **Office sign out:** a 401 reads "Signed out.".

### New specs (all four projects unless marked)
- **`offline.spec`:**
  - *The login page poisons nothing (Chromium):* during an online reload, `context.route` answers all nine page files
    (sw.js included) with 200 `text/html`. The worker page still shows, and it reloads offline from the cache and checks in.
  - *Offline reload after midnight (Chromium):* checked in at 11:20 PM with signal; then no signal, the clock at 12:20 AM, a
    reload. "No saved list…" shows beside "Still open from yesterday", the check-out is queued, it sends, and 3 600 s are
    worked.
  - *Two links on one phone:* Jo's and Sam's lists and drafts are stored under their own keys. Sam's New link and a reload
    leave only Jo's list and draft.
  - *The Fix-times refusal:* now asserts the history wording and Dismiss.
- **`worker.spec`:**
  - *Check out without the note:* no note sent, the check-out at that tap, 1 200 s.
  - *The lost first answer:* `route.fetch` then `abort`; the resend's `200 duplicate` carries `note_refused` and the notice
    shows.
  - *"Check in again":* a spoiled location gets a 400 on the card; "Check in again" lands at 10:35 and the old one becomes
    history with Dismiss.
  - *A check-in still queued across midnight:* it shows under "Still open from yesterday", and both events land with 3 600 s.
  - *A Saturday check-in still open on Monday* with today's list answering 500: "Still open from Sat Sep 12" and "No saved
    list…", then both land with the Saturday time kept.
- **`office.spec`:** sign out after the session ended elsewhere answers 401 and reads "Signed out.".
- **WebKit skips:** the two Chromium-only tests are `test.skip` on WebKit with the reason "Playwright's WebKit neither reloads
  a page with the context offline nor routes a service worker's own fetches". That makes 4 skipped: 2 tests × 2 WebKit
  projects.
- **`worker.spec`, the queue alone opens yesterday:** a check-in is queued at 11:20 PM under Sam's old link. The office makes a
  new link, and at 12:20 AM the new link shows "Still open from yesterday". The queued check-in is re-sent under the new key
  (same worker), and the check-out lands with 3 600 s. Added after `proof-queued-midnight` stayed green (below).

### Results (full suite run alone, 2026-09-14)
| project | passed | failed | skipped |
|---|---|---|---|
| chromium-390 | 43 | 0 | 0 |
| chromium-1280 | 42 | 0 | 0 |
| webkit-390 | 41 | 0 | 2 |
| webkit-1280 | 40 | 0 | 2 |
| **total** | **166** | **0** | **4** |

The 4 skipped are the two Chromium-only tests (offline reload after midnight, login-page cache poisoning) on the two WebKit
projects. Each carries the written reason: Playwright's WebKit neither reloads with the context offline nor routes a service
worker's own fetches. No route is missing behind them. Steps still skipped inside tests on WebKit: the no-signal reload in the
first offline test, and the clipboard read-back.

### Negative controls (a)–(h) and proofs (run alone, 14:58–15:09Z; `app/tests/negative-control.log`)
Each passed on its unbroken copy first, then went red at the named assertion.

| check | break (copy only) | red with |
|---|---|---|
| (a) queue | deletes before posting | `/ · saved on this phone$/`: element(s) not found |
| (b) time | `at` = send time | "check-in keeps the time tapped": expected `…13:00:00.000Z`, received `…15:12:10.000Z` |
| (c) board | late at 16 min | at 09:15:00 `data-alert` expected `"late"`, received `"none"` |
| (d) familynote | the copied Worker returns every note | "the note is not on the page": expected 0, received 1 |
| (e) overlay | transparent `div` over Check in | `tap(Check in) hit-test at 195,476: something else is on top` |
| (f) portal | any 200 counts as sent | "the check-in is still saved on the phone": received `"All sent"` |
| (g) payrollround | Payroll total = rounded rows added up | expected `"2.01"`, received `"2.02"` |
| **(h) swpoison** (new) | `w/sw.js` caches any 200 (no type check, no page marker) | "the worker page, not the login page": `.visit-name` "Bill S. (SAMPLE)" not found |
| proof-yesterday | no earlier day is loaded | heading "Still open from yesterday": not found |
| proof-queued-midnight | the queue no longer opens an earlier day | heading "Still open from yesterday" on the new link: not found (see note) |
| **proof-earlier-days** (item 4) | only yesterday is looked at | heading "Still open from Sat Sep 12": not found |
| **proof-earlier-without-today** (item 4) | earlier days only when today's list loaded | heading "Still open from Sat Sep 12": not found |
| proof-forget | a refused key keeps its lists and drafts | "no hcv:visits or hcv:draft keys left": received 4 keys |
| **proof-draft-key** (item 5) | a refused key deletes every link's lists and drafts | "only Jo's list and draft are left": received none |
| proof-refusedcard | no refused check-in on its card | "An earlier check-in at 10:30 AM wasn't accepted by the office.": not found |
| proof-check-in-again | no "refused" state | `tap(Check in again): visible`: not found |
| proof-notecheck | no health card check while typing | `.note-error` expected the words, received `""` |
| **proof-without-note** (item 6) | no "Check out without the note" | `tap(Check out without the note): visible`: not found |
| proof-notice | `note_refused` ignored | "Checked out. The note wasn't saved: …": not found |
| proof-inactive-list / -sheet / -row, **1280 and now 390** | clarification 15 removed one piece at a time | the "Inactive" heading; `#vs-worker` `""` instead of `"5"`; the 1280 grid row / the 390 group heading "Terry O. (SAMPLE) (inactive)" |

**A proof that measured nothing, and what changed.** `proof-queued-midnight` first ran against "a check-in still queued across
midnight" and stayed **GREEN**. That spec keeps yesterday's saved list, which already shows the queued check-in, so the queue
path is never needed there. The proof now runs against the old-link test above, where only the queue knows the visit is open,
and it goes red. The green run and a note explaining it stay in the log.

Run: `node app/tests/negative-<queue|time|board|familynote|overlay|portal|payrollround|swpoison>.mjs`, and
`node app/tests/negative-m2c-proofs.mjs` (`PROOF=<name>` for one).

### Phone screenshots (viewport, all four projects, looked at)
- `app/tests/shots/phone-still-open-earlier-day-<project>.png`: "Still open from Sat Sep 12" with George N. checked in at 9:05 AM
  and its Check out, above "No visits for you today".
- `phone-checkout-without-note-<project>.png`: the sheet with the note, "Don't put health card numbers in this app.", the
  disabled "Yes, check out", "Check out without the note" and "Not yet".

Made with `npx playwright test -c playwright.shots.config.mjs` (8 passed, office and phone).

## M3c: the page side of clarification 17 (2026-09-14)

Rebased on main at 5883591 (hc1 M5: a PIN change ends every other session; `scheduled_hours` in billing). Each item was
committed as soon as its specs went green: b9d2021 (items 1 and 3), 0eca1fa (2, 4, 6), 62e0992 (5).

### Built, with the spec that fails without it
1. **No silent next day** (`office/sheet.js`).
   - Change: Fix times sends each time on the visit's date. When the typed check-out is at or before the check-in, a checkbox
     "The check-out was after midnight" appears; only when it is ticked is the check-out sent on the next day.
   - Spec (`sheet.spec`): a 6:00–8:00 PM visit is checked in at 6:02 and the office types 8:00 AM. The PUT carries 8:00 AM on
     the visit's date, the Worker answers "Check-out has to be after check-in." by the field, and nothing is stored. Ticked,
     the check-out is stored at 8:00 AM the next day with 50 280 s worked.
   - Negative control (i), `negative-silentnextday.mjs`: the copy moves the check-out to the next day without the box.
2. **Presets and downloads at the moment of use** (`office/reports.js`).
   - Change: `presetRange()` reads `Date.now()` when a button is pressed. Download CSV reads From and To at the click and,
     when they differ from the shown period, loads that period first.
   - Specs (`reports.spec`):
     - the Reports tab opened on Sat Sep 12; three days on, without a reload, "Last week" is Sep 7–13 (not Aug 31–Sep 6),
       "Last 14 days" is Sep 2–15, and "This week" is Sep 14–20;
     - dates typed without pressing Show download `home-care-payroll-2026-09-01-to-2026-09-10.csv`, the Worker's bytes, and
       the page then shows "Tue Sep 1 to Thu Sep 10".
   - Negative control (j), `negative-presetsmount.mjs`: presets computed at mount.
3. **The spring-forward gap.**
   - Change: a typed time is turned into an instant and back; when the NL date or time differs, the time doesn't exist that
     day. The sheet shows "That time doesn't exist on the day the clocks change." by the field and sends nothing.
   - Spec (`sheet.spec`): check-in 2:30 AM on 2026-03-08 shows the words, no PUT is sent, and the visit has no check-in.
4. **Billing prints the Worker's `scheduled_hours`** on clients, funders and the total; the page's own rounding helper is gone.
   Spec: every billing row's and the total's scheduled-hours cell equals the API's `scheduled_hours`.
5. **Retries measured in page time.**
   - Change: `waitEvent` records `pageWaitMs` and steps an installed clock 1 s at a time. `offline.spec` stamps each try's page
     time in its route and checks the gaps against the contract's 5/15/30/60 s backoff: never earlier, and within the backoff
     plus one 20 s tick (plus 2 s step slack after a 500).
   - The login page: the next try comes within 5 s plus one tick after one failure.
   - The 500-once test: success comes within the named backoff for that many failures in a row, 30 s after the third failure.
   - Both refused tests (now on a paused clock): the next try comes 5 s after the first failure and 15 s after the dropped send.
   - The no-signal test: both sends come within one 5 s clock step of `online`.
   - Proof `proof-retry-timing`: a copy that waits 30 s after the first failure.
   - Not measured: the worker.spec cross-midnight and Saturday tests. They run on a fixed clock whose timers run in real time,
     so how many tries fail before signal returns isn't deterministic. They assert that the sends arrive, with the tapped
     times kept.
6. **Spec gaps.**
   - `settings.spec`: renaming the agency to "Exploits Home Support (demo)" hides the badge (`sample: false` in the answer and
     the public agency). Renaming it back to "SAMPLE Exploits Home Support (demo)" shows it again.
   - `reports.spec`: on Sunday 2026-11-01 at 11:30 PM NL, the day the clocks go back, "This week" is Oct 26–Nov 1, "Last 14
     days" is Oct 19–Nov 1, and "Last week" is Oct 19–25.

### Results (full suite run alone, 2026-09-14 15:31Z)
| project | passed | failed | skipped |
|---|---|---|---|
| chromium-390 | 49 | 0 | 0 |
| chromium-1280 | 48 | 0 | 0 |
| webkit-390 | 47 | 0 | 2 |
| webkit-1280 | 46 | 0 | 2 |
| **total** | **190** | **0** | **4** |

The 4 skipped are unchanged from M3b: the two Chromium-only tests (offline reload after midnight, and the login page poisoning
the cache) on the two WebKit projects, each with its written WebKit reason.

### Negative controls (a)–(j) and proofs, run alone after the suite (15:38–15:48Z, `app/tests/negative-control.log`)
Each passed on its unbroken copy first, then went red at the named assertion. The log holds no machine paths.

| check | break (copy only) | red with |
|---|---|---|
| (a) queue | deletes before posting | `/ · saved on this phone$/`: element(s) not found |
| (b) time | `at` = send time | "check-in keeps the time tapped": expected `…13:00:00.000Z`, received `…15:12:10.000Z` |
| (c) board | late at 16 min | at 09:15:00 `data-alert` expected `"late"`, received `"none"` |
| (d) familynote | the copied Worker returns every note | "the note is not on the page": expected 0, received 1 |
| (e) overlay | transparent `div` over Check in | `tap(Check in) hit-test at 195,476: something else is on top` |
| (f) portal | any 200 counts as sent | "the check-in is still saved on the phone": received `"All sent"` |
| (g) payrollround | Payroll total = rounded rows added up | expected `"2.01"`, received `"2.02"` |
| (h) swpoison | the service worker caches any 200 | "the worker page, not the login page": not found |
| **(i) silentnextday** (new) | the check-out moves to the next day without the box | the first Fix times answer: expected 400, received 200 (stored instead of refused) |
| **(j) presetsmount** (new) | presets computed at mount | "the week before Tue Sep 15, not before Sat Sep 12": the inputs differ |
| **proof-retry-timing** (new) | the queue waits 30 s after its first failure | "the try after the login page: 31000 ms of page time, within the 5 s backoff plus 20 s": expected ≤ 25000 |
| the 17 earlier proofs | as listed under M3b | each red at the same assertion as in M3b |

Run: `node app/tests/negative-<queue|time|board|familynote|overlay|portal|payrollround|swpoison|silentnextday|presetsmount>.mjs`, and
`node app/tests/negative-m2c-proofs.mjs` (18 proofs; `PROOF=<name>` runs one).

## M3d: the page side of clarifications 18 and 19 (2026-09-14)

Rebased on main at 6cb9e81 (hc1 M6: `open_dates` on `GET /api/worker/visits`).

### Built, with the spec that fails without it
1. **Saved list first** (clarification 18, `w/app.js`).
   - Change: `refreshQueue().then(showSaved).then(load)` draws today's saved list (with "Saved list from …"), the open earlier
     days from the saved lists, and the queue before any request. Every `GET /api/worker/visits` carries a
     `AbortSignal.timeout(8000)`, and a timeout is a failed load, so the saved list stays.
   - Spec (`offline.spec`): the visits GET is routed so it never answers; after a reload the saved list's Check in is visible
     within 1 s with "Saved list from 10:30 AM".
   - Negative control (k), `negative-savedfirst.mjs`: the copy draws only after the GET.
2. **Dismiss hides, never deletes.** Dismiss adds the refused item's `seq` to `localStorage` `hcv:dismissed` and hides only the
   history notice.
   - Spec (`worker.spec`, "Check in again"): after Dismiss the item is still under "Not accepted by the office", a reload keeps
     the notice hidden and the item listed, and Remove takes it away.
3. **`open_dates`.** `loadEarlier` also loads every date the Worker names in the day's `open_dates` (the saved answer's when
   offline).
   - Spec (`worker.spec`): Sam's Friday 9:05 AM check-in is made through the API (the lost phone), and the Monday answer names
     Friday. A clean context on Monday shows "Still open from Fri Sep 11" with "Checked in 9:05 AM · Location not shared". Check
     out lands, and `worked_seconds` is Monday 10:30 AM minus Friday 9:05 AM.
   - Negative control (l), `negative-opendatespage.mjs`: the copy ignores `open_dates`.
4. **Fix times dates each time from the event it replaces** (clarification 19, `office/sheet.js`).
   - A typed check-in is on the visit's date, or the next day when "The check-in was after midnight" is ticked. That box is
     offered when the typed time is earlier than the visit's start, and starts ticked when the stored check-in is on a later
     date.
   - A typed check-out is on the check-in's own NL date, or the next day when "The check-out was after midnight" is ticked.
     That box is offered when the check-out instant would be at or before the check-in instant, and starts ticked when the
     stored check-out is on a later date than its check-in.
   - A time is sent only when its date or minute differs from the stored event.
   - Spec (`sheet.spec`): an 11:00–11:55 PM visit is checked in at 12:10 AM the next day. The check-in box is shown and ticked,
     and 12:50 AM typed needs no check-out box. The PUT sends only `check_out_at` at 12:50 AM the next day, stored with 2 400 s
     worked.
   - Control (i)'s break now sits on the new check-out line.
5. **Small items.**
   - Report tabs take the dates typed in From and To. Spec: dates typed, then the "Missed and late" tab shows "Tue Sep 1 to Thu
     Sep 10".
   - Billing spec: three 20-minute clients each print "0.33" on screen as the API gives, and the total prints "1.00" (rounded
     rows would add up to 0.99).
   - `app/package.json` `npm run negative` runs `tests/run-negatives.mjs`: every `negative-*.mjs` except the library, in name
     order, one at a time, exiting non-zero if any is not red.

### A spec race found in the final run, and fixed
The first full run failed once, on chromium-390: "a Saturday check-in still open on Monday…" hit "Element is not attached
to the DOM" at the Check out tap. The same race had made `proof-earlier-days` and `proof-earlier-without-today` VOID.
- Cause: since item 1 the page draws Saturday from the phone first, then again when Saturday's list answers. The tap could
  land in that redraw. The old-link test hit the same race earlier this round and got the same kind of wait.
- Fix: the spec waits for Saturday's list to answer, and brings the signal back only after Check out is tapped. The test
  passed 12/12 (3 runs on each project).
- With the break in place, both proofs now go red at `page.waitForResponse` for Saturday's list, because the broken copy never
  asks for it. Before the fix they went red at the heading.

### Results (full suite run alone, 2026-09-14 16:32Z)
| project | passed | failed | skipped |
|---|---|---|---|
| chromium-390 | 54 | 0 | 0 |
| chromium-1280 | 53 | 0 | 0 |
| webkit-390 | 52 | 0 | 2 |
| webkit-1280 | 51 | 0 | 2 |
| **total** | **210** | **0** | **4** |

The 4 skipped are unchanged from M3b and M3c, each with its written WebKit reason.

### Negative controls (a)–(l) and all 18 proofs (`npm run negative`, run alone after the suite, 16:38–16:52Z)
`npm run negative` exited 0 with "All 13 negative-control scripts went red as required". Each script passed on its unbroken copy
first, then went red at the named assertion. `app/tests/negative-control.log` holds no machine paths.

| check | break (copy only) | red with |
|---|---|---|
| (a) queue | deletes before posting | `/ · saved on this phone$/`: element(s) not found |
| (b) time | `at` = send time | "check-in keeps the time tapped": expected `…13:00:00.000Z`, received `…15:12:10.000Z` |
| (c) board | late at 16 min | `data-alert` expected `"late"`, received `"none"` |
| (d) familynote | the copied Worker returns every note | "the note is not on the page": expected 0, received 1 |
| (e) overlay | transparent `div` over Check in | `tap(Check in) hit-test at 195,476: something else is on top` |
| (f) portal | any 200 counts as sent | "the check-in is still saved on the phone": received `"All sent"` |
| (g) payrollround | Payroll total = rounded rows added up | expected `"2.01"`, received `"2.02"` |
| (h) swpoison | the service worker caches any 200 | "the worker page, not the login page": not found |
| (i) silentnextday | the check-out moves to the next day without the box (new anchor) | expected 400, received 200 |
| (j) presetsmount | presets computed at mount | "the week before Tue Sep 15, not before Sat Sep 12": the inputs differ |
| **(k) savedfirst** (new) | the saved list is drawn only after the visits GET | "the saved list, without waiting for the network": not found |
| **(l) opendatespage** (new) | the page ignores `open_dates` | the "Still open from Fri Sep 11" heading: not found |
| proof-earlier-days, proof-earlier-without-today | as in M3b | `page.waitForResponse` for Saturday's list times out (the broken copy never asks for it) |
| the other 16 proofs | as in M3b and M3c | each red at the same assertion as before |

About the log: in the first run (16:10–16:20Z) those two proofs were VOID, from the spec race above. The entries from that run
were then lost when I edited the log file to add a note, so I restored the committed log, wrote the note again, and reran
everything. The entries from 16:38Z on are the ones that count.

Servers: the suite's Worker (7903/7913) and the controls' Worker (7906/7916) were stopped by their runners, and all four ports
are free.

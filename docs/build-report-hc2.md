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

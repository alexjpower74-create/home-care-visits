# Build report: hc1 (Worker, D1, rules, reports)

Slice `worker/**`, branch `rig/hc1`. This file is a record: items are marked DONE or REJECTED in place.

## M1 (2026-09-14)

### What was built: DONE

- `worker/wrangler.toml`: name `home-care-visits`, D1 binding `DB` with the placeholder id, `[assets] ../app/public`,
  `run_worker_first = ["/api/*"]`. No `TEST_MODE` anywhere in it (a unit test checks).
- `migrations/0001_init.sql`: agency (single row), zones, funders, sessions, signin_attempts, family_lookups, workers,
  worker_zones, clients, client_tasks, family_contacts, patterns (`valid_from_at`/`ended_at`), visits
  (`UNIQUE(pattern_id, pattern_date)`, `version`), visit_workers, events (`id TEXT PRIMARY KEY`, `voided_at`, partial unique
  indexes on one effective check-in and one effective check-out per visit), visit_tasks, visit_notes (`shareable`).
- `migrations/0002_agency.sql`: the SAMPLE agency with PIN 4826 as PBKDF2-SHA256 (100 000 iterations, 16-byte salt), zones and
  funders. `tools/hash-pin.mjs` made the hash. `src/sample.js` reuses the same hash on reset, so a reset costs no PBKDF2 run. A unit
  test proves the two copies agree and that the hash really is 4826 and not 4827.
- `tools/build-sample-data.mjs` builds the committed `src/sample-data.js` from `data/sample-agency.json`. A unit test fails when that
  output is stale.
- `src/`: `index.js` (router and handlers), `auth.js`, `clock.js` (X-Test-Now and X-Test-IP only under `TEST_MODE=1`), `time.js`
  (NL local ↔ UTC, labels, weeks, hours), `geo.js`, `rules.js` (late/missed rule and original-time rule), `conflicts.js`,
  `generate.js`, `privacy.js`, `labels.js`, `sample.js`.
- Routes (M1 list): `GET /api/agency`; office `signin`, `signout`, `GET/POST/PUT clients` (+ `GET clients/:id`), `GET/POST/PUT workers`,
  `GET week`, `GET day`, `POST visits`, `PUT visits/:id`, `POST visits/:id/cancel`, `POST visits/:id/restore`, `PUT visits/:id/note`;
  worker `GET visits`, `POST events`; `GET /api/family/:key`; `POST /api/test/reset`, `GET /api/test/events`.
- `tests/run.mjs` works as in Snow Route. With nothing answering on `PORT` (default 7902), it wipes `.state-<PORT>`, migrates,
  and starts `wrangler dev --local --var TEST_MODE:1` (inspector port + 10). Since `app/public` is absent in this worktree it
  serves an empty assets folder, and it stops what it started.
- `npm run dev` migrates, then starts wrangler dev on 7902/7912 with state in `.state-dev`, so a test run never wipes it.
  It needs `../app/public` to exist, which is true once hc2's work is merged.

### Verified: DONE

`npm test` in `worker/`: **23/23 unit tests pass** (`unit`, `time`, `conflicts`), then **48/48 API tests pass** against a real
`wrangler dev --local` on 7902. Nothing skipped.

What the tests hold, and how each could have gone wrong:
- **Late/missed boundaries:** start + 14:59.999 is none, + 15:00.000 late, + 29:59.999 late, + 30:00.000 missed. A checked-in or
  cancelled visit is none at + 2 h. The day board API checks the same boundaries through `X-Test-Now`.
- **Time:** both examples in each direction; the spring-forward gap refused, both in the pure test and as a 400 on `POST visits`;
  the fall-back hour gives its first occurrence. `hmLabel("HH:MM")` equals Intl's label for all 1 440 minutes of a day. Mondays
  are checked across a month end and a year end.
- **Conflicts:** a hand-built week with exactly one conflict of each kind, compared whole (messages, extra fields, order). The
  travel-gap boundary sits at gap = needed with 1.3 × the straight-line distance computed in the test. Over-hours ids are
  checked at, below and above the limit. Unassigned and cancelled visits never conflict. 20 shuffled inputs give identical
  output. The SAMPLE base week gives exactly `expected_base_week_conflicts`, for a summer week and a winter week.
- **Events:** a resend of the same id (again, upper-cased, or aimed at a different visit) answers 200 `duplicate`, and the raw
  rows show exactly one. Also covered: a different id → 409 `already_checked_in` with the stored event; check-out before
  check-in → 409; `worked_seconds` of 5 530 exactly; `at` = T with now = T + 45 min stored as T (truncated to the second);
  2 h ahead adjusted; a check-out earlier than the check-in clamped and flagged; a reassigned visit accepts the first worker's
  check-in but refuses another worker's check-out; a cancelled visit gives `visited_after_cancel`; a stranger gets 404; and
  every input refusal.
- **Pattern edits:** rebuilt at Wednesday 8:55 AM with Wednesday's 9:00 visit already checked in. Monday, Tuesday and
  Wednesday 9:00 keep their row ids. Thursday and Friday are new rows at 10:00, and `rebuilt_visits` is 2. A pattern added on a
  Wednesday creates visits only from Wednesday on. Deactivating a client removes exactly its two unstarted future visits.
- **Family privacy:** the raw family answer is searched for the note text, entry notes, address, coordinates, the cancel reason,
  `distance`, `location`, the location label, the worker's last name, family contact name and relationship, every SAMPLE worker
  and family phone, and every funder name. None is there until `PUT note {shareable: true}`, after which the note is. Every
  status label is covered, and an unknown key is 404.
- **Worker list:** only this worker's currently assigned visits, in order, with entry notes. The raw text never contains a
  family phone, a funder name or `distance_m`. Mileage follows the check-ins.

### Negative controls: DONE

`npm run negative` runs all five. Each copies `worker/` into `worker/.negative/<name>/` (git-ignored) and runs the named tests on
the **unbroken** copy, where they must pass. It then applies a literal break that must match exactly once, runs again, and
exits 0 only if every named test is ✖. API controls serve the copy on 7905/7915. Full output, with repo paths scrubbed, is in
`worker/tests/negative-control.log`, recorded against the M1 commit.

| control | break (in the copy only) | went red with |
|---|---|---|
| `negative:idempotent` | `0001_init.sql`: `id TEXT PRIMARY KEY` → `id TEXT NOT NULL`; `index.js`: the stored-id lookup `WHERE id = ?1` → `WHERE id = ?1 AND 0` | `rows stored with this id: [...] actual: 2, expected: 1` (the resend aimed at another visit became a second row) |
| `negative:time` | `rules.js`: `return { atMs: at, adjusted: false }` → `return { atMs: now, … }` | `actual: '2026-09-14T12:19:12.000Z', expected: '2026-09-14T11:34:12.000Z'` |
| `negative:familynote` | `index.js`: `note: checkOut && note && note.shareable ? note.text : null` → without `note.shareable` | `the family answer contains "Ate well, talked about the SAMPLE garden."` |
| `negative:alert` | `rules.js`: `nowMs >= start + LATE_MS` → `nowMs > start + LATE_MS` | the boundary test fails at 15:00.000 |
| `negative:travelgap` | `conflicts.js`: `Math.ceil(metres * 1.3 / 1000)` → `Math.ceil(metres / 1000)` | hand-built week (needed 11, not 14), boundary (no conflict at gap = needed − 1), SAMPLE week (needed 30, not 38) |

One control was tightened during the build. `negative:idempotent` first went red only on the status (409 instead of 200), before
its row count was checked. The test now counts the stored rows before looking at any status, so the red output shows the
duplicate row itself.

The unit test "wrangler.toml never sets TEST_MODE" checks its own pattern against a known-bad `[vars]` line in the same run.

### Calls made where the contract is silent or disagrees with itself (for the lead)

1. **`availability_label` order.** The rule says groups go "in weekday order of each group's first day", but the example lists
   `"Sat–Sun 8:00 AM – 4:00 PM, Fri 12:00 PM – 8:00 PM"`. Following the rule, Terry O. reads `"Fri 12:00 PM – 8:00 PM, Sat–Sun
   8:00 AM – 4:00 PM"`. Please confirm, or change the rule.
2. **The brief's "check-in → 201 with `location: near` and `distance_m`"** contradicts API.md: the worker view carries
   `location_label` but neither `location` nor `distance_m`. The 201 follows API.md (a test asserts its exact keys). `location:
   near` and `distance_m` are asserted on the office day view of the same event.
3. **Messages the contract does not give** (all plain English, 400 with the field): more than 12 tasks "Keep to 12 care tasks or
   fewer."; more than 7 patterns "Keep to 7 visit patterns or fewer."; more than 4 family contacts "Keep to 4 family contacts
   or fewer."; relationship over 30 "Keep the relationship under 30 characters."; worker `active` "Say whether this worker is
   active."; visit `start`/`end` malformed "Pick a start time." / "Pick an end time."; `shareable` not a boolean "Say whether the
   family can see this note."; event `id`/`kind` "That didn't come through. Reload and try again.", `at` "The time didn't come
   through. Reload and try again.", `location` "The location didn't come through. Check in again without it.".
   Refusing to cancel a started visit says "This visit has started, so it can't be cancelled.". Office 401 without `field` is
   "Sign in to continue." (no token) or "Your session has ended. Sign in again." (unknown or expired). Unknown ids give "That
   client isn't on the list." / "That worker isn't on the list." / "That visit isn't on the schedule.".
4. **Order of event answers.** API.md orders: stored id, then validation, then the 409s. It does not place the 404 "not on your
   list". The Worker checks it after validation and before the 409s.
5. **The 409 `already_checked_in` / `already_checked_out` `event`** uses the worker-view shape (`id, at, at_label,
   location_label, source`), because only the phone calls that route.
6. **An inactive worker's key answers 401**, the same as an unknown key.
7. **Worker history (`visit_workers`)** records the old and new worker whenever the office changes a visit's worker, the worker
   of a one-off visit, and the workers taken off visits when a worker is deactivated. It does not record on generation: the
   current worker is always allowed directly.
8. **A pattern day whose start or end falls in the spring-forward gap** generates no visit that day. There is no SAMPLE pattern
   between 2:00 and 3:00 AM.
9. **`PUT visits/:id`** accepts keeping the visit's current worker even if that worker is now inactive. Assigning a different
   worker requires an active one.
10. **Wrong PINs and unknown family keys are already recorded** in `signin_attempts` / `family_lookups`. The 429 guards that read
    those rows are M2, as the plan says.

### Left undone (M2, waiting for the lead's prompt)

`PUT pin`, `GET/PUT office agency`, `new-link` for clients and workers, `PUT visits/:id/times`, the four reports and their CSV,
the PIN and family-link rate guards, `POST /api/test/seed {scenario: "demo"}`, and negative controls (f)–(j).

### Needed from another slice

Nothing. For hc2, when calling M1: every `/api/*` answer in the tests carries `Cache-Control: no-store`, `Referrer-Policy:
no-referrer` and `X-Content-Type-Options: nosniff`; the event answers use the worker-view shapes of API.md.

## Lead review of M1 (merged f26d2f2)

- Calls 1-5 and 7-10: adopted (API.md clarifications 3-4). **DONE**
- Call 6 (an inactive worker's key answers 401): **REJECTED** by the lead (clarification 5). Fixed in M2: deactivating a worker
  never stops their link, and only "New link" does. See the M2 test and control (k) below.
- Clarification 3 adds `kind` and `visit_id` to the worker-view event. Added in M2, and the event 201 test now checks the exact
  key set. **DONE**

## M2 (2026-09-14, rebased on main 4c91521)

### What was built: DONE

- **Clarification 5.** `requireWorker` no longer asks for `active = 1`. An inactive worker's `GET /api/worker/visits` answers 200
  with whatever is still assigned. A visit that already has events stays theirs when they are deactivated.
- **Remaining routes:**
  - `PUT /api/office/pin`: 4–8 digits; a wrong `current` is 401 field `current`, the session stays, and it counts toward the guard.
  - `GET/PUT /api/office/agency`: name 1–80 with the health-card guard; phone normalised; `sample` follows the name.
  - `POST /api/office/clients/:id/new-link` and `workers/:id/new-link`: a new 144-bit key; the old one stops at once.
  - `PUT /api/office/visits/:id/times`: every non-null value voids the effective event of that kind and stores a `source: "office"`
    event for the visit's worker (`location: not_shared` on a check-in, the reason in `correction_reason`). The version bump, the
    voids and the inserts are one D1 batch, and `SELECT CASE WHEN changes() = 0 THEN json('stale') …` aborts the whole batch when
    another screen saved first.
  - The four reports and their CSV, in `src/reports.js` (pure). The Worker fetches every visit dated in the period or checked in
    within a day of it; the pure code then picks by the check-in's NL date. Missed-visit reports generate the period's visits
    first, so a week nobody opened still reports.
- **Guards.** PIN: `COUNT(*)` of `signin_attempts` for the IP inside 15 minutes ≥ 5 → 429 before the PIN is checked, so the
  right PIN is refused too. Family: `family_lookups` inside 10 minutes ≥ 30 → 429 before the key is looked up, so known keys are
  refused too.
- **Demo scenario** (`src/demo.js`, `POST /api/test/seed {scenario: "demo"}`): the base, then last week and this week before
  today all done. Check-in is 0–9 min after the start and check-out 0–9 min either side of the end, both from the visit id;
  the lowest id is far, the next not shared, the rest near; notes on even ids, shareable on multiples of 6. Last Friday's Edna F.
  visit goes to Chris M. Today, every visit past start + 30 min is done except the latest one, left missed (a Gladys W. one-off
  45 min ago when none has passed yet). One visit in progress, or a Walter G. one-off from 10 min ago, is checked in. A Frank H.
  one-off for Sam R. starts 20 min ago (late). A one-off for Chris M. overlaps his next visit later this week, or two overlapping
  one-offs tomorrow. Event ids are derived from visit ids, so the same now gives the same data. The answer adds `office_url`.

### Verified: DONE

`npm test` at `a5706a7`: **23/23 unit, 62/62 API** (48 M1 + 14 M2), nothing skipped. The M2 tests:
- **worker key:** check in, deactivate, then the saved check-out with its own id is 201 with 56 min worked. `GET visits` still
  answers 200. After New link the old key is 401 and the new one 200.
- **new link:** the old worker key is 401 and the old family key 404; the new ones work; unknown ids 404; no token 401.
- **office agency** (shape, refusals, `sample` flips when SAMPLE leaves the name) and **office PIN** (400 `new`, 401 `current`
  keeps the session, the new PIN signs in and the old one does not).
- **rate guards:** 5 wrong → 429 for the right PIN; another IP is fine. Still 429 at 14:59 after, 200 at 15:01. Four wrong
  sign-ins plus one wrong `current` → 429. 30 unknown family keys → 429 for a known key from that IP; another IP and 10:01
  later are fine.
- **fix times:**
  - Refusals: `check_in_at`, `reason`, a health-card reason, `check_out_at` not after check-in, too far from the visit, stale,
    no worker, a check-out without a check-in.
  - A missing check-out set by the office gives 58 min, `source: office`, the reason, and the version bumped.
  - The phone's later check-out with its own id is 409 `already_checked_out`.
  - Fixing the check-in too gives 61 min. `/api/test/events` still holds the voided phone event (3 rows, exactly that one
    voided), and payroll agrees.
- **payroll exactness:** 1:00:20 + 0:45:20 + 2:10:20 → worker 14 160 s, `"3.93"`, `"3 h 56 min"`. Per client, Bill 11 440 s is
  `"3.18"` and Ruby `"0.76"`. A second worker, and the total 17 760 s `"4.93"`, come from summed seconds. A check-in with no
  check-out is in `incomplete` and not in the hours. The whole answer is compared.
- **NL date of the check-in:** a check-in at 23:50 NDT Tuesday (already Wednesday in UTC; the test asserts that too) counts for
  Mon–Tue, and 00:10 Wednesday does not.
- **billing:** grouped by funder, with scheduled minutes, compared whole. Refusals: `to` before `from`, 63 days (62 allowed),
  missing `from`, no token.
- **missed:** Margaret checked in at 14:59 is not listed; Walter at exactly 15:00 is late (15). Ruby, cancelled, is excluded. A
  no-worker one-off is included with `worker_name: null`. Gladys at exactly start + 30 min is missed. A week nobody opened
  reports its 6 missed Monday visits.
- **mileage:** Sam taps Walter G. (Botwood) before Margaret P. and Frank H. (Grand Falls-Windsor), against the schedule. The
  legs are Walter→Margaret, Margaret→Frank. A worker with one check-in has no row. The whole answer is compared.
- **CSV:** payroll, billing and mileage compared byte for byte; missed by header and first row. Checked on all four:
  content type, filename, `no-store`, no BOM, CRLF on every line, a final CRLF. A name with a comma and a quote comes out as
  `"Kit ""K"" O'Brien, Jr. (SAMPLE)"`, and `=SUM(A1) (SAMPLE)` as `'=SUM(A1) (SAMPLE)`.
- **demo seed**, at Wed 11:00 AM and at Wed 6:10 AM (before any visit has started):
  - today: exactly one missed, a late Sam R. one-off, exactly one checked in, and every other visit past start + 30 min done;
  - this week: a Chris M. double-booking; last week: all 36 visits done, Friday's Edna F. with Chris M.;
  - check-ins 0–9 min after the start; exactly one far and one not shared; notes on a third to two thirds of visits, some
    shareable and some not;
  - payroll for the last 14 days is non-empty;
  - seeding again at the same now gives an identical `GET day`.

### Negative controls: DONE

`npm run negative` runs all eleven, each red after its unbroken copy passed. The whole log was re-recorded against `a5706a7`
(`worker/tests/negative-control.log`, repo paths scrubbed and checked for machine paths).

| control | break (copy only) | red with |
|---|---|---|
| (f) `negative:payrollround` | `reports.js`: `hours: decimalHours(seconds)` → sum of each visit's rounded hundredths | `hours: '3.94'` for `'3.93'`, total `'4.94'` for `'4.93'` |
| (g) `negative:mileageorder` | `reports.js`: legs sorted by `a.at` → by `a.starts_at` | legs Margaret→Walter→Frank, `metres: 59379` for `30775` |
| (h) `negative:csvguard` | `reports.js`: the line `if (FORMULA.test(s)) s = \`'${s}\`` removed | `Sam R. (SAMPLE),=SUM(A1) (SAMPLE),…` for `'=SUM(A1) (SAMPLE)` |
| (i) `negative:missedcancel` | `reports.js`: `!v.cancelled &&` removed from the missed branch | an extra row `Ruby T. (SAMPLE)` `what: 'missed'` (6 rows for 5) |
| (j) `negative:ndtdate` | `reports.js`: `const date = nlDate(atIso)` → `atIso.slice(0, 10)` | Mon–Tue payroll `[0, 0]` for `[1, 480]` |
| (k) `negative:inactivekey` | `index.js`: worker key lookup gains `AND active = 1` | `GET /api/worker/visits` for the deactivated worker 401 for 200 |

Controls (a) to (e) from M1 were re-run in the same log against `a5706a7`, still red.

### Calls made in M2 (for the lead)

1. **Messages the contract does not give:** report `from` missing or bad "Pick a start date.", `to` "Pick an end date.";
   fix-times value not a date "Type the time as a date and a time."; a check-out set with no check-in "Set the check-in time
   first." (field `check_out_at`); unknown seed scenario 400 field `scenario`.
2. **`PUT /api/office/pin` checks in this order:** guard (429), then `new` (400), then `current` (401). A malformed new PIN
   never costs a try.
3. **An office check-in or check-out is stored for the visit's current worker**, even when the phone's check-in came from a
   worker assigned earlier. Payroll follows the effective check-in's worker, as the contract says.
4. **CSV `Date` columns** (missed, mileage) use `YYYY-MM-DD`, which sorts in a spreadsheet. The billing funder and `Total` rows
   carry the summed scheduled hours.
5. **Names sort by lower-cased code units**, then id, the same rule as SQLite's `NOCASE`. Locale collation can differ between
   Node and workerd, and a report's order must not.
6. **The demo** gives an unassigned visit shown as done (only last Friday's Edna F. visit, unless the demo runs on a Saturday or
   Sunday) to Chris M., so "every visit before today is done" holds.

## Read-only review of hc2's pages on main after hc1 M2 (main at 4c91521)

Scope: `git log main -- app/` shows only hc2 M1 (`4379983`). Reviewed: `app/public/api.js`, `w/queue.js`, `w/app.js`, `w/sw.js`,
`f/app.js`, and the heads of `w/index.html` and `f/index.html`. `office/index.html` on main is a placeholder that calls only
`GET /api/agency`; the office pages of hc2's M2 are not on main yet, so none of their API calls could be checked. Nothing in
`app/**` was edited. Each finding has a tag, a place and a scenario that fails.

1. **DATA LOSS** · `app/public/w/queue.js:98` with `app/public/api.js:17-20`. Any 200/201 deletes the queued event, and nothing
   checks the body is the Worker's answer for that event. `fetch` follows redirects, and a body that is not JSON becomes
   `data: null` with the status kept.
   Scenario: a worker's phone joins a café or community Wi-Fi with a captive portal. The POST to `/api/worker/events` is
   redirected to the portal's login page, which answers 200 HTML. `confirmSent` deletes the check-out, the strip says "All
   sent", and the Worker never saw it: the visit shows "Checked in", and payroll has no hours for it.
   Suggested fix: treat a 200/201 as sent only when `res.data?.event?.id` equals the queued `event.id`, lower-cased. Anything
   else is `retry`. Optionally add `redirect: 'error'` for the event POST.
2. **DATA LOSS** (contract; involves hc1's `updateClient` in `worker/src/index.js`, the `doomed` query). Saving a changed pattern
   deletes that client's future visits with no events *on the server*, but a phone may still hold a queued check-in for one.
   `queue.js:99` then moves it to "Not accepted by the office", with the server's "That visit isn't on your list.". The
   worked time exists only in `refused`, and the Remove button deletes it.
   Scenario: the worker taps Check in at 8:55 for a 9:00 visit with no signal. At 8:57 the office moves the client's pattern to
   9:15. The phone syncs at 9:30 and gets a 404. Deactivating the client does the same.
   Needs a lead decision. Options: the Worker keeps a deleted visit as a tombstone that still accepts events; or the rebuild
   leaves visits starting within the next 12 hours alone; or the refused item offers "Ask the office to fix it" with the tapped
   times kept, so the office can re-enter them with Fix times.
3. **PAYROLL / DATA LOSS** (contract; `app/public/w/app.js:350-353` and `queue.js:99`). The whole check-out, not just the note, is
   refused when the note trips the health-card guard. Twelve or more digits separated by single spaces or dashes count, so two
   phone numbers in a row do.
   Scenario: the note says "Daughter called from 709 555 0152 709 555 0153". The Worker answers 400 field `note`, the check-out
   lands in "Not accepted by the office", and the visit has no check-out, so no payroll hours. The page gives no warning before
   "Yes, check out".
   Suggested fix: the page runs the same `/\d(?:[ -]?\d){11,}/` check on the note while typing and blocks the confirm with
   the API's words, or the lead lets the Worker store the check-out and refuse only the note.
4. **PAYROLL** · `app/public/w/app.js:75` (and `:221`). `load()` always asks for the server's today. On a visit from 11:15 PM to
   11:59 PM, if the worker checks out after midnight or reopens the page after midnight, the list reloads with the next day's
   visits. The checked-in visit is gone from the page, so there is no Check out button. The check-out is never recorded
   until the office uses Fix times.
   Suggested fix: keep asking for the date of any visit that is checked in (on the server or in the queue) and not yet checked
   out; `GET /api/worker/visits?date=` accepts yesterday.
5. **PRIVACY** · `app/public/w/app.js:31-38` and `:80-83`. The saved list, including entry notes and key-safe codes, stays in
   `localStorage`. It is pruned only after a *successful* load, so a phone whose key answers 401 never clears it.
   Scenario: a worker loses their phone and the office presses New link. The page now says "This link doesn't work any more", but
   `hcv:visits:<worker id>:<date>` still holds every client's key-safe code, indefinitely, for anyone with the phone and
   browser devtools.
   Suggested fix: on a 401 for the page's own key, remove the `hcv:visits:*` entries saved under that key (keep the queue,
   which API.md clarification 2 requires).
6. **PAYROLL** (low) · `app/public/w/app.js:121-133` and `:326`. `view()` builds a visit's state from the answer and `queue`
   only, not `refused`. After a check-in is refused, the card goes back to "Check in".
   Scenario: a check-in is refused because the location failed validation. The worker taps Check in again 40 minutes later, and
   that check-in lands with the later time: 40 minutes lost from payroll unless the office notices.
   Suggested fix: show a refused check-in on the card ("Not accepted, tapped 9:04 AM, call the office") rather than offering a
   fresh check-in silently.
7. **OTHER** · `app/public/w/sw.js:3-10`. The page files are served cache-first under a hand-bumped `VERSION`, and `addAll` fails
   the whole install if any listed file is missing.
   Scenario: a fix to `queue.js` is deployed without bumping `VERSION`. Installed phones keep running the old queue until the
   cache is cleared, and so do the finding-1 and finding-3 fixes. Removing the mock files from a deploy breaks the service
   worker's install, so the page no longer opens offline.
   Suggested fix: derive `VERSION` from a build stamp, or let the page check a version endpoint.

**Checked and in line with docs/API.md:**
- The queue writes to IndexedDB before any network call.
- The two stores `queue` and `refused` are used as specified.
- 400/404/409 go to refused with the server's `error`; 401 is held with the rekey rule; 429/5xx/network/timeout retry with
  backoff.
- A visit's later event waits behind its earlier one.
- `at` is taken at the tap for check-in (before location) and at "Yes, check out".
- The tasks snapshot carries `task_id, kind, label, done`; the note is trimmed, ≤ 2 lines and ≤ 200 characters.
- Location `{ lat, lng, accuracy_m }` or null, 8 s, Skip.
- The worker key goes in `X-Worker-Key`; labels use the agency time zone; the service worker never intercepts `/api/*`.
- `no-referrer` meta is on `/w/` and `/f/`; the family page renders only allow-listed fields and stops refreshing on 404.
- Both pages use the new `kind`/`visit_id` event fields only through the queue item, so clarification 3 needs no page change.

## Lead review of M2 (merged 249b8ec)

- M2 calls 1-6: adopted (API.md clarification 13). **DONE**
- Review findings R1-R7: all adopted (clarifications 6-12, DECISIONS 27-31). R2 and R3 decided by the lead: soft-remove
  (clarification 7), and a note or task list never costs a check-out (clarification 8). Both built in M3, on the Worker side.
  **DONE**

## M3 (2026-09-14, rebased on main 56bc0f5)

### What was built: DONE

- **Clarification 7, soft-remove.** `migrations/0003_visit_removed.sql` adds `visits.removed_at` and `visits.removed_reason`.
  - **What soft-removes.** `PUT clients/:id` no longer deletes: a changed or ended pattern's future visits with no events get
    `removed_at` = now. The reason is "Removed when the visit pattern changed." or, for a deactivated client, "Removed when the
    client was made inactive.". `rebuilt_visits` counts them, and the worker history rows stay.
  - **Where they are hidden.** A shared `VISIBLE` predicate (not removed, or has an effective event) is part of every visit
    load: week, day, the office edits (404), the phone list and the family answer. Report rows use the same rule with their
    joined events. Conflicts are computed from the week's visible visits; missed uses the report rows.
  - **Generation.** The removed row still holds its `(pattern_id, pattern_date)`, and its pattern has ended, so nothing is
    generated again.
  - **Late events.** `POST /api/worker/events` looks the visit up without the filter, so a removed visit still accepts events,
    and the phone's own answer includes it. Once visited it loads with `cancelled` = true, `cancel_reason` = the removal
    reason and `visited_after_cancel` = true, and it counts for payroll, billing and mileage.
  - **Restore.** `restore` on a removed visit that was visited is 409 `bad_state` "This visit was removed from the schedule, so
    it can't be restored.". A new message, for the lead.
- **Clarification 8.** The task list and the note are checked separately from the check-out. A refused one is dropped (tasks
  `[]`, no note) and the 201 adds `note_refused` / `tasks_refused` with the rule's message. A duplicate resend answers as usual.
  The M1 input-refusal test now expects a good two-line note to be stored; the refused cases moved to the new test.

### Verified: DONE

`npm test` at `5183d3e`: **23/23 unit, 66/66 API** (62 before + 4), nothing skipped. New tests:
- **check-out:** six check-outs of exactly 3 600 s each. Notes: 3 lines, 201 characters, two phone numbers in a row (health
  guard) and a number instead of a string. Task lists: missing, and a medication label together with a health-card note. Each
  is 201 with the expected `note_refused` / `tasks_refused`, `worked_seconds` 3 600, the office note null (or kept when only
  the tasks were refused), `tasks_done` [], and a resend of the same id 200 `duplicate`.
- **soft-remove, late check-in:** Alex taps Check in at 8:55 for Walter G.'s Wednesday 9:00 visit. The office moves the pattern
  to 10:00 at 8:57 (3 visits soft-removed), and the phone's POST arrives at 9:30: 201 with `at` = 8:55. The day board shows the
  9:00 visit checked in, cancelled, "Removed when the visit pattern changed.", visited, next to the new 10:00 visit; the phone
  list shows both. After the check-out, Wednesday payroll and billing count 3 600 s for Alex and missed does not list it. The
  removed Thursday visit answers 404 to move, cancel and fix times.
- **soft-remove, invisible:** after the change, the removed Wednesday–Friday 9:00 visit ids appear in none of the raw week, day
  (×3), phone, family and missed answers. The week shows Mon 9:00, Tue 9:00, Wed–Fri 10:00; missed lists only the 10:00 visits;
  the family week matches.
- **soft-remove, deactivated client:** the week keeps only Mon and Tue, Thursday's day board and Wed–Fri missed have no Walter.
  A late check-in on the removed Wednesday visit is 201 and shows "Removed when the client was made inactive.", visited.

### Negative controls: DONE

`npm run negative` runs all thirteen, (a)-(m), each red after its unbroken copy passed. The log was re-recorded against
`5183d3e` and checked for machine paths.

| control | break (copy only) | red with |
|---|---|---|
| (l) `negative:rebuilddelete` | `index.js`: the soft-remove `UPDATE visits SET removed_at = …` → `DELETE FROM visits WHERE id IN (…)` | the 8:55 check-in answers 404 `{"error":"That visit isn't on your list."}` instead of 201 |
| (m) `negative:noteblocks` | `index.js`: `out.note_refused = e.body.error` → `throw e` | `Bill 2026-09-14: {"error":"Keep the note to two short lines.","code":"bad_request","field":"note"}` instead of 201 |

(a)-(k) are unchanged and still red at `5183d3e`.

### Left undone / next

Waiting for the lead's prompt for the read-only review of hc2's office pages once they are on main.

## Early review of hc2 office pages (rig/hc2 @ 7bbd204)

Read-only, from `git show 7bbd204:<path>` and `git diff main...7bbd204 -- app/`; hc2's worktree was not opened and nothing in
`app/**` was edited. `38ff6d5` (named in the prompt) is an earlier "part A" commit that is not on `rig/hc2`. Its branch head
`7bbd204` ("M2 part B: suite green against the real Worker") replaces it, so this review is of `7bbd204`.
Reviewed:
- `app/public/office/{app,core,board,sheet,week,clients,workers}.js`, `office/index.html`, `app/public/rules.js`;
- the `w/app.js` diff;
- `app/tests/{helpers,start-worker}.mjs`, `app/playwright.config.mjs` and all seven specs.
Checked against docs/API.md including clarifications 1-14.

### Office pages: calls and answers in line with the contract

- **Session:** `office()` in `core.js:18-31` sends the Bearer token and treats a 401 without `field` as a lost session (clears the
  token, back to sign-in). Every view skips its own error text on 401. Sign-in goes through `request()`, so its 401 `field: "pin"`
  and a 429 are shown by the PIN field and never end a session.
- **Late/missed rule:** `app/public/rules.js:5-11` gives exactly the Worker's boundaries (none below start + 15:00.000, late
  from 15:00.000, missed from 30:00.000). `board.js` recomputes it from `Date.now()` after every load, on a 15 s reload, and with a
  timer at the next 15- or 30-minute mark. It reads only fields the day answer has (`id, time_label, client_name, worker_name,
  worker_phone, status, status_label, late_label, visited_after_cancel, cancelled, starts_at, check_in`).
- **Week:** it reads `week_start, week_label, days, workers[].hours_label, visits, conflicts[].kind/label/severity/date/message/
  visit_ids, distance_note`. It derives chip severity from `visit_ids` instead of `conflict_kinds`, which is equivalent.
  Drags and "Assign to" send `worker_id, date, start, end, version`; a `stale` or `bad_state` answer shows the API's words.
- **Edit sheet:** `stale` lands in the `_` slot with "This visit was changed on another screen. Reload and try again.". Cancel,
  restore (including clarification 14's 409) and the note toggle show the API's words, and the toggle reverts on failure.
- **Client and worker forms:** they send the contract's field names, and every validation `field` the Worker can return has a
  `data-error-for` slot (client `name, address, lat, zone_id, entry_notes, funder_id, active, tasks, patterns, family_contacts`;
  worker `name, phone, zone_ids, availability, max_week_minutes`; worker `active` falls back to `_`). Unchanged patterns keep
  their `id` with days sorted, so a save that doesn't touch visit times rebuilds nothing. The rebuild warning shows on existing
  clients.
- **Escaping:** all server text goes through `esc()` or `textContent`; no unescaped HTML sink was found. Leaflet titles are
  attributes.

### Findings

1. **SECURITY** · `app/public/office/workers.js:14` (and `clients.js:66`). Both lists call `GET /api/office/workers` and
   `GET /api/office/clients` without `?all=1`, so an inactive worker or client disappears from the office for good.
   - Clarification 5 makes "New link" the only way to stop a former worker's phone, and that button (M3) will live on the
     worker form, which an inactive worker can no longer be opened from.
   - Scenario: a worker is let go; the office unticks "Active worker" and saves. The worker vanishes from the list. Their link
     still answers 200, and the office has no screen to make a new link or reactivate them.
   - The same happens to a client made inactive by mistake: it can't be reopened and its family link can't be replaced.
   - Suggested fix: list with `?all=1`, show inactive entries under an "Inactive" heading, and keep New link on them.
2. **OTHER (worked-time bookkeeping)** · `app/public/office/sheet.js:5,11-12,57`. The sheet's worker list is active workers
   only, so a visit whose worker is now inactive has no matching option. The select falls back to "No worker", and "Save
   changes" sends `worker_id: null`.
   - Scenario: Terry O. is deactivated on Wednesday. His Monday visit had no check-in, so it keeps him (only future visits are
     unassigned). The office opens it to shorten the end time and saves.
   - The visit is silently unassigned, even though clarification 4 lets `PUT` keep an inactive current worker. It also drops
     out of the missed report's worker column.
   - Suggested fix: add the current worker as an option ("Terry O. (SAMPLE), inactive") when missing.
3. **OTHER** · `app/public/office/week.js:62,70,83`. The grid and the day view build their rows from `data.workers` (active
   workers) plus "No worker", so a visit assigned to an inactive worker is in `data.visits` but on no row.
   - Scenario: after Terry O. is deactivated mid-week, his earlier missed visits are invisible in the planner, yet an
     over-hours or availability conflict can still name them in the list above the grid. The office can't open or reassign
     them from the Week tab.
   - Suggested fix: add a row for every worker who appears in `visits`, marked inactive.
4. **SECURITY (low)** · `app/public/office/app.js:98-101` at `7bbd204`. Sign out clears the local token even when
   `POST /api/office/signout` never reached the Worker (status 0), so the server session stays valid for 14 days.
   - Scenario: at a shared office computer with no connection, the coordinator presses "Sign out" and walks away. The screen
     says "Signed out.", but the token copied to another device (or still in a browser backup) keeps working until it expires.
   - Suggested fix: when signout does not answer 200, say "Signed out on this computer. The session could not be closed on the
     server; sign in and out again when the connection is back."
5. **OTHER** · `app/public/office/app.js:71-86` at `7bbd204` (`agencyFromM1Routes`). When `GET /api/office/agency` answers 404,
   the page builds an agency from `clients?all=1` and `workers?all=1`, with `office.label: ''` and zones and funders only as far
   as clients and workers name them. The route exists since hc1 M2, so this is dead code that can mask a real 404.
   - Scenario: a deploy whose router loses `/api/office/agency` still "works". The client form's zone and funder selects are
     missing any zone or funder nobody uses yet, and the SAMPLE header comes from the public answer. Nothing tells the office
     that the Worker is wrong.
   - Suggested fix: remove the fallback now that the route is merged.
6. **DATA LOSS** · `app/public/w/queue.js:98` with `app/public/api.js:17`, unchanged from main. **R1 is still present** in
   hc2's newest commit: any 200/201 deletes the item, and the fetch follows redirects, so clarification 6 is not implemented
   yet. No spec covers it, so the whole e2e suite passes with this defect. The captive-portal scenario is in the M2 review above.
7. **PAYROLL** · `app/public/w/app.js:75`. **R4 is still present**: `load()` only asks for today, so clarification 9 ("Still open
   from yesterday") is not implemented.
8. **PRIVACY** · `app/public/w/app.js:80-83`. **R5 is still present**: a 401 on the page's own key keeps every `hcv:visits:*` entry
   (entry notes and key-safe codes) and every draft, so clarification 10 is not implemented.
9. **PAYROLL (low)** · `app/public/w/app.js:121-122,338`. **R6 is still present**: `view()` reads only `queue`, so a refused
   check-in's card offers a fresh "Check in", and clarification 11 is not implemented. Clarification 8's "The note wasn't saved"
   message is not shown either (nothing reads `note_refused` or `tasks_refused`), and the service worker is still cache-first
   (clarification 12). All three are expected in hc2's M3; listed so they are not lost.

### Specs: what each measures, and a break that would slip through

- **`board.spec.mjs`:** measures what PLAN.md asks (page clock at 09:14:59 → 09:15:00 late with the late token → 09:29:59 late →
  09:30:00 missed with the `tel:` link → done after a check-in; the cancelled visit stays none). A page rule of `<=` at either
  boundary goes red, because `runFor` lands exactly on 15:00.000 and 30:00.000. **Slips through:** a board that stops recomputing
  after the first paint but keeps its 15 s reload, since the Worker's `X-Test-Now` is pinned at 09:14:59 and the page's own rule
  is what turns the row. That is fine and intended. No material gap found.
- **`office.spec.mjs`:**
  1. **OTHER, slips through:** a client form that ignores the pattern's worker select (sends `worker_id: null`). The spec counts
     chips by client name in any row (`office.spec.mjs:56-64`), so unassigned chips in "No worker" still pass. Assert the chip
     sits in Alex B.'s row.
  2. The worker test asserts only 201 and the phone in the list. A form that sends the wrong `availability` (the default Mon–Fri
     8–4 instead of what was ticked) passes; the spec never ticks a day, so it can't tell.
- **`planner.spec.mjs`:**
  1. Strong on the drag (server state after a reload) and on `stale` (the 409 response plus the words).
  2. **OTHER, slips through:** "both chips edged" is asserted only as `data-conflict="problem"` (`planner.spec.mjs:70,97`). A CSS
     change that drops the red edge, or the word "Conflict", passes. Assert the computed border colour or the `.chip-flag` text.
  3. A page that re-sent the edit with the new version after a 409 would also pass, because only the first PUT is awaited.
- **`family.spec.mjs`:**
  1. Good on privacy: it checks `page.content()` for the note before sharing, which is what negative control (d) needs.
  2. **OTHER, slips through:** the phone's clock is `setFixedTime(NOW)` for both taps, so check-in and check-out are both
     10:30 AM and the status is "Arrived 10:30 AM, left 10:30 AM" (`family.spec.mjs:37`). A Worker or page that shows the
     check-in time as "left" passes. Advance the page clock between the taps (as `offline.spec` does) and assert different
     labels.
- **`worker.spec.mjs`:**
  1. **PAYROLL, slips through:** the same fixed clock gives "Done 10:30 AM – 10:30 AM" (`worker.spec.mjs:59`). The office check
     (`:63-64`) asserts `check_in.at` but neither `check_out.at` nor `worked_seconds`, so a page that stamps the check-out with
     the check-in's time passes this spec. `offline.spec` would catch it only for the queued path.
  2. The location-denied test relies on the browser refusing an unanswered permission; the new 10 s fallback in `w/app.js`
     covers WebKit.
- **`offline.spec.mjs`:**
  1. The main test is strong: T and T + 1:32:10 to the second, 5 530 s, `at_adjusted` false, `received_at` at signal-back, the
     reload in Chromium with its WebKit reason. The 500-once test proves both stay queued and send on the next try, and the
     refused test proves the 409 words and a single stored check-out.
  2. **DATA LOSS, slips through:** a queue that deletes on any 200 (R1, still in `queue.js:98`). Add a step where `page.route`
     fulfils the event POST once with `200 text/html` (a captive portal) and assert the item is still queued and later reaches
     `/api/test/events`.
- **`targets.spec.mjs`:** measures sizes and hit-tests on the worker page and sheet, the badge on all four pages, no sideways
  scroll, and contrast. Contrast covers the late and missed row text but not the "Call … : 709-555-…" link on those rows.
  Minor: a link colour on amber below 4.5 : 1 passes.
- **`helpers.mjs`:**
  - The network guard routes `tile.openstreetmap.org` to a local PNG and aborts and records any other non-127.0.0.1 host, so the
    guard can fail.
  - `tap()` hit-tests with `elementFromPoint` and accounts for the sticky strip.
  - The only `evaluate` calls read or scroll.
  - `start-worker.mjs` runs `--local` with `TEST_MODE:1` and an explicit inspector port.
  - No problems found.

## Review of hc2 M2c (9ac55e7)

Read-only, from `git show 9ac55e7:<path>` and `git diff 866ee71 9ac55e7 -- app/` (merged into main as `0c33594`); hc2's
worktree was not opened and nothing in `app/**` was edited. Checked against docs/API.md clarifications 6, 8-12 and 15.

### What is correct

- **Clarification 6** (`w/queue.js:89-111`, `api.js:7-13,29-31`).
  - A 200/201 is "sent" only when `data.event.id` equals the queued id, both lower-cased. The Worker's 201, its 200
    `duplicate` answer (which carries the stored event, voided or not) and a resend aimed at another visit all name that same
    id, so a real resend is still confirmed. A login page's 200 HTML (no JSON, `data: null`) is a retry.
  - `redirect: 'error'` is set on the event POST only. Fetch's `redirect` option is supported in WebKit/Safari, and a redirect
    becomes a thrown TypeError, which `post()` turns into a retry.
- **Clarification 8 (typing check)** (`w/app.js:104-110`). It matches the Worker exactly: CR/LF normalised, trimmed, over 200
  code points or over 2 lines → "Keep the note to two short lines.", then `/\d(?:[ -]?\d){11,}/` → "Don't put health card
  numbers in this app.". Medication wording is checked by the Worker on task labels only, and the page sends the server's labels.
- **Clarification 10, other keys** (`w/app.js:66-80`). A refused key removes only the saved lists whose `key` is this page's
  key (and damaged entries); another link's saved list stays. The queue and refused stores stay.
- **Clarification 11** (`w/app.js:197-199,248-254`). After a later accepted check-in the visit reads "Checked in …" (the
  server's or the queued check-in wins over the refused one); only the notice remains (finding 8).
- **Clarification 12, `/api/*`** (`w/sw.js:42-49`). The service worker never touches `/api/*`: it returns early for non-GET,
  other origins and `/api/`, and handles only the listed files.
- **Clarification 15** (`office/workers.js`, `clients.js`, `sheet.js`, `week.js`, `app.js`).
  - Workers and Clients load with `?all=1` and list inactive entries under "Inactive"; the client map shows active pins only.
  - The sheet adds "<name> (inactive)" as the selected option.
  - The grid and the 390 day view add an inactive row for every worker named on a visit, and "Assign to" keeps the inactive
    current worker selected.
  - The `agencyFromM1Routes` fallback is gone, and a sign-out that does not answer 200 shows the agreed message.

### Findings

1. **DATA LOSS** · `app/public/w/sw.js:35` (`if (res.ok && !res.redirected) await cache.put(path, res.clone())`) and
   `sw.js:14` (`cache.add` at install). Network-first caches any 200 for a page file, whatever it is.
   - **Scenario:** a worker's phone joins a café Wi-Fi with a transparent login page that answers every GET with 200 HTML, and
     the worker opens the page. `/w/`, `/w/app.js` and `/w/queue.js` are each cached as the login page.
   - Back in a dead zone, the page opens from the cache as the Wi-Fi login page. The module scripts are HTML, so the browser
     refuses to run them.
   - There is no Check in and no queue, so nothing tapped in the dead zone is saved, until the phone gets real signal and a
     good load.
   - The same happens when the service worker installs behind the portal: `cache.add` accepts a 200 too.
   - **Suggested fix:** only cache a response whose `Content-Type` matches the file (`text/html` for `/w/`, JavaScript for
     `.js`, `text/css` for `.css`, SVG for the icon). For `/w/`, also require a marker the real page carries (for example
     `<meta name="hcv-page" content="worker">`). Apply the same checks at install.
2. **PAYROLL** · `app/public/w/app.js:130-140`. `loadYesterday` runs only when a list for today exists: `if (S.answer) await
   loadYesterday(…)`. Clarification 9 says "whenever the saved lists or the queue hold a visit from yesterday … checked in and not
   checked out".
   - **Scenario:** Sam checks in at 11:20 PM and the page shows it. At 12:20 AM, in a dead zone, iOS has discarded the tab, and
     opening the link reloads the page with no signal.
   - No list for the new date is saved, so `S.answer` stays null and the page says "No saved list on this phone yet. Find signal
     once to load today's visits.".
   - "Still open from yesterday" never shows, although yesterday's saved list (and possibly the queue) hold the open visit. There
     is no Check out, so the 12:20 AM check-out time can't be tapped.
   - **Suggested fix:** in the catch, when there is no list for today, still call `loadYesterday(localDate(Date.now(), TZ),
     false)`, and render the yesterday section even when `S.answer` is null.
   - Missing proof: `proof-yesterday` covers only the case where the check-in reached the Worker and the phone had signal after
     midnight.
3. **PAYROLL** · `app/public/w/sw.js:28-40`. The 3-second abort also applies when there is no cached copy, so a slow network
   gives `Response.error()` instead of a page.
   - **Scenario:** iOS clears a web app's storage after days without use, or a `cache.put` failed for lack of space. The worker
     opens the link on one bar of signal where the page takes 5 s: every file is aborted at 3 s and the page doesn't open at all,
     though waiting would have worked.
   - **Suggested fix:** look the file up in the cache first. Race the network against 3 s only when there is a cached copy to
     fall back to; with no copy, wait for the network (or use a much longer limit).
4. **DATA LOSS** (worked-visit record) · `app/public/w/app.js:72`. A refused key deletes **every** `hcv:draft:*`, whichever link
   or worker the draft was typed under; drafts are keyed by visit id only (`w/app.js:82-84`). Clarification 10 says "every
   `hcv:draft:*`", so this follows the contract, but the contract is wrong for this case.
   - **Scenario:** after a lost-phone scare the office made Sam a new link, but the old one is still on Sam's home screen. Mid-visit,
     with tasks ticked and a note typed under the new link, Sam taps the old icon; it answers 401 and every draft is deleted.
   - Back on the new link, the ticks and note are gone. If Sam checks out without noticing, the Worker stores every task
     `done: false` and no note, and the office and family see nothing done.
   - **Suggested fix** (needs a lead decision): delete only drafts for visits in the lists saved under the refused key, or key
     drafts by worker id (`hcv:draft:<worker id>:<visit id>`).
5. **PAYROLL** (contract; `app/public/w/app.js:153-158` and hc1's `GET /api/worker/visits` date range). A check-in queued for a
   visit older than yesterday that is not checked out has no card anywhere. The page looks only at yesterday, and the Worker
   refuses `?date=` before yesterday.
   - **Scenario:** Saturday 10:05 PM, Alex checks in at Edna F.'s with no signal. The phone dies at the door, and Alex turns it
     on again on Monday morning.
   - The queue sends Saturday's check-in with its original time (inside the Worker's 7-day window), but no screen offers Check
     out. The visit stays "Checked in" and sits in payroll's `incomplete` until the office uses Fix times.
   - **Suggested fix** (needs a lead decision): let `GET /api/worker/visits?date=` go back 7 days, matching the original-time
     window (hc1's change), and have the page load every date for which the queue holds a check-in with no check-out; or show a
     queue-only "Still open" card built from the item's saved client name and time.
6. **PAYROLL** (contract, low) · `app/public/w/app.js:363,464`. A note the Worker would refuse disables "Yes, check out", and the
   check-out time is only taken when the button works.
   - **Scenario:** at the door Sam types a daughter's two phone numbers, sees the button greyed out, and drives on. Twenty minutes
     later, parked, Sam deletes the numbers and checks out: 20 extra minutes are recorded as worked.
   - **Suggested fix:** keep the warning but offer "Check out without the note". The Worker stores the check-out either way
     (clarification 8).
7. **OTHER** · `app/public/w/app.js:88-93`, with the Worker's duplicate answer (hc1). The "The note wasn't saved" notice comes
   only from a fresh 201. A resend's `200 duplicate` carries no `note_refused`, because the Worker does not store the refusal.
   - **Scenario:** a check-out whose note the Worker refused is stored, but the 201 is lost to the 30 s timeout on a weak
     connection. The resend answers `duplicate: true`, the item is confirmed with no notice, and the worker never learns the
     note was dropped.
   - The page's typing check makes this rare, but a note drafted before the update (or edited in another tab) can still get
     through.
   - **Suggested fix** (hc1, needs a lead decision): the Worker stores `note_refused` / `tasks_refused` on the check-out event and
     repeats them in the duplicate answer.
8. **OTHER** (low) · `app/public/w/app.js:198,248-254`. After a later accepted check-in, the refused check-in's "Not accepted by
   the office: check-in tapped at 9:04 AM" notice stays on the card next to "Checked in 9:40 AM", and it can only be cleared
   with Remove in the panel at the bottom.
   - **Scenario:** a worker reads the red notice as a problem with today's accepted check-in and phones the office, which may fix
     the accepted time back to 9:04.
   - **Suggested fix:** when the card has an accepted or queued check-in, word the notice as history ("An earlier check-in at
     9:04 AM wasn't accepted") and give it a dismiss button.
9. **OTHER** (low) · `app/public/office/app.js:100-103`. Sign out after the session has already expired answers 401. `office()`
   ends the session, then the handler shows "Signed out on this computer. The session couldn't be closed at the office. Sign in
   and out again when the connection is back."
   - **Scenario:** a coordinator comes back after 15 days and presses Sign out. The page says the session is still open at the
     office, though the Worker has none, and suggests signing in again to close it.
   - **Suggested fix:** treat a 401 like a 200 ("Signed out.").
10. **OTHER** (a window for R1 again) · `app/public/w/sw.js:28-40`. Each file is fetched on its own with its own 3 s limit, so one
   load can mix new and old files.
   - **Scenario:** a deploy fixes `queue.js`. On weak signal `app.js` arrives in 2.8 s but `queue.js` times out, so this load
     runs the new page with the cached **old** queue; if that copy predates clarification 6, any 200 counts as sent again.
   - The next good load corrects it.
   - **Suggested fix:** serve the page's modules with a version query (`/w/queue.js?v=…`) written into the cached page, so a
     page and its modules are always from the same deploy; or have `app.js` check a version exported by `queue.js` and reload.

### Controls and proofs: do they break the real fix, and go red at the assertion meant?

- **The harness** (`app/tests/negative-lib.mjs`):
  - copies `app/public` and `worker`, runs the named spec on the unbroken copy (VOID if red), applies a `replaceOnce` break (an
    anchor that must match exactly once), runs again, and exits 0 only if red;
  - keeps each copy's Playwright output inside the copy, and scrubs repo roots and the home folder from the log;
  - The committed log holds no machine paths (checked for a home folder and the user name). No run added by M2c is VOID. The word appears twice in the log, both in hc2's older notes (lines 186 and 366) about two earlier re-runs ("queue", "time") that went red for the wrong reason and were run again; those later runs are red at their intended assertions.
- **Control (f) `negative-portal.mjs`.** Honest. The break removes exactly the clarification 6 check (`&& answeredFor(res,
  item)`). The unbroken copy passed. The broken run went red at the intended assertion, "the check-in is still saved on the
  phone": the strip said "All sent" after the login page's 200 (`offline.spec.mjs:181`). Not proven:
  - `redirect: 'error'`: removing it stays green, because the page-level id check still catches the redirected 200. It is
    defence in depth, with no WebKit run;
  - finding 1: the same login page poisoning the service worker's cache is untested.
- **proof-yesterday.** Honest: red at the "Still open from yesterday" heading (`worker.spec.mjs:131`). It covers only the path
  where the check-in reached the Worker before midnight and the phone reloads with signal. **Slips through:** a break that
  drops `queuedIn` (a check-in still queued across midnight), and finding 2 (reload offline after midnight).
- **proof-forget.** Honest: both breaks go in together, and the red output lists the leftover draft and saved-list keys
  (`offline.spec.mjs:212`); the queue is asserted to stay. **Slips through:** a `forgetLink` that deletes every
  `hcv:visits:*` (another link's saved list included) passes, because the spec holds only one key. Finding 4 is untested.
- **proof-refusedcard.** Honest: red at the notice text (`offline.spec.mjs:246`). The scenario ends with the office's check-in
  on the card (status "in"). **Slips through:** a break of the `refusedIn ? 'refused'` status, meaning no "Check in again"
  button, stays green; that path has no assertion.
- **proof-notecheck.** Honest: red at the note error for two phone numbers (`worker.spec.mjs:151`). A break of the 200-character
  / 2-line rule stays green (low: `clampNote` already stops a third line and the 201st character while typing).
- **proof-notice.** Honest: red at "Checked out. The note wasn't saved: …" (`worker.spec.mjs:183`). The refused note is injected
  by rewriting the POST body in `page.route`, a fair stand-in for a note the page's check missed.
- **proof-inactive-list, -sheet, -row.** Honest. All three share one test but go red at their own assertions:
  - list: the "Inactive" heading, `office.spec.mjs:136`;
  - sheet: `#vs-worker` holds `""`, not Terry's id, `:152`;
  - row: the "(inactive)" grid row, `:145`.

  Each break leaves the steps before its own assertion working, so none goes red early. They run at 1280 only: the 390 day
  view's inactive group and its "Assign to" option have no proof.
- **Controls (a)-(e), re-run in this log.** Still red at their intended assertions:
  - queue: the saved-on-phone status;
  - time: `check_in.at` 13:00 against 15:12:10;
  - board: `data-alert` none at 09:15:00;
  - familynote: the note count;
  - overlay: the hit-test finds the transparent element (a follow-on `waitForResponse` error after it is only a consequence).

## Lead review of the M2c review (merged 8977d6a)

- Findings 1-10: all adopted as API.md clarification 16 (DECISIONS 37-40). Findings 5 and 7 needed Worker changes, done in M4.
  **DONE**

## M4 (2026-09-14, rebased on main 7fb81e0)

### What was built: DONE

- **Worker visits, 7 days back** (clarification 16, findings 2 and 5). `GET /api/worker/visits?date=` now accepts 7 days back to
  6 days ahead, matching the original-time window. Outside it: 400 field `date` "Pick a day from last week to next week.".
- **Refusals remembered** (clarification 16, finding 7). `migrations/0004_event_refusals.sql` adds `events.note_refused` and
  `events.tasks_refused`. The phone's check-out insert stores what `validateEvent` refused. `storedRefusals(stored)` repeats
  them in the `200 duplicate` answer. They are worker answers only: the office event view and the family view list their fields
  explicitly and never read these columns; only the test-only raw `GET /api/test/events` shows them.

### Verified: DONE

`npm test` at `2ac4e5a`: **23/23 unit, 66/66 API**, nothing skipped. Changed tests:
- **Worker visits:** with now on Monday Sep 14, 7 days back (Sep 7) is 200 with last Monday's two visits, and 6 days ahead
  (Sep 20) is 200. 8 days back (Sep 6) and 7 days ahead (Sep 21) are 400 field `date` with the new message.
- **Check-out:** each refused case's 201 carries its `note_refused` / `tasks_refused`. A resend of the same id answers `200
  duplicate: true` with the **same** fields. A new clean check-out (Friday, "A clean note. (SAMPLE)") answers 201 and its resend
  has neither field. The raw week, five day boards and three family answers contain neither field name nor any refusal message.

### Negative controls: DONE

`npm run negative` runs all fourteen, (a)-(n), each red after its unbroken copy passed. The log was re-recorded against
`2ac4e5a` and holds no machine paths.

| control | break (copy only) | red with |
|---|---|---|
| (n) `negative:duplicaterefusal` | `index.js`: `, ...storedRefusals(stored) })` → ` })` | `resend of Bill 2026-09-14: {"duplicate":true,…}`: `actual: undefined, expected: 'Keep the note to two short lines.'` |

(a)-(m) are unchanged and still red at `2ac4e5a`.

### Left undone / next

Nothing for M4. The page side of clarification 16 belongs to hc2.

## Review of hc2 M3 (46519d0)

Read-only, from `git show 46519d0:<path>` and `git diff 0c33594 46519d0 -- app/` (merged into main as `5bac755`); hc2's worktree
was not opened and nothing in `app/**` was edited. Reviewed:
- `office/reports.js`, `office/settings.js`, and the Fix times, New link, `core.js` and `time.js` changes;
- `reports`, `settings`, `links` specs, and the `board`/`offline`/`planner`/`helpers` diffs;
- control (g) and its log entries.

### What is correct

- **Reports show the Worker's numbers.** Payroll rows, per-client rows, the total's hours and `hm_label`, the incomplete list,
  billing hours, missed rows and mileage km (per day, per leg, per worker total) all print API fields as they come. The Payroll
  total is `d.total.hours`, not a sum. The one exception is scheduled hours (finding 5).
- **CSV download.** It fetches `/api/office/reports/<kind>.csv` with the token and `cache: 'no-store'`, saves the Worker's blob
  under the `Content-Disposition` filename, and ends the session only on a 401 without `field`. `reports.spec.mjs:97-104`
  compares the download byte for byte with a direct GET.
- **Presets are right in NL time.** `today = localDate(Date.now(), agency tz)`; "This week" is `mondayOf(today)` to +6, "Last
  week" is the 7 days before, "Last 14 days" is today−13 to today. `addDays` and `mondayOf` work on calendar dates in UTC
  arithmetic, so a DST change or a month or year end can't shift them. When the presets are computed is another matter (finding 2).
- **Fix times.**
  - Inputs show `localHm(at, NL)`, and only a time whose `HH:MM` changed is sent, so a phone's seconds are kept.
    `reports.spec.mjs:76` proves it.
  - `localToUtcMs(date, hm, NL)` gives the first occurrence on the fall-back day (01:30 on 2026-11-01 → 04:00Z, NDT), the same
    rule as the Worker.
  - `version` is sent and refreshed from the answer; `stale` and every refusal show the API's words; clarification 14's 409
    shows in the sheet (`planner.spec.mjs`, new test).
- **New link.**
  - The inline confirm reads "The old link stops working at once. <who> will need the new one." with "Make a new link" / "Keep
    the old link", and the result message says the old link no longer works.
  - It works from an inactive worker opened under Inactive, and Copy uses the new URL straight after, without re-rendering the
    form, so unsaved edits stay.
  - `links.spec` proves the old worker link 401s, the old family link 404s, and the clipboard holds the exact worker link in
    Chromium (the WebKit skip has a written reason).
- **Settings.** A 401 with `field: "current"` shows by the field and keeps the session: `office()` ends a session only without
  `field`, and `settings.spec` proves the board still loads. A saved name repaints the header with `paintAgency`, which uses the
  API's `sample`, so the badge rule is the Worker's.

### Findings

1. **PAYROLL** · `app/public/office/sheet.js:99-100`. When the typed check-out is earlier than the check-in, the page silently
   moves it to the next day. The Worker's "Check-out has to be after check-in." then never appears, and a slip between AM and PM
   is stored as an overnight shift.
   - **Scenario:** an evening visit 6:00–8:00 PM, the phone's check-in at 6:05 PM, no check-out. The coordinator picks 8:00 **AM**
     in the time input instead of PM.
   - The page sends the next day at 8:00 AM, which is inside the Worker's "ends_at + 12 h" window, so it is accepted: 13 h 55 min
     worked, straight into payroll.
   - **Suggested fix:** send the time on the visit's date and let the Worker refuse it. Offer "next day" only as an explicit
     choice, a checkbox "The check-out was after midnight", shown when the time is earlier than the check-in.
2. **PAYROLL** · `app/public/office/reports.js:66-73`. `today`, `monday` and `PRESETS` are computed once, when the Reports tab
   mounts, and the tab can stay open for days.
   - **Scenario:** a coordinator leaves Reports open on Friday afternoon. On Monday at 8 AM, still in that tab, they press "Last
     week" to run payroll and get the week **before** last. The table and the CSV are for the wrong pay period, and only the small
     period label says so.
   - **Suggested fix:** compute the presets inside the click handler from `Date.now()`.
3. **PAYROLL** (low) · `app/public/office/reports.js:128-133,142`. "Download CSV" uses the period last shown, not the dates in
   the From/To inputs.
   - **Scenario:** the coordinator types the pay period into From and To and presses "Download CSV" without "Show". The file is
     this week's, and only its filename says so.
   - **Suggested fix:** read the inputs at download time (and show that period), or disable "Download CSV" while the inputs
     differ from the shown period.
4. **SECURITY** (Worker and contract; hc1's `PUT /api/office/pin` in `worker/src/index.js`, used by `settings.js:44-54`).
   Changing the PIN leaves every existing office session valid for up to 14 days.
   - **Scenario:** a coordinator who has left still has a signed-in browser on their own laptop. The office changes the PIN in
     Settings to lock them out; the old token keeps opening clients' entry notes, key-safe codes and payroll until it expires.
   - **Suggested fix** (needs a lead decision; hc1 would do it): a successful PIN change deletes every session except the caller's.
5. **OTHER** · `app/public/office/reports.js:8,32,38`. Scheduled hours are the only report numbers the page computes: it rounds
   `scheduled_minutes` itself and adds up a funder's minutes. The formula matches the Worker's CSV today, but no test asserts
   it, and control (g) does not cover it.
   - The Billing total's scheduled-hours cell is blank, although the CSV's `Total` row has it.
   - **Scenario:** the Worker's rounding changes and the screen's scheduled hours quietly stop matching the CSV.
   - **Suggested fix** (needs a lead decision; hc1 would add it): the billing answer gains `scheduled_hours` strings on clients,
     funders and the total, and the page prints them.
6. **OTHER** (low) · `app/public/office/sheet.js:96-98` with `time.js:54-65`. A fix time in the spring-forward gap is silently
   moved: 02:30 on 2026-03-08 becomes 06:00Z (3:30 AM NDT) after the three iterations oscillate. The Worker refuses such a time
   for visits ("That time doesn't exist on the day the clocks change."), but the sheet never lets it see one.
   - **Scenario:** a night visit on DST day with a fix typed at 2:30 AM is stored an hour later than typed.
   - **Suggested fix:** detect the gap (the local time of the result differs from the typed one) and show the Worker's words.
7. **OTHER** (spec gap) · `app/tests/settings.spec.mjs:35-43`. The rename keeps "SAMPLE" in the name, so only "badge stays
   visible" is proven.
   - **Slips through:** a page that never hides the badge (`$('badge').hidden = false`). Add a rename without SAMPLE → badge
     hidden, and back → visible.
8. **OTHER** (spec gap) · `app/tests/reports.spec.mjs:131-137`. The presets are asserted only on Monday Sep 14, mid-month with no
   DST change.
   - **Slips through:** a `mondayOf` that treats Sunday as the start of the week, or a preset built from the phone's UTC date.
   - Add a run with the page clock on Sunday 2026-11-01 at 11:30 PM NL (a fall-back day, the first of a month, already Monday in
     UTC): "This week" must be Oct 26 – Nov 1, and "Last 14 days" Oct 19 – Nov 1.

### hc2's timing fixes (board.spec, offline.spec, helpers)

- **board.spec: can fail only at the boundaries.** `page.clock.install(09:14:58)` then `pauseAt(09:14:59)` freezes the page
  clock, so only `runFor` moves it. `runFor(1000)` lands exactly on 15:00.000, and `runFor(14:59)` + `runFor(1000)` exactly on
  30:00.000. The board's boundary timer (`nextAlertChange`) fires inside those `runFor` calls, and nothing else can move the
  clock between steps. Control (c) (late at 16 min) is still red at the 09:15:00 assertion in the new log.
- **helpers `setNow(…, 'install')`** installs one second early and pauses at the time, the same deterministic pattern.
- **`waitEvent` / `untilAnswer`** (`helpers.mjs:89-111,255-264`) can hide a slow or broken retry schedule. While a response is
  awaited it moves the page clock 5 s every 400 ms of real time, for up to 110 s: about 23 minutes of phone time.
  1. Every test that awaits a queued send passes as long as the send happens *eventually* within those 23 minutes.
     **Slips through:** a queue whose backoff after a dropped send is 20 minutes instead of 5/15/30/60 s, or one that retries only
     on the 20 s tick and never on `online`. Suggested: record the page's `Date.now()` before and after, and assert the answer
     came within the backoff the contract names (≤ 5 s of page time after the first failure, ≤ 20 s after the second).
  2. `Promise.all([waitEvent(…), waitEvent(…)])` subscribes both thenables at once, so two loops step the clock together (10 s
     per 400 ms). That is harmless today, but it doubles the drift that hides finding 1 above.
- **The one-dropped-POST proof is real.** After `offline = false`, the route aborts the first event POST with `connectionreset`
  and counts it. The test then needs the queued check-out (or check-in) to reach the Worker and come back 409, and asserts
  `dropped === 1` (`offline.spec.mjs` "office already has" and "Fix times stays on its card").
  - Only the item under test is queued, so the dropped POST is that item.
  - A queue that dropped or refused the item on a network error would never produce the 409, and the wait would time out red.
  - It proves the retry happens, not how soon (point 1 above), and does not assert that the item was still shown as saved
    between the drop and the retry.

### Control (g) `negative-payrollround.mjs`: honest

- The break replaces exactly the line that makes the footer the Worker's (`const totalHours = d.total.hours;`) with the rows'
  rounded hours added up.
- The data is built for this break: two visits of 3 618 s each give rows of "1.01" and an exact total of 7 236 s = "2.01", so
  the break shows "2.02".
- The unbroken copy passed; the broken run went red at the intended assertion, "the Worker's total, not the rounded rows added
  up (2.02)" (`reports.spec.mjs:92`, expected "2.01", received "2.02"), not at a harness error.
- **Not covered by any control:** Billing's scheduled hours (finding 5) and the Billing total (the spec asserts it, but nothing
  breaks it); the CSV bytes check has no control either. That check is a strong byte comparison, so a missing control there
  matters less.
- The re-run lettered controls and M2c proofs in the same log are still red at their intended assertions; the log holds no
  machine paths.

## Lead review of the M3 review (merged 603275b)

- Findings 1-8: all adopted as API.md clarification 17 (DECISIONS 41-44). The two decisions I asked for: a PIN change ends every
  other session, and billing gains Worker-computed `scheduled_hours`. Both built in M5. **DONE**

## M5 (2026-09-14, rebased on main)

### What was built: DONE

- **A PIN change ends every other session** (clarification 17, finding 4). A successful `PUT /api/office/pin` runs one D1 batch:
  the new PBKDF2 hash, then `DELETE FROM sessions WHERE token_hash <> <caller's token hash>`. The guard (429), `new` (400) and a
  wrong `current` (401 field `current`) still come first and change nothing.
- **Billing `scheduled_hours`** (clarification 17, finding 5).
  - Each client, each funder and the total carry `scheduled_hours`: `decimalHours(minutes × 60)`, where the minutes are the sum
    of `scheduled_minutes` over that group's counted visits. So a funder's and the total's strings come from summed minutes and
    are rounded once, never by adding rounded strings.
  - `billingCsv` now prints these same strings instead of computing its own. Its bytes are unchanged: the existing byte-for-byte
    CSV test still passes.

### Verified: DONE

`npm test` at `287f971`: **23/23 unit, 68/68 API** (66 + 2), nothing skipped. New or changed tests:
- **office PIN, sessions:** three tokens (A, B, C). A wrong current PIN with A answers 401 field `current`, and all three still
  work. A good change with A → A still works, B and C answer 401 **without** `field`, and the new PIN signs in.
- **billing `scheduled_hours`:**
  - Three 20-minute one-off visits for three clients of the same funder, each worked exactly 20 min, give per-client
    `scheduled_hours` "0.33".
  - The funder and the total are "1.00", from 60 summed minutes; adding the rounded rows would give "0.99".
  - The CSV rows print "0.33" three times, then "1.00" on the funder total and Total rows.
- **billing, existing test:** the whole answer is compared again with the new fields (clients "1.00" and "1.50", funders "2.50"
  and "1.00", total "3.50").

### Negative controls: DONE

`npm run negative` runs all fifteen, (a)-(o), each red after its unbroken copy passed. The log was re-recorded against
`287f971` and holds no machine paths.

| control | break (copy only) | red with |
|---|---|---|
| (o) `negative:pinsessions` | `index.js`: the `DELETE FROM sessions WHERE token_hash <> ?1` statement removed from the PIN batch | token B still gets `GET /api/office/clients` 200; `actual: 200, expected: 401` |

(a)-(n) are unchanged and still red at `287f971`.

Not covered by a control: the "summed minutes, not summed strings" rule for `scheduled_hours`. The test measures it with a case
where the two differ ("1.00" against "0.99"), but no copy of the Worker has been broken to show that assertion going red; the
lead did not ask for one.

### Left undone / next

Nothing for M5. The page side of clarification 17 (the midnight checkbox, presets and CSV at the moment of use, the gap refusal,
printing `scheduled_hours`, measured retries) belongs to hc2.

## Review of hc2 M3b (f27283c)

Read-only, from `git show f27283c:<path>` and `git diff 5bac755 f27283c -- app/` (merged as `5883591`). Nothing in `app/**` was
edited. Only what is worth fixing tonight is written out below; everything smaller is one line under Known gaps.

### What holds

- **`w/sw.js`**
  - A response is kept only when it is 200, not redirected, the right `Content-Type`, and (for `/w/`) carries `<meta
    name="hcv-page" content="worker">`. The same `checked()` runs at install and on every refresh.
  - A set is stored only when every required file passed.
  - A navigation is served from the newest set and pins that set to the page (`resultingClientId`), so its modules come from
    that same set.
  - With a set, the network gets 3 s; with no set, the navigation waits for the network with no limit. It never handles
    `/api/*` (line 97).
- **`w/app.js`**
  - Earlier days are looked at up to 7 back, for dates the queue or a saved list shows open, whether or not today's list loaded.
    Online they are loaded; offline they are rebuilt from the saved list, plus cards made from queued items.
  - Drafts store `{ key, done, note }`, and a refused link deletes only lists and drafts with its own key.
  - "Check out without the note" takes the time at that tap and sends no note.
  - A `200 duplicate` answer's `note_refused` reaches the notice (the answers passed to `onSent` include duplicates).
  - A refused check-in reads as history once the card has an accepted or queued check-in.
- **`office/app.js:98`:** a 401 from sign-out now reads "Signed out.".
- **Control (h) is honest.** It removes the type check and the marker. The unbroken copy passed. The broken run went red at "the
  worker page, not the login page" (`offline.spec.mjs:86`): the poisoned set was stored and served.
- **The 17 proofs are honest.** Each was red after its unbroken copy passed, at the assertion its fix owns.
  - The midnight proof is recorded honestly: `proof-queued-midnight` first stayed GREEN at 15:01:34Z, because in that spec
    yesterday's saved list also showed the visit.
  - hc2 logged that and moved the proof to "queued before midnight under an old link", where only the queue knows the visit.
    It went red there at 15:09:42Z.
  - No other GREEN or VOID run is left unexplained.

### Findings worth fixing tonight

1. **PAYROLL** · `app/public/w/app.js:118-129` with `app/public/api.js` `workerVisits` (no timeout). On a weak connection that
   neither answers nor fails, the page shows "Loading today's visits…" and nothing else until the browser gives up on the GET.
   - The saved list is used only in the `catch` (lines 137-143), and each earlier-day GET in `loadEarlier` (line 188) has no
     limit either.
   - **Scenario:** at a client's door with one bar that passes no data, Sam opens the link. For a minute or more there is no
     visit card and no Check in. Sam waits or gives up; the tapped time is late or never taken, though today's list is saved on
     the phone.
   - **Fix:** render the saved list (and the earlier-day cards) before the network call, and give the visits GETs
     `AbortSignal.timeout(8000)`, like the event POST's 30 s limit.
2. **PAYROLL** · `app/public/w/app.js:280,541`. "Dismiss" on the history notice calls `queue.removeRefused`, deleting the refused
   check-in from the phone for good, not just hiding the notice. That record is the only trace of the time the worker first tapped.
   - **Scenario:** Sam's 9:04 check-in is refused, and Sam checks in again at 9:44, which is accepted. Sam taps Dismiss on "An earlier
     check-in at 9:04 AM wasn't accepted by the office."; the 9:04 record disappears from the card and from "Not accepted by the
     office".
   - When Sam later phones the office, nothing on the phone shows 9:04, so Fix times can't restore the 40 minutes.
   - **Fix:** Dismiss hides the notice (remember the dismissed `seq`), and the item stays in the panel until Remove.
3. **PAYROLL** (hc1 can help) · `app/public/w/app.js:52-60,177-184`. An earlier day is looked at only when **this phone** holds the
   open visit, in a list saved under **this link**'s key or in the queue. A visit whose check-in already reached the Worker is
   invisible on another phone, or under a new link on the same phone.
   - **Scenario:** Saturday 9:05, Terry checks in at George N.'s with signal (sent), then drops the phone in the harbour. On Monday
     the office gives Terry a new link on a borrowed phone.
   - The Worker has Saturday's visit open, but the new phone holds no saved list and no queue, so there is no "Still open from Sat
     Sep 12" and no Check out, and the visit stays in payroll's incomplete list.
   - **Fix** (needs a lead decision): `GET /api/worker/visits` also answers `open_dates` (the NL dates, up to 7 back, of this
     worker's visits with an effective check-in and no check-out; a small hc1 change), and the page loads those dates as well.

### Known gaps (OTHER)

- `w/sw.js:44-53,74,87`: a navigation that arrives while another refresh is still writing its set reads that newest, half-written
  set, so a missing module falls back to the network (or fails offline). Mark a set complete last, and read only complete sets.
- `w/sw.js:82,87`: `event.resultingClientId` is the only pin; where a browser leaves it unset, modules come from the newest set,
  which a refresh finishing between the page and its modules can change.
- `w/sw.js:51`: keeping only the previous set can delete the set a still-loading page is pinned to after two quick reloads.
- `w/sw.js:30`: the set's file fetches have no timeout, so with no cached set a stalled connection holds the navigation until the
  browser gives up (the contract's "wait for the network", but with no end).
- `w/sw.js:62`: install fails behind a login page or with no signal, so the phone has no offline copy until a later good online load.
- `w/app.js:77`: drafts saved before M3b carry no `key`, so a refused link never clears them.
- `offline.spec.mjs:65-99`: control (h) goes red at the online reload, not the offline one. The one-set rule, keeping the old set
  when one file fails, and the no-copy wait have no proof.
- `office.spec.mjs` "Sign out after the session already ended": no proof breaks the 401 branch.
- `worker.spec.mjs:274` "still queued across midnight" stays in the suite but passes on the saved list, not the queue (hc2 logged
  this; its proof moved to the old-link test).

## Lead review of the M3b review (merged c6f581e)

- Findings 1-3: adopted as API.md clarification 18 (DECISIONS 45-47). The known gaps go into the README as written. Finding 3
  needed a Worker change, done in M6. **DONE**

## M6 (2026-09-14, rebased on main)

### What was built: DONE

- **`open_dates` on `GET /api/worker/visits`** (clarification 18, finding 3).
  - One query per answer: the distinct visit dates from today−7 up to, but not including, today, of visits with an effective
    (non-voided) check-in whose `worker_id` is this worker, and no effective check-out. Ascending, with the requested date
    left out.
  - It ignores the visit's current worker, cancellation and soft-removal: what counts is this worker's own open check-in. A visit
    checked in from a lost phone, or from a visit the office has since reassigned or removed, still shows on a new phone or link.
  - It does not depend on the requested date, apart from leaving that date out. The contract says "not counting the requested date
    and today", so a phone that asks for an open day doesn't see it listed twice.

### Verified: DONE

`npm test` at `e44611d`: **23/23 unit, 69/69 API** (68 + 1), nothing skipped. The new test, with now on Monday Sep 14:
- a check-in 3 days ago (Fri Sep 11) with no check-out → `["2026-09-11"]`;
- 7 days back (Mon Sep 7) is listed; a one-off visit 8 days back (Sun Sep 6) with an open check-in is not;
- a **soft-removed** visit (Ruby T., Wed Sep 9, pattern moved at 10:00, Sam's check-in tapped at 10:25 lands at 10:40) is listed;
- a **voided** check-in is not: Sam checked in to Tue Sep 8 after the visit went to Jo, and the office's Fix times replaced it with
  Jo's check-in. The test sees Sam's row voided, the date not in Sam's list, and it in Jo's;
- **another worker's** open check-in (Jo, Thu Sep 10) is in Jo's list only;
- today's open check-in is never listed;
- the answer is `["2026-09-07", "2026-09-09", "2026-09-11"]` for no date, today, Sep 13, Sep 16 and Sep 20, and without Sep 7 when Sep 7
  itself is requested;
- after Friday's check-out, the list is `["2026-09-07", "2026-09-09"]`.

### Negative controls: DONE

`npm run negative` runs all sixteen, (a)-(p), each red after its unbroken copy passed. The log was re-recorded against
`e44611d` and holds no machine paths.

| control | break (copy only) | red with |
|---|---|---|
| (p) `negative:opendates` | `index.js`: the open-dates window `addDays(today, -7)` → `addDays(today, -1)` | "a check-in 3 days ago with no check-out": `actual: [], expected: ['2026-09-11']` |

(a)-(o) are unchanged and still red at `e44611d`.

### Left undone / next

Nothing for M6. The page side of clarification 18 (saved list first with an 8 s limit, Dismiss hides, loading each of
`open_dates`) belongs to hc2.

## Early review of hc2 M3c (b9d2021, 0eca1fa)

Read-only, from `git show b9d2021` and `git show 0eca1fa` on `rig/hc2`; hc2's worktree was not opened and nothing in `app/**` was
edited. Checked against API.md clarification 17.

### What holds

- **The evening visit** (`office/sheet.js`, b9d2021). A check-out typed at or before the check-in shows "The check-out was after
  midnight", unticked. Unticked, the time goes on the visit's date and the Worker's "Check-out has to be after check-in." shows;
  ticked, it goes on the next day. `sheet.spec` proves both for 8:00 AM on a 6–8 PM visit (400, nothing stored; then 200,
  13 h 58 min). Control (i), a copy that moves the time silently, would store the first try and go red.
- **The gap check matches the Worker's rule.** A typed time counts as missing when converting it to UTC and back doesn't give the
  same NL date and `HH:MM`. That catches exactly the spring-forward gap: 02:30 on 2026-03-08 shows "That time doesn't exist on the
  day the clocks change.", and nothing is sent. The repeated hour on fall-back day round-trips, so it is accepted as its first
  occurrence, as in the Worker. Without the check the page would send 3:30 AM and the Worker would accept it, so the spec's
  `puts === 0` would go red.
- **Presets at the click** (`office/reports.js`, 0eca1fa). `presetRange()` reads `Date.now()` each press. The "three days on
  without a reload" test goes red under control (j). The Sunday 2026-11-01 11:30 PM test (already Monday in UTC, fall-back day,
  month start) would go red for a UTC-date or Sunday-first week.
- **CSV at the click.** The typed From and To replace the shown period, are loaded first, then downloaded. The spec compares the
  filename, the period label, and the bytes with a direct GET for typed dates without pressing Show.
- **`scheduled_hours` are printed, not computed.** The page's own rounding is gone; clients, funders and the total print the
  Worker's strings.
- **The badge follows the name.** `settings.spec` renames the agency without "SAMPLE" (badge hidden, `sample: false`) and back
  (badge visible).

### Worth fixing tonight

1. **PAYROLL** · `app/public/office/sheet.js` (b9d2021), the Fix times submit handler and `syncOvernight`. The offer compares
   bare `HH:MM` strings, and every time is dated from the **visit's** date. A visit whose check-in was already after midnight can't
   get its check-out, or its check-in, fixed.
   - **Scenario:** a 11:00–11:55 PM visit on Mon Sep 14. The worker arrives late, and the phone's check-in is 12:10 AM on Tue
     Sep 15. The phone dies, and the office sets the check-out to 12:50 AM.
   - "00:50" is after "00:10", so the box is never offered, and the check-out goes as **Mon** 12:50 AM, 22 hours before the check-in.
     The Worker refuses it ("That time is too far from the visit."), and nothing on the sheet lets the office send Tuesday.
   - Typing a check-in of 12:10 AM likewise goes as Monday and is refused. The visit stays in payroll's incomplete list.
   - **Fix:** date a time from the day of the event it replaces (the stored check-in's NL date; for a new check-out, the check-in's
     date). Offer the box whenever the resulting check-out instant is at or before the check-in instant, and offer the same "after
     midnight" choice for a check-in typed earlier than the visit's start. `sheet.spec` needs a case with a check-in after midnight.

### Smaller (one line each)

- `sheet.js` `syncOvernight`: when the stored check-out is already on the next day, the box is shown unticked. Editing that check-out
  then sends the visit's date and gets the Worker's refusal: safe, but the box should start ticked.
- `reports.js` tabs: switching Payroll/Billing/Missed/Mileage after typing dates without Show reloads the old period and silently
  puts the old dates back in the inputs.
- `reports.spec` billing: the `scheduled_hours` assertions can't tell printing from computing (the old page arithmetic gave the
  same strings for 60 and 90 minutes); only a case like 3 × 20 min (0.33 each, 1.00 total) would.
- No control breaks the gap check or the CSV-at-click path; both specs would go red without the fix, but neither red run is recorded.

## Diagnosis: webkit pageerror on navigation (6cb9e81)

Diagnosed on main `4bdc689` (the same `app/public` as `6cb9e81`) with the Worker on hc1's ports (7905/7915). Nothing in `app/**` was
edited; scratch specs and configs live in the git-ignored `.negative/diag/`.

**Reproduced.** `E2E_PORT=7905 npx playwright test tests/targets.spec.mjs --project webkit-390 --repeat-each 15`: 2 of 15 runs of
"Check in, Check out and the late and missed rows meet 4.5 : 1" failed the guarded fixture with "…/127.0.0.1:7905/api/worker/visits
due to access control checks.". The other 58 passed.

**Which promise.** An instrumented copy of the same flow (no route interception) caught the error with its stack, 1 in 25 runs:
`request (api.js:18:26)` ← `load (w/app.js:124:33)` ← `onSent (w/app.js:28:55)` ← `drain (w/queue.js:145)`.
- The check-in's answer makes the queue call `onSent`, which starts `load()`. Its `GET /api/worker/visits` is still in flight when
  the spec's `signIn` navigates to `/office/`.
- That request is **handled**: `await workerVisits(key)` at `w/app.js:124` is inside `load()`'s `try`, and the catch falls back to
  the saved list.
- What fails the test is not an unhandled promise. It is a **console error that WebKit logs itself** when the page unloads mid-fetch,
  and Playwright's WebKit backend reports every such console error as a `pageerror`.

The evidence:
1. **Playwright's mapping.** `playwright-core/lib/coreBundle.js`, WebKit `_onConsoleMessage`: any console message with
   `level === "error" && source === "javascript"` goes to `page.addPageError`. The name is the text before the first colon, and
   the stack is the console message's stack trace.
   - WebKit's text is "Fetch API cannot load http://127.0.0.1:…/api/worker/visits due to access control checks.", so the reported
     name "Fetch API cannot load http" and message "/127.0.0.1:…" are that split, not a JS exception's name.
   - A truly unhandled fetch rejection (control F4, 5/5) reports as `TypeError: Load failed`, a different shape.
2. **Handled rejections never report.** A fetch in flight during a navigation, handled by `.then(ok, err)`, by one `try/await`, or
   by two async layers like `request()` → `load()`: 0 page errors in 15 runs (F1-F3, real Worker, no interception). The same with
   the `X-Worker-Key` header: 0/5 (F6). Navigating the moment `onSent`'s refresh starts, with and without the service worker, with
   and without Web Locks: 0/30 (G1-G3).
3. **No rejection event in the hit.** The captured failing run logged `beforeunload`, but no `unhandledrejection` event.
4. **Not the service worker.** The same spec with `serviceWorkers: 'block'` still failed 1/15; the service worker never handles
   `/api/*`.

I could not make WebKit log "access control checks" on demand. It appears only in a narrow window of the unload (about 1 run in
10-25), so point 1 is shown by the mapping and the matching message shape, not by a deterministic repro.

**The other candidates are cleared.**
- The queue sender: `post()` catches.
- `loadEarlier`: awaited, and its GET is inside `try`.
- `api.js` `request()` / `res.json()`: awaited by callers inside `try`, and `json()` has its own `try`.
- The service worker's page fetch: not on the stack, and blocking it does not help.
- "WebKit reports a rejection handled late, after unload" is not what happens either: handled rejections during unload stayed silent
  every time.

**A real phone.** A dropped request with no navigation does not produce it. With the network gone (F5, F7) or the request aborted
(the dropped-no-navigation variant), the fetch rejects with "TypeError: Load failed", the page's `catch` runs, and WebKit logs only
"Failed to load resource: …": 0 page errors in 15 runs. Even the navigation case is only a console line on a phone. The page is
leaving, and the rejection it logged is handled, so nothing is lost or shown to the worker.

**Fix for hc2 (the spec, not the app).**
- `tests/targets.spec.mjs` "…meet 4.5 : 1" navigates to `/office/` while the phone's refresh after the check-in is still loading.
  Before `signIn(page)`, it should wait until that refresh has finished: the card shows the server's check-in, not the queued one
  (`await expect(page.locator('.visit-status').first()).not.toContainText('saved on this phone')` after it reads "Checked in"),
  and the strip reads "All sent".
- The first test in the same file already waits for "Within 250 m of the client" and "All sent" before moving on, which is why it
  never hits this.
- Do not filter the message in the guarded fixture: a real uncaught error with a similar text would then slip through.
- The same rule applies to any spec that leaves `/w/` straight after a queued send.
- Optional app hardening, not required: when the visits GETs gain `AbortSignal.timeout(8000)` (clarification 18), also abort them
  on `pagehide`, so an unloading page cancels its own fetch instead of letting WebKit fail it mid-teardown.

## Review of hc2 M3d (fcd24d4)

Read-only, from `git diff 6cb9e81 fcd24d4 -- app/` (merged as `15a6801`); nothing in `app/**` was edited. Checked against API.md
clarifications 18-19.

### What holds

- **Saved list first, with the 8 s limit** (`w/app.js` `showSaved`, `loadSignal`).
  - At start the page draws today's saved list (marked "Saved list from …") and the earlier days it can rebuild offline, then loads.
  - Every visits GET carries an 8 s abort signal. A timeout, a stalled body (`res.json()` aborted, so `data: null`, so `saveList`
    throws inside the `try`) or a failure all land in the `catch`, which keeps the saved list and the "Saved list from" notice.
  - A loaded answer replaces it and clears `stale`, so stale data never passes as fresh.
- **Dismiss hides only.** The dismissed `seq` is kept in `hcv:dismissed`; the item stays under "Not accepted by the office" until
  Remove. `worker.spec` proves it through a reload.
- **`open_dates`.** The page loads each named date online, and offline uses the saved answer's `open_dates`. Earlier days and today
  come from different dates, so a visit can't be carded twice. `withQueued` adds a card only for a queued item missing from its
  date's list.
- **Fix times dated from the events.**
  - An 11:00–11:55 PM visit checked in at 12:10 AM: "The check-in was after midnight" starts ticked, and a 12:50 AM check-out goes
    on the check-in's day (40 min). `sheet.spec` proves it.
  - The check-out date comes from the check-in's NL date. The gap check uses each time's own date.
  - A typed check-in earlier than the start offers the check-in box.
- **Report tabs** read From and To at the click.
- **`npm run negative` exits non-zero** whenever any control or the proofs script does not go red.
  - `run-negatives.mjs` runs every `negative-*.mjs` except the library, and exits 1 if any exits non-zero: a VOID control returns
    2, a GREEN one 1, a thrown anchor or a signal is non-zero, and the proofs script exits 1 unless every proof is red.
- **Controls (k) and (l) are honest.** The unbroken copies passed. (k) (the network first) went red at "the saved list, without
  waiting for the network" (`offline.spec.mjs:392`), with the visits request hanging. (l) (`named = false`) went red at "Still open
  from Fri Sep 11" (`worker.spec.mjs:106`) on a clean phone.

### Worth fixing tonight

1. **PAYROLL** (Worker and contract; hc1's `GET /api/worker/visits` in `worker/src/index.js`, `loadVisitRecords(db, 'v.date = ?1 AND
   v.worker_id = ?2', …)`, with `app/public/w/app.js` `withQueued`). The worker list returns only visits **currently assigned** to
   the worker, while `open_dates` and the check-out rule follow the worker who **checked in**.
   - The Worker accepts a check-in from a worker who was assigned earlier, and only that worker may check out. The page can show
     such a visit only while its check-in is still queued.
   - **Scenario:** Sam is driving to Bill S.'s 9:00 visit with no signal, and at 8:50 the office moves the visit to Jo. Sam's phone
     still has the saved card, and Sam checks in at 9:02; it is accepted.
   - The refresh after the send reloads today's list without Bill (now Jo's), so the card disappears. Sam can't check out, and Jo
     can't either ("Another worker checked in to this visit.").
   - The same visit is then named in Sam's `open_dates` every day for a week, and each load finds no card. It stays in payroll's
     incomplete list until the office uses Fix times.
   - **Fix** (needs a lead decision; hc1 would do it): `GET /api/worker/visits` also returns, for the requested date, the visits
     where this worker holds the effective check-in, marked `"reassigned": true` when the current worker is someone else. The page
     needs no change to show them.

### Known gaps (OTHER)

- `w/app.js` load and the queue: between a send's confirmation and the refresh's answer (up to 8 s on a slow line), a card falls
  back to the older answer and offers Check in or Check out again. A second tap is refused 409: nothing is lost, but the worker sees
  a confusing "wasn't accepted" notice.
- `w/app.js` `showSaved`: saved entry notes and key-safe codes are drawn before the key is checked, so a lost phone opened after New
  link shows them until the 401 arrives (offline, until it has signal). Offline this was already true before M3d.
- `office/sheet.js` `syncOvernight`: "The check-out was after midnight" is never unticked when the check-out stops being at or before
  the check-in, so a corrected same-evening check-out is sent on the next day; the Worker then refuses it as too far.
- `w/app.js` `hcv:dismissed` only grows and isn't keyed by link, so a reused `seq` after IndexedDB is cleared could hide a new
  notice.
- `sheet.spec`: the check-out box starting ticked and a same-day check-in typed before the visit's start have no test.
- Control (k) proves "saved list first" but not the 8 s limit; a page that never times out would still pass.
- `negative-control.log`: the first M3d run's two VOID entries ("proof-earlier-days", "proof-earlier-without-today") are replaced by a
  note, so their raw output is no longer in the record. The later runs are red.

## Lead review of the M3d review (merged b377d85)

- The payroll finding is adopted as API.md clarification 21 (DECISIONS 51-52), built in M7. The smaller notes go into the README's
  known gaps. **DONE**

## M7 (2026-09-14, rebased on main)

### What was built: DONE

- **The worker's list keeps visits they checked in to** (clarification 21). `GET /api/worker/visits?date=` now loads the visits
  on that date where `v.worker_id` is this worker **or** this worker holds the effective (non-voided) check-in. The two kinds are
  sorted together by `starts_at`, then `id`; each visit has its check-in and check-out as before, plus `"reassigned"`: `true` when
  the current worker is someone else or no one, `false` otherwise.
- **Unchanged:** soft-removed visits follow the same visibility rule as before (they show once they have an event); `open_dates`
  and mileage are untouched.

### Verified: DONE

`npm test` at `f6d5fae`: **23/23 unit, 71/71 API** (69 + 2), nothing skipped. New or changed tests:
- **Reassigned after an offline check-in:** the office gives Bill S. to Jo at 8:50, and Sam's check-in tapped at 9:02 lands. Sam's
  Monday list is `[Bill S. reassigned true, Ruby T. false]`, in start order, with Sam's check-in. Jo's list has Bill S. with `false`.
  Sam's check-out answers 201, and the card keeps its check-out.
- **Given to no one:** Ruby T. moved to no worker, then Sam's check-in lands, so Sam sees it with `reassigned: true`.
- **Reassigned before any check-in:** Tuesday's Frank H. moved to Jo, and Sam's Tuesday list is empty.
- **A voided check-in:** on Wednesday Sam's check-in keeps the visit on Sam's list. After Fix times replaces it with the office's
  check-in for Jo, the visit is gone from Sam's list.
- **The `open_dates` day:** a Friday visit reassigned to Jo with Sam's open check-in. Monday's `open_dates` is `["2026-09-11"]`, and
  Friday's list has the card (`reassigned: true`, check-in 9:02, no check-out).
- **M1's "a reassigned visit still accepts the first worker's check-in"** now expects the card on Sam's list with `reassigned: true`,
  where it used to expect the card gone, as clarification 21 changes the contract.

### Negative controls: DONE

`npm run negative` runs all seventeen, (a)-(q), each red after its unbroken copy passed. The log was re-recorded against
`f6d5fae` and holds no machine paths.

| control | break (copy only) | red with |
|---|---|---|
| (q) `negative:reassignedlist` | `index.js`: the ` OR EXISTS (… check-in by this worker …)` clause removed from the worker list | `AssertionError [ERR_ASSERTION]: sorted by start, each marked` / `actual: [ [ 'Ruby T. (SAMPLE)', false ] ],` / `expected: [ [ 'Bill S. (SAMPLE)', true ], [ 'Ruby T. (SAMPLE)', false ] ],` |

(a)-(p) are unchanged and still red at `f6d5fae`.

### Left undone / next

Nothing for M7. On the page side, the optional "Moved to another worker by the office" line belongs to hc2.

## Review of hc2 M3e (55c16ef)

Read-only, from `git diff 15a6801 55c16ef -- app/` (merged as `e41d196`); nothing in `app/**` was edited. Scratch checks ran on
hc1's ports (7905/7915) from the git-ignored `.negative/diag/`. Checked against API.md clarification 20 and DECISIONS 49.

### What holds

- **The map** (`office/clients.js`, `map-config.js`).
  - MapLibre is Leaflet's base layer through `L.maplibreGL({ style: MAP_STYLE_URL })`. The style URL appears only in
    `map-config.js`, and no `tile.openstreetmap.org` is left anywhere in `app/public` (vendor included).
  - The binding (0.1.4) creates the MapLibre map with `attributionControl: false` and `interactive: false`, so pins, clicks and the
    draft pin stay Leaflet's.
  - `customAttribution: ''` keeps it from adding the TileJSON's own text, so the only attribution is Leaflet's.
  - The attribution is added before the base layer is chosen, so it shows with or without WebGL. Its text is exactly "OpenFreeMap ©
    OpenMapTiles Data from OpenStreetMap", with the three required links (openfreemap.org, openmaptiles.org,
    openstreetmap.org/copyright).
  - **No WebGL:** no WebGL context, no `maplibregl`, or `addTo` throwing gives `data-base="plain"` and a plain background, and
    MapLibre's later load errors go to `console.warn`, never uncaught.
- **Vendored files.** `maplibre-gl.js`, `maplibre-gl.css` and `LICENSE.txt` are byte-for-byte `maplibre-gl@5.24.0`, and
  `leaflet-maplibre-gl.js` and `LICENSE` byte-for-byte `@maplibre/maplibre-gl-leaflet@0.1.4`. Checked by SHA-256 against the installed
  packages; `app/package-lock.json` pins both. The MapLibre header names v5.24.0 and BSD-3-Clause, and both licence files ship
  beside the code. No licence or attribution breach found.
- **`pagehide` abort + 8 s limit** (`w/app.js`). Only the visits GETs use `loadSignal()`; the queue's event POSTs keep their own 30 s
  signal, so leaving never cancels a send. An aborted load lands in `load()`'s `catch`, so the saved list stays.
- **Settle before leaving `/w/`.** `settledOnPhone` waits for "All sent" and for the card's own server text: "Checked in … ·
  Within 250 m…" or "Done … – …", never "saved on this phone". That text appears only after `load()` (and its awaited
  `loadEarlier`) has answered and redrawn. It is used before every navigation away from `/w/` that follows a send. The contrast spec
  also sets a real position, so WebKit's check-in is accepted.
- **The network guard's `blob:` rule** is scoped: a `blob:` URL counts as its inner origin, and passes only for 127.0.0.1 or
  tiles.openfreemap.org.
  - **Can a real outside request slip through?** A scratch map, online, with every URL on the unresolvable
    `tiles.openfreemap.invalid` and a route on that host. In both Chromium and WebKit the route answered **all 8** requests MapLibre
    made (style, TileJSON and 6 tile fetches from its web worker): 8 seen, 8 routed, none unrouted. So the worker's tile fetches don't
    bypass the fixtures.
- **Control (m) is honest.** The unbroken copy passed. The break removes exactly `map.attributionControl.addAttribution(MAP_ATTRIBUTION)`,
  and the broken copy went red at the attribution assertion (expected the OpenFreeMap text, received ""), not at a harness error.
  The log adds 31 red entries and no GREEN or VOID.

### Worth fixing tonight

None. No data-loss, payroll, privacy, security, licence or attribution finding in M3e.

### Known gaps (OTHER)

- `w/app.js`: after a restore from the back-forward cache, the HTML spec fires `visibilitychange` before `pageshow`, so `load()` may
  still take the old, already-aborted `leaving` signal and fail at once. The page then keeps its saved list ("Saved list from …")
  until the next online event, visible tab or send. Starting a `load()` on `pageshow` with `persisted` would close it.
- `tests/office.spec.mjs` map test: the MapLibre checks run only when `data-base` is `maplibre`, so a regression that sends every
  browser to the plain background (a script not loaded, `webgl()` always false) passes the whole suite. MapLibre did run headless here
  in both engines, so one project could require `maplibre`.
- `tests/helpers.mjs` `offHost`: tiles.openfreemap.org is left out of the `seen` check, so an OpenFreeMap request no route answered
  would not fail the guard. None does today (see above); comparing `seen` with the routed `tiles` list would keep it that way.
- `tests/helpers.mjs` `hostOf`: a `blob:null/…` URL (opaque origin) makes `new URL(url.pathname)` throw inside the route predicate.
  The app makes none today.

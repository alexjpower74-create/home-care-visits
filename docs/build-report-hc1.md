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

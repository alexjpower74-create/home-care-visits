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

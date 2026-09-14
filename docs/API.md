# Home Care Visits: API contract (v1)

The contract between the Worker slice (hc1) and the app slice (hc2). If the code and this file disagree, this file wins
until the lead changes it. Written by the lead 2026-09-14. Clarifications are appended at the bottom, numbered. **Follow the
rule, never an example**: the examples show shapes; where an example value and a rule disagree, the rule is right.

One Worker `home-care-visits` serves the API under `/api/*` (Worker first) and the static app from `app/public/` (same
origin, no CORS). Local only tonight: `wrangler dev --local`. One deployment = one agency.

## Conventions

JSON in, JSON out. Errors are always `{ "error": "<plain English>", "code": "<machine code>", "field"?: "<input name>" }`.

| code | HTTP | when |
|---|---|---|
| `bad_request` | 400 | validation; `field` names the input |
| `unauthorized` | 401 | missing/expired office token, wrong PIN (`field: "pin"` or `"current"`), unknown or reset worker key |
| `not_found` | 404 | unknown id, unknown or reset family key, a visit that is not (and never was) on this worker's list |
| `bad_state` | 409 | moving/cancelling a visit that has a check-in; check-out with no check-in; another worker's visit already checked in |
| `stale` | 409 | an office edit sent with a `version` that is not the visit's current one |
| `already_checked_in` | 409 | a second check-in (different id) for a visit that has one; body also has `event` (the stored one) |
| `already_checked_out` | 409 | a second check-out (different id) for a visit that has one; body also has `event` |
| `rate_limited` | 429 | too many PIN tries, or too many unknown family-link lookups |
| `server_error` | 500 | anything unexpected: "Something went wrong on our side. Try again in a minute." |

- **Ids.** Clients, workers, visits, patterns, tasks, zones and funders have integer `id`s. Event ids (check-in, check-out)
  are **client-generated UUID v4 strings, stored lower-cased**: the id is the idempotency key that lets a phone resend safely.
- **Instants** are ISO 8601 UTC with milliseconds (`2026-09-14T12:04:00.000Z`), **truncated to the whole second when stored**
  (so worked time is whole seconds). Every instant a person reads has a `*_label` beside it in NL time (`America/St_Johns`):
  - time label: `Intl.DateTimeFormat('en-US', { timeZone: 'America/St_Johns', hour: 'numeric', minute: '2-digit' })` → `"9:04 AM"`;
  - date label: `{ weekday: 'short', month: 'short', day: 'numeric' }` → `"Mon Sep 14"`;
  - full label: `"Mon Sep 14, 9:04 AM"`.
  ICU puts U+202F (narrow no-break space) or U+2009 before AM/PM: replace both with a plain space, on both sides. The app formats
  anything that is only on the phone (a queued check-in) with the same call and the agency `timezone`, never the phone's zone.
- **Visit times** are local: `date` `"YYYY-MM-DD"`, `start` and `end` `"HH:MM"` (24 h), in NL time. `starts_at` / `ends_at`
  are the UTC instants they mean, DST aware (NDT is UTC−2:30, NST is UTC−3:30; `2026-07-14 09:00` → `2026-07-14T11:30:00.000Z`,
  `2026-01-12 09:00` → `2026-01-12T12:30:00.000Z`). A local time that does not exist on the spring-forward day is refused (400,
  "That time doesn't exist on the day the clocks change."); a repeated local time on the fall-back day means its first occurrence.
  A visit ends after it starts on the same date and lasts 15 minutes to 12 hours.
- **Weeks run Monday to Sunday.** A `week_start` is a Monday. "Today" is the NL date of server now.
- **Durations and money.** Worked time is integer **seconds**. Decimal hours are a string with 2 places, rounded half up from
  the seconds of **that row**: `hundredths = floor((seconds * 100 + 1800) / 3600)` → `"3.93"`. A total is computed from the summed
  seconds, never by adding rounded rows. `hm_label` is whole minutes, truncated: `"3 h 56 min"` (`"0 h 45 min"`). No money
  anywhere: the agency bills hours; rates are out of scope.
- **Distances** are haversine metres on a sphere of radius 6 371 008.8 m, rounded half up to whole metres. `km` strings have
  1 decimal, from metres: `tenths = floor((metres + 50) / 100)` → `"28.6"`. Every screen that shows a distance or a travel
  time says it is straight-line.
- **Auth.**
  - Office: `Authorization: Bearer <token>` from `POST /api/office/signin`. Tokens are 32 random bytes, base64url, stored
    as SHA-256 only, valid 14 days. The PIN is PBKDF2-SHA256, 100 000 iterations, random 16-byte salt. SAMPLE PIN `4826`.
  - Worker phone: `X-Worker-Key: <key>` header on every `/api/worker/*` call. The page reads the key from its own URL (`/w/?k=`).
  - Family: the key is in the path, `GET /api/family/<key>`.
  - Worker and family keys are ≥ 128 random bits, base64url, stored as they are, because the office needs to copy the same
    link again. "New link" replaces a key; the old one stops working at once (worker 401, family 404).
- **Absolute links.** `worker_url` (`<origin>/w/?k=<key>`) and `family_url` (`<origin>/f/?k=<key>`) are built from the
  request's origin (`new URL(request.url).origin`).
- **Headers.** Every `/api/*` answer carries `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and
  `X-Content-Type-Options: nosniff`. The `/w/` and `/f/` pages set `<meta name="referrer" content="no-referrer">`.
- **Rate guards** (client IP = `CF-Connecting-IP`, else `"local"`):
  - PIN: 5 wrong PINs from one IP inside 15 minutes → 429 "Too many tries. Wait 15 minutes and try again." for every
    sign-in (the right PIN included) until the window passes. Wrong `current` PINs on `PUT /api/office/pin` count too.
  - Family: 30 unknown-key lookups from one IP inside 10 minutes → 429 "Too many tries. Wait a few minutes and try again."
    for **every** family lookup from that IP, known keys included, so a guesser cannot spot a hit by a different answer.
- **Test mode.** Only when the Worker has var `TEST_MODE=1` (never on a deploy): header `X-Test-Now: <ISO instant>` replaces
  server now, `X-Test-IP: <string>` replaces the client IP, and `/api/test/*` exist. Without `TEST_MODE=1` both headers are
  ignored and `/api/test/*` answers 404.
- **Privacy guards** (400 with the field named):
  - **Health card numbers.** Any free-text field (names, address, entry notes, task details and labels, family contact
    name and relationship, visit note, cancel reason, time-fix reason) containing 12 or more digits in a row, where single
    spaces or dashes may sit between digits (`/\d(?:[ -]?\d){11,}/`) → "Don't put health card numbers in this app."
  - **No medication administration.** A task `detail` or `label` matching
    `/\b(administer(ed|s|ing)?|administration|doses?|dosage|inject(ed|ing|ions?)?|insulin|\d+ ?(mg|mcg|ml)|(give|gave|given|giving)\s+((him|her|them|the|his|their)\s+)?(meds?|medications?|pills?|tablets?))\b/i`
    (so "Morning pills from the blister pack" and "Help with bath" pass; "Give her pills", "5 mg" and "insulin" do not) → "This app records medication
    reminders only, not medication given. Reword this task." (field `tasks`). There is no task kind for giving medication and
    no field that records it.
  - There is no diagnosis field, no health card field, no date of birth field. Do not add one.

## Objects

**Agency** (`GET /api/agency`, public)
```json
{ "name": "SAMPLE Exploits Home Support (demo)", "sample": true, "timezone": "America/St_Johns",
  "office_phone": "709-555-0100", "late_after_minutes": 15, "missed_after_minutes": 30, "near_metres": 250 }
```
`sample` is `true` while the name contains `SAMPLE`; every screen shows a SAMPLE badge while it is true. The office view
(`GET /api/office/agency`) adds `"office": { "label": "SAMPLE office, Grand Falls-Windsor", "lat": 48.96400, "lng": -55.66444 }`,
`"zones": [ { "id": 1, "name": "Grand Falls-Windsor" }, … ]` and `"funders": [ { "id": 1, "name": "SAMPLE Regional home support program" }, … ]`.
Zones and funders are fixed by the seed in v1.

**Task** (on a client)
```json
{ "id": 11, "kind": "medication_reminder", "label": "Medication reminder", "detail": "Morning pills from the blister pack" }
```
`kind` and its `label`: `personal_care` "Personal care" · `meal_prep` "Meal preparation" · `medication_reminder`
"Medication reminder" · `housekeeping` "Light housekeeping" · `laundry` "Laundry" · `companionship` "Companionship" ·
`errands` "Errands and shopping" · `other` "Other". `detail` is optional, ≤ 80 characters, shown to the worker only.

**Pattern** (a client's repeating visit)
```json
{ "id": 5, "days": [1, 3, 5], "start": "09:00", "end": "10:30", "worker_id": 2,
  "days_label": "Mon, Wed, Fri", "time_label": "9:00 AM – 10:30 AM" }
```
`days` are ISO weekdays (1 = Monday … 7 = Sunday), unique, sorted. `worker_id` may be `null` (visits start unassigned).
Time ranges in labels use ` – ` (space, en dash, space).

**Client** (office view)
```json
{ "id": 3, "name": "Walter G. (SAMPLE)", "initials": "WG", "address": "Botwood, NL (SAMPLE: no street address)",
  "lat": 49.13690, "lng": -55.37010, "zone_id": 3, "zone_name": "Botwood, Peterview & Northern Arm",
  "entry_notes": "Key safe left of the back door, code 1942 (SAMPLE). Knock twice.",
  "funder_id": 3, "funder_name": "SAMPLE Veterans program", "active": true,
  "tasks": [ "Task…" ], "patterns": [ "Pattern…" ],
  "family_contacts": [ { "name": "Dave G. (SAMPLE)", "relationship": "Son", "phone": "709-555-0152" } ],
  "family_url": "http://127.0.0.1:7902/f/?k=…" }
```
`initials`: the name without `(SAMPLE)`, split on spaces; first letter of the first word, plus the first letter of the last
word when there are two or more; upper case (`"Walter G. (SAMPLE)"` → `"WG"`, `"Jo (SAMPLE)"` → `"J"`).

Client input (POST and PUT; all fields required on PUT; on POST `entry_notes` defaults to `""`, `active` to `true`,
`patterns` and `family_contacts` to `[]`): `name, address, lat, lng, zone_id, entry_notes, funder_id, active, tasks,
patterns, family_contacts`. Tasks and patterns in the input may carry the `id` of an existing one. Validation → 400 with `field`:

| field | rule | message |
|---|---|---|
| name | 1–60 characters after trimming | "Give the client a name." / "Keep the name under 60 characters." |
| address | 1–120 characters after trimming | "Type where the client lives (the town is enough)." |
| lat, lng | numbers; lat 46.5–60.5, lng −67.9 to −52.5 (Newfoundland and Labrador) | "Put a pin on the map for this client." (field `lat`) |
| zone_id | an existing zone | "Pick a zone." |
| entry_notes | ≤ 300 characters | "Keep the entry notes under 300 characters." |
| funder_id | an existing funder | "Pick who pays for this client's visits." |
| tasks | 1–12 items; `kind` from the list; `detail` ≤ 80 | "Add at least one care task." / "Pick a task type." / "Keep each task under 80 characters." |
| patterns | 0–7 items; `days` 1–7 unique values 1..7; `start`/`end` `HH:MM`; 15 min–12 h; `worker_id` null or an active worker | "Pick at least one day." / "The visit has to end after it starts." / "A visit is between 15 minutes and 12 hours." / "Pick one of your workers." (field `patterns`) |
| family_contacts | 0–4 items; `name` 1–60; `relationship` ≤ 30; `phone` 10 digits once spaces, dashes, dots, brackets and a leading `1` are removed, stored `709-555-0152` | "Add a name for each family contact." / "Type a 10-digit phone number, like 709-555-0152." (field `family_contacts`) |
| active | boolean | "Say whether this client is active." |

Plus the privacy guards. `PUT` answers the saved Client plus `"rebuilt_visits": <n>` (see Visit generation).

**Worker** (office view)
```json
{ "id": 2, "name": "Sam R. (SAMPLE)", "initials": "SR", "phone": "709-555-0132", "zone_ids": [1, 2],
  "zone_names": ["Grand Falls-Windsor", "Bishop's Falls & Norris Arm"],
  "availability": { "1": { "start": "07:30", "end": "15:30" }, "2": { "start": "07:30", "end": "15:30" }, "3": null, "4": null, "5": null, "6": null, "7": null },
  "availability_label": "Mon–Tue 7:30 AM – 3:30 PM", "max_week_minutes": 2250, "max_week_label": "37.5 h",
  "active": true, "worker_url": "http://127.0.0.1:7902/w/?k=…" }
```
Worker input: `name` 1–40 ("Give the worker a name."), `phone` as for family contacts, `zone_ids` 1+ existing ("Pick at
least one travel zone."), `availability` keys "1".."7" each `null` or a `start`/`end` window ending after it starts
("Availability has to end after it starts."), `max_week_minutes` integer 60–4800 ("Weekly hours are between 1 and 80."),
`active`. `max_week_label` is hours with up to one decimal (`"37.5 h"`, `"20 h"`). `availability_label` groups consecutive
days with the same window (`"Mon–Fri 8:00 AM – 4:00 PM"`, `"Fri 12:00 PM – 8:00 PM, Sat–Sun 8:00 AM – 4:00 PM"`, in weekday order of each group's first day) or `"Not available"`.

**Event** (a check-in or check-out; office view)
```json
{ "id": "6f1c2a3e-…", "visit_id": 101, "worker_id": 2, "worker_name": "Sam R. (SAMPLE)", "kind": "check_in",
  "at": "2026-09-14T12:34:12.000Z", "at_label": "10:04 AM", "at_adjusted": false, "received_at": "2026-09-14T13:20:05.000Z",
  "source": "phone", "location": "near", "location_label": "Within 250 m of the client", "distance_m": 34,
  "correction_reason": null }
```
- `kind`: `check_in` | `check_out`. `source`: `phone` | `office` (a time fixed by the office; then `correction_reason` is set
  and `location` is `not_shared`).
- `location` (check-ins only; `null` on check-outs): `near` "Within 250 m of the client" (distance ≤ 250 m) · `far`
  "More than 250 m from the client (<d>)" where `<d>` is `"640 m"` under 1 000 m, else `"1.2 km"` · `not_shared`
  "Location not shared". The worker view carries `location_label` but not `distance_m`. The family view never carries either.
- `at_adjusted`: `true` when the Worker did not keep the phone's time (see the original-time rule).

**Visit** (office view)
```json
{ "id": 101, "client_id": 3, "client_name": "Walter G. (SAMPLE)", "client_initials": "WG", "zone_id": 3,
  "lat": 49.13690, "lng": -55.37010,
  "worker_id": 2, "worker_name": "Sam R. (SAMPLE)", "worker_phone": "709-555-0132", "pattern_id": 5,
  "date": "2026-09-14", "date_label": "Mon Sep 14", "start": "09:00", "end": "10:30", "time_label": "9:00 AM – 10:30 AM",
  "starts_at": "2026-09-14T11:30:00.000Z", "ends_at": "2026-09-14T13:00:00.000Z", "scheduled_minutes": 90,
  "cancelled": false, "cancel_reason": null, "version": 1,
  "check_in": "Event…", "check_out": null, "worked_seconds": null,
  "status": "checked_in", "status_label": "Checked in 9:04 AM",
  "alert": "none", "late_minutes": 0, "late_label": null,
  "tasks_done": [ { "task_id": 11, "kind": "meal_prep", "label": "Meal preparation", "done": true } ],
  "note": { "text": "Ate well. Asked about Thursday's groceries.", "shareable": false, "written_label": "10:28 AM" },
  "visited_after_cancel": false, "conflict_kinds": [] }
```
- `check_in` / `check_out`: the **effective** event of that kind (not voided), or `null`. `worked_seconds` = `check_out.at −
  check_in.at` in seconds when both exist, else `null`.
- `status`: `checked_out` if there is a check-out; else `checked_in` if there is a check-in; else `cancelled` if cancelled;
  else `unassigned` if `worker_id` is null; else `scheduled`. `status_label`: "Checked out 10:31 AM" · "Checked in 9:04 AM" ·
  "Cancelled" · "No worker assigned" · "Scheduled".
- `alert` (the late/missed rule, below) computed with server now. `late_minutes` = for a checked-in visit
  `max(0, floor((check_in.at − starts_at) / 60 000))`, else `null`; `late_label` = `"22 min late"` when `late_minutes ≥ 15`, else `null`.
- `tasks_done` and `note` come with the check-out (`[]` and `null` before). `note.written_label` is the check-out's `at_label`.
- `visited_after_cancel`: `true` when the visit is cancelled and still has a check-in (a phone that did not know).
- `conflict_kinds`: the kinds of every conflict naming this visit (week view only; `[]` elsewhere).

### The late / missed rule (pure; `alertFor(visit, nowMs)`, identical in the Worker and the office page)
- cancelled, or has a check-in → `"none"`;
- `now < starts_at + 15 min` → `"none"`;
- `starts_at + 15 min ≤ now < starts_at + 30 min` → `"late"` (amber);
- `now ≥ starts_at + 30 min` → `"missed"` (red).

Exactly 15:00 after the start is late; exactly 30:00 is missed. A visit with no worker follows the same rule. The Worker's
`alert` field uses server now. **The office board recomputes `alert` from the page's own clock** (`Date.now()`) every 15
seconds and after every load, so a person watching the board sees amber at 15 and red at 30 without a reload. Board wording:
late "Late: not checked in 15 minutes after the start", missed "Missed: not checked in 30 minutes after the start", each
with "Call <worker name>: <phone>" as a `tel:` link (or "No worker assigned").

### Visit generation (patterns → visits)
- A pattern generates one visit per matching day with `pattern_id`, `pattern_date` (the date it was generated for, never
  changed afterwards; unique together) and the pattern's `start`, `end`, `worker_id`.
- A pattern has `valid_from_at` and `ended_at` (instants). It generates a visit for date D only when that visit's `starts_at ≥
  valid_from_at` and (`ended_at` is null or `starts_at < ended_at`). The SAMPLE seed's patterns start `2020-01-01T00:00:00.000Z`.
- **Generation is lazy and idempotent:** every route that reads visits for a date range first ensures the visits of every
  week it touches (`INSERT OR IGNORE` on `(pattern_id, pattern_date)`), for active clients only. Reading a week twice never
  duplicates a visit.
- **Saving a client's patterns** (PUT): a pattern in the input with the `id` of a stored pattern and the same `days`, `start`,
  `end` and `worker_id` is unchanged. Every other stored pattern is ended (`ended_at` = now), and its visits with `starts_at >
  now` and **no events at all** are deleted. Every new or changed pattern in the input is stored as a new pattern with
  `valid_from_at` = now. `rebuilt_visits` is the number of visits deleted. So a past or started visit is never rewritten, and
  changes made to single upcoming visits of a changed pattern are replaced (the app says so before saving).
- **Deactivating a client** (`active: false`) ends all its patterns the same way (the answer's `patterns` is `[]`).
  Reactivating does not bring patterns back.
- **Deactivating a worker** sets `worker_id` to null on its patterns (in place) and on its visits with `starts_at > now` and no
  events.

### Conflicts (pure; `worker/src/conflicts.js`)
Computed for one week, per worker, over that worker's **non-cancelled** visits in the week (sorted by `starts_at`, then `id`).
Straight-line distance between the two clients' pins; **needed travel minutes** = `ceil(distance_m * 1.3 / 1000)` (1.3 × the
straight line for the road, at 60 km/h).

| kind | label | severity | when | message |
|---|---|---|---|---|
| `double_booked` | "Double-booked" | problem | two visits overlap: `a.starts_at < b.ends_at && b.starts_at < a.ends_at` (one conflict per overlapping pair) | "`<worker>` is booked for `<client a>` and `<client b>` at the same time on `<date label>`." |
| `travel_gap` | "Travel gap too short" | problem | two visits next to each other in the sorted list, same date, not overlapping, `gap_minutes < needed_minutes` | "`<worker>` has `<gap>` min between `<client a>` and `<client b>` on `<date label>`, but they are `<km>` km apart in a straight line (about `<needed>` min of driving)." |
| `over_hours` | "Over weekly hours" | problem | the sum of `scheduled_minutes` > `max_week_minutes` | "`<worker>` is booked for `<h>` h this week; their limit is `<max>` h." |
| `unavailable` | "Outside availability" | warning | a visit not fully inside that weekday's availability window (a `null` day is never available) | "`<date label>` `<time label>` is outside `<worker>`'s availability (`<availability_label>`)." |
| `outside_zone` | "Outside travel zone" | warning | the client's `zone_id` is not in the worker's `zone_ids` | "`<client>` is in `<zone>`, outside `<worker>`'s travel zones." |

Conflict object: `{ "kind", "label", "severity", "worker_id", "date" (null for over_hours), "visit_ids": [sorted], "message" }`
plus `gap_minutes`, `needed_minutes`, `distance_m` on `travel_gap` and `scheduled_minutes`, `max_week_minutes` on
`over_hours`. `<h>` in messages is hours with up to one decimal (`"39.5"`, `"40"`). For `over_hours`, `visit_ids` are the visits
from the first one whose running total passes the limit to the end of the week. Unassigned visits have no conflicts. Order:
date (nulls last), then `worker_id`, then the table's kind order, then `visit_ids`. The same input always gives the same output.

### The original-time rule (events)
`at` from the phone is kept (truncated to the second) when `server now − 7 days ≤ at ≤ server now + 10 minutes` and `at ≥
starts_at − 12 hours`. Otherwise the stored `at` is server now and `at_adjusted` is `true`. A check-out whose kept `at` is
earlier than its check-in's `at` is stored with the check-in's `at` and `at_adjusted: true` (0 seconds worked, visible to the
office to fix). `received_at` is always server now.

## Routes

### Public
- `GET /api/agency` → Agency.

### Office (`Authorization: Bearer`; 401 without a valid token)
- `POST /api/office/signin` `{ "pin": "4826" }` → 200 `{ "token", "expires_at" }`; wrong → 401 field `pin` "That PIN is not
  right."; the PIN guard applies.
- `POST /api/office/signout` → 200 `{ "ok": true }` (the token stops working).
- `PUT /api/office/pin` `{ "current", "new" }` → 200 `{ "ok": true }`; `new` is 4–8 digits (400 field `new` "Use 4 to 8
  digits."); wrong `current` → 401 field `current` "That PIN is not right." (counts toward the guard; the session stays).
- `GET /api/office/agency` → office Agency. `PUT /api/office/agency` `{ "name", "office_phone" }` → 200 office Agency
  (`name` 1–80 "Give the agency a name.", phone as above).
- `GET /api/office/clients` → `{ "clients": [Client] }` active only, by name; `?all=1` includes inactive.
- `GET /api/office/clients/:id` → Client. `POST /api/office/clients` → 201 Client. `PUT /api/office/clients/:id` → 200 Client.
- `POST /api/office/clients/:id/new-link` → 200 Client with a new `family_url`.
- `GET /api/office/workers` → `{ "workers": [Worker] }` active only, by name; `?all=1` includes inactive.
- `POST /api/office/workers` → 201 Worker. `PUT /api/office/workers/:id` → 200 Worker.
  `POST /api/office/workers/:id/new-link` → 200 Worker with a new `worker_url`.
- `GET /api/office/week?start=YYYY-MM-DD` (a Monday; else 400 field `start` "Pick a Monday.") →
  ```json
  { "week_start": "2026-09-14", "week_label": "Week of Mon Sep 14",
    "days": [ { "date": "2026-09-14", "date_label": "Mon Sep 14" } ],
    "workers": [ { "id": 2, "name": "Sam R. (SAMPLE)", "initials": "SR", "scheduled_minutes": 750, "max_week_minutes": 2250,
                   "hours_label": "12.5 h of 37.5 h" } ],
    "visits": [ "Visit…" ], "conflicts": [ "Conflict…" ],
    "distance_note": "Travel times use straight-line distance, not road time." }
  ```
  `days` has 7 entries; `workers` are the active workers by name; `visits` include cancelled and unassigned ones, by
  `starts_at` then `id`.
- `GET /api/office/day?date=YYYY-MM-DD` → `{ "date", "date_label", "server_now", "visits": [Visit] }` (the board; by
  `starts_at` then `id`; cancelled included).
- `POST /api/office/visits` `{ "client_id", "worker_id" (or null), "date", "start", "end" }` → 201 Visit (a one-off visit,
  `pattern_id` null). 400 fields `client_id` ("Pick a client."), `worker_id`, `date` ("Pick a date."), `start`, `end`.
- `PUT /api/office/visits/:id` `{ "worker_id", "date", "start", "end", "version" }` → 200 Visit (version + 1). 409 `stale`
  "This visit was changed on another screen. Reload and try again." when `version` is not current (checked first). 409
  `bad_state` "This visit has started, so it can't be moved." when it has a check-in; "This visit is cancelled. Restore it
  first." when cancelled. Assigning a worker records them in the visit's worker history (below).
- `POST /api/office/visits/:id/cancel` `{ "reason", "version" }` → 200 Visit. `reason` 1–120 ("Say why the visit is
  cancelled."). 409 `bad_state` when it has a check-in.
- `POST /api/office/visits/:id/restore` `{ "version" }` → 200 Visit (`cancelled` false, `cancel_reason` null).
- `PUT /api/office/visits/:id/times` `{ "check_in_at" (ISO or null), "check_out_at" (ISO or null), "reason", "version" }` →
  200 Visit. The office fixes a missing or wrong time: each non-null value replaces the effective event of that kind (the old
  one is voided, kept in the database) with a `source: "office"` event for the visit's worker (400 field `worker_id` "Assign a worker first." when there is none). At least one value (400 field
  `check_in_at` "Give a check-in or a check-out time."); `reason` 1–120 ("Say why the time is being fixed."); every resulting
  check-out after its check-in (400 field `check_out_at` "Check-out has to be after check-in."); both within `starts_at − 12 h`
  and `ends_at + 12 h` (400 "That time is too far from the visit."). A check-out may only be set when the visit has, or this
  call sets, a check-in.
- `PUT /api/office/visits/:id/note` `{ "shareable": true }` → 200 Visit. 404 "This visit has no note." when there is none.
  The office cannot edit the note's text.
- **Reports** (`from`, `to` NL dates inclusive; 400 field `to` "The end date has to be on or after the start date." / "Pick up
  to 62 days at a time."):
  - `GET /api/office/reports/payroll?from&to` →
    ```json
    { "from": "2026-09-01", "to": "2026-09-14", "period_label": "Tue Sep 1 to Mon Sep 14",
      "rows": [ { "worker_id": 2, "worker_name": "Sam R. (SAMPLE)", "visits": 12, "seconds": 64820, "hours": "18.01", "hm_label": "18 h 0 min",
                  "clients": [ { "client_id": 3, "client_name": "Walter G. (SAMPLE)", "visits": 4, "seconds": 21600, "hours": "6.00", "hm_label": "6 h 0 min" } ] } ],
      "total": { "visits": 40, "seconds": 190000, "hours": "52.78", "hm_label": "52 h 46 min" },
      "incomplete": [ { "visit_id": 140, "worker_name": "…", "client_name": "…", "date_label": "Mon Sep 14", "check_in_label": "9:04 AM" } ],
      "note": "Hours are check-out minus check-in, added up to the second and rounded once." }
    ```
    A visit counts for the worker of its effective check-in when it has an effective check-in **and** check-out, and the
    check-in's NL date is inside the period (cancelled or not). `incomplete` lists visits in the period with a check-in and no
    check-out. Rows by worker name; clients by client name. A worker with no counted visits is not listed.
  - `GET /api/office/reports/billing?from&to` → `{ from, to, period_label, "funders": [ { "funder_id", "funder_name",
    "visits", "seconds", "hours", "hm_label", "clients": [ { "client_id", "client_name", "visits", "scheduled_minutes",
    "seconds", "hours", "hm_label" } ] } ], "total": { visits, seconds, hours, hm_label }, "note": "Hours worked are check-out minus check-in." }`.
    Same counting rule as payroll, grouped by the client's funder; `scheduled_minutes` sums the counted visits' schedules.
    Funders by name, clients by name; a funder with no counted visits is not listed.
  - `GET /api/office/reports/missed?from&to` → `{ from, to, period_label, "rows": [ { "visit_id", "date", "date_label",
    "time_label", "client_name", "worker_name" (or null), "what": "missed" | "late", "what_label", "late_minutes" (or null),
    "check_in_label" (or null) } ] }`. `missed`: visit date in the period, not cancelled, no effective check-in, and `starts_at +
    30 min ≤ server now` ("Missed: no check-in"). `late`: visit date in the period with an effective check-in and `late_minutes ≥
    15` ("Late: checked in 22 min after the start"). By `starts_at`, then `id`.
  - `GET /api/office/reports/mileage?from&to` → `{ from, to, period_label, "rows": [ { "worker_id", "worker_name", "date",
    "date_label", "legs": [ { "from_client": "…", "to_client": "…", "metres": 28612, "km": "28.6" } ], "metres", "km" } ],
    "total": [ { "worker_id", "worker_name", "metres", "km" } ], "note": "Straight-line distance between clients, in the order
    the worker checked in. Not road distance. The drive to the first client and home from the last isn't counted." }`.
    For each worker and each NL date in the period: that worker's effective check-ins (by `worker_id` of the event) on that
    date sorted by `at`, then visit `id`; one leg between each consecutive pair (0 m when it is the same place). Day `metres` =
    sum of leg metres; `total` per worker = sum of its days. A day with fewer than two check-ins has no row.
    Rows by worker name then date.
  - **CSV:** `GET /api/office/reports/<payroll|billing|missed|mileage>.csv?from&to` → `Content-Type: text/csv; charset=utf-8`,
    `Content-Disposition: attachment; filename="home-care-<kind>-<from>-to-<to>.csv"`. CRLF line ends, no BOM, a final CRLF.
    A field is quoted when it holds a comma, a quote, CR or LF; quotes are doubled. **Formula guard:** a text field starting
    with `=`, `+`, `-`, `@`, a tab or CR gets a leading `'` (inside the quotes when quoted). Numbers as the JSON strings/integers.
    Exact headers and rows:
    - payroll: `Worker,Client,Visits,Hours (decimal),Hours and minutes,Seconds`; one row per worker × client, then
      `<worker> total,,<visits>,<hours>,<hm_label>,<seconds>` after that worker's rows; finally `Total,,<visits>,<hours>,<hm_label>,<seconds>`.
    - billing: `Funder,Client,Visits,Scheduled hours,Hours worked (decimal),Hours and minutes,Seconds`; one row per client
      (scheduled hours = decimal from `scheduled_minutes * 60` seconds), then `<funder> total,,…` per funder, then `Total,,…`.
    - missed: `Date,Scheduled,Client,Worker,What happened,Minutes late` (Worker empty when none; Minutes late empty for missed).
    - mileage: `Worker,Date,From,To,Kilometres (straight line)`; one row per leg, then `<worker> total,,,,<km>` after that
      worker's legs.

### Worker phone (`X-Worker-Key`; 401 "This link doesn't work any more. Ask the office for a new one.")
- `GET /api/worker/visits?date=YYYY-MM-DD` (optional; default today; allowed from yesterday to 6 days ahead, else 400 field
  `date` "Pick a day from yesterday to next week.") →
  ```json
  { "worker": { "id": 2, "name": "Sam R. (SAMPLE)", "initials": "SR" },
    "agency": { "name": "…", "sample": true, "office_phone": "709-555-0100", "timezone": "America/St_Johns" },
    "date": "2026-09-14", "date_label": "Mon Sep 14", "server_now": "…",
    "visits": [ { "id": 101, "client_id": 3, "client_name": "…", "client_initials": "WG", "address": "…", "lat": 49.1369,
                  "lng": -55.3701, "entry_notes": "…", "tasks": [ "Task…" ], "date": "…", "start": "09:00", "end": "10:30",
                  "time_label": "…", "starts_at": "…", "ends_at": "…", "cancelled": false, "cancel_reason": null,
                  "check_in": { "id", "at", "at_label", "location_label", "source" } , "check_out": null,
                  "tasks_done": [], "note": null } ],
    "mileage": { "metres": 14230, "km": "14.2", "note": "Straight-line distance between your check-ins today." } }
  ```
  The visits on that date **currently assigned** to this worker, by `starts_at` then `id`, cancelled ones included (the page
  shows "Cancelled by the office"). `note` here is `{ "text" }` only. Never includes family contacts, funder, other workers'
  visits or distances.
- `POST /api/worker/events` →
  ```json
  { "id": "uuid", "visit_id": 101, "kind": "check_in", "at": "ISO",
    "location": { "lat": 49.13690, "lng": -55.37010, "accuracy_m": 18 } }
  { "id": "uuid", "visit_id": 101, "kind": "check_out", "at": "ISO",
    "tasks": [ { "task_id": 11, "kind": "meal_prep", "label": "Meal preparation", "done": true } ], "note": "Ate well." }
  ```
  - `location` is optional and may be `null` → `not_shared`. Coordinates outside ±90/±180 or not finite → 400 field `location`.
    `accuracy_m` is stored, not judged. `location` on a check-out is ignored.
  - `tasks` (check-out; required, may be `[]`): ≤ 12 items, `kind` from the list, `label` 1–80, `done` boolean, `task_id`
    integer or null; stored as sent (a snapshot, so a later edit to the client's tasks never rewrites a past visit). 400 field
    `tasks` "The task list didn't come through. Reload and try again." `note` (check-out; optional): trimmed, `\r\n` → `\n`,
    ≤ 200 characters and at most 2 lines (400 field `note` "Keep the note to two short lines."); empty → no note.
  - Privacy guards apply to `note` and task labels.
  - **Who may send:** the visit's current worker, or any worker who was ever assigned to it (`visit_workers` history), so a
    phone that checked in before a reassignment still lands. Otherwise 404 "That visit isn't on your list." The event stores
    the sender's `worker_id`. A check-out from a worker other than the check-in's worker → 409 `bad_state` "Another worker
    checked in to this visit."
  - **Answers, in this order:** an `id` already stored (any visit, any worker, voided or not) → 200 `{ "duplicate": true,
    "event", "visit" }` with nothing changed. Validation → 400. A check-in when the visit has an effective check-in → 409
    `already_checked_in` "This visit already has a check-in at 9:04 AM." with `event`. A check-out with no effective check-in →
    409 `bad_state` "Check in before you check out." A check-out when one exists → 409 `already_checked_out` "This visit
    already has a check-out at 10:31 AM." with `event`. Otherwise 201 `{ "event", "visit" }` (worker-view shapes).
  - Events on a **cancelled** visit are accepted (never lose worked time): the visit stays cancelled and the office sees
    `visited_after_cancel: true`.
  - The database enforces one effective check-in and one effective check-out per visit (partial unique indexes over
    non-voided rows) and `id TEXT PRIMARY KEY`; two racing sends of the same visit leave exactly one.

### Family (`GET /api/family/:key`, no auth; 404 "This link doesn't work. Ask the agency for a new one.")
```json
{ "agency": { "name": "…", "sample": true, "office_phone": "709-555-0100" },
  "client": { "name": "Walter G. (SAMPLE)", "initials": "WG" },
  "today": { "date": "2026-09-14", "date_label": "Mon Sep 14", "visits": [ "FamilyVisit…" ] },
  "week": { "week_start": "2026-09-14", "week_label": "Week of Mon Sep 14",
            "days": [ { "date": "2026-09-14", "date_label": "Mon Sep 14", "visits": [ "FamilyVisit…" ] } ] },
  "updated_label": "Mon Sep 14, 10:40 AM" }
```
FamilyVisit: `{ "time_label": "9:00 AM – 10:30 AM", "worker_first_name": "Sam" (or null), "status", "status_label",
"arrived_label" (or null), "left_label" (or null), "tasks_done": ["Meal preparation"], "note": "…" (only when shareable, else null) }`.
- `status` / `status_label`: `left` "Arrived 9:04 AM, left 10:31 AM" · `arrived` "Arrived 9:04 AM" · `cancelled` "Cancelled" ·
  `not_checked_in` "Not checked in yet" (start has passed, today) or "No check-in recorded" (an earlier day) · `scheduled`
  "Scheduled". A cancelled visit that was visited shows its arrived/left status.
- `tasks_done`: labels of the check-out's tasks with `done: true`, in the order sent; `[]` before check-out.
- Today and the week are server-today based (tests use `X-Test-Now`). `week.days` has 7 entries.
- **Never in this answer, on any path:** entry notes, address, coordinates, distances, location labels, any phone number other
  than the agency's, family contacts, funder, cancel reasons, correction reasons, worker last names, and the text of a note
  that is not shareable. A test asserts this on the raw response text.

### Test (TEST_MODE only)
- `POST /api/test/reset` → wipes every table and seeds the SAMPLE base (agency, 3 zones, 3 funders, 5 workers, 12 clients with
  their tasks, patterns and family contacts, from `worker/src/sample-data.js`); no visits or events. Answers
  `{ "pin": "4826", "workers": [ { "id", "name", "key", "worker_url" } ], "clients": [ { "id", "name", "family_key", "family_url" } ] }`.
- `POST /api/test/seed` `{ "scenario": "demo" }` → reset, then a lived-in week relative to server now (see PLAN.md, hc1 M2).
  Same answer shape plus `"office_url"`.
- `GET /api/test/events?visit_id=` → `{ "events": [raw rows, voided included] }` so a test can count what the database holds.
  The app never calls `/api/test/*`.

## Pages (hc2)
- `/` — agency name + SAMPLE badge, "Office sign-in" button, and one line: "Workers and families use the links the office gives them."
- `/office/` — sign-in, then Today (the board), Week (planner), Clients, Workers, Reports, Settings.
- `/w/?k=<worker key>` — worker phone. Service worker `/w/sw.js`, scope `/w/`, never intercepts `/api/*`.
- `/f/?k=<family key>` — family link.
- Storage: `localStorage` `hcv:office-token`; `hcv:visits:<worker id>:<date>` (the last visits answer seen); IndexedDB
  database `home-care-visits`, object stores `queue` (events waiting to send) and `refused` (events the office would not
  accept, with its message).
- Map tiles `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with "© OpenStreetMap contributors" linking to
  https://www.openstreetmap.org/copyright, always visible. Leaflet 1.9.4 vendored in `app/public/vendor/leaflet/`.
- **Navigate** is a real link with `target="_blank"` to the client's pin (coordinates, not the address: rural addresses and
  SAMPLE clients have no street address): `https://maps.apple.com/?daddr=<lat>,<lng>&dirflg=d` on iPhone/iPad,
  `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` everywhere else.

## Clarifications

1. **(hc2 M1) Drafts on the phone.** Ticks and the note typed before check-out are kept in `localStorage`
   `hcv:draft:<visit id>` (`{ done: { <task id>: true }, note }`), so a reload in a dead zone loses nothing; the key is removed
   when the check-out is queued. The mock files (`api.mock.js`, `mock-data.js`) ship in `app/public` and load only with `?mock=1`.
2. **(hc2 M1) The queue's backoff is one shared state.** A 429/5xx/network error/timeout stops that sending pass (the
   network or the Worker is the problem, not the event); a new event, `online` or a visible tab tries again at once, the timers
   respect the backoff. A 401 on the page's own key keeps items in `queue` (never `refused`) with the link message; they send if
   the key works again. After the office accepts or refuses anything, the page reloads the visits so the server's labels replace
   "saved on this phone".
3. **(hc1 M1) Small shapes adopted.** `availability_label` follows the weekday rule (the example above is fixed: Terry O. reads
   `"Fri 12:00 PM – 8:00 PM, Sat–Sun 8:00 AM – 4:00 PM"`). The event answers (201, 200 `duplicate`, and the `event` in the two
   409s) use the **worker-view** event shape `{ id, at, at_label, location_label, source }` (with `kind` and `visit_id`); `location`
   and `distance_m` are office-only. PLAN.md's "201 with `location: near` and `distance_m`" is superseded: those are checked on the
   office view. hc1's M1 wording for the cases the tables do not give is the contract (docs/build-report-hc1.md, M1 calls 3), and
   the event route checks, in order: stored id → validation → "That visit isn't on your list." 404 → the 409s.
4. **(hc1 M1) Worker history.** `visit_workers` records the old and new worker whenever the office changes a visit's worker, the
   worker of a one-off visit, and the workers taken off visits when a worker is deactivated; the visit's current worker is always
   allowed. `PUT visits/:id` may keep a now-inactive current worker; assigning a different worker needs an active one. A pattern day
   whose start or end falls in the spring-forward gap generates no visit that day.
5. **(lead, overrules hc1 M1 call 6) Deactivating a worker never kills their link. Only "New link" does.** An inactive worker's
   key still works: `GET /api/worker/visits` answers 200 with the visits currently assigned to them (normally none after
   deactivation), and `POST /api/worker/events` accepts events under the usual who-may-send rule (the history keeps the visits they
   were taken off). A worker who is let go with check-ins still saved on their phone must be able to send them; tidying the list
   must not throw away worked time (DECISIONS 9). The office's "New link" is the way to stop a lost or former worker's phone.
6. **(hc1 review R1, DATA LOSS) A queued event counts as sent only when the Worker says so.** The event POST uses
   `redirect: 'error'` (a redirect is a network failure). A 200/201 removes the item only when the JSON body's `event.id` equals
   the queued event's id (lower-cased); any other 200/201 (a Wi-Fi login page, a proxy) is a failure: keep it and back off.
7. **(hc1 review R2, DATA LOSS) Rebuilt and removed visits are soft-removed, never deleted.** Wherever "Visit generation" says
   visits are deleted (a changed or ended pattern's future visits with no events, a deactivated client's), the Worker sets
   `removed_at` = now instead. A soft-removed visit with no effective event is invisible everywhere: week, day, worker visits,
   family, reports, conflicts and missed; office edits to it answer 404. It **still accepts events** under the who-may-send rule,
   because a phone may hold a check-in made before the change. Once it has an effective event it reappears everywhere as a
   cancelled visit with `cancel_reason` "Removed when the visit pattern changed." (or "Removed when the client was made
   inactive."), `visited_after_cancel: true`, and it counts for payroll, billing and mileage like any visited visit.
   `rebuilt_visits` counts soft-removed visits.
8. **(hc1 review R3, PAYROLL) Neither the note nor the task list ever costs a check-out.** On a check-out, a note that breaks a
   note rule (not a string, over 200 characters, more than 2 lines, the health-card guard) is not stored, and a task list that
   is malformed or refused is stored as `[]`; the check-out itself is stored, and the 201 answer adds `"note_refused": "<message>"`
   and/or `"tasks_refused": "<message>"`. A duplicate resend answers as usual. The phone shows the message on that visit
   ("Checked out. The note wasn't saved: Don't put health card numbers in this app.") until dismissed. The page also checks the
   note while typing with the same rules and disables "Yes, check out" with the message shown, so the Worker's refusal is
   normally never reached. The office sees `note: null`.
9. **(hc1 review R4, PAYROLL) A visit still open after midnight stays on the phone.** Whenever the saved lists or the queue hold
   a visit from yesterday that is checked in and not checked out, the worker page also loads `?date=<yesterday>` and shows those
   visits first under "Still open from yesterday", with their Check out.
10. **(hc1 review R5, PRIVACY) A refused link clears the saved lists.** When the page's own key answers 401, the page deletes every
    `hcv:visits:*` entry saved under that key (they hold entry notes and key-safe codes) and every `hcv:draft:*`. The `queue` and
    `refused` stores stay (clarification 2): they hold worked time and never entry notes.
11. **(hc1 review R6, PAYROLL) A refused check-in stays on its card**: "Not accepted by the office: check-in tapped at 9:04 AM.
    Call the office: 709-555-0100", with a "Check in again" button below it (a new tap is a new time; the office can set the tapped
    time with Fix times).
12. **(hc1 review R7) The worker page's service worker is network-first for its own files**: online it fetches with a 3-second
    timeout and refreshes the cache, falling back to the cache; offline it serves the cache. Precaching adds files one at a time and
    tolerates a missing optional file (the mock files), so a deploy without them still installs. It still never touches `/api/*`.
13. **(hc1 M2) Small shapes adopted** (docs/build-report-hc1.md, M2 calls 1-6): the messages; `PUT /api/office/pin` checks guard →
    `new` → `current`; an office-set event is stored for the visit's current worker; CSV `Date` columns are `YYYY-MM-DD`; names sort
    by lower-cased code units then id; the demo gives last Friday's unassigned Edna F. visit to Chris M.
14. **(hc1 M3) A visited soft-removed visit cannot be restored**: `POST /api/office/visits/:id/restore` answers 409 `bad_state`
    "This visit was removed from the schedule, so it can't be restored." (it stays cancelled with its removal reason; Fix times
    and the note toggle still work on it).
15. **(hc1 early review of the office pages, findings 1-5) Inactive people stay reachable; no invented answers.**
    - The office Workers and Clients screens load with `?all=1` and list inactive entries under an "Inactive" heading. They stay
      openable, with the Active toggle and "New link": that is the only screen where a former worker's link can be stopped
      (clarification 5).
    - The visit edit sheet's worker select always includes the visit's current worker, labelled "<name> (inactive)" when they are
      not in the active list, so saving an unrelated change never unassigns the visit (clarification 4 lets it stay).
    - The week grid and day view add a row for every worker named in `visits` who is not in `workers`, labelled
      "<name> (inactive)", so every visit is on a row and can be opened.
    - Sign out: when `POST /api/office/signout` does not answer 200, the page still clears its token and says "Signed out on this
      computer. The session couldn't be closed at the office. Sign in and out again when the connection is back."
    - No fallback answers: an office route that answers 404 or 5xx shows the API's error text; the page never rebuilds an answer
      from other routes.
16. **(hc1 review of hc2 M2c, findings 1-10) The phone survives bad networks, old links and long gaps.** Amends 9, 10 and 12.
    - **Service worker caches only the real page** (finding 1, DATA LOSS). A response is cached (at install and on refresh) only
      when it is 200, not redirected, and its `Content-Type` matches the file (`text/html` for `/w/`, JavaScript for `.js`,
      `text/css` for `.css`, `image/svg+xml` for the icon); `/w/` must also contain `<meta name="hcv-page" content="worker">`. A
      Wi-Fi login page can then never replace the worker page in the cache.
    - **Page files update as one set** (finding 10). On a navigation to `/w/`, the service worker fetches the page and every file
      it caches together; only when **all** of them arrive and pass the checks does it replace the cached set, and module requests
      are served from the cached set. A page never runs with a newer `app.js` and an older `queue.js`.
    - **No copy, no 3-second limit** (finding 3). The 3-second network race applies only when a cached copy exists; with no copy
      the service worker waits for the network.
    - **Open visits from earlier days** (findings 2 and 5, PAYROLL; amends 9). `GET /api/worker/visits?date=` accepts dates from
      **7 days back** to 6 days ahead (400 field `date` "Pick a day from last week to next week."), matching the original-time window.
      The page loads every date, up to 7 days back, for which the saved lists or the queue hold a visit checked in and not checked
      out, **whether or not today's list loaded**, and shows those visits first under "Still open from yesterday" or "Still open
      from Sat Sep 12". Offline, it builds the section from the saved lists and the queue.
    - **Drafts belong to the link they were typed under** (finding 4, amends 10). `hcv:draft:<visit id>` stores `{ key, done, note }`;
      a refused key deletes only the saved lists and drafts stored under that key.
    - **Check out without the note** (finding 6). When the note breaks a rule, the sheet keeps the message and offers "Check out
      without the note" next to the disabled "Yes, check out", so the check-out time is never delayed by the note.
    - **A refused note is remembered** (finding 7). The Worker stores `note_refused` / `tasks_refused` on the check-out event and
      repeats them in the `200 duplicate` answer, so a resend after a lost 201 still tells the worker.
    - **An old refused check-in reads as history** (finding 8). When the card also has an accepted or queued check-in, the notice
      reads "An earlier check-in at 9:04 AM wasn't accepted by the office." with a Dismiss button.
    - **Sign out after the session expired** (finding 9): a 401 from `POST /api/office/signout` reads "Signed out." like a 200.
17. **(hc1 review of hc2 M3, findings 1-8) Office time and money rules.**
    - **No silent next day** (finding 1, PAYROLL). Fix times sends each time on the visit's date. When the typed check-out is
      earlier than the check-in, the sheet shows a checkbox "The check-out was after midnight"; only when it is ticked is the
      check-out sent on the next day. Otherwise the Worker's "Check-out has to be after check-in." is shown.
    - **Presets and downloads read the moment of use** (findings 2 and 3, PAYROLL). "This week", "Last week" and "Last 14 days" are
      computed from `Date.now()` when pressed, never when the tab opened. "Download CSV" uses the dates in From and To at the moment
      of the click and shows that period first.
    - **The spring-forward gap is refused** (finding 6). A fix time that does not exist on the clocks-change day shows "That time
      doesn't exist on the day the clocks change." and is not sent.
    - **A PIN change ends every other session** (finding 4, SECURITY). A successful `PUT /api/office/pin` deletes every office
      session except the caller's, so changing the PIN locks out every other signed-in browser at once.
    - **Scheduled hours come from the Worker** (finding 5). The billing answer adds `"scheduled_hours"` (decimal string from
      `scheduled_minutes * 60` seconds, the same rounding as every hours string) on each client, each funder and the total; the
      page prints them and computes nothing.
    - **Retries are measured, not only awaited** (hc1's note on `waitEvent`). The specs that wait for a queued send also assert the
      page time it took: the first retry after one failure within 5 s of page time plus one 20 s tick, a 500 then success within the
      contract's backoff. A slow or missing retry schedule then fails instead of hiding inside minutes of fast-forwarded clock.
18. **(hc1 review of hc2 M3b, findings 1-3) The phone never waits on the network to show what it knows.**
    - **Saved list first** (finding 1, PAYROLL). The worker page renders the saved lists (today and any open earlier day) and the
      queue **before** any network call, then refreshes. Every `GET /api/worker/visits` carries `AbortSignal.timeout(8000)`; a
      timeout is a failed load, so the saved list stays with "Saved list from 7:02 AM".
    - **Dismiss hides, never deletes** (finding 2, PAYROLL). "Dismiss" on the earlier-refused-check-in notice only hides that
      notice (the dismissed `seq` is kept in `localStorage` `hcv:dismissed`). The refused item stays under "Not accepted by the
      office" until the worker taps Remove there.
    - **The Worker names the open days** (finding 3, PAYROLL). `GET /api/worker/visits` adds
      `"open_dates": ["2026-09-12"]`: the NL dates, up to 7 days before today, of visits whose effective check-in was made by this
      worker and that have no effective check-out, ascending, not counting the requested date and today. The page also loads each of
      those dates, so a visit checked in from a lost phone can be checked out from a new phone or a new link.
19. **(hc1 early review of hc2 M3c) Fix times dates each time from the event it replaces** (PAYROLL; sharpens 17).
    - A typed check-in time is dated from the stored check-in's NL date, or the visit's date when there is none. A typed check-out
      time is dated from the check-in's NL date (the stored one, or the one typed in the same save).
    - "The check-out was after midnight" is offered whenever the resulting check-out instant is at or before the check-in instant,
      and starts **ticked** when the stored check-out is already on a later date than its check-in. The same choice, "The check-in was
      after midnight", is offered when a typed check-in time is earlier than the visit's start time.
    - So an 11:00-11:55 PM visit checked in at 12:10 AM the next day gets its 12:50 AM check-out fixed on the right day.
    - Smaller: switching report tabs uses the dates typed in From and To (never silently puts back the old ones); the billing spec
      includes three 20-minute clients so printing `scheduled_hours` (0.33, 0.33, 0.33, total 1.00) is told apart from computing it.
20. **(Alexander's rule, LEAD-RULES §4, 13:10) The map background is OpenFreeMap, drawn by MapLibre inside Leaflet.** Supersedes
    the tile lines in "Pages" above.
    - Never the OSM standard tile server (its policy lets it withdraw commercial access). One config value:
      `app/public/map-config.js` exports `MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'`.
    - Vendored and pinned in `app/public/vendor/`, no CDN: `maplibre-gl@5.24.0` (`dist/maplibre-gl.js`, `dist/maplibre-gl.css`,
      LICENSE) and `@maplibre/maplibre-gl-leaflet@0.1.4` (`leaflet-maplibre-gl.js`, LICENSE), loaded after Leaflet. Pins, clicks and
      drags stay Leaflet (`L.maplibreGL({ style: MAP_STYLE_URL })` as the base layer).
    - **Attribution, always visible** in Leaflet's attribution control, exactly `OpenFreeMap © OpenMapTiles Data from OpenStreetMap`,
      with the links OpenFreeMap → `https://openfreemap.org`, © OpenMapTiles → `https://www.openmaptiles.org/`, OpenStreetMap →
      `https://www.openstreetmap.org/copyright`. Source: openfreemap.org, "Attribution is required. … you must add the following
      attribution: OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (fetched 2026-09-14, `data/sources/openfreemap-home-2026-09-14.html`).
    - **No WebGL** (an old phone, a locked-down browser, a headless engine): the map still works with a plain background, its pins
      and the same attribution, and nothing is thrown uncaught.
    - **Tests** route `https://tiles.openfreemap.org/**` to local fixtures (a minimal style, its TileJSON, empty tiles, and glyphs or
      sprites only if the fixture style names them). The network guard fails on any other host, `tile.openstreetmap.org` included. A
      spec asserts the attribution text and its three links are visible and hit-test to themselves on the Clients map at 390 and 1280
      in both engines. Negative control (m) `negative-attribution.mjs`: a copy without the attribution goes red.

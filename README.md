# Home Care Visits

The visit schedule for a small Newfoundland home support agency: workers check in and out at the client's home on their own
phones (even with no signal), families see that today's visits happened, and the office gets exact hours for payroll and for
billing each funder.

**Live (SAMPLE people only):** <https://home-care-visits.alexjpower74.workers.dev> — office PIN **4826**. Deployed 2026-09-15 on
Alexander's say-so; one Cloudflare Worker (`home-care-visits`) with a D1 database. Every screen carries a SAMPLE badge; the
worker and family links are on the office Clients and Workers screens. Source is public.

## Run it on your own computer

```sh
cd ~/Projects/"Home Care Visits" && npm run demo
```

Then open <http://127.0.0.1:7901/office/> and sign in with PIN **4826**. The demo prints a worker link for each SAMPLE worker
and a family link for three SAMPLE clients, and writes them all to `.logs/demo-links.txt`. Every client's family link is also on
the office Clients screen, and every worker's link on Workers. Ctrl+C stops it. (The overnight build left one running detached,
with its output in `.logs/demo.log`; stop that one by the PID listening on port 7901.)

Needs Node 22+ and `wrangler` 4.131+ on the PATH. The demo wipes and reseeds its own local database each time (a lived-in SAMPLE
week dated around the real date and time, so the Today board always has a late and a missed visit).

| Screen | Where | Who |
|---|---|---|
| Office: Today board, Week planner, Clients, Workers, Reports, Settings | `/office/` | the coordinator (PIN) |
| Worker phone: today's visits, Navigate, Check in / Check out, tasks, note | `/w/?k=…` | each worker, from their own link |
| Family link: today's and this week's visits | `/f/?k=…` | family members the office gives the link to |

## What it does
- **Office.** Clients with a map pin (Leaflet with OpenFreeMap tiles via MapLibre), entry/key-safe notes, care tasks (medication **reminder** only),
  repeating visit times and family contacts. Workers with availability, travel zones and weekly hours. A **week planner** where
  visits are dragged onto workers and conflicts show up: double-booked, travel gap too short (straight-line distance × 1.3 at 60
  km/h), over weekly hours, outside availability, outside travel zone. A **Today board** where a visit not checked in 15 minutes
  after its start turns amber and at 30 minutes red, with the worker's number to call. **Reports**: hours per worker (payroll),
  hours per client per funder (billing), missed and late visits, straight-line mileage, each with CSV. **Fix times** with a
  reason, "New link" for a lost phone, and a family-note switch.
- **Worker phone.** Today's visits in order, Navigate to the client's pin, Check in (with an optional "within 250 m" location
  check that never blocks the visit), the task checklist, a two-line note, Check out. **Works offline**: every tap is saved on
  the phone first with the time it was tapped and sent when signal comes back; nothing the office refuses is ever dropped
  silently. A visit still open after midnight, or from an earlier day, keeps its Check out.
- **Family link.** Unguessable per client. Arrived and left times and the tasks done; a note only when the office marks it
  shareable. No entry notes, addresses, locations or phone numbers other than the agency's. Nothing is emailed or texted: the
  office copies the link.

## Real vs SAMPLE
- **SAMPLE:** the agency ("SAMPLE Exploits Home Support (demo)"), its 5 workers and 12 clients, their phone numbers (the fictional
  709-555-01xx range), key-safe codes, notes, funders and every visit. Every screen shows a SAMPLE badge.
- **Real:** the six community points the SAMPLE pins sit near (Grand Falls-Windsor, Bishop's Falls, Norris Arm, Botwood,
  Peterview, Northern Arm), from Natural Resources Canada's Geographical Names service (Open Government Licence - Canada), saved
  raw in `data/sources/`. No client has a street address; each pin is a stated offset in metres from its community point.
- **No AI and no paid services.** Model spend: CA$0.

## Tests
**Final QA** (lead, QA worktree pinned to `ab47a00`, one run, nothing re-run to green):
- Worker: unit tests 23 passed / 0 failed / 0 skipped; API tests 71 / 0 / 0.
- Playwright, chromium + webkit at 390 and 1280, real taps against the real Worker: **224 passed / 0 failed / 4 skipped**. The 4 skips
  are two offline tests WebKit cannot run under Playwright (it cannot reload a page while offline), each with its reason in the test;
  Chromium runs both.
- Negative controls, each passing on an unbroken copy and then going red on its broken copy: 17 Worker controls and 14 app control
  scripts (13 lettered controls plus the proofs script, every proof red). Every run and every control is in `docs/build-report.md`.

```sh
cd worker && npm test          # unit + API tests against a local TEST_MODE Worker (port 7902)
cd worker && npm run negative  # Worker negative controls: each breaks a copy and must go red
cd app && npx playwright test  # chromium + webkit, 390 and 1280, real taps, against the real Worker (port 7903)
cd app && npm run negative     # app negative controls and proofs
```

## Deployment (done 2026-09-15; details in `docs/DEPLOY.md`)
- Cloudflare: Worker `home-care-visits` serving the API and the app, D1 database `home-care-visits` (migrations applied with
  `wrangler d1 migrations apply home-care-visits --remote`: a deploy does not migrate). No secrets, no cron, no `TEST_MODE`.
  The `workers.dev` address is HTTPS, which the offline mode and location check need.
- Before a real agency uses it: change PIN 4826, rename the agency, start without the SAMPLE people, **never set `TEST_MODE`**.
  The map uses OpenFreeMap (free, commercial use allowed, no SLA); keep its attribution, and if an SLA is ever needed point the one
  style URL in `app/public/map-config.js` at a paid provider.
- Outside the code, because this is personal health information under NL's PHIA: a privacy impact assessment and the agency's
  privacy officer's sign-off, client consent for family links, worker notice about the location check, a retention period with
  scheduled clean-up, backups the agency controls, and named office accounts (v1 has one shared PIN).

## Where to pick this up
- Read `PLAN.md` (the build contract), `docs/API.md` (the Worker/app contract and its clarifications), `DECISIONS.md` (every call
  made overnight, with why), then `docs/build-report.md`.
- Known gaps (product): one shared office PIN and no access log; zones and funders are fixed by the seed; straight-line
  distances, not road routing; no pay or billing rates (hours only); no scheduled data retention; one deployment per agency.
- Known gaps (found in cross-review, judged safe to leave tonight; none loses a tap or pays wrongly, DECISIONS 45 and 52):
  - For a few seconds after a send on a slow line, a card can offer Check in or Check out again; a second tap is refused
    ("wasn't accepted") and nothing is lost.
  - A lost phone opened after "New link" shows the saved entry notes until the Worker's refusal arrives (offline, until it has
    signal). They were already on the phone.
  - In Fix times, the "after midnight" box does not untick itself when the time is corrected back to the same evening; the Worker
    then refuses the time as too far from the visit.
  - Service worker edge cases: two quick reloads racing a background refresh can make a page fetch a module from the network; a
    browser that leaves `resultingClientId` unset can mix a new set with an old page; install fails behind a Wi-Fi login page until a
    later good load; with no cached copy a stalled connection waits for the browser's own timeout.
  - Drafts saved by builds before this one carry no link key and are never cleared by a refused link; `hcv:dismissed` only grows.
  - After the phone's browser restores the worker page from its back/forward cache, the first refresh can fail at once and the
    page keeps showing its saved list until the next online event, visible tab or send.
  - WebKit under Playwright cannot reload a page while offline or read the clipboard; those steps are skipped there with written
    reasons (Chromium runs them).

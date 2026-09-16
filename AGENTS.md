# Home Care Visits

For a small home support agency in Newfoundland: the visit schedule for home support workers, check-in and check-out
at the client's home, a short visit note from a task checklist, a family link showing that today's visits happened, and
hours per worker (payroll) and per client per funder (billing). Overnight build 2026-09-14, lead `hc-lead`, slices `hc1`
(Worker) and `hc2` (app).

Read PLAN.md first (the Rig contract), then docs/API.md (the contract between slices), then DECISIONS.md.

## Stack and ports

- `worker/`: Cloudflare Worker, plain JS ESM, no build, no npm deps (`wrangler` on PATH, 4.131+). D1 binding `DB`
  (`home-care-visits`). Serves `/api/*` (Worker first) and the static app in `app/public/`.
- `app/public/`: plain HTML/JS/CSS, no build. `/office/` coordinator (PIN) · `/w/?k=` worker phone · `/f/?k=` family link.
- `app/tests/`: Playwright 1.63, chromium + webkit, 390 and 1280, against the real Worker.
- Ports: hc1 Worker 7902 (inspector 7912), hc1 negative controls 7905 (inspector 7915) · hc2 dev Worker 7901 (inspector
  7911), e2e Worker 7903 (inspector 7913), app negative controls 7906 (inspector 7916) · QA 7909 (inspector 7919) ·
  `npm run demo` 7901. Always pass `--inspector-port`: other crews run wrangler too and the default 9229 collides.
- SAMPLE coordinator PIN `4826`.

## Rules that bite here

- **Deploys only when Alexander says so (he did on 2026-09-15).** Live: <https://home-care-visits.alexjpower74.workers.dev>, one
  Worker + D1 `home-care-visits`. Day to day use `wrangler dev --local`. Never `--var TEST_MODE:1` on a deploy that stays up.
- **Public repo.** `check-no-personal-data .` must print clean before every push.
- **Nothing is sent.** No SMS or email. Family links and messages are "Copy link" / "Copy text" buttons only.
- **SAMPLE only, labelled on every screen.** Agency "SAMPLE Exploits Home Support (demo)". Clients and workers are SAMPLE
  people with initials avatars, SAMPLE phone numbers in the fictional 709-555-01xx range, and no street addresses: pins sit
  near real community points (NRCan geographical names).
- **Privacy is a feature.** No health card numbers, no diagnoses field, no medication administration: the medication task is
  a *reminder* only. The family link never shows entry/key-safe notes, phone numbers, locations or a note the coordinator has
  not marked shareable.
- **Times are NL time** (`America/St_Johns`, DST aware). A check-in or check-out keeps the time the worker tapped, not the
  time it synced. Payroll seconds are summed exactly and rounded once, on the total.
- **Location never blocks a visit.** "Within 250 m of the client", "More than 250 m from the client", or "Location not shared".
- **Distances are straight-line**, and every screen that uses one says so.
- **Map background:** OpenFreeMap vector tiles (style URL in `app/public/map-config.js`) drawn inside Leaflet through MapLibre GL
  JS + `@maplibre/maplibre-gl-leaflet`, vendored and pinned; never the OSM standard tile server (Alexander, 2026-09-14). Attribution
  "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" always visible. Tests never fetch real tiles (API.md clarification 20).
- Worker-phone tap targets are at least 48 px (56 px for Check in / Check out).
- Own only your slice's paths; `rig guard` enforces it. Verify → commit (own paths) → report.
- Every important check has a negative control: break a copy, watch it go red, restore, record it.
- Plain English for Newfoundland users. No emoji as icons. No devils or demons.

## Standing rules (every project, read by Claude Code and Codex alike)

CLAUDE.md is a symlink to this file, so Onyx (Claude Code) and Cobalt (Codex) read the same text. Edit AGENTS.md only.

- **Read PLAN.md first where it exists; it is the contract.** Own only your slice's files.
- **What "done" means:** verified, committed (only your own paths, with a message that says what and why), pushed, and shown: a screenshot via `pwshot` for anything visible. Never hand back an empty screen; seed demo data if the UI needs it. Never leave a green step uncommitted.
- **Nothing leaves without Alexander.** Emails, forms, applications, posts, marketplace submissions and pull requests to other people's repos are staged to one click; he presses send.
- **Tests that cannot lie.** A bug that reached a person gets a test that fails without the fix, proved by reverting the fix. Every guard (grep, lint, check) is shown to fail on a known-bad input in the same run: a check that cannot fail measured nothing. Real dependencies over mocks where practical. Hit-test with elementFromPoint, never rects.
- **Public-repo hygiene.** No secrets, no machine names, no home-folder paths, no invented businesses. Real businesses appear only where Alexander chose to show them. Run `check-no-personal-data` before pushing a public repo.
- **Browser work.** Playwright is the default; WebKit check before calling a WKWebView page done; the Chrome extension only for pages that need his real login.
- **Keep this file short:** commands, gotchas with a why, hard rules. Architecture belongs in the code and README.

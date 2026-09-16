# Deploying Home Care Visits

**Deployed 2026-09-15** (Alexander's go) as a SAMPLE demo:
- App and API: <https://home-care-visits.alexjpower74.workers.dev> (Worker `home-care-visits`, `workers.dev` route, no custom domain).
- D1 database `home-care-visits`, id `c953b098-c785-4643-b6f1-ede37553d4fd`, migrations 0001–0004 applied `--remote`.
- No secrets, no cron, no `TEST_MODE`. The SAMPLE fortnight was seeded once by deploying with `--var TEST_MODE:1`, calling
  `POST /api/test/seed {"scenario":"demo"}`, then redeploying without the var (the test routes now answer 404). To reseed, repeat
  those three steps; the demo dates itself relative to the seed time, and later days are generated lazily from the patterns.

The rest of this page is the checklist for a real agency. One deployment serves one agency.

## Cloudflare pieces
| Piece | Name | Notes |
|---|---|---|
| Worker | `home-care-visits` | `worker/wrangler.toml`; serves `/api/*` and the static app in `app/public/` |
| D1 database | `home-care-visits` | `wrangler d1 create home-care-visits`, then put its id in `worker/wrangler.toml` (the file holds a placeholder id) |
| Migrations | `worker/migrations/` | `wrangler d1 migrations apply home-care-visits --remote`. **A deploy does not migrate**; run this before the first deploy and after any new migration, then smoke-test a real request |
| Secrets | none | The PIN is stored hashed in D1 |
| Cron | none | Visits are generated lazily from patterns when a week is read |
| Domain | Alexander's call | HTTPS is required: the worker page's offline mode (service worker) and location check only work on HTTPS |

## Before the first real agency uses it
1. **Change the office PIN** from the SAMPLE `4826` (Settings, or `PUT /api/office/pin`).
2. **Rename the agency** (Settings). The SAMPLE badge disappears only when the name no longer contains `SAMPLE`.
3. **Remove the SAMPLE workers and clients.** Production starts from `0002_agency.sql` (the agency row, zones, funders, PIN);
   the 5 SAMPLE workers and 12 SAMPLE clients only come from the TEST_MODE routes. Set the real zones and funders in a new
   migration (they are fixed by the seed in v1; there is no screen for them).
4. **Never set `TEST_MODE`** on a deployed Worker. With it, anyone can reset the database (`/api/test/reset`) and fake the
   clock with a header. `wrangler.toml` must not have it in `[vars]`; the demo sets it on the command line only.
5. **Map tiles.** The office map draws OpenFreeMap vector tiles (free, commercial use allowed, no key, no usage limits, no SLA)
   through MapLibre inside Leaflet, never the OSM standard tile server. The style URL is one value in `app/public/map-config.js`;
   if an SLA is ever needed, point it at a paid provider's style or a self-hosted OpenFreeMap. Keep the attribution
   "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" visible.

## What a real deployment needs outside the code (home care is health information)
- **PHIA review.** In Newfoundland and Labrador, visit records, care tasks and notes about a client are personal health
  information under the *Personal Health Information Act*. The agency is the custodian. Before real use: a privacy impact
  assessment, the agency's privacy officer's sign-off, and a written agreement with whoever hosts it (Cloudflare is the
  processor; D1 data location and backups should be confirmed for the agency's policy).
- **Consent and notice.** Clients (or their substitute decision-makers) agree to the family link, and to whom it is given.
  Workers are told their check-in location is compared with the client's pin (the app stores distance and accuracy, never a
  track) and that it never blocks a visit.
- **Retention.** Decide how long visit records, notes and events are kept (payroll and funder audits often need several years)
  and add a scheduled clean-up for anything past it. There is none in v1.
- **Backups.** D1 has Time Travel (point-in-time restore for a limited window); a regular export to storage the agency controls
  is still needed for longer retention.
- **Access.** v1 has one shared office PIN and no per-coordinator accounts or audit log of who viewed what. A real agency will
  likely need named accounts (Cloudflare Access in front of `/office/` is the quickest path) and an access log.
- **Lost phones.** The office's "New link" stops a worker link at once; the worker page holds today's list (with entry notes)
  in the browser's storage until it is next loaded, so a lost phone should be followed by a new link.

## Local run (what tonight used)
See README.md: `npm run demo` → <http://127.0.0.1:7901/office/> (PIN 4826).

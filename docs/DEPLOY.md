# Deploying Home Care Visits (not done tonight)

Nothing has been deployed. Everything so far ran locally with `wrangler dev --local`. This page lists what a real deployment
needs, for Alexander to decide on. One deployment serves one agency.

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
5. **Map tiles.** The office maps use OpenStreetMap's standard tiles, which are fine for one office's light use under the
   OSM tile usage policy. A product sold to many agencies should use a tile provider with its own terms.

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

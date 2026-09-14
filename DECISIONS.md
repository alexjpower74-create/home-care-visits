# Decisions (Home Care Visits)

Calls made without Alexander, newest at the bottom. Each says what and why.

## 2026-09-14, lead (contract)

1. **The SAMPLE map data comes from NRCan, not OpenStreetMap's Overpass API.** The lead first ran three Overpass street
   queries (overpass-api.de `/api/interpreter`, 3 requests, 12:08–12:09 UTC) and only then read that host's robots.txt, which
   says `Disallow: /api/` for every agent. That broke the sprint rule to respect robots.txt, so the responses were deleted
   unused (the robots.txt stays in `data/sources/` as the record). Nominatim search, Geofabrik extracts and planet.osm are also
   disallowed for bots, and the OSM editing API is for editing. NRCan's Geographical Names service (`/services/geoname/…`,
   allowed by geogratis.gc.ca's robots.txt, Open Government Licence - Canada) gives real community points. *Found for other
   projects:* Snow Route's `data/sample-clients.json` names `overpass-api.de/api/interpreter` as its source (not touched).
2. **SAMPLE clients have no street address.** Each pin is a stated offset in metres from a real Exploits community point
   (Grand Falls-Windsor, Bishop's Falls, Norris Arm, Botwood, Peterview, Northern Arm), and the address reads "Botwood, NL
   (SAMPLE: no street address)". A pin is then nobody's home, and the long rural drives between towns (Botwood to Grand
   Falls-Windsor is about 28 km in a straight line) make the travel-gap rule mean something.
3. **One deployment per agency; one Worker serves the API and the app** (same origin, no CORS), as in the sibling builds.
4. **Workers get a secret link each, not a login.** They use their own phones, often in poor signal; typing a password at a
   client's door is the wrong tool. The office copies the link and can make a new one (the old one stops at once) when a
   phone is lost. The office side uses one PIN; per-coordinator accounts and an audit trail are a known gap.
5. **Navigate uses the client's pin coordinates**, not the address text: rural NL addresses geocode badly and SAMPLE clients
   have none. Apple Maps on iPhone/iPad, Google Maps directions everywhere else.
6. **Late and missed are one pure rule, used twice.** The Worker computes `alert` with server now for the API and reports; the
   office board recomputes it from the page's clock every 15 seconds. That is what a coordinator watching the board needs
   (amber appears at 15:00 without a reload), and it lets the brief's fake-clock test drive the real page.
7. **Visits are generated lazily from patterns and never rewritten once started.** Patterns carry `valid_from_at` /
   `ended_at`; editing one ends it and rebuilds only future visits with no events. Otherwise adding a pattern on a Wednesday
   would invent missed visits on Monday and Tuesday, and an edit could rewrite a visit that was already worked.
8. **No Undo on the worker's phone. The office fixes times instead, with a reason.** Snow Route's cross-reviews found most
   of their 51 defects in phone-side Undo races (lost undos, voided pushes, two tabs). Here a wrong check-in costs one call to
   the office, which sets the right time with a reason; the phone's event is voided, not deleted. Check-out asks "Check out
   now?" first, so the common mistake is caught at the door.
9. **Worked time is never refused.** A check-in from a worker who was assigned earlier (before a reassignment) is accepted,
   and so is one on a visit the office cancelled while the phone had no signal (`visited_after_cancel`). Payroll follows the
   worker who actually checked in.
10. **The phone's time is kept inside a window** (7 days back, 10 minutes ahead, not more than 12 hours before the visit's
    start); outside it the Worker stores server now and flags `at_adjusted`. A check-out earlier than its check-in is stored at
    the check-in time, flagged, for the office to fix. A bad phone clock can then never produce negative hours.
11. **Hours are exact seconds, rounded once.** Durations are summed as integer seconds; decimal hours are rounded half up
    from a row's (or the total's) seconds, never by adding rounded rows. No pay or billing rates: the brief asks for hours, and
    rates differ by funder contract.
12. **Mileage is straight-line, in check-in order, between clients only.** Workers' home addresses are not stored (their
    privacy), so the drive to the first client and home from the last is not counted; every screen says "straight line".
13. **Travel allowance = 1.3 × straight-line distance at 60 km/h** (`ceil(metres × 1.3 / 1000)` minutes). Road factors of
    1.2–1.4 are typical for rural road networks; the screen says the times use straight-line distance, not road time.
14. **Five conflict kinds: the brief's three are problems, availability and travel zone are warnings.** The brief asks for
    availability and travel zone on each worker, so the planner uses them, but a coordinator may knowingly send a worker
    outside their usual zone.
15. **Privacy is enforced by the Worker, not only by the forms.** A 12-digit guard refuses health-card-like numbers in every
    free-text field; a wording guard refuses tasks that record medication given; the family answer is built from an allow-list
    and a test searches its raw text for everything that must never appear.
16. **The family link says "Not checked in yet", never "missed",** and names the worker by first name only. A worker in a dead
    zone may have checked in on the phone already; a family reading "missed" would phone in a panic.
17. **Location waits at most 8 seconds, with a Skip button, and never blocks.** The time is taken at the tap; the page then
    asks the phone for its position (GPS works with no signal) and writes the event with or without it.
18. **Weeks run Monday to Sunday**; zones and funders are fixed by the seed in v1 (editing them is a known gap).
19. **Demo data is dated relative to the real date and time**, so the board always has one amber and one red visit when the
    demo starts, whatever the hour.
20. **Crew shape.** Two slices (the maximum tonight): hc1 owns `worker/**` (API, D1, rules, reports), hc2 owns `app/**`
    (pages, offline queue, Playwright). Milestones with a cross-review after each Worker milestone, as Snow Route did, but with
    the contract settled up front on the things that went wrong there (Undo, re-keying, two tabs).

## 2026-09-14, lead (after hc2 M1, merged 10:25)

21. **hc2's five M1 calls are adopted** (API.md clarifications 1-2): one shared backoff, drafts in `hcv:draft:<visit id>`,
    reload after the office answers, a refused page key keeps items queued, mock files ship behind `?mock=1`.
22. **On the worker phone only the sync strip sticks; the header scrolls away.** In the M1 screenshots at 390 the sticky
    header and strip took about a third of the screen, on the page a worker uses one-handed at a door. The strip is the
    part that must always be visible.
23. **hc2 starts M2's Worker-independent parts while hc1 finishes M1** (Playwright config, start-worker, helpers, the office
    pages written to the contract), and runs nothing against a mock. Two slices waiting on each other would waste the
    parallel time; the contract is detailed enough that office pages written to it should need small fixes, not rework.

## 2026-09-14, lead (after hc1 M1, QA at `7d50ed2`, merged 10:40)

24. **hc1 M1 is merged on the lead's own pinned run**: unit 23/0/0, API 48/0/0 (QA worktree on 7909), plus hc1's five negative
    controls each red after passing on an unbroken copy. hc1's calls 1-5 and 7-10 are adopted (API.md clarifications 3-4).
25. **Deactivating a worker never kills their link** (API.md clarification 5, overrules hc1's call 6). The obvious tidy-up
    (mark a departed worker inactive) would otherwise strand every check-in still saved on their phone, which is exactly the
    worked time payroll owes them. "New link" is the deliberate way to stop a phone.
26. **The cross-review of hc1 M1 is folded into hc2's Part B**: before running its suite against the Worker, hc2 reads hc1's
    handlers for every route it calls and writes any mismatch with API.md in its report. hc1 reviews hc2's queue and API calls
    read-only after hc1's M2, because the phone queue is where data can be lost.

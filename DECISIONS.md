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

## 2026-09-14, lead (after hc1 M2, QA at `f74b413`, merged 10:58)

27. **hc1 M2 is merged on the lead's pinned run**: unit 23/0/0, API 62/0/0; hc1 recorded 11 negative controls red (the lead
    re-runs every control in the final QA, not per merge).
28. **All seven of hc1's review findings on the phone pages are adopted** (API.md 6-12). Two were real data-loss paths across
    the slice boundary that neither slice's own tests could see: a captive-portal 200 deleting a queued check-out, and a pattern
    rebuild deleting a visit a phone had already checked in to. Every defect so far crossed a boundary, as on Snow Route.
29. **Soft-remove, not "leave the next 12 hours alone".** The phone's queue may send days late (the original-time rule allows 7
    days), so any time window would still lose some check-ins; a removed-but-reachable visit loses none, and it only shows up
    again when someone actually worked it.
30. **A note never costs a check-out.** The Worker stores the check-out and reports the note's refusal, rather than refusing the
    whole event: payroll hours outrank a note, and the page's own check while typing keeps the refusal rare. The same for a bad task
    snapshot.
31. **Work split from here.** hc1 M3: the Worker side of clarifications 7 and 8 with tests and negative controls (l) and (m), then a
    read-only review of hc2's office pages once they are on main. hc2, after Part B: M2c = the page side of clarifications 6 and
    8-12 with specs and a captive-portal negative control, then M3.

## 2026-09-14, lead (after hc1 M3, QA at `f367d7d`, merged 11:05)

32. **hc1 M3 is merged on the lead's pinned run**: unit 23/0/0, API 66/0/0, controls (a)-(m) recorded red by hc1. hc1's restore
    message is adopted (API.md 14).
33. **hc1 reviews hc2's office pages early, from the committed branch**, while hc2 is still running Part B. Snow Route's
    early review on a commit still being written found six real findings (their DECISIONS 32); reading `rig/hc2` with
    `git show` keeps the review stable while hc2's worktree changes.

## 2026-09-14, lead (after hc1's early review of the office pages, 11:12)

34. **All of hc1's office findings are adopted** (API.md 15) and go to hc2 as M2c together with the phone-page clarifications
    6 and 8-12 and the five spec gaps. The spec gaps matter most: four specs would have passed a broken product (a check-out
    stamped with the check-in's time, a client form dropping the pattern's worker, a conflict losing its red edge and word, a
    queue deleting on a captive portal's 200). Each gets an assertion that fails without the fix.
35. **The remaining page work stays in hc2's slice; hc1 waits for the next review round.** Moving office files to hc1 mid-build
    would split `app/**` ownership that `rig guard` checks by glob, and the weekly usage budget is at 70%, so an idle reviewer is
    the cheaper choice.

## 2026-09-14, lead (pinned e2e QA of main `866ee71`, 11:22)

36. **A red pinned run is fixed, never re-run to green.** The first lead run of the whole Playwright suite on integrated main
    gave 64 passed / 2 failed. Both failures are specs whose result depends on how fast the machine is: one lets the page clock
    run in real time between clock steps, the other freezes `Date.now()` so a single transient failure stalls the queue's retry
    forever. Neither is a product defect, but a check that can fail for the wrong reason can also pass for the wrong reason.
    hc2 fixes both (pause the clock; step it until the answer arrives) before M3, and the final QA must be one clean run.

## 2026-09-14, lead (after hc1's review of hc2 M2c, 11:50)

37. **All ten findings are adopted** (API.md 16). The third review round still found a DATA LOSS path (the service worker caching
    a Wi-Fi login page as the worker page, so a dead zone gets a page that cannot check in), which is the same failure as R1 one
    layer lower. The phone's offline promise is only as good as its weakest cache.
38. **Drafts are tied to the key they were typed under, not the worker.** Keying by worker id would still delete the drafts in
    hc1's scenario (the same worker holding an old and a new link), so the draft remembers its key and only that key's refusal
    removes it.
39. **The worker list reaches back 7 days, like the original-time rule.** A phone that died at a door on Saturday and comes back
    on Monday must still offer Check out for Saturday's visit; the Worker already accepts its times for 7 days, so the list must
    reach as far.
40. **Work split.** hc1 M4: the Worker side of 16 (7-day date range, `note_refused`/`tasks_refused` stored and repeated on a
    duplicate) with tests and a negative control. hc2 M3b, after M3: the page side of 16, plus the proof gaps hc1 named
    (a check-in still queued across midnight, an offline reload after midnight, two keys on one phone, the "Check in again"
    button, the inactive proofs at 390, and a login page poisoning the cache).

## 2026-09-14, lead (after hc1's review of hc2 M3, 12:18)

41. **All eight M3 findings are adopted** (API.md 17). Three were payroll mistakes a coordinator could make with no warning (an
    AM/PM slip stored as a 14-hour overnight shift, "Last week" meaning the week before last in a tab left open over the weekend, a
    CSV for a different period than the one typed), and one was a security gap the contract itself had: changing the PIN did not
    lock anyone out.
42. **A PIN change ends every other session.** The only reason an office changes a shared PIN is to lock someone out; leaving
    their browser signed in for 14 days would make the change look done when it is not.
43. **The retry schedule is asserted in page time.** hc2's clock-stepping helper made the tests honest about eventually-sent events
    but hid how long a retry takes (up to about 23 minutes of phone time). The contract names the backoff, so the specs measure it.
44. **Work split.** hc1 M5 (now): the Worker side of 17 (sessions on PIN change, `scheduled_hours`) with tests and a negative
    control. hc2 M3c, after M3b: the page side of 17 and the two spec gaps (badge hidden after a rename without SAMPLE; presets on a
    fall-back Sunday night that is already Monday in UTC).

## 2026-09-14, lead (after hc1's review of hc2 M3b, 12:55)

45. **The three payroll findings are fixed tonight; the service-worker edge cases are known gaps** (API.md 18; the gaps are listed in
    docs/build-report-hc1.md and README). The fixed three are ordinary days for a home support worker: one bar of signal at the door,
    tapping Dismiss on a notice, a lost phone replaced on Monday. The known gaps need two reloads racing a background refresh, or a
    browser that leaves `resultingClientId` unset, and they fall back to the network rather than losing a tap.
46. **The Worker tells the phone which days are still open** (`open_dates`), rather than the phone guessing from what it saved.
    Only the Worker knows about a check-in made on a phone that no longer exists, and payroll's incomplete list is otherwise stuck
    until the office uses Fix times.
47. **Work split, final rounds.** hc1 M6: `open_dates` with tests and a negative control. hc2 M3d, after M3c: saved list first with
    the 8 s limit, Dismiss that hides, and loading `open_dates`, each with a spec. Then the lead's final QA.

## 2026-09-14, lead (after hc1's early review of hc2 M3c, 13:05)

48. **A fixed time is dated from the event it replaces, not the visit** (API.md 19). Night visits that run past midnight are normal
    in home support (bedtime routines), and dating every typed time from the visit's date made a post-midnight check-in impossible to
    complete, leaving the visit in payroll's incomplete list. It joins M3d with clarification 18's page side, hc1's smaller notes and an
    `npm run negative` script in `app/package.json` (the README names it). M3d is the last app round; anything found after it goes to
    the known gaps unless it can lose a check-in or pay someone wrongly.

## 2026-09-14, lead (after hc1's diagnosis of the webkit-390 failure at `6cb9e81`, 13:47)

49. **The one red test in the pinned run at `6cb9e81` was the spec, not the app, and it is fixed in the spec, never filtered in the
    fixture.** hc1 reproduced it (2 in 15 runs) and traced it: the worker page's refresh after a check-in was still loading when the
    spec navigated to the office, WebKit logs its own "Fetch API cannot load … due to access control checks." console error while the
    page unloads, and Playwright's WebKit backend reports every such console error as a `pageerror`. The request's rejection is
    handled, and a dropped request on a phone that is not navigating never produces it. The spec waits for the refresh ("All sent"
    and the server's check-in) before leaving `/w/`; filtering the text in the fixture would hide a real uncaught error with a
    similar message. The page also aborts its visits requests on `pagehide` (hc1's optional hardening), so an unloading page cancels
    its own fetch. This is hc2's M3e, then the final QA.

## 2026-09-14, lead (new sprint rule on maps, relayed from Onyx, 13:52)

50. **Maps move to OpenFreeMap through MapLibre inside Leaflet** (LEAD-RULES §4, Alexander's call 13:10; API.md clarification 20).
    The rule was checked in LEAD-RULES.md before acting on the relayed message. The attribution wording comes from openfreemap.org
    itself ("Attribution is required … OpenFreeMap © OpenMapTiles Data from OpenStreetMap"), because the live Liberty style carries
    no attribution field and the Leaflet binding does not add one. `maplibre-gl` is pinned at 5.24.0, the newest 5.x, because
    OpenFreeMap's quick start loads MapLibre 5; `@maplibre/maplibre-gl-leaflet` 0.1.4 supports it. A browser without WebGL keeps a
    working map with pins and attribution, since a coordinator's old office PC must still be able to place a pin. It goes to hc2 with
    M3e; the lead updates AGENTS.md, README.md and docs/DEPLOY.md.

## 2026-09-14, lead (after hc1's review of hc2 M3d, 14:32)

51. **The worker list follows the check-in, not only the assignment** (API.md 21). Two earlier calls were each right on their own:
    events are accepted from a worker assigned earlier (DECISIONS 9), and only the worker who checked in may check out. Together
    they left a visit that nobody could finish when the office reassigned it while the worker was checking in. The fix belongs in
    the Worker (hc1 M7, with a negative control); the page already draws whatever the list returns.
52. **hc1's smaller M3d notes are known gaps, not fixes tonight.** None loses a tap or pays wrongly: a card offering Check out again
    for a few seconds after a send is refused 409 on a second tap; an "after midnight" box left ticked sends a time the Worker refuses;
    entry notes on a lost phone show until the 401 arrives (they were already on the phone offline). They are listed in the README.

## 2026-09-14, lead (after hc1's review of hc2 M3e, 15:30)

53. **The OpenFreeMap move passed review with nothing to fix**: vendored MapLibre 5.24.0 and the Leaflet binding 0.1.4 match the
    packages byte for byte with their licences beside them, the attribution is exact, no OSM tile URL is left, and a scratch run
    showed MapLibre's web-worker tile fetches cannot slip past the test routes.
54. **Two test-honesty gaps go to hc2 as a tiny M3g; the bfcache refresh gap stays a known gap.** The map spec only checked MapLibre
    when it happened to load, so a regression that drops every browser to the plain background would still pass; and the network
    guard did not fail on an OpenFreeMap request no route answered. Both are checks that could not fail. The back/forward-cache case
    only delays a refresh (the saved list shows), so it is written in the README instead.

## 2026-09-14, lead (final QA attempt 1 at `b51d4b1`, 16:35)

55. **The first final QA is not called green.** Everything else passed (Worker 23 + 71, 17 Worker controls, 14 app control scripts
    with every proof), but one Playwright test failed on chromium-1280: the across-midnight spec tapped Check out while the "Still
    open from yesterday" card was being redrawn from the saved list to yesterday's answer. It is the redraw race hc2 already fixed in
    the Saturday spec, so the spec waits for the answer; and because a real worker's tap at that instant would also be swallowed, hc2
    checks whether an unchanged card is being replaced and keeps the node if so (M3h). The final QA then runs again from a clean pin.

## 2026-09-14, lead (final QA, 17:23)

56. **The final QA is green at `ab47a00`**: Worker 23 + 71, Playwright 224 passed / 0 failed / 4 skipped, 14 app control scripts
    red. The 17 Worker controls are carried over from attempt 1 rather than re-run, because `worker/` has no diff since `b51d4b1`
    (checked in the QA script itself); everything that changed was run again from a clean pin. Nothing was deployed, sent or
    submitted, and no model API was used (CA$0).

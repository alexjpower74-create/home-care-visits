# Home Care Visits — brief (Onyx, 2026-09-14)

**Prefix** `hc` · **Ports** app 7901, worker 7902, QA 7909 · **Repo** `home-care-visits` (private) · **Lead effort** xhigh

## What
For a small home support agency in Newfoundland: the visit schedule for home support workers, check-in and
check-out at the client's home, a short visit note from a task checklist, a family link showing that today's
visits happened, and hours per worker per client for payroll and for billing the funder. Rural NL: bad signal,
long drives, workers on their own phones.

## Coordinator side (PIN)
Clients: name, address as a map pin (Leaflet + OSM, attribution), key-safe/entry notes, care tasks list
(personal care, meal prep, medication **reminder** only — the app never records medication administration),
visit pattern (e.g. Mon/Wed/Fri 9:00–10:30), family contacts. Workers: availability, travel zone. Week
planner: drag visits onto workers; conflicts shown (double-booked, travel gap too short by straight-line
distance, over weekly hours). Missed/late visit board: a visit not checked in 15 min after its start turns amber,
30 min red, with the worker's phone number to call.

## Worker phone
Today's visits in order, "Navigate" (opens maps), **Check in** (time + optional location check: "within 250 m of
the client" / "location not shared" — never blocks the visit), task checklist, a 2-line note, **Check out**.
Works **offline** with a queue that keeps original times (negative control: break it, see the test lose a visit).
Mileage between visits logged from the check-in order.

## Family link
Unguessable per client: today's and this week's visits — scheduled, checked in at, checked out at, tasks done.
No notes content unless the coordinator marks the note shareable. Nothing is sent by email/SMS; "copy link"
only.

## Reports
Hours per worker (payroll), hours per client per funder (billing), missed visits, mileage; CSV export.

## Privacy (hard rules)
SAMPLE agency "SAMPLE Exploits Home Support (demo)", SAMPLE clients and workers only, labelled SAMPLE,
initials for avatars. No health card numbers, no diagnoses field. README states what a real deployment needs
(PHIA review, consent, retention, backups).

## Tests that matter
Late/missed visit colour changes at 15/30 min on a fake clock; offline check-ins sync with original times;
payroll hours = check-out − check-in summed exactly; family link hides non-shareable notes (negative control);
journeys chromium + webkit at 390 + 1280.

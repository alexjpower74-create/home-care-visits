#!/usr/bin/env python3
"""Builds data/sample-agency.json: the SAMPLE agency, workers and clients.
Community points come from NRCan's Geographical Names service (Open Government Licence - Canada), saved raw in
data/sources/geonames-*.json. Each SAMPLE client pin is a stated offset (metres east/north) from its community point,
so no pin is anyone's address. Run: python3 tools/build-sample-agency.py"""
import json, math, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'sources')
R = 6371008.8
FETCHED = {'grand-falls-windsor': '2026-09-14T12:13:19Z', 'bishops-falls': '2026-09-14T12:13:21Z',
           'norris-arm': '2026-09-14T12:20:12Z', 'botwood': '2026-09-14T12:13:55Z',
           'peterview': '2026-09-14T12:13:57Z', 'northern-arm': '2026-09-14T12:14:04Z'}
NAMES = {'grand-falls-windsor': "Grand Falls-Windsor", 'bishops-falls': "Bishop's Falls", 'norris-arm': 'Norris Arm',
         'botwood': 'Botwood', 'peterview': 'Peterview', 'northern-arm': 'Northern Arm'}

def community(slug):
    d = json.load(open(os.path.join(SRC, f'geonames-{slug}.json')))
    hits = [i for i in d['items'] if i['name'] == NAMES[slug] and i['concise']['code'] == 'TOWN']
    assert len(hits) == 1, slug
    h = hits[0]
    return {'name': h['name'], 'geonames_id': h['id'], 'lat': h['latitude'], 'lng': h['longitude'],
            'source_url': f"https://geogratis.gc.ca/services/geoname/en/geonames.json?q={NAMES[slug].replace(' ', '%20')}&province=10",
            'raw': f'data/sources/geonames-{slug}.json', 'fetched': FETCHED[slug]}

C = {s: community(s) for s in NAMES}

def offset(slug, east, north):
    c = C[slug]
    lat = c['lat'] + math.degrees(north / R)
    lng = c['lng'] + math.degrees(east / (R * math.cos(math.radians(c['lat']))))
    return round(lat, 5), round(lng, 5)

def hav(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return math.floor(2 * R * math.asin(math.sqrt(h)) + 0.5)

ZONES = [{'id': 1, 'name': 'Grand Falls-Windsor'}, {'id': 2, 'name': "Bishop's Falls & Norris Arm"},
         {'id': 3, 'name': 'Botwood, Peterview & Northern Arm'}]
ZONE_OF = {'grand-falls-windsor': 1, 'bishops-falls': 2, 'norris-arm': 2, 'botwood': 3, 'peterview': 3, 'northern-arm': 3}
FUNDERS = [{'id': 1, 'name': 'SAMPLE Regional home support program'}, {'id': 2, 'name': 'Private pay (SAMPLE)'},
           {'id': 3, 'name': 'SAMPLE Veterans program'}]
WD = lambda s, e: {'start': s, 'end': e}
WORKERS = [
    {'ref': 1, 'name': 'Jo W. (SAMPLE)', 'phone': '709-555-0131', 'zone_ids': [1],
     'availability': {str(d): WD('08:00', '16:00') if d <= 5 else None for d in range(1, 8)}, 'max_week_minutes': 2250},
    {'ref': 2, 'name': 'Sam R. (SAMPLE)', 'phone': '709-555-0132', 'zone_ids': [1, 2],
     'availability': {str(d): WD('07:30', '15:30') if d <= 5 else None for d in range(1, 8)}, 'max_week_minutes': 2250},
    {'ref': 3, 'name': 'Alex B. (SAMPLE)', 'phone': '709-555-0133', 'zone_ids': [3],
     'availability': {str(d): WD('09:00', '17:00') if d <= 6 else None for d in range(1, 8)}, 'max_week_minutes': 1800},
    {'ref': 4, 'name': 'Chris M. (SAMPLE)', 'phone': '709-555-0134', 'zone_ids': [2, 3],
     'availability': {str(d): WD('10:00', '18:00') if d <= 5 else None for d in range(1, 8)}, 'max_week_minutes': 1200},
    {'ref': 5, 'name': 'Terry O. (SAMPLE)', 'phone': '709-555-0135', 'zone_ids': [1, 2, 3],
     'availability': {'1': None, '2': None, '3': None, '4': None, '5': WD('12:00', '20:00'), '6': WD('08:00', '16:00'), '7': WD('08:00', '16:00')},
     'max_week_minutes': 960},
]
T = lambda kind, detail='': {'kind': kind, 'detail': detail}
P = lambda days, s, e, w: {'days': days, 'start': s, 'end': e, 'worker': w}
F = lambda n, r, p: {'name': n, 'relationship': r, 'phone': p}
CLIENTS = [
    ('Margaret P. (SAMPLE)', 'grand-falls-windsor', (-900, 300), 1, 'Key safe left of the front door, code 1942 (SAMPLE). Knock, then let yourself in.',
     [T('personal_care', 'Wash and dress'), T('meal_prep', 'Breakfast'), T('medication_reminder', 'Morning pills from the blister pack')],
     [P([1, 2, 3, 4, 5], '08:30', '09:30', 1)], [F('Linda P. (SAMPLE)', 'Daughter', '709-555-0150')]),
    ('Ron K. (SAMPLE)', 'grand-falls-windsor', (600, -400), 1, 'Side door. Ron answers slowly, give him a minute.',
     [T('personal_care', 'Shower on Mondays'), T('housekeeping', 'Kitchen and bathroom')],
     [P([1, 3, 5], '10:00', '11:30', 1)], [F('Gerald K. (SAMPLE)', 'Brother', '709-555-0151')]),
    ('Doris L. (SAMPLE)', 'grand-falls-windsor', (1500, 700), 2, 'Ring the bell. Cat is not allowed out.',
     [T('companionship', 'Walk if the weather is fine'), T('errands', 'Groceries on Thursday')],
     [P([2, 4], '13:00', '15:00', 1)], [F('Paul L. (SAMPLE)', 'Son', '709-555-0152'), F('Anne L. (SAMPLE)', 'Daughter-in-law', '709-555-0153')]),
    ('Frank H. (SAMPLE)', 'grand-falls-windsor', (-400, -900), 3, 'Ramp at the back. Door code with the office (SAMPLE).',
     [T('personal_care', 'Help with shaving'), T('laundry', 'Bedding on Thursday')],
     [P([2, 4], '09:00', '10:00', 2)], [F('Joan H. (SAMPLE)', 'Wife', '709-555-0154')]),
    ('Gladys W. (SAMPLE)', 'grand-falls-windsor', (200, 1100), 1, 'Front door is unlocked from 11 AM. Call out when you come in.',
     [T('meal_prep', 'Lunch, soft foods'), T('medication_reminder', 'Noon pills, remind only')],
     [P([1, 2, 3, 4, 5], '12:00', '12:45', 1)], [F('Rose W. (SAMPLE)', 'Niece', '709-555-0155')]),
    ('Bill S. (SAMPLE)', 'bishops-falls', (300, -250), 1, 'Key safe by the shed, code 5530 (SAMPLE).',
     [T('personal_care', 'Wash and dress'), T('housekeeping', 'Sweep the porch')],
     [P([1, 3, 5], '09:00', '10:00', 2)], [F('Karen S. (SAMPLE)', 'Daughter', '709-555-0156')]),
    ('Ruby T. (SAMPLE)', 'norris-arm', (-200, 300), 1, 'Back door. Dog barks but is friendly.',
     [T('meal_prep', 'Soup for supper, leave in the fridge'), T('companionship')],
     [P([1, 3, 5], '10:30', '12:00', 2)], [F('Mike T. (SAMPLE)', 'Grandson', '709-555-0157')]),
    ('Walter G. (SAMPLE)', 'botwood', (250, 400), 3, 'Key safe left of the back door, code 2718 (SAMPLE). Knock twice.',
     [T('personal_care', 'Wash and dress'), T('meal_prep', 'Breakfast'), T('medication_reminder', 'Morning pills, remind only')],
     [P([1, 2, 3, 4, 5], '09:00', '10:00', 3)], [F('Dave G. (SAMPLE)', 'Son', '709-555-0158')]),
    ('Irene C. (SAMPLE)', 'peterview', (150, -200), 1, 'Front door. Irene likes a knock and a hello through the door.',
     [T('housekeeping', 'Vacuum and dishes'), T('laundry')],
     [P([2, 4], '10:30', '12:00', 3)], [F('Brenda C. (SAMPLE)', 'Daughter', '709-555-0159')]),
    ('Edna F. (SAMPLE)', 'northern-arm', (-250, 150), 2, 'Porch door. Boots off inside, please.',
     [T('companionship', 'Cards or a drive'), T('errands', 'Pharmacy pick-up on Fridays')],
     [P([3], '13:00', '15:00', 4), P([5], '13:00', '14:00', None)], [F('Tom F. (SAMPLE)', 'Son', '709-555-0160')]),
    ('George N. (SAMPLE)', 'botwood', (-350, -300), 1, 'Key safe by the step, code 8080 (SAMPLE).',
     [T('personal_care', 'Wash and dress')],
     [P([6, 7], '09:00', '10:00', 5)], [F('Sharon N. (SAMPLE)', 'Daughter', '709-555-0161')]),
    ('Mary D. (SAMPLE)', 'grand-falls-windsor', (-1300, -200), 1, 'Front door. Mary uses a walker, give her time to reach the door.',
     [T('personal_care', 'Help with bath'), T('meal_prep', 'Weekend lunch')],
     [P([6, 7], '10:15', '11:15', 5)], [F('Steve D. (SAMPLE)', 'Son', '709-555-0162')]),
]

clients = []
for i, (name, slug, (e, n), funder, entry, tasks, patterns, fam) in enumerate(CLIENTS, 1):
    lat, lng = offset(slug, e, n)
    clients.append({'ref': i, 'name': name, 'address': f"{C[slug]['name']}, NL (SAMPLE: no street address)",
                    'community': slug, 'offset_m': {'east': e, 'north': n}, 'lat': lat, 'lng': lng,
                    'zone_id': ZONE_OF[slug], 'funder_id': funder, 'entry_notes': entry, 'tasks': tasks,
                    'patterns': patterns, 'family_contacts': fam})

# Check the base week against the contract's conflict rule (docs/API.md).
def mins(hm): h, m = hm.split(':'); return int(h) * 60 + int(m)
visits = []
for c in clients:
    for p in c['patterns']:
        for d in p['days']:
            visits.append({'client': c, 'day': d, 's': mins(p['start']), 'e': mins(p['end']), 'w': p['worker']})
conflicts = []
for w in WORKERS:
    mine = sorted([v for v in visits if v['w'] == w['ref']], key=lambda v: (v['day'], v['s']))
    total = sum(v['e'] - v['s'] for v in mine)
    if total > w['max_week_minutes']: conflicts.append(('over_hours', w['name']))
    for a, b in zip(mine, mine[1:]):
        if a['day'] != b['day']: continue
        if a['s'] < b['e'] and b['s'] < a['e']: conflicts.append(('double_booked', w['name'], a['day'])); continue
        dist = hav((a['client']['lat'], a['client']['lng']), (b['client']['lat'], b['client']['lng']))
        need = math.ceil(dist * 1.3 / 1000)
        if b['s'] - a['e'] < need:
            conflicts.append(('travel_gap', w['name'], a['day'], a['client']['name'], b['client']['name'], b['s'] - a['e'], need, dist))
    for v in mine:
        win = w['availability'][str(v['day'])]
        if not win or v['s'] < mins(win['start']) or v['e'] > mins(win['end']): conflicts.append(('unavailable', w['name'], v['day'], v['client']['name']))
        if v['client']['zone_id'] not in w['zone_ids']: conflicts.append(('outside_zone', w['name'], v['client']['name']))
    print(f"{w['name']}: {total} min scheduled of {w['max_week_minutes']}")
for c in conflicts: print('CONFLICT', c)
# every gap between consecutive visits, for the record
out = {
    'note': 'SAMPLE data. People are made up and labelled SAMPLE. Phone numbers are in the fictional 709-555-01xx range. '
            'No client has a street address: each pin is a stated offset in metres from the NRCan point for a real community, '
            'so no pin is anyone\'s home. Key-safe codes are SAMPLE.',
    'communities': C, 'licence': 'Community points: Natural Resources Canada, Canadian Geographical Names Database, Open Government Licence - Canada.',
    'agency': {'name': 'SAMPLE Exploits Home Support (demo)', 'office_phone': '709-555-0100', 'timezone': 'America/St_Johns',
               'office': {'label': 'SAMPLE office, Grand Falls-Windsor', 'lat': round(C['grand-falls-windsor']['lat'], 5), 'lng': round(C['grand-falls-windsor']['lng'], 5)},
               'pin': '4826'},
    'zones': ZONES, 'funders': FUNDERS, 'workers': WORKERS, 'clients': clients,
    'expected_base_week_conflicts': [
        {'kind': c[0], 'worker': c[1], 'iso_weekday': c[2], 'from_client': c[3], 'to_client': c[4], 'gap_minutes': c[5], 'needed_minutes': c[6], 'distance_m': c[7]}
        for c in conflicts if c[0] == 'travel_gap'] + [{'kind': c[0], 'detail': list(c[1:])} for c in conflicts if c[0] != 'travel_gap'],
}
json.dump(out, open(os.path.join(ROOT, 'data', 'sample-agency.json'), 'w'), indent=2, ensure_ascii=False)
print('wrote data/sample-agency.json', len(WORKERS), 'workers', len(clients), 'clients', len(visits), 'weekly visits')

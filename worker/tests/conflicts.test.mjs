// Conflicts (pure): one of each kind with exact messages, the travel-gap boundary, over-hours ids, what never conflicts,
// deterministic order, and the SAMPLE base week giving exactly expected_base_week_conflicts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findConflicts } from '../src/conflicts.js'
import { patternVisits } from '../src/generate.js'
import { localToUtc, isoWeekday } from '../src/time.js'
import { SAMPLE } from '../src/sample-data.js'

const ZONES = [{ id: 1, name: 'Zone One' }, { id: 2, name: 'Zone Two' }]
const WINDOW = { start: '08:00', end: '16:00' }
const PAT = { id: 1, name: 'Pat Q. (SAMPLE)', zone_ids: [1], availability: { 1: WINDOW, 2: WINDOW, 3: WINDOW, 4: WINDOW, 5: WINDOW, 6: null, 7: null }, max_week_minutes: 200 }
const HERE = { lat: 48.96, lng: -55.66 }
const NORTH = { lat: 49.05, lng: -55.66 } // 0.09° of latitude north of HERE

/** The straight-line metres between HERE and NORTH, with the haversine written out (same sphere as the API). */
function metresHereToNorth () {
  const R = 6371008.8
  const toRad = d => d * Math.PI / 180
  const h = Math.sin(toRad(NORTH.lat - HERE.lat) / 2) ** 2 +
    Math.cos(toRad(HERE.lat)) * Math.cos(toRad(NORTH.lat)) * Math.sin(toRad(NORTH.lng - HERE.lng) / 2) ** 2
  return Math.floor(2 * R * Math.asin(Math.sqrt(h)) + 0.5)
}

let nextId = 1
function visit (over) {
  const v = { id: nextId++, worker_id: 1, client_name: 'X (SAMPLE)', zone_id: 1, ...HERE, date: '2026-09-14', start: '09:00', end: '10:00', cancelled: false, ...over }
  v.starts_at = new Date(localToUtc(v.date, v.start)).toISOString()
  v.ends_at = new Date(localToUtc(v.date, v.end)).toISOString()
  return v
}

function handBuiltWeek () {
  nextId = 1
  return [
    visit({ client_name: 'X (SAMPLE)' }), // 1: Mon 09:00–10:00
    visit({ client_name: 'Y (SAMPLE)', start: '09:30', end: '10:30' }), // 2: overlaps 1
    visit({ client_name: 'Z (SAMPLE)', ...NORTH, start: '10:35', end: '11:00' }), // 3: 5 min after 2, 10 km away
    visit({ client_name: 'X (SAMPLE)', date: '2026-09-15', start: '17:00', end: '18:00' }), // 4: Tue, outside 08–16
    visit({ client_name: 'W (SAMPLE)', zone_id: 2, date: '2026-09-16' }), // 5: Wed, client in zone 2
    visit({ client_name: 'V (SAMPLE)', worker_id: null, start: '09:15', end: '10:15' }), // 6: unassigned, overlaps 1
    visit({ client_name: 'U (SAMPLE)', cancelled: true, start: '09:00', end: '12:00', zone_id: 2 }) // 7: cancelled, overlaps 1–3
  ]
}

test('conflicts: a hand-built week with exactly one of each kind, exact messages and order', () => {
  const metres = metresHereToNorth()
  const needed = Math.ceil(metres * 1.3 / 1000)
  assert.equal(metres, 10008)
  assert.equal(needed, 14)
  const got = findConflicts({ visits: handBuiltWeek(), workers: [PAT], zones: ZONES })
  assert.deepEqual(got, [
    { kind: 'double_booked', label: 'Double-booked', severity: 'problem', worker_id: 1, date: '2026-09-14', visit_ids: [1, 2],
      message: 'Pat Q. (SAMPLE) is booked for X (SAMPLE) and Y (SAMPLE) at the same time on Mon Sep 14.' },
    { kind: 'travel_gap', label: 'Travel gap too short', severity: 'problem', worker_id: 1, date: '2026-09-14', visit_ids: [2, 3],
      message: 'Pat Q. (SAMPLE) has 5 min between Y (SAMPLE) and Z (SAMPLE) on Mon Sep 14, but they are 10.0 km apart in a straight line (about 14 min of driving).',
      gap_minutes: 5, needed_minutes: 14, distance_m: 10008 },
    { kind: 'unavailable', label: 'Outside availability', severity: 'warning', worker_id: 1, date: '2026-09-15', visit_ids: [4],
      message: "Tue Sep 15 5:00 PM – 6:00 PM is outside Pat Q. (SAMPLE)'s availability (Mon–Fri 8:00 AM – 4:00 PM)." },
    { kind: 'outside_zone', label: 'Outside travel zone', severity: 'warning', worker_id: 1, date: '2026-09-16', visit_ids: [5],
      message: "W (SAMPLE) is in Zone Two, outside Pat Q. (SAMPLE)'s travel zones." },
    // 60 + 60 + 25 = 145, + 60 = 205 passes 200 at visit 4, so 4 and 5.
    { kind: 'over_hours', label: 'Over weekly hours', severity: 'problem', worker_id: 1, date: null, visit_ids: [4, 5],
      message: 'Pat Q. (SAMPLE) is booked for 4.4 h this week; their limit is 3.3 h.', scheduled_minutes: 265, max_week_minutes: 200 }
  ])
})

test('conflicts: travel-gap boundary, gap = needed is fine and gap = needed − 1 is a conflict', () => {
  const metres = metresHereToNorth()
  const needed = Math.ceil(metres * 1.3 / 1000) // 1.3 × straight line at 60 km/h
  const pair = gap => {
    nextId = 1
    const endMin = 10 * 60 + gap
    const start = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`
    const worker = { ...PAT, max_week_minutes: 4800 }
    return findConflicts({ visits: [visit({}), visit({ client_name: 'Z (SAMPLE)', ...NORTH, start, end: '11:30' })], workers: [worker], zones: ZONES })
  }
  assert.deepEqual(pair(needed), [])
  const short = pair(needed - 1)
  assert.equal(short.length, 1)
  assert.equal(short[0].kind, 'travel_gap')
  assert.equal(short[0].gap_minutes, needed - 1)
  assert.equal(short[0].needed_minutes, needed)
})

test('conflicts: unassigned and cancelled visits never conflict; the same input in any order gives the same output', () => {
  const week = handBuiltWeek()
  const base = findConflicts({ visits: week, workers: [PAT], zones: ZONES })
  for (const c of base) assert.ok(!c.visit_ids.includes(6) && !c.visit_ids.includes(7), JSON.stringify(c))
  const onlyIgnored = findConflicts({ visits: week.slice(5), workers: [PAT], zones: ZONES })
  assert.deepEqual(onlyIgnored, [])
  for (let seed = 1; seed <= 20; seed++) {
    const shuffled = [...week]
    let x = seed
    for (let i = shuffled.length - 1; i > 0; i--) {
      x = (x * 1103515245 + 12345) % 2147483648
      const j = x % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    assert.deepEqual(findConflicts({ visits: shuffled, workers: [{ ...PAT, zone_ids: [...PAT.zone_ids] }], zones: [...ZONES].reverse() }), base)
  }
})

test('conflicts: over-hours ids run from the visit whose running total passes the limit to the end of the week', () => {
  nextId = 1
  const visits = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'].map(date => visit({ date }))
  const exactly = findConflicts({ visits, workers: [{ ...PAT, max_week_minutes: 180 }], zones: ZONES })
  assert.deepEqual(exactly.map(c => [c.kind, c.visit_ids]), [['over_hours', [4]]])
  const atLimit = findConflicts({ visits, workers: [{ ...PAT, max_week_minutes: 240 }], zones: ZONES })
  assert.deepEqual(atLimit, [])
  const early = findConflicts({ visits, workers: [{ ...PAT, max_week_minutes: 60 }], zones: ZONES })
  assert.deepEqual(early.map(c => [c.kind, c.visit_ids, c.message]), [['over_hours', [2, 3, 4], 'Pat Q. (SAMPLE) is booked for 4 h this week; their limit is 1 h.']])
})

/** The SAMPLE base week as the Worker builds it: seed ids in data order, visits from patternVisits. */
export function sampleWeek (weekStart) {
  const workers = SAMPLE.workers.map((w, i) => ({ id: i + 1, name: w.name, zone_ids: w.zone_ids, availability: w.availability, max_week_minutes: w.max_week_minutes }))
  const patterns = []
  SAMPLE.clients.forEach((c, i) => c.patterns.forEach(p => patterns.push({
    id: patterns.length + 1, client_id: i + 1, days: p.days, start: p.start, end: p.end, worker_id: p.worker, valid_from_at: '2020-01-01T00:00:00.000Z', ended_at: null
  })))
  const visits = patternVisits(patterns, weekStart).map((r, i) => {
    const c = SAMPLE.clients[r.client_id - 1]
    return { id: i + 1, ...r, client_name: c.name, zone_id: c.zone_id, lat: c.lat, lng: c.lng, cancelled: false }
  })
  return { workers, visits, zones: SAMPLE.zones }
}

test('conflicts: the SAMPLE base week gives exactly expected_base_week_conflicts (36 visits)', () => {
  for (const weekStart of ['2026-09-14', '2026-01-12']) {
    const week = sampleWeek(weekStart)
    assert.equal(week.visits.length, 36)
    const byId = new Map(week.visits.map(v => [v.id, v]))
    const got = findConflicts(week).map(c => ({
      kind: c.kind,
      worker: week.workers.find(w => w.id === c.worker_id).name,
      iso_weekday: isoWeekday(c.date),
      from_client: byId.get(c.visit_ids[0]).client_name,
      to_client: byId.get(c.visit_ids[1]).client_name,
      gap_minutes: c.gap_minutes,
      needed_minutes: c.needed_minutes,
      distance_m: c.distance_m
    }))
    assert.deepEqual(got, SAMPLE.expected_base_week_conflicts, weekStart)
  }
})

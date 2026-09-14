// API tests (M1) against a running Worker started with --var TEST_MODE:1 (tests/run.mjs does that).
// BASE defaults to http://127.0.0.1:7902. Every test resets first. The clock is pinned with X-Test-Now (NL times via nl()).
// Stored rows are counted through GET /api/test/events (raw rows, voided included).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { localToUtc } from '../src/time.js'
import { distanceM, kmText } from '../src/geo.js'
import { SAMPLE } from '../src/sample-data.js'

const BASE = process.env.BASE || `http://127.0.0.1:${process.env.PORT || 7902}`
const nl = (date, hm) => new Date(localToUtc(date, hm)).toISOString()
const plusMs = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString()
const plus = (iso, minutes) => plusMs(iso, minutes * 60000)
const MON = '2026-09-14'
const TUE = '2026-09-15'
const WED = '2026-09-16'
const THU = '2026-09-17'
const FRI = '2026-09-18'
const SAT = '2026-09-19'
const NOW = nl(MON, '07:30') // Mon Sep 14, 7:30 AM NDT
const AGENCY = 'SAMPLE Exploits Home Support (demo)'
const HEALTH = "Don't put health card numbers in this app."
const MEDICATION = 'This app records medication reminders only, not medication given. Reword this task.'

async function api (method, path, { body, token, key, now = NOW, ip = '10.0.0.1', raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'X-Test-Now': now,
      'X-Test-IP': ip,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'X-Worker-Key': key } : {})
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, body: json, text, headers: res.headers }
}

function expectError (r, status, code, field, error) {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.code, code, r.text)
  assert.equal(typeof r.body.error, 'string', r.text)
  if (field !== undefined) assert.equal(r.body.field, field, r.text)
  if (error !== undefined) assert.equal(r.body.error, error, r.text)
}

async function setup (now = NOW) {
  const r = await api('POST', '/api/test/reset', { now })
  assert.equal(r.status, 200, r.text)
  const seed = r.body
  const s = await api('POST', '/api/office/signin', { body: { pin: '4826' }, now })
  assert.equal(s.status, 200, s.text)
  const byPrefix = (list, prefix) => {
    const found = list.find(x => x.name.startsWith(prefix))
    assert.ok(found, `no ${prefix} in the seed`)
    return found
  }
  return {
    seed,
    token: s.body.token,
    keyOf: name => byPrefix(seed.workers, name).key,
    workerId: name => byPrefix(seed.workers, name).id,
    clientId: name => byPrefix(seed.clients, name).id,
    familyKey: name => byPrefix(seed.clients, name).family_key
  }
}

async function dayVisits (token, date, now = NOW) {
  const r = await api('GET', `/api/office/day?date=${date}`, { token, now })
  assert.equal(r.status, 200, r.text)
  return r.body.visits
}

async function visitOf (token, date, clientPrefix, now = NOW) {
  const v = (await dayVisits(token, date, now)).find(x => x.client_name.startsWith(clientPrefix))
  assert.ok(v, `no visit for ${clientPrefix} on ${date}`)
  return v
}

async function week (token, start = MON, now = NOW) {
  const r = await api('GET', `/api/office/week?start=${start}`, { token, now })
  assert.equal(r.status, 200, r.text)
  return r.body
}

const checkIn = (key, visitId, at, { now = at, location = null, id = randomUUID() } = {}) =>
  api('POST', '/api/worker/events', { key, now, body: { id, visit_id: visitId, kind: 'check_in', at, location } })

const checkOut = (key, visitId, at, { now = at, tasks = [], note = '', id = randomUUID() } = {}) =>
  api('POST', '/api/worker/events', { key, now, body: { id, visit_id: visitId, kind: 'check_out', at, tasks, note } })

async function storedEvents (visitId) {
  const r = await api('GET', `/api/test/events${visitId === undefined ? '' : `?visit_id=${visitId}`}`)
  assert.equal(r.status, 200, r.text)
  return r.body.events
}

const pinOf = prefix => {
  const c = SAMPLE.clients.find(x => x.name.startsWith(prefix))
  return { lat: c.lat, lng: c.lng }
}

const moveBody = (v, over = {}) => ({ worker_id: v.worker_id, date: v.date, start: v.start, end: v.end, version: v.version, ...over })

// ---------------------------------------------------------------- agency, headers, sign-in

test('agency shape and the headers on every /api answer', async () => {
  await setup()
  const r = await api('GET', '/api/agency')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, {
    name: AGENCY, sample: true, timezone: 'America/St_Johns', office_phone: '709-555-0100', late_after_minutes: 15, missed_after_minutes: 30, near_metres: 250
  })
  for (const answer of [r, await api('GET', '/api/nothing-here'), await api('GET', '/api/office/clients')]) {
    assert.equal(answer.headers.get('cache-control'), 'no-store')
    assert.equal(answer.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(answer.headers.get('x-content-type-options'), 'nosniff')
  }
  expectError(await api('GET', '/api/nothing-here'), 404, 'not_found')
})

test('sign-in: wrong PIN 401 field pin, right PIN gives a token, no token 401, sign-out ends it', async () => {
  const { token } = await setup()
  expectError(await api('POST', '/api/office/signin', { body: { pin: '1111' } }), 401, 'unauthorized', 'pin', 'That PIN is not right.')
  expectError(await api('POST', '/api/office/signin', { body: {} }), 401, 'unauthorized', 'pin')
  const good = await api('POST', '/api/office/signin', { body: { pin: '4826' } })
  assert.equal(good.status, 200)
  assert.match(good.body.token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(good.body.expires_at, '2026-09-28T10:00:00.000Z') // 14 days
  const noToken = await api('GET', '/api/office/clients')
  expectError(noToken, 401, 'unauthorized')
  assert.equal(noToken.body.field, undefined)
  expectError(await api('GET', '/api/office/clients', { token: 'not-a-token' }), 401, 'unauthorized')
  assert.equal((await api('GET', '/api/office/clients', { token })).status, 200)
  assert.equal((await api('POST', '/api/office/signout', { token })).status, 200)
  expectError(await api('GET', '/api/office/clients', { token }), 401, 'unauthorized')
  assert.equal((await api('GET', '/api/office/clients', { token: good.body.token })).status, 200, 'the other session is untouched')
  expectError(await api('GET', '/api/office/clients', { token: good.body.token, now: '2026-09-28T10:00:01.000Z' }), 401, 'unauthorized')
})

// ---------------------------------------------------------------- clients

test('clients: 12 SAMPLE clients by name, with the office shape', async () => {
  const { token, clientId, workerId } = await setup()
  const r = await api('GET', '/api/office/clients', { token })
  assert.equal(r.status, 200)
  const names = r.body.clients.map(c => c.name)
  assert.equal(names.length, 12)
  assert.deepEqual(names, [...SAMPLE.clients.map(c => c.name)].sort((a, b) => a.localeCompare(b)))
  assert.ok(names.every(n => n.endsWith('(SAMPLE)')))
  const walter = r.body.clients.find(c => c.name === 'Walter G. (SAMPLE)')
  assert.deepEqual({ ...walter, tasks: walter.tasks.map(({ id, ...t }) => t), patterns: walter.patterns.map(({ id, ...p }) => p), family_url: undefined }, {
    id: clientId('Walter'),
    name: 'Walter G. (SAMPLE)',
    initials: 'WG',
    address: 'Botwood, NL (SAMPLE: no street address)',
    lat: 49.13924,
    lng: -55.36972,
    zone_id: 3,
    zone_name: 'Botwood, Peterview & Northern Arm',
    entry_notes: 'Key safe left of the back door, code 2718 (SAMPLE). Knock twice.',
    funder_id: 3,
    funder_name: 'SAMPLE Veterans program',
    active: true,
    tasks: [
      { kind: 'personal_care', label: 'Personal care', detail: 'Wash and dress' },
      { kind: 'meal_prep', label: 'Meal preparation', detail: 'Breakfast' },
      { kind: 'medication_reminder', label: 'Medication reminder', detail: 'Morning pills, remind only' }
    ],
    patterns: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '10:00', worker_id: workerId('Alex'), days_label: 'Mon, Tue, Wed, Thu, Fri', time_label: '9:00 AM – 10:00 AM' }],
    family_contacts: [{ name: 'Dave G. (SAMPLE)', relationship: 'Son', phone: '709-555-0158' }],
    family_url: undefined
  })
  assert.match(walter.family_url, new RegExp(`^${BASE.replace(/[.]/g, '\\.')}/f/\\?k=[A-Za-z0-9_-]{24,}$`))
  const one = await api('GET', `/api/office/clients/${walter.id}`, { token })
  assert.deepEqual(one.body, walter)
  expectError(await api('GET', '/api/office/clients/9999', { token }), 404, 'not_found')
})

const goodClient = (over = {}) => ({
  name: 'Nora B. (SAMPLE)',
  address: 'Botwood, NL (SAMPLE: no street address)',
  lat: 49.14,
  lng: -55.35,
  zone_id: 3,
  entry_notes: 'Front door (SAMPLE).',
  funder_id: 1,
  tasks: [{ kind: 'meal_prep', detail: 'Supper' }],
  patterns: [{ days: [1, 3], start: '14:00', end: '15:00', worker_id: null }],
  family_contacts: [{ name: 'Ada B. (SAMPLE)', relationship: 'Daughter', phone: '(709) 555-0170' }],
  ...over
})

const CLIENT_REFUSALS = [
  ['name', 'empty', { name: '   ' }, 'Give the client a name.'],
  ['name', '61 characters', { name: 'N'.repeat(61) }, 'Keep the name under 60 characters.'],
  ['address', 'empty', { address: '' }, 'Type where the client lives (the town is enough).'],
  ['lat', 'outside Newfoundland and Labrador', { lat: 44.65, lng: -63.57 }, 'Put a pin on the map for this client.'],
  ['lat', 'no lng', { lng: undefined }, 'Put a pin on the map for this client.'],
  ['zone_id', 'unknown', { zone_id: 99 }, 'Pick a zone.'],
  ['entry_notes', '301 characters', { entry_notes: 'e'.repeat(301) }, 'Keep the entry notes under 300 characters.'],
  ['funder_id', 'unknown', { funder_id: 99 }, "Pick who pays for this client's visits."],
  ['tasks', 'none', { tasks: [] }, 'Add at least one care task.'],
  ['tasks', 'unknown kind', { tasks: [{ kind: 'nursing' }] }, 'Pick a task type.'],
  ['tasks', 'detail of 81 characters', { tasks: [{ kind: 'other', detail: 'd'.repeat(81) }] }, 'Keep each task under 80 characters.'],
  ['patterns', 'no days', { patterns: [{ days: [], start: '09:00', end: '10:00', worker_id: null }] }, 'Pick at least one day.'],
  ['patterns', 'a repeated day', { patterns: [{ days: [1, 1], start: '09:00', end: '10:00', worker_id: null }] }, 'Pick at least one day.'],
  ['patterns', 'end before start', { patterns: [{ days: [1], start: '10:00', end: '09:00', worker_id: null }] }, 'The visit has to end after it starts.'],
  ['patterns', '10 minutes', { patterns: [{ days: [1], start: '10:00', end: '10:10', worker_id: null }] }, 'A visit is between 15 minutes and 12 hours.'],
  ['patterns', 'an unknown worker', { patterns: [{ days: [1], start: '10:00', end: '11:00', worker_id: 999 }] }, 'Pick one of your workers.'],
  ['family_contacts', 'no name', { family_contacts: [{ name: '', relationship: 'Son', phone: '709-555-0170' }] }, 'Add a name for each family contact.'],
  ['family_contacts', 'a 7-digit phone', { family_contacts: [{ name: 'Ada B. (SAMPLE)', relationship: 'Son', phone: '555-0170' }] }, 'Type a 10-digit phone number, like 709-555-0152.'],
  ['active', 'not a boolean', { active: 'yes' }, 'Say whether this client is active.'],
  ['entry_notes', 'a health card number (privacy guard)', { entry_notes: 'MCP 1234 5678 9012' }, HEALTH],
  ['family_contacts', 'a health card number in a relationship (privacy guard)', { family_contacts: [{ name: 'Ada B. (SAMPLE)', relationship: '1234-5678-9012', phone: '709-555-0170' }] }, HEALTH],
  ['tasks', 'medication given (privacy guard)', { tasks: [{ kind: 'medication_reminder', detail: 'Give her pills' }] }, MEDICATION]
]

for (const [field, why, over, message] of CLIENT_REFUSALS) {
  test(`clients: POST refuses ${field} (${why})`, async () => {
    const { token } = await setup()
    expectError(await api('POST', '/api/office/clients', { token, body: goodClient(over) }), 400, 'bad_request', field, message)
    assert.equal((await api('GET', '/api/office/clients?all=1', { token })).body.clients.length, 12, 'nothing stored')
  })
}

const clientInput = c => ({
  name: c.name, address: c.address, lat: c.lat, lng: c.lng, zone_id: c.zone_id, entry_notes: c.entry_notes, funder_id: c.funder_id,
  active: c.active, tasks: c.tasks.map(t => ({ id: t.id, kind: t.kind, detail: t.detail })),
  patterns: c.patterns.map(p => ({ id: p.id, days: p.days, start: p.start, end: p.end, worker_id: p.worker_id })),
  family_contacts: c.family_contacts
})

test('clients: a good POST and a good PUT (task ids kept, unchanged pattern kept, PUT needs every field)', async () => {
  const { token } = await setup()
  const body = goodClient({ entry_notes: undefined, active: undefined })
  const r = await api('POST', '/api/office/clients', { token, body })
  assert.equal(r.status, 201, r.text)
  const c = r.body
  assert.equal(c.name, 'Nora B. (SAMPLE)')
  assert.equal(c.initials, 'NB')
  assert.equal(c.entry_notes, '')
  assert.equal(c.active, true)
  assert.equal(c.zone_name, 'Botwood, Peterview & Northern Arm')
  assert.equal(c.funder_name, 'SAMPLE Regional home support program')
  assert.deepEqual(c.family_contacts, [{ name: 'Ada B. (SAMPLE)', relationship: 'Daughter', phone: '709-555-0170' }])
  assert.equal(c.patterns.length, 1)
  assert.equal(c.patterns[0].days_label, 'Mon, Wed')
  assert.equal((await api('GET', '/api/office/clients', { token })).body.clients.length, 13)

  const input = clientInput(c)
  input.name = 'Nora B. Again (SAMPLE)'
  input.tasks[0].detail = 'Supper, soft foods'
  input.tasks.push({ kind: 'laundry', detail: '' })
  const put = await api('PUT', `/api/office/clients/${c.id}`, { token, body: input })
  assert.equal(put.status, 200, put.text)
  assert.equal(put.body.name, 'Nora B. Again (SAMPLE)')
  assert.equal(put.body.tasks[0].id, c.tasks[0].id)
  assert.equal(put.body.tasks[0].detail, 'Supper, soft foods')
  assert.equal(put.body.tasks[1].label, 'Laundry')
  assert.equal(put.body.patterns[0].id, c.patterns[0].id, 'an unchanged pattern keeps its id')
  assert.equal(put.body.rebuilt_visits, 0)
  const { active, ...missingActive } = input
  expectError(await api('PUT', `/api/office/clients/${c.id}`, { token, body: missingActive }), 400, 'bad_request', 'active')
  expectError(await api('PUT', '/api/office/clients/9999', { token, body: input }), 404, 'not_found')
})

// ---------------------------------------------------------------- pattern edits

test('pattern edits: reading a week twice gives the same visits', async () => {
  const { token } = await setup()
  const first = await week(token)
  const second = await week(token)
  assert.equal(first.visits.length, 36)
  assert.deepEqual(second.visits.map(v => v.id), first.visits.map(v => v.id))
  await dayVisits(token, WED)
  assert.equal((await week(token)).visits.length, 36)
})

test('pattern edits: a new time mid-week rebuilds only future visits with no events, and rebuilt_visits says how many', async () => {
  const now = nl(WED, '08:55')
  const { token, keyOf, clientId } = await setup(now)
  const before = (await week(token, MON, now)).visits.filter(v => v.client_name.startsWith('Walter'))
  assert.deepEqual(before.map(v => [v.date, v.start]), [[MON, '09:00'], [TUE, '09:00'], [WED, '09:00'], [THU, '09:00'], [FRI, '09:00']])
  const wed = before[2]
  assert.equal((await checkIn(keyOf('Alex'), wed.id, now, { now })).status, 201) // started, though its start is still ahead

  const client = (await api('GET', `/api/office/clients/${clientId('Walter')}`, { token, now })).body
  const input = clientInput(client)
  input.patterns[0] = { ...input.patterns[0], start: '10:00', end: '11:00' }
  const put = await api('PUT', `/api/office/clients/${client.id}`, { token, now, body: input })
  assert.equal(put.status, 200, put.text)
  assert.equal(put.body.rebuilt_visits, 2)
  assert.equal(put.body.patterns.length, 1)
  assert.notEqual(put.body.patterns[0].id, client.patterns[0].id)
  assert.equal(put.body.patterns[0].time_label, '10:00 AM – 11:00 AM')

  const after = (await week(token, MON, now)).visits.filter(v => v.client_name.startsWith('Walter'))
  assert.deepEqual(after.map(v => [v.date, v.start]),
    [[MON, '09:00'], [TUE, '09:00'], [WED, '09:00'], [WED, '10:00'], [THU, '10:00'], [FRI, '10:00']])
  assert.deepEqual(after.slice(0, 3).map(v => v.id), before.slice(0, 3).map(v => v.id), 'past and started visits are the same rows')
  assert.equal(after[2].status, 'checked_in')
  for (const v of after.slice(3)) assert.ok(!before.some(b => b.id === v.id), 'future visits are new rows')
  assert.equal((await week(token, MON, now)).visits.length, 37, 'reading again adds nothing')
})

test('pattern edits: a pattern added on a Wednesday creates no Monday or Tuesday visits', async () => {
  const now = nl(WED, '12:00')
  const { token, clientId } = await setup(now)
  const client = (await api('GET', `/api/office/clients/${clientId('Doris')}`, { token, now })).body
  const input = clientInput(client)
  input.patterns.push({ days: [1, 2, 3, 4, 5], start: '16:00', end: '17:00', worker_id: null })
  const put = await api('PUT', `/api/office/clients/${client.id}`, { token, now, body: input })
  assert.equal(put.status, 200, put.text)
  assert.equal(put.body.rebuilt_visits, 0)
  const w = await week(token, MON, now)
  const added = w.visits.filter(v => v.client_name.startsWith('Doris') && v.start === '16:00')
  assert.deepEqual(added.map(v => v.date), [WED, THU, FRI])
  assert.ok(added.every(v => v.status === 'unassigned'))
  assert.deepEqual(w.visits.filter(v => v.client_name.startsWith('Doris') && v.start === '13:00').map(v => v.date), [TUE, THU])
})

test('pattern edits: deactivating a client removes its future unstarted visits and no started one', async () => {
  const now = nl(WED, '08:55')
  const { token, keyOf, clientId } = await setup(now)
  const before = (await week(token, MON, now)).visits.filter(v => v.client_name.startsWith('Walter'))
  assert.equal((await checkIn(keyOf('Alex'), before[2].id, now, { now })).status, 201)
  const client = (await api('GET', `/api/office/clients/${clientId('Walter')}`, { token, now })).body
  const put = await api('PUT', `/api/office/clients/${client.id}`, { token, now, body: { ...clientInput(client), active: false } })
  assert.equal(put.status, 200, put.text)
  assert.equal(put.body.active, false)
  assert.deepEqual(put.body.patterns, [])
  assert.equal(put.body.rebuilt_visits, 2)
  const after = (await week(token, MON, now)).visits.filter(v => v.client_name.startsWith('Walter'))
  assert.deepEqual(after.map(v => v.id), before.slice(0, 3).map(v => v.id))
  assert.ok(!(await api('GET', '/api/office/clients', { token, now })).body.clients.some(c => c.id === client.id))
  assert.ok((await api('GET', '/api/office/clients?all=1', { token, now })).body.clients.some(c => c.id === client.id))
  const back = await api('PUT', `/api/office/clients/${client.id}`, { token, now, body: { ...clientInput(put.body), active: true } })
  assert.deepEqual(back.body.patterns, [], 'reactivating does not bring patterns back')
})

// ---------------------------------------------------------------- workers

test('workers: 5 SAMPLE workers with the office shape; POST, PUT and deactivation', async () => {
  const { token, workerId } = await setup()
  const r = await api('GET', '/api/office/workers', { token })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.workers.map(w => w.name), ['Alex B. (SAMPLE)', 'Chris M. (SAMPLE)', 'Jo W. (SAMPLE)', 'Sam R. (SAMPLE)', 'Terry O. (SAMPLE)'])
  const sam = r.body.workers.find(w => w.name.startsWith('Sam'))
  assert.equal(sam.initials, 'SR')
  assert.equal(sam.phone, '709-555-0132')
  assert.deepEqual(sam.zone_ids, [1, 2])
  assert.deepEqual(sam.zone_names, ['Grand Falls-Windsor', "Bishop's Falls & Norris Arm"])
  assert.equal(sam.availability_label, 'Mon–Fri 7:30 AM – 3:30 PM')
  assert.deepEqual(sam.availability['6'], null)
  assert.equal(sam.max_week_label, '37.5 h')
  assert.match(sam.worker_url, /\/w\/\?k=[A-Za-z0-9_-]{24,}$/)
  assert.equal(r.body.workers.find(w => w.name.startsWith('Chris')).max_week_label, '20 h')
  assert.equal(r.body.workers.find(w => w.name.startsWith('Terry')).availability_label, 'Fri 12:00 PM – 8:00 PM, Sat–Sun 8:00 AM – 4:00 PM')

  const body = { name: 'Pat Q. (SAMPLE)', phone: '709 555 0139', zone_ids: [2], availability: { 1: { start: '09:00', end: '13:00' } }, max_week_minutes: 600 }
  expectError(await api('POST', '/api/office/workers', { token, body: { ...body, name: '' } }), 400, 'bad_request', 'name', 'Give the worker a name.')
  expectError(await api('POST', '/api/office/workers', { token, body: { ...body, phone: '5550139' } }), 400, 'bad_request', 'phone')
  expectError(await api('POST', '/api/office/workers', { token, body: { ...body, zone_ids: [] } }), 400, 'bad_request', 'zone_ids', 'Pick at least one travel zone.')
  expectError(await api('POST', '/api/office/workers', { token, body: { ...body, availability: { 1: { start: '13:00', end: '09:00' } } } }), 400, 'bad_request', 'availability', 'Availability has to end after it starts.')
  expectError(await api('POST', '/api/office/workers', { token, body: { ...body, max_week_minutes: 59 } }), 400, 'bad_request', 'max_week_minutes', 'Weekly hours are between 1 and 80.')
  const made = await api('POST', '/api/office/workers', { token, body })
  assert.equal(made.status, 201, made.text)
  assert.equal(made.body.phone, '709-555-0139')
  assert.equal(made.body.availability_label, 'Mon 9:00 AM – 1:00 PM')
  assert.equal(made.body.max_week_label, '10 h')

  // Deactivating Terry at Monday 7:30: his patterns lose him in place, his weekend visits become unassigned.
  const terry = r.body.workers.find(w => w.name.startsWith('Terry'))
  const { id, initials, zone_names, availability_label, max_week_label, worker_url, ...input } = terry
  const put = await api('PUT', `/api/office/workers/${terry.id}`, { token, body: { ...input, active: false } })
  assert.equal(put.status, 200, put.text)
  assert.equal(put.body.active, false)
  assert.ok(!(await api('GET', '/api/office/workers', { token })).body.workers.some(w => w.id === terry.id))
  const w = await week(token)
  assert.equal(w.visits.filter(v => v.worker_id === workerId('Terry')).length, 0)
  assert.equal(w.visits.filter(v => v.date === SAT && v.status === 'unassigned').length, 2)
  assert.deepEqual(w.conflicts, [])
  const george = (await api('GET', '/api/office/clients', { token })).body.clients.find(c => c.name.startsWith('George'))
  assert.equal(george.patterns[0].worker_id, null)
})

// ---------------------------------------------------------------- week

test('week: 36 SAMPLE visits, 7 days, the base conflicts, and start must be a Monday', async () => {
  const { token, workerId } = await setup()
  const w = await week(token)
  assert.equal(w.week_start, MON)
  assert.equal(w.week_label, 'Week of Mon Sep 14')
  assert.deepEqual(w.days.map(d => d.date_label), ['Mon Sep 14', 'Tue Sep 15', 'Wed Sep 16', 'Thu Sep 17', 'Fri Sep 18', 'Sat Sep 19', 'Sun Sep 20'])
  assert.equal(w.visits.length, 36)
  const order = [...w.visits].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id - b.id)
  assert.deepEqual(w.visits.map(v => v.id), order.map(v => v.id))
  assert.equal(w.distance_note, 'Travel times use straight-line distance, not road time.')
  assert.deepEqual(w.workers.map(x => [x.name, x.hours_label]), [
    ['Alex B. (SAMPLE)', '8 h of 30 h'], ['Chris M. (SAMPLE)', '2 h of 20 h'], ['Jo W. (SAMPLE)', '17.3 h of 37.5 h'],
    ['Sam R. (SAMPLE)', '9.5 h of 37.5 h'], ['Terry O. (SAMPLE)', '4 h of 16 h']
  ])
  assert.deepEqual(w.conflicts.map(c => [c.kind, c.worker_id, c.date, c.gap_minutes, c.needed_minutes, c.distance_m, c.message]), [
    ['travel_gap', workerId('Terry'), SAT, 15, 38, 29194, 'Terry O. (SAMPLE) has 15 min between George N. (SAMPLE) and Mary D. (SAMPLE) on Sat Sep 19, but they are 29.2 km apart in a straight line (about 38 min of driving).'],
    ['travel_gap', workerId('Terry'), '2026-09-20', 15, 38, 29194, 'Terry O. (SAMPLE) has 15 min between George N. (SAMPLE) and Mary D. (SAMPLE) on Sun Sep 20, but they are 29.2 km apart in a straight line (about 38 min of driving).']
  ])
  const flagged = w.visits.filter(v => v.conflict_kinds.length)
  assert.deepEqual(flagged.map(v => [v.client_name, v.date, v.conflict_kinds]), [
    ['George N. (SAMPLE)', SAT, ['travel_gap']], ['Mary D. (SAMPLE)', SAT, ['travel_gap']],
    ['George N. (SAMPLE)', '2026-09-20', ['travel_gap']], ['Mary D. (SAMPLE)', '2026-09-20', ['travel_gap']]
  ])
  expectError(await api('GET', `/api/office/week?start=${TUE}`, { token }), 400, 'bad_request', 'start', 'Pick a Monday.')
  expectError(await api('GET', '/api/office/week', { token }), 400, 'bad_request', 'start')
  expectError(await api('GET', '/api/office/week?start=2026-02-30', { token }), 400, 'bad_request', 'start')
})

test('week: moving a visit to another worker (the drag), and a double-booking made on purpose', async () => {
  const { token, workerId } = await setup()
  const w = await week(token)
  const george = w.visits.find(v => v.date === SAT && v.client_name.startsWith('George'))
  const moved = await api('PUT', `/api/office/visits/${george.id}`, { token, body: moveBody(george, { worker_id: workerId('Jo') }) })
  assert.equal(moved.status, 200, moved.text)
  assert.equal(moved.body.version, george.version + 1)
  assert.equal(moved.body.worker_id, workerId('Jo'))
  assert.equal(moved.body.worker_name, 'Jo W. (SAMPLE)')
  const w2 = await week(token)
  assert.ok(!w2.conflicts.some(c => c.kind === 'travel_gap' && c.date === SAT), 'the Saturday travel gap is gone')
  assert.ok(w2.conflicts.some(c => c.kind === 'travel_gap' && c.date === '2026-09-20'), 'Sunday is untouched')
  // Jo is not available on Saturdays and George is outside her zone: two warnings, no problem.
  assert.deepEqual(w2.conflicts.filter(c => c.date === SAT).map(c => [c.kind, c.severity, c.worker_id, c.visit_ids]),
    [['unavailable', 'warning', workerId('Jo'), [george.id]], ['outside_zone', 'warning', workerId('Jo'), [george.id]]])

  const bill = w2.visits.find(v => v.date === MON && v.client_name.startsWith('Bill'))
  const margaret = w2.visits.find(v => v.date === MON && v.client_name.startsWith('Margaret'))
  const r = await api('PUT', `/api/office/visits/${bill.id}`, { token, body: moveBody(bill, { worker_id: workerId('Jo') }) })
  assert.equal(r.status, 200, r.text)
  const w3 = await week(token)
  const doubles = w3.conflicts.filter(c => c.kind === 'double_booked')
  assert.deepEqual(doubles.map(c => [c.worker_id, c.date, c.visit_ids, c.severity, c.message]), [
    [workerId('Jo'), MON, [margaret.id, bill.id].sort((a, b) => a - b), 'problem', 'Jo W. (SAMPLE) is booked for Margaret P. (SAMPLE) and Bill S. (SAMPLE) at the same time on Mon Sep 14.']
  ])
  for (const id of [bill.id, margaret.id]) assert.ok(w3.visits.find(v => v.id === id).conflict_kinds.includes('double_booked'))
  expectError(await api('PUT', `/api/office/visits/${bill.id}`, { token, body: moveBody(r.body, { worker_id: 999 }) }), 400, 'bad_request', 'worker_id')
  expectError(await api('PUT', '/api/office/visits/99999', { token, body: moveBody(r.body) }), 404, 'not_found')
})

test('week: a stale version is 409 stale, a visit with a check-in is 409 bad_state, cancel and restore', async () => {
  const { token, keyOf } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const later = await api('PUT', `/api/office/visits/${bill.id}`, { token, body: moveBody(bill, { start: '09:15', end: '10:15' }) })
  assert.equal(later.status, 200, later.text)
  assert.equal(later.body.time_label, '9:15 AM – 10:15 AM')
  assert.equal(later.body.starts_at, '2026-09-14T11:45:00.000Z')
  expectError(await api('PUT', `/api/office/visits/${bill.id}`, { token, body: moveBody(bill) }), 409, 'stale', undefined,
    'This visit was changed on another screen. Reload and try again.')

  const ruby = await visitOf(token, MON, 'Ruby')
  expectError(await api('POST', `/api/office/visits/${ruby.id}/cancel`, { token, body: { reason: '', version: ruby.version } }), 400, 'bad_request', 'reason', 'Say why the visit is cancelled.')
  expectError(await api('POST', `/api/office/visits/${ruby.id}/cancel`, { token, body: { reason: 'card 1234 5678 9012', version: ruby.version } }), 400, 'bad_request', 'reason', HEALTH)
  expectError(await api('POST', `/api/office/visits/${ruby.id}/cancel`, { token, body: { reason: 'Ruby is away (SAMPLE)', version: ruby.version + 1 } }), 409, 'stale')
  const cancelled = await api('POST', `/api/office/visits/${ruby.id}/cancel`, { token, body: { reason: 'Ruby is away (SAMPLE)', version: ruby.version } })
  assert.equal(cancelled.status, 200, cancelled.text)
  assert.equal(cancelled.body.cancelled, true)
  assert.equal(cancelled.body.cancel_reason, 'Ruby is away (SAMPLE)')
  assert.equal(cancelled.body.status, 'cancelled')
  assert.equal(cancelled.body.status_label, 'Cancelled')
  assert.equal(cancelled.body.version, ruby.version + 1)
  expectError(await api('PUT', `/api/office/visits/${ruby.id}`, { token, body: moveBody(cancelled.body) }), 409, 'bad_state', undefined, 'This visit is cancelled. Restore it first.')
  const restored = await api('POST', `/api/office/visits/${ruby.id}/restore`, { token, body: { version: cancelled.body.version } })
  assert.equal(restored.status, 200, restored.text)
  assert.equal(restored.body.cancelled, false)
  assert.equal(restored.body.cancel_reason, null)
  assert.equal(restored.body.status, 'scheduled')
  expectError(await api('POST', `/api/office/visits/${ruby.id}/restore`, { token, body: { version: cancelled.body.version } }), 409, 'stale')

  const at = nl(MON, '09:20')
  assert.equal((await checkIn(keyOf('Sam'), bill.id, at)).status, 201)
  const started = await visitOf(token, MON, 'Bill', at)
  expectError(await api('PUT', `/api/office/visits/${bill.id}`, { token, now: at, body: moveBody(started, { start: '11:00', end: '12:00' }) }), 409, 'bad_state', undefined,
    "This visit has started, so it can't be moved.")
  expectError(await api('POST', `/api/office/visits/${bill.id}/cancel`, { token, now: at, body: { reason: 'Too late (SAMPLE)', version: started.version } }), 409, 'bad_state')
})

test('visits: POST a one-off visit, its refusals, and the spring-forward gap', async () => {
  const { token, clientId, workerId } = await setup()
  const r = await api('POST', '/api/office/visits', { token, body: { client_id: clientId('Walter'), worker_id: workerId('Sam'), date: MON, start: '14:00', end: '14:45' } })
  assert.equal(r.status, 201, r.text)
  assert.equal(r.body.pattern_id, null)
  assert.equal(r.body.scheduled_minutes, 45)
  assert.equal(r.body.status, 'scheduled')
  assert.equal(r.body.date_label, 'Mon Sep 14')
  assert.equal(r.body.starts_at, '2026-09-14T16:30:00.000Z')
  assert.equal(r.body.worker_phone, '709-555-0132')
  assert.equal((await dayVisits(token, MON)).filter(v => v.id === r.body.id).length, 1)
  const unassigned = await api('POST', '/api/office/visits', { token, body: { client_id: clientId('Walter'), worker_id: null, date: MON, start: '15:00', end: '16:00' } })
  assert.equal(unassigned.body.status, 'unassigned')
  assert.equal(unassigned.body.status_label, 'No worker assigned')
  const post = over => api('POST', '/api/office/visits', { token, body: { client_id: clientId('Walter'), worker_id: null, date: MON, start: '14:00', end: '15:00', ...over } })
  expectError(await post({ client_id: 9999 }), 400, 'bad_request', 'client_id', 'Pick a client.')
  expectError(await post({ worker_id: 9999 }), 400, 'bad_request', 'worker_id')
  expectError(await post({ date: '14/09/2026' }), 400, 'bad_request', 'date', 'Pick a date.')
  expectError(await post({ start: '9am' }), 400, 'bad_request', 'start')
  expectError(await post({ end: '13:00' }), 400, 'bad_request', 'end', 'The visit has to end after it starts.')
  expectError(await post({ end: '14:10' }), 400, 'bad_request', 'end', 'A visit is between 15 minutes and 12 hours.')
  expectError(await post({ date: '2026-03-08', start: '02:30', end: '03:30' }), 400, 'bad_request', 'start', "That time doesn't exist on the day the clocks change.")
})

// ---------------------------------------------------------------- day board

test('day: the board alert from X-Test-Now, late at start + 15 min and missed at start + 30 min', async () => {
  const { token, keyOf } = await setup()
  const start = nl(MON, '09:00')
  const bill = async now => (await dayVisits(token, MON, now)).find(v => v.client_name.startsWith('Bill'))
  const at1459 = await bill(plusMs(start, 15 * 60000 - 1))
  assert.equal(at1459.alert, 'none')
  assert.equal(at1459.worker_phone, '709-555-0132')
  assert.equal((await bill(plus(start, 15))).alert, 'late')
  assert.equal((await bill(plusMs(start, 30 * 60000 - 1))).alert, 'late')
  const missed = await bill(plus(start, 30))
  assert.equal(missed.alert, 'missed')
  assert.equal(missed.status, 'scheduled')
  assert.equal(missed.late_minutes, null)

  const day = await api('GET', `/api/office/day?date=${MON}`, { token, now: plus(start, 30) })
  assert.equal(day.body.date_label, 'Mon Sep 14')
  assert.equal(day.body.server_now, plus(start, 30))
  assert.deepEqual(day.body.visits.map(v => v.client_name),
    ['Margaret P. (SAMPLE)', 'Bill S. (SAMPLE)', 'Walter G. (SAMPLE)', 'Ron K. (SAMPLE)', 'Ruby T. (SAMPLE)', 'Gladys W. (SAMPLE)'])

  const ruby = await visitOf(token, MON, 'Ruby')
  await api('POST', `/api/office/visits/${ruby.id}/cancel`, { token, body: { reason: 'Away (SAMPLE)', version: ruby.version } })
  assert.equal((await visitOf(token, MON, 'Ruby', nl(MON, '12:30'))).alert, 'none', 'cancelled is never late')

  assert.equal((await checkIn(keyOf('Sam'), missed.id, plus(start, 22), { now: plus(start, 40) })).status, 201)
  const checked = await bill(plus(start, 120))
  assert.equal(checked.alert, 'none')
  assert.equal(checked.late_minutes, 22)
  assert.equal(checked.late_label, '22 min late')
  assert.equal(checked.status_label, 'Checked in 9:22 AM')
})

// ---------------------------------------------------------------- worker events

test('events: check-in 201 with location near and distance_m (office view), far and not shared too', async () => {
  const { token, keyOf } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const at = '2026-09-14T11:34:12.000Z'
  const pin = pinOf('Bill')
  const near = await checkIn(keyOf('Sam'), bill.id, at, { location: { lat: pin.lat + 0.0003, lng: pin.lng, accuracy_m: 18 } })
  assert.equal(near.status, 201, near.text)
  assert.deepEqual(Object.keys(near.body.event).sort(), ['at', 'at_label', 'id', 'location_label', 'source'])
  assert.equal(near.body.event.location_label, 'Within 250 m of the client')
  assert.equal(near.body.event.at_label, '9:04 AM')
  assert.equal(near.body.visit.id, bill.id)
  assert.equal(near.body.visit.check_in.at, at)
  assert.ok(!near.text.includes('distance'), 'the worker view carries no distance')
  const office = (await visitOf(token, MON, 'Bill', at)).check_in
  assert.equal(office.location, 'near')
  assert.equal(office.distance_m, distanceM(pin.lat + 0.0003, pin.lng, pin.lat, pin.lng))
  assert.ok(office.distance_m > 30 && office.distance_m < 40, String(office.distance_m))
  assert.equal(office.worker_name, 'Sam R. (SAMPLE)')
  assert.equal(office.source, 'phone')
  assert.equal(office.received_at, at)
  assert.equal(office.correction_reason, null)

  const ruby = await visitOf(token, MON, 'Ruby')
  const far = await checkIn(keyOf('Sam'), ruby.id, nl(MON, '10:31'), { location: pin })
  assert.equal(far.status, 201, far.text)
  const metres = distanceM(pin.lat, pin.lng, pinOf('Ruby').lat, pinOf('Ruby').lng)
  assert.equal(far.body.event.location_label, `More than 250 m from the client (${kmText(metres)} km)`)
  const walter = await visitOf(token, MON, 'Walter')
  const none = await checkIn(keyOf('Alex'), walter.id, nl(MON, '09:01'))
  assert.equal(none.body.event.location_label, 'Location not shared')
  const officeNone = (await visitOf(token, MON, 'Walter', nl(MON, '09:02'))).check_in
  assert.equal(officeNone.location, 'not_shared')
  assert.equal(officeNone.distance_m, null)
  expectError(await checkIn(keyOf('Alex'), walter.id, nl(MON, '09:01'), { location: { lat: 91, lng: 0 } }), 400, 'bad_request', 'location')
})

test('events: the same id again answers 200 duplicate and the database still holds exactly one row', async () => {
  const { token, keyOf } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const ruby = await visitOf(token, MON, 'Ruby')
  const id = randomUUID()
  const at = nl(MON, '09:03')
  assert.equal((await checkIn(keyOf('Sam'), bill.id, at, { id })).status, 201)
  const again = await checkIn(keyOf('Sam'), bill.id, at, { id, now: plus(at, 5) })
  const upper = await checkIn(keyOf('Sam'), bill.id, at, { id: id.toUpperCase(), now: plus(at, 6) })
  // A phone bug sending the same id for another visit is still only a resend.
  const elsewhere = await checkIn(keyOf('Sam'), ruby.id, nl(MON, '10:32'), { id, now: nl(MON, '10:32') })
  // What the database holds is checked first, so a broken Worker shows the extra row, not only a wrong status.
  const rows = (await storedEvents()).filter(e => e.id === id)
  assert.equal(rows.length, 1, `rows stored with this id: ${JSON.stringify(rows)}`)
  assert.equal((await storedEvents(bill.id)).length, 1)
  assert.equal((await storedEvents(ruby.id)).length, 0)
  assert.equal(rows[0].received_at, at, 'nothing changed on the resends')
  for (const resend of [again, upper, elsewhere]) {
    assert.equal(resend.status, 200, resend.text)
    assert.equal(resend.body.duplicate, true)
    assert.equal(resend.body.event.id, id)
  }
  assert.equal(again.body.visit.id, bill.id)
})

test('events: a second check-in with a different id is 409 already_checked_in with the stored event', async () => {
  const { token, keyOf } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const first = await checkIn(keyOf('Sam'), bill.id, nl(MON, '09:04'))
  assert.equal(first.status, 201)
  const second = await checkIn(keyOf('Sam'), bill.id, nl(MON, '09:10'))
  expectError(second, 409, 'already_checked_in', undefined, 'This visit already has a check-in at 9:04 AM.')
  assert.deepEqual(second.body.event, first.body.event)
  assert.equal((await storedEvents(bill.id)).length, 1)
})

test('events: check-out before check-in is 409 bad_state; check-out is 201 with worked_seconds exact', async () => {
  const { token, keyOf } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const key = keyOf('Sam')
  const tasks = [
    { task_id: 12, kind: 'personal_care', label: 'Personal care', done: true },
    { task_id: 13, kind: 'housekeeping', label: 'Light housekeeping', done: false }
  ]
  const T = '2026-09-14T11:34:12.000Z'
  expectError(await checkOut(key, bill.id, T, { tasks }), 409, 'bad_state', undefined, 'Check in before you check out.')
  assert.equal((await checkIn(key, bill.id, T)).status, 201)
  const out = await checkOut(key, bill.id, plus(T, 92), { now: plus(T, 95), tasks, note: '  Ate well.\r\nAsked about Thursday.  ' })
  assert.equal(out.status, 201, out.text)
  const outAt = plusMs(T, 5530 * 1000)
  const exact = await checkOut(key, bill.id, outAt, { tasks })
  expectError(exact, 409, 'already_checked_out', undefined, `This visit already has a check-out at ${out.body.event.at_label}.`)
  assert.deepEqual(exact.body.event, out.body.event)
  assert.equal(out.body.visit.note.text, 'Ate well.\nAsked about Thursday.')
  assert.deepEqual(out.body.visit.tasks_done, tasks)
  const office = await visitOf(token, MON, 'Bill', plus(T, 120))
  assert.equal(office.worked_seconds, 92 * 60)
  assert.equal(office.status, 'checked_out')
  assert.equal(office.status_label, 'Checked out 10:36 AM')
  assert.deepEqual(office.note, { text: 'Ate well.\nAsked about Thursday.', shareable: false, written_label: '10:36 AM' })

  // The exact case from the brief, on another visit: T to T + 1:32:10 is 5 530 seconds.
  const ruby = await visitOf(token, MON, 'Ruby')
  const T2 = '2026-09-14T13:02:05.000Z'
  assert.equal((await checkIn(key, ruby.id, T2)).status, 201)
  assert.equal((await checkOut(key, ruby.id, plusMs(T2, 5530 * 1000), { tasks: [] })).status, 201)
  const r2 = await visitOf(token, MON, 'Ruby', plusMs(T2, 5600 * 1000))
  assert.equal(r2.worked_seconds, 5530)
  assert.equal(r2.check_out.at, '2026-09-14T14:34:15.000Z')
  assert.deepEqual(r2.tasks_done, [])
  assert.equal(r2.note, null)
})

test('events: original time kept — at = T with X-Test-Now = T + 45 min stores T; at 2 h ahead is adjusted', async () => {
  const { token, keyOf } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const T = '2026-09-14T11:34:12.678Z'
  const now = plus(T, 45)
  const r = await checkIn(keyOf('Sam'), bill.id, T, { now })
  assert.equal(r.status, 201, r.text)
  const [row] = await storedEvents(bill.id)
  assert.equal(row.at, '2026-09-14T11:34:12.000Z')
  assert.equal(row.at_adjusted, 0)
  assert.equal(row.received_at, '2026-09-14T12:19:12.000Z')
  const office = (await visitOf(token, MON, 'Bill', now)).check_in
  assert.equal(office.at, '2026-09-14T11:34:12.000Z')
  assert.equal(office.at_label, '9:04 AM')
  assert.equal(office.at_adjusted, false)

  const ruby = await visitOf(token, MON, 'Ruby')
  const ahead = await checkIn(keyOf('Sam'), ruby.id, plus(now, 120), { now })
  assert.equal(ahead.status, 201, ahead.text)
  const [adjusted] = await storedEvents(ruby.id)
  assert.equal(adjusted.at, '2026-09-14T12:19:12.000Z')
  assert.equal(adjusted.at_adjusted, 1)
  assert.equal((await visitOf(token, MON, 'Ruby', now)).check_in.at_adjusted, true)
})

test('events: a check-out earlier than its check-in is stored at the check-in time and flagged', async () => {
  const { token, keyOf } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const T = nl(MON, '09:04')
  assert.equal((await checkIn(keyOf('Sam'), bill.id, T)).status, 201)
  const out = await checkOut(keyOf('Sam'), bill.id, nl(MON, '08:50'), { now: plus(T, 10) })
  assert.equal(out.status, 201, out.text)
  const v = await visitOf(token, MON, 'Bill', plus(T, 10))
  assert.equal(v.check_out.at, T)
  assert.equal(v.check_out.at_adjusted, true)
  assert.equal(v.worked_seconds, 0)
})

test('events: a reassigned visit still accepts the first worker\'s check-in, and only that worker checks out', async () => {
  const { token, keyOf, workerId } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const moved = await api('PUT', `/api/office/visits/${bill.id}`, { token, body: moveBody(bill, { worker_id: workerId('Jo') }) })
  assert.equal(moved.status, 200, moved.text)
  const at = nl(MON, '09:03')
  const r = await checkIn(keyOf('Sam'), bill.id, at)
  assert.equal(r.status, 201, r.text)
  const v = await visitOf(token, MON, 'Bill', at)
  assert.equal(v.worker_id, workerId('Jo'))
  assert.equal(v.check_in.worker_id, workerId('Sam'))
  expectError(await checkOut(keyOf('Jo'), bill.id, nl(MON, '09:50')), 409, 'bad_state', undefined, 'Another worker checked in to this visit.')
  assert.equal((await checkOut(keyOf('Sam'), bill.id, nl(MON, '09:55'))).status, 201)
  const samList = await api('GET', `/api/worker/visits?date=${MON}`, { key: keyOf('Sam') })
  assert.ok(!samList.body.visits.some(x => x.id === bill.id), 'the list shows visits currently assigned')
})

test('events: a cancelled visit accepts events and the office sees visited_after_cancel', async () => {
  const { token, keyOf } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const c = await api('POST', `/api/office/visits/${bill.id}/cancel`, { token, body: { reason: 'Family visiting (SAMPLE)', version: bill.version } })
  assert.equal(c.status, 200)
  assert.equal(c.body.visited_after_cancel, false)
  const r = await checkIn(keyOf('Sam'), bill.id, nl(MON, '09:02'))
  assert.equal(r.status, 201, r.text)
  assert.equal(r.body.visit.cancelled, true)
  const v = await visitOf(token, MON, 'Bill', nl(MON, '09:03'))
  assert.equal(v.cancelled, true)
  assert.equal(v.visited_after_cancel, true)
  assert.equal(v.status, 'checked_in')
})

test('events: a stranger worker is 404, a bad key 401, and the input refusals', async () => {
  const { token, keyOf } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const at = nl(MON, '09:02')
  expectError(await checkIn(keyOf('Jo'), bill.id, at), 404, 'not_found', undefined, "That visit isn't on your list.")
  expectError(await checkIn(keyOf('Jo'), 99999, at), 404, 'not_found')
  expectError(await checkIn('not-a-key', bill.id, at), 401, 'unauthorized', undefined, "This link doesn't work any more. Ask the office for a new one.")
  const post = body => api('POST', '/api/worker/events', { key: keyOf('Sam'), now: at, body: { id: randomUUID(), visit_id: bill.id, kind: 'check_in', at, ...body } })
  expectError(await post({ id: 'not-a-uuid' }), 400, 'bad_request', 'id')
  expectError(await post({ kind: 'arrived' }), 400, 'bad_request', 'kind')
  expectError(await post({ at: 'nine' }), 400, 'bad_request', 'at')
  assert.equal((await post({})).status, 201)
  const out = body => post({ kind: 'check_out', tasks: [], note: '', ...body })
  expectError(await out({ note: 'one\ntwo\nthree' }), 400, 'bad_request', 'note', 'Keep the note to two short lines.')
  expectError(await out({ note: 'x'.repeat(201) }), 400, 'bad_request', 'note')
  expectError(await out({ note: 'MCP 1234 5678 9012' }), 400, 'bad_request', 'note', HEALTH)
  expectError(await out({ tasks: undefined }), 400, 'bad_request', 'tasks', "The task list didn't come through. Reload and try again.")
  expectError(await out({ tasks: [{ task_id: 1, kind: 'personal_care', label: 'Personal care', done: 'yes' }] }), 400, 'bad_request', 'tasks')
  expectError(await out({ tasks: [{ task_id: 1, kind: 'medication_reminder', label: 'Gave her pills', done: true }] }), 400, 'bad_request', 'tasks', MEDICATION)
  assert.equal((await storedEvents(bill.id)).filter(e => e.kind === 'check_out').length, 0)
  assert.equal((await out({ note: 'one\r\ntwo' })).status, 201)
})

// ---------------------------------------------------------------- worker visits

test('worker visits: only this worker\'s visits for the date, in order, with entry notes; never family phones or funders', async () => {
  const { token, keyOf } = await setup()
  const key = keyOf('Sam')
  const r = await api('GET', '/api/worker/visits', { key })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.body.worker, { id: r.body.worker.id, name: 'Sam R. (SAMPLE)', initials: 'SR' })
  assert.deepEqual(r.body.agency, { name: AGENCY, sample: true, office_phone: '709-555-0100', timezone: 'America/St_Johns' })
  assert.equal(r.body.date, MON)
  assert.equal(r.body.date_label, 'Mon Sep 14')
  assert.deepEqual(r.body.visits.map(v => [v.client_name, v.time_label]), [['Bill S. (SAMPLE)', '9:00 AM – 10:00 AM'], ['Ruby T. (SAMPLE)', '10:30 AM – 12:00 PM']])
  const bill = r.body.visits[0]
  assert.equal(bill.entry_notes, 'Key safe by the shed, code 5530 (SAMPLE).')
  assert.equal(bill.client_initials, 'BS')
  assert.deepEqual(bill.tasks.map(t => t.label), ['Personal care', 'Light housekeeping'])
  assert.equal(bill.check_in, null)
  assert.deepEqual(bill.tasks_done, [])
  assert.deepEqual(r.body.mileage, { metres: 0, km: '0.0', note: 'Straight-line distance between your check-ins today.' })
  for (const c of SAMPLE.clients) for (const f of c.family_contacts) assert.ok(!r.text.includes(f.phone), `family phone ${f.phone}`)
  for (const f of SAMPLE.funders) assert.ok(!r.text.includes(f.name), `funder ${f.name}`)
  assert.ok(!r.text.includes('distance_m'), 'no distances from the pin')
  assert.ok(!r.text.includes('Jo W.') && !r.text.includes('Margaret'), 'no other worker\'s visits')

  // Check in at Bill, then Ruby: mileage follows the check-ins.
  const ruby = r.body.visits[1]
  assert.equal((await checkIn(key, bill.id, nl(MON, '09:02'))).status, 201)
  assert.equal((await checkIn(key, ruby.id, nl(MON, '10:31'))).status, 201)
  const later = await api('GET', '/api/worker/visits', { key, now: nl(MON, '10:40') })
  const metres = distanceM(bill.lat, bill.lng, ruby.lat, ruby.lng)
  assert.deepEqual(later.body.mileage, { metres, km: kmText(metres), note: 'Straight-line distance between your check-ins today.' })
  assert.equal(later.body.visits[0].check_in.location_label, 'Location not shared')

  const tue = await api('GET', `/api/worker/visits?date=${TUE}`, { key })
  assert.deepEqual(tue.body.visits.map(v => v.client_name), ['Frank H. (SAMPLE)'])
  assert.equal((await api('GET', '/api/worker/visits?date=2026-09-13', { key })).status, 200, 'yesterday is allowed')
  assert.equal((await api('GET', '/api/worker/visits?date=2026-09-20', { key })).status, 200, '6 days ahead is allowed')
  expectError(await api('GET', '/api/worker/visits?date=2026-09-21', { key }), 400, 'bad_request', 'date', 'Pick a day from yesterday to next week.')
  expectError(await api('GET', '/api/worker/visits?date=2026-09-12', { key }), 400, 'bad_request', 'date')
  expectError(await api('GET', '/api/worker/visits', {}), 401, 'unauthorized')

  assert.equal((await visitOf(token, MON, 'Ruby', nl(MON, '10:40'))).status, 'checked_in')
})

// ---------------------------------------------------------------- family link

test('family privacy: a checked-out visit with a non-shareable note shows none of what must never reach the family', async () => {
  const { token, keyOf, familyKey } = await setup()
  const margaret = await visitOf(token, MON, 'Margaret')
  const key = keyOf('Jo')
  const NOTE = 'Ate well, talked about the SAMPLE garden.'
  const REASON = 'SAMPLE reason: away at her sister\'s'
  assert.equal((await checkIn(key, margaret.id, nl(MON, '08:32'), { location: pinOf('Margaret') })).status, 201)
  const tasks = [
    { task_id: 1, kind: 'personal_care', label: 'Personal care', done: true },
    { task_id: 2, kind: 'meal_prep', label: 'Meal preparation', done: true },
    { task_id: 3, kind: 'medication_reminder', label: 'Medication reminder', done: false }
  ]
  assert.equal((await checkOut(key, margaret.id, nl(MON, '09:28'), { tasks, note: NOTE })).status, 201)
  const tuesday = await visitOf(token, TUE, 'Margaret')
  assert.equal((await api('POST', `/api/office/visits/${tuesday.id}/cancel`, { token, body: { reason: REASON, version: tuesday.version } })).status, 200)

  const now = nl(MON, '10:00')
  const r = await api('GET', `/api/family/${familyKey('Margaret')}`, { now })
  assert.equal(r.status, 200, r.text)
  const client = SAMPLE.clients.find(c => c.name.startsWith('Margaret'))
  const never = [
    NOTE, client.entry_notes, client.address, String(client.lat), String(client.lng), REASON, 'distance', 'location', 'Within 250 m',
    'Jo W.', 'Linda P.', 'Daughter', ...SAMPLE.workers.map(w => w.phone), ...SAMPLE.clients.flatMap(c => c.family_contacts.map(f => f.phone)),
    ...SAMPLE.funders.map(f => f.name)
  ]
  for (const s of never) assert.ok(!r.text.includes(s), `the family answer contains ${JSON.stringify(s)}`)
  assert.deepEqual(r.body.agency, { name: AGENCY, sample: true, office_phone: '709-555-0100' })
  assert.deepEqual(r.body.client, { name: 'Margaret P. (SAMPLE)', initials: 'MP' })
  assert.deepEqual(r.body.today.visits, [{
    time_label: '8:30 AM – 9:30 AM', worker_first_name: 'Jo', status: 'left', status_label: 'Arrived 8:32 AM, left 9:28 AM',
    arrived_label: '8:32 AM', left_label: '9:28 AM', tasks_done: ['Personal care', 'Meal preparation'], note: null
  }])
  assert.equal(r.body.week.days[1].visits[0].status, 'cancelled')
  assert.equal(r.body.updated_label, 'Mon Sep 14, 10:00 AM')

  const shared = await api('PUT', `/api/office/visits/${margaret.id}/note`, { token, now, body: { shareable: true } })
  assert.equal(shared.status, 200, shared.text)
  assert.equal(shared.body.note.shareable, true)
  const after = await api('GET', `/api/family/${familyKey('Margaret')}`, { now })
  assert.ok(after.text.includes(NOTE), 'a shareable note reaches the family')
  assert.equal(after.body.today.visits[0].note, NOTE)
  expectError(await api('PUT', `/api/office/visits/${tuesday.id}/note`, { token, now, body: { shareable: true } }), 404, 'not_found', undefined, 'This visit has no note.')
  expectError(await api('PUT', `/api/office/visits/${margaret.id}/note`, { token, now, body: { shareable: 'yes' } }), 400, 'bad_request', 'shareable')
})

test('family: status labels for scheduled, not checked in yet, no check-in recorded, arrived, left and cancelled; unknown key 404', async () => {
  const now = nl(WED, '10:20')
  const { token, keyOf, familyKey } = await setup(now)
  const alex = keyOf('Alex')
  const mon = await visitOf(token, MON, 'Walter', now)
  assert.equal((await checkIn(alex, mon.id, nl(MON, '09:02'), { now })).status, 201)
  assert.equal((await checkOut(alex, mon.id, nl(MON, '09:58'), { now, tasks: [{ task_id: null, kind: 'meal_prep', label: 'Meal preparation', done: true }] })).status, 201)
  const tue = await visitOf(token, TUE, 'Walter', now)
  assert.equal((await api('POST', `/api/office/visits/${tue.id}/cancel`, { token, now, body: { reason: 'Away (SAMPLE)', version: tue.version } })).status, 200)
  const wed = await visitOf(token, WED, 'Walter', now)
  assert.equal((await checkIn(alex, wed.id, nl(WED, '09:03'), { now })).status, 201)

  const walter = await api('GET', `/api/family/${familyKey('Walter')}`, { now })
  assert.equal(walter.status, 200, walter.text)
  assert.equal(walter.body.week.week_label, 'Week of Mon Sep 14')
  assert.equal(walter.body.week.days.length, 7)
  const statuses = walter.body.week.days.map(d => d.visits.map(v => [v.status, v.status_label]))
  assert.deepEqual(statuses, [
    [['left', 'Arrived 9:02 AM, left 9:58 AM']], [['cancelled', 'Cancelled']], [['arrived', 'Arrived 9:03 AM']],
    [['scheduled', 'Scheduled']], [['scheduled', 'Scheduled']], [], []
  ])
  assert.equal(walter.body.today.date, WED)
  assert.deepEqual(walter.body.today.visits.map(v => [v.status, v.worker_first_name, v.arrived_label, v.left_label]), [['arrived', 'Alex', '9:03 AM', null]])
  assert.deepEqual(walter.body.week.days[0].visits[0].tasks_done, ['Meal preparation'])

  const ron = await api('GET', `/api/family/${familyKey('Ron')}`, { now })
  assert.deepEqual(ron.body.week.days.map(d => d.visits.map(v => v.status_label)),
    [['No check-in recorded'], [], ['Not checked in yet'], [], ['Scheduled'], [], []])
  assert.equal(ron.body.week.days[2].visits[0].status, 'not_checked_in')

  expectError(await api('GET', '/api/family/not-a-real-key-at-all', { now }), 404, 'not_found', undefined, "This link doesn't work. Ask the agency for a new one.")
  expectError(await api('GET', '/api/family/', { now }), 404, 'not_found')
})

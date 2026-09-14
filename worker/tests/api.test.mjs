// API tests (M1) against a running Worker started with --var TEST_MODE:1 (tests/run.mjs does that).
// BASE defaults to http://127.0.0.1:7902. Every test resets first. The clock is pinned with X-Test-Now (NL times via nl()).
// Stored rows are counted through GET /api/test/events (raw rows, voided included).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { addDays, localToUtc } from '../src/time.js'
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
  assert.deepEqual(Object.keys(near.body.event).sort(), ['at', 'at_label', 'id', 'kind', 'location_label', 'source', 'visit_id'])
  assert.equal(near.body.event.kind, 'check_in')
  assert.equal(near.body.event.visit_id, bill.id)
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
  // A bad note or task list never refuses a check-out (clarification 8; its own test below). A good two-line note is stored.
  const good = await out({ note: 'one\r\ntwo' })
  assert.equal(good.status, 201, good.text)
  assert.equal(good.body.visit.note.text, 'one\ntwo')
  assert.equal(good.body.note_refused, undefined)
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
  // Clarification 16: 7 days back to 6 days ahead.
  assert.equal((await api('GET', '/api/worker/visits?date=2026-09-13', { key })).status, 200, 'yesterday is allowed')
  const weekBack = await api('GET', '/api/worker/visits?date=2026-09-07', { key })
  assert.equal(weekBack.status, 200, '7 days back is allowed')
  assert.deepEqual(weekBack.body.visits.map(v => v.client_name), ['Bill S. (SAMPLE)', 'Ruby T. (SAMPLE)'], "last Monday's visits")
  assert.equal((await api('GET', '/api/worker/visits?date=2026-09-20', { key })).status, 200, '6 days ahead is allowed')
  expectError(await api('GET', '/api/worker/visits?date=2026-09-06', { key }), 400, 'bad_request', 'date', 'Pick a day from last week to next week.')
  expectError(await api('GET', '/api/worker/visits?date=2026-09-21', { key }), 400, 'bad_request', 'date', 'Pick a day from last week to next week.')
  expectError(await api('GET', '/api/worker/visits', {}), 401, 'unauthorized')

  assert.equal((await visitOf(token, MON, 'Ruby', nl(MON, '10:40'))).status, 'checked_in')
})

test('worker visits: open_dates lists the earlier days this worker left a visit checked in and not checked out', async () => {
  const { token, keyOf, workerId, clientId } = await setup()
  const sam = keyOf('Sam')
  const jo = keyOf('Jo')
  const SUN6 = '2026-09-06'
  const MON7 = '2026-09-07'
  const TUE8 = '2026-09-08'
  const WED9 = '2026-09-09'
  const THU10 = '2026-09-10'
  const FRI11 = '2026-09-11'
  const openDates = async (key, date, now = NOW) => {
    const r = await api('GET', `/api/worker/visits${date ? `?date=${date}` : ''}`, { key, now })
    assert.equal(r.status, 200, r.text)
    return r.body.open_dates
  }
  assert.deepEqual(await openDates(sam), [], 'nothing open yet')

  // 3 days ago (Friday): Sam checks in at Bill S. and never checks out.
  const bill11 = await visitOf(token, FRI11, 'Bill')
  assert.equal((await checkIn(sam, bill11.id, nl(FRI11, '09:02'))).status, 201)
  assert.deepEqual(await openDates(sam), [FRI11], 'a check-in 3 days ago with no check-out')

  // 7 days back (Monday Sep 7) is listed; 8 days back (Sunday Sep 6, a one-off) is not.
  const bill7 = await visitOf(token, MON7, 'Bill')
  assert.equal((await checkIn(sam, bill7.id, nl(MON7, '09:02'))).status, 201)
  const sun = await api('POST', '/api/office/visits', { token, body: { client_id: clientId('Bill'), worker_id: workerId('Sam'), date: SUN6, start: '09:00', end: '10:00' } })
  assert.equal(sun.status, 201, sun.text)
  assert.equal((await checkIn(sam, sun.body.id, nl(SUN6, '09:02'))).status, 201)

  // A soft-removed visit with an open check-in counts: the office moves Ruby T.'s pattern at 10:00 on Wednesday, and Sam's
  // check-in tapped at 10:25 (before the change reached the phone) lands on the removed 10:30 visit.
  const ruby9 = await visitOf(token, WED9, 'Ruby', nl(WED9, '09:00'))
  const ruby = (await api('GET', `/api/office/clients/${clientId('Ruby')}`, { token })).body
  const input = clientInput(ruby)
  input.patterns[0] = { ...input.patterns[0], start: '11:00', end: '12:30' }
  const moved = await api('PUT', `/api/office/clients/${ruby.id}`, { token, now: nl(WED9, '10:00'), body: input })
  assert.ok(moved.body.rebuilt_visits >= 1, moved.text)
  assert.equal((await checkIn(sam, ruby9.id, nl(WED9, '10:25'), { now: nl(WED9, '10:40') })).status, 201)

  // A voided check-in does not count: Sam's phone check-in on Tuesday is replaced by the office's for the visit's worker, Jo.
  const frank8 = await visitOf(token, TUE8, 'Frank', nl(TUE8, '07:00'))
  assert.equal((await api('PUT', `/api/office/visits/${frank8.id}`, { token, now: nl(TUE8, '07:00'), body: moveBody(frank8, { worker_id: workerId('Jo') }) })).status, 200)
  assert.equal((await checkIn(sam, frank8.id, nl(TUE8, '09:03'))).status, 201, 'the first worker may still check in')
  const f = await visitOf(token, TUE8, 'Frank', nl(TUE8, '12:00'))
  const fix = await api('PUT', `/api/office/visits/${f.id}/times`, { token, now: nl(TUE8, '12:00'), body: { check_in_at: nl(TUE8, '09:00'), reason: 'Jo was there (SAMPLE)', version: f.version } })
  assert.equal(fix.status, 200, fix.text)
  assert.equal((await storedEvents(f.id)).filter(e => e.voided_at).length, 1, "Sam's check-in is voided")

  // Another worker's open check-in is not Sam's.
  const margaret10 = await visitOf(token, THU10, 'Margaret')
  assert.equal((await checkIn(jo, margaret10.id, nl(THU10, '08:32'))).status, 201)

  // Today's open check-in is never listed.
  const billToday = await visitOf(token, MON, 'Bill')
  assert.equal((await checkIn(sam, billToday.id, nl(MON, '09:02'))).status, 201)

  const later = nl(MON, '10:00')
  assert.deepEqual(await openDates(sam, undefined, later), [MON7, WED9, FRI11])
  assert.deepEqual(await openDates(jo, undefined, later), [TUE8, THU10], "Jo's own: the office's check-in on Tuesday, Thursday's phone check-in")
  for (const date of [MON, '2026-09-13', '2026-09-16', '2026-09-20', MON7]) {
    const expected = [MON7, WED9, FRI11].filter(d => d !== date)
    assert.deepEqual(await openDates(sam, date, later), expected, `the same list for date=${date} (minus the requested date)`)
  }

  // Its check-out takes Friday off the list.
  assert.equal((await checkOut(sam, bill11.id, nl(FRI11, '10:00'), { now: later })).status, 201)
  assert.deepEqual(await openDates(sam, undefined, later), [MON7, WED9])
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

// ================================================================ M2

const workerInput = w => {
  const { id, initials, zone_names, availability_label, max_week_label, worker_url, ...input } = w
  return input
}

test('worker key: deactivating a worker keeps their link; their saved check-out still lands; only New link stops it', async () => {
  const { token, keyOf, workerId } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const key = keyOf('Sam')
  assert.equal((await checkIn(key, bill.id, nl(MON, '09:02'))).status, 201)
  const sam = (await api('GET', '/api/office/workers', { token })).body.workers.find(w => w.name.startsWith('Sam'))
  const off = await api('PUT', `/api/office/workers/${sam.id}`, { token, now: nl(MON, '09:10'), body: { ...workerInput(sam), active: false } })
  assert.equal(off.status, 200, off.text)
  assert.equal(off.body.active, false)
  const list = await api('GET', '/api/worker/visits', { key, now: nl(MON, '09:20') })
  assert.equal(list.status, 200, list.text)
  assert.deepEqual(list.body.visits.map(v => v.id), [bill.id], 'the started visit stays theirs, the unstarted one is taken off')
  const out = await checkOut(key, bill.id, nl(MON, '09:58'), { now: nl(MON, '10:30') })
  assert.equal(out.status, 201, out.text)
  assert.equal((await visitOf(token, MON, 'Bill', nl(MON, '10:30'))).worked_seconds, 56 * 60)
  const link = await api('POST', `/api/office/workers/${workerId('Sam')}/new-link`, { token, now: nl(MON, '10:31') })
  assert.equal(link.status, 200, link.text)
  expectError(await api('GET', '/api/worker/visits', { key, now: nl(MON, '10:32') }), 401, 'unauthorized')
  const fresh = new URL(link.body.worker_url).searchParams.get('k')
  assert.equal((await api('GET', '/api/worker/visits', { key: fresh, now: nl(MON, '10:32') })).status, 200)
})

test('new link: a new worker link makes the old key 401, a new family link makes the old key 404', async () => {
  const { token, keyOf, workerId, clientId, familyKey } = await setup()
  const oldKey = keyOf('Jo')
  assert.equal((await api('GET', '/api/worker/visits', { key: oldKey })).status, 200)
  const w = await api('POST', `/api/office/workers/${workerId('Jo')}/new-link`, { token })
  assert.equal(w.status, 200, w.text)
  assert.equal(w.body.name, 'Jo W. (SAMPLE)')
  const newKey = new URL(w.body.worker_url).searchParams.get('k')
  assert.notEqual(newKey, oldKey)
  assert.ok(newKey.length >= 22)
  expectError(await api('GET', '/api/worker/visits', { key: oldKey }), 401, 'unauthorized')
  assert.equal((await api('GET', '/api/worker/visits', { key: newKey })).status, 200)

  const oldFamily = familyKey('Walter')
  assert.equal((await api('GET', `/api/family/${oldFamily}`)).status, 200)
  const c = await api('POST', `/api/office/clients/${clientId('Walter')}/new-link`, { token })
  assert.equal(c.status, 200, c.text)
  const newFamily = new URL(c.body.family_url).searchParams.get('k')
  assert.notEqual(newFamily, oldFamily)
  expectError(await api('GET', `/api/family/${oldFamily}`), 404, 'not_found')
  assert.equal((await api('GET', `/api/family/${newFamily}`)).status, 200)
  expectError(await api('POST', '/api/office/workers/999/new-link', { token }), 404, 'not_found')
  expectError(await api('POST', '/api/office/clients/999/new-link', { token }), 404, 'not_found')
  expectError(await api('POST', `/api/office/clients/${clientId('Walter')}/new-link`), 401, 'unauthorized')
})

test('office agency: GET and PUT, and the public agency follows', async () => {
  const { token } = await setup()
  const r = await api('GET', '/api/office/agency', { token })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.body, {
    name: AGENCY, sample: true, timezone: 'America/St_Johns', office_phone: '709-555-0100', late_after_minutes: 15, missed_after_minutes: 30,
    near_metres: 250, office: { label: 'SAMPLE office, Grand Falls-Windsor', lat: 48.964, lng: -55.66444 }, zones: SAMPLE.zones, funders: SAMPLE.funders
  })
  expectError(await api('GET', '/api/office/agency'), 401, 'unauthorized')
  expectError(await api('PUT', '/api/office/agency', { token, body: { name: ' ', office_phone: '709-555-0100' } }), 400, 'bad_request', 'name', 'Give the agency a name.')
  expectError(await api('PUT', '/api/office/agency', { token, body: { name: 'N'.repeat(81), office_phone: '709-555-0100' } }), 400, 'bad_request', 'name')
  expectError(await api('PUT', '/api/office/agency', { token, body: { name: 'Exploits Home Support', office_phone: '555' } }), 400, 'bad_request', 'office_phone', 'Type a 10-digit phone number, like 709-555-0152.')
  const put = await api('PUT', '/api/office/agency', { token, body: { name: 'Exploits Home Support', office_phone: '(709) 555-0109' } })
  assert.equal(put.status, 200, put.text)
  assert.equal(put.body.sample, false)
  assert.equal(put.body.office_phone, '709-555-0109')
  assert.deepEqual((await api('GET', '/api/agency')).body.name, 'Exploits Home Support')
  assert.equal((await api('GET', '/api/agency')).body.sample, false)
})

test('office PIN: 4 to 8 digits; a wrong current PIN is 401 field current and keeps the session; the new PIN signs in', async () => {
  const { token } = await setup()
  expectError(await api('PUT', '/api/office/pin', { token, body: { current: '4826', new: '12' } }), 400, 'bad_request', 'new', 'Use 4 to 8 digits.')
  expectError(await api('PUT', '/api/office/pin', { token, body: { current: '4826', new: '123456789' } }), 400, 'bad_request', 'new')
  expectError(await api('PUT', '/api/office/pin', { token, body: { current: '1111', new: '2468' } }), 401, 'unauthorized', 'current', 'That PIN is not right.')
  assert.equal((await api('GET', '/api/office/clients', { token })).status, 200, 'the session stays')
  expectError(await api('PUT', '/api/office/pin', { body: { current: '4826', new: '2468' } }), 401, 'unauthorized')
  assert.equal((await api('PUT', '/api/office/pin', { token, body: { current: '4826', new: '246813' } })).status, 200)
  expectError(await api('POST', '/api/office/signin', { body: { pin: '4826' } }), 401, 'unauthorized', 'pin')
  assert.equal((await api('POST', '/api/office/signin', { body: { pin: '246813' } })).status, 200)
})

test('office PIN: a successful change ends every other session; a wrong current PIN deletes nothing', async () => {
  const { token: a } = await setup()
  const b = (await api('POST', '/api/office/signin', { body: { pin: '4826' } })).body.token
  const c = (await api('POST', '/api/office/signin', { body: { pin: '4826' } })).body.token
  expectError(await api('PUT', '/api/office/pin', { token: a, body: { current: '1111', new: '2468' } }), 401, 'unauthorized', 'current')
  for (const t of [a, b, c]) assert.equal((await api('GET', '/api/office/clients', { token: t })).status, 200, 'a wrong current PIN ends no session')
  assert.equal((await api('PUT', '/api/office/pin', { token: a, body: { current: '4826', new: '2468' } })).status, 200)
  assert.equal((await api('GET', '/api/office/clients', { token: a })).status, 200, "the caller's session stays")
  for (const t of [b, c]) {
    const r = await api('GET', '/api/office/clients', { token: t })
    expectError(r, 401, 'unauthorized')
    assert.equal(r.body.field, undefined, 'a 401 without field: the session ended')
  }
  const d = (await api('POST', '/api/office/signin', { body: { pin: '2468' } })).body.token
  assert.equal((await api('GET', '/api/office/clients', { token: d })).status, 200, 'the new PIN signs in')
})

test('rate guards: 5 wrong PINs from one IP → 429 even for the right PIN; other IPs and a passed window are fine; wrong current PINs count', async () => {
  const { token } = await setup()
  const ip = '10.9.9.1'
  for (let i = 0; i < 5; i++) expectError(await api('POST', '/api/office/signin', { ip, body: { pin: '1111' } }), 401, 'unauthorized', 'pin')
  expectError(await api('POST', '/api/office/signin', { ip, body: { pin: '4826' } }), 429, 'rate_limited', undefined, 'Too many tries. Wait 15 minutes and try again.')
  assert.equal((await api('POST', '/api/office/signin', { ip: '10.9.9.2', body: { pin: '4826' } })).status, 200)
  assert.equal((await api('POST', '/api/office/signin', { ip, now: plusMs(NOW, 15 * 60000 - 1000), body: { pin: '4826' } })).status, 429)
  assert.equal((await api('POST', '/api/office/signin', { ip, now: plusMs(NOW, 15 * 60000 + 1000), body: { pin: '4826' } })).status, 200)

  const ip3 = '10.9.9.3'
  for (let i = 0; i < 4; i++) await api('POST', '/api/office/signin', { ip: ip3, body: { pin: '0000' } })
  expectError(await api('PUT', '/api/office/pin', { token, ip: ip3, body: { current: '0000', new: '2468' } }), 401, 'unauthorized', 'current')
  expectError(await api('POST', '/api/office/signin', { ip: ip3, body: { pin: '4826' } }), 429, 'rate_limited')
  expectError(await api('PUT', '/api/office/pin', { token, ip: ip3, body: { current: '4826', new: '2468' } }), 429, 'rate_limited')
})

test('rate guards: 30 unknown family keys from one IP → 429 for every lookup from that IP, known keys included', async () => {
  const { familyKey } = await setup()
  const ip = '10.8.8.1'
  const known = familyKey('Walter')
  for (let i = 0; i < 30; i++) expectError(await api('GET', `/api/family/guess-${i}-aaaaaaaaaaaaaaaa`, { ip }), 404, 'not_found')
  expectError(await api('GET', `/api/family/${known}`, { ip }), 429, 'rate_limited', undefined, 'Too many tries. Wait a few minutes and try again.')
  expectError(await api('GET', '/api/family/guess-31-aaaaaaaaaaaaaaaa', { ip }), 429, 'rate_limited')
  assert.equal((await api('GET', `/api/family/${known}`, { ip: '10.8.8.2' })).status, 200)
  assert.equal((await api('GET', `/api/family/${known}`, { ip, now: plusMs(NOW, 10 * 60000 + 1000) })).status, 200)
})

test('fix times: the office sets a missing check-out; the phone\'s later check-out is 409; the voided phone event stays', async () => {
  const { token, keyOf, clientId } = await setup()
  const bill = await visitOf(token, MON, 'Bill')
  const phoneIn = await checkIn(keyOf('Sam'), bill.id, nl(MON, '09:03'))
  assert.equal(phoneIn.status, 201)
  const now = nl(MON, '13:00')
  let v = await visitOf(token, MON, 'Bill', now)
  const put = (body, visit = v) => api('PUT', `/api/office/visits/${visit.id}/times`, { token, now, body: { version: visit.version, reason: 'Phone battery died (SAMPLE)', ...body } })
  expectError(await put({ check_in_at: null, check_out_at: null }), 400, 'bad_request', 'check_in_at', 'Give a check-in or a check-out time.')
  expectError(await put({ check_out_at: nl(MON, '10:01'), reason: '' }), 400, 'bad_request', 'reason', 'Say why the time is being fixed.')
  expectError(await put({ check_out_at: nl(MON, '10:01'), reason: 'MCP 1234 5678 9012' }), 400, 'bad_request', 'reason', HEALTH)
  expectError(await put({ check_out_at: nl(MON, '09:03') }), 400, 'bad_request', 'check_out_at', 'Check-out has to be after check-in.')
  expectError(await put({ check_out_at: nl(TUE, '10:01') }), 400, 'bad_request', 'check_out_at', 'That time is too far from the visit.')
  expectError(await put({ check_out_at: nl(MON, '10:01'), version: v.version + 1 }), 409, 'stale')

  const fixed = await put({ check_out_at: nl(MON, '10:01') })
  assert.equal(fixed.status, 200, fixed.text)
  assert.equal(fixed.body.version, v.version + 1)
  assert.equal(fixed.body.worked_seconds, 58 * 60)
  assert.equal(fixed.body.status, 'checked_out')
  assert.equal(fixed.body.check_out.source, 'office')
  assert.equal(fixed.body.check_out.correction_reason, 'Phone battery died (SAMPLE)')
  assert.equal(fixed.body.check_out.at_label, '10:01 AM')
  assert.equal(fixed.body.check_out.location, null)

  expectError(await checkOut(keyOf('Sam'), bill.id, nl(MON, '10:05'), { now: nl(MON, '13:05') }), 409, 'already_checked_out')

  v = fixed.body
  const fixIn = await put({ check_in_at: nl(MON, '09:00') })
  assert.equal(fixIn.status, 200, fixIn.text)
  assert.equal(fixIn.body.check_in.source, 'office')
  assert.equal(fixIn.body.check_in.location, 'not_shared')
  assert.equal(fixIn.body.check_in.worker_name, 'Sam R. (SAMPLE)')
  assert.equal(fixIn.body.worked_seconds, 61 * 60)
  const rows = await storedEvents(bill.id)
  assert.equal(rows.length, 3, JSON.stringify(rows))
  assert.deepEqual(rows.filter(e => e.voided_at).map(e => e.id), [phoneIn.body.event.id])
  const payroll = await api('GET', `/api/office/reports/payroll?from=${MON}&to=${MON}`, { token, now })
  assert.equal(payroll.body.total.seconds, 61 * 60)

  const loose = await api('POST', '/api/office/visits', { token, body: { client_id: clientId('Walter'), worker_id: null, date: MON, start: '14:00', end: '15:00' } })
  expectError(await put({ check_in_at: nl(MON, '14:00') }, loose.body), 400, 'bad_request', 'worker_id', 'Assign a worker first.')
  const walter = await visitOf(token, MON, 'Walter', now)
  expectError(await put({ check_out_at: nl(MON, '10:00') }, walter), 400, 'bad_request', 'check_out_at')
})

/** A worker's visit worked from `startHm` for exactly `seconds`, through the phone routes. */
async function work (token, key, date, clientPrefix, startHm, seconds) {
  const v = await visitOf(token, date, clientPrefix)
  const at = nl(date, startHm)
  assert.equal((await checkIn(key, v.id, at)).status, 201)
  assert.equal((await checkOut(key, v.id, plusMs(at, seconds * 1000))).status, 201)
  return v
}

test('reports: payroll exactness — 1:00:20 + 0:45:20 + 2:10:20 is 14 160 s and "3.93" (rounding each visit would say 3.94)', async () => {
  const { token, keyOf, workerId, clientId } = await setup()
  await work(token, keyOf('Sam'), MON, 'Bill', '09:00', 3620)
  await work(token, keyOf('Sam'), MON, 'Ruby', '10:30', 2720)
  await work(token, keyOf('Sam'), WED, 'Bill', '09:00', 7820)
  await work(token, keyOf('Alex'), MON, 'Walter', '09:05', 3600)
  const open = await visitOf(token, TUE, 'Walter')
  assert.equal((await checkIn(keyOf('Alex'), open.id, nl(TUE, '09:01'))).status, 201)
  const r = await api('GET', `/api/office/reports/payroll?from=${MON}&to=${WED}`, { token, now: nl(WED, '18:00') })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.body, {
    from: MON,
    to: WED,
    period_label: 'Mon Sep 14 to Wed Sep 16',
    rows: [
      { worker_id: workerId('Alex'), worker_name: 'Alex B. (SAMPLE)', visits: 1, seconds: 3600, hours: '1.00', hm_label: '1 h 0 min',
        clients: [{ client_id: clientId('Walter'), client_name: 'Walter G. (SAMPLE)', visits: 1, seconds: 3600, hours: '1.00', hm_label: '1 h 0 min' }] },
      { worker_id: workerId('Sam'), worker_name: 'Sam R. (SAMPLE)', visits: 3, seconds: 14160, hours: '3.93', hm_label: '3 h 56 min',
        clients: [
          { client_id: clientId('Bill'), client_name: 'Bill S. (SAMPLE)', visits: 2, seconds: 11440, hours: '3.18', hm_label: '3 h 10 min' },
          { client_id: clientId('Ruby'), client_name: 'Ruby T. (SAMPLE)', visits: 1, seconds: 2720, hours: '0.76', hm_label: '0 h 45 min' }
        ] }
    ],
    total: { visits: 4, seconds: 17760, hours: '4.93', hm_label: '4 h 56 min' },
    incomplete: [{ visit_id: open.id, worker_name: 'Alex B. (SAMPLE)', client_name: 'Walter G. (SAMPLE)', date_label: 'Tue Sep 15', check_in_label: '9:01 AM' }],
    note: 'Hours are check-out minus check-in, added up to the second and rounded once.'
  })
})

test('reports: payroll period uses the NL date of the check-in (23:50 NDT on the last day counts, 00:10 the next day does not)', async () => {
  const { token, keyOf, clientId, workerId } = await setup()
  const make = async (date, start, end) => {
    const r = await api('POST', '/api/office/visits', { token, body: { client_id: clientId('Doris'), worker_id: workerId('Jo'), date, start, end } })
    assert.equal(r.status, 201, r.text)
    return r.body
  }
  const lateNight = await make(TUE, '23:30', '23:59')
  const earlyMorning = await make(WED, '00:00', '00:45')
  assert.equal(nl(TUE, '23:50').slice(0, 10), WED, 'the 23:50 NDT check-in is already Wednesday in UTC')
  assert.equal((await checkIn(keyOf('Jo'), lateNight.id, nl(TUE, '23:50'))).status, 201)
  assert.equal((await checkOut(keyOf('Jo'), lateNight.id, nl(TUE, '23:58'))).status, 201)
  assert.equal((await checkIn(keyOf('Jo'), earlyMorning.id, nl(WED, '00:10'))).status, 201)
  assert.equal((await checkOut(keyOf('Jo'), earlyMorning.id, nl(WED, '00:40'))).status, 201)
  const now = nl(WED, '12:00')
  const monTue = await api('GET', `/api/office/reports/payroll?from=${MON}&to=${TUE}`, { token, now })
  assert.deepEqual([monTue.body.total.visits, monTue.body.total.seconds], [1, 480])
  const wed = await api('GET', `/api/office/reports/payroll?from=${WED}&to=${WED}`, { token, now })
  assert.deepEqual([wed.body.total.visits, wed.body.total.seconds], [1, 1800])
})

test('reports: billing by funder with scheduled minutes, and the period refusals', async () => {
  const { token, keyOf, clientId } = await setup()
  await work(token, keyOf('Sam'), MON, 'Bill', '09:00', 3620)
  await work(token, keyOf('Sam'), MON, 'Ruby', '10:30', 2720)
  await work(token, keyOf('Alex'), MON, 'Walter', '09:05', 3600)
  const r = await api('GET', `/api/office/reports/billing?from=${MON}&to=${MON}`, { token, now: nl(MON, '18:00') })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.body, {
    from: MON,
    to: MON,
    period_label: 'Mon Sep 14 to Mon Sep 14',
    funders: [
      { funder_id: 1, funder_name: 'SAMPLE Regional home support program', visits: 2, seconds: 6340, hours: '1.76', hm_label: '1 h 45 min', scheduled_hours: '2.50',
        clients: [
          { client_id: clientId('Bill'), client_name: 'Bill S. (SAMPLE)', visits: 1, scheduled_minutes: 60, scheduled_hours: '1.00', seconds: 3620, hours: '1.01', hm_label: '1 h 0 min' },
          { client_id: clientId('Ruby'), client_name: 'Ruby T. (SAMPLE)', visits: 1, scheduled_minutes: 90, scheduled_hours: '1.50', seconds: 2720, hours: '0.76', hm_label: '0 h 45 min' }
        ] },
      { funder_id: 3, funder_name: 'SAMPLE Veterans program', visits: 1, seconds: 3600, hours: '1.00', hm_label: '1 h 0 min', scheduled_hours: '1.00',
        clients: [{ client_id: clientId('Walter'), client_name: 'Walter G. (SAMPLE)', visits: 1, scheduled_minutes: 60, scheduled_hours: '1.00', seconds: 3600, hours: '1.00', hm_label: '1 h 0 min' }] }
    ],
    total: { visits: 3, seconds: 9940, hours: '2.76', hm_label: '2 h 45 min', scheduled_hours: '3.50' },
    note: 'Hours worked are check-out minus check-in.'
  })
  expectError(await api('GET', `/api/office/reports/billing?from=${TUE}&to=${MON}`, { token }), 400, 'bad_request', 'to', 'The end date has to be on or after the start date.')
  expectError(await api('GET', `/api/office/reports/billing?from=2026-07-01&to=2026-09-01`, { token }), 400, 'bad_request', 'to', 'Pick up to 62 days at a time.')
  assert.equal((await api('GET', `/api/office/reports/billing?from=2026-07-01&to=2026-08-31`, { token })).status, 200, '62 days is allowed')
  expectError(await api('GET', `/api/office/reports/billing?to=${MON}`, { token }), 400, 'bad_request', 'from')
  expectError(await api('GET', `/api/office/reports/billing?from=${MON}&to=${MON}`), 401, 'unauthorized')
})

test('reports: billing scheduled_hours come from summed minutes: three 20-minute visits are "0.33" each and "1.00" in total, not "0.99"', async () => {
  const { token, keyOf, clientId, workerId } = await setup()
  const clients = ['Margaret', 'Ron', 'Gladys'] // all SAMPLE Regional home support program
  for (const [i, name] of clients.entries()) {
    const start = `1${4 + i}:00`
    const v = await api('POST', '/api/office/visits', { token, body: { client_id: clientId(name), worker_id: workerId('Sam'), date: MON, start, end: `1${4 + i}:20` } })
    assert.equal(v.status, 201, v.text)
    assert.equal((await checkIn(keyOf('Sam'), v.body.id, nl(MON, start))).status, 201)
    assert.equal((await checkOut(keyOf('Sam'), v.body.id, plus(nl(MON, start), 20))).status, 201)
  }
  const now = nl(MON, '18:00')
  const r = await api('GET', `/api/office/reports/billing?from=${MON}&to=${MON}`, { token, now })
  assert.equal(r.status, 200, r.text)
  const [funder] = r.body.funders
  assert.deepEqual(funder.clients.map(c => [c.client_name, c.scheduled_minutes, c.scheduled_hours]),
    [['Gladys W. (SAMPLE)', 20, '0.33'], ['Margaret P. (SAMPLE)', 20, '0.33'], ['Ron K. (SAMPLE)', 20, '0.33']])
  assert.equal(funder.scheduled_hours, '1.00', 'the funder from 60 summed minutes, not 0.33 + 0.33 + 0.33')
  assert.equal(r.body.total.scheduled_hours, '1.00', 'the total from summed minutes')
  const csv = (await api('GET', `/api/office/reports/billing.csv?from=${MON}&to=${MON}`, { token, now })).text.split('\r\n')
  assert.deepEqual(csv.slice(1, 6), [
    'SAMPLE Regional home support program,Gladys W. (SAMPLE),1,0.33,0.33,0 h 20 min,1200',
    'SAMPLE Regional home support program,Margaret P. (SAMPLE),1,0.33,0.33,0 h 20 min,1200',
    'SAMPLE Regional home support program,Ron K. (SAMPLE),1,0.33,0.33,0 h 20 min,1200',
    'SAMPLE Regional home support program total,,3,1.00,1.00,1 h 0 min,3600',
    'Total,,3,1.00,1.00,1 h 0 min,3600'
  ])
})

test('reports: missed excludes cancelled visits, includes a visit with no worker, and late is exactly 15 minutes', async () => {
  const { token, keyOf, clientId } = await setup()
  const margaret = await visitOf(token, MON, 'Margaret')
  assert.equal((await checkIn(keyOf('Jo'), margaret.id, plusMs(nl(MON, '08:45'), -1000))).status, 201) // 14:59 late: not listed
  const walter = await visitOf(token, MON, 'Walter')
  assert.equal((await checkIn(keyOf('Alex'), walter.id, nl(MON, '09:15'))).status, 201)
  const ruby = await visitOf(token, MON, 'Ruby')
  assert.equal((await api('POST', `/api/office/visits/${ruby.id}/cancel`, { token, body: { reason: 'Away (SAMPLE)', version: ruby.version } })).status, 200)
  const loose = await api('POST', '/api/office/visits', { token, body: { client_id: clientId('Doris'), worker_id: null, date: MON, start: '10:00', end: '11:00' } })
  const r = await api('GET', `/api/office/reports/missed?from=${MON}&to=${MON}`, { token, now: nl(MON, '12:30') })
  assert.equal(r.status, 200, r.text)
  const bill = await visitOf(token, MON, 'Bill')
  const ron = await visitOf(token, MON, 'Ron')
  const gladys = await visitOf(token, MON, 'Gladys')
  const missed = (v, worker) => ({ visit_id: v.id, date: MON, date_label: 'Mon Sep 14', time_label: v.time_label, client_name: v.client_name, worker_name: worker, what: 'missed', what_label: 'Missed: no check-in', late_minutes: null, check_in_label: null })
  assert.deepEqual(r.body, {
    from: MON,
    to: MON,
    period_label: 'Mon Sep 14 to Mon Sep 14',
    rows: [
      missed(bill, 'Sam R. (SAMPLE)'),
      { visit_id: walter.id, date: MON, date_label: 'Mon Sep 14', time_label: '9:00 AM – 10:00 AM', client_name: 'Walter G. (SAMPLE)', worker_name: 'Alex B. (SAMPLE)', what: 'late', what_label: 'Late: checked in 15 min after the start', late_minutes: 15, check_in_label: '9:15 AM' },
      missed(ron, 'Jo W. (SAMPLE)'),
      missed(loose.body, null),
      missed(gladys, 'Jo W. (SAMPLE)') // 12:00 + 30 min is exactly now
    ]
  })
  // A week nobody opened still reports its missed visits.
  const nextWeek = await api('GET', '/api/office/reports/missed?from=2026-09-21&to=2026-09-21', { token, now: '2026-09-21T23:00:00.000Z' })
  assert.equal(nextWeek.body.rows.length, 6)
})

test('reports: mileage follows check-in order, not schedule order', async () => {
  const { token, keyOf, clientId, workerId } = await setup()
  const make = async (client, start, end) => (await api('POST', '/api/office/visits', { token, body: { client_id: clientId(client), worker_id: workerId('Sam'), date: MON, start, end } })).body
  const margaret = await make('Margaret', '13:00', '13:30')
  const walter = await make('Walter', '14:00', '14:30')
  const frank = await make('Frank', '15:00', '15:30')
  // Against the schedule: Botwood first, then the two Grand Falls-Windsor clients.
  assert.equal((await checkIn(keyOf('Sam'), walter.id, nl(MON, '12:40'))).status, 201)
  assert.equal((await checkIn(keyOf('Sam'), margaret.id, nl(MON, '13:05'))).status, 201)
  assert.equal((await checkIn(keyOf('Sam'), frank.id, nl(MON, '15:02'))).status, 201)
  assert.equal((await checkIn(keyOf('Alex'), (await visitOf(token, MON, 'Walter')).id, nl(MON, '09:01'))).status, 201) // one check-in: no row
  const r = await api('GET', `/api/office/reports/mileage?from=${MON}&to=${MON}`, { token, now: nl(MON, '16:00') })
  assert.equal(r.status, 200, r.text)
  const d = (a, b) => distanceM(pinOf(a).lat, pinOf(a).lng, pinOf(b).lat, pinOf(b).lng)
  const m1 = d('Walter', 'Margaret')
  const m2 = d('Margaret', 'Frank')
  assert.ok(m1 > 25000 && m2 < 5000)
  assert.deepEqual(r.body, {
    from: MON,
    to: MON,
    period_label: 'Mon Sep 14 to Mon Sep 14',
    rows: [{
      worker_id: workerId('Sam'), worker_name: 'Sam R. (SAMPLE)', date: MON, date_label: 'Mon Sep 14',
      legs: [
        { from_client: 'Walter G. (SAMPLE)', to_client: 'Margaret P. (SAMPLE)', metres: m1, km: kmText(m1) },
        { from_client: 'Margaret P. (SAMPLE)', to_client: 'Frank H. (SAMPLE)', metres: m2, km: kmText(m2) }
      ],
      metres: m1 + m2,
      km: kmText(m1 + m2)
    }],
    total: [{ worker_id: workerId('Sam'), worker_name: 'Sam R. (SAMPLE)', metres: m1 + m2, km: kmText(m1 + m2) }],
    note: "Straight-line distance between clients, in the order the worker checked in. Not road distance. The drive to the first client and home from the last isn't counted."
  })
})

test('reports: CSV headers, CRLF, quoting, the formula guard and the filename, for all four', async () => {
  const { token, keyOf, workerId } = await setup()
  const add = async (name, lat) => {
    const r = await api('POST', '/api/office/clients', { token, body: goodClient({ name, lat, lng: -55.67, zone_id: 1, funder_id: 2, patterns: [], family_contacts: [] }) })
    assert.equal(r.status, 201, r.text)
    return r.body
  }
  const kit = await add('Kit "K" O\'Brien, Jr. (SAMPLE)', 48.97)
  const sum = await add('=SUM(A1) (SAMPLE)', 48.98)
  const visit = async (client, start, end) => (await api('POST', '/api/office/visits', { token, body: { client_id: client.id, worker_id: workerId('Sam'), date: MON, start, end } })).body
  const v1 = await visit(kit, '13:00', '14:00')
  const v2 = await visit(sum, '14:30', '15:00')
  assert.equal((await checkIn(keyOf('Sam'), v1.id, nl(MON, '13:00'))).status, 201)
  assert.equal((await checkOut(keyOf('Sam'), v1.id, plusMs(nl(MON, '13:00'), 3620 * 1000))).status, 201)
  assert.equal((await checkIn(keyOf('Sam'), v2.id, nl(MON, '14:30'))).status, 201)
  assert.equal((await checkOut(keyOf('Sam'), v2.id, plusMs(nl(MON, '14:30'), 2720 * 1000))).status, 201)
  const now = nl(MON, '15:30')
  const csv = async kind => {
    const r = await api('GET', `/api/office/reports/${kind}.csv?from=${MON}&to=${MON}`, { token, now })
    assert.equal(r.status, 200, r.text)
    assert.equal(r.headers.get('content-type'), 'text/csv; charset=utf-8')
    assert.equal(r.headers.get('content-disposition'), `attachment; filename="home-care-${kind}-${MON}-to-${MON}.csv"`)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.ok(!r.text.startsWith('﻿'), 'no BOM')
    assert.ok(r.text.endsWith('\r\n'))
    assert.ok(!r.text.replace(/\r\n/g, '').includes('\n'), 'every line ends CRLF')
    return r.text
  }
  const KIT = '"Kit ""K"" O\'Brien, Jr. (SAMPLE)"'
  const SUM = "'=SUM(A1) (SAMPLE)"
  assert.equal(await csv('payroll'), [
    'Worker,Client,Visits,Hours (decimal),Hours and minutes,Seconds',
    `Sam R. (SAMPLE),${SUM},1,0.76,0 h 45 min,2720`,
    `Sam R. (SAMPLE),${KIT},1,1.01,1 h 0 min,3620`,
    'Sam R. (SAMPLE) total,,2,1.76,1 h 45 min,6340',
    'Total,,2,1.76,1 h 45 min,6340', ''
  ].join('\r\n'))
  assert.equal(await csv('billing'), [
    'Funder,Client,Visits,Scheduled hours,Hours worked (decimal),Hours and minutes,Seconds',
    `Private pay (SAMPLE),${SUM},1,0.50,0.76,0 h 45 min,2720`,
    `Private pay (SAMPLE),${KIT},1,1.00,1.01,1 h 0 min,3620`,
    'Private pay (SAMPLE) total,,2,1.50,1.76,1 h 45 min,6340',
    'Total,,2,1.50,1.76,1 h 45 min,6340', ''
  ].join('\r\n'))
  const missed = (await csv('missed')).split('\r\n')
  assert.equal(missed[0], 'Date,Scheduled,Client,Worker,What happened,Minutes late')
  assert.equal(missed[1], '2026-09-14,8:30 AM – 9:30 AM,Margaret P. (SAMPLE),Jo W. (SAMPLE),Missed: no check-in,')
  const km = kmText(distanceM(48.97, -55.67, 48.98, -55.67))
  assert.equal(await csv('mileage'), [
    'Worker,Date,From,To,Kilometres (straight line)',
    `Sam R. (SAMPLE),2026-09-14,${KIT},${SUM},${km}`,
    `Sam R. (SAMPLE) total,,,,${km}`, ''
  ].join('\r\n'))
  expectError(await api('GET', `/api/office/reports/payroll.csv?from=${MON}&to=${MON}`, { now }), 401, 'unauthorized')
})

test('demo seed: a lived-in fortnight with exactly one missed, a late Sam R. visit, one checked in, a Chris M. double-booking and payroll', async () => {
  for (const now of [nl(WED, '11:00'), nl(WED, '06:10')]) {
    const r = await api('POST', '/api/test/seed', { now, body: { scenario: 'demo' } })
    assert.equal(r.status, 200, r.text)
    assert.equal(r.body.office_url, `${BASE}/office/`)
    assert.equal(r.body.pin, '4826')
    assert.equal(r.body.workers.length, 5)
    assert.equal(r.body.clients.length, 12)
    const token = (await api('POST', '/api/office/signin', { now, body: { pin: '4826' } })).body.token
    const day = await dayVisits(token, WED, now)
    assert.equal(day.filter(v => v.alert === 'missed').length, 1, `${now}: ${JSON.stringify(day.map(v => [v.client_name, v.start, v.alert, v.status]))}`)
    assert.ok(day.some(v => v.alert === 'late' && v.worker_name === 'Sam R. (SAMPLE)' && v.pattern_id === null), 'Sam R. is late')
    assert.equal(day.filter(v => v.status === 'checked_in').length, 1)
    for (const v of day) {
      if (Date.parse(v.starts_at) + 30 * 60000 <= Date.parse(now) && v.alert !== 'missed') assert.equal(v.status, 'checked_out', `${v.client_name} ${v.start}`)
    }
    const thisWeek = await week(token, MON, now)
    assert.ok(thisWeek.conflicts.some(c => c.kind === 'double_booked' && c.worker_id === r.body.workers.find(w => w.name.startsWith('Chris')).id))
    const lastWeek = await week(token, '2026-09-07', now)
    assert.equal(lastWeek.visits.length, 36)
    assert.ok(lastWeek.visits.every(v => v.status === 'checked_out'), 'last week is all done')
    assert.equal(lastWeek.visits.find(v => v.client_name.startsWith('Edna') && v.date === '2026-09-11').worker_name, 'Chris M. (SAMPLE)')
    const past = [...lastWeek.visits, ...thisWeek.visits].filter(v => v.check_out)
    for (const v of past) {
      const inAfter = (Date.parse(v.check_in.at) - Date.parse(v.starts_at)) / 60000
      assert.ok(inAfter >= 0 && inAfter <= 9, `check-in ${inAfter} min after the start`)
    }
    const locations = past.map(v => v.check_in.location)
    assert.equal(locations.filter(l => l === 'far').length, 1)
    assert.equal(locations.filter(l => l === 'not_shared').length, 1)
    const notes = past.filter(v => v.note)
    assert.ok(notes.length > past.length / 3 && notes.length < past.length * 2 / 3, `${notes.length} notes on ${past.length} visits`)
    assert.ok(notes.some(v => v.note.shareable) && notes.some(v => !v.note.shareable))
    const payroll = await api('GET', `/api/office/reports/payroll?from=${addDays(WED, -13)}&to=${WED}`, { token, now })
    assert.ok(payroll.body.rows.length >= 4 && payroll.body.total.seconds > 0)

    const again = await api('POST', '/api/test/seed', { now, body: { scenario: 'demo' } })
    assert.equal(again.status, 200)
    const token2 = (await api('POST', '/api/office/signin', { now, body: { pin: '4826' } })).body.token
    assert.deepEqual(await dayVisits(token2, WED, now), day, 'the same now gives the same demo')
  }
  expectError(await api('POST', '/api/test/seed', { body: { scenario: 'party' } }), 400, 'bad_request', 'scenario')
})

// ================================================================ M3 (API.md clarifications 7 and 8)

test('check-out: a note or a task list that breaks a rule never costs the check-out', async () => {
  const { token, keyOf, familyKey } = await setup()
  const key = keyOf('Sam')
  const TWO_LINES = 'Keep the note to two short lines.'
  const TASKS = "The task list didn't come through. Reload and try again."
  const cases = [
    [MON, 'Bill', { note: 'one\ntwo\nthree' }, { note_refused: TWO_LINES }],
    [MON, 'Ruby', { note: 'x'.repeat(201) }, { note_refused: TWO_LINES }],
    [TUE, 'Frank', { note: 'Daughter called from 709 555 0152 709 555 0153' }, { note_refused: HEALTH }],
    [WED, 'Bill', { note: 123 }, { note_refused: TWO_LINES }],
    [WED, 'Ruby', { tasks: undefined, note: 'Kept this note.' }, { tasks_refused: TASKS }],
    [THU, 'Frank', { tasks: [{ task_id: 1, kind: 'medication_reminder', label: 'Gave her pills', done: true }], note: 'MCP 1234 5678 9012' },
      { tasks_refused: MEDICATION, note_refused: HEALTH }],
    [FRI, 'Bill', { note: 'A clean note. (SAMPLE)' }, {}]
  ]
  for (const [date, client, body, refused] of cases) {
    const v = await visitOf(token, date, client)
    const at = v.starts_at
    assert.equal((await checkIn(key, v.id, at)).status, 201)
    const id = randomUUID()
    const outAt = plusMs(at, 3600 * 1000)
    const r = await api('POST', '/api/worker/events', { key, now: outAt, body: { id, visit_id: v.id, kind: 'check_out', at: outAt, tasks: [], note: '', ...body } })
    assert.equal(r.status, 201, `${client} ${date}: ${r.text}`)
    assert.equal(r.body.note_refused, refused.note_refused, r.text)
    assert.equal(r.body.tasks_refused, refused.tasks_refused, r.text)
    const office = await visitOf(token, date, client, plus(outAt, 1))
    assert.equal(office.status, 'checked_out')
    assert.equal(office.worked_seconds, 3600)
    assert.equal(office.note?.text ?? null, refused.note_refused ? null : body.note)
    assert.deepEqual(office.tasks_done, [])
    const again = await api('POST', '/api/worker/events', { key, now: plus(outAt, 5), body: { id, visit_id: v.id, kind: 'check_out', at: outAt, tasks: [], ...body } })
    assert.equal(again.status, 200, again.text)
    assert.equal(again.body.duplicate, true)
    // Clarification 16: the resend's answer repeats what was refused (and a clean check-out's has neither field).
    assert.equal(again.body.note_refused, refused.note_refused, `resend of ${client} ${date}: ${again.text}`)
    assert.equal(again.body.tasks_refused, refused.tasks_refused, `resend of ${client} ${date}: ${again.text}`)
    if (!refused.note_refused && !refused.tasks_refused) assert.ok(!('note_refused' in again.body) && !('tasks_refused' in again.body))
  }
  // Never in the office or family views.
  const later = nl(FRI, '18:00')
  const views = [
    (await api('GET', `/api/office/week?start=${MON}`, { token, now: later })).text,
    ...(await Promise.all([MON, TUE, WED, THU, FRI].map(d => api('GET', `/api/office/day?date=${d}`, { token, now: later })))).map(r => r.text),
    ...(await Promise.all(['Bill', 'Ruby', 'Frank'].map(c => api('GET', `/api/family/${familyKey(c)}`, { now: later })))).map(r => r.text)
  ]
  for (const text of views) {
    for (const s of ['note_refused', 'tasks_refused', TWO_LINES, TASKS, MEDICATION]) assert.ok(!text.includes(s), `a view contains ${s}`)
  }
})

test('soft-remove: a check-in tapped before the pattern changed lands, shows cancelled and visited, and counts for payroll', async () => {
  const tapped = nl(WED, '08:55')
  const { token, keyOf, clientId, workerId } = await setup(tapped)
  const before = (await week(token, MON, tapped)).visits.filter(v => v.client_name.startsWith('Walter'))
  const wed9 = before.find(v => v.date === WED)
  const thu9 = before.find(v => v.date === THU)
  const client = (await api('GET', `/api/office/clients/${clientId('Walter')}`, { token, now: tapped })).body
  const input = clientInput(client)
  input.patterns[0] = { ...input.patterns[0], start: '10:00', end: '11:00' }
  const put = await api('PUT', `/api/office/clients/${client.id}`, { token, now: nl(WED, '08:57'), body: input })
  assert.equal(put.status, 200, put.text)
  assert.equal(put.body.rebuilt_visits, 3)

  // The phone had no signal at 8:55; its check-in arrives at 9:30, after the change.
  const late = await checkIn(keyOf('Alex'), wed9.id, tapped, { now: nl(WED, '09:30') })
  assert.equal(late.status, 201, late.text)
  assert.equal(late.body.event.at, tapped)
  const board = (await dayVisits(token, WED, nl(WED, '09:31'))).filter(v => v.client_name.startsWith('Walter'))
  assert.deepEqual(board.map(v => [v.id === wed9.id, v.start, v.status, v.cancelled, v.cancel_reason, v.visited_after_cancel]), [
    [true, '09:00', 'checked_in', true, 'Removed when the visit pattern changed.', true],
    [false, '10:00', 'scheduled', false, null, false]
  ])
  assert.equal(board[0].check_in.at, tapped)
  const phone = await api('GET', `/api/worker/visits?date=${WED}`, { key: keyOf('Alex'), now: nl(WED, '09:31') })
  assert.deepEqual(phone.body.visits.filter(v => v.client_name.startsWith('Walter')).map(v => [v.start, v.cancelled]), [['09:00', true], ['10:00', false]])

  assert.equal((await checkOut(keyOf('Alex'), wed9.id, nl(WED, '09:55'))).status, 201)
  const now = nl(WED, '18:00')
  const payroll = await api('GET', `/api/office/reports/payroll?from=${WED}&to=${WED}`, { token, now })
  assert.deepEqual(payroll.body.rows.map(r => [r.worker_id, r.seconds, r.clients.map(c => c.client_name)]), [[workerId('Alex'), 3600, ['Walter G. (SAMPLE)']]])
  const billing = await api('GET', `/api/office/reports/billing?from=${WED}&to=${WED}`, { token, now })
  assert.equal(billing.body.total.seconds, 3600)
  const missed = await api('GET', `/api/office/reports/missed?from=${WED}&to=${WED}`, { token, now })
  assert.ok(!missed.body.rows.some(r => r.visit_id === wed9.id), 'a cancelled visit is never missed')

  // Office edits to a removed visit with no event are 404.
  expectError(await api('PUT', `/api/office/visits/${thu9.id}`, { token, now, body: moveBody(thu9) }), 404, 'not_found')
  expectError(await api('POST', `/api/office/visits/${thu9.id}/cancel`, { token, now, body: { reason: 'x', version: thu9.version } }), 404, 'not_found')
  expectError(await api('PUT', `/api/office/visits/${thu9.id}/times`, { token, now, body: { check_in_at: nl(THU, '09:00'), reason: 'x', version: thu9.version } }), 404, 'not_found')
})

test('soft-remove: a removed visit with no events appears nowhere — week, day, phone, family, conflicts, missed', async () => {
  const change = nl(WED, '08:57')
  const { token, keyOf, clientId, familyKey } = await setup(change)
  const before = (await week(token, MON, change)).visits.filter(v => v.client_name.startsWith('Walter'))
  const removedIds = before.filter(v => v.date >= WED).map(v => v.id)
  const client = (await api('GET', `/api/office/clients/${clientId('Walter')}`, { token, now: change })).body
  const input = clientInput(client)
  input.patterns[0] = { ...input.patterns[0], start: '10:00', end: '11:00' }
  assert.equal((await api('PUT', `/api/office/clients/${client.id}`, { token, now: change, body: input })).body.rebuilt_visits, 3)

  const now = nl(FRI, '23:00')
  const raw = [
    (await api('GET', `/api/office/week?start=${MON}`, { token, now })).text,
    ...(await Promise.all([WED, THU, FRI].map(d => api('GET', `/api/office/day?date=${d}`, { token, now })))).map(r => r.text),
    (await api('GET', `/api/worker/visits?date=${FRI}`, { key: keyOf('Alex'), now })).text,
    (await api('GET', `/api/family/${familyKey('Walter')}`, { now })).text,
    (await api('GET', `/api/office/reports/missed?from=${MON}&to=${FRI}`, { token, now })).text
  ]
  for (const text of raw) for (const id of removedIds) assert.ok(!new RegExp(`"(id|visit_id)":${id}[,}]`).test(text) && !text.includes(`,${id}]`) && !text.includes(`[${id},`) && !text.includes(`[${id}]`), `removed visit ${id} in ${text.slice(0, 80)}`)
  const w = await week(token, MON, now)
  assert.deepEqual(w.visits.filter(v => v.client_name.startsWith('Walter')).map(v => [v.date, v.start]),
    [[MON, '09:00'], [TUE, '09:00'], [WED, '10:00'], [THU, '10:00'], [FRI, '10:00']])
  const missed = (await api('GET', `/api/office/reports/missed?from=${WED}&to=${FRI}`, { token, now })).body.rows
  assert.deepEqual(missed.filter(r => r.client_name.startsWith('Walter')).map(r => [r.date, r.time_label]),
    [[WED, '10:00 AM – 11:00 AM'], [THU, '10:00 AM – 11:00 AM'], [FRI, '10:00 AM – 11:00 AM']])
  const family = (await api('GET', `/api/family/${familyKey('Walter')}`, { now })).body
  assert.deepEqual(family.week.days.map(d => d.visits.map(v => v.time_label)),
    [['9:00 AM – 10:00 AM'], ['9:00 AM – 10:00 AM'], ['10:00 AM – 11:00 AM'], ['10:00 AM – 11:00 AM'], ['10:00 AM – 11:00 AM'], [], []])
})

test('soft-remove: a deactivated client\'s removed visits appear nowhere, and a late check-in still lands with the inactive reason', async () => {
  const change = nl(WED, '08:57')
  const { token, keyOf, clientId } = await setup(change)
  const before = (await week(token, MON, change)).visits.filter(v => v.client_name.startsWith('Walter'))
  const client = (await api('GET', `/api/office/clients/${clientId('Walter')}`, { token, now: change })).body
  const put = await api('PUT', `/api/office/clients/${client.id}`, { token, now: change, body: { ...clientInput(client), active: false } })
  assert.equal(put.body.rebuilt_visits, 3)
  const now = nl(FRI, '23:00')
  assert.deepEqual((await week(token, MON, now)).visits.filter(v => v.client_name.startsWith('Walter')).map(v => v.date), [MON, TUE])
  assert.ok(!(await dayVisits(token, THU, now)).some(v => v.client_name.startsWith('Walter')))
  const missed = (await api('GET', `/api/office/reports/missed?from=${WED}&to=${FRI}`, { token, now })).body.rows
  assert.ok(!missed.some(r => r.client_name.startsWith('Walter')), JSON.stringify(missed))

  const wed9 = before.find(v => v.date === WED)
  const r = await checkIn(keyOf('Alex'), wed9.id, nl(WED, '08:55'), { now: nl(WED, '09:40') })
  assert.equal(r.status, 201, r.text)
  const shown = (await dayVisits(token, WED, now)).find(v => v.id === wed9.id)
  assert.deepEqual([shown.cancelled, shown.cancel_reason, shown.visited_after_cancel, shown.status],
    [true, 'Removed when the client was made inactive.', true, 'checked_in'])
})

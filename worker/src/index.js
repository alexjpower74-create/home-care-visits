// Home Care Visits Worker: the API in docs/API.md. Static files in ../app/public are served by [assets]; only /api/* reaches here.

import { now as clockNow, clientIp, isTestMode } from './clock.js'
import { randomKey, sha256Hex, verifyPin, isUuidV4 } from './auth.js'
import {
  addDays, dayLabel, fullLabel, hoursText, isDate, isHm, isoSecond, isoWeekday, localToUtc, minutesOf, mondayOf, nlDate, rangeLabel, timeLabel
} from './time.js'
import { distanceM, kmText, locationLabel, locationStatus } from './geo.js'
import { alertFor, keptTime, lateMinutes } from './rules.js'
import { HEALTH_CARD_MESSAGE, MEDICATION_MESSAGE, looksLikeHealthCard, recordsMedicationGiven } from './privacy.js'
import { DISTANCE_NOTE, KINDS, availabilityLabel, findConflicts } from './conflicts.js'
import { patternVisits } from './generate.js'
import { familyUrl, seedSample, workerUrl } from './sample.js'
import { TASK_LABELS, daysLabel, firstName, initials, normalizePhone } from './labels.js'

const SESSION_DAYS = 14
const DAY_MS = 86400000

const WORKER_KEY_MESSAGE = "This link doesn't work any more. Ask the office for a new one."
const FAMILY_KEY_MESSAGE = "This link doesn't work. Ask the agency for a new one."
const GAP_MESSAGE = "That time doesn't exist on the day the clocks change."
const PHONE_MESSAGE = 'Type a 10-digit phone number, like 709-555-0152.'
const NOT_ON_LIST = "That visit isn't on your list."

// ---- responses ----

class HttpError extends Error {
  constructor (status, code, error, extra = {}) {
    super(error)
    this.status = status
    this.body = { error, code, ...extra }
  }
}

const BASE_HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }

function json (status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...BASE_HEADERS } })
}

const badRequest = (field, error) => new HttpError(400, 'bad_request', error, field ? { field } : {})
const unauthorized = (error, field) => new HttpError(401, 'unauthorized', error, field ? { field } : {})
const notFound = error => new HttpError(404, 'not_found', error)
const badState = (error, extra) => new HttpError(409, 'bad_state', error, extra)
const stale = () => new HttpError(409, 'stale', 'This visit was changed on another screen. Reload and try again.')

async function readJson (request) {
  const text = await request.text()
  if (!text.trim()) return {}
  try {
    const body = JSON.parse(text)
    if (body && typeof body === 'object' && !Array.isArray(body)) return body
  } catch {}
  throw badRequest(null, 'That request could not be read.')
}

const errorText = e => String(e?.message || e) + String(e?.cause?.message || '')
const isUniqueViolation = e => /UNIQUE constraint failed/i.test(errorText(e))
const chars = s => [...s].length
const isNum = v => typeof v === 'number' && Number.isFinite(v)
const placeholders = (n, from = 1) => Array.from({ length: n }, (_, i) => `?${i + from}`).join(', ')

function guardText (value, field) {
  if (looksLikeHealthCard(value)) throw badRequest(field, HEALTH_CARD_MESSAGE)
}

// ---- context ----

function context (request, env) {
  const url = new URL(request.url)
  const nowMs = clockNow(request, env)
  return { request, env, db: env.DB, url, origin: url.origin, nowMs, nowIso: isoSecond(nowMs), ip: clientIp(request, env) }
}

const prep = (db, sql, binds = []) => (binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql))

// ---- agency ----

async function loadAgency (db) {
  const row = await db.prepare('SELECT * FROM agency WHERE id = 1').first()
  if (!row) throw new HttpError(500, 'server_error', 'The agency is not set up yet.')
  return row
}

const agencyView = row => ({
  name: row.name,
  sample: row.name.includes('SAMPLE'),
  timezone: row.timezone,
  office_phone: row.office_phone,
  late_after_minutes: 15,
  missed_after_minutes: 30,
  near_metres: 250
})

async function getAgency (ctx) {
  return json(200, agencyView(await loadAgency(ctx.db)))
}

async function loadRefs (db) {
  const [zones, funders, workers] = await db.batch([
    db.prepare('SELECT id, name FROM zones ORDER BY id'),
    db.prepare('SELECT id, name FROM funders ORDER BY id'),
    db.prepare('SELECT id FROM workers WHERE active = 1')
  ])
  return { zones: zones.results, funders: funders.results, activeWorkerIds: new Set(workers.results.map(w => w.id)) }
}

// ---- office sign-in ----

async function requireOffice (ctx) {
  const m = /^Bearer\s+(\S+)$/.exec(ctx.request.headers.get('Authorization') || '')
  if (!m) throw unauthorized('Sign in to continue.')
  const hash = await sha256Hex(m[1])
  const row = await ctx.db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?1 AND expires_at > ?2').bind(hash, ctx.nowIso).first()
  if (!row) throw unauthorized('Your session has ended. Sign in again.')
  return hash
}

const office = handler => async (ctx, ...args) => {
  ctx.tokenHash = await requireOffice(ctx)
  return handler(ctx, ...args)
}

async function signin (ctx) {
  const body = await readJson(ctx.request)
  const agency = await loadAgency(ctx.db)
  const pin = typeof body.pin === 'string' ? body.pin : typeof body.pin === 'number' ? String(body.pin) : ''
  const ok = await verifyPin(pin, { hash: agency.pin_hash, salt: agency.pin_salt, iterations: agency.pin_iterations })
  if (!ok) {
    await ctx.db.prepare('INSERT INTO signin_attempts (ip, at) VALUES (?1, ?2)').bind(ctx.ip, ctx.nowIso).run()
    throw unauthorized('That PIN is not right.', 'pin')
  }
  const token = randomKey(32)
  const expiresAt = isoSecond(ctx.nowMs + SESSION_DAYS * DAY_MS)
  await ctx.db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?1, ?2, ?3)')
    .bind(await sha256Hex(token), ctx.nowIso, expiresAt).run()
  return json(200, { token, expires_at: expiresAt })
}

async function signout (ctx) {
  await ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(ctx.tokenHash).run()
  return json(200, { ok: true })
}

// ---- clients ----

const taskView = t => ({ id: t.id, kind: t.kind, label: TASK_LABELS[t.kind], detail: t.detail })

function patternView (p) {
  const days = JSON.parse(p.days)
  return {
    id: p.id, days, start: p.start_hm, end: p.end_hm, worker_id: p.worker_id,
    days_label: daysLabel(days), time_label: rangeLabel(p.start_hm, p.end_hm)
  }
}

function groupBy (rows, key) {
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], [])
    m.get(r[key]).push(r)
  }
  return m
}

async function loadClients (ctx, { id = null, all = false } = {}) {
  const db = ctx.db
  const where = id !== null ? 'c.id = ?1' : all ? '1 = 1' : 'c.active = 1'
  const binds = id !== null ? [id] : []
  const owned = `client_id IN (SELECT c.id FROM clients c WHERE ${where})`
  const [clients, tasks, patterns, contacts] = await db.batch([
    prep(db, `SELECT c.*, z.name AS zone_name, f.name AS funder_name FROM clients c JOIN zones z ON z.id = c.zone_id
      JOIN funders f ON f.id = c.funder_id WHERE ${where} ORDER BY c.name COLLATE NOCASE, c.id`, binds),
    prep(db, `SELECT * FROM client_tasks WHERE ${owned} ORDER BY position, id`, binds),
    prep(db, `SELECT * FROM patterns WHERE ended_at IS NULL AND ${owned} ORDER BY id`, binds),
    prep(db, `SELECT * FROM family_contacts WHERE ${owned} ORDER BY position, id`, binds)
  ])
  const t = groupBy(tasks.results, 'client_id')
  const p = groupBy(patterns.results, 'client_id')
  const f = groupBy(contacts.results, 'client_id')
  return clients.results.map(c => ({
    id: c.id,
    name: c.name,
    initials: initials(c.name),
    address: c.address,
    lat: c.lat,
    lng: c.lng,
    zone_id: c.zone_id,
    zone_name: c.zone_name,
    entry_notes: c.entry_notes,
    funder_id: c.funder_id,
    funder_name: c.funder_name,
    active: !!c.active,
    tasks: (t.get(c.id) || []).map(taskView),
    patterns: (p.get(c.id) || []).map(patternView),
    family_contacts: (f.get(c.id) || []).map(x => ({ name: x.name, relationship: x.relationship, phone: x.phone })),
    family_url: familyUrl(ctx.origin, c.family_key)
  }))
}

async function clientById (ctx, id) {
  const [client] = await loadClients(ctx, { id })
  if (!client) throw notFound("That client isn't on the list.")
  return client
}

function trimmed (value) {
  return typeof value === 'string' ? value.trim() : ''
}

function validateClient (raw, { isPost, zones, funders, activeWorkerIds }) {
  const input = isPost ? { entry_notes: '', active: true, patterns: [], family_contacts: [], ...raw } : raw

  const name = trimmed(input.name)
  if (!chars(name)) throw badRequest('name', 'Give the client a name.')
  if (chars(name) > 60) throw badRequest('name', 'Keep the name under 60 characters.')
  guardText(name, 'name')

  const address = trimmed(input.address)
  if (!chars(address) || chars(address) > 120) throw badRequest('address', 'Type where the client lives (the town is enough).')
  guardText(address, 'address')

  const { lat, lng } = input
  if (!isNum(lat) || !isNum(lng) || lat < 46.5 || lat > 60.5 || lng < -67.9 || lng > -52.5) {
    throw badRequest('lat', 'Put a pin on the map for this client.')
  }

  if (!Number.isInteger(input.zone_id) || !zones.some(z => z.id === input.zone_id)) throw badRequest('zone_id', 'Pick a zone.')

  if (typeof input.entry_notes !== 'string' || chars(input.entry_notes.trim()) > 300) {
    throw badRequest('entry_notes', 'Keep the entry notes under 300 characters.')
  }
  const entryNotes = input.entry_notes.trim()
  guardText(entryNotes, 'entry_notes')

  if (!Number.isInteger(input.funder_id) || !funders.some(f => f.id === input.funder_id)) {
    throw badRequest('funder_id', "Pick who pays for this client's visits.")
  }

  if (!Array.isArray(input.tasks) || input.tasks.length === 0) throw badRequest('tasks', 'Add at least one care task.')
  if (input.tasks.length > 12) throw badRequest('tasks', 'Keep to 12 care tasks or fewer.')
  const tasks = input.tasks.map(t => {
    if (!t || typeof t !== 'object' || !Object.hasOwn(TASK_LABELS, t.kind)) throw badRequest('tasks', 'Pick a task type.')
    if (t.detail !== undefined && t.detail !== null && typeof t.detail !== 'string') throw badRequest('tasks', 'Keep each task under 80 characters.')
    const detail = trimmed(t.detail)
    if (chars(detail) > 80) throw badRequest('tasks', 'Keep each task under 80 characters.')
    for (const text of [detail, typeof t.label === 'string' ? t.label : '']) {
      guardText(text, 'tasks')
      if (recordsMedicationGiven(text)) throw badRequest('tasks', MEDICATION_MESSAGE)
    }
    return { id: Number.isInteger(t.id) ? t.id : null, kind: t.kind, detail }
  })

  if (!Array.isArray(input.patterns)) throw badRequest('patterns', 'Pick at least one day.')
  if (input.patterns.length > 7) throw badRequest('patterns', 'Keep to 7 visit patterns or fewer.')
  const patterns = input.patterns.map(p => {
    const days = p?.days
    if (!Array.isArray(days) || days.length < 1 || days.length > 7 || !days.every(d => Number.isInteger(d) && d >= 1 && d <= 7) ||
      new Set(days).size !== days.length) {
      throw badRequest('patterns', 'Pick at least one day.')
    }
    if (!isHm(p.start) || !isHm(p.end) || p.end <= p.start) throw badRequest('patterns', 'The visit has to end after it starts.')
    const minutes = minutesOf(p.end) - minutesOf(p.start)
    if (minutes < 15 || minutes > 720) throw badRequest('patterns', 'A visit is between 15 minutes and 12 hours.')
    const workerId = p.worker_id ?? null
    if (workerId !== null && !activeWorkerIds.has(workerId)) throw badRequest('patterns', 'Pick one of your workers.')
    return { id: Number.isInteger(p.id) ? p.id : null, days: [...days].sort((a, b) => a - b), start: p.start, end: p.end, worker_id: workerId }
  })

  if (!Array.isArray(input.family_contacts)) throw badRequest('family_contacts', 'Add a name for each family contact.')
  if (input.family_contacts.length > 4) throw badRequest('family_contacts', 'Keep to 4 family contacts or fewer.')
  const contacts = input.family_contacts.map(f => {
    const n = trimmed(f?.name)
    if (!chars(n) || chars(n) > 60) throw badRequest('family_contacts', 'Add a name for each family contact.')
    if (f.relationship !== undefined && f.relationship !== null && typeof f.relationship !== 'string') {
      throw badRequest('family_contacts', 'Keep the relationship under 30 characters.')
    }
    const relationship = trimmed(f.relationship)
    if (chars(relationship) > 30) throw badRequest('family_contacts', 'Keep the relationship under 30 characters.')
    guardText(n, 'family_contacts')
    guardText(relationship, 'family_contacts')
    const phone = normalizePhone(f.phone)
    if (!phone) throw badRequest('family_contacts', PHONE_MESSAGE)
    return { name: n, relationship, phone }
  })

  if (typeof input.active !== 'boolean') throw badRequest('active', 'Say whether this client is active.')

  return { name, address, lat, lng, zone_id: input.zone_id, entry_notes: entryNotes, funder_id: input.funder_id, active: input.active, tasks, patterns, contacts }
}

const insertPattern = (db, clientSql, clientBind, p, nowIso) => db.prepare(
  `INSERT INTO patterns (client_id, days, start_hm, end_hm, worker_id, valid_from_at, ended_at) VALUES ((${clientSql}), ?2, ?3, ?4, ?5, ?6, NULL)`
).bind(clientBind, JSON.stringify(p.days), p.start, p.end, p.worker_id, nowIso)

async function listClients (ctx) {
  return json(200, { clients: await loadClients(ctx, { all: ctx.url.searchParams.get('all') === '1' }) })
}

async function getClient (ctx, id) {
  return json(200, await clientById(ctx, Number(id)))
}

async function createClient (ctx) {
  const body = await readJson(ctx.request)
  const refs = await loadRefs(ctx.db)
  const c = validateClient(body, { isPost: true, ...refs })
  const db = ctx.db
  const key = randomKey()
  const byKey = 'SELECT id FROM clients WHERE family_key = ?1'
  const stmts = [
    db.prepare(`INSERT INTO clients (name, address, lat, lng, zone_id, entry_notes, funder_id, active, family_key)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
      .bind(c.name, c.address, c.lat, c.lng, c.zone_id, c.entry_notes, c.funder_id, c.active ? 1 : 0, key),
    ...c.tasks.map((t, pos) => db.prepare(`INSERT INTO client_tasks (client_id, position, kind, detail) VALUES ((${byKey}), ?2, ?3, ?4)`)
      .bind(key, pos, t.kind, t.detail)),
    ...(c.active ? c.patterns : []).map(p => insertPattern(db, byKey, key, p, ctx.nowIso)),
    ...c.contacts.map((f, pos) => db.prepare(
      `INSERT INTO family_contacts (client_id, position, name, relationship, phone) VALUES ((${byKey}), ?2, ?3, ?4, ?5)`
    ).bind(key, pos, f.name, f.relationship, f.phone))
  ]
  await db.batch(stmts)
  const row = await db.prepare(byKey).bind(key).first()
  return json(201, await clientById(ctx, row.id))
}

const samePattern = (stored, p) =>
  p.id === stored.id && JSON.stringify(p.days) === stored.days && p.start === stored.start_hm && p.end === stored.end_hm &&
  p.worker_id === stored.worker_id

async function updateClient (ctx, idText) {
  const id = Number(idText)
  const db = ctx.db
  const existing = await db.prepare('SELECT id FROM clients WHERE id = ?1').bind(id).first()
  if (!existing) throw notFound("That client isn't on the list.")
  const body = await readJson(ctx.request)
  const refs = await loadRefs(db)
  const c = validateClient(body, { isPost: false, ...refs })

  const [storedPatterns, storedTasks] = await db.batch([
    db.prepare('SELECT * FROM patterns WHERE client_id = ?1 AND ended_at IS NULL').bind(id),
    db.prepare('SELECT id FROM client_tasks WHERE client_id = ?1').bind(id)
  ])
  const kept = c.active ? storedPatterns.results.filter(s => c.patterns.some(p => samePattern(s, p))) : []
  const keptIds = new Set(kept.map(s => s.id))
  const ending = storedPatterns.results.filter(s => !keptIds.has(s.id)).map(s => s.id)
  const added = c.active ? c.patterns.filter(p => !kept.some(s => samePattern(s, p))) : []

  const ownTaskIds = new Set(storedTasks.results.map(t => t.id))
  const keepTaskIds = c.tasks.filter(t => t.id !== null && ownTaskIds.has(t.id)).map(t => t.id)

  const stmts = [
    db.prepare(`UPDATE clients SET name = ?1, address = ?2, lat = ?3, lng = ?4, zone_id = ?5, entry_notes = ?6, funder_id = ?7, active = ?8
      WHERE id = ?9`).bind(c.name, c.address, c.lat, c.lng, c.zone_id, c.entry_notes, c.funder_id, c.active ? 1 : 0, id),
    db.prepare(`DELETE FROM client_tasks WHERE client_id = ?1 AND id NOT IN (${keepTaskIds.length ? placeholders(keepTaskIds.length, 2) : 'NULL'})`)
      .bind(id, ...keepTaskIds),
    ...c.tasks.map((t, pos) => (t.id !== null && ownTaskIds.has(t.id))
      ? db.prepare('UPDATE client_tasks SET position = ?1, kind = ?2, detail = ?3 WHERE id = ?4').bind(pos, t.kind, t.detail, t.id)
      : db.prepare('INSERT INTO client_tasks (client_id, position, kind, detail) VALUES (?1, ?2, ?3, ?4)').bind(id, pos, t.kind, t.detail)),
    db.prepare('DELETE FROM family_contacts WHERE client_id = ?1').bind(id),
    ...c.contacts.map((f, pos) => db.prepare(
      'INSERT INTO family_contacts (client_id, position, name, relationship, phone) VALUES (?1, ?2, ?3, ?4, ?5)'
    ).bind(id, pos, f.name, f.relationship, f.phone))
  ]
  let deleteIndex = -1
  if (ending.length) {
    const inList = placeholders(ending.length, 2)
    // Future visits of an ended pattern with no events at all go; a past or started visit is never touched.
    const doomed = `SELECT v.id FROM visits v WHERE v.pattern_id IN (${inList}) AND v.starts_at > ?1
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.visit_id = v.id)`
    stmts.push(
      db.prepare(`UPDATE patterns SET ended_at = ?1 WHERE id IN (${inList})`).bind(ctx.nowIso, ...ending),
      db.prepare(`DELETE FROM visit_workers WHERE visit_id IN (${doomed})`).bind(ctx.nowIso, ...ending)
    )
    deleteIndex = stmts.length
    stmts.push(db.prepare(`DELETE FROM visits WHERE id IN (${doomed}) RETURNING id`).bind(ctx.nowIso, ...ending))
  }
  for (const p of added) {
    stmts.push(db.prepare('INSERT INTO patterns (client_id, days, start_hm, end_hm, worker_id, valid_from_at, ended_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)')
      .bind(id, JSON.stringify(p.days), p.start, p.end, p.worker_id, ctx.nowIso))
  }
  const results = await db.batch(stmts)
  const rebuilt = deleteIndex >= 0 ? results[deleteIndex].results.length : 0
  return json(200, { ...(await clientById(ctx, id)), rebuilt_visits: rebuilt })
}

// ---- workers ----

async function loadWorkers (ctx, { id = null, all = false } = {}) {
  const db = ctx.db
  const where = id !== null ? 'w.id = ?1' : all ? '1 = 1' : 'w.active = 1'
  const binds = id !== null ? [id] : []
  const [workers, zones] = await db.batch([
    prep(db, `SELECT w.* FROM workers w WHERE ${where} ORDER BY w.name COLLATE NOCASE, w.id`, binds),
    prep(db, `SELECT wz.worker_id, z.id, z.name FROM worker_zones wz JOIN zones z ON z.id = wz.zone_id
      WHERE wz.worker_id IN (SELECT w.id FROM workers w WHERE ${where}) ORDER BY z.id`, binds)
  ])
  const z = groupBy(zones.results, 'worker_id')
  return workers.results.map(w => workerView(w, z.get(w.id) || [], ctx.origin))
}

function normalizeAvailability (a) {
  const out = {}
  for (let d = 1; d <= 7; d++) {
    const w = a?.[String(d)]
    out[String(d)] = w ? { start: w.start, end: w.end } : null
  }
  return out
}

function workerView (w, zones, origin) {
  const availability = normalizeAvailability(JSON.parse(w.availability))
  return {
    id: w.id,
    name: w.name,
    initials: initials(w.name),
    phone: w.phone,
    zone_ids: zones.map(z => z.id),
    zone_names: zones.map(z => z.name),
    availability,
    availability_label: availabilityLabel(availability),
    max_week_minutes: w.max_week_minutes,
    max_week_label: `${hoursText(w.max_week_minutes)} h`,
    active: !!w.active,
    worker_url: workerUrl(origin, w.worker_key)
  }
}

async function workerById (ctx, id) {
  const [worker] = await loadWorkers(ctx, { id })
  if (!worker) throw notFound("That worker isn't on the list.")
  return worker
}

function validateWorker (raw, { isPost, zones }) {
  const input = isPost ? { active: true, ...raw } : raw
  const name = trimmed(input.name)
  if (!chars(name) || chars(name) > 40) throw badRequest('name', 'Give the worker a name.')
  guardText(name, 'name')
  const phone = normalizePhone(input.phone)
  if (!phone) throw badRequest('phone', PHONE_MESSAGE)
  const zoneIds = input.zone_ids
  if (!Array.isArray(zoneIds) || !zoneIds.length || new Set(zoneIds).size !== zoneIds.length ||
    !zoneIds.every(id => Number.isInteger(id) && zones.some(z => z.id === id))) {
    throw badRequest('zone_ids', 'Pick at least one travel zone.')
  }
  const a = input.availability
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw badRequest('availability', 'Availability has to end after it starts.')
  const availability = {}
  for (let d = 1; d <= 7; d++) {
    const w = a[String(d)]
    if (w === null || w === undefined) { availability[String(d)] = null; continue }
    if (typeof w !== 'object' || !isHm(w.start) || !isHm(w.end) || w.end <= w.start) {
      throw badRequest('availability', 'Availability has to end after it starts.')
    }
    availability[String(d)] = { start: w.start, end: w.end }
  }
  const max = input.max_week_minutes
  if (!Number.isInteger(max) || max < 60 || max > 4800) throw badRequest('max_week_minutes', 'Weekly hours are between 1 and 80.')
  if (typeof input.active !== 'boolean') throw badRequest('active', 'Say whether this worker is active.')
  return { name, phone, zone_ids: [...zoneIds].sort((x, y) => x - y), availability, max_week_minutes: max, active: input.active }
}

async function listWorkers (ctx) {
  return json(200, { workers: await loadWorkers(ctx, { all: ctx.url.searchParams.get('all') === '1' }) })
}

async function createWorker (ctx) {
  const body = await readJson(ctx.request)
  const { zones } = await loadRefs(ctx.db)
  const w = validateWorker(body, { isPost: true, zones })
  const db = ctx.db
  const key = randomKey()
  const byKey = 'SELECT id FROM workers WHERE worker_key = ?1'
  await db.batch([
    db.prepare('INSERT INTO workers (name, phone, availability, max_week_minutes, active, worker_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(w.name, w.phone, JSON.stringify(w.availability), w.max_week_minutes, w.active ? 1 : 0, key),
    ...w.zone_ids.map(z => db.prepare(`INSERT INTO worker_zones (worker_id, zone_id) VALUES ((${byKey}), ?2)`).bind(key, z))
  ])
  const row = await db.prepare(byKey).bind(key).first()
  return json(201, await workerById(ctx, row.id))
}

async function updateWorker (ctx, idText) {
  const id = Number(idText)
  const db = ctx.db
  const existing = await db.prepare('SELECT * FROM workers WHERE id = ?1').bind(id).first()
  if (!existing) throw notFound("That worker isn't on the list.")
  const body = await readJson(ctx.request)
  const { zones } = await loadRefs(db)
  const w = validateWorker(body, { isPost: false, zones })
  const stmts = [
    db.prepare('UPDATE workers SET name = ?1, phone = ?2, availability = ?3, max_week_minutes = ?4, active = ?5 WHERE id = ?6')
      .bind(w.name, w.phone, JSON.stringify(w.availability), w.max_week_minutes, w.active ? 1 : 0, id),
    db.prepare('DELETE FROM worker_zones WHERE worker_id = ?1').bind(id),
    ...w.zone_ids.map(z => db.prepare('INSERT INTO worker_zones (worker_id, zone_id) VALUES (?1, ?2)').bind(id, z))
  ]
  if (!w.active) {
    // Deactivating: the worker leaves its patterns (in place) and its upcoming visits with no events.
    const upcoming = 'worker_id = ?1 AND starts_at > ?2 AND NOT EXISTS (SELECT 1 FROM events e WHERE e.visit_id = visits.id)'
    stmts.push(
      db.prepare('UPDATE patterns SET worker_id = NULL WHERE worker_id = ?1 AND ended_at IS NULL').bind(id),
      db.prepare(`INSERT OR IGNORE INTO visit_workers (visit_id, worker_id, assigned_at) SELECT id, worker_id, ?2 FROM visits WHERE ${upcoming}`)
        .bind(id, ctx.nowIso),
      db.prepare(`UPDATE visits SET worker_id = NULL, version = version + 1 WHERE ${upcoming}`).bind(id, ctx.nowIso)
    )
  }
  await db.batch(stmts)
  return json(200, await workerById(ctx, id))
}

// ---- visits: generation, loading, views ----

/** Lazily and idempotently create the pattern visits of every week from `from` to `to` (active clients only). */
async function ensureVisits (ctx, from, to) {
  const db = ctx.db
  const firstMonday = mondayOf(from)
  const patterns = (await db.prepare(`SELECT p.id, p.client_id, p.days, p.start_hm AS start, p.end_hm AS "end", p.worker_id, p.valid_from_at,
      p.ended_at FROM patterns p JOIN clients c ON c.id = p.client_id WHERE c.active = 1 AND (p.ended_at IS NULL OR p.ended_at > ?1)`)
    .bind(`${addDays(firstMonday, -1)}T00:00:00.000Z`).all()).results
  const rows = []
  for (let week = firstMonday; week <= to; week = addDays(week, 7)) rows.push(...patternVisits(patterns, week))
  if (!rows.length) return
  const stmt = db.prepare(`INSERT OR IGNORE INTO visits (client_id, pattern_id, pattern_date, date, start_hm, end_hm, starts_at, ends_at,
    worker_id, cancelled, version, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 1, ?10)`)
  await db.batch(rows.map(r => stmt.bind(r.client_id, r.pattern_id, r.pattern_date, r.date, r.start, r.end,
    isoSecond(r.starts_at), isoSecond(r.ends_at), r.worker_id, ctx.nowIso)))
}

/** Visits matching `where` (over alias v) with their effective events, task snapshots and notes. */
async function loadVisitRecords (db, where, binds) {
  const ids = `SELECT v.id FROM visits v WHERE ${where}`
  const [visits, events, tasks, notes] = await db.batch([
    prep(db, `SELECT v.*, c.name AS client_name, c.zone_id, c.lat, c.lng, c.address, c.entry_notes, w.name AS worker_name,
      w.phone AS worker_phone FROM visits v JOIN clients c ON c.id = v.client_id LEFT JOIN workers w ON w.id = v.worker_id
      WHERE ${where} ORDER BY v.starts_at, v.id`, binds),
    prep(db, `SELECT e.*, w.name AS worker_name FROM events e JOIN workers w ON w.id = e.worker_id
      WHERE e.voided_at IS NULL AND e.visit_id IN (${ids})`, binds),
    prep(db, `SELECT * FROM visit_tasks WHERE visit_id IN (${ids}) ORDER BY visit_id, position`, binds),
    prep(db, `SELECT * FROM visit_notes WHERE visit_id IN (${ids})`, binds)
  ])
  const ev = groupBy(events.results, 'visit_id')
  const tk = groupBy(tasks.results, 'visit_id')
  const nt = new Map(notes.results.map(n => [n.visit_id, n]))
  return visits.results.map(row => {
    const own = ev.get(row.id) || []
    return {
      row,
      check_in: own.find(e => e.kind === 'check_in') || null,
      check_out: own.find(e => e.kind === 'check_out') || null,
      tasks: (tk.get(row.id) || []).map(t => ({ task_id: t.task_id, kind: t.kind, label: t.label, done: !!t.done })),
      note: nt.get(row.id) || null
    }
  })
}

async function visitRecord (db, id) {
  const [rec] = await loadVisitRecords(db, 'v.id = ?1', [id])
  return rec || null
}

function officeEventView (e) {
  const isIn = e.kind === 'check_in'
  return {
    id: e.id,
    visit_id: e.visit_id,
    worker_id: e.worker_id,
    worker_name: e.worker_name,
    kind: e.kind,
    at: e.at,
    at_label: timeLabel(e.at),
    at_adjusted: !!e.at_adjusted,
    received_at: e.received_at,
    source: e.source,
    location: isIn ? e.location : null,
    location_label: isIn ? locationLabel(e.location, e.distance_m) : null,
    distance_m: isIn ? e.distance_m ?? null : null,
    correction_reason: e.correction_reason ?? null
  }
}

const workerEventView = e => ({
  id: e.id,
  at: e.at,
  at_label: timeLabel(e.at),
  location_label: e.kind === 'check_in' ? locationLabel(e.location, e.distance_m) : null,
  source: e.source
})

const workedSeconds = rec => (rec.check_in && rec.check_out ? (Date.parse(rec.check_out.at) - Date.parse(rec.check_in.at)) / 1000 : null)

function visitStatus (rec) {
  if (rec.check_out) return { status: 'checked_out', status_label: `Checked out ${timeLabel(rec.check_out.at)}` }
  if (rec.check_in) return { status: 'checked_in', status_label: `Checked in ${timeLabel(rec.check_in.at)}` }
  if (rec.row.cancelled) return { status: 'cancelled', status_label: 'Cancelled' }
  if (rec.row.worker_id === null) return { status: 'unassigned', status_label: 'No worker assigned' }
  return { status: 'scheduled', status_label: 'Scheduled' }
}

function officeVisitView (rec, nowMs) {
  const r = rec.row
  const cancelled = !!r.cancelled
  const late = rec.check_in ? lateMinutes(rec.check_in.at, r.starts_at) : null
  const checkOut = rec.check_out ? officeEventView(rec.check_out) : null
  return {
    id: r.id,
    client_id: r.client_id,
    client_name: r.client_name,
    client_initials: initials(r.client_name),
    zone_id: r.zone_id,
    lat: r.lat,
    lng: r.lng,
    worker_id: r.worker_id,
    worker_name: r.worker_name ?? null,
    worker_phone: r.worker_phone ?? null,
    pattern_id: r.pattern_id,
    date: r.date,
    date_label: dayLabel(r.date),
    start: r.start_hm,
    end: r.end_hm,
    time_label: rangeLabel(r.start_hm, r.end_hm),
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    scheduled_minutes: minutesOf(r.end_hm) - minutesOf(r.start_hm),
    cancelled,
    cancel_reason: r.cancel_reason ?? null,
    version: r.version,
    check_in: rec.check_in ? officeEventView(rec.check_in) : null,
    check_out: checkOut,
    worked_seconds: workedSeconds(rec),
    ...visitStatus(rec),
    alert: alertFor({ cancelled, check_in: rec.check_in, starts_at: r.starts_at }, nowMs),
    late_minutes: late,
    late_label: late !== null && late >= 15 ? `${late} min late` : null,
    tasks_done: checkOut ? rec.tasks : [],
    note: checkOut && rec.note ? { text: rec.note.text, shareable: !!rec.note.shareable, written_label: checkOut.at_label } : null,
    visited_after_cancel: cancelled && !!rec.check_in,
    conflict_kinds: []
  }
}

function workerVisitView (rec, clientTasks) {
  const r = rec.row
  return {
    id: r.id,
    client_id: r.client_id,
    client_name: r.client_name,
    client_initials: initials(r.client_name),
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    entry_notes: r.entry_notes,
    tasks: (clientTasks.get(r.client_id) || []).map(taskView),
    date: r.date,
    start: r.start_hm,
    end: r.end_hm,
    time_label: rangeLabel(r.start_hm, r.end_hm),
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    cancelled: !!r.cancelled,
    cancel_reason: r.cancel_reason ?? null,
    check_in: rec.check_in ? workerEventView(rec.check_in) : null,
    check_out: rec.check_out ? workerEventView(rec.check_out) : null,
    tasks_done: rec.check_out ? rec.tasks : [],
    note: rec.check_out && rec.note ? { text: rec.note.text } : null
  }
}

async function clientTasksFor (db, clientIds) {
  if (!clientIds.length) return new Map()
  const unique = [...new Set(clientIds)]
  const rows = (await db.prepare(`SELECT * FROM client_tasks WHERE client_id IN (${placeholders(unique.length)}) ORDER BY position, id`)
    .bind(...unique).all()).results
  return groupBy(rows, 'client_id')
}

async function workerVisitById (db, id) {
  const rec = await visitRecord(db, id)
  return workerVisitView(rec, await clientTasksFor(db, [rec.row.client_id]))
}

// ---- office: week, day, visits ----

async function getWeek (ctx) {
  const start = ctx.url.searchParams.get('start')
  if (!isDate(start) || isoWeekday(start) !== 1) throw badRequest('start', 'Pick a Monday.')
  const end = addDays(start, 6)
  await ensureVisits(ctx, start, end)
  const db = ctx.db
  const [records, allWorkers, refs] = await Promise.all([
    loadVisitRecords(db, 'v.date BETWEEN ?1 AND ?2', [start, end]),
    loadWorkers(ctx, { all: true }),
    loadRefs(db)
  ])
  const visits = records.map(rec => officeVisitView(rec, ctx.nowMs))
  const conflicts = findConflicts({ visits, workers: allWorkers, zones: refs.zones })
  const kindsByVisit = new Map()
  for (const c of conflicts) for (const id of c.visit_ids) (kindsByVisit.get(id) || kindsByVisit.set(id, new Set()).get(id)).add(c.kind)
  for (const v of visits) {
    const kinds = kindsByVisit.get(v.id)
    v.conflict_kinds = kinds ? KINDS.map(k => k.kind).filter(k => kinds.has(k)) : []
  }
  const workers = allWorkers.filter(w => w.active).map(w => {
    const scheduled = visits.filter(v => v.worker_id === w.id && !v.cancelled).reduce((sum, v) => sum + v.scheduled_minutes, 0)
    return {
      id: w.id, name: w.name, initials: w.initials, scheduled_minutes: scheduled, max_week_minutes: w.max_week_minutes,
      hours_label: `${hoursText(scheduled)} h of ${hoursText(w.max_week_minutes)} h`
    }
  })
  return json(200, {
    week_start: start,
    week_label: `Week of ${dayLabel(start)}`,
    days: Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), date_label: dayLabel(addDays(start, i)) })),
    workers,
    visits,
    conflicts,
    distance_note: DISTANCE_NOTE
  })
}

async function getDay (ctx) {
  const date = ctx.url.searchParams.get('date') || nlDate(ctx.nowMs)
  if (!isDate(date)) throw badRequest('date', 'Pick a date.')
  await ensureVisits(ctx, date, date)
  const records = await loadVisitRecords(ctx.db, 'v.date = ?1', [date])
  return json(200, { date, date_label: dayLabel(date), server_now: new Date(ctx.nowMs).toISOString(), visits: records.map(r => officeVisitView(r, ctx.nowMs)) })
}

function visitTimes (date, start, end) {
  if (!isHm(start)) throw badRequest('start', 'Pick a start time.')
  if (!isHm(end)) throw badRequest('end', 'Pick an end time.')
  if (end <= start) throw badRequest('end', 'The visit has to end after it starts.')
  const minutes = minutesOf(end) - minutesOf(start)
  if (minutes < 15 || minutes > 720) throw badRequest('end', 'A visit is between 15 minutes and 12 hours.')
  const s = localToUtc(date, start)
  if (s === null) throw badRequest('start', GAP_MESSAGE)
  const e = localToUtc(date, end)
  if (e === null) throw badRequest('end', GAP_MESSAGE)
  return { starts_at: isoSecond(s), ends_at: isoSecond(e) }
}

async function officeVisit (ctx, id) {
  const rec = await visitRecord(ctx.db, id)
  if (!rec) throw notFound("That visit isn't on the schedule.")
  return rec
}

async function createVisit (ctx) {
  const body = await readJson(ctx.request)
  const db = ctx.db
  const client = Number.isInteger(body.client_id)
    ? await db.prepare('SELECT id FROM clients WHERE id = ?1 AND active = 1').bind(body.client_id).first()
    : null
  if (!client) throw badRequest('client_id', 'Pick a client.')
  const workerId = body.worker_id ?? null
  if (workerId !== null && !(await loadRefs(db)).activeWorkerIds.has(workerId)) throw badRequest('worker_id', 'Pick one of your workers.')
  if (!isDate(body.date)) throw badRequest('date', 'Pick a date.')
  const t = visitTimes(body.date, body.start, body.end)
  const row = await db.prepare(`INSERT INTO visits (client_id, pattern_id, pattern_date, date, start_hm, end_hm, starts_at, ends_at, worker_id,
    cancelled, version, created_at) VALUES (?1, NULL, NULL, ?2, ?3, ?4, ?5, ?6, ?7, 0, 1, ?8) RETURNING id`)
    .bind(client.id, body.date, body.start, body.end, t.starts_at, t.ends_at, workerId, ctx.nowIso).first()
  if (workerId !== null) {
    await db.prepare('INSERT OR IGNORE INTO visit_workers (visit_id, worker_id, assigned_at) VALUES (?1, ?2, ?3)').bind(row.id, workerId, ctx.nowIso).run()
  }
  return json(201, officeVisitView(await officeVisit(ctx, row.id), ctx.nowMs))
}

/** An office edit guarded by version: the update only lands on the version the office saw. */
async function versionedUpdate (ctx, rec, version, setSql, binds, extra = []) {
  const db = ctx.db
  const results = await db.batch([
    db.prepare(`UPDATE visits SET ${setSql}, version = version + 1 WHERE id = ?1 AND version = ?2`).bind(rec.row.id, version, ...binds),
    ...extra
  ])
  if (!results[0].meta.changes) throw stale()
  return json(200, officeVisitView(await officeVisit(ctx, rec.row.id), ctx.nowMs))
}

async function updateVisit (ctx, idText) {
  const rec = await officeVisit(ctx, Number(idText))
  const body = await readJson(ctx.request)
  if (body.version !== rec.row.version) throw stale()
  if (rec.check_in) throw badState("This visit has started, so it can't be moved.")
  if (rec.row.cancelled) throw badState('This visit is cancelled. Restore it first.')
  const db = ctx.db
  const workerId = body.worker_id ?? null
  if (workerId !== null && workerId !== rec.row.worker_id && !(await loadRefs(db)).activeWorkerIds.has(workerId)) {
    throw badRequest('worker_id', 'Pick one of your workers.')
  }
  if (!isDate(body.date)) throw badRequest('date', 'Pick a date.')
  const t = visitTimes(body.date, body.start, body.end)
  const history = [rec.row.worker_id, workerId].filter(w => w !== null).map(w => db.prepare(
    `INSERT OR IGNORE INTO visit_workers (visit_id, worker_id, assigned_at) SELECT ?1, ?2, ?3
     WHERE EXISTS (SELECT 1 FROM visits WHERE id = ?1 AND version = ?4)`
  ).bind(rec.row.id, w, ctx.nowIso, rec.row.version + 1))
  return versionedUpdate(ctx, rec, body.version,
    'worker_id = ?3, date = ?4, start_hm = ?5, end_hm = ?6, starts_at = ?7, ends_at = ?8',
    [workerId, body.date, body.start, body.end, t.starts_at, t.ends_at], history)
}

async function cancelVisit (ctx, idText) {
  const rec = await officeVisit(ctx, Number(idText))
  const body = await readJson(ctx.request)
  if (body.version !== rec.row.version) throw stale()
  if (rec.check_in) throw badState("This visit has started, so it can't be cancelled.")
  const reason = trimmed(body.reason)
  if (!chars(reason) || chars(reason) > 120) throw badRequest('reason', 'Say why the visit is cancelled.')
  guardText(reason, 'reason')
  return versionedUpdate(ctx, rec, body.version, 'cancelled = 1, cancel_reason = ?3', [reason])
}

async function restoreVisit (ctx, idText) {
  const rec = await officeVisit(ctx, Number(idText))
  const body = await readJson(ctx.request)
  if (body.version !== rec.row.version) throw stale()
  return versionedUpdate(ctx, rec, body.version, 'cancelled = 0, cancel_reason = NULL', [])
}

async function setNoteShareable (ctx, idText) {
  const rec = await officeVisit(ctx, Number(idText))
  const body = await readJson(ctx.request)
  if (typeof body.shareable !== 'boolean') throw badRequest('shareable', 'Say whether the family can see this note.')
  if (!rec.note || !rec.check_out) throw notFound('This visit has no note.')
  await ctx.db.prepare('UPDATE visit_notes SET shareable = ?1 WHERE visit_id = ?2').bind(body.shareable ? 1 : 0, rec.row.id).run()
  return json(200, officeVisitView(await officeVisit(ctx, rec.row.id), ctx.nowMs))
}

// ---- worker phone ----

async function requireWorker (ctx) {
  const key = ctx.request.headers.get('X-Worker-Key')
  const worker = key ? await ctx.db.prepare('SELECT * FROM workers WHERE worker_key = ?1 AND active = 1').bind(key).first() : null
  if (!worker) throw unauthorized(WORKER_KEY_MESSAGE)
  return worker
}

/** Straight-line metres between a worker's effective check-ins on an NL date, in the order they were tapped. */
async function checkInMileage (db, workerId, date) {
  const from = isoSecond(localToUtc(date, '00:00'))
  const to = isoSecond(localToUtc(addDays(date, 1), '00:00'))
  const rows = (await db.prepare(`SELECT e.at, v.id AS visit_id, c.lat, c.lng FROM events e JOIN visits v ON v.id = e.visit_id
    JOIN clients c ON c.id = v.client_id WHERE e.worker_id = ?1 AND e.kind = 'check_in' AND e.voided_at IS NULL AND e.at >= ?2 AND e.at < ?3
    ORDER BY e.at, v.id`).bind(workerId, from, to).all()).results
  let metres = 0
  for (let i = 1; i < rows.length; i++) metres += distanceM(rows[i - 1].lat, rows[i - 1].lng, rows[i].lat, rows[i].lng)
  return metres
}

async function workerVisits (ctx) {
  const worker = await requireWorker(ctx)
  const today = nlDate(ctx.nowMs)
  const date = ctx.url.searchParams.get('date') || today
  if (!isDate(date) || date < addDays(today, -1) || date > addDays(today, 6)) {
    throw badRequest('date', 'Pick a day from yesterday to next week.')
  }
  await ensureVisits(ctx, date, date)
  const db = ctx.db
  const [records, agency, metres] = await Promise.all([
    loadVisitRecords(db, 'v.date = ?1 AND v.worker_id = ?2', [date, worker.id]),
    loadAgency(db),
    checkInMileage(db, worker.id, date)
  ])
  const tasks = await clientTasksFor(db, records.map(r => r.row.client_id))
  return json(200, {
    worker: { id: worker.id, name: worker.name, initials: initials(worker.name) },
    agency: { name: agency.name, sample: agency.name.includes('SAMPLE'), office_phone: agency.office_phone, timezone: agency.timezone },
    date,
    date_label: dayLabel(date),
    server_now: new Date(ctx.nowMs).toISOString(),
    visits: records.map(r => workerVisitView(r, tasks)),
    mileage: { metres, km: kmText(metres), note: 'Straight-line distance between your check-ins today.' }
  })
}

const TASKS_MESSAGE = "The task list didn't come through. Reload and try again."

function validateEvent (body) {
  if (body.kind !== 'check_in' && body.kind !== 'check_out') throw badRequest('kind', "That didn't come through. Reload and try again.")
  if (!Number.isInteger(body.visit_id)) throw badRequest('visit_id', NOT_ON_LIST)
  const atMs = typeof body.at === 'string' ? Date.parse(body.at) : NaN
  if (!Number.isFinite(atMs)) throw badRequest('at', "The time didn't come through. Reload and try again.")
  const out = { kind: body.kind, visit_id: body.visit_id, atMs, location: null, tasks: [], note: '' }
  if (body.kind === 'check_in') {
    const l = body.location
    if (l !== undefined && l !== null) {
      if (typeof l !== 'object' || !isNum(l.lat) || !isNum(l.lng) || Math.abs(l.lat) > 90 || Math.abs(l.lng) > 180) {
        throw badRequest('location', "The location didn't come through. Check in again without it.")
      }
      out.location = { lat: l.lat, lng: l.lng, accuracy_m: isNum(l.accuracy_m) ? l.accuracy_m : null }
    }
    return out
  }
  if (!Array.isArray(body.tasks) || body.tasks.length > 12) throw badRequest('tasks', TASKS_MESSAGE)
  out.tasks = body.tasks.map(t => {
    if (!t || typeof t !== 'object' || !Object.hasOwn(TASK_LABELS, t.kind) || typeof t.label !== 'string' || typeof t.done !== 'boolean' ||
      !(t.task_id === undefined || t.task_id === null || Number.isInteger(t.task_id))) {
      throw badRequest('tasks', TASKS_MESSAGE)
    }
    const label = t.label.trim()
    if (!chars(label) || chars(label) > 80) throw badRequest('tasks', TASKS_MESSAGE)
    guardText(label, 'tasks')
    if (recordsMedicationGiven(label)) throw badRequest('tasks', MEDICATION_MESSAGE)
    return { task_id: t.task_id ?? null, kind: t.kind, label, done: t.done }
  })
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') throw badRequest('note', 'Keep the note to two short lines.')
  const note = (body.note || '').replace(/\r\n?/g, '\n').trim()
  if (chars(note) > 200 || note.split('\n').length > 2) throw badRequest('note', 'Keep the note to two short lines.')
  guardText(note, 'note')
  out.note = note
  return out
}

async function postEvent (ctx) {
  const worker = await requireWorker(ctx)
  const body = await readJson(ctx.request)
  if (!isUuidV4(body.id)) throw badRequest('id', "That didn't come through. Reload and try again.")
  const id = body.id.toLowerCase()
  const db = ctx.db

  for (let attempt = 0; ; attempt++) {
    // An id already stored (any visit, any worker, voided or not) is a resend: answer what is stored, change nothing.
    const stored = await db.prepare('SELECT * FROM events WHERE id = ?1 LIMIT 1').bind(id).first()
    if (stored) return json(200, { duplicate: true, event: workerEventView(stored), visit: await workerVisitById(db, stored.visit_id) })

    const input = validateEvent(body)
    const visit = await db.prepare(`SELECT v.*, c.lat AS client_lat, c.lng AS client_lng,
        EXISTS (SELECT 1 FROM visit_workers vw WHERE vw.visit_id = v.id AND vw.worker_id = ?2) AS was_assigned
      FROM visits v JOIN clients c ON c.id = v.client_id WHERE v.id = ?1`).bind(input.visit_id, worker.id).first()
    if (!visit || (visit.worker_id !== worker.id && !visit.was_assigned)) throw notFound(NOT_ON_LIST)

    const effective = (await db.prepare('SELECT * FROM events WHERE visit_id = ?1 AND voided_at IS NULL').bind(visit.id).all()).results
    const checkIn = effective.find(e => e.kind === 'check_in')
    const checkOut = effective.find(e => e.kind === 'check_out')

    const kept = keptTime(input.atMs, ctx.nowMs, Date.parse(visit.starts_at))
    let atMs = kept.atMs
    let adjusted = kept.adjusted
    const event = {
      id, visit_id: visit.id, worker_id: worker.id, kind: input.kind, at_adjusted: 0, received_at: ctx.nowIso, source: 'phone',
      location: null, lat: null, lng: null, accuracy_m: null, distance_m: null
    }
    const stmts = []

    if (input.kind === 'check_in') {
      if (checkIn) {
        throw new HttpError(409, 'already_checked_in', `This visit already has a check-in at ${timeLabel(checkIn.at)}.`, { event: workerEventView(checkIn) })
      }
      const metres = input.location ? distanceM(input.location.lat, input.location.lng, visit.client_lat, visit.client_lng) : null
      Object.assign(event, {
        location: locationStatus(metres).location, lat: input.location?.lat ?? null, lng: input.location?.lng ?? null,
        accuracy_m: input.location?.accuracy_m ?? null, distance_m: metres
      })
    } else {
      if (!checkIn) throw badState('Check in before you check out.')
      if (checkIn.worker_id !== worker.id) throw badState('Another worker checked in to this visit.')
      if (checkOut) {
        throw new HttpError(409, 'already_checked_out', `This visit already has a check-out at ${timeLabel(checkOut.at)}.`, { event: workerEventView(checkOut) })
      }
      const checkInMs = Date.parse(checkIn.at)
      if (atMs < checkInMs) { atMs = checkInMs; adjusted = true }
    }
    event.at = isoSecond(atMs)
    event.at_adjusted = adjusted ? 1 : 0

    stmts.push(db.prepare(`INSERT INTO events (id, visit_id, worker_id, kind, at, at_adjusted, received_at, source, location, lat, lng, accuracy_m,
      distance_m, correction_reason, voided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL, NULL)`)
      .bind(event.id, event.visit_id, event.worker_id, event.kind, event.at, event.at_adjusted, event.received_at, event.source,
        event.location, event.lat, event.lng, event.accuracy_m, event.distance_m))
    if (input.kind === 'check_out') {
      stmts.push(db.prepare('DELETE FROM visit_tasks WHERE visit_id = ?1').bind(visit.id))
      input.tasks.forEach((t, pos) => stmts.push(db.prepare(
        'INSERT INTO visit_tasks (visit_id, position, task_id, kind, label, done) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
      ).bind(visit.id, pos, t.task_id, t.kind, t.label, t.done ? 1 : 0)))
      stmts.push(db.prepare('DELETE FROM visit_notes WHERE visit_id = ?1').bind(visit.id))
      if (input.note) {
        stmts.push(db.prepare('INSERT INTO visit_notes (visit_id, text, shareable, event_id, written_at) VALUES (?1, ?2, 0, ?3, ?4)')
          .bind(visit.id, input.note, id, event.at))
      }
    }
    try {
      await db.batch(stmts)
    } catch (e) {
      // Two sends racing: the database kept one. Decide again against what it now holds.
      if (isUniqueViolation(e) && attempt < 2) continue
      throw e
    }
    return json(201, { event: workerEventView(event), visit: await workerVisitById(db, visit.id) })
  }
}

// ---- family link ----

function familyVisitView (rec, today, nowMs) {
  const r = rec.row
  const checkIn = rec.check_in
  const checkOut = rec.check_out
  const note = rec.note
  let status
  let statusLabel
  if (checkOut) {
    status = 'left'
    statusLabel = `Arrived ${timeLabel(checkIn.at)}, left ${timeLabel(checkOut.at)}`
  } else if (checkIn) {
    status = 'arrived'
    statusLabel = `Arrived ${timeLabel(checkIn.at)}`
  } else if (r.cancelled) {
    status = 'cancelled'
    statusLabel = 'Cancelled'
  } else if (nowMs >= Date.parse(r.starts_at)) {
    status = 'not_checked_in'
    statusLabel = r.date === today ? 'Not checked in yet' : 'No check-in recorded'
  } else {
    status = 'scheduled'
    statusLabel = 'Scheduled'
  }
  return {
    time_label: rangeLabel(r.start_hm, r.end_hm),
    worker_first_name: firstName(checkIn ? checkIn.worker_name : r.worker_name),
    status,
    status_label: statusLabel,
    arrived_label: checkIn ? timeLabel(checkIn.at) : null,
    left_label: checkIn && checkOut ? timeLabel(checkOut.at) : null,
    tasks_done: checkOut ? rec.tasks.filter(t => t.done).map(t => t.label) : [],
    note: checkOut && note && note.shareable ? note.text : null
  }
}

async function getFamily (ctx, key) {
  const db = ctx.db
  const client = await db.prepare('SELECT id, name FROM clients WHERE family_key = ?1').bind(key).first()
  if (!client) {
    await db.prepare('INSERT INTO family_lookups (ip, at) VALUES (?1, ?2)').bind(ctx.ip, ctx.nowIso).run()
    throw notFound(FAMILY_KEY_MESSAGE)
  }
  const today = nlDate(ctx.nowMs)
  const weekStart = mondayOf(today)
  const weekEnd = addDays(weekStart, 6)
  await ensureVisits(ctx, weekStart, weekEnd)
  const [agency, records] = await Promise.all([
    loadAgency(db),
    loadVisitRecords(db, 'v.client_id = ?1 AND v.date BETWEEN ?2 AND ?3', [client.id, weekStart, weekEnd])
  ])
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    return { date, date_label: dayLabel(date), visits: records.filter(r => r.row.date === date).map(r => familyVisitView(r, today, ctx.nowMs)) }
  })
  return json(200, {
    agency: { name: agency.name, sample: agency.name.includes('SAMPLE'), office_phone: agency.office_phone },
    client: { name: client.name, initials: initials(client.name) },
    today: { date: today, date_label: dayLabel(today), visits: days.find(d => d.date === today).visits },
    week: { week_start: weekStart, week_label: `Week of ${dayLabel(weekStart)}`, days },
    updated_label: fullLabel(ctx.nowMs)
  })
}

// ---- test mode ----

async function testReset (ctx) {
  return json(200, await seedSample(ctx.db, ctx.origin))
}

async function testEvents (ctx) {
  const visitId = ctx.url.searchParams.get('visit_id')
  const rows = visitId
    ? (await ctx.db.prepare('SELECT * FROM events WHERE visit_id = ?1 ORDER BY received_at, rowid').bind(Number(visitId)).all()).results
    : (await ctx.db.prepare('SELECT * FROM events ORDER BY received_at, rowid').all()).results
  return json(200, { events: rows })
}

// ---- router ----

const ROUTES = [
  ['GET', /^\/api\/agency$/, getAgency],
  ['POST', /^\/api\/office\/signin$/, signin],
  ['POST', /^\/api\/office\/signout$/, office(signout)],
  ['GET', /^\/api\/office\/clients$/, office(listClients)],
  ['POST', /^\/api\/office\/clients$/, office(createClient)],
  ['GET', /^\/api\/office\/clients\/(\d+)$/, office(getClient)],
  ['PUT', /^\/api\/office\/clients\/(\d+)$/, office(updateClient)],
  ['GET', /^\/api\/office\/workers$/, office(listWorkers)],
  ['POST', /^\/api\/office\/workers$/, office(createWorker)],
  ['PUT', /^\/api\/office\/workers\/(\d+)$/, office(updateWorker)],
  ['GET', /^\/api\/office\/week$/, office(getWeek)],
  ['GET', /^\/api\/office\/day$/, office(getDay)],
  ['POST', /^\/api\/office\/visits$/, office(createVisit)],
  ['PUT', /^\/api\/office\/visits\/(\d+)$/, office(updateVisit)],
  ['POST', /^\/api\/office\/visits\/(\d+)\/cancel$/, office(cancelVisit)],
  ['POST', /^\/api\/office\/visits\/(\d+)\/restore$/, office(restoreVisit)],
  ['PUT', /^\/api\/office\/visits\/(\d+)\/note$/, office(setNoteShareable)],
  ['GET', /^\/api\/worker\/visits$/, workerVisits],
  ['POST', /^\/api\/worker\/events$/, postEvent],
  ['GET', /^\/api\/family\/([A-Za-z0-9_-]{1,100})$/, getFamily],
  ['POST', /^\/api\/test\/reset$/, testReset],
  ['GET', /^\/api\/test\/events$/, testEvents]
]

async function handle (request, env) {
  const ctx = context(request, env)
  const path = ctx.url.pathname
  if (path.startsWith('/api/test/') && !isTestMode(env)) throw notFound('Not found.')
  for (const [method, re, handler] of ROUTES) {
    const m = re.exec(path)
    if (m && method === request.method) return handler(ctx, ...m.slice(1))
  }
  if (path.startsWith('/api/family/')) throw notFound(FAMILY_KEY_MESSAGE)
  throw notFound('Not found.')
}

export default {
  async fetch (request, env) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return new Response('Not found', { status: 404 })
    try {
      return await handle(request, env)
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, e.body)
      console.error(e)
      return json(500, { error: 'Something went wrong on our side. Try again in a minute.', code: 'server_error' })
    }
  }
}

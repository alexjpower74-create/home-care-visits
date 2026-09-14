// Seeding the SAMPLE agency (POST /api/test/reset). People and places come from the generated sample-data.js.
import { SAMPLE } from './sample-data.js'
import { randomKey } from './auth.js'

export const SAMPLE_PIN = '4826'
// The same PBKDF2 hash as migrations/0002_agency.sql (tests/unit.test.mjs checks they agree and that it verifies 4826).
// Reusing it keeps a reset fast: hashing 100 000 rounds on every test would add up.
export const SAMPLE_PIN_HASH = { hash: 'HL0CykjsPuFaSAXK69aAa30EgjVIx27twS5K1yQtMrg=', salt: 'iyOxbAJBo7Emc5z1pg1gxg==', iterations: 100000 }
export const SAMPLE_PATTERNS_FROM = '2020-01-01T00:00:00.000Z'

// Children first: the database enforces the foreign keys.
const TABLES = ['visit_notes', 'visit_tasks', 'events', 'visit_workers', 'visits', 'patterns', 'family_contacts', 'client_tasks',
  'clients', 'worker_zones', 'workers', 'sessions', 'signin_attempts', 'family_lookups', 'funders', 'zones', 'agency']

export async function wipe (db) {
  await db.batch([
    ...TABLES.map(t => db.prepare(`DELETE FROM ${t}`)),
    db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${TABLES.map(t => `'${t}'`).join(', ')})`)
  ])
}

export const workerUrl = (origin, key) => `${origin}/w/?k=${key}`
export const familyUrl = (origin, key) => `${origin}/f/?k=${key}`

/** Wipe, then seed the SAMPLE base: agency, zones, funders, workers, clients with tasks, patterns and family contacts. */
export async function seedSample (db, origin) {
  await wipe(db)
  const { agency } = SAMPLE
  const workerKeys = SAMPLE.workers.map(() => randomKey())
  const first = await db.batch([
    db.prepare(`INSERT INTO agency (id, name, office_phone, timezone, office_label, office_lat, office_lng, pin_hash, pin_salt, pin_iterations)
      VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
      .bind(agency.name, agency.office_phone, agency.timezone, agency.office.label, agency.office.lat, agency.office.lng,
        SAMPLE_PIN_HASH.hash, SAMPLE_PIN_HASH.salt, SAMPLE_PIN_HASH.iterations),
    ...SAMPLE.zones.map(z => db.prepare('INSERT INTO zones (id, name) VALUES (?1, ?2)').bind(z.id, z.name)),
    ...SAMPLE.funders.map(f => db.prepare('INSERT INTO funders (id, name) VALUES (?1, ?2)').bind(f.id, f.name)),
    ...SAMPLE.workers.map((w, i) => db.prepare(
      'INSERT INTO workers (name, phone, availability, max_week_minutes, active, worker_key) VALUES (?1, ?2, ?3, ?4, 1, ?5) RETURNING id'
    ).bind(w.name, w.phone, JSON.stringify(w.availability), w.max_week_minutes, workerKeys[i]))
  ])
  const workerIds = first.slice(-SAMPLE.workers.length).map(r => r.results[0].id)

  const familyKeys = SAMPLE.clients.map(() => randomKey())
  const inserted = await db.batch(SAMPLE.clients.map((c, i) => db.prepare(
    `INSERT INTO clients (name, address, lat, lng, zone_id, entry_notes, funder_id, active, family_key)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8) RETURNING id`
  ).bind(c.name, c.address, c.lat, c.lng, c.zone_id, c.entry_notes, c.funder_id, familyKeys[i])))
  const clientIds = inserted.map(r => r.results[0].id)

  const children = []
  SAMPLE.workers.forEach((w, i) => {
    for (const z of w.zone_ids) children.push(db.prepare('INSERT INTO worker_zones (worker_id, zone_id) VALUES (?1, ?2)').bind(workerIds[i], z))
  })
  SAMPLE.clients.forEach((c, i) => {
    c.tasks.forEach((t, pos) => children.push(db.prepare(
      'INSERT INTO client_tasks (client_id, position, kind, detail) VALUES (?1, ?2, ?3, ?4)').bind(clientIds[i], pos, t.kind, t.detail || '')))
    c.patterns.forEach(p => children.push(db.prepare(
      'INSERT INTO patterns (client_id, days, start_hm, end_hm, worker_id, valid_from_at, ended_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)'
    ).bind(clientIds[i], JSON.stringify(p.days), p.start, p.end, p.worker ? workerIds[p.worker - 1] : null, SAMPLE_PATTERNS_FROM)))
    c.family_contacts.forEach((f, pos) => children.push(db.prepare(
      'INSERT INTO family_contacts (client_id, position, name, relationship, phone) VALUES (?1, ?2, ?3, ?4, ?5)'
    ).bind(clientIds[i], pos, f.name, f.relationship, f.phone)))
  })
  await db.batch(children)

  return {
    pin: SAMPLE_PIN,
    workers: SAMPLE.workers.map((w, i) => ({ id: workerIds[i], name: w.name, key: workerKeys[i], worker_url: workerUrl(origin, workerKeys[i]) })),
    clients: SAMPLE.clients.map((c, i) => ({ id: clientIds[i], name: c.name, family_key: familyKeys[i], family_url: familyUrl(origin, familyKeys[i]) }))
  }
}

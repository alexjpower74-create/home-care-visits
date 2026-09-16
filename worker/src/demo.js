// The demo scenario (POST /api/test/seed { scenario: "demo" }): the SAMPLE base plus a lived-in fortnight, dated relative to
// server now (DECISIONS 19) and deterministic for a given now: every choice comes from visit ids, never Math.random.
//
// - every visit of last week and of this week before today: checked in 0–9 min after its start, out 0–9 min either side of its
//   end; locations mostly near, one far, one not shared; notes on about half, a third of those shareable;
// - last week's Friday unassigned visit for Edna F. is given to Chris M. and done;
// - today: every visit whose start + 30 min has passed is done except exactly one, left missed (a one-off for Gladys W. when
//   none has passed yet); one visit checked in and not out; a one-off for Sam R. that started 20 minutes ago (late);
// - a one-off double-booking for Chris M. later this week.

import { seedSample } from './sample.js'
import { addDays, isoSecond, localToUtc, mondayOf, nlDate, nlHm } from './time.js'
import { distanceM, locationStatus } from './geo.js'
import { TASK_LABELS } from './labels.js'

const MIN = 60000
const NOTES = [
  'Good visit. Ate most of breakfast.',
  'Quiet morning, we watched the weather together.',
  "Asked about Thursday's groceries.",
  'In good spirits, talked about the garden.',
]

const eventId = (visitId, kind) =>
  `00000000-0000-4000-8000-${(visitId * 2 + (kind === 'check_out' ? 1 : 0)).toString(16).padStart(12, '0')}`
const floorMinute = (ms) => Math.floor(ms / MIN) * MIN

export async function seedDemo(ctx, ensureVisits) {
  const db = ctx.db
  const now = ctx.nowMs
  const seed = await seedSample(db, ctx.origin)
  const workerId = (prefix) => seed.workers.find((w) => w.name.startsWith(prefix)).id
  const clientId = (prefix) => seed.clients.find((c) => c.name.startsWith(prefix)).id
  const today = nlDate(now)
  const monday = mondayOf(today)
  const lastMonday = addDays(monday, -7)
  const sunday = addDays(monday, 6)
  await ensureVisits(ctx, lastMonday, sunday)

  const history = (visitId, worker) =>
    db
      .prepare('INSERT OR IGNORE INTO visit_workers (visit_id, worker_id, assigned_at) VALUES (?1, ?2, ?3)')
      .bind(visitId, worker, ctx.nowIso)

  async function oneOff(clientPrefix, workerPrefix, startMs, minutes) {
    const date = nlDate(startMs)
    const endMs = Math.min(startMs + minutes * MIN, localToUtc(date, '23:59'))
    const worker = workerPrefix ? workerId(workerPrefix) : null
    const row = await db
      .prepare(`INSERT INTO visits (client_id, pattern_id, pattern_date, date, start_hm, end_hm, starts_at, ends_at, worker_id,
      cancelled, version, created_at) VALUES (?1, NULL, NULL, ?2, ?3, ?4, ?5, ?6, ?7, 0, 1, ?8) RETURNING id`)
      .bind(clientId(clientPrefix), date, nlHm(startMs), nlHm(endMs), isoSecond(startMs), isoSecond(endMs), worker, ctx.nowIso)
      .first()
    if (worker) await history(row.id, worker).run()
    return row.id
  }

  const visits = (
    await db
      .prepare(`SELECT v.*, c.lat, c.lng FROM visits v JOIN clients c ON c.id = v.client_id
    WHERE v.date BETWEEN ?1 AND ?2 AND v.cancelled = 0 ORDER BY v.starts_at, v.id`)
      .bind(lastMonday, sunday)
      .all()
  ).results
  const chris = workerId('Chris')
  const stmts = []

  // Past days, and today's visits whose start + 30 min has passed, all done except the last of today's.
  const due = visits.filter((v) => v.date === today && Date.parse(v.starts_at) + 30 * MIN <= now)
  const done = [...visits.filter((v) => v.date < today), ...due.slice(0, -1)]
  if (!due.length) await oneOff('Gladys', 'Jo', floorMinute(now - 45 * MIN), 45)
  for (const v of done) {
    if (v.worker_id !== null) continue
    v.worker_id = chris // last week's Friday Edna F. visit (and any other unassigned visit that is being shown as done)
    stmts.push(history(v.id, chris), db.prepare('UPDATE visits SET worker_id = ?1, version = version + 1 WHERE id = ?2').bind(chris, v.id))
  }

  // One visit checked in and not out: a visit in progress today, or a one-off for Walter G. that started 10 minutes ago.
  const inProgress = visits.find(
    (v) => v.date === today && v.worker_id !== null && Date.parse(v.starts_at) <= now && Date.parse(v.starts_at) + 30 * MIN > now,
  )
  let open
  if (inProgress) {
    const start = Date.parse(inProgress.starts_at)
    open = {
      id: inProgress.id,
      worker_id: inProgress.worker_id,
      lat: inProgress.lat,
      lng: inProgress.lng,
      at: start + Math.min(inProgress.id % 10, Math.floor((now - start) / MIN)) * MIN,
    }
  } else {
    const start = floorMinute(now - 10 * MIN)
    const id = await oneOff('Walter', 'Alex', start, 60)
    const pin = await db.prepare('SELECT lat, lng FROM clients WHERE id = ?1').bind(clientId('Walter')).first()
    open = { id, worker_id: workerId('Alex'), lat: pin.lat, lng: pin.lng, at: start + 2 * MIN }
  }

  await oneOff('Frank', 'Sam', floorMinute(now - 20 * MIN), 60) // late

  const chrisLater = visits.find((v) => v.worker_id === chris && v.date > today)
  if (chrisLater) {
    await oneOff('Irene', 'Chris', Date.parse(chrisLater.starts_at) + 30 * MIN, 60)
  } else {
    const day = today < sunday ? addDays(today, 1) : today
    await oneOff('Edna', 'Chris', localToUtc(day, '13:00'), 120)
    await oneOff('Irene', 'Chris', localToUtc(day, '13:30'), 60)
  }

  const tasks = (await db.prepare('SELECT * FROM client_tasks ORDER BY position, id').all()).results
  const ordered = [...done].sort((a, b) => a.id - b.id)
  const farId = ordered[0]?.id
  const hiddenId = ordered[1]?.id

  const insertEvent = (id, v, workerIdValue, kind, atMs, receivedMs, where) => {
    const metres = where ? distanceM(where.lat, where.lng, v.lat, v.lng) : null
    return db
      .prepare(`INSERT INTO events (id, visit_id, worker_id, kind, at, at_adjusted, received_at, source, location, lat, lng, accuracy_m,
      distance_m, correction_reason, voided_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 'phone', ?7, ?8, ?9, ?10, ?11, NULL, NULL)`)
      .bind(
        id,
        v.id,
        workerIdValue,
        kind,
        isoSecond(atMs),
        isoSecond(Math.min(receivedMs, now)),
        kind === 'check_in' ? locationStatus(metres).location : null,
        where?.lat ?? null,
        where?.lng ?? null,
        where ? 12 : null,
        kind === 'check_in' ? metres : null,
      )
  }

  for (const v of done) {
    const checkIn = Date.parse(v.starts_at) + (v.id % 10) * MIN
    let checkOut = Date.parse(v.ends_at) + (((v.id * 7) % 19) - 9) * MIN
    if (checkOut > now - MIN) checkOut = floorMinute(now - MIN)
    if (checkOut <= checkIn) checkOut = checkIn + MIN
    const where = v.id === hiddenId ? null : { lat: v.lat + (v.id === farId ? 0.006 : ((v.id % 9) + 1) * 0.0001), lng: v.lng }
    stmts.push(
      insertEvent(eventId(v.id, 'check_in'), v, v.worker_id, 'check_in', checkIn, checkIn + (v.id % 5) * MIN, where),
      insertEvent(eventId(v.id, 'check_out'), v, v.worker_id, 'check_out', checkOut, checkOut + (v.id % 4) * MIN, null),
    )
    const own = tasks.filter((t) => t.client_id === v.client_id)
    own.forEach((t, pos) => {
      stmts.push(
        db
          .prepare('INSERT INTO visit_tasks (visit_id, position, task_id, kind, label, done) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
          .bind(v.id, pos, t.id, t.kind, TASK_LABELS[t.kind], v.id % 3 === 0 && pos === own.length - 1 ? 0 : 1),
      )
    })
    if (v.id % 2 === 0) {
      stmts.push(
        db
          .prepare('INSERT INTO visit_notes (visit_id, text, shareable, event_id, written_at) VALUES (?1, ?2, ?3, ?4, ?5)')
          .bind(v.id, NOTES[(v.id / 2) % NOTES.length], v.id % 6 === 0 ? 1 : 0, eventId(v.id, 'check_out'), isoSecond(checkOut)),
      )
    }
  }
  stmts.push(
    insertEvent(eventId(open.id, 'check_in'), open, open.worker_id, 'check_in', open.at, open.at, {
      lat: open.lat + 0.0002,
      lng: open.lng,
    }),
  )
  await db.batch(stmts)

  return { ...seed, office_url: `${ctx.origin}/office/` }
}

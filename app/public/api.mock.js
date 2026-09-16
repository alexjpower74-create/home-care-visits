// In-memory stand-in for the M1 routes of docs/API.md, same shapes, used only with ?mock=1 before the Worker exists.
// It is deliberately small: worker visits, worker events, family, agency. Tests always run against the real Worker.
// Past visits of the SAMPLE week are seeded as done relative to Date.now(). Walter G.'s notes are shareable.
import DATA from './mock-data.js'
import { TZ, timeLabel, dateLabelOf, localDate, localToUtcMs, addDays, isoWeekday, mondayOf, initials, haversineM, kmOf } from './time.js'

const visits = new Map()
const events = new Map()
const generated = new Set()
const iso = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString()
const hm = (h) => {
  const [H, M] = h.split(':').map(Number)
  return `${H % 12 || 12}:${String(M).padStart(2, '0')} ${H < 12 ? 'AM' : 'PM'}`
}
const dayNum = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000)
const agency = () => ({
  name: DATA.agency.name,
  sample: DATA.agency.name.includes('SAMPLE'),
  office_phone: DATA.agency.office_phone,
  timezone: TZ,
})
const err = (status, code, error, extra = {}) => ({ status, ok: false, data: { error, code, ...extra } })
const ok = (data, status = 200) => ({ status, ok: true, data })

function ensureDate(date) {
  if (generated.has(date)) return
  generated.add(date)
  const wd = isoWeekday(date)
  for (const c of DATA.clients)
    c.patterns.forEach((p, i) => {
      if (!p.days.includes(wd)) return
      const id = c.id * 1000000 + (i + 1) * 100000 + (dayNum(date) % 100000)
      const v = {
        id,
        client: c,
        worker_id: p.worker_id,
        date,
        start: p.start,
        end: p.end,
        starts_at: localToUtcMs(date, p.start),
        ends_at: localToUtcMs(date, p.end),
        cancelled: false,
        cancel_reason: null,
        check_in: null,
        check_out: null,
        note: null,
      }
      visits.set(id, v)
      if (v.worker_id && v.ends_at + 5 * 60000 < Date.now()) seedDone(v)
    })
}

function seedDone(v) {
  const inAt = v.starts_at + (v.id % 9) * 60000 + (v.id % 50) * 1000
  store(v, {
    id: `seed-in-${v.id}`,
    kind: 'check_in',
    at: iso(inAt),
    location: { lat: v.client.lat, lng: v.client.lng },
    worker_id: v.worker_id,
  })
  const note = v.client.id === 8 ? 'Walter ate a good breakfast and we talked about his garden. (SAMPLE)' : null
  store(v, {
    id: `seed-out-${v.id}`,
    kind: 'check_out',
    at: iso(v.ends_at + ((v.id % 7) - 3) * 60000),
    worker_id: v.worker_id,
    tasks: v.client.tasks.map((t) => ({ task_id: t.id, kind: t.kind, label: t.label, done: true })),
    note,
  })
  if (note) v.note = { text: note, shareable: true }
}

function store(v, e, source = 'phone') {
  const ev = { ...e, visit_id: v.id, source, at_label: timeLabel(e.at) }
  if (e.kind === 'check_in') {
    const d = e.location ? haversineM(e.location.lat, e.location.lng, v.client.lat, v.client.lng) : null
    ev.location_label =
      d == null
        ? 'Location not shared'
        : d <= 250
          ? 'Within 250 m of the client'
          : `More than 250 m from the client (${d < 1000 ? `${d} m` : `${kmOf(d)} km`})`
    v.check_in = ev
  } else {
    ev.location_label = null
    v.check_out = ev
  }
  events.set(ev.id, ev)
  return ev
}

const eventView = (e) => e && { id: e.id, at: e.at, at_label: e.at_label, location_label: e.location_label, source: e.source }
function workerVisit(v) {
  const c = v.client
  return {
    id: v.id,
    client_id: c.id,
    client_name: c.name,
    client_initials: initials(c.name),
    address: c.address,
    lat: c.lat,
    lng: c.lng,
    entry_notes: c.entry_notes,
    tasks: c.tasks,
    date: v.date,
    start: v.start,
    end: v.end,
    time_label: `${hm(v.start)} – ${hm(v.end)}`,
    starts_at: iso(v.starts_at),
    ends_at: iso(v.ends_at),
    cancelled: v.cancelled,
    cancel_reason: v.cancel_reason,
    check_in: eventView(v.check_in),
    check_out: eventView(v.check_out),
    tasks_done: v.check_out ? v.check_out.tasks : [],
    note: v.note ? { text: v.note.text } : null,
  }
}

function workerFor(headers) {
  const key = headers['X-Worker-Key'] || headers['x-worker-key']
  return DATA.workers.find((w) => w.key === key)
}

function workerVisits(w, url) {
  const today = localDate(Date.now())
  const date = url.searchParams.get('date') || today
  ensureDate(date)
  const mine = [...visits.values()]
    .filter((v) => v.date === date && v.worker_id === w.id)
    .sort((a, b) => a.starts_at - b.starts_at || a.id - b.id)
  const ins = mine.filter((v) => v.check_in).sort((a, b) => a.check_in.at.localeCompare(b.check_in.at) || a.id - b.id)
  let metres = 0
  for (let i = 1; i < ins.length; i++)
    metres += haversineM(ins[i - 1].client.lat, ins[i - 1].client.lng, ins[i].client.lat, ins[i].client.lng)
  return ok({
    worker: { id: w.id, name: w.name, initials: initials(w.name) },
    agency: agency(),
    date,
    date_label: dateLabelOf(date),
    server_now: new Date().toISOString(),
    visits: mine.map(workerVisit),
    mileage: { metres, km: kmOf(metres), note: 'Straight-line distance between your check-ins today.' },
  })
}

function postEvent(w, b) {
  const dup = events.get(String(b?.id || '').toLowerCase())
  const v = visits.get(b?.visit_id)
  if (dup) return ok({ duplicate: true, event: eventView(dup), visit: workerVisit(visits.get(dup.visit_id)) })
  if (!v || v.worker_id !== w.id) return err(404, 'not_found', "That visit isn't on your list.")
  if (b.kind === 'check_out' && typeof b.note === 'string' && (b.note.trim().length > 200 || b.note.trim().split('\n').length > 2)) {
    return err(400, 'bad_request', 'Keep the note to two short lines.', { field: 'note' })
  }
  if (b.kind === 'check_in') {
    if (v.check_in)
      return err(409, 'already_checked_in', `This visit already has a check-in at ${v.check_in.at_label}.`, {
        event: eventView(v.check_in),
      })
    const e = store(v, {
      id: b.id.toLowerCase(),
      kind: 'check_in',
      at: iso(Date.parse(b.at)),
      location: b.location || null,
      worker_id: w.id,
    })
    return ok({ event: eventView(e), visit: workerVisit(v) }, 201)
  }
  if (!v.check_in) return err(409, 'bad_state', 'Check in before you check out.')
  if (v.check_out)
    return err(409, 'already_checked_out', `This visit already has a check-out at ${v.check_out.at_label}.`, {
      event: eventView(v.check_out),
    })
  const note = (b.note || '').trim()
  const e = store(v, { id: b.id.toLowerCase(), kind: 'check_out', at: iso(Date.parse(b.at)), tasks: b.tasks, worker_id: w.id })
  if (note) v.note = { text: note, shareable: false }
  return ok({ event: eventView(e), visit: workerVisit(v) }, 201)
}

function familyVisit(v, today) {
  const w = DATA.workers.find((x) => x.id === v.worker_id)
  const inL = v.check_in?.at_label ?? null,
    outL = v.check_out?.at_label ?? null
  let status, label
  if (inL && outL) [status, label] = ['left', `Arrived ${inL}, left ${outL}`]
  else if (inL) [status, label] = ['arrived', `Arrived ${inL}`]
  else if (v.cancelled) [status, label] = ['cancelled', 'Cancelled']
  else if (v.starts_at <= Date.now()) [status, label] = ['not_checked_in', v.date === today ? 'Not checked in yet' : 'No check-in recorded']
  else [status, label] = ['scheduled', 'Scheduled']
  return {
    time_label: `${hm(v.start)} – ${hm(v.end)}`,
    worker_first_name: w ? w.name.split(' ')[0] : null,
    status,
    status_label: label,
    arrived_label: inL,
    left_label: outL,
    tasks_done: v.check_out ? v.check_out.tasks.filter((t) => t.done).map((t) => t.label) : [],
    note: v.note?.shareable ? v.note.text : null,
  }
}

function family(key) {
  const c = DATA.clients.find((x) => x.family_key === key)
  if (!c) return err(404, 'not_found', "This link doesn't work. Ask the agency for a new one.")
  const today = localDate(Date.now())
  const monday = mondayOf(today)
  const forDate = (date) => {
    ensureDate(date)
    return [...visits.values()]
      .filter((v) => v.client.id === c.id && v.date === date)
      .sort((a, b) => a.starts_at - b.starts_at)
      .map((v) => familyVisit(v, today))
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((date) => ({
    date,
    date_label: dateLabelOf(date),
    visits: forDate(date),
  }))
  return ok({
    agency: { name: DATA.agency.name, sample: true, office_phone: DATA.agency.office_phone },
    client: { name: c.name, initials: initials(c.name) },
    today: { date: today, date_label: dateLabelOf(today), visits: forDate(today) },
    week: { week_start: monday, week_label: `Week of ${dateLabelOf(monday)}`, days },
    updated_label: `${dateLabelOf(today)}, ${timeLabel(Date.now())}`,
  })
}

export async function handle(method, path, { headers = {}, body } = {}) {
  if (!navigator.onLine) throw new TypeError('Failed to fetch')
  await Promise.resolve()
  const url = new URL(path, location.origin)
  if (method === 'GET' && url.pathname === '/api/agency') return ok(agency())
  if (url.pathname.startsWith('/api/family/')) return family(decodeURIComponent(url.pathname.slice(12)))
  if (url.pathname.startsWith('/api/worker/')) {
    const w = workerFor(headers)
    if (!w) return err(401, 'unauthorized', "This link doesn't work any more. Ask the office for a new one.")
    if (method === 'GET' && url.pathname === '/api/worker/visits') return workerVisits(w, url)
    if (method === 'POST' && url.pathname === '/api/worker/events') return postEvent(w, body)
  }
  return err(404, 'not_found', 'Not found.')
}

// The office side of the mock, for screenshots of refused items: the office sets both times on today's visit for a client.
globalThis.hcvMock = {
  officeFixTimes(clientName) {
    const today = localDate(Date.now())
    ensureDate(today)
    const v = [...visits.values()].find((x) => x.date === today && x.client.name === clientName)
    store(
      v,
      { id: `office-in-${v.id}`, kind: 'check_in', at: iso(Date.now() - 20 * 60000), location: null, worker_id: v.worker_id },
      'office',
    )
    store(v, { id: `office-out-${v.id}`, kind: 'check_out', at: iso(Date.now() - 60000), tasks: [], worker_id: v.worker_id }, 'office')
  },
}

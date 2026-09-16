// Week-planner conflicts (pure; docs/API.md "Conflicts"). Three problems from the brief, two warnings (DECISIONS 14).
// Travel allowance is 1.3 × the straight-line distance at 60 km/h (DECISIONS 13).

import { distanceM, kmText } from './geo.js'
import { dayLabel, dayName, hoursText, minutesOf, rangeLabel } from './time.js'

export const KINDS = [
  { kind: 'double_booked', label: 'Double-booked', severity: 'problem' },
  { kind: 'travel_gap', label: 'Travel gap too short', severity: 'problem' },
  { kind: 'over_hours', label: 'Over weekly hours', severity: 'problem' },
  { kind: 'unavailable', label: 'Outside availability', severity: 'warning' },
  { kind: 'outside_zone', label: 'Outside travel zone', severity: 'warning' },
]
const KIND = Object.fromEntries(KINDS.map((k, i) => [k.kind, { ...k, order: i }]))

export const DISTANCE_NOTE = 'Travel times use straight-line distance, not road time.'

/** Minutes of driving allowed for a straight-line distance: ceil(metres × 1.3 / 1000). */
export const neededMinutes = (metres) => Math.ceil((metres * 1.3) / 1000)

/** "Mon–Fri 8:00 AM – 4:00 PM, Sat 9:00 AM – 1:00 PM": consecutive days with the same window, by each group's first day. */
export function availabilityLabel(availability) {
  const groups = []
  for (let d = 1; d <= 7; d++) {
    const w = availability?.[String(d)]
    if (!w) continue
    const last = groups.at(-1)
    if (last && last.to === d - 1 && last.start === w.start && last.end === w.end) last.to = d
    else groups.push({ from: d, to: d, start: w.start, end: w.end })
  }
  if (!groups.length) return 'Not available'
  return groups
    .map((g) => `${g.from === g.to ? dayName(g.from) : `${dayName(g.from)}–${dayName(g.to)}`} ${rangeLabel(g.start, g.end)}`)
    .join(', ')
}

const toMs = (t) => (typeof t === 'number' ? t : Date.parse(t))

function conflict(kind, workerId, date, visitIds, message, extra = {}) {
  const k = KIND[kind]
  return {
    kind,
    label: k.label,
    severity: k.severity,
    worker_id: workerId,
    date,
    visit_ids: [...visitIds].sort((a, b) => a - b),
    message,
    ...extra,
  }
}

function compareIds(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

/**
 * Conflicts for one week.
 * visits: `{ id, worker_id, client_name, zone_id, lat, lng, date, start, end, starts_at, ends_at, cancelled }`
 * workers: `{ id, name, zone_ids, availability, max_week_minutes }`; zones: `{ id, name }`.
 */
export function findConflicts({ visits, workers, zones }) {
  const workerById = new Map(workers.map((w) => [w.id, w]))
  const zoneName = new Map(zones.map((z) => [z.id, z.name]))
  const byWorker = new Map()
  for (const v of visits) {
    if (v.cancelled || v.worker_id === null || v.worker_id === undefined || !workerById.has(v.worker_id)) continue
    if (!byWorker.has(v.worker_id)) byWorker.set(v.worker_id, [])
    byWorker.get(v.worker_id).push(v)
  }

  const out = []
  for (const [workerId, list] of byWorker) {
    const w = workerById.get(workerId)
    list.sort((a, b) => toMs(a.starts_at) - toMs(b.starts_at) || a.id - b.id)

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        if (toMs(a.starts_at) < toMs(b.ends_at) && toMs(b.starts_at) < toMs(a.ends_at)) {
          out.push(
            conflict(
              'double_booked',
              workerId,
              a.date,
              [a.id, b.id],
              `${w.name} is booked for ${a.client_name} and ${b.client_name} at the same time on ${dayLabel(a.date)}.`,
            ),
          )
        }
      }
    }

    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]
      const b = list[i + 1]
      if (a.date !== b.date || toMs(b.starts_at) < toMs(a.ends_at)) continue
      const gap = Math.floor((toMs(b.starts_at) - toMs(a.ends_at)) / 60000)
      const metres = distanceM(a.lat, a.lng, b.lat, b.lng)
      const needed = neededMinutes(metres)
      if (gap < needed) {
        out.push(
          conflict(
            'travel_gap',
            workerId,
            a.date,
            [a.id, b.id],
            `${w.name} has ${gap} min between ${a.client_name} and ${b.client_name} on ${dayLabel(a.date)}, but they are ${kmText(metres)} km apart in a straight line (about ${needed} min of driving).`,
            { gap_minutes: gap, needed_minutes: needed, distance_m: metres },
          ),
        )
      }
    }

    let running = 0
    let firstOver = -1
    for (let i = 0; i < list.length; i++) {
      running += minutesOf(list[i].end) - minutesOf(list[i].start)
      if (firstOver < 0 && running > w.max_week_minutes) firstOver = i
    }
    if (firstOver >= 0) {
      out.push(
        conflict(
          'over_hours',
          workerId,
          null,
          list.slice(firstOver).map((v) => v.id),
          `${w.name} is booked for ${hoursText(running)} h this week; their limit is ${hoursText(w.max_week_minutes)} h.`,
          { scheduled_minutes: running, max_week_minutes: w.max_week_minutes },
        ),
      )
    }

    const label = availabilityLabel(w.availability)
    for (const v of list) {
      const day = ((new Date(`${v.date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
      const win = w.availability?.[String(day)]
      if (!win || v.start < win.start || v.end > win.end) {
        out.push(
          conflict(
            'unavailable',
            workerId,
            v.date,
            [v.id],
            `${dayLabel(v.date)} ${rangeLabel(v.start, v.end)} is outside ${w.name}'s availability (${label}).`,
          ),
        )
      }
      if (!w.zone_ids.includes(v.zone_id)) {
        out.push(
          conflict(
            'outside_zone',
            workerId,
            v.date,
            [v.id],
            `${v.client_name} is in ${zoneName.get(v.zone_id)}, outside ${w.name}'s travel zones.`,
          ),
        )
      }
    }
  }

  return out.sort(
    (a, b) =>
      (a.date === null) - (b.date === null) ||
      (a.date !== b.date && a.date !== null && b.date !== null ? (a.date < b.date ? -1 : 1) : 0) ||
      a.worker_id - b.worker_id ||
      KIND[a.kind].order - KIND[b.kind].order ||
      compareIds(a.visit_ids, b.visit_ids),
  )
}

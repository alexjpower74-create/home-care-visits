// Patterns → visits (pure). The routes insert these rows with INSERT OR IGNORE on (pattern_id, pattern_date), so reading a
// week twice never duplicates a visit, and a pattern only generates visits inside [valid_from_at, ended_at) (DECISIONS 7).

import { addDays, localToUtc } from './time.js'

const toMs = t => (typeof t === 'number' ? t : Date.parse(t))

/**
 * The visits a set of patterns generates in the week starting `weekStart` (a Monday).
 * A pattern: `{ id, client_id, days: [1..7], start, end, worker_id, valid_from_at, ended_at }`.
 * Returns `{ pattern_id, pattern_date, client_id, date, start, end, starts_at, ends_at, worker_id }` with ms instants.
 */
export function patternVisits (patterns, weekStart) {
  const out = []
  for (const p of patterns) {
    const days = typeof p.days === 'string' ? JSON.parse(p.days) : p.days
    const validFrom = toMs(p.valid_from_at)
    const ended = p.ended_at ? toMs(p.ended_at) : null
    for (let i = 0; i < 7; i++) {
      if (!days.includes(i + 1)) continue
      const date = addDays(weekStart, i)
      const startsAt = localToUtc(date, p.start)
      const endsAt = localToUtc(date, p.end)
      if (startsAt === null || endsAt === null) continue // a time the clocks skip that day
      if (startsAt < validFrom) continue
      if (ended !== null && startsAt >= ended) continue
      out.push({
        pattern_id: p.id, pattern_date: date, client_id: p.client_id, date, start: p.start, end: p.end,
        starts_at: startsAt, ends_at: endsAt, worker_id: p.worker_id ?? null
      })
    }
  }
  return out
}

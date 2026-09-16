// Pure rules shared by the routes and the reports: the late/missed rule and the original-time rule (docs/API.md).

export const LATE_MS = 15 * 60000
export const MISSED_MS = 30 * 60000

const toMs = (t) => (typeof t === 'number' ? t : Date.parse(t))

/**
 * The late/missed rule. `visit` needs `cancelled`, `check_in` (the effective one or null) and `starts_at`.
 * Exactly 15:00 after the start is late; exactly 30:00 is missed.
 */
export function alertFor(visit, nowMs) {
  if (visit.cancelled || visit.check_in) return 'none'
  const start = toMs(visit.starts_at)
  if (nowMs >= start + MISSED_MS) return 'missed'
  if (nowMs >= start + LATE_MS) return 'late'
  return 'none'
}

const WINDOW_BACK_MS = 7 * 86400000
const WINDOW_AHEAD_MS = 10 * 60000
const BEFORE_START_MS = 12 * 3600000

/**
 * The original-time rule: the phone's `at` (truncated to the second) is kept when now − 7 days ≤ at ≤ now + 10 minutes and
 * at ≥ starts_at − 12 hours. Otherwise the server's now is stored and the event is flagged `at_adjusted`.
 * Returns `{ atMs, adjusted }`, both whole seconds.
 */
export function keptTime(atMs, nowMs, startsAtMs) {
  const at = Math.floor(atMs / 1000) * 1000
  const now = Math.floor(nowMs / 1000) * 1000
  if (at >= now - WINDOW_BACK_MS && at <= now + WINDOW_AHEAD_MS && at >= startsAtMs - BEFORE_START_MS) {
    return { atMs: at, adjusted: false }
  }
  return { atMs: now, adjusted: true }
}

/** `late_minutes` for a visit with a check-in: whole minutes after the start, never negative. */
export const lateMinutes = (checkInAt, startsAt) => Math.max(0, Math.floor((toMs(checkInAt) - toMs(startsAt)) / 60000))

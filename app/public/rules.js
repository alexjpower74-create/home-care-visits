// The late / missed rule (docs/API.md), identical to the Worker's alertFor. The office board runs it on the page's clock.
export const LATE_AFTER_MS = 15 * 60000;
export const MISSED_AFTER_MS = 30 * 60000;

export function alertFor(visit, nowMs) {
  if (visit.cancelled || visit.check_in) return 'none';
  const start = Date.parse(visit.starts_at);
  if (nowMs < start + LATE_AFTER_MS) return 'none';
  if (nowMs < start + MISSED_AFTER_MS) return 'late';
  return 'missed';
}

/** The instants after nowMs at which alertFor can change for these visits (for a repaint exactly on the minute). */
export function nextAlertChange(visits, nowMs) {
  let next = Infinity;
  for (const v of visits) {
    if (v.cancelled || v.check_in) continue;
    const start = Date.parse(v.starts_at);
    for (const t of [start + LATE_AFTER_MS, start + MISSED_AFTER_MS]) if (t > nowMs && t < next) next = t;
  }
  return next;
}

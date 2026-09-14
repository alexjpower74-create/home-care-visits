// Reports (pure): payroll, billing, missed and late visits, mileage, and their CSV (docs/API.md "Reports").
// Worked time is whole seconds, summed exactly and rounded once per row or total (DECISIONS 11). A visit is dated by the NL date
// of its check-in, never the UTC date. Mileage is straight-line, in the order the worker checked in (DECISIONS 12).

import { dayLabel, decimalHours, hmDuration, nlDate, rangeLabel, timeLabel } from './time.js'
import { distanceM, kmText } from './geo.js'
import { MISSED_MS, lateMinutes } from './rules.js'

export const PAYROLL_NOTE = 'Hours are check-out minus check-in, added up to the second and rounded once.'
export const BILLING_NOTE = 'Hours worked are check-out minus check-in.'
export const MILEAGE_NOTE = "Straight-line distance between clients, in the order the worker checked in. Not road distance. The drive to the first client and home from the last isn't counted."

export const periodLabel = (from, to) => `${dayLabel(from)} to ${dayLabel(to)}`

// Code-unit order of the lower-cased name (the same everywhere, unlike locale collation), then id.
const byName = (nameA, idA, nameB, idB) => {
  const a = nameA.toLowerCase()
  const b = nameB.toLowerCase()
  return a < b ? -1 : a > b ? 1 : idA - idB
}

/** The period rule for anything dated by a check-in: the check-in's NL date. */
export function checkInInPeriod (atIso, from, to) {
  const date = nlDate(atIso)
  return date >= from && date <= to
}

/** `{ visits, seconds, hours, hm_label }` from items carrying whole `seconds`; rounded once, from the summed seconds. */
export function totals (list) {
  const seconds = list.reduce((sum, v) => sum + v.seconds, 0)
  return { visits: list.length, seconds, hours: decimalHours(seconds), hm_label: hmDuration(seconds) }
}

function groupSorted (list, idKey, nameKey) {
  const groups = new Map()
  for (const item of list) {
    if (!groups.has(item[idKey])) groups.set(item[idKey], { id: item[idKey], name: item[nameKey], items: [] })
    groups.get(item[idKey]).items.push(item)
  }
  return [...groups.values()].sort((a, b) => byName(a.name, a.id, b.name, b.id))
}

/**
 * Report rows (one per visit): `{ visit_id, date, start, end, starts_at, cancelled, client_id, client_name, funder_id, funder_name,
 * lat, lng, worker_name, check_in_at, check_in_worker_id, check_in_worker_name, check_out_at }` (effective events only).
 */
function counted (rows, from, to) {
  return rows
    .filter(r => r.check_in_at && r.check_out_at && checkInInPeriod(r.check_in_at, from, to))
    .map(r => ({ ...r, seconds: (Date.parse(r.check_out_at) - Date.parse(r.check_in_at)) / 1000 }))
}

export function payrollReport (rows, from, to) {
  const done = counted(rows, from, to)
  return {
    from,
    to,
    period_label: periodLabel(from, to),
    rows: groupSorted(done, 'check_in_worker_id', 'check_in_worker_name').map(w => ({
      worker_id: w.id,
      worker_name: w.name,
      ...totals(w.items),
      clients: groupSorted(w.items, 'client_id', 'client_name').map(c => ({ client_id: c.id, client_name: c.name, ...totals(c.items) }))
    })),
    total: totals(done),
    incomplete: rows
      .filter(r => r.check_in_at && !r.check_out_at && checkInInPeriod(r.check_in_at, from, to))
      .sort((a, b) => a.check_in_at.localeCompare(b.check_in_at) || a.visit_id - b.visit_id)
      .map(r => ({
        visit_id: r.visit_id, worker_name: r.check_in_worker_name, client_name: r.client_name, date_label: dayLabel(r.date), check_in_label: timeLabel(r.check_in_at)
      })),
    note: PAYROLL_NOTE
  }
}

const scheduledMinutes = list => list.reduce((sum, v) => sum + v.scheduled_minutes, 0)
/** Scheduled hours from summed minutes, rounded once like every hours string (clarification 17). */
const scheduledHours = list => decimalHours(scheduledMinutes(list) * 60)

export function billingReport (rows, from, to) {
  const done = counted(rows, from, to)
  return {
    from,
    to,
    period_label: periodLabel(from, to),
    funders: groupSorted(done, 'funder_id', 'funder_name').map(f => ({
      funder_id: f.id,
      funder_name: f.name,
      ...totals(f.items),
      scheduled_hours: scheduledHours(f.items),
      clients: groupSorted(f.items, 'client_id', 'client_name').map(c => {
        const t = totals(c.items)
        return {
          client_id: c.id, client_name: c.name, visits: t.visits, scheduled_minutes: scheduledMinutes(c.items),
          scheduled_hours: scheduledHours(c.items), seconds: t.seconds, hours: t.hours, hm_label: t.hm_label
        }
      })
    })),
    total: { ...totals(done), scheduled_hours: scheduledHours(done) },
    note: BILLING_NOTE
  }
}

export function missedReport (visits, nowMs, from, to) {
  const found = []
  for (const v of visits) {
    if (v.date < from || v.date > to) continue
    if (v.check_in_at) {
      const late = lateMinutes(v.check_in_at, v.starts_at)
      if (late >= 15) found.push({ v, what: 'late', late })
    } else if (!v.cancelled && Date.parse(v.starts_at) + MISSED_MS <= nowMs) {
      found.push({ v, what: 'missed', late: null })
    }
  }
  return {
    from,
    to,
    period_label: periodLabel(from, to),
    rows: found
      .sort((a, b) => a.v.starts_at.localeCompare(b.v.starts_at) || a.v.visit_id - b.v.visit_id)
      .map(({ v, what, late }) => ({
        visit_id: v.visit_id,
        date: v.date,
        date_label: dayLabel(v.date),
        time_label: rangeLabel(v.start, v.end),
        client_name: v.client_name,
        worker_name: (what === 'late' ? v.check_in_worker_name : v.worker_name) ?? null,
        what,
        what_label: what === 'late' ? `Late: checked in ${late} min after the start` : 'Missed: no check-in',
        late_minutes: late,
        check_in_label: v.check_in_at ? timeLabel(v.check_in_at) : null
      }))
  }
}

export function mileageReport (rows, from, to) {
  const days = new Map()
  for (const r of rows) {
    if (!r.check_in_at || !checkInInPeriod(r.check_in_at, from, to)) continue
    const key = `${r.check_in_worker_id}|${nlDate(r.check_in_at)}`
    if (!days.has(key)) days.set(key, { worker_id: r.check_in_worker_id, worker_name: r.check_in_worker_name, date: nlDate(r.check_in_at), list: [] })
    days.get(key).list.push({ ...r, at: r.check_in_at })
  }
  const out = []
  for (const day of days.values()) {
    const list = day.list
    if (list.length < 2) continue
    list.sort((a, b) => a.at.localeCompare(b.at) || a.visit_id - b.visit_id)
    const legs = []
    for (let i = 1; i < list.length; i++) {
      const metres = distanceM(list[i - 1].lat, list[i - 1].lng, list[i].lat, list[i].lng)
      legs.push({ from_client: list[i - 1].client_name, to_client: list[i].client_name, metres, km: kmText(metres) })
    }
    const metres = legs.reduce((sum, l) => sum + l.metres, 0)
    out.push({ worker_id: day.worker_id, worker_name: day.worker_name, date: day.date, date_label: dayLabel(day.date), legs, metres, km: kmText(metres) })
  }
  out.sort((a, b) => byName(a.worker_name, a.worker_id, b.worker_name, b.worker_id) || (a.date < b.date ? -1 : 1))
  const total = []
  for (const r of out) {
    const last = total.at(-1)
    if (last && last.worker_id === r.worker_id) last.metres += r.metres
    else total.push({ worker_id: r.worker_id, worker_name: r.worker_name, metres: r.metres })
  }
  return {
    from,
    to,
    period_label: periodLabel(from, to),
    rows: out,
    total: total.map(t => ({ ...t, km: kmText(t.metres) })),
    note: MILEAGE_NOTE
  }
}

// ---- CSV ----

const FORMULA = /^[=+\-@\t\r]/

/** One CSV field: numbers as they are; text guarded against spreadsheet formulas, then quoted when it needs to be. */
export function csvCell (value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  let s = String(value)
  if (FORMULA.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export const toCsv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

export function payrollCsv (report) {
  const out = [['Worker', 'Client', 'Visits', 'Hours (decimal)', 'Hours and minutes', 'Seconds']]
  for (const w of report.rows) {
    for (const c of w.clients) out.push([w.worker_name, c.client_name, c.visits, c.hours, c.hm_label, c.seconds])
    out.push([`${w.worker_name} total`, '', w.visits, w.hours, w.hm_label, w.seconds])
  }
  out.push(['Total', '', report.total.visits, report.total.hours, report.total.hm_label, report.total.seconds])
  return toCsv(out)
}

export function billingCsv (report) {
  const out = [['Funder', 'Client', 'Visits', 'Scheduled hours', 'Hours worked (decimal)', 'Hours and minutes', 'Seconds']]
  for (const f of report.funders) {
    for (const c of f.clients) out.push([f.funder_name, c.client_name, c.visits, c.scheduled_hours, c.hours, c.hm_label, c.seconds])
    out.push([`${f.funder_name} total`, '', f.visits, f.scheduled_hours, f.hours, f.hm_label, f.seconds])
  }
  const t = report.total
  out.push(['Total', '', t.visits, t.scheduled_hours, t.hours, t.hm_label, t.seconds])
  return toCsv(out)
}

export function missedCsv (report) {
  const out = [['Date', 'Scheduled', 'Client', 'Worker', 'What happened', 'Minutes late']]
  for (const r of report.rows) out.push([r.date, r.time_label, r.client_name, r.worker_name ?? '', r.what_label, r.late_minutes ?? ''])
  return toCsv(out)
}

export function mileageCsv (report) {
  const out = [['Worker', 'Date', 'From', 'To', 'Kilometres (straight line)']]
  for (const t of report.total) {
    for (const r of report.rows.filter(x => x.worker_id === t.worker_id)) {
      for (const l of r.legs) out.push([r.worker_name, r.date, l.from_client, l.to_client, l.km])
    }
    out.push([`${t.worker_name} total`, '', '', '', t.km])
  }
  return toCsv(out)
}

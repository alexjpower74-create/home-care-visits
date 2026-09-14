// NL time (America/St_Johns): local date/time ↔ UTC instants (DST aware), the labels people read, weeks, hours.
// Labels follow docs/API.md. ICU writes U+202F or U+2009 before AM/PM; the API text uses a plain space.

export const TIMEZONE = 'America/St_Johns'
const DAY_MS = 86400000

const clean = s => s.replace(/[\u202f\u2009\u00a0]/g, " ")
const toMs = t => (typeof t === 'number' ? t : Date.parse(t))

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short', month: 'short', day: 'numeric' })
const utcDateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
})
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const pad = n => String(n).padStart(2, '0')
const partsOf = (fmt, ms) => Object.fromEntries(fmt.formatToParts(ms).map(x => [x.type, x.value]))

/** ISO instant truncated to the whole second: "2026-09-14T12:04:00.000Z". */
export const isoSecond = t => new Date(Math.floor(toMs(t) / 1000) * 1000).toISOString()

/** "9:04 AM" in NL time. */
export const timeLabel = t => clean(timeFmt.format(toMs(t)))

/** "Mon Sep 14" of an instant, in NL time. */
export function dateLabel (t) {
  const p = partsOf(dateFmt, toMs(t))
  return `${p.weekday} ${p.month} ${p.day}`
}

/** "Mon Sep 14, 9:04 AM" */
export const fullLabel = t => `${dateLabel(t)}, ${timeLabel(t)}`

const dateMs = date => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const dateOf = ms => new Date(ms).toISOString().slice(0, 10)

/** "Mon Sep 14" of a calendar date "YYYY-MM-DD". */
export function dayLabel (date) {
  const p = partsOf(utcDateFmt, dateMs(date) + 12 * 3600000)
  return `${p.weekday} ${p.month} ${p.day}`
}

export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dateOf(dateMs(s)) === s
export const isHm = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
export const minutesOf = hm => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** "9:00 AM" from "09:00" (the same text Intl gives for that wall-clock time). */
export function hmLabel (hm) {
  const h = Number(hm.slice(0, 2))
  return `${h % 12 || 12}:${hm.slice(3, 5)} ${h < 12 ? 'AM' : 'PM'}`
}

/** "9:00 AM – 10:30 AM" */
export const rangeLabel = (start, end) => `${hmLabel(start)} – ${hmLabel(end)}`

export const addDays = (date, n) => dateOf(dateMs(date) + n * DAY_MS)

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export const isoWeekday = date => ((new Date(dateMs(date)).getUTCDay() + 6) % 7) + 1

export const dayName = isoDay => DAY_NAMES[isoDay - 1]

/** The Monday of the week holding `date`. */
export const mondayOf = date => addDays(date, 1 - isoWeekday(date))

/** NL wall clock of an instant as a UTC-epoch number (for offset arithmetic). */
function wallOf (ms) {
  const p = partsOf(partsFmt, ms)
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
}

/** NL date "YYYY-MM-DD" of an instant. */
export const nlDate = t => dateOf(wallOf(toMs(t)))

/** NL "HH:MM" of an instant. */
export function nlHm (t) {
  const w = new Date(wallOf(toMs(t)))
  return `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`
}

/**
 * The UTC instant (ms) of an NL local date and "HH:MM", or null when that local time does not exist (the spring-forward gap).
 * A repeated local time on the fall-back day gives its first occurrence.
 */
export function localToUtc (date, hm) {
  const wall = dateMs(date) + minutesOf(hm) * 60000
  const offsets = [wallOf(wall - DAY_MS) - (wall - DAY_MS), wallOf(wall + DAY_MS) - (wall + DAY_MS)]
  const candidates = [...new Set(offsets)].map(off => wall - off).sort((a, b) => a - b)
  for (const c of candidates) if (wallOf(c) === wall) return c
  return null
}

/** Hours with up to one decimal, rounded half up from minutes: 2250 → "37.5", 2400 → "40". */
export function hoursText (minutes) {
  const tenths = Math.floor((minutes + 3) / 6)
  return tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`
}

/** Decimal hours with 2 places, rounded half up from whole seconds: 14160 → "3.93". */
export function decimalHours (seconds) {
  const hundredths = Math.floor((seconds * 100 + 1800) / 3600)
  return `${Math.floor(hundredths / 100)}.${pad(hundredths % 100)}`
}

/** Whole minutes, truncated: 14160 → "3 h 56 min". */
export const hmDuration = seconds => `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`

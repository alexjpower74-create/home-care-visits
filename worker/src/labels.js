// Small text helpers shared by the routes: initials, first names, day lists, task labels, phone numbers.

import { dayName } from './time.js'

export const TASK_LABELS = {
  personal_care: 'Personal care',
  meal_prep: 'Meal preparation',
  medication_reminder: 'Medication reminder',
  housekeeping: 'Light housekeeping',
  laundry: 'Laundry',
  companionship: 'Companionship',
  errands: 'Errands and shopping',
  other: 'Other',
}

const words = (name) =>
  String(name)
    .replace(/\(SAMPLE\)/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

/** "Walter G. (SAMPLE)" → "WG", "Jo (SAMPLE)" → "J". */
export function initials(name) {
  const w = words(name)
  if (!w.length) return ''
  return (w[0][0] + (w.length > 1 ? w.at(-1)[0] : '')).toUpperCase()
}

/** "Sam R. (SAMPLE)" → "Sam" (the family link never shows a worker's last name). */
export const firstName = (name) => (name ? (words(name)[0] ?? null) : null)

/** [1, 3, 5] → "Mon, Wed, Fri" */
export const daysLabel = (days) => days.map(dayName).join(', ')

/** 10 digits once spaces, dashes, dots, brackets and a leading 1 are removed → "709-555-0152"; otherwise null. */
export function normalizePhone(value) {
  if (typeof value !== 'string') return null
  let d = value.replace(/[\s\-.()]/g, '')
  if (/^1\d{10}$/.test(d)) d = d.slice(1)
  if (!/^\d{10}$/.test(d)) return null
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
}

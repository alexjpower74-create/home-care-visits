// The two privacy guards on free text (DECISIONS 15). There is no switch that turns either off.

export const HEALTH_CARD_RE = /\d(?:[ -]?\d){11,}/
export const MEDICATION_RE =
  /\b(administer(ed|s|ing)?|administration|doses?|dosage|inject(ed|ing|ions?)?|insulin|\d+ ?(mg|mcg|ml)|(give|gave|given|giving)\s+((him|her|them|the|his|their)\s+)?(meds?|medications?|pills?|tablets?))\b/i

export const HEALTH_CARD_MESSAGE = "Don't put health card numbers in this app."
export const MEDICATION_MESSAGE = 'This app records medication reminders only, not medication given. Reword this task.'

/** 12 or more digits in a row, single spaces or dashes allowed between them. */
export const looksLikeHealthCard = (text) => typeof text === 'string' && HEALTH_CARD_RE.test(text)

/** Wording that records medication being given (a task may only remind). */
export const recordsMedicationGiven = (text) => typeof text === 'string' && MEDICATION_RE.test(text)

// Pure rules: late/missed, the original-time rule, distance and location, privacy guards, labels, and the seed's integrity.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { alertFor, keptTime } from '../src/rules.js'
import { distanceM, kmText, locationStatus } from '../src/geo.js'
import { looksLikeHealthCard, recordsMedicationGiven } from '../src/privacy.js'
import { availabilityLabel } from '../src/conflicts.js'
import { daysLabel, firstName, initials, normalizePhone } from '../src/labels.js'
import { SAMPLE_PIN, SAMPLE_PIN_HASH } from '../src/sample.js'
import { render, sampleData } from '../tools/build-sample-data.mjs'

const file = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------- the late / missed rule

test('late/missed rule at the boundaries: 14:59.999 none, 15:00.000 late, 29:59.999 late, 30:00.000 missed', () => {
  const starts = '2026-09-14T11:30:00.000Z'
  const s = Date.parse(starts)
  const v = { cancelled: false, check_in: null, starts_at: starts }
  const at = (m, sec, ms) => s + m * 60000 + sec * 1000 + ms
  assert.equal(alertFor(v, s - 60000), 'none')
  assert.equal(alertFor(v, at(14, 59, 999)), 'none')
  assert.equal(alertFor(v, at(15, 0, 0)), 'late')
  assert.equal(alertFor(v, at(29, 59, 999)), 'late')
  assert.equal(alertFor(v, at(30, 0, 0)), 'missed')
  assert.equal(alertFor(v, at(120, 0, 0)), 'missed')
})

test('late/missed rule: a checked-in or cancelled visit is never late, even 2 h after its start', () => {
  const starts = '2026-09-14T11:30:00.000Z'
  const twoHours = Date.parse(starts) + 2 * 3600000
  assert.equal(alertFor({ cancelled: false, check_in: { at: starts }, starts_at: starts }, twoHours), 'none')
  assert.equal(alertFor({ cancelled: true, check_in: null, starts_at: starts }, twoHours), 'none')
  assert.equal(alertFor({ cancelled: false, check_in: null, starts_at: Date.parse(starts) }, twoHours), 'missed')
})

// ---------------------------------------------------------------- the original-time rule

test('original-time rule: the phone time is kept inside the window and replaced by now outside it', () => {
  const now = Date.parse('2026-09-14T14:00:00.000Z')
  const start = Date.parse('2026-09-14T11:30:00.000Z')
  assert.deepEqual(keptTime(now - 45 * 60000 + 999, now, start), { atMs: now - 45 * 60000, adjusted: false })
  assert.deepEqual(keptTime(now + 10 * 60000, now, start), { atMs: now + 10 * 60000, adjusted: false })
  assert.deepEqual(keptTime(now + 10 * 60000 + 1000, now, start), { atMs: now, adjusted: true })
  assert.deepEqual(keptTime(now + 2 * 3600000, now, start), { atMs: now, adjusted: true })
  assert.deepEqual(keptTime(now - 7 * 86400000, now, now - 7 * 86400000), { atMs: now - 7 * 86400000, adjusted: false })
  assert.deepEqual(keptTime(now - 7 * 86400000 - 1000, now, now - 8 * 86400000), { atMs: now, adjusted: true })
  assert.deepEqual(keptTime(start - 12 * 3600000, now, start), { atMs: start - 12 * 3600000, adjusted: false })
  assert.deepEqual(keptTime(start - 12 * 3600000 - 1000, now, start), { atMs: now, adjusted: true })
})

// ---------------------------------------------------------------- distance and location

test('haversine: matches the formula written out, rounded half up to whole metres', () => {
  // Grand Falls-Windsor and Botwood community points (NRCan).
  const [lat1, lng1, lat2, lng2] = [48.9640028, -55.6644417, 49.1356472, -55.3731528]
  const R = 6371008.8
  const toRad = (d) => (d * Math.PI) / 180
  const h = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2
  const expected = Math.floor(2 * R * Math.asin(Math.sqrt(h)) + 0.5)
  assert.equal(distanceM(lat1, lng1, lat2, lng2), expected)
  assert.ok(expected > 27000 && expected < 30000, `about 28 km, got ${expected}`)
  assert.equal(distanceM(lat1, lng1, lat1, lng1), 0)
  assert.equal(kmText(28612), '28.6')
  assert.equal(kmText(28649), '28.6')
  assert.equal(kmText(28650), '28.7')
})

test('location status: 250 m near, 251 m far "251 m", 1 250 m "1.3 km", null not shared', () => {
  assert.deepEqual(locationStatus(250), { location: 'near', location_label: 'Within 250 m of the client' })
  assert.deepEqual(locationStatus(0), { location: 'near', location_label: 'Within 250 m of the client' })
  assert.deepEqual(locationStatus(251), { location: 'far', location_label: 'More than 250 m from the client (251 m)' })
  assert.deepEqual(locationStatus(999), { location: 'far', location_label: 'More than 250 m from the client (999 m)' })
  assert.deepEqual(locationStatus(1250), { location: 'far', location_label: 'More than 250 m from the client (1.3 km)' })
  assert.deepEqual(locationStatus(null), { location: 'not_shared', location_label: 'Location not shared' })
})

// ---------------------------------------------------------------- privacy guards

test('privacy: health card numbers (12+ digits, spaces or dashes between) are refused; 11 digits and phone numbers pass', () => {
  for (const s of ['123456789012', '1234 5678 9012', '1234-5678-9012', 'card 1 2 3 4 5 6 7 8 9 0 1 2', 'MCP 1234-567-890-123']) {
    assert.equal(looksLikeHealthCard(s), true, s)
  }
  for (const s of ['12345678901', '1234 5678 901', '709-555-0152', 'Call 709 555 0152 after 5', 'code 1942 (SAMPLE)', '1234  5678 9012']) {
    assert.equal(looksLikeHealthCard(s), false, s)
  }
})

test('privacy: the medication wording table', () => {
  const refused = [
    'Give her pills',
    '5 mg',
    'insulin',
    'Administer eye drops',
    'Check the dosage',
    'Gave his meds',
    'Injection at noon',
    '10ml syrup',
    'giving tablets',
    'Two doses at supper',
    'Give medication with breakfast',
    '250 mcg',
  ]
  const allowed = [
    'Morning pills from the blister pack',
    'Help with bath',
    'give him a minute',
    'Remind her to take her pills',
    'Noon pills, remind only',
    'Pick up the prescription',
    'Give the dog a walk',
    'Medication reminder',
    'Pharmacy pick-up on Fridays',
  ]
  for (const s of refused) assert.equal(recordsMedicationGiven(s), true, `should refuse: ${s}`)
  for (const s of allowed) assert.equal(recordsMedicationGiven(s), false, `should allow: ${s}`)
})

// ---------------------------------------------------------------- labels

test('labels: initials, first names, days, phones, availability', () => {
  assert.equal(initials('Walter G. (SAMPLE)'), 'WG')
  assert.equal(initials('Jo (SAMPLE)'), 'J')
  assert.equal(initials('mary anne d. (SAMPLE)'), 'MD')
  assert.equal(firstName('Sam R. (SAMPLE)'), 'Sam')
  assert.equal(firstName(null), null)
  assert.equal(daysLabel([1, 3, 5]), 'Mon, Wed, Fri')
  assert.equal(normalizePhone('(709) 555.0152'), '709-555-0152')
  assert.equal(normalizePhone('1 709 555 0152'), '709-555-0152')
  assert.equal(normalizePhone('555-0152'), null)
  assert.equal(normalizePhone('+1 709 555 0152'), null)
  const window = { start: '08:00', end: '16:00' }
  assert.equal(availabilityLabel({ 1: window, 2: window, 3: window, 4: window, 5: window, 6: null, 7: null }), 'Mon–Fri 8:00 AM – 4:00 PM')
  assert.equal(availabilityLabel({ 1: { start: '07:30', end: '15:30' }, 2: { start: '07:30', end: '15:30' } }), 'Mon–Tue 7:30 AM – 3:30 PM')
  // Groups in weekday order of each group's first day (docs/API.md rule; its example lists Sat–Sun first, the rule wins).
  assert.equal(
    availabilityLabel({ 5: { start: '12:00', end: '20:00' }, 6: window, 7: window }),
    'Fri 12:00 PM – 8:00 PM, Sat–Sun 8:00 AM – 4:00 PM',
  )
  assert.equal(availabilityLabel({ 1: window, 2: null, 3: window }), 'Mon 8:00 AM – 4:00 PM, Wed 8:00 AM – 4:00 PM')
  assert.equal(availabilityLabel({}), 'Not available')
})

// ---------------------------------------------------------------- seed integrity

test('seed: src/sample-data.js is exactly what tools/build-sample-data.mjs writes from data/sample-agency.json', () => {
  assert.equal(file('src/sample-data.js'), render(sampleData()), 'stale: run npm run build:sample')
})

test('seed: the PIN hash in 0002_agency.sql and src/sample.js agree and really is PBKDF2 of 4826', async () => {
  const sql = file('migrations/0002_agency.sql')
  assert.ok(sql.includes(`'${SAMPLE_PIN_HASH.hash}'`) && sql.includes(`'${SAMPLE_PIN_HASH.salt}'`))
  const derive = async (pin) => {
    const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
    const bits = await webcrypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(SAMPLE_PIN_HASH.salt, 'base64'), iterations: SAMPLE_PIN_HASH.iterations },
      key,
      256,
    )
    return Buffer.from(bits).toString('base64')
  }
  assert.equal(SAMPLE_PIN, '4826')
  assert.equal(SAMPLE_PIN_HASH.iterations, 100000)
  assert.equal(await derive('4826'), SAMPLE_PIN_HASH.hash)
  assert.notEqual(await derive('4827'), SAMPLE_PIN_HASH.hash)
})

test('seed: wrangler.toml never sets TEST_MODE', () => {
  const toml = file('wrangler.toml')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')
  assert.ok(!/TEST_MODE/.test(toml), 'TEST_MODE must only be passed on the command line')
  assert.ok(/TEST_MODE/.test('[vars]\nTEST_MODE = "1"'), 'the check itself can see a TEST_MODE line')
})

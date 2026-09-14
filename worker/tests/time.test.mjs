// NL time: local ↔ UTC across both DST states, the gap and the repeated hour, labels, weeks, hours.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays, dateLabel, dayLabel, decimalHours, fullLabel, hmDuration, hmLabel, hoursText, isDate, isoSecond, isoWeekday, localToUtc,
  mondayOf, nlDate, nlHm, rangeLabel, timeLabel
} from '../src/time.js'

test('time: 2026-07-14 09:00 NDT is 2026-07-14T11:30:00.000Z, both ways', () => {
  const ms = localToUtc('2026-07-14', '09:00')
  assert.equal(new Date(ms).toISOString(), '2026-07-14T11:30:00.000Z')
  assert.equal(nlDate('2026-07-14T11:30:00.000Z'), '2026-07-14')
  assert.equal(nlHm('2026-07-14T11:30:00.000Z'), '09:00')
})

test('time: 2026-01-12 09:00 NST is 2026-01-12T12:30:00.000Z, both ways', () => {
  const ms = localToUtc('2026-01-12', '09:00')
  assert.equal(new Date(ms).toISOString(), '2026-01-12T12:30:00.000Z')
  assert.equal(nlDate('2026-01-12T12:30:00.000Z'), '2026-01-12')
  assert.equal(nlHm('2026-01-12T12:30:00.000Z'), '09:00')
})

test('time: the spring-forward gap (2026-03-08, 2:00 AM → 3:00 AM) is refused; the minutes either side exist', () => {
  assert.equal(localToUtc('2026-03-08', '02:00'), null)
  assert.equal(localToUtc('2026-03-08', '02:30'), null)
  assert.equal(localToUtc('2026-03-08', '02:59'), null)
  const before = localToUtc('2026-03-08', '01:59')
  const after = localToUtc('2026-03-08', '03:00')
  assert.equal(new Date(before).toISOString(), '2026-03-08T05:29:00.000Z')
  assert.equal(new Date(after).toISOString(), '2026-03-08T05:30:00.000Z')
})

test('time: the repeated hour on fall-back day (2026-11-01 1:30 AM) means its first occurrence (NDT)', () => {
  assert.equal(new Date(localToUtc('2026-11-01', '01:30')).toISOString(), '2026-11-01T04:00:00.000Z')
  assert.equal(new Date(localToUtc('2026-11-01', '02:30')).toISOString(), '2026-11-01T06:00:00.000Z')
})

test('time: labels have a plain space before AM/PM and match the Intl formats of docs/API.md', () => {
  const t = '2026-09-14T12:34:12.000Z'
  assert.equal(timeLabel(t), '10:04 AM')
  assert.equal(dateLabel(t), 'Mon Sep 14')
  assert.equal(fullLabel(t), 'Mon Sep 14, 10:04 AM')
  assert.equal(timeLabel('2026-09-14T15:30:00.000Z'), '1:00 PM')
  for (const label of [timeLabel(t), fullLabel(t), timeLabel('2026-01-12T03:30:00.000Z')]) {
    assert.ok(!/[\u202f\u2009\u00a0]/.test(label), JSON.stringify(label))
  }
  assert.equal(timeLabel('2026-01-12T03:30:00.000Z'), '12:00 AM')
  // hmLabel (from "HH:MM") gives exactly what Intl gives for that wall-clock time, for every minute of a day.
  for (let m = 0; m < 1440; m++) {
    const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    assert.equal(hmLabel(hm), timeLabel(localToUtc('2026-09-14', hm)), hm)
  }
  assert.equal(rangeLabel('09:00', '10:30'), '9:00 AM – 10:30 AM')
  assert.equal(dayLabel('2026-09-14'), 'Mon Sep 14')
})

test('time: the Monday of a week, across a month end and a year end', () => {
  assert.equal(mondayOf('2026-09-14'), '2026-09-14')
  assert.equal(mondayOf('2026-09-20'), '2026-09-14')
  assert.equal(mondayOf('2026-10-01'), '2026-09-28')
  assert.equal(mondayOf('2027-01-01'), '2026-12-28')
  assert.equal(mondayOf('2027-01-03'), '2026-12-28')
  assert.equal(isoWeekday('2026-09-14'), 1)
  assert.equal(isoWeekday('2026-09-20'), 7)
  assert.equal(addDays('2026-12-28', 6), '2027-01-03')
  assert.ok(isDate('2028-02-29'))
  assert.ok(!isDate('2026-02-29'))
  assert.ok(!isDate('2026-9-14'))
})

test('time: hours and durations are rounded once, from whole seconds or minutes', () => {
  assert.equal(decimalHours(14160), '3.93')
  assert.equal(decimalHours(3620) , '1.01')
  assert.equal(decimalHours(1800 + 18), '0.51') // 0.505 h rounds half up
  assert.equal(hmDuration(14160), '3 h 56 min')
  assert.equal(hmDuration(2720), '0 h 45 min')
  assert.equal(hoursText(2250), '37.5')
  assert.equal(hoursText(1200), '20')
  assert.equal(isoSecond('2026-09-14T12:34:12.999Z'), '2026-09-14T12:34:12.000Z')
})

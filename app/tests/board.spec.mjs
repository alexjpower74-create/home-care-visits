// The brief's clock test: the Today board recomputes late/missed from the page's own clock.
import {
  test,
  expect,
  signIn,
  api,
  officeToken,
  oneOffVisit,
  byName,
  rgbOfHex,
  randomUUID,
  iso,
  localToUtcMs,
  DAY,
  MIN,
} from './helpers.mjs'

test('the Today board turns late at 15:00 and missed at 30:00 on the page clock, and done after a check-in', async ({
  page,
  context,
  request,
  seed,
}) => {
  test.setTimeout(180_000)
  const token = await officeToken(request)
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)')
  const start = localToUtcMs(DAY, '09:00')
  const visit = await oneOffVisit(request, token, {
    client_id: byName(seed.clients, 'Ron K. (SAMPLE)').id,
    worker_id: sam.id,
    date: DAY,
    start: '09:00',
    end: '10:00',
  })
  const off = await oneOffVisit(request, token, {
    client_id: byName(seed.clients, 'Irene C. (SAMPLE)').id,
    worker_id: sam.id,
    date: DAY,
    start: '09:00',
    end: '10:00',
  })
  const c = await api(request, 'POST', `/api/office/visits/${off.id}/cancel`, {
    token,
    data: { reason: 'Client away this week (SAMPLE)', version: off.version },
  })
  expect(c.status, 'cancel the second visit').toBe(200)

  await context.setExtraHTTPHeaders({ 'X-Test-Now': iso(start + 14 * MIN + 59_000) })
  // Paused at 09:14:59: only runFor moves the page clock, so the boundaries below don't depend on the machine's speed.
  await page.clock.install({ time: start + 14 * MIN + 58_000 })
  await page.clock.pauseAt(start + 14 * MIN + 59_000)
  await signIn(page)
  const row = page.locator(`.board-row[data-visit-id="${visit.id}"]`)
  const cancelled = page.locator(`.board-row[data-visit-id="${off.id}"]`)
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute('data-alert', 'none')
  await expect(row).not.toContainText('Late')

  await page.clock.runFor(1000) // 09:15:00
  await expect(row).toHaveAttribute('data-alert', 'late')
  await expect(row).toContainText('Late: not checked in 15 minutes after the start')
  const lateToken = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--late-bg').trim())
  expect(lateToken).toBe('#fdecc8')
  expect(await row.evaluate((e) => getComputedStyle(e).backgroundColor), 'the row wears the late token').toBe(rgbOfHex(lateToken))

  await page.clock.runFor(14 * MIN + 59_000) // 09:29:59
  await expect(row).toHaveAttribute('data-alert', 'late')
  await expect(row).toContainText('Late: not checked in 15 minutes after the start')

  await page.clock.runFor(1000) // 09:30:00
  await expect(row).toHaveAttribute('data-alert', 'missed')
  await expect(row).toContainText('Missed: not checked in 30 minutes after the start')
  const call = row.getByRole('link', { name: 'Call Sam R. (SAMPLE): 709-555-0132' })
  await expect(call).toHaveAttribute('href', 'tel:7095550132')
  await expect(cancelled, 'a cancelled visit is never late').toHaveAttribute('data-alert', 'none')
  await expect(cancelled).toContainText('Cancelled')

  const at = iso(start + 31 * MIN)
  const ev = await api(request, 'POST', '/api/worker/events', {
    headers: { 'X-Worker-Key': sam.key },
    now: start + 31 * MIN,
    data: { id: randomUUID(), visit_id: visit.id, kind: 'check_in', at, location: null },
  })
  expect(ev.status, 'check in through the worker API').toBe(201)
  await page.clock.runFor(15_000) // the board's next refresh
  await expect(row).toHaveAttribute('data-status', 'checked_in')
  await expect(row).toHaveAttribute('data-alert', 'none')
  await expect(row).toContainText('Checked in 9:31 AM')
})

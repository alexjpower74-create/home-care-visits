// Tap targets, the SAMPLE badge, no sideways scroll, and contrast of the action buttons and the late/missed rows.
import {
  test,
  expect,
  settledOnPhone,
  tap,
  hitTest,
  intoView,
  tab,
  signIn,
  byName,
  pathOf,
  setNow,
  contrast,
  rgb,
  localToUtcMs,
  NOW,
  DAY,
} from './helpers.mjs'

async function bigAndOnTop(page, locator, label, min) {
  await intoView(page, locator)
  const { box, hit } = await hitTest(locator)
  expect(box, `${label}: has a box`).not.toBeNull()
  expect(box.height, `${label}: at least ${min} px tall`).toBeGreaterThanOrEqual(min)
  expect(box.width, `${label}: at least 48 px wide`).toBeGreaterThanOrEqual(48)
  expect(hit, `${label}: hit-tests to itself`).toBe('')
}

// With the check-out sheet open only its own buttons can be tapped; the page behind it is covered on purpose.
async function everyButton(page, label, { sheet = false } = {}) {
  const controls = sheet
    ? page.locator('#sheet-root button:visible')
    : page.locator('#main button:visible, #main a.btn:visible, #main label.task:visible, #foot a:visible')
  const n = await controls.count()
  expect(n, `${label}: there are buttons to check`).toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    const c = controls.nth(i)
    const name = (await c.innerText()).trim().split('\n')[0]
    await bigAndOnTop(page, c, `${label}: "${name}"`, ['Check in', 'Check out', 'Yes, check out'].includes(name) ? 56 : 48)
  }
}

test('every worker-page button is at least 48 px (Check in / Check out 56 px) and hit-tests to itself at 390 @phone', async ({
  page,
  context,
  seed,
}) => {
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)')
  await setNow(page, context, NOW)
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 49.0187, longitude: -55.48578, accuracy: 10 })
  await page.goto(pathOf(sam.worker_url))
  await expect(page.getByRole('button', { name: 'Check in' })).toBeVisible()
  await expect(page.locator('#strip-text')).toHaveText('All sent')
  await everyButton(page, 'visit open')
  await tap(page, page.getByRole('button', { name: 'Check in' }), 'Check in')
  // Settled: the check-in was sent and the page reloaded the visits with the server's label.
  await expect(page.locator('.visit-status', { hasText: 'Within 250 m of the client' })).toBeVisible()
  await expect(page.locator('#strip-text')).toHaveText('All sent')
  await everyButton(page, 'checked in')
  await tap(page, page.getByRole('button', { name: 'Check out' }), 'Check out')
  await expect(page.getByRole('dialog')).toBeVisible()
  await everyButton(page, 'check-out sheet', { sheet: true })
})

test('the SAMPLE badge is visible on /, /office/, /w/ and /f/', async ({ page, context, seed }) => {
  await setNow(page, context, NOW)
  for (const [url, label] of [
    ['/', 'landing'],
    ['/office/', 'office'],
    [pathOf(seed.workers[0].worker_url), 'worker'],
    [pathOf(seed.clients[0].family_url), 'family'],
  ]) {
    await page.goto(url)
    const badge = page.locator('.badge')
    await expect(badge.first(), `${label}: SAMPLE badge`).toBeVisible()
    await expect(badge.first()).toHaveText('SAMPLE')
    await expect(page.locator('#agency').first(), `${label}: agency name`).toHaveText('SAMPLE Exploits Home Support (demo)')
  }
})

test('no horizontal scroll at 390 on any page @phone', async ({ page, context, seed }) => {
  await setNow(page, context, NOW)
  const fits = async (label) => {
    const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
    expect(scroll, `${label}: page is ${scroll} px wide in a ${inner} px window`).toBeLessThanOrEqual(inner)
  }
  for (const [url, label] of [
    ['/', 'landing'],
    [pathOf(byName(seed.workers, 'Sam R. (SAMPLE)').worker_url), 'worker'],
    [pathOf(seed.clients[0].family_url), 'family'],
  ]) {
    await page.goto(url)
    await expect(page.locator('.badge').first()).toBeVisible()
    await fits(label)
  }
  await page.goto('/office/')
  await expect(page.locator('#pin')).toBeVisible()
  await fits('office sign-in')
  await signIn(page)
  await expect(page.locator('.board-row').first()).toBeVisible()
  await fits('Today')
  await tab(page, 'Week')
  await expect(page.locator('.day-tab').first()).toBeVisible()
  await fits('Week')
  await tab(page, 'Clients')
  await expect(page.locator('#client-list .entity').first()).toBeVisible()
  await fits('Clients')
  await tap(page, page.getByRole('button', { name: 'Add client' }), 'Add client')
  await expect(page.locator('#cf-name')).toBeVisible()
  await fits('client form')
  await tab(page, 'Workers')
  await expect(page.locator('#worker-list .entity').first()).toBeVisible()
  await fits('Workers')
  await tap(page, page.getByRole('button', { name: 'Add worker' }), 'Add worker')
  await expect(page.locator('#wf-name')).toBeVisible()
  await fits('worker form')
})

test('Check in, Check out and the late and missed rows meet 4.5 : 1', async ({ page, context, seed }) => {
  const ratio = async (locator, label) => {
    const [fg, bg] = await locator.evaluate((el) => {
      let n = el
      let back = 'rgba(0, 0, 0, 0)'
      while (n && /rgba\(0, 0, 0, 0\)|transparent/.test(back)) {
        back = getComputedStyle(n).backgroundColor
        n = n.parentElement
      }
      return [getComputedStyle(el).color, back]
    })
    const r = contrast(rgb(fg), rgb(bg))
    expect(r, `${label}: ${fg} on ${bg} is ${r.toFixed(2)} : 1`).toBeGreaterThanOrEqual(4.5)
  }
  await setNow(page, context, NOW)
  await context.grantPermissions(['geolocation'])
  // At Bill S.'s map point: with no position set, WebKit's check-in carries one the office refuses (the card then loses Check out).
  await context.setGeolocation({ latitude: 49.0187, longitude: -55.48578, accuracy: 10 })
  await page.goto(pathOf(byName(seed.workers, 'Sam R. (SAMPLE)').worker_url))
  await ratio(page.getByRole('button', { name: 'Check in' }), 'Check in')
  await tap(page, page.getByRole('button', { name: 'Check in' }), 'Check in')
  // Measure, then leave /w/, only once the refresh after the check-in has answered and redrawn the card (DECISIONS 49).
  await settledOnPhone(
    page,
    page.locator('.visit', { has: page.getByRole('button', { name: 'Check out' }) }),
    'Checked in 10:30 AM · Within 250 m of the client',
  )
  await ratio(page.getByRole('button', { name: 'Check out' }), 'Check out')

  // 9:20 on the board: Bill S. (9:00) is late, Margaret P. (8:30) is missed.
  const at = localToUtcMs(DAY, '09:20')
  await page.clock.setFixedTime(at)
  await context.setExtraHTTPHeaders({ 'X-Test-Now': new Date(at).toISOString() })
  await signIn(page)
  const late = page.locator('.board-row[data-alert="late"]').first()
  const missed = page.locator('.board-row[data-alert="missed"]').first()
  await expect(late).toBeVisible()
  await expect(missed).toBeVisible()
  await ratio(late.locator('.row-status'), 'late row')
  await ratio(missed.locator('.row-status'), 'missed row')
  await ratio(late.locator('.row-client'), 'late row client')
  await ratio(missed.locator('.row-client'), 'missed row client')
  await ratio(late.locator('a.call'), 'late row "Call …" link')
  await ratio(missed.locator('a.call'), 'missed row "Call …" link')
})

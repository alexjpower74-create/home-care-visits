// M1 screenshots (viewport) of the worker page and the family page, chromium + webkit at 390 and 1280, against the dev
// server with ?mock=1 (the Worker is not merged yet; the M2 Playwright suite runs against the real Worker).
// Each step waits for the words it needs, so a broken page fails here instead of producing an empty picture.
// Run: node app/dev-server.mjs & node app/tests/shots-m1.mjs     (BASE defaults to http://127.0.0.1:7901)
import { chromium, webkit, devices } from '@playwright/test'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import DATA from '../public/mock-data.js'

const BASE = process.env.BASE || 'http://127.0.0.1:7901'
const OUT = fileURLToPath(new URL('./shots/', import.meta.url)) // not .pathname: the repo path has spaces
const ONLY = process.env.ONLY // e.g. "chromium-390"
const T = new Date('2026-09-14T13:10:00.000Z') // Mon Sep 14, 10:40 AM in Newfoundland (NDT)
const ruby = DATA.clients.find((c) => c.name === 'Ruby T. (SAMPLE)')
const WAIT = { timeout: 10000 }

const PROJECTS = [
  ['chromium-390', chromium, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
  ['chromium-1280', chromium, { viewport: { width: 1280, height: 800 } }],
  ['webkit-390', webkit, { ...devices['iPhone 14'] }],
  ['webkit-1280', webkit, { viewport: { width: 1280, height: 800 } }],
]

fs.mkdirSync(OUT, { recursive: true })

async function context(browser, opts, problems) {
  const ctx = await browser.newContext({
    ...opts,
    permissions: ['geolocation'],
    geolocation: { latitude: ruby.lat, longitude: ruby.lng, accuracy: 15 },
  })
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.hostname === '127.0.0.1') return route.continue()
    problems.push(`request left 127.0.0.1: ${u.href}`)
    return route.abort()
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  await page.clock.install({ time: T })
  return { ctx, page }
}

async function project(name, engine, opts) {
  const browser = await engine.launch()
  const problems = []
  const shot = (page, what) => page.screenshot({ path: `${OUT}${what}-${name}.png` })
  try {
    // 1. Online: a visit open, checked in with tasks, the check-out sheet.
    let { ctx, page } = await context(browser, opts, problems)
    await page.goto(`${BASE}/w/?k=mock-w2&mock=1`)
    await page.getByRole('button', { name: 'Check in' }).waitFor(WAIT)
    await page.getByText('Done ').first().waitFor(WAIT)
    await shot(page, 'worker-visit-open')

    await page.getByRole('button', { name: 'Check in' }).click()
    await page.getByText(/Checked in 10:40 AM · Within 250 m of the client/).waitFor(WAIT)
    await page.getByText('All sent').waitFor(WAIT)
    const boxes = page.locator('.task input')
    await boxes.nth(0).check()
    await boxes.nth(1).check()
    await page.getByLabel('Note (two short lines)').click()
    await page.keyboard.insertText('Soup made and in the fridge. Ruby asked about Friday. (SAMPLE)')
    await page.getByText(/^6\d \/ 200$/).waitFor(WAIT)
    await page.getByRole('button', { name: 'Check out' }).scrollIntoViewIfNeeded()
    await shot(page, 'worker-checked-in')

    await page.getByRole('button', { name: 'Check out' }).click()
    await page.getByRole('dialog').getByText('Check out now?').waitFor(WAIT)
    await page.getByText('2 of 2 tasks ticked').waitFor(WAIT)
    await shot(page, 'worker-checkout-sheet')
    await page.getByRole('button', { name: 'Yes, check out' }).click()
    await page.getByText(/Done 10:40 AM – 10:40 AM$/).waitFor(WAIT)
    await ctx.close()

    // 2. No signal: check in and out on the phone → 2 saved; then the office has already set times → both refused.
    ;({ ctx, page } = await context(browser, opts, problems))
    await page.goto(`${BASE}/w/?k=mock-w2&mock=1`)
    await page.getByRole('button', { name: 'Check in' }).waitFor(WAIT)
    await ctx.setOffline(true)
    await page.getByText('No signal. Nothing is waiting to send.').waitFor(WAIT)
    await page.getByRole('button', { name: 'Check in' }).click()
    await page.getByText('Checked in 10:40 AM · saved on this phone').waitFor(WAIT)
    await page.locator('.task input').nth(0).check()
    await page.getByRole('button', { name: 'Check out' }).click()
    await page.getByRole('button', { name: 'Yes, check out' }).click()
    await page.getByText('No signal. 2 saved on this phone. They send when signal comes back and keep the time you tapped.').waitFor(WAIT)
    await page.getByText('Done 10:40 AM – 10:40 AM · saved on this phone').waitFor(WAIT)
    await shot(page, 'worker-offline-2-saved')

    await page.evaluate(() => globalThis.hcvMock.officeFixTimes('Ruby T. (SAMPLE)'))
    await ctx.setOffline(false)
    await page.getByRole('heading', { name: 'Not accepted by the office' }).waitFor(WAIT)
    await page.getByText(/This visit already has a check-in at 10:20 AM\./).waitFor(WAIT)
    await page.getByText(/This visit already has a check-out at 10:39 AM\./).waitFor(WAIT)
    await page.getByText(/^All sent\. 2 not accepted by the office\.$/).waitFor(WAIT)
    await page.getByRole('heading', { name: 'Not accepted by the office' }).scrollIntoViewIfNeeded()
    await shot(page, 'worker-refused')

    // 3. Family link: today with a shareable note, then the week.
    await page.goto(`${BASE}/f/?k=mock-f8&mock=1`)
    await page.getByRole('heading', { name: 'Visits for Walter G. (SAMPLE)' }).waitFor(WAIT)
    await page.getByText('Walter ate a good breakfast and we talked about his garden. (SAMPLE)').waitFor(WAIT)
    await page
      .getByText(/^Arrived \d+:\d\d AM, left \d+:\d\d AM$/)
      .first()
      .waitFor(WAIT)
    await shot(page, 'family-today')
    await page.getByRole('heading', { name: 'This week' }).evaluate((h) => h.scrollIntoView({ block: 'start' }))
    await shot(page, 'family-week')

    await page.goto(`${BASE}/f/?k=not-a-real-link&mock=1`)
    await page.getByText("This link doesn't work. Ask the agency for a new one.").waitFor(WAIT)
    await ctx.close()
  } catch (e) {
    problems.push(`step failed: ${e.message.split('\n')[0]}`)
  } finally {
    await browser.close()
  }
  return problems
}

let failed = false
for (const [name, engine, opts] of PROJECTS) {
  if (ONLY && ONLY !== name) continue
  const problems = await project(name, engine, opts)
  console.log(`${problems.length ? 'RED  ' : 'GREEN'} ${name}${problems.map((p) => `\n      ${p}`).join('')}`)
  failed ||= problems.length > 0
}
process.exit(failed ? 1 : 0)

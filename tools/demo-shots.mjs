// Lead's demo screenshots into docs/shots/: the running `npm run demo` (default http://127.0.0.1:7901), real input only,
// viewport captures (full-page shots misplace sticky bars), chromium + webkit at 390 and 1280.
// Usage: npm run demo   (in another shell)   then   node tools/demo-shots.mjs
// Reads the links the demo wrote to .logs/demo-links.txt. The Clients map loads real OpenFreeMap tiles, as the product does.
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(ROOT, 'app', 'package.json'))
const { chromium, webkit, devices } = require('@playwright/test')
const OUT = path.join(ROOT, 'docs', 'shots')
mkdirSync(OUT, { recursive: true })

const links = readFileSync(path.join(ROOT, '.logs', 'demo-links.txt'), 'utf8')
const office = links.match(/^Office:\s+(\S+)\s+PIN (\d+)/m)
const workers = [...links.matchAll(/^Worker:\s+(\S+)\s+\((.+)\)$/gm)].map((m) => ({ url: m[1], name: m[2] }))
const families = [...links.matchAll(/^Family:\s+(\S+)\s+\((.+)\)$/gm)].map((m) => ({ url: m[1], name: m[2] }))
if (!office || !workers.length || !families.length) throw new Error('demo-links.txt is missing the office, worker or family links')
const worker = workers.find((w) => w.name.startsWith('Sam R.')) || workers[0]
const family = families[0]

const projects = [
  {
    name: 'chromium-390',
    engine: chromium,
    use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  },
  { name: 'chromium-1280', engine: chromium, use: { viewport: { width: 1280, height: 800 } } },
  { name: 'webkit-390', engine: webkit, use: { ...devices['iPhone 14'] } },
  { name: 'webkit-1280', engine: webkit, use: { viewport: { width: 1280, height: 800 } } },
]

const shot = (page, screen, project) => page.screenshot({ path: path.join(OUT, `${screen}-${project}.png`) })
const notLoading = (page, sel, text) =>
  page.waitForFunction(
    ([s, t]) => {
      const el = document.querySelector(s)
      return el && !el.textContent.includes(t)
    },
    [sel, text],
    { timeout: 20000 },
  )

async function tapOrClick(page, locator, touch) {
  await locator.scrollIntoViewIfNeeded()
  const b = await locator.boundingBox()
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  const hit = await locator.evaluate(
    (el, [px, py]) => {
      const t = document.elementFromPoint(px, py)
      return t === el || el.contains(t)
    },
    [x, y],
  )
  if (!hit) throw new Error(`something covers ${locator}`)
  if (touch) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

const errors = []
for (const p of projects) {
  const browser = await p.engine.launch()
  const context = await browser.newContext(p.use)
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${p.name} ${page.url()}: ${e.message}`))
  const touch = !!p.use.hasTouch

  // Worker phone and family link first (no sign-in).
  await page.goto(worker.url)
  await notLoading(page, '#main', "Loading today's visits")
  await page.waitForTimeout(800)
  await shot(page, 'worker-today', p.name)
  await page.goto(family.url)
  await notLoading(page, '#main', 'Loading visits')
  await shot(page, 'family', p.name)

  // Office: real PIN typed, real tap on Sign in, then each tab by a real tap.
  await page.goto(office[1])
  await page.locator('#pin').waitFor()
  await tapOrClick(page, page.locator('#pin'), touch)
  if (touch) await page.keyboard.insertText(office[2])
  else await page.keyboard.type(office[2])
  if ((await page.locator('#pin').inputValue()) !== office[2]) throw new Error(`${p.name}: the PIN did not go in`)
  await tapOrClick(page, page.locator('#signin-btn'), touch)
  await page.locator('#tabs').waitFor({ state: 'visible' })
  for (const tab of ['today', 'week', 'clients', 'reports']) {
    await tapOrClick(page, page.locator(`#tabs a[data-tab="${tab}"]`), touch)
    await notLoading(page, '#view', 'Loading')
    await page.waitForTimeout(tab === 'clients' ? 3500 : 800) // the map's real tiles
    await page.evaluate(() => window.scrollTo(0, 0))
    await shot(page, `office-${tab}`, p.name)
  }
  await browser.close()
  console.log(`${p.name}: 6 screens`)
}
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'))
  process.exit(1)
}
console.log(`Screenshots in ${path.relative(ROOT, OUT)}/`)

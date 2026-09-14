// Shared fixture and helpers for the e2e suite (against the real Worker).
// - Every test starts with POST /api/test/reset (auto fixture `seed`, which also hands the test the keys and links).
// - Map tiles (https://tile.openstreetmap.org/**) get a local placeholder PNG; any other request to a host that is not
//   127.0.0.1 is aborted and fails the test (auto fixture `guarded`).
// - REAL input only: tap() hit-tests the target's centre with elementFromPoint before a real touch or click; typing is
//   page.keyboard (insertText on touch projects, then the value is asserted); drags are page.mouse. evaluate only reads
//   (and scrolls a target into view, as a person would). Native <select> and date/time inputs use selectOption/fill.
// - Time: the suite runs on a fixed Monday. NOW is sent as X-Test-Now (the Worker's clock, TEST_MODE only) and given to
//   page.clock, so "today" on the server and on the page are the same day whenever the suite runs.
import { test as base, expect } from '@playwright/test';
import { deflateSync, crc32 } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { localDate, localToUtcMs, addDays, timeLabel } from '../public/time.js';

export { expect, randomUUID, localDate, localToUtcMs, addDays, timeLabel };
export const PIN = '4826';
export const AGENCY = 'SAMPLE Exploits Home Support (demo)';
export const OFFICE_PHONE = '709-555-0100';
export const DAY = '2026-09-14'; // a Monday
export const NOW = localToUtcMs(DAY, '10:30'); // Mon Sep 14, 10:30 AM NDT
export const MIN = 60_000;
export const iso = ms => new Date(ms).toISOString();
export const pathOf = url => { const u = new URL(url); return u.pathname + u.search; };
export function byName(list, name) {
  const found = list.find(x => x.name === name);
  if (!found) throw new Error(`no "${name}" in the seed`);
  return found;
}

/* ---- a generated tile ---- */
function png(width, height, paint) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(paint(x, y), y * (width * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const TILE = png(256, 256, (x, y) => (((x >> 5) + (y >> 5)) % 2 ? [226, 232, 222] : [214, 224, 212]));

/* ---- the network guard ---- */
export async function guard(context) {
  const outside = [];
  await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await context.route(url => url.hostname !== '127.0.0.1' && url.hostname !== 'tile.openstreetmap.org', route => {
    outside.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  return { outside };
}

export const test = base.extend({
  guarded: [async ({ context }, use) => {
    const g = await guard(context);
    await use(g);
    expect(g.outside, 'every request stays on 127.0.0.1 (map tiles go to the local placeholder)').toEqual([]);
  }, { auto: true }],
  seed: [async ({ request }, use) => {
    const r = await request.post('/api/test/reset');
    expect(r.status(), 'POST /api/test/reset').toBe(200);
    await use(await r.json());
  }, { auto: true }],
});

/** The Worker's clock (X-Test-Now on the page's requests) and the page's clock at ms. mode 'fixed' pins Date (timers run);
 *  'install' fakes timers too, so a test can page.clock.runFor. */
export async function setNow(page, context, ms, { mode = 'fixed' } = {}) {
  await context.setExtraHTTPHeaders({ 'X-Test-Now': iso(ms) });
  if (mode === 'install') await page.clock.install({ time: ms });
  else await page.clock.setFixedTime(ms);
}

/* ---- real input ---- */
export async function hitTest(locator) {
  const box = await locator.boundingBox();
  if (!box) return { box, hit: 'no box' };
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const hit = await locator.evaluate((el, [px, py]) => {
    const t = document.elementFromPoint(px, py);
    return t === el || el.contains(t) ? '' : t ? t.outerHTML.slice(0, 160) : 'nothing';
  }, [x, y]);
  return { box, x, y, hit };
}

export async function intoView(page, locator, block = 'center') {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  // "In view" to Playwright includes under the sticky sync strip, where a person could not tap it.
  const stuck = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('.sticky')].map(e => e.getBoundingClientRect().bottom)));
  const vh = page.viewportSize().height;
  if (box && (box.y < stuck || box.y + box.height > vh)) await locator.evaluate((el, b) => el.scrollIntoView({ block: b }), block);
}

const coarse = page => page.evaluate(() => matchMedia('(pointer: coarse)').matches);

export async function tap(page, locator, label = String(locator)) {
  await expect(locator, `tap(${label}): visible`).toBeVisible();
  await intoView(page, locator);
  const { x, y, hit } = await hitTest(locator);
  expect(hit, `tap(${label}) hit-test at ${Math.round(x)},${Math.round(y)}: something else is on top`).toBe('');
  if (await coarse(page)) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** A tap or click at a fraction of an element's box (a map), hit-tested to that element first. */
export async function tapAt(page, locator, fx, fy, label) {
  await expect(locator).toBeVisible();
  await intoView(page, locator);
  const box = await locator.boundingBox();
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  const hit = await locator.evaluate((el, [px, py]) => {
    const t = document.elementFromPoint(px, py);
    return t === el || el.contains(t) ? '' : t ? t.outerHTML.slice(0, 160) : 'nothing';
  }, [x, y]);
  expect(hit, `tapAt(${label}) hit-test at ${Math.round(x)},${Math.round(y)}`).toBe('');
  if (await coarse(page)) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Tap the field, type (insertText on touch projects: keyboard.type drops keys after a touch tap), assert the value. */
export async function typeInto(page, locator, text, label = 'field') {
  await tap(page, locator, label);
  const before = await locator.inputValue();
  if (before) {
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
  }
  if (await coarse(page)) await page.keyboard.insertText(text);
  else await page.keyboard.type(text);
  await expect(locator, `${label}: the typed value`).toHaveValue(text);
}

/** A free point on a Leaflet map: at least 16 px from every control and not on a marker. → { fx, fy } */
export async function mapPoint(page, map) {
  await intoView(page, map);
  const box = await map.boundingBox();
  const controls = await map.locator('.leaflet-control').evaluateAll(els => els.map(e => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  for (const [fx, fy] of [[0.3, 0.72], [0.72, 0.3], [0.22, 0.35], [0.8, 0.62], [0.45, 0.2], [0.55, 0.85], [0.35, 0.5]]) {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    if (!controls.every(c => x < c.x - 16 || x > c.x + c.w + 16 || y < c.y - 16 || y > c.y + c.h + 16)) continue;
    const blocked = await map.evaluate((el, [px, py]) => {
      const t = document.elementFromPoint(px, py);
      return !t || !el.contains(t) || !!t.closest('.leaflet-marker-icon, .leaflet-control');
    }, [x, y]);
    if (!blocked) return { fx, fy };
  }
  throw new Error('mapPoint: no free point on the map away from controls and markers');
}

/** A real mouse drag from the centre of `from` to the centre of `to`, both hit-tested. */
export async function drag(page, from, to, label) {
  await expect(from).toBeVisible();
  await from.evaluate(el => el.scrollIntoView({ block: 'start' }));
  const a = await hitTest(from);
  expect(a.hit, `drag(${label}): the chip is on top at its centre`).toBe('');
  const box = await to.boundingBox();
  const vh = page.viewportSize().height;
  expect(box && box.y + box.height / 2 < vh && box.y + box.height / 2 > 0, `drag(${label}): the drop cell is on screen`).toBe(true);
  const tx = box.x + box.width / 2;
  const ty = box.y + box.height / 2;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 12, a.y + 12, { steps: 3 });
  await page.mouse.move(tx, ty, { steps: 15 });
  const hit = await to.evaluate((el, [px, py]) => {
    const t = document.elementFromPoint(px, py);
    return t === el || el.contains(t) ? '' : t ? t.outerHTML.slice(0, 160) : 'nothing';
  }, [tx, ty]);
  expect(hit, `drag(${label}): the drop point hit-tests to the target cell`).toBe('');
  await page.mouse.up();
}

/* ---- API (arranging and reading data is not UI state) ---- */
export async function api(request, method, url, { data, headers = {}, token, now = NOW } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (now != null) h['X-Test-Now'] = iso(now);
  const r = await request.fetch(url, { method, data, headers: h });
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return { status: r.status(), body };
}

export async function officeToken(request) {
  const r = await api(request, 'POST', '/api/office/signin', { data: { pin: PIN } });
  expect(r.status, 'sign in with the SAMPLE PIN').toBe(200);
  return r.body.token;
}

export async function testEvents(request, visitId) {
  const r = await api(request, 'GET', `/api/test/events?visit_id=${visitId}`);
  expect(r.status).toBe(200);
  return r.body.events;
}

export async function officeVisit(request, token, id, date = DAY, now = NOW) {
  const r = await api(request, 'GET', `/api/office/day?date=${date}`, { token, now });
  expect(r.status).toBe(200);
  return r.body.visits.find(v => v.id === id);
}

export async function oneOffVisit(request, token, data) {
  const r = await api(request, 'POST', '/api/office/visits', { token, data });
  expect(r.status, `one-off visit ${JSON.stringify(data)}`).toBe(201);
  return r.body;
}

/** The POST /api/worker/events answer for an event of this kind. */
export const waitEvent = (page, kind, opts) => page.waitForResponse(r => r.url().endsWith('/api/worker/events')
  && r.request().method() === 'POST' && r.request().postDataJSON()?.kind === kind, opts);

export async function signIn(page, pin = PIN) {
  await page.goto('/office/');
  await typeInto(page, page.locator('#pin'), pin, 'PIN');
  await tap(page, page.locator('#signin-btn'), 'Sign in');
  await expect(page.locator('#signout')).toBeVisible();
}

export const tab = (page, name) => tap(page, page.locator('#tabs').getByRole('link', { name, exact: true }), `${name} tab`);

/* ---- colour ---- */
const channel = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const rgb = css => css.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
export const rgbOfHex = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

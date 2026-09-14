// The offline queue against the real Worker. The phone's clock is page.clock; the Worker's clock is X-Test-Now on the page's
// requests. A check-in tapped at T and a check-out tapped at T + 1:32:10 with no signal must reach the database with exactly
// those times when signal comes back 40 minutes later.
import { test, expect, tap, typeInto, api, officeToken, officeVisit, testEvents, byName, pathOf, setNow, waitEvent, randomUUID, iso, NOW, MIN, OFFICE_PHONE } from './helpers.mjs';

const T = NOW; // Mon Sep 14, 10:30 AM NDT
const OUT = T + (1 * 3600 + 32 * 60 + 10) * 1000; // 12:02:10 PM
const BACK = OUT + 40 * MIN;
const NOTE = 'Swept the porch. Bill asked about Friday. (SAMPLE)';
const WEBKIT_RELOAD = "webkit: page.reload() with the context offline fails in Playwright's WebKit with \"WebKit encountered an internal "
  + 'error" (seen 2026-09-14 on webkit-390 and webkit-1280), so the reload-with-no-signal step runs in Chromium only; every other '
  + 'step here, including the send with the original times, runs in both engines';

test.use({ permissions: ['geolocation'] });

async function phoneOnline(page, context, request, seed, mode = 'fixed') {
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  const visits = (await api(request, 'GET', '/api/worker/visits', { headers: { 'X-Worker-Key': sam.key } })).body.visits;
  const visit = visits[0];
  await setNow(page, context, T, { mode });
  await context.setGeolocation({ latitude: visit.lat, longitude: visit.lng, accuracy: 10 });
  await page.goto(pathOf(sam.worker_url));
  const card = page.locator(`.visit[data-visit="${visit.id}"]`);
  await expect(card.locator('.visit-name')).toHaveText(visit.client_name);
  await expect(page.locator('#strip-text')).toHaveText('All sent');
  return { sam, visit, card };
}

async function checkOut(page, card, taskCount) {
  const tasks = card.locator('.task');
  for (let i = 0; i < taskCount; i++) await tap(page, tasks.nth(i), `task ${i + 1}`);
  await typeInto(page, card.locator('textarea'), NOTE, 'note');
  await tap(page, card.getByRole('button', { name: 'Check out' }), 'Check out');
  await tap(page, page.getByRole('dialog').getByRole('button', { name: 'Yes, check out' }), 'Yes, check out');
}

test('no signal: check-in and check-out are saved, survive a reload, and send later with the times tapped', async ({ page, context, request, seed, browserName }) => {
  test.setTimeout(180_000);
  const { visit, card } = await phoneOnline(page, context, request, seed);
  const controlled = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 100));
    return !!navigator.serviceWorker.controller;
  });
  if (browserName === 'chromium') expect(controlled, 'the service worker controls the worker page').toBe(true);

  await context.setOffline(true);
  await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in (no signal)');
  await expect(card.locator('.visit-status')).toHaveText('Checked in 10:30 AM · saved on this phone');
  await page.clock.setFixedTime(OUT);
  await checkOut(page, card, 2);
  await expect(card.locator('.visit-status')).toHaveText('Done 10:30 AM – 12:02 PM · saved on this phone');
  await expect(page.locator('#strip-text')).toHaveText(/(^|\. )2 saved on this phone\./);
  if (browserName === 'chromium') {
    await expect(page.locator('#strip-text')).toHaveText('No signal. 2 saved on this phone. They send when signal comes back and keep the time you tapped.');
  }
  expect(await testEvents(request, visit.id), 'nothing reached the server with no signal').toHaveLength(0);

  if (browserName === 'webkit') {
    test.info().annotations.push({ type: 'skipped step', description: `${WEBKIT_RELOAD} (service worker controlling the page: ${controlled})` });
  } else {
    await page.reload();
    await expect(card.locator('.visit-status')).toHaveText('Done 10:30 AM – 12:02 PM · saved on this phone');
    await expect(page.locator('#strip-text')).toHaveText(/(^|\. )2 saved on this phone\./);
    await expect(page.locator('.notice-saved')).toHaveText('Saved list from 10:30 AM');
  }

  // Forty minutes after the check-out, signal comes back.
  await page.clock.setFixedTime(BACK);
  await context.setExtraHTTPHeaders({ 'X-Test-Now': iso(BACK) });
  const sent = Promise.all([waitEvent(page, 'check_in', { timeout: 90_000 }), waitEvent(page, 'check_out', { timeout: 90_000 })]);
  await context.setOffline(false);
  const [rin, rout] = await sent;
  expect(rin.status(), 'check-in sent').toBe(201);
  expect(rout.status(), 'check-out sent').toBe(201);

  const token = await officeToken(request);
  const v = await officeVisit(request, token, visit.id, undefined, BACK);
  expect(v.check_in.at, 'check-in keeps the time tapped').toBe(iso(T));
  expect(v.check_out.at, 'check-out keeps the time tapped').toBe(iso(OUT));
  expect(v.worked_seconds).toBe(5530);
  expect(v.check_in.at_adjusted).toBe(false);
  expect(v.check_out.at_adjusted).toBe(false);
  expect(v.check_in.received_at, 'received when signal came back').toBe(iso(BACK));
  expect(v.note.text).toBe(NOTE);
  await expect(page.locator('#strip-text')).toHaveText('All sent');
});

test.describe('with the service worker blocked', () => {
  // These are about the queue, not the service worker: page.route must see every /api request.
  test.use({ serviceWorkers: 'block' });

  test('a 500 when signal comes back leaves both queued; they send on the next try', async ({ page, context, request, seed }) => {
    const { visit, card } = await phoneOnline(page, context, request, seed, 'install');
    let mode = 'offline';
    let failed = 0;
    await page.route('**/api/worker/events', route => {
      if (mode === 'offline') return route.abort('internetdisconnected');
      if (mode === 'fail-once') {
        mode = 'through';
        failed += 1;
        return route.fulfill({ status: 500, contentType: 'application/json',
          body: JSON.stringify({ error: 'Something went wrong on our side. Try again in a minute.', code: 'server_error' }) });
      }
      return route.continue();
    });

    await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in');
    await expect(card.locator('.visit-status')).toHaveText(/ · saved on this phone$/);
    await checkOut(page, card, 1);
    await expect(page.locator('#strip-text')).toHaveText(/(^|\. )2 saved on this phone\./);

    // Run the page clock a second at a time and stop at the 500, before the 5 s backoff can send again.
    mode = 'fail-once';
    for (let s = 0; s < 70 && failed === 0; s++) await page.clock.runFor(1000);
    expect(failed, 'the sender tried and got a 500').toBe(1);
    await expect(page.locator('#strip-text')).toHaveText('2 saved on this phone. Trying again soon. They keep the time you tapped.');
    expect(await testEvents(request, visit.id), 'still nothing on the server').toHaveLength(0);

    const sent = Promise.all([waitEvent(page, 'check_in'), waitEvent(page, 'check_out')]);
    await page.clock.runFor(61_000); // the sender's next try
    const [rin, rout] = await sent;
    expect([rin.status(), rout.status()]).toEqual([201, 201]);
    expect(await testEvents(request, visit.id), 'both sent on the next try').toHaveLength(2);
    await expect(page.locator('#strip-text')).toHaveText('All sent');
  });

  test("a check-out the office already has lands in \"Not accepted by the office\" with the server's words", async ({ page, context, request, seed }) => {
    const { sam, visit, card } = await phoneOnline(page, context, request, seed);
    const in1 = waitEvent(page, 'check_in');
    await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in');
    expect((await in1).status()).toBe(201);

    let offline = true;
    await page.route('**/api/worker/events', route => (offline ? route.abort('internetdisconnected') : route.continue()));
    await checkOut(page, card, 1);
    await expect(page.locator('#strip-text')).toHaveText(/(^|\. )1 saved on this phone\./);

    // Meanwhile the visit already got a check-out on the server (another send with its own id).
    const other = await api(request, 'POST', '/api/worker/events', { headers: { 'X-Worker-Key': sam.key },
      data: { id: randomUUID(), visit_id: visit.id, kind: 'check_out', at: iso(T + MIN), tasks: [] } });
    expect(other.status, 'the other check-out is stored').toBe(201);

    const refused = page.waitForResponse(r => r.url().endsWith('/api/worker/events') && r.request().method() === 'POST' && r.status() === 409, { timeout: 90_000 });
    // Nothing announces a route change; the sender's own retry finds the signal. The phone's clock moves on, so the
    // backoff's due time (Date.now() + delay) passes.
    offline = false;
    await page.clock.setFixedTime(T + 5 * MIN);
    const words = (await (await refused).json()).error;
    expect(words).toMatch(/^This visit already has a check-out at \d{1,2}:\d{2} [AP]M\.$/);
    await expect(page.getByRole('heading', { name: 'Not accepted by the office' })).toBeVisible();
    const item = page.locator('.refused-item');
    await expect(item).toHaveCount(1);
    await expect(item.locator('.server-words')).toHaveText(words);
    await expect(item).toContainText(`Ask the office to fix it: ${OFFICE_PHONE}`);
    await expect(page.locator('#strip-text')).toHaveText('All sent. 1 not accepted by the office.');
    const events = await testEvents(request, visit.id);
    expect(events.filter(e => e.kind === 'check_out'), 'still exactly one check-out').toHaveLength(1);
  });
});

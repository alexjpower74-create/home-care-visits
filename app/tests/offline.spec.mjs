// The offline queue against the real Worker. The phone's clock is page.clock; the Worker's clock is X-Test-Now on the page's
// requests. A check-in tapped at T and a check-out tapped at T + 1:32:10 with no signal must reach the database with exactly
// those times when signal comes back 40 minutes later.
import { test, expect, settledOnPhone, tap, typeInto, api, officeToken, officeVisit, oneOffVisit, testEvents, byName, pathOf, setNow, waitEvent, randomUUID, iso,
  localToUtcMs, addDays, pageNow, NOW, DAY, MIN, OFFICE_PHONE } from './helpers.mjs';

// The queue's retry schedule (API.md, the offline queue; clarification 17: retries are measured, not only awaited).
const BACKOFF_MS = [5000, 15000, 30000, 60000];
const TICK_MS = 20000;
/** The page time between two tries after `failures` failures in a row: not before the backoff, and within `slack` after it. */
function expectRetryGap(from, to, failures, label, slack = TICK_MS) {
  const backoff = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
  const gap = to - from;
  expect(gap, `${label}: ${gap} ms of page time after ${failures} failure(s), not before the ${backoff / 1000} s backoff`).toBeGreaterThanOrEqual(backoff - 1000);
  expect(gap, `${label}: ${gap} ms of page time, within the ${backoff / 1000} s backoff plus ${slack / 1000} s`).toBeLessThanOrEqual(backoff + slack);
}

const T = NOW; // Mon Sep 14, 10:30 AM NDT
const OUT = T + (1 * 3600 + 32 * 60 + 10) * 1000; // 12:02:10 PM
const BACK = OUT + 40 * MIN;
const NOTE = 'Swept the porch. Bill asked about Friday. (SAMPLE)';
const WEBKIT_RELOAD = "webkit: page.reload() with the context offline fails in Playwright's WebKit with \"WebKit encountered an internal "
  + 'error" (seen 2026-09-14 on webkit-390 and webkit-1280), so the reload-with-no-signal step runs in Chromium only; every other '
  + 'step here, including the send with the original times, runs in both engines';

const WEBKIT_SW_ROUTE = "webkit: Playwright's WebKit neither reloads a page with the context offline nor routes a service worker's "
  + 'own fetches, so a test built on either runs in Chromium only';

test.use({ permissions: ['geolocation'] });

const controlledBySw = page => page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return false;
  await navigator.serviceWorker.ready;
  for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 100));
  return !!navigator.serviceWorker.controller;
});

test('with no signal after midnight, a reload still shows yesterday\'s open visit and checks it out', async ({ page, context, request, seed, browserName }) => {
  test.skip(browserName === 'webkit', WEBKIT_SW_ROUTE);
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  const token = await officeToken(request);
  const visit = await oneOffVisit(request, token, { client_id: byName(seed.clients, 'Ron K. (SAMPLE)').id, worker_id: sam.id, date: DAY, start: '23:15', end: '23:55' });
  const inAt = localToUtcMs(DAY, '23:20');
  const outAt = localToUtcMs(addDays(DAY, 1), '00:20');
  await setNow(page, context, inAt);
  await context.setGeolocation({ latitude: visit.lat, longitude: visit.lng, accuracy: 10 });
  await page.goto(pathOf(sam.worker_url));
  expect(await controlledBySw(page), 'the service worker controls the page').toBe(true);
  const card = page.locator(`.visit[data-visit="${visit.id}"]`);
  await tap(page, card.locator('.visit-head'), 'open Ron K. 11:15 PM');
  const inR = waitEvent(page, 'check_in');
  await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in 11:20 PM');
  expect((await inR).status()).toBe(201);
  await settledOnPhone(page, card, 'Checked in 11:20 PM · Within 250 m of the client');

  // 12:20 AM, no signal, the page is opened again.
  await context.setOffline(true);
  await setNow(page, context, outAt);
  await page.reload();
  await expect(page.getByText("No saved list on this phone yet. Find signal once to load today's visits.")).toBeVisible();
  const section = page.locator('.still-open');
  await expect(section.getByRole('heading', { name: 'Still open from yesterday' })).toBeVisible();
  const open = section.locator(`.visit[data-visit="${visit.id}"]`);
  await expect(open.locator('.visit-status')).toHaveText('Checked in 11:20 PM · Within 250 m of the client');
  await tap(page, open.getByRole('button', { name: 'Check out' }), 'Check out 12:20 AM (no signal)');
  await tap(page, page.getByRole('dialog').getByRole('button', { name: 'Yes, check out' }), 'Yes, check out');
  await expect(open.locator('.visit-status')).toHaveText('Done 11:20 PM – 12:20 AM · saved on this phone');

  const sent = waitEvent(page, 'check_out');
  await context.setOffline(false);
  expect((await sent).status()).toBe(201);
  const v = await officeVisit(request, token, visit.id, DAY, outAt);
  expect(v.worked_seconds, '11:20 PM to 12:20 AM').toBe(3600);
});

test("a Wi-Fi login page answering the worker page's files never replaces them in the cache", async ({ page, context, request, seed, browserName }) => {
  test.skip(browserName === 'webkit', WEBKIT_SW_ROUTE);
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  const visit = (await api(request, 'GET', '/api/worker/visits', { headers: { 'X-Worker-Key': sam.key } })).body.visits[0];
  await setNow(page, context, T);
  await page.goto(pathOf(sam.worker_url));
  const card = page.locator(`.visit[data-visit="${visit.id}"]`);
  await expect(card.locator('.visit-name')).toHaveText(visit.client_name);
  expect(await controlledBySw(page), 'the service worker controls the page').toBe(true);

  // A login page answers every file of the worker page with 200 text/html, during an online load.
  const FILES = ['/w/', '/w/app.js', '/w/queue.js', '/api.js', '/time.js', '/theme.css', '/style.css', '/icons/icon.svg', '/w/sw.js'];
  let poisoned = true;
  let served = 0;
  await context.route(url => url.hostname === '127.0.0.1' && FILES.includes(url.pathname), route => {
    if (!poisoned) return route.continue();
    served += 1;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Free Wi-Fi</title><p>Log in to continue.</p>' });
  });
  await page.reload();
  await expect.poll(() => served, { message: "the login page answered the page's files", timeout: 20_000 }).toBeGreaterThanOrEqual(8);
  await expect(card.locator('.visit-name'), 'the worker page, not the login page').toHaveText(visit.client_name);

  // Later, no signal: the page opens from the cache and still works.
  poisoned = false;
  await context.setOffline(true);
  await page.reload();
  await expect(card.locator('.visit-name')).toHaveText(visit.client_name);
  await expect(page.locator('.notice-saved')).toHaveText('Saved list from 10:30 AM');
  await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in (no signal)');
  await expect(card.locator('.visit-status')).toHaveText('Checked in 10:30 AM · saved on this phone');
});

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
  const sent = Promise.all([waitEvent(page, 'check_in'), waitEvent(page, 'check_out')]);
  await context.setOffline(false);
  const [rin, rout] = await sent;
  expect(rin.status(), 'check-in sent').toBe(201);
  expect(rout.status(), 'check-out sent').toBe(201);
  // The `online` event sends at once: no backoff and no tick in between (one 5 s clock step of slack).
  for (const [res, label] of [[rin, 'check-in'], [rout, 'check-out']]) {
    expect(res.pageWaitMs, `${label}: sent within ${res.pageWaitMs} ms of page time after signal came back`).toBeLessThanOrEqual(5000);
  }

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
    let aborted = 0;
    const tries = []; // { t: page time, ok }
    await page.route('**/api/worker/events', async route => {
      const t = await pageNow(page);
      if (mode === 'offline') { aborted += 1; tries.push({ t, ok: false }); return route.abort('internetdisconnected'); }
      if (mode === 'fail-once') {
        mode = 'through';
        failed += 1;
        tries.push({ t, ok: false });
        return route.fulfill({ status: 500, contentType: 'application/json',
          body: JSON.stringify({ error: 'Something went wrong on our side. Try again in a minute.', code: 'server_error' }) });
      }
      tries.push({ t, ok: true });
      return route.continue();
    });

    await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in');
    await expect(card.locator('.visit-status')).toHaveText(/ · saved on this phone$/);
    // A failed send must leave the event on the phone.
    await expect.poll(() => aborted, { message: 'the phone tried to send the check-in' }).toBeGreaterThan(0);
    await expect(page.locator('#strip-text'), 'the check-in is still saved on the phone after a failed send').toHaveText(/^1 saved on this phone\./);
    await checkOut(page, card, 1);
    await expect(page.locator('#strip-text')).toHaveText(/(^|\. )2 saved on this phone\./);

    // Run the page clock a second at a time and stop at the 500, before the 5 s backoff can send again.
    mode = 'fail-once';
    for (let s = 0; s < 70 && failed === 0; s++) await page.clock.runFor(1000);
    expect(failed, 'the sender tried and got a 500').toBe(1);
    await expect(page.locator('#strip-text')).toHaveText('2 saved on this phone. Trying again soon. They keep the time you tapped.');
    expect(await testEvents(request, visit.id), 'still nothing on the server').toHaveLength(0);

    // The sender's next try, the clock moved a second at a time (waitEvent) so each try's page time is known.
    const sentIn = waitEvent(page, 'check_in', { mode: 'install' });
    const sentOut = waitEvent(page, 'check_out', { mode: 'install' });
    const rin = await sentIn;
    const rout = await sentOut;
    expect([rin.status(), rout.status()]).toEqual([201, 201]);
    expect(await testEvents(request, visit.id), 'both sent on the next try').toHaveLength(2);
    await expect(page.locator('#strip-text')).toHaveText('All sent');
    // A 500, then success within the named backoff for that many failures in a row.
    const firstOk = tries.findIndex(x => x.ok);
    expectRetryGap(tries[firstOk - 1].t, tries[firstOk].t, firstOk, 'after the 500', 2000);
  });

  test("a check-out the office already has lands in \"Not accepted by the office\" with the server's words", async ({ page, context, request, seed }) => {
    // A paused page clock: the only tries are the queue's own, so their spacing can be measured.
    const { sam, visit, card } = await phoneOnline(page, context, request, seed, 'install');
    const in1 = waitEvent(page, 'check_in', { mode: 'install' });
    await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in');
    expect((await in1).status()).toBe(201);

    // No signal, then signal with one dropped send (the proxy failure QA saw at 866ee71): the test must survive it.
    let offline = true;
    let dropped = 0;
    const tries = [];
    await page.route('**/api/worker/events', async route => {
      const t = await pageNow(page);
      if (offline) { tries.push({ t, ok: false }); return route.abort('internetdisconnected'); }
      if (dropped === 0) { dropped += 1; tries.push({ t, ok: false }); return route.abort('connectionreset'); }
      tries.push({ t, ok: true });
      return route.continue();
    });
    await checkOut(page, card, 1);
    await expect(page.locator('#strip-text')).toHaveText(/(^|\. )1 saved on this phone\./);

    // Meanwhile the visit already got a check-out on the server (another send with its own id).
    const other = await api(request, 'POST', '/api/worker/events', { headers: { 'X-Worker-Key': sam.key },
      data: { id: randomUUID(), visit_id: visit.id, kind: 'check_out', at: iso(T + MIN), tasks: [] } });
    expect(other.status, 'the other check-out is stored').toBe(201);

    // Nothing announces a route change: the sender's own retries find the signal while the clock moves (waitEvent).
    const refused = waitEvent(page, 'check_out', { status: 409, mode: 'install' });
    offline = false;
    const words = (await (await refused).json()).error;
    expect(dropped, 'one send was dropped after signal came back').toBe(1);
    expect(tries.map(x => x.ok), 'no signal, the dropped send, then the answer').toEqual([false, false, true]);
    expectRetryGap(tries[0].t, tries[1].t, 1, 'the try after one failure');
    expectRetryGap(tries[1].t, tries[2].t, 2, 'the try after the dropped send');
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

  test("a 200 that is not the Worker's answer (a Wi-Fi login page) keeps the event queued; it then lands exactly once", async ({ page, context, request, seed }) => {
    const { visit, card } = await phoneOnline(page, context, request, seed, 'install');
    let portal = 0;
    let through = 0;
    const tries = [];
    await page.route('**/api/worker/events', async route => {
      tries.push(await pageNow(page));
      if (portal === 0) {
        portal += 1;
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Free Wi-Fi</title><p>Log in to continue.</p>' });
      }
      through += 1;
      return route.continue();
    });

    await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in');
    await expect.poll(() => portal, { message: 'the login page answered the first send' }).toBe(1);
    await expect(page.locator('#strip-text'), 'the check-in is still saved on the phone').toHaveText(/^1 saved on this phone\./);
    await expect(card.locator('.visit-status')).toHaveText(/ · saved on this phone$/);
    expect(await testEvents(request, visit.id), 'the Worker has not seen it').toHaveLength(0);

    const sent = waitEvent(page, 'check_in', { mode: 'install' });
    for (let s = 0; s < 70 && through === 0; s++) await page.clock.runFor(1000);
    expect((await sent).status(), 'the next try reaches the Worker').toBe(201);
    // After one failure the next try comes within the 5 s backoff plus one 20 s tick.
    expectRetryGap(tries[0], tries[1], 1, 'the try after the login page');
    await expect(page.locator('#strip-text')).toHaveText('All sent');
    await page.clock.runFor(61_000);
    expect(await testEvents(request, visit.id), 'exactly one check-in stored').toHaveLength(1);
    expect(through, 'sent once, not again').toBe(1);
  });

  test('a refused link takes the saved lists and drafts off the phone and keeps the queue', async ({ page, context, request, seed }) => {
    const { sam, visit, card } = await phoneOnline(page, context, request, seed);
    await page.route('**/api/worker/events', route => route.abort('internetdisconnected'));
    await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in (no signal)');
    await expect(card.locator('.visit-status')).toHaveText('Checked in 10:30 AM · saved on this phone');
    await typeInto(page, card.locator('textarea'), 'Half a note (SAMPLE)', 'note');

    const saved = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('hcv:visits:') || k.startsWith('hcv:draft:')).sort());
    const before = await saved();
    expect(before.some(k => k.startsWith('hcv:visits:')), 'a saved list is on the phone').toBe(true);
    expect(before, 'the draft is on the phone').toContain(`hcv:draft:${visit.id}`);

    const token = await officeToken(request);
    const fresh = await api(request, 'POST', `/api/office/workers/${sam.id}/new-link`, { token });
    expect(fresh.status, 'the office makes a new link').toBe(200);

    await page.reload();
    await expect(page.getByText("This link doesn't work any more. Ask the office for a new one.")).toBeVisible();
    await expect.poll(saved, { message: 'no hcv:visits or hcv:draft keys left' }).toEqual([]);
    expect(await page.content(), 'no entry notes on the page').not.toContain(visit.entry_notes);
    const queued = await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('home-care-visits');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const all = open.result.transaction('queue').objectStore('queue').getAll();
        all.onsuccess = () => resolve(all.result.map(i => `${i.event.kind}:${i.event.visit_id}`));
        all.onerror = () => reject(all.error);
      };
    }));
    expect(queued, 'the check-in is still queued').toEqual([`check_in:${visit.id}`]);
    await expect(page.locator('#strip-text')).toHaveText(/1 saved on this phone/);
  });

  test('a check-in the office already set with Fix times stays on its card: "Not accepted by the office"', async ({ page, context, request, seed }) => {
    const { visit, card } = await phoneOnline(page, context, request, seed, 'install');
    let offline = true;
    let dropped = 0;
    const tries = [];
    await page.route('**/api/worker/events', async route => {
      const t = await pageNow(page);
      if (offline) { tries.push({ t, ok: false }); return route.abort('internetdisconnected'); }
      if (dropped === 0) { dropped += 1; tries.push({ t, ok: false }); return route.abort('connectionreset'); } // one dropped send after the signal returns
      tries.push({ t, ok: true });
      return route.continue();
    });
    await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in (no signal)');
    await expect(card.locator('.visit-status')).toHaveText('Checked in 10:30 AM · saved on this phone');

    // Meanwhile the worker phoned, and the office set the check-in with Fix times.
    const token = await officeToken(request);
    const before = await officeVisit(request, token, visit.id);
    const fix = await api(request, 'PUT', `/api/office/visits/${visit.id}/times`, { token,
      data: { check_in_at: iso(T - 20 * MIN), check_out_at: null, reason: 'Worker phoned the office (SAMPLE)', version: before.version } });
    expect(fix.status, 'Fix times').toBe(200);

    const refused = waitEvent(page, 'check_in', { status: 409, mode: 'install' });
    offline = false;
    const words = (await (await refused).json()).error;
    expect(dropped, 'one send was dropped after signal came back').toBe(1);
    expect(tries.map(x => x.ok), 'no signal, the dropped send, then the answer').toEqual([false, false, true]);
    expectRetryGap(tries[0].t, tries[1].t, 1, 'the try after one failure');
    expectRetryGap(tries[1].t, tries[2].t, 2, 'the try after the dropped send');
    expect(words).toMatch(/^This visit already has a check-in at /);
    // The visit has the office's check-in, so the refused one reads as history (clarification 16).
    await expect(card.locator('.visit-status'), "the office's check-in is the visit's").toHaveText('Checked in 10:10 AM · Location not shared');
    const notice = card.locator('.visit-notice');
    await expect(notice).toContainText("An earlier check-in at 10:30 AM wasn't accepted by the office.");
    await expect(page.locator('.refused-item')).toContainText(words);
    await tap(page, notice.getByRole('button', { name: 'Dismiss' }), 'Dismiss');
    await expect(card.locator('.visit-notice')).toHaveCount(0);
  });

  test('the saved list and its Check in are on screen within 1 s when the visits request never answers', async ({ page, context, request, seed }) => {
    const { visit, card } = await phoneOnline(page, context, request, seed); // today's list is saved
    await page.route('**/api/worker/visits*', () => {}); // the request hangs: no answer, no error
    await page.reload();
    await expect(card.getByRole('button', { name: 'Check in' }), 'the saved list, without waiting for the network').toBeVisible({ timeout: 1000 });
    await expect(card.locator('.visit-name')).toHaveText(visit.client_name);
    await expect(page.locator('.notice-saved')).toHaveText('Saved list from 10:30 AM');
  });

  test('two links on one phone: a refused link clears only its own saved lists and drafts', async ({ page, context, request, seed }) => {
    const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
    const jo = byName(seed.workers, 'Jo W. (SAMPLE)');
    const firstOf = async w => (await api(request, 'GET', '/api/worker/visits', { headers: { 'X-Worker-Key': w.key } })).body.visits[0];
    const samVisit = await firstOf(sam);
    const joVisit = await firstOf(jo);
    await setNow(page, context, T);
    const draftUnder = async (worker, visit, note) => {
      await context.setGeolocation({ latitude: visit.lat, longitude: visit.lng, accuracy: 10 });
      await page.goto(pathOf(worker.worker_url));
      const card = page.locator(`.visit[data-visit="${visit.id}"]`);
      const sent = waitEvent(page, 'check_in');
      await tap(page, card.getByRole('button', { name: 'Check in' }), `Check in (${worker.name})`);
      expect((await sent).status()).toBe(201);
      await settledOnPhone(page, card, /^Checked in \d{1,2}:\d\d [AP]M · (?!saved on this phone$)/);
      await typeInto(page, card.locator('textarea'), note, 'note');
    };
    await draftUnder(jo, joVisit, "Jo's half-written note (SAMPLE)");
    await draftUnder(sam, samVisit, "Sam's half-written note (SAMPLE)");

    const stored = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
      .filter(k => k.startsWith('hcv:visits:') || k.startsWith('hcv:draft:'))
      .map(k => [k, JSON.parse(localStorage.getItem(k)).key])));
    const joKeys = [`hcv:draft:${joVisit.id}`, `hcv:visits:${jo.id}:${DAY}`].sort();
    const before = await stored();
    expect(Object.keys(before).sort()).toEqual([...joKeys, `hcv:draft:${samVisit.id}`, `hcv:visits:${sam.id}:${DAY}`].sort());
    expect(before[`hcv:draft:${joVisit.id}`], "Jo's draft is stored under Jo's link").toBe(jo.key);
    expect(before[`hcv:draft:${samVisit.id}`], "Sam's draft is stored under Sam's link").toBe(sam.key);

    const token = await officeToken(request);
    expect((await api(request, 'POST', `/api/office/workers/${sam.id}/new-link`, { token })).status).toBe(200);
    await page.reload(); // Sam's old link
    await expect(page.getByText("This link doesn't work any more. Ask the office for a new one.")).toBeVisible();
    await expect.poll(async () => Object.keys(await stored()).sort(), { message: "only Jo's list and draft are left" }).toEqual(joKeys);
  });
});

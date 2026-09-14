// The worker phone against the real Worker: Sam R.'s visits in order, Navigate, check in near the client, tasks, note and a
// check-out 47 minutes later, with the office's day API showing what the phone sent; a check-in with location denied; the note
// rules while typing; a note refused on its way out; a visit still open after midnight. Each test sets its geolocation
// permission before the page loads: WebKit keeps a page's first answer, and clearing a grant mid-page does not deny in Chromium.
import { test, expect, tap, typeInto, api, officeToken, officeVisit, oneOffVisit, byName, pathOf, setNow, waitEvent, iso,
  addDays, localToUtcMs, NOW, DAY, MIN } from './helpers.mjs';

const NOTE = 'Swept the porch. Bill was in good spirits. (SAMPLE)';
const OUT = NOW + 47 * MIN; // 11:17 AM
const CARD_WORDS = "Don't put health card numbers in this app.";

async function samsDay(page, context, request, seed) {
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  await setNow(page, context, NOW);
  const list = await api(request, 'GET', '/api/worker/visits', { headers: { 'X-Worker-Key': sam.key } });
  expect(list.status).toBe(200);
  expect(list.body.date, 'Mon Sep 14 is the day').toBe(DAY);
  return { sam, visits: list.body.visits };
}

async function checkedIn(page, context, request, seed) {
  const { sam, visits } = await samsDay(page, context, request, seed);
  const [first] = visits;
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: first.lat, longitude: first.lng, accuracy: 12 });
  await page.goto(pathOf(sam.worker_url));
  const card = page.locator(`.visit[data-visit="${first.id}"]`);
  const inR = waitEvent(page, 'check_in');
  await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in');
  expect((await inR).status(), 'check-in accepted').toBe(201);
  await expect(card.locator('.visit-status')).toHaveText('Checked in 10:30 AM · Within 250 m of the client');
  return { sam, first, card };
}

test('Sam R.: visits in order, Navigate, check in near the client, tasks and note, check out 47 minutes later', async ({ page, context, request, seed }, testInfo) => {
  const { sam, visits } = await samsDay(page, context, request, seed);
  expect(visits.length, 'Sam has visits on Monday').toBeGreaterThanOrEqual(2);
  expect(visits.map(v => v.starts_at), 'the API answers in start order').toEqual([...visits.map(v => v.starts_at)].sort());
  const [first] = visits;

  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: first.lat, longitude: first.lng, accuracy: 12 });
  await page.goto(pathOf(sam.worker_url));
  await expect(page.locator('.visit .visit-name'), 'the page shows the visits in order').toHaveText(visits.map(v => v.client_name));

  const card = page.locator(`.visit[data-visit="${first.id}"]`);
  const nav = card.getByRole('link', { name: 'Navigate' });
  const apple = testInfo.project.name === 'webkit-390'; // iPhone 14
  await expect(nav).toHaveAttribute('href', apple
    ? `https://maps.apple.com/?daddr=${first.lat},${first.lng}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${first.lat},${first.lng}`);
  await expect(nav).toHaveAttribute('target', '_blank');

  const inR = waitEvent(page, 'check_in');
  await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in');
  expect((await inR).status(), 'check-in accepted').toBe(201);
  await expect(card.locator('.visit-status')).toHaveText('Checked in 10:30 AM · Within 250 m of the client');

  const tasks = card.locator('.task');
  await expect(tasks).toHaveCount(first.tasks.length);
  const ticked = first.tasks.slice(0, 2).map(t => t.id);
  for (let i = 0; i < ticked.length; i++) {
    await tap(page, tasks.nth(i), `task ${i + 1}`);
    await expect(tasks.nth(i).locator('input')).toBeChecked();
  }
  await typeInto(page, card.locator('textarea'), NOTE, 'note');
  await expect(card.locator('.counter')).toHaveText(`${NOTE.length} / 200`);

  // 47 minutes at the client.
  await setNow(page, context, OUT);
  await tap(page, card.getByRole('button', { name: 'Check out' }), 'Check out');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Check out now?' })).toBeVisible();
  await expect(sheet).toContainText(`${ticked.length} of ${first.tasks.length} tasks ticked`);
  await expect(sheet).toContainText(NOTE);
  const outR = waitEvent(page, 'check_out');
  await tap(page, sheet.getByRole('button', { name: 'Yes, check out' }), 'Yes, check out');
  expect((await outR).status(), 'check-out accepted').toBe(201);
  await expect(card.locator('.visit-status')).toHaveText('Done 10:30 AM – 11:17 AM');

  const token = await officeToken(request);
  const v = await officeVisit(request, token, first.id, DAY, OUT);
  expect(v.check_in).toMatchObject({ kind: 'check_in', location: 'near', source: 'phone', at: iso(NOW), at_adjusted: false });
  expect(v.check_out).toMatchObject({ kind: 'check_out', source: 'phone', at: iso(OUT), at_adjusted: false });
  expect(v.worked_seconds, 'check-out minus check-in').toBe(47 * 60);
  expect(v.tasks_done).toEqual(first.tasks.map(t => ({ task_id: t.id, kind: t.kind, label: t.label, done: ticked.includes(t.id) })));
  expect(v.note).toMatchObject({ text: NOTE, shareable: false });
});

test('with location denied, Check in still checks the visit in: "Location not shared"', async ({ page, context, request, seed }) => {
  const { sam, visits } = await samsDay(page, context, request, seed);
  const [first] = visits;
  await page.goto(pathOf(sam.worker_url));
  const card = page.locator(`.visit[data-visit="${first.id}"]`);
  const inR = waitEvent(page, 'check_in', { timeout: 30_000 });
  await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in (location denied)');
  const r = await inR;
  expect(r.status(), 'check-in accepted without a location').toBe(201);
  expect(r.request().postDataJSON().location, 'no location was sent').toBeNull();
  await expect(card.locator('.visit-status')).toHaveText('Checked in 10:30 AM · Location not shared');

  const token = await officeToken(request);
  const v = await officeVisit(request, token, first.id);
  expect(v.status).toBe('checked_in');
  expect(v.check_in).toMatchObject({ kind: 'check_in', location: 'not_shared', location_label: 'Location not shared', source: 'phone' });
});

test('a visit still open after midnight shows under "Still open from yesterday" and checks out with the right hours', async ({ page, context, request, seed }) => {
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  const token = await officeToken(request);
  const visit = await oneOffVisit(request, token, { client_id: byName(seed.clients, 'Ron K. (SAMPLE)').id, worker_id: sam.id, date: DAY, start: '23:15', end: '23:55' });
  const inAt = localToUtcMs(DAY, '23:20');
  const outAt = localToUtcMs(addDays(DAY, 1), '00:20');

  await setNow(page, context, inAt);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: visit.lat, longitude: visit.lng, accuracy: 10 });
  await page.goto(pathOf(sam.worker_url));
  const card = page.locator(`.visit[data-visit="${visit.id}"]`);
  await tap(page, card.locator('.visit-head'), 'open Ron K. 11:15 PM');
  const inR = waitEvent(page, 'check_in');
  await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in 11:20 PM');
  expect((await inR).status()).toBe(201);
  await expect(card.locator('.visit-status')).toHaveText('Checked in 11:20 PM · Within 250 m of the client');
  await expect(page.locator('#strip-text')).toHaveText('All sent');

  // An hour later it is tomorrow; the phone opens the page again.
  await setNow(page, context, outAt);
  await page.reload();
  const section = page.locator('.still-open');
  await expect(section.getByRole('heading', { name: 'Still open from yesterday' })).toBeVisible();
  const open = section.locator(`.visit[data-visit="${visit.id}"]`);
  await expect(open.locator('.visit-status')).toHaveText('Checked in 11:20 PM · Within 250 m of the client');
  await tap(page, open.getByRole('button', { name: 'Check out' }), 'Check out 12:20 AM');
  const outR = waitEvent(page, 'check_out');
  await tap(page, page.getByRole('dialog').getByRole('button', { name: 'Yes, check out' }), 'Yes, check out');
  expect((await outR).status()).toBe(201);

  const v = await officeVisit(request, token, visit.id, DAY, outAt);
  expect(v.check_out).toMatchObject({ at: iso(outAt), at_adjusted: false });
  expect(v.worked_seconds, '11:20 PM to 12:20 AM').toBe(3600);
});

test.describe('with the service worker blocked', () => {
  // page.route must see the phone's event POSTs.
  test.use({ serviceWorkers: 'block' });

  test('a 12-digit number in the note disables "Yes, check out" and shows the API\'s words', async ({ page, context, request, seed }) => {
    const { card } = await checkedIn(page, context, request, seed);
    await typeInto(page, card.locator('textarea'), 'Daughter called from 709 555 0152 709 555 0153 (SAMPLE)', 'note');
    await expect(card.locator('.note-error')).toHaveText(CARD_WORDS);
    await tap(page, card.getByRole('button', { name: 'Check out' }), 'Check out');
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', { name: 'Yes, check out' })).toBeDisabled();
    await expect(sheet.locator('.note-error')).toHaveText(CARD_WORDS);

    await tap(page, sheet.getByRole('button', { name: 'Not yet' }), 'Not yet');
    await typeInto(page, card.locator('textarea'), 'Daughter called. (SAMPLE)', 'note');
    await expect(card.locator('.note-error')).toHaveText('');
    await tap(page, card.getByRole('button', { name: 'Check out' }), 'Check out');
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Yes, check out' })).toBeEnabled();
  });

  test('a note refused on its way out: the check-out lands and the card says "The note wasn\'t saved: …"', async ({ page, context, request, seed }) => {
    const { first, card } = await checkedIn(page, context, request, seed);
    await typeInto(page, card.locator('textarea'), 'A good visit. (SAMPLE)', 'note');
    // Something between the phone and the Worker rewrites the note into one the Worker refuses.
    await page.route('**/api/worker/events', route => {
      const body = route.request().postDataJSON();
      if (body.kind !== 'check_out') return route.continue();
      return route.continue({ postData: JSON.stringify({ ...body, note: 'Card 1234 5678 9012 (SAMPLE)' }) });
    });
    await setNow(page, context, NOW + 45 * MIN);
    await tap(page, card.getByRole('button', { name: 'Check out' }), 'Check out');
    const outR = waitEvent(page, 'check_out');
    await tap(page, page.getByRole('dialog').getByRole('button', { name: 'Yes, check out' }), 'Yes, check out');
    const res = await outR;
    expect(res.status(), 'the check-out itself is stored').toBe(201);
    const body = await res.json();
    expect(body.note_refused, 'the Worker refused only the note').toBe(CARD_WORDS);

    const notice = card.locator('.visit-notice');
    await expect(notice).toContainText(`Checked out. The note wasn't saved: ${body.note_refused}`);
    await expect(card.locator('.visit-status')).toHaveText('Done 10:30 AM – 11:15 AM');

    const token = await officeToken(request);
    const v = await officeVisit(request, token, first.id, DAY, NOW + 45 * MIN);
    expect(v.worked_seconds, 'the hours are kept').toBe(45 * 60);
    expect(v.note).toBeNull();

    await tap(page, notice.getByRole('button', { name: 'OK' }), 'OK');
    await expect(card.locator('.visit-notice')).toHaveCount(0);
  });
});

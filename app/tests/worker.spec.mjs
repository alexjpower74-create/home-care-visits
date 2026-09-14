// The worker phone against the real Worker: Sam R.'s visits in order, Navigate, check in near the client, tasks, note and
// check-out, with the office's day API showing what the phone sent; and, in its own context, a check-in with location denied
// that still lands. Each test sets its geolocation permission before the page loads: WebKit keeps a page's first answer
// (a grant made after a denial is ignored), and clearing a grant mid-page does not deny in Chromium.
import { test, expect, tap, typeInto, api, officeToken, officeVisit, byName, pathOf, setNow, waitEvent, NOW, DAY } from './helpers.mjs';

const NOTE = 'Swept the porch. Bill was in good spirits. (SAMPLE)';

async function samsDay(page, context, request, seed) {
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  await setNow(page, context, NOW);
  const list = await api(request, 'GET', '/api/worker/visits', { headers: { 'X-Worker-Key': sam.key } });
  expect(list.status).toBe(200);
  expect(list.body.date, 'Mon Sep 14 is the day').toBe(DAY);
  return { sam, visits: list.body.visits };
}

test('Sam R.: visits in order, Navigate, check in near the client, tasks and note, check out', async ({ page, context, request, seed }, testInfo) => {
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
  await tap(page, card.getByRole('button', { name: 'Check out' }), 'Check out');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Check out now?' })).toBeVisible();
  await expect(sheet).toContainText(`${ticked.length} of ${first.tasks.length} tasks ticked`);
  await expect(sheet).toContainText(NOTE);
  const outR = waitEvent(page, 'check_out');
  await tap(page, sheet.getByRole('button', { name: 'Yes, check out' }), 'Yes, check out');
  expect((await outR).status(), 'check-out accepted').toBe(201);
  await expect(card.locator('.visit-status')).toHaveText('Done 10:30 AM – 10:30 AM');

  const token = await officeToken(request);
  const v = await officeVisit(request, token, first.id);
  expect(v.check_in).toMatchObject({ kind: 'check_in', location: 'near', source: 'phone', at: new Date(NOW).toISOString() });
  expect(v.check_out).toMatchObject({ kind: 'check_out', source: 'phone' });
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

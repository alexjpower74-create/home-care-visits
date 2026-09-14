// The worker phone against the real Worker: Sam R.'s visits in order, Navigate, check in near, tasks, note, check out, and a
// check-in with location denied that still lands. The office's day API then shows what the phone sent.
import { test, expect, tap, typeInto, api, officeToken, officeVisit, byName, pathOf, setNow, waitEvent, NOW, DAY } from './helpers.mjs';

const NOTE = 'Swept the porch. Bill was in good spirits. (SAMPLE)';

test('Sam R.: visits in order, Navigate, check in near, tasks and note, check out; a denied location still checks in', async ({ page, context, request, seed }, testInfo) => {
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  await setNow(page, context, NOW);
  const list = await api(request, 'GET', '/api/worker/visits', { headers: { 'X-Worker-Key': sam.key } });
  expect(list.status).toBe(200);
  const visits = list.body.visits;
  expect(list.body.date, 'Mon Sep 14 is the day').toBe(DAY);
  expect(visits.length, 'Sam has visits on Monday').toBeGreaterThanOrEqual(2);
  expect(visits.map(v => v.starts_at), 'the API answers in start order').toEqual([...visits.map(v => v.starts_at)].sort());
  const [first, second] = visits;

  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: first.lat, longitude: first.lng, accuracy: 12 });
  await page.goto(pathOf(sam.worker_url));
  await expect(page.locator('.visit .visit-name'), 'the page shows the visits in order').toHaveText(visits.map(v => v.client_name));

  const card1 = page.locator(`.visit[data-visit="${first.id}"]`);
  const nav = card1.getByRole('link', { name: 'Navigate' });
  const apple = testInfo.project.name === 'webkit-390'; // iPhone 14
  await expect(nav).toHaveAttribute('href', apple
    ? `https://maps.apple.com/?daddr=${first.lat},${first.lng}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${first.lat},${first.lng}`);
  await expect(nav).toHaveAttribute('target', '_blank');

  // Check in at the client's pin.
  const in1 = waitEvent(page, 'check_in');
  await tap(page, card1.getByRole('button', { name: 'Check in' }), 'Check in');
  expect((await in1).status(), 'check-in accepted').toBe(201);
  await expect(card1.locator('.visit-status')).toHaveText('Checked in 10:30 AM · Within 250 m of the client');

  // Tick tasks, write the note, check out.
  const tasks = card1.locator('.task');
  await expect(tasks).toHaveCount(first.tasks.length);
  const ticked = first.tasks.slice(0, 2).map(t => t.id);
  for (let i = 0; i < ticked.length; i++) {
    await tap(page, tasks.nth(i), `task ${i + 1}`);
    await expect(tasks.nth(i).locator('input')).toBeChecked();
  }
  await typeInto(page, card1.locator('textarea'), NOTE, 'note');
  await expect(card1.locator('.counter')).toHaveText(`${NOTE.length} / 200`);
  await tap(page, card1.getByRole('button', { name: 'Check out' }), 'Check out');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Check out now?' })).toBeVisible();
  await expect(sheet).toContainText(`${ticked.length} of ${first.tasks.length} tasks ticked`);
  await expect(sheet).toContainText(NOTE);
  const out1 = waitEvent(page, 'check_out');
  await tap(page, sheet.getByRole('button', { name: 'Yes, check out' }), 'Yes, check out');
  expect((await out1).status(), 'check-out accepted').toBe(201);
  await expect(card1.locator('.visit-status')).toHaveText('Done 10:30 AM – 10:30 AM');

  // Location denied: the next visit still checks in.
  await context.clearPermissions();
  const card2 = page.locator(`.visit[data-visit="${second.id}"]`);
  await expect(card2.getByRole('button', { name: 'Check in' }), 'the next visit opens').toBeVisible();
  const in2 = waitEvent(page, 'check_in', { timeout: 30_000 });
  await tap(page, card2.getByRole('button', { name: 'Check in' }), 'Check in (location denied)');
  const r2 = await in2;
  expect(r2.status()).toBe(201);
  expect(r2.request().postDataJSON().location, 'no location was sent').toBeNull();
  await expect(card2.locator('.visit-status')).toHaveText('Checked in 10:30 AM · Location not shared');

  // What the office sees.
  const token = await officeToken(request);
  const v1 = await officeVisit(request, token, first.id);
  expect(v1.check_in).toMatchObject({ kind: 'check_in', location: 'near', source: 'phone', at: new Date(NOW).toISOString() });
  expect(v1.check_out).toMatchObject({ kind: 'check_out', source: 'phone' });
  expect(v1.tasks_done).toEqual(first.tasks.map(t => ({ task_id: t.id, kind: t.kind, label: t.label, done: ticked.includes(t.id) })));
  expect(v1.note).toMatchObject({ text: NOTE, shareable: false });
  const v2 = await officeVisit(request, token, second.id);
  expect(v2.status).toBe('checked_in');
  expect(v2.check_in.location).toBe('not_shared');
});

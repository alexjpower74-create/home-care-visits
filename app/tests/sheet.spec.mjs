// Fix times in the edit sheet (clarification 17): no silent next day, and a time in the spring-forward gap is never sent.
import { test, expect, tap, typeInto, signIn, api, officeToken, oneOffVisit, officeVisit, testEvents, byName, setNow, randomUUID, iso,
  localToUtcMs, addDays, DAY } from './helpers.mjs';

const REASON = 'Worker phoned the office the next morning (SAMPLE)';

test('a check-out typed earlier than the check-in is refused unless "The check-out was after midnight" is ticked', async ({ page, context, request, seed }) => {
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  const token = await officeToken(request);
  const visit = await oneOffVisit(request, token, { client_id: byName(seed.clients, 'Ron K. (SAMPLE)').id, worker_id: sam.id, date: DAY, start: '18:00', end: '20:00' });
  const inAt = localToUtcMs(DAY, '18:02');
  const checkIn = await api(request, 'POST', '/api/worker/events', { headers: { 'X-Worker-Key': sam.key }, now: inAt,
    data: { id: randomUUID(), visit_id: visit.id, kind: 'check_in', at: iso(inAt), location: null } });
  expect(checkIn.status).toBe(201);

  await setNow(page, context, localToUtcMs(DAY, '20:30'));
  await signIn(page);
  await tap(page, page.locator(`.board-row[data-visit-id="${visit.id}"] .row-client`), 'Ron K. 6:00 PM');
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('#vs-overnight-row'), 'no checkbox before a check-out is typed').toBeHidden();
  await sheet.locator('#vs-fix-out').fill('08:00');
  await expect(sheet.locator('#vs-overnight-row')).toBeVisible();
  await expect(sheet.locator('#vs-fix-overnight')).not.toBeChecked();
  await typeInto(page, sheet.locator('#vs-fix-reason'), REASON, 'reason');

  // Not ticked: sent on the visit's date, and the Worker refuses it.
  const first = page.waitForResponse(r => r.url().endsWith(`/api/office/visits/${visit.id}/times`) && r.request().method() === 'PUT');
  await tap(page, sheet.getByRole('button', { name: 'Fix times' }), 'Fix times');
  const refused = await first;
  expect(refused.status()).toBe(400);
  expect(refused.request().postDataJSON().check_out_at, "sent on the visit's own date").toBe(iso(localToUtcMs(DAY, '08:00')));
  await expect(sheet.locator('[data-error-for="check_out_at"]')).toHaveText('Check-out has to be after check-in.');
  expect((await officeVisit(request, token, visit.id)).check_out, 'nothing stored').toBeNull();
  expect((await testEvents(request, visit.id)).filter(e => e.kind === 'check_out')).toHaveLength(0);

  // Ticked: the next day.
  await tap(page, sheet.locator('#vs-overnight-row'), 'The check-out was after midnight');
  await expect(sheet.locator('#vs-fix-overnight')).toBeChecked();
  const second = page.waitForResponse(r => r.url().endsWith(`/api/office/visits/${visit.id}/times`) && r.request().method() === 'PUT');
  await tap(page, sheet.getByRole('button', { name: 'Fix times' }), 'Fix times');
  const stored = await second;
  expect(stored.status()).toBe(200);
  const body = await stored.json();
  expect(body.check_out.at, '8:00 AM the next day').toBe(iso(localToUtcMs(addDays(DAY, 1), '08:00')));
  expect(body.worked_seconds, '6:02 PM to 8:00 AM').toBe(13 * 3600 + 58 * 60);
});

test('a fix time in the spring-forward gap shows the words and is not sent', async ({ page, context, request, seed }) => {
  const GAP_DAY = '2026-03-08'; // clocks go from 2:00 to 3:00 AM in Newfoundland
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  const token = await officeToken(request);
  const visit = await oneOffVisit(request, token, { client_id: byName(seed.clients, 'Ron K. (SAMPLE)').id, worker_id: sam.id, date: GAP_DAY, start: '01:00', end: '04:00' });

  await setNow(page, context, localToUtcMs(GAP_DAY, '05:00'));
  await signIn(page);
  let puts = 0;
  page.on('request', r => { if (r.method() === 'PUT' && r.url().endsWith(`/api/office/visits/${visit.id}/times`)) puts += 1; });
  await tap(page, page.locator(`.board-row[data-visit-id="${visit.id}"] .row-client`), 'Ron K. 1:00 AM');
  const sheet = page.getByRole('dialog');
  await sheet.locator('#vs-fix-in').fill('02:30');
  await typeInto(page, sheet.locator('#vs-fix-reason'), 'Worker phoned (SAMPLE)', 'reason');
  await tap(page, sheet.getByRole('button', { name: 'Fix times' }), 'Fix times');
  await expect(sheet.locator('[data-error-for="check_in_at"]')).toHaveText("That time doesn't exist on the day the clocks change.");
  await page.waitForTimeout(1000); // room for a request that should not be made
  expect(puts, 'nothing was sent').toBe(0);
  expect((await officeVisit(request, token, visit.id, GAP_DAY)).check_in).toBeNull();
});

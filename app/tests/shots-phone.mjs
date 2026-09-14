// Viewport screenshots of the phone screens changed in M3b: an earlier-day "Still open from Sat Sep 12" section, and the
// check-out sheet with "Check out without the note". Each waits for what the picture must show.
import { fileURLToPath } from 'node:url';
import { test, expect, tap, typeInto, api, byName, pathOf, setNow, waitEvent, localToUtcMs, addDays, NOW, DAY } from './helpers.mjs';

const OUT = fileURLToPath(new URL('./shots/', import.meta.url));

test('phone: an earlier-day section, and "Check out without the note"', async ({ page, context, request, seed }, testInfo) => {
  const shot = name => page.screenshot({ path: `${OUT}phone-${name}-${testInfo.project.name}.png` });
  const terry = byName(seed.workers, 'Terry O. (SAMPLE)');
  const sat = addDays(DAY, -2);
  const george = (await api(request, 'GET', `/api/worker/visits?date=${sat}`, { headers: { 'X-Worker-Key': terry.key } })).body.visits
    .find(v => v.client_name === 'George N. (SAMPLE)');
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: george.lat, longitude: george.lng, accuracy: 10 });

  // Saturday: Terry checks in at George N.'s.
  await setNow(page, context, localToUtcMs(sat, '09:05'));
  await page.goto(pathOf(terry.worker_url));
  const card = page.locator(`.visit[data-visit="${george.id}"]`);
  const sent = waitEvent(page, 'check_in');
  await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in');
  expect((await sent).status()).toBe(201);
  await expect(card.locator('.visit-status')).toHaveText('Checked in 9:05 AM · Within 250 m of the client');

  // Monday: the visit is still open.
  await setNow(page, context, NOW);
  await page.reload();
  const section = page.locator('.still-open');
  await expect(section.getByRole('heading', { name: 'Still open from Sat Sep 12' })).toBeVisible();
  await shot('still-open-earlier-day');

  // The note breaks a rule: the sheet offers "Check out without the note".
  const open = section.locator(`.visit[data-visit="${george.id}"]`);
  await typeInto(page, open.locator('textarea'), 'Son called from 709 555 0161 709 555 0162 (SAMPLE)', 'note');
  await tap(page, open.getByRole('button', { name: 'Check out' }), 'Check out');
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: 'Yes, check out' })).toBeDisabled();
  await expect(sheet.getByRole('button', { name: 'Check out without the note' })).toBeVisible();
  await shot('checkout-without-note');
});

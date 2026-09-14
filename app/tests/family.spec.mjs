// The family link after a real worker journey: arrived/left and the ticked tasks; the note stays off the page until the office
// marks it shareable in the edit sheet; a bad link shows the plain message.
import { test, expect, tap, typeInto, byName, pathOf, setNow, signIn, waitEvent, NOW, MIN } from './helpers.mjs';

const NOTE = 'Bill had a good morning and asked about the garden. (SAMPLE)';

test('family link: arrived and left with ticked tasks; the note appears only once the office shares it', async ({ page, context, seed }) => {
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  const bill = byName(seed.clients, 'Bill S. (SAMPLE)');
  await setNow(page, context, NOW);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 49.0187, longitude: -55.48578, accuracy: 10 });

  // Sam's first Monday visit is Bill S. at 9:00.
  await page.goto(pathOf(sam.worker_url));
  const card = page.locator('.visit', { hasText: 'Bill S. (SAMPLE)' });
  const visitId = Number(await card.getAttribute('data-visit'));
  const inR = waitEvent(page, 'check_in');
  await tap(page, card.getByRole('button', { name: 'Check in' }), 'Check in');
  expect((await inR).status()).toBe(201);
  const tasks = card.locator('.task');
  const labels = [];
  for (let i = 0; i < 2; i++) {
    await tap(page, tasks.nth(i), `task ${i + 1}`);
    labels.push((await tasks.nth(i).locator('.task-label').textContent()).trim());
  }
  await typeInto(page, card.locator('textarea'), NOTE, 'note');
  await setNow(page, context, NOW + 47 * MIN); // 47 minutes at the client
  await tap(page, card.getByRole('button', { name: 'Check out' }), 'Check out');
  const outR = waitEvent(page, 'check_out');
  await tap(page, page.getByRole('dialog').getByRole('button', { name: 'Yes, check out' }), 'Yes, check out');
  expect((await outR).status()).toBe(201);

  // The family page.
  await page.goto(pathOf(bill.family_url));
  await expect(page.getByRole('heading', { name: 'Visits for Bill S. (SAMPLE)' })).toBeVisible();
  const today = page.locator('.fam-card[data-status="left"]');
  await expect(today.locator('.fam-status'), 'arrived and left are different times').toHaveText('Arrived 10:30 AM, left 11:17 AM');
  await expect(today.locator('.ticks li')).toHaveText(labels);
  await expect(page.getByText(NOTE), 'the note is not on the page').toHaveCount(0);
  expect(await page.content(), 'the note is nowhere in the page').not.toContain(NOTE);

  // The office marks it shareable with real taps in the edit sheet.
  await signIn(page);
  await tap(page, page.locator(`.board-row[data-visit-id="${visitId}"] .row-client`), 'Bill S. on the board');
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('.quote')).toHaveText(NOTE);
  const share = sheet.locator('label.check', { hasText: 'Family can see this note' });
  const put = page.waitForResponse(r => r.url().endsWith(`/api/office/visits/${visitId}/note`) && r.request().method() === 'PUT');
  await tap(page, share, 'Family can see this note');
  expect((await put).status()).toBe(200);
  await expect(page.getByRole('dialog').locator('#vs-share')).toBeChecked();

  await page.goto(pathOf(bill.family_url));
  await expect(page.locator('.fam-card[data-status="left"] .quote')).toHaveText(NOTE);

  // A bad link.
  await page.goto('/f/?k=this-is-not-a-family-key');
  await expect(page.getByText("This link doesn't work. Ask the agency for a new one.")).toBeVisible();
  await expect(page.locator('.fam-card')).toHaveCount(0);
});

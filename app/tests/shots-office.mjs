// Viewport screenshots of every office screen on the real Worker, with the demo scenario (a lived-in week relative to NOW):
// Today (late and missed rows), the visit sheet with its times, Week with a conflict, Clients and a client form, Workers and a
// worker form with the New link confirm, the four reports, Settings. Each waits for what the picture must show.
// Run: npx playwright test -c playwright.shots.config.mjs
import { fileURLToPath } from 'node:url';
import { test, expect, tap, tab, signIn, setNow, api, NOW, DAY, addDays } from './helpers.mjs';

const OUT = fileURLToPath(new URL('./shots/', import.meta.url));

test('office: every screen', async ({ page, context, request }, testInfo) => {
  test.setTimeout(180_000);
  const wide = testInfo.project.name.endsWith('1280');
  const shot = name => page.screenshot({ path: `${OUT}office-${name}-${testInfo.project.name}.png` });
  const top = locator => locator.evaluate(el => el.scrollIntoView({ block: 'start' }));
  expect((await api(request, 'POST', '/api/test/seed', { data: { scenario: 'demo' } })).status, 'demo seeded').toBe(200);
  await setNow(page, context, NOW);
  await signIn(page);

  // Today: the demo always has one late and one missed visit.
  const alert = page.locator('.board-row[data-alert="missed"], .board-row[data-alert="late"]').first();
  await expect(page.locator('.board-row[data-alert="late"]').first()).toBeVisible();
  await expect(page.locator('.board-row[data-alert="missed"]').first()).toBeVisible();
  if (!wide) await top(alert);
  await shot('today');

  // The visit sheet of a finished visit, at its Times section.
  const done = page.locator('.board-row[data-status="checked_out"] .row-client').first();
  await tap(page, done, 'a finished visit');
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('#vs-times-now')).toContainText('Check-out:');
  await top(sheet.locator('#vs-times-now'));
  await shot('visit-sheet');
  await tap(page, sheet.getByRole('button', { name: 'Close' }), 'Close');

  // Week with a conflict.
  await tab(page, 'Week');
  await expect(page.locator('.conflict').first()).toBeVisible();
  if (wide) {
    await expect(page.locator('.chip[data-conflict]').first()).toBeVisible();
    await top(page.locator('.conflicts'));
  } else {
    await tap(page, page.locator(`.day-tab[data-day="${addDays(DAY, 5)}"]`), 'Sat tab');
    await expect(page.locator('.vcard[data-conflict="problem"]').first()).toBeVisible();
    await top(page.locator('.day-tabs'));
  }
  await shot('week-conflict');

  // Clients and a client form.
  await tab(page, 'Clients');
  await expect(page.locator('#client-list .entity').first()).toBeVisible();
  await shot('clients');
  await tap(page, page.locator('#client-list .entity', { hasText: 'Walter G. (SAMPLE)' }), 'Walter G.');
  await expect(page.locator('#cf-name')).toHaveValue('Walter G. (SAMPLE)');
  await top(page.locator('.view-head h1'));
  await shot('client-form');

  // Workers and a worker form with the New link confirm open.
  await tab(page, 'Workers');
  await expect(page.locator('#worker-list .entity').first()).toBeVisible();
  await shot('workers');
  await tap(page, page.locator('#worker-list .entity', { hasText: 'Sam R. (SAMPLE)' }), 'Sam R.');
  await tap(page, page.getByRole('button', { name: 'New link', exact: true }), 'New link');
  await expect(page.locator('#link-confirm')).toBeVisible();
  await top(page.locator('.link-block'));
  await shot('worker-form-new-link');
  await tap(page, page.getByRole('button', { name: 'Keep the old link' }), 'Keep the old link');

  // Reports over the last 14 days.
  await tab(page, 'Reports');
  await tap(page, page.getByRole('button', { name: 'Last 14 days' }), 'Last 14 days');
  await expect(page.locator('#payroll-table')).toBeVisible();
  await shot('report-payroll');
  for (const [tabName, ready, name] of [['Billing', '#billing-table', 'report-billing'], ['Missed and late', '#missed-table', 'report-missed'], ['Mileage', '.mileage-day', 'report-mileage']]) {
    await tap(page, page.getByRole('tab', { name: tabName }), tabName);
    await expect(page.locator(ready).first()).toBeVisible();
    await shot(name);
  }

  // Settings.
  await tab(page, 'Settings');
  await expect(page.locator('#st-name')).toBeVisible();
  await shot('settings');
});

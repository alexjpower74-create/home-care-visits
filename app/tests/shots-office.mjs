// Viewport screenshots of the office on the real Worker: the Today board with a late and a missed row, the Week planner with
// a conflict, and a client form. Each waits for what the picture must show. Run: npx playwright test -c playwright.shots.config.mjs
import { fileURLToPath } from 'node:url';
import { test, expect, tap, tab, signIn, localToUtcMs, NOW, DAY, addDays } from './helpers.mjs';

const OUT = fileURLToPath(new URL('./shots/', import.meta.url));
const shot = (page, testInfo, name) => page.screenshot({ path: `${OUT}${name}-${testInfo.project.name}.png` });

test('office: Today board with late and missed rows, Week with a conflict, a client form', async ({ page, context }, testInfo) => {
  const at = localToUtcMs(DAY, '09:20'); // Bill S. (9:00) is late, Margaret P. (8:30) is missed
  await context.setExtraHTTPHeaders({ 'X-Test-Now': new Date(at).toISOString() });
  await page.clock.setFixedTime(at);
  await signIn(page);
  const missed = page.locator('.board-row[data-alert="missed"]').first();
  await expect(page.locator('.board-row[data-alert="late"]').first()).toBeVisible();
  await expect(missed).toContainText('Missed: not checked in 30 minutes after the start');
  if (!testInfo.project.name.endsWith('1280')) await missed.evaluate(el => el.scrollIntoView({ block: 'start' }));
  await shot(page, testInfo, 'office-today');

  await context.setExtraHTTPHeaders({ 'X-Test-Now': new Date(NOW).toISOString() });
  await page.clock.setFixedTime(NOW);
  await tab(page, 'Week');
  await expect(page.locator('.conflict[data-kind="travel_gap"]').first()).toBeVisible();
  if (testInfo.project.name.endsWith('1280')) {
    await expect(page.locator('.chip[data-conflict="problem"]').first()).toBeVisible();
    await page.locator('.conflicts').evaluate(el => el.scrollIntoView({ block: 'start' }));
  } else {
    await tap(page, page.locator(`.day-tab[data-day="${addDays(DAY, 5)}"]`), 'Sat tab');
    await expect(page.locator('.vcard[data-conflict="problem"]').first()).toBeVisible();
    await page.locator('.day-tabs').evaluate(el => el.scrollIntoView({ block: 'start' }));
  }
  await shot(page, testInfo, 'office-week-conflict');

  await tab(page, 'Clients');
  await expect(page.locator('#client-list .entity')).toHaveCount(12);
  await tap(page, page.locator('#client-list .entity', { hasText: 'Walter G. (SAMPLE)' }), 'Walter G.');
  await expect(page.locator('#cf-name')).toHaveValue('Walter G. (SAMPLE)');
  await expect(page.locator('.warn')).toBeVisible();
  await page.locator('.view-head h1').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await shot(page, testInfo, 'office-client-form');
});

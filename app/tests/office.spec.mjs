// The office on M1 routes: sign-in refusals, adding a client with the map pin, the medication wording guard, adding a worker.
import { test, expect, tap, tapAt, typeInto, mapPoint, tab, signIn, setNow, NOW, DAY, addDays } from './helpers.mjs';

test('a wrong PIN says "That PIN is not right." and the sign-in answers 401', async ({ page, context }) => {
  await setNow(page, context, NOW);
  await page.goto('/office/');
  await typeInto(page, page.locator('#pin'), '0000', 'PIN');
  const resp = page.waitForResponse(r => r.url().endsWith('/api/office/signin'));
  await tap(page, page.locator('#signin-btn'), 'Sign in');
  expect((await resp).status()).toBe(401);
  await expect(page.locator('#pin-error')).toHaveText('That PIN is not right.');
  await expect(page.locator('#signout')).toBeHidden();
});

async function newClient(page, name, { task }) {
  await tab(page, 'Clients');
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
  await expect(page.locator('.leaflet-control-attribution')).toBeVisible();
  await tap(page, page.getByRole('button', { name: 'Add client' }), 'Add client');
  await typeInto(page, page.locator('#cf-name'), name, 'name');
  await typeInto(page, page.locator('#cf-address'), 'Peterview, NL (SAMPLE: no street address)', 'address');
  await page.locator('#cf-zone').selectOption({ label: 'Botwood, Peterview & Northern Arm' });
  await page.locator('#cf-funder').selectOption({ label: 'Private pay (SAMPLE)' });
  const map = page.locator('#cl-map');
  const { fx, fy } = await mapPoint(page, map);
  await tapAt(page, map, fx, fy, 'the map');
  await expect(page.locator('#cf-pin')).toHaveText(/^Pin at 4\d\.\d{5}, -5\d\.\d{5}\. /);
  const row = page.locator('#cf-task-rows [data-row="task"]').first();
  await row.locator('[data-f="kind"]').selectOption(task.kind);
  await typeInto(page, row.locator('[data-f="detail"]'), task.detail, 'task detail');
}

test('add a client by typing and clicking the map, with a task and a Mon/Wed pattern: in the list, on the map, in the week', async ({ page, context }, testInfo) => {
  const name = 'Nora B. (SAMPLE)';
  await setNow(page, context, NOW);
  await signIn(page);
  await newClient(page, name, { task: { kind: 'meal_prep', detail: 'Lunch, soft foods' } });

  await tap(page, page.getByRole('button', { name: 'Add visit times' }), 'Add visit times');
  const pattern = page.locator('#cf-pattern-rows [data-row="pattern"]').first();
  for (const d of ['Mon', 'Wed']) await tap(page, pattern.locator('.day-toggle', { hasText: d }), d);
  await expect(pattern.locator('[data-day="1"]')).toBeChecked();
  await expect(pattern.locator('[data-day="3"]')).toBeChecked();
  await pattern.locator('[data-f="start"]').fill('13:00');
  await pattern.locator('[data-f="end"]').fill('14:00');
  await pattern.locator('[data-f="worker_id"]').selectOption({ label: 'Alex B. (SAMPLE)' });

  const post = page.waitForResponse(r => r.url().endsWith('/api/office/clients') && r.request().method() === 'POST');
  await tap(page, page.getByRole('button', { name: 'Save client' }), 'Save client');
  expect((await post).status()).toBe(201);
  await expect(page.locator('#client-list .entity-name', { hasText: name })).toBeVisible();
  await expect(page.locator(`.leaflet-marker-icon[title="${name}"]`), 'on the map').toBeAttached();

  await tab(page, 'Week');
  if (testInfo.project.name.endsWith('1280')) {
    for (const date of [DAY, addDays(DAY, 2)]) {
      await expect(page.locator(`.cell[data-date="${date}"] .chip`, { hasText: name }), `a chip on ${date}`).toHaveCount(1);
    }
  } else {
    for (const date of [DAY, addDays(DAY, 2)]) {
      await tap(page, page.locator(`.day-tab[data-day="${date}"]`), `day ${date}`);
      await expect(page.locator('.vcard', { hasText: name }), `a visit on ${date}`).toHaveCount(1);
    }
  }
});

test('a task "Give her pills" shows the medication message by the tasks field', async ({ page, context }) => {
  await setNow(page, context, NOW);
  await signIn(page);
  await newClient(page, 'Olive P. (SAMPLE)', { task: { kind: 'other', detail: 'Give her pills' } });
  const post = page.waitForResponse(r => r.url().endsWith('/api/office/clients') && r.request().method() === 'POST');
  await tap(page, page.getByRole('button', { name: 'Save client' }), 'Save client');
  expect((await post).status()).toBe(400);
  await expect(page.locator('[data-error-for="tasks"]')).toHaveText('This app records medication reminders only, not medication given. Reword this task.');
});

test('add a worker', async ({ page, context }) => {
  const name = 'Dana K. (SAMPLE)';
  await setNow(page, context, NOW);
  await signIn(page);
  await tab(page, 'Workers');
  await tap(page, page.getByRole('button', { name: 'Add worker' }), 'Add worker');
  await typeInto(page, page.locator('#wf-name'), name, 'name');
  await typeInto(page, page.locator('#wf-phone'), '709-555-0199', 'phone');
  await tap(page, page.locator('label.check', { hasText: 'Grand Falls-Windsor' }), 'Grand Falls-Windsor zone');
  const post = page.waitForResponse(r => r.url().endsWith('/api/office/workers') && r.request().method() === 'POST');
  await tap(page, page.getByRole('button', { name: 'Save worker' }), 'Save worker');
  expect((await post).status()).toBe(201);
  await expect(page.locator('#worker-list .entity', { hasText: name })).toContainText('709-555-0199');
});

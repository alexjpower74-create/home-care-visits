// The office: sign-in refusals and sign-out, adding a client with the map pin (its visits on Alex B.'s row), the medication
// wording guard, adding a worker with ticked availability, and a deactivated worker who stays reachable (clarification 15).
import { test, expect, tap, tapAt, typeInto, mapPoint, hitTest, intoView, tab, signIn, setNow, api, officeToken, oneOffVisit, byName, NOW, DAY, addDays } from './helpers.mjs';

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

test("Sign out that can't reach the office says the session is still open there", async ({ page, context }) => {
  await setNow(page, context, NOW);
  await signIn(page);
  await page.route('**/api/office/signout', route => route.abort('internetdisconnected'));
  await tap(page, page.locator('#signout'), 'Sign out');
  await expect(page.getByText("Signed out on this computer. The session couldn't be closed at the office. Sign in and out again when the connection is back.")).toBeVisible();
  await expect(page.locator('#pin')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('hcv:office-token')), 'the token is gone from this computer').toBeNull();
});

test('Sign out after the session already ended at the office says "Signed out."', async ({ page, context, request }) => {
  await setNow(page, context, NOW);
  await signIn(page);
  const token = await page.evaluate(() => localStorage.getItem('hcv:office-token'));
  expect((await api(request, 'POST', '/api/office/signout', { token })).status, 'the session ends elsewhere').toBe(200);
  const res = page.waitForResponse(r => r.url().endsWith('/api/office/signout'));
  await tap(page, page.locator('#signout'), 'Sign out');
  expect((await res).status()).toBe(401);
  await expect(page.getByText('Signed out.', { exact: true })).toBeVisible();
  await expect(page.getByText("The session couldn't be closed at the office", { exact: false })).toHaveCount(0);
  await expect(page.locator('#pin')).toBeVisible();
});

async function newClient(page, name, { task }) {
  await tab(page, 'Clients');
  await expect(page.locator('.leaflet-control-attribution')).toHaveText('OpenFreeMap © OpenMapTiles Data from OpenStreetMap');
  await expect(page.locator('.leaflet-control-attribution')).toBeVisible();
  await expect(page.locator('#client-list .entity'), 'the client list has loaded').toHaveCount(12);
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

test('add a client by typing and clicking the map, with a task and a Mon/Wed pattern: in the list, on the map, on Alex B.\'s row', async ({ page, context, seed }, testInfo) => {
  const name = 'Nora B. (SAMPLE)';
  const alex = byName(seed.workers, 'Alex B. (SAMPLE)');
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
  const saved = await post;
  expect(saved.status()).toBe(201);
  expect((await saved.json()).patterns[0], 'the pattern as stored').toMatchObject({ days: [1, 3], start: '13:00', end: '14:00', worker_id: alex.id });
  await expect(page.locator('#client-list .entity-name', { hasText: name })).toBeVisible();
  await expect(page.locator(`.leaflet-marker-icon[title="${name}"]`), 'on the map').toBeAttached();

  await tab(page, 'Week');
  for (const date of [DAY, addDays(DAY, 2)]) {
    if (testInfo.project.name.endsWith('1280')) {
      await expect(page.locator(`.cell[data-worker-id="${alex.id}"][data-date="${date}"] .chip`, { hasText: name }), `a chip on Alex B.'s row on ${date}`).toHaveCount(1);
      await expect(page.locator(`.cell[data-worker-id="none"] .chip`, { hasText: name })).toHaveCount(0);
    } else {
      await tap(page, page.locator(`.day-tab[data-day="${date}"]`), `day ${date}`);
      await expect(page.locator(`.wgroup[data-worker-id="${alex.id}"] .vcard`, { hasText: name }), `a visit under Alex B. on ${date}`).toHaveCount(1);
    }
  }
});

test('the Clients map: the OpenFreeMap attribution and its three links, a pin placed by clicking, only the routed tiles leave 127.0.0.1', async ({ page, context, guarded }, testInfo) => {
  await setNow(page, context, NOW);
  await signIn(page);
  await tab(page, 'Clients');
  const map = page.locator('#cl-map');
  await expect(map).toHaveAttribute('data-base', /^(maplibre|plain)$/);
  const base = await map.getAttribute('data-base');
  console.log(`[map] ${testInfo.project.name}: ${base === 'maplibre' ? 'MapLibre with WebGL' : 'the plain background (no WebGL)'}`);
  testInfo.annotations.push({ type: 'map base', description: base });
  if (base === 'maplibre') {
    await expect(map.locator('canvas.maplibregl-canvas')).toBeAttached();
    await expect.poll(() => [...new Set(guarded.tiles)].filter(t => !t.endsWith('.pbf')).sort(), { message: 'the style and its TileJSON came from the routed fixtures' })
      .toEqual(['/planet', '/styles/liberty']);
  }

  const attribution = map.locator('.leaflet-control-attribution');
  await expect(attribution).toHaveText('OpenFreeMap © OpenMapTiles Data from OpenStreetMap');
  for (const [name, href] of [['OpenFreeMap', 'https://openfreemap.org'], ['© OpenMapTiles', 'https://www.openmaptiles.org/'], ['OpenStreetMap', 'https://www.openstreetmap.org/copyright']]) {
    const link = attribution.getByRole('link', { name, exact: true });
    await expect(link, `${name}: visible`).toBeVisible();
    await expect(link).toHaveAttribute('href', href);
    await intoView(page, link);
    const { x, y, hit } = await hitTest(link);
    expect(hit, `${name} hit-test at ${Math.round(x)},${Math.round(y)}: the link is on top`).toBe('');
  }

  await expect(page.locator('#client-list .entity'), 'the client list has loaded').toHaveCount(12);
  await tap(page, page.getByRole('button', { name: 'Add client' }), 'Add client');
  const { fx, fy } = await mapPoint(page, map); // not within 16 px of a Leaflet control, not on a pin
  await tapAt(page, map, fx, fy, 'the map');
  await expect(page.locator('#cf-pin')).toHaveText(/^Pin at 4\d\.\d{5}, -5\d\.\d{5}\. /);
  await expect(map.locator('.pin-new')).toBeVisible();
  expect(guarded.outside, 'nothing but tiles.openfreemap.org (routed) left 127.0.0.1').toEqual([]);
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

test('add a worker with the days ticked: the stored availability is what was ticked', async ({ page, context }) => {
  const name = 'Dana K. (SAMPLE)';
  await setNow(page, context, NOW);
  await signIn(page);
  await tab(page, 'Workers');
  await tap(page, page.getByRole('button', { name: 'Add worker' }), 'Add worker');
  await typeInto(page, page.locator('#wf-name'), name, 'name');
  await typeInto(page, page.locator('#wf-phone'), '709-555-0199', 'phone');
  await tap(page, page.locator('label.check', { hasText: 'Grand Falls-Windsor' }), 'Grand Falls-Windsor zone');
  // The form starts at Mon–Fri 8:00–4:00: take Friday off, add Saturday 9:00–1:00.
  await tap(page, page.locator('.avail-row[data-day="5"] label.check'), 'Fri');
  await expect(page.locator('[data-avail-on="5"]')).not.toBeChecked();
  await tap(page, page.locator('.avail-row[data-day="6"] label.check'), 'Sat');
  await expect(page.locator('[data-avail-on="6"]')).toBeChecked();
  await page.locator('[data-avail-start="6"]').fill('09:00');
  await page.locator('[data-avail-end="6"]').fill('13:00');

  const post = page.waitForResponse(r => r.url().endsWith('/api/office/workers') && r.request().method() === 'POST');
  await tap(page, page.getByRole('button', { name: 'Save worker' }), 'Save worker');
  const res = await post;
  expect(res.status()).toBe(201);
  const day = { start: '08:00', end: '16:00' };
  expect((await res.json()).availability, 'the availability as stored').toEqual({
    1: day, 2: day, 3: day, 4: day, 5: null, 6: { start: '09:00', end: '13:00' }, 7: null,
  });
  await expect(page.locator('#worker-list .entity', { hasText: name })).toContainText('709-555-0199');
});

test('a deactivated worker stays under Inactive, their earlier visit keeps them when saved, and the week shows their row', async ({ page, context, request, seed }, testInfo) => {
  const terry = byName(seed.workers, 'Terry O. (SAMPLE)');
  const token = await officeToken(request);
  const visit = await oneOffVisit(request, token, { client_id: byName(seed.clients, 'George N. (SAMPLE)').id, worker_id: terry.id, date: DAY, start: '08:00', end: '09:00' });
  await setNow(page, context, NOW);
  await signIn(page);

  await tab(page, 'Workers');
  await tap(page, page.locator('#worker-list .entity', { hasText: 'Terry O. (SAMPLE)' }), 'Terry O.');
  await tap(page, page.locator('label.check', { hasText: 'Active worker' }), 'Active worker');
  await expect(page.locator('#wf-active')).not.toBeChecked();
  const put = page.waitForResponse(r => r.url().endsWith(`/api/office/workers/${terry.id}`) && r.request().method() === 'PUT');
  await tap(page, page.getByRole('button', { name: 'Save worker' }), 'Save worker');
  const saved = await put;
  expect(saved.status()).toBe(200);
  expect((await saved.json()).active).toBe(false);

  await expect(page.getByRole('heading', { name: 'Inactive' })).toBeVisible();
  const inactive = page.locator('#worker-list-inactive .entity', { hasText: 'Terry O. (SAMPLE)' });
  await expect(inactive).toBeVisible();
  await expect(page.locator('#worker-list .entity', { hasText: 'Terry O. (SAMPLE)' })).toHaveCount(0);
  await tap(page, inactive, 'Terry O. under Inactive');
  await expect(page.locator('#wf-name'), 'still openable').toHaveValue('Terry O. (SAMPLE)');

  await tab(page, 'Week');
  if (testInfo.project.name.endsWith('1280')) {
    await expect(page.locator('.grid-worker', { hasText: 'Terry O. (SAMPLE) (inactive)' })).toBeVisible();
    await tap(page, page.locator(`.cell[data-worker-id="${terry.id}"][data-date="${DAY}"] .chip[data-visit-id="${visit.id}"]`), 'the 8:00 visit');
  } else {
    await expect(page.locator(`.wgroup[data-worker-id="${terry.id}"] h3`)).toContainText('Terry O. (SAMPLE) (inactive)');
    await tap(page, page.locator(`[data-open-visit="${visit.id}"]`), 'the 8:00 visit');
  }
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('#vs-worker'), 'the sheet keeps the inactive worker').toHaveValue(String(terry.id));
  await expect(sheet.locator('#vs-worker option:checked')).toHaveText('Terry O. (SAMPLE) (inactive)');
  await sheet.locator('#vs-end').fill('09:15');
  const save = page.waitForResponse(r => r.url().endsWith(`/api/office/visits/${visit.id}`) && r.request().method() === 'PUT');
  await tap(page, sheet.getByRole('button', { name: 'Save changes' }), 'Save changes');
  const res = await save;
  expect(res.status()).toBe(200);
  expect(await res.json(), 'saved with the worker kept').toMatchObject({ worker_id: terry.id, end: '09:15' });
  const day = await api(request, 'GET', `/api/office/day?date=${DAY}`, { token });
  expect(day.body.visits.find(v => v.id === visit.id).worker_id).toBe(terry.id);
});

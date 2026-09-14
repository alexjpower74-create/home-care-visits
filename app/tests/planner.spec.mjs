// The week planner: a real mouse drag at 1280, "Assign to" at 390, the conflict list, and a stale edit.
import { test, expect, tap, drag, tab, signIn, api, officeToken, byName, setNow, NOW, DAY, addDays } from './helpers.mjs';

const MON = DAY;
const SAT = addDays(DAY, 5);

async function weekData(request) {
  const token = await officeToken(request);
  const r = await api(request, 'GET', `/api/office/week?start=${MON}`, { token });
  expect(r.status).toBe(200);
  const w = r.body;
  const worker = name => byName(w.workers, name);
  const visit = (client, date) => {
    const v = w.visits.find(x => x.client_name === client && x.date === date);
    if (!v) throw new Error(`no ${client} visit on ${date}`);
    return v;
  };
  return { token, w, worker, visit };
}

async function openWeek(page, context) {
  await setNow(page, context, NOW);
  await signIn(page);
  await tab(page, 'Week');
  await expect(page.getByRole('heading', { name: 'Week of Mon Sep 14' })).toBeVisible();
}

const travelGap = (page, date) => page.locator(`.conflict[data-kind="travel_gap"][data-date="${date}"]`);

test('a mouse drag of Terry O.\'s Saturday chip onto Jo W. clears the travel gap, and a reload keeps it @desktop', async ({ page, context, request }) => {
  const { worker, visit } = await weekData(request);
  const terry = worker('Terry O. (SAMPLE)');
  const jo = worker('Jo W. (SAMPLE)');
  const george = visit('George N. (SAMPLE)', SAT);
  await openWeek(page, context);
  await expect(travelGap(page, SAT)).toHaveCount(1);

  const chip = page.locator(`.cell[data-worker-id="${terry.id}"][data-date="${SAT}"] .chip[data-visit-id="${george.id}"]`);
  const target = page.locator(`.cell[data-worker-id="${jo.id}"][data-date="${SAT}"]`);
  const put = page.waitForResponse(r => r.url().endsWith(`/api/office/visits/${george.id}`) && r.request().method() === 'PUT');
  await drag(page, chip, target, 'George N. to Jo W.');
  expect((await put).status()).toBe(200);
  await expect(travelGap(page, SAT), 'the Saturday travel gap is gone').toHaveCount(0);
  await expect(page.locator(`.cell[data-worker-id="${jo.id}"][data-date="${SAT}"] .chip[data-visit-id="${george.id}"]`)).toBeVisible();

  await page.reload();
  await tab(page, 'Week');
  await expect(page.locator(`.cell[data-worker-id="${jo.id}"][data-date="${SAT}"] .chip[data-visit-id="${george.id}"]`), 'kept after a reload').toBeVisible();
  await expect(travelGap(page, SAT)).toHaveCount(0);
  await expect(travelGap(page, addDays(DAY, 6)), "Sunday's travel gap is still there").toHaveCount(1);
});

test('dragging a visit onto a worker already booked then shows Double-booked with both chips edged @desktop', async ({ page, context, request }) => {
  const { worker, visit } = await weekData(request);
  const sam = worker('Sam R. (SAMPLE)');
  const alex = worker('Alex B. (SAMPLE)');
  const walter = visit('Walter G. (SAMPLE)', MON); // Alex B., 9:00
  const bill = visit('Bill S. (SAMPLE)', MON); // Sam R., 9:00
  await openWeek(page, context);
  await expect(page.locator(`.conflict[data-kind="double_booked"]`)).toHaveCount(0);

  const put = page.waitForResponse(r => r.url().endsWith(`/api/office/visits/${walter.id}`) && r.request().method() === 'PUT');
  await drag(page, page.locator(`.cell[data-worker-id="${alex.id}"][data-date="${MON}"] .chip[data-visit-id="${walter.id}"]`),
    page.locator(`.cell[data-worker-id="${sam.id}"][data-date="${MON}"]`), 'Walter G. to Sam R.');
  expect((await put).status()).toBe(200);
  const conflict = page.locator(`.conflict[data-kind="double_booked"][data-date="${MON}"]`);
  await expect(conflict).toHaveCount(1);
  await expect(conflict).toContainText('Double-booked');
  await expect(conflict.locator('.conflict-msg')).toHaveText(/^Sam R\. \(SAMPLE\) is booked for (Bill S\. \(SAMPLE\) and Walter G\. \(SAMPLE\)|Walter G\. \(SAMPLE\) and Bill S\. \(SAMPLE\)) at the same time on Mon Sep 14\.$/);
  for (const v of [walter, bill]) await expect(page.locator(`.chip[data-visit-id="${v.id}"]`)).toHaveAttribute('data-conflict', 'problem');
});

test('"Assign to" at 390 clears the travel gap and makes a double-booking @phone', async ({ page, context, request }) => {
  const { worker, visit } = await weekData(request);
  const jo = worker('Jo W. (SAMPLE)');
  const sam = worker('Sam R. (SAMPLE)');
  const george = visit('George N. (SAMPLE)', SAT);
  const walter = visit('Walter G. (SAMPLE)', MON);
  const bill = visit('Bill S. (SAMPLE)', MON);
  await openWeek(page, context);
  await expect(travelGap(page, SAT)).toHaveCount(1);

  await tap(page, page.locator(`.day-tab[data-day="${SAT}"]`), 'Sat tab');
  await page.locator(`#assign-${george.id}`).selectOption(String(jo.id));
  let put = page.waitForResponse(r => r.url().endsWith(`/api/office/visits/${george.id}`) && r.request().method() === 'PUT');
  await tap(page, page.locator(`[data-save-assign="${george.id}"]`), 'Save (George N.)');
  expect((await put).status()).toBe(200);
  await expect(travelGap(page, SAT)).toHaveCount(0);
  await expect(page.locator(`.wgroup[data-worker-id="${jo.id}"] .vcard[data-visit-id="${george.id}"]`)).toBeVisible();

  await tap(page, page.locator(`.day-tab[data-day="${MON}"]`), 'Mon tab');
  await page.locator(`#assign-${walter.id}`).selectOption(String(sam.id));
  put = page.waitForResponse(r => r.url().endsWith(`/api/office/visits/${walter.id}`) && r.request().method() === 'PUT');
  await tap(page, page.locator(`[data-save-assign="${walter.id}"]`), 'Save (Walter G.)');
  expect((await put).status()).toBe(200);
  await expect(page.locator(`.conflict[data-kind="double_booked"][data-date="${MON}"]`)).toContainText('Double-booked');
  for (const v of [walter, bill]) await expect(page.locator(`.vcard[data-visit-id="${v.id}"]`)).toHaveAttribute('data-conflict', 'problem');
});

test('a stale edit shows "This visit was changed on another screen. Reload and try again."', async ({ page, context, request }, testInfo) => {
  const { token, visit } = await weekData(request);
  const george = visit('George N. (SAMPLE)', SAT);
  await openWeek(page, context);
  if (testInfo.project.name.endsWith('1280')) {
    await tap(page, page.locator(`.chip[data-visit-id="${george.id}"]`), 'George N. chip');
  } else {
    await tap(page, page.locator(`.day-tab[data-day="${SAT}"]`), 'Sat tab');
    await tap(page, page.locator(`[data-open-visit="${george.id}"]`), 'George N. card');
  }
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'George N. (SAMPLE)' })).toBeVisible();
  await sheet.locator('#vs-end').fill('10:15');

  // Another screen changes the visit between load and save.
  const other = await api(request, 'PUT', `/api/office/visits/${george.id}`, { token,
    data: { worker_id: george.worker_id, date: george.date, start: george.start, end: '10:30', version: george.version } });
  expect(other.status).toBe(200);

  const put = page.waitForResponse(r => r.url().endsWith(`/api/office/visits/${george.id}`) && r.request().method() === 'PUT');
  await tap(page, sheet.getByRole('button', { name: 'Save changes' }), 'Save changes');
  expect((await put).status()).toBe(409);
  await expect(sheet).toContainText('This visit was changed on another screen. Reload and try again.');
});

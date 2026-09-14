// Reports after real phone journeys. Sam R. and Jo W. each work one visit of exactly 3 618 s (1 h 0 min 18 s): each row rounds
// up to "1.01" on its own, while the exact total of 7 236 s is "2.01". A screen that added the rounded rows would show "2.02".
// Jo's missing check-out is fixed through the edit sheet. The CSV download must be the Worker's bytes.
import fs from 'node:fs/promises';
import { test, expect, tap, typeInto, tab, signIn, api, officeToken, byName, pathOf, setNow, waitEvent, iso, localToUtcMs, addDays, DAY } from './helpers.mjs';

const SAM_IN = localToUtcMs(DAY, '09:00');          // Bill S. 9:00
const SAM_OUT = SAM_IN + 3618 * 1000;               // 10:00:18 AM
const RUBY_IN = localToUtcMs(DAY, '10:31');         // Ruby T.: never checked out, stays incomplete
const JO_IN = localToUtcMs(DAY, '08:30') + 42_000;  // Margaret P. 8:30:42 AM; the office sets the check-out to 9:31 → 3 618 s
const JO_OUT = localToUtcMs(DAY, '09:31');
const OFFICE_AT = localToUtcMs(DAY, '12:30');
const WEEK = [DAY, addDays(DAY, 6)];
const REASON = "Jo's phone battery died; she phoned at 9:31 (SAMPLE)";

const inputs = page => Promise.all([page.locator('#rp-from').inputValue(), page.locator('#rp-to').inputValue()]);

test('presets read the page clock when pressed: three days on without a reload, "Last week" is the new last week', async ({ page, context }) => {
  const saturday = localToUtcMs('2026-09-12', '10:30');
  await setNow(page, context, saturday);
  await signIn(page);
  await tab(page, 'Reports');
  await expect(page.locator('#rp-from')).toHaveValue('2026-09-07');
  await expect(page.locator('#rp-to')).toHaveValue('2026-09-13');

  // Tuesday Sep 15, the tab still open.
  await setNow(page, context, saturday + 3 * 24 * 3600 * 1000);
  await tap(page, page.getByRole('button', { name: 'Last week' }), 'Last week');
  await expect.poll(() => inputs(page), { message: 'the week before Tue Sep 15, not before Sat Sep 12' }).toEqual(['2026-09-07', '2026-09-13']);
  await tap(page, page.getByRole('button', { name: 'Last 14 days' }), 'Last 14 days');
  await expect.poll(() => inputs(page)).toEqual(['2026-09-02', '2026-09-15']);
  await tap(page, page.getByRole('button', { name: 'This week' }), 'This week');
  await expect.poll(() => inputs(page)).toEqual(['2026-09-14', '2026-09-20']);
});

test('presets on Sunday Nov 1 2026 at 11:30 PM NL, the day the clocks go back', async ({ page, context }) => {
  await setNow(page, context, localToUtcMs('2026-11-01', '23:30'));
  await signIn(page);
  await tab(page, 'Reports');
  await expect.poll(() => inputs(page), { message: 'This week' }).toEqual(['2026-10-26', '2026-11-01']);
  await tap(page, page.getByRole('button', { name: 'Last 14 days' }), 'Last 14 days');
  await expect.poll(() => inputs(page)).toEqual(['2026-10-19', '2026-11-01']);
  await tap(page, page.getByRole('button', { name: 'Last week' }), 'Last week');
  await expect.poll(() => inputs(page)).toEqual(['2026-10-19', '2026-10-25']);
});

test('Download CSV uses the From and To typed at the click, and shows that period first', async ({ page, context, request }) => {
  await setNow(page, context, localToUtcMs(DAY, '10:30'));
  const token = await officeToken(request);
  await signIn(page);
  await tab(page, 'Reports');
  await expect(page.locator('#rp-label')).toHaveText('Mon Sep 14 to Sun Sep 20');
  await page.locator('#rp-from').fill('2026-09-01');
  await page.locator('#rp-to').fill('2026-09-10');
  const download = page.waitForEvent('download');
  await tap(page, page.getByRole('button', { name: 'Download CSV' }), 'Download CSV (not pressing Show)');
  const file = await download;
  expect(file.suggestedFilename()).toBe('home-care-payroll-2026-09-01-to-2026-09-10.csv');
  await expect(page.locator('#rp-label'), 'the page shows the period it downloaded').toHaveText('Tue Sep 1 to Thu Sep 10');
  const direct = await request.get('/api/office/reports/payroll.csv?from=2026-09-01&to=2026-09-10', { headers: { Authorization: `Bearer ${token}` } });
  expect(Buffer.compare(await fs.readFile(await file.path()), await direct.body())).toBe(0);
});

async function checkInOnPhone(page, context, worker, visit, at) {
  await setNow(page, context, at);
  await context.setGeolocation({ latitude: visit.lat, longitude: visit.lng, accuracy: 10 });
  await page.goto(pathOf(worker.worker_url));
  const card = page.locator(`.visit[data-visit="${visit.id}"]`);
  await expect(card.locator('.visit-name')).toHaveText(visit.client_name);
  if (!(await card.getByRole('button', { name: 'Check in' }).isVisible())) await tap(page, card.locator('.visit-head'), `open ${visit.client_name}`);
  const sent = waitEvent(page, 'check_in');
  await tap(page, card.getByRole('button', { name: 'Check in' }), `Check in (${visit.client_name})`);
  expect((await sent).status()).toBe(201);
  return card;
}

test('Payroll shows the Worker\'s exact hours after two phone journeys and a Fix times; the CSV is the Worker\'s bytes; Billing, Missed, Mileage', async ({ page, context, request, seed }) => {
  test.setTimeout(180_000);
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  const jo = byName(seed.workers, 'Jo W. (SAMPLE)');
  const visitsOf = async w => (await api(request, 'GET', '/api/worker/visits', { headers: { 'X-Worker-Key': w.key } })).body.visits;
  const samVisits = await visitsOf(sam);
  const bill = samVisits.find(v => v.client_name === 'Bill S. (SAMPLE)');
  const ruby = samVisits.find(v => v.client_name === 'Ruby T. (SAMPLE)');
  const margaret = (await visitsOf(jo)).find(v => v.client_name === 'Margaret P. (SAMPLE)');
  await context.grantPermissions(['geolocation']);

  // Sam: Bill S. in at 9:00:00, out at 10:00:18; then Ruby T. in at 10:31.
  const billCard = await checkInOnPhone(page, context, sam, bill, SAM_IN);
  await setNow(page, context, SAM_OUT);
  await tap(page, billCard.getByRole('button', { name: 'Check out' }), 'Check out');
  const out = waitEvent(page, 'check_out');
  await tap(page, page.getByRole('dialog').getByRole('button', { name: 'Yes, check out' }), 'Yes, check out');
  expect((await out).status()).toBe(201);
  await checkInOnPhone(page, context, sam, ruby, RUBY_IN);
  // Jo: Margaret P. in at 8:30:42; the phone never checks out.
  await checkInOnPhone(page, context, jo, margaret, JO_IN);

  // The office, at 12:30.
  await setNow(page, context, OFFICE_AT);
  const token = await officeToken(request);
  const report = async (kind) => (await api(request, 'GET', `/api/office/reports/${kind}?from=${WEEK[0]}&to=${WEEK[1]}`, { token, now: OFFICE_AT })).body;
  await signIn(page);
  await tab(page, 'Reports');
  await expect(page.locator('#rp-from')).toHaveValue(WEEK[0]);
  await expect(page.locator('#rp-to')).toHaveValue(WEEK[1]);
  await expect(page.locator(`#payroll-incomplete [data-visit-id="${margaret.id}"]`))
    .toHaveText('Jo W. (SAMPLE) · Margaret P. (SAMPLE) · Mon Sep 14, checked in 8:30 AM');

  // Fix Jo's missing check-out in the edit sheet.
  await tab(page, 'Today');
  await tap(page, page.locator(`.board-row[data-visit-id="${margaret.id}"] .row-client`), 'Margaret P. on the board');
  let sheet = page.getByRole('dialog');
  await expect(sheet.locator('#vs-times-now')).toContainText('Check-in: 8:30 AM (from the phone');
  await expect(sheet.locator('#vs-times-now')).toContainText('Check-out: none yet');
  await sheet.locator('#vs-fix-out').fill('09:31');
  await typeInto(page, sheet.locator('#vs-fix-reason'), REASON, 'reason');
  const fixed = page.waitForResponse(r => r.url().endsWith(`/api/office/visits/${margaret.id}/times`) && r.request().method() === 'PUT');
  await tap(page, sheet.getByRole('button', { name: 'Fix times' }), 'Fix times');
  const fixRes = await fixed;
  expect(fixRes.status()).toBe(200);
  const fixBody = await fixRes.json();
  expect(fixBody.check_out).toMatchObject({ at: iso(JO_OUT), source: 'office', correction_reason: REASON });
  expect(fixBody.check_in.at, "the phone's check-in (with its seconds) is kept").toBe(iso(JO_IN));
  expect(fixBody.worked_seconds).toBe(3618);
  sheet = page.getByRole('dialog');
  await expect(sheet.locator('#vs-times-now')).toContainText(`Check-out: 9:31 AM (set by the office: ${REASON})`);
  await expect(sheet.locator('#vs-times-now')).toContainText('Worked: 1 h 0 min');
  await tap(page, sheet.getByRole('button', { name: 'Close' }), 'Close');

  // Payroll: the Worker's numbers, including its total.
  await tab(page, 'Reports');
  const payroll = await report('payroll');
  expect(payroll.total, 'the Worker adds seconds, then rounds once').toMatchObject({ visits: 2, seconds: 7236, hours: '2.01' });
  expect(payroll.rows.map(r => r.hours), 'each row rounds up on its own').toEqual(['1.01', '1.01']);
  for (const r of payroll.rows) {
    await expect(page.locator(`#payroll-table tr.row-worker[data-worker-id="${r.worker_id}"] .hours`)).toHaveText(r.hours);
    for (const c of r.clients) await expect(page.locator(`#payroll-table tr.row-sub[data-worker-id="${r.worker_id}"][data-client-id="${c.client_id}"] .hours`)).toHaveText(c.hours);
  }
  await expect(page.locator('#payroll-total .hours'), "the Worker's total, not the rounded rows added up (2.02)").toHaveText(payroll.total.hours);
  await expect(page.locator(`#payroll-incomplete [data-visit-id="${margaret.id}"]`), 'fixed: no longer incomplete').toHaveCount(0);
  await expect(page.locator(`#payroll-incomplete [data-visit-id="${ruby.id}"]`)).toContainText('Sam R. (SAMPLE) · Ruby T. (SAMPLE)');

  // Download CSV: the Worker's bytes.
  const download = page.waitForEvent('download');
  await tap(page, page.getByRole('button', { name: 'Download CSV' }), 'Download CSV');
  const file = await download;
  expect(file.suggestedFilename()).toBe(`home-care-payroll-${WEEK[0]}-to-${WEEK[1]}.csv`);
  const bytes = await fs.readFile(await file.path());
  const direct = await request.get(`/api/office/reports/payroll.csv?from=${WEEK[0]}&to=${WEEK[1]}`, { headers: { Authorization: `Bearer ${token}`, 'X-Test-Now': iso(OFFICE_AT) } });
  expect(direct.status()).toBe(200);
  expect(Buffer.compare(bytes, await direct.body()), "the download is byte for byte GET payroll.csv").toBe(0);

  // Billing, grouped by funder.
  await tap(page, page.getByRole('tab', { name: 'Billing' }), 'Billing');
  const billing = await report('billing');
  await expect(page.locator('#billing-table tr.row-funder th')).toHaveText(billing.funders.map(f => f.funder_name));
  for (const f of billing.funders) {
    await expect(page.locator(`#billing-table tr.row-funder[data-funder-id="${f.funder_id}"] .hours`)).toHaveText(f.hours);
    // Scheduled hours are the Worker's scheduled_hours, on funders and clients (clarification 17).
    await expect(page.locator(`#billing-table tr.row-funder[data-funder-id="${f.funder_id}"] .scheduled`)).toHaveText(f.scheduled_hours);
    for (const c of f.clients) {
      await expect(page.locator(`#billing-table tr.row-sub[data-funder-id="${f.funder_id}"][data-client-id="${c.client_id}"] .scheduled`)).toHaveText(c.scheduled_hours);
    }
  }
  await expect(page.locator('#billing-total .hours')).toHaveText(billing.total.hours);
  await expect(page.locator('#billing-total .scheduled')).toHaveText(billing.total.scheduled_hours);

  // Missed and late.
  await tap(page, page.getByRole('tab', { name: 'Missed and late' }), 'Missed and late');
  const missed = await report('missed');
  expect(missed.rows.some(r => r.what === 'missed')).toBe(true);
  await expect(page.locator('#missed-table tbody tr')).toHaveCount(missed.rows.length);
  const first = missed.rows.find(r => r.what === 'missed');
  await expect(page.locator(`#missed-table tr[data-visit-id="${first.visit_id}"]`)).toContainText(`${first.client_name}`);
  await expect(page.locator(`#missed-table tr[data-visit-id="${first.visit_id}"]`)).toContainText('Missed: no check-in');

  // Mileage: Sam's Bill S. → Ruby T. leg, with the straight-line note.
  await tap(page, page.getByRole('tab', { name: 'Mileage' }), 'Mileage');
  const mileage = await report('mileage');
  await expect(page.locator('.report-note')).toHaveText(mileage.note);
  expect(mileage.note).toContain('Straight-line distance');
  const samDay = mileage.rows.find(r => r.worker_id === sam.id);
  await expect(page.locator(`[data-mileage-worker="${sam.id}"] h3`)).toContainText(`${samDay.km} km`);
  await expect(page.locator(`[data-mileage-worker="${sam.id}"]`)).toContainText('Bill S. (SAMPLE) to Ruby T. (SAMPLE)');

  // Period buttons.
  await tap(page, page.getByRole('button', { name: 'Last week' }), 'Last week');
  await expect(page.locator('#rp-from')).toHaveValue(addDays(DAY, -7));
  await expect(page.locator('#rp-to')).toHaveValue(addDays(DAY, -1));
  await tap(page, page.getByRole('button', { name: 'Last 14 days' }), 'Last 14 days');
  await expect(page.locator('#rp-from')).toHaveValue(addDays(DAY, -13));
  await expect(page.locator('#rp-to')).toHaveValue(DAY);
});

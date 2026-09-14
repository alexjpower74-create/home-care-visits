// New link (with its inline confirm) for workers, inactive workers and clients, and Copy link.
import { test, expect, tap, tab, signIn, setNow, api, officeToken, byName, pathOf, NOW } from './helpers.mjs';

const CLIPBOARD_WEBKIT = "webkit: Playwright's WebKit can't grant clipboard-read, so the clipboard's text can't be read back; "
  + 'the step asserts "Copied" and skips only the read';

async function newLinkFor(page, formSelector, postPath) {
  const form = page.locator(formSelector);
  await tap(page, form.getByRole('button', { name: 'New link', exact: true }), 'New link');
  const confirm = form.locator('#link-confirm');
  await expect(confirm).toContainText('The old link stops working at once.');
  const post = page.waitForResponse(r => r.url().endsWith(postPath) && r.request().method() === 'POST');
  await tap(page, confirm.getByRole('button', { name: 'Make a new link' }), 'Make a new link');
  const res = await post;
  expect(res.status()).toBe(200);
  await expect(confirm).toBeHidden();
  return res.json();
}

test('New link on a worker: after the inline confirm the old link stops working and the new one works', async ({ page, context, seed }) => {
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  await setNow(page, context, NOW);
  await signIn(page);
  await tab(page, 'Workers');
  await tap(page, page.locator('#worker-list .entity', { hasText: 'Sam R. (SAMPLE)' }), 'Sam R.');
  // "Keep the old link" changes nothing.
  await tap(page, page.getByRole('button', { name: 'New link', exact: true }), 'New link');
  await tap(page, page.getByRole('button', { name: 'Keep the old link' }), 'Keep the old link');
  await expect(page.locator('#link-confirm')).toBeHidden();

  const fresh = await newLinkFor(page, '#worker-form', `/api/office/workers/${sam.id}/new-link`);
  expect(fresh.worker_url).not.toBe(sam.worker_url);
  await expect(page.locator('#link-msg')).toHaveText('New link made. The old link no longer works. Copy the new one and give it to Sam R. (SAMPLE).');

  await page.goto(pathOf(sam.worker_url));
  await expect(page.getByText("This link doesn't work any more. Ask the office for a new one.")).toBeVisible();
  await page.goto(pathOf(fresh.worker_url));
  await expect(page.locator('.visit').first()).toBeVisible();
  await expect(page.locator('#strip-text')).toHaveText('All sent');
});

test('New link on an inactive worker, opened from Inactive', async ({ page, context, request, seed }) => {
  const terry = byName(seed.workers, 'Terry O. (SAMPLE)');
  const token = await officeToken(request);
  const w = (await api(request, 'GET', '/api/office/workers?all=1', { token })).body.workers.find(x => x.id === terry.id);
  const off = await api(request, 'PUT', `/api/office/workers/${terry.id}`, { token,
    data: { name: w.name, phone: w.phone, zone_ids: w.zone_ids, availability: w.availability, max_week_minutes: w.max_week_minutes, active: false } });
  expect(off.status).toBe(200);
  await setNow(page, context, NOW);
  await signIn(page);
  await tab(page, 'Workers');
  await tap(page, page.locator('#worker-list-inactive .entity', { hasText: 'Terry O. (SAMPLE)' }), 'Terry O. under Inactive');
  await newLinkFor(page, '#worker-form', `/api/office/workers/${terry.id}/new-link`);
  await page.goto(pathOf(terry.worker_url));
  await expect(page.getByText("This link doesn't work any more. Ask the office for a new one.")).toBeVisible();
});

test('New family link on a client: the old family link shows the bad-link message', async ({ page, context, seed }) => {
  const walter = byName(seed.clients, 'Walter G. (SAMPLE)');
  await setNow(page, context, NOW);
  await signIn(page);
  await tab(page, 'Clients');
  await expect(page.locator('#client-list .entity')).toHaveCount(12);
  await tap(page, page.locator('#client-list .entity', { hasText: 'Walter G. (SAMPLE)' }), 'Walter G.');
  await expect(page.locator('#cf-name')).toHaveValue('Walter G. (SAMPLE)');
  const fresh = await newLinkFor(page, '#client-form', `/api/office/clients/${walter.id}/new-link`);
  expect(fresh.family_url).not.toBe(walter.family_url);
  await page.goto(pathOf(walter.family_url));
  await expect(page.getByText("This link doesn't work. Ask the agency for a new one.")).toBeVisible();
  await page.goto(pathOf(fresh.family_url));
  await expect(page.getByRole('heading', { name: 'Visits for Walter G. (SAMPLE)' })).toBeVisible();
});

test('Copy worker link puts the exact link on the clipboard and says "Copied"', async ({ page, context, seed, browserName }) => {
  const sam = byName(seed.workers, 'Sam R. (SAMPLE)');
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setNow(page, context, NOW);
  await signIn(page);
  await tab(page, 'Workers');
  await tap(page, page.locator('#worker-list .entity', { hasText: 'Sam R. (SAMPLE)' }), 'Sam R.');
  const copy = page.getByRole('button', { name: 'Copy worker link' });
  await tap(page, copy, 'Copy worker link');
  await expect(page.locator('[data-act="copy-worker"]')).toHaveText('Copied');
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText()), 'the exact worker link').toBe(sam.worker_url);
  } else {
    test.info().annotations.push({ type: 'skipped step', description: CLIPBOARD_WEBKIT });
  }
});

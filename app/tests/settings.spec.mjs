// Settings: a wrong current PIN keeps the session; changing the PIN; the agency name and office phone.
import { test, expect, tap, typeInto, tab, signIn, setNow, api, NOW, PIN } from './helpers.mjs';

test('a wrong current PIN keeps the session and shows the message by the field', async ({ page, context, request }) => {
  await setNow(page, context, NOW);
  await signIn(page);
  await tab(page, 'Settings');
  await typeInto(page, page.locator('#st-current'), '0000', 'current PIN');
  await typeInto(page, page.locator('#st-new'), '1357', 'new PIN');
  const put = page.waitForResponse(r => r.url().endsWith('/api/office/pin') && r.request().method() === 'PUT');
  await tap(page, page.getByRole('button', { name: 'Change PIN' }), 'Change PIN');
  const res = await put;
  expect(res.status()).toBe(401);
  expect((await res.json()).field).toBe('current');
  await expect(page.locator('#pin-form [data-error-for="current"]')).toHaveText('That PIN is not right.');
  await expect(page.locator('#signout'), 'still signed in').toBeVisible();
  await tab(page, 'Today');
  await expect(page.locator('.board-row').first(), 'the session still works').toBeVisible();
  expect((await api(request, 'POST', '/api/office/signin', { data: { pin: PIN } })).status, 'the PIN is unchanged').toBe(200);
});

test('change the PIN, and the agency name and office phone', async ({ page, context, request }) => {
  await setNow(page, context, NOW);
  await signIn(page);
  await tab(page, 'Settings');
  await typeInto(page, page.locator('#st-current'), PIN, 'current PIN');
  await typeInto(page, page.locator('#st-new'), '1357', 'new PIN');
  const put = page.waitForResponse(r => r.url().endsWith('/api/office/pin') && r.request().method() === 'PUT');
  await tap(page, page.getByRole('button', { name: 'Change PIN' }), 'Change PIN');
  expect((await put).status()).toBe(200);
  await expect(page.locator('#pin-saved')).toHaveText('PIN changed. Use the new PIN next time you sign in.');
  expect((await api(request, 'POST', '/api/office/signin', { data: { pin: '1357' } })).status, 'the new PIN signs in').toBe(200);
  expect((await api(request, 'POST', '/api/office/signin', { data: { pin: PIN } })).status, 'the old PIN does not').toBe(401);

  const name = 'SAMPLE Exploits Home Care (demo)';
  await typeInto(page, page.locator('#st-name'), name, 'agency name');
  await typeInto(page, page.locator('#st-phone'), '709-555-0109', 'office phone');
  const agency = page.waitForResponse(r => r.url().endsWith('/api/office/agency') && r.request().method() === 'PUT');
  await tap(page, page.getByRole('button', { name: 'Save agency' }), 'Save agency');
  expect((await agency).status()).toBe(200);
  await expect(page.locator('#agency-saved')).toHaveText('Saved.');
  await expect(page.locator('#agency'), 'the header shows the new name').toHaveText(name);
  await expect(page.locator('#badge')).toBeVisible();
  expect((await api(request, 'GET', '/api/agency')).body).toMatchObject({ name, office_phone: '709-555-0109', sample: true });
});

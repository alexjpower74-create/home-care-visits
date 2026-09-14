// The only way the pages talk to the Worker: same-origin fetch('/api/…') as in docs/API.md.
// Every call answers { status, ok, data }; a network failure throws. Error text shown to people is the API's `error` as is.
// With ?mock=1 on the page URL the in-memory api.mock.js answers instead (development before the Worker exists; tests never use it).
export const isMock = new URLSearchParams(location.search).get('mock') === '1';
let mock = null;

export async function request(method, path, { headers = {}, body, signal } = {}) {
  if (isMock) {
    mock ??= await import('./api.mock.js');
    return mock.handle(method, path, { headers, body });
  }
  const init = { method, headers: { ...headers }, signal, cache: 'no-store' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}

export const errorText = r => r?.data?.error || 'Something went wrong on our side. Try again in a minute.';

export const getAgency = () => request('GET', '/api/agency');
export const workerVisits = (key, date) =>
  request('GET', `/api/worker/visits${date ? `?date=${encodeURIComponent(date)}` : ''}`, { headers: { 'X-Worker-Key': key } });
export const postWorkerEvent = (key, event, signal) =>
  request('POST', '/api/worker/events', { headers: { 'X-Worker-Key': key }, body: event, signal });
export const familyVisits = key => request('GET', `/api/family/${encodeURIComponent(key)}`);

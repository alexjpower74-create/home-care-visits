// Office shared pieces: the token, the authorised API call, field errors, Copy link, the sheet.
import { request, errorText } from '../api.js';

export { errorText };
export { esc, telHref } from '../time.js';

const TOKEN_KEY = 'hcv:office-token';
export const NETWORK = "Can't reach the server. Check the connection and try again.";

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = t => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode: session lasts this page */ } };
export const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing stored */ } };

let sessionEnded = () => {};
export const onSessionEnded = fn => { sessionEnded = fn; };
/** A 401 without `field` from a call made outside office() (the CSV download). */
export function endSession(message) {
  clearToken();
  sessionEnded(message);
}

/** The inline "New link" block for the worker and client forms: Copy, New link, and a confirm that says what happens. */
export function linkBlock({ label, help, copyAct, copyLabel, who }) {
  return `<div class="field link-block"><span class="label">${label}</span><p class="muted">${help}</p>
    <div class="link-actions"><button type="button" class="btn btn-outline btn-inline" data-act="${copyAct}">${copyLabel}</button>
      <button type="button" class="btn btn-outline btn-inline" data-act="new-link">New link</button></div>
    <div class="confirm" id="link-confirm" role="group" aria-label="Make a new link" hidden>
      <p>The old link stops working at once. ${who} will need the new one.</p>
      <div class="link-actions"><button type="button" class="btn btn-accent btn-inline" data-act="confirm-new-link">Make a new link</button>
        <button type="button" class="btn btn-outline btn-inline" data-act="cancel-new-link">Keep the old link</button></div></div>
    <p class="muted" id="link-msg" role="status"></p><p class="field-error" data-error-for="link" role="alert"></p></div>`;
}

/** Authorised office call → { status, ok, data }; status 0 when the server can't be reached. A 401 without `field` ends the session. */
export async function office(method, path, body) {
  const token = getToken();
  let r;
  try {
    r = await request(method, path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, body });
  } catch {
    return { status: 0, ok: false, data: { error: NETWORK } };
  }
  if (r.status === 401 && !r.data?.field) endSession(errorText(r));
  return r;
}

/** Clears every [data-error-for] in root, then puts the API's words by the named field (or the general "_" slot). */
export function showErrors(root, r) {
  root.querySelectorAll('[data-error-for]').forEach(p => { p.textContent = ''; });
  if (!r || r.ok) return;
  const field = r.data?.field;
  const slot = (field && root.querySelector(`[data-error-for="${field}"]`)) || root.querySelector('[data-error-for="_"]');
  if (slot) {
    slot.textContent = errorText(r);
    slot.scrollIntoView({ block: 'nearest' });
  }
}

export async function copyText(button, text) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  button.dataset.label ??= button.textContent;
  button.textContent = ok ? 'Copied' : "Couldn't copy. Ask for help copying the link.";
  clearTimeout(button.copyTimer);
  button.copyTimer = setTimeout(() => { button.textContent = button.dataset.label; }, 2500);
  return ok;
}

export function openSheet(html) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = `<div class="sheet-back" data-sheet-back><div class="sheet sheet-office" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${html}</div></div>`;
  root.querySelector('#sheet-title')?.focus();
  return root.querySelector('.sheet');
}
export function closeSheet() {
  const root = document.getElementById('sheet-root');
  if (root) root.innerHTML = '';
}
document.addEventListener('click', e => {
  if (e.target.matches?.('[data-sheet-back]') || e.target.closest?.('[data-sheet-close]')) closeSheet();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

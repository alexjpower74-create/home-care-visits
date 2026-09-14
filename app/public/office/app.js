// Office shell: PIN sign-in, tabs by #hash, sign out, "session ended" on a 401 without field.
import { request } from '../api.js';
import { office, getToken, setToken, clearToken, onSessionEnded, esc, errorText, closeSheet, NETWORK } from './core.js';
import * as today from './board.js';
import * as week from './week.js';
import * as clients from './clients.js';
import * as workers from './workers.js';

const later = title => ({
  mount(el) {
    el.innerHTML = `<div class="view-head"><h1>${title}</h1></div><p class="notice">${title} comes in the next build step.</p>`;
    return () => {};
  },
});
const VIEWS = { today, week, clients, workers, reports: later('Reports'), settings: later('Settings') };
const $ = id => document.getElementById(id);
const ctx = { agency: null };
let unmount = null;

function paintAgency(a) {
  $('agency').textContent = a.name;
  $('badge').hidden = !(a.sample ?? a.name.includes('SAMPLE'));
  document.title = `Office · ${a.name}`;
}

async function publicHeader() {
  try {
    const r = await request('GET', '/api/agency');
    if (r.ok) paintAgency(r.data);
  } catch { /* the generic header stays */ }
}

function leave() {
  unmount?.();
  unmount = null;
  closeSheet();
}

function showSignin(note = '') {
  leave();
  ctx.agency = null;
  $('tabs').hidden = true;
  $('signout').hidden = true;
  $('view').innerHTML = `<section class="signin" aria-labelledby="signin-title">
    <h1 id="signin-title">Office sign-in</h1>
    ${note ? `<p class="notice" role="status">${esc(note)}</p>` : ''}
    <form id="signin-form" novalidate>
      <div class="field"><label for="pin">PIN</label>
        <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8"></div>
      <p id="pin-error" class="field-error" role="alert"></p>
      <button id="signin-btn" type="submit" class="btn btn-accent">Sign in</button>
    </form></section>`;
  $('signin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('signin-btn');
    btn.disabled = true;
    $('pin-error').textContent = '';
    let r;
    try { r = await request('POST', '/api/office/signin', { body: { pin: $('pin').value } }); } catch { r = { ok: false, data: { error: NETWORK } }; }
    btn.disabled = false;
    if (r.ok) {
      setToken(r.data.token);
      showApp();
    } else {
      $('pin-error').textContent = errorText(r);
      $('pin').select();
    }
  });
}

async function showApp() {
  const r = await office('GET', '/api/office/agency');
  if (!r.ok) {
    if (r.status !== 401) $('view').innerHTML = `<p class="notice notice-bad" role="alert">${esc(errorText(r))}</p>`;
    return;
  }
  ctx.agency = r.data;
  paintAgency(r.data);
  $('tabs').hidden = false;
  $('signout').hidden = false;
  route();
}

function route() {
  if (!getToken() || !ctx.agency) return;
  const name = location.hash.slice(1);
  const view = VIEWS[name] ? name : 'today';
  document.querySelectorAll('[data-tab]').forEach(a => {
    if (a.dataset.tab === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  leave();
  $('view').innerHTML = '';
  unmount = VIEWS[view].mount($('view'), ctx);
}

addEventListener('hashchange', route);
$('signout').addEventListener('click', async () => {
  await office('POST', '/api/office/signout');
  clearToken();
  showSignin('Signed out.');
});
onSessionEnded(() => showSignin('Your session ended. Sign in again.'));

publicHeader();
if (getToken()) showApp();
else showSignin();

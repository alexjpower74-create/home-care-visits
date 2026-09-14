// Settings: the agency name and office phone, and changing the PIN. A wrong current PIN is a 401 with `field: "current"`: the
// words show by that field and the session stays (only a 401 without `field` ends it).
import { office, showErrors, esc } from './core.js';

export function mount(el, ctx) {
  const a = ctx.agency;
  el.innerHTML = `<div class="view-head"><h1>Settings</h1></div>
    <form id="agency-form" class="office-form narrow" novalidate>
      <h2>Agency</h2>
      <p class="field-error" data-error-for="_" role="alert"></p>
      <div class="field"><label for="st-name">Agency name</label><input id="st-name" maxlength="80" value="${esc(a.name)}" autocomplete="off">
        <p class="field-error" data-error-for="name" role="alert"></p></div>
      <div class="field"><label for="st-phone">Office phone</label><input type="tel" id="st-phone" value="${esc(a.office_phone)}" autocomplete="off">
        <p class="field-error" data-error-for="office_phone" role="alert"></p></div>
      <div class="form-actions"><button type="submit" class="btn btn-accent btn-inline">Save agency</button></div>
      <p class="muted" id="agency-saved" role="status"></p>
    </form>
    <form id="pin-form" class="office-form narrow" novalidate>
      <h2>Change the PIN</h2>
      <p class="field-error" data-error-for="_" role="alert"></p>
      <div class="field"><label for="st-current">Current PIN</label><input type="password" id="st-current" inputmode="numeric" maxlength="8" autocomplete="current-password">
        <p class="field-error" data-error-for="current" role="alert"></p></div>
      <div class="field"><label for="st-new">New PIN (4 to 8 digits)</label><input type="password" id="st-new" inputmode="numeric" maxlength="8" autocomplete="new-password">
        <p class="field-error" data-error-for="new" role="alert"></p></div>
      <div class="form-actions"><button type="submit" class="btn btn-accent btn-inline">Change PIN</button></div>
      <p class="muted" id="pin-saved" role="status"></p>
    </form>`;
  const q = s => el.querySelector(s);

  q('#agency-form').addEventListener('submit', async e => {
    e.preventDefault();
    q('#agency-saved').textContent = '';
    const r = await office('PUT', '/api/office/agency', { name: q('#st-name').value, office_phone: q('#st-phone').value });
    if (r.status === 401 && !r.data?.field) return;
    showErrors(e.target, r);
    if (!r.ok) return;
    Object.assign(ctx.agency, r.data);
    ctx.onAgency?.(ctx.agency);
    q('#st-name').value = r.data.name;
    q('#st-phone').value = r.data.office_phone;
    q('#agency-saved').textContent = 'Saved.';
  });

  q('#pin-form').addEventListener('submit', async e => {
    e.preventDefault();
    q('#pin-saved').textContent = '';
    const r = await office('PUT', '/api/office/pin', { current: q('#st-current').value, new: q('#st-new').value });
    if (r.status === 401 && !r.data?.field) return;
    showErrors(e.target, r);
    if (!r.ok) return;
    q('#st-current').value = '';
    q('#st-new').value = '';
    q('#pin-saved').textContent = 'PIN changed. Use the new PIN next time you sign in.';
  });

  return () => {};
}

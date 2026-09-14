// NL time labels and small shared helpers. Labels use the same Intl call as docs/API.md, in the agency's zone,
// never the phone's zone, with U+202F / U+2009 before AM/PM replaced by a plain space.
export const TZ = 'America/St_Johns';

const formats = new Map();
function fmt(tz, opts) {
  const k = tz + JSON.stringify(opts);
  let f = formats.get(k);
  if (!f) formats.set(k, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts })));
  return f;
}
const plain = s => s.replace(/[\u202F\u2009]/g, ' ');
const asDate = t => (t instanceof Date ? t : new Date(t));

export const timeLabel = (t, tz = TZ) => plain(fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(asDate(t)));

/** "Mon Sep 14" for a calendar date "YYYY-MM-DD". */
export function dateLabelOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return plain(fmt('UTC', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d, 12)))).replace(/,/g, '');
}

function parts(t, tz) {
  const p = {};
  const f = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (const x of f.formatToParts(asDate(t))) p[x.type] = x.value;
  return p;
}

/** The NL calendar date "YYYY-MM-DD" of an instant. */
export function localDate(t, tz = TZ) {
  const p = parts(t, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The UTC milliseconds of a local date + "HH:MM" in tz (DST aware). */
export function localToUtcMs(date, hm, tz = TZ) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let ms = wall;
  for (let i = 0; i < 3; i++) {
    const p = parts(ms, tz);
    const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    ms = wall - (seen - ms);
  }
  return ms;
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const isoWeekday = date => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
export const mondayOf = date => addDays(date, 1 - isoWeekday(date));

/** "Walter G. (SAMPLE)" → "WG" (docs/API.md, Client.initials). */
export function initials(name) {
  const words = name.replace(/\(SAMPLE\)/g, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dp = (lat2 - lat1) * rad, dl = (lng2 - lng1) * rad;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dl / 2) ** 2;
  return Math.floor(2 * R * Math.asin(Math.sqrt(h)) + 0.5);
}
export const kmOf = metres => (Math.floor((metres + 50) / 100) / 10).toFixed(1);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const telHref = phone => `tel:${String(phone).replace(/[^\d+]/g, '')}`;

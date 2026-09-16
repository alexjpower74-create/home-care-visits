// Family link: today's visits and this week, from GET /api/family/<key>. Refreshes every 60 s and when the tab is shown again.
// A bad link shows the API's plain message and stops refreshing.
import { familyVisits, getAgency } from '../api.js'
import { esc, telHref } from '../time.js'

const key = new URLSearchParams(location.search).get('k') || ''
const $ = (id) => document.getElementById(id)
const REFRESH_MS = 60000
let timer = null
let stopped = false
let last = null

const TICK =
  '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

function header(agency) {
  if (!agency) return
  $('agency').textContent = agency.name
  $('badge').hidden = !agency.sample
  $('foot').innerHTML = agency.office_phone
    ? `<p>Questions about a visit? Call the agency: <a href="${telHref(agency.office_phone)}">${esc(agency.office_phone)}</a></p>`
    : ''
}

function card(v) {
  const who = v.worker_first_name ? `<p class="fam-who">With ${esc(v.worker_first_name)}</p>` : ''
  const tasks = v.tasks_done.length
    ? `<div><p class="muted" style="margin:0 0 6px">Done on this visit</p><ul class="ticks">${v.tasks_done.map((t) => `<li>${TICK}<span>${esc(t)}</span></li>`).join('')}</ul></div>`
    : ''
  const note = v.note ? `<blockquote class="quote">${esc(v.note)}</blockquote>` : ''
  return `<article class="fam-card" data-status="${esc(v.status)}">
    <p class="fam-time">${esc(v.time_label)}</p>
    <p class="fam-status fam-status--${esc(v.status)}">${esc(v.status_label)}</p>
    ${who}${tasks}${note}</article>`
}

function render(d) {
  header(d.agency)
  document.title = `Visits for ${d.client.name}`
  const updated = d.updated_label.split(', ').pop()
  const todayCards = d.today.visits.length ? d.today.visits.map(card).join('') : '<p class="empty">No visits today.</p>'
  const days = d.week.days
    .map(
      (day) =>
        `<section class="fam-day"><h3${day.date === d.today.date ? ' class="is-today"' : ''}>${esc(day.date_label)}${day.date === d.today.date ? ' (today)' : ''}</h3>${
          day.visits.length
            ? `<ul class="plain">${day.visits.map((v) => `<li><span>${esc(v.time_label)}</span><span>${esc(v.status_label)}</span></li>`).join('')}</ul>`
            : '<p class="muted" style="margin:0">No visits</p>'
        }</section>`,
    )
    .join('')
  $('main').innerHTML = `<h1>Visits for ${esc(d.client.name)}</h1>
    <h2>Today, ${esc(d.today.date_label)}</h2>${todayCards}
    <h2 id="week">This week</h2><p class="muted">${esc(d.week.week_label)}</p>${days}
    <p class="updated" id="updated" role="status">Updated ${esc(updated)}</p>`
}

async function badLink(message) {
  stopped = true
  clearInterval(timer)
  $('main').innerHTML = `<div class="notice notice-bad" role="alert" style="margin-top:24px">${esc(message)}</div>`
  try {
    const r = await getAgency()
    if (r.ok) header(r.data)
  } catch {
    /* keep the generic header */
  }
}

async function load() {
  if (stopped) return
  if (!key) return badLink("This link doesn't work. Ask the agency for a new one.")
  try {
    const r = await familyVisits(key)
    if (r.status === 200) {
      last = r.data
      render(r.data)
      return
    }
    if (r.status === 404) return badLink(r.data?.error || "This link doesn't work. Ask the agency for a new one.")
    throw new Error(r.data?.error || `answered ${r.status}`)
  } catch (e) {
    if (!last) {
      $('main').innerHTML =
        `<div class="notice" role="alert" style="margin-top:24px">${esc(e instanceof TypeError ? "Can't reach the agency right now. This page tries again every minute." : e.message)}</div>`
    } else if ($('updated')) {
      $('updated').textContent = `Couldn't refresh just now. Showing what was there at ${last.updated_label.split(', ').pop()}.`
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load()
})
timer = setInterval(load, REFRESH_MS)
load()

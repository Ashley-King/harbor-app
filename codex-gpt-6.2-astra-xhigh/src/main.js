import '@fontsource-variable/dm-sans/wght.css'
import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/instrument-serif/latin-400-italic.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import './style.css'
import SunCalc from 'suncalc'
import { icon, icons } from './icons.js'
import { terminals, berth, classify, colors, category } from './geography.js'
import { createMap } from './map.js'
import { sprite } from './models.js'

const $ = (s) => document.querySelector(s)
const esc = (s) =>
  String(s ?? 'unknown').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short'
})
const time = (v) => (v && Number.isFinite(Date.parse(v)) ? timeFormat.format(new Date(v)) : 'unknown')
const dateTime = (v) =>
  v
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      }).format(new Date(v))
    : 'unknown'
const memory = {
  read(k) {
    try {
      return JSON.parse(localStorage.getItem('soundings-v1-' + k))
    } catch {
      return null
    }
  },
  write(k, v) {
    try {
      localStorage.setItem('soundings-v1-' + k, JSON.stringify(v))
    } catch {}
  }
}
const state = {
  feed: {},
  ships: [],
  tab: 'ships',
  selected: null,
  openTerminal: null,
  checking: false,
  checked: null,
  wasStale: false
}
const flagNames = new Intl.DisplayNames(['en'], { type: 'region' })
const statusName = (s) =>
  s.speed != null && s.speed > 0.7
    ? 'Underway'
    : s.status === 5
      ? 'Moored'
      : s.status === 1
        ? 'At anchor'
        : s.speed != null
          ? 'Stationary'
          : 'unknown'
const speed = (s) => (s.speed == null ? 'unknown' : s.speed.toFixed(1) + ' kn')
function country(code) {
  try {
    return code ? flagNames.of(code) : 'unknown'
  } catch {
    return 'unknown'
  }
}
function pretty(s) {
  return s?.replaceAll('_', ' ') || 'unknown'
}
const thumbnails = new Map()
function thumb(s) {
  const ratio = s.length && s.beam ? s.length / s.beam : 5.9,
    key = s.model + '-' + Math.round(ratio * 4)
  if (!thumbnails.has(key)) thumbnails.set(key, sprite(s.model, true, ratio).toDataURL())
  return thumbnails.get(key)
}

icons()
const map = createMap(selectShip, selectTerminal)
function selectShip(id) {
  const s = state.ships.find((s) => s.mmsi === id)
  state.selected = s?.mmsi || null
  map.focus(s)
  renderDetail()
  markSelection()
  if (s && window.innerWidth < 850) $('.map-shell').scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function selectTerminal(id) {
  state.tab = 'terminals'
  state.openTerminal = id
  state.selected = null
  renderDetail()
  map.terminal(terminals.find((t) => t.id === id))
  renderList()
}
function changeTab(tab) {
  state.tab = tab
  state.openTerminal = null
  renderList()
}
$('#ships-tab').onclick = () => changeTab('ships')
$('#term-tab').onclick = () => changeTab('terminals')
$('#layers').onclick = () => {
  const menu = $('#layer-menu')
  menu.hidden = !menu.hidden
  $('#layers').setAttribute('aria-expanded', String(!menu.hidden))
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.map-top')) {
    $('#layer-menu').hidden = true
    $('#layers').setAttribute('aria-expanded', 'false')
  }
})
$('.expand').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {}
}
document.addEventListener('fullscreenchange', () =>
  $('.expand').setAttribute(
    'aria-label',
    document.fullscreenElement ? 'Exit full screen' : 'Enter full screen'
  )
)
for (const el of [$('#credits'), $('#sources')]) el.onclick = () => $('#source-dialog').showModal()
$('.dialog-close').onclick = () => $('#source-dialog').close()
$('#source-dialog').onclick = (e) => {
  if (e.target === $('#source-dialog')) $('#source-dialog').close()
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#source-dialog').open) {
    selectShip(null)
    $('#layer-menu').hidden = true
    $('#layers').setAttribute('aria-expanded', 'false')
  }
})

let preferred = memory.read('lighting') || { mode: 'auto', started: Date.now() }
function applyLighting() {
  const now = new Date()
  const times = SunCalc.getTimes(now, 32.8, -79.91)
  const yesterday = SunCalc.getTimes(new Date(+now - 86400000), 32.8, -79.91)
  const transitions = [yesterday.sunrise, yesterday.sunset, times.sunrise, times.sunset].filter(
    (d) => d <= now
  )
  const transitioned = transitions.some((d) => +d > preferred.started)
  const solarNight = now < times.sunrise || now >= times.sunset
  const isNight =
    preferred.mode === 'auto'
      ? preferred.started && !transitioned
        ? true
        : solarNight
      : preferred.mode === 'night'
  document.documentElement.dataset.light = isNight ? 'night' : 'day'
  document
    .querySelectorAll('[data-mode]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === preferred.mode)))
  $('[data-mode="auto"]').title =
    'Automatic lighting · sunrise ' +
    time(times.sunrise.toISOString()) +
    ' / sunset ' +
    time(times.sunset.toISOString())
  map.light(isNight)
}
if (!memory.read('lighting')) memory.write('lighting', preferred)
document.querySelectorAll('[data-mode]').forEach(
  (b) =>
    (b.onclick = () => {
      preferred = { mode: b.dataset.mode, started: 0 }
      memory.write('lighting', preferred)
      applyLighting()
    })
)
applyLighting()
function updateClock() {
  $('#clock').textContent = time(new Date().toISOString())
  applyLighting()
}
updateClock()
setInterval(updateClock, 15_000)

function stale(key) {
  const f = state.feed[key]
  if (!f?.data || f.stale) return true
  const reference = key === 'ais' ? f.updatedAt : f.data.observedAt
  return Date.now() - Date.parse(reference) > (key === 'ais' ? 13 : 30) * 60_000
}
function status() {
  const f = state.feed.ais,
    el = $('#signal')
  const missing = !f?.data
  const current = !missing && !stale('ais')
  el.className = 'signal ' + (current ? 'ok' : state.checking && missing ? '' : 'warn')
  el.textContent = missing
    ? state.checking
      ? 'Connecting'
      : 'AIS unavailable'
    : current
      ? 'Live feed'
      : 'AIS stale'
  $('#asof').textContent = missing
    ? state.checking
      ? 'Checking for vessel reports'
      : 'Retrying every 10 min'
    : (current ? 'Updated ' : 'Last good ') + (current ? time(f.updatedAt) : dateTime(f.updatedAt))
  $('#ais-credits').textContent = f?.data?.credits?.join(' · ') || ''
}
function chart(samples, shade) {
  if (!samples?.length || samples.length < 2) return ''
  const min = Math.min(...samples.map((s) => s.value)),
    max = Math.max(...samples.map((s) => s.value)),
    range = max - min || 0.1
  const first = samples[0].time,
    span = samples.at(-1).time - first || 1
  const points = samples.map((s) => [
    (2 + ((s.time - first) / span) * 135).toFixed(1),
    (24 - ((s.value - min) / range) * 19).toFixed(1)
  ])
  let path = ''
  points.forEach((p, i) => {
    path += (i && samples[i].time - samples[i - 1].time < 13 * 60_000 ? 'L' : 'M') + p.join(' ')
  })
  const last = points.at(-1)
  return (
    '<svg class="spark" aria-label="Eight hours of observed readings" viewBox="0 0 140 30" preserveAspectRatio="none"><path d="' +
    path +
    '" fill="none" stroke="' +
    shade +
    '" stroke-width="1.6" vector-effect="non-scaling-stroke"/><circle cx="' +
    last[0] +
    '" cy="' +
    last[1] +
    '" r="2.2" fill="' +
    shade +
    '"/></svg>'
  )
}
function renderMeters() {
  for (const [key, label, unit, glyph, shade] of [
    ['tide', 'Water level', 'MLLW', 'wave', '#79cec1'],
    ['gap', 'Ravenel clearance', 'air gap', 'bridge', '#e5a979']
  ]) {
    const f = state.feed[key],
      d = f?.data
    const value = d ? d.value.toFixed(key === 'tide' ? 2 : 1) : 'unknown'
    $('#' + key).innerHTML =
      '<div class="metric-label">' +
      icon(glyph) +
      label +
      '</div><div class="metric-value">' +
      value +
      (d ? '<em> ft</em>' : '') +
      '</div>' +
      chart(d?.samples, shade) +
      '<div class="metric-meta">' +
      (d
        ? stale(key)
          ? 'Stale · ' + esc(dateTime(d.observedAt))
          : esc(time(d.observedAt)) + ' · ' + unit
        : state.checking
          ? 'Checking…'
          : 'Unavailable') +
      '</div>'
  }
}
function markSelection() {
  document
    .querySelectorAll('[data-ship]')
    .forEach((b) => b.classList.toggle('chosen', b.dataset.ship === state.selected))
}
function vesselRow(s) {
  const meta = s.typeLabel + ' · ' + (s.length != null ? s.length + ' m' : 'unknown')
  return (
    '<button class="ship-row" data-ship="' +
    s.mmsi +
    '"><span class="vignette" style="--type:' +
    colors[category(s)] +
    '"><img src="' +
    thumb(s) +
    '" alt=""></span><span class="ship-id"><strong>' +
    esc(pretty(s.name)) +
    '</strong><small>' +
    esc(meta) +
    '</small></span><span class="row-arrow">' +
    icon('next') +
    '</span></button>'
  )
}
function renderList() {
  const panel = $('#listing'),
    scroll = panel.scrollTop
  const exists = !!state.feed.ais?.data
  $('#ships-tab span').textContent = exists ? state.ships.length : '—'
  $('#ships-tab').setAttribute('aria-pressed', String(state.tab === 'ships'))
  $('#term-tab').setAttribute('aria-pressed', String(state.tab === 'terminals'))
  $('#list-help').textContent =
    state.tab === 'ships'
      ? 'Select a vessel to locate it on the map'
      : 'Select a terminal to inspect its berth'
  if (state.tab === 'ships') {
    panel.innerHTML =
      state.ships.map(vesselRow).join('') ||
      '<p class="empty">' +
        (state.checking
          ? 'Listening for ship reports…'
          : exists
            ? 'No eligible vessels reported in the last 30 minutes.'
            : 'Waiting for an AIS position report.') +
        '</p>'
  } else {
    panel.innerHTML = terminals
      .map((t) => {
        const ships = state.ships.filter((s) => s.berth?.id === t.id)
        const open = t.id === state.openTerminal
        return (
          '<div class="term"><button class="terminal-row" data-terminal="' +
          t.id +
          '" aria-expanded="' +
          open +
          '"><span class="anchor">' +
          icon('anchor') +
          '</span><span><strong>' +
          t.name +
          '</strong><small>' +
          t.water +
          '</small></span><b>' +
          (exists ? ships.length : '—') +
          '</b>' +
          icon(open ? 'down' : 'next') +
          '</button>' +
          (open
            ? ships.map(vesselRow).join('') ||
              '<p class="empty small">' +
                (exists ? 'No eligible ships alongside.' : 'AIS unavailable.') +
                '</p>'
            : '') +
          '</div>'
        )
      })
      .join('')
  }
  panel.scrollTop = scroll
  markSelection()
}
$('#listing').onclick = (e) => {
  const ship = e.target.closest('[data-ship]'),
    term = e.target.closest('[data-terminal]')
  if (ship) selectShip(ship.dataset.ship)
  if (term) {
    if (state.openTerminal === term.dataset.terminal) {
      state.openTerminal = null
      renderList()
    } else selectTerminal(term.dataset.terminal)
  }
}
function renderDetail() {
  const s = state.ships.find((s) => s.mmsi === state.selected),
    el = $('#detail')
  el.hidden = !s
  if (!s) return
  const fields = [
    ['Flag', country(s.flag)],
    ['IMO', s.imo],
    ['Length × beam', (s.length ?? 'unknown') + ' × ' + (s.beam ?? 'unknown') + ' m'],
    ['Speed', speed(s)],
    ['Destination', s.destination],
    ['ETA (UTC)', s.eta],
    ['Draught', s.draught == null ? null : s.draught + ' m'],
    ['Heading', s.heading == null ? null : s.heading + '°']
  ]
  const references = (s.sources || [])
    .filter((r) => typeof r.url === 'string' && r.url.startsWith('https://'))
    .map((r) => '<a target="_blank" rel="noreferrer" href="' + esc(r.url) + '">' + esc(r.credit) + '</a>')
  el.innerHTML =
    '<button class="icon-btn detail-close" aria-label="Close vessel details">' +
    icon('close') +
    '</button><div class="detail-art"><img alt="" src="' +
    thumb(s) +
    '"></div><span class="eyebrow">' +
    esc(s.typeLabel) +
    '</span><h2>' +
    esc(pretty(s.name)) +
    '</h2><div class="detail-sub">' +
    esc(statusName(s)) +
    (s.berth ? ' · ' + esc(s.berth.name) : '') +
    '</div><dl>' +
    fields.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + esc(v) + '</dd></div>').join('') +
    '</dl><div class="observed">' +
    (stale('ais') ? 'Stale · ' : '') +
    'Last report ' +
    esc(dateTime(s.seen)) +
    (references.length ? '<br>Particulars · ' + references.join(', ') : '') +
    '</div>'
  el.querySelector('button').onclick = () => selectShip(null)
}
function paint() {
  state.ships = (state.feed.ais?.data?.ships || [])
    .map((s) => {
      const [model, typeLabel] = classify(s)
      return { ...s, model, typeLabel, berth: berth(s) }
    })
    .sort((a, b) => {
      const priority = (s) =>
        s.model === 'other' ? 3 : category(s) === 'workboat' ? 2 : category(s) === 'passenger' ? 1 : 0
      return (
        priority(a) - priority(b) ||
        (b.length || 0) - (a.length || 0) ||
        pretty(a.name).localeCompare(pretty(b.name))
      )
    })
  if (state.selected && !state.ships.some((s) => s.mmsi === state.selected)) {
    state.selected = null
    map.focus(null)
  }
  map.setShips(state.ships, stale('ais'))
  status()
  renderMeters()
  renderList()
  renderDetail()
}
for (const k of ['ais', 'tide', 'gap']) {
  const cached = memory.read(k)
  if (cached?.data) state.feed[k] = { ...cached, stale: true }
}
async function refresh() {
  if (state.checking) return
  state.checking = true
  status()
  try {
    const res = await fetch('/api/harbor', { cache: 'no-store', signal: AbortSignal.timeout(28_000) })
    if (!res.ok) throw Error()
    const body = await res.json()
    for (const k of ['ais', 'tide', 'gap']) {
      const f = body[k],
        old = state.feed[k]
      if (f?.data && (!old?.data || Date.parse(f.data.observedAt) >= Date.parse(old.data.observedAt))) {
        state.feed[k] = f
        memory.write(k, f)
      } else if (old) state.feed[k] = { ...old, stale: true }
    }
  } catch {
    for (const f of Object.values(state.feed)) f.stale = true
  } finally {
    state.checking = false
    state.checked = Date.now()
    paint()
  }
}
paint()
refresh()
setInterval(refresh, 600_000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - (state.checked || 0) >= 600_000) refresh()
})
setInterval(() => {
  status()
  renderMeters()
  const old = stale('ais')
  if (old !== state.wasStale) {
    state.wasStale = old
    map.setShips(state.ships, old)
    renderDetail()
  }
}, 30_000)

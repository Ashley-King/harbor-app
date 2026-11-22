import '@fontsource-variable/manrope/wght.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import SunCalc from 'suncalc';
import { AGING_REPORT, CLASS_NAMES, REFRESH_INTERVAL, isMoving } from '../lib/vessels.js';
import { icon, renderIcons } from './icons.js';
import { HarborMap } from './map.js';
import { berthFor, CHARLESTON, TERMINALS } from './places.js';
import './style.css';

const $ = selector => document.querySelector(selector);
const ZONE = 'America/New_York';
const cacheKey = 'charleston-harbor-feeds-v1';
const clockFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' });
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const timestampFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE });
const countryNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const mobile = matchMedia('(max-width: 720px)');
const panel = $('#harbor-panel');
const card = $('#ship-card');
let selected = null;
let lastFocused = null;
let pending = null;
let lastAttempt = 0;
let solarDate;
let sun;
let firstAutoTransition;
let feeds = {};
let ships = [];

function readStorage(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeStorage(key, value) { try { localStorage.setItem(key, value); } catch { /* Optional offline storage. */ } }
const savedMode = readStorage('charleston-harbor-mode');
let mode = ['auto', 'day', 'night'].includes(savedMode) ? savedMode : 'auto';

renderIcons();
const harbor = new HarborMap($('#map'), id => openShip(id));

function setPanel(open) {
  panel.dataset.collapsed = String(!open);
  $('.panel-toggle').setAttribute('aria-expanded', String(open));
}
setPanel(!mobile.matches);
mobile.addEventListener('change', event => setPanel(!event.matches));
$('.panel-toggle').addEventListener('click', () => {
  setPanel(panel.dataset.collapsed === 'true');
  if (panel.dataset.collapsed === 'false') $('.panel-close').focus();
});
$('.panel-close').addEventListener('click', () => { setPanel(false); $('.panel-toggle').focus(); });
$('#home-view').addEventListener('click', () => harbor.home());
$('#zoom-in').addEventListener('click', () => harbor.map.zoomIn());
$('#zoom-out').addEventListener('click', () => harbor.map.zoomOut());
if (document.fullscreenEnabled) $('#fullscreen').addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await $('.map-shell').requestFullscreen();
});
else $('#fullscreen').hidden = true;

function daylight(now = new Date()) {
  const date = dateFormat.format(now);
  if (date !== solarDate) {
    solarDate = date;
    sun = SunCalc.getTimes(new Date(`${date}T16:00:00Z`), ...CHARLESTON);
    $('#sun-times').textContent = `Sunrise ${timeFormat.format(sun.sunrise)} · Sunset ${timeFormat.format(sun.sunset)}`;
  }
  if (firstAutoTransition === undefined) firstAutoTransition = savedMode ? 0 : now < sun.sunrise ? sun.sunrise : sun.sunset;
  const night = mode === 'night' || mode === 'auto' && (now < firstAutoTransition || now < sun.sunrise || now >= sun.sunset);
  const theme = night ? 'night' : 'day';
  if (document.documentElement.dataset.theme !== theme) {
    document.documentElement.dataset.theme = theme;
    harbor.setTheme(night);
  }
  $('#clock').textContent = clockFormat.format(now);
  $('#clock').dateTime = now.toISOString();
}

for (const button of modeButtons) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    firstAutoTransition = 0;
    writeStorage('charleston-harbor-mode', mode);
    selectMode();
    daylight();
  });
}
function selectMode() {
  for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
}
selectMode();
daylight();
setInterval(daylight, 1000);

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = value;
  return node;
}

function shipButton(ship) {
  const button = el('button', 'ship-link');
  const stale = Date.now() - Date.parse(ship.seen) >= AGING_REPORT;
  button.append(el('span', 'ship-link-name', ship.name ?? 'Unknown vessel'));
  button.append(el('span', 'ship-link-type', stale ? 'Older report' : isMoving(ship) ? `${ship.speed.toFixed(1)} kn` : CLASS_NAMES[ship.category]));
  button.type = 'button';
  button.addEventListener('click', () => openShip(ship.id, true));
  return button;
}

function formatAt(iso, format = timeFormat) {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? format.format(new Date(parsed)) : 'unknown';
}

function openShip(id, pan = false) {
  const ship = ships.find(entry => entry.id === id);
  if (ship && selected !== id) lastFocused = document.activeElement;
  selected = ship?.id ?? null;
  harbor.setSelected(selected);
  if (ship && pan) {
    if (mobile.matches) setPanel(false);
    harbor.focus(ship.position, Math.max(harbor.map.getZoom(), 15.7));
  }
  renderShipCard();
  if (ship && pan) card.querySelector('button')?.focus({ preventScroll: true });
}

function renderShipCard() {
  const ship = ships.find(item => item.id === selected);
  card.hidden = !ship;
  if (!ship) return;
  const heading = el('header');
  const title = el('div');
  title.append(el('p', 'eyebrow', `MMSI ${ship.id}`), el('h2', null, ship.name ?? 'Unknown vessel'));
  const close = el('button', 'inline-icon');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close vessel card');
  close.innerHTML = icon('close');
  close.addEventListener('click', closeShip);
  heading.append(title, close);
  const details = el('dl');
  const aging = feeds.ais?.status !== 'live' || Date.now() - Date.parse(ship.seen) >= AGING_REPORT;
  const size = `${ship.length == null ? 'unknown' : `${ship.length} m`} × ${ship.beam == null ? 'unknown' : `${ship.beam} m`}`;
  const fields = [
    ['Flag', ship.flag ? countryNames.of(ship.flag) ?? ship.flag : null],
    ['IMO', ship.imo],
    ['Type', ship.subtype ?? (ship.type ? `${CLASS_NAMES[ship.category]} · AIS ${ship.type}` : null)],
    ['Length × beam', size],
    ['Speed', ship.speed == null ? null : `${ship.speed.toFixed(1)} kn`],
    ['Destination', ship.destination],
    ['ETA (AIS, UTC)', ship.eta],
    ['Draught', ship.draught == null ? null : `${ship.draught.toFixed(1)} m`],
    ['Last AIS report', `${formatAt(ship.seen, timestampFormat)}${aging ? ' · stale' : ''}`],
  ];
  for (const [label, value] of fields) details.append(el('dt', null, label), el('dd', label.startsWith('Last') && aging ? 'old' : null, value ?? 'unknown'));
  const restoreCloseFocus = card.contains(document.activeElement);
  card.replaceChildren(heading, details);
  if (restoreCloseFocus) close.focus({ preventScroll: true });
}

function closeShip() {
  openShip(null);
  if (lastFocused?.isConnected && lastFocused.getClientRects().length) lastFocused.focus({ preventScroll: true });
  else $('#map').focus({ preventScroll: true });
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && selected) closeShip();
  else if (event.key === 'Escape' && mobile.matches && panel.dataset.collapsed === 'false') {
    setPanel(false);
    $('.panel-toggle').focus();
  }
});

const terminalCards = new Map();
for (const terminal of TERMINALS) {
  const row = el('details', 'terminal');
  const summary = el('summary');
  const anchor = el('span', 'terminal-icon');
  anchor.innerHTML = icon('anchor');
  const arrow = el('span', 'terminal-arrow');
  arrow.innerHTML = icon('chevron');
  const count = el('span', 'terminal-count', '—');
  summary.append(anchor, el('span', 'terminal-name', terminal.name), count, arrow);
  const body = el('div', 'terminal-body');
  row.append(summary, body);
  $('#terminal-list').append(row);
  terminalCards.set(terminal.id, { row, count, body });
}

let openedOccupiedTerminals = false;

function renderAIS() {
  const ais = feeds.ais;
  const status = ais?.status ?? 'loading';
  const hasData = Boolean(ais?.data);
  ships = (ais?.data?.ships ?? []).toSorted((a, b) => Number(b.large) - Number(a.large) || (a.name ?? '').localeCompare(b.name ?? ''));
  const large = ships.filter(ship => ship.large);
  $('#vessel-count').textContent = hasData ? large.length : '—';
  $('#moving-count').textContent = hasData ? large.filter(isMoving).length : '—';
  $('#service-count').textContent = hasData ? ships.length - large.length : '—';
  $('#directory-count').textContent = hasData ? ships.length : '';
  $('#map-dot').dataset.status = $('#footer-dot').dataset.status = status;
  $('#map-feed').textContent = {
    live: ais?.data?.truncated ? 'Live AIS · partial coverage' : 'Live AIS', stale: 'AIS · stale snapshot',
    unavailable: 'AIS unavailable', loading: 'Connecting to AIS',
  }[status];
  $('#last-updated').textContent = hasData
    ? `${status === 'stale' ? 'Stale since last good update' : 'AIS checked'} · ${formatAt(ais.updatedAt, timestampFormat)}`
    : status === 'loading' ? 'Waiting for live reports' : 'AIS unavailable · retry pending';
  harbor.setShips(ships, status !== 'live');
  if (!ships.some(ship => ship.id === selected)) {
    selected = null;
    harbor.setSelected(null);
  }
  renderShipCard();
  const dir = $('#directory');
  dir.replaceChildren(...(ships.length ? ships.map(shipButton) : [el('p', null, hasData ? 'No matching AIS reports in this area.' : 'Waiting for AIS reports.') ]));
  const byTerminal = new Map(TERMINALS.map(t => [t.id, []]));
  for (const ship of large) byTerminal.get(berthFor(ship))?.push(ship);
  for (const terminal of TERMINALS) {
    const entries = byTerminal.get(terminal.id);
    const ui = terminalCards.get(terminal.id);
    ui.count.textContent = hasData ? String(entries.length) : '—';
    if (!openedOccupiedTerminals && status === 'live' && entries.length) ui.row.open = true;
    const jump = el('button', 'terminal-jump', 'Show on map');
    jump.type = 'button';
    jump.addEventListener('click', () => {
      if (mobile.matches) setPanel(false);
      harbor.focus(terminal.wharf[0], 15.1);
    });
    ui.body.replaceChildren(...(entries.length ? entries.map(shipButton) : [el('p', null, hasData ? 'No vessels detected in the berth area.' : 'AIS observations unavailable.')]), jump);
  }
  openedOccupiedTerminals ||= status === 'live';
  const partners = $('#source-partners');
  partners.replaceChildren();
  for (const [enabled, name, href] of [[ais?.data?.aishub, 'AISHub', 'https://www.aishub.net/'], [ais?.data?.aisstream, 'AISStream', 'https://aisstream.io/']]) {
    if (!enabled) continue;
    const link = el('a', null, name);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer';
    partners.append(' · ', link);
  }
}

function renderNOAA(name) {
  const view = $(`#${name}`);
  const feed = feeds[name];
  view.dataset.status = feed?.status ?? 'loading';
  view.querySelector('.reading').textContent = feed?.data ? feed.data.value.toFixed(2) : '—';
  const time = view.querySelector('time');
  if (feed?.data) {
    time.dateTime = feed.data.observedAt;
    time.textContent = `${feed.status === 'stale' ? 'Stale · ' : ''}${formatAt(feed.data.observedAt, feed.status === 'stale' ? timestampFormat : timeFormat)}`;
  } else {
    time.removeAttribute('datetime');
    time.textContent = feed?.status === 'unavailable' ? 'Unavailable' : 'Connecting…';
  }
}

function validFeed(name, feed) {
  if (!feed || !Number.isFinite(Date.parse(feed.updatedAt))) return false;
  return name === 'ais' ? Array.isArray(feed.data?.ships) : Number.isFinite(feed.data?.value) && Number.isFinite(Date.parse(feed.data?.observedAt));
}

function storeSnapshot(result) {
  for (const key of ['ais', 'tide', 'clearance']) {
    const fresh = result[key];
    const previous = feeds[key];
    if (validFeed(key, fresh) && (!previous?.data || fresh.updatedAt >= previous.updatedAt)) feeds[key] = fresh;
    else if (previous?.data) feeds[key] = { ...previous, status: 'stale' };
    else feeds[key] = { status: 'unavailable' };
  }
  writeStorage(cacheKey, JSON.stringify(feeds));
  renderAIS();
  renderNOAA('tide');
  renderNOAA('clearance');
}

try {
  const saved = JSON.parse(readStorage(cacheKey) ?? '{}');
  for (const key of ['ais', 'tide', 'clearance']) if (validFeed(key, saved[key])) feeds[key] = { ...saved[key], status: 'stale' };
} catch { /* An unreadable snapshot can be replaced by live observations. */ }
renderAIS();
renderNOAA('tide');
renderNOAA('clearance');

function refresh() {
  if (pending) return pending;
  lastAttempt = Date.now();
  const button = $('#refresh');
  button.setAttribute('aria-busy', 'true');
  pending = fetch('/api/harbor', { cache: 'no-store', signal: AbortSignal.timeout(16_000) })
    .then(response => {
      if (!response.ok) throw new Error(`Harbor API ${response.status}`);
      return response.json();
    })
    .then(result => storeSnapshot(result.feeds ?? {}), () => storeSnapshot({}))
    .finally(() => { pending = null; button.setAttribute('aria-busy', 'false'); });
  return pending;
}

$('#refresh').addEventListener('click', refresh);
setInterval(refresh, REFRESH_INTERVAL);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastAttempt >= REFRESH_INTERVAL) refresh();
});
refresh();

import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import * as SunCalcNs from 'suncalc';
const SunCalc = SunCalcNs;
import './style.css';
import geo from './geo.json';
import { Scene3D, distToPoly } from './scene3d.js';
import { makeWater } from './water.js';
import { modelClass, CLASS_LABEL, CLASS_COLOR } from './models.js';

const REFRESH_MS = 10 * 60e3;
const TZ = 'America/New_York';
const HARBOR = { lat: 32.79, lon: -79.92 };
const $ = (id) => document.getElementById(id);

// ---------------- map ----------------
maplibregl.setWorkerUrl(workerUrl);
const map = new maplibregl.Map({
  container: 'map',
  attributionControl: false,
  maxPitch: 60,
  bounds: [[-79.99, 32.725], [-79.815, 32.915]],
  fitBoundsOptions: { padding: { top: 20, bottom: 20, left: 20, right: window.innerWidth > 720 ? 390 : 20 } },
  style: {
    version: 8,
    sources: {
      imagery: {
        type: 'raster',
        tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 16,
        attribution: 'Imagery: USGS The National Map',
      },
      terminals: { type: 'geojson', data: { type: 'FeatureCollection', features: geo.terminals.map((t) => ({ type: 'Feature', properties: { name: t.name }, geometry: { type: 'Polygon', coordinates: [t.polygon] } })) } },
      ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0b2633' } },
      { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-fade-duration': 300, 'raster-resampling': 'linear' } },
      { id: 'water-tint', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-color': '#021220', 'fill-opacity': 0.5, 'fill-antialias': true } },
      { id: 'water-glint', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-pattern': 'water-glint', 'fill-opacity': 0.9 } },
      { id: 'terminal-glow', type: 'fill', source: 'terminals', paint: { 'fill-color': '#ffbf73', 'fill-opacity': 0 } },
      { id: 'buildings-night', type: 'fill', source: 'ofm', 'source-layer': 'building', minzoom: 12, paint: { 'fill-color': '#ffcf8a', 'fill-opacity': 0.1 } },
      {
        id: 'roads-night', type: 'line', source: 'ofm', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#ffc27a', ['primary', 'secondary'], '#ffb460', '#f5a04a'],
          'line-opacity': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 0.75, ['secondary', 'tertiary'], 0.55, 0.32],
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, ['match', ['get', 'class'], ['motorway', 'trunk'], 1.6, 0.5], 16, ['match', ['get', 'class'], ['motorway', 'trunk'], 9, ['primary', 'secondary'], 6, 3]],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 4],
        },
      },
    ],
  },
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-left');

const scene = new Scene3D(geo);
let water;
map.on('styleimagemissing', (e) => { if (e.id === 'water-glint' && !water) water = makeWater(map); });
map.on('load', () => {
  if (!water) water = makeWater(map);
  map.addLayer(scene);
  addLabels();
  try { updateMode(); } catch (e) { console.error('mode', e); }
  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(updateMode, 30e3);
  setInterval(renderClock, 1000);
});

// ---------------- labels ----------------
function label(text, lngLat, cls, rotation = 0) {
  const el = document.createElement('div');
  el.className = `label ${cls}`;
  el.textContent = text;
  new maplibregl.Marker({ element: el, rotationAlignment: rotation ? 'map' : 'viewport', rotation }).setLngLat(lngLat).addTo(map);
}
function addLabels() {
  const [a, b] = geo.ravenelMainSpan;
  label('Ravenel Bridge', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.0028], 'bridge');
  const dh = geo.donHoltOutline.slice(0, -1);
  label('Don Holt Bridge', [dh.reduce((s, p) => s + p[0], 0) / dh.length, dh.reduce((s, p) => s + p[1], 0) / dh.length + 0.0025], 'bridge');
  const offsets = { 'Wando Welch Terminal': [0.006, 0], 'North Charleston Terminal': [-0.004, 0.002], 'Leatherman Terminal': [-0.004, 0.001], 'Columbus Street Terminal': [-0.003, 0.0015] };
  for (const t of geo.terminals) {
    const p = t.polygon.slice(0, -1);
    const c = [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
    const o = offsets[t.name] || [0, 0];
    label(t.name.replace(' Terminal', ''), [c[0] + o[0], c[1] + o[1]], 'terminal');
  }
  // Shipping channel along the OSM recommended track (entrance reach and harbor reach)
  for (const seg of [[[-79.8666507, 32.758787], [-79.8457146, 32.7393676]], [[-79.8882812, 32.7722105], [-79.913582, 32.7833998]], [[-79.896993, 32.8273666], [-79.9131882, 32.8127061]]]) {
    const [p, q] = seg;
    const brg = (Math.atan2((q[0] - p[0]) * Math.cos(32.78 * Math.PI / 180), q[1] - p[1]) * 180) / Math.PI;
    let rot = brg - 90;
    while (rot > 90) rot -= 180;
    while (rot <= -90) rot += 180;
    label('Shipping Channel', [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], 'channel', rot);
  }
}

// ---------------- day / night ----------------
let modePref = 'auto';
let isNight = true;
function sunVector(date) {
  const p = SunCalc.getPosition(date, HARBOR.lat, HARBOR.lon);
  const b = p.azimuth + Math.PI;
  return { vec: new THREE.Vector3(Math.sin(b) * Math.cos(p.altitude), Math.cos(b) * Math.cos(p.altitude), Math.sin(p.altitude)), altitude: p.altitude };
}
function updateMode() {
  const now = new Date();
  const t = SunCalc.getTimes(now, HARBOR.lat, HARBOR.lon);
  const sunUp = now >= t.sunrise && now < t.sunset;
  isNight = modePref === 'auto' ? !sunUp : modePref === 'night';
  let { vec, altitude } = sunVector(now);
  if (altitude < 0.35) vec = sunVector(new Date(t.solarNoon.getTime() - 2.5 * 3600e3)).vec; // manual day at night: mid-morning sun
  document.body.classList.toggle('day', !isNight);
  const fmt = (d) => d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const tomorrow = SunCalc.getTimes(new Date(now.getTime() + 86400e3), HARBOR.lat, HARBOR.lon);
  $('sunline').textContent = sunUp
    ? `Sunset ${fmt(t.sunset)} · Charleston time`
    : `Sunrise ${fmt(now < t.sunrise ? t.sunrise : tomorrow.sunrise)} · Charleston time`;
  if (!map.getLayer('imagery')) return;
  const tr = { duration: 1500 };
  const P = (l, k, v) => { map.setPaintProperty(l, `${k}-transition`, tr); map.setPaintProperty(l, k, v); };
  if (isNight) {
    P('imagery', 'raster-brightness-max', 0.33); P('terminal-glow', 'fill-opacity', 0.16); P('imagery', 'raster-saturation', -0.65); P('imagery', 'raster-contrast', 0.15);
    P('water-tint', 'fill-color', '#010a14'); P('water-tint', 'fill-opacity', 0.62); P('bg', 'background-color', '#02060b');
    P('water-glint', 'fill-opacity', 0.75);
    map.setLayoutProperty('roads-night', 'visibility', 'visible');
    map.setLayoutProperty('buildings-night', 'visibility', 'visible');
  } else {
    P('imagery', 'raster-brightness-max', 1); P('terminal-glow', 'fill-opacity', 0); P('imagery', 'raster-saturation', 0.08); P('imagery', 'raster-contrast', 0.05);
    P('water-tint', 'fill-color', '#0d3d52'); P('water-tint', 'fill-opacity', 0.22); P('bg', 'background-color', '#24505c');
    P('water-glint', 'fill-opacity', 0.85);
    map.setLayoutProperty('roads-night', 'visibility', 'none');
    map.setLayoutProperty('buildings-night', 'visibility', 'none');
  }
  scene.setLighting(isNight, vec);
  water?.set(isNight, vec);
}
document.querySelectorAll('.mode button').forEach((b) =>
  b.addEventListener('click', () => {
    modePref = b.dataset.mode;
    document.querySelectorAll('.mode button').forEach((x) => x.classList.toggle('on', x === b));
    updateMode();
  })
);

// ---------------- data ----------------
const state = { ais: null, tide: null, airGap: null, tidePred: null, lastAttempt: null, lastAttemptOk: true, nextAt: Date.now() + REFRESH_MS };

function mergeSource(key, src) {
  const prev = state[key];
  if (src && src.ok && src.data) state[key] = { data: src.data, fetchedAt: src.fetchedAt, stale: false };
  else if (src && src.data && (!prev || src.fetchedAt > prev.fetchedAt)) state[key] = { data: src.data, fetchedAt: src.fetchedAt, stale: true, error: src.error };
  else if (prev) state[key] = { ...prev, stale: true, error: src?.error || 'unreachable' };
}

async function refresh() {
  state.lastAttempt = new Date();
  state.nextAt = Date.now() + REFRESH_MS;
  let j = null;
  try {
    const r = await fetch('/api/harbor', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    j = await r.json();
    state.lastAttemptOk = true;
  } catch (e) {
    state.lastAttemptOk = false;
    console.warn('refresh failed', e);
  }
  for (const k of ['ais', 'tide', 'airGap', 'tidePred']) mergeSource(k, j?.[k]);
  if (j?.ais?.ok && state.ais) scene.setVessels(state.ais.data.vessels);
  renderPanel();
}

// ---------------- panel ----------------
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fmtDateTime = (d) => new Date(d).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ago = (d) => {
  const m = Math.round((Date.now() - new Date(d)) / 60e3);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min ago` : `${Math.floor(m / 1440)} d ago`;
};

function renderClock() {
  const a = state.ais;
  const anyStale = ['ais', 'tide', 'airGap'].some((k) => state[k]?.stale) || !state.lastAttemptOk;
  $('liveDot').classList.toggle('stale', anyStale);
  const left = Math.max(0, state.nextAt - Date.now());
  const next = `next ${Math.floor(left / 60e3)}:${String(Math.floor((left % 60e3) / 1000)).padStart(2, '0')}`;
  $('updated').textContent = a ? `Updated ${fmtTime(a.fetchedAt)} · ${next}` : state.lastAttempt ? `No data yet · retry ${next}` : 'Loading live data…';
}

function terminalOf(v) {
  const p = scene.toLocal(v.lon, v.lat);
  let best = null, bd = 380;
  for (const t of scene.terminalPolys || []) {
    const d = distToPoly(p, t.local);
    if (d < bd) { bd = d; best = t.name; }
  }
  return best;
}

function renderPanel() {
  renderClock();
  // tide
  const tide = state.tide, pred = state.tidePred?.data;
  if (tide) {
    $('tideValue').textContent = `${tide.data.feet.toFixed(1)} ft`;
    let trend = '';
    if (pred) {
      const next = pred.find((p) => Date.parse(p.time) > Date.now());
      if (next) trend = `${next.type === 'H' ? 'Rising' : 'Falling'} · ${next.type === 'H' ? 'high' : 'low'} ${next.feet.toFixed(1)} ft at ${fmtTime(next.time)}<br>`;
    }
    $('tideMeta').innerHTML = `${trend}MLLW · read ${fmtTime(tide.data.time)}${tide.stale ? ` <span class="stale-tag">stale</span>` : ''}`;
  } else $('tideMeta').textContent = 'unknown (feed unavailable)';
  const air = state.airGap;
  if (air) {
    $('airValue').textContent = `${air.data.feet.toFixed(1)} ft`;
    $('airMeta').innerHTML = `Air gap, NOAA sensor<br>read ${fmtTime(air.data.time)}${air.stale ? ` <span class="stale-tag">stale</span>` : ''}`;
  } else $('airMeta').textContent = 'unknown (feed unavailable)';

  // feed warnings
  const warns = [];
  for (const [k, label] of [['ais', 'Ship positions'], ['tide', 'Tide'], ['airGap', 'Ravenel air gap']]) {
    const s = state[k];
    if (!s) warns.push(`${label}: no data yet, retrying every 10 min.`);
    else if (s.stale) warns.push(`${label}: feed failed (${s.error}). Showing last good data from ${fmtDateTime(s.fetchedAt)}.`);
  }
  $('feedWarn').hidden = !warns.length;
  $('feedWarn').innerHTML = warns.join('<br>');

  // ship lists
  const vessels = state.ais?.data.vessels || [];
  const groups = { 'Wando Welch Terminal': [], 'North Charleston Terminal': [], 'Leatherman Terminal': [], 'Columbus Street Terminal': [], 'Under way': [], 'At anchor': [], 'Other berths': [], 'Tugs & pilot boats': [] };
  for (const v of vessels) {
    if (v.category !== 'large') { groups['Tugs & pilot boats'].push(v); continue; }
    const t = terminalOf(v);
    const moving = (v.sog ?? 0) >= 0.5;
    if (moving) groups['Under way'].push(v);
    else if (t) groups[t].push(v);
    else if (v.nav_status === 1) groups['At anchor'].push(v);
    else groups['Other berths'].push(v);
  }
  const html = Object.entries(groups).map(([name, list]) => {
    list.sort((a, b) => (b.length ?? 0) - (a.length ?? 0));
    const rows = list.map((v) => {
      const cls = modelClass(v);
      const size = v.length ? `${v.length} m` : 'size unknown';
      const spd = (v.sog ?? 0) >= 0.5 ? ` · ${v.sog.toFixed(1)} kn` : '';
      return `<div class="ship-row${scene.selected === v.mmsi ? ' sel' : ''}" data-mmsi="${v.mmsi}"><span class="sw" style="background:${CLASS_COLOR[cls]}"></span><span class="nm">${esc(v.name || `MMSI ${v.mmsi}`)}</span><span class="mt">${CLASS_LABEL[cls]} · ${size}${spd}</span></div>`;
    }).join('');
    const isTerminal = name.endsWith('Terminal');
    if (!list.length && !isTerminal) return '';
    return `<div class="group"><h2><span>${name}</span><span>${list.length}</span></h2>${rows || '<div class="empty">No large ships</div>'}</div>`;
  }).join('');
  $('lists').innerHTML = html;
  $('lists').querySelectorAll('.ship-row').forEach((el) => el.addEventListener('click', () => select(Number(el.dataset.mmsi), true)));
  if (scene.selected) renderCard();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------------- ship card ----------------
const NAV = { 0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command', 3: 'Restricted manoeuvrability', 4: 'Constrained by draught', 5: 'Moored', 6: 'Aground', 7: 'Engaged in fishing', 8: 'Under way sailing', 11: 'Towing astern', 12: 'Pushing ahead / towing alongside', 14: 'AIS-SART active' };
function aisType(t) {
  if (t == null) return 'unknown';
  const fixed = { 30: 'Fishing', 31: 'Towing', 32: 'Towing (large)', 33: 'Dredging', 34: 'Diving ops', 35: 'Military', 36: 'Sailing', 37: 'Pleasure craft', 50: 'Pilot vessel', 51: 'Search and rescue', 52: 'Tug', 53: 'Port tender', 55: 'Law enforcement', 58: 'Medical transport' };
  if (fixed[t]) return `${fixed[t]} (${t})`;
  const base = { 4: 'High-speed craft', 6: 'Passenger', 7: 'Cargo', 8: 'Tanker', 9: 'Other' }[Math.floor(t / 10)];
  const hz = { 1: ', hazardous cat. A', 2: ', hazardous cat. B', 3: ', hazardous cat. C', 4: ', hazardous cat. D' }[t % 10] || '';
  return base ? `${base}${hz} (${t})` : `Type ${t}`;
}
const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
function flagText(code) {
  if (!code) return 'unknown';
  let name = code;
  try { name = regionNames?.of(code) || code; } catch { /* keep code */ }
  const emoji = /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '';
  return `${emoji} ${name}`.trim();
}
function etaText(eta) {
  if (!eta) return 'unknown';
  const m = /^(\d\d)-(\d\d) (\d\d):(\d\d)$/.exec(eta);
  if (!m) return esc(eta);
  return `${esc(eta)} UTC`;
}
const U = (v, f = (x) => x) => (v == null || v === '' ? 'unknown' : f(v));

function renderCard() {
  const v = state.ais?.data.vessels.find((x) => x.mmsi === scene.selected);
  const card = $('card');
  if (!v) { card.hidden = true; return; }
  const cls = modelClass(v);
  card.innerHTML = `
    <button class="icon-btn close" aria-label="Close">✕</button>
    <h3>${esc(v.name || 'Name unknown')}</h3>
    <div class="kind">${CLASS_LABEL[cls]} · ${v.callsign ? esc(v.callsign) + ' · ' : ''}MMSI ${v.mmsi}</div>
    <dl>
      <dt>Flag</dt><dd>${flagText(v.flag)}</dd>
      <dt>IMO</dt><dd>${U(v.imo)}</dd>
      <dt>Type</dt><dd>${aisType(v.type)}</dd>
      <dt>Length × beam</dt><dd>${v.length && v.beam ? `${v.length} × ${v.beam} m` : `${U(v.length, (x) => x + ' m')} × ${U(v.beam, (x) => x + ' m')}`}</dd>
      <dt>Speed</dt><dd>${U(v.sog, (x) => `${x.toFixed(1)} kn`)}${v.cog != null && (v.sog ?? 0) >= 0.5 ? ` · course ${Math.round(v.cog)}°` : ''}</dd>
      <dt>Status</dt><dd>${U(NAV[v.nav_status])}</dd>
      <dt>Destination</dt><dd>${U(v.destination, esc)}</dd>
      <dt>ETA</dt><dd>${etaText(v.eta)}</dd>
      <dt>Draught</dt><dd>${U(v.draught, (x) => `${x} m`)}</dd>
      <dt>Last report</dt><dd>${fmtDateTime(v.seen)} (${ago(v.seen)})</dd>
    </dl>
    <div class="note">Model drawn from AIS type, name and size. Moving ships replay their real AIS track about 10 minutes behind live.</div>`;
  card.hidden = false;
  card.querySelector('.close').addEventListener('click', () => select(null));
}

function select(mmsi, fly = false) {
  scene.selected = mmsi;
  if (!mmsi) { $('card').hidden = true; renderPanel(); return; }
  renderPanel();
  if (fly) {
    const ll = scene.shipLngLat(mmsi);
    if (ll) map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 15), duration: 1800 });
  }
}

function metersPerPixel() {
  return (40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
}
map.on('click', (e) => select(scene.pick(e.lngLat, metersPerPixel())));
let hoverPending = false;
map.on('mousemove', (e) => {
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    map.getCanvas().style.cursor = scene.pick(e.lngLat, metersPerPixel()) ? 'pointer' : '';
  });
});

// panel collapse
$('collapse').addEventListener('click', () => { $('panel').classList.add('collapsed'); $('expand').hidden = false; });
$('expand').addEventListener('click', () => { $('panel').classList.remove('collapsed'); $('expand').hidden = true; });
setInterval(() => { if (scene.selected) renderCard(); }, 30e3);

// Handy for inspecting the live state from the browser console.
window.harbor = { map, scene, state };

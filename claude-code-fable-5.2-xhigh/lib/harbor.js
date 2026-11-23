// The three live feeds the page needs, gathered in one call, each with its own status:
//   ais    - vessels in the Charleston Harbor box (Open Waters AIS)
//   tide   - observed water level and tide predictions (NOAA CO-OPS 8665530)
//   airGap - clearance under the Ravenel Bridge (NOAA CO-OPS 8665353)
// No source needs a key. If a source fails, its block says ok:false. When this warm
// instance still holds the last good answer it is returned too, marked stale with its
// original time.
//
// This file uses only fetch and plain JavaScript, so the same code runs as a Vercel
// function (api/harbor.js) and as a Cloudflare Worker (worker/index.js).

import { hullDimensions, vesselGroup, num, cleanText } from './vessels.js';

const UA = 'harbor-bench/1.0';
const AIS_BASE = 'https://ais.openwaters.io/v1/vessels';
const AIS_URL = `${AIS_BASE}?bbox=32.70,-80.05,32.95,-79.75`;
const NOAA = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const TIDE_STATION = '8665530';
const AIRGAP_STATION = '8665353';
const TRACK_MINUTES = 25;
const MAX_TRACKS = 40;            // a host with a tighter limit on outgoing calls passes a lower number

const lastGood = { ais: null, tide: null, airGap: null };

async function getJson(url, { timeout = 12000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err.name === 'AbortError' ? new Error('timed out') : err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- AIS

function normalizeVessel(f) {
  const p = f.properties || {};
  const c = f.geometry && f.geometry.coordinates;
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  const dims = hullDimensions(p);
  const type = num(p.type) || null;
  const heading = num(p.heading);
  return {
    mmsi: p.mmsi ?? f.id,
    kind: p.kind || 'vessel',
    name: cleanText(p.name),
    callsign: cleanText(p.callsign),
    flag: cleanText(p.flag),
    imo: validImo(p.imo),
    type,
    group: vesselGroup(type, dims.length),
    ...dims,
    lon: c[0],
    lat: c[1],
    sog: num(p.sog),
    cog: num(p.cog),
    heading: heading != null && heading >= 0 && heading < 360 ? heading : null,
    navStatus: num(p.nav_status),
    destination: cleanText(p.destination),
    eta: cleanText(p.eta),
    draught: num(p.draught) > 0 ? num(p.draught) : null,
    seen: p.seen || null,
    source: p.source || null,
  };
}

// IMO numbers are seven digits with a check digit. Anything else is a typing error
// in the transponder, so it is dropped and shown as unknown.
function validImo(v) {
  const n = num(v);
  if (n == null) return null;
  const s = String(Math.trunc(n));
  if (s.length !== 7) return null;
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Number(s[i]) * (7 - i);
  return sum % 10 === Number(s[6]) ? Number(s) : null;
}

async function fetchTrack(mmsi, fromIso) {
  const url = `${AIS_BASE}/${String(mmsi).padStart(9, '0')}/track?from=${encodeURIComponent(fromIso)}&interval=20`;
  const d = await getJson(url, { timeout: 9000, retries: 0 });
  const g = d.geometry;
  const pr = d.properties || {};
  if (!g || !pr.times) return [];
  const coords = g.type === 'Point' ? [g.coordinates] : g.coordinates;
  const out = [];
  for (let i = 0; i < coords.length; i++) {
    const t = Date.parse(pr.times[i]);
    if (!Number.isFinite(t)) continue;
    const hd = pr.heading ? num(pr.heading[i]) : null;
    out.push([
      Math.round(t / 1000),
      Math.round(coords[i][1] * 1e6) / 1e6,
      Math.round(coords[i][0] * 1e6) / 1e6,
      pr.sog ? num(pr.sog[i]) : null,
      pr.cog ? num(pr.cog[i]) : null,
      hd != null && hd >= 0 && hd < 360 ? hd : null,
    ]);
  }
  return out;
}

async function loadAis(maxTracks) {
  const d = await getJson(AIS_URL);
  if (!d || !Array.isArray(d.features)) throw new Error('unexpected response');
  const vessels = d.features.filter((f) => (f.properties?.kind || 'vessel') === 'vessel').map(normalizeVessel).filter(Boolean);

  // Real track for vessels that are under way, so the page can move them along the
  // path they actually took instead of a straight line between two reports.
  const now = Date.now();
  // Large ships first, then tugs and pilot boats, then the fastest small craft.
  const rank = { ship: 0, tug: 1, pilot: 1, other: 2 };
  const moving = vessels
    .filter((v) => v.sog != null && v.sog >= (v.group === 'other' ? 1.5 : 0.4) && v.seen && now - Date.parse(v.seen) < 30 * 60000)
    .sort((a, b) => rank[a.group] - rank[b.group] || b.sog - a.sog)
    .slice(0, maxTracks);
  const fromIso = new Date(now - TRACK_MINUTES * 60000).toISOString().replace(/\.\d+Z$/, 'Z');
  let tracksFailed = 0;
  await Promise.all(moving.map(async (v) => {
    try {
      v.track = await fetchTrack(v.mmsi, fromIso);
    } catch {
      tracksFailed++;
    }
  }));

  const attribution = [...new Set(Object.values(d.attribution || {}).flatMap((s) => String(s).split('. ')).map((s) => s.replace(/\.$/, '').trim()).filter(Boolean))];
  return { count: vessels.length, truncated: !!d.truncated, attribution, tracks: moving.length - tracksFailed, tracksFailed, vessels };
}

// ---------------------------------------------------------------- NOAA

function noaaUrl(params) {
  const q = new URLSearchParams({ application: 'harbor-bench', time_zone: 'gmt', units: 'english', format: 'json', ...params });
  return `${NOAA}?${q}`;
}

const noaaTime = (t) => `${t.replace(' ', 'T')}:00Z`;

function yyyymmddhhmm(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function readSeries(d) {
  if (d && d.error) throw new Error(d.error.message || 'NOAA error');
  const rows = (d && (d.data || d.predictions)) || [];
  return rows
    .map((r) => ({ t: noaaTime(r.t), ft: num(r.v), type: r.type }))
    .filter((r) => r.ft != null);
}

async function loadTide() {
  const now = Date.now();
  const [obs, hilo, curve] = await Promise.all([
    getJson(noaaUrl({ product: 'water_level', station: TIDE_STATION, datum: 'MLLW', range: '6' })),
    getJson(noaaUrl({ product: 'predictions', station: TIDE_STATION, datum: 'MLLW', interval: 'hilo', begin_date: yyyymmddhhmm(now - 7 * 3600e3), range: '38' })).catch(() => null),
    getJson(noaaUrl({ product: 'predictions', station: TIDE_STATION, datum: 'MLLW', interval: '30', begin_date: yyyymmddhhmm(now - 6 * 3600e3), range: '24' })).catch(() => null),
  ]);
  const series = readSeries(obs);
  if (!series.length) throw new Error('no water level data');
  const latest = series[series.length - 1];
  // Trend from the last hour of observations.
  const hourAgo = Date.parse(latest.t) - 3600e3;
  const first = series.find((r) => Date.parse(r.t) >= hourAgo) || series[0];
  const hours = (Date.parse(latest.t) - Date.parse(first.t)) / 3600e3;
  const ftPerHour = hours > 0.2 ? (latest.ft - first.ft) / hours : null;
  const all = hilo ? safe(() => readSeries(hilo)) : null;
  return {
    station: TIDE_STATION,
    stationName: obs.metadata?.name || 'Charleston',
    datum: 'MLLW',
    level: { t: latest.t, ft: latest.ft },
    ftPerHour,
    observed: series.filter((_, i) => i % 2 === 0 || i === series.length - 1).map((r) => [r.t, r.ft]),
    hilo: all ? all.map((r) => ({ t: r.t, ft: r.ft, type: r.type === 'H' ? 'high' : 'low' })) : null,
    predicted: curve ? safe(() => readSeries(curve).map((r) => [r.t, r.ft])) : null,
  };
}

async function loadAirGap() {
  const d = await getJson(noaaUrl({ product: 'air_gap', station: AIRGAP_STATION, range: '1' }));
  const series = readSeries(d);
  if (!series.length) throw new Error('no air gap data');
  const latest = series[series.length - 1];
  const first = series[0];
  const hours = (Date.parse(latest.t) - Date.parse(first.t)) / 3600e3;
  return {
    station: AIRGAP_STATION,
    stationName: d.metadata?.name || 'Ravenel Bridge Air Gap',
    value: { t: latest.t, ft: latest.ft },
    ftPerHour: hours > 0.2 ? (latest.ft - first.ft) / hours : null,
  };
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- all three

async function feed(name, loader) {
  const fetchedAt = new Date().toISOString();
  try {
    const data = await loader();
    const block = { ok: true, fetchedAt, ...data };
    lastGood[name] = block;
    return block;
  } catch (err) {
    const block = { ok: false, fetchedAt, error: String(err && err.message ? err.message : err).slice(0, 200) };
    if (lastGood[name]) block.lastGood = { ...lastGood[name], ok: false, stale: true };
    return block;
  }
}

/** Fetch every feed now. Never throws: a failed feed is reported inside its own block. */
export async function harborFeeds({ maxTracks = MAX_TRACKS } = {}) {
  const [ais, tide, airGap] = await Promise.all([feed('ais', () => loadAis(maxTracks)), feed('tide', loadTide), feed('airGap', loadAirGap)]);
  return { generatedAt: new Date().toISOString(), ais, tide, airGap };
}

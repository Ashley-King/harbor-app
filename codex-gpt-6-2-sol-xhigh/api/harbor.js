import { AIS_BOUNDS, normalizeVessel } from '../lib/vessels.js';

const USER_AGENT = 'harbor-bench/1.0';
const AIS_URL = `https://ais.openwaters.io/v1/vessels?bbox=${AIS_BOUNDS.flat().map(x => x.toFixed(2)).join(',')}&max_age=90m`;
const NOAA_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const lastGood = new Map();
let inFlight;

async function json(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/geo+json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json();
}

async function vessels() {
  const body = await json(AIS_URL);
  if (body.type !== 'FeatureCollection' || !Array.isArray(body.features)) throw new Error('Invalid AIS response');
  const ships = new Map();
  const now = Date.now();
  for (const feature of body.features) {
    const ship = normalizeVessel(feature, now);
    if (ship && (!ships.has(ship.id) || ships.get(ship.id).seen < ship.seen)) ships.set(ship.id, ship);
  }
  return {
    ships: [...ships.values()],
    truncated: body.truncated === true,
    aishub: Object.hasOwn(body.attribution ?? {}, 'aishub'),
    aisstream: Object.hasOwn(body.attribution ?? {}, 'aisstream'),
  };
}

async function observation(station, product, datum) {
  const query = new URLSearchParams({
    station, product, date: 'latest', time_zone: 'gmt', units: 'english',
    format: 'json', application: 'harbor-bench',
  });
  if (datum) query.set('datum', datum);
  const body = await json(`${NOAA_URL}?${query}`);
  const observations = Array.isArray(body.data) ? body.data : [];
  const readings = observations.flatMap(row => {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(row.t ?? '') || !String(row.v ?? '').trim()) return [];
    const observedAt = Date.parse(`${row.t.replace(' ', 'T')}:00Z`);
    const value = Number(row.v);
    return Number.isFinite(observedAt) && observedAt <= Date.now() + 60_000 && Number.isFinite(value)
      ? [{ value, observedAt: new Date(observedAt).toISOString() }] : [];
  });
  if (!readings.length) throw new Error('NOAA observation unavailable');
  return readings.sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
}

async function feed(name, load) {
  try {
    const data = await load();
    const result = { status: 'live', updatedAt: new Date().toISOString(), data };
    lastGood.set(name, result);
    return result;
  } catch (error) {
    console.warn(`[${name}] ${error.name}: ${error.message}`);
    const previous = lastGood.get(name);
    return previous ? { ...previous, status: 'stale' } : { status: 'unavailable', updatedAt: null, data: null };
  }
}

async function snapshot() {
  const [ais, tide, clearance] = await Promise.all([
    feed('ais', vessels),
    feed('tide', () => observation('8665530', 'water_level', 'MLLW')),
    feed('clearance', () => observation('8665353', 'air_gap')),
  ]);
  return { checkedAt: new Date().toISOString(), feeds: { ais, tide, clearance } };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  inFlight ??= snapshot().finally(() => { inFlight = undefined; });
  res.end(JSON.stringify(await inFlight));
}

// The slower feeds behind the optional layers, gathered in one call, each with its
// own status like the feeds in harbor.js:
//   weather  - wind, water and air temperature, pressure (NOAA CO-OPS 8665530)
//   currents - predicted tidal currents at eight stations along the channel (NOAA CO-OPS)
//   marine   - active marine alerts and the harbor forecast (National Weather Service)
//   inbound  - ships offshore that are heading for the jetties (Open Waters AIS)
//   dolphins - recent bottlenose dolphin sightings in the harbor (iNaturalist)
// No source needs a key. Each list is trimmed to the fields the page shows.

import { getJson, feed, noaaUrl, yyyymmddhhmm, aisVessels } from './harbor.js';
import { num, cleanText } from './vessels.js';

const TIDE_STATION = '8665530';
const NWS = 'https://api.weather.gov';
const NWS_OFFICE = 'CHS';
const NWS_ZONE_NAME = 'Charleston Harbor';
const NWS_ZONE_FALLBACK = 'AMZ340';
const INAT = 'https://api.inaturalist.org/v1/observations';
// The harbor box the map covers, and the stretch of ocean in front of it.
const HARBOR_BOX = { south: 32.7, west: -80.05, north: 32.95, east: -79.75 };
const OFFSHORE_BBOX = '32.25,-79.80,32.85,-79.00';
// The seaward end of the jetties, where a ship enters the harbor.
const ENTRANCE = { lat: 32.7175, lon: -79.8 };

// NOAA tidal current prediction stations, from the sea to the terminals.
const CURRENT_STATIONS = [
  { id: 'ACT6636', name: 'Harbor entrance, between the jetties', lat: 32.7333, lon: -79.8333 },
  { id: 'ACT6651', name: 'Off Fort Sumter', lat: 32.756, lon: -79.8703 },
  { id: 'ACT6701', name: 'Customhouse Reach', lat: 32.782, lon: -79.92 },
  { id: 'ACT6751', name: 'Hog Island Reach', lat: 32.794, lon: -79.915 },
  { id: 'ACT6761', name: 'Under the Ravenel Bridge', lat: 32.804, lon: -79.915 },
  { id: 'ACT6781', name: 'Daniel Island Reach', lat: 32.827, lon: -79.929 },
  { id: 'ACT6906', name: 'Wando River turning basin', lat: 32.833, lon: -79.897 },
  { id: 'ACT6806', name: 'North Charleston', lat: 32.864, lon: -79.959 },
];

const D2R = Math.PI / 180;
const iso = (t) => `${String(t).replace(' ', 'T')}:00Z`;

/** Great-circle distance in nautical miles. */
export function distanceNm(a, b) {
  const dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b in degrees. */
export function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * D2R) * Math.cos(b.lat * D2R);
  const x = Math.cos(a.lat * D2R) * Math.sin(b.lat * D2R) - Math.sin(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.cos((b.lon - a.lon) * D2R);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

// ---------------------------------------------------------------- weather

async function loadWeather() {
  const latest = async (product) => {
    const d = await getJson(noaaUrl({ product, station: TIDE_STATION, date: 'latest' }), { retries: 0 });
    const row = d && d.data && d.data[0];
    if (!row) throw new Error('no reading');
    return row;
  };
  const [wind, water, air, pressure] = await Promise.all(['wind', 'water_temperature', 'air_temperature', 'air_pressure'].map((p) => latest(p).catch(() => null)));
  if (!wind && !water && !air && !pressure) throw new Error('no weather readings');
  return {
    station: TIDE_STATION,
    wind: wind && num(wind.s) != null ? { t: iso(wind.t), kn: num(wind.s), deg: num(wind.d), from: cleanText(wind.dr), gustKn: num(wind.g) } : null,
    waterF: water && num(water.v) != null ? { t: iso(water.t), f: num(water.v) } : null,
    airF: air && num(air.v) != null ? { t: iso(air.t), f: num(air.v) } : null,
    pressureMb: pressure && num(pressure.v) != null ? { t: iso(pressure.t), mb: num(pressure.v) } : null,
  };
}

// ---------------------------------------------------------------- currents

async function loadCurrents() {
  const begin = yyyymmddhhmm(Date.now() - 8 * 3600e3);
  const stations = await Promise.all(CURRENT_STATIONS.map(async (s) => {
    try {
      const d = await getJson(noaaUrl({ product: 'currents_predictions', station: s.id, bin: '1', interval: 'MAX_SLACK', begin_date: begin, range: '30' }), { retries: 0 });
      const rows = (d && d.current_predictions && d.current_predictions.cp) || [];
      // Each row is a slack or a peak. Speed is signed: flood positive, ebb negative.
      const events = rows.map((r) => [iso(r.Time), num(r.Velocity_Major)]).filter((e) => e[1] != null);
      if (events.length < 2) return null;
      return { ...s, floodDeg: num(rows[0].meanFloodDir), ebbDeg: num(rows[0].meanEbbDir), events };
    } catch {
      return null;
    }
  }));
  const good = stations.filter(Boolean);
  if (!good.length) throw new Error('no current predictions');
  return { stations: good };
}

// ---------------------------------------------------------------- marine weather

/** The harbor's own section of the coastal waters forecast: its zone code and the first periods. */
function harborForecast(text) {
  const at = text.indexOf(`\n${NWS_ZONE_NAME}-`);
  if (at < 0) return null;
  const head = text.lastIndexOf('\n', at - 1);
  const zone = /^([A-Z]{2}Z\d{3})/.exec(text.slice(head + 1, at));
  const end = text.indexOf('$$', at);
  const body = text.slice(at, end < 0 ? undefined : end);
  const periods = [];
  for (const part of body.split(/\n\./).slice(1)) {
    const m = /^([A-Z][A-Z ]+?)\.\.\.([\s\S]*)$/.exec(part);
    if (m) periods.push({ name: m[1].trim(), text: m[2].replace(/\s+/g, ' ').trim().slice(0, 300) });
  }
  return { zone: zone ? zone[1] : null, periods: periods.slice(0, 3) };
}

async function loadMarine() {
  let forecast = null;
  try {
    const list = await getJson(`${NWS}/products/types/CWF/locations/${NWS_OFFICE}`, { accept: 'application/ld+json', retries: 0 });
    const newest = list && list['@graph'] && list['@graph'][0];
    if (newest && /^[\w-]+$/.test(newest.id)) {
      const product = await getJson(`${NWS}/products/${newest.id}`, { accept: 'application/ld+json', retries: 0 });
      forecast = harborForecast(String(product.productText || ''));
      if (forecast) forecast.issued = product.issuanceTime || null;
    }
  } catch {
    /* the alerts below still work without the forecast */
  }
  const zone = (forecast && forecast.zone) || NWS_ZONE_FALLBACK;
  const d = await getJson(`${NWS}/alerts/active?zone=${zone}`, { accept: 'application/geo+json' });
  if (!d || !Array.isArray(d.features)) throw new Error('unexpected response');
  const alerts = d.features.map((f) => f.properties || {}).filter((p) => p.event).map((p) => ({
    event: cleanText(p.event),
    severity: cleanText(p.severity),
    headline: cleanText(p.headline),
    onset: p.onset || p.effective || null,
    ends: p.ends || p.expires || null,
    text: String(p.description || '').replace(/[ \t]*\n[ \t]*/g, '\n').trim().slice(0, 900),
    instruction: String(p.instruction || '').replace(/\s+/g, ' ').trim().slice(0, 400) || null,
  }));
  return { zone, alerts, forecast: forecast && forecast.periods.length ? forecast : null };
}

// ---------------------------------------------------------------- ships arriving from sea

async function loadInbound() {
  const { vessels } = await aisVessels(OFFSHORE_BBOX);
  const now = Date.now();
  const ships = [];
  for (const v of vessels) {
    if (v.group !== 'ship' || v.sog == null || v.sog < 2) continue;
    if (!v.seen || now - Date.parse(v.seen) > 60 * 60000) continue;
    // Ships already inside the map are drawn there.
    if (v.lat >= HARBOR_BOX.south && v.lat <= HARBOR_BOX.north && v.lon >= HARBOR_BOX.west && v.lon <= HARBOR_BOX.east) continue;
    const toEntrance = bearing(v, ENTRANCE);
    const off = v.cog == null ? 180 : Math.abs(((v.cog - toEntrance + 540) % 360) - 180);
    const named = /CHS|CHARLESTON/i.test(v.destination || '');
    // Heading for the jetties, or says so and is not sailing away.
    if (!(off <= 35 || (named && off <= 80))) continue;
    const nm = distanceNm(v, ENTRANCE);
    ships.push({
      mmsi: v.mmsi, name: v.name, flag: v.flag, imo: v.imo, type: v.type, length: v.length, beam: v.beam, draught: v.draught,
      sog: v.sog, cog: v.cog, destination: v.destination, lat: v.lat, lon: v.lon, seen: v.seen,
      distanceNm: Math.round(nm * 10) / 10,
      etaMinutes: Math.round((nm / v.sog) * 60),
    });
  }
  ships.sort((a, b) => a.etaMinutes - b.etaMinutes);
  return { entrance: ENTRANCE, ships: ships.slice(0, 12) };
}

// ---------------------------------------------------------------- dolphins

async function loadDolphins() {
  const since = new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    taxon_name: 'Tursiops', d1: since, geoprivacy: 'open', taxon_geoprivacy: 'open', per_page: '30', order: 'desc', order_by: 'observed_on',
    swlat: String(HARBOR_BOX.south), swlng: String(HARBOR_BOX.west), nelat: String(HARBOR_BOX.north), nelng: String(HARBOR_BOX.east),
  });
  const d = await getJson(`${INAT}?${q}`);
  if (!d || !Array.isArray(d.results)) throw new Error('unexpected response');
  const sightings = [];
  for (const o of d.results) {
    const [lat, lon] = String(o.location || '').split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || o.obscured || !Number.isInteger(o.id)) continue;
    sightings.push({
      id: o.id, lat, lon, on: /^\d{4}-\d{2}-\d{2}$/.test(o.observed_on || '') ? o.observed_on : null,
      species: cleanText(o.taxon && (o.taxon.preferred_common_name || o.taxon.name)),
      by: cleanText(o.user && o.user.login), license: cleanText(o.license_code), place: cleanText(o.place_guess),
    });
  }
  return { days: 90, sightings };
}

/** Fetch every extra feed now. Never throws: a failed feed is reported inside its own block. */
export async function harborExtras() {
  const [weather, currents, marine, inbound, dolphins] = await Promise.all([
    feed('weather', loadWeather), feed('currents', loadCurrents), feed('marine', loadMarine), feed('inbound', loadInbound), feed('dolphins', loadDolphins),
  ]);
  return { generatedAt: new Date().toISOString(), weather, currents, marine, inbound, dolphins };
}

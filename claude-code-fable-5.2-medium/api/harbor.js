// Vercel serverless function: fetches live harbor data so the browser never
// talks to the upstream sources directly. No keys are needed for any source.
//   - Vessel positions: Open Waters AIS (GeoJSON)
//   - Tide (water level) at Charleston, station 8665530: NOAA CO-OPS
//   - Air gap under the Ravenel Bridge, station 8665353: NOAA CO-OPS
// Each feed is reported independently so the client can keep the last good
// copy of one feed while another fails. Nothing is cached, sampled or invented.

const UA = 'harbor-bench/1.0';
const AIS_URL = 'https://ais.openwaters.io/v1/vessels?bbox=32.70,-80.05,32.95,-79.75';
const NOAA = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const NOAA_COMMON = 'units=english&time_zone=gmt&format=json&application=harbor-bench';

async function getJson(url, ms = 9000) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
  return r.json();
}

async function feed(fn) {
  const fetchedAt = new Date().toISOString();
  try {
    return { ok: true, fetchedAt, data: await fn() };
  } catch (e) {
    return { ok: false, fetchedAt, error: String((e && e.message) || e).slice(0, 200) };
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);

async function vessels() {
  const j = await getJson(AIS_URL);
  if (!j || j.type !== 'FeatureCollection' || !Array.isArray(j.features)) {
    throw new Error('Unexpected AIS response');
  }
  const out = [];
  for (const f of j.features) {
    const c = f && f.geometry && f.geometry.coordinates;
    const p = (f && f.properties) || {};
    if (!Array.isArray(c) || num(c[0]) === null || num(c[1]) === null || !p.mmsi) continue;
    out.push({
      mmsi: p.mmsi,
      kind: str(p.kind),
      lon: c[0],
      lat: c[1],
      name: str(p.name),
      flag: str(p.flag),
      imo: num(p.imo),
      callsign: str(p.callsign),
      type: num(p.type),
      length: num(p.length),
      beam: num(p.beam),
      toBow: num(p.to_bow),
      toStern: num(p.to_stern),
      toPort: num(p.to_port),
      toStarboard: num(p.to_starboard),
      sog: num(p.sog),
      cog: num(p.cog),
      heading: num(p.heading),
      navStatus: num(p.nav_status),
      destination: str(p.destination),
      eta: str(p.eta),
      draught: num(p.draught),
      seen: str(p.seen),
    });
  }
  const attribution = [...new Set(Object.values(j.attribution || {}).map(String))].slice(0, 6);
  return { vessels: out, attribution };
}

const noaaTime = (t) => (typeof t === 'string' ? t.replace(' ', 'T') + ':00Z' : null);

async function noaaSeries(query) {
  const j = await getJson(`${NOAA}?${query}&${NOAA_COMMON}`);
  if (j.error) throw new Error(`NOAA: ${String(j.error.message || 'error').slice(0, 120)}`);
  const rows = (j.data || [])
    .map((d) => ({ t: noaaTime(d.t), v: d.v === '' || d.v == null ? null : Number(d.v) }))
    .filter((d) => d.t && Number.isFinite(d.v));
  if (!rows.length) throw new Error('NOAA: no recent observations');
  return { station: j.metadata || null, rows };
}

async function tide() {
  const { station, rows } = await noaaSeries('product=water_level&station=8665530&datum=MLLW&range=3');
  const latest = rows[rows.length - 1];
  // Observed trend over roughly the last hour, from the observations themselves.
  const hourAgo = Date.parse(latest.t) - 3600e3;
  const ref = rows.find((r) => Date.parse(r.t) >= hourAgo) || rows[0];
  const dtH = (Date.parse(latest.t) - Date.parse(ref.t)) / 3600e3;
  const ratePerHour = dtH > 0.2 ? (latest.v - ref.v) / dtH : null;
  // NOAA's own high/low predictions for the next day (optional extra).
  let next = [];
  try {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const begin = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}%20${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
    const j = await getJson(`${NOAA}?product=predictions&station=8665530&datum=MLLW&interval=hilo&begin_date=${begin}&range=26&${NOAA_COMMON}`, 6000);
    next = (j.predictions || []).slice(0, 3).map((x) => ({ t: noaaTime(x.t), v: Number(x.v), type: x.type === 'H' ? 'high' : 'low' }));
  } catch {
    next = [];
  }
  return { stationId: '8665530', stationName: (station && station.name) || null, datum: 'MLLW', unit: 'ft', t: latest.t, v: latest.v, ratePerHour, next };
}

async function airGap() {
  const { station, rows } = await noaaSeries('product=air_gap&station=8665353&range=3');
  const latest = rows[rows.length - 1];
  return { stationId: '8665353', stationName: (station && station.name) || null, unit: 'ft', t: latest.t, v: latest.v };
}

export default async function handler(req, res) {
  const [ais, tideR, gapR] = await Promise.all([feed(vessels), feed(tide), feed(airGap)]);
  const allOk = ais.ok && tideR.ok && gapR.ok;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // A short shared cache protects the free upstream feeds; failures are never cached.
  res.setHeader('Cache-Control', allOk ? 'public, max-age=0, s-maxage=30' : 'no-store');
  res.end(JSON.stringify({ generatedAt: new Date().toISOString(), ais, tide: tideR, airGap: gapR }));
}

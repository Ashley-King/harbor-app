// Vercel serverless function: fetches live harbor data on every request.
// Sources: Open Waters AIS (no key) and NOAA CO-OPS (no key). Nothing is stored or invented.

const UA = 'harbor-bench/1.0';
const BBOX = '32.70,-80.05,32.95,-79.75';
const AIS_URL = `https://ais.openwaters.io/v1/vessels?bbox=${BBOX}&kind=vessel&max_age=6h`;
const NOAA = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const NOAA_COMMON = 'units=english&time_zone=gmt&format=json&application=harbor-bench';
const TIDE_STATION = '8665530'; // Charleston, Cooper River Entrance
const AIRGAP_STATION = '8665353'; // Ravenel Bridge air gap

// Last good results kept while this function instance stays warm.
// The browser also keeps its own last good copy, so a cold start never loses data on screen.
const lastGood = {};

async function getJSON(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function category(p) {
  const t = p.type ?? 0;
  const len = p.length ?? ((p.to_bow ?? 0) + (p.to_stern ?? 0) || null);
  if (t === 31 || t === 32 || t === 52) return 'tug';
  if (t === 50) return 'pilot';
  if ((t >= 60 && t <= 89) || (len && len > 150)) return 'large';
  return null; // everything else is hidden
}

function slimVessel(f) {
  const p = f.properties || {};
  const cat = category(p);
  if (!cat || !f.geometry) return null;
  const pick = ['mmsi', 'name', 'callsign', 'imo', 'flag', 'type', 'length', 'beam', 'to_bow', 'to_stern', 'to_port',
    'to_starboard', 'sog', 'cog', 'heading', 'nav_status', 'destination', 'eta', 'draught', 'seen'];
  const v = { category: cat, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
  for (const k of pick) if (p[k] !== undefined && p[k] !== null) v[k] = p[k];
  return v;
}

async function fetchTracks(vessels) {
  // Real recent track points for moving ships so the map can follow their actual path.
  const moving = vessels
    .filter((v) => (v.sog ?? 0) >= 0.5 && Date.now() - Date.parse(v.seen) < 30 * 60e3)
    .sort((a, b) => (b.length ?? 0) - (a.length ?? 0))
    .slice(0, 30);
  const from = new Date(Date.now() - 25 * 60e3).toISOString();
  const results = await Promise.allSettled(
    moving.map((v) => getJSON(`https://ais.openwaters.io/v1/vessels/${v.mmsi}/track?from=${from}`, 8000))
  );
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const g = r.value?.geometry;
    const times = r.value?.properties?.times;
    if (!g || !times) return;
    const coords = g.type === 'Point' ? [g.coordinates] : g.coordinates;
    const hdg = r.value.properties.heading || [];
    const cog = r.value.properties.cog || [];
    moving[i].track = coords.map((c, j) => ({ t: times[j], lon: c[0], lat: c[1], h: hdg[j] ?? cog[j] ?? null }));
  });
}

async function source(name, fn) {
  try {
    const data = await fn();
    lastGood[name] = { ok: true, data, fetchedAt: new Date().toISOString() };
    return lastGood[name];
  } catch (err) {
    const prev = lastGood[name];
    return prev
      ? { ...prev, ok: false, stale: true, error: String(err.message || err) }
      : { ok: false, data: null, error: String(err.message || err) };
  }
}

export default async function handler(req, res) {
  const [ais, tide, airGap, tidePred] = await Promise.all([
    source('ais', async () => {
      const fc = await getJSON(AIS_URL);
      const vessels = (fc.features || []).map(slimVessel).filter(Boolean);
      await fetchTracks(vessels);
      return { vessels, attribution: fc.attribution || null };
    }),
    source('tide', async () => {
      const j = await getJSON(`${NOAA}?${NOAA_COMMON}&station=${TIDE_STATION}&product=water_level&datum=MLLW&date=latest`);
      if (!j.data?.length) throw new Error(j.error?.message || 'no data');
      return { feet: Number(j.data[0].v), time: j.data[0].t.replace(' ', 'T') + ':00Z', station: j.metadata?.name };
    }),
    source('airGap', async () => {
      const j = await getJSON(`${NOAA}?${NOAA_COMMON}&station=${AIRGAP_STATION}&product=air_gap&date=latest`);
      if (!j.data?.length) throw new Error(j.error?.message || 'no data');
      return { feet: Number(j.data[0].v), time: j.data[0].t.replace(' ', 'T') + ':00Z', station: j.metadata?.name };
    }),
    source('tidePred', async () => {
      const d = new Date(Date.now() - 12 * 3600e3);
      const begin = d.toISOString().slice(0, 10).replace(/-/g, '');
      const j = await getJSON(`${NOAA}?${NOAA_COMMON}&station=${TIDE_STATION}&product=predictions&datum=MLLW&interval=hilo&begin_date=${begin}&range=60`);
      if (!j.predictions?.length) throw new Error(j.error?.message || 'no data');
      return j.predictions.map((p) => ({ time: p.t.replace(' ', 'T') + ':00Z', feet: Number(p.v), type: p.type }));
    }),
  ]);

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
  res.status(200).json({ generatedAt: new Date().toISOString(), ais, tide, airGap, tidePred });
}

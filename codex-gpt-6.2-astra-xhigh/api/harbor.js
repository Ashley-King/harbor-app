const ROOT = 'https://ais.openwaters.io/v1/vessels'
const BOX = '32.70,-80.05,32.95,-79.75'
const HALF_HOUR = 30 * 60_000
const agent = 'harbor-bench/1.0 (https://harbor-codex-gpt-6-2-astra-xhigh.vercel.app)'
const lastGood = new Map()
const registry = new Map()
let pending
let recent

async function json(url, timeout = 8500) {
  const res = await fetch(url, {
    headers: { 'User-Agent': agent, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeout)
  })
  if (!res.ok) throw Error('Upstream returned ' + res.status)
  return res.json()
}

function number(value, min, max) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

function clean(value) {
  return typeof value === 'string' ? value.replace(/@+$/g, '').trim() || null : null
}

async function particulars(id) {
  const cached = registry.get(id)
  if (cached && Date.now() - cached.time < 86400_000) return cached
  try {
    const { properties: p } = await json(ROOT + '/' + id, 2400)
    const entry = {
      time: Date.now(),
      type: clean(p.particulars?.ship_type),
      sources: Object.values(p.sources || {}).map((s) => ({
        credit: s.credit,
        license: s.license,
        url: s.url
      })),
      length: p.particulars?.length,
      beam: p.particulars?.beam
    }
    if (registry.size > 1500) registry.clear()
    registry.set(id, entry)
    return entry
  } catch {
    return cached || {}
  }
}

function vessel(feature) {
  const p = feature.properties ?? {}
  const [lon, lat] = feature.geometry?.coordinates ?? []
  const mmsi = String(p.mmsi ?? feature.id)
  if (
    p.kind !== 'vessel' ||
    !/^\d{9}$/.test(mmsi) ||
    number(lon, -80.05, -79.75) === null ||
    number(lat, 32.7, 32.95) === null
  )
    return
  const time = Date.parse(p.seen)
  if (!Number.isFinite(time) || Date.now() - time > HALF_HOUR || time > Date.now() + 60_000) return
  const type = number(p.type, 1, 99)
  const length = number(p.length, 1, 1022)
  if (!((type >= 60 && type <= 89) || length > 150 || [31, 32, 50, 52].includes(type))) return
  return {
    mmsi,
    lat,
    lon,
    name: clean(p.name),
    type,
    length,
    beam: number(p.beam, 1, 126),
    heading: number(p.heading, 0, 359),
    course: number(p.cog, 0, 359.99),
    speed: number(p.sog, 0, 102.2),
    bow: number(p.to_bow, 0, 511),
    stern: number(p.to_stern, 0, 511),
    port: number(p.to_port, 0, 63),
    starboard: number(p.to_starboard, 0, 63),
    status: number(p.nav_status, 0, 14),
    seen: new Date(time).toISOString(),
    flag: clean(p.flag),
    imo: number(p.imo, 1000000, 9999999),
    destination: clean(p.destination),
    eta: /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]$/.test(p.eta)
      ? p.eta
      : null,
    draught: number(p.draught, 0.1, 25.5)
  }
}

const reportedTypes = new Map()
async function enrichTypes(ships) {
  const eligible = ships.filter(
    (s) =>
      s.imo &&
      s.type >= 60 &&
      s.type <= 89 &&
      (!s.subtype || /^(general )?cargo ship$|^passenger (ship|vessel)$/i.test(s.subtype))
  )
  const now = Date.now()
  const missing = [...new Set(eligible.map((s) => s.imo))].filter(
    (imo) => now - (reportedTypes.get(imo)?.time ?? 0) > 86400_000
  )
  if (missing.length) {
    const q = new URLSearchParams({
      page: '1',
      limit: '100',
      orderByCol: 'reportingPeriod',
      orderByType: 'DESC'
    })
    for (const imo of missing) q.append('imoNumbers', String(imo))
    try {
      const body = await json('https://mrv.emsa.europa.eu/api/public-emission-report?' + q, 5500)
      if (Array.isArray(body.results)) {
        if (reportedTypes.size > 1500) reportedTypes.clear()
        for (const imo of missing) {
          const row = body.results.find((r) => Number(r.imo) === imo && clean(r.shipType))
          reportedTypes.set(imo, {
            time: now,
            type: clean(row?.shipType),
            year: number(row?.reportingPeriod, 2018, 2100)
          })
        }
      }
    } catch {
      /* An optional registry lookup must never drop an AIS position. */
    }
  }
  for (const s of eligible) {
    const entry = reportedTypes.get(s.imo)
    if (!entry?.type) continue
    s.subtype = entry.type
    s.sources = [
      ...(s.sources || []),
      {
        credit: 'EMSA THETIS-MRV',
        url: 'https://mrv.emsa.europa.eu/#public/emission-report/ship/' + s.imo + '/rp/' + entry.year
      }
    ]
  }
}

async function fleet() {
  const feed = await json(ROOT + '?bbox=' + BOX + '&kind=vessel&max_age=30m&max_age_moving=30m')
  if (feed.type !== 'FeatureCollection' || !Array.isArray(feed.features) || feed.truncated)
    throw Error('Incomplete snapshot')
  const ships = feed.features.map(vessel).filter(Boolean)
  // AIS does not distinguish container, bulk and vehicle carriers. Use registry descriptions where available.
  const lookup = ships
    .filter((s) => (s.type >= 60 && s.type <= 89) || s.length > 150)
    .sort((a, b) => (b.length || 0) - (a.length || 0))
    .slice(0, 48)
  for (let i = 0; i < lookup.length; i += 12) {
    await Promise.all(
      lookup.slice(i, i + 12).map(async (s) => {
        const p = await particulars(s.mmsi)
        s.subtype = p.type ?? null
        s.sources = p.sources ?? []
        s.length ??= number(p.length, 1, 1022)
        s.beam ??= number(p.beam, 1, 126)
      })
    )
  }
  await enrichTypes(ships)
  return { ships, credits: Object.values(feed.attribution || {}), observedAt: new Date().toISOString() }
}

async function observation(station, product) {
  const q = new URLSearchParams({
    station,
    product,
    range: '8',
    time_zone: 'gmt',
    units: 'english',
    format: 'json',
    application: 'harbor-bench'
  })
  if (product === 'water_level') q.set('datum', 'MLLW')
  const body = await json('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?' + q)
  const samples = (body.data || [])
    .map((r) => ({ time: Date.parse(r.t.replace(' ', 'T') + ':00Z'), value: number(r.v, -50, 500) }))
    .filter((r) => Number.isFinite(r.time) && r.value !== null)
    .sort((a, b) => a.time - b.time)
  if (String(body.metadata?.id) !== station || !samples.length) throw Error('Missing observations')
  const latest = samples.at(-1)
  return { station, samples, value: latest.value, observedAt: new Date(latest.time).toISOString() }
}

async function source(key, reader) {
  try {
    const data = await reader()
    const result = {
      data,
      updatedAt: new Date().toISOString(),
      stale: Date.now() - Date.parse(data.observedAt) > HALF_HOUR
    }
    lastGood.set(key, result)
    return result
  } catch {
    return { ...(lastGood.get(key) || { data: null, updatedAt: null }), stale: true }
  }
}

async function snapshot() {
  const [ais, tide, gap] = await Promise.all([
    source('ais', fleet),
    source('tide', () => observation('8665530', 'water_level')),
    source('gap', () => observation('8665353', 'air_gap'))
  ])
  return { ais, tide, gap, checkedAt: new Date().toISOString() }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  if (!recent || Date.now() - Date.parse(recent.checkedAt) > 45_000) {
    pending ??= snapshot().finally(() => {
      pending = null
    })
    recent = await pending
  }
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader(
    'Vercel-CDN-Cache-Control',
    Object.values(recent).some((s) => s.stale) ? 'no-store' : 'public, s-maxage=45'
  )
  return res.status(200).json(recent)
}

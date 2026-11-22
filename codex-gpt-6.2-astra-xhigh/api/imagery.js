// Restricted to high-resolution tiles around Charleston. The satellite overview is bundled locally.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const { z, x, y } = req.query
  if (![z, x, y].every((v) => typeof v === 'string' && /^\d{1,6}$/.test(v))) return res.status(400).end()
  if (+z < 14 || +z > 17) return res.status(404).end()
  const n = 2 ** z
  const lon = ((+x + 0.5) / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (+y + 0.5)) / n))) * 180) / Math.PI
  if (lon < -80.38 || lon > -79.43 || lat < 32.52 || lat > 33.1) return res.status(404).end()
  try {
    const r = await fetch(
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/' +
        [z, y, x].join('/'),
      { headers: { 'User-Agent': 'harbor-bench/1.0' }, signal: AbortSignal.timeout(6500) }
    )
    if (!r.ok || !r.headers.get('content-type')?.startsWith('image/')) throw Error()
    res.setHeader('Content-Type', r.headers.get('content-type'))
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800')
    return res.status(200).send(Buffer.from(await r.arrayBuffer()))
  } catch {
    return res.status(502).end()
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const z = Number(req.query.z),
    x = Number(req.query.x),
    y = Number(req.query.y);
  if (
    ![z, x, y].every(Number.isInteger) ||
    z < 8 ||
    z > 16 ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** z ||
    y >= 2 ** z
  )
    return res.status(400).end();
  const lon = ((x + 0.5) / 2 ** z) * 360 - 180,
    lat =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z))) * 180) /
      Math.PI;
  if (lon < -80.5 || lon > -79.3 || lat < 32.3 || lat > 33.4)
    return res.status(404).end();
  try {
    const upstream = await fetch(
      `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
      {
        headers: { "User-Agent": "harbor-bench/1.0" },
        signal: AbortSignal.timeout(18000),
      },
    );
    if (!upstream.ok) throw new Error();
    res.setHeader(
      "Content-Type",
      upstream.headers.get("Content-Type") || "image/jpeg",
    );
    res.setHeader(
      "Cache-Control",
      "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    );
    return res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    return res.status(502).end();
  }
}

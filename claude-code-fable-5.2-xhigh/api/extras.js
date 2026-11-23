// GET /api/extras on Vercel: weather, tidal currents, marine alerts, ships arriving
// from sea and dolphin sightings in one answer (see lib/extras.js). On Cloudflare the
// same data is served by worker/index.js.

import { harborExtras } from '../lib/extras.js';

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('Method not allowed');
    return;
  }
  const body = JSON.stringify(await harborExtras());
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=300');
  res.end(body);
}

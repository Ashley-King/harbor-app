// GET /api/ship?imo=1234567 on Vercel: one ship's backstory from Wikidata (see
// lib/ship.js). On Cloudflare the same data is served by worker/index.js.

import { shipStory } from '../lib/ship.js';

export default async function handler(req, res) {
  const send = (status, body, cache) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', cache || 'no-store');
    res.end(JSON.stringify(body));
  };
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    return send(405, { ok: false, error: 'method not allowed' });
  }
  const imo = new URL(req.url, 'http://localhost').searchParams.get('imo') || '';
  if (!/^\d{7}$/.test(imo)) return send(400, { ok: false, error: 'imo must be seven digits' });
  try {
    return send(200, { ok: true, ...(await shipStory(imo)) }, 'public, max-age=0, s-maxage=604800');
  } catch (err) {
    const bad = err instanceof RangeError;
    return send(bad ? 400 : 502, { ok: false, error: bad ? 'not an IMO number' : 'the ship register did not answer' });
  }
}

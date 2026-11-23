// GET /api/harbor on Vercel.
// The browser only ever talks to this endpoint. It returns the live ships, the tide and
// the bridge clearance in one answer (see lib/harbor.js). On Cloudflare the same data
// is served by worker/index.js.

import { harborFeeds } from '../lib/harbor.js';

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('Method not allowed');
    return;
  }
  const body = JSON.stringify(await harborFeeds());
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // A short shared cache keeps several open screens from multiplying upstream calls.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=20, stale-while-revalidate=20');
  res.end(body);
}

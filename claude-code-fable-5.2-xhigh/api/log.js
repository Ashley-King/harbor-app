// GET /api/log on Vercel. The harbor log needs somewhere to remember ships between
// visits, and this app only sets that up on Cloudflare (Workers KV, see
// worker/index.js). Here the answer says so and the page hides the log.

export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
  res.end(JSON.stringify({ log: { ok: false, fetchedAt: new Date().toISOString(), error: 'not set up' } }));
}

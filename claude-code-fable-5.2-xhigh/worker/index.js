// The Cloudflare Worker for this app.
//
// Cloudflare serves the built site (dist/) as static files without running this code.
// Only /api/* comes here (see wrangler.jsonc), which is the one endpoint the page
// calls: GET /api/harbor, the live ships, tide and bridge clearance in one answer.
// The data code is shared with the Vercel function (lib/harbor.js).

import { harborFeeds } from '../lib/harbor.js';

// The Workers Free plan allows 50 outgoing calls per request. One goes to the vessel
// list and four to NOAA, each with one retry, which leaves room for 32 vessel tracks.
const MAX_TRACKS = 32;
// Several open screens asking within the same few seconds share one finished answer.
// Only a finished answer is kept: a Worker must not hand one request's unfinished
// work to another request.
const SHARE_MS = 20000;
let shared = null;

async function harbor() {
  if (shared && Date.now() - shared.at <= SHARE_MS) return shared.body;
  const body = JSON.stringify(await harborFeeds({ maxTracks: MAX_TRACKS }));
  shared = { at: Date.now(), body };
  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/harbor') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
      }
      const body = await harbor();
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' },
      });
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};

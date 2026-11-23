// The Cloudflare Worker for this app.
//
// Cloudflare serves the built site (dist/) as static files without running this code.
// Two paths come here first (see wrangler.jsonc):
//   /api/*  the one endpoint the page calls, GET /api/harbor: live ships, tide and
//           bridge clearance in one answer. The data code is shared with the Vercel
//           function (lib/harbor.js).
//   /       the page itself, so that plain http and the www name are sent on to the
//           one true address before anything is served.
// Security headers for the static files are in public/_headers. The ones for the
// answers this Worker writes itself are set below.

import { harborFeeds } from '../lib/harbor.js';

// The Workers Free plan allows 50 outgoing calls per request, and the two cache
// calls below count. One call goes to the vessel list and four to NOAA, each with
// one retry, which leaves room for 32 vessel tracks.
const MAX_TRACKS = 32;
// However many screens are open, the sources are asked at most about once every
// 20 seconds per Cloudflare location: a finished answer is kept in this Worker's
// memory and in Cloudflare's cache, and reused until it is that old.
const SHARE_SECONDS = 20;
let shared = null;

const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex',
};

async function harbor(request, ctx) {
  if (shared && Date.now() - shared.at <= SHARE_SECONDS * 1000) return shared.body;
  // Cloudflare's cache is shared by every copy of this Worker in the same location.
  // It only exists on a real domain, so every use of it is allowed to fail quietly.
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(new URL('/api/harbor', request.url).toString());
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) {
      const body = await hit.text();
      shared = { at: Date.now(), body };
      return body;
    }
  }
  const body = JSON.stringify(await harborFeeds({ maxTracks: MAX_TRACKS }));
  shared = { at: Date.now(), body };
  if (cache) {
    const copy = new Response(body, { headers: { 'Content-Type': API_HEADERS['Content-Type'], 'Cache-Control': `public, max-age=${SHARE_SECONDS}` } });
    ctx.waitUntil(cache.put(key, copy).catch(() => {}));
  }
  return body;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // One address only: https, without www. `npm run cf:dev` sets LOCAL_DEV, because a
    // local run is plain http and must not be sent away.
    if (env.LOCAL_DEV !== '1' && (url.protocol === 'http:' || url.hostname.startsWith('www.'))) {
      url.protocol = 'https:';
      url.hostname = url.hostname.replace(/^www\./, '');
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === '/api/harbor') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'X-Content-Type-Options': 'nosniff' } });
      }
      const body = await harbor(request, ctx);
      return new Response(request.method === 'HEAD' ? null : body, { headers: API_HEADERS });
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });
    return env.ASSETS.fetch(request);
  },
};

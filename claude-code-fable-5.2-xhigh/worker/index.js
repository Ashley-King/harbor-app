// The Cloudflare Worker for this app.
//
// Cloudflare serves the built site (dist/) as static files without running this code.
// Two paths come here first (see wrangler.jsonc):
//   /api/*  the endpoints the page calls, all read-only:
//             GET /api/harbor        live ships, tide and bridge clearance (lib/harbor.js)
//             GET /api/extras        weather, currents, marine alerts, inbound ships,
//                                    dolphin sightings (lib/extras.js)
//             GET /api/ship?imo=N    one ship's backstory from Wikidata (lib/ship.js)
//             GET /api/log           the harbor log (lib/log.js)
//   /       the page itself, so that plain http and the www name are sent on to the
//           one true address before anything is served.
// A timer also runs this Worker every ten minutes to keep the harbor log (see
// `scheduled` below). Security headers for the static files are in public/_headers.
// The ones for the answers this Worker writes itself are set below.

import { harborFeeds, aisVessels } from '../lib/harbor.js';
import { harborExtras } from '../lib/extras.js';
import { shipStory } from '../lib/ship.js';
import { updateLog } from '../lib/log.js';

// The Workers Free plan allows 50 outgoing calls per request, and the two cache
// calls below count. One call goes to the vessel list and four to NOAA, each with
// one retry, which leaves room for 32 vessel tracks.
const MAX_TRACKS = 32;
// However many screens are open, the sources are asked at most once per period per
// Cloudflare location: a finished answer is kept in this Worker's memory and in
// Cloudflare's cache, and reused until it is that old.
const SHARE_SECONDS = { harbor: 20, extras: 300, log: 60 };
const STORY_SECONDS = 7 * 86400;      // a ship's builder does not change
const LOG_KEY = 'log';
const memory = new Map();

const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex',
};

const json = (body, status = 200) => new Response(body, { status, headers: API_HEADERS });

/** One answer shared by everyone for `seconds`. `make` builds a fresh one as a JSON string. */
async function shared(path, seconds, request, ctx, make) {
  const held = memory.get(path);
  if (held && Date.now() - held.at <= seconds * 1000) return held.body;
  // Cloudflare's cache is shared by every copy of this Worker in the same location.
  // It only exists on a real domain, so every use of it is allowed to fail quietly.
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(new URL(path, request.url).toString());
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) {
      const body = await hit.text();
      remember(path, body);
      return body;
    }
  }
  const body = await make();
  remember(path, body);
  if (cache) {
    const copy = new Response(body, { headers: { 'Content-Type': API_HEADERS['Content-Type'], 'Cache-Control': `public, max-age=${seconds}` } });
    ctx.waitUntil(cache.put(key, copy).catch(() => {}));
  }
  return body;
}

function remember(path, body) {
  // Ship stories are held one per ship, so the oldest go first when there are many.
  if (memory.size >= 300) memory.delete(memory.keys().next().value);
  memory.set(path, { at: Date.now(), body });
}

async function story(url, request, ctx) {
  const imo = url.searchParams.get('imo') || '';
  if (!/^\d{7}$/.test(imo)) return json(JSON.stringify({ ok: false, error: 'imo must be seven digits' }), 400);
  try {
    return json(await shared(`/api/ship?imo=${imo}`, STORY_SECONDS, request, ctx, async () => JSON.stringify({ ok: true, ...(await shipStory(imo)) })));
  } catch (err) {
    const bad = err instanceof RangeError;
    return json(JSON.stringify({ ok: false, error: bad ? 'not an IMO number' : 'the ship register did not answer' }), bad ? 400 : 502);
  }
}

async function readLog(env) {
  const fetchedAt = new Date().toISOString();
  if (!env.HARBOR_LOG) return JSON.stringify({ log: { ok: false, fetchedAt, error: 'not set up' } });
  const log = await env.HARBOR_LOG.get(LOG_KEY, 'json').catch(() => null);
  return JSON.stringify({ log: log ? { ok: true, fetchedAt, ...log } : { ok: false, fetchedAt, error: 'not started' } });
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

    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'X-Content-Type-Options': 'nosniff' } });
    }
    let answer;
    if (url.pathname === '/api/harbor') answer = json(await shared('/api/harbor', SHARE_SECONDS.harbor, request, ctx, async () => JSON.stringify(await harborFeeds({ maxTracks: MAX_TRACKS }))));
    else if (url.pathname === '/api/extras') answer = json(await shared('/api/extras', SHARE_SECONDS.extras, request, ctx, async () => JSON.stringify(await harborExtras())));
    else if (url.pathname === '/api/log') answer = json(await shared('/api/log', SHARE_SECONDS.log, request, ctx, () => readLog(env)));
    else if (url.pathname === '/api/ship') answer = await story(url, request, ctx);
    else return new Response('Not found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });
    return request.method === 'HEAD' ? new Response(null, { status: answer.status, headers: answer.headers }) : answer;
  },

  // Every ten minutes: note which large ships are in the harbor, so the log shows
  // arrivals and departures even when nobody has the page open. One call to the ship
  // list, one read and one write to KV, about 150 of each a day.
  async scheduled(event, env, ctx) {
    if (!env.HARBOR_LOG) return;
    const { vessels } = await aisVessels();
    const prev = await env.HARBOR_LOG.get(LOG_KEY, 'json');
    await env.HARBOR_LOG.put(LOG_KEY, JSON.stringify(updateLog(prev, vessels)));
  },
};

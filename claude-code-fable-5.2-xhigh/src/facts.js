// Small facts worked out from what a ship reports: the water under its keel, where
// it is going and how far that is, and what its size compares to. Each returns null
// when the report does not hold enough to say.

import { findPort } from './ports.js';
import { countryName } from './util.js';

const FT = 0.3048;
const D2R = Math.PI / 180;

// ---------------------------------------------------------------- water under the keel

function inside(ring, x, y) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/** The dredged channel reach a world position lies in, or null. */
export function reachAt(harbor, x, y) {
  return harbor.channel.find((r) => r.depthFt && inside(r.ring, x, y)) || null;
}

/**
 * Water under the keel in feet: the channel's maintained depth where the ship is,
 * plus the tide now, less the draught the ship reports. Only inside the dredged
 * channel, where the depth is known.
 */
export function underKeel(e, harbor, tideFt) {
  const v = e.v;
  if (v.draught == null || tideFt == null || !e.centre) return null;
  const reach = reachAt(harbor, e.centre.x, e.centre.y);
  if (!reach) return null;
  const draughtFt = v.draught / FT;
  const ft = reach.depthFt + tideFt - draughtFt;
  // A draught deeper than the water means the crew typed it wrong.
  if (ft < 1) return null;
  return { ft, depthFt: reach.depthFt, tideFt, draughtFt, reach: reach.name };
}

// ---------------------------------------------------------------- destination

function nm(a, b) {
  const dLat = (b[0] - a[0]) * D2R, dLon = (b[1] - a[1]) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const along = (pts) => pts.slice(1).reduce((sum, p, i) => sum + nm(pts[i], p), 0);

// Turning points of the usual sea routes out of Charleston, as [lat, lon].
const FLORIDA_STRAITS = [[25.5, -79.8], [24.3, -81.5]];
const WINDWARD = [20.0, -73.8];
const PANAMA = [[9.4, -79.9], [8.9, -79.5]];
const GIBRALTAR = [35.95, -5.6];
const SUEZ = [[31.4, 32.3], [29.8, 32.6], [12.5, 43.4]];
const MALACCA = [[5.8, 80.5], [1.2, 103.8]];
const CAPE_SAO_ROQUE = [-5.0, -34.5];

/**
 * A rough distance by sea in nautical miles from a position to a port, along the
 * usual route for that part of the world (round Florida, through Panama or Suez).
 */
export function seaMiles(from, port) {
  const to = [port.lat, port.lon];
  const { lat, lon } = port;
  const route = (...via) => along([from, ...via, to]);
  if (lon > -100 && lon < -81.5 && lat > 17 && lat < 31) return route(...FLORIDA_STRAITS);                  // Gulf of Mexico
  if (lon > -93 && lon < -59 && lat > 7 && lat < 24) return route(WINDWARD);                                // Caribbean
  if (lon < -100 || (lon < -69 && lat < 7)) return route(WINDWARD, ...PANAMA);                              // Pacific coast of the Americas
  if (lon > -60 && lon < -30 && lat < -6) return route(CAPE_SAO_ROQUE);                                     // Brazil and the River Plate
  if (lon > -6 && lon < 37 && lat > 30 && lat < 46 && !(lon < 0 && lat > 42)) return lon > 31 && lat < 30.5 ? route(GIBRALTAR, SUEZ[0], SUEZ[1]) : route(GIBRALTAR);   // Mediterranean
  if (lon > 37 && lon < 78) return route(GIBRALTAR, ...SUEZ);                                               // Red Sea, Gulf, India
  if (lon >= 78 || lon < -160) return Math.min(route(GIBRALTAR, ...SUEZ, ...MALACCA), route(WINDWARD, ...PANAMA)); // East Asia, Oceania
  return route();
}

const roundMiles = (n) => (n < 100 ? Math.round(n / 5) * 5 : n < 1000 ? Math.round(n / 10) * 10 : Math.round(n / 100) * 100);

/**
 * Where a ship says it is going. Returns { place, here, miles, days, knots, typical }
 * or null when the destination cannot be read.
 */
export function destination(v) {
  const port = findPort(v.destination);
  if (!port) return null;
  const country = countryName(port.country);
  const place = port.country === 'US' || !country || port.name.startsWith('the ') ? port.name : `${port.name}, ${country}`;
  if (port.code === 'USCHS') return { place, here: true };
  const miles = seaMiles([v.lat, v.lon], port);
  // A ship at the wharf has no speed yet, so a typical sea speed stands in.
  const moving = v.sog != null && v.sog >= 6;
  const knots = moving ? v.sog : 16;
  return { place, here: false, miles: roundMiles(miles), days: miles / knots / 24, knots, typical: !moving };
}

// ---------------------------------------------------------------- size

const FOOTBALL_FIELD = 109.7;    // metres, goal post to goal post with both end zones
const RAVENEL_SPAN = 471;        // metres, the main span of the Ravenel Bridge
const YORKTOWN = 266;            // metres, USS Yorktown at Patriots Point
const SCHOOL_BUS = 12;

/** One plain sentence that puts a hull length in metres on a human scale, or null. */
export function sizeStory(length) {
  if (length == null) return null;
  if (length < 20) return null;
  if (length < 70) return `About as long as ${Math.round(length / SCHOOL_BUS)} school buses parked end to end.`;
  const fields = (length / FOOTBALL_FIELD).toFixed(1).replace(/\.0$/, '');
  const span = Math.round((length / RAVENEL_SPAN) * 100);
  const diffFt = Math.round(Math.abs(length - YORKTOWN) / FT / 10) * 10;
  const yorktown = length < 180 ? '' : diffFt < 30 ? ' About the length of the aircraft carrier Yorktown at Patriots Point.' : ` ${diffFt} ft ${length > YORKTOWN ? 'longer' : 'shorter'} than the aircraft carrier Yorktown at Patriots Point.`;
  return `${fields} football fields long, ${span}% of the Ravenel Bridge's main span.${yorktown}`;
}

// ---------------------------------------------------------------- tidal current

/**
 * The predicted current at a station now, from its list of slacks and peaks
 * ([time, knots], flood positive and ebb negative). The water speeds up and slows
 * down smoothly between them. Returns signed knots, or null outside the list.
 */
export function currentAt(events, now) {
  for (let i = 1; i < events.length; i++) {
    const t0 = Date.parse(events[i - 1][0]), t1 = Date.parse(events[i][0]);
    if (now < t0 || now > t1) continue;
    const f = (1 - Math.cos((Math.PI * (now - t0)) / (t1 - t0))) / 2;
    return events[i - 1][1] + (events[i][1] - events[i - 1][1]) * f;
  }
  return null;
}

// Local projection: Web Mercator scaled to true ground metres at the harbor's
// latitude. World +X is east, +Y is north, +Z is up, units are metres.
import geo from './geo.json';

const RAD = Math.PI / 180;
export const R = 6378137;
export const LAT0 = 32.82;
export const LON0 = -79.925;
export const K = Math.cos(LAT0 * RAD);
const mx = (lon) => R * lon * RAD;
const my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const MX0 = mx(LON0);
const MY0 = my(LAT0);

export function toWorld(lon, lat) {
  return [(mx(lon) - MX0) * K, (my(lat) - MY0) * K];
}
export function tileRect(z, x, y) {
  const ts = (2 * Math.PI * R) / 2 ** z;
  const x0 = (x * ts - Math.PI * R - MX0) * K;
  const yTop = (Math.PI * R - y * ts - MY0) * K;
  return { x: x0, y: yTop - ts * K, size: ts * K };
}
export function worldToTile(wx, wy, z) {
  const ts = (2 * Math.PI * R) / 2 ** z;
  return [(wx / K + MX0 + Math.PI * R) / ts, (Math.PI * R - (wy / K + MY0)) / ts];
}
export const WORLD_CIRC = 2 * Math.PI * R * K;

// Extent of public/watermask.png (see tools/build_watermask.py).
const [mw, ms] = toWorld(-80.2001953125, 32.583849325656615);
const [me, mn] = toWorld(-79.62890625, 33.027087580028734);
export const MASK_RECT = { x: mw, y: ms, w: me - mw, h: mn - ms };

const line = (l) => l.map(([lon, lat]) => toWorld(lon, lat));
export const GEO = {
  ravenel: geo.ravenel.map(line),
  donHolt: geo.donHolt.map(line),
  terminals: geo.terminals.map((t) => {
    const poly = line(t.polygon);
    let cx = 0, cy = 0;
    for (const p of poly) { cx += p[0]; cy += p[1]; }
    return { key: t.key, name: t.name, poly, center: [cx / poly.length, cy / poly.length] };
  }),
  cranes: geo.cranes.map(([lon, lat]) => toWorld(lon, lat)),
  seamarks: geo.seamarks.map((s) => ({ ...s, pos: toWorld(s.lon, s.lat) })),
  channel: geo.channel.map((c) => ({ kind: c.kind, line: line(c.line) })),
};

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function distToPoly(x, y, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

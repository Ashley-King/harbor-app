// Local metric frame for the harbor: Web Mercator scaled by cos(lat0), so one unit
// is one metre on the ground (within about 0.1 percent across the harbor) and map
// tiles stay exactly square. World: x east, y north. Scene: X east, Y up, Z south.

export const LAT0 = 32.825;
export const LON0 = -79.9;
const R = 6378137;
const D2R = Math.PI / 180;
export const K = Math.cos(LAT0 * D2R);
export const CIRC = 2 * Math.PI * R;

const mercX = (lon) => R * lon * D2R;
const mercY = (lat) => R * Math.asinh(Math.tan(lat * D2R));
const MX0 = mercX(LON0);
const MY0 = mercY(LAT0);

export function toWorld(lat, lon) {
  return { x: (mercX(lon) - MX0) * K, y: (mercY(lat) - MY0) * K };
}

export function toLatLon(x, y) {
  const mx = x / K + MX0;
  const my = y / K + MY0;
  return { lat: Math.atan(Math.sinh(my / R)) / D2R, lon: mx / R / D2R };
}

/** Size of one map tile at zoom z, in world metres. */
export const tileSize = (z) => (CIRC * K) / 2 ** z;

/** World bounds of tile z/x/y. */
export function tileBounds(z, x, y) {
  const size = tileSize(z);
  const west = (-CIRC / 2 + (x * CIRC) / 2 ** z - MX0) * K;
  const north = (CIRC / 2 - (y * CIRC) / 2 ** z - MY0) * K;
  return { west, north, east: west + size, south: north - size, size };
}

/** Fractional tile coordinates of a world point at zoom z. */
export function worldToTile(x, y, z) {
  const n = 2 ** z;
  return { tx: ((x / K + MX0 + CIRC / 2) / CIRC) * n, ty: ((CIRC / 2 - (y / K + MY0)) / CIRC) * n };
}

export const KNOT = 0.514444; // metres per second

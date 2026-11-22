// Sun and moon for Charleston, computed in the browser (no service needed).
// Standard low-precision formulas (Astronomical Algorithms, as used by SunCalc);
// good to about a minute for sunrise and sunset.

export const CHARLESTON = { lat: 32.7765, lon: -79.9311 };

const rad = Math.PI / 180;
const DAY = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQ = rad * 23.4397;

const toDays = (ms) => ms / DAY - 0.5 + J1970 - J2000;
const fromJulian = (j) => (j + 0.5 - J1970) * DAY;
const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQ) - Math.tan(b) * Math.sin(OBLIQ), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQ) + Math.cos(b) * Math.sin(OBLIQ) * Math.sin(l));
const azimuthS = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);

function eclipticLongitude(M) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + Math.PI;
}

function sunCoords(d) {
  const L = eclipticLongitude(solarMeanAnomaly(d));
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d);
  const M = rad * (134.963 + 13.064993 * d);
  const F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M);
  const b = rad * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

/** Sun direction: azimuth in radians clockwise from north, altitude in radians. */
export function sunPosition(ms, where = CHARLESTON) {
  const lw = rad * -where.lon;
  const phi = rad * where.lat;
  const d = toDays(ms);
  const c = sunCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  return { azimuth: azimuthS(H, phi, c.dec) + Math.PI, altitude: altitude(H, phi, c.dec) };
}

/** Moon direction plus the lit fraction of its disc (0 new, 1 full). */
export function moonPosition(ms, where = CHARLESTON) {
  const lw = rad * -where.lon;
  const phi = rad * where.lat;
  const d = toDays(ms);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  const s = sunCoords(d);
  const sdist = 149598000;
  const ang = Math.acos(Math.sin(s.dec) * Math.sin(c.dec) + Math.cos(s.dec) * Math.cos(c.dec) * Math.cos(s.ra - c.ra));
  const inc = Math.atan2(sdist * Math.sin(ang), c.dist - sdist * Math.cos(ang));
  return { azimuth: azimuthS(H, phi, c.dec) + Math.PI, altitude: altitude(H, phi, c.dec), fraction: (1 + Math.cos(inc)) / 2 };
}

/** Sunrise and sunset (ms) for the solar day nearest the given time. */
export function sunTimes(ms, where = CHARLESTON) {
  const lw = rad * -where.lon;
  const phi = rad * where.lat;
  const d = toDays(ms);
  const J0 = 0.0009;
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const transit = (base) => J2000 + base + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const noon = transit(ds);
  const h0 = -0.833 * rad;
  const cosw = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  const w = Math.acos(Math.min(1, Math.max(-1, cosw)));
  const set = transit(J0 + (w + lw) / (2 * Math.PI) + n);
  return { sunrise: fromJulian(noon - (set - noon)), sunset: fromJulian(set), noon: fromJulian(noon) };
}

/** True between sunset and sunrise. Also returns the next switch time. */
export function dayState(ms, where = CHARLESTON) {
  const isNight = sunPosition(ms, where).altitude < -0.833 * rad;
  let next = null;
  for (const offset of [-1, 0, 1, 2]) {
    const t = sunTimes(ms + offset * DAY, where);
    for (const [kind, at] of [['sunrise', t.sunrise], ['sunset', t.sunset]]) {
      if (at > ms && (!next || at < next.at)) next = { kind, at };
    }
  }
  return { isNight, next };
}

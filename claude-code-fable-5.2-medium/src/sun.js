// Solar position and sunrise/sunset for Charleston, computed in the browser
// (standard astronomical formulas, as used by SunCalc). No network needed.
const RAD = Math.PI / 180;
const DAY_MS = 864e5, J1970 = 2440588, J2000 = 2451545, OBLIQ = RAD * 23.4397, J0 = 0.0009;
export const CHS = { lat: 32.7765, lon: -79.9311 };

const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j) => (j + 0.5 - J1970) * DAY_MS;
const meanAnomaly = (d) => RAD * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + Math.PI;
}
const declination = (L) => Math.asin(Math.sin(OBLIQ) * Math.sin(L));
const rightAscension = (L) => Math.atan2(Math.sin(L) * Math.cos(OBLIQ), Math.cos(L));

/** Sun azimuth (radians clockwise from north) and altitude (radians). */
export function sunPosition(ms, lat = CHS.lat, lon = CHS.lon) {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(ms);
  const L = eclipticLongitude(meanAnomaly(d));
  const dec = declination(L), ra = rightAscension(L);
  const H = RAD * (280.16 + 360.9856235 * d) - lw - ra;
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  return { azimuth: az, altitude: alt };
}

/** Sunrise and sunset (ms since epoch) for the solar day nearest the given time. */
export function sunTimes(ms, lat = CHS.lat, lon = CHS.lon) {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(ms);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = meanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L);
  const transit = (x) => J2000 + x + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const noon = transit(ds);
  const h0 = RAD * -0.833;
  const w = Math.acos((Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  const set = transit(J0 + (w + lw) / (2 * Math.PI) + n);
  return { sunrise: fromJulian(noon - (set - noon)), sunset: fromJulian(set), noon: fromJulian(noon) };
}

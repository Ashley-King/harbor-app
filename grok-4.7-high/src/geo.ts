export type LngLat = [number, number];

export function metersBetween(a: LngLat, b: LngLat): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const east = (b[0] - a[0]) * 111320 * Math.cos(lat);
  const north = (b[1] - a[1]) * 111320;
  return Math.hypot(east, north);
}

export function distanceToRingMeters(lng: number, lat: number, ring: LngLat[]): number {
  const closed = closeRing(ring);
  let inside = false;
  for (let i = 0; i < closed.length - 1; i++) {
    const [x1, y1] = closed[i];
    const [x2, y2] = closed[i + 1];
    if (y1 > lat !== y2 > lat && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1 || 1e-12) + x1) {
      inside = !inside;
    }
  }
  if (inside) return 0;
  let best = Infinity;
  for (let i = 0; i < closed.length - 1; i++) {
    best = Math.min(best, pointSegmentMeters(lng, lat, closed[i], closed[i + 1]));
  }
  return best;
}

export function nearestBerthHeading(lng: number, lat: number, ring: LngLat[], prefer: number | null): number | null {
  const closed = closeRing(ring);
  let best = Infinity;
  let bearing = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const dist = pointSegmentMeters(lng, lat, closed[i], closed[i + 1]);
    if (dist < best) {
      best = dist;
      bearing = segmentBearing(closed[i], closed[i + 1], lat);
    }
  }
  if (!Number.isFinite(best)) return null;
  if (prefer == null) return bearing;
  const alt = (bearing + 180) % 360;
  const d1 = angleDelta(bearing, prefer);
  const d2 = angleDelta(alt, prefer);
  return d1 <= d2 ? bearing : alt;
}

export function shipCenter(
  lat: number,
  lon: number,
  headingDeg: number,
  toBow: number | null,
  toStern: number | null,
  toPort: number | null,
  toStarboard: number | null,
  length: number | null,
): { lat: number; lon: number } {
  if (toBow == null || toStern == null || toPort == null || toStarboard == null) return { lat, lon };
  const span = toBow + toStern;
  if (span < 15 || span > 450) return { lat, lon };
  if (length != null && Math.abs(span - length) / length > 0.25) return { lat, lon };
  const forward = (toBow - toStern) / 2;
  const starboard = (toStarboard - toPort) / 2;
  const heading = (headingDeg * Math.PI) / 180;
  const north = forward * Math.cos(heading) - starboard * Math.sin(heading);
  const east = forward * Math.sin(heading) + starboard * Math.cos(heading);
  return {
    lat: lat + north / 111320,
    lon: lon + east / (111320 * Math.cos((lat * Math.PI) / 180)),
  };
}

export function sampleLine(line: LngLat[], spacing: number): LngLat[] {
  const out: LngLat[] = [];
  if (line.length === 0) return out;
  out.push(line[0]);
  let carry = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = metersBetween(a, b);
    if (len < 0.5) continue;
    let dist = spacing - carry;
    while (dist <= len) {
      const t = dist / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      dist += spacing;
    }
    carry = len - (dist - spacing);
    if (carry < 0) carry = 0;
  }
  return out;
}

export function offsetAway(point: LngLat, target: LngLat, meters: number): LngLat {
  const latM = (point[1] - target[1]) * 111320;
  const lngM = (point[0] - target[0]) * 111320 * Math.cos((point[1] * Math.PI) / 180);
  const len = Math.hypot(latM, lngM) || 1;
  const north = (latM / len) * meters;
  const east = (lngM / len) * meters;
  return [
    point[0] + east / (111320 * Math.cos((point[1] * Math.PI) / 180)),
    point[1] + north / 111320,
  ];
}

export function ringCentroid(ring: LngLat[]): LngLat {
  const closed = closeRing(ring);
  let lng = 0;
  let lat = 0;
  const n = Math.max(1, closed.length - 1);
  for (let i = 0; i < n; i++) {
    lng += closed[i][0];
    lat += closed[i][1];
  }
  return [lng / n, lat / n];
}

export function closeRing(ring: LngLat[]): LngLat[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function pointSegmentMeters(lng: number, lat: number, a: LngLat, b: LngLat): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  const ax = (a[0] - lng) * 111320 * cos;
  const ay = (a[1] - lat) * 111320;
  const bx = (b[0] - lng) * 111320 * cos;
  const by = (b[1] - lat) * 111320;
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, (-ax * vx + -ay * vy) / len2));
  return Math.hypot(ax + t * vx, ay + t * vy);
}

function segmentBearing(a: LngLat, b: LngLat, lat: number): number {
  const east = (b[0] - a[0]) * Math.cos((lat * Math.PI) / 180);
  const north = b[1] - a[1];
  return (Math.atan2(east, north) * 180) / Math.PI;
}

function angleDelta(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

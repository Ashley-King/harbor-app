import raw from "./data/features.json";
import { closeRing, offsetAway, ringCentroid, sampleLine, type LngLat } from "./geo";

type RawFeature = {
  osmId: number;
  name: string;
  kind: string;
  geomType: string;
  coordinates: number[][] | number[][][];
};

const META: Record<number, { id: string; name: string; seaward: LngLat }> = {
  56236110: { id: "wando", name: "Wando Welch", seaward: [-79.9, 32.833] },
  730887451: { id: "north-charleston", name: "North Charleston", seaward: [-79.945, 32.905] },
  1013132649: { id: "leatherman", name: "Leatherman", seaward: [-79.955, 32.841] },
  487069143: { id: "columbus", name: "Columbus Street", seaward: [-79.922, 32.796] },
};

function asLine(coordinates: number[][] | number[][][]): LngLat[] {
  if (Array.isArray(coordinates[0]) && typeof coordinates[0][0] === "number") {
    return (coordinates as number[][]).map((pair) => [pair[0], pair[1]]);
  }
  const ring = (coordinates as number[][][])[0] ?? [];
  return ring.map((pair) => [pair[0], pair[1]]);
}

const features = (raw as { features: RawFeature[] }).features;

export type TerminalPlace = {
  id: string;
  name: string;
  osmId: number;
  ring: LngLat[];
  label: LngLat;
  seaward: LngLat;
};

export const terminals: TerminalPlace[] = features
  .filter((feature) => feature.kind === "terminal" && META[feature.osmId])
  .map((feature) => {
    const meta = META[feature.osmId];
    const ring = closeRing(asLine(feature.coordinates));
    const center = ringCentroid(ring);
    const label = offsetAway(center, meta.seaward, 180);
    return { ...meta, osmId: feature.osmId, ring, label };
  })
  .map((terminal) => (terminal.id === "leatherman" ? leathermanBerth(terminal) : terminal));

const ravenelParts = features
  .filter((feature) => feature.osmId === 927255592 || feature.osmId === 927255595)
  .map((feature) => asLine(feature.coordinates));

export const ravenelLine: LngLat[] = joinLines(ravenelParts);

const holt = features.find((feature) => feature.osmId === 1469639956);
export const donHoltRing: LngLat[] = holt ? closeRing(asLine(holt.coordinates)) : [];
export const donHoltLabel: LngLat = donHoltRing.length ? ringCentroid(donHoltRing) : [-79.9642, 32.8913];

export const ravenelLabel: LngLat = [-79.9153, 32.8054];

/** Centerline through the entrance, Ravenel span, and the Cooper River. */
export const channel: LngLat[] = [
  [-79.792, 32.718],
  [-79.84, 32.74],
  [-79.868, 32.756],
  [-79.898, 32.77],
  [-79.92, 32.786],
  [-79.917, 32.796],
  [-79.915, 32.803],
  [-79.91, 32.816],
  [-79.928, 32.838],
  [-79.948, 32.862],
  [-79.958, 32.89],
  [-79.96, 32.91],
];

export const wandoChannel: LngLat[] = [
  [-79.91, 32.816],
  [-79.9, 32.828],
  [-79.893, 32.834],
];

export const channelLabel: LngLat = [-79.885, 32.762];

export const harborBounds: [LngLat, LngLat] = [
  [-80.02, 32.705],
  [-79.78, 32.925],
];

export type Lamp = { lng: number; lat: number; kind: "bridge" | "tower" | "wharf" | "crane" | "street" };

export const lamps: Lamp[] = buildLamps();

function buildLamps(): Lamp[] {
  const lamps: Lamp[] = [];
  for (const point of sampleLine(ravenelLine, 32)) {
    lamps.push({ lng: point[0], lat: point[1], kind: "bridge" });
  }
  const span = features.find((feature) => feature.osmId === 927255592);
  if (span) {
    for (const point of asLine(span.coordinates)) {
      lamps.push({ lng: point[0], lat: point[1], kind: "tower" });
    }
  }
  if (donHoltRing.length >= 2) {
    const west = [...donHoltRing].sort((a, b) => a[0] - b[0])[0];
    const east = [...donHoltRing].sort((a, b) => b[0] - a[0])[0];
    for (const point of sampleLine([west, east], 28)) {
      lamps.push({ lng: point[0], lat: point[1], kind: "street" });
    }
  }
  for (const terminal of terminals) {
    for (const point of sampleLine(terminal.ring, 55)) {
      lamps.push({ lng: point[0], lat: point[1], kind: "wharf" });
    }
    let craneStep = 0;
    for (const edge of berthEdges(terminal.ring, terminal.seaward)) {
      for (const point of sampleLine([edge.a, edge.b], 45)) {
        lamps.push({ lng: point[0], lat: point[1], kind: "wharf" });
        craneStep++;
        if (craneStep % 2 === 0) {
          const inland = offsetAway(point, terminal.seaward, 22);
          lamps.push({ lng: inland[0], lat: inland[1], kind: "crane" });
        }
      }
    }
  }
  return lamps;
}

function berthEdges(ring: LngLat[], seaward: LngLat[]): { a: LngLat; b: LngLat }[] {
  const edges: { dist: number; a: LngLat; b: LngLat }[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const cos = Math.cos((mid[1] * Math.PI) / 180);
    const east = (mid[0] - seaward[0]) * 111320 * cos;
    const north = (mid[1] - seaward[1]) * 111320;
    edges.push({ dist: Math.hypot(east, north), a, b });
  }
  if (!edges.length) return [];
  edges.sort((a, b) => a.dist - b.dist);
  return edges.filter((edge) => edge.dist < edges[0].dist + 140).slice(0, 10);
}

function leathermanBerth(terminal: TerminalPlace): TerminalPlace {
  // The OSM industrial polygon sits inland of the wharf. The berth is the
  // crane line on the west bank of the Cooper River.
  const ring = closeRing([
    [-79.9672, 32.8508],
    [-79.9528, 32.8502],
    [-79.9506, 32.8658],
    [-79.9648, 32.8672],
    [-79.9672, 32.8508],
  ]);
  const seaward: LngLat = [-79.942, 32.858];
  return { ...terminal, ring, seaward, label: offsetAway(ringCentroid(ring), seaward, 240) };
}

function joinLines(parts: LngLat[][]): LngLat[] {
  const unused = parts.filter((part) => part.length > 1).map((part) => part.slice());
  if (!unused.length) return [];
  unused.sort((a, b) => a[0][0] - b[0][0]);
  const line = unused.shift()!;
  if (line[0][0] > line[line.length - 1][0]) line.reverse();
  while (unused.length) {
    const end = line[line.length - 1];
    let best = 0;
    let bestDist = Infinity;
    let reverse = false;
    for (let i = 0; i < unused.length; i++) {
      const part = unused[i];
      const d0 = Math.hypot(part[0][0] - end[0], part[0][1] - end[1]);
      const d1 = Math.hypot(part[part.length - 1][0] - end[0], part[part.length - 1][1] - end[1]);
      if (d0 < bestDist) {
        best = i;
        bestDist = d0;
        reverse = false;
      }
      if (d1 < bestDist) {
        best = i;
        bestDist = d1;
        reverse = true;
      }
    }
    const next = unused.splice(best, 1)[0];
    if (reverse) next.reverse();
    line.push(...next.slice(1));
  }
  return line;
}

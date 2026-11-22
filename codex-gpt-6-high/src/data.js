export const HARBOR_BOUNDS = [
  [-80.012, 32.705],
  [-79.756, 32.935],
];
// Geographic annotations, not a navigational chart. Berth lines follow OpenStreetMap terminal outlines, cross-checked with SC Ports maps and USGS imagery.
export const TERMINALS = [
  {
    id: "wando",
    name: "Wando Welch",
    fullName: "Wando Welch Terminal",
    short: "WW",
    coordinate: [-79.8899, 32.8338],
    berth: [
      [-79.89373, 32.82856],
      [-79.88926, 32.83833],
    ],
    label: [-79.8896, 32.8395],
  },
  {
    id: "north",
    name: "North Charleston",
    fullName: "North Charleston Terminal",
    short: "NC",
    coordinate: [-79.9592, 32.9024],
    berth: [
      [-79.96178, 32.89981],
      [-79.95657, 32.90493],
    ],
    label: [-79.975, 32.908],
  },
  {
    id: "leatherman",
    name: "Leatherman",
    fullName: "Hugh Leatherman Terminal",
    short: "HL",
    coordinate: [-79.9343, 32.838],
    berth: [
      [-79.93312, 32.83588],
      [-79.93285, 32.83973],
    ],
    label: [-79.952, 32.84],
  },
  {
    id: "columbus",
    name: "Columbus Street",
    fullName: "Columbus Street Terminal",
    short: "CS",
    coordinate: [-79.9285, 32.7967],
    berth: [
      [-79.92551, 32.79242],
      [-79.93086, 32.80204],
    ],
    label: [-79.947, 32.7957],
  },
];
export const BRIDGES = [
  {
    id: "ravenel",
    name: "Ravenel Bridge",
    coordinate: [-79.9138, 32.8032],
    line: [
      [-79.932, 32.8075],
      [-79.8951, 32.7978],
    ],
    cable: true,
  },
  {
    id: "holt",
    name: "Don Holt Bridge",
    coordinate: [-79.9497, 32.8913],
    line: [
      [-79.9621, 32.8932],
      [-79.9365, 32.8894],
    ],
    cable: false,
  },
];
export const CHANNEL = [
  [-79.771, 32.713],
  [-79.804, 32.731],
  [-79.85, 32.753],
  [-79.884, 32.774],
  [-79.901, 32.791],
  [-79.914, 32.808],
  [-79.919, 32.828],
  [-79.927, 32.844],
  [-79.93, 32.864],
  [-79.944, 32.881],
  [-79.95, 32.897],
  [-79.959, 32.91],
];
export const WANDO_CHANNEL = [
  [-79.919, 32.815],
  [-79.91, 32.819],
  [-79.899, 32.826],
  [-79.895, 32.838],
  [-79.891, 32.845],
];
export const REFRESH_MS = 10 * 60 * 1000;
export function distanceMeters(a, b) {
  const lat = ((a[1] + b[1]) * Math.PI) / 360;
  return Math.hypot(
    (a[0] - b[0]) * 111320 * Math.cos(lat),
    (a[1] - b[1]) * 111320,
  );
}
function distanceToLine(point, line) {
  const lat = (point[1] * Math.PI) / 180;
  const project = (p) => [
    (p[0] - point[0]) * 111320 * Math.cos(lat),
    (p[1] - point[1]) * 111320,
  ];
  const [a, b] = line.map(project);
  const d = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(
    0,
    Math.min(1, -(a[0] * d[0] + a[1] * d[1]) / (d[0] ** 2 + d[1] ** 2)),
  );
  return Math.hypot(a[0] + t * d[0], a[1] + t * d[1]);
}
export function terminalFor(vessel) {
  if (vessel.speed == null || vessel.speed > 0.8) return null;
  let closest = null,
    best = 350;
  for (const t of TERMINALS) {
    const d = distanceToLine(vessel.coordinates, t.berth);
    if (d < best) {
      best = d;
      closest = t.id;
    }
  }
  return closest;
}
export function timeLocal(value, seconds = false) {
  if (!value) return "unknown";
  const date = new Date(value);
  return Number.isNaN(+date)
    ? "unknown"
    : date.toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        ...(seconds ? { second: "2-digit" } : {}),
        hour12: false,
      });
}
export function reportAge(value, now = Date.now()) {
  if (!value) return "unknown";
  const age = Math.max(0, Math.floor((now - new Date(value)) / 60000));
  return age < 1 ? "just now" : `${age}m ago`;
}
export function isAged(source, now = Date.now()) {
  return (
    !source?.fetchedAt ||
    source.status !== "live" ||
    now - new Date(source.fetchedAt) > REFRESH_MS + 60000
  );
}
export function mergeSnapshot(previous, incoming) {
  const result = { ...incoming };
  for (const key of ["ais", "tide", "clearance"]) {
    const next = incoming[key];
    if (next?.status === "unavailable" && previous?.[key]?.data != null) {
      result[key] = { ...previous[key], status: "stale", error: next.error };
    }
  }
  return result;
}
export function flagName(code) {
  if (!code) return "unknown";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}
export function flagEmoji(code) {
  return /^[A-Z]{2}$/.test(code ?? "")
    ? String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0)))
    : "⚑";
}

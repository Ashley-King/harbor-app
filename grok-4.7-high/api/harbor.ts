import type { HarborResponse, LevelFeed, Ship, ShipModel, ShipsFeed } from "../src/types";

const UA = "harbor-bench/1.0";
const BBOX = "32.70,-80.05,32.95,-79.75";
const AIS = "https://ais.openwaters.io/v1/vessels";

type GeoFeature = {
  geometry?: { type?: string; coordinates?: [number, number] } | null;
  properties?: Record<string, unknown>;
};

export async function getHarbor(): Promise<HarborResponse> {
  const [ships, tide, clearance] = await Promise.all([
    loadShips().catch(() => failShips()),
    loadLevel("8665530", "water_level", "MLLW", "Charleston").catch(() => failLevel()),
    loadLevel("8665353", "air_gap", "STND", "Ravenel Bridge").catch(() => failLevel()),
  ]);
  return { ships, tide, clearance };
}

export async function GET(): Promise<Response> {
  const body = await getHarbor();
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function failShips(): ShipsFeed {
  return { ok: false, error: "AIS feed unavailable" };
}

function failLevel(): LevelFeed {
  return { ok: false, error: "NOAA feed unavailable" };
}

async function loadShips(): Promise<ShipsFeed> {
  const url = `${AIS}?bbox=${BBOX}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/geo+json, application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return failShips();
  const body = (await res.json()) as { features?: GeoFeature[] };
  const features = Array.isArray(body.features) ? body.features : [];
  const rough = features.map(toRough).filter((ship): ship is Rough => ship != null && include(ship));
  const deadline = Date.now() + 6500;
  const enriched = await mapPool(rough, 6, async (ship) => {
    if (Date.now() > deadline) return finish(ship, null);
    try {
      const detail = await fetchDetail(ship.mmsi);
      return finish(ship, detail);
    } catch {
      return finish(ship, null);
    }
  });
  enriched.sort((a, b) => (b.lengthM ?? 0) - (a.lengthM ?? 0) || (a.name ?? "").localeCompare(b.name ?? ""));
  return { ok: true, asOf: new Date().toISOString(), vessels: enriched };
}

async function fetchDetail(mmsi: number): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${AIS}/${mmsi}`, {
    headers: { "User-Agent": UA, Accept: "application/geo+json, application/json" },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { properties?: Record<string, unknown> };
  return body.properties ?? null;
}

type Rough = {
  mmsi: number;
  name: string | null;
  flag: string | null;
  imo: string | null;
  typeCode: number | null;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
  destination: string | null;
  eta: string | null;
  draughtM: number | null;
  seen: string | null;
  lat: number;
  lon: number;
  aisLength: number | null;
  aisBeam: number | null;
  toBow: number | null;
  toStern: number | null;
  toPort: number | null;
  toStarboard: number | null;
};

function toRough(feature: GeoFeature): Rough | null {
  const geometry = feature.geometry;
  const props = feature.properties ?? {};
  if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) return null;
  if (props.kind != null && props.kind !== "vessel") return null;
  const [lon, lat] = geometry.coordinates;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const mmsi = asInt(props.mmsi);
  if (mmsi == null) return null;
  return {
    mmsi,
    name: text(props.name),
    flag: flagCode(props.flag),
    imo: imo(props.imo),
    typeCode: asInt(props.type),
    sog: ranged(props.sog, 0, 80),
    cog: ranged(props.cog, 0, 360),
    heading: ranged(props.heading, 0, 359.9),
    navStatus: asInt(props.nav_status),
    destination: text(props.destination),
    eta: text(props.eta),
    draughtM: ranged(props.draught, 0.1, 30),
    seen: text(props.seen),
    lat,
    lon,
    aisLength: ranged(props.length, 2, 450),
    aisBeam: ranged(props.beam, 1, 75),
    toBow: ranged(props.to_bow, 1, 400),
    toStern: ranged(props.to_stern, 1, 400),
    toPort: ranged(props.to_port, 0.5, 60),
    toStarboard: ranged(props.to_starboard, 0.5, 60),
  };
}

function include(ship: Rough): boolean {
  const type = ship.typeCode;
  if (type === 31 || type === 32 || type === 50 || type === 52) return true;
  if (type != null && type >= 60 && type <= 89) return true;
  if (ship.aisLength != null && ship.aisLength > 150) return true;
  return false;
}

function finish(ship: Rough, detail: Record<string, unknown> | null): Ship {
  const particulars = (detail?.particulars ?? null) as Record<string, unknown> | null;
  const shipType = text(particulars?.ship_type);
  const service = text(particulars?.service);
  const detailText = shipType ?? service;
  const registeredLength = ranged(particulars?.length, 2, 450);
  const registeredBeam = ranged(particulars?.beam, 1, 75);
  const lengthM = pickDim(ship.aisLength, registeredLength);
  const beamM = pickDim(ship.aisBeam, registeredBeam);
  const typeLabel = shipType
    ? sentence(shipType)
    : service
      ? sentence(service)
      : ship.typeCode == null
        ? null
        : ituLabel(ship.typeCode);
  return {
    mmsi: ship.mmsi,
    name: ship.name ?? text(detail?.name),
    flag: ship.flag ?? flagCode(detail?.flag),
    imo: ship.imo ?? imo(detail?.imo),
    typeCode: ship.typeCode,
    typeLabel,
    model: modelFor(ship.typeCode, detailText, lengthM),
    lengthM,
    beamM,
    sog: ship.sog,
    cog: ship.cog,
    heading: ship.heading,
    navStatus: ship.navStatus,
    destination: ship.destination,
    eta: ship.eta,
    draughtM: ship.draughtM,
    seen: ship.seen,
    lat: ship.lat,
    lon: ship.lon,
    toBow: ship.toBow,
    toStern: ship.toStern,
    toPort: ship.toPort,
    toStarboard: ship.toStarboard,
  };
}

function pickDim(reported: number | null, registered: number | null): number | null {
  if (reported != null && registered != null) {
    const ratio = reported / registered;
    if (ratio > 1.45 || ratio < 0.7) return registered;
    return reported;
  }
  return reported ?? registered;
}

function modelFor(typeCode: number | null, detail: string | null, length: number | null): ShipModel {
  const text = (detail ?? "").toLowerCase();
  if (text.includes("container")) return "container";
  if (/(tanker|\blng\b|\blpg\b|chemical tanker|oil tanker|gas carrier)/.test(text)) return "tanker";
  if (text.includes("bulk")) return "bulk";
  if (/(vehicle|ro-ro|roro|roll-on|roll on|car carrier)/.test(text)) return "roro";
  if (text.includes("cruise")) return "cruise";
  if (/(tug|towing)/.test(text)) return "tug";
  if (text.includes("pilot")) return "pilot";
  if (typeCode === 31 || typeCode === 32 || typeCode === 52) return "tug";
  if (typeCode === 50) return "pilot";
  if (typeCode != null && typeCode >= 80 && typeCode <= 89) return "tanker";
  if (typeCode != null && typeCode >= 60 && typeCode <= 69) return (length ?? 0) >= 140 ? "cruise" : "passenger";
  if (text.includes("passenger")) return (length ?? 0) >= 140 ? "cruise" : "passenger";
  return "cargo";
}

function ituLabel(code: number): string | null {
  if (code === 31 || code === 32 || code === 52) return "Tug";
  if (code === 50) return "Pilot boat";
  if (code >= 60 && code <= 69) return "Passenger ship";
  if (code >= 70 && code <= 79) return "Cargo ship";
  if (code >= 80 && code <= 89) return "Tanker";
  return null;
}

async function loadLevel(station: string, product: string, datum: string, fallbackName: string): Promise<LevelFeed> {
  const url = new URL("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter");
  url.searchParams.set("station", station);
  url.searchParams.set("product", product);
  url.searchParams.set("datum", datum);
  url.searchParams.set("time_zone", "gmt");
  url.searchParams.set("units", "english");
  url.searchParams.set("format", "json");
  url.searchParams.set("date", "latest");
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return failLevel();
  const body = (await res.json()) as {
    error?: { message?: string };
    metadata?: { name?: string; id?: string };
    data?: { t?: string; v?: string }[];
  };
  if (body.error) return failLevel();
  const row = body.data?.[0];
  const feet = row ? Number(row.v) : NaN;
  if (!row?.t || !Number.isFinite(feet)) return failLevel();
  return {
    ok: true,
    asOf: noaaTimeToIso(row.t),
    feet,
    station: body.metadata?.id || station,
    name: body.metadata?.name || fallbackName,
  };
}

function noaaTimeToIso(value: string): string {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (!match) return new Date().toISOString();
  return `${match[1]}T${match[2]}:${match[3] ?? "00"}Z`;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sentence(value: string): string {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function asInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n)) return null;
  return n;
}

function ranged(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function imo(value: unknown): string | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  return /^\d{7}$/.test(raw) ? raw : null;
}

function flagCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

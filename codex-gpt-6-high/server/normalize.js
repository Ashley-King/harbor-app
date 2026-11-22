function number(value, min = 0, max = Infinity) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n < max ? n : null;
}
function text(value) {
  return typeof value === "string" && value.trim() && value !== "@@@@"
    ? value.replace(/@+$/, "").trim()
    : null;
}
export function modelType(p) {
  const detail = p.particulars ?? {};
  const label = [
    detail.ship_type,
    detail.type,
    detail.vessel_type,
    p.ship_type,
    p.vessel_type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/container/.test(label)) return "container";
  if (/tanker|chemical|oil/.test(label) || (p.type >= 80 && p.type <= 89))
    return "tanker";
  if (/vehicle|car carrier|ro.ro|ro\/ro|roll.on.roll.off/.test(label))
    return "roro";
  if (/bulk/.test(label)) return "bulk";
  if (/cruise/.test(label)) return "cruise";
  if ([31, 32, 52].includes(p.type)) return "tug";
  if (p.type === 50) return "pilot";
  if (p.type >= 60 && p.type <= 69) return "passenger";
  if (p.type >= 70 && p.type <= 79) return "cargo";
  return "unknown";
}
export function normalizeVessel(feature) {
  const p = feature.properties ?? {};
  const coordinates = feature.geometry?.coordinates;
  if (
    feature.geometry?.type !== "Point" ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    !coordinates.slice(0, 2).every(Number.isFinite)
  )
    return null;
  if (
    coordinates[0] < -80.05 ||
    coordinates[0] > -79.75 ||
    coordinates[1] < 32.7 ||
    coordinates[1] > 32.95
  )
    return null;
  if (p.kind && p.kind !== "vessel") return null;
  const type = number(p.type, 0, 100);
  const length = number(p.length, 0.1);
  const beam = number(p.beam, 0.1);
  const mmsi = String(p.mmsi ?? feature.id ?? "");
  if (!/^\d{9}$/.test(mmsi)) return null;
  const large = (type >= 60 && type <= 89) || length > 150;
  const support = [31, 32, 50, 52].includes(type);
  if (!large && !support) return null;
  const heading = number(p.heading, 0, 360);
  const course = number(p.cog, 0, 360);
  const date = Date.parse(p.seen);
  const model = modelType(p);
  const particulars = p.particulars ?? {};
  return {
    id: mmsi,
    mmsi,
    name: text(p.name),
    coordinates: coordinates.slice(0, 2),
    type,
    model,
    large,
    length,
    beam,
    heading,
    course,
    speed: number(p.sog, 0, 102.3),
    imo: number(p.imo, 1000000, 10000000),
    flag: text(p.flag),
    destination: text(p.destination),
    eta: text(p.eta),
    draught: number(p.draught, 0.1, 25.6),
    navStatus: number(p.nav_status, 0, 15),
    seen: Number.isFinite(date) ? new Date(date).toISOString() : null,
    source: text(p.source),
    toBow: number(p.to_bow, 0),
    toPort: number(p.to_port, 0),
    typeDescription: text(
      particulars.ship_type ??
        particulars.vessel_type ??
        (typeof particulars.type === "string" ? particulars.type : null),
    ),
    modelInferred:
      model === "cargo" || model === "passenger" || model === "unknown",
    dimensionsSuspect: length === 511 || beam === 63,
  };
}
export function normalizeAIS(json, now = Date.now()) {
  if (json?.type !== "FeatureCollection" || !Array.isArray(json.features))
    throw new Error("AIS returned an invalid collection");
  const vessels = json.features
    .map(normalizeVessel)
    .filter(Boolean)
    .filter(
      (v) =>
        v.seen &&
        now - Date.parse(v.seen) <= 30 * 60 * 1000 &&
        Date.parse(v.seen) <= now + 5 * 60 * 1000,
    );
  return {
    vessels,
    attribution: json.attribution ?? {},
    totalReports: json.features.length,
    truncated: !!json.truncated,
  };
}
export function normalizeNOAA(json) {
  if (json?.error)
    throw new Error(json.error.message || "NOAA reports no observations");
  if (!Array.isArray(json?.data))
    throw new Error("NOAA returned no observations");
  const readings = json.data
    .map((d) => ({
      time: typeof d.t === "string" ? d.t.replace(" ", "T") + "Z" : null,
      value: number(d.v, -1000, 1000),
      flags: text(d.f),
      quality: text(d.q),
    }))
    .filter((d) => d.value != null && Number.isFinite(Date.parse(d.time)))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (!readings.length) throw new Error("NOAA returned no valid readings");
  return {
    station: json.metadata?.id ?? null,
    name: json.metadata?.name ?? null,
    latest: readings.at(-1),
    readings,
  };
}

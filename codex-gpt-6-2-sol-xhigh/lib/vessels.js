export const AIS_BOUNDS = [[32.70, -80.05], [32.95, -79.75]];
export const REPORT_WINDOW = 90 * 60_000;
export const AGING_REPORT = 20 * 60_000;
export const REFRESH_INTERVAL = 10 * 60_000;

// Static ship classes corroborated by the MARAD RRF and Coast Guard COFR registers.
const reserveRoRo = /^CAPE (DECISION|DOMINGO|DOUGLAS|DUCATO)$/i;
const registeredBulk = new Set(['9644550']);

function number(value, min = -Infinity, max = Infinity) {
  if (value === '' || value == null || !Number.isFinite(Number(value))) return null;
  const result = Number(value);
  return result >= min && result <= max ? result : null;
}

function text(value) {
  if (typeof value !== 'string') return null;
  const result = value.trim().replace(/@+$/, '').trim();
  return result && !/^(?:n[\s/.]*a|unknown|not available|[-?]+)$/i.test(result) ? result : null;
}

export function vesselClass({ type, name, subtype, length }) {
  const description = subtype ?? '';
  if (type === 50 || /\bpilot (boat|vessel)\b/i.test(description)) return 'pilot';
  if ([31, 32, 52].includes(type) || /\btug\b/i.test(description)) return 'tug';
  if (/bulk (carrier|cargo)/i.test(description)) return 'bulk';
  if (/ro[ /-]?ro|roll.on|vehicle carrier|car carrier|\bpctc\b/i.test(description)) return 'ro-ro';
  if (/container/i.test(description)) return 'container';
  if (/tank(er|ship)/i.test(description) || type >= 80 && type <= 89) return 'tanker';
  if (/cruise/i.test(description) || type >= 60 && type <= 69) return 'passenger';
  if (type >= 70 && type <= 79 && /^(?:MSC |CMA CGM |MAERSK |COSCO SHIPPING |EVER |HMM |OOCL |ZIM |ONE |YM )/i.test(name ?? '') && length >= 150) return 'container';
  return 'cargo';
}

export const CLASS_NAMES = {
  container: 'Container ship', tanker: 'Tanker', 'ro-ro': 'Ro/Ro carrier',
  bulk: 'Bulk carrier', passenger: 'Passenger ship', cargo: 'Cargo / large vessel',
  tug: 'Tug', pilot: 'Pilot boat',
};

export function normalizeVessel(feature, now = Date.now()) {
  const p = feature?.properties;
  if (!p || p.kind && p.kind !== 'vessel' || feature.geometry?.type !== 'Point') return null;
  const [lon, lat] = feature.geometry.coordinates ?? [];
  const id = String(p.mmsi ?? feature.id ?? '');
  const seen = Date.parse(p.seen);
  const [[south, west], [north, east]] = AIS_BOUNDS;
  if (!/^\d{9}$/.test(id) || !Number.isFinite(seen) || seen > now + 60_000 || now - seen > REPORT_WINDOW ||
      !Number.isFinite(lon) || !Number.isFinite(lat) || lon < west || lon > east || lat < south || lat > north) return null;

  const type = number(p.type, 1, 99);
  const toBow = number(p.to_bow, 0, 511);
  const toStern = number(p.to_stern, 0, 511);
  const toPort = number(p.to_port, 0, 63);
  const toStarboard = number(p.to_starboard, 0, 63);
  const length = number(p.length, 1, 1022) ?? (toBow != null && toStern != null ? number(toBow + toStern, 1) : null);
  const beam = number(p.beam, 1, 126) ?? (toPort != null && toStarboard != null ? number(toPort + toStarboard, 1) : null);
  const name = text(p.name);
  const imo = /^\d{7}$/.test(String(p.imo)) ? String(p.imo) : null;
  const reportedSubtype = text(p.particulars?.ship_type ?? p.particulars?.vessel_type ?? p.particulars?.type ?? p.ship_type_name);
  const registerSubtype = reserveRoRo.test(name ?? '') && type >= 70 && type <= 79 ? 'Ro/Ro carrier' : registeredBulk.has(imo) ? 'Bulk carrier' : null;
  const subtype = reportedSubtype ?? registerSubtype;
  const large = (type >= 60 && type <= 89) || length > 150;
  const category = vesselClass({ type, name, subtype, length });
  if (!large && !['tug', 'pilot'].includes(category)) return null;

  return {
    id, position: [lat, lon], name, type, subtype, category, large, seen: new Date(seen).toISOString(),
    flag: /^[a-z]{2}$/i.test(p.flag ?? '') ? p.flag.toUpperCase() : null,
    imo,
    length, beam, heading: number(p.heading, 0, 359), course: number(p.cog, 0, 359.999),
    speed: number(p.sog, 0, 102.2), nav: number(p.nav_status, 0, 14),
    destination: text(p.destination), eta: text(p.eta), draught: number(p.draught, 0.1, 25.5),
    toBow, toStern, toPort, toStarboard,
  };
}

export function isMoving(ship) {
  return ![1, 5, 6].includes(ship.nav) && ship.speed >= 0.7;
}

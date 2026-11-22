// Vessel helpers shared by the serverless function and the browser.
// Everything here reads AIS fields as reported. Nothing is filled in or guessed:
// a missing or out-of-range field becomes null and the UI shows "unknown".

/** AIS ship-type code (ITU-R M.1371) to a plain description. */
export function aisTypeName(type) {
  if (type == null || type === 0) return null;
  const t = Number(type);
  const special = {
    30: 'Fishing vessel', 31: 'Towing vessel', 32: 'Towing vessel (long tow)', 33: 'Dredger or underwater operations',
    34: 'Diving operations', 35: 'Military vessel', 36: 'Sailing vessel', 37: 'Pleasure craft',
    50: 'Pilot vessel', 51: 'Search and rescue vessel', 52: 'Tug', 53: 'Port tender',
    54: 'Anti-pollution vessel', 55: 'Law enforcement vessel', 58: 'Medical transport', 59: 'Noncombatant ship',
  };
  if (special[t]) return special[t];
  const decade = Math.floor(t / 10);
  const base = { 2: 'Wing-in-ground craft', 4: 'High-speed craft', 6: 'Passenger ship', 7: 'Cargo ship', 8: 'Tanker', 9: 'Other vessel' }[decade];
  if (!base) return null;
  const haz = { 1: 'hazard category A', 2: 'hazard category B', 3: 'hazard category C', 4: 'hazard category D' }[t % 10];
  return haz ? `${base}, ${haz}` : base;
}

export const NAV_STATUS = {
  0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command', 3: 'Restricted manoeuvrability',
  4: 'Constrained by draught', 5: 'Moored', 6: 'Aground', 7: 'Engaged in fishing', 8: 'Under way sailing',
  11: 'Towing astern', 12: 'Pushing ahead or towing alongside', 14: 'AIS-SART active',
};

/**
 * AIS encodes hull dimensions as distances from the GPS antenna. 511 m (bow or stern)
 * and 63 m (port or starboard) are the "this or more" caps, which in practice mark a
 * transponder that was never configured. Those and zero-size hulls count as unknown.
 */
export function hullDimensions(p) {
  const a = num(p.to_bow), b = num(p.to_stern), c = num(p.to_port), d = num(p.to_starboard);
  const hasParts = a != null && b != null && c != null && d != null;
  const capped = hasParts && (a >= 511 || b >= 511 || c >= 63 || d >= 63);
  let length = num(p.length), beam = num(p.beam);
  if (hasParts) {
    length = a + b;
    beam = c + d;
  }
  if (capped || length == null || beam == null || length < 3 || beam < 1 || length > 460 || beam > 70 || beam > length) {
    return { length: null, beam: null, toBow: null, toStern: null, toPort: null, toStarboard: null };
  }
  return hasParts
    ? { length, beam, toBow: a, toStern: b, toPort: c, toStarboard: d }
    : { length, beam, toBow: null, toStern: null, toPort: null, toStarboard: null };
}

/**
 * Which drawing group a vessel belongs to.
 *  ship  - AIS types 60-89 (passenger, cargo, tanker) or any hull longer than 150 m
 *  tug   - tugs and towing vessels
 *  pilot - pilot vessels
 *  other - everything else, drawn faded
 */
export function vesselGroup(type, length) {
  const t = Number(type) || 0;
  if ((t >= 60 && t <= 89) || (length != null && length > 150)) return 'ship';
  if (t === 52 || t === 31 || t === 32) return 'tug';
  if (t === 50) return 'pilot';
  return 'other';
}

export function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function cleanText(v) {
  if (v == null) return null;
  const s = String(v).replace(/@+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
}

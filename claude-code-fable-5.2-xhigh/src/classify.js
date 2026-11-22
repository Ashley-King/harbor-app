// Decides how each vessel is drawn and where it is berthed.
//
// AIS gives a broad type (cargo, tanker, passenger, tug, pilot) but not the kind of
// cargo ship. Tankers, passenger vessels, tugs and pilot boats are drawn straight
// from the AIS type. For cargo ships the model is an estimate from the name, the
// berth and the size, and the ship card says so. The AIS type itself is always
// shown exactly as reported.

const CONTAINER_NAME = /^(MSC|CMA CGM|APL|ANL|MAERSK|SEALAND|EVER|COSCO|OOCL|CSCL|ONE|YM|ZIM|HMM|HYUNDAI|HAPAG|NYK|WAN HAI|SEASPAN|CONTI|GSL|KOTA|X-PRESS|CAP|SANTA|NORTHERN|AL)\b|\bMAERSK\b|\bEXPRESS$/;
const CARRIER_NAME = /\b(LEADER|HIGHWAY|ACE)$|^(HOEGH|HÖEGH|GLOVIS|MORNING|GRANDE|RCC|ARC|ALLIANCE|GREEN|AUTO|TORINO|TOSCA|TITUS|TALISMAN|TONSBERG|THERMOPYLAE|THEBEN|TORRENS|TOLEDO|TAMESIS|TIJUCA|TIRRANNA|TOMBARRA|TORTUGAS|TYSLA|TARAGO|TAMERLANE|TRAVIATA|FIDELIO|FAUST|FIGARO|OBERON|OTELLO|PARSIFAL|SALOME|UNDINE|CARMEN|AIDA|ELEKTRA|MIGNON|TITANIA|TRISTAN|ENDURANCE|PATRIOT|LIBERTY|FREEDOM|RESOLVE|HONOR|INTEGRITY)\b/;
const RESERVE_FLEET = /^CAPE [A-Z]+$/;

/** { model, how } where how is 'ais', 'name', 'berth' or 'size'. */
export function chooseModel(v, berth) {
  const L = v.length;
  const type = v.type || 0;
  const name = (v.name || '').toUpperCase();
  if (v.group === 'pilot') return { model: 'pilot', how: 'ais' };
  if (v.group === 'tug') return { model: 'tug', how: 'ais' };
  if (type === 52 || type === 31 || type === 32) return { model: 'atb', how: 'size' };   // a tug longer than 150 m is a tug and barge unit
  if (type >= 60 && type <= 69) return { model: L >= 55 ? 'cruise' : 'tourboat', how: 'ais' };
  if (type >= 80 && type <= 89) return { model: 'tanker', how: 'ais' };
  if (type >= 70 && type <= 79) {
    if (RESERVE_FLEET.test(name) && v.flag === 'US') return { model: 'roro', how: 'name' };
    if (CARRIER_NAME.test(name)) return { model: 'carcarrier', how: 'name' };
    if (CONTAINER_NAME.test(name)) return { model: 'container', how: 'name' };
    if (berth && ['wando', 'nct', 'leatherman'].includes(berth.terminal)) return { model: 'container', how: 'berth' };
    if (berth && berth.terminal === 'columbus' && L >= 160 && v.beam >= 28) return { model: 'carcarrier', how: 'berth' };
    if (L >= 245) return { model: 'container', how: 'size' };
    if (L >= 150) return { model: 'bulk', how: 'size' };
    return { model: 'cargo', how: 'size' };
  }
  return { model: 'plain', how: 'size' };
}

export const HOW_TEXT = {
  ais: null,
  name: 'estimated from the name',
  berth: 'estimated from the berth',
  size: 'estimated from the size',
};

function segDistance(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
  const qx = a[0] + dx * t, qy = a[1] + dy * t;
  return { d: Math.hypot(px - qx, py - qy), t, qx, qy };
}

/**
 * The wharf a stationary vessel is lying at, if any.
 * Returns { terminal, label, bearing, a, out }: the wharf's bearing in degrees, a point
 * on its face and the unit vector pointing from the face out over the water.
 */
export function findBerth(x, y, beam, harbor) {
  let best = null;
  for (const term of harbor.terminals) {
    for (const w of term.wharves) {
      const s = segDistance(x, y, w.a, w.b);
      const out = (x - s.qx) * w.out[0] + (y - s.qy) * w.out[1];
      const limit = (beam || 20) / 2 + 55;
      if (s.d < limit && out > -15 && (!best || s.d < best.d)) {
        const bearing = (Math.atan2(w.b[0] - w.a[0], w.b[1] - w.a[1]) * 180) / Math.PI;
        best = { d: s.d, terminal: term.id, label: term.label, container: term.container, bearing: (bearing + 360) % 360, a: w.a, out: w.out };
      }
    }
  }
  return best;
}

/** Name of the nearest charted place, for vessels that are not at a terminal. */
export function nearestPlace(x, y, harbor, maxDist = 900) {
  let best = null;
  for (const l of harbor.labels) {
    if (l.kind !== 'landmark') continue;
    const d = Math.hypot(x - l.at[0], y - l.at[1]);
    if (d < maxDist && (!best || d < best.d)) best = { d, text: l.text };
  }
  return best ? best.text : null;
}

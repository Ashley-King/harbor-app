import { Builder, hullOutline, sliceOutline } from './builder.js';
import { clamp } from '../util.js';

// Top-down 3D models of the vessel kinds that call at Charleston. Each builder gets
// the hull's true length and beam (metres) from AIS and returns a geometry scaled to
// them, plus where its navigation and deck lights sit. Paint schemes and the exact
// deck clutter are generic for the kind: AIS does not describe them.

const WHITE = 0xf1f1ec;
const OFFWHITE = 0xdcdcd4;
const STEEL = 0x8d9499;
const DARK = 0x2a2d30;
const BOOT = 0x6e1f1a; // red anti-fouling band at the waterline
const WINDOW = 0x16222c;
const ORANGE = 0xe4601e;
const DECK_GREEN = 0x3c5f50;
const DECK_RED = 0x73392f;
const DECK_GREY = 0x6b7074;

const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

// Masts, outriggers, a dredge's crane boom and its legs go into a second geometry,
// `spars`. They are drawn like the rest of the vessel but cast no shadow: a mast is
// tens of metres tall and a hand's width across, and its shadow reads as a stray
// black line over the water.

const GUNWALE = 0xc6ccd0;

/**
 * A hull outline moved in from the edge by w metres all round. The outline runs up
 * the starboard side from stern to bow and back down the port side (see hullOutline).
 */
function inset(outline, w) {
  const n = outline.length / 2;
  const x0 = outline[0][0], x1 = outline[n - 1][0];
  const mid = (x0 + x1) / 2, k = (x1 - x0 - 2 * w) / (x1 - x0);
  const side = [];
  for (let i = 0; i < n; i++) {
    if (outline[i][1] - w > 0.03) side.push([mid + (outline[i][0] - mid) * k, outline[i][1] - w]);
  }
  if (side.length < 2) return null;
  const out = side.map((p) => [p[0], p[1]]);
  for (let i = side.length - 1; i >= 0; i--) out.push([side[i][0], -side[i][1]]);
  return out;
}

/**
 * The deck of a ship seen from above: a pale strip round the edge with the deck
 * colour inside it. From overhead the painted hull sides cannot be seen, so without
 * the strip a dark deck melts into dark water and into the shadows of the cranes.
 * The strip also holds a little light at night.
 */
function deckEdge(b, outline, y, deck, beam) {
  const inner = inset(outline, clamp(beam * 0.03, 0.35, 1.5));
  if (inner) b.prism(inner, y, y + 0.06, deck, deck);
}

function hull(b, outline, freeboard, side, deck) {
  b.prism(outline, -1.5, 1.1, BOOT, BOOT, { noTop: true });
  b.prism(outline, 1.1, freeboard, side, GUNWALE, { topGlow: 0.14 });
  deckEdge(b, outline, freeboard, deck, outline.halfAt(0) * 2);
}

/** Deckhouse with a full-width bridge and wings on top. Returns the bridge roof height. */
function deckhouse(b, x, y0, len, width, beam, decks, color = WHITE) {
  const h = decks * 2.9;
  b.on(x, 0, y0, len, h, width, color, { top: OFFWHITE });
  // window bands
  for (let d = 1; d < decks; d++) b.on(x + len / 2 + 0.05, 0, y0 + d * 2.9 - 1.9, 0.12, 1.0, width * 0.9, WINDOW, { glow: 0.5 });
  const by = y0 + h;
  b.on(x + len * 0.12, 0, by, len * 0.7, 3.0, beam * 0.98, color, { top: OFFWHITE });       // bridge with wings
  b.on(x + len * 0.12 + len * 0.35 + 0.05, 0, by + 1.2, 0.12, 1.2, beam * 0.6, WINDOW, { glow: 0.35 });
  b.on(x, 0, by + 3.0, 2.2, 5.5, 2.2, OFFWHITE);                                           // radar mast
  b.on(x, 0, by + 8.0, 0.6, 0.5, 7.0, OFFWHITE);
  return by + 3.0;
}

function funnel(b, x, z, y0, len, height, width, color, band) {
  b.on(x, z, y0, len, height, width, color, { top: DARK });
  if (band != null) b.on(x, z, y0 + height * 0.55, len + 0.1, height * 0.2, width + 0.1, band);
}

function winches(b, rand, x0, x1, y, beamAt) {
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
    const w = beamAt(x) * 0.5;
    b.on(x, (rand() - 0.5) * w * 1.2, y, 2.2, 1.4, 3.2, DARK);
  }
}

// ------------------------------------------------------------------ container ship

const LINES = [
  { re: /^MSC\b/, hull: 0x18181a, funnel: 0xe6d6a0, band: 0x18181a, boxes: [0xd29b3a, 0xd29b3a, 0xc98a2b, 0x8a5a2c] },
  { re: /^CMA CGM\b|^APL\b|^ANL\b/, hull: 0x13254a, funnel: 0xf1f1ec, band: 0xb3202a, boxes: [0x1c3c78, 0x1c3c78, 0x254d95, 0xc4c9cc] },
  { re: /MAERSK|^SEALAND\b/, hull: 0x7fb4d8, funnel: 0x7fb4d8, band: 0xf1f1ec, boxes: [0xc4c9cc, 0xb4bbc0, 0x8fa9bd, 0x33506e] },
  { re: /EXPRESS$|^HAPAG|^AL /, hull: 0x1b1b1d, funnel: 0xe2702a, band: 0x1b1b1d, boxes: [0xdc6a26, 0xdc6a26, 0xc65a1c, 0x2b3f6b] },
  { re: /^ONE\b/, hull: 0xcf2378, funnel: 0xcf2378, band: 0xf1f1ec, boxes: [0xcf2378, 0xcf2378, 0xd9488f, 0xc4c9cc] },
  { re: /^EVER\b/, hull: 0x1d6a3a, funnel: 0x1d6a3a, band: 0xf1f1ec, boxes: [0x1f7a40, 0x1f7a40, 0x2d8a50, 0xc4c9cc] },
  { re: /^COSCO|^OOCL|^CSCL|^XIN /, hull: 0x23324a, funnel: 0x2a5ea8, band: 0xe6c12a, boxes: [0x2a5ea8, 0x7d8a94, 0xb9bfc4, 0xa33327] },
  { re: /^YM\b/, hull: 0x232629, funnel: 0xe9e4d2, band: 0xb3202a, boxes: [0xbfc4c8, 0xa9afb4, 0x8e959b, 0x2b4a7a] },
  { re: /^ZIM\b/, hull: 0x1c2f55, funnel: 0xf1f1ec, band: 0x1c2f55, boxes: [0xe5e5e0, 0xd2d2cc, 0xd8782a, 0x1c2f55] },
  { re: /^HMM\b|^HYUNDAI/, hull: 0x1b2c4e, funnel: 0x1b2c4e, band: 0xe6e6e0, boxes: [0x2a4f8f, 0xc9552a, 0xc4c9cc, 0x1b2c4e] },
];
const MIXED_BOXES = [0x7a2a26, 0x224c7c, 0x2e6b4a, 0xc9ced2, 0xc8642a, 0x8f4a2c, 0x2a7f86, 0x8b9096, 0xd4a53c, 0x4a5560, 0xa9342c, 0x1f3f7a];

export function containerShip(L, B, rand, info = {}) {
  const b = new Builder();
  const name = (info.name || '').toUpperCase();
  const line = LINES.find((l) => l.re.test(name)) || { hull: pick(rand, [0x1a1b1e, 0x5c1f1d, 0x16284a, 0x2f3438]), funnel: pick(rand, [0xe8e2cf, 0x1d3f77, 0xb3202a]), band: null, boxes: [] };
  const D = clamp(B * 0.34, 7, 17);
  const outline = hullOutline(L, B, { bow: 0.2, bowA: 1.55, bowB: 0.9, stern: 0.07, transom: 0.86 });
  const deck = pick(rand, [DECK_GREEN, DECK_RED, DECK_GREY]);
  hull(b, outline, D, line.hull, deck);
  const bowX = L / 2, sternX = -L / 2;

  // forecastle and mooring decks
  const fc = sliceOutline(outline, bowX - L * 0.085, bowX - 0.4);
  b.prism(fc, D, D + 2.6, line.hull, deck);
  winches(b, rand, bowX - L * 0.075, bowX - L * 0.02, D + 2.6, outline.halfAt);
  b.on(bowX - L * 0.06, 0, D + 2.6, 1.1, 15, 1.1, OFFWHITE);                 // foremast
  b.on(bowX - L * 0.088, 0, D, 0.8, 4.2, outline.halfAt(bowX - L * 0.088) * 1.9, line.hull); // breakwater
  winches(b, rand, sternX + 3, sternX + L * 0.035, D, outline.halfAt);

  // superstructure: forward island on the largest ships, aft house otherwise
  const twin = L >= 330;
  const houseLen = clamp(L * 0.045, 10, 16);
  const houseX = twin ? bowX - L * 0.31 : sternX + L * (L > 240 ? 0.2 : 0.17);
  const decks = Math.round(clamp(L / 34, 5, 10));
  const bridgeY = deckhouse(b, houseX, D, houseLen, B * 0.82, B, decks);
  const funnelX = twin ? sternX + L * 0.2 : houseX - houseLen / 2 - 7;
  const fH = twin ? decks * 2.9 * 0.85 : decks * 2.9 * 0.9;
  b.on(funnelX, 0, D, 11, fH * 0.55, B * 0.5, WHITE, { top: OFFWHITE });       // engine casing
  funnel(b, funnelX, 0, D + fH * 0.55, 6.5, fH * 0.55, 8, line.funnel, line.band);

  // container bays
  const bayLen = 12.6, gap = 1.3, boxH = 2.59, boxW = 2.44, rowPitch = 2.52;
  const zones = [];
  const start = sternX + L * 0.045 + 3, end = bowX - L * 0.095;
  const blocked = [[houseX - houseLen / 2 - 1.5, houseX + houseLen / 2 + 3], [funnelX - 7, funnelX + 7]];
  let x = start;
  while (x + bayLen < end) {
    const hit = blocked.find(([a, c]) => x < c && x + bayLen > a);
    if (hit) {
      x = hit[1] + 0.5;
      continue;
    }
    zones.push(x + bayLen / 2);
    x += bayLen + gap;
  }
  const maxTiers = Math.round(clamp(B / 5.4, 3, 9));
  // How full the deck is. A ship that has just finished discharging can be nearly bare.
  const load = 0.55 + rand() * 0.45;
  const palette = line.boxes.length ? [...line.boxes, ...line.boxes, ...MIXED_BOXES] : MIXED_BOXES;
  let boxes = 0;
  for (const cx of zones) {
    const rows = Math.max(2, Math.floor((outline.halfAt(cx + bayLen / 2) * 2 - 2.6) / rowPitch));
    // Stacks step down toward the bow so the bridge can see over them.
    const ahead = cx > houseX ? (cx - houseX) / (bowX - houseX) : 0;
    const sight = Math.round(maxTiers - 3.2 * ahead ** 1.1);
    const behind = cx < houseX && !twin ? maxTiers : sight;
    const bayMax = Math.max(1, Math.min(maxTiers, cx > houseX ? sight : behind));
    const bayFill = rand() < load ? bayMax - Math.floor(rand() * 2.2) : Math.floor(rand() * 3);
    b.on(cx, 0, D, bayLen + 0.4, 1.3, rows * rowPitch + 0.6, 0x4f5559);        // hatch cover
    if (bayFill <= 0) continue;
    const dominant = pick(rand, palette);
    for (let r = 0; r < rows; r++) {
      const z = (r - (rows - 1) / 2) * rowPitch;
      let tiers = bayFill - (rand() < 0.3 ? 1 : 0) - (rand() < 0.08 ? 2 : 0);
      if (tiers <= 0) continue;
      const twenty = rand() < 0.22;
      for (let t = 0; t < tiers; t++) {
        const y = D + 1.3 + t * boxH;
        const top = t === tiers - 1;
        if (!top && r > 0 && r < rows - 1) continue;                            // hidden inside the stack
        const col = () => (rand() < 0.45 ? dominant : pick(rand, palette));
        if (twenty) {
          b.on(cx - 3.1, z, y, 6.06, boxH, boxW, col(), { noBottom: true });
          b.on(cx + 3.1, z, y, 6.06, boxH, boxW, col(), { noBottom: true });
          boxes += 2;
        } else {
          b.on(cx, z, y, 12.19, boxH, boxW, col(), { noBottom: true });
          boxes++;
        }
      }
    }
    // lashing bridge at the end of the bay
    b.on(cx + bayLen / 2 + gap / 2, 0, D, 0.7, Math.min(bayFill, 3) * boxH + 1.3, rows * rowPitch, 0x5d6468);
  }
  const lights = {
    masthead: [bowX - L * 0.06, D + 18, 0],
    masthead2: [houseX, bridgeY + 6.5, 0],
    port: [houseX + houseLen * 0.2, bridgeY - 1, -B / 2 + 0.6],
    stbd: [houseX + houseLen * 0.2, bridgeY - 1, B / 2 - 0.6],
    stern: [sternX + 1, D + 3, 0],
  };
  const work = [];
  for (let i = 0; i < zones.length; i += 2) work.push([zones[i], D + maxTiers * boxH * 0.5, 0, B * 0.55]);
  return { geometry: b.build(), height: bridgeY + 9, lights, work, note: `${boxes} boxes` };
}

// ------------------------------------------------------------------ tanker

export function tanker(L, B, rand) {
  const b = new Builder();
  const D = clamp(B * 0.2, 3.5, 9);
  const outline = hullOutline(L, B, { bow: 0.1, bowA: 2.1, bowB: 0.6, stern: 0.07, transom: 0.8 });
  const side = pick(rand, [0x1c1d20, 0x5f201c, 0x1a2d4f, 0x23382c]);
  const deck = pick(rand, [DECK_RED, DECK_GREEN, 0x7b3f33]);
  hull(b, outline, D, side, deck);
  const bowX = L / 2, sternX = -L / 2;
  const houseLen = clamp(L * 0.07, 9, 16);
  const houseX = sternX + L * 0.13;
  const cargo0 = houseX + houseLen / 2 + 6, cargo1 = bowX - L * 0.09;
  // deck frames
  for (let x = cargo0; x < cargo1; x += Math.max(6, L / 36)) b.on(x, 0, D, 0.5, 0.35, outline.halfAt(x) * 1.9, 0x5a2d26);
  // centreline pipe rack and catwalk
  const pipes = L > 150 ? 5 : 3;
  for (let i = 0; i < pipes; i++) {
    const z = (i - (pipes - 1) / 2) * 1.5;
    b.on((cargo0 + cargo1) / 2, z, D + 1.0, cargo1 - cargo0 - 6, 0.7, 0.7, i % 2 ? 0x9aa0a4 : 0xb8bdc0);
  }
  b.on((cargo0 + cargo1) / 2, -(pipes * 0.75 + 1.6), D + 2.0, cargo1 - cargo0 - 2, 0.25, 1.6, 0xb9bec2);
  for (let x = cargo0 + 4; x < cargo1 - 4; x += 12) b.on(x, 0, D, 0.6, 1.3, pipes * 1.5 + 2, 0x70777b);
  // cargo manifold amidships: cross-deck pipes ending in valves at both rails
  const mx = (cargo0 + cargo1) / 2;
  const mcount = L > 150 ? 6 : 4;
  for (let i = 0; i < mcount; i++) {
    const x = mx + (i - (mcount - 1) / 2) * 2.6;
    b.on(x, 0, D + 1.2, 0.8, 0.8, B * 0.86, i % 2 ? 0xc2c6c9 : 0xa33327);
    for (const s of [-1, 1]) b.on(x, s * B * 0.43, D + 0.8, 1.3, 1.5, 1.3, 0xd0b02a);
  }
  for (const s of [-1, 1]) b.on(mx, s * B * 0.4, D, mcount * 2.6 + 3, 0.3, 4.5, 0x8e9499);     // drip trays
  // hose cranes
  for (const s of [-1, 1]) {
    b.cyl(mx + s * (mcount * 1.3 + 5), 0, D, D + 9, 1.1, OFFWHITE);
    b.on(mx + s * (mcount * 1.3 + 5) - s * 7, 3.2 * s, D + 8.6, 15, 0.9, 0.9, 0xd9b326, { yaw: 0.22 * s });
  }
  // tank hatches and vents
  const tanks = Math.round(clamp(L / 26, 4, 9));
  for (let i = 0; i < tanks; i++) {
    const x = cargo0 + ((cargo1 - cargo0) * (i + 0.5)) / tanks;
    for (const s of [-1, 1]) {
      const z = s * outline.halfAt(x) * 0.52;
      b.cyl(x - 3, z, D, D + 1.2, 1.3, 0x9a9fa3);
      b.cyl(x + 3.5, z * 1.25, D, D + 2.6, 0.35, 0xc8ccd0);
    }
  }
  // forecastle
  const fc = sliceOutline(outline, bowX - L * 0.075, bowX - 0.3);
  b.prism(fc, D, D + 2.4, side, deck);
  winches(b, rand, bowX - L * 0.065, bowX - L * 0.015, D + 2.4, outline.halfAt);
  b.on(bowX - L * 0.05, 0, D + 2.4, 1, 13, 1, OFFWHITE);
  // accommodation, funnel, lifeboat
  const decks = Math.round(clamp(L / 40, 3, 6));
  const bridgeY = deckhouse(b, houseX, D, houseLen, B * 0.72, B, decks);
  funnel(b, houseX - houseLen / 2 - 5.5, 0, D, 6, decks * 2.9 + 6, 6.5, pick(rand, [0x1b2c4e, 0xe9e4d2, 0x1d1e21, 0xb3202a]), pick(rand, [0xe6e6e0, 0xb3202a, 0x2a5ea8]));
  b.on(sternX + 5, B * 0.2, D + 1, 8, 2.6, 2.8, ORANGE, { pitch: -0.25 });                  // free-fall lifeboat
  winches(b, rand, sternX + 2, sternX + L * 0.03, D, outline.halfAt);
  const lights = {
    masthead: [bowX - L * 0.05, D + 15.5, 0],
    masthead2: [houseX, bridgeY + 6.5, 0],
    port: [houseX + houseLen * 0.2, bridgeY - 1, -B / 2 + 0.6],
    stbd: [houseX + houseLen * 0.2, bridgeY - 1, B / 2 - 0.6],
    stern: [sternX + 1, D + 3, 0],
  };
  const work = [[mx, D + 6, 0, B * 0.6], [cargo0 + (cargo1 - cargo0) * 0.2, D + 6, 0, B * 0.5], [cargo0 + (cargo1 - cargo0) * 0.82, D + 6, 0, B * 0.5]];
  return { geometry: b.build(), height: bridgeY + 9, lights, work };
}

// ------------------------------------------------------------------ car carrier

export function carCarrier(L, B, rand, info = {}) {
  const b = new Builder();
  const H = clamp(B * 0.95, 22, 36);
  const outline = hullOutline(L, B, { bow: 0.13, bowA: 2.0, bowB: 0.62, stern: 0.05, transom: 0.92 });
  const scheme = pick(rand, [
    { low: 0x1b2f55, up: 0xf1f1ec, deck: 0x8f9a94 },
    { low: 0x23382f, up: 0xf1f1ec, deck: 0x7f8d86 },
    { low: 0x70777c, up: 0xe9e9e4, deck: 0x8b9296 },
    { low: 0xb3402a, up: 0xf1f1ec, deck: 0x8f9a94 },
  ]);
  if (info.grey) Object.assign(scheme, { low: 0x6f777d, up: 0x8d959b, deck: 0x7b8388 });
  b.prism(outline, -1.5, 1.1, BOOT, BOOT, { noTop: true });
  b.prism(outline, 1.1, H * 0.36, scheme.low, scheme.low, { noTop: true });
  b.prism(outline, H * 0.36, H, scheme.up, GUNWALE, { topGlow: 0.14 });
  deckEdge(b, outline, H, scheme.deck, B);
  const bowX = L / 2, sternX = -L / 2;
  // weather deck: ventilator housings in two lines, lane markings
  const n = Math.round(L / 11);
  for (let i = 1; i < n; i++) {
    const x = sternX + (L * i) / n;
    if (x > bowX - L * 0.2) continue;
    for (const s of [-1, 1]) b.on(x, s * B * 0.34, H, 2.6, 1.9, 2.0, 0xc9cdcf, { top: 0xdfe2e3 });
    if (i % 3 === 0) b.on(x, 0, H, 3.4, 1.4, 3.4, 0xb0b5b8);
  }
  for (const s of [-1, 1]) b.on(-L * 0.04, s * B * 0.12, H, L * 0.62, 0.12, 0.5, 0xd8dbd6);
  // bridge across the full beam near the bow
  const bx = bowX - L * 0.13;
  b.on(bx, 0, H, 9, 3.4, B * 1.0, WHITE, { top: OFFWHITE });
  b.on(bx + 4.55, 0, H + 1.3, 0.12, 1.3, B * 0.8, WINDOW, { glow: 0.4 });
  b.on(bx - 1, 0, H + 3.4, 2, 6, 2, OFFWHITE);
  b.on(bx - 1, 0, H + 8.5, 0.6, 0.5, 6.5, OFFWHITE);
  // funnel aft, offset to starboard as on most car carriers
  funnel(b, sternX + L * 0.14, B * 0.24, H, 7, 8.5, 5, scheme.low, 0xe6e6e0);
  // open mooring decks at bow and stern
  b.on(bowX - L * 0.045, 0, H, L * 0.05, 0.25, outline.halfAt(bowX - L * 0.045) * 1.5, 0x5f6669);
  b.on(sternX + L * 0.03, 0, H, L * 0.045, 0.25, B * 0.7, 0x5f6669);
  // stern quarter ramp, stowed upright against the starboard quarter
  b.on(sternX + 1.2, B * 0.3, H * 0.3, 1.6, H * 0.62, 8.5, 0x9aa0a4);
  // lifeboats recessed along the sides
  for (const s of [-1, 1]) b.on(sternX + L * 0.28, s * (B / 2 - 0.4), H * 0.72, 9, 2.8, 1.6, ORANGE);
  const lights = {
    masthead: [bx - 1, H + 9, 0],
    masthead2: [sternX + L * 0.2, H + 11, 0],
    port: [bx, H + 2.5, -B / 2 + 0.5],
    stbd: [bx, H + 2.5, B / 2 - 0.5],
    stern: [sternX + 1, H * 0.5, 0],
  };
  b.on(sternX + L * 0.2, 0, H, 1, 10.5, 1, OFFWHITE);
  const work = [[sternX + L * 0.08, H * 0.6, B * 0.45, 16], [0, H + 4, 0, B * 0.4]];
  return { geometry: b.build(), height: H + 11, lights, work };
}

// ------------------------------------------------------------------ bulk carrier and general cargo

export function bulkCarrier(L, B, rand, info = {}) {
  const b = new Builder();
  const D = clamp(B * 0.28, 4.5, 11);
  const outline = hullOutline(L, B, { bow: 0.11, bowA: 2.1, bowB: 0.6, stern: 0.07, transom: 0.8 });
  const side = pick(rand, [0x1b1c1f, 0x5d211d, 0x18305a, 0x1f4a3a, 0x3a3d40]);
  const deck = pick(rand, [DECK_RED, 0x7b3f33, DECK_GREEN]);
  hull(b, outline, D, side, deck);
  const bowX = L / 2, sternX = -L / 2;
  const houseLen = clamp(L * 0.075, 8, 15);
  const houseX = sternX + L * 0.12;
  const hold0 = houseX + houseLen / 2 + 5, hold1 = bowX - L * 0.085;
  const hatches = info.general ? Math.max(2, Math.round(L / 45)) : Math.round(clamp(L / 27, 4, 9));
  const pitch = (hold1 - hold0) / hatches;
  const geared = info.general || L < 205;
  const coverCol = pick(rand, [0x8a8f93, 0x9a6a3a, 0x49685a, 0xa8553a]);
  for (let i = 0; i < hatches; i++) {
    const x = hold0 + pitch * (i + 0.5);
    const w = Math.min(B * 0.56, outline.halfAt(x + pitch * 0.35) * 2 - 6);
    const len = pitch - (geared ? 7.5 : 4.2);
    b.on(x, 0, D, len, 1.9, w, coverCol, { top: coverCol });
    // folding cover panels
    const panels = Math.max(2, Math.round(len / 5));
    for (let k = 1; k < panels; k++) b.on(x - len / 2 + (len * k) / panels, 0, D + 1.9, 0.3, 0.25, w, 0x4b4f52);
    b.on(x, 0, D, len + 1.4, 0.9, w + 1.6, 0x55595c);                                     // coaming
  }
  if (geared) {
    const cranes = info.general ? Math.max(1, hatches - 1) : Math.min(4, hatches - 1);
    for (let i = 0; i < cranes; i++) {
      const x = hold0 + pitch * (i + 1) * (hatches / (cranes + 1));
      b.cyl(x, 0, D, D + 10, 1.9, 0xd8b93a);
      b.on(x, 0, D + 10, 4.6, 3.2, 4.6, 0xd8b93a, { top: 0xc4a52f });
      b.on(x + pitch * 0.42, 0, D + 12, pitch * 0.78, 1.1, 1.3, 0xd8b93a, { pitch: 0.06 });
    }
  }
  const fc = sliceOutline(outline, bowX - L * 0.075, bowX - 0.3);
  b.prism(fc, D, D + 2.5, side, deck);
  winches(b, rand, bowX - L * 0.065, bowX - L * 0.015, D + 2.5, outline.halfAt);
  b.on(bowX - L * 0.05, 0, D + 2.5, 1, 12, 1, OFFWHITE);
  const decks = Math.round(clamp(L / 38, 3, 6));
  const bridgeY = deckhouse(b, houseX, D, houseLen, B * 0.7, B, decks);
  funnel(b, houseX - houseLen / 2 - 5, 0, D, 5.5, decks * 2.9 + 5.5, 6, pick(rand, [0x1b2c4e, 0xe9e4d2, 0x1d1e21, 0x2f6b4a]), pick(rand, [0xe6e6e0, 0xb3202a, 0xd9b326]));
  b.on(sternX + 4.5, -B * 0.18, D + 1, 7.5, 2.5, 2.7, ORANGE, { pitch: -0.25 });
  winches(b, rand, sternX + 2, sternX + L * 0.03, D, outline.halfAt);
  const lights = {
    masthead: [bowX - L * 0.05, D + 14.5, 0],
    masthead2: [houseX, bridgeY + 6.5, 0],
    port: [houseX + houseLen * 0.2, bridgeY - 1, -B / 2 + 0.6],
    stbd: [houseX + houseLen * 0.2, bridgeY - 1, B / 2 - 0.6],
    stern: [sternX + 1, D + 3, 0],
  };
  const work = [];
  for (let i = 0; i < hatches; i += 2) work.push([hold0 + pitch * (i + 0.5), D + 8, 0, B * 0.5]);
  return { geometry: b.build(), height: bridgeY + 9, lights, work };
}

// ------------------------------------------------------------------ cruise ship, small passenger vessels

export function cruiseShip(L, B, rand) {
  const b = new Builder();
  const big = L >= 150;
  const D = clamp(B * 0.32, 4, 13);
  const outline = hullOutline(L, B, { bow: 0.22, bowA: 1.6, bowB: 0.9, stern: 0.06, transom: 0.9 });
  const hullCol = big ? pick(rand, [WHITE, WHITE, 0x1a2a4c]) : WHITE;
  const teak = 0xb89462;
  hull(b, outline, D, hullCol, 0xd3d6d4);
  const bowX = L / 2, sternX = -L / 2;
  // stepped superstructure tiers
  const tiers = big ? 5 : L > 70 ? 3 : 2;
  const tierH = big ? 5.6 : 3.0;
  let x0 = sternX + L * (big ? 0.035 : 0.08), x1 = bowX - L * (big ? 0.2 : 0.24);
  let y = D;
  let half = B / 2 - 0.4;
  for (let t = 0; t < tiers; t++) {
    const o = sliceOutline(outline, x0, x1).map((p) => [p[0], Math.sign(p[1]) * Math.min(Math.abs(p[1]), half)]);
    b.prism(o, y, y + tierH, WHITE, t === tiers - 1 ? 0x9fb4c2 : teak);
    // balcony and window bands
    for (const s of [-1, 1]) b.on((x0 + x1) / 2, s * (half + 0.03), y + tierH * 0.3, (x1 - x0) * 0.9, tierH * 0.4, 0.08, WINDOW, { glow: 0.55 });
    y += tierH;
    x0 += L * (big ? 0.035 : 0.04);
    x1 -= L * (big ? 0.03 : 0.045);
    half -= big ? 1.1 : 0.7;
  }
  const top = y;
  const tx0 = x0 - L * 0.035 + 2, tx1 = x1 + L * 0.03 - 2;
  // lifeboats along both sides, just below the open decks
  if (L > 60) {
    const boats = Math.round(clamp(L / 22, 3, 9));
    for (let i = 0; i < boats; i++) {
      const x = sternX + L * 0.2 + (L * 0.48 * i) / Math.max(1, boats - 1);
      for (const s of [-1, 1]) b.on(x, s * (B / 2 - 0.2), D + tierH * 0.7, Math.min(9, L / 24), 2.6, 2.9, i % 3 === 2 ? WHITE : ORANGE, { top: 0xf4a25a });
    }
  }
  // sun deck: pools, hot tubs, loungers, sports court
  const deckLen = tx1 - tx0;
  if (L > 60) {
    const pools = big ? 2 : 1;
    for (let i = 0; i < pools; i++) {
      const px = tx0 + deckLen * (pools === 1 ? 0.5 : 0.36 + i * 0.26);
      const pw = Math.min(big ? 8 : 4.5, half * 0.8), pl = big ? 13 : 6.5;
      b.on(px, 0, top, pl + 2.4, 0.5, pw + 2.4, 0xe9e7e0);
      b.on(px, 0, top + 0.5, pl, 0.12, pw, 0x39b9d8, { topGlow: 0.9, glow: 0.3 });
      for (const s of [-1, 1]) b.cyl(px + pl / 2 + 3.2, s * pw * 0.42, top, top + 0.6, 1.5, 0xe9e7e0, { top: 0x55c6de, topGlow: 0.8 });
      // rows of loungers
      for (let k = 0; k < 6; k++) for (const s of [-1, 1]) b.on(px - pl / 2 + (pl * (k + 0.5)) / 6, s * (pw / 2 + 2.6), top, 1.9, 0.4, 0.8, pick(rand, [0xf5f5f0, 0x2a6fb0, 0xf2c14a]));
    }
    if (big) {
      b.on(tx0 + deckLen * 0.86, 0, top, 16, 0.15, half * 1.3, 0x2e7d4f);            // sports court
      b.on(tx0 + deckLen * 0.86, 0, top + 0.15, 0.25, 0.05, half * 1.3, WHITE);
      b.on(tx0 + deckLen * 0.5, 0, top, 14, 2.6, half * 1.1, 0x9fc4d6, { top: 0xbfdbe8 }); // glazed atrium roof
    }
  }
  // bridge with wings, radar mast, satellite domes
  const bx = x1 + L * 0.03;
  b.on(bx, 0, top - tierH, 7, tierH + 1.2, B * 0.98, WHITE, { top: OFFWHITE });
  b.on(bx + 3.55, 0, top - tierH * 0.5, 0.12, 1.4, B * 0.8, WINDOW, { glow: 0.4 });
  b.on(bx - 5, 0, top, 2, 8, 2, OFFWHITE);
  b.on(bx - 5, 0, top + 6.5, 0.6, 0.5, 8, OFFWHITE);
  for (const s of [-1, 1]) b.cyl(bx - 11, s * half * 0.55, top, top + 3, 1.7, WHITE, { seg: 8 });
  // funnel
  const fx = tx0 + deckLen * 0.16;
  funnel(b, fx, 0, top, big ? 11 : 4.5, big ? 11 : 4.5, big ? 8 : 3.2, pick(rand, [0x1a2a4c, 0xb3202a, 0xf1f1ec, 0x17466f]), pick(rand, [0xf1f1ec, 0xe6c12a, 0xb3202a]));
  // foredeck: winches and a helipad on the big ships
  winches(b, rand, bowX - L * 0.14, bowX - L * 0.04, D, outline.halfAt);
  if (big) b.cyl(bowX - L * 0.085, 0, D, D + 0.2, Math.min(7, outline.halfAt(bowX - L * 0.085) * 0.8), 0x2f6b4a, { seg: 16 });
  // terraced stern with its own pool
  if (big) {
    b.on(sternX + L * 0.03, 0, D, 9, 0.5, B * 0.45, 0xe9e7e0);
    b.on(sternX + L * 0.03, 0, D + 0.5, 7, 0.1, B * 0.36, 0x39b9d8, { topGlow: 0.9 });
  }
  const lights = {
    masthead: [bx - 5, top + 7.5, 0],
    masthead2: big ? [fx + 8, top + 13, 0] : null,
    port: [bx, top - tierH + 2, -B / 2 + 0.4],
    stbd: [bx, top - tierH + 2, B / 2 - 0.4],
    stern: [sternX + 1, D + 2.5, 0],
  };
  if (big) b.on(fx + 8, 0, top, 1, 12.5, 1, OFFWHITE);
  const work = [];
  for (let i = 0; i < Math.max(2, Math.round(L / 40)); i++) work.push([tx0 + (deckLen * (i + 0.5)) / Math.max(2, Math.round(L / 40)), top + 3, 0, B * 0.6]);
  return { geometry: b.build(), height: top + 14, lights, work, festive: true };
}

/** Harbor tour boats, water taxis and small ferries. */
export function tourBoat(L, B, rand) {
  const b = new Builder();
  const D = clamp(B * 0.22, 1.2, 2.6);
  const outline = hullOutline(L, B, { bow: 0.3, bowA: 1.6, bowB: 0.85, stern: 0.08, transom: 0.92 });
  const trim = pick(rand, [0x1b3a6b, 0x7a1f1f, 0x1d5a3a, 0x202326]);
  hull(b, outline, D, WHITE, 0xc9c5b8);
  b.prism(outline, D - 0.5, D - 0.1, trim, trim, { noTop: true });
  const x0 = -L / 2 + L * 0.1, x1 = L / 2 - L * 0.3;
  const cabin = sliceOutline(outline, x0, x1).map((p) => [p[0], Math.sign(p[1]) * Math.min(Math.abs(p[1]), B / 2 - 0.5)]);
  b.prism(cabin, D, D + 2.5, WHITE, 0xd8d5c8);
  for (const s of [-1, 1]) b.on((x0 + x1) / 2, s * (B / 2 - 0.47), D + 1.1, (x1 - x0) * 0.86, 1.0, 0.06, WINDOW, { glow: 0.6 });
  // open top deck with a canopy and bench rows
  const top = D + 2.5;
  b.on(x0 + (x1 - x0) * 0.42, 0, top + 2.3, (x1 - x0) * 0.62, 0.15, B * 0.84, pick(rand, [0xf2f2ee, 0x1b3a6b, 0x9c2a2a]));
  for (let x = x0 + 2; x < x1 - 2; x += 1.7) b.on(x, 0, top, 0.5, 0.5, B * 0.6, 0x6b5a45);
  b.on(x1 - 1.5, 0, top, 3, 2.3, B * 0.5, WHITE, { top: OFFWHITE });                      // wheelhouse
  b.on(x1 - 0.02, 0, top + 1.1, 0.06, 0.9, B * 0.42, WINDOW, { glow: 0.4 });
  b.on(x1 - 2.2, 0, top + 2.3, 0.3, 2.6, 0.3, OFFWHITE);
  const lights = {
    masthead: [x1 - 2.2, top + 5.0, 0],
    masthead2: null,
    port: [x1 - 1.5, top + 2.0, -B * 0.28],
    stbd: [x1 - 1.5, top + 2.0, B * 0.28],
    stern: [-L / 2 + 0.5, D + 1.2, 0],
  };
  return { geometry: b.build(), height: top + 5, lights, work: [[0, top + 2, 0, B * 0.8]], festive: true };
}

// ------------------------------------------------------------------ tug, pilot boat, tug-and-barge unit

function tugShape(b, L, B, rand, x = 0, yaw = 0) {
  // built around (x, 0); yaw is unused (kept for symmetry) because the tug rides in line with its barge
  const D = clamp(B * 0.2, 1.4, 2.8);
  const outline = hullOutline(L, B, { bow: 0.36, bowA: 2.0, bowB: 0.62, stern: 0.2, transom: 0.72 }).map((p) => [p[0] + x, p[1]]);
  outline.halfAt = (px) => hullOutline(L, B, { bow: 0.36, bowA: 2.0, bowB: 0.62, stern: 0.2, transom: 0.72 }).halfAt(px - x);
  const liv = pick(rand, [
    { house: 0xa8262a, trim: 0xf1f1ec, stack: 0x1b1b1d },   // red house
    { house: 0xf1f1ec, trim: 0x1f3f77, stack: 0x1f3f77 },   // white and blue
    { house: 0xe8e2cf, trim: 0x2f6b4a, stack: 0x2f6b4a },   // buff and green
    { house: 0xf1f1ec, trim: 0x1b1b1d, stack: 0x8a1f1f },
  ]);
  b.prism(outline, -1.2, D, 0x151618, pick(rand, [0x70352c, 0x3c5f50, 0x5a5f63]));
  // rubber fendering all round the rail
  const rim = outline.map((p) => [x + (p[0] - x) * 1.012, p[1] * 1.03]);
  b.prism(rim, D - 0.5, D + 0.35, 0x0c0d0e, 0x0c0d0e, { noTop: true });
  b.on(x + L * 0.47, 0, D - 0.6, L * 0.07, 1.3, B * 0.42, 0x0c0d0e);                       // bow fender
  const hx = x + L * 0.1, hl = L * 0.32, hw = B * 0.56;
  b.on(hx, 0, D, hl, 2.5, hw, liv.house, { top: OFFWHITE });
  b.on(hx + hl * 0.18, 0, D + 2.5, hl * 0.5, 2.4, hw * 0.74, liv.trim === 0x1b1b1d ? WHITE : liv.house, { top: OFFWHITE }); // wheelhouse
  b.on(hx + hl * 0.18 + hl * 0.25 + 0.03, 0, D + 3.3, 0.06, 1.0, hw * 0.66, WINDOW, { glow: 0.5 });
  for (const s of [-1, 1]) b.on(hx + hl * 0.18, s * (hw * 0.37 + 0.03), D + 3.3, hl * 0.42, 1.0, 0.06, WINDOW, { glow: 0.5 });
  b.on(hx + hl * 0.1, 0, D + 4.9, 0.35, 4.2, 0.35, OFFWHITE);
  for (const s of [-1, 1]) b.cyl(hx - hl * 0.42, s * hw * 0.3, D + 2.5, D + 5.6, 0.62, liv.stack, { top: 0x0d0d0e, seg: 8 });
  b.on(x - L * 0.2, 0, D, L * 0.12, 1.5, B * 0.34, 0x35393c);                              // towing winch
  b.on(x - L * 0.36, 0, D, 0.6, 1.1, B * 0.3, 0x2b2e31);                                   // tow bitts
  return { D, hx, hl, hw };
}

export function tug(L, B, rand) {
  const b = new Builder();
  const t = tugShape(b, L, B, rand);
  const lights = {
    masthead: [t.hx + t.hl * 0.1, t.D + 9.2, 0],
    masthead2: null,
    port: [t.hx + t.hl * 0.18, t.D + 5.1, -t.hw * 0.37],
    stbd: [t.hx + t.hl * 0.18, t.D + 5.1, t.hw * 0.37],
    stern: [-L / 2 + 0.6, t.D + 1.2, 0],
  };
  return { geometry: b.build(), height: t.D + 9.5, lights, work: [[-L * 0.22, t.D + 3, 0, B * 0.7]] };
}

export function pilotBoat(L, B, rand) {
  const b = new Builder();
  const D = clamp(B * 0.22, 1.0, 1.8);
  const outline = hullOutline(L, B, { bow: 0.42, bowA: 1.5, bowB: 0.9, stern: 0.06, transom: 0.94 });
  b.prism(outline, -1, D, 0x15171a, 0x8e9498);
  const rim = outline.map((p) => [p[0] * 1.01, p[1] * 1.04]);
  b.prism(rim, D - 0.4, D + 0.15, 0x0c0d0e, 0x0c0d0e, { noTop: true });
  const hx = L * 0.03, hl = L * 0.38, hw = B * 0.62;
  b.on(hx, 0, D, hl, 2.2, hw, ORANGE, { top: 0xf1f1ec });
  b.on(hx + hl / 2 + 0.03, 0, D + 1.0, 0.06, 0.9, hw * 0.86, WINDOW, { glow: 0.5 });
  for (const s of [-1, 1]) b.on(hx, s * (hw / 2 + 0.03), D + 1.0, hl * 0.8, 0.9, 0.06, WINDOW, { glow: 0.5 });
  b.on(hx - hl * 0.2, 0, D + 2.2, 0.25, 2.6, 0.25, OFFWHITE);
  b.on(hx - hl * 0.2, 0, D + 4.2, 0.3, 0.2, hw * 0.7, OFFWHITE);
  const lights = {
    masthead: [hx - hl * 0.2, D + 5.0, 0],
    masthead2: null,
    port: [hx + hl * 0.3, D + 2.4, -hw / 2],
    stbd: [hx + hl * 0.3, D + 2.4, hw / 2],
    stern: [-L / 2 + 0.4, D + 0.8, 0],
  };
  return { geometry: b.build(), height: D + 5.2, lights, work: [] };
}

/** Articulated tug and barge: a tank barge with the tug locked into a notch at its stern. */
export function tugBarge(L, B, rand) {
  const b = new Builder();
  const tugL = clamp(L * 0.2, 28, 42);
  const tugB = Math.min(B * 0.6, 13);
  const bargeL = L - tugL * 0.72;
  const bx = (L - bargeL) / 2;                               // barge centre
  const D = clamp(B * 0.2, 3, 6);
  const o = hullOutline(bargeL, B, { bow: 0.12, bowA: 2.2, bowB: 0.58, stern: 0.03, transom: 0.98 }).map((p) => [p[0] + bx, p[1]]);
  const side = pick(rand, [0x1b1c1f, 0x1a2d4f, 0x5f201c]);
  const deck = pick(rand, [DECK_RED, DECK_GREY]);
  b.prism(o, -1.5, 1.0, BOOT, BOOT, { noTop: true });
  b.prism(o, 1.0, D, side, deck);
  const c0 = bx - bargeL * 0.4, c1 = bx + bargeL * 0.4;
  for (let i = 0; i < 4; i++) b.on((c0 + c1) / 2, (i - 1.5) * 1.5, D + 0.9, c1 - c0, 0.7, 0.7, i % 2 ? 0x9aa0a4 : 0xb8bdc0);
  for (let x = c0; x < c1; x += 9) b.on(x, 0, D, 0.5, 0.35, B * 0.94, 0x55292a);
  for (let i = 0; i < 5; i++) b.on(bx + (i - 2) * 2.5, 0, D + 1.1, 0.8, 0.8, B * 0.84, i % 2 ? 0xc2c6c9 : 0xa33327);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) b.cyl(c0 + ((c1 - c0) * (i + 0.5)) / 6, s * B * 0.27, D, D + 1.1, 1.2, 0x9a9fa3);
  b.on(bx + bargeL * 0.44, 0, D, 1, 9, 1, OFFWHITE);
  const tx = -L / 2 + tugL / 2;
  const t = tugShape(b, tugL, tugB, rand, tx);
  // raised pilothouse so the tug can see over the barge
  b.on(t.hx, 0, t.D + 4.9, 3.2, 7.5, 3.2, OFFWHITE);
  b.on(t.hx, 0, t.D + 12.4, 5.2, 2.6, 5.6, WHITE, { top: OFFWHITE });
  b.on(t.hx + 2.63, 0, t.D + 13.2, 0.06, 1.1, 4.8, WINDOW, { glow: 0.5 });
  const lights = {
    masthead: [bx + bargeL * 0.44, D + 9.5, 0],
    masthead2: [t.hx, t.D + 16, 0],
    port: [t.hx, t.D + 15, -2.8],
    stbd: [t.hx, t.D + 15, 2.8],
    stern: [-L / 2 + 0.6, t.D + 1.2, 0],
  };
  return { geometry: b.build(), height: t.D + 16.5, lights, work: [[bx, D + 5, 0, B * 0.6]] };
}

/** Roll-on/roll-off cargo ship with an open weather deck (the reserve-fleet "Cape" ships). */
export function roroShip(L, B, rand) {
  const b = new Builder();
  const D = clamp(B * 0.5, 9, 17);
  const outline = hullOutline(L, B, { bow: 0.17, bowA: 1.8, bowB: 0.75, stern: 0.05, transom: 0.92 });
  const grey = 0x7c858b;
  b.prism(outline, -1.5, 1.1, BOOT, BOOT, { noTop: true });
  b.prism(outline, 1.1, D, grey, GUNWALE, { topGlow: 0.14 });
  deckEdge(b, outline, D, 0x646b70, B);
  const bowX = L / 2, sternX = -L / 2;
  const houseLen = clamp(L * 0.1, 12, 22);
  const houseX = sternX + L * 0.2;
  const bridgeY = deckhouse(b, houseX, D, houseLen, B * 0.86, B, 5, 0xc9ced1);
  funnel(b, houseX - houseLen / 2 - 6, 0, D, 7, 17, 7, 0x6f777d, 0x1b1b1d);
  // weather deck lanes, king posts and cargo cranes
  for (let i = -2; i <= 2; i++) b.on((houseX + houseLen / 2 + bowX - L * 0.1) / 2, (i * B) / 6.2, D, bowX - L * 0.1 - houseX - houseLen / 2 - 6, 0.08, 0.35, 0x9aa1a5);
  for (const f of [0.02, 0.24]) {
    const x = L * f;
    for (const s of [-1, 1]) b.on(x, s * B * 0.36, D, 1.6, 15, 1.6, 0xb9bfc3);
    b.on(x, 0, D + 14, 1.4, 1.2, B * 0.74, 0xb9bfc3);
    b.on(x + 9, 0, D + 13, 19, 1.1, 1.2, 0xb9bfc3, { pitch: 0.12 });
  }
  const fc = sliceOutline(outline, bowX - L * 0.09, bowX - 0.3);
  b.prism(fc, D, D + 2.5, grey, 0x646b70);
  winches(b, rand, bowX - L * 0.08, bowX - L * 0.02, D + 2.5, outline.halfAt);
  b.on(bowX - L * 0.06, 0, D + 2.5, 1, 12, 1, 0xc9ced1);
  b.on(sternX + 1.4, B * 0.22, D * 0.35, 1.8, D * 1.1, 9, 0x8e969b);                         // stern ramp, stowed
  const lights = {
    masthead: [bowX - L * 0.06, D + 14.5, 0],
    masthead2: [houseX, bridgeY + 6.5, 0],
    port: [houseX + houseLen * 0.2, bridgeY - 1, -B / 2 + 0.6],
    stbd: [houseX + houseLen * 0.2, bridgeY - 1, B / 2 - 0.6],
    stern: [sternX + 1, D + 3, 0],
  };
  return { geometry: b.build(), height: bridgeY + 9, lights, work: [[L * 0.12, D + 8, 0, B * 0.5]] };
}

/** Plain hull for large vessels of other kinds (naval, research and so on). */
export function plainShip(L, B, rand) {
  const b = new Builder();
  const D = clamp(B * 0.3, 2, 9);
  const outline = hullOutline(L, B, { bow: 0.28, bowA: 1.6, bowB: 0.9, stern: 0.07, transom: 0.85 });
  hull(b, outline, D, 0x7b848a, 0x666d72);
  const houseLen = L * 0.28;
  const hx = -L * 0.04;
  const o = sliceOutline(outline, hx - houseLen / 2, hx + houseLen / 2).map((p) => [p[0], Math.sign(p[1]) * Math.min(Math.abs(p[1]), B * 0.36)]);
  b.prism(o, D, D + 5, 0x8d959b, 0x7a8187);
  b.on(hx + houseLen * 0.22, 0, D + 5, houseLen * 0.3, 3, B * 0.6, 0x8d959b, { top: 0x7a8187 });
  b.on(hx, 0, D + 5, 1.2, 12, 1.2, 0x8d959b);
  b.on(hx - houseLen * 0.2, 0, D + 5, houseLen * 0.14, 5, B * 0.26, 0x6f777d, { top: DARK });
  const lights = {
    masthead: [hx, D + 17.5, 0],
    masthead2: null,
    port: [hx + houseLen * 0.22, D + 7, -B * 0.3],
    stbd: [hx + houseLen * 0.22, D + 7, B * 0.3],
    stern: [-L / 2 + 0.8, D + 2, 0],
  };
  return { geometry: b.build(), height: D + 18, lights, work: [] };
}

// ------------------------------------------------------------------ small craft

/** Sailing yacht: slim hull, cabin trunk, cockpit, mast and a boom with the sail furled on it. */
export function sailboat(L, B, rand) {
  const b = new Builder();
  const D = clamp(B * 0.26, 0.5, 1.7);
  const outline = hullOutline(L, B, { bow: 0.58, bowA: 1.5, bowB: 0.95, stern: 0.2, transom: 0.55, bowTip: 0.03 });
  const hullCol = pick(rand, [WHITE, WHITE, WHITE, 0x1c2f55, 0x1f4a3a, 0x8a1f1f, 0xdcd6c2]);
  b.prism(outline, -0.6, D, hullCol, 0xe9e7df);
  const cover = pick(rand, [0x1f4f8f, 0x1f4f8f, 0xcfc7b0, 0x7a1f1f, 0x2f6b4a, 0x23272b]);
  // cabin trunk, companionway hatch and windows
  const cx = L * 0.1, cl = L * 0.3, cw = B * 0.5;
  b.on(cx, 0, D, cl, 0.5, cw, WHITE, { top: 0xf4f3ee });
  for (const s of [-1, 1]) b.on(cx, s * (cw / 2 + 0.02), D + 0.15, cl * 0.7, 0.22, 0.04, WINDOW, { glow: 0.5 });
  b.on(cx - cl * 0.5 + 0.3, 0, D + 0.5, 0.7, 0.08, cw * 0.4, 0x8d7a5f);
  // cockpit with teak sole and a wheel
  b.on(-L * 0.24, 0, D, L * 0.24, 0.06, B * 0.46, 0xa98a5e);
  b.cyl(-L * 0.3, 0, D + 0.06, D + 0.9, 0.09, STEEL, { seg: 6 });
  b.on(-L * 0.3, 0, D + 0.85, 0.08, 0.5, 0.75, STEEL);
  // mast, boom and furled mainsail under its cover
  const sp = new Builder();
  const mx = L * 0.14, mastH = L * 1.15;
  sp.cyl(mx, 0, D + 0.5, D + mastH, 0.085 + L * 0.004, 0xc9cdd0, { seg: 6 });
  b.on(mx - L * 0.19, 0, D + 1.7, L * 0.38, 0.14, 0.14, 0xc9cdd0);
  b.on(mx - L * 0.19, 0, D + 1.84, L * 0.36, 0.34, 0.36, cover);
  if (L > 17) {
    // ketch: a second, shorter mast aft
    sp.cyl(-L * 0.34, 0, D, D + mastH * 0.62, 0.07 + L * 0.003, 0xc9cdd0, { seg: 6 });
    b.on(-L * 0.42, 0, D + 1.6, L * 0.16, 0.3, 0.3, cover);
  }
  // furled headsail on the forestay, bow pulpit, stern rail
  b.on(mx + (L * 0.5 - mx) * 0.5, 0, D + 0.6, (L * 0.5 - mx) * 0.9, 0.2, 0.2, 0xf1f1ec, { pitch: -0.5 });
  b.on(L * 0.47, 0, D, 0.5, 0.45, B * 0.12, STEEL);
  b.on(-L * 0.49, 0, D, 0.12, 0.5, B * 0.5, STEEL);
  const lights = {
    masthead: [mx, D + mastH, 0], masthead2: null,
    port: [L * 0.44, D + 0.5, -B * 0.1], stbd: [L * 0.44, D + 0.5, B * 0.1], stern: [-L * 0.49, D + 0.6, 0],
  };
  return { geometry: b.build(), spars: sp.build(), height: D + mastH, lights, work: [] };
}

/** Open motor boat: centre console with a T-top, bench seats, outboards. */
export function runabout(L, B, rand) {
  const b = new Builder();
  const D = clamp(B * 0.24, 0.45, 0.9);
  const outline = hullOutline(L, B, { bow: 0.42, bowA: 1.7, bowB: 0.8, stern: 0.05, transom: 0.95 });
  const hullCol = pick(rand, [WHITE, WHITE, 0x9fc4d6, 0x1c2f55, 0xdcd6c2, 0x6f8fa3]);
  b.prism(outline, -0.4, D, hullCol, 0xe4e3dc);
  const sole = sliceOutline(outline, -L * 0.46, L * 0.3).map((p) => [p[0], Math.sign(p[1]) * Math.max(0, Math.abs(p[1]) - 0.28)]);
  b.prism(sole, D - 0.25, D - 0.18, 0xbfc3bd, 0xc9cdc6);
  b.on(L * 0.02, 0, D - 0.18, L * 0.14, 1.0, B * 0.34, WHITE, { top: 0xdedfd9 });                 // console
  b.on(L * 0.02, 0, D + 1.75, L * 0.3, 0.08, B * 0.62, pick(rand, [WHITE, 0x1f4f8f, 0x23272b, 0xcfc7b0]));   // T-top
  for (const s of [-1, 1]) for (const f of [-0.11, 0.15]) b.cyl(L * (0.02 + f), s * B * 0.24, D - 0.18, D + 1.75, 0.04, STEEL, { seg: 5 });
  b.on(-L * 0.12, 0, D - 0.18, L * 0.07, 0.55, B * 0.5, 0xd8d2bf);                               // leaning post
  b.on(L * 0.3, 0, D - 0.18, L * 0.12, 0.3, B * 0.42, 0xd8d2bf);                                 // bow cushion
  const engines = L > 8 ? 2 : 1;
  for (let i = 0; i < engines; i++) b.on(-L * 0.5 - 0.3, (i - (engines - 1) / 2) * 0.75, D - 0.2, 0.7, 0.75, 0.5, 0x1c1d20);
  const lights = {
    masthead: [L * 0.02, D + 2.1, 0], masthead2: null,
    port: [L * 0.4, D + 0.2, -B * 0.16], stbd: [L * 0.4, D + 0.2, B * 0.16], stern: [-L * 0.48, D + 0.4, 0],
  };
  return { geometry: b.build(), height: D + 2.2, lights, work: [] };
}

/** Motor yacht or cabin cruiser. Grows a flybridge and then extra decks with length. */
export function motorYacht(L, B, rand) {
  if (L < 9.5) return runabout(L, B, rand);
  const b = new Builder();
  const big = L >= 24;
  const D = clamp(B * 0.3, 0.9, 3.4);
  const outline = hullOutline(L, B, { bow: 0.4, bowA: 1.6, bowB: 0.85, stern: 0.05, transom: 0.94 });
  const hullCol = pick(rand, [WHITE, WHITE, WHITE, 0x1b2a4c, 0x23272b, 0xd9d6cb]);
  const teak = 0xb08d5f;
  b.prism(outline, -0.6, D, hullCol, 0xf0efe9);
  // swim platform and aft cockpit in teak
  b.on(-L * 0.5 - L * 0.025, 0, 0.25, L * 0.06, 0.12, B * 0.82, teak);
  b.on(-L * 0.36, 0, D, L * 0.22, 0.06, B * 0.8, teak);
  // main cabin with a dark windscreen band
  const x0 = -L * 0.26, x1 = L * 0.2;
  const cabin = sliceOutline(outline, x0, x1).map((p) => [p[0], Math.sign(p[1]) * Math.min(Math.abs(p[1]), B / 2 - 0.45)]);
  const ch = big ? 2.6 : 1.9;
  b.prism(cabin, D, D + ch, WHITE, 0xf4f3ee);
  b.on(x1 + 0.02, 0, D + ch * 0.45, 0.08, ch * 0.42, B * 0.55, WINDOW, { glow: 0.5 });
  b.on(x1 - L * 0.035, 0, D + ch, L * 0.06, 0.05, B * 0.5, WINDOW, { glow: 0.4 });               // raked windscreen, seen from above
  for (const s of [-1, 1]) b.on((x0 + x1) / 2, s * (B / 2 - 0.43), D + ch * 0.45, (x1 - x0) * 0.82, ch * 0.38, 0.05, WINDOW, { glow: 0.55 });
  let top = D + ch;
  if (L >= 13) {
    // flybridge with a hardtop or bimini
    const fx0 = x0 + (x1 - x0) * 0.1, fx1 = x1 - (x1 - x0) * 0.25;
    b.on((fx0 + fx1) / 2, 0, top, fx1 - fx0, 0.9, B * 0.62, WHITE, { top: 0xe6e3d8 });
    b.on((fx0 + fx1) / 2 + (fx1 - fx0) * 0.12, 0, top + 2.0, (fx1 - fx0) * 0.6, 0.09, B * 0.58, pick(rand, [WHITE, 0x1f4f8f, 0xcfc7b0, 0x23272b]));
    for (const s of [-1, 1]) b.cyl((fx0 + fx1) / 2, s * B * 0.26, top, top + 2.0, 0.05, STEEL, { seg: 5 });
    top += 0.9;
    if (big) {
      // superyacht: sun deck with a hot tub, radar arch and domes, tender on the aft deck
      b.on(fx0 + (fx1 - fx0) * 0.3, 0, top, (fx1 - fx0) * 0.5, 1.9, B * 0.5, WHITE, { top: 0xf4f3ee });
      b.cyl(fx0 + (fx1 - fx0) * 0.8, 0, top, top + 0.45, Math.min(1.3, B * 0.12), 0xe9e7e0, { top: 0x55c6de, topGlow: 0.8, seg: 10 });
      for (const s of [-1, 1]) b.cyl(fx0 + (fx1 - fx0) * 0.3, s * B * 0.12, top + 1.9, top + 2.8, 0.5, WHITE, { seg: 8 });
      b.on(-L * 0.34, B * 0.12, D + 0.06, Math.min(5.5, L * 0.15), 0.7, 1.9, 0x6b7074, { top: ORANGE });
      top += 1.9;
    }
  }
  b.on(L * 0.3, 0, D, L * 0.1, 0.08, B * 0.3, 0xd8d2bf);                                          // foredeck sun pad
  b.on(L * 0.44, 0, D, 0.7, 0.3, 0.5, STEEL);                                                    // windlass
  const lights = {
    masthead: [(x0 + x1) / 2, top + 1.2, 0], masthead2: null,
    port: [x1, D + ch, -B * 0.3], stbd: [x1, D + ch, B * 0.3], stern: [-L * 0.5, D + 0.5, 0],
  };
  return { geometry: b.build(), height: top + 2.4, lights, work: [[-L * 0.3, D + 1.5, 0, B * 0.5]], festive: big };
}

/** Commercial fishing boat, drawn as a Lowcountry shrimp trawler with its outriggers. */
export function fishingBoat(L, B, rand) {
  if (L < 9) return runabout(L, B, rand);
  const b = new Builder();
  const D = clamp(B * 0.26, 0.9, 2.4);
  const outline = hullOutline(L, B, { bow: 0.34, bowA: 1.8, bowB: 0.75, stern: 0.12, transom: 0.8 });
  const hullCol = pick(rand, [WHITE, WHITE, 0x1f4a3a, 0x1c2f55, 0x8a1f1f, 0x2a2d30]);
  const trim = pick(rand, [0x1f6b3a, 0x8a1f1f, 0x1c2f55, 0x23272b]);
  b.prism(outline, -0.7, D, hullCol, 0x8a8f8a);
  b.prism(outline, D - 0.05, D + 0.35, trim, trim, { noTop: true });                             // bulwark cap
  const hx = L * 0.2, hl = L * 0.22, hw = B * 0.52;
  b.on(hx, 0, D, hl, 2.3, hw, WHITE, { top: OFFWHITE });                                          // wheelhouse forward
  b.on(hx + hl / 2 + 0.02, 0, D + 1.2, 0.06, 0.8, hw * 0.85, WINDOW, { glow: 0.5 });
  for (const s of [-1, 1]) b.on(hx, s * (hw / 2 + 0.02), D + 1.2, hl * 0.7, 0.75, 0.05, WINDOW, { glow: 0.5 });
  // mast with the outriggers swung out, as they are carried when working or drying nets
  const sp = new Builder();
  const mx = hx - hl / 2 - 0.6;
  sp.cyl(mx, 0, D, D + L * 0.42, 0.14, 0x6b6f72, { seg: 6 });
  for (const s of [-1, 1]) {
    sp.on(mx, s * L * 0.19, D + L * 0.2, 0.2, 0.2, L * 0.42, 0x6b6f72, { yaw: 0, pitch: 0 });
    b.on(mx - 0.4, s * L * 0.36, D + L * 0.2 - 0.6, 0.9, 0.9, 0.9, 0x2f6b4a);                     // trawl door or net float
  }
  sp.on(mx - L * 0.05, 0, D + L * 0.3, L * 0.3, 0.16, 0.16, 0x6b6f72, { pitch: 0.35 });           // boom aft
  // work deck: winch, hold hatch, piled net
  b.on(-L * 0.08, 0, D, 1.6, 1.0, B * 0.36, 0x35393c);
  b.on(-L * 0.24, 0, D, L * 0.12, 0.3, B * 0.34, 0x9aa0a4);
  b.on(-L * 0.4, 0, D, L * 0.12, 0.7, B * 0.5, pick(rand, [0x2f6b4a, 0xb9662a, 0x2a5a6b]));
  const lights = {
    masthead: [mx, D + L * 0.42, 0], masthead2: null,
    port: [hx, D + 2.4, -hw / 2], stbd: [hx, D + 2.4, hw / 2], stern: [-L * 0.5 + 0.3, D + 0.8, 0],
  };
  return { geometry: b.build(), spars: sp.build(), height: D + L * 0.45, lights, work: [[-L * 0.25, D + 3, 0, B * 0.8]] };
}

/** Patrol craft: navy grey, police blue, or Coast Guard with an orange collar or stripe. */
export function patrolBoat(L, B, rand, info = {}) {
  const b = new Builder();
  const kind = info.service || 'navy';
  const D = clamp(B * 0.28, 0.6, 3.2);
  const outline = hullOutline(L, B, { bow: 0.42, bowA: 1.6, bowB: 0.85, stern: 0.05, transom: 0.93 });
  const grey = 0x7b848a;
  const hullCol = kind === 'navy' ? grey : kind === 'police' ? 0x16284a : L < 16 ? 0xb9bfc3 : WHITE;
  b.prism(outline, -0.6, D, hullCol, kind === 'navy' ? 0x666d72 : 0x9aa0a4);
  if (kind === 'sar' && L < 16) {
    // response boat: bright orange foam collar all round
    const collar = outline.map((p) => [p[0] * 1.03, p[1] * 1.16]);
    b.prism(collar, D - 0.55, D + 0.2, ORANGE, ORANGE);
    b.prism(outline.map((p) => [p[0] * 0.95, p[1] * 0.8]), D + 0.2, D + 0.26, 0x9aa0a4, 0x9aa0a4);
  } else if (kind === 'sar') {
    b.on(L * 0.27, 0, D, L * 0.035, 0.05, B * 0.9, 0xd3401f, { yaw: 0.5 });                       // racing stripe across the bow
    b.on(L * 0.235, 0, D, L * 0.012, 0.05, B * 0.9, 0x1f3f77, { yaw: 0.5 });
  }
  const hx = L * 0.04, hl = L * 0.3, hw = B * 0.6;
  const houseCol = kind === 'navy' ? 0x8d959b : kind === 'police' ? WHITE : L < 16 ? 0xc3c9cd : WHITE;
  b.on(hx, 0, D, hl, kind === 'navy' && L > 30 ? 3.2 : 2.1, hw, houseCol, { top: kind === 'navy' ? 0x7a8187 : OFFWHITE });
  const hh = kind === 'navy' && L > 30 ? 3.2 : 2.1;
  b.on(hx + hl / 2 + 0.02, 0, D + hh * 0.55, 0.06, hh * 0.3, hw * 0.85, WINDOW, { glow: 0.4 });
  for (const s of [-1, 1]) b.on(hx, s * (hw / 2 + 0.02), D + hh * 0.55, hl * 0.75, hh * 0.28, 0.05, WINDOW, { glow: 0.4 });
  b.on(hx - hl * 0.15, 0, D + hh, 0.3, 2.6, 0.3, kind === 'navy' ? 0x8d959b : OFFWHITE);
  b.on(hx - hl * 0.15, 0, D + hh + 2.0, 0.25, 0.2, hw * 0.7, kind === 'navy' ? 0x8d959b : OFFWHITE);
  if (kind === 'police') b.on(hx + hl * 0.1, 0, D + hh, 0.5, 0.25, hw * 0.5, 0x2a5ea8, { glow: 1 });
  if (kind === 'navy' && L > 20) {
    b.cyl(L * 0.32, 0, D, D + 1.1, Math.min(1.2, B * 0.14), 0x6f777d, { seg: 8 });               // gun mount
    b.on(L * 0.32 + 1.6, 0, D + 0.8, 2.6, 0.16, 0.16, 0x4b5257);
  }
  if (L >= 16) b.on(-L * 0.33, 0, D, Math.min(5, L * 0.16), 0.7, 1.9, 0x3a3d40, { top: ORANGE });  // boat on the aft deck
  const engines = L < 16 ? 2 : 0;
  for (let i = 0; i < engines; i++) b.on(-L * 0.5 - 0.3, (i - 0.5) * 0.9, D - 0.2, 0.7, 0.8, 0.55, 0x1c1d20);
  const lights = {
    masthead: [hx - hl * 0.15, D + hh + 2.7, 0], masthead2: null,
    port: [hx + hl * 0.3, D + hh, -hw / 2], stbd: [hx + hl * 0.3, D + hh, hw / 2], stern: [-L * 0.5 + 0.3, D + 0.6, 0],
  };
  return { geometry: b.build(), height: D + hh + 3, lights, work: [] };
}

/** Plain workboat for vessels whose kind AIS does not narrow down. */
export function workboat(L, B, rand) {
  if (L < 9) return runabout(L, B, rand);
  const b = new Builder();
  const D = clamp(B * 0.25, 0.8, 2.6);
  const outline = hullOutline(L, B, { bow: 0.32, bowA: 1.9, bowB: 0.7, stern: 0.08, transom: 0.9 });
  const hullCol = pick(rand, [0x1b1c1f, 0x1a2d4f, 0x1f4a3a, 0x3a3d40, 0x6e1f1a]);
  b.prism(outline, -0.6, D, hullCol, pick(rand, [0x6b7074, 0x70352c, 0x5a5f63]));
  const rim = outline.map((p) => [p[0] * 1.008, p[1] * 1.03]);
  b.prism(rim, D - 0.4, D + 0.2, 0x0f1011, 0x0f1011, { noTop: true });
  const hx = L * 0.2, hl = L * 0.24, hw = B * 0.56;
  b.on(hx, 0, D, hl, 2.3, hw, WHITE, { top: OFFWHITE });
  b.on(hx + hl / 2 + 0.02, 0, D + 1.2, 0.06, 0.8, hw * 0.85, WINDOW, { glow: 0.5 });
  for (const s of [-1, 1]) b.on(hx, s * (hw / 2 + 0.02), D + 1.2, hl * 0.7, 0.75, 0.05, WINDOW, { glow: 0.5 });
  b.on(hx - hl * 0.2, 0, D + 2.3, 0.25, 2.4, 0.25, OFFWHITE);
  // open working deck aft: small crane, bitts, a stowed load
  b.cyl(-L * 0.12, B * 0.2, D, D + 2.2, 0.3, 0xd8b93a, { seg: 6 });
  b.on(-L * 0.25, B * 0.2, D + 2.1, L * 0.26, 0.25, 0.25, 0xd8b93a, { pitch: -0.12 });
  b.on(-L * 0.3, -B * 0.12, D, L * 0.12, 0.8, B * 0.3, pick(rand, [0x8b9096, 0x2e6b4a, 0x224c7c]));
  b.on(-L * 0.45, 0, D, 0.4, 0.7, B * 0.3, 0x2b2e31);
  const lights = {
    masthead: [hx - hl * 0.2, D + 4.8, 0], masthead2: null,
    port: [hx, D + 2.4, -hw / 2], stbd: [hx, D + 2.4, hw / 2], stern: [-L * 0.5 + 0.3, D + 0.8, 0],
  };
  return { geometry: b.build(), height: D + 5, lights, work: [[-L * 0.25, D + 3, 0, B * 0.7]] };
}

/** Dredge: a square barge with a crane, spuds and a pump house. */
export function dredge(L, B, rand) {
  const b = new Builder();
  const D = clamp(B * 0.14, 1.2, 3);
  const o = [[-L / 2, B / 2], [L / 2 - B * 0.12, B / 2], [L / 2, B / 2 - B * 0.12], [L / 2, -B / 2 + B * 0.12], [L / 2 - B * 0.12, -B / 2], [-L / 2, -B / 2]];
  b.prism(o, -0.8, D, 0x26292c, pick(rand, [0x70352c, 0x5d6468, 0x6b5a45]));
  b.on(-L * 0.18, 0, D, L * 0.24, 4.2, B * 0.5, 0xd9d6cb, { top: 0xbfc4c8 });                    // pump and engine house
  b.on(-L * 0.05, B * 0.2, D + 4.2, L * 0.07, 2.4, B * 0.2, WHITE, { top: OFFWHITE });            // control cab
  b.on(-L * 0.05 + L * 0.036, B * 0.2, D + 5.2, 0.06, 0.9, B * 0.17, WINDOW, { glow: 0.5 });
  // crane with its boom reaching over the bow
  b.cyl(L * 0.16, 0, D, D + 3, Math.min(2.6, B * 0.16), 0xd8b93a, { seg: 10 });
  b.on(L * 0.16, 0, D + 3, Math.min(6, L * 0.12), 2.6, Math.min(4.5, B * 0.3), 0xd8b93a, { top: 0xc4a52f });
  const sp = new Builder();
  sp.on(L * 0.16 + L * 0.2, 0, D + 9, L * 0.44, 0.9, 1.1, 0xd8b93a, { pitch: 0.28 });
  // spuds: the legs that pin the dredge to the bottom. Most of each is under water.
  const spud = clamp(L * 0.12, 8, 15);
  for (const s of [-1, 1]) sp.cyl(-L * 0.46, s * B * 0.38, D - 0.5, D + spud, 0.55, 0x4b5257, { seg: 8 });
  // discharge pipe along one side
  b.on(-L * 0.05, -B * 0.42, D + 0.4, L * 0.8, 0.8, 0.8, 0x55595c);
  for (let i = 0; i < 4; i++) b.on(L * (0.02 + i * 0.09), B * 0.36, D, 2.2, 1.4, 2.2, 0x35393c);
  const lights = {
    masthead: [-L * 0.05, D + 7.2, B * 0.2], masthead2: null,
    port: [L * 0.45, D + 1.5, -B * 0.45], stbd: [L * 0.45, D + 1.5, B * 0.45], stern: [-L * 0.49, D + 1.5, 0],
  };
  return { geometry: b.build(), spars: sp.build(), height: D + Math.max(13, spud + 1), lights, work: [[L * 0.1, D + 8, 0, B * 0.7], [-L * 0.2, D + 6, 0, B * 0.6]] };
}

export const MODELS = {
  container: { build: containerShip, label: 'container ship' },
  tanker: { build: tanker, label: 'tanker' },
  carcarrier: { build: carCarrier, label: 'car carrier' },
  bulk: { build: bulkCarrier, label: 'bulk carrier' },
  cargo: { build: (L, B, r, i) => bulkCarrier(L, B, r, { ...i, general: true }), label: 'general cargo ship' },
  roro: { build: roroShip, label: 'roll-on/roll-off cargo ship' },
  cruise: { build: cruiseShip, label: 'cruise ship' },
  tourboat: { build: tourBoat, label: 'small passenger vessel' },
  tug: { build: tug, label: 'tug' },
  pilot: { build: pilotBoat, label: 'pilot boat' },
  atb: { build: tugBarge, label: 'tug and barge unit' },
  plain: { build: plainShip, label: 'large vessel' },
  sail: { build: sailboat, label: 'sailing yacht' },
  yacht: { build: motorYacht, label: 'motor yacht' },
  runabout: { build: runabout, label: 'small motor boat' },
  fishing: { build: fishingBoat, label: 'fishing boat' },
  navy: { build: (L, B, r, i) => patrolBoat(L, B, r, { ...i, service: 'navy' }), label: 'military vessel' },
  police: { build: (L, B, r, i) => patrolBoat(L, B, r, { ...i, service: 'police' }), label: 'law enforcement boat' },
  rescue: { build: (L, B, r, i) => patrolBoat(L, B, r, { ...i, service: 'sar' }), label: 'rescue boat' },
  workboat: { build: workboat, label: 'workboat' },
  dredge: { build: dredge, label: 'dredge' },
};

// Used only when a vessel reports no usable hull size: a common size for its kind,
// so it can still be drawn. The card says when a size is a stand-in.
export const TYPICAL_SIZE = {
  container: [180, 28], tanker: [120, 19], carcarrier: [190, 32], bulk: [170, 27], cargo: [85, 14], roro: [160, 25],
  cruise: [70, 14], tourboat: [24, 7], tug: [27, 9], pilot: [16, 5], atb: [170, 22], plain: [45, 9],
  sail: [11.5, 3.6], yacht: [12.5, 4], runabout: [7, 2.5], fishing: [20, 6.2], navy: [26, 6], police: [10, 3.2],
  rescue: [13.7, 4.4], workboat: [15, 5], dredge: [60, 16],
};

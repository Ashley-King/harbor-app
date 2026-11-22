// Procedural top-down 3D ship models, built to each vessel's true length and beam.
// Local frame: +Y is the bow, +X is starboard, +Z is up, origin at the hull centre.
// Deck cargo, colours and fittings are illustrative; only size, type, position
// and heading come from AIS.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const matCache = new Map();
function mat(color) {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.05 }); matCache.set(color, m); }
  return m;
}
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function hullShape(L, B, o = {}) {
  const { bow = 0.16, stern = 0.05, sternW = 0.78 } = o;
  const h = L / 2, w = B / 2, bl = L * bow, sl = L * stern;
  const s = new THREE.Shape();
  s.moveTo(-w * sternW, -h);
  s.lineTo(w * sternW, -h);
  s.quadraticCurveTo(w, -h, w, -h + sl);
  s.lineTo(w, h - bl);
  s.bezierCurveTo(w, h - bl * 0.45, w * 0.4, h - bl * 0.08, 0, h);
  s.bezierCurveTo(-w * 0.4, h - bl * 0.08, -w, h - bl * 0.45, -w, h - bl);
  s.lineTo(-w, -h + sl);
  s.quadraticCurveTo(-w, -h, -w * sternW, -h);
  return s;
}
function halfWidth(y, L, B, bow) {
  const h = L / 2, bl = L * bow;
  if (y <= h - bl) return B / 2;
  const t = Math.min(1, (y - (h - bl)) / bl);
  return (B / 2) * Math.pow(Math.max(0, 1 - t * t), 0.62);
}

export class Builder {
  constructor() { this.parts = new Map(); }
  add(g, color, x = 0, y = 0, z = 0, rot = 0) {
    if (rot) g.rotateZ(rot);
    g.translate(x, y, z);
    const gg = g.index ? g.toNonIndexed() : g;
    if (!this.parts.has(color)) this.parts.set(color, []);
    this.parts.get(color).push(gg);
  }
  box(color, w, l, h, x = 0, y = 0, z = 0, rot = 0) {
    const g = new THREE.BoxGeometry(w, l, h);
    g.translate(0, 0, h / 2);
    this.add(g, color, x, y, z, rot);
  }
  cyl(color, r, h, x = 0, y = 0, z = 0, seg = 12) {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, h / 2);
    this.add(g, color, x, y, z);
  }
  hull(color, L, B, h, z, o) {
    const g = new THREE.ExtrudeGeometry(hullShape(L, B, o), { depth: h, bevelEnabled: false, curveSegments: 10 });
    this.add(g, color, 0, o && o.dy ? o.dy : 0, z);
  }
  build() {
    const grp = new THREE.Group();
    for (const [color, list] of this.parts) {
      const m = new THREE.Mesh(mergeGeometries(list), mat(color));
      m.castShadow = true;
      m.receiveShadow = true;
      grp.add(m);
      for (const g of list) g.dispose();
    }
    return grp;
  }
}

const WHITE = 0xecece6, WARM = [1.0, 0.82, 0.55], NAVW = [1.0, 0.97, 0.9], RED = [1.0, 0.1, 0.08], GREEN = [0.1, 1.0, 0.35];

// Navigation lights per COLREGs. mode 'run' shows when under way, 'moor' when
// moored or anchored, 'all' in both cases.
function navLights(L, B, deckZ, topZ, bridgeY, o = {}) {
  const l = [];
  const s = Math.max(5, Math.min(11, L * 0.05));
  l.push({ x: 0, y: o.foreY ?? L * 0.36, z: deckZ + 16, c: NAVW, s, i: 2.6, m: 'run' });
  if (L > 50) l.push({ x: 0, y: bridgeY, z: topZ + 9, c: NAVW, s, i: 2.6, m: 'run' });
  l.push({ x: -B / 2, y: bridgeY + 1, z: topZ, c: RED, s, i: 2.8, m: 'run' });
  l.push({ x: B / 2, y: bridgeY + 1, z: topZ, c: GREEN, s, i: 2.8, m: 'run' });
  l.push({ x: 0, y: -L / 2 + 0.5, z: deckZ + 3, c: NAVW, s: s * 0.9, i: 2.2, m: 'run' });
  l.push({ x: 0, y: L / 2 - Math.min(5, L * 0.08), z: deckZ + 9, c: NAVW, s, i: 2.4, m: 'moor' });
  if (L > 50) l.push({ x: 0, y: -L / 2 + 3, z: deckZ + 6, c: NAVW, s, i: 2.4, m: 'moor' });
  l.push({ x: 0, y: bridgeY, z: topZ, c: WARM, s: Math.max(8, B * 0.7), i: 0.7, m: 'all' });
  if (L > 60) {
    const n = Math.max(2, Math.min(12, Math.round(L / 30)));
    for (let k = 0; k < n; k++) {
      const y = -L * 0.38 + (L * 0.76 * (k + 0.5)) / n;
      l.push({ x: (k % 2 ? 1 : -1) * B * 0.28, y, z: deckZ + 6, c: WARM, s: Math.max(9, B * 0.55), i: 0.75, m: 'moor' });
    }
  }
  return l;
}

function house(b, B, deckZ, y, w, l, h) {
  b.box(WHITE, w, l, h, 0, y, deckZ);
  b.box(0xf6f6f2, Math.min(B + 3, w + 9), Math.min(4.5, l * 0.4), 2.8, 0, y + l / 2 - Math.min(2.3, l * 0.2), deckZ + h);
  b.box(0x3a4048, w * 0.8, 0.5, 1.6, 0, y + l / 2 + 0.05, deckZ + h - 2.4);
  b.cyl(0xd8d8d8, Math.max(0.3, w * 0.02), Math.max(4, h * 0.3), 0, y - l * 0.1, deckZ + h + 2.8, 8);
}

function containerShip(L, B, r) {
  const b = new Builder();
  const fb = Math.min(14, 7 + L * 0.02), h = L / 2, bow = 0.17;
  const hullC = pick(r, [0x1c2b45, 0x23262b, 0x6e1f1c, 0x1d4a3a, 0x2f5f8f, 0x39424d]);
  b.hull(hullC, L, B, fb, 0, { bow, stern: 0.04, sternW: 0.82 });
  b.hull(0x5a2f2a, L - 1.6, B - 1.4, 0.3, fb, { bow, stern: 0.04, sternW: 0.82 });
  const twin = L >= 330;
  const houseL = 13, houseH = 20 + L * 0.035;
  const houseY = twin ? L * 0.17 : -h + L * 0.2;
  const funnelY = twin ? -h + L * 0.21 : houseY - houseL / 2 - 6;
  house(b, B, fb, houseY, B * 0.94, houseL, houseH);
  const fc = pick(r, [0x1c3f73, 0xb3261e, 0xd9a521, 0x1e1e1e, 0xe06a1b, 0x2f6f4f]);
  b.box(fc, 7, 9, houseH * 0.85, 0, funnelY, fb);
  b.box(0x1a1a1a, 5, 6, 1.5, 0, funnelY, fb + houseH * 0.85);
  b.cyl(0xd0d0d0, 0.5, 14, 0, h - L * 0.06, fb, 8);
  const palette = [0x9c2a1e, 0x9c2a1e, 0xc45a1e, 0x1f4e79, 0x1f4e79, 0x2f6f4f, 0xd9d9d6, 0x6e7f8a, 0x6e7f8a, 0xcfa82e, 0x7a3b2e, 0x2b6a8f, 0xd66a9a, 0x8c8f93];
  const stacks = [];
  const pitch = 13.25, cw = 2.44, rowPitch = 2.52, tierH = 2.6;
  for (let y = -h + L * 0.045 + pitch / 2; y < h - L * 0.1; y += pitch) {
    if (Math.abs(y - houseY) < houseL / 2 + pitch / 2 + 1.5) continue;
    if (Math.abs(y - funnelY) < 4.5 + pitch / 2 + 1) continue;
    const hw = halfWidth(y + pitch / 2, L, B, bow) - 1.5;
    const rows = Math.floor((2 * hw) / rowPitch);
    if (rows < 3 || r() < 0.05) continue;
    const base = 2 + Math.floor(r() * 6);
    const lead = pick(r, palette);
    for (let i = 0; i < rows; i++) {
      const x = (i - (rows - 1) / 2) * rowPitch;
      const t = base - (r() < 0.3 ? 1 : 0) - (r() < 0.1 ? 1 : 0);
      if (t <= 0) continue;
      const c = () => (r() < 0.35 ? lead : pick(r, palette));
      if (r() < 0.3) {
        stacks.push([x, y - 3.07, cw, 6.06, t * tierH, c()]);
        stacks.push([x, y + 3.07, cw, 6.06, (r() < 0.2 ? Math.max(1, t - 1) : t) * tierH, c()]);
      } else stacks.push([x, y, cw, 12.19, t * tierH, c()]);
    }
  }
  const grp = b.build();
  if (stacks.length) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0, 0.5);
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 }), stacks.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    stacks.forEach((s, i) => {
      m4.makeScale(s[2], s[3], s[4]);
      m4.setPosition(s[0], s[1], fb + 0.3);
      im.setMatrixAt(i, m4);
      im.setColorAt(i, col.setHex(s[5]));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    grp.add(im);
  }
  return { group: grp, lights: navLights(L, B, fb, fb + houseH, houseY), height: fb + houseH + 12 };
}

function aftHouse(b, L, B, fb, r, tall = 1) {
  const h = L / 2, hl = Math.max(9, L * 0.075), hh = (11 + L * 0.045) * tall;
  const y = -h + L * 0.13;
  house(b, B, fb, y, B * 0.82, hl, hh);
  const fc = pick(r, [0x1c3f73, 0xb3261e, 0xd9a521, 0x1e1e1e, 0x2f6f4f, 0x8a2d2d]);
  b.box(fc, Math.max(3, B * 0.2), Math.max(4, L * 0.03), hh + 3, 0, y - hl / 2 - Math.max(3.5, L * 0.025), fb);
  return { y, top: fb + hh };
}

function tanker(L, B, r) {
  const b = new Builder();
  const fb = Math.min(8, 3.5 + L * 0.016), h = L / 2, bow = 0.13;
  const hullC = pick(r, [0x1b1d21, 0x5c1f1b, 0x1c2b45, 0x2d3338]);
  const deckC = pick(r, [0x7a3328, 0x7a3328, 0x2f5d50, 0x6b6f72]);
  b.hull(hullC, L, B, fb, 0, { bow, stern: 0.05, sternW: 0.8 });
  b.hull(deckC, L - 1.4, B - 1.2, 0.3, fb, { bow, stern: 0.05, sternW: 0.8 });
  const ah = aftHouse(b, L, B, fb, r);
  const y0 = ah.y + L * 0.075, y1 = h - L * 0.14, cy = (y0 + y1) / 2, len = y1 - y0;
  b.box(0x9aa0a4, 2.6, len, 1.6, 0, cy, fb + 0.3); // centreline pipe rack
  b.box(0xc9cdd0, 1.1, len, 0.5, 0, cy, fb + 1.9); // catwalk
  for (const dx of [-1, 1]) {
    b.box(0x7d8387, 0.6, len * 0.96, 0.8, dx * (B * 0.14), cy, fb + 0.3);
    b.box(0x8b6b3d, 0.45, len * 0.9, 0.6, dx * (B * 0.2), cy, fb + 0.3);
  }
  const my = cy + len * 0.04; // cargo manifold, athwartships amidships
  b.box(0xb9bdc0, B * 0.86, 1.2, 1.6, 0, my - 3, fb + 0.3);
  b.box(0xb9bdc0, B * 0.86, 1.2, 1.6, 0, my + 3, fb + 0.3);
  for (let k = -3; k <= 3; k++) b.box(0xd0584a, 0.7, 7.5, 0.9, k * 1.7, my, fb + 0.6);
  for (const dx of [-1, 1]) {
    b.box(0x4a4f54, 3.5, 9, 0.5, dx * (B * 0.43 - 1.5), my, fb + 0.3); // drip trays
    b.cyl(0xd9b23a, 0.9, 9, dx * B * 0.3, my + 8, fb, 10); // hose crane
    b.box(0xd9b23a, 0.9, 13, 0.9, dx * B * 0.3, my + 2, fb + 9);
  }
  const tanks = Math.max(4, Math.round(len / 26));
  for (let k = 0; k < tanks; k++) {
    const y = y0 + (len * (k + 0.5)) / tanks;
    for (const dx of [-1, 1]) {
      b.cyl(0xc7cbce, 1.3, 1.1, dx * B * 0.3, y, fb + 0.3, 10);
      b.box(0x5a2620, 0.25, len / tanks, 0.35, dx * B * 0.3, y, fb + 0.3);
    }
    b.box(0x5a2620, B - 3, 0.3, 0.35, 0, y + len / tanks / 2, fb + 0.3);
  }
  b.box(deckC, B * 0.5, L * 0.07, 2.2, 0, h - L * 0.075, fb); // forecastle
  b.cyl(0xd0d0d0, 0.5, 13, 0, h - L * 0.09, fb + 2, 8);
  return { group: b.build(), lights: navLights(L, B, fb, ah.top, ah.y), height: ah.top + 12 };
}

function carCarrier(L, B, r) {
  const b = new Builder();
  const H = Math.min(36, 20 + L * 0.07), h = L / 2, bow = 0.12;
  const scheme = pick(r, [[0x2b4a6f, 0xdfe2e0], [0xd9dbd6, 0xc9ccc8], [0x2f6b52, 0xdfe2e0], [0x6d7a86, 0xd4d7d4], [0xb5492a, 0xe2e2dc]]);
  b.hull(0x4a1f1c, L, B, 3, 0, { bow, stern: 0.02, sternW: 0.95 });
  b.hull(scheme[0], L, B, H - 3, 3, { bow, stern: 0.02, sternW: 0.95 });
  b.hull(scheme[1], L - 1.2, B - 1.0, 0.4, H, { bow, stern: 0.02, sternW: 0.95 }); // weather deck
  const by = h - L * 0.11;
  b.box(WHITE, B + 2.5, 7, 4.2, 0, by, H + 0.4); // full-width bridge, forward
  b.box(0x3a4048, B * 0.9, 0.5, 1.6, 0, by + 3.6, H + 2.2);
  b.cyl(0xd8d8d8, 0.5, 9, 0, by - 2, H + 4.6, 8);
  b.box(pick(r, [0x1c3f73, 0xd9a521, 0xb3261e, 0x1e1e1e]), 6, 8, 9, B * 0.22, -h + L * 0.14, H + 0.4); // funnel
  const n = Math.round(L / 22);
  for (let k = 0; k < n; k++) {
    const y = -h + L * 0.2 + ((L * 0.6) * k) / n;
    for (const dx of [-1, 1]) b.box(0xb8bcb9, 3, 3, 1.6, dx * B * 0.3, y, H + 0.4); // ventilators
    if (k % 2 === 0) b.box(0xa9adaa, B * 0.5, 0.5, 0.25, 0, y + 5, H + 0.4);
  }
  b.box(0xc9ccc8, 7.5, 3, H * 0.75, B * 0.3, -h + 1.6, 4); // stowed stern quarter ramp
  b.box(0xdadcd8, B * 0.5, L * 0.05, 0.5, 0, -h + L * 0.05, H + 0.4);
  return { group: b.build(), lights: navLights(L, B, H, H + 5, by, { foreY: by + 2 }), height: H + 16 };
}

function bulkCarrier(L, B, r, general = false) {
  const b = new Builder();
  const fb = Math.min(9, 4 + L * 0.02), h = L / 2, bow = 0.13;
  const hullC = pick(r, [0x1b1d21, 0x6a201c, 0x1c2b45, 0x1d4a3a, 0x30353a]);
  const deckC = pick(r, [0x7a3328, 0x6b2b24, 0x3c5a4c]);
  b.hull(hullC, L, B, fb, 0, { bow, stern: 0.05, sternW: 0.8 });
  b.hull(deckC, L - 1.4, B - 1.2, 0.3, fb, { bow, stern: 0.05, sternW: 0.8 });
  const ah = aftHouse(b, L, B, fb, r);
  const y0 = ah.y + L * 0.07, y1 = h - L * 0.13, len = y1 - y0;
  const n = Math.max(general ? 2 : 4, Math.min(9, Math.round(len / (general ? 26 : 30))));
  const pitch = len / n;
  const hatchC = pick(r, [0x9aa39a, 0x8b4a32, 0xb7b9b4, 0x5d6b73]);
  const geared = L < 205;
  for (let k = 0; k < n; k++) {
    const y = y0 + pitch * (k + 0.5);
    const w = Math.min(B * 0.62, 2 * halfWidth(y + pitch * 0.3, L, B, bow) - 4);
    b.box(0x2e3134, w + 1.2, pitch * 0.7 + 1.2, 1.2, 0, y, fb + 0.3); // coaming
    b.box(hatchC, w, pitch * 0.7, 1.0, 0, y, fb + 1.5);
    b.box(0x2e3134, 0.3, pitch * 0.7, 0.2, 0, y, fb + 2.5);
    if (geared && k < n - 1) {
      const cyy = y + pitch / 2;
      b.cyl(0xd9b23a, 1.5, 11, 0, cyy, fb + 0.3, 10);
      b.box(0xd9b23a, 3.2, 3.6, 2.6, 0, cyy, fb + 11.3);
      b.box(0xd9b23a, 1.0, pitch * 0.72, 1.0, 0.8, cyy - pitch * 0.38, fb + 12.4);
    }
  }
  b.box(deckC, B * 0.5, L * 0.07, 2.2, 0, h - L * 0.07, fb);
  b.cyl(0xd0d0d0, 0.5, 13, 0, h - L * 0.085, fb + 2, 8);
  return { group: b.build(), lights: navLights(L, B, fb, ah.top, ah.y), height: ah.top + 12 };
}

function cruiseShip(L, B, r) {
  const b = new Builder();
  const fb = Math.min(13, 6 + L * 0.022), h = L / 2, bow = 0.2;
  b.hull(pick(r, [0xf2f2ee, 0xf2f2ee, 0x1c2b45, 0x20242a]), L, B, fb, 0, { bow, stern: 0.06, sternW: 0.86 });
  const tiers = Math.max(2, Math.min(7, Math.round(L / 45)));
  let z = fb, tl = L * 0.9, tb = B * 0.98, dy = -L * 0.03;
  for (let k = 0; k < tiers; k++) {
    b.hull(k % 2 ? 0xe4e6e3 : 0xf5f5f1, tl, tb, 3.1, z, { bow: 0.14 + k * 0.01, stern: 0.05, sternW: 0.9, dy });
    b.hull(0x38424d, tl - 0.3, tb + 0.05, 0.35, z + 1.6, { bow: 0.14 + k * 0.01, stern: 0.05, sternW: 0.9, dy });
    z += 3.1; tl *= k < tiers - 2 ? 0.985 : 0.93; tb *= 0.985; dy -= L * 0.004;
  }
  b.hull(0xb48f58, tl * 0.97, tb * 0.9, 0.3, z, { bow: 0.16, stern: 0.05, sternW: 0.9, dy }); // teak sun deck
  const pools = L > 180 ? 2 : 1;
  for (let k = 0; k < pools; k++) {
    const y = dy + (pools === 1 ? 0 : (k ? -1 : 1) * L * 0.1);
    b.box(0xe9ecee, B * 0.42, L * 0.07, 0.5, 0, y, z + 0.3);
    b.box(0x27a9cf, B * 0.3, L * 0.05, 0.2, 0, y, z + 0.8);
    for (const dx of [-1, 1]) b.cyl(0x3fc1de, 1.6, 0.2, dx * B * 0.3, y + L * 0.045, z + 0.4, 12);
  }
  b.box(WHITE, tb * 0.7, L * 0.06, 5, 0, dy + tl * 0.36, z + 0.3); // bridge block
  b.box(0x38424d, tb * 0.72, 0.5, 1.6, 0, dy + tl * 0.36 + L * 0.03, z + 2.6);
  const fy = dy - tl * 0.25;
  b.box(pick(r, [0xc8102e, 0x1c3f73, 0xf1c40f, 0x1e1e1e, 0xe9e9e4]), B * 0.3, L * 0.055, 10, 0, fy, z + 0.3); // funnel
  b.cyl(WHITE, 2.2, 3, 0, dy + tl * 0.2, z + 0.3, 14);
  b.cyl(0xd8d8d8, 0.5, 10, 0, dy + tl * 0.3, z + 5, 8);
  const lb = Math.max(2, Math.round(L / 28));
  for (let k = 0; k < lb; k++) {
    const y = -L * 0.3 + (L * 0.55 * k) / Math.max(1, lb - 1);
    for (const dx of [-1, 1]) b.box(0xe8731c, 2.6, 8.5, 2.6, dx * (B / 2 - 0.6), y, fb + 2.5);
  }
  const lights = navLights(L, B, fb, z + 5, dy + tl * 0.36, { foreY: h - L * 0.12 });
  for (let k = 0; k < Math.round(L / 18); k++) {
    lights.push({ x: (k % 2 ? 1 : -1) * B * 0.3, y: -L * 0.4 + k * 18, z, c: WARM, s: B * 0.6, i: 0.9, m: 'all' });
  }
  return { group: b.build(), lights, height: z + 18 };
}

function passengerBoat(L, B, r) {
  const b = new Builder();
  const fb = 1.4 + L * 0.02, h = L / 2;
  b.hull(pick(r, [0xf0f0ec, 0x1c2b45, 0xf0f0ec, 0x7a1f1f]), L, B, fb, 0, { bow: 0.28, stern: 0.04, sternW: 0.9 });
  b.hull(0xcfd2cf, L - 0.6, B - 0.5, 0.15, fb, { bow: 0.28, stern: 0.04, sternW: 0.9 });
  b.box(WHITE, B * 0.8, L * 0.56, 2.6, 0, -L * 0.06, fb);
  b.box(0x38424d, B * 0.82, L * 0.5, 0.9, 0, -L * 0.06, fb + 1.2);
  b.box(pick(r, [0x1c3f73, 0xe9e9e4, 0xa62b2b]), B * 0.72, L * 0.4, 0.3, 0, -L * 0.1, fb + 2.6);
  b.box(WHITE, B * 0.5, L * 0.12, 2.2, 0, L * 0.16, fb + 2.6);
  b.cyl(0xd8d8d8, 0.15, 4, 0, L * 0.12, fb + 4.8, 6);
  return { group: b.build(), lights: navLights(L, B, fb, fb + 4.8, L * 0.16, { foreY: h * 0.5 }), height: fb + 10 };
}

function tug(L, B, r, pilot = false) {
  const b = new Builder();
  const fb = 1.6 + L * 0.03, h = L / 2;
  const hullC = pilot ? 0x1f2a36 : pick(r, [0x1b1d21, 0x7a1f1f, 0x1c3f73, 0x1d4a3a]);
  b.hull(0x15171a, L, B, fb * 0.8, 0, { bow: 0.36, stern: 0.12, sternW: 0.72 }); // fendering
  b.hull(hullC, L - 0.8, B - 0.8, fb * 0.35, fb * 0.8, { bow: 0.36, stern: 0.12, sternW: 0.72 });
  b.hull(pilot ? 0xc9ccc8 : 0x5a2f2a, L - 1.6, B - 1.6, 0.15, fb * 1.15, { bow: 0.36, stern: 0.12, sternW: 0.72 });
  const z = fb * 1.15;
  const hy = pilot ? L * 0.02 : L * 0.1;
  b.box(pilot ? 0xe8731c : WHITE, B * 0.56, L * (pilot ? 0.5 : 0.36), 2.6, 0, hy, z);
  b.box(WHITE, B * 0.44, L * 0.2, 2.4, 0, hy + L * 0.04, z + 2.6);
  b.box(0x38424d, B * 0.46, L * 0.2 + 0.1, 0.9, 0, hy + L * 0.04, z + 3.6);
  if (!pilot) {
    const fc = pick(r, [0xb3261e, 0x1e1e1e, 0xd9a521, 0x1c3f73]);
    for (const dx of [-1, 1]) b.box(fc, B * 0.12, L * 0.07, 5.5, dx * B * 0.18, hy - L * 0.2, z);
    b.cyl(0x2a2d31, B * 0.13, B * 0.3, 0, -L * 0.22, z + 0.2, 10); // towing winch
    b.box(0x2a2d31, B * 0.5, 0.5, 1.2, 0, -L * 0.33, z);
  }
  b.cyl(0xd8d8d8, 0.14, 4.5, 0, hy, z + 5, 6);
  return { group: b.build(), lights: navLights(L, B, z, z + 5, hy + L * 0.04, { foreY: hy + L * 0.04 }), height: z + 12 };
}

function tugAndBarge(L, B, r) {
  // Articulated tug and barge: the AIS length covers the combined unit.
  const b = new Builder();
  const tugL = Math.min(42, L * 0.24), bargeL = L - tugL * 0.75, fb = 4.5, h = L / 2;
  const by = h - bargeL / 2;
  const g = new THREE.ExtrudeGeometry(hullShape(bargeL, B, { bow: 0.1, stern: 0.0, sternW: 1 }), { depth: fb, bevelEnabled: false, curveSegments: 8 });
  b.add(g, pick(r, [0x1b1d21, 0x5c1f1b, 0x2d3338]), 0, by, 0);
  b.box(0x6b6f72, B - 1.4, bargeL * 0.84, 0.3, 0, by - bargeL * 0.03, fb);
  b.box(0x9aa0a4, 2, bargeL * 0.7, 1.4, 0, by, fb + 0.3);
  const n = Math.max(3, Math.round(bargeL / 24));
  for (let k = 0; k < n; k++) for (const dx of [-1, 1]) b.cyl(0xc7cbce, 1.2, 1, dx * B * 0.3, by - bargeL * 0.36 + (bargeL * 0.72 * k) / (n - 1), fb + 0.3, 10);
  b.box(0xb9bdc0, B * 0.8, 1.2, 1.5, 0, by, fb + 0.3);
  const t = tug(tugL, Math.min(B * 0.6, 13), r);
  const grp = b.build();
  t.group.position.set(0, -h + tugL / 2, 0);
  grp.add(t.group);
  const lights = navLights(L, B, fb, 14, -h + tugL * 0.6);
  return { group: grp, lights, height: 26 };
}

export const KIND_LABEL = {
  container: 'container ship', tanker: 'tanker', carcarrier: 'car carrier', bulk: 'bulk carrier',
  general: 'general cargo ship', cruise: 'cruise ship', passenger: 'passenger vessel',
  tug: 'tug', pilot: 'pilot boat', atb: 'tug and barge',
};

export function buildShip(kind, L, B, seed) {
  const r = rng(seed);
  switch (kind) {
    case 'container': return containerShip(L, B, r);
    case 'tanker': return tanker(L, B, r);
    case 'carcarrier': return carCarrier(L, B, r);
    case 'bulk': return bulkCarrier(L, B, r);
    case 'general': return bulkCarrier(L, B, r, true);
    case 'cruise': return cruiseShip(L, B, r);
    case 'passenger': return passengerBoat(L, B, r);
    case 'pilot': return tug(L, B, r, true);
    case 'atb': return tugAndBarge(L, B, r);
    default: return tug(L, B, r);
  }
}

export function disposeShip(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.isInstancedMesh) o.material.dispose();
  });
}

// ---------- wake ----------
const WAKE_VERT = /* glsl */ `
varying vec2 vP;
uniform vec2 uSize;
void main() {
  vP = position.xy * uSize; // metres: x across, y from 0 at the bow to -length astern
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy * uSize, 0.0, 1.0);
}`;
const WAKE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
uniform vec2 uSize;
uniform float uTime, uNight, uBeam, uShipLen, uStrength;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
void main() {
  float db = -vP.y;                 // distance astern of the bow
  float ds = db - uShipLen;         // distance astern of the stern
  float len = uSize.y;
  float ax = abs(vP.x);
  float n = noise(vec2(vP.x * 0.35, vP.y * 0.12 + uTime * 1.6)) * 0.6 + noise(vec2(vP.x * 0.9, vP.y * 0.4 + uTime * 2.4)) * 0.4;
  // Kelvin wake arms spreading at about 19.5 degrees, broken up into feathered crests.
  float armW = 1.2 + db * 0.022;
  float crest = 0.5 + 0.5 * sin(db * 0.16 - ax * 0.10 - uTime * 2.2);
  float arms = exp(-pow((ax - (uBeam * 0.5 + db * 0.33)) / armW, 2.0)) * exp(-db / (len * 0.28)) * step(0.0, db) * (0.35 + 0.65 * crest);
  // Turbulent prop wash trailing the stern.
  float coreW = uBeam * 0.36 + max(ds, 0.0) * 0.035;
  float core = exp(-pow(ax / coreW, 2.0)) * smoothstep(-uShipLen * 0.12, uShipLen * 0.04, ds) * exp(-max(ds, 0.0) / (len * 0.30));
  float bowWave = exp(-pow((ax - uBeam * 0.5) / 1.8, 2.0)) * exp(-db / (uShipLen * 0.45)) * step(0.0, db) * 0.5;
  float a = (arms * 0.34 + core * 0.62 + bowWave) * (0.35 + 0.95 * n) * uStrength;
  a *= smoothstep(len, len * 0.55, db);
  vec3 col = mix(vec3(0.93, 0.97, 0.98), vec3(0.20, 0.26, 0.36), uNight);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
  #include <colorspace_fragment>
}`;
const wakeGeom = new THREE.PlaneGeometry(1, 1);
wakeGeom.translate(0, -0.5, 0);

export function makeWake(shared) {
  const m = new THREE.ShaderMaterial({
    vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG, transparent: true, depthWrite: false,
    uniforms: {
      uSize: { value: new THREE.Vector2(100, 300) }, uTime: shared.uTime, uNight: shared.uNight,
      uBeam: { value: 30 }, uShipLen: { value: 200 }, uStrength: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(wakeGeom, m);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}

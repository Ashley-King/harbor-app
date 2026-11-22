// Procedural top-down 3D ship models. Units are meters.
// Frame: +x = starboard, +y = bow, +z = up. Origin = hull center at the waterline.
import * as THREE from 'three';

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return matCache.get(key);
}
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 14).rotateX(Math.PI / 2); // axis along z

function box(g, color, w, l, h, x, y, z0, rotZ = 0) {
  const m = new THREE.Mesh(unitBox, typeof color === 'string' || typeof color === 'number' ? mat(color) : color);
  m.scale.set(w, l, h);
  m.position.set(x, y, z0 + h / 2);
  m.rotation.z = rotZ;
  g.add(m);
  return m;
}
function cyl(g, color, r, h, x, y, z0) {
  const m = new THREE.Mesh(unitCyl, mat(color));
  m.scale.set(r, r, h);
  m.position.set(x, y, z0 + h / 2);
  g.add(m);
  return m;
}
function pipe(g, color, r, len, x, y, z, alongX = false) {
  const m = new THREE.Mesh(unitCyl, mat(color));
  m.scale.set(r, r, len);
  m.rotation.set(alongX ? 0 : Math.PI / 2, alongX ? Math.PI / 2 : 0, 0);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function hullShape(L, B, bowFrac = 0.17, sternRound = 0.18, inset = 0) {
  const hb = B / 2 - inset, hl = L / 2 - inset;
  const bowLen = Math.min(L * bowFrac, B * 1.7);
  const sr = B * sternRound;
  const s = new THREE.Shape();
  s.moveTo(-hb, -hl + sr);
  s.quadraticCurveTo(-hb, -hl, -hb + sr, -hl);
  s.lineTo(hb - sr, -hl);
  s.quadraticCurveTo(hb, -hl, hb, -hl + sr);
  s.lineTo(hb, hl - bowLen);
  s.bezierCurveTo(hb, hl - bowLen * 0.35, hb * 0.3, hl, 0, hl);
  s.bezierCurveTo(-hb * 0.3, hl, -hb, hl - bowLen * 0.35, -hb, hl - bowLen);
  s.closePath();
  return s;
}

function hull(g, L, B, F, hullColor, deckColor, bowFrac, sternRound) {
  const geo = new THREE.ExtrudeGeometry(hullShape(L, B, bowFrac, sternRound), { depth: F, bevelEnabled: false, curveSegments: 10 });
  g.add(new THREE.Mesh(geo, mat(hullColor)));
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(hullShape(L, B, bowFrac, sternRound, Math.min(0.9, B * 0.03)), 10), mat(deckColor));
  deck.position.z = F + 0.05;
  g.add(deck);
  // bulwark rail line
  const rail = new THREE.Mesh(new THREE.ShapeGeometry(hullShape(L, B, bowFrac, sternRound, 0)), mat(hullColor));
  rail.position.z = F + 0.02;
  g.add(rail);
}

// Accommodation block with stepped decks, bridge wings and a funnel.
function house(g, L, B, F, y, levels, len, white = '#eef1f2', funnelColor = '#2d2d2d', funnelDy = -1) {
  const tier = 2.9;
  for (let i = 0; i < levels; i++) {
    const w = B * (0.82 - i * 0.015), l = len * (1 - i * 0.03);
    box(g, white, w, l, tier, 0, y, F + i * tier);
  }
  const top = F + levels * tier;
  box(g, white, B * 1.0, Math.max(2.5, len * 0.22), 1.2, 0, y + len * 0.36, top - 1.2); // bridge wings
  box(g, '#1d2a33', B * 0.7, Math.max(1.6, len * 0.12), 0.4, 0, y + len * 0.42, top - 2.2); // windows band
  box(g, '#c9ced2', B * 0.5, len * 0.5, 0.9, 0, y, top); // monkey island
  if (funnelDy !== 0) {
    const fy = y + funnelDy * len * 0.62;
    box(g, funnelColor, B * 0.22, len * 0.32, 7, 0, fy, top - 1);
    box(g, '#111', B * 0.18, len * 0.24, 0.6, 0, fy, top + 6);
  }
  return { top, y, len };
}

const BOX_COLORS = ['#1b4f8c', '#2364aa', '#c22d2d', '#8e1c1c', '#e8b22b', '#d9d9d6', '#6c7a85', '#2f7d4a', '#e2702a', '#b9c3c9', '#0d3a63', '#7a4b2a', '#5a2a6e', '#e3e0d3', '#a41f30'];
const CONTAINER_LINES = { MSC: ['#e8b22b', '#d9d9d6', '#6c7a85'], MAERSK: ['#3d8fd1', '#3d8fd1', '#b9c3c9'], 'CMA CGM': ['#1b4f8c', '#c22d2d', '#d9d9d6'], EVER: ['#2f7d4a', '#2f7d4a', '#d9d9d6'], ONE: ['#c9327b', '#c9327b', '#6c7a85'], YM: ['#e3e0d3', '#8e1c1c', '#6c7a85'], HAPAG: ['#e2702a', '#e2702a', '#d9d9d6'], COSCO: ['#1b4f8c', '#d9d9d6', '#2364aa'], ZIM: ['#d9d9d6', '#1b4f8c', '#e8b22b'] };

function containerShip(g, L, B, F, r, name) {
  const hullCol = ['#1a1f2b', '#0f2b4a', '#5a1414', '#11161c', '#203a2a'][Math.floor(r() * 5)];
  hull(g, L, B, F, hullCol, '#5b6168', 0.16, 0.16);
  const forwardBridge = L > 250;
  const houseLen = Math.max(9, L * 0.045);
  const houseY = forwardBridge ? L / 2 - L * 0.36 : -L / 2 + L * 0.15;
  house(g, L, B, F, houseY, Math.round(Math.min(10, 4 + L / 60)), houseLen, '#f2f2ee', '#1c1c1c', forwardBridge ? 0 : -1);
  const engineY = -L / 2 + L * 0.13;
  if (forwardBridge) { box(g, '#2a2a2a', B * 0.24, Math.max(5, L * 0.03), 14, 0, engineY, F); box(g, '#eaeaea', B * 0.5, Math.max(6, L * 0.035), 6, 0, engineY, F); }
  box(g, '#6b7178', B * 0.9, L * 0.05, 2.2, 0, L / 2 - L * 0.07, F); // forecastle
  // container stacks
  const lineKey = Object.keys(CONTAINER_LINES).find((k) => name.toUpperCase().startsWith(k) || name.toUpperCase().includes(k + ' '));
  const linePalette = lineKey ? CONTAINER_LINES[lineKey] : null;
  const rows = Math.max(2, Math.floor((B * 0.92) / 2.56));
  const rowW = 2.44, gapX = 0.12;
  const bayL = 12.2, gapY = 1.1;
  const y0 = -L / 2 + L * 0.06, y1 = L / 2 - L * 0.1;
  const avoid = [[houseY, houseLen / 2 + 3]];
  if (forwardBridge) avoid.push([engineY, Math.max(5, L * 0.03) / 2 + 3]);
  else avoid.push([houseY - houseLen * 0.6, 4]);
  const cells = [];
  const tiersMax = Math.round(Math.min(9, 3 + L / 60));
  for (let y = y0 + bayL / 2; y < y1 - bayL / 2; y += bayL + gapY) {
    if (avoid.some(([c, h]) => Math.abs(y - c) < h + bayL / 2)) continue;
    const taper = Math.min(1, (y1 - y) / (L * 0.12) + 0.45); // bow flare narrows forward bays
    const nr = Math.max(2, Math.floor(rows * Math.min(1, taper)));
    const bayTier = Math.max(1, Math.round(tiersMax * (0.55 + r() * 0.45)));
    for (let i = 0; i < nr; i++) {
      if (r() < 0.06) continue;
      const tiers = Math.max(1, bayTier - (r() < 0.25 ? Math.floor(r() * 3) : 0));
      const x = (i - (nr - 1) / 2) * (rowW + gapX);
      const col = linePalette && r() < 0.6 ? linePalette[Math.floor(r() * linePalette.length)] : BOX_COLORS[Math.floor(r() * BOX_COLORS.length)];
      cells.push({ x, y, h: tiers * 2.59, col });
    }
  }
  if (cells.length) {
    const im = new THREE.InstancedMesh(unitBox, new THREE.MeshLambertMaterial({ color: '#ffffff' }), cells.length);
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    cells.forEach((cell, k) => {
      m4.compose(new THREE.Vector3(cell.x, cell.y, F + 1.5 + cell.h / 2), new THREE.Quaternion(), new THREE.Vector3(rowW, bayL, cell.h));
      im.setMatrixAt(k, m4);
      im.setColorAt(k, c.set(cell.col).offsetHSL(0, 0, (r() - 0.5) * 0.08));
    });
    g.add(im);
  }
  // lashing bridges between bays
  for (let y = y0 + bayL + gapY / 2; y < y1 - bayL; y += bayL + gapY) {
    if (avoid.some(([cc, h]) => Math.abs(y - cc) < h)) continue;
    box(g, '#c8a43a', B * 0.9, 0.5, 3, 0, y, F);
  }
  return { mastY: houseY + houseLen * 0.2, mastZ: F + 4 + Math.min(10, 4 + L / 60) * 2.9 + 4, foreMastY: L / 2 - L * 0.06, sternZ: F + 2 };
}

function tanker(g, L, B, F, r) {
  const hullCol = ['#1a1a1a', '#5c1616', '#13283f'][Math.floor(r() * 3)];
  const deck = ['#7a3226', '#3b5b3a', '#8a3a2a', '#5d6a5a'][Math.floor(r() * 4)];
  hull(g, L, B, F, hullCol, deck, 0.18, 0.2);
  const houseLen = Math.max(8, L * 0.07);
  const hy = -L / 2 + L * 0.1;
  house(g, L, B, F, hy, Math.round(Math.min(8, 4 + L / 70)), houseLen, '#f0f0ec', '#202020', -1);
  // central pipe rack and catwalk
  const ya = hy + houseLen / 2 + 4, yb = L / 2 - L * 0.1, len = yb - ya, yc = (ya + yb) / 2;
  box(g, '#9aa1a6', 1.6, len, 0.25, 0, yc, F + 2.6);
  for (const dx of [-1.6, -0.6, 0.6, 1.6]) pipe(g, dx < 0 ? '#d8d8d2' : '#b7bcc0', 0.32, len, dx, yc, F + 1.2);
  for (let y = ya; y < yb; y += 9) box(g, '#70777c', 3.8, 0.4, 1.4, 0, y, F + 0.1);
  // manifold midships
  for (const dy of [-3, -1, 1, 3]) pipe(g, '#e0d8c4', 0.4, B * 0.78, 0, dy, F + 1.4, true);
  box(g, '#4e555a', B * 0.82, 9, 0.25, 0, 0, F + 0.05);
  box(g, '#f0c02c', 2, 2, 6, -B * 0.32, 8, F); box(g, '#f0c02c', 2, 2, 6, B * 0.32, 8, F); // hose cranes
  // tank domes / hatches
  for (let y = ya + 6; y < yb - 4; y += Math.max(8, L / 18)) {
    for (const dx of [-B * 0.27, B * 0.27]) cyl(g, '#c9c6bb', 0.9, 0.9, dx, y, F);
  }
  box(g, deck, B * 0.85, L * 0.05, 2, 0, L / 2 - L * 0.065, F);
  return { mastY: hy + houseLen * 0.2, mastZ: F + 6 + Math.min(8, 4 + L / 70) * 2.9, foreMastY: L / 2 - L * 0.06, sternZ: F + 2 };
}

function carCarrier(g, L, B, F, r, govGrey) {
  const H = Math.max(F, govGrey ? 18 : Math.min(34, L * 0.17));
  const body = govGrey ? '#7d8489' : ['#f2f2ef', '#1e3d6e', '#8f1c1c', '#eeeeea', '#24292f'][Math.floor(r() * 5)];
  hull(g, L, B, H, body, govGrey ? '#8b9196' : '#d9dcdc', 0.08, 0.06);
  box(g, govGrey ? '#9aa0a4' : '#c9cdcf', B * 0.96, L * 0.86, 0.5, 0, -L * 0.03, H);
  // weather deck fittings
  for (let y = -L * 0.35; y < L * 0.3; y += L / 9) box(g, '#a7adb1', B * 0.75, 1.2, 0.8, 0, y, H + 0.4);
  box(g, '#eef0f0', B * 0.98, Math.max(6, L * 0.04), 4, 0, L / 2 - L * 0.08, H); // bridge
  box(g, '#1d2a33', B * 0.8, 1.2, 0.5, 0, L / 2 - L * 0.06, H + 2.8);
  box(g, '#2a2a2a', B * 0.18, 6, 5, B * 0.3, -L / 2 + L * 0.08, H); box(g, '#2a2a2a', B * 0.18, 6, 5, -B * 0.3, -L / 2 + L * 0.08, H);
  if (govGrey) { box(g, '#eaeaea', B * 0.7, L * 0.08, 8, 0, -L / 2 + L * 0.18, H); box(g, '#5b6166', 3, 18, 1, B * 0.25, 0, H + 0.5, 0.4); }
  box(g, '#5d6266', B * 0.55, 8, 0.6, B * 0.18, -L / 2 - 3, H * 0.2, 0.25); // stern quarter ramp
  return { mastY: L / 2 - L * 0.08, mastZ: H + 8, foreMastY: L / 2 - L * 0.03, sternZ: H };
}

function bulker(g, L, B, F, r, cranes) {
  const hullCol = ['#1b1d22', '#24324a', '#6a1d1d', '#2c3a2a'][Math.floor(r() * 4)];
  const deck = ['#6e2f25', '#43604a', '#5a6168'][Math.floor(r() * 3)];
  hull(g, L, B, F, hullCol, deck, 0.16, 0.18);
  const houseLen = Math.max(8, L * 0.07);
  const hy = -L / 2 + L * 0.1;
  house(g, L, B, F, hy, Math.round(Math.min(7, 3 + L / 70)), houseLen, '#f1f1ec', '#22303a', -1);
  const ya = hy + houseLen / 2 + 5, yb = L / 2 - L * 0.09;
  const n = Math.max(2, Math.round((yb - ya) / 24));
  const step = (yb - ya) / n;
  const hatchCol = ['#2b4c7e', '#7a2d23', '#3c6b44', '#b0862c'][Math.floor(r() * 4)];
  for (let i = 0; i < n; i++) {
    const y = ya + step * (i + 0.5);
    box(g, '#4a4f55', B * 0.72, step * 0.72, 1.4, 0, y, F);
    box(g, hatchCol, B * 0.68, step * 0.68, 0.5, 0, y, F + 1.4);
    box(g, '#2b2f33', 0.3, step * 0.68, 0.2, 0, y, F + 1.9);
    if (cranes && i < n - 1) {
      const cy = y + step / 2;
      cyl(g, '#e8d23a', 1.4, 6, 0, cy, F);
      const boom = box(g, '#e8d23a', 1.1, step * 0.9, 1.1, B * 0.1, cy + step * 0.2, F + 6, (r() - 0.5) * 0.6);
      boom.position.z += 1;
    }
  }
  box(g, deck, B * 0.85, L * 0.05, 2, 0, L / 2 - L * 0.06, F);
  return { mastY: hy + houseLen * 0.2, mastZ: F + 6 + Math.min(7, 3 + L / 70) * 2.9, foreMastY: L / 2 - L * 0.05, sternZ: F + 2 };
}

function cruise(g, L, B, F, r) {
  const H = Math.max(F, Math.min(22, L * 0.07));
  hull(g, L, B, H, '#f6f7f8', '#e9ecef', 0.2, 0.1);
  const decks = 6;
  for (let i = 0; i < decks; i++) {
    const w = B * (0.98 - i * 0.05), l = L * (0.86 - i * 0.07);
    box(g, i % 2 ? '#f4f5f6' : '#e6e9ec', w, l, 3, 0, -L * 0.02 + i * L * 0.01, H + i * 3);
  }
  const top = H + decks * 3;
  box(g, '#6fa3b8', B * 0.62, L * 0.32, 0.2, 0, -L * 0.02, top); // lido deck
  for (const [dx, dy, w, l] of [[0, L * 0.04, B * 0.28, L * 0.07], [0, -L * 0.1, B * 0.22, L * 0.05]]) box(g, '#2ea8d8', w, l, 0.3, dx, dy, top + 0.1);
  box(g, '#c4b08a', B * 0.5, L * 0.08, 0.25, 0, L * 0.16, top);
  box(g, '#dfe3e6', B * 0.3, L * 0.06, 6, 0, -L * 0.26, top); // funnel housing
  box(g, '#1a3c6e', B * 0.22, L * 0.035, 3, 0, -L * 0.27, top + 6);
  for (let y = -L * 0.28; y < L * 0.25; y += 14) { box(g, '#f28b1e', 3.2, 10, 3, -B / 2 + 1.8, y, H + 3); box(g, '#f28b1e', 3.2, 10, 3, B / 2 - 1.8, y, H + 3); }
  box(g, '#16222c', B * 0.9, 1.5, 0.4, 0, L * 0.38, H + decks * 3 - 1.8);
  return { mastY: L * 0.36, mastZ: top + 8, foreMastY: L / 2 - L * 0.05, sternZ: H };
}

function smallPassenger(g, L, B, F) {
  hull(g, L, B, F, '#f4f5f6', '#cfd6db', 0.28, 0.25);
  box(g, '#f8f8f8', B * 0.82, L * 0.6, 2.6, 0, -L * 0.04, F);
  box(g, '#2b4a63', B * 0.84, L * 0.08, 0.5, 0, L * 0.22, F + 1.6);
  box(g, '#e8ecef', B * 0.8, L * 0.5, 2.4, 0, -L * 0.08, F + 2.6);
  box(g, '#4a7da3', B * 0.6, L * 0.3, 0.2, 0, -L * 0.12, F + 5);
  return { mastY: L * 0.12, mastZ: F + 7, foreMastY: L * 0.3, sternZ: F + 1 };
}

function tug(g, L, B, F, r) {
  const col = ['#b3241f', '#1d1f22', '#e7e3dc', '#1f3f73'][Math.floor(r() * 4)];
  const fender = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape(L + 1.2, B + 1.2, 0.3, 0.35), { depth: 1.4, bevelEnabled: false }), mat('#111214'));
  fender.position.z = F - 1.6;
  g.add(fender);
  hull(g, L, B, F, col, '#3a3d40', 0.3, 0.35);
  box(g, col === '#e7e3dc' ? '#b3241f' : '#efefea', B * 0.62, L * 0.28, 3.2, 0, L * 0.06, F);
  box(g, '#efefea', B * 0.5, L * 0.16, 2.4, 0, L * 0.08, F + 3.2);
  box(g, '#16222c', B * 0.52, 0.6, 0.6, 0, L * 0.16, F + 4.6);
  box(g, '#222', 0.9, 1.6, 3, -B * 0.18, -L * 0.04, F + 3); box(g, '#222', 0.9, 1.6, 3, B * 0.18, -L * 0.04, F + 3);
  cyl(g, '#5a5f63', 1.0, 1.4, 0, -L * 0.28, F); // towing winch
  return { mastY: L * 0.08, mastZ: F + 9, foreMastY: L * 0.3, sternZ: F + 1 };
}

function pilot(g, L, B, F) {
  hull(g, L, B, F, '#1c1f24', '#2c3238', 0.32, 0.3);
  box(g, '#ff7a1a', B * 0.7, L * 0.34, 2.4, 0, L * 0.04, F);
  box(g, '#16222c', B * 0.66, 0.5, 0.6, 0, L * 0.2, F + 1.6);
  box(g, '#f3f3f0', B * 0.56, L * 0.2, 0.3, 0, L * 0.02, F + 2.4);
  return { mastY: L * 0.05, mastZ: F + 5, foreMastY: L * 0.25, sternZ: F + 1 };
}

// Visual class from AIS type, name and size. AIS type codes do not separate container,
// bulk and ro-ro ships, so this only chooses which kind of model to draw.
export function modelClass(v) {
  const t = v.type ?? 0;
  const name = (v.name || '').toUpperCase();
  const L = v.length || (v.to_bow ?? 0) + (v.to_stern ?? 0);
  if (v.category === 'tug') return 'tug';
  if (v.category === 'pilot') return 'pilot';
  if (t >= 80 && t <= 89) return 'tanker';
  if (t >= 60 && t <= 69) return L >= 150 ? 'cruise' : 'passenger';
  if (/HIGHWAY|LEADER|\bACE\b| ACE$|HOEGH|GLOVIS|GRANDE |WILHELMSEN|ARC |\bPCTC\b|AUTO|CAR /.test(name)) return 'carcarrier';
  if (/^CAPE [A-Z]/.test(name) && L > 150 && L < 260) return 'rrf';
  if (/^(MSC|MAERSK|CMA CGM|YM |EVER |ONE |HAPAG|COSCO|OOCL|ZIM|HMM|APL|SEASPAN|SEALAND|MOL |CSCL|WAN HAI|KOTA)/.test(name)) return 'container';
  if (/BULK|ORE|CARRIER/.test(name)) return 'bulker';
  if (L >= 220) return 'container';
  if (L >= 120) return 'bulker';
  return 'general';
}

export const CLASS_LABEL = {
  container: 'Container ship', tanker: 'Tanker', carcarrier: 'Car carrier', rrf: 'Ro-ro', bulker: 'Bulk / cargo',
  general: 'General cargo', cruise: 'Cruise ship', passenger: 'Passenger vessel', tug: 'Tug', pilot: 'Pilot boat',
};
export const CLASS_COLOR = {
  container: '#4a8fd8', tanker: '#d9534f', carcarrier: '#e6e6e6', rrf: '#9aa3a9', bulker: '#c58a3a', general: '#b07a4a',
  cruise: '#ffffff', passenger: '#e8f4ff', tug: '#ff7043', pilot: '#ffa726',
};

// Returns { group, lights: [{x,y,z,kind}] , L, B }
export function buildShip(v) {
  const r = rng(v.mmsi);
  const cls = modelClass(v);
  let L = v.length || (v.to_bow ?? 0) + (v.to_stern ?? 0);
  let B = v.beam || (v.to_port ?? 0) + (v.to_starboard ?? 0);
  if (!L || L < 5) L = cls === 'tug' ? 28 : cls === 'pilot' ? 16 : 0;
  if (!B || B < 2) B = L ? Math.max(4, L * (cls === 'tug' ? 0.36 : 0.15)) : 0;
  const g = new THREE.Group();
  if (!L) return { group: g, lights: [], L: 0, B: 0, cls, sizeKnown: false };
  const F = Math.max(1.2, Math.min(15, L * (cls === 'tug' || cls === 'pilot' ? 0.09 : 0.045)));
  let m;
  switch (cls) {
    case 'container': m = containerShip(g, L, B, F, r, v.name || ''); break;
    case 'tanker': m = tanker(g, L, B, F, r); break;
    case 'carcarrier': m = carCarrier(g, L, B, F, r, false); break;
    case 'rrf': m = carCarrier(g, L, B, F, r, true); break;
    case 'bulker': m = bulker(g, L, B, F, r, L < 200); break;
    case 'general': m = bulker(g, L, B, F, r, true); break;
    case 'cruise': m = cruise(g, L, B, F, r); break;
    case 'passenger': m = smallPassenger(g, L, B, F); break;
    case 'tug': m = tug(g, L, B, F, r); break;
    case 'pilot': m = pilot(g, L, B, F); break;
  }
  // Navigation light positions (COLREGs layout).
  const lights = [
    { kind: 'port', x: -B / 2 + 0.3, y: m.mastY, z: m.mastZ - 4 },
    { kind: 'stbd', x: B / 2 - 0.3, y: m.mastY, z: m.mastZ - 4 },
    { kind: 'mast', x: 0, y: L >= 50 ? m.foreMastY : m.mastY, z: L >= 50 ? m.mastZ - 2 : m.mastZ },
    { kind: 'stern', x: 0, y: -L / 2 + 0.5, z: m.sternZ },
    { kind: 'anchorF', x: 0, y: L / 2 - 1, z: m.sternZ + 4 },
    { kind: 'anchorA', x: 0, y: -L / 2 + 1, z: m.sternZ + 2 },
  ];
  if (L >= 50) lights.push({ kind: 'mast2', x: 0, y: m.mastY, z: m.mastZ + 3 });
  if (cls === 'pilot') lights.push({ kind: 'pilotW', x: 0, y: L * 0.05, z: m.mastZ + 1.5 }, { kind: 'pilotR', x: 0, y: L * 0.05, z: m.mastZ });
  if (cls === 'tug') lights.push({ kind: 'towMast', x: 0, y: m.mastY, z: m.mastZ + 2 });
  // deck/working lights along the ship
  const nDeck = Math.max(2, Math.round(L / 35));
  for (let i = 0; i < nDeck; i++) {
    const y = -L / 2 + L * ((i + 0.5) / nDeck);
    lights.push({ kind: 'deck', x: (i % 2 ? 1 : -1) * B * 0.42, y, z: m.sternZ + 1 });
  }
  g.traverse((o) => { o.castShadow = false; o.matrixAutoUpdate = true; });
  return { group: g, lights, L, B, cls, sizeKnown: true };
}

// Ship-to-shore gantry crane. Boom points along +y (toward the water).
export function buildCrane() {
  const g = new THREE.Group();
  const c1 = '#e9edf0', c2 = '#2a5d9a';
  const gauge = 30, legW = 1.6;
  for (const x of [-9, 9]) for (const y of [-gauge / 2, gauge / 2]) box(g, c1, legW, legW, 44, x, y, 0);
  for (const y of [-gauge / 2, gauge / 2]) box(g, c2, 20, 2, 2.5, 0, y, 42);
  box(g, c2, 2.5, gauge + 4, 2.5, -9, 0, 42); box(g, c2, 2.5, gauge + 4, 2.5, 9, 0, 42);
  box(g, c1, 3.2, 70, 3, -2.6, 22, 45); box(g, c1, 3.2, 70, 3, 2.6, 22, 45); // boom
  box(g, c1, 8, 28, 3, 0, -26, 45); // backreach
  box(g, '#2f3438', 7, 9, 4, 0, -36, 45); // machinery house
  box(g, c2, 3, 3, 28, 0, -10, 45); // A-frame apex
  box(g, '#ffd23f', 3, 4, 2, 0, 10, 40); // trolley cab
  return g;
}

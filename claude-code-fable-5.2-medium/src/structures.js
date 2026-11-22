// Fixed harbor structures: the Ravenel and Don Holt bridges, container cranes,
// charted channel lines, and all the fixed lighting used in night mode.
// Geometry comes from OpenStreetMap (see tools/build_geo.py).
import * as THREE from 'three';
import { GEO, pointInPoly, distToPoly } from './geo.js';
import { Builder } from './ships.js';

const WARM = [1.0, 0.8, 0.5], WHITE = [0.95, 0.97, 1.0], RED = [1.0, 0.12, 0.08];
const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function ribbon(pts, width, zFn) {
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const d = len(a, b) || 1;
    const nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d;
    const z = zFn(pts[i]);
    pos.push(pts[i][0] + nx * width / 2, pts[i][1] + ny * width / 2, z, pts[i][0] - nx * width / 2, pts[i][1] - ny * width / 2, z);
    if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k, k - 1, k + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function walk(pts, step, fn) {
  let carry = step / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = len(a, b);
    let s = carry;
    while (s < d) { const t = s / d; fn([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], [(b[0] - a[0]) / d, (b[1] - a[1]) / d]); s += step; }
    carry = s - d;
  }
}

export function buildStructures(scene, lights, shared) {
  const labels = [];
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.95, side: THREE.DoubleSide });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xa9aba6, roughness: 0.9, side: THREE.DoubleSide });
  const nightMats = [];

  // ---------- Arthur Ravenel Jr. Bridge ----------
  const spans = GEO.ravenel.filter((w) => w.length === 2 && len(w[0], w[1]) > 400 && len(w[0], w[1]) < 520);
  let rc = [0, 0], towers = [], axis = [1, 0];
  if (spans.length) {
    const ends = [[0, 0], [0, 0]];
    const ref = spans[0];
    for (const s of spans) {
      const flip = len(s[0], ref[0]) > len(s[1], ref[0]);
      const a = flip ? s[1] : s[0], b = flip ? s[0] : s[1];
      ends[0][0] += a[0] / spans.length; ends[0][1] += a[1] / spans.length;
      ends[1][0] += b[0] / spans.length; ends[1][1] += b[1] / spans.length;
    }
    towers = ends;
    rc = [(ends[0][0] + ends[1][0]) / 2, (ends[0][1] + ends[1][1]) / 2];
    const d = len(ends[0], ends[1]);
    axis = [(ends[1][0] - ends[0][0]) / d, (ends[1][1] - ends[0][1]) / d];
  }
  const zRav = (p) => 5 + 52 * Math.exp(-Math.pow(len(p, rc) / 900, 2));
  for (const w of GEO.ravenel) {
    const m = new THREE.Mesh(ribbon(w, 17.5, zRav), deckMat);
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
    const e = new THREE.Mesh(ribbon(w, 19.5, (p) => zRav(p) - 0.4), edgeMat);
    e.castShadow = true; scene.add(e);
    walk(w, 42, (p) => lights.add(p[0], p[1], zRav(p) + 10, WARM, 15, 1.5, 1.8));
  }
  if (towers.length) {
    const b = new Builder();
    const cablePos = [];
    const v = [-axis[1], axis[0]];
    const ang = Math.atan2(axis[1], axis[0]);
    for (const t of towers) {
      const zd = zRav(t), top = 175;
      for (const side of [-1, 1]) {
        const segs = 7;
        for (let k = 0; k < segs; k++) {
          // Diamond tower: legs spread to deck level, then lean in to the top.
          const z0 = (top * k) / segs, zm = z0 + top / segs / 2;
          const off = zm < zd ? 14 + 12 * (zm / zd) : 26 - 23 * ((zm - zd) / (top - zd));
          b.box(0xd9d6cc, 6, 5, top / segs + 0.5, t[0] + v[0] * off * side, t[1] + v[1] * off * side, z0, ang);
        }
      }
      b.box(0xd9d6cc, 6, 56, 4, t[0], t[1], zd - 5, ang - Math.PI / 2 + Math.PI / 2);
      for (const dir of [-1, 1]) for (let k = 1; k <= 16; k++) {
        const s = k * 14 * dir;
        for (const side of [-1, 1]) {
          const px = t[0] + axis[0] * s + v[0] * 19 * side, py = t[1] + axis[1] * s + v[1] * 19 * side;
          const zt = top - 6 - (16 - k) * 3.2;
          cablePos.push(t[0] + v[0] * 3 * side, t[1] + v[1] * 3 * side, zt, px, py, zRav([px, py]) + 1);
          lights.add((t[0] + px) / 2, (t[1] + py) / 2, 80, WHITE, 7, 0.45, 1.0);
        }
      }
      lights.add(t[0], t[1], top + 2, RED, 9, 2.6, 2.6, 2.0, 0.0);
      for (const side of [-1, 1]) lights.add(t[0] + v[0] * 24 * side, t[1] + v[1] * 24 * side, zd + 4, WHITE, 60, 0.9, 3.0);
      lights.add(t[0], t[1], top - 20, WHITE, 34, 1.2, 2.6);
    }
    const tg = b.build();
    scene.add(tg);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cablePos, 3));
    const cm = new THREE.LineBasicMaterial({ color: 0xe9e9e4, transparent: true, opacity: 0.85 });
    scene.add(new THREE.LineSegments(cg, cm));
    nightMats.push(cm);
    labels.push({ text: 'Ravenel Bridge', pos: [rc[0] - axis[1] * 330, rc[1] + axis[0] * 330], cls: 'major' });
  }

  // ---------- Don N. Holt Bridge (I-526 over the Cooper River) ----------
  if (GEO.donHolt.length) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const w of GEO.donHolt) for (const p of w) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const hc = [(x0 + x1) / 2, (y0 + y1) / 2];
    const zH = (p) => 5 + 42 * Math.exp(-Math.pow(len(p, hc) / 750, 2));
    const truss = [];
    for (const w of GEO.donHolt) {
      const m = new THREE.Mesh(ribbon(w, 15, zH), deckMat);
      m.castShadow = true; m.receiveShadow = true; scene.add(m);
      const e = new THREE.Mesh(ribbon(w, 17, (p) => zH(p) - 0.4), edgeMat);
      e.castShadow = true; scene.add(e);
      walk(w, 45, (p) => lights.add(p[0], p[1], zH(p) + 10, WARM, 15, 1.4, 1.8));
      // Steel through-truss over the main channel span.
      let prev = null;
      walk(w, 16, (p, d) => {
        if (len(p, hc) > 260) { prev = null; return; }
        const n = [-d[1], d[0]], z = zH(p), zt = z + 22;
        const L = [p[0] + n[0] * 8, p[1] + n[1] * 8], Rr = [p[0] - n[0] * 8, p[1] - n[1] * 8];
        truss.push(L[0], L[1], z, L[0], L[1], zt, Rr[0], Rr[1], z, Rr[0], Rr[1], zt, L[0], L[1], zt, Rr[0], Rr[1], zt);
        if (prev) truss.push(prev.L[0], prev.L[1], zt, Rr[0], Rr[1], zt, prev.R[0], prev.R[1], zt, L[0], L[1], zt,
          prev.L[0], prev.L[1], zt, L[0], L[1], zt, prev.R[0], prev.R[1], zt, Rr[0], Rr[1], zt);
        prev = { L, R: Rr };
      });
    }
    const tgm = new THREE.BufferGeometry();
    tgm.setAttribute('position', new THREE.Float32BufferAttribute(truss, 3));
    const tm = new THREE.LineBasicMaterial({ color: 0x8fa39a, transparent: true, opacity: 0.9 });
    scene.add(new THREE.LineSegments(tgm, tm));
    nightMats.push(tm);
    lights.add(hc[0], hc[1], 75, RED, 9, 2.4, 2.6, 2.0, 0.5);
    labels.push({ text: 'Don Holt Bridge', pos: [hc[0], hc[1] + 330], cls: 'major' });
  }

  // ---------- Port terminals: high-mast yard lighting ----------
  const NAMES = { wando: 'Wando Welch Terminal', nct: 'North Charleston Terminal', leatherman: 'Leatherman Terminal', columbus: 'Columbus Street Terminal', unionpier: 'Union Pier', veterans: 'Veterans Terminal' };
  for (const t of GEO.terminals) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of t.poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const step = 125;
    let row = 0;
    for (let y = y0 + step / 2; y < y1; y += step, row++) for (let x = x0 + (row % 2 ? step / 2 : step / 4); x < x1; x += step) {
      if (!pointInPoly(x, y, t.poly)) continue;
      lights.add(x, y, 30, [1.0, 0.9, 0.72], 16, 1.5, 1.5);
      lights.add(x, y, 1, [1.0, 0.78, 0.5], 170, 0.10, 0);
    }
    const major = ['wando', 'nct', 'leatherman', 'columbus'].includes(t.key);
    labels.push({ text: NAMES[t.key] || t.name, pos: t.center, cls: major ? 'major terminal' : 'minor' });
  }

  // ---------- Ship-to-shore container cranes ----------
  const craneB = new Builder();
  for (const c of GEO.cranes) {
    let near = null, nd = Infinity;
    for (const o of GEO.cranes) { const d = len(c, o); if (o !== c && d < nd) { nd = d; near = o; } }
    let term = null, td = Infinity;
    for (const t of GEO.terminals) { const d = pointInPoly(c[0], c[1], t.poly) ? 0 : distToPoly(c[0], c[1], t.poly); if (d < td) { td = d; term = t; } }
    if (!near || nd > 450 || !term || td > 250) { lights.add(c[0], c[1], 40, WHITE, 20, 1.2, 1.8); continue; }
    const q = [(near[0] - c[0]) / nd, (near[1] - c[1]) / nd]; // along the quay
    let n = [-q[1], q[0]]; // toward the water: away from the terminal's centre
    if ((term.center[0] - c[0]) * n[0] + (term.center[1] - c[1]) * n[1] > 0) n = [-n[0], -n[1]];
    const ang = Math.atan2(n[1], n[0]) - Math.PI / 2;
    const P = (lx, ly) => [c[0] + q[0] * lx + n[0] * ly, c[1] + q[1] * lx + n[1] * ly];
    const blue = 0x4f78a8;
    for (const lx of [-12, 12]) {
      for (const ly of [-15, 15]) { const p = P(lx, ly); craneB.box(blue, 2.2, 2.2, 48, p[0], p[1], 0, ang); }
      const p = P(lx, 0); craneB.box(blue, 2, 32, 2.5, p[0], p[1], 46, ang);
    }
    for (const ly of [-15, 15]) { const p = P(0, ly); craneB.box(blue, 26, 2, 2.5, p[0], p[1], 44, ang); }
    for (const lx of [-4, 4]) { const p = P(lx, 25); craneB.box(blue, 1.6, 106, 2.6, p[0], p[1], 49, ang); }
    let p = P(0, -12); craneB.box(0xe6e6e0, 11, 14, 7, p[0], p[1], 51.6, ang);
    p = P(0, 12); craneB.box(blue, 2, 2, 30, p[0], p[1], 51.6, ang);
    p = P(0, 40); craneB.box(0xe6e6e0, 4, 5, 3, p[0], p[1], 45.5, ang);
    p = P(0, 12); lights.add(p[0], p[1], 82, RED, 7, 2.2, 2.2);
    for (const ly of [-10, 72]) { p = P(0, ly); lights.add(p[0], p[1], 50, WHITE, 13, 1.5, 1.5); }
    p = P(0, 76); lights.add(p[0], p[1], 52, RED, 6, 1.8, 1.8);
  }
  const cranes = craneB.build();
  scene.add(cranes);

  // ---------- Lighted buoys and beacons (OpenSeaMap data) ----------
  const COL = { red: [1.0, 0.1, 0.08], green: [0.1, 1.0, 0.35], white: [1.0, 1.0, 0.9], yellow: [1.0, 0.85, 0.2] };
  GEO.seamarks.forEach((s, i) => {
    const c = COL[s.colour];
    if (!c) return;
    const fixed = s.char === 'F';
    const period = fixed ? 0 : s.period || (s.char === 'Q' ? 1 : 4);
    lights.add(s.pos[0], s.pos[1], 5, c, 9, 2.4, 2.4, period, (i * 0.37) % 1);
  });

  // ---------- Charted channel lines ----------
  const chanMat = new THREE.LineDashedMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.4, dashSize: 90, gapSize: 70, depthTest: false });
  let longest = null;
  for (const c of GEO.channel) {
    const g = new THREE.BufferGeometry().setFromPoints(c.line.map((p) => new THREE.Vector3(p[0], p[1], 0.5)));
    const l = new THREE.Line(g, chanMat);
    l.computeLineDistances();
    l.renderOrder = 1;
    scene.add(l);
    const d = len(c.line[0], c.line[c.line.length - 1]);
    if (c.kind === 'recommended_track' && (!longest || d > longest.d)) longest = { d, line: c.line };
  }
  if (longest) {
    const a = longest.line[0], b = longest.line[longest.line.length - 1];
    labels.push({ text: 'Shipping channel', pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], cls: 'major channel' });
  }

  lights.commit();
  return {
    labels,
    setNight(n) {
      for (const m of nightMats) m.opacity = 0.85 - 0.35 * n;
      chanMat.opacity = 0.4 - 0.12 * n;
      deckMat.emissive.setRGB(0.10 * n, 0.075 * n, 0.045 * n);
    },
  };
}

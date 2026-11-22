import * as THREE from 'three';

// Ship frame: +X toward the bow, +Z to starboard, +Y up, origin at the middle of
// the hull on the waterline. All sizes in metres.

const tmpColor = new THREE.Color();

/** Collects coloured boxes, prisms and cylinders into one geometry. */
export class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.glow = [];
    this.idx = [];
    this.n = 0;
  }

  _color(c) {
    if (Array.isArray(c)) return c;
    tmpColor.set(c);
    return [tmpColor.r, tmpColor.g, tmpColor.b];
  }

  _quad(a, b, c, d, normal, color, glow = 0) {
    const col = this._color(color);
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(normal[0], normal[1], normal[2]);
      this.col.push(col[0], col[1], col[2]);
      this.glow.push(glow);
    }
    this.idx.push(this.n, this.n + 1, this.n + 2, this.n, this.n + 2, this.n + 3);
    this.n += 4;
  }

  /**
   * Box by centre and size. Options: yaw (radians about Y), pitch (about Z, raises
   * the +X end), top (colour of the top face), glow (night emission 0..1), noBottom.
   */
  box(cx, cy, cz, sx, sy, sz, color, o = {}) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const cyaw = Math.cos(o.yaw || 0), syaw = Math.sin(o.yaw || 0);
    const cp = Math.cos(o.pitch || 0), sp = Math.sin(o.pitch || 0);
    const tf = (x, y, z) => {
      // pitch about Z, then yaw about Y
      const x1 = x * cp - y * sp;
      const y1 = x * sp + y * cp;
      return [cx + x1 * cyaw + z * syaw, cy + y1, cz - x1 * syaw + z * cyaw];
    };
    const nf = (x, y, z) => {
      const x1 = x * cp - y * sp;
      const y1 = x * sp + y * cp;
      return [x1 * cyaw + z * syaw, y1, -x1 * syaw + z * cyaw];
    };
    const v = [
      tf(-hx, -hy, -hz), tf(hx, -hy, -hz), tf(hx, hy, -hz), tf(-hx, hy, -hz),
      tf(-hx, -hy, hz), tf(hx, -hy, hz), tf(hx, hy, hz), tf(-hx, hy, hz),
    ];
    const g = o.glow || 0;
    const top = o.top ?? color;
    this._quad(v[3], v[7], v[6], v[2], nf(0, 1, 0), top, o.topGlow ?? g);
    this._quad(v[4], v[5], v[6], v[7], nf(0, 0, 1), color, g);
    this._quad(v[1], v[0], v[3], v[2], nf(0, 0, -1), color, g);
    this._quad(v[5], v[1], v[2], v[6], nf(1, 0, 0), color, g);
    this._quad(v[0], v[4], v[7], v[3], nf(-1, 0, 0), color, g);
    if (!o.noBottom) this._quad(v[0], v[1], v[5], v[4], nf(0, -1, 0), color, g);
    return this;
  }

  /** Box sitting on a deck: x, z centre, y0 base, then size. */
  on(x, z, y0, sx, sy, sz, color, o = {}) {
    return this.box(x, y0 + sy / 2, z, sx, sy, sz, color, { noBottom: true, ...o });
  }

  /**
   * Vertical prism from a closed outline [[x, z], ...] listed counter-clockwise when
   * seen from above with +X right and +Z down the page (stern, starboard side, bow, port side).
   */
  prism(outline, y0, y1, side, top = side, o = {}) {
    const n = outline.length;
    const g = o.glow || 0;
    for (let i = 0; i < n; i++) {
      const a = outline[i], b = outline[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      // Outward normal for an outline that runs stern -> starboard -> bow -> port.
      const nx = dz / len, nz = -dx / len;
      this._quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [-nx, 0, -nz], side, g);
    }
    if (!o.noTop) {
      const contour = outline.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const col = this._color(top);
      const base = this.n;
      for (const p of outline) {
        this.pos.push(p[0], y1, p[1]);
        this.nor.push(0, 1, 0);
        this.col.push(col[0], col[1], col[2]);
        this.glow.push(o.topGlow ?? g);
      }
      this.n += n;
      for (const t of tris) {
        // Wind the cap so it faces up.
        const [a, b, c] = t;
        const pa = outline[a], pb = outline[b], pc = outline[c];
        const cross = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
        if (cross > 0) this.idx.push(base + a, base + c, base + b);
        else this.idx.push(base + a, base + b, base + c);
      }
    }
    return this;
  }

  /** Upright cylinder (or cone when r1 differs from r0). */
  cyl(x, z, y0, y1, r0, color, o = {}) {
    const seg = o.seg || 10;
    const r1 = o.r1 ?? r0;
    const g = o.glow || 0;
    const ring = (r, y) => Array.from({ length: seg }, (_, i) => {
      const a = (i / seg) * Math.PI * 2;
      return [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
    });
    const lo = ring(r0, y0), hi = ring(r1, y1);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const a = ((i + 0.5) / seg) * Math.PI * 2;
      this._quad(lo[j], lo[i], hi[i], hi[j], [Math.cos(a), 0, Math.sin(a)], color, g);
    }
    const col = this._color(o.top ?? color);
    const base = this.n;
    this.pos.push(x, y1, z);
    this.nor.push(0, 1, 0);
    this.col.push(col[0], col[1], col[2]);
    this.glow.push(o.topGlow ?? g);
    for (const p of hi) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(0, 1, 0);
      this.col.push(col[0], col[1], col[2]);
      this.glow.push(o.topGlow ?? g);
    }
    this.n += seg + 1;
    for (let i = 0; i < seg; i++) this.idx.push(base, base + 1 + ((i + 1) % seg), base + 1 + i);
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(this.glow), 1));
    g.setIndex(this.n > 65535 ? new THREE.BufferAttribute(new Uint32Array(this.idx), 1) : new THREE.BufferAttribute(new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Deck outline of a hull as [[x, z], ...]: stern, up the starboard side, bow, back
 * down the port side. `bow` and `stern` are the fractions of the length that taper.
 */
export function hullOutline(L, B, { bow = 0.2, bowA = 1.7, bowB = 0.85, stern = 0.08, transom = 0.82, steps = 12, bowTip = 0.02 } = {}) {
  const half = (s) => {
    if (s < stern) return transom + (1 - transom) * Math.sin((Math.PI / 2) * (s / stern)) ** 0.9;
    if (s > 1 - bow) {
      const t = Math.min(1, Math.max(0, (s - (1 - bow)) / bow));
      return Math.max(bowTip, (1 - t ** bowA) ** bowB);
    }
    return 1;
  };
  const stations = [0];
  for (let i = 1; i <= 4; i++) stations.push((stern * i) / 4);
  stations.push(1 - bow);
  for (let i = 1; i <= steps; i++) stations.push(1 - bow + (bow * i) / steps);
  const side = stations.map((s) => [-L / 2 + s * L, (half(s) * B) / 2]);
  const out = side.map((p) => [p[0], p[1]]);
  for (let i = side.length - 1; i >= 0; i--) out.push([side[i][0], -side[i][1]]);
  out.halfAt = (x) => (half(Math.min(1, Math.max(0, (x + L / 2) / L))) * B) / 2;
  return out;
}

/** Shrink an outline toward the centreline (used for stepped decks). */
export function inset(outline, dx, dz) {
  const xs = outline.map((p) => p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const sx = (maxX - minX - 2 * dx) / (maxX - minX);
  const cx = (minX + maxX) / 2;
  return outline.map((p) => [cx + (p[0] - cx) * sx, Math.sign(p[1]) * Math.max(0, Math.abs(p[1]) - dz)]);
}

/** The part of an outline between two x positions, as a closed polygon. */
export function sliceOutline(outline, x0, x1) {
  const half = outline.halfAt;
  const steps = 8;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    pts.push([x, half(x)]);
  }
  const out = pts.map((p) => [p[0], p[1]]);
  for (let i = pts.length - 1; i >= 0; i--) out.push([pts[i][0], -pts[i][1]]);
  return out;
}

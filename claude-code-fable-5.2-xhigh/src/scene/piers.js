// Piers and docks as geometry the fleet can reason about. AIS positions are good to
// a few metres and many small craft report no heading, so a moored boat can end up
// drawn across the dock it is tied to. With the real pier lines (OpenStreetMap) a
// boat can be turned to lie along its dock and slid sideways until it is clear.

const CELL = 120;

export class PierIndex {
  constructor(piers = []) {
    this.segs = [];
    this.grid = new Map();
    this._stamp = 0;
    for (const p of piers) {
      const c = p.p;
      for (let i = 0; i + 3 < c.length; i += 2) this._add(c[i], c[i + 1], c[i + 2], c[i + 3], p.w);
    }
  }

  _add(ax, ay, bx, by, w) {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.4) return;
    const seg = { ax, ay, bx, by, w, len, ux: (bx - ax) / len, uy: (by - ay) / len, mx: (ax + bx) / 2, my: (ay + by) / 2, seen: 0 };
    this.segs.push(seg);
    const pad = w / 2 + 1;
    const x0 = Math.floor((Math.min(ax, bx) - pad) / CELL), x1 = Math.floor((Math.max(ax, bx) + pad) / CELL);
    const y0 = Math.floor((Math.min(ay, by) - pad) / CELL), y1 = Math.floor((Math.max(ay, by) + pad) / CELL);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const key = gx * 100003 + gy;
        let cell = this.grid.get(key);
        if (!cell) this.grid.set(key, (cell = []));
        cell.push(seg);
      }
    }
  }

  /** Every pier segment that could lie within r metres of a point. */
  near(x, y, r) {
    const out = [];
    const stamp = ++this._stamp;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const cell = this.grid.get(gx * 100003 + gy);
        if (!cell) continue;
        for (const s of cell) {
          if (s.seen !== stamp) {
            s.seen = stamp;
            out.push(s);
          }
        }
      }
    }
    return out;
  }

  /** The closest pier to a point: its segment and the distance to its edge (negative when on it). */
  nearest(x, y, r) {
    let best = null;
    for (const s of this.near(x, y, r + 12)) {
      const t = Math.min(s.len, Math.max(0, (x - s.ax) * s.ux + (y - s.ay) * s.uy));
      const d = Math.hypot(x - (s.ax + s.ux * t), y - (s.ay + s.uy * t)) - s.w / 2;
      if (d <= r && (!best || d < best.d)) best = { seg: s, d };
    }
    return best;
  }

  /**
   * How far a hull must move to stop overlapping a pier, as the shortest push
   * (separating-axis test between two rectangles). Null when they do not touch.
   * hull: { x, y, fx, fy (unit vector toward the bow), hl, hb (half length, half beam) }
   */
  static push(hull, seg, gap = 0.5) {
    const sx = hull.fy, sy = -hull.fx;                    // hull's beam direction
    const qx = -seg.uy, qy = seg.ux;                      // pier's width direction
    const dx = hull.x - seg.mx, dy = hull.y - seg.my;
    const pl = seg.len / 2, pw = seg.w / 2 + gap;
    let best = null;
    for (const [ax, ay] of [[hull.fx, hull.fy], [sx, sy], [seg.ux, seg.uy], [qx, qy]]) {
      const rh = hull.hl * Math.abs(hull.fx * ax + hull.fy * ay) + hull.hb * Math.abs(sx * ax + sy * ay);
      const rp = pl * Math.abs(seg.ux * ax + seg.uy * ay) + pw * Math.abs(qx * ax + qy * ay);
      const dist = dx * ax + dy * ay;
      const overlap = rh + rp - Math.abs(dist);
      if (overlap <= 0) return null;
      if (!best || overlap < best.depth) {
        const sign = dist >= 0 ? 1 : -1;
        best = { x: ax * overlap * sign, y: ay * overlap * sign, depth: overlap };
      }
    }
    return best;
  }
}

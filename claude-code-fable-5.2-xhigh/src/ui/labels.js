import { esc } from '../util.js';

/**
 * Map names as HTML over the canvas, so they stay sharp at any size.
 * Fixed names (bridges, terminals, the channel, places) come first, ship names
 * fill the space that is left. A label that would overlap another is dropped.
 */
export class Labels {
  constructor(container, stage, harbor) {
    this.el = container;
    this.stage = stage;
    this.fixed = [];
    this.ships = new Map();
    const add = (text, at, kind, tier = 0, priority = 5, sub = null, anchor = 'c') => {
      const node = document.createElement('div');
      node.className = `lbl k-${kind}`;
      node.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
      node.style.display = 'none';
      this.el.appendChild(node);
      this.fixed.push({ node, at, kind, tier, priority, anchor, w: 0, h: 0, shown: false });
    };
    for (const b of harbor.bridges) add(b.label, b.span, 'bridge', 0, 10, null, 'above');
    for (const t of harbor.terminals) add(t.label, t.at, 'terminal', t.container ? 0 : 1, t.container ? 9 : 4);
    // The channel is named in a few places along its length, as on a chart.
    const named = ['Fort Sumter Range', 'Rebellion Reach', 'Daniel Island Reach'];
    for (const r of harbor.channel) {
      if (named.includes(r.name)) add('Shipping channel', r.at, 'channel', 0, 8, r.depthFt ? `${r.depthFt} ft deep` : null);
    }
    for (const r of harbor.channel) {
      if (/Terminal$/.test(r.name)) continue;
      add(r.name, [r.at[0], r.at[1] - (named.includes(r.name) ? 260 : 0)], 'reach', 2, 2);
    }
    for (const l of harbor.labels) add(l.text, l.at, l.kind, l.tier, l.kind === 'water' ? 6 : l.kind === 'place' ? 5 : 3);
    this.fixed.sort((a, b) => b.priority - a.priority);
    this._measured = false;
    // Switched from the layers panel.
    this.showShips = true;
    this.showChannel = true;
  }

  _measure() {
    for (const f of this.fixed) {
      f.node.style.display = 'block';
      f.w = f.node.offsetWidth;
      f.h = f.node.offsetHeight;
      f.node.style.display = 'none';
      f.shown = false;
    }
    this._measured = true;
  }

  remeasure() {
    this._measured = false;
    for (const s of this.ships.values()) s.w = 0;
  }

  update(fleet, selected) {
    if (!this._measured) this._measure();
    const stage = this.stage;
    const mpp = stage.mpp;
    const W = stage.width, H = stage.height;
    const tier = mpp < 6.5 ? 2 : mpp < 15 ? 1 : 0;
    const boxes = [];
    const free = (x, y, w, h) => {
      for (const b of boxes) {
        if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false;
      }
      return true;
    };

    // ---- fixed names
    for (const f of this.fixed) {
      let show = f.tier <= tier && (this.showChannel || (f.kind !== 'channel' && f.kind !== 'reach'));
      let x = 0, y = 0;
      if (show) {
        const p = stage.worldToScreen(f.at[0], f.at[1], 0);
        x = p.x - f.w / 2;
        y = f.anchor === 'above' ? p.y - f.h - 16 : p.y - f.h / 2;
        show = x + f.w > 0 && x < W && y + f.h > 0 && y < H && free(x, y, f.w, f.h);
        // Required names (bridges, container terminals, the channel) hold their place when on screen.
        if (!show && f.priority >= 9 && x + f.w > 0 && x < W && y + f.h > 0 && y < H) show = true;
      }
      if (show) {
        boxes.push([x - 3, y - 2, f.w + 6, f.h + 4]);
        f.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        if (!f.shown) f.node.style.display = 'block';
      } else if (f.shown) f.node.style.display = 'none';
      f.shown = show;
    }

    // ---- ship names take the free spots next to their hulls
    const want = [];
    for (const e of fleet.entities.values()) {
      if (e.gone || !e.centre || e.hidden) continue;
      const isSel = e.mmsi === selected;
      const len = e.size ? e.size.L : 0;
      let ok = isSel;
      if (e.group === 'ship') ok = ok || len >= 150 || mpp < 11;
      else if (e.group === 'tug' || e.group === 'pilot') ok = ok || mpp < 3.2;
      else ok = ok || mpp < 1.4;
      if (!ok || !e.v.name || (!this.showShips && !isSel)) continue;
      want.push({ e, isSel, score: (isSel ? 1e6 : 0) + (e.group === 'ship' ? 1000 : 0) + len });
    }
    want.sort((a, b) => b.score - a.score);
    const live = new Set();
    for (const { e, isSel } of want) {
      const len = e.size ? e.size.L : 20;
      const sx = e.screen.x, sy = e.screen.y;
      if (sx < -40 || sy < -20 || sx > W + 40 || sy > H + 20) continue;
      let s = this.ships.get(e.mmsi);
      if (!s) {
        const node = document.createElement('div');
        node.className = 'lbl k-ship';
        this.el.appendChild(node);
        s = { node, text: null, w: 0, h: 0 };
        this.ships.set(e.mmsi, s);
      }
      if (s.text !== e.v.name) {
        s.text = e.v.name;
        s.node.textContent = e.v.name;
        s.w = 0;
      }
      const cls = `lbl k-ship${e.group !== 'ship' || len < 150 ? ' is-small' : ''}${isSel ? ' is-selected' : ''}`;
      if (s.node.className !== cls) {
        s.node.className = cls;
        s.w = 0;
      }
      if (!s.w) {
        s.node.style.display = 'block';
        s.w = s.node.offsetWidth;
        s.h = s.node.offsetHeight;
      }
      // Half the hull's footprint on screen decides how far out the name sits.
      const h = (e.heading * Math.PI) / 180;
      const half = len / 2 / mpp;
      const rx = Math.abs(Math.sin(h)) * half + 8, ry = Math.abs(Math.cos(h)) * half + 6;
      const spots = [[sx + rx, sy - s.h / 2], [sx - rx - s.w, sy - s.h / 2], [sx - s.w / 2, sy - ry - s.h], [sx - s.w / 2, sy + ry]];
      let placed = null;
      for (const [x, y] of spots) {
        if (free(x, y, s.w, s.h)) {
          placed = [x, y];
          break;
        }
      }
      if (!placed && isSel) placed = spots[0];
      if (!placed) continue;
      boxes.push([placed[0] - 2, placed[1] - 1, s.w + 4, s.h + 2]);
      s.node.style.display = 'block';
      s.node.style.transform = `translate(${placed[0].toFixed(1)}px, ${placed[1].toFixed(1)}px)`;
      live.add(e.mmsi);
    }
    for (const [mmsi, s] of this.ships) {
      if (live.has(mmsi)) continue;
      if (!fleet.entities.has(mmsi)) {
        s.node.remove();
        this.ships.delete(mmsi);
      } else if (s.node.style.display !== 'none') s.node.style.display = 'none';
    }

  }
}

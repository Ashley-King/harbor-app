import * as THREE from 'three';
import { clamp } from '../util.js';

const FOV = 26;
const TAN = Math.tan((FOV / 2) * (Math.PI / 180));

// The harbor from the jetty tips to the North Charleston Terminal (world metres).
export const HARBOR = { west: -7300, east: 9500, south: -12700, north: 10300 };

/**
 * Renderer, straight-down camera and pan/zoom controls.
 * The camera always looks vertically down with north at the top, like a chart.
 * A narrow perspective lens keeps a little aerial-photo parallax on tall things.
 */
export class Stage {
  constructor(canvas, bounds) {
    this.canvas = canvas;
    this.bounds = bounds;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x04090f, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 10, 100000);
    this.camera.up.set(0, 0, -1);

    this.center = { x: 0, y: 0 };
    this.viewHeight = 24000;
    this.target = { x: 0, y: 0, h: 24000 };
    this.velocity = { x: 0, y: 0 };
    this.fly = null;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.gestureEndedAt = 0;        // when the last drag or pinch ended, so a pin can ignore the click after it
    this.minHeight = 240;
    this.maxHeight = 30000;
    this.userMoved = false;
    this.onPick = null;
    this.onHover = null;
    this._pointers = new Map();
    this._drag = null;
    this._bind();
    this.resize();
  }

  // ------------------------------------------------------------ geometry

  /** Metres per CSS pixel. */
  get mpp() {
    return this.viewHeight / this.height;
  }

  viewRect(margin = 0) {
    const hw = (this.viewHeight * this.width) / this.height / 2 + margin;
    const hh = this.viewHeight / 2 + margin;
    return { west: this.center.x - hw, east: this.center.x + hw, south: this.center.y - hh, north: this.center.y + hh };
  }

  /** World (x east, y north, h up) to CSS pixels. Includes lens parallax for height. */
  worldToScreen(x, y, h = 0) {
    const camH = this.viewHeight / 2 / TAN;
    const s = camH / (camH - h) / this.mpp;
    return { x: this.width / 2 + (x - this.center.x) * s, y: this.height / 2 - (y - this.center.y) * s };
  }

  screenToWorld(px, py) {
    return { x: this.center.x + (px - this.width / 2) * this.mpp, y: this.center.y - (py - this.height / 2) * this.mpp };
  }

  fitHeight(rect, pad = 1.04) {
    const aspect = this.width / this.height;
    return Math.max((rect.north - rect.south) * pad, ((rect.east - rect.west) * pad) / aspect);
  }

  /** The tallest view that the imagery still fills from edge to edge, so no empty margin shows. */
  coverHeight() {
    const b = this.bounds;
    const m = 280 * 2; // the imagery fades out over its last 260 m on each side
    return Math.min(b.north - b.south - m, ((b.east - b.west - m) * this.height) / this.width);
  }

  /** Frame the whole harbor, or as much of it as fits without showing past the imagery. */
  home(animate = true) {
    this.maxHeight = Math.max(this.coverHeight(), 3000);
    const h = Math.min(this.fitHeight(HARBOR), this.maxHeight);
    let cx = (HARBOR.west + HARBOR.east) / 2;
    let cy = (HARBOR.south + HARBOR.north) / 2;
    [cx, cy] = this.inside(cx, cy, h);
    if (animate) this.flyTo(cx, cy, h, 1.6);
    else {
      this.center.x = this.target.x = cx;
      this.center.y = this.target.y = cy;
      this.viewHeight = this.target.h = h;
    }
    this.userMoved = false;
  }

  flyTo(x, y, h, seconds = 1.8) {
    this.fly = {
      from: { x: this.center.x, y: this.center.y, h: this.viewHeight },
      to: (() => {
        const hh = clamp(h, this.minHeight, this.maxHeight);
        const [tx, ty] = this.inside(x, y, hh);
        return { x: tx, y: ty, h: hh };
      })(),
      t: 0,
      dur: seconds,
    };
    this.velocity.x = this.velocity.y = 0;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    // Cap the backing store so a 4K or 5K wall screen stays smooth.
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8.4e6 / (w * h)));
    if (w === this.width && h === this.height && dpr === this.dpr) return false;
    const first = this.width === 1;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (first || !this.userMoved) this.home(false);
    else {
      this.maxHeight = Math.max(this.coverHeight(), 3000);
      this._clampTarget();
    }
    return true;
  }

  // ------------------------------------------------------------ per frame

  update(dt) {
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      // Zoom in log space so the motion feels even from harbor scale to ship scale.
      const h = Math.exp(Math.log(f.from.h) + (Math.log(f.to.h) - Math.log(f.from.h)) * e);
      this.center.x = f.from.x + (f.to.x - f.from.x) * e;
      this.center.y = f.from.y + (f.to.y - f.from.y) * e;
      this.viewHeight = h;
      this.target.x = this.center.x;
      this.target.y = this.center.y;
      this.target.h = h;
      if (f.t >= 1) this.fly = null;
    } else {
      if (!this._drag && (Math.abs(this.velocity.x) > 0.01 || Math.abs(this.velocity.y) > 0.01)) {
        this.target.x += this.velocity.x * dt;
        this.target.y += this.velocity.y * dt;
        const decay = Math.exp(-dt * 4.5);
        this.velocity.x *= decay;
        this.velocity.y *= decay;
      }
      this._clampTarget();
      const k = 1 - Math.exp(-dt * 14);
      this.center.x += (this.target.x - this.center.x) * k;
      this.center.y += (this.target.y - this.center.y) * k;
      this.viewHeight = Math.exp(Math.log(this.viewHeight) + (Math.log(this.target.h) - Math.log(this.viewHeight)) * k);
    }
    const camH = this.viewHeight / 2 / TAN;
    this.camera.position.set(this.center.x, camH, -this.center.y);
    this.camera.lookAt(this.center.x, 0, -this.center.y);
    this.camera.near = Math.max(5, camH - 260);
    this.camera.far = camH + 60;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.cameraHeight = camH;
  }

  /** Keep a view of height h inside the imagery where it fits, centred on it where it does not. */
  inside(x, y, h) {
    const b = this.bounds;
    const hw = (h * this.width) / this.height / 2;
    const hh = h / 2;
    const m = 280; // the imagery fades out over its last 260 m
    const fit = (v, lo, hi, half) => (hi - lo <= half * 2 ? (lo + hi) / 2 : clamp(v, lo + half, hi - half));
    return [fit(x, b.west + m, b.east - m, hw), fit(y, b.south + m, b.north - m, hh)];
  }

  _clampTarget() {
    this.target.h = clamp(this.target.h, this.minHeight, this.maxHeight);
    [this.target.x, this.target.y] = this.inside(this.target.x, this.target.y, this.target.h);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ input

  _zoomAt(px, py, factor) {
    this.fly = null;
    const before = { x: this.target.x + (px - this.width / 2) * (this.target.h / this.height), y: this.target.y - (py - this.height / 2) * (this.target.h / this.height) };
    const h = clamp(this.target.h * factor, this.minHeight, this.maxHeight);
    this.target.h = h;
    this.target.x = before.x - (px - this.width / 2) * (h / this.height);
    this.target.y = before.y + (py - this.height / 2) * (h / this.height);
    this.userMoved = true;
  }

  _bind() {
    const c = this.canvas;
    const local = (e) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    // A finger wobbles more than a mouse, so a tap is allowed more travel.
    const slop = (e) => (e.pointerType === 'mouse' ? 4 : 10);
    // `overlay` is true for a touch that lands on a pin laid over the map. It still
    // pans and pinches the map, and only a clean tap is left to the pin.
    const down = (e, overlay) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (!overlay) c.setPointerCapture(e.pointerId);
      const p = local(e);
      this._pointers.set(e.pointerId, p);
      this.fly = null;
      this.velocity.x = this.velocity.y = 0;
      if (this._pointers.size === 1) this._drag = { start: p, last: p, moved: 0, time: performance.now(), overlay };
      else {
        this._pinch = null;
        // The second finger makes it a pinch, wherever the first one landed.
        for (const id of this._pointers.keys()) if (!c.hasPointerCapture(id)) try { c.setPointerCapture(id); } catch { /* the pointer is already gone */ }
      }
    };
    const move = (e) => {
      const p = local(e);
      if (!this._pointers.has(e.pointerId)) {
        if (e.target === c) this.onHover?.(p.x, p.y);
        return;
      }
      const prev = this._pointers.get(e.pointerId);
      if (prev.x === p.x && prev.y === p.y) return;
      this._pointers.set(e.pointerId, p);
      if (this._pointers.size === 1 && this._drag) {
        const d = this._drag;
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        const was = d.moved;
        d.moved += Math.abs(dx) + Math.abs(dy);
        // Nothing moves until the finger has clearly left the spot, so a tap stays a tap.
        if (d.moved <= slop(e)) return;
        if (was <= slop(e) && !c.hasPointerCapture(e.pointerId)) try { c.setPointerCapture(e.pointerId); } catch { /* gone */ }
        const m = this.target.h / this.height;
        this.target.x -= dx * m;
        this.target.y += dy * m;
        this.center.x = this.target.x;
        this.center.y = this.target.y;
        const now = performance.now();
        const dt = Math.max(1, now - d.time) / 1000;
        this.velocity.x = this.velocity.x * 0.5 + ((-dx * m) / dt) * 0.5;
        this.velocity.y = this.velocity.y * 0.5 + ((dy * m) / dt) * 0.5;
        d.time = now;
        this.userMoved = true;
      } else if (this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this._pinch) {
          this._zoomAt(mid.x, mid.y, this._pinch.dist / Math.max(1, dist));
          const m = this.target.h / this.height;
          this.target.x -= (mid.x - this._pinch.mid.x) * m;
          this.target.y += (mid.y - this._pinch.mid.y) * m;
          // The map stays under the fingers: no easing while they are down.
          this._clampTarget();
          this.center.x = this.target.x;
          this.center.y = this.target.y;
          this.viewHeight = this.target.h;
        }
        this._pinch = { dist, mid };
        if (this._drag) this._drag.moved = 99;
      }
    };
    const end = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      const p = local(e);
      this._pointers.delete(e.pointerId);
      if (this._pinch) {
        // Lifting one finger of a pinch must not fling the map.
        this.velocity.x = this.velocity.y = 0;
        if (this._drag) this._drag.time = 0;
      }
      this._pinch = null;
      if (this._drag && this._pointers.size === 0) {
        const d = this._drag;
        this._drag = null;
        if (performance.now() - d.time > 120) this.velocity.x = this.velocity.y = 0;
        if (d.moved > slop(e)) this.gestureEndedAt = performance.now();
        else if (e.type === 'pointerup') {
          this.velocity.x = this.velocity.y = 0;
          if (!d.overlay) this.onPick?.(p.x, p.y);
        }
      }
    };
    c.addEventListener('pointerdown', (e) => down(e, false));
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    // A touch keeps sending its events to the pin it landed on, so they are heard there too.
    this.adopt = (el) => {
      el.addEventListener('pointerdown', (e) => down(e, true));
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    };
    c.addEventListener('pointerleave', () => this.onHover?.(-1, -1));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      this._zoomAt(p.x, p.y, Math.exp(clamp(delta, -240, 240) * (e.ctrlKey ? 0.01 : 0.0022)));
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      const p = local(e);
      this._zoomAt(p.x, p.y, 0.5);
    });
    c.addEventListener('keydown', (e) => {
      const step = this.target.h * 0.18;
      if (e.key === 'ArrowLeft') this.target.x -= step;
      else if (e.key === 'ArrowRight') this.target.x += step;
      else if (e.key === 'ArrowUp') this.target.y += step;
      else if (e.key === 'ArrowDown') this.target.y -= step;
      else if (e.key === '+' || e.key === '=') this._zoomAt(this.width / 2, this.height / 2, 0.7);
      else if (e.key === '-' || e.key === '_') this._zoomAt(this.width / 2, this.height / 2, 1 / 0.7);
      else if (e.key === '0' || e.key === 'Home') this.home();
      else return;
      this.userMoved = e.key !== '0' && e.key !== 'Home';
      this.fly = e.key === '0' || e.key === 'Home' ? this.fly : null;
      e.preventDefault();
    });
  }
}

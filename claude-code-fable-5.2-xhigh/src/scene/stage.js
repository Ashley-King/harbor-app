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

  /** Frame the whole harbor. */
  home(animate = true) {
    const h = this.fitHeight(HARBOR);
    let cx = (HARBOR.west + HARBOR.east) / 2;
    let cy = (HARBOR.south + HARBOR.north) / 2;
    this.maxHeight = Math.max(h * 1.2, 9000);
    [cx, cy] = this._inside(cx, cy, h);
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
        const [tx, ty] = this._inside(x, y, hh);
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
    else this.maxHeight = Math.max(this.fitHeight(HARBOR) * 1.2, 9000);
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
  _inside(x, y, h) {
    const b = this.bounds;
    const hw = (h * this.width) / this.height / 2;
    const hh = h / 2;
    const fit = (v, lo, hi, half) => (hi - lo <= half * 2 ? (lo + hi) / 2 : clamp(v, lo + half, hi - half));
    return [fit(x, b.west, b.east, hw), fit(y, b.south, b.north, hh)];
  }

  _clampTarget() {
    this.target.h = clamp(this.target.h, this.minHeight, this.maxHeight);
    [this.target.x, this.target.y] = this._inside(this.target.x, this.target.y, this.target.h);
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
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      this._pointers.set(e.pointerId, p);
      this.fly = null;
      this.velocity.x = this.velocity.y = 0;
      if (this._pointers.size === 1) this._drag = { start: p, last: p, moved: 0, time: performance.now() };
      else this._pinch = null;
    });
    c.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (!this._pointers.has(e.pointerId)) {
        this.onHover?.(p.x, p.y);
        return;
      }
      const prev = this._pointers.get(e.pointerId);
      this._pointers.set(e.pointerId, p);
      if (this._pointers.size === 1 && this._drag) {
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        this._drag.moved += Math.abs(dx) + Math.abs(dy);
        const m = this.target.h / this.height;
        this.target.x -= dx * m;
        this.target.y += dy * m;
        this.center.x = this.target.x;
        this.center.y = this.target.y;
        const now = performance.now();
        const dt = Math.max(1, now - this._drag.time) / 1000;
        this.velocity.x = this.velocity.x * 0.5 + ((-dx * m) / dt) * 0.5;
        this.velocity.y = this.velocity.y * 0.5 + ((dy * m) / dt) * 0.5;
        this._drag.time = now;
        if (this._drag.moved > 4) this.userMoved = true;
      } else if (this._pointers.size === 2) {
        const [a, b] = [...this._pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this._pinch) {
          this._zoomAt(mid.x, mid.y, this._pinch.dist / Math.max(1, dist));
          const m = this.target.h / this.height;
          this.target.x -= (mid.x - this._pinch.mid.x) * m;
          this.target.y += (mid.y - this._pinch.mid.y) * m;
        }
        this._pinch = { dist, mid };
        if (this._drag) this._drag.moved = 99;
      }
    });
    const end = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      const p = local(e);
      this._pointers.delete(e.pointerId);
      this._pinch = null;
      if (this._drag && this._pointers.size === 0) {
        const d = this._drag;
        this._drag = null;
        if (performance.now() - d.time > 120) this.velocity.x = this.velocity.y = 0;
        if (d.moved <= 4 && e.type === 'pointerup') {
          this.velocity.x = this.velocity.y = 0;
          this.onPick?.(p.x, p.y);
        }
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
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

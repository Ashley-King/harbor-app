// MapLibre custom layer that renders ships, cranes, bridge structures and night lights with three.js.
// Local frame: meters, x = east, y = north, z = up, origin at ORIGIN.
import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import { buildShip, buildCrane, rng } from './models.js';

export const ORIGIN = [-79.92, 32.81];
const DEG = Math.PI / 180;

const LIGHT_COLORS = {
  port: [1.0, 0.12, 0.08], stbd: [0.1, 1.0, 0.3], mast: [1, 1, 0.94], mast2: [1, 1, 0.94], stern: [1, 0.98, 0.9],
  anchorF: [1, 0.98, 0.9], anchorA: [1, 0.98, 0.9], deck: [1.0, 0.78, 0.45], pilotW: [1, 1, 1], pilotR: [1, 0.1, 0.1],
  towMast: [1, 1, 0.94], aviation: [1, 0.08, 0.05], flood: [1.0, 0.82, 0.55], bridge: [1.0, 0.86, 0.6],
  cable: [0.85, 0.92, 1.0], hiMast: [1.0, 0.8, 0.5],
};
const LIGHT_SIZE = { port: 9, stbd: 9, mast: 8, mast2: 8, stern: 7, anchorF: 8, anchorA: 7, deck: 9, pilotW: 7, pilotR: 7, towMast: 7, aviation: 9, flood: 14, bridge: 7, cable: 5, hiMast: 11 };

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function angLerp(a, b, t) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

export class Scene3D {
  constructor(geo) {
    this.id = 'scene3d';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.geo = geo;
    this.ships = new Map();
    this.night = true;
    this.sunDir = new THREE.Vector3(0.3, -0.5, 0.8).normalize();
    this.delayMs = 10.5 * 60e3;
    this.selected = null;
    const o = maplibregl.MercatorCoordinate.fromLngLat(ORIGIN, 0);
    this.o = o;
    this.s = o.meterInMercatorCoordinateUnits();
    this.root = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).scale(new THREE.Vector3(this.s, -this.s, this.s));
  }

  toLocal(lon, lat) {
    const m = maplibregl.MercatorCoordinate.fromLngLat([lon, lat], 0);
    return [(m.x - this.o.x) / this.s, -(m.y - this.o.y) / this.s];
  }
  toLngLat(x, y) {
    return new maplibregl.MercatorCoordinate(this.o.x + x * this.s, this.o.y - y * this.s, 0).toLngLat();
  }

  onAdd(map, gl) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.hemi = new THREE.HemisphereLight('#dfefff', '#3a4450', 1.6);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.4);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.shadowMat = new THREE.MeshBasicMaterial({
      color: '#000000', transparent: true, opacity: 0.38, depthWrite: false,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
    });
    this.shadowMatrix = new THREE.Matrix4();
    this.glowTex = glowTexture();
    this.glowMat = new THREE.MeshBasicMaterial({ map: this.glowTex, color: '#ffd09a', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glowGeo = new THREE.PlaneGeometry(1, 1);
    this.wakeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });

    this.buildStatic();
    this.buildLightPoints();
    this.selRing = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2), Math.sin((i / 64) * Math.PI * 2), 0))),
      new THREE.LineBasicMaterial({ color: '#7fd1ff', transparent: true, opacity: 0.95, depthTest: false })
    );
    this.selRing.visible = false;
    this.selRing.renderOrder = 10;
    this.scene.add(this.selRing);
    this.applyMode();
  }

  // ---------- static structures ----------
  buildStatic() {
    this.staticLights = [];
    this.staticShadowCasters = [];
    const { terminals, cranes, ravenelDeck, ravenelMainSpan, donHoltDeck, donHoltOutline } = this.geo;
    const polys = terminals.map((t) => ({ ...t, local: t.polygon.map(([lo, la]) => this.toLocal(lo, la)) }));
    this.terminalPolys = polys;

    // Gantry cranes from OpenStreetMap, grouped by terminal, booms pointing at the water.
    const groups = new Map();
    for (const [lo, la] of cranes) {
      const p = this.toLocal(lo, la);
      let best = null, bd = 450;
      for (const t of polys) { const d = distToPoly(p, t.local); if (d < bd) { bd = d; best = t; } }
      if (!best) continue;
      if (!groups.has(best.name)) groups.set(best.name, { t: best, pts: [] });
      groups.get(best.name).pts.push(p);
    }
    for (const { t, pts } of groups.values()) {
      const c = centroid(t.local);
      let dir;
      if (pts.length >= 2) {
        const a = pts[0], b = pts[pts.length - 1];
        const lx = b[0] - a[0], ly = b[1] - a[1], ll = Math.hypot(lx, ly) || 1;
        dir = [-ly / ll, lx / ll];
      } else dir = [1, 0];
      const mid = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
      if ((mid[0] - c[0]) * dir[0] + (mid[1] - c[1]) * dir[1] < 0) dir = [-dir[0], -dir[1]];
      const ang = Math.atan2(dir[1], dir[0]) - Math.PI / 2; // model boom is +y
      for (const p of pts) {
        const g = buildCrane();
        g.position.set(p[0], p[1], 0);
        g.rotation.z = ang;
        g.updateMatrix();
        this.scene.add(g);
        this.addShadow(g, true);
        const fx = Math.cos(ang + Math.PI / 2), fy = Math.sin(ang + Math.PI / 2);
        this.staticLights.push({ kind: 'aviation', x: p[0] - fx * 10, y: p[1] - fy * 10, z: 74 });
        for (const d of [10, 30, 52]) this.staticLights.push({ kind: 'flood', x: p[0] + fx * d, y: p[1] + fy * d, z: 44 });
      }
    }

    // High-mast yard lighting inside each terminal.
    for (const t of polys) {
      const [minX, minY, maxX, maxY] = bbox(t.local);
      const step = 125;
      const jr = rng(t.name.length * 7919);
      for (let x = minX + step / 2; x < maxX; x += step)
        for (let y = minY + step / 2; y < maxY; y += step) {
          const p = [x + (jr() - 0.5) * 70, y + (jr() - 0.5) * 70];
          if (pointInPoly(p, t.local)) this.staticLights.push({ kind: 'hiMast', x: p[0], y: p[1], z: 30, k: 0.7 + jr() * 0.6 });
        }
    }

    // Arthur Ravenel Jr. Bridge: diamond towers, fan cables, deck lighting.
    const deckMat = new THREE.LineBasicMaterial({ color: '#cfd6dc', transparent: true, opacity: 0.5 });
    this.cableMat = deckMat;
    if (ravenelMainSpan) {
      const a = this.toLocal(...ravenelMainSpan[0]), b = this.toLocal(...ravenelMainSpan[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const ux = (b[0] - a[0]), uy = (b[1] - a[1]), ul = Math.hypot(ux, uy);
      const u = [ux / ul, uy / ul], n = [-u[1], u[0]];
      const span = ul;
      const deckH = (p) => {
        const d = Math.abs((p[0] - mid[0]) * u[0] + (p[1] - mid[1]) * u[1]);
        return d < span / 2 + 60 ? 57 : Math.max(0, 57 - (d - span / 2 - 60) * 0.045);
      };
      const towerMat = new THREE.MeshLambertMaterial({ color: '#d9dcd8' });
      const cablePts = [];
      for (const T of [a, b]) {
        const leg = (s) => [
          new THREE.Vector3(T[0] + n[0] * 14 * s, T[1] + n[1] * 14 * s, 0),
          new THREE.Vector3(T[0] + n[0] * 30 * s, T[1] + n[1] * 30 * s, 55),
          new THREE.Vector3(T[0], T[1], 175),
        ];
        for (const s of [-1, 1]) {
          const [p0, p1, p2] = leg(s);
          this.scene.add(beam(p0, p1, 4.5, towerMat));
          const top = beam(p1, p2, 4, towerMat);
          this.scene.add(top);
          this.addShadow(top, true);
        }
        this.scene.add(beam(new THREE.Vector3(T[0] - n[0] * 30, T[1] - n[1] * 30, 55), new THREE.Vector3(T[0] + n[0] * 30, T[1] + n[1] * 30, 55), 3, towerMat));
        this.staticLights.push({ kind: 'aviation', x: T[0], y: T[1], z: 178 });
        for (let z = 70; z <= 170; z += 20) this.staticLights.push({ kind: 'cable', x: T[0], y: T[1], z });
        // two cable planes, fanning both ways
        for (const s of [-1, 1]) for (let k = 1; k <= 16; k++) {
          const along = s * k * (span / 2 - 10) / 16;
          const topZ = 175 - k * 3.4;
          for (const side of [-1, 1]) {
            cablePts.push(new THREE.Vector3(T[0], T[1], topZ));
            cablePts.push(new THREE.Vector3(T[0] + u[0] * along + n[0] * 13 * side, T[1] + u[1] * along + n[1] * 13 * side, 58));
          }
        }
      }
      const cables = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cablePts), deckMat);
      this.scene.add(cables);
      for (const ln of ravenelDeck) this.deckLights(ln, deckH, 38);
    }
    if (donHoltOutline) {
      const c = centroid(donHoltOutline.slice(0, -1).map((p) => this.toLocal(...p)));
      const dh = (p) => Math.max(0, 52 - Math.max(0, Math.hypot(p[0] - c[0], p[1] - c[1]) - 250) * 0.04);
      for (const ln of donHoltDeck) this.deckLights(ln, dh, 38);
    }
  }

  deckLights(line, heightFn, spacing) {
    const pts = line.map((p) => this.toLocal(...p));
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let d = carry; d < len; d += spacing) {
        const p = [x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len];
        const h = heightFn(p);
        if (h > 1) this.staticLights.push({ kind: 'bridge', x: p[0], y: p[1], z: h + 2 });
      }
      carry = (carry - len) % spacing;
      if (carry < 0) carry += spacing;
    }
  }

  addShadow(obj, isStatic) {
    const sh = new THREE.Group();
    obj.updateMatrix();
    const meshes = [];
    obj.traverse((m) => { if (m.isMesh) meshes.push(m); });
    for (const m of meshes) {
      let c;
      if (m.isInstancedMesh) {
        c = new THREE.InstancedMesh(m.geometry, this.shadowMat, m.count);
        c.instanceMatrix.copy(m.instanceMatrix);
      } else c = new THREE.Mesh(m.geometry, this.shadowMat);
      c.matrixAutoUpdate = false;
      m.updateMatrix();
      if (m !== obj) c.matrix.copy(m.matrix);
      sh.add(c);
    }
    sh.matrixAutoUpdate = false;
    sh.renderOrder = -1;
    sh.userData.source = obj;
    this.scene.add(sh);
    if (isStatic) this.staticShadowCasters.push(sh);
    return sh;
  }

  buildLightPoints() {
    const max = 6000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.lightMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 }, uTime: { value: 0 } },
      vertexShader: `
        attribute float size; attribute vec3 color; varying vec3 vColor; uniform float uScale;
        void main(){ vColor = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale; }`,
      fragmentShader: `
        varying vec3 vColor;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
          float core = smoothstep(0.22, 0.0, d); float halo = exp(-d * d * 5.0) * (1.0 - d);
          gl_FragColor = vec4(vColor * (halo * 0.9) + vec3(core), (core + halo * 0.85)); }`,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.lightPoints = new THREE.Points(geo, this.lightMat);
    this.lightPoints.frustumCulled = false;
    this.lightPoints.renderOrder = 5;
    this.scene.add(this.lightPoints);
  }

  // ---------- data ----------
  setVessels(vessels, receivedAt = Date.now()) {
    const seenNow = new Set();
    for (const v of vessels) {
      seenNow.add(v.mmsi);
      let s = this.ships.get(v.mmsi);
      if (!s) {
        s = { mmsi: v.mmsi, samples: [], trail: [], fade: 0, born: receivedAt };
        const built = buildShip(v);
        if (!built.sizeKnown) continue; // no hull size reported: cannot draw to scale
        Object.assign(s, built);
        built.group.matrixAutoUpdate = false;
        this.scene.add(built.group);
        s.shadow = this.addShadow(built.group, false);
        s.glow = new THREE.Mesh(this.glowGeo, this.glowMat);
        s.glow.matrixAutoUpdate = false;
        this.scene.add(s.glow);
        s.wake = new THREE.Mesh(new THREE.BufferGeometry(), this.wakeMat);
        s.wake.frustumCulled = false;
        s.wake.renderOrder = -2;
        this.scene.add(s.wake);
        this.ships.set(v.mmsi, s);
      }
      s.v = v;
      s.gone = false;
      // antenna offset to hull center, in ship frame
      s.off = v.to_bow != null && v.to_stern != null ? [((v.to_starboard ?? 0) - (v.to_port ?? 0)) / 2, (v.to_bow - v.to_stern) / 2] : [0, 0];
      const add = (t, lon, lat, h) => {
        const ms = Date.parse(t);
        if (!isFinite(ms) || s.samples.some((q) => Math.abs(q.t - ms) < 1000)) return;
        const [x, y] = this.toLocal(lon, lat);
        s.samples.push({ t: ms, x, y, h });
      };
      for (const p of v.track || []) add(p.t, p.lon, p.lat, p.h);
      add(v.seen, v.lon, v.lat, v.heading ?? null);
      s.samples.sort((a, b) => a.t - b.t);
      const cutoff = Date.now() - 45 * 60e3;
      while (s.samples.length > 2 && s.samples[1].t < cutoff) s.samples.shift();
      s.restHeading = v.heading ?? v.cog ?? s.restHeading ?? 0;
    }
    for (const [id, s] of this.ships) if (!seenNow.has(id)) s.gone = true;
  }

  stateAt(s, T) {
    const sm = s.samples;
    if (!sm.length) return null;
    let x, y, h, moving = false;
    if (T <= sm[0].t || sm.length === 1) ({ x, y } = sm[0]);
    else if (T >= sm[sm.length - 1].t) ({ x, y } = sm[sm.length - 1]);
    else {
      let i = 1;
      while (sm[i].t < T) i++;
      const a = sm[i - 1], b = sm[i];
      const f = (T - a.t) / (b.t - a.t);
      x = a.x + (b.x - a.x) * f;
      y = a.y + (b.y - a.y) * f;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      moving = dist / ((b.t - a.t) / 1000) > 0.25;
      const brg = Math.atan2(b.x - a.x, b.y - a.y) / DEG;
      const ha = a.h ?? brg, hb = b.h ?? brg;
      h = moving ? angLerp(ha, hb, f) : null;
    }
    if (h == null) {
      const last = sm[sm.length - 1];
      h = (T >= last.t ? last.h : null) ?? s.restHeading ?? 0;
    }
    return { x, y, h, moving };
  }

  // ---------- per frame ----------
  render(gl, args) {
    if (!this.renderer) return;
    const now = Date.now();
    const T = now - this.delayMs;
    const zoom = this.map.getZoom();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.lightMat.uniforms.uScale.value = Math.min(2.4, Math.max(0.45, Math.pow(2, (zoom - 13) * 0.75))) * dpr;

    const lightsArr = [];
    const pushLight = (kind, x, y, z, k = 1) => lightsArr.push(kind, x, y, z, k);

    for (const [id, s] of this.ships) {
      const st = this.stateAt(s, T);
      const lastT = s.samples.length ? s.samples[s.samples.length - 1].t : 0;
      if (s.gone && T > lastT) s.fade = Math.max(0, s.fade - 0.02);
      else s.fade = Math.min(1, s.fade + 0.02);
      if (s.gone && s.fade <= 0) { this.removeShip(id); continue; }
      if (!st) continue;
      // smooth heading changes
      s.dispH = s.dispH == null ? st.h : angLerp(s.dispH, st.h, 0.08);
      const hr = -s.dispH * DEG;
      const c = Math.cos(hr), sn = Math.sin(hr);
      const cx = st.x + (s.off[0] * c - s.off[1] * sn);
      const cy = st.y + (s.off[0] * sn + s.off[1] * c);
      s.pos = [cx, cy];
      s.moving = st.moving;
      const m = s.group.matrix;
      m.makeRotationZ(hr).setPosition(cx, cy, 0);
      const sc = 0.001 + s.fade * 0.999;
      if (sc < 1) m.scale(new THREE.Vector3(1, 1, sc));
      s.group.matrixWorldNeedsUpdate = true;
      s.group.visible = s.fade > 0.01;
      s.shadow.matrix.multiplyMatrices(this.shadowMatrix, m);
      s.shadow.matrixWorldNeedsUpdate = true;
      s.shadow.visible = !this.night && s.group.visible;
      s.glow.matrix.makeRotationZ(hr).setPosition(cx, cy, 0.4).scale(new THREE.Vector3(s.B * 3.2 + 30, s.L * 1.25 + 30, 1));
      s.glow.matrixWorldNeedsUpdate = true;
      s.glow.visible = this.night && s.cls !== 'tug' && s.cls !== 'pilot';
      this.updateWake(s, now, c, sn);

      if (this.night && s.fade > 0.5) {
        const status = s.v.nav_status;
        const underway = st.moving || (s.v.sog ?? 0) > 0.5 || status === 0 || status === 8;
        const anchored = status === 1 && !st.moving;
        for (const L of s.lights) {
          const k = L.kind;
          let on;
          if (k === 'deck') on = !underway || s.cls === 'cruise';
          else if (k === 'anchorF' || k === 'anchorA') on = anchored || (!underway && status === 5);
          else if (k === 'pilotW' || k === 'pilotR') on = true;
          else if (k === 'towMast') on = underway;
          else on = underway;
          if (!on) continue;
          pushLight(k, cx + L.x * c - L.y * sn, cy + L.x * sn + L.y * c, L.z);
        }
        if (s.cls === 'cruise') for (let i = 0; i < 10; i++) {
          const yy = -s.L * 0.4 + (s.L * 0.8 * i) / 9;
          for (const xx of [-s.B / 2 + 0.5, s.B / 2 - 0.5]) pushLight('deck', cx + xx * c - yy * sn, cy + xx * sn + yy * c, 20, 0.6);
        }
      }
    }
    if (this.night) for (const L of this.staticLights) pushLight(L.kind, L.x, L.y, L.z, L.k ?? 1);
    this.fillLights(lightsArr);

    if (this.selected && this.ships.get(this.selected)?.pos) {
      const s = this.ships.get(this.selected);
      this.selRing.visible = true;
      this.selRing.matrixAutoUpdate = false;
      this.selRing.matrix.makeRotationZ(-s.dispH * DEG).setPosition(s.pos[0], s.pos[1], 1).scale(new THREE.Vector3(s.B / 2 + 14, s.L / 2 + 14, 1));
      this.selRing.matrixWorldNeedsUpdate = true;
    } else this.selRing.visible = false;

    const mm = args.defaultProjectionData.mainMatrix;
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(mm).multiply(this.root);
    this.renderer.resetState();
    this.renderer.clear(false, true, true);
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }

  updateWake(s, now, c, sn) {
    const stern = [s.pos[0] - (s.L / 2) * -sn, s.pos[1] - (s.L / 2) * c];
    const tr = s.trail;
    const last = tr[tr.length - 1];
    if (s.moving && (!last || Math.hypot(stern[0] - last.x, stern[1] - last.y) > 4)) tr.push({ x: stern[0], y: stern[1], t: now });
    const life = 150e3;
    while (tr.length && now - tr[0].t > life) tr.shift();
    if (tr.length < 2) { s.wake.visible = false; return; }
    s.wake.visible = true;
    const pts = [...tr, { x: stern[0], y: stern[1], t: now }];
    const n = pts.length;
    const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 4);
    const base = this.night ? 0.28 : 0.55;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      let dx = q.x - o.x, dy = q.y - o.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      const age = (now - p.t) / life;
      const w = s.B * (0.45 + age * 1.6);
      const nx = -dy * w, ny = dx * w;
      pos.set([p.x + nx, p.y + ny, 0.3, p.x - nx, p.y - ny, 0.3], i * 6);
      const a = base * Math.pow(1 - Math.min(1, age), 1.6) * s.fade;
      const tint = this.night ? [0.7, 0.8, 0.9] : [0.95, 0.97, 1];
      col.set([...tint, a, ...tint, a], i * 8);
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = s.wake.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
  }

  fillLights(arr) {
    const g = this.lightPoints.geometry;
    const P = g.attributes.position.array, C = g.attributes.color.array, S = g.attributes.size.array;
    const n = Math.min(arr.length / 5, S.length);
    for (let i = 0; i < n; i++) {
      const k = arr[i * 5];
      const col = LIGHT_COLORS[k];
      P[i * 3] = arr[i * 5 + 1]; P[i * 3 + 1] = arr[i * 5 + 2]; P[i * 3 + 2] = arr[i * 5 + 3];
      C[i * 3] = col[0]; C[i * 3 + 1] = col[1]; C[i * 3 + 2] = col[2];
      S[i] = LIGHT_SIZE[k] * arr[i * 5 + 4];
    }
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = true;
  }

  removeShip(id) {
    const s = this.ships.get(id);
    for (const o of [s.group, s.shadow, s.glow, s.wake]) if (o) this.scene.remove(o);
    s.wake?.geometry.dispose();
    this.ships.delete(id);
    if (this.selected === id) this.selected = null;
  }

  // ---------- lighting ----------
  setLighting(night, sunDir) {
    this.night = night;
    if (sunDir) this.sunDir.copy(sunDir);
    this.applyMode();
  }
  applyMode() {
    if (!this.hemi) return;
    const L = this.sunDir.clone();
    if (L.z < 0.25) L.z = 0.25;
    L.normalize();
    if (this.night) {
      this.hemi.color.set('#8ea6cc'); this.hemi.groundColor.set('#1a1d22'); this.hemi.intensity = 1.25;
      this.sun.color.set('#b4c8ee'); this.sun.intensity = 0.6;
      this.sun.position.set(0.3, 0.6, 1);
      this.cableMat.color.set('#e8f0ff'); this.cableMat.opacity = 0.55; this.cableMat.blending = THREE.AdditiveBlending;
    } else {
      this.hemi.color.set('#e4f0ff'); this.hemi.groundColor.set('#4b4f55'); this.hemi.intensity = 1.5;
      this.sun.color.set('#fff6e8'); this.sun.intensity = 2.6;
      this.sun.position.copy(L);
      this.cableMat.color.set('#c8ced4'); this.cableMat.opacity = 0.55; this.cableMat.blending = THREE.NormalBlending;
    }
    this.cableMat.needsUpdate = true;
    // Planar projection onto the water (z = 0.15) along the sun direction.
    const h = 0.15, lx = L.x / L.z, ly = L.y / L.z;
    this.shadowMatrix.set(1, 0, -lx, h * lx, 0, 1, -ly, h * ly, 0, 0, 0, h, 0, 0, 0, 1);
    for (const sh of this.staticShadowCasters) {
      const src = sh.userData.source;
      src.updateMatrix();
      sh.matrix.multiplyMatrices(this.shadowMatrix, src.matrix);
      sh.matrixWorldNeedsUpdate = true;
      sh.visible = !this.night;
    }
  }

  // ---------- picking ----------
  pick(lngLat, pxMeters) {
    const [x, y] = this.toLocal(lngLat.lng, lngLat.lat);
    let best = null, bestScore = Infinity;
    for (const [id, s] of this.ships) {
      if (!s.pos || s.fade < 0.3) continue;
      const hr = s.dispH * DEG;
      const dx = x - s.pos[0], dy = y - s.pos[1];
      const along = dx * Math.sin(hr) + dy * Math.cos(hr);
      const across = dx * Math.cos(hr) - dy * Math.sin(hr);
      const pad = pxMeters * 10;
      if (Math.abs(along) <= s.L / 2 + pad && Math.abs(across) <= s.B / 2 + pad) {
        const score = Math.hypot(along / (s.L / 2 + pad), across / (s.B / 2 + pad)) + s.L * 1e-4;
        if (score < bestScore) { bestScore = score; best = id; }
      }
    }
    return best;
  }
  shipLngLat(id) {
    const s = this.ships.get(id);
    return s?.pos ? this.toLngLat(s.pos[0], s.pos[1]) : null;
  }
}

function beam(p0, p1, w, material) {
  const d = new THREE.Vector3().subVectors(p1, p0);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, w, d.length()), material);
  m.position.copy(p0).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
  m.updateMatrix();
  return m;
}
function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
function bbox(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
}
export function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function distToPoly(p, poly) {
  if (pointInPoly(p, poly)) return 0;
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const [ax, ay] = poly[i - 1], [bx, by] = poly[i];
    const vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(p[0] - ax - vx * t, p[1] - ay - vy * t));
  }
  return best;
}

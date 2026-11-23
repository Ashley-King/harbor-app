import * as THREE from 'three';
import { toWorld, KNOT } from '../geo.js';
import { clamp, lerp, lerpAngle, angleDiff, smoothstep, rng, D2R } from '../util.js';
import { MODELS, TYPICAL_SIZE } from '../ships/models.js';
import { chooseModel, findBerth, nearestPlace } from '../classify.js';
import { PierIndex } from './piers.js';
import { RED, GREEN, WHITE } from './lights.js';

const WAKE_SECONDS = 150;
const WAKE_POINTS = 28;
const STALE_MS = 3 * 3600e3;      // drawn dimmed when not heard for this long
const DROP_MS = 24 * 3600e3;      // not drawn at all after a day of silence
const WARM_DECK = [1.0, 0.86, 0.62];

const WAKE_VERT = /* glsl */ `
attribute vec2 aUv;
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  vUv = aUv;
  vAlpha = aAlpha;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WAKE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uNight;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  float across = 1.0 - abs(vUv.x);
  vec4 n = texture2D(uNoise, vWorld.xz / 23.0 + uTime * 0.010);
  vec4 n2 = texture2D(uNoise, vWorld.xz / 6.5 - uTime * 0.017);
  float foam = smoothstep(0.40, 0.78, n.b * 0.55 + n2.a * 0.45 + across * 0.3 - vUv.y * 0.3);
  float a = vAlpha * (pow(across, 1.5) * 0.45 + foam * 0.55) * smoothstep(0.0, 0.14, across);
  vec3 col = mix(vec3(0.84, 0.92, 0.94), vec3(0.15, 0.19, 0.25), uNight);
  gl_FragColor = vec4(col, a * mix(0.8, 0.65, uNight));
  #include <colorspace_fragment>
}`;

// Bow waves: the V every moving hull leaves (the Kelvin angle, 19.5 degrees a side),
// plus the churned water just behind the stern. Drawn in the ship's own frame.
const KELVIN_VERT = /* glsl */ `
uniform vec3 uExtent;        // stern-most x, bow-most x, full width (ship metres)
varying vec2 vLocal;
varying vec3 vWorld;
void main() {
  vec3 p = vec3(mix(uExtent.x, uExtent.y, position.x + 0.5), 0.12, position.z * uExtent.z);
  vLocal = p.xz;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const KELVIN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uNight;
uniform float uLen;
uniform float uBeam;
uniform float uSpeed;
varying vec2 vLocal;
varying vec3 vWorld;
void main() {
  float d = uLen * 0.5 - vLocal.x;                 // metres astern of the bow
  if (d < 0.0 || uSpeed < 0.01) discard;
  float y = abs(vLocal.y);
  float w = 1.0 + d * 0.05;
  float arm = exp(-pow((y - (uBeam * 0.30 + d * 0.354)) / w, 2.0));
  float inner = 0.4 * exp(-pow((y - (uBeam * 0.22 + d * 0.19)) / (w * 1.5), 2.0));
  float fade = exp(-d / (uLen * 1.25)) * smoothstep(0.0, uLen * 0.05, d);
  vec4 n = texture2D(uNoise, vWorld.xz / 8.0 + uTime * 0.02);
  float foam = (arm + inner) * fade * (0.5 + 1.0 * n.b);
  float ds = d - uLen;
  float wash = step(0.0, ds) * exp(-ds / (uLen * 0.45)) * smoothstep(uBeam * 0.62, uBeam * 0.12, y) * (0.45 + 0.9 * n.a);
  float a = clamp((foam * 0.8 + wash) * uSpeed, 0.0, 0.9);
  vec3 col = mix(vec3(0.86, 0.93, 0.95), vec3(0.15, 0.19, 0.25), uNight);
  gl_FragColor = vec4(col, a * mix(0.85, 0.7, uNight));
  #include <colorspace_fragment>
}`;

/**
 * Every vessel on the map: reconciles each data refresh with what is already
 * shown, moves ships along the track they really sailed, and owns their models,
 * wakes and lights.
 */
export class Fleet {
  constructor(stage, env, harbor, lightField, noise) {
    this.stage = stage;
    this.env = env;
    this.harbor = harbor;
    this.lights = lightField;
    this.entities = new Map();
    this.group = new THREE.Group();
    stage.scene.add(this.group);
    this.showOthers = true;
    this.selected = null;
    this.nextRefreshAt = Date.now() + 600000;
    this.glow = { value: 0 };
    this.wakeUniforms = { uNoise: { value: noise }, uTime: env.uniforms.uTime, uNight: env.uniforms.uNight };
    this.wakeMaterial = new THREE.ShaderMaterial({ vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG, uniforms: this.wakeUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.kelvinGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

    this.piers = new PierIndex(harbor.piers);

    // Ring around the selected vessel, and a tick at its newest reported position.
    const ring = new THREE.RingGeometry(0.96, 1.0, 96).rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }));
    this.ring.visible = false;
    this.ring.renderOrder = 30;
    this.fix = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.0, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
    this.fix.visible = false;
    this.fix.renderOrder = 30;
    this.group.add(this.ring, this.fix);
  }

  // ------------------------------------------------------------ data

  /** Take a fresh AIS block. `nextRefreshAt` is when the following one is due. */
  setData(vessels, nextRefreshAt) {
    const now = Date.now();
    this.nextRefreshAt = nextRefreshAt;
    const seen = new Set();
    for (const v of vessels) {
      const t = v.seen ? Date.parse(v.seen) : NaN;
      if (!Number.isFinite(t) || now - t > DROP_MS) continue;
      seen.add(v.mmsi);
      let e = this.entities.get(v.mmsi);
      if (!e) {
        e = this._create(v);
        this.entities.set(v.mmsi, e);
      }
      this._ingest(e, v, t, now);
    }
    for (const [mmsi, e] of this.entities) {
      if (!seen.has(mmsi)) e.gone = true;
    }
    for (const e of this.entities.values()) {
      if (e.needsFit && !e.gone) {
        e.assumedHeading = this._fitHeading(e.needsFit, e.v, e);
        e.needsFit = null;
      }
    }
    // With every heading settled, slide moored hulls clear of the wharf or dock they lie at.
    for (const e of this.entities.values()) {
      e.nudge = !e.gone && e.state !== 'underway' ? this._clearance(e) : null;
    }
  }

  _create(v) {
    return {
      mmsi: v.mmsi, v, group: v.group, path: [], s: 0, rate: 1, fresh: true,
      pos: { x: 0, y: 0 }, heading: 0, headingKnown: false, speed: 0, fade: 0, gone: false,
      object: null, built: null, model: null, berth: null, place: null, wake: null, kelvin: null, deck: { value: 0 },
      screen: { x: 0, y: 0 },
    };
  }

  _ingest(e, v, seenMs, now) {
    e.v = v;
    e.group = v.group;
    e.gone = false;
    e.seenMs = seenMs;
    e.stale = now - seenMs > STALE_MS;
    const here = toWorld(v.lat, v.lon);
    const reportHeading = v.heading != null ? v.heading : v.sog != null && v.sog >= 0.5 && v.cog != null ? v.cog : null;
    const pts = [];
    for (const p of v.track || []) {
      const w = toWorld(p[1], p[2]);
      const hd = p[5] != null ? p[5] : p[3] != null && p[3] >= 0.5 && p[4] != null ? p[4] : null;
      pts.push({ t: p[0] * 1000, x: w.x, y: w.y, hdg: hd, sog: p[3] });
    }
    pts.push({ t: seenMs, x: here.x, y: here.y, hdg: reportHeading, sog: v.sog });
    const path = e.path;
    const last = path[path.length - 1];
    if (last && !(v.track && v.track.length) && Math.hypot(here.x - last.x, here.y - last.y) < 15 && (v.sog == null || v.sog < 0.5)) {
      // Sitting still: GPS jitter at a berth is not movement.
      last.t = Math.max(last.t, seenMs);
      if (reportHeading != null) last.hdg = reportHeading;
    } else {
      // No track for this vessel: if the straight line from its last report to this one
      // crosses land, it must not be drawn sailing over it. It is moved in one step instead.
      if (last && !(v.track && v.track.length) && this._crossesLand(last, here)) pts[pts.length - 1].jump = true;
      for (const p of pts) {
        if (!last || p.t > last.t + 500) path.push(p);
      }
      path.sort((a, b) => a.t - b.t);
      for (let i = path.length - 1; i > 0; i--) {
        if (path[i].t - path[i - 1].t < 500) path.splice(i - 1, 1);   // the newest report repeats the last track point
      }
    }
    const newest = path[path.length - 1];
    if (e.fresh) {
      // First sight: start about one refresh back along the real track, so the ship
      // is already moving when the page opens.
      const lead = clamp(this.nextRefreshAt - now, 60000, 900000);
      e.s = Math.max(path[0].t, newest.t - lead);
      const p = this._sample(e, e.s);
      e.pos.x = p.x;
      e.pos.y = p.y;
      e.fresh = false;
      e.first = true;
    }
    while (path.length > 3 && path[1].t < e.s - WAKE_SECONDS * 1000 - 30000) path.shift();
    if (path.length > 400) path.splice(0, path.length - 400);

    // Berth, model and size are decided from the newest report.
    const dims = v.length != null && v.beam != null;
    const off = this._centreOffset(v, reportHeading ?? 0);
    const cx = here.x + off.x, cy = here.y + off.y;
    // Tied-up boats still report a few tenths of a knot of GPS drift.
    const tied = v.navStatus === 5 || v.navStatus === 1;
    const still = v.sog == null || v.sog < (tied ? 1.6 : v.group === 'other' ? 1.0 : 0.7);
    e.berth = still ? findBerth(cx, cy, v.beam, this.harbor) : null;
    e.place = still && !e.berth ? nearestPlace(cx, cy, this.harbor) : null;
    e.state = !still ? 'underway' : e.berth ? 'berth' : v.navStatus === 1 ? 'anchor' : 'still';
    const choice = chooseModel(v, e.berth);
    // Keep a model once chosen unless the reported size changes, so a ship does not
    // change shape when it leaves the berth that hinted at its kind.
    const sizeKey = dims ? `${v.length}:${v.beam}` : 'typical';
    if (!e.model || e.sizeKey !== sizeKey || (e.model.how !== 'ais' && choice.how !== e.model.how && (choice.how === 'name' || choice.how === 'ais'))) {
      const typical = TYPICAL_SIZE[choice.model];
      e.size = dims ? { L: v.length, B: v.beam, estimated: false } : { L: typical[0], B: typical[1], estimated: true };
      e.model = { ...choice, label: MODELS[choice.model].label, key: `${choice.model}:${e.size.L}:${e.size.B}` };
      e.sizeKey = sizeKey;
    }
    if (reportHeading != null) e.lastHeading = reportHeading;
    if (still && reportHeading == null && e.lastHeading == null) {
      // No heading from the vessel: lie along the wharf or dock it is at, or failing
      // that the way the hull fits the open water around it.
      const pier = e.berth ? null : this._pierHeading(here, v, e.size);
      if (e.berth) e.assumedHeading = e.berth.bearing;
      else if (pier != null) e.assumedHeading = pier;
      else e.needsFit = here;
      e.headingFrom = e.berth ? 'wharf' : pier != null ? 'dock' : 'water';
    }
  }

  /** True when the straight line between two positions passes over land. */
  _crossesLand(a, b) {
    const wet = this.wetAt;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (!wet || d < 40) return false;
    const steps = Math.min(400, Math.ceil(d / 12));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      if (wet(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f) < 0.15) return true;
    }
    return false;
  }

  /**
   * Heading for a stationary vessel that reports none and sits at a pier or dock:
   * along the dock. Which end is the bow is taken from its course over ground when
   * it has one, and is otherwise a guess that the card owns up to.
   */
  _pierHeading(here, v, size) {
    const hit = this.piers.nearest(here.x, here.y, size.B + 7);
    if (!hit) return null;
    const along = ((Math.atan2(hit.seg.ux, hit.seg.uy) / D2R) + 360) % 360;
    const ref = v.cog;
    if (ref != null && Math.abs(angleDiff(ref, along)) > 90) return (along + 180) % 360;
    return along;
  }

  /**
   * Where a moored hull has to move so it is not drawn through the wharf or dock it
   * is tied to. GPS and antenna-offset errors of a few metres cause the overlap. The
   * push is the shortest one that clears every pier nearby, and never more than 30 m.
   */
  _clearance(e) {
    const v = e.v;
    const here = e.path[e.path.length - 1];
    const hd = here.hdg ?? e.lastHeading ?? e.assumedHeading ?? v.cog ?? 0;
    const off = this._centreOffset(v, hd);
    const h = hd * D2R;
    const hull = { x: here.x + off.x, y: here.y + off.y, fx: Math.sin(h), fy: Math.cos(h), hl: e.size.L / 2, hb: e.size.B / 2 };
    const x0 = hull.x, y0 = hull.y;
    if (e.berth) {
      const w = this._clearWharf(hull.x, hull.y, hd, e.size, e.berth);
      if (w) {
        hull.x += w.x;
        hull.y += w.y;
      }
    }
    for (let pass = 0; pass < 8; pass++) {
      let worst = null;
      for (const seg of this.piers.near(hull.x, hull.y, hull.hl + 12)) {
        const push = PierIndex.push(hull, seg);
        if (push && (!worst || push.depth > worst.depth)) worst = push;
      }
      if (!worst) break;
      hull.x += worst.x;
      hull.y += worst.y;
    }
    const nx = hull.x - x0, ny = hull.y - y0;
    const d = Math.hypot(nx, ny);
    if (d < 0.1) return null;
    const k = d > 30 ? 30 / d : 1;
    return { x: nx * k, y: ny * k };
  }

  /**
   * A stationary ship that reports no heading still has to be drawn pointing some way.
   * Its course over ground is noise at zero speed, so try every 15 degrees and keep the
   * direction that leaves the most of the hull over water (a ship at a pier then lies
   * along the pier). Which end is the bow stays a guess, and the card says so.
   */
  _fitHeading(here, v, self) {
    const water = this.waterAt;
    const fallback = v.cog ?? 0;
    if (!water) return fallback;
    const L = self.size.L, B = self.size.B;
    const score = (hd) => {
      const off = this._centreOffset(v, hd);
      const h = hd * D2R;
      let sum = 0;
      for (let i = -4; i <= 4; i++) {
        for (const side of [-0.4, 0.4]) {
          const fx = (i / 8) * L, sx = side * B;
          sum += water(here.x + off.x + Math.sin(h) * fx + Math.cos(h) * sx, here.y + off.y + Math.cos(h) * fx - Math.sin(h) * sx);
        }
      }
      return sum;
    };
    let best = fallback, bestScore = -1;
    for (let k = 0; k < 24; k++) {
      const hd = (Math.round(fallback / 15) * 15 + k * 15) % 360;
      const sc = score(hd);
      if (sc > bestScore + 0.4) {
        bestScore = sc;
        best = hd;
      }
    }
    // Ships at the same pier lie parallel: copy a stationary neighbour's reported heading when it fits as well.
    let near = null;
    for (const o of this.entities.values()) {
      if (o === self || o.gone || o.lastHeading == null || o.state === 'underway' || !o.path.length) continue;
      const p = o.path[o.path.length - 1];
      const d = Math.hypot(p.x - here.x, p.y - here.y);
      if (d < 380 && (!near || d < near.d)) near = { d, hdg: o.lastHeading };
    }
    if (near) {
      for (const hd of [near.hdg, (near.hdg + 180) % 360]) {
        if (score(hd) >= bestScore - 0.6) return hd;
      }
    }
    return best;
  }

  /**
   * GPS and antenna-offset errors of a few metres can put a berthed hull partly
   * "inside" the wharf. A ship cannot be there, so slide it straight off the wharf
   * face until it just clears the fenders. Never more than 30 m.
   */
  _clearWharf(cx, cy, headingDeg, size, berth) {
    const h = headingDeg * D2R;
    const fx = Math.sin(h), fy = Math.cos(h);
    const sx = Math.cos(h), sy = -Math.sin(h);
    let min = Infinity;
    for (const [a, b] of [[0.42, 0.5], [0.42, -0.5], [-0.5, 0.5], [-0.5, -0.5], [0, 0.5], [0, -0.5]]) {
      const px = cx + fx * size.L * a + sx * size.B * b;
      const py = cy + fy * size.L * a + sy * size.B * b;
      min = Math.min(min, (px - berth.a[0]) * berth.out[0] + (py - berth.a[1]) * berth.out[1]);
    }
    const push = clamp(2.5 - min, 0, 30);
    return push > 0.1 ? { x: berth.out[0] * push, y: berth.out[1] * push } : null;
  }

  /** Offset from the GPS antenna to the middle of the hull, in world metres. */
  _centreOffset(v, headingDeg) {
    if (v.toBow == null || v.toStern == null || v.toPort == null || v.toStarboard == null) return { x: 0, y: 0 };
    const fwd = (v.toBow - v.toStern) / 2;
    const stbd = (v.toStarboard - v.toPort) / 2;
    const h = headingDeg * D2R;
    return { x: Math.sin(h) * fwd + Math.cos(h) * stbd, y: Math.cos(h) * fwd - Math.sin(h) * stbd };
  }

  /** Position on the recorded track at time t (ms). */
  _sample(e, t) {
    const path = e.path;
    const n = path.length;
    if (n === 1 || t <= path[0].t) return { x: path[0].x, y: path[0].y, hdg: path[0].hdg, speed: 0, i: 0 };
    if (t >= path[n - 1].t) return { x: path[n - 1].x, y: path[n - 1].y, hdg: path[n - 1].hdg, speed: 0, i: n - 1 };
    let i = e._i && e._i < n - 1 && path[e._i].t <= t ? e._i : 0;
    while (i < n - 2 && path[i + 1].t <= t) i++;
    e._i = i;
    const a = path[i], b = path[i + 1];
    if (b.jump) return { x: a.x, y: a.y, hdg: a.hdg, speed: 0, i };       // wait here, then step to b
    const span = Math.max(1, b.t - a.t);
    const f = (t - a.t) / span;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    let hdg = null;
    if (a.hdg != null && b.hdg != null) hdg = lerpAngle(a.hdg, b.hdg, f);
    else if (dist > 12) hdg = (Math.atan2(b.x - a.x, b.y - a.y) / D2R + 360) % 360;
    else hdg = b.hdg ?? a.hdg;
    return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), hdg, speed: dist / (span / 1000) / KNOT, i };
  }

  // ------------------------------------------------------------ models

  _build(e) {
    const v = e.v;
    const info = { name: v.name, grey: false };
    const L = e.size.L, B = e.size.B;
    const built = MODELS[e.model.model].build(L, B, rng(v.mmsi), info);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04 });
    const glow = this.glow;
    const deck = e.deck;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = glow;
      shader.uniforms.uDeck = deck;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uGlow;\nuniform float uDeck;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (vGlow * uGlow * 2.4 + uDeck);');
    };
    const mesh = new THREE.Mesh(built.geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const object = new THREE.Group();
    object.add(mesh);
    const kelvin = new THREE.Mesh(this.kelvinGeometry, new THREE.ShaderMaterial({
      vertexShader: KELVIN_VERT, fragmentShader: KELVIN_FRAG, transparent: true, depthWrite: false,
      uniforms: { ...this.wakeUniforms, uLen: { value: L }, uBeam: { value: B }, uSpeed: { value: 0 }, uExtent: { value: new THREE.Vector3(-L * 3.1, L * 0.5, L * 2.6 + B) } },
    }));
    kelvin.frustumCulled = false;
    kelvin.visible = false;
    kelvin.renderOrder = 3;
    object.add(kelvin);
    this.group.add(object);
    e.object = object;
    e.mesh = mesh;
    e.kelvin = kelvin;
    e.built = built;
    e.builtKey = e.model.key;
  }

  _dispose(e) {
    if (e.object) {
      this.group.remove(e.object);
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
      e.kelvin.material.dispose();
      e.object = null;
      e.built = null;
    }
    if (e.wake) {
      this.group.remove(e.wake);
      e.wake.geometry.dispose();
      e.wake = null;
    }
  }

  _wakeMesh() {
    const g = new THREE.BufferGeometry();
    const n = WAKE_POINTS * 2;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aUv', new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < WAKE_POINTS - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx);
    const m = new THREE.Mesh(g, this.wakeMaterial);
    m.frustumCulled = false;
    m.renderOrder = 2;
    this.group.add(m);
    return m;
  }

  /** Trail of disturbed water along the path the ship has just sailed. */
  _updateWake(e, strength) {
    if (strength < 0.02 || e.path.length < 2) {
      if (e.wake) e.wake.visible = false;
      return;
    }
    if (!e.wake) e.wake = this._wakeMesh();
    const g = e.wake.geometry;
    const pos = g.attributes.position.array, uv = g.attributes.aUv.array, al = g.attributes.aAlpha.array;
    const beam = e.size.B;
    const len = e.size.L;
    const span = WAKE_SECONDS * 1000 * clamp(0.45 + e.speed / 14, 0.45, 1);
    // Samples run from the ship's stern back in time along the recorded track.
    const off = this._centreOffset(e.v, e.heading);
    const h = e.heading * D2R;
    const sternX = e.pos.x + off.x - Math.sin(h) * len * 0.5;
    const sternY = e.pos.y + off.y - Math.cos(h) * len * 0.5;
    let px = sternX, py = sternY, dirx = -Math.sin(h), diry = -Math.cos(h);
    for (let i = 0; i < WAKE_POINTS; i++) {
      const f = i / (WAKE_POINTS - 1);
      let x = sternX, y = sternY;
      if (i > 0) {
        const p = this._sample(e, e.s - f * span);
        const po = this._centreOffset(e.v, p.hdg ?? e.heading);
        const ph = (p.hdg ?? e.heading) * D2R;
        x = p.x + po.x - Math.sin(ph) * len * 0.5;
        y = p.y + po.y - Math.cos(ph) * len * 0.5;
        const dx = x - px, dy = y - py;
        const d = Math.hypot(dx, dy);
        if (d > 0.5) {
          dirx = dx / d;
          diry = dy / d;
        }
      }
      px = x;
      py = y;
      const half = beam * (0.42 + 1.5 * f) + 5 * f;
      const nx = -diry, ny = dirx;
      const a = strength * (1 - f) ** 1.4;
      for (let s = 0; s < 2; s++) {
        const sign = s ? 1 : -1;
        const k = (i * 2 + s) * 3;
        pos[k] = x + nx * half * sign;
        pos[k + 1] = 0.1;
        pos[k + 2] = -(y + ny * half * sign);
        uv[(i * 2 + s) * 2] = sign;
        uv[(i * 2 + s) * 2 + 1] = f;
        al[i * 2 + s] = a;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aUv.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    e.wake.visible = true;
  }

  // ------------------------------------------------------------ per frame

  update(dt, nowMs) {
    const night = this.env.night;
    this.glow.value = night;
    const lights = this.lights;
    lights.reset();
    lights.uniforms.uStrength.value = night;
    const mpp = this.stage.mpp;
    const timeLeft = Math.max(8000, this.nextRefreshAt - nowMs);
    const view = this.stage.viewRect(600);

    for (const [mmsi, e] of this.entities) {
      // ---- advance along the recorded track
      const newest = e.path[e.path.length - 1];
      const remaining = newest.t - e.s;
      const want = clamp(remaining / timeLeft, 0, 4);
      e.rate += (want - e.rate) * Math.min(1, dt * 0.8);
      if (remaining > 0) e.s = Math.min(newest.t, e.s + dt * 1000 * e.rate);
      const p = this._sample(e, e.s);
      const at = e.path[p.i];
      if (at !== e._at) {
        // Arrived at a report that could not be reached by water: step there, and fade back in.
        if (at.jump && e._at) {
          e.pos.x = p.x;
          e.pos.y = p.y;
          e.fade = 0;
        }
        e._at = at;
      }
      const k = e.first ? 1 : 1 - Math.exp(-dt * 2.2);
      e.pos.x += (p.x - e.pos.x) * k;
      e.pos.y += (p.y - e.pos.y) * k;
      const moving = remaining > 500 && p.speed > 0.4;
      e.speed += ((moving ? p.speed * e.rate : 0) - e.speed) * Math.min(1, dt * 1.2);
      let hdg = p.hdg;
      e.headingKnown = hdg != null;
      if (hdg == null) hdg = e.lastHeading ?? e.assumedHeading ?? e.v.cog ?? 0;
      e.heading = e.first ? hdg : (e.heading + angleDiff(e.heading, hdg) * (1 - Math.exp(-dt * 1.4)) + 360) % 360;
      e.first = false;

      // ---- fade in, fade out
      e.fade = clamp(e.fade + (e.gone ? -dt / 1.5 : dt / 1.2), 0, 1);
      if (e.gone && e.fade <= 0) {
        this._dispose(e);
        this.entities.delete(mmsi);
        if (this.selected === mmsi) this.selected = null;
        continue;
      }
      const off = this._centreOffset(e.v, e.heading);
      // Ease the dock correction in and out as the vessel arrives or leaves.
      e.nudgeMix = clamp((e.nudgeMix ?? 1) + (e.nudge && e.state !== 'underway' && remaining < 1500 ? dt : -dt) / 4, 0, 1);
      if (e.nudge) e.nudgeLast = e.nudge;
      const nd = e.nudgeLast && e.nudgeMix > 0 ? e.nudgeLast : null;
      const cx = e.pos.x + off.x + (nd ? nd.x * e.nudgeMix : 0), cy = e.pos.y + off.y + (nd ? nd.y * e.nudgeMix : 0);
      e.centre = { x: cx, y: cy };
      const sp = this.stage.worldToScreen(cx, cy, 0);
      e.screen.x = sp.x;
      e.screen.y = sp.y;
      const inView = cx > view.west && cx < view.east && cy > view.south && cy < view.north;
      e.hidden = e.group === 'other' && !this.showOthers;

      if (e.hidden) {
        if (e.object) e.object.visible = false;
        if (e.wake) e.wake.visible = false;
        continue;
      }
      if (!e.object || e.builtKey !== e.model.key) {
        if (!inView && !e.object) continue;           // build models as they come into view
        this._dispose(e);
        this._build(e);
      }
      const o = e.object;
      o.position.set(cx, 0, -cy);
      o.rotation.y = Math.PI / 2 - e.heading * D2R;
      o.visible = e.fade > 0.01;
      const mat = e.mesh.material;
      const dim = e.stale ? 0.58 : 1;
      mat.color.setScalar(dim);
      if (e.fade < 1) {
        mat.transparent = true;
        mat.opacity = e.fade;
      } else if (mat.transparent) {
        mat.transparent = false;
        mat.opacity = 1;
        mat.needsUpdate = true;
      }
      const strength = smoothstep(1.0, 6.5, e.speed) * e.fade;
      e.kelvin.visible = strength > 0.02;
      e.kelvin.material.uniforms.uSpeed.value = strength;
      this._updateWake(e, strength * 0.9);
      // Deck floodlights are on when a ship is working cargo or at anchor, off under way.
      // Small craft at a dock keep only a little cabin and cockpit light.
      const working = e.state !== 'underway' ? 1 : 0.12;
      const level = e.group === 'other' ? 0.1 : e.built.festive ? 0.34 : 0.2;
      e.deck.value += (night * working * level * dim - e.deck.value) * Math.min(1, dt * 2);
      if (night > 0.02 && inView) this._lightsFor(e, cx, cy, working * dim);
    }
    lights.commit();

    // ---- selection ring
    const sel = this.selected != null ? this.entities.get(this.selected) : null;
    if (sel && sel.centre && !sel.hidden) {
      const r = Math.max(sel.size.L * 0.62, 16 * mpp) + 6 * mpp;
      this.ring.visible = true;
      this.ring.position.set(sel.centre.x, 0.5, -sel.centre.y);
      this.ring.scale.set(r, 1, r);
      this.ring.material.opacity = 0.65 + 0.25 * Math.sin(nowMs / 420);
      // Where the newest report puts the ship, when the drawn ship has not reached it yet.
      const newest = sel.path[sel.path.length - 1];
      const d = Math.hypot(newest.x - sel.pos.x, newest.y - sel.pos.y);
      this.fix.visible = d > Math.max(40, 14 * mpp);
      if (this.fix.visible) {
        const o = this._centreOffset(sel.v, newest.hdg ?? sel.heading);
        const fr = Math.max(7 * mpp, 10);
        this.fix.position.set(newest.x + o.x, 0.5, -(newest.y + o.y));
        this.fix.scale.set(fr, 1, fr);
      }
    } else {
      this.ring.visible = false;
      this.fix.visible = false;
    }
  }

  /** Navigation and deck lights for one vessel, placed on its model. */
  _lightsFor(e, cx, cy, working) {
    const L = e.built.lights;
    const lights = this.lights;
    const h = e.heading * D2R;
    const sin = Math.sin(h), cos = Math.cos(h);
    const put = (p, color, intensity, size, sheen) => {
      if (!p) return;
      // ship frame (x forward, z starboard) to world
      const wx = cx + sin * p[0] + cos * p[2];
      const wy = cy + cos * p[0] - sin * p[2];
      lights.add(wx, wy, p[1] + 0.6, color, intensity * e.fade, size);
      if (sheen) lights.add(wx + cos * Math.sign(p[2] || 0) * sheen * 0.9, wy - sin * Math.sign(p[2] || 0) * sheen * 0.9, 0.4, color, intensity * 0.28 * e.fade, sheen);
    };
    const len = e.size.L, beam = e.size.B;
    const big = len > 50;
    const s = clamp(beam * 0.16, 0.9, 5.5);
    if (e.group === 'other' && e.state !== 'underway') {
      // A small boat tied up or at anchor shows a single white light, as the rules ask at anchor.
      put(L.masthead, WHITE, 1.3, s);
      return;
    }
    put(L.masthead, WHITE, 2.3, s);
    if (big) put(L.masthead2, WHITE, 2.3, s);
    const sheen = big ? 13 : len > 20 ? 6 : 0;
    put(L.port, RED, 2.2, s * 0.9, sheen);
    put(L.stbd, GREEN, 2.2, s * 0.9, sheen);
    put(L.stern, WHITE, 1.7, s * 0.85, big ? 9 : 0);
    if (working > 0.5 && e.group !== 'other') {
      for (const w of e.built.work) put([w[0], w[1], w[2]], WARM_DECK, 0.26, Math.max(w[3] * 0.8, 6));
      // Loom of the deck lights on the water around the hull.
      const n = Math.max(1, Math.round(len / 60));
      for (let i = 0; i < n; i++) put([(-0.4 + (0.8 * (i + 0.5)) / n) * len, 0, 0], WARM_DECK, 0.16, beam * 1.5);
    }
  }

  // ------------------------------------------------------------ picking

  /** The vessel under a screen point. When hulls overlap, the one whose middle is nearest wins. */
  pick(px, py) {
    const w = this.stage.screenToWorld(px, py);
    const mpp = this.stage.mpp;
    let best = null;
    for (const e of this.entities.values()) {
      if (!e.centre || e.gone || e.hidden) continue;
      const len = e.size.L, beam = e.size.B;
      const h = e.heading * D2R;
      const dx = w.x - e.centre.x, dy = w.y - e.centre.y;
      const fwd = dx * Math.sin(h) + dy * Math.cos(h);
      const side = dx * Math.cos(h) - dy * Math.sin(h);
      const pad = Math.max(9 * mpp, 2.5);
      if (Math.abs(fwd) <= len / 2 + pad && Math.abs(side) <= beam / 2 + pad) {
        const score = Math.hypot(fwd / (len / 2 + pad), side / (beam / 2 + pad));
        if (!best || score < best.score) best = { e, score };
      }
    }
    return best ? best.e : null;
  }

  select(mmsi) {
    this.selected = mmsi;
  }
}

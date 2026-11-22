// Charleston Harbor live ship viewer: scene setup, live data, ship motion and UI.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { toWorld, GEO, pointInPoly, distToPoly } from './geo.js';
import { sunPosition, sunTimes } from './sun.js';
import { Ground } from './ground.js';
import { LightField } from './lights.js';
import { buildStructures } from './structures.js';
import { buildShip, disposeShip, makeWake, KIND_LABEL } from './ships.js';

const REFRESH_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 6 * 3600 * 1000; // hide vessels not heard from for six hours
const GLIDE_MS = 45 * 1000; // time a ship takes to glide to a newly reported position
const TZ = 'America/New_York';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

// ------------------------------------------------------------------ renderer
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x05090e);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 8000);
camera.position.set(0, 0, 4000);
camera.up.set(0, 1, 0);
camera.lookAt(0, 0, 0);

const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uMpp: { value: 10 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.4, 0.85) },
  uPxPerM: { value: 0.1 },
  uDpr: { value: renderer.getPixelRatio() },
};

const hemi = new THREE.HemisphereLight(0xdfeaff, 0x54606a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const shadowMat = new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false });
const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
shadowPlane.receiveShadow = true;
shadowPlane.position.z = 0.05;
shadowPlane.renderOrder = 0;
scene.add(shadowPlane);

const ground = new Ground(scene, renderer, shared);
const staticLights = new LightField(scene, 6000, shared, false);
const shipLights = new LightField(scene, 4000, shared, true);
const structures = buildStructures(scene, staticLights, shared);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.6, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Small on-screen markers: faded dots for other craft, locators for tiny boats.
const dots = (() => {
  const cap = 600;
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 4), size = new Float32Array(cap);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uDpr: shared.uDpr },
    vertexShader: `attribute vec4 aColor; attribute float aSize; uniform float uDpr; varying vec4 vC;
      void main(){ vC = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uDpr; }`,
    fragmentShader: `varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
      float ring = smoothstep(0.62, 0.78, d); vec3 c = mix(vC.rgb, vec3(0.02, 0.04, 0.07), ring);
      gl_FragColor = vec4(c, vC.a * (1.0 - smoothstep(0.9, 1.0, d)));
      #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 15;
  scene.add(pts);
  let n = 0;
  return {
    reset() { n = 0; },
    add(x, y, r, gg, b, a, s) {
      if (n >= cap) return;
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = 60;
      col[n * 4] = r; col[n * 4 + 1] = gg; col[n * 4 + 2] = b; col[n * 4 + 3] = a;
      size[n++] = s;
    },
    commit() { g.setDrawRange(0, n); for (const k in g.attributes) g.attributes[k].needsUpdate = true; },
  };
})();

const selRing = new THREE.Mesh(
  new THREE.RingGeometry(0.96, 1, 96),
  new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.9, depthTest: false }),
);
selRing.renderOrder = 18;
selRing.visible = false;
scene.add(selRing);

// ------------------------------------------------------------------ camera / view
const view = { cx: 0, cy: 0, halfH: 12000, touched: false };
const HOME = (() => {
  const [x0, y0] = toWorld(-79.992, 32.718);
  const [x1, y1] = toWorld(-79.795, 32.925);
  return { x0, y0, x1, y1 };
})();
let W = 1, H = 1;
function panelWidthPx() {
  const p = $('panel');
  if (p.classList.contains('hidden') || window.innerWidth <= 760) return 0;
  return p.getBoundingClientRect().width + 16;
}
function goHome() {
  const pw = panelWidthPx();
  const availW = Math.max(200, W - pw);
  const bw = HOME.x1 - HOME.x0, bh = HOME.y1 - HOME.y0;
  view.halfH = Math.max(bh / 2, (bw / 2) * (H / availW)) * 1.03;
  const mppCss = (2 * view.halfH) / H;
  view.cx = (HOME.x0 + HOME.x1) / 2 + (pw / 2) * mppCss;
  view.cy = (HOME.y0 + HOME.y1) / 2;
  view.touched = false;
}
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  shared.uDpr.value = renderer.getPixelRatio();
  renderer.setSize(W, H, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(W, H);
  if (!view.touched) goHome();
}
window.addEventListener('resize', resize);
const screenToWorld = (sx, sy) => {
  const halfW = view.halfH * (W / H);
  return [view.cx + (sx / W - 0.5) * 2 * halfW, view.cy - (sy / H - 0.5) * 2 * view.halfH];
};
function zoomAt(sx, sy, factor) {
  const [wx, wy] = screenToWorld(sx, sy);
  const nh = clamp(view.halfH * factor, 120, 45000);
  const f = nh / view.halfH;
  view.cx = wx + (view.cx - wx) * f;
  view.cy = wy + (view.cy - wy) * f;
  view.halfH = nh;
  view.touched = true;
}
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(clamp(e.deltaY, -120, 120) * 0.0022));
}, { passive: false });
const pointers = new Map();
let dragMoved = 0, pinchDist = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  dragMoved = 0;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]); }
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p[0], dy = e.clientY - p[1];
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 1) {
    const mpp = (2 * view.halfH) / H;
    view.cx -= dx * mpp; view.cy += dy * mpp;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    if (dragMoved > 4) view.touched = true;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinchDist > 0) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinchDist / d);
    pinchDist = d; dragMoved += 10;
  }
});
const endPointer = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  canvas.classList.remove('dragging');
  if (e.type === 'pointerup' && dragMoved < 5 && pointers.size === 0) pickAt(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('dblclick', (e) => zoomAt(e.clientX, e.clientY, 0.5));
$('home').addEventListener('click', goHome);
$('panelToggle').addEventListener('click', () => {
  $('panel').classList.toggle('hidden');
  document.body.classList.toggle('nopanel', $('panel').classList.contains('hidden'));
  if (!view.touched) goHome();
});

// ------------------------------------------------------------------ day / night
const params = new URLSearchParams(location.search);
let mode = ['auto', 'day', 'night'].includes(params.get('mode')) ? params.get('mode') : 'auto';
let nightTarget = 0;
let nightInit = false;
function updateSun() {
  const now = Date.now();
  const sp = sunPosition(now);
  const altDeg = (sp.altitude * 180) / Math.PI;
  // In Auto, the switch is centred on real sunrise and sunset with a short twilight blend.
  const autoNight = clamp((-0.833 - altDeg) / 5 + 0.5, 0, 1);
  nightTarget = mode === 'auto' ? autoNight : mode === 'night' ? 1 : 0;
  if (!nightInit) { shared.uNight.value = nightTarget; nightInit = true; }
  // Daylight direction: the real sun when it is up, otherwise a mid-afternoon stand-in for manual Day.
  let az = sp.azimuth, alt = sp.altitude;
  if (altDeg < 2) { az = (215 * Math.PI) / 180; alt = (42 * Math.PI) / 180; }
  alt = Math.max(alt, (14 * Math.PI) / 180);
  dayDir.set(Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt));
  const t = sunTimes(now);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const isNight = altDeg < -0.833;
  $('sunline').textContent = `Sunrise ${fmt.format(t.sunrise)} · Sunset ${fmt.format(t.sunset)} · ${mode === 'auto' ? `Auto: ${isNight ? 'night' : 'day'} now` : `Manual ${mode}`}`;
  for (const b of $('modes').children) b.classList.toggle('on', b.dataset.mode === mode);
}
const dayDir = new THREE.Vector3(0.3, -0.5, 0.8);
const moonDir = new THREE.Vector3(Math.sin(2.6) * 0.57, Math.cos(2.6) * 0.57, 0.82).normalize();
for (const b of $('modes').children) b.addEventListener('click', () => { mode = b.dataset.mode; updateSun(); });

// ------------------------------------------------------------------ vessels
const AIS_TYPES = { 30: 'Fishing', 31: 'Towing', 32: 'Towing (large)', 33: 'Dredging', 34: 'Diving ops', 35: 'Military', 36: 'Sailing', 37: 'Pleasure craft', 50: 'Pilot vessel', 51: 'Search and rescue', 52: 'Tug', 53: 'Port tender', 54: 'Anti-pollution', 55: 'Law enforcement', 58: 'Medical transport', 59: 'Noncombatant' };
function aisTypeName(t) {
  if (t == null) return null;
  if (AIS_TYPES[t]) return `${AIS_TYPES[t]} (AIS ${t})`;
  const d = Math.floor(t / 10);
  const base = { 2: 'Wing in ground', 4: 'High-speed craft', 6: 'Passenger', 7: 'Cargo', 8: 'Tanker', 9: 'Other' }[d];
  return base ? `${base} (AIS ${t})` : `AIS type ${t}`;
}
const NAV = { 0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command', 3: 'Restricted manoeuvrability', 4: 'Constrained by draught', 5: 'Moored', 6: 'Aground', 7: 'Fishing', 8: 'Under way sailing', 11: 'Towing astern', 12: 'Pushing ahead or towing alongside' };
const CONTAINER_RE = /\b(MSC|MAERSK|CMA CGM|COSCO|EVER|HAPAG|EXPRESS|YM|ONE|ZIM|HYUNDAI|HMM|OOCL|APL|SEALAND|WAN HAI|NYK|KOTA|SEASPAN|SAFMARINE|MATSON|CONTSHIP|COSCO SHIPPING)\b/;
const CARCARRIER_RE = /\b(LEADER|HIGHWAY|ACE|HOEGH|WALLENIUS|GLOVIS|MORNING|GRANDE|AUTO|ARC|RCC|PARSIFAL|TONSBERG|FIGARO|FIDELIO|ENDURANCE|HERO|CAPE D[A-Z]+|CAPE EDMONT)\b/;
const LARGE = new Set(['container', 'tanker', 'carcarrier', 'bulk', 'general', 'cruise', 'passenger', 'atb']);
const CONTAINER_TERMS = new Set(['wando', 'nct', 'leatherman']);
const TERM_ORDER = [['wando', 'Wando Welch Terminal'], ['nct', 'North Charleston Terminal'], ['leatherman', 'Leatherman Terminal'], ['columbus', 'Columbus Street Terminal']];

const validLen = (v) => (v.length != null && v.length >= 3 && v.length <= 460 ? v.length : null);
const validBeam = (v) => (v.beam != null && v.beam >= 1 && v.beam <= 70 ? v.beam : null);

function terminalAt(x, y, reach) {
  let best = null, bd = Infinity;
  for (const t of GEO.terminals) {
    const d = pointInPoly(x, y, t.poly) ? 0 : distToPoly(x, y, t.poly);
    if (d < bd) { bd = d; best = t; }
  }
  return bd <= reach ? best.key : null;
}

const kindCache = new Map();
/** Decide how a vessel is drawn. AIS only says "cargo", so the cargo subtype is inferred. */
function classify(v, term) {
  const t = v.type, L = validLen(v), B = validBeam(v);
  const name = (v.name || '').toUpperCase();
  const big = (t != null && t >= 60 && t <= 89) || (L != null && L > 150);
  let kind = 'other', why = '', strong = true;
  if (t === 50) kind = 'pilot';
  else if (t === 52 || t === 31 || t === 32) kind = L != null && L > 90 ? 'atb' : 'tug';
  else if (big) {
    if (t >= 60 && t <= 69) kind = L != null && L >= 100 ? 'cruise' : 'passenger';
    else if (t >= 80 && t <= 89) kind = 'tanker';
    else if (CONTAINER_RE.test(name)) { kind = 'container'; why = 'inferred from the name'; }
    else if (CARCARRIER_RE.test(name)) { kind = 'carcarrier'; why = 'inferred from the name'; }
    else if (term && CONTAINER_TERMS.has(term)) { kind = 'container'; why = 'inferred from its berth at a container terminal'; }
    else if (term === 'columbus') { kind = 'carcarrier'; why = 'inferred from its berth at the vehicle terminal'; }
    else if (L != null && L >= 250) { kind = 'container'; why = 'inferred from its size'; strong = false; }
    else if (L != null && L >= 140) { kind = 'bulk'; why = 'inferred from its size'; strong = false; }
    else { kind = 'general'; why = 'generic cargo model'; strong = false; }
  }
  if (kind === 'other') return { kind, why, big: false, drawable: false };
  const prev = kindCache.get(v.mmsi);
  if (prev && (prev.strong || !strong)) { kind = prev.kind; why = prev.why; } else kindCache.set(v.mmsi, { kind, why, strong });
  return { kind, why, big, drawable: L != null && B != null };
}

const ships = new Map();
let vesselCount = { large: 0, small: 0, other: 0 };

function targetOf(v) {
  let hdg = null, hdgKnown = true;
  if (v.heading != null && v.heading < 360) hdg = v.heading;
  else if (v.cog != null && v.cog < 360 && (v.sog || 0) >= 0.5) hdg = v.cog;
  else { hdgKnown = false; hdg = v.cog != null && v.cog < 360 ? v.cog : 0; }
  let [x, y] = toWorld(v.lon, v.lat);
  const L = validLen(v), B = validBeam(v);
  // AIS reports the antenna position; shift to the hull centre using the reported offsets.
  if (L && B && v.toBow != null && v.toStern != null && v.toPort != null && v.toStarboard != null
    && Math.abs(v.toBow + v.toStern - L) <= 2 && v.toBow + v.toStern > 0 && hdgKnown) {
    const h = (hdg * Math.PI) / 180;
    const fwd = (v.toBow - v.toStern) / 2, stb = (v.toStarboard - v.toPort) / 2;
    x += Math.sin(h) * fwd + Math.cos(h) * stb;
    y += Math.cos(h) * fwd - Math.sin(h) * stb;
  }
  return { x, y, hdg, hdgKnown };
}

function applyVessels(list) {
  const now = Date.now();
  const seen = new Set();
  vesselCount = { large: 0, small: 0, other: 0 };
  for (const v of list) {
    if (v.kind && v.kind !== 'vessel') continue;
    const age = v.seen ? now - Date.parse(v.seen) : Infinity;
    if (!(age < MAX_AGE_MS)) continue;
    const tg = targetOf(v);
    const moving = (v.sog || 0) >= 1;
    const term = moving ? null : terminalAt(tg.x, tg.y, 140 + (validBeam(v) || 0));
    const c = classify(v, term);
    seen.add(v.mmsi);
    let s = ships.get(v.mmsi);
    if (!s) {
      s = { mmsi: v.mmsi, cur: { ...tg }, from: { ...tg }, to: { ...tg }, t0: now, group: null, wake: null, label: null };
      ships.set(v.mmsi, s);
    } else {
      s.from = { ...s.cur }; s.to = { ...tg }; s.t0 = now;
      if (Math.hypot(tg.x - s.cur.x, tg.y - s.cur.y) > 15000) { s.cur = { ...tg }; s.from = { ...tg }; }
    }
    s.v = v; s.term = term; s.c = c;
    s.cat = c.kind === 'other' ? 'other' : LARGE.has(c.kind) ? 'large' : 'small';
    if (c.big && c.kind !== 'other') s.cat = 'large';
    vesselCount[s.cat]++;
    const L = validLen(v), B = validBeam(v);
    const sig = c.drawable ? `${c.kind}/${L}/${B}` : 'none';
    if (s.sig !== sig) {
      if (s.group) { scene.remove(s.group); disposeShip(s.group); s.group = null; s.wake = null; }
      s.sig = sig;
      if (c.drawable) {
        const m = buildShip(c.kind, L, B, v.mmsi);
        s.group = m.group; s.lights = m.lights; s.L = L; s.B = B;
        s.wake = makeWake(shared);
        s.wake.position.set(0, L / 2, 0.35);
        s.wake.material.uniforms.uBeam.value = B;
        s.wake.material.uniforms.uShipLen.value = L;
        s.group.add(s.wake);
        scene.add(s.group);
      }
    }
  }
  for (const [mmsi, s] of ships) {
    if (seen.has(mmsi)) continue;
    if (s.group) { scene.remove(s.group); disposeShip(s.group); }
    if (s.label) s.label.remove();
    ships.delete(mmsi);
    if (selected === mmsi) selectShip(null);
  }
  if (selected != null) renderCard();
}

function animateShips(now, n, mpp) {
  shipLights.reset();
  dots.reset();
  const mppCss = (2 * view.halfH) / H;
  for (const s of ships.values()) {
    const t = smooth(clamp((now - s.t0) / GLIDE_MS, 0, 1));
    s.cur.x = lerp(s.from.x, s.to.x, t);
    s.cur.y = lerp(s.from.y, s.to.y, t);
    const dh = ((s.to.hdg - s.from.hdg + 540) % 360) - 180;
    s.cur.hdg = s.from.hdg + dh * t;
    const v = s.v, sog = v.sog || 0;
    if (!s.group) {
      if (s.cat === 'other') dots.add(s.cur.x, s.cur.y, 0.82, 0.88, 0.95, lerp(0.42, 0.26, n), 4.2);
      else dots.add(s.cur.x, s.cur.y, 1.0, 0.72, 0.25, 0.95, 9); // large vessel with no reported dimensions
      continue;
    }
    const h = (s.cur.hdg * Math.PI) / 180;
    s.group.position.set(s.cur.x, s.cur.y, 0);
    s.group.rotation.z = -h;
    const under = sog >= 0.5 && v.navStatus !== 1 && v.navStatus !== 5;
    const wu = s.wake.material.uniforms;
    const strength = clamp((sog - 0.6) / 4, 0, 1);
    s.wake.visible = strength > 0.01;
    if (s.wake.visible) {
      const wl = clamp(s.L * 1.3 + sog * 38, 50, 1100);
      wu.uSize.value.set(s.B + wl * 0.72, wl);
      wu.uStrength.value = strength;
    }
    const sh = Math.sin(h), ch = Math.cos(h);
    const minPx = s.cat === 'large' ? 2.6 : 2.0;
    for (const l of s.lights) {
      if (l.m === 'run' ? !under : l.m === 'moor' ? under : false) continue;
      shipLights.add(s.cur.x + l.x * ch + l.y * sh, s.cur.y - l.x * sh + l.y * ch, l.z, l.c, l.s, l.i, l.c === undefined ? 2 : (l.i > 2 ? minPx : 0));
    }
    // Small boats shrink below a pixel when the whole harbor is in view; keep a locator dot.
    const px = s.L / mppCss;
    if (px < 9) {
      const a = clamp((9 - px) / 4, 0, 1) * (s.cat === 'large' ? 0.95 : lerp(0.8, 0.45, n));
      if (s.cat === 'large') dots.add(s.cur.x, s.cur.y, 1.0, 0.86, 0.45, a, 7);
      else dots.add(s.cur.x, s.cur.y, 0.45, 0.85, 1.0, a, 5.2);
    }
  }
  shipLights.commit();
  dots.commit();
  const sel = selected != null && ships.get(selected);
  selRing.visible = !!sel;
  if (sel) {
    const r = Math.max((sel.L || 30) * 0.62, 14 * mppCss);
    selRing.position.set(sel.cur.x, sel.cur.y, 70);
    selRing.scale.set(r, r, 1);
  }
}

// ------------------------------------------------------------------ picking and the ship card
let selected = null;
function pickAt(sx, sy) {
  const [wx, wy] = screenToWorld(sx, sy);
  const mppCss = (2 * view.halfH) / H;
  let best = null, bd = Infinity;
  for (const s of ships.values()) {
    const h = (s.cur.hdg * Math.PI) / 180;
    const dx = wx - s.cur.x, dy = wy - s.cur.y;
    const lx = dx * Math.cos(h) - dy * Math.sin(h), ly = dx * Math.sin(h) + dy * Math.cos(h);
    const pad = (s.cat === 'other' ? 7 : 10) * mppCss;
    const hw = Math.max((s.B || 0) / 2, pad), hl = Math.max((s.L || 0) / 2, pad);
    if (Math.abs(lx) > hw || Math.abs(ly) > hl) continue;
    const d = Math.hypot(dx, dy) + (s.cat === 'other' ? 3 * mppCss : 0);
    if (d < bd) { bd = d; best = s; }
  }
  selectShip(best ? best.mmsi : null);
}
function selectShip(mmsi, focus = false) {
  selected = mmsi;
  const s = mmsi != null && ships.get(mmsi);
  if (s && focus) {
    view.cx = s.cur.x; view.cy = s.cur.y;
    view.halfH = clamp(Math.max((s.L || 60) * 2.2, 420), 120, view.halfH);
    view.touched = true;
  }
  renderCard();
  for (const b of document.querySelectorAll('.ship')) b.classList.toggle('sel', Number(b.dataset.mmsi) === mmsi);
}
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const timeFmtS = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min ago`;
}
let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { regionNames = null; }
function flagText(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return null;
  const emoji = String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  let name = code;
  try { name = (regionNames && regionNames.of(code)) || code; } catch { name = code; }
  return `${emoji} ${name}`;
}
function etaText(eta) {
  const m = eta && /^(\d\d)-(\d\d) (\d\d):(\d\d)$/.exec(eta);
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31 || +m[3] > 23 || +m[4] > 59) return null;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[1] - 1];
  return `${mon} ${+m[2]}, ${m[3]}:${m[4]} UTC`;
}
function renderCard() {
  const card = $('card');
  const s = selected != null && ships.get(selected);
  if (!s) { card.hidden = true; return; }
  const v = s.v, L = validLen(v), B = validBeam(v);
  card.replaceChildren();
  const head = el('div', 'head');
  const titles = el('div');
  titles.append(el('h2', null, v.name || 'Unknown name'));
  const kind = s.c.kind !== 'other' ? `Drawn as ${KIND_LABEL[s.c.kind]}${s.c.why ? `, ${s.c.why}` : ''}` : 'Not a large ship, shown as a faded marker';
  titles.append(el('div', 'kind', s.c.drawable || s.c.kind === 'other' ? kind : `${KIND_LABEL[s.c.kind]}, size not reported so no scale model`));
  const x = el('button', 'x', 'Close');
  x.addEventListener('click', () => selectShip(null));
  head.append(titles, x);
  const dl = el('dl');
  const row = (k, val) => {
    dl.append(el('dt', null, k));
    dl.append(el('dd', val == null ? 'unknown' : null, val == null ? 'unknown' : val));
  };
  row('Flag', flagText(v.flag));
  row('IMO', v.imo != null && v.imo >= 1000000 && v.imo <= 9999999 ? String(v.imo) : null);
  row('MMSI', String(v.mmsi));
  row('Type', aisTypeName(v.type));
  row('Length × beam', L != null && B != null ? `${L} m × ${B} m` : L != null ? `${L} m × unknown` : null);
  row('Speed', v.sog != null ? `${v.sog.toFixed(1)} kn` : null);
  row('Heading', s.to.hdgKnown ? `${Math.round(s.to.hdg)}°` : null);
  row('Status', v.navStatus != null && NAV[v.navStatus] ? NAV[v.navStatus] : null);
  row('Destination', v.destination);
  row('ETA', etaText(v.eta));
  row('Draught', v.draught != null && v.draught > 0 ? `${v.draught.toFixed(1)} m` : null);
  const seenMs = v.seen ? Date.parse(v.seen) : NaN;
  row('Last report', Number.isFinite(seenMs) ? `${timeFmt.format(seenMs)} (${ago(seenMs)})` : null);
  card.append(head, dl);
  if (!s.to.hdgKnown && s.group) card.append(el('p', 'note', 'This vessel is not reporting a heading, so its orientation on the map is not reliable.'));
  card.hidden = false;
}

// ------------------------------------------------------------------ labels
const labelLayer = $('labels');
const staticLabels = [
  ...structures.labels,
  { text: 'Charleston', pos: toWorld(-79.9405, 32.7835), cls: 'place' },
  { text: 'Mount Pleasant', pos: toWorld(-79.862, 32.802), cls: 'place' },
  { text: 'Daniel Island', pos: toWorld(-79.912, 32.862), cls: 'place' },
  { text: 'North Charleston', pos: toWorld(-79.985, 32.868), cls: 'place' },
  { text: 'James Island', pos: toWorld(-79.945, 32.735), cls: 'place' },
  { text: 'Fort Sumter', pos: toWorld(-79.8747, 32.7523), cls: 'minor' },
  { text: 'Harbor jetties', pos: toWorld(-79.828, 32.741), cls: 'minor' },
  { text: 'Cooper River', pos: toWorld(-79.928, 32.823), cls: 'minor' },
  { text: 'Wando River', pos: toWorld(-79.872, 32.853), cls: 'minor' },
  { text: 'Ashley River', pos: toWorld(-79.962, 32.772), cls: 'minor' },
].map((l) => ({ ...l, node: labelLayer.appendChild(el('div', `lbl ${l.cls}`, l.text)) }));
function placeLabel(node, wx, wy, dyPx = 0) {
  const halfW = view.halfH * (W / H);
  const sx = ((wx - view.cx) / (2 * halfW) + 0.5) * W;
  const sy = (0.5 - (wy - view.cy) / (2 * view.halfH)) * H + dyPx;
  const vis = sx > -150 && sx < W + 150 && sy > -40 && sy < H + 40;
  node.style.display = vis ? '' : 'none';
  if (vis) node.style.transform = `translate(-50%, -50%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
}
function updateLabels() {
  const mppCss = (2 * view.halfH) / H;
  const halfW = view.halfH * (W / H);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
  const placed = [];
  for (const l of staticLabels) {
    if ((l.cls === 'minor' || l.cls === 'place') && mppCss > 34) { l.node.style.display = 'none'; continue; }
    placeLabel(l.node, l.pos[0], l.pos[1]);
    placed.push({
      sx: ((l.pos[0] - view.cx) / (2 * halfW) + 0.5) * W, sy: (0.5 - (l.pos[1] - view.cy) / (2 * view.halfH)) * H,
      w: l.text.length * rem * (l.cls.includes('major') ? 0.56 : 0.5),
    });
  }
  // Ship names: biggest ships first, and a name is skipped if it would overlap one already placed.
  const order = [...ships.values()].sort((a, b) => (b.mmsi === selected) - (a.mmsi === selected) || (b.L || 0) - (a.L || 0));
  const hits = (sx, sy, w) => placed.some((p) => Math.abs(p.sx - sx) < (p.w + w) / 2 && Math.abs(p.sy - sy) < rem * 1.3);
  for (const s of order) {
    const px = (s.L || 0) / mppCss;
    let want = s.v.name && (s.mmsi === selected || (s.cat === 'large' && ((s.L || 0) >= 90 || !s.group || px > 14)) || (s.cat === 'small' && px > 9));
    let sx = 0, sy = 0, w = 0, off = 0;
    if (want) {
      // Place the name beside the hull, clear of the ship itself.
      const h = (s.cur.hdg * Math.PI) / 180;
      const ext = s.group ? (Math.abs(Math.cos(h)) * s.L + Math.abs(Math.sin(h)) * s.B) / 2 : 0;
      off = ext / mppCss + rem * 0.95;
      sx = ((s.cur.x - view.cx) / (2 * halfW) + 0.5) * W;
      const cy = (0.5 - (s.cur.y - view.cy) / (2 * view.halfH)) * H;
      w = s.v.name.length * rem * 0.46 + rem;
      sy = cy + off;
      if (hits(sx, sy, w)) { off = -off; sy = cy + off; } // try above the ship instead
      if (hits(sx, sy, w) && s.mmsi !== selected) want = false;
    }
    if (!want) { if (s.label) { s.label.remove(); s.label = null; } continue; }
    placed.push({ sx, sy, w });
    if (!s.label) s.label = labelLayer.appendChild(el('div', 'lbl shipname', s.v.name));
    else if (s.label.textContent !== s.v.name) s.label.textContent = s.v.name;
    const cls = `lbl shipname${s.cat === 'small' ? ' small' : ''}${s.mmsi === selected ? ' sel' : ''}`;
    if (s.label.className !== cls) s.label.className = cls;
    placeLabel(s.label, s.cur.x, s.cur.y, off);
  }
}

// ------------------------------------------------------------------ live data
const feeds = { ais: null, tide: null, airGap: null };
const FEED_NAMES = { ais: 'Ship positions', tide: 'Tide', airGap: 'Bridge clearance' };
let nextAt = Date.now() + REFRESH_MS, lastAttempt = null, loading = true;
async function refresh() {
  nextAt = Date.now() + REFRESH_MS;
  let j = null, err = null;
  try {
    const r = await fetch('/api/harbor', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    j = await r.json();
  } catch (e) {
    err = String((e && e.message) || e);
  }
  lastAttempt = Date.now();
  loading = false;
  for (const k of Object.keys(feeds)) {
    const f = j && j[k];
    if (f && f.ok && f.data) feeds[k] = { data: f.data, at: Date.parse(f.fetchedAt) || Date.now(), stale: false, error: null };
    else feeds[k] = { data: feeds[k] ? feeds[k].data : null, at: feeds[k] ? feeds[k].at : null, stale: true, error: (f && f.error) || err || 'no response' };
  }
  // Ships only move when fresh data arrives; a failed refresh keeps the last good picture.
  if (feeds.ais.data && !feeds.ais.stale) applyVessels(feeds.ais.data.vessels);
  renderPanel();
  renderCredits();
}
setInterval(refresh, REFRESH_MS);

function renderStatus() {
  const box = $('status');
  box.replaceChildren();
  box.append(el('h2', null, 'Live data'));
  const a = feeds.ais;
  if (loading) box.append(el('p', 'updated', 'Loading live data'));
  else if (a && a.at) box.append(el('p', 'updated', `Updated ${timeFmtS.format(a.at)}`));
  else box.append(el('p', 'updated', 'No ship data received yet'));
  const left = Math.max(0, nextAt - Date.now());
  box.append(el('p', 'sub', `Next refresh in ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} · refreshes every 10 minutes`));
  const chips = el('div', 'chips');
  for (const k of Object.keys(feeds)) {
    const f = feeds[k];
    const c = el('span', `chip ${!f ? 'wait' : f.stale ? 'stale' : 'ok'}`, !f ? `${FEED_NAMES[k]}: waiting` : f.stale ? `${FEED_NAMES[k]}: stale` : `${FEED_NAMES[k]}: live`);
    chips.append(c);
  }
  box.append(chips);
  for (const k of Object.keys(feeds)) {
    const f = feeds[k];
    if (!f || !f.stale) continue;
    box.append(el('p', 'stalebox', f.at
      ? `${FEED_NAMES[k]} feed failed at ${timeFmt.format(lastAttempt)}. Showing the last good data from ${timeFmt.format(f.at)}. Retrying at the next refresh.`
      : `${FEED_NAMES[k]} feed is unavailable (${f.error}). Nothing to show yet. Retrying at the next refresh.`));
  }
}
function metric(k, value, unit, detail, stale) {
  const m = el('div', `metric${stale ? ' stale' : ''}`);
  m.append(el('div', 'k', k));
  const v = el('div', 'v', value);
  if (unit) v.append(el('small', null, unit));
  m.append(v);
  for (const d of detail) m.append(el('div', 'd', d));
  return m;
}
function renderConditions() {
  const box = $('conditions');
  box.replaceChildren();
  box.append(el('h2', null, 'Tide and bridge clearance'));
  const grid = el('div', 'metrics');
  const t = feeds.tide, g = feeds.airGap;
  if (t && t.data) {
    const d = t.data, det = [];
    const trend = d.ratePerHour == null ? '' : Math.abs(d.ratePerHour) < 0.1 ? 'Slack' : d.ratePerHour > 0 ? `Rising ${d.ratePerHour.toFixed(1)} ft/h` : `Falling ${Math.abs(d.ratePerHour).toFixed(1)} ft/h`;
    det.push(`${trend ? `${trend} · ` : ''}observed ${timeFmt.format(Date.parse(d.t))}`);
    if (d.next && d.next[0]) det.push(`Next ${d.next[0].type} ${d.next[0].v.toFixed(1)} ft at ${timeFmt.format(Date.parse(d.next[0].t))} (NOAA prediction)`);
    if (t.stale) det.push(`Stale: last good ${timeFmt.format(t.at)}`);
    grid.append(metric('Tide, above MLLW', d.v.toFixed(2), 'ft', det, t.stale));
  } else grid.append(metric('Tide, above MLLW', 'unknown', '', [t && t.stale ? 'Feed unavailable' : 'Waiting for data'], !!(t && t.stale)));
  if (g && g.data) {
    const d = g.data, det = [`${(d.v * 0.3048).toFixed(1)} m · observed ${timeFmt.format(Date.parse(d.t))}`, 'Air gap under the main span'];
    if (g.stale) det.push(`Stale: last good ${timeFmt.format(g.at)}`);
    grid.append(metric('Ravenel clearance', d.v.toFixed(1), 'ft', det, g.stale));
  } else grid.append(metric('Ravenel clearance', 'unknown', '', [g && g.stale ? 'Feed unavailable' : 'Waiting for data'], !!(g && g.stale)));
  box.append(grid);
  box.append(el('p', 'sub', 'NOAA CO-OPS stations 8665530 (Charleston) and 8665353 (Ravenel Bridge)'));
}
function shipRow(s) {
  const b = el('button', 'ship');
  b.dataset.mmsi = s.mmsi;
  if (s.mmsi === selected) b.classList.add('sel');
  b.append(el('span', 'n', s.v.name || `MMSI ${s.mmsi}`));
  const L = validLen(s.v);
  const bits = [KIND_LABEL[s.c.kind] || 'vessel'];
  if (L) bits.push(`${L} m`);
  if ((s.v.sog || 0) >= 0.5) bits.push(`${s.v.sog.toFixed(1)} kn`);
  b.append(el('span', 'm', bits.join(' · ')));
  b.addEventListener('click', () => selectShip(s.mmsi, true));
  return b;
}
function renderTerminals() {
  const box = $('terminals');
  box.replaceChildren();
  box.append(el('h2', null, 'Ships at the terminals'));
  const large = [...ships.values()].filter((s) => s.cat === 'large').sort((a, b) => (validLen(b.v) || 0) - (validLen(a.v) || 0));
  const used = new Set();
  const section = (title, list, emptyText) => {
    const t = el('div', 'term');
    const h = el('h3', null, title);
    h.append(el('span', null, String(list.length)));
    t.append(h);
    if (!list.length) t.append(el('div', 'none', emptyText));
    for (const s of list) t.append(shipRow(s));
    box.append(t);
  };
  const noData = !feeds.ais || !feeds.ais.data;
  for (const [key, name] of TERM_ORDER) {
    const list = large.filter((s) => s.term === key);
    list.forEach((s) => used.add(s.mmsi));
    section(name, list, noData ? 'unknown' : 'No large ships alongside');
  }
  const moving = large.filter((s) => !used.has(s.mmsi) && (s.v.sog || 0) >= 1);
  moving.forEach((s) => used.add(s.mmsi));
  section('Under way in the harbor', moving, noData ? 'unknown' : 'None right now');
  section('Other berths and anchorages', large.filter((s) => !used.has(s.mmsi)), noData ? 'unknown' : 'None right now');
  const small = [...ships.values()].filter((s) => s.cat === 'small').sort((a, b) => (b.v.sog || 0) - (a.v.sog || 0));
  section('Tugs and pilot boats', small, noData ? 'unknown' : 'None reporting');
  if (!noData) box.append(el('p', 'sub', `${vesselCount.other} other craft are shown as faded dots. Vessels silent for over 6 hours are hidden.`));
}
function renderPanel() { renderStatus(); renderConditions(); renderTerminals(); }
function renderCredits() {
  const ais = feeds.ais && feeds.ais.data && feeds.ais.data.attribution && feeds.ais.data.attribution.length
    ? feeds.ais.data.attribution.join(' ') : 'Open Waters AIS (https://openwaters.io/ais/)';
  $('credits').textContent = `Imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics, and the GIS User Community) · Ship positions: ${ais} · Tide and air gap: NOAA CO-OPS · Bridges, terminals, cranes and buoys: © OpenStreetMap contributors · Water mask: USGS National Hydrography Dataset`;
}
function tickClock() {
  $('clock').textContent = `${dayFmt.format(Date.now())} · ${timeFmtS.format(Date.now())} · live ship traffic`;
  renderStatus();
  updateSun();
}

// ------------------------------------------------------------------ frame loop
let frame = 0, last = performance.now();
function loop(tNow) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (tNow - last) / 1000);
  last = tNow;
  frame++;
  shared.uTime.value += dt;
  const n0 = shared.uNight.value;
  shared.uNight.value = Math.abs(nightTarget - n0) < 0.002 ? nightTarget : n0 + (nightTarget - n0) * Math.min(1, dt * 1.6);
  const n = shared.uNight.value;

  const halfW = view.halfH * (W / H);
  camera.left = -halfW; camera.right = halfW; camera.top = view.halfH; camera.bottom = -view.halfH;
  camera.position.set(view.cx, view.cy, 4000);
  camera.updateProjectionMatrix();
  const bufH = H * renderer.getPixelRatio();
  const mpp = (2 * view.halfH) / bufH;
  shared.uMpp.value = mpp;
  shared.uPxPerM.value = 1 / mpp;

  // Sun by day, moon by night; the key light dips through the switch.
  const useDay = n < 0.5;
  const dir = useDay ? dayDir : moonDir;
  shared.uSunDir.value.copy(dir);
  const k = Math.abs(1 - 2 * n);
  sun.color.setHex(useDay ? 0xfff2df : 0x9db4e6);
  sun.intensity = (useDay ? 2.5 : 0.42) * (0.25 + 0.75 * k);
  hemi.intensity = lerp(1.15, 0.50, n);
  hemi.color.setHex(useDay ? 0xdfeaff : 0x8fa6d8);
  shadowMat.opacity = (useDay ? 0.45 : 0.22) * k;
  const pad = 700;
  sun.target.position.set(view.cx, view.cy, 0);
  sun.position.set(view.cx + dir.x * 3000, view.cy + dir.y * 3000, dir.z * 3000);
  const sc = sun.shadow.camera;
  const ext = Math.max(halfW, view.halfH) + pad;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 10; sc.far = 7000;
  sc.updateProjectionMatrix();
  shadowPlane.position.set(view.cx, view.cy, 0.05);
  shadowPlane.scale.set(halfW * 2.2, view.halfH * 2.2, 1);

  const gain = Math.pow(n, 1.4);
  staticLights.gain.value = gain;
  shipLights.gain.value = gain;
  staticLights.points.visible = gain > 0.01;
  shipLights.points.visible = gain > 0.01;
  structures.setNight(n);
  bloom.strength = lerp(0.16, 0.7, n);
  bloom.radius = 0.55;

  animateShips(Date.now(), n, mpp);
  ground.update({ x0: view.cx - halfW, x1: view.cx + halfW, y0: view.cy - view.halfH, y1: view.cy + view.halfH, mpp }, frame);
  updateLabels();
  composer.render();
}

resize();
updateSun();
tickClock();
setInterval(tickClock, 1000);
setInterval(() => { if (selected != null) renderCard(); }, 30000);
renderPanel();
renderCredits();
refresh();
requestAnimationFrame(loop);
// Handy for checking from the console.
window.__harbor = { ships, feeds, view, refresh, toWorld, lookAt(lon, lat, halfH) { const [x, y] = toWorld(lon, lat); view.cx = x; view.cy = y; view.halfH = halfH; view.touched = true; } };

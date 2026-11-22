// Satellite imagery ground: a small slippy-tile manager drawing Esri World
// Imagery tiles as textured quads, with a shader that adds animated water
// (using a static land/water mask) and a night look with city lights.
import * as THREE from 'three';
import { tileRect, worldToTile, WORLD_CIRC, MASK_RECT } from './geo.js';

const TILE_URL = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const BASE_Z = 11, MIN_Z = 11, MAX_Z = 18, MAX_CACHE = 420;

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec2 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform sampler2D uMask;
uniform vec4 uMaskRect;
uniform float uTime;
uniform float uNight;
uniform float uMpp;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec2 vWorld;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// Water surface height: wind-driven chop at two scales plus broad gust patches.
float waterH(vec2 p, float mid, float fine) {
  vec2 wind = vec2(0.8, 0.35);
  float h = fbm(p / 520.0 + wind * uTime * 0.008) * 1.5;
  h += mid * fbm(p / 75.0 + wind * uTime * 0.03) * 0.55;
  h += fine * (fbm(p / 13.0 + wind * uTime * 0.10) * 0.30 + fbm(p / 4.3 - wind.yx * uTime * 0.14) * 0.12);
  return h;
}

void main() {
  vec3 sat = texture2D(uMap, vUv).rgb;
  vec2 muv = (vWorld - uMaskRect.xy) / uMaskRect.zw;
  float water = smoothstep(0.35, 0.65, texture2D(uMask, clamp(muv, 0.0, 1.0)).r);

  // ---------- water ----------
  // A blurred copy of the imagery keeps the real water colour while removing
  // the vessels that happened to be in the satellite photo.
  // Close in, the water is mostly procedural so that vessels caught in the
  // satellite photo do not show through; zoomed out, the real imagery colour leads.
  float far = smoothstep(4.0, 14.0, uMpp);
  vec3 blur = textureLod(uMap, vUv, mix(6.5, 2.5, far)).rgb;
  vec3 deep = vec3(0.030, 0.088, 0.105) * (0.82 + 0.36 * fbm(vWorld / 900.0));
  vec3 wbase = mix(pow(blur, vec3(0.9)) * 1.25, deep, mix(0.93, 0.34, far));
  float mid = 1.0 - smoothstep(3.0, 14.0, uMpp);
  float fine = 1.0 - smoothstep(0.6, 3.0, uMpp);
  float e = max(uMpp * 1.2, 1.5);
  float h0 = waterH(vWorld, mid, fine);
  vec2 grad = vec2(waterH(vWorld + vec2(e, 0.0), mid, fine) - h0, waterH(vWorld + vec2(0.0, e), mid, fine) - h0) / e;
  vec3 n = normalize(vec3(-grad * 6.0, 1.0));
  vec3 L = normalize(uSunDir);
  float relief = dot(n.xy, L.xy);
  vec3 Hh = normalize(vec3(L.xy * 0.22, 1.0));
  float glint = smoothstep(0.9955, 0.9998, dot(n, Hh)) * (0.25 + 0.75 * fine);
  vec3 dayWater = wbase * (1.0 + relief * (0.55 + 0.35 * fine)) + vec3(1.0, 0.96, 0.88) * glint * 0.38
                + vec3(0.08, 0.14, 0.18) * (1.0 - n.z) * 1.2;
  vec3 nightWater = vec3(0.0035, 0.008, 0.016) * (1.0 + relief * 1.1) + blur * 0.012
                  + vec3(0.55, 0.65, 0.85) * glint * 0.03;

  // ---------- land ----------
  vec3 soft = textureLod(uMap, vUv, 2.0).rgb;
  float lum = dot(soft, vec3(0.2126, 0.7152, 0.0722));
  float mxc = max(max(soft.r, soft.g), soft.b), mnc = min(min(soft.r, soft.g), soft.b);
  float chroma = (mxc - mnc) / (mxc + 0.02);
  // Built-up surfaces (pavement, roofs, yards) are bright and grey; marsh and trees are not.
  float urban = smoothstep(0.10, 0.26, lum) * (1.0 - smoothstep(0.16, 0.34, chroma));
  vec3 dayLand = pow(sat, vec3(0.86)) * 1.22;
  float cell = 30.0;
  vec2 g = vWorld / cell;
  vec2 id = floor(g);
  vec2 jit = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
  float d = length((fract(g) - 0.5 - jit * 0.6) * cell);
  float rr = max(3.2, uMpp * 0.95);
  float lamp = exp(-d * d / (rr * rr)) * step(0.42, hash(id + 11.3)) * min(1.0, 9.0 / (rr * rr) + 0.35);
  vec3 lampCol = mix(vec3(1.0, 0.62, 0.28), vec3(0.95, 0.93, 0.85), step(0.72, hash(id + 5.5)));
  vec3 nightLand = sat * vec3(0.030, 0.042, 0.075)
                 + sat * urban * vec3(1.0, 0.70, 0.42) * 0.16
                 + lampCol * lamp * urban * 2.6;

  vec3 day = mix(dayLand, dayWater, water);
  vec3 night = mix(nightLand, nightWater, water);
  // Warm, low light around sunrise and sunset.
  float dusk = uNight * (1.0 - uNight) * 4.0;
  day *= mix(vec3(1.0), vec3(1.05, 0.86, 0.70), dusk * 0.6);
  gl_FragColor = vec4(mix(day, night, uNight), 1.0);
  #include <colorspace_fragment>
}`;

export class Ground {
  constructor(scene, renderer, shared) {
    this.scene = scene;
    this.shared = shared; // { uTime, uNight, uMpp, uSunDir }
    this.tiles = new Map();
    this.loader = new THREE.TextureLoader();
    this.loader.setCrossOrigin('anonymous');
    this.aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    this.geom = new THREE.PlaneGeometry(1, 1);
    this.geom.translate(0.5, 0.5, 0);
    const mask = this.loader.load('/watermask.png');
    mask.minFilter = THREE.LinearFilter;
    mask.magFilter = THREE.LinearFilter;
    mask.generateMipmaps = false;
    this.maskUniform = { value: mask };
    this.maskRect = { value: new THREE.Vector4(MASK_RECT.x, MASK_RECT.y, MASK_RECT.w, MASK_RECT.h) };
    this.failed = 0;
  }

  _request(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let t = this.tiles.get(key);
    if (t) return t;
    const n = 2 ** z;
    if (x < 0 || y < 0 || x >= n || y >= n) return null;
    t = { key, z, x, y, loaded: false, mesh: null, used: 0, rect: tileRect(z, x, y) };
    this.tiles.set(key, t);
    this.loader.load(
      TILE_URL(z, x, y),
      (tex) => {
        if (!this.tiles.has(key)) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.aniso;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        const mat = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          depthTest: false,
          depthWrite: false,
          uniforms: {
            uMap: { value: tex },
            uMask: this.maskUniform,
            uMaskRect: this.maskRect,
            uTime: this.shared.uTime,
            uNight: this.shared.uNight,
            uMpp: this.shared.uMpp,
            uSunDir: this.shared.uSunDir,
          },
        });
        const mesh = new THREE.Mesh(this.geom, mat);
        mesh.position.set(t.rect.x, t.rect.y, 0);
        mesh.scale.set(t.rect.size, t.rect.size, 1);
        mesh.renderOrder = -100 + z;
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.scene.add(mesh);
        t.mesh = mesh;
        t.tex = tex;
        t.loaded = true;
      },
      undefined,
      () => { this.failed++; t.error = true; setTimeout(() => { if (!t.loaded) this.tiles.delete(key); }, 15000); },
    );
    return t;
  }

  /** view: { x0, x1, y0, y1, mpp } in world metres and metres per device pixel. */
  update(view, frame) {
    const z = Math.max(MIN_Z, Math.min(MAX_Z, Math.ceil(Math.log2(WORLD_CIRC / (256 * view.mpp)) - 0.75)));
    const needed = new Set();
    const levels = [BASE_Z];
    if (z - 3 > BASE_Z) levels.push(z - 3); // a quick mid-resolution fill while the sharp tiles load
    if (z > BASE_Z) levels.push(z);
    for (const zz of levels) {
      const [tx0, ty0] = worldToTile(view.x0, view.y1, zz);
      const [tx1, ty1] = worldToTile(view.x1, view.y0, zz);
      const xa = Math.floor(tx0), xb = Math.floor(tx1), ya = Math.floor(ty0), yb = Math.floor(ty1);
      if ((xb - xa + 1) * (yb - ya + 1) > 400) continue;
      for (let x = xa; x <= xb; x++) for (let y = ya; y <= yb; y++) {
        const t = this._request(zz, x, y);
        if (t) { needed.add(t.key); t.used = frame; }
      }
    }
    for (const t of this.tiles.values()) {
      if (!t.loaded) continue;
      const r = t.rect;
      const inView = r.x < view.x1 && r.x + r.size > view.x0 && r.y < view.y1 && r.y + r.size > view.y0;
      let vis = false;
      if (inView) {
        if (t.z <= z) vis = true; // exact level, or coarser tiles underneath as a fallback
        else {
          // Finer tiles stay until the tile that replaces them has arrived.
          const s = t.z - z;
          const anc = this.tiles.get(`${z}/${t.x >> s}/${t.y >> s}`);
          vis = !(anc && anc.loaded);
        }
        if (vis) t.used = frame;
      }
      t.mesh.visible = vis;
    }
    if (this.tiles.size > MAX_CACHE) {
      const old = [...this.tiles.values()].filter((t) => t.used < frame - 30 && t.z !== BASE_Z).sort((a, b) => a.used - b.used);
      for (const t of old.slice(0, this.tiles.size - MAX_CACHE + 40)) {
        if (t.mesh) { this.scene.remove(t.mesh); t.mesh.material.dispose(); t.tex.dispose(); }
        this.tiles.delete(t.key);
      }
    }
  }
}

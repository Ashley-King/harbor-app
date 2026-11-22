import * as THREE from 'three';
import { tileBounds, tileSize, worldToTile } from '../geo.js';
import { clamp } from '../util.js';
import { makeWaveTexture } from './noise.js';

// USGS The National Map aerial imagery (NAIP orthophotos), public domain, no key.
const TILE_URL = (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`;
const BASE_Z = 14; // the mosaic shipped with the app
const MAX_Z = 16; // deepest level the USGS cache holds here
const MAX_TILES = 300;
const MAX_LOADS = 8;

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// One shader draws land and water, day and night.
//  Land: the aerial photo. By night it is dimmed to moonlight and then lit again
//        wherever the light map says there are lamps.
//  Water: redrawn from scratch (moving waves, sun glitter, reflections of shore
//        lights), tinted with the smoothed colour of the photographed water. This
//        is what removes the ships that were in the harbor when the photo was taken.
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform sampler2D uBase;
uniform sampler2D uMask;
uniform sampler2D uTint;
uniform sampler2D uLightMap;
uniform sampler2D uNoise;
uniform vec4 uBounds;      // west, south, 1/width, 1/height
uniform float uFade;       // 0 = base mosaic, 1 = this tile
uniform float uTime;
uniform float uNight;
uniform float uPixel;
uniform float uMoonAmbient;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uSkyColor;
uniform vec3 uDayGain;
uniform vec3 uBackdrop;
varying vec2 vUv;
varying vec3 vWorld;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 g = vec2((vWorld.x - uBounds.x) * uBounds.z, (-vWorld.z - uBounds.y) * uBounds.w);
  vec3 photo = texture2D(uMap, vUv).rgb;
  if (uFade < 1.0) photo = mix(texture2D(uBase, g).rgb, photo, uFade);
  vec3 mask = texture2D(uMask, g).rgb;
  vec3 tint = texture2D(uTint, g).rgb;
  vec3 lamp = texture2D(uLightMap, g).rgb;
  float shore = mask.b * 510.0;                       // metres of water between here and land

  // Inside a structure zone (pier, bridge, jetty, museum ship) the photo decides:
  // anything clearly brighter than the surrounding water is kept as structure.
  // (Judged on a slightly blurred copy of the photo, which keeps pier edges from fraying.)
  float lp = luma(texture2D(uMap, vUv, 1.6).rgb);
  float lt = luma(tint);
  float keep = smoothstep(0.25, 0.6, mask.g) * smoothstep(0.03, 0.09, lp - lt * 1.05);
  float water = smoothstep(0.38, 0.62, mask.r) * (1.0 - keep);

  // ---------------- land
  vec3 landDay = photo * uDayGain;
  float l = luma(photo);
  vec3 moonlit = mix(vec3(l), photo, 0.4) * vec3(0.42, 0.6, 1.0) * uMoonAmbient;
  // Lamp light with a soft shoulder, so overlapping pools do not flatten into daylight.
  vec3 lit = 1.0 - exp(-lamp * 1.9);
  vec3 landNight = moonlit + photo * lit * 0.74 + lit * 0.018;
  vec3 land = mix(landDay, landNight, uNight);

  vec3 col = land;
  if (water > 0.001) {
    // ---------------- water
    // Four wave layers of different size, each turned to a different angle so the
    // repeating texture never lines up with itself.
    vec2 p = vWorld.xz;
    const mat2 R1 = mat2(0.8, -0.6, 0.6, 0.8);
    const mat2 R2 = mat2(0.6, 0.8, -0.8, 0.6);
    const mat2 R3 = mat2(-0.28, 0.96, -0.96, -0.28);
    vec4 n1 = texture2D(uNoise, (R1 * p) / 331.0 + uTime * vec2(0.0031, 0.0017));
    vec4 n2 = texture2D(uNoise, (R2 * p) / 109.0 + uTime * vec2(-0.0062, 0.0041) + 0.37);
    vec4 n3 = texture2D(uNoise, (R3 * p) / 37.0 + uTime * vec2(0.0125, -0.0085) + 0.71);
    vec4 n4 = texture2D(uNoise, p / 11.5 + uTime * vec2(-0.019, 0.024) + 0.13);
    vec4 big = texture2D(uNoise, (R2 * p) / 3100.0 + uTime * vec2(0.0005, 0.0003));
    vec4 big2 = texture2D(uNoise, (R1 * p) / 870.0 - uTime * vec2(0.0011, 0.0007) + 0.5);
    float calm = mix(0.45, 1.0, smoothstep(10.0, 320.0, shore));
    vec2 slope = (((n1.rg - 0.5) * R1) * 0.55 + ((n2.rg - 0.5) * R2) * 0.8 + ((n3.rg - 0.5) * R3) * 0.7 + (n4.rg - 0.5) * 0.45) * 0.4 * calm;
    vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    float patches = 0.84 + 0.2 * big.b + 0.12 * big2.a;

    // day
    vec3 H = normalize(uSunDir + V);
    float nh = max(dot(N, H), 0.0);
    float glitter = pow(nh, 420.0) * 7.0 + pow(nh, 48.0) * 0.10;
    float facing = dot(N, uSunDir) - uSunDir.y;
    vec3 body = tint * patches * (1.0 + facing * 1.5);
    body = mix(body * vec3(1.06, 1.08, 1.0), body, smoothstep(0.0, 90.0, shore));   // paler shallows
    vec3 waterDay = body * uDayGain + uSkyColor * fres * 0.75 + uSunColor * glitter;

    // night: black water that picks up shore and deck lights as broken, moving glints
    vec2 wob = slope * 0.004;
    vec3 refl = texture2D(uLightMap, g + wob).rgb * 0.55 + texture2D(uLightMap, g - wob * 2.3).rgb * 0.45;
    refl = 1.0 - exp(-refl * 1.6);
    float glint = 0.16 + 0.95 * smoothstep(0.34, 0.9, n2.b * 0.5 + n3.b * 0.5) + 0.5 * smoothstep(0.55, 0.95, n3.b * 0.4 + n4.b * 0.6);
    vec3 Hm = normalize(uMoonDir + V);
    float moonGlint = pow(max(dot(N, Hm), 0.0), 260.0) * 2.4 + pow(max(dot(N, Hm), 0.0), 30.0) * 0.05;
    vec3 waterNight = tint * vec3(0.20, 0.34, 0.62) * uMoonAmbient * patches
                    + refl * refl * glint * 0.4
                    + uMoonColor * moonGlint * 0.5;

    col = mix(land, mix(waterDay, waterNight, uNight), water);
  }

  // Fade out to the backdrop at the edge of the imagery.
  vec2 e = min(g, 1.0 - g) / (uBounds.zw * 900.0);
  float edge = smoothstep(0.0, 1.0, min(e.x, e.y));
  col = mix(uBackdrop, col, edge);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function quadGeometry() {
  // Unit square on the ground: x 0..1 east, z 0..1 south, with north at the top of the image.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  return g;
}

function setupColorTexture(tex, renderer) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

/** Ground imagery: the shipped mosaic plus sharper tiles streamed in as you zoom. */
export class Ground {
  constructor(stage, env, assets, geo) {
    this.stage = stage;
    this.env = env;
    this.bounds = geo.base;
    this.group = new THREE.Group();
    stage.scene.add(this.group);
    this.geometry = quadGeometry();
    const r = stage.renderer;
    this.baseTex = setupColorTexture(assets.base, r);
    assets.mask.colorSpace = THREE.NoColorSpace;
    assets.mask.minFilter = THREE.LinearFilter;
    assets.mask.magFilter = THREE.LinearFilter;
    assets.mask.generateMipmaps = false;
    assets.tint.colorSpace = THREE.SRGBColorSpace;
    assets.tint.minFilter = assets.tint.magFilter = THREE.LinearFilter;
    assets.tint.generateMipmaps = false;
    const b = this.bounds;
    this.shared = {
      ...env.uniforms,
      uBase: { value: this.baseTex },
      uMask: { value: assets.mask },
      uTint: { value: assets.tint },
      uNoise: { value: makeWaveTexture() },
      uBounds: { value: new THREE.Vector4(b.west, b.south, 1 / (b.east - b.west), 1 / (b.north - b.south)) },
    };
    this.tiles = new Map();
    this.loading = 0;
    this.queue = [];
    this.lastPlan = 0;
    this.targetZ = BASE_Z;

    const base = this._mesh(this.baseTex, 1);
    base.position.set(b.west, 0, -b.north);
    base.scale.set(b.east - b.west, 1, b.north - b.south);
    base.renderOrder = -100;
    this.group.add(base);
  }

  _mesh(texture, fade) {
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...this.shared, uMap: { value: texture }, uFade: { value: fade } },
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = true;
    return mesh;
  }

  update(dt, nowMs) {
    for (const t of this.tiles.values()) {
      if (t.mesh && t.fade < 1) {
        t.fade = Math.min(1, t.fade + dt * 2.8);
        t.mesh.material.uniforms.uFade.value = t.fade;
      }
    }
    if (nowMs - this.lastPlan < 140) return;
    this.lastPlan = nowMs;
    this._plan(nowMs);
  }

  _plan(nowMs) {
    const stage = this.stage;
    const px = stage.mpp / stage.dpr; // metres per device pixel
    // Deepest level whose pixels are not much smaller than a screen pixel.
    const z = clamp(Math.ceil(Math.log2(tileSize(0) / (256 * px)) - 0.45), BASE_Z, MAX_Z);
    this.targetZ = z;
    const view = stage.viewRect(120);
    const b = this.bounds;
    const rect = { west: Math.max(view.west, b.west), east: Math.min(view.east, b.east), south: Math.max(view.south, b.south), north: Math.min(view.north, b.north) };
    const wanted = new Set();
    const want = [];
    if (rect.west < rect.east && rect.south < rect.north) {
      for (let level = BASE_Z + 1; level <= z; level++) {
        const a = worldToTile(rect.west, rect.north, level);
        const c = worldToTile(rect.east, rect.south, level);
        const x0 = Math.floor(a.tx), x1 = Math.floor(c.tx), y0 = Math.floor(a.ty), y1 = Math.floor(c.ty);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 260) continue;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const key = `${level}/${x}/${y}`;
            wanted.add(key);
            if (!this.tiles.has(key)) want.push({ key, z: level, x, y });
          }
        }
      }
    }
    for (const [key, t] of this.tiles) {
      const on = wanted.has(key);
      if (t.mesh) t.mesh.visible = on;
      if (on) t.seen = nowMs;
    }
    // Nearest the view centre first, coarser levels before finer ones.
    const cx = stage.center.x, cy = stage.center.y;
    want.sort((p, q) => p.z - q.z || this._dist(p, cx, cy) - this._dist(q, cx, cy));
    this.queue = want;
    this._pump();
    if (this.tiles.size > MAX_TILES) {
      const old = [...this.tiles.entries()].filter(([k, t]) => !wanted.has(k) && !t.pending).sort((p, q) => p[1].seen - q[1].seen);
      for (const [key, t] of old.slice(0, this.tiles.size - MAX_TILES)) {
        if (t.mesh) {
          this.group.remove(t.mesh);
          t.mesh.material.uniforms.uMap.value.dispose();
          t.mesh.material.dispose();
        }
        this.tiles.delete(key);
      }
    }
  }

  _dist(t, cx, cy) {
    const tb = tileBounds(t.z, t.x, t.y);
    return Math.abs((tb.west + tb.east) / 2 - cx) + Math.abs((tb.south + tb.north) / 2 - cy);
  }

  _pump() {
    while (this.loading < MAX_LOADS && this.queue.length) {
      const job = this.queue.shift();
      const known = this.tiles.get(job.key);
      if (known) continue;
      const rec = { pending: true, seen: performance.now(), fade: 0, mesh: null };
      this.tiles.set(job.key, rec);
      this.loading++;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      const done = () => {
        this.loading--;
        rec.pending = false;
        this._pump();
      };
      img.onload = () => {
        const ready = () => {
          const tex = setupColorTexture(new THREE.Texture(img), this.stage.renderer);
          tex.needsUpdate = true;
          const tb = tileBounds(job.z, job.x, job.y);
          const mesh = this._mesh(tex, 0);
          mesh.position.set(tb.west, 0, -tb.north);
          mesh.scale.set(tb.size, 1, tb.size);
          mesh.renderOrder = -100 + (job.z - BASE_Z);
          rec.mesh = mesh;
          this.group.add(mesh);
          done();
        };
        if (img.decode) img.decode().then(ready, ready);
        else ready();
      };
      img.onerror = () => {
        // Leave the coarser imagery in place and try this tile again in a minute.
        setTimeout(() => this.tiles.get(job.key) === rec && !rec.mesh && this.tiles.delete(job.key), 60000);
        done();
      };
      img.src = TILE_URL(job.z, job.x, job.y);
    }
  }
}

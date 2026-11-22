import * as THREE from 'three';
import { rng } from '../util.js';

// Every lamp is a small flat sprite on the ground (the camera looks straight down,
// so a ground-aligned quad is also screen-aligned). The same lamp list is drawn
// twice: once as visible points of light, and once, much larger and softer, into
// a "light map" that the ground shader uses to light the photo around each lamp.

const GLOW_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aSize;
attribute vec2 aPool;
attribute vec3 aBlink;      // period s, phase 0..1, duty 0..1 (period 0 = steady)
uniform float uTime;
uniform float uPixel;       // metres per device pixel
uniform float uMinPx;
uniform float uPoolPass;
varying vec2 vCorner;
varying vec3 vColor;
void main() {
  float on = 1.0;
  if (aBlink.x > 0.0) on = step(fract(uTime / aBlink.x + aBlink.y), aBlink.z);
  float r = aSize;
  float gain = 1.0;
  if (uPoolPass > 0.5) {
    r = aPool.x;
    gain = aPool.y;
    on = aBlink.x > 0.0 ? 0.0 : 1.0;
  } else {
    // Keep distant lamps visible as pin-points, dimmed so a city does not turn into a blob.
    float minR = uMinPx * uPixel * 0.5;
    if (r < minR) {
      gain = pow(r / minR, 1.1);
      r = minR;
    }
  }
  vCorner = position.xz;
  vColor = aColor * gain * on;
  vec3 world = aPos + vec3(position.x * r, 0.0, position.z * r);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const GLOW_FRAG = /* glsl */ `
precision highp float;
uniform float uStrength;
uniform float uPoolPass;
varying vec2 vCorner;
varying vec3 vColor;
void main() {
  float d = length(vCorner);
  if (d > 1.0) discard;
  float a;
  if (uPoolPass > 0.5) {
    a = exp(-d * d * 4.2) - 0.015;                           // soft pool of light on the ground
  } else {
    a = exp(-d * d * 9.0) + 0.22 * pow(1.0 - d, 2.0);         // hot core with a soft halo
  }
  gl_FragColor = vec4(vColor * a * uStrength, 1.0);
}`;

function quad() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1]), 3));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  return g;
}

/** A batch of lamps. */
export class LightField {
  constructor(capacity, shared, { dynamic = false, minPx = 2.2 } = {}) {
    this.capacity = capacity;
    this.count = 0;
    const g = quad();
    const usage = dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage;
    const attr = (name, n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(usage);
      g.setAttribute(name, a);
      return a;
    };
    this.aPos = attr('aPos', 3);
    this.aColor = attr('aColor', 3);
    this.aSize = attr('aSize', 1);
    this.aPool = attr('aPool', 2);
    this.aBlink = attr('aBlink', 3);
    g.instanceCount = 0;
    this.geometry = g;
    this.uniforms = { uTime: shared.uTime, uPixel: shared.uPixel, uMinPx: { value: minPx }, uStrength: { value: 0 }, uPoolPass: { value: 0 } };
    this.material = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: this.uniforms,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  /** x east, y north, h height above water (metres). */
  add(x, y, h, color, intensity, size, pool = 0, poolGain = 0, blink = null) {
    const i = this.count;
    if (i >= this.capacity) return -1;
    this.aPos.setXYZ(i, x, h, -y);
    this.aColor.setXYZ(i, color[0] * intensity, color[1] * intensity, color[2] * intensity);
    this.aSize.setX(i, size);
    this.aPool.setXY(i, pool, poolGain);
    this.aBlink.setXYZ(i, blink ? blink[0] : 0, blink ? blink[1] : 0, blink ? blink[2] : 0);
    this.count = i + 1;
    return i;
  }

  reset() {
    this.count = 0;
  }

  commit() {
    this.geometry.instanceCount = this.count;
    for (const a of [this.aPos, this.aColor, this.aSize, this.aPool, this.aBlink]) a.needsUpdate = true;
  }
}

// Lamp looks by kind: colour, brightness, glow radius (m), pool radius (m), pool strength.
const SODIUM = [1.0, 0.66, 0.36];
const WARM = [1.0, 0.8, 0.55];
const NEUTRAL = [1.0, 0.92, 0.78];
const COOL = [0.84, 0.92, 1.0];
const KINDS = [
  { c: SODIUM, i: 1.25, r: 4.4, pool: 46, pg: 0.34 }, // residential street
  { c: WARM, i: 1.5, r: 5.2, pool: 58, pg: 0.46 }, // main road
  { c: NEUTRAL, i: 1.7, r: 5.6, pool: 66, pg: 0.5 }, // highway
  { c: NEUTRAL, i: 2.4, r: 6.5, pool: 100, pg: 0.5 }, // container terminal high mast
  { c: NEUTRAL, i: 1.8, r: 5.2, pool: 56, pg: 0.55 }, // bridge roadway
  { c: WARM, i: 1.7, r: 5.5, pool: 86, pg: 0.36 }, // industrial yard
  { c: COOL, i: 1.1, r: 3, pool: 30, pg: 0.22 }, // pier or dock
];
export const RED = [1.0, 0.07, 0.04];
export const GREEN = [0.08, 1.0, 0.32];
export const WHITE = [1.0, 0.97, 0.9];

/** All fixed lights: streets, terminals, docks, bridges, cranes, buoys. */
export function buildCityLights(bin, harbor, shared) {
  const data = new Int16Array(bin);
  const n = Math.floor(data.length / 3);
  const field = new LightField(n + 2400, shared, { minPx: 2.0 });
  const rand = rng(41);
  for (let i = 0; i < n; i++) {
    const k = KINDS[data[i * 3 + 2]] || KINDS[0];
    // A little variety: older sodium lamps next to newer white ones, some dimmer.
    const mix = rand();
    const c = data[i * 3 + 2] <= 1 && mix > 0.72 ? NEUTRAL : k.c;
    const dim = 0.7 + 0.5 * rand();
    field.add(data[i * 3] / 2, data[i * 3 + 1] / 2, 6, c, k.i * dim, k.r, k.pool, k.pg * dim);
  }

  // ---- ship-to-shore cranes: floodlights along the boom, a red beacon on top
  for (const cr of harbor.cranes) {
    const [x, y] = cr.at;
    const [ox, oy] = cr.out;
    for (const d of [-28, -8, 14, 34, 54]) field.add(x + ox * d, y + oy * d, 52, WHITE, 1.7, 3.6, d > 0 ? 46 : 60, 0.3);
    field.add(x - ox * 6, y - oy * 6, 81, RED, 2.2, 3.4, 0, 0, [2.4, rand(), 0.5]);
  }

  // ---- bridges
  for (const b of harbor.bridges) {
    const [t1, t2] = b.towers;
    const ax = t2[0] - t1[0], ay = t2[1] - t1[1];
    const len = Math.hypot(ax, ay);
    const ux = ax / len, uy = ay / len;
    const nx = -uy, ny = ux;
    for (const t of b.towers) {
      if (b.style === 'cable') {
        // The Ravenel's two diamond towers are floodlit white.
        for (const s of [-1, 1]) {
          field.add(t[0] + nx * 22 * s, t[1] + ny * 22 * s, 8, WHITE, 2.2, 18, 120, 0.6);
          field.add(t[0] + nx * 9 * s, t[1] + ny * 9 * s, 12, RED, 2.6, 7, 0, 0, [1.6, 0.0, 0.45]);
        }
        // Stay cables catch the light near each tower.
        for (const d of [-150, -100, -55, 55, 100, 150]) {
          for (const s of [-1, 1]) field.add(t[0] + ux * d + nx * 17 * s, t[1] + uy * d + ny * 17 * s, 8, COOL, 0.9, 7, 40, 0.3);
        }
      } else {
        for (const s of [-1, 1]) field.add(t[0] + nx * 8 * s, t[1] + ny * 8 * s, 10, RED, 2.4, 6.5, 0, 0, [1.8, 0.3, 0.5]);
      }
      // Red lights mark the edges of the navigation span.
      for (const s of [-1, 1]) field.add(t[0] + nx * 20 * s + ux * (t === t1 ? 14 : -14), t[1] + ny * 20 * s + uy * (t === t1 ? 14 : -14), 4, RED, 1.7, 5, 26, 0.25);
    }
    // Green lights mark the centre of the span, the best water.
    for (const s of [-1, 1]) field.add(b.span[0] + nx * 19 * s, b.span[1] + ny * 19 * s, 4, GREEN, 1.9, 5.5, 26, 0.22);
    if (b.style === 'truss') {
      for (let d = 20; d < len; d += 34) for (const s of [-1, 1]) field.add(t1[0] + ux * d + nx * 14 * s, t1[1] + uy * d + ny * 14 * s, 8, NEUTRAL, 1.1, 7.5, 40, 0.55);
    }
  }

  // ---- lit buoys and beacons flash their charted colour
  harbor.aids.forEach((a, i) => {
    const c = a.c === 'r' ? RED : a.c === 'g' ? GREEN : a.c === 'y' ? [1, 0.8, 0.1] : WHITE;
    const period = [4, 2.5, 6, 4][i % 4];
    field.add(a.at[0], a.at[1], 3, c, 1.9, 4.6, 0, 0, [period, rand(), period === 2.5 ? 0.2 : 0.14]);
  });

  field.commit();
  return field;
}

/** Draw every lamp's pool of light into one texture covering the whole map. */
export function renderLightMap(renderer, field, bounds) {
  const width = Math.min(3072, renderer.capabilities.maxTextureSize);
  const height = Math.round((width * (bounds.north - bounds.south)) / (bounds.east - bounds.west));
  const rt = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  rt.texture.generateMipmaps = false;
  const cam = new THREE.OrthographicCamera(bounds.west, bounds.east, bounds.north, bounds.south, 1, 1000);
  cam.position.set(0, 500, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  // With the camera at the origin looking down and north up, x maps east and -z maps north.
  cam.left = bounds.west;
  cam.right = bounds.east;
  cam.top = bounds.north;
  cam.bottom = bounds.south;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const scene = new THREE.Scene();
  const u = field.uniforms;
  const keep = { strength: u.uStrength.value, pool: u.uPoolPass.value, depth: field.material.depthTest };
  const parent = field.mesh.parent;
  scene.add(field.mesh);
  u.uStrength.value = 1;
  u.uPoolPass.value = 1;
  field.material.depthTest = false;
  const prev = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  renderer.setClearColor(prevColor, prevAlpha);
  u.uStrength.value = keep.strength;
  u.uPoolPass.value = keep.pool;
  field.material.depthTest = keep.depth;
  if (parent) parent.add(field.mesh);
  return rt;
}

// Additive point lights (navigation lights, bridge and terminal lighting, buoys).
// Sizes are in metres with a minimum on-screen size so lights stay visible when
// the whole harbor is in view.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 color;
attribute vec4 aParams; // size (m), min size (css px), flash period (s, 0 = steady), flash phase
attribute float aIntensity;
uniform float uPxPerM, uDpr, uTime, uGain;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aParams.x * uPxPerM;
  float minPx = aParams.y * uDpr;
  float size = max(px, minPx);
  float on = 1.0;
  if (aParams.z > 0.0) on = smoothstep(0.0, 0.04, fract(uTime / aParams.z + aParams.w)) * (1.0 - smoothstep(0.26, 0.32, fract(uTime / aParams.z + aParams.w)));
  // When a light is smaller than its minimum size, keep its energy sensible.
  float comp = clamp(px / minPx, 0.35, 1.0);
  vColor = color * aIntensity * on * uGain * mix(0.6, 1.0, comp);
  gl_PointSize = size;
}`;
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 22.0);
  float halo = exp(-d * d * 4.5) * 0.28 * (1.0 - d);
  gl_FragColor = vec4(vColor * (core * 1.6 + halo), 1.0);
}`;

export class LightField {
  constructor(scene, capacity, shared, dynamic = false) {
    this.cap = capacity;
    this.n = 0;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.par = new Float32Array(capacity * 4);
    this.int = new Float32Array(capacity);
    const g = new THREE.BufferGeometry();
    const usage = dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(usage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(usage));
    g.setAttribute('aParams', new THREE.BufferAttribute(this.par, 4).setUsage(usage));
    g.setAttribute('aIntensity', new THREE.BufferAttribute(this.int, 1).setUsage(usage));
    this.geom = g;
    this.gain = { value: 1 };
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPxPerM: shared.uPxPerM, uDpr: shared.uDpr, uTime: shared.uTime, uGain: this.gain },
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    scene.add(this.points);
  }
  reset() { this.n = 0; }
  add(x, y, z, c, size, intensity, minPx = 2.2, period = 0, phase = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    this.par[i * 4] = size; this.par[i * 4 + 1] = minPx; this.par[i * 4 + 2] = period; this.par[i * 4 + 3] = phase;
    this.int[i] = intensity;
  }
  commit() {
    this.geom.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'aParams', 'aIntensity']) this.geom.attributes[k].needsUpdate = true;
  }
}

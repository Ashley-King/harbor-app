import * as THREE from 'three';
import { rng } from '../util.js';

/**
 * A seamless wave texture built from a few dozen sine waves with whole-number
 * frequencies, so it tiles exactly. R,G hold the surface slope, B the height and
 * A a second, unrelated pattern used for foam and patchiness.
 */
export function makeWaveTexture(size = 256) {
  const rand = rng(1670);
  const waves = [];
  for (let i = 0; i < 34; i++) {
    const k = 2 + Math.floor(rand() ** 1.6 * 26);
    const ang = rand() * Math.PI * 2;
    const kx = Math.round(Math.cos(ang) * k);
    const ky = Math.round(Math.sin(ang) * k);
    const len = Math.hypot(kx, ky) || 1;
    waves.push({ kx, ky, amp: 1 / len ** 1.15, ph: rand() * Math.PI * 2 });
  }
  const waves2 = waves.map((w) => ({ ...w, ph: rand() * Math.PI * 2, kx: w.ky, ky: -w.kx }));
  const h = new Float32Array(size * size);
  const sx = new Float32Array(size * size);
  const sy = new Float32Array(size * size);
  const h2 = new Float32Array(size * size);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let a = 0, dx = 0, dy = 0, b = 0;
      for (const w of waves) {
        const p = TAU * (w.kx * u + w.ky * v) + w.ph;
        const c = Math.cos(p);
        // Sharpen the crests a little: real wind waves are peaked, not sinusoidal.
        a += w.amp * (c + 0.25 * Math.cos(2 * p));
        const d = -w.amp * (Math.sin(p) + 0.5 * Math.sin(2 * p));
        dx += d * w.kx;
        dy += d * w.ky;
      }
      for (const w of waves2) b += w.amp * Math.cos(TAU * (w.kx * u + w.ky * v) + w.ph);
      const i = y * size + x;
      h[i] = a;
      sx[i] = dx;
      sy[i] = dy;
      h2[i] = b;
    }
  }
  const norm = (arr) => {
    let max = 0;
    for (const v of arr) max = Math.max(max, Math.abs(v));
    return max || 1;
  };
  const nh = norm(h), ns = Math.max(norm(sx), norm(sy)), nh2 = norm(h2);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round((sx[i] / ns) * 127 + 128);
    data[i * 4 + 1] = Math.round((sy[i] / ns) * 127 + 128);
    data[i * 4 + 2] = Math.round((h[i] / nh) * 127 + 128);
    data[i * 4 + 3] = Math.round((h2[i] / nh2) * 127 + 128);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

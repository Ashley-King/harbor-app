// Animated sun/moon glints on the water, drawn into a tileable pattern that MapLibre
// repeats over the OpenStreetMap water polygons.
const N = 128;
const WAVES = [
  [3, 5, 0.5], [7, -2, 0.45], [-5, 8, 0.4], [11, 4, 0.3], [-9, -12, 0.28], [15, -7, 0.22], [-17, 9, 0.18], [21, 13, 0.14],
].map(([kx, ky, a], i) => ({ kx, ky, a, ph: i * 1.93, w: Math.sqrt(Math.hypot(kx, ky)) * 0.85 }));

export function makeWater(map) {
  const data = new Uint8ClampedArray(N * N * 4);
  const image = { width: N, height: N, data };
  map.addImage('water-glint', image, { pixelRatio: 1 });
  let night = true;
  let sun = [0.3, -0.5, 0.8];
  let last = 0;

  function draw(t) {
    const hx = sun[0] * 0.6, hy = sun[1] * 0.6, hz = 1;
    const hl = Math.hypot(hx, hy, hz);
    const H = [hx / hl, hy / hl, hz / hl];
    const tint = night ? [170, 195, 235] : [255, 252, 240];
    const gain = night ? 0.16 : 0.55;
    const sharp = night ? 160 : 260;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let gx = 0, gy = 0;
        for (const w of WAVES) {
          const k = (2 * Math.PI) / N;
          const c = Math.cos(k * (w.kx * x + w.ky * y) + w.ph - w.w * t) * w.a;
          gx += c * w.kx * 0.035;
          gy += c * w.ky * 0.035;
        }
        const nl = Math.hypot(gx, gy, 1);
        const d = Math.max(0, (-gx * H[0] - gy * H[1] + H[2]) / nl);
        const spec = Math.pow(d, sharp) * gain;
        const ripple = Math.max(0, gx + gy) * (night ? 0.015 : 0.05);
        const a = Math.min(1, spec + ripple);
        const i = (y * N + x) * 4;
        data[i] = tint[0]; data[i + 1] = tint[1]; data[i + 2] = tint[2]; data[i + 3] = a * 255;
      }
    }
  }

  function tick(ts) {
    if (ts - last > 90) {
      last = ts;
      draw(ts / 1000);
      map.updateImage('water-glint', image);
    }
    requestAnimationFrame(tick);
  }
  draw(0);
  map.updateImage('water-glint', image);
  requestAnimationFrame(tick);

  return {
    set(nightMode, sunDir) {
      night = nightMode;
      if (sunDir) sun = [sunDir.x, -sunDir.y, Math.max(0.2, sunDir.z)];
    },
  };
}

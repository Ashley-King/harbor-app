import * as THREE from 'three';
import { Builder } from '../ships/builder.js';
import { LightField, RED, GREEN, WHITE } from './lights.js';
import { rng } from '../util.js';

// Buoys, beacons and their lights, from the NOAA chart data in public/data/chart.json.
// Every mark is modelled at its real size, so it is a speck from high up and a buoy
// when you zoom in. Every light flashes its charted colour and sequence.

const PAINT = { r: 0xb3261e, g: 0x1c7a3e, y: 0xd9a400, w: 0xe6e8e6 };
const GLOW = { r: RED, g: GREEN, y: [1.0, 0.8, 0.1], w: WHITE };
const STEEL = 0x8a9299;
const TIMBER = 0x5a4a3a;

function addMark(b, x, y, colour, shape, yaw) {
  const z = -y;
  const paint = PAINT[colour] || PAINT.w;
  if (shape === 'c') {
    // can buoy: a plain cylinder
    b.cyl(x, z, -0.3, 1.7, 0.9, paint, { seg: 12 });
  } else if (shape === 'n') {
    // nun buoy: a cylinder with a cone top
    b.cyl(x, z, -0.3, 0.8, 0.9, paint, { seg: 12 });
    b.cyl(x, z, 0.8, 2.1, 0.9, paint, { seg: 12, r1: 0.15 });
  } else if (shape === 'k') {
    // beacon: a timber pile with a painted dayboard
    b.cyl(x, z, -0.5, 4.6, 0.28, TIMBER, { seg: 8 });
    b.box(x, 4.0, z, 1.3, 1.3, 0.16, paint, { yaw });
  } else {
    // lighted pillar buoy: a wide float, a steel cage and the lantern
    b.cyl(x, z, -0.3, 0.9, 1.35, paint, { seg: 14 });
    b.cyl(x, z, 0.9, 3.9, 0.55, paint, { seg: 8, r1: 0.32 });
    b.cyl(x, z, 3.9, 4.4, 0.22, STEEL, { seg: 8, top: 0xdfe6ea });
  }
}

/** Returns { setVisible(on), update(night) }. */
export function buildAids(scene, chart, shared, glowUniform) {
  const rand = rng(77);

  // ---- the marks themselves
  const b = new Builder();
  for (const [x, y, colour, shape] of chart.marks) addMark(b, x, y, colour, shape, rand() * Math.PI);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glowUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow * 0.3;');
  };
  const marks = new THREE.Mesh(b.build(), material);
  marks.castShadow = true;
  marks.receiveShadow = true;
  marks.frustumCulled = false;
  scene.add(marks);

  // ---- their lights
  // The lamp shader lights one stretch of each period. A light that flashes more than
  // once a period (a group flash) is one lamp per flash, each with its own offset.
  const flashes = chart.lights.reduce((n, l) => n + Math.max(1, l[5].filter((s) => s > 0).length), 0);
  const field = new LightField(flashes, shared, { minPx: 7 });
  for (const [x, y, colour, range, height, seq] of chart.lights) {
    const c = GLOW[colour] || WHITE;
    // A light charted to carry further is drawn larger and brighter.
    // The glow is larger than the lantern so that a flash can be seen from high up.
    const size = 9 + Math.min(range, 22) * 0.6;
    const power = range >= 10 ? 7 : 5;
    const h = Math.max(3, height);
    const period = seq.reduce((sum, s) => sum + Math.abs(s), 0);
    if (!period) {
      field.add(x, y, h, c, power, size);
      continue;
    }
    // Lights are not synchronised with each other, so each starts at its own moment.
    const start = rand() * period;
    let t = 0;
    for (const s of seq) {
      if (s > 0) field.add(x, y, h, c, power, size, 0, 0, [period, (((start - t) / period) % 1 + 1) % 1, s / period]);
      t += Math.abs(s);
    }
  }
  field.commit();
  field.mesh.renderOrder = 21;
  scene.add(field.mesh);

  let visible = true;
  return {
    setVisible(on) {
      visible = on;
      marks.visible = on;
      field.mesh.visible = on;
    },
    update(night) {
      field.uniforms.uStrength.value = visible ? night : 0;
    },
  };
}

import * as THREE from 'three';
import { Builder } from '../ships/builder.js';

// Ship-to-shore gantry crane, boom lowered over the berth. Local frame: +X points
// out over the water, origin on the wharf face, sizes in metres (a modern
// neo-Panamax crane: 30 m rail gauge, about 65 m outreach, 50 m under the boom).
function craneGeometry() {
  const b = new Builder();
  const body = 0xc3ccd3, dark = 0x3d4a57, house = 0xe9ecee;
  const railW = -5, railL = -35;                       // waterside and landside rails
  for (const x of [railW, railL]) {
    for (const z of [-9, 9]) b.on(x, z, 0, 2.0, 50, 2.0, body);
    b.on(x, 0, 11, 1.6, 2.2, 18, body);                 // sill beam
    b.on(x, 0, 48, 1.8, 2.4, 20, body);                 // portal beam
    for (const z of [-9, 9]) b.on(x, z, 0, 5.5, 1.6, 2.6, dark);   // bogies
  }
  for (const z of [-9, 9]) b.on((railW + railL) / 2, z, 46, railW - railL, 2.2, 1.6, body);
  // boom and trolley girder, backreach to outreach
  for (const z of [-3.4, 3.4]) b.on(3, z, 50.5, 124, 2.6, 1.5, body);
  for (let x = -56; x <= 64; x += 10) b.on(x, 0, 51, 0.9, 1.2, 8.2, body);
  b.on(-44, 0, 53, 20, 6.5, 8.5, house, { top: 0xd3d8dc });    // machinery house
  // A-frame and stays
  for (const z of [-3.4, 3.4]) {
    b.on(railW, z, 53, 1.3, 27, 1.3, body);
    b.on((railW - 44) / 2, z, 66.5, 46, 1.1, 1.1, body, { pitch: 0.6 });
    b.on(railW + 20, z, 66.5, 48, 0.6, 0.6, dark, { pitch: -0.6 });
    b.on(railW + 33, z, 66.5, 71, 0.5, 0.5, dark, { pitch: -0.39 });
  }
  b.on(railW, 0, 79.5, 1.6, 1.4, 9, body);
  // trolley, operator cab and spreader
  b.on(24, 0, 47.5, 7, 2.6, 8.4, dark);
  b.on(19, 3.2, 44.5, 3.4, 3.0, 2.6, house, { glow: 0.6 });
  b.on(24, 0, 30, 12.6, 1.0, 2.6, 0xd9b326);
  return b.build();
}

/** The 3D cranes on the container wharves. They cast real shadows by day. */
export function buildCranes(scene, harbor, glowUniform) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glowUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow * (0.26 + vGlow * 2.0);');
  };
  const mesh = new THREE.InstancedMesh(craneGeometry(), material, harbor.cranes.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  harbor.cranes.forEach((c, i) => {
    q.setFromAxisAngle(up, Math.atan2(c.out[1], c.out[0]));
    m.compose(new THREE.Vector3(c.at[0], 0, -c.at[1]), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

const LINE_VERT = /* glsl */ `
attribute vec2 aNormal;
attribute float aSide;
attribute float aDist;
uniform float uPixel;       // metres per device pixel
uniform float uWidth;       // line width in device pixels
varying float vDist;
varying float vSide;
void main() {
  vDist = aDist / uPixel;
  vSide = aSide;
  vec3 p = position + vec3(aNormal.x, 0.0, aNormal.y) * aSide * uWidth * 0.5 * uPixel;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const LINE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uDash;        // dash period in device pixels
varying float vDist;
varying float vSide;
void main() {
  float dash = smoothstep(0.0, 0.08, fract(vDist / uDash)) * smoothstep(0.62, 0.54, fract(vDist / uDash));
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(vSide));
  gl_FragColor = vec4(uColor, uOpacity * dash * edge);
}`;

/**
 * The federal shipping channel: a faint tint over the dredged reaches and a dashed
 * outline, drawn at a constant width on screen like a chart overlay.
 */
export function buildChannel(scene, harbor, shared) {
  const group = new THREE.Group();
  // ---- tint
  const pos = [];
  const idx = [];
  let n = 0;
  for (const r of harbor.channel) {
    const contour = r.ring.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const p of r.ring) pos.push(p[0], 0.02, -p[1]);
    for (const t of tris) idx.push(n + t[0], n + t[1], n + t[2]);
    n += r.ring.length;
  }
  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fillGeo.setIndex(idx);
  const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: 0x0a3a66, transparent: true, opacity: 0.1, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  fill.renderOrder = -20;
  fill.frustumCulled = false;
  group.add(fill);

  // ---- dashed outline as thin ribbons
  const lp = [], ln = [], ls = [], ld = [], li = [];
  let v = 0;
  for (const r of harbor.channel) {
    for (const line of r.lines) {
      let dist = 0;
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 0.5) continue;
        const nx = -dy / len, ny = dx / len;
        for (const [p, d] of [[a, dist], [b, dist + len]]) {
          for (const side of [-1, 1]) {
            lp.push(p[0], 0.04, -p[1]);
            ln.push(nx, -ny);
            ls.push(side);
            ld.push(d);
          }
        }
        li.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        v += 4;
        dist += len;
      }
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lineGeo.setAttribute('aNormal', new THREE.Float32BufferAttribute(ln, 2));
  lineGeo.setAttribute('aSide', new THREE.Float32BufferAttribute(ls, 1));
  lineGeo.setAttribute('aDist', new THREE.Float32BufferAttribute(ld, 1));
  lineGeo.setIndex(li);
  const uniforms = { uPixel: shared.uPixel, uWidth: { value: 2.4 }, uDash: { value: 16 }, uColor: { value: new THREE.Color(0xdfeefa) }, uOpacity: { value: 0.55 } };
  const lines = new THREE.Mesh(lineGeo, new THREE.ShaderMaterial({ vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, uniforms, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  lines.renderOrder = -19;
  lines.frustumCulled = false;
  group.add(lines);
  scene.add(group);
  return {
    group,
    /** night 0..1, dpr for a constant on-screen width. */
    update(night, dpr) {
      fill.material.opacity = 0.075 - 0.03 * night;
      fill.material.color.setHex(night > 0.5 ? 0x2a6aa8 : 0x0a3a66);
      uniforms.uOpacity.value = 0.6 - 0.2 * night;
      uniforms.uWidth.value = 1.3 * dpr + 0.6;
      uniforms.uDash.value = 15 * dpr;
    },
  };
}

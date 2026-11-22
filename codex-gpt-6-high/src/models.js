import * as THREE from "three";
const palette = [
  "#8c4840",
  "#557584",
  "#b9ad7b",
  "#54786c",
  "#a4724a",
  "#8b9290",
];
const material = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.26,
    ...extra,
  });
const sharedGeometry = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 10, 8),
};
function box(group, x, y, z, w, l, h, color) {
  const m = new THREE.Mesh(sharedGeometry.box, material(color));
  m.position.set(x, y, z);
  m.scale.set(w, l, h);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}
function light(group, x, y, z, color, radius) {
  const m = new THREE.Mesh(
    sharedGeometry.sphere,
    new THREE.MeshBasicMaterial({ color }),
  );
  m.position.set(x, y, z);
  m.scale.setScalar(radius);
  m.userData.light = true;
  group.add(m);
}
function pipe(group, a, b, radius, color = "#c7c4af") {
  const start = new THREE.Vector3(...a),
    end = new THREE.Vector3(...b);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 7),
    material(color),
  );
  mesh.position.copy(start.clone().add(end).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    end.sub(start).normalize(),
  );
  group.add(mesh);
}
export function createShip(vessel) {
  const group = new THREE.Group();
  const L = vessel.length,
    B = vessel.beam;
  if (!L || !B || vessel.dimensionsSuspect) return group;
  const H = Math.max(2.5, Math.min(15, L * 0.035));
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-B * 0.4, -L * 0.48);
  hullShape.lineTo(B * 0.4, -L * 0.48);
  hullShape.quadraticCurveTo(B * 0.5, -L * 0.45, B * 0.5, -L * 0.3);
  hullShape.lineTo(B * 0.5, L * 0.28);
  hullShape.quadraticCurveTo(B * 0.43, L * 0.41, 0, L * 0.5);
  hullShape.quadraticCurveTo(-B * 0.43, L * 0.41, -B * 0.5, L * 0.28);
  hullShape.lineTo(-B * 0.5, -L * 0.3);
  hullShape.quadraticCurveTo(-B * 0.5, -L * 0.45, -B * 0.4, -L * 0.48);
  const hull = new THREE.Mesh(
    new THREE.ExtrudeGeometry(hullShape, {
      depth: H,
      bevelEnabled: true,
      bevelSize: Math.min(1, B * 0.02),
      bevelThickness: 0.6,
      bevelSegments: 2,
      steps: 1,
      curveSegments: 12,
    }),
    material(
      vessel.model === "cruise" || vessel.model === "passenger"
        ? "#e4e4da"
        : "#263c48",
    ),
  );
  hull.castShadow = true;
  group.add(hull);
  const deck = new THREE.Mesh(
    new THREE.ShapeGeometry(hullShape),
    material("#90968a"),
  );
  deck.position.z = H + 0.7;
  group.add(deck);
  const type = vessel.model;
  if (type === "container") {
    const rows = Math.max(1, Math.floor(B / 3.2) - 1),
      bays = Math.max(1, Math.floor((L * 0.67) / 13));
    const geo = sharedGeometry.box;
    const blocks = new THREE.InstancedMesh(
      geo,
      material("#ffffff"),
      rows * bays,
    );
    const matrix = new THREE.Matrix4();
    let i = 0;
    for (let bay = 0; bay < bays; bay++)
      for (let row = 0; row < rows; row++) {
        const tiers = 3 + ((bay * 7 + row * 11) % 4);
        matrix.makeScale(((B * 0.88) / rows) * 0.94, 11.8, 2.6 * tiers);
        matrix.setPosition(
          ((row - (rows - 1) / 2) * (B * 0.88)) / rows,
          (bay - (bays - 1) / 2) * 13 + L * 0.07,
          H + (2.6 * tiers) / 2,
        );
        blocks.setMatrixAt(i, matrix);
        blocks.setColorAt(
          i,
          new THREE.Color(palette[(bay * 3 + row * 7) % palette.length]),
        );
        i++;
      }
    group.add(blocks);
  } else if (type === "tanker") {
    box(group, 0, 0, H + 1.6, B * 0.55, L * 0.64, 2, "#a2473c");
    for (const x of [-0.25, -0.12, 0.12, 0.25])
      pipe(
        group,
        [B * x, -L * 0.28, H + 3.4],
        [B * x, L * 0.33, H + 3.4],
        Math.max(0.16, B * 0.009),
      );
    for (let i = 0; i < 5; i++) {
      const y = (i - 2) * L * 0.12;
      pipe(group, [-B * 0.4, y, H + 3.5], [B * 0.4, y, H + 3.5], B * 0.009);
      for (const x of [-0.3, 0.3]) {
        const cap = new THREE.Mesh(
          new THREE.CylinderGeometry(B * 0.065, B * 0.065, 1.1, 12),
          material("#a8a899"),
        );
        cap.rotation.x = Math.PI / 2;
        cap.position.set(B * x, y, H + 2.7);
        group.add(cap);
      }
    }
  } else if (type === "roro") {
    box(
      group,
      0,
      -L * 0.01,
      H + L * 0.042,
      B * 0.92,
      L * 0.81,
      L * 0.084,
      "#e5e4d9",
    );
    for (let i = 0; i < 5; i++)
      box(
        group,
        0,
        (i - 2) * L * 0.12,
        H + L * 0.085,
        B * 0.82,
        0.5,
        0.25,
        "#b7b7aa",
      );
    box(
      group,
      0,
      L * 0.28,
      H + L * 0.092,
      B * 0.9,
      L * 0.07,
      L * 0.025,
      "#f0efde",
    );
  } else if (type === "cruise" || type === "passenger") {
    for (let i = 0; i < 4; i++) {
      box(
        group,
        0,
        -L * 0.025,
        H + 2 + i * 3,
        B * (0.87 - i * 0.1),
        L * (0.78 - i * 0.07),
        2.8,
        "#edeee6",
      );
      for (const x of [-1, 1])
        box(
          group,
          x * B * (0.43 - i * 0.05),
          -L * 0.025,
          H + 2 + i * 3,
          0.35,
          L * (0.7 - i * 0.07),
          1,
          "#78979c",
        );
    }
    if (L > 120) {
      box(group, 0, L * 0.11, H + 13, B * 0.28, L * 0.11, 0.3, "#43b7c3");
      box(group, 0, -L * 0.18, H + 14, B * 0.24, L * 0.07, 2, "#303c3c");
    }
  } else if (type === "tug" || type === "pilot") {
    box(group, 0, L * 0.04, H + 2, B * 0.65, L * 0.43, 4, "#e7e2cc");
    box(group, 0, L * 0.09, H + 4.7, B * 0.61, L * 0.23, 1.5, "#718b8e");
    box(group, 0, -L * 0.25, H + 1, B * 0.68, L * 0.14, 1.5, "#9c642f");
    for (let i = 0; i < 7; i++)
      for (const side of [-1, 1]) {
        const f = new THREE.Mesh(
          new THREE.TorusGeometry(B * 0.07, B * 0.024, 6, 10),
          material("#121b1d"),
        );
        f.position.set(side * B * 0.48, (i - 3) * L * 0.11, H * 0.7);
        f.rotation.y = Math.PI / 2;
        group.add(f);
      }
  } else if (type === "bulk") {
    for (let i = 0; i < 5; i++) {
      const y = (i - 2) * L * 0.127;
      box(group, 0, y + L * 0.06, H + 1.8, B * 0.78, L * 0.105, 2.4, "#8b6550");
      for (let j = 0; j < 4; j++)
        box(
          group,
          (j - 1.5) * B * 0.18,
          y + L * 0.06,
          H + 3.1,
          0.35,
          L * 0.1,
          0.3,
          "#b7956f",
        );
    }
  } else {
    // A generic cargo deck is deliberate: AIS 70–79 does not identify container vs bulk vs Ro/Ro.
    box(group, 0, L * 0.04, H + 0.8, B * 0.77, L * 0.65, 0.7, "#8c938b");
    for (let i = 0; i < 4; i++)
      box(
        group,
        0,
        (i - 1.5) * L * 0.15 + L * 0.08,
        H + 1.1,
        B * 0.72,
        L * 0.12,
        0.5,
        "#757e77",
      );
  }
  if (!["roro", "cruise", "passenger", "tug", "pilot"].includes(type)) {
    box(group, 0, -L * 0.35, H + 5, B * 0.86, L * 0.1, 10, "#d9ded8");
    box(group, 0, -L * 0.34, H + 10.4, B * 0.91, L * 0.065, 2, "#6d8d91");
    box(group, B * 0.21, -L * 0.4, H + 10, B * 0.18, L * 0.035, 9, "#24343b");
  }
  const mastY = L * 0.18;
  pipe(
    group,
    [0, mastY, H + 1],
    [0, mastY, H + Math.max(10, L * 0.07)],
    Math.max(0.12, B * 0.008),
    "#c9c9b8",
  );
  const bridgeY = ["tug", "pilot"].includes(type) ? L * 0.12 : -L * 0.3;
  const lightH = H + (["tug", "pilot"].includes(type) ? 6 : 12);
  // +Y is the bow; -X port (red), +X starboard (green), white fore masthead and aft stern.
  light(group, -B * 0.48, bridgeY, lightH, "#ff3a36", Math.max(0.4, B * 0.018));
  light(group, B * 0.48, bridgeY, lightH, "#5dff93", Math.max(0.4, B * 0.018));
  light(
    group,
    0,
    mastY,
    H + Math.max(10, L * 0.07),
    "#fff6cf",
    Math.max(0.5, B * 0.022),
  );
  light(group, 0, -L * 0.48, H + 2, "#ffffff", Math.max(0.4, B * 0.018));
  // Soft contact shadow, intentionally beneath the hull rather than an invented water position.
  const shadow = new THREE.Mesh(
    new THREE.ShapeGeometry(hullShape),
    new THREE.MeshBasicMaterial({
      color: "#000b10",
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
  shadow.position.set(3, -3, 0.1);
  shadow.scale.set(1.04, 1.02, 1);
  group.add(shadow);
  group.userData.dimensions = { length: L, beam: B };
  return group;
}
export function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry && !Object.values(sharedGeometry).includes(obj.geometry))
      obj.geometry.dispose();
    if (obj.material) {
      for (const m of Array.isArray(obj.material)
        ? obj.material
        : [obj.material])
        m.dispose();
    }
  });
}
export function setShipNight(group, night) {
  group.traverse((obj) => {
    if (obj.userData.light) obj.visible = night;
  });
}

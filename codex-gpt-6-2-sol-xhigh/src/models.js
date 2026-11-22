import * as THREE from 'three';

const materialCache = new Map();
const palette = ['#b34d3b', '#677987', '#24474f', '#a7a49b', '#be8655', '#6c3332', '#325a78', '#759173'];
const defaults = { container: '#19454c', tanker: '#423028', bulk: '#254449', 'ro-ro': '#35505f', passenger: '#e4e6de', cargo: '#384b43', tug: '#512d32', pilot: '#bd6c24' };
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);

function material(color) {
  if (!materialCache.has(color)) materialCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: .83 }));
  return materialCache.get(color);
}

function box(group, x, y, z, width, height, length, color, geometry = boxGeometry) {
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.set(x, y + height / 2, z);
  mesh.scale.set(width, height, length);
  group.add(mesh);
  return mesh;
}

function outline(group, beam, start, end, base, height, color, profile = 1) {
  const b = beam / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, start);
  shape.bezierCurveTo(b * .76, start + .025 * profile, b, start + .14 * profile, b, start + .22 * profile);
  shape.lineTo(b, end - .12 * profile);
  shape.quadraticCurveTo(b * .96, end, b * .55, end);
  shape.lineTo(-b * .55, end);
  shape.quadraticCurveTo(-b * .96, end, -b, end - .12 * profile);
  shape.lineTo(-b, start + .22 * profile);
  shape.bezierCurveTo(-b, start + .14 * profile, -b * .76, start + .025 * profile, 0, start);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 8 });
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.y = base + height;
  group.add(mesh);
}

function bridge(group, b, z, width = .8, top = .033) {
  box(group, 0, top, z, b * width, .018, .070, '#e2e3d3');
  box(group, 0, top + .018, z - .019, b * width * .9, .002, .012, '#294349');
  box(group, 0, top + .018, z + .009, b * .28, .012, .021, '#cfd1c0');
}

function containerDeck(group, b) {
  bridge(group, b, .255);
  for (let bay = 0; bay < 9; bay++) {
    const z = -.297 + bay * .067 + (bay === 8 ? .09 : 0);
    for (let row = 0; row < 6; row++) {
      if ((bay * 13 + row * 7) % 19 === 9) continue;
      const x = (row - 2.5) * .137 * b;
      const h = .014 + ((bay * 17 + row * 31) % 5) * .0042;
      box(group, x, .028, z, b * .122, h, .054, palette[(bay * 5 + row * 3) % palette.length]);
      box(group, x, .029 + h, z + .022, b * .12, .002, .003, '#b7a88e');
    }
  }
}

function liquidDeck(group, b) {
  bridge(group, b, .326);
  for (const x of [-.26, -.10, .11, .25]) {
    box(group, x * b, .029, -.045, b * .024, .009, .57, x < 0 ? '#bdad83' : '#a6b6b2');
  }
  for (let i = 0; i < 8; i++) {
    const z = -.30 + i * .067;
    box(group, 0, .03, z, b * .67, .009, .006, '#648e80');
    for (const x of [-.32, .32]) box(group, x * b, .028, z, b * .042, .007, b * .042, '#a4bdb2', cylinderGeometry);
  }
  box(group, 0, .04, .02, b * .88, .014, .024, '#c5a66a');
  box(group, 0, .034, -.36, b * .25, .021, .03, '#ddd2aa');
}

function hatchDeck(group, b, cargo) {
  bridge(group, b, .34);
  for (let i = 0; i < (cargo ? 4 : 6); i++) {
    const z = -.297 + i * (cargo ? .145 : .103);
    box(group, 0, .028, z, b * .73, .004, cargo ? .114 : .079, '#354445');
    for (let j = 0; j < 2; j++) box(group, 0, .032, z + (j - .5) * (cargo ? .054 : .037), b * .675, .009, cargo ? .05 : .034, cargo ? '#8c6e51' : '#68776d');
    if (cargo || i % 2 === 0) {
      box(group, 0, .031, z - .053, b * .11, .024, b * .12, '#c5ad7b', cylinderGeometry);
      box(group, 0, .052, z - .02, b * .035, .006, .075, '#c5ad7b');
    }
  }
}

function roRoDeck(group, b) {
  outline(group, b * .89, -.397, .445, .025, .056, '#b8bdaf', .65);
  bridge(group, b, -.270, .79, .08);
  for (const x of [-.29, .29]) box(group, x * b, .082, .004, b * .028, .004, .35, '#d5d9c7');
  box(group, 0, .081, .206, b * .38, .02, .045, '#3f4a48');
  box(group, b * .21, .082, .340, b * .24, .011, .066, '#e0d7b0');
}

function passengerDeck(group, b) {
  outline(group, b * .87, -.424, .46, .023, .028, '#d2dbd6', .9);
  outline(group, b * .70, -.352, .405, .050, .026, '#ebede5', .7);
  outline(group, b * .55, -.272, .336, .076, .012, '#cbc0a8', .6);
  bridge(group, b, -.246, .69, .083);
  box(group, 0, .088, -.037, b * .25, .002, .093, '#3599b7');
  box(group, 0, .088, .145, b * .18, .003, .05, '#49b5c8');
  box(group, 0, .087, .054, b * .21, .022, .049, '#49484a');
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) box(group, b * .4 * side, .049, -.16 + i * .058, b * .095, .012, .045, '#de9149');
}

function serviceDeck(group, b, pilot) {
  bridge(group, b, -.124, .69, .052);
  box(group, 0, .031, .168, b * .66, .011, .36, pilot ? '#667979' : '#425754');
  box(group, 0, .041, .056, b * .17, .023, .065, '#8c9b8a');
  box(group, 0, .079, -.14, b * .09, .025, .018, '#f0e9da');
}

export class ShipModels {
  cache = new Map();

  constructor() {
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setSize(192, 192, false);
      this.renderer.setClearColor(0, 0);
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.HemisphereLight('#e1effa', '#7a6554', 2.35));
      this.keyLight = new THREE.DirectionalLight('#ffffe9', 2.45);
      this.keyLight.position.set(-1.3, 2.2, -1.0);
      this.scene.add(this.keyLight);
      this.camera = new THREE.OrthographicCamera(-.636, .636, .636, -.636, .1, 6);
      this.camera.position.set(0, 3, 0);
      this.camera.up.set(0, 0, -1);
      this.camera.lookAt(0, 0, 0);
    } catch {
      this.renderer = null;
    }
  }

  sprite(category, ratio, night) {
    if (!this.renderer || this.renderer.getContext().isContextLost()) return null;
    const b = Math.round(ratio * 100) / 100;
    const key = `${category}/${b}/${night}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const group = new THREE.Group();
    outline(group, b, -.50, .50, 0, .027, defaults[category], ['tug', 'pilot'].includes(category) ? 1.3 : 1);
    outline(group, b * .91, -.469, .475, .027, .003, category === 'tanker' ? '#625343' : '#6e7467');
    if (category === 'container') containerDeck(group, b);
    if (category === 'tanker') liquidDeck(group, b);
    if (category === 'bulk' || category === 'cargo') hatchDeck(group, b, category === 'cargo');
    if (category === 'ro-ro') roRoDeck(group, b);
    if (category === 'passenger') passengerDeck(group, b);
    if (category === 'tug' || category === 'pilot') serviceDeck(group, b, category === 'pilot');
    box(group, 0, .031, -.407, b * .26, .008, .018, '#b3b8a2');
    this.scene.add(group);
    this.keyLight.color.set(night ? '#afc9ff' : '#fff4df');
    this.keyLight.intensity = night ? 1.1 : 2.4;
    this.renderer.toneMappingExposure = night ? .74 : 1.0;
    this.renderer.render(this.scene, this.camera);
    const image = document.createElement('canvas');
    image.width = image.height = 192;
    image.getContext('2d').drawImage(this.renderer.domElement, 0, 0);
    this.scene.remove(group);
    group.traverse(object => {
      if (object.geometry instanceof THREE.ExtrudeGeometry) object.geometry.dispose();
    });
    if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, image);
    return image;
  }
}

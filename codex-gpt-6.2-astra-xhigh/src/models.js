// Orthographic, lit meshes are rendered once into reusable sprites. The map positions,
// rotates and sizes these using the AIS fix, antenna offsets and reported dimensions.
import * as T from 'three'
const materialCache = new Map()
function material(color) {
  if (!materialCache.has(color))
    materialCache.set(color, new T.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.12 }))
  return materialCache.get(color)
}
const box = new T.BoxGeometry(1, 1, 1)
const round = new T.CylinderGeometry(1, 1, 1, 14)
const art = new Map()
const containerColors = [
  '#a94e35',
  '#335b70',
  '#b38c54',
  '#517c76',
  '#b85d41',
  '#777c72',
  '#455b5d',
  '#a39178'
]

function shipMesh(type, lengthToBeam) {
  const boat = new T.Group()
  const L = 100,
    B = L / lengthToBeam
  const small = ['tug', 'pilot', 'passenger'].includes(type)
  const steel =
    type === 'cruise' || type === 'passenger' ? '#e1e2d8' : type === 'vehicle' ? '#9ea9aa' : '#293b41'
  const deck =
    type === 'tanker' ? '#a1543f' : type === 'cruise' || type === 'passenger' ? '#baa48b' : '#676d68'
  function part(geo, color, x, y, z, w, l, h) {
    const m = new T.Mesh(geo, material(color))
    m.position.set(x, y, z)
    m.scale.set(w, l, h)
    boat.add(m)
    return m
  }
  function block(x, y, z, w, l, h, c) {
    return part(box, c, x, y, z, w, l, h)
  }
  function cylinder(x, y, z, r, h, c) {
    const m = part(round, c, x, y, z, r, h, r)
    m.rotation.x = Math.PI / 2
    return m
  }
  function deckShape(width, length, base, height, color, blunt = false) {
    const b = width / 2,
      l = length / 2
    const s = new T.Shape()
    s.moveTo(0, l)
    s.bezierCurveTo(b * 0.35, l, b, l * (blunt ? 0.83 : 0.7), b, l * 0.53)
    s.lineTo(b, -l * 0.84)
    s.quadraticCurveTo(b, -l, -b * 0.02, -l)
    s.quadraticCurveTo(-b, -l, -b, -l * 0.84)
    s.lineTo(-b, l * 0.53)
    s.bezierCurveTo(-b, l * (blunt ? 0.83 : 0.7), -b * 0.35, l, 0, l)
    const geo = new T.ExtrudeGeometry(s, {
      depth: height,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.35,
      bevelThickness: 0.4,
      curveSegments: 10
    })
    const m = new T.Mesh(geo, material(color))
    m.position.z = base
    boat.add(m)
  }
  deckShape(B * 0.96, 99, 0, 1.6, '#813e30')
  deckShape(B, 100, 1.5, 3.2, steel, type === 'vehicle')
  deckShape(B * 0.95, 98, 4.8, 0.35, deck, type === 'vehicle')
  function house(y, levels = 3, span = 0.8) {
    for (let i = 0; i < levels; i++) {
      const w = B * (span - i * 0.045)
      block(0, y, 6.1 + i * 1.9, w, 8.5 - i * 0.7, 1.8, '#e5e3d8')
      block(0, y + 3.3 - i * 0.3, 6.7 + i * 1.9, w * 0.94, 1.05, 0.63, '#354e55')
    }
    block(0, y + 2.2, 7 + levels * 1.9, B * 0.9, 2, 0.5, '#dfddce')
    cylinder(0, y, 8 + levels * 1.9, 0.38, 3.4, '#c1c3b4')
    block(0, y, 9.2 + levels * 1.9, B * 0.28, 0.45, 0.45, '#d5d3c7')
  }
  if (type === 'container') {
    const cols = Math.max(4, Math.min(9, Math.round(B / 2.5)))
    const cw = (B * 0.87) / cols
    for (let row = 0; row < 11; row++)
      for (let col = 0; col < cols; col++) {
        if (row === 10 && (col === 0 || col === cols - 1)) continue
        const n = (row * 17 + col * 7 + row * col) % containerColors.length
        const x = (col - (cols - 1) / 2) * cw,
          y = -26 + row * 6.2,
          h = 2.7 + ((row * 5 + col) % 3) * 1.25
        block(x, y, 5.2 + h / 2, cw * 0.94, 5.8, h, containerColors[n])
        block(x - cw * 0.28, y, 5.25 + h, 0.13, 5.5, 0.08, '#a89c85')
      }
    house(-34, 4)
  } else if (type === 'tanker') {
    for (let i = 0; i < 9; i++) {
      const y = -25 + i * 7.8
      block(0, y, 5.55, B * 0.91, 0.55, 0.65, '#916854')
      for (const side of [-1, 1]) {
        cylinder(side * B * 0.31, y + 1.3, 5.8, 0.95, 0.7, '#dbb49c')
        block(side * B * 0.21, y, 5.95, B * 0.35, 0.65, 0.65, '#c2b8a2')
      }
    }
    for (let i = -2; i <= 2; i++) block(i * 0.95, 3, 6.2, 0.61, 70, 0.65, i % 2 ? '#c0b7a0' : '#d8c9aa')
    block(0, 1, 7.1, B * 0.9, 3, 1.3, '#b28552')
    house(-35, 4)
  } else if (type === 'bulk') {
    for (let i = 0; i < 5; i++) {
      const y = -23 + i * 13.1
      block(0, y, 5.8, B * 0.8, 10.7, 1.6, '#aa7560')
      for (let k = -2; k <= 2; k++) block(0, y + k * 1.75, 6.7, B * 0.76, 0.4, 0.28, '#cd9b80')
      if (i < 4) {
        cylinder(-B * 0.31, y + 6.6, 8, 1.05, 5, '#d2bb8d')
        const boom = block(-B * 0.12, y + 3.7, 10.55, 0.7, 9, 0.9, '#ddca9b')
        boom.rotation.z = -0.57
      }
    }
    house(-36, 4)
  } else if (type === 'vehicle') {
    block(0, -3, 10.2, B * 0.94, 78, 10.2, '#a3adb0')
    block(0, -3, 15.5, B * 0.91, 77, 0.5, '#d4d5cb')
    for (let i = 0; i < 7; i++) block(0, -33 + i * 9.5, 16, B * 0.71, 0.55, 0.5, '#afb3aa')
    house(29, 2)
    block(-B * 0.28, -30, 17.8, 2.6, 4, 4, '#bd754c')
  } else if (type === 'cruise' || type === 'passenger') {
    const cruise = type === 'cruise',
      levels = cruise ? 5 : 2
    for (let i = 0; i < levels; i++) {
      const w = B * (0.94 - i * 0.075),
        l = 79 - i * 5
      block(0, -1 + i, 6.4 + i * 2.1, w, l, 2.2, '#dbdcd3')
      for (const side of [-1, 1])
        block(side * w * 0.494, -1 + i, 6.7 + i * 2.1, 0.25, l * 0.91, 0.85, '#445f6a')
    }
    const top = 7.5 + (levels - 1) * 2.1
    block(0, 7, top, B * 0.56, 16, 0.5, '#bb9e77')
    if (cruise) {
      block(0, 7, top + 0.3, B * 0.31, 8, 0.45, '#62c8ca')
      for (const side of [-1, 1])
        for (let i = 0; i < 7; i++) block(side * B * 0.45, -22 + i * 6.2, 8.7, B * 0.1, 4.3, 1.4, '#d98a50')
    }
    block(0, -17, top + 2, B * 0.21, 5, 4, '#c09867')
    house(26, 2, 0.64)
  } else if (type === 'tug' || type === 'pilot') {
    block(0, -27, 6.5, B * 0.64, 13, 2, '#5e6661')
    house(9, type === 'tug' ? 3 : 2, 0.69)
    block(0, 8, 8.1, B * 0.66, 22, 4, '#d6d3c4')
    block(0, 9, 10.4, B * 0.6, 13, 1.25, type === 'pilot' ? '#f18e43' : '#b14f39')
    for (const side of [-1, 1])
      for (let i = 0; i < 6; i++) cylinder(side * B * 0.47, -32 + i * 12, 3.6, B * 0.079, 2.1, '#202a2d')
    cylinder(0, -17, 7.3, B * 0.14, 2.8, '#273d44')
  } else {
    house(-30, 3)
    for (let i = 0; i < 4; i++) block(0, -13 + i * 13.5, 5.7, B * 0.72, 11.5, 1.1, '#697d7b')
  }
  for (const side of [-1, 1]) {
    cylinder(side * B * 0.18, 40, 5.65, 0.6, 1.1, '#c7c8b9')
    block(side * B * 0.47, -1, 5.35, 0.21, 63, 0.55, '#bcbaab')
  }
  if (!small && type !== 'cruise' && type !== 'vehicle') {
    block(B * 0.17, -41, 8.2, B * 0.19, 4, 6, '#ce9d6c')
    block(B * 0.17, -41, 11.1, B * 0.19, 4, 1.2, '#41464a')
  }
  return boat
}
let renderer
function render(boat, side) {
  if (!renderer)
    renderer = new T.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power'
    })
  const w = side ? 344 : 220,
    h = side ? 152 : 600
  renderer.setSize(w, h, false)
  renderer.setClearColor(0x000000, 0)
  const extent = side ? 25 : 53
  const cam = new T.OrthographicCamera((-extent * w) / h, (extent * w) / h, extent, -extent, 0.1, 600)
  cam.up.set(0, side ? 0 : 1, side ? 1 : 0)
  cam.position.set(...(side ? [148, -58, 94] : [0, 0, 180]))
  cam.lookAt(0, 0, side ? 6 : 0)
  const scene = new T.Scene()
  scene.add(boat, new T.HemisphereLight(0xfff7df, 0x4b6a79, 2.0))
  const sun = new T.DirectionalLight(0xffe6c3, 2.6)
  sun.position.set(-50, 60, 80)
  scene.add(sun)
  renderer.render(scene, cam)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d').drawImage(renderer.domElement, 0, 0)
  return c
}
// Fallback for wall displays with disabled WebGL.
function fallback(type, side, ratio) {
  const c = document.createElement('canvas')
  c.width = side ? 344 : 220
  c.height = side ? 152 : 600
  const g = c.getContext('2d')
  g.translate(c.width / 2, c.height / 2)
  if (side) {
    g.rotate(-Math.PI * 0.47)
    g.scale(0.51, 0.51)
  }
  const w = Math.min(175, 560 / ratio)
  g.fillStyle = '#81918e'
  g.beginPath()
  g.moveTo(0, -280)
  g.quadraticCurveTo(w / 2, -243, w / 2, -168)
  g.lineTo(w / 2, 247)
  g.quadraticCurveTo(0, 293, -w / 2, 247)
  g.lineTo(-w / 2, -168)
  g.quadraticCurveTo(-w / 2, -243, 0, -280)
  g.fill()
  g.fillStyle = '#d3d6cb'
  g.fillRect(-w * 0.4, 142, w * 0.8, 49)
  for (let i = 0; i < 7; i++) {
    g.fillStyle = type === 'container' ? containerColors[i] : '#53686a'
    g.fillRect(-w * 0.35, -179 + i * 43, w * 0.7, 31)
  }
  return c
}
export function sprite(type, side = false, ratio = 5.9) {
  ratio = Math.min(12, Math.max(2.8, Math.round(ratio * 4) / 4))
  const key = type + '-' + side + '-' + ratio
  if (!art.has(key)) {
    const model = shipMesh(type, ratio)
    try {
      art.set(key, render(model, side))
    } catch {
      art.set(key, fallback(type, side, ratio))
    }
    model.traverse((m) => {
      if (m.isMesh && m.geometry !== box && m.geometry !== round) m.geometry.dispose()
    })
  }
  return art.get(key)
}

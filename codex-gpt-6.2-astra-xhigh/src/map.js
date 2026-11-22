import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import channel from './channel.json'
import { terminals, bridges, midpoint, colors, category } from './geography.js'
import { sprite } from './models.js'

const rad = Math.PI / 180
const geoBounds = [
  [32.54, -80.36],
  [33.08, -79.45]
]
const overview = [
  [32.708, -79.977],
  [32.91, -79.716]
]
const mix = (a, b, t) => a + (b - a) * t
const heading = (s) => s.heading ?? (s.speed >= 0.7 ? s.course : null)
const turn = (a, b, t) => a + (((b - a + 540) % 360) - 180) * t

export function createMap(onShip, onTerminal) {
  const map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    minZoom: 10.5,
    maxZoom: 18,
    zoomSnap: 0.05,
    zoomDelta: 0.8,
    maxBounds: geoBounds,
    maxBoundsViscosity: 0.95,
    zoomAnimation: false,
    markerZoomAnimation: false,
    preferCanvas: true
  })
  const base = L.imageOverlay('/imagery/charleston-night.webp', geoBounds, {
    className: 'satellite-base'
  }).addTo(map)
  const aerial = L.tileLayer('/api/imagery?z={z}&x={x}&y={y}', {
    minZoom: 14,
    maxNativeZoom: 17,
    maxZoom: 18,
    bounds: [
      [32.7, -80.063],
      [32.95, -79.79]
    ],
    keepBuffer: 1,
    className: 'aerial',
    updateWhenIdle: true
  }).addTo(map)
  const shape = L.geoJSON(channel, {
    interactive: false,
    style: {
      color: '#70d4c2',
      weight: 1.1,
      opacity: 0.64,
      fillColor: '#66c5ae',
      fillOpacity: 0.085,
      dashArray: '3 4'
    }
  }).addTo(map)
  const canvas = document.querySelector('#overlay'),
    ctx = canvas.getContext('2d')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const tracks = new Map()
  const layer = { labels: true, channel: true, boats: true }
  let night = true,
    selected = null,
    hits = [],
    frame = 0,
    W,
    H,
    stale = false
  const px = (lat, lon) => map.latLngToContainerPoint([lat, lon])
  function home() {
    map.fitBounds(overview, { paddingTopLeft: [36, 47], paddingBottomRight: [40, 52], animate: false })
  }
  home()
  function pose(tr, now) {
    const t = tr.duration ? Math.min(1, (now - tr.start) / tr.duration) : 1
    const e = t * t * (3 - 2 * t)
    const h = heading(tr.ship)
    return {
      lat: mix(tr.from.lat, tr.ship.lat, e),
      lon: mix(tr.from.lon, tr.ship.lon, e),
      h: h == null ? null : tr.from.h == null ? h : turn(tr.from.h, h, e),
      animating: t < 1
    }
  }
  function setShips(ships, isStale) {
    const now = performance.now()
    stale = isStale
    const ids = new Set(ships.map((s) => s.mmsi))
    for (const id of tracks.keys()) if (!ids.has(id)) tracks.delete(id)
    for (const s of ships) {
      const old = tracks.get(s.mmsi)
      if (old && old.ship.seen === s.seen) {
        old.ship = s
        continue
      }
      const from = old ? pose(old, now) : { lat: s.lat, lon: s.lon, h: heading(s) }
      const duration =
        !isStale &&
        !reduced.matches &&
        old &&
        (from.lat !== s.lat || from.lon !== s.lon || from.h !== heading(s))
          ? 38_000
          : 0
      tracks.set(s.mmsi, { ship: s, from, start: now, duration })
    }
    request()
  }
  function request() {
    if (!frame) frame = requestAnimationFrame(draw)
  }
  function line(points, color, width = 1) {
    ctx.beginPath()
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.stroke()
  }
  function lamp(x, y, sz, color) {
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = sz * 2.8
    ctx.beginPath()
    ctx.arc(x, y, sz, 0, 2 * Math.PI)
    ctx.fill()
    ctx.shadowBlur = 0
  }
  function berthLights(item, bridge, mpp) {
    const [a, b] = item.ends.map((v) => px(...v))
    if (
      Math.min(a.x, b.x) > W + 30 ||
      Math.max(a.x, b.x) < -30 ||
      Math.min(a.y, b.y) > H + 30 ||
      Math.max(a.y, b.y) < -30
    )
      return
    const dist = a.distanceTo(b),
      dx = (b.x - a.x) / dist,
      dy = (b.y - a.y) / dist
    line(
      [a, b],
      bridge ? 'rgba(237,190,133,.36)' : 'rgba(237,184,130,.31)',
      Math.min(3, Math.max(1, 4 / mpp))
    )
    const n = Math.max(2, Math.ceil(dist / Math.max(3, (bridge ? 48 : 64) / mpp)))
    for (let i = 0; i <= n; i++) {
      const x = mix(a.x, b.x, i / n),
        y = mix(a.y, b.y, i / n)
      lamp(x, y, Math.max(0.55, Math.min(1.8, 1.6 / mpp)), i % 4 === 0 ? '#ffe4ba' : '#dda46a')
      if (!bridge && item.id !== 'columbus' && i % 2 === 0) {
        const reach = Math.min(62 / mpp, 48)
        const side = item.id === 'wando' ? 1 : -1
        line(
          [
            { x, y },
            { x: x + dy * reach * side, y: y - dx * reach * side }
          ],
          'rgba(232,180,125,.56)',
          Math.max(0.6, 1.3 / mpp)
        )
        lamp(x + dy * reach * side, y - dx * reach * side, 0.8, '#f5bb78')
      }
    }
  }
  function hatchGrid() {
    const gap = map.getZoom() > 14 ? 0.01 : 0.05
    const bounds = map.getBounds()
    ctx.save()
    ctx.setLineDash([2, 6])
    ctx.strokeStyle = 'rgba(200,218,212,.13)'
    ctx.lineWidth = 0.65
    ctx.beginPath()
    for (let lng = Math.ceil(bounds.getWest() / gap) * gap; lng < bounds.getEast(); lng += gap) {
      const x = px(32.8, lng).x
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
    }
    for (let lat = Math.ceil(bounds.getSouth() / gap) * gap; lat < bounds.getNorth(); lat += gap) {
      const y = px(lat, -79.9).y
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
    }
    ctx.stroke()
    ctx.restore()
  }
  function vessel(tr, now, mpp) {
    const s = tr.ship,
      kind = category(s),
      selectedShip = s.mmsi === selected
    if (kind === 'workboat' && !layer.boats && !selectedShip) return
    const p = pose(tr, now),
      fix = px(p.lat, p.lon)
    if (fix.x < -200 || fix.y < -200 || fix.x > W + 200 || fix.y > H + 200) return
    const l = s.length / mpp,
      b = s.beam / mpp,
      theta = (p.h ?? 0) * rad
    const offY =
      s.bow != null && s.stern != null && s.bow + s.stern === s.length ? (s.bow - s.stern) / 2 / mpp : 0
    const offX =
      s.port != null && s.starboard != null && s.port + s.starboard === s.beam
        ? (s.starboard - s.port) / 2 / mpp
        : 0
    const x = fix.x + (p.h == null ? 0 : offY * Math.sin(theta) + offX * Math.cos(theta)),
      y = fix.y + (p.h == null ? 0 : -offY * Math.cos(theta) + offX * Math.sin(theta))
    const detailed = p.h != null && l > 0 && b > 0
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(theta)
    if (!stale && s.speed >= 1 && p.h != null) {
      const stern = detailed ? l / 2 : 4
      const trail = Math.min(120, Math.max(8, Math.min(s.speed * 6, s.length || 50) / mpp))
      const wide = Math.max(2, Math.min(32, b * 0.75))
      const g = ctx.createLinearGradient(0, stern, 0, stern + trail)
      g.addColorStop(0, 'rgba(218,238,232,.53)')
      g.addColorStop(1, 'rgba(218,238,232,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(-wide * 0.3, stern)
      ctx.lineTo(-wide * 1.4, stern + trail)
      ctx.lineTo(0, stern + trail * 0.56)
      ctx.lineTo(wide * 1.4, stern + trail)
      ctx.lineTo(wide * 0.3, stern)
      ctx.fill()
    }
    if (detailed) {
      if (l < 16) {
        ctx.beginPath()
        ctx.arc(0, 0, kind === 'workboat' ? 5 : 7, 0, 2 * Math.PI)
        ctx.fillStyle = '#12242bc2'
        ctx.fill()
        ctx.strokeStyle = colors[kind]
        ctx.lineWidth = 1
        ctx.stroke()
      }
      const ratio = s.length / s.beam,
        asset = sprite(s.model, false, ratio)
      const usedRatio = Math.min(12, Math.max(2.8, Math.round(ratio * 4) / 4))
      const h = l * 1.06,
        w = (b * usedRatio * 1.06 * asset.width) / asset.height
      ctx.shadowColor = 'rgba(0,9,13,.75)'
      ctx.shadowBlur = Math.min(8, 2 / mpp)
      ctx.shadowOffsetX = Math.min(8, 2 / mpp)
      ctx.shadowOffsetY = Math.min(10, 3 / mpp)
      ctx.drawImage(asset, -w / 2, -h / 2, w, h)
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
      if (night && l >= 10) {
        const r = Math.max(0.7, Math.min(2.6, 1.1 / mpp))
        lamp(-b * 0.47, l * 0.04, r, '#ff5a4e')
        lamp(b * 0.47, l * 0.04, r, '#6af69c')
        lamp(0, -l * 0.21, r * 0.87, '#fff5d6')
        lamp(0, l * 0.475, r * 0.8, '#fff5e8')
      }
    } else {
      const color = colors[kind],
        r = kind === 'workboat' ? 3.2 : 4.5
      ctx.beginPath()
      ctx.arc(0, 0, r + 3.1, 0, Math.PI * 2)
      ctx.fillStyle = '#142228b8'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 0.8
      ctx.stroke()
      ctx.fillStyle = color
      ctx.beginPath()
      if (p.h !== null) {
        ctx.moveTo(0, -r * 1.23)
        ctx.lineTo(r * 0.7, r)
        ctx.lineTo(0, r * 0.66)
        ctx.lineTo(-r * 0.7, r)
        ctx.closePath()
      } else ctx.arc(0, 0, r * 0.62, 0, 2 * Math.PI)
      ctx.fill()
    }
    if (selectedShip) {
      ctx.strokeStyle = '#ffe8bf'
      ctx.lineWidth = 1.4
      ctx.setLineDash([4, 4])
      ctx.strokeRect(
        -Math.max(10, b / 2 + 5),
        -Math.max(12, detailed ? l / 2 + 6 : 12),
        Math.max(20, b + 10),
        Math.max(24, detailed ? l + 12 : 24)
      )
      ctx.setLineDash([])
    }
    ctx.restore()
    const hit = { x, y, id: s.mmsi, r: Math.max(10, Math.min(75, l / 2)), ship: s }
    hits.push(hit)
    return { p: hit, anim: p.animating }
  }
  function draw(now) {
    frame = 0
    const host = map.getContainer()
    W = host.clientWidth
    H = host.clientHeight
    const dpr = Math.min(2, devicePixelRatio || 1)
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const mpp = (156543.03392 * Math.cos(map.getCenter().lat * rad)) / 2 ** map.getZoom()
    const scale =
      [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000].filter((m) => m / mpp <= 85).at(-1) ?? 10
    document.querySelector('.scale i').style.width = scale / mpp + 'px'
    document.querySelector('.scale span').textContent = scale >= 1000 ? scale / 1000 + ' km' : scale + ' m'
    const occupied = [],
      candidates = []
    hits = []
    hatchGrid()
    if (night) {
      bridges.forEach((t) => berthLights(t, true, mpp))
      terminals.forEach((t) => berthLights(t, false, mpp))
    }
    let anim = false
    for (const tr of tracks.values()) {
      const v = vessel(tr, now, mpp)
      if (v) {
        candidates.push(v.p)
        anim ||= v.anim
      }
    }
    function label(text, p, off, style, force = false, terminal = null) {
      const isShip = style === 'ship',
        place = style === 'place',
        terminalStyle = style === 'terminal'
      const font = place
        ? 'italic 14px Georgia'
        : '500 ' + (isShip ? '10' : '10.5') + 'px "DM Sans Variable",sans-serif'
      ctx.font = font
      const tw = ctx.measureText(text).width,
        left = off[0] < 0
      let x = p.x + off[0] - (left ? tw + 12 : 0),
        y = p.y + off[1] - 8
      if (y < 8 || y > H - 35 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) return
      x = Math.max(4, Math.min(W - tw - 16, x))
      const overlaps = (cy) =>
        occupied.some((a) => x < a.x + a.w && x + tw + 14 > a.x && cy < a.y + a.h && cy + 19 > a.y)
      if (overlaps(y)) {
        if (!force) return
        for (const delta of [-18, 18, -34, 34])
          if (!overlaps(y + delta) && y + delta > 4 && y + delta < H - 32) {
            y += delta
            break
          }
      }
      occupied.push({ x, y, w: tw + 14, h: 19 })
      const tint = isShip
        ? colors[category(p.ship)]
        : terminalStyle
          ? '#f2ae7d'
          : place
            ? '#c4d6cd'
            : '#e1ddc8'
      if (!place) {
        const edgeX = left ? x + tw + 12 : x
        line([p, { x: edgeX, y: y + 8.5 }], isShip ? tint + '80' : 'rgba(222,204,170,.63)', 0.9)
        if (!isShip) {
          ctx.fillStyle = tint
          ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
        }
        ctx.fillStyle = isShip ? 'rgba(17,31,36,.91)' : 'rgba(19,31,36,.79)'
        ctx.beginPath()
        ctx.roundRect(x, y, tw + 12, 17, 3)
        ctx.fill()
      }
      ctx.fillStyle = tint
      ctx.textBaseline = 'middle'
      ctx.shadowColor = '#142028'
      ctx.shadowBlur = place ? 4 : 0
      ctx.fillText(text, x + 6, y + 8.7)
      ctx.shadowBlur = 0
      if (terminal) hits.push({ x: x + (tw + 12) / 2, y: y + 8.5, w: tw + 12, h: 17, terminal })
    }
    if (layer.labels) {
      for (const t of terminals) {
        const p = px(...midpoint(t.ends))
        label(t.name, p, t.offset, 'terminal', true, t.id)
      }
      for (const t of bridges) {
        const p = px(...midpoint(t.ends))
        label(t.name, p, t.offset, 'bridge', true)
      }
      if (layer.channel) label('Shipping channel', px(32.749, -79.882), [-23, 20], 'bridge', true)
    }
    const sorted = candidates.sort(
      (a, b) => (b.id === selected) - (a.id === selected) || (b.ship.length || 0) - (a.ship.length || 0)
    )
    let shown = 0
    for (const p of sorted) {
      if (
        !p.ship.name ||
        (map.getZoom() < 13 && (shown >= 3 || category(p.ship) === 'workboat') && p.id !== selected)
      )
        continue
      const before = occupied.length
      label(p.ship.name, p, [15, -10], 'ship', p.id === selected)
      if (occupied.length > before) shown++
    }
    if (layer.labels && map.getZoom() < 13.4 && W > 430) {
      for (const [name, a, b] of [
        ['Charleston', 32.777, -79.954],
        ['Mount Pleasant', 32.811, -79.84],
        ['Atlantic Ocean', 32.701, -79.74]
      ]) {
        label(name, px(a, b), [0, 0], 'place')
      }
    }
    if (anim) request()
  }
  function pick(point) {
    const labels = hits.filter(
      (h) => h.terminal && Math.abs(h.x - point.x) < h.w / 2 + 2 && Math.abs(h.y - point.y) < h.h / 2 + 1
    )
    if (labels.length) return labels[0]
    return hits
      .filter((h) => h.ship)
      .map((h) => ({ h, d: Math.hypot(h.x - point.x, h.y - point.y) }))
      .filter((v) => v.d < v.h.r + 2)
      .sort((a, b) => a.d - b.d)[0]?.h
  }
  map.on('click', (e) => {
    const h = pick(e.containerPoint)
    if (h?.id) onShip(h.id)
    else if (h?.terminal) onTerminal(h.terminal)
  })
  map.on('mousemove', (e) => {
    map.getContainer().style.cursor = pick(e.containerPoint) ? 'pointer' : ''
  })
  map.on('move zoom resize viewreset', request)
  new ResizeObserver(() => {
    map.invalidateSize({ pan: false })
    if (!selected && map.getZoom() < 13) home()
    request()
  }).observe(map.getContainer())
  document.fonts.ready.then(request)
  document.querySelector('#zoom-in').onclick = () => map.zoomIn(0.9)
  document.querySelector('#zoom-out').onclick = () => map.zoomOut(0.9)
  document.querySelector('#home').onclick = () => {
    onShip(null)
    home()
  }
  document.querySelectorAll('[data-layer]').forEach(
    (el) =>
      (el.onchange = () => {
        layer[el.dataset.layer] = el.checked
        if (layer.channel && !map.hasLayer(shape)) shape.addTo(map)
        if (!layer.channel && map.hasLayer(shape)) shape.remove()
        request()
      })
  )
  return {
    setShips,
    home,
    focus(ship) {
      selected = ship?.mmsi || null
      if (ship) map.setView([ship.lat, ship.lon], ship.length > 120 ? 15.9 : 16.8, { animate: false })
      request()
    },
    terminal(t) {
      selected = null
      map.fitBounds(t.ends, { padding: [65, 75], maxZoom: 15.4, animate: false })
      request()
    },
    light(value) {
      if (night !== value) {
        night = value
        base.setUrl('/imagery/charleston' + (night ? '-night' : '') + '.webp')
        aerial.redraw()
        request()
      }
    }
  }
}

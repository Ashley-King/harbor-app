import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AGING_REPORT, AIS_BOUNDS, isMoving } from '../lib/vessels.js';
import channel from './channel.json';
import { BRIDGES, HARBOR_VIEW, LANDMARKS, SHORE_LIGHTS, TERMINALS } from './places.js';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SC = 'https://tiles.arcgis.com/tiles/RvqSyw3diI7dTKo5/arcgis/rest/services/SC_2023_RGB/MapServer/tile/{z}/{y}/{x}';
const radians = Math.PI / 180;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const fallbackIcon = L.divIcon({ className: 'vessel-key', iconSize: [24, 24], iconAnchor: [12, 12] });

function interpolate(a, b, t) { return a + (b - a) * t; }
function pulse(ctx, x, y, radius, rgb, opacity) {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
  halo.addColorStop(0, `rgba(${rgb},${opacity})`);
  halo.addColorStop(.28, `rgba(${rgb},${opacity * .44})`);
  halo.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function segmentPoints(path, count) {
  return path.slice(1).flatMap(([lat, lon], i) => Array.from({ length: count }, (_, j) => {
    const t = j / count;
    return [interpolate(path[i][0], lat, t), interpolate(path[i][1], lon, t)];
  }));
}

function animatePose(track, now) {
  const t = Math.min(1, (now - track.started) / track.duration);
  const mix = t * t * (3 - 2 * t);
  return [
    [interpolate(track.from[0], track.ship.position[0], mix), interpolate(track.from[1], track.ship.position[1], mix)],
    track.fromAngle + track.turn * mix,
    t < 1,
  ];
}

function hullCenter(point, ship, angle, ppm) {
  const front = ship.toBow != null && ship.toStern != null && ship.toBow + ship.toStern === ship.length
    ? (ship.toBow - ship.toStern) * .5 * ppm : 0;
  const right = ship.toPort != null && ship.toStarboard != null && ship.toPort + ship.toStarboard === ship.beam
    ? (ship.toStarboard - ship.toPort) * .5 * ppm : 0;
  return L.point(point.x + front * Math.sin(angle) + right * Math.cos(angle), point.y - front * Math.cos(angle) + right * Math.sin(angle));
}

function drawWake(ctx, length, beam, speed, time) {
  const trail = Math.max(13, Math.min(77, length * .92 + speed * 1.7));
  const half = Math.max(.6, beam * .45);
  const stern = length * .46;
  const gradient = ctx.createLinearGradient(0, stern, 0, stern + trail);
  gradient.addColorStop(0, '#bfeceb90');
  gradient.addColorStop(.23, '#a8cbdc40');
  gradient.addColorStop(1, '#bfefff00');
  ctx.strokeStyle = gradient;
  ctx.lineWidth = .9;
  ctx.beginPath();
  ctx.moveTo(-half, stern + 1);
  ctx.quadraticCurveTo(-half * .6, stern + trail * .3, -half - trail * .32, stern + trail);
  ctx.moveTo(half, stern + 1);
  ctx.quadraticCurveTo(half * .6, stern + trail * .3, half + trail * .32, stern + trail);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const progress = (i / 4 + time / 3100) % 1;
    const y = stern + trail * progress;
    ctx.strokeStyle = `rgba(186,229,236,${.23 * (1 - progress)})`;
    ctx.beginPath();
    ctx.moveTo(-half * (1 + progress), y);
    ctx.quadraticCurveTo(0, y + 3 * progress, half * (1 + progress), y);
    ctx.stroke();
  }
}

function drawNavLights(ctx, ship, length, beam) {
  const lamp = (x, y, rgb, radius = 3.3) => {
    pulse(ctx, x, y, radius, rgb, .78);
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.min(1.4, Math.max(.55, length / 55)), 0, 2 * Math.PI);
    ctx.fill();
  };
  if (ship.nav === 5 || ship.nav === 6) return;
  if (ship.nav === 1) {
    lamp(0, -length * .28, '255,246,212');
    if (ship.length >= 50) lamp(0, length * .39, '255,246,212');
    return;
  }
  if (!isMoving(ship) && ship.nav !== 0) return;
  lamp(-beam * .48, -length * .05, '255,46,63');
  lamp(beam * .48, -length * .05, '71,255,151');
  lamp(0, -length * .25, '248,246,229');
  lamp(0, length * .47, '255,245,212');
  if (ship.length >= 50) lamp(0, length * .20, '248,246,229');
}

export class HarborMap {
  tracks = new Map();
  selected = null;
  night = true;
  stale = false;

  constructor(container, selectShip) {
    this.container = container;
    this.selectShip = selectShip;
    this.map = L.map(container, {
      zoomControl: false, attributionControl: false, zoomSnap: .1, zoomDelta: .7,
      minZoom: 10, maxZoom: 19.5, maxBounds: L.latLngBounds(AIS_BOUNDS).pad(.42),
      maxBoundsViscosity: .72, preferCanvas: false,
    });
    this.map.createPane('photos').classList.add('photo-pane');
    this.map.getPane('photos').style.zIndex = '200';
    this.map.createPane('places').style.zIndex = '565';
    L.tileLayer(ESRI, { pane: 'photos', maxNativeZoom: 18, maxZoom: 20, keepBuffer: 3 }).addTo(this.map);
    L.tileLayer(SC, { pane: 'photos', maxZoom: 20, minZoom: 14, maxNativeZoom: 19, keepBuffer: 3, bounds: [[32.705, -80.15], [33.1, -79.778]] }).addTo(this.map);
    L.control.scale({ position: 'bottomleft', maxWidth: 104, imperial: false }).addTo(this.map);
    L.geoJSON(channel, {
      interactive: false,
      style: { className: 'chart-channel', weight: 1, dashArray: '4 5', fillOpacity: .12 },
    }).addTo(this.map);
    const labels = [...LANDMARKS, ...BRIDGES.map(b => [b.label, b.name, 'bridge']),
      ...TERMINALS.map(t => [t.label, `${t.name} Terminal`, `terminal${t.left ? ' left' : ''}`])];
    for (const [position, label, style] of labels) {
      L.marker(position, {
        icon: L.divIcon({ className: `map-label label-${style}`, html: `<span>${label}</span>`, iconSize: [0, 0], iconAnchor: [0, 0] }),
        pane: 'places', interactive: false, keyboard: false,
      }).addTo(this.map);
    }
    this.canvas = L.DomUtil.create('canvas', 'harbor-canvas', container);
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
    import('./models.js').then(({ ShipModels }) => {
      this.models = new ShipModels();
      this.requestDraw();
    }).catch(() => { /* The map can show AIS contacts without WebGL. */ });
    this.shore = SHORE_LIGHTS.flatMap((path, i) => segmentPoints(path, i < 7 ? 28 : 19));
    this.bridges = BRIDGES.flatMap(b => segmentPoints(b.lights, b.name.startsWith('Ravenel') ? 28 : 18));
    this.cranes = TERMINALS.flatMap(t => segmentPoints(t.wharf, t.cranes));
    this.map.on('move zoom resize', () => this.requestDraw());
    this.map.on('click', e => this.onClick(e.containerPoint));
    this.map.on('zoomend', () => this.updateLabels());
    new ResizeObserver(() => { this.map.invalidateSize({ pan: false }); this.requestDraw(); }).observe(container);
    this.home();
  }

  home() {
    this.map.fitBounds(HARBOR_VIEW, { paddingTopLeft: [14, 49], paddingBottomRight: [20, 52], animate: false });
  }

  focus(position, zoom) {
    this.map.flyTo(position, zoom ?? this.map.getZoom(), { animate: !reducedMotion.matches, duration: .9 });
  }

  updateLabels() {
    const zoom = this.map.getZoom();
    if (zoom < 13) return;
    for (const track of this.tracks.values()) {
      if (!track.ship.large || !track.ship.name || track.marker.getTooltip()) continue;
      const text = document.createElement('span');
      text.textContent = track.ship.name;
      track.marker.bindTooltip(text, { className: 'vessel-tooltip', direction: 'top', offset: [0, -5] });
    }
  }

  setTheme(night) { this.night = night; this.requestDraw(); }
  setSelected(id) { this.selected = id; this.requestDraw(); }

  setShips(ships, stale) {
    this.stale = stale;
    const now = performance.now();
    const ids = new Set(ships.map(ship => ship.id));
    for (const [id, track] of this.tracks) {
      if (ids.has(id)) continue;
      track.marker.remove();
      this.tracks.delete(id);
    }
    for (const ship of ships) {
      const prior = this.tracks.get(ship.id);
      if (prior && prior.ship.seen > ship.seen) continue;
      const angle = ship.heading ?? ship.course ?? 0;
      const [from, fromAngle] = prior ? animatePose(prior, now) : [ship.position, angle];
      const distance = this.map.distance(from, ship.position);
      const duration = reducedMotion.matches ? 1 : Math.max(800, Math.min(11_000, 1500 + distance * 1.8));
      const turn = ((angle - fromAngle + 540) % 360 + 360) % 360 - 180;
      const marker = prior?.marker ?? L.marker(ship.position, { icon: fallbackIcon, riseOnHover: true, bubblingMouseEvents: false })
        .addTo(this.map).on('click', () => this.selectShip(ship.id));
      marker.getElement()?.setAttribute('aria-label', ship.name ?? `Vessel MMSI ${ship.id}`);
      this.tracks.set(ship.id, { ship, marker, started: now, from, fromAngle, turn, duration });
    }
    this.updateLabels();
    this.requestDraw();
  }

  onClick(point) {
    let best = Infinity;
    let id = null;
    for (const [key, track] of this.tracks) {
      if (!track.point) continue;
      const dx = point.x - track.point.x;
      const dy = point.y - track.point.y;
      const cross = dx * Math.cos(track.angle) + dy * Math.sin(track.angle);
      const along = -dx * Math.sin(track.angle) + dy * Math.cos(track.angle);
      const distance = Math.hypot(cross / Math.max(13, track.beam / 2), along / Math.max(13, track.length / 2));
      if (distance <= 1 && distance < best) { best = distance; id = key; }
    }
    this.selectShip(id);
  }

  requestDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(now => {
      this.frame = null;
      this.draw(now);
    });
  }

  draw(now) {
    const ctx = this.ctx;
    const { x: width, y: height } = this.map.getSize();
    const density = Math.min(2, devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(width * density) || this.canvas.height !== Math.round(height * density)) {
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.canvas.width = Math.round(width * density);
      this.canvas.height = Math.round(height * density);
    }
    ctx.setTransform(density, 0, 0, density, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (this.night) {
      const at = this.map.getCenter();
      const key = `${width}/${height}/${density}/${this.map.getZoom()}/${at.lat}/${at.lng}`;
      if (this.lightsKey !== key) {
        this.lightsKey = key;
        this.lights ??= document.createElement('canvas');
        this.lights.width = this.canvas.width;
        this.lights.height = this.canvas.height;
        const lightContext = this.lights.getContext('2d');
        lightContext.setTransform(density, 0, 0, density, 0, 0);
        this.drawShore(lightContext);
      }
      ctx.drawImage(this.lights, 0, 0, width, height);
    }
    const zoom = this.map.getZoom();
    const world = 256 * 2 ** zoom / 40_075_016.7;
    let animating = false;
    let wake = false;
    const reportTime = Date.now();
    const tracks = [...this.tracks.values()].sort((a, b) => Number(a.ship.large) - Number(b.ship.large));
    for (const track of tracks) {
      const { ship, marker } = track;
      const [position, heading, changing] = animatePose(track, now);
      const ppm = world / Math.cos(position[0] * radians);
      const angle = heading * radians;
      const p = hullCenter(this.map.latLngToContainerPoint(position), ship, angle, ppm);
      const length = ship.length * ppm;
      const beam = ship.beam * ppm;
      const visible = p.x >= -length - 50 && p.y >= -length - 50 && p.x <= width + length + 50 && p.y <= height + length + 50;
      if (changing || !track.point || this.map.distance(marker.getLatLng(), position) > .25 || track.scale !== ppm) {
        marker.setLatLng(this.map.containerPointToLatLng(p));
      }
      Object.assign(track, { point: p, length, beam, angle, scale: ppm });
      if (!visible) continue;
      animating ||= changing;
      const moving = isMoving(ship) && !this.stale && reportTime - Date.parse(ship.seen) < AGING_REPORT;
      const aged = this.stale || reportTime - Date.parse(ship.seen) >= AGING_REPORT;
      wake ||= moving;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = aged ? .53 : 1;
      const small = !ship.large;
      const contactColor = small ? '#ffd08a' : '#91f7e9';
      if (length < 23 || !beam || this.selected === ship.id) {
        const radius = Math.min(36, Math.max(small ? 4 : 8, length * .54 + 3));
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.strokeStyle = this.selected === ship.id ? '#f5fff7' : `${contactColor}${small ? '60' : 'a4'}`;
        ctx.lineWidth = this.selected === ship.id ? 1.45 : .8;
        ctx.stroke();
      }
      ctx.rotate(angle);
      if (moving && ship.course != null && length > 3) {
        const wakeAngle = (ship.course - heading) * radians;
        ctx.rotate(wakeAngle);
        drawWake(ctx, length, beam, ship.speed, reducedMotion.matches ? 0 : now);
        ctx.rotate(-wakeAngle);
      }
      const hasDirection = ship.heading != null || ship.course != null;
      const model = hasDirection && length >= 5 && beam > 0 ? this.models?.sprite(ship.category, beam / length, this.night) : null;
      if (model) {
        const size = length * 1.272;
        ctx.shadowColor = '#001923a7';
        ctx.shadowOffsetY = Math.min(6, length * .09);
        ctx.shadowBlur = Math.min(12, length * .17);
        ctx.drawImage(model, -size / 2, -size / 2, size, size);
        ctx.shadowColor = 'transparent';
      } else {
        ctx.fillStyle = contactColor;
        ctx.beginPath();
        if (!hasDirection) ctx.arc(0, 0, small ? 1.7 : 2.6, 0, Math.PI * 2);
        else {
          ctx.moveTo(0, small ? -3 : -5);
          ctx.lineTo(small ? 2.1 : 3.3, small ? 3 : 4);
          ctx.lineTo(small ? -2.1 : -3.3, small ? 3 : 4);
          ctx.closePath();
        }
        ctx.fill();
      }
      if (this.night && model) drawNavLights(ctx, ship, length, beam);
      ctx.restore();
    }
    if (animating) this.requestDraw();
    else if (wake && !reducedMotion.matches && !this.wakeTimer) {
      this.wakeTimer = setTimeout(() => { this.wakeTimer = null; this.requestDraw(); }, 65);
    }
  }

  drawShore(ctx) {
    const zoom = this.map.getZoom();
    const scale = Math.max(.65, Math.min(1.65, 2 ** ((zoom - 12) / 3)));
    const paint = (position, rgb, radius, opacity) => {
      const p = this.map.latLngToContainerPoint(position);
      if (p.x < -30 || p.y < -30 || p.x > this.map.getSize().x + 30 || p.y > this.map.getSize().y + 30) return;
      pulse(ctx, p.x, p.y, radius * scale, rgb, opacity);
    };
    this.shore.forEach((p, i) => paint(p, i % 4 ? '255,179,98' : '235,240,203', i % 9 ? 2.25 : 5.5, .17 + i % 7 * .055));
    this.bridges.forEach((p, i) => paint(p, '255,205,124', i % 5 ? 3 : 6, .43));
    this.cranes.forEach(p => paint(p, '255,211,128', 8.5, .68));
    for (const bridge of BRIDGES) for (const tower of bridge.towers) {
      paint(tower, '248,218,168', 10, .57);
      paint(tower, '255,72,65', 3.3, .87);
    }
  }
}

import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/400-italic.css';
import '@fontsource/barlow/500-italic.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import './styles.css';

import * as THREE from 'three';
import { Stage } from './scene/stage.js';
import { Env } from './scene/env.js';
import { Ground } from './scene/ground.js';
import { LightField, buildCityLights, renderLightMap } from './scene/lights.js';
import { buildCranes, buildChannel, buildPiers } from './scene/structures.js';
import { buildAids } from './scene/aids.js';
import { Fleet } from './scene/fleet.js';
import { Feed } from './data.js';
import { Panel } from './ui/panel.js';
import { Labels } from './ui/labels.js';
import { Pins } from './ui/pins.js';
import { renderCard, renderInfo } from './ui/card.js';
import { Layers } from './layers.js';
import { LANDMARKS, HISTORIC_WRECKS, chartedWreck } from './places.js';
import { currentAt } from './facts.js';
import { toWorld } from './geo.js';
import { clock, clockSmart } from './util.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

function loadTexture(url) {
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, () => reject(new Error(`could not load ${url}`))));
}

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url}`);
  return res.json();
}

/**
 * The water mask on the CPU, for placing vessels. Returns two lookups by world position:
 * `wet` is water coverage (0..1) and `open` is the same with piers, bridges and jetties
 * counted as obstacles.
 */
function waterSamplers(image, b) {
  const w = image.width, h = image.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const wet = new Uint8Array(w * h);
  const open = new Uint8Array(w * h);
  for (let i = 0; i < wet.length; i++) {
    wet[i] = px[i * 4];
    open[i] = Math.round((px[i * 4] * (255 - px[i * 4 + 1])) / 255);
  }
  const lookup = (arr) => (x, y) => {
    const u = Math.floor(((x - b.west) / (b.east - b.west)) * w);
    const v = Math.floor(((b.north - y) / (b.north - b.south)) * h);
    return u < 0 || v < 0 || u >= w || v >= h ? 0 : arr[v * w + u] / 255;
  };
  // The same mask read smoothly between its pixels, which is where the shore is drawn.
  const soft = (x, y) => {
    const fu = ((x - b.west) / (b.east - b.west)) * w - 0.5, fv = ((b.north - y) / (b.north - b.south)) * h - 0.5;
    const u0 = Math.floor(fu), v0 = Math.floor(fv);
    if (u0 < 0 || v0 < 0 || u0 >= w - 1 || v0 >= h - 1) return 0;
    const a = fu - u0, c = fv - v0, i = v0 * w + u0;
    return ((wet[i] * (1 - a) + wet[i + 1] * a) * (1 - c) + (wet[i + w] * (1 - a) + wet[i + w + 1] * a) * c) / 255;
  };
  return { wet: lookup(wet), open: lookup(open), soft };
}

function savedMode() {
  try {
    const m = localStorage.getItem('harbor-mode');
    return m === 'day' || m === 'night' ? m : 'auto';
  } catch {
    return 'auto';
  }
}

async function boot() {
  const canvas = $('map');
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) throw new Error('This browser cannot draw the 3D map (WebGL 2 is not available).');

  const [geo, harbor, chart, hires, bin, base, mask, tint] = await Promise.all([
    loadJson('/data/geo.json'),
    loadJson('/data/harbor.json'),
    loadJson('/data/chart.json'),
    loadJson('/data/hires.json').catch(() => null), // sharp close-up tiles are optional
    fetch('/data/lights.bin').then((r) => {
      if (!r.ok) throw new Error('could not load the light positions');
      return r.arrayBuffer();
    }),
    loadTexture('/data/base.jpg'),
    loadTexture('/data/mask.png'),
    loadTexture('/data/tint.jpg'),
  ]);

  const stage = new Stage(canvas, geo.base);
  const env = new Env(stage);
  const ground = new Ground(stage, env, { base, mask, tint }, geo, hires);
  const noise = ground.shared.uNoise.value;

  // Fixed lights, and the light map the ground and water use at night.
  const city = buildCityLights(bin, harbor, env.uniforms);
  stage.scene.add(city.mesh);
  const lightMap = renderLightMap(stage.renderer, city, geo.base);
  env.uniforms.uLightMap.value = lightMap.texture;

  const shipLights = new LightField(6000, env.uniforms, { dynamic: true, minPx: 3.2 });
  shipLights.mesh.renderOrder = 21;
  stage.scene.add(shipLights.mesh);

  const fleet = new Fleet(stage, env, harbor, shipLights, noise);
  const water = waterSamplers(mask.image, geo.base);
  fleet.waterAt = water.open;
  fleet.wetAt = water.wet;
  fleet.shoreAt = water.soft;
  buildCranes(stage.scene, harbor, fleet.glow);
  buildPiers(stage.scene, harbor, fleet.glow);
  const channel = buildChannel(stage.scene, harbor, env.uniforms);
  const aids = buildAids(stage.scene, chart, env.uniforms, fleet.glow);
  const labels = new Labels($('labels'), stage, harbor);

  const feed = new Feed();
  const extras = new Feed('/api/extras', ['weather', 'currents', 'marine', 'inbound', 'dolphins']);
  const logFeed = new Feed('/api/log', ['log']);

  // ------------------------------------------------------------ the card
  // One card shows either the selected ship or a pin, an alert or a ship at sea.
  // It opens compact so the map stays in view. On a phone it sits at the bottom of
  // the screen, and the map slides so the ship is in the part left uncovered.

  const card = $('card');
  const board = $('board');
  const phone = window.matchMedia('(max-width: 820px)');
  const stories = new Map();          // IMO number -> backstory, 'loading' or null
  let selected = null;                // MMSI of the selected ship
  let info = null;                    // or the thing the card shows instead
  let expanded = false;

  const cardContext = (e) => ({
    harbor,
    tideFt: feed.state.tide.data?.level?.ft ?? null,
    expanded,
    story: e.v.imo ? stories.get(e.v.imo) : null,
  });
  const drawCard = (now = Date.now()) => {
    const e = selected != null ? fleet.entities.get(selected) : null;
    if (e) renderCard(card, e, now, cardContext(e));
    else if (info) renderInfo(card, info);
    card.hidden = !e && !info;
    // On a phone the card takes the board's place at the bottom of the screen.
    root.classList.toggle('card-open', !card.hidden);
  };
  const loadStory = async (imo) => {
    if (!imo || stories.has(imo)) return;
    stories.set(imo, 'loading');
    let story = null;
    try {
      const res = await fetch(`/api/ship?imo=${imo}`);
      const body = await res.json();
      if (res.ok && body.ok) story = body;
    } catch {
      /* no backstory is shown, and the rest of the card is unaffected */
    }
    stories.set(imo, story);
    drawCard();
  };

  /** How far the middle of the uncovered part of the map is from the middle of the map, in pixels. */
  const freeOffset = () => {
    const s = $('stage').getBoundingClientRect();
    let left = 0, right = s.width, top = 0, bottom = s.height;
    if (phone.matches) {
      top = 56;
      bottom = Math.min(bottom, (card.hidden ? board : card).getBoundingClientRect().top - s.top);
    } else if (!card.hidden) {
      left = card.getBoundingClientRect().right - s.left;
    }
    return { dx: (left + right) / 2 - s.width / 2, dy: (top + bottom) / 2 - s.height / 2, left, right, top, bottom };
  };
  /** Fly so that a world point lands in the middle of the uncovered part of the map. */
  const flyToPoint = (x, y, h, seconds) => {
    const f = freeOffset();
    let hh = Math.min(Math.max(h, stage.minHeight), stage.maxHeight);
    let cx, cy;
    // The map stops at the edge of its imagery. Near an edge the view moves in
    // closer until the point can sit where it is wanted.
    for (let i = 0; i < 5; i++) {
      const mpp = hh / stage.height;
      cx = x - f.dx * mpp;
      cy = y + f.dy * mpp;
      const [ix, iy] = stage.inside(cx, cy, hh);
      if (Math.hypot(ix - cx, iy - cy) < 30 * mpp || hh <= stage.minHeight) break;
      hh = Math.max(hh * 0.7, stage.minHeight);
    }
    stage.flyTo(cx, cy, hh, seconds);
    stage.userMoved = true;
  };
  const flyToShip = (e) => {
    if (!e || !e.centre) return;
    flyToPoint(e.centre.x, e.centre.y, Math.min(Math.max((e.v.length || 40) * 5.5, 600), 3200), 1.9);
  };
  /** After a tap on the map: slide the map only if the card would hide what was tapped. */
  const reveal = (x, y) => {
    const f = freeOffset();
    const p = stage.worldToScreen(x, y, 0);
    const m = 36;
    if (p.x > f.left + m && p.x < f.right - m && p.y > f.top + m && p.y < f.bottom - m) return;
    flyToPoint(x, y, stage.viewHeight, 0.7);
  };

  const sheet = (open) => {
    board.classList.toggle('is-open', open);
    $('sheet-handle').setAttribute('aria-expanded', String(open));
    // On a phone the closed board is only its handle, so its contents take no focus.
    $('board-body').inert = phone.matches && !open;
  };

  const select = (mmsi, fly = false) => {
    selected = mmsi;
    info = null;
    fleet.select(mmsi);
    const e = mmsi != null ? fleet.entities.get(mmsi) : null;
    delete card.dataset.key;
    if (e && expanded) loadStory(e.v.imo);
    drawCard();
    if (e) {
      if (phone.matches) sheet(false);
      // The card has to be laid out before the uncovered part of the map is known.
      requestAnimationFrame(() => (fly ? flyToShip(e) : e.centre && reveal(e.centre.x, e.centre.y)));
    }
    panel.renderShips(fleet, harbor, feed, selected);
  };
  const showInfo = (item) => {
    selected = null;
    fleet.select(null);
    info = item;
    delete card.dataset.key;
    drawCard();
    if (phone.matches) sheet(false);
    if (item.at) requestAnimationFrame(() => reveal(item.at.x, item.at.y));
    panel.renderShips(fleet, harbor, feed, selected);
  };
  const closeCard = () => {
    info = null;
    select(null);
  };
  card.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closeCard();
    else if (act === 'zoom' && info && info.at) flyToPoint(info.at.x, info.at.y, 2600, 1.6);
    else if (act === 'zoom') flyToShip(fleet.entities.get(selected));
    else if (act === 'more') {
      expanded = !expanded;
      const e = fleet.entities.get(selected);
      if (e && expanded) loadStory(e.v.imo);
      drawCard();
      card.scrollTop = 0;
      if (e && e.centre) requestAnimationFrame(() => reveal(e.centre.x, e.centre.y));
    }
  });
  stage.onPick = (x, y) => {
    const e = fleet.pick(x, y);
    if (e) select(e.mmsi);
    else closeCard();
  };
  stage.onHover = (x, y) => canvas.classList.toggle('is-over', x >= 0 && !!fleet.pick(x, y));
  // Safari on a phone would otherwise zoom the whole page when a pinch starts on a button or a pin.
  for (const type of ['gesturestart', 'gesturechange']) $('stage').addEventListener(type, (ev) => ev.preventDefault());
  canvas.addEventListener('pointerdown', () => canvas.classList.add('is-dragging'));
  window.addEventListener('pointerup', () => canvas.classList.remove('is-dragging'));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !card.hidden && $('layers').hidden) closeCard();
  });

  // The board is a sheet on a phone: its handle opens and closes it, by tap or swipe.
  const handle = $('sheet-handle');
  let swipe = null;
  handle.addEventListener('pointerdown', (ev) => {
    swipe = { y: ev.clientY, done: false };
    handle.setPointerCapture(ev.pointerId);
  });
  // The sheet moves as soon as the finger has clearly gone up or down, without waiting for it to lift.
  handle.addEventListener('pointermove', (ev) => {
    if (!swipe || swipe.done) return;
    const dy = ev.clientY - swipe.y;
    if (Math.abs(dy) > 14) {
      sheet(dy < 0);
      swipe.done = true;
    }
  });
  handle.addEventListener('pointercancel', () => {
    swipe = null;
  });
  handle.addEventListener('click', () => {
    if (!swipe || !swipe.done) sheet(!board.classList.contains('is-open'));
    swipe = null;
  });
  phone.addEventListener('change', () => sheet(false));
  sheet(false);

  // ------------------------------------------------------------ panel, pins and layers

  const panel = new Panel({ onSelect: (mmsi) => select(mmsi, true), onInfo: showInfo });
  const pins = new Pins($('pins'), stage, showInfo);
  const place = (lat, lon) => toWorld(lat, lon);
  const inMap = (p) => p.x > geo.base.west + 300 && p.x < geo.base.east - 300 && p.y > geo.base.south + 300 && p.y < geo.base.north - 300;
  const pinned = (list) => list.map((l) => {
    const at = place(l.at[0], l.at[1]);
    return { ...l, at, x: at.x, y: at.y, label: l.title };
  }).filter((l) => inMap(l));
  pins.set('landmarks', pinned(LANDMARKS));
  pins.set('wrecks', [
    ...pinned(HISTORIC_WRECKS),
    ...chart.wrecks.map((w) => { const c = chartedWreck(w); return { ...c, at: { x: w[0], y: w[1] }, x: w[0], y: w[1], label: c.title, minor: true }; }).filter((w) => inMap(w)),
  ]);

  const drawDolphins = () => {
    const d = extras.state.dolphins.data;
    pins.set('dolphins', ((d && d.sightings) || []).map((o) => {
      const at = place(o.lat, o.lon);
      const when = o.on ? clockSmart(Date.parse(`${o.on}T12:00:00-05:00`)).split(',').slice(0, 2).join(',') : 'date not given';
      return {
        x: at.x, y: at.y, at, label: `Bottlenose dolphin sighting, ${when}`,
        title: 'Bottlenose dolphin sighting',
        sub: `Seen ${when}${o.place ? `, ${o.place}` : ''}`,
        text: ['Dolphins live in the harbor all year. They work the tide lines along the channel and follow the shrimp boats into Shem Creek.'],
        note: `Reported on iNaturalist${o.by ? ` by ${o.by}` : ''}${o.license ? ` (${o.license.toUpperCase()})` : ''}.`,
        links: [{ href: `https://www.inaturalist.org/observations/${o.id}`, text: 'See the sighting on iNaturalist' }],
      };
    }).filter((o) => inMap(o)));
  };
  const drawCurrents = (now = Date.now()) => {
    const d = extras.state.currents.data;
    pins.set('currents', ((d && d.stations) || []).map((s) => {
      const kn = currentAt(s.events, now);
      if (kn == null) return null;
      const at = place(s.lat, s.lon);
      const speed = Math.abs(kn);
      const flood = kn >= 0;
      const slack = speed < 0.15;
      const next = s.events.find((e) => Date.parse(e[0]) > now);
      const text = slack ? 'slack' : `${speed.toFixed(1)} kn ${flood ? 'flood' : 'ebb'}`;
      return {
        x: at.x, y: at.y, at, kn: speed, deg: (flood ? s.floodDeg : s.ebbDeg) ?? 0, tag: text,
        label: `Tidal current, ${s.name}: ${text}`,
        title: s.name,
        sub: slack ? 'Slack water, the tide is turning' : `${speed.toFixed(1)} knots, ${flood ? 'flooding in from the sea' : 'ebbing out to sea'}`,
        rows: next ? [[next[1] === 0 ? 'Next slack' : `Next peak ${next[1] > 0 ? 'flood' : 'ebb'}`, `${clock(Date.parse(next[0]))}${next[1] ? `, ${Math.abs(next[1]).toFixed(1)} knots` : ''}`]] : [],
        note: `A NOAA tidal current prediction for station ${s.id}, not a measurement. Wind and river flow change the real current.`,
        links: [{ href: `https://tidesandcurrents.noaa.gov/noaacurrents/predictions.html?id=${s.id}_1`, text: 'NOAA predictions for this station' }],
      };
    }).filter(Boolean));
  };

  const layers = new Layers($('layers'), $('layers-btn'));
  layers.onChange((id, on) => {
    if (id === 'names') labels.showShips = on;
    else if (id === 'small') fleet.setShowOthers(on);
    else if (id === 'channel') {
      channel.group.visible = on;
      labels.showChannel = on;
    } else if (id === 'aids') aids.setVisible(on);
    else if (id === 'currents' || id === 'landmarks' || id === 'wrecks' || id === 'dolphins') pins.show(id, on);
    else if (id in panel.show) {
      panel.show[id] = on;
      panel.renderWeather(extras);
      panel.renderMarine(extras);
      panel.renderInbound(extras);
      panel.renderLog(logFeed);
    }
  });

  feed.onUpdate(() => {
    const ais = feed.state.ais;
    if (ais.data && !feed.loading) fleet.setData(ais.data.vessels || [], feed.nextAt);
    panel.renderConditions(feed);
    panel.renderStatus(feed);
    panel.renderCredits(feed);
    // The lists read berth and state from the fleet, which settles on the next frame.
    requestAnimationFrame(() => {
      panel.renderShips(fleet, harbor, feed, selected);
      panel.renderSummary(feed, fleet);
      if (selected != null && !fleet.entities.has(selected)) select(null);
    });
  });
  extras.onUpdate(() => {
    if (extras.loading) return;
    panel.renderWeather(extras);
    panel.renderMarine(extras);
    panel.renderInbound(extras);
    drawDolphins();
    drawCurrents();
  });
  logFeed.onUpdate(() => {
    if (!logFeed.loading) panel.renderLog(logFeed);
  });

  // ------------------------------------------------------------ day and night

  const modeButtons = [...document.querySelectorAll('.mode button')];
  const setMode = (mode) => {
    env.setMode(mode);
    for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    try {
      localStorage.setItem('harbor-mode', mode);
    } catch {
      /* private window: the choice just lasts for this visit */
    }
    modeNote();
  };
  const modeNote = () => {
    const st = env.state;
    const next = st.next ? `${st.next.kind} at ${clock(st.next.at)}` : '';
    let text;
    if (env.mode === 'auto') text = st.isNight ? `Night view until ${next}` : `Day view until ${next}`;
    else text = `${env.mode === 'day' ? 'Day' : 'Night'} view held. Next ${next}.`;
    if ($('mode-note').textContent !== text) $('mode-note').textContent = text;
  };
  env.onChange = (isNight) => {
    root.dataset.theme = isNight ? 'night' : 'day';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', isNight ? '#071019' : '#eef3f2');
  };
  for (const b of modeButtons) b.addEventListener('click', () => setMode(b.dataset.mode));
  env.mode = savedMode();
  for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === env.mode));

  $('zoom-in').addEventListener('click', () => stage._zoomAt(stage.width / 2, stage.height / 2, 0.6));
  $('zoom-out').addEventListener('click', () => stage._zoomAt(stage.width / 2, stage.height / 2, 1 / 0.6));
  $('zoom-home').addEventListener('click', () => stage.home());

  new ResizeObserver(() => {
    if (stage.resize()) labels.remeasure();
  }).observe($('stage'));
  document.fonts?.ready.then(() => labels.remeasure());

  // ------------------------------------------------------------ frame loop

  let last = performance.now();
  let lastTick = 0;
  let lastSlow = 0;
  let first = true;
  const frame = (t) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    const now = Date.now();
    stage.update(dt);
    env.update(now, dt, t / 1000);
    if (first) {
      // Start in the right mode without the dimmer animation.
      env.night = env.isNight ? 1 : 0;
      env.onChange(env.isNight);
      env.update(now, 0, t / 1000);
    }
    ground.update(dt, t);
    fleet.update(dt, now);
    channel.update(env.night, stage.dpr);
    aids.update(env.night);
    city.uniforms.uStrength.value = env.night;
    labels.update(fleet, selected);
    pins.update();
    stage.render();
    if (t - lastTick > 1000) {
      lastTick = t;
      panel.tick(now);
      panel.renderStatus(feed, now);
      modeNote();
      if (selected != null) drawCard(now);
    }
    if (t - lastSlow > 60000) {
      // The current turns slowly, so its arrows are redrawn once a minute.
      lastSlow = t;
      drawCurrents(now);
    }
    if (first) {
      first = false;
      $('loading').classList.add('is-done');
    }
  };
  panel.tick();
  panel.renderShips(fleet, harbor, feed, selected);
  panel.renderStatus(feed);
  panel.renderCredits(feed);
  feed.start();
  extras.start();
  logFeed.start();
  requestAnimationFrame(frame);

  // Handy when checking the page from the console.
  window.__harbor = { stage, env, fleet, feed, extras, logFeed, ground, layers };
}

boot().catch((err) => {
  console.error(err);
  const el = $('loading');
  el.classList.add('is-error');
  el.querySelector('p').textContent = `The harbor view could not start: ${err.message}`;
});

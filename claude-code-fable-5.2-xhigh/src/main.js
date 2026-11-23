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
import { Fleet } from './scene/fleet.js';
import { Feed } from './data.js';
import { Panel } from './ui/panel.js';
import { Labels } from './ui/labels.js';
import { renderCard } from './ui/card.js';
import { clock } from './util.js';

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
  return { wet: lookup(wet), open: lookup(open) };
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

  const [geo, harbor, hires, bin, base, mask, tint] = await Promise.all([
    loadJson('/data/geo.json'),
    loadJson('/data/harbor.json'),
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
  buildCranes(stage.scene, harbor, fleet.glow);
  buildPiers(stage.scene, harbor, fleet.glow);
  const channel = buildChannel(stage.scene, harbor, env.uniforms);
  const labels = new Labels($('labels'), stage, harbor);

  // ------------------------------------------------------------ selection and card

  const card = $('card');
  let selected = null;
  const flyToShip = (e) => {
    if (!e || !e.centre) return;
    const h = Math.min(Math.max((e.v.length || 40) * 5.5, 600), 3200);
    stage.flyTo(e.centre.x, e.centre.y, h, 1.9);
    stage.userMoved = true;
  };
  const select = (mmsi, fly = false) => {
    selected = mmsi;
    fleet.select(mmsi);
    const e = mmsi != null ? fleet.entities.get(mmsi) : null;
    if (e) {
      delete card.dataset.key;
      renderCard(card, e);
      card.hidden = false;
      if (fly) flyToShip(e);
    } else {
      card.hidden = true;
    }
    panel.renderShips(fleet, harbor, feed, selected);
  };
  card.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') select(null);
    else if (act === 'zoom') flyToShip(fleet.entities.get(selected));
    else if (act === 'harbor') stage.home();
  });
  stage.onPick = (x, y) => {
    const e = fleet.pick(x, y);
    select(e ? e.mmsi : null);
  };
  stage.onHover = (x, y) => canvas.classList.toggle('is-over', x >= 0 && !!fleet.pick(x, y));
  canvas.addEventListener('pointerdown', () => canvas.classList.add('is-dragging'));
  window.addEventListener('pointerup', () => canvas.classList.remove('is-dragging'));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && selected != null) select(null);
  });

  // ------------------------------------------------------------ panel and data

  const feed = new Feed();
  const panel = new Panel({
    onSelect: (mmsi) => select(mmsi, true),
    onToggleOthers: (on) => {
      fleet.showOthers = on;
    },
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
      if (selected != null && !fleet.entities.has(selected)) select(null);
    });
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
    city.uniforms.uStrength.value = env.night;
    labels.update(fleet, selected);
    stage.render();
    if (t - lastTick > 1000) {
      lastTick = t;
      panel.tick(now);
      panel.renderStatus(feed, now);
      modeNote();
      const e = selected != null ? fleet.entities.get(selected) : null;
      if (e) renderCard(card, e, now);
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
  requestAnimationFrame(frame);

  // Handy when checking the page from the console.
  window.__harbor = { stage, env, fleet, feed, ground };
}

boot().catch((err) => {
  console.error(err);
  const el = $('loading');
  el.classList.add('is-error');
  el.querySelector('p').textContent = `The harbor view could not start: ${err.message}`;
});

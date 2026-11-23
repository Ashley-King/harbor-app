// The things a visitor can switch on and off, and the small panel that does it.
// Choices are remembered in this browser. Nothing is sent anywhere.

import { esc } from './util.js';

export const LAYERS = [
  { id: 'names', group: 'On the map', label: 'Ship names', on: true },
  { id: 'small', group: 'On the map', label: 'Small craft', hint: 'Yachts, fishing boats and workboats', on: true },
  { id: 'channel', group: 'On the map', label: 'Shipping channel', hint: 'The dredged channel and its reach names', on: true },
  { id: 'aids', group: 'On the map', label: 'Buoys and beacons', hint: 'With their real flash patterns at night', on: true },
  { id: 'currents', group: 'On the map', label: 'Tidal currents', hint: 'Predicted flow at eight points along the channel', on: true },
  { id: 'landmarks', group: 'On the map', label: 'Landmarks', hint: 'Forts, the Yorktown, the lighthouse', on: true },
  { id: 'wrecks', group: 'On the map', label: 'Shipwrecks', hint: 'Named wrecks with their stories, and the rest of the chart', on: true },
  { id: 'dolphins', group: 'On the map', label: 'Dolphin sightings', hint: 'Reported on iNaturalist in the last 90 days', on: true },
  { id: 'weather', group: 'On the board', label: 'Weather and water', hint: 'Wind, temperatures and pressure', on: true },
  { id: 'alerts', group: 'On the board', label: 'Marine alerts and forecast', on: true },
  { id: 'inbound', group: 'On the board', label: 'Ships arriving from sea', on: true },
  { id: 'log', group: 'On the board', label: 'Harbor log', hint: 'Arrivals, departures and the biggest ship', on: true },
];

// The name changes when the defaults do, so an old saved choice does not hide a new default.
const STORE = 'harbor-layers-2';

export class Layers {
  /** `panel` is the element to fill, `button` opens and closes it. */
  constructor(panel, button) {
    this.panel = panel;
    this.button = button;
    this.listeners = [];
    this.state = Object.fromEntries(LAYERS.map((l) => [l.id, l.on]));
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
      for (const l of LAYERS) if (typeof saved[l.id] === 'boolean') this.state[l.id] = saved[l.id];
    } catch {
      /* private window or a damaged entry: the defaults apply */
    }
    this._render();
    button.addEventListener('click', () => this.toggle());
    panel.addEventListener('change', (ev) => {
      const id = ev.target.dataset.layer;
      if (id in this.state) this.set(id, ev.target.checked);
    });
    panel.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-act=close]')) this.toggle(false);
    });
    // A click anywhere else, or Escape, puts the panel away.
    document.addEventListener('pointerdown', (ev) => {
      if (!panel.hidden && !panel.contains(ev.target) && !button.contains(ev.target)) this.toggle(false);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !panel.hidden) {
        this.toggle(false);
        button.focus();
      }
    });
  }

  get(id) {
    return !!this.state[id];
  }

  set(id, on) {
    this.state[id] = !!on;
    try {
      localStorage.setItem(STORE, JSON.stringify(this.state));
    } catch {
      /* private window: the choice lasts for this visit */
    }
    for (const fn of this.listeners) fn(id, !!on);
  }

  /** Call fn(id, on) for every layer now, and again whenever one changes. */
  onChange(fn) {
    this.listeners.push(fn);
    for (const l of LAYERS) fn(l.id, this.state[l.id]);
  }

  toggle(open = this.panel.hidden) {
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('layers-open', open);
  }

  _render() {
    const groups = [...new Set(LAYERS.map((l) => l.group))];
    this.panel.innerHTML = `
      <header><h2>Layers</h2><button type="button" class="close" data-act="close" aria-label="Close layers">&times;</button></header>
      ${groups.map((g) => `<fieldset><legend>${esc(g)}</legend>${LAYERS.filter((l) => l.group === g).map((l) => `
        <label class="switch"><input type="checkbox" role="switch" data-layer="${l.id}"${this.state[l.id] ? ' checked' : ''} />
          <span class="track" aria-hidden="true"></span>
          <span class="text">${esc(l.label)}${l.hint ? `<small>${esc(l.hint)}</small>` : ''}</span></label>`).join('')}</fieldset>`).join('')}`;
  }
}

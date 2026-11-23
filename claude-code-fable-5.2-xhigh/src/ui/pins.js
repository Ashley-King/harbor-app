// Pins on the map: landmarks, wrecks, dolphin sightings and tidal current arrows.
// They are HTML buttons laid over the canvas, so they stay sharp at any zoom and
// work with a keyboard and a screen reader. Each kind is a layer that can be hidden.

import { esc } from '../util.js';

// One small picture per kind, drawn on a 24 by 24 grid.
const ICONS = {
  // a star fort
  landmarks: '<path d="M12 3.5l2.3 4.6 5.1.7-3.7 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.7-3.6 5.1-.7z" fill="#fff"/>',
  // the chart symbol for a wreck: a hull line crossed by three ribs
  wrecks: '<path d="M4.5 12h15M8 8.5v7M12 7.5v9M16 8.5v7" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>',
  // a dorsal fin over a wave
  dolphins: '<path d="M6.5 14.5c1.5-5 5-8.5 9.5-9-1.8 2.6-1.6 6 .8 9z" fill="#fff"/><path d="M4 17.5c1.4-1.3 2.7-1.3 4 0s2.7 1.3 4 0 2.7-1.3 4 0 2.7 1.3 4 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
};

const ARROW = '<svg class="arrow" viewBox="-14 -14 28 28" aria-hidden="true"><g><path d="M0-12l5 7.5h-3.2v15.5h-3.6v-15.5h-5z"/></g></svg>';

export class Pins {
  /** onOpen(item) is called when a pin is chosen. */
  constructor(container, stage, onOpen) {
    this.el = container;
    this.stage = stage;
    this.layers = new Map();
    // A drag or pinch that starts on a pin moves the map like any other.
    stage.adopt(container);
    container.addEventListener('click', (ev) => {
      const node = ev.target.closest('.pin');
      if (!node || performance.now() - stage.gestureEndedAt < 350) return;
      const layer = this.layers.get(node.dataset.layer);
      const item = layer && layer.items[Number(node.dataset.i)];
      if (item) onOpen(item);
    });
  }

  /**
   * Replace the pins of one layer. Each item: { x, y, label } in world metres, plus
   * whatever the card needs. Current stations also carry { deg, kn, tag }.
   */
  set(id, items) {
    let layer = this.layers.get(id);
    if (!layer) {
      layer = { items: [], nodes: [], visible: true };
      this.layers.set(id, layer);
    }
    for (const n of layer.nodes) n.remove();
    layer.items = items;
    layer.nodes = items.map((item, i) => {
      const node = document.createElement('button');
      node.type = 'button';
      // A minor pin is drawn smaller: an unnamed wreck beside the ones with a story.
      node.className = `pin k-${id}${item.minor ? ' is-minor' : ''}`;
      node.dataset.layer = id;
      node.dataset.i = String(i);
      node.setAttribute('aria-label', item.label);
      node.title = item.label;
      if (id === 'currents') {
        node.innerHTML = `${ARROW}<span class="tag">${esc(item.tag)}</span>`;
        // The arrow points the way the water is going and grows with its speed.
        const scale = item.kn < 0.15 ? 0.5 : Math.min(1, 0.6 + item.kn * 0.16);
        node.querySelector('g').setAttribute('transform', `rotate(${Math.round(item.deg)}) scale(${scale.toFixed(2)})`);
        node.classList.toggle('is-slack', item.kn < 0.15);
      } else {
        node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>`;
      }
      node.hidden = !layer.visible;
      this.el.appendChild(node);
      return node;
    });
  }

  show(id, on) {
    let layer = this.layers.get(id);
    if (!layer) {
      layer = { items: [], nodes: [], visible: on };
      this.layers.set(id, layer);
    }
    layer.visible = on;
    for (const n of layer.nodes) n.hidden = !on;
  }

  /** Move every visible pin to its place on screen. Called once a frame. */
  update() {
    const stage = this.stage;
    const W = stage.width, H = stage.height;
    // Current speeds are written out only when there is room for them.
    this.el.classList.toggle('is-wide', stage.mpp > 16);
    for (const layer of this.layers.values()) {
      if (!layer.visible) continue;
      for (let i = 0; i < layer.nodes.length; i++) {
        const item = layer.items[i], node = layer.nodes[i];
        const p = stage.worldToScreen(item.x, item.y, 0);
        const on = p.x > -30 && p.y > -30 && p.x < W + 30 && p.y < H + 30;
        if (on) node.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        if (node.hidden === on) node.hidden = !on;
      }
    }
  }
}

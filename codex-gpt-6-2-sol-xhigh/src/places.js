export const HARBOR_VIEW = [[32.724, -79.976], [32.917, -79.803]];
export const CHARLESTON = [32.7808, -79.9236];

export const TERMINALS = [
  { id: 'wando', name: 'Wando Welch', label: [32.8317, -79.8899], wharf: [[32.8295, -79.893], [32.8378, -79.8893]], radius: 165, cranes: 15 },
  { id: 'north', name: 'North Charleston', label: [32.905, -79.9555], wharf: [[32.9002, -79.9612], [32.9062, -79.9544]], radius: 155, cranes: 5 },
  { id: 'hl', name: 'Leatherman', label: [32.8406, -79.9349], left: true, wharf: [[32.8375, -79.9325], [32.8424, -79.9336]], radius: 150, cranes: 5 },
  { id: 'cs', name: 'Columbus Street', label: [32.7959, -79.927], left: true, wharf: [[32.793, -79.9268], [32.7998, -79.9296]], radius: 145, cranes: 2 },
];

export const BRIDGES = [
  { label: [32.8079, -79.9139], name: 'Ravenel Bridge', lights: [[32.8037, -79.922], [32.8028, -79.9149], [32.80175, -79.9065]], towers: [[32.8031, -79.9172], [32.80255, -79.9129]] },
  { label: [32.8875, -79.959], name: 'Don Holt Bridge', lights: [[32.8921, -79.9714], [32.89115, -79.963], [32.89044, -79.958]], towers: [[32.89136, -79.9645], [32.89122, -79.9632]] },
];

export const LANDMARKS = [
  [[32.779, -79.941], 'CHARLESTON', 'city'],
  [[32.8101, -79.873], 'MOUNT PLEASANT', 'city'],
  [[32.857, -79.910], 'DANIEL ISLAND', 'city'],
  [[32.7660, -79.838], 'SULLIVAN’S ISLAND', 'coast'],
  [[32.7521, -79.875], 'FORT SUMTER', 'coast'],
  [[32.7633, -79.924], 'Charleston Harbor', 'water'],
  [[32.819, -79.942], 'Cooper River', 'water'],
  [[32.8372, -79.912], 'Wando River', 'water'],
  [[32.7364, -79.820], 'Shipping channel', 'channel'],
];

// Light locations follow visible waterfront streets and developed shorelines in the aerial layer.
export const SHORE_LIGHTS = [
  [[32.7704,-79.9332],[32.7711,-79.9272],[32.7746,-79.9247],[32.7811,-79.9251],[32.7879,-79.9293]],
  [[32.7718,-79.9329],[32.7780,-79.9358],[32.7896,-79.9414],[32.7978,-79.9461]],
  [[32.776,-79.9294],[32.7835,-79.9335],[32.7918,-79.9391],[32.7993,-79.9437]],
  [[32.7732,-79.9398],[32.7817,-79.944],[32.7923,-79.9498],[32.805,-79.9525]],
  [[32.784,-79.9482],[32.7847,-79.9428],[32.7849,-79.9365],[32.7838,-79.926]],
  [[32.7901,-79.9533],[32.7911,-79.9477],[32.7917,-79.941],[32.7904,-79.9312]],
  [[32.8014,-79.9559],[32.8051,-79.9530],[32.8146,-79.9548],[32.8301,-79.9664],[32.8395,-79.9686]],
  [[32.7869,-79.9032],[32.7948,-79.9006],[32.8001,-79.8912],[32.8052,-79.8796]],
  [[32.7838,-79.8862],[32.7933,-79.8755],[32.8023,-79.8631],[32.8098,-79.854]],
  [[32.7966,-79.9043],[32.8011,-79.8959],[32.8074,-79.8848],[32.8135,-79.8734]],
  [[32.8162,-79.9122],[32.8242,-79.9141],[32.8311,-79.9171]],
  [[32.8462,-79.9229],[32.8524,-79.9184],[32.8603,-79.9119]],
  [[32.8472,-79.9456],[32.8543,-79.9501],[32.8601,-79.954],[32.868,-79.9606]],
  [[32.8481,-79.9572],[32.8568,-79.9633],[32.8667,-79.9701],[32.88,-79.9757]],
  [[32.7806,-79.974],[32.7819,-79.961],[32.7819,-79.9539]],
];

function distanceToWharf([lat, lon], [a, b]) {
  const lonScale = 111_195 * Math.cos(lat * Math.PI / 180);
  const offset = ([y, x]) => [(x - lon) * lonScale, (y - lat) * 111_195];
  const [ax, ay] = offset(a);
  const [bx, by] = offset(b);
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function berthFor(ship) {
  if (ship.nav === 1 || ship.nav === 6 || ship.speed > 0.6 || ship.speed == null && ship.nav !== 5) return null;
  const distances = TERMINALS.map(t => ({ id: t.id, distance: distanceToWharf(ship.position, t.wharf), radius: t.radius }));
  return distances.filter(t => t.distance < t.radius).sort((a, b) => a.distance - b.distance)[0]?.id ?? null;
}

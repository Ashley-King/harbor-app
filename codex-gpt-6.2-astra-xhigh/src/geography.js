export const terminals = [
  {
    id: 'wando',
    name: 'Wando Welch',
    water: 'Wando River',
    ends: [
      [32.82886, -79.89388],
      [32.8381, -79.88983]
    ],
    offset: [39, 0]
  },
  {
    id: 'north',
    name: 'North Charleston',
    water: 'Cooper River',
    ends: [
      [32.89525, -79.96582],
      [32.90576, -79.95623]
    ],
    offset: [-29, -7]
  },
  {
    id: 'leatherman',
    name: 'Leatherman',
    water: 'Cooper River',
    ends: [
      [32.83615, -79.9329],
      [32.84404, -79.93293]
    ],
    offset: [-33, 4]
  },
  {
    id: 'columbus',
    name: 'Columbus Street',
    water: 'Cooper River',
    ends: [
      [32.79241, -79.9262],
      [32.8008, -79.93007]
    ],
    offset: [-34, 10]
  }
]
export const bridges = [
  {
    name: 'Ravenel Bridge',
    ends: [
      [32.80502, -79.9315],
      [32.8019, -79.90576]
    ],
    offset: [54, -4]
  },
  {
    name: 'Don Holt Bridge',
    ends: [
      [32.89191, -79.96839],
      [32.89023, -79.95709]
    ],
    offset: [46, 5]
  }
]
export const midpoint = (ends) => ends[0].map((v, i) => (v + ends[1][i]) / 2)
export function berth(ship) {
  if ((ship.speed != null && ship.speed > 0.7) || (ship.speed == null && ship.status !== 5)) return null
  for (const t of terminals) {
    const [a, b] = t.ends
    const dx = (b[1] - a[1]) * 93600,
      dy = (b[0] - a[0]) * 111200
    const px = (ship.lon - a[1]) * 93600,
      py = (ship.lat - a[0]) * 111200
    const k = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)))
    if (Math.hypot(px - k * dx, py - k * dy) < 185) return t
  }
  return null
}
export function classify(s) {
  const detail = (s.subtype || '').toLowerCase()
  if (/container/.test(detail)) return ['container', 'Container ship']
  if (/car carrier|vehicle|roll.on|ro.ro/.test(detail)) return ['vehicle', 'Vehicle carrier']
  if (/\bbulk\b/.test(detail)) return ['bulk', 'Bulk carrier']
  if (/cruise|ocean liner/.test(detail)) return ['cruise', 'Cruise ship']
  if (/tanker/.test(detail) || (s.type >= 80 && s.type <= 89)) return ['tanker', 'Tanker']
  if (s.type === 52 || [31, 32].includes(s.type)) return ['tug', s.type === 52 ? 'Tug' : 'Towing vessel']
  if (s.type === 50) return ['pilot', 'Pilot boat']
  if (s.type >= 60 && s.type <= 69) return ['passenger', s.subtype || 'Passenger vessel']
  if (s.type >= 70 && s.type <= 79)
    return ['cargo', s.subtype ? s.subtype[0].toUpperCase() + s.subtype.slice(1) : 'Cargo ship']
  return [
    'other',
    s.subtype || ({ 36: 'Sailing vessel', 37: 'Pleasure craft', 90: 'Other vessel' }[s.type] ?? 'unknown')
  ]
}
export const category = (s) =>
  ['tug', 'pilot'].includes(s.model)
    ? 'workboat'
    : ['cruise', 'passenger'].includes(s.model)
      ? 'passenger'
      : ['bulk', 'cargo', 'container', 'tanker', 'vehicle'].includes(s.model)
        ? 'cargo'
        : 'other'
export const colors = { cargo: '#f3a068', passenger: '#78cabc', workboat: '#87bde0', other: '#c4c7c5' }

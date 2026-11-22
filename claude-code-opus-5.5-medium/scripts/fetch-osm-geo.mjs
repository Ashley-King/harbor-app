// One-time helper: pulls static harbor geography (bridges, terminals, cranes, channel)
// from OpenStreetMap via Overpass and writes src/geo.json. Ship data is never stored.
// Run: node scripts/fetch-osm-geo.mjs
import { writeFileSync } from 'node:fs';

const q = `[out:json][timeout:90];
(
 way(id:1494459861,1469639956,487069143,1013132649,730887451,56236110);
 way["highway"="motorway"]["name"~"Ravenel"](32.79,-79.95,32.82,-79.89);
 way["highway"="motorway"]["bridge"="yes"](32.885,-79.975,32.898,-79.955);
 way["seamark:type"="recommended_track"](32.70,-80.05,32.95,-79.70);
 node["man_made"="crane"](32.70,-80.05,32.95,-79.75);
 way["man_made"="crane"](32.70,-80.05,32.95,-79.75);
);
out tags geom;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'User-Agent': 'harbor-bench/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'data=' + encodeURIComponent(q),
});
const osm = await res.json();
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const line = (e) => e.geometry.map((p) => [r6(p.lon), r6(p.lat)]);
const centroid = (c) => { let x = 0, y = 0; c.forEach(([a, b]) => { x += a; y += b; }); return [r6(x / c.length), r6(y / c.length)]; };

const TERMINALS = {
  56236110: 'Wando Welch Terminal',
  730887451: 'North Charleston Terminal',
  1013132649: 'Leatherman Terminal',
  487069143: 'Columbus Street Terminal',
};
const out = { terminals: [], ravenelDeck: [], ravenelMainSpan: null, donHoltDeck: [], donHoltOutline: null, channel: [], cranes: [] };
for (const e of osm.elements) {
  const t = e.tags || {};
  if (e.type === 'way' && TERMINALS[e.id]) out.terminals.push({ name: TERMINALS[e.id], polygon: line(e) });
  else if (e.id === 1469639956) out.donHoltOutline = line(e);
  else if (t.highway === 'motorway' && /Ravenel/.test(t.name || '')) {
    out.ravenelDeck.push(line(e));
    if (e.id === 927255592) out.ravenelMainSpan = line(e);
  } else if (t.highway === 'motorway') out.donHoltDeck.push(line(e));
  else if (t['seamark:type'] === 'recommended_track') out.channel.push(line(e));
  else if (t.man_made === 'crane') out.cranes.push(e.type === 'node' ? [r6(e.lon), r6(e.lat)] : centroid(line(e)));
}
writeFileSync(new URL('../src/geo.json', import.meta.url), JSON.stringify(out));
console.log('terminals', out.terminals.length, 'ravenel', out.ravenelDeck.length, 'donholt', out.donHoltDeck.length, 'channel', out.channel.length, 'cranes', out.cranes.length, 'span', !!out.ravenelMainSpan);

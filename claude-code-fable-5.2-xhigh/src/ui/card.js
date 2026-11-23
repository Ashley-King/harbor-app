import { clockSmart, zoneName, ago, esc, countryName } from '../util.js';
import { aisTypeName, NAV_STATUS } from '../../lib/vessels.js';
import { HOW_TEXT, isGuess } from '../classify.js';
import { underKeel, destination, sizeStory } from '../facts.js';

const unknown = '<span class="unknown">unknown</span>';
const show = (v) => (v == null || v === '' ? unknown : esc(v));

function flagEmoji(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** AIS sends the ETA as month-day hour:minute in UTC, with no year. */
function etaText(eta) {
  const m = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(eta || '');
  if (!m) return null;
  const [mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1];
  return `${month} ${d}, ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')} UTC`;
}

const metres = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function planDrawing(length, beam) {
  if (length == null || beam == null) return '';
  // Plan view to scale: the hull's real proportions with its dimensions marked.
  const W = 300, H = 66;
  const scale = Math.min((W - 20) / length, 30 / beam);
  const l = length * scale, b = Math.max(3, beam * scale);
  const x0 = (W - l) / 2, y0 = 6;
  const bow = Math.min(l * 0.2, b * 1.6);
  return `<svg class="plan" viewBox="0 0 ${W} ${H}" role="img" aria-label="Plan view, ${Math.round(length)} by ${Math.round(beam)} metres">
    <path d="M${x0} ${y0}H${x0 + l - bow}Q${x0 + l - bow * 0.3} ${y0} ${x0 + l} ${y0 + b / 2}Q${x0 + l - bow * 0.3} ${y0 + b} ${x0 + l - bow} ${y0 + b}H${x0}z" fill="currentColor" opacity="0.9"/>
    <path d="M${x0} ${y0 + b + 9}H${x0 + l}M${x0} ${y0 + b + 5}v8M${x0 + l} ${y0 + b + 5}v8" stroke="currentColor" stroke-width="1" fill="none" opacity="0.6"/>
    <text x="${W / 2}" y="${y0 + b + 23}" text-anchor="middle">${Math.round(length)} m long, ${Math.round(beam)} m beam</text>
  </svg>`;
}

const FT = 0.3048;
const feet = (n) => `${Math.round(n)} ft`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function daysText(days) {
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} hours`;
  return days < 9.5 ? `${days.toFixed(1).replace(/\.0$/, '')} days` : `${Math.round(days)} days`;
}

/** Where the ship is going, as one sentence, or null. */
function destinationLine(v, e) {
  const d = destination(v);
  if (!d) return null;
  if (d.here) return e.state === 'underway' ? 'Bound for Charleston.' : null;
  const far = `About ${d.miles.toLocaleString('en-US')} nautical miles by sea, ${daysText(d.days)} at ${d.typical ? 'a typical ' : ''}${Math.round(d.knots)} knots.`;
  return `${e.state === 'underway' ? 'Bound for' : 'Next port:'} ${d.place}. ${far}`;
}

/** The ship's backstory from Wikidata: a photo when there is one, then who built and runs it. */
function storyBlock(story) {
  if (story === 'loading') return '<p class="story-note">Looking the ship up in Wikidata.</p>';
  if (!story || !story.found) return '';
  const bits = [];
  if (story.built && story.builder) bits.push(`Built in ${story.built} by ${story.builder}.`);
  else if (story.built) bits.push(`Built in ${story.built}.`);
  else if (story.builder) bits.push(`Built by ${story.builder}.`);
  if (story.operator) bits.push(`Operated by ${story.operator}.`);
  else if (story.owner) bits.push(`Owned by ${story.owner}.`);
  const links = [story.article ? `<a href="${esc(story.article)}" target="_blank" rel="noopener noreferrer">Wikipedia</a>` : '', story.wikidata ? `<a href="${esc(story.wikidata)}" target="_blank" rel="noopener noreferrer">Wikidata</a>` : ''].filter(Boolean).join(' · ');
  const photo = story.image ? `<figure class="photo"><img src="${esc(story.image)}" alt="${esc(story.name || 'The ship')}" loading="lazy" referrerpolicy="no-referrer" />${story.imagePage ? `<figcaption><a href="${esc(story.imagePage)}" target="_blank" rel="noopener noreferrer">Photo and its credit on Wikimedia Commons</a></figcaption>` : ''}</figure>` : '';
  if (!bits.length && !photo && !links) return '';
  return `<div class="story">${photo}<p>${esc(bits.join(' '))}${links ? ` <span class="story-links">${links}</span>` : ''}</p></div>`;
}

/**
 * Fill the ship card for one vessel. The card opens compact, with the few things
 * worth knowing at a glance, so the ship stays in view. "More details" opens the
 * rest. Every missing field reads "unknown".
 * ctx: { harbor, tideFt, expanded, story }
 */
export function renderCard(el, e, now = Date.now(), ctx = {}) {
  const v = e.v;
  const country = countryName(v.flag);
  const typeName = aisTypeName(v.type);
  const status =
    e.state === 'underway' ? `Under way${v.sog != null ? ` at ${v.sog.toFixed(1)} knots` : ''}`
    : e.state === 'berth' ? `At ${e.berth.label}`
    : e.state === 'anchor' ? `At anchor${e.place ? ` near ${e.place}` : ''}`
    : `Stopped${e.place ? ` near ${e.place}` : ''}`;
  const cargo = v.type >= 70 && v.type <= 79;
  const why = isGuess(v, e.model) ? 'AIS gives no type to go on, so this is a plain stand-in'
    : HOW_TEXT[e.model.how] ? `${HOW_TEXT[e.model.how]}${cargo ? '; AIS does not say which kind of cargo ship' : ''}`
    : null;
  const standIn = e.size.estimated ? `no hull size reported, so it is drawn at a typical ${e.size.L} m by ${e.size.B} m` : null;
  const drawn = `${esc(cap(e.model.label))}${[why, standIn].filter(Boolean).map((t) => `<small>${esc(t)}</small>`).join('')}`;
  // A yacht size that can only be feet: show what was reported and what is drawn.
  const inFeet = e.size.feet;
  const length = v.length == null ? null : inFeet ? e.size.L : v.length;
  const sizeText = v.length == null || v.beam == null ? unknown
    : inFeet ? `${metres(e.size.L)} m × ${metres(e.size.B)} m<small>${esc(`reported as ${v.length} m × ${v.beam} m. A yacht that long is never that wide, so the figures are read as feet`)}</small>`
    : `${esc(v.length)} m × ${esc(v.beam)} m<small>${esc(`${feet(v.length / FT)} × ${feet(v.beam / FT)}`)}</small>`;
  const ll = v.lat != null ? `${Math.abs(v.lat).toFixed(4)}° ${v.lat >= 0 ? 'N' : 'S'}, ${Math.abs(v.lon).toFixed(4)}° ${v.lon >= 0 ? 'E' : 'W'}` : null;
  const newest = e.path[e.path.length - 1];
  const lag = newest ? Math.hypot(newest.x - e.pos.x, newest.y - e.pos.y) : 0;
  const warns = [];
  const staleWarn = e.stale ? `Not heard for ${ago(e.seenMs, now).replace(' ago', '')}. It may have left or switched its transponder off.` : null;
  if (!e.headingKnown) warns.push(e.state === 'underway' ? 'Heading not reported. Drawn on its course over ground.' : e.headingFrom === 'wharf' ? 'Heading not reported. Drawn lying along the wharf.' : e.headingFrom === 'dock' ? 'Heading not reported. Drawn lying along its dock, so bow and stern may be swapped.' : 'Heading not reported. Drawn the way the hull fits the water around it, so bow and stern may be swapped.');
  const moved = e.nudge && e.state !== 'underway' ? Math.round(Math.hypot(e.nudge.x, e.nudge.y)) : 0;
  if (moved >= 3) warns.push(`Drawn ${moved} m from its reported position to keep it clear of the dock and the boats around it. Reported positions are often a few metres out.`);
  if (lag > 60) warns.push(`The model is following the ship's real track and is ${lag >= 1000 ? `${(lag / 1000).toFixed(1)} km` : `${Math.round(lag / 10) * 10} m`} short of this report. The ring marks the reported position.`);

  // The glance facts: where it is going, the water under it, how big it is. The
  // compact card shows the first two, to stay small.
  const keel = ctx.harbor ? underKeel(e, ctx.harbor, ctx.tideFt) : null;
  const facts = [
    destinationLine(v, e),
    keel ? `About ${feet(keel.ft)} of water under the keel right now.` : null,
    sizeStory(length),
  ].filter(Boolean);
  const keelRow = keel ? `<dt>Under the keel</dt><dd>${esc(feet(keel.ft))}<small>${esc(`${keel.depthFt} ft channel in ${keel.reach}, ${keel.tideFt >= 0 ? 'plus' : 'less'} ${Math.abs(keel.tideFt).toFixed(1)} ft of tide, less a ${feet(keel.draughtFt)} draught. The channel figure is its maintained depth, not a sounding.`)}</small></dd>` : '';

  const expanded = !!ctx.expanded;
  const story = ctx.story;
  const key = JSON.stringify([v.mmsi, v.seen, e.state, e.stale, e.headingKnown, e.headingFrom, Math.round(lag / 50), moved, e.model.key, Math.floor((now - e.seenMs) / 60000), expanded, story === 'loading' ? 1 : story ? 2 : 0, keel ? Math.round(keel.ft) : null]);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.dataset.kind = 'ship';
  const kind = [cap(e.model.label), country ? `${flagEmoji(v.flag)} ${country}` : null].filter(Boolean).join(' · ');
  el.innerHTML = `
    <button type="button" class="close" data-act="close" aria-label="Close ship details">&times;</button>
    <h2>${esc(v.name || 'Name unknown')}</h2>
    <p class="sub">${esc(status)}<span class="kind">${esc(kind)}</span></p>
    ${facts.length ? `<ul class="facts">${(expanded ? facts : facts.slice(0, 2)).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${staleWarn ? `<p class="warn">${esc(staleWarn)}</p>` : ''}
    <div class="actions"><button type="button" data-act="zoom">Zoom to ship</button><button type="button" data-act="more" aria-expanded="${expanded}">${expanded ? 'Fewer details' : 'More details'}</button></div>
    ${expanded ? `<div class="more">
    ${storyBlock(story)}
    ${inFeet ? planDrawing(e.size.L, e.size.B) : planDrawing(v.length, v.beam)}
    <dl>
      <dt>Flag</dt><dd>${country ? `${flagEmoji(v.flag)} ${esc(country)}` : show(v.flag)}</dd>
      <dt>Type</dt><dd>${typeName ? `${esc(typeName)}<small>AIS type ${esc(v.type)}</small>` : unknown}</dd>
      <dt>Length × beam</dt><dd>${sizeText}</dd>
      <dt>Draught</dt><dd>${v.draught != null ? `${v.draught.toFixed(1)} m<small>${esc(feet(v.draught / FT))}</small>` : unknown}</dd>
      ${keelRow}
      <dt>Speed</dt><dd>${v.sog != null ? `${v.sog.toFixed(1)} knots` : unknown}</dd>
      <dt>Destination</dt><dd>${show(v.destination)}</dd>
      <dt>ETA</dt><dd>${show(etaText(v.eta))}</dd>
      <dt>Last report</dt><dd>${e.seenMs ? `${esc(clockSmart(e.seenMs, now))} ${esc(zoneName(e.seenMs))}<small>${esc(ago(e.seenMs, now))}</small>` : unknown}</dd>
      <dt>Status</dt><dd>${v.navStatus != null && NAV_STATUS[v.navStatus] ? esc(NAV_STATUS[v.navStatus]) : unknown}</dd>
      <dt>Heading</dt><dd>${v.heading != null ? `${Math.round(v.heading)}°` : unknown}${v.cog != null ? `<small>course over ground ${Math.round(v.cog)}°</small>` : ''}</dd>
      <dt>Position</dt><dd>${show(ll)}</dd>
      <dt>IMO</dt><dd>${show(v.imo)}</dd>
      <dt>MMSI</dt><dd>${show(v.mmsi)}${v.callsign ? `<small>call sign ${esc(v.callsign)}</small>` : ''}</dd>
      <dt>Drawn as</dt><dd>${drawn}</dd>
    </dl>
    ${warns.map((w) => `<p class="warn">${esc(w)}</p>`).join('')}
    </div>` : ''}`;
}

/**
 * Fill the same card for something that is not a ship in the harbor: a landmark, a
 * wreck, a dolphin sighting, a current station, an alert, a ship still at sea.
 * info: { title, sub, text: [paragraph], rows: [[label, value]], links: [{ href, text }], note }
 */
export function renderInfo(el, info) {
  const key = JSON.stringify(info);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.dataset.kind = 'info';
  const link = (l) => (/^https:\/\//.test(l.href) ? `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.text)}</a>` : '');
  el.innerHTML = `
    <button type="button" class="close" data-act="close" aria-label="Close details">&times;</button>
    <h2>${esc(info.title)}</h2>
    ${info.sub ? `<p class="sub">${esc(info.sub)}</p>` : ''}
    ${(info.text || []).map((t) => `<p class="para">${esc(t)}</p>`).join('')}
    ${info.rows && info.rows.length ? `<dl>${info.rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('')}</dl>` : ''}
    ${info.note ? `<p class="note">${esc(info.note)}</p>` : ''}
    ${info.links && info.links.length ? `<p class="links">${info.links.map(link).filter(Boolean).join(' · ')}</p>` : ''}
    ${info.at ? '<div class="actions"><button type="button" data-act="zoom">Show on the map</button></div>' : ''}`;
}

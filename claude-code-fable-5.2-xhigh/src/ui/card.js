import { clockSmart, zoneName, ago, esc, countryName } from '../util.js';
import { aisTypeName, NAV_STATUS } from '../../lib/vessels.js';
import { HOW_TEXT, isGuess } from '../classify.js';

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

/** Fill the ship card for one vessel. Every missing field reads "unknown". */
export function renderCard(el, e, now = Date.now()) {
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
  const drawn = `${esc(e.model.label[0].toUpperCase() + e.model.label.slice(1))}${[why, standIn].filter(Boolean).map((t) => `<small>${esc(t)}</small>`).join('')}`;
  // A yacht size that can only be feet: show what was reported and what is drawn.
  const feet = e.size.feet;
  const sizeText = v.length == null || v.beam == null ? unknown
    : feet ? `${metres(e.size.L)} m × ${metres(e.size.B)} m<small>${esc(`reported as ${v.length} m × ${v.beam} m. A yacht that long is never that wide, so the figures are read as feet`)}</small>`
    : `${esc(v.length)} m × ${esc(v.beam)} m`;
  const ll = v.lat != null ? `${Math.abs(v.lat).toFixed(4)}° ${v.lat >= 0 ? 'N' : 'S'}, ${Math.abs(v.lon).toFixed(4)}° ${v.lon >= 0 ? 'E' : 'W'}` : null;
  const newest = e.path[e.path.length - 1];
  const lag = newest ? Math.hypot(newest.x - e.pos.x, newest.y - e.pos.y) : 0;
  const warns = [];
  if (e.stale) warns.push(`Not heard for ${ago(e.seenMs, now).replace(' ago', '')}. It may have left or switched its transponder off.`);
  if (!e.headingKnown) warns.push(e.state === 'underway' ? 'Heading not reported. Drawn on its course over ground.' : e.headingFrom === 'wharf' ? 'Heading not reported. Drawn lying along the wharf.' : e.headingFrom === 'dock' ? 'Heading not reported. Drawn lying along its dock, so bow and stern may be swapped.' : 'Heading not reported. Drawn the way the hull fits the water around it, so bow and stern may be swapped.');
  const moved = e.nudge && e.state !== 'underway' ? Math.round(Math.hypot(e.nudge.x, e.nudge.y)) : 0;
  if (moved >= 3) warns.push(`Drawn ${moved} m from its reported position to keep it clear of the dock and the boats around it. Reported positions are often a few metres out.`);
  if (lag > 60) warns.push(`The model is following the ship's real track and is ${lag >= 1000 ? `${(lag / 1000).toFixed(1)} km` : `${Math.round(lag / 10) * 10} m`} short of this report. The ring marks the reported position.`);
  const key = JSON.stringify([v.mmsi, v.seen, e.state, e.stale, e.headingKnown, e.headingFrom, Math.round(lag / 50), moved, e.model.key, Math.floor((now - e.seenMs) / 60000)]);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = `
    <button type="button" class="close" data-act="close" aria-label="Close ship details">&times;</button>
    <h2>${esc(v.name || 'Name unknown')}</h2>
    <p class="sub">${esc(status)}</p>
    ${feet ? planDrawing(e.size.L, e.size.B) : planDrawing(v.length, v.beam)}
    <dl>
      <dt>Flag</dt><dd>${country ? `${flagEmoji(v.flag)} ${esc(country)}` : show(v.flag)}</dd>
      <dt>IMO</dt><dd>${show(v.imo)}</dd>
      <dt>Type</dt><dd>${typeName ? `${esc(typeName)}<small>AIS type ${esc(v.type)}</small>` : unknown}</dd>
      <dt>Length × beam</dt><dd>${sizeText}</dd>
      <dt>Speed</dt><dd>${v.sog != null ? `${v.sog.toFixed(1)} knots` : unknown}</dd>
      <dt>Destination</dt><dd>${show(v.destination)}</dd>
      <dt>ETA</dt><dd>${show(etaText(v.eta))}</dd>
      <dt>Draught</dt><dd>${v.draught != null ? `${v.draught.toFixed(1)} m` : unknown}</dd>
      <dt>Last report</dt><dd>${e.seenMs ? `${esc(clockSmart(e.seenMs, now))} ${esc(zoneName(e.seenMs))}<small>${esc(ago(e.seenMs, now))}</small>` : unknown}</dd>
      <dt>Status</dt><dd>${v.navStatus != null && NAV_STATUS[v.navStatus] ? esc(NAV_STATUS[v.navStatus]) : unknown}</dd>
      <dt>Heading</dt><dd>${v.heading != null ? `${Math.round(v.heading)}°` : unknown}${v.cog != null ? `<small>course over ground ${Math.round(v.cog)}°</small>` : ''}</dd>
      <dt>Position</dt><dd>${show(ll)}</dd>
      <dt>MMSI</dt><dd>${show(v.mmsi)}${v.callsign ? `<small>call sign ${esc(v.callsign)}</small>` : ''}</dd>
      <dt>Drawn as</dt><dd>${drawn}</dd>
    </dl>
    ${warns.map((w) => `<p class="warn">${esc(w)}</p>`).join('')}
    <div class="actions"><button type="button" data-act="zoom">Zoom to ship</button><button type="button" data-act="harbor">Whole harbor</button></div>`;
}

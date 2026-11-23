import { ICONS } from './pins.js';
import { clock, clockSec, clockSmart, dayLabel, zoneName, ago, countdown, esc, countryName } from '../util.js';
import { aisTypeName } from '../../lib/vessels.js';

const $ = (id) => document.getElementById(id);
const CHARTED_CLEARANCE_FT = 186; // Ravenel Bridge, charted vertical clearance at mean high water

const TERMINAL_ORDER = ['wando', 'leatherman', 'nct', 'columbus'];

function hullIcon(length) {
  // A plan-view hull whose drawn length follows the ship's real length.
  const w = Math.round(14 + 86 * Math.min(1, (length || 20) / 366));
  return `<svg class="hull" viewBox="0 0 100 24" aria-hidden="true"><path d="M${100 - w} 5h${w - 14}l14 7-14 7H${100 - w}z" fill="currentColor"/></svg>`;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** One line saying what a vessel is, for the lists. */
export function kindText(e) {
  if (e.model) return cap(e.model.label);
  return aisTypeName(e.v.type) || 'Type unknown';
}

/** The side panel: tide, bridge clearance, ships by terminal, feed status. */
export class Panel {
  constructor({ onSelect, onInfo }) {
    this.onSelect = onSelect;
    this.onInfo = onInfo;
    // Which optional sections are switched on in the layers panel.
    this.show = { weather: true, alerts: true, inbound: true, log: true };
    this.infos = { alerts: [], inbound: [], 'wreck-list': [], 'dolphin-list': [] };
    this.logOpen = false;
    for (const id of ['alerts', 'inbound', 'wreck-list', 'dolphin-list']) {
      $(id).addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-info]');
        const info = b && this.infos[id][Number(b.dataset.info)];
        if (info) this.onInfo(info);
      });
    }
    $('alert-chip').addEventListener('click', () => this.infos.alerts[0] && this.onInfo(this.infos.alerts[0]));
    $('harbor-log').addEventListener('toggle', (ev) => {
      if (ev.target.matches('details')) this.logOpen = ev.target.open;
    }, true);
    this.listEl = $('ship-lists');
    this.listEl.addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-mmsi]');
      if (row) this.onSelect(Number(row.dataset.mmsi));
    });
    this.tugsOpen = false;
    this.smallOpen = false;
    this.listEl.addEventListener('toggle', (ev) => {
      if (!ev.target.matches('details')) return;
      if (ev.target.dataset.list === 'small') this.smallOpen = ev.target.open;
      else if (ev.target.dataset.list === 'tugs') this.tugsOpen = ev.target.open;
    }, true);
  }

  // ------------------------------------------------------------ conditions

  renderConditions(feed, now = Date.now()) {
    const tide = feed.state.tide;
    const gap = feed.state.airGap;
    if (tide.data && tide.data.level) {
      const d = tide.data;
      $('tide-value').innerHTML = `${d.level.ft.toFixed(1)}<small>ft</small>`;
      const trend = d.ftPerHour == null ? '' : Math.abs(d.ftPerHour) < 0.15 ? 'Slack' : d.ftPerHour > 0 ? `Rising ${d.ftPerHour.toFixed(1)} ft an hour` : `Falling ${Math.abs(d.ftPerHour).toFixed(1)} ft an hour`;
      const next = (d.hilo || []).find((h) => Date.parse(h.t) > now);
      const nextText = next ? `${cap(next.type)} ${next.ft.toFixed(1)} ft at ${clock(Date.parse(next.t))}` : '';
      $('tide-detail').innerHTML = [trend, nextText].filter(Boolean).map(esc).join('<br>') || `Measured ${esc(clock(Date.parse(d.level.t)))}`;
      this._tideChart(d, now);
    } else {
      $('tide-value').textContent = 'unknown';
      $('tide-detail').textContent = tide.error ? 'NOAA did not answer' : 'Waiting for NOAA';
    }
    this._note('tide-note', tide, tide.data?.level?.t);

    if (gap.data && gap.data.value) {
      const d = gap.data;
      $('gap-value').innerHTML = `${d.value.ft.toFixed(1)}<small>ft</small>`;
      $('gap-detail').innerHTML = `Water to steel at mid-span<br>${esc((d.value.ft * 0.3048).toFixed(1))} m, measured ${esc(clock(Date.parse(d.value.t)))}`;
      this._gapChart(d.value.ft);
    } else {
      $('gap-value').textContent = 'unknown';
      $('gap-detail').textContent = gap.error ? 'NOAA did not answer' : 'Waiting for NOAA';
    }
    this._note('gap-note', gap, gap.data?.value?.t);
  }

  _note(id, st, readingTime) {
    const el = $(id);
    if (st.stale && st.data) {
      el.hidden = false;
      el.textContent = `Stale. Last good reading ${clockSmart(Date.parse(readingTime) || st.at)}.`;
    } else if (st.stale) {
      el.hidden = false;
      el.textContent = 'No reading yet. Trying again at the next refresh.';
    } else {
      el.hidden = true;
    }
  }

  _tideChart(d, now) {
    const svg = $('tide-chart');
    const t0 = now - 6 * 3600e3, t1 = now + 18 * 3600e3;
    const pred = (d.predicted || []).map(([t, v]) => [Date.parse(t), v]).filter(([t]) => t >= t0 && t <= t1);
    const obs = (d.observed || []).map(([t, v]) => [Date.parse(t), v]).filter(([t]) => t >= t0);
    const all = [...pred, ...obs].map((p) => p[1]);
    if (all.length < 2) {
      svg.innerHTML = '';
      return;
    }
    const lo = Math.min(...all) - 0.3, hi = Math.max(...all) + 0.3;
    const X = (t) => ((t - t0) / (t1 - t0)) * 240;
    const Y = (v) => 60 - ((v - lo) / (hi - lo)) * 56;
    const line = (pts) => pts.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
    const nowX = X(now);
    const last = obs[obs.length - 1];
    const marks = (d.hilo || []).map((h) => [Date.parse(h.t), h.ft, h.type]).filter(([t]) => t > now && t < t1)
      .map(([t, v, type]) => `<text x="${X(t).toFixed(1)}" y="${(type === 'high' ? Y(v) - 3 : Y(v) + 9).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="var(--muted)">${esc(clock(t).replace(' ', ''))}</text>`).join('');
    svg.innerHTML = `
      <line x1="${nowX}" x2="${nowX}" y1="2" y2="62" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>
      ${pred.length > 1 ? `<path d="${line(pred)}" fill="none" stroke="var(--muted)" stroke-width="1.2" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ''}
      ${obs.length > 1 ? `<path d="${line(obs)}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : ''}
      ${last ? `<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3" fill="var(--accent)"/>` : ''}
      ${marks}`;
  }

  _gapChart(ft) {
    // The water line sits lower or higher with the measured gap, against the fixed deck.
    const y = 58 - Math.max(0, Math.min(1, (ft - 180) / 30)) * 10;
    const top = 14;
    $('gap-chart').innerHTML = `
      <path d="M0 ${top}H240" stroke="var(--text)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
      <path d="M78 ${top + 36}V2M162 ${top + 36}V2" stroke="var(--text)" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <path d="M78 3L30 ${top}M78 3L52 ${top}M78 3L104 ${top}M78 3L120 ${top}M162 3L120 ${top}M162 3L136 ${top}M162 3L188 ${top}M162 3L210 ${top}" stroke="var(--muted)" stroke-width="0.8" fill="none" vector-effect="non-scaling-stroke"/>
      <path d="M0 ${y}q7.5 -3 15 0t15 0 15 0 15 0 15 0 15 0 15 0 15 0 15 0 15 0 15 0 15 0 15 0 15 0 15 0 15 0" fill="none" stroke="var(--water-label)" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
      <path d="M120 ${top + 3}V${y - 4}M116 ${top + 8}l4 -5 4 5M116 ${y - 9}l4 5 4 -5" fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      <text x="170" y="${(top + y) / 2 - 2}" font-size="8.5" fill="var(--muted)">charted ${CHARTED_CLEARANCE_FT} ft</text>
      <text x="170" y="${(top + y) / 2 + 8}" font-size="8.5" fill="var(--muted)">at high water</text>`;
  }

  // ------------------------------------------------------------ ships

  renderShips(fleet, harbor, feed, selected, now = Date.now()) {
    const ents = [...fleet.entities.values()].filter((e) => !e.gone);
    const ships = ents.filter((e) => e.group === 'ship');
    const work = ents.filter((e) => e.group === 'tug' || e.group === 'pilot');
    const small = ents.filter((e) => e.group === 'other');
    const len = (e) => (e.size && e.size.feet ? e.size.L : e.v.length || 0);
    const bySize = (a, b) => len(b) - len(a) || String(a.v.name).localeCompare(String(b.v.name));
    const row = (e, note) => {
      const v = e.v;
      const country = countryName(v.flag);
      const what = [kindText(e), country].filter(Boolean).join(', ');
      const size = v.length != null ? `${Math.round(e.size && e.size.feet ? e.size.L : v.length)} m` : 'size unknown';
      const state = e.stale ? `heard ${ago(e.seenMs, now)}` : note;
      return `<li><button type="button" class="ship${e.stale ? ' is-stale' : ''}" data-mmsi="${v.mmsi}" data-kind="${e.group}" aria-current="${selected === v.mmsi}">
        ${hullIcon(e.size ? e.size.L : v.length)}
        <span class="txt"><span class="name">${esc(v.name || `MMSI ${v.mmsi}`)}</span><span class="what">${esc(what)}</span></span>
        <span class="size">${esc(size)}<small>${esc(state)}</small></span></button></li>`;
    };
    const stateNote = (e) => {
      if (e.state === 'underway') return `${e.v.sog != null ? e.v.sog.toFixed(1) : '?'} kn`;
      if (e.state === 'anchor') return 'at anchor';
      if (e.v.navStatus === 5 || e.state === 'berth') return 'moored';
      return 'stopped';
    };
    let html = '';
    if (!feed.state.ais.data) {
      html += `<div class="group"><h2>Ships</h2><p class="empty">${feed.loading ? 'Reading the live ship positions.' : 'The ship feed has not answered yet. No ships are drawn until it does. The next refresh tries again.'}</p></div>`;
      this.listEl.innerHTML = html;
      return;
    }
    const terminals = TERMINAL_ORDER.map((id) => harbor.terminals.find((t) => t.id === id)).filter(Boolean);
    for (const t of terminals) {
      const here = ships.filter((e) => e.berth && e.berth.terminal === t.id).sort(bySize);
      html += `<div class="group"><h2>${esc(t.label)}<span class="count">${here.length === 1 ? '1 ship' : `${here.length} ships`}</span></h2>`;
      html += here.length ? `<ul class="ship-list">${here.map((e) => row(e, stateNote(e))).join('')}</ul>` : '<p class="empty">No ship at the wharf</p>';
      html += '</div>';
    }
    const containerIds = new Set(TERMINAL_ORDER);
    const elsewhere = ships.filter((e) => e.state !== 'underway' && !(e.berth && containerIds.has(e.berth.terminal))).sort(bySize);
    const moving = ships.filter((e) => e.state === 'underway').sort(bySize);
    html += `<div class="group"><h2>Under way<span class="count">${moving.length === 1 ? '1 ship' : `${moving.length} ships`}</span></h2>`;
    html += moving.length ? `<ul class="ship-list">${moving.map((e) => row(e, stateNote(e))).join('')}</ul>` : '<p class="empty">No large ship is moving</p>';
    html += '</div>';
    if (elsewhere.length) {
      html += `<div class="group"><h2>Other berths and anchorages<span class="count">${elsewhere.length}</span></h2><ul class="ship-list">`;
      html += elsewhere.map((e) => row(e, e.berth ? e.berth.label.replace(' Terminal', '') : e.place ? e.place : stateNote(e))).join('');
      html += '</ul></div>';
    }
    if (work.length) {
      const tugs = work.filter((e) => e.group === 'tug').length;
      const pilots = work.length - tugs;
      const label = [tugs ? `${tugs} ${tugs === 1 ? 'tug' : 'tugs'}` : '', pilots ? `${pilots} ${pilots === 1 ? 'pilot boat' : 'pilot boats'}` : ''].filter(Boolean).join(', ');
      html += `<details class="group" data-list="tugs"${this.tugsOpen ? ' open' : ''}><summary><h2>Tugs and pilot boats<span class="count">${esc(label)}</span></h2></summary><ul class="ship-list">`;
      html += work.sort((a, b) => (a.state === 'underway' ? 0 : 1) - (b.state === 'underway' ? 0 : 1) || bySize(a, b)).map((e) => row(e, stateNote(e))).join('');
      html += '</ul></details>';
    }
    if (small.length) {
      const moving = small.filter((e) => e.state === 'underway').length;
      const label = `${small.length}${moving ? `, ${moving} under way` : ''}`;
      html += `<details class="group" data-list="small"${this.smallOpen ? ' open' : ''}><summary><h2>Small craft<span class="count">${esc(label)}</span></h2></summary><ul class="ship-list">`;
      html += small.sort((a, b) => (a.state === 'underway' ? 0 : 1) - (b.state === 'underway' ? 0 : 1) || bySize(a, b)).map((e) => row(e, stateNote(e))).join('');
      html += '</ul></details>';
    }
    this.listEl.innerHTML = html;
  }

  // ------------------------------------------------------------ weather, alerts, forecast

  renderWeather(extras) {
    const el = $('weather');
    const d = extras.state.weather.data;
    el.hidden = !this.show.weather || !d;
    if (el.hidden) return;
    const cell = (label, value, unit, detail) => `<div class="wx"><h2>${label}</h2><p class="value">${value != null ? `<span class="num">${esc(value)}<small>${unit}</small></span>` : '<span class="unknown">unknown</span>'}</p><p class="detail">${esc(detail || '')}</p></div>`;
    const w = d.wind;
    const windDetail = w ? [w.kn < 1 ? 'calm' : w.from || '', w.gustKn != null && w.gustKn >= w.kn + 3 ? `gusts ${Math.round(w.gustKn)}` : ''].filter(Boolean).join(', ') : '';
    const html = cell('Wind', w ? Math.round(w.kn) : null, 'kn', windDetail)
      + cell('Water', d.waterF ? Math.round(d.waterF.f) : null, '°F', d.waterF ? `${Math.round(((d.waterF.f - 32) * 5) / 9)} °C` : '')
      + cell('Air', d.airF ? Math.round(d.airF.f) : null, '°F', d.airF ? `${Math.round(((d.airF.f - 32) * 5) / 9)} °C` : '')
      + cell('Pressure', d.pressureMb ? Math.round(d.pressureMb.mb) : null, 'mb', extras.state.weather.stale ? 'stale' : '');
    if (html !== this._wx) {
      this._wx = html;
      el.innerHTML = html;
    }
  }

  renderMarine(extras, now = Date.now()) {
    const el = $('alerts');
    const chip = $('alert-chip');
    const d = extras.state.marine.data;
    const alerts = (this.show.alerts && d && d.alerts) || [];
    const forecast = this.show.alerts && d ? d.forecast : null;
    const until = (a) => (a.ends && Date.parse(a.ends) > now ? `until ${clockSmart(Date.parse(a.ends), now)}` : '');
    const infos = alerts.map((a) => ({
      title: a.event,
      sub: [a.severity && a.severity !== 'Unknown' ? `${a.severity} severity` : '', until(a)].filter(Boolean).join(', '),
      text: [...String(a.text || '').split(/\n{2,}/).map((t) => t.replace(/\n/g, ' ').trim()).filter(Boolean).slice(0, 5), a.instruction].filter(Boolean),
      note: 'From the National Weather Service, for the Charleston Harbor marine zone.',
      links: [{ href: 'https://www.weather.gov/chs/marine', text: 'NWS Charleston marine page' }],
    }));
    if (forecast) {
      infos.push({
        title: 'Harbor forecast',
        sub: forecast.issued ? `National Weather Service, issued ${clockSmart(Date.parse(forecast.issued), now)}` : 'National Weather Service',
        rows: forecast.periods.map((p) => [cap(p.name.toLowerCase()), p.text]),
        links: [{ href: 'https://www.weather.gov/chs/marine', text: 'NWS Charleston marine page' }],
      });
    }
    this.infos.alerts = infos;
    const first = forecast && forecast.periods[0];
    const html = alerts.map((a, i) => `<button type="button" class="alert" data-info="${i}"><span class="mark" aria-hidden="true">!</span><span><strong>${esc(a.event)}</strong>${until(a) ? ` <span class="when">${esc(until(a))}</span>` : ''}</span></button>`).join('')
      + (first ? `<button type="button" class="forecast" data-info="${alerts.length}"><strong>${esc(cap(first.name.toLowerCase()))}</strong> ${esc(first.text)}</button>` : '');
    el.hidden = !html;
    if (html !== this._marine) {
      this._marine = html;
      el.innerHTML = html;
    }
    // The same alert as a small chip on the map, so it is seen with the board closed.
    chip.hidden = !alerts.length;
    if (alerts.length) chip.textContent = alerts.length > 1 ? `${alerts[0].event} and ${alerts.length - 1} more` : alerts[0].event;
  }

  // ------------------------------------------------------------ ships still at sea

  renderInbound(extras, now = Date.now()) {
    const el = $('inbound');
    const st = extras.state.inbound;
    el.hidden = !this.show.inbound || !st.data;
    if (el.hidden) return;
    const ships = st.data.ships || [];
    this.infos.inbound = ships.map((v) => {
      const eta = Date.parse(v.seen) + v.etaMinutes * 60000;
      return {
        title: v.name || `MMSI ${v.mmsi}`,
        sub: `${v.distanceNm} nautical miles from the jetties, making ${v.sog.toFixed(1)} knots`,
        text: [`At this speed she reaches the harbor entrance about ${clockSmart(eta, now)}. She joins the map when she passes the jetties.`],
        rows: [
          ['Type', aisTypeName(v.type) || 'unknown'],
          ['Flag', countryName(v.flag) || v.flag || 'unknown'],
          ['Size', v.length != null && v.beam != null ? `${v.length} m × ${v.beam} m` : 'unknown'],
          ['Draught', v.draught != null ? `${v.draught.toFixed(1)} m` : 'unknown'],
          ['Destination', v.destination || 'unknown'],
          ['Last report', `${clockSmart(Date.parse(v.seen), now)}, ${ago(Date.parse(v.seen), now)}`],
        ],
        note: 'Ships are only heard offshore while they are in range of a receiver on land, usually 20 to 40 nautical miles.',
      };
    });
    const row = (v, i) => {
      const eta = Date.parse(v.seen) + v.etaMinutes * 60000;
      const what = [aisTypeName(v.type), countryName(v.flag)].filter(Boolean).join(', ');
      return `<li><button type="button" class="ship" data-info="${i}" data-kind="ship">
        ${hullIcon(v.length)}
        <span class="txt"><span class="name">${esc(v.name || `MMSI ${v.mmsi}`)}</span><span class="what">${esc(what)}</span></span>
        <span class="size">${esc(`${Math.round(v.distanceNm)} nm out`)}<small>${esc(`jetties ${clock(eta)}`)}</small></span></button></li>`;
    };
    const html = `<div class="group"><h2>Arriving from sea<span class="count">${ships.length === 1 ? '1 ship' : `${ships.length} ships`}</span></h2>${ships.length ? `<ul class="ship-list">${ships.map(row).join('')}</ul>` : '<p class="empty">No ship in range offshore is heading in</p>'}</div>`;
    if (html !== this._inbound) {
      this._inbound = html;
      el.innerHTML = html;
    }
  }

  // ------------------------------------------------------------ wrecks and dolphins

  /**
   * A list of the things one kind of pin marks, so they can be found without hunting
   * on the map. `items` are the same objects the pins open: { title, sub, ... }. An item may give
   * its own two lines for the list as `row`.
   * `kind` is the pin kind, for the picture. The section follows its map layer.
   */
  renderPlaces(id, kind, heading, items, on, empty) {
    const el = $(id);
    el.hidden = !on;
    if (el.hidden) return;
    this.infos[id] = items;
    const row = (it, i) => `<li><button type="button" class="ship place" data-info="${i}">
        <span class="badge k-${kind}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind]}</svg></span>
        <span class="txt"><span class="name">${esc(it.row ? it.row[0] : it.title)}</span><span class="what">${esc(it.row ? it.row[1] : it.sub || '')}</span></span></button></li>`;
    const html = `<div class="group"><h2>${esc(heading)}<span class="count">${items.length}</span></h2>${items.length ? `<ul class="ship-list">${items.map(row).join('')}</ul>` : `<p class="empty">${esc(empty)}</p>`}</div>`;
    if (html !== this[`_${id}`]) {
      this[`_${id}`] = html;
      el.innerHTML = html;
    }
  }

  // ------------------------------------------------------------ harbor log

  renderLog(logFeed, now = Date.now()) {
    const el = $('harbor-log');
    const st = logFeed.state.log;
    const d = st.data;
    // On a host without the log (Vercel) the section simply is not there.
    el.hidden = !this.show.log || (!d && st.error !== 'not started');
    if (el.hidden) return;
    let body;
    if (!d) {
      body = '<p class="empty">The log starts with the next ten minute check of the harbor.</p>';
    } else {
      const days = Object.keys(d.days || {}).sort();
      const today = d.days[days[days.length - 1]] || { arrivals: [], departures: [], ships: [] };
      const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      const stays = Object.values(d.present || {}).filter((s) => s.since).sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
      const longest = stays[0];
      const stay = (ms) => (ms >= 2 * 86400e3 ? `${Math.round(ms / 86400e3)} days` : `${Math.max(1, Math.round(ms / 3600e3))} hours`);
      const events = [...today.arrivals.map((a) => ({ ...a, what: 'arrived' })), ...today.departures.map((a) => ({ ...a, what: 'left' }))]
        .sort((a, b) => Date.parse(b.t) - Date.parse(a.t)).slice(0, 8);
      const facts = [
        ['Today', `${n(today.arrivals.length, 'arrival', 'arrivals')}, ${n(today.departures.length, 'departure', 'departures')}, ${n((today.ships || []).length, 'ship', 'ships')} seen`],
        today.biggest ? ['Biggest today', `${today.biggest.name || `MMSI ${today.biggest.mmsi}`}, ${Math.round(today.biggest.length)} m`] : null,
        longest ? ['Longest stay', `${longest.name || `MMSI ${longest.mmsi}`}, here ${stay(now - Date.parse(longest.since))}`] : null,
      ].filter(Boolean);
      body = `<dl class="log-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
        + (events.length ? `<ul class="log-events">${events.map((e) => `<li><time>${esc(clock(Date.parse(e.t)))}</time><span>${esc(e.name || `MMSI ${e.mmsi}`)} ${e.what}${e.stayHours ? ` after ${esc(stay(e.stayHours * 3600e3))}` : ''}</span></li>`).join('')}</ul>` : '')
        + `<p class="empty">Large ships only. Kept since ${esc(clockSmart(Date.parse(d.since), now))}.</p>`;
    }
    const html = `<details class="group" data-list="log"${this.logOpen ? ' open' : ''}><summary><h2>Harbor log</h2></summary>${body}</details>`;
    if (html !== this._log) {
      this._log = html;
      el.innerHTML = html;
    }
  }

  /** One line for the handle of the board on a phone. */
  renderSummary(feed, fleet) {
    const tide = feed.state.tide.data;
    const ships = [...fleet.entities.values()].filter((e) => !e.gone && e.group === 'ship').length;
    const parts = [];
    if (tide && tide.level) parts.push(`Tide ${tide.level.ft.toFixed(1)} ft${tide.ftPerHour == null || Math.abs(tide.ftPerHour) < 0.15 ? '' : tide.ftPerHour > 0 ? ' rising' : ' falling'}`);
    if (feed.state.ais.data) parts.push(ships === 1 ? '1 large ship' : `${ships} large ships`);
    const text = parts.join(' · ') || 'Tide, bridge and ships';
    if (text !== this._sum) {
      this._sum = text;
      $('sheet-sum').textContent = text;
    }
  }

  // ------------------------------------------------------------ status

  renderStatus(feed, now = Date.now()) {
    const el = $('status');
    const ais = feed.state.ais;
    const lines = [];
    if (ais.stale && !ais.at) {
      lines.push(`<p class="is-stale"><span class="dot"></span><span>The ship feed has not answered, so no ships are drawn. Trying again at ${esc(clock(feed.nextAt))}.</span></p>`);
    } else if (ais.stale) {
      lines.push(`<p class="is-stale"><span class="dot"></span><span>Ship positions are stale. Last good data ${esc(clockSmart(ais.at, now))}. Trying again at ${esc(clock(feed.nextAt))}.</span></p>`);
    } else if (ais.at) {
      lines.push(`<p><span class="dot"></span><span>Ships updated ${esc(clockSec(ais.at))} ${esc(zoneName(ais.at))}</span></p>`);
    } else {
      lines.push('<p><span class="dot"></span><span>Reading live data</span></p>');
    }
    const noaaStale = feed.state.tide.stale || feed.state.airGap.stale;
    if (noaaStale) {
      const which = feed.state.tide.stale && feed.state.airGap.stale ? 'Tide and clearance are' : feed.state.tide.stale ? 'Tide is' : 'Bridge clearance is';
      const none = !feed.state.tide.at && !feed.state.airGap.at;
      lines.push(`<p class="is-stale"><span class="dot"></span><span>${none ? 'NOAA has not answered' : `${which} stale`}. Trying again at ${esc(clock(feed.nextAt))}.</span></p>`);
    } else if (feed.state.tide.at) {
      lines.push(`<p><span class="dot"></span><span>Tide and clearance updated ${esc(clock(feed.state.tide.at))}</span></p>`);
    }
    lines.push(`<p class="next">${feed.loading ? 'Refreshing now' : `Next refresh in ${countdown(feed.nextAt - now)}`}</p>`);
    const html = lines.join('');
    if (html !== this._status) {
      el.innerHTML = html;
      this._status = html;
    }
  }

  renderCredits(feed) {
    const ais = (feed.state.ais.data && feed.state.ais.data.attribution) || ['Open Waters AIS (https://openwaters.io/ais/)'];
    const names = ais.map((s) => s.replace(/\s*\(https?:[^)]*\)/, '')).join(', ');
    const text = `Imagery: USGS The National Map, USDA NAIP aerial photos. Map data: © OpenStreetMap contributors. Channel: US Army Corps of Engineers. Ships: ${names}. Tide, clearance, weather and currents: NOAA CO-OPS. Buoys, lights and wrecks: NOAA Office of Coast Survey. Alerts and forecast: National Weather Service. Dolphin sightings: iNaturalist. Ship backstories: Wikidata and Wikimedia Commons.`;
    if (text !== this._credits) {
      this._credits = text;
      $('map-credits').textContent = text;
      $('credits').textContent = `${text} Not for navigation.`;
    }
  }

  tick(now = Date.now()) {
    $('clock').textContent = `${dayLabel(now)}, ${clock(now)} ${zoneName(now)}`;
  }
}

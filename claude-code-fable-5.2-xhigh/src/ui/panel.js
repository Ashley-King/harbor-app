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
  constructor({ onSelect, onToggleOthers }) {
    this.onSelect = onSelect;
    this.listEl = $('ship-lists');
    this.listEl.addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-mmsi]');
      if (row) this.onSelect(Number(row.dataset.mmsi));
    });
    $('toggle-others').addEventListener('change', (ev) => onToggleOthers(ev.target.checked));
    this.tugsOpen = false;
    this.smallOpen = false;
    this.listEl.addEventListener('toggle', (ev) => {
      if (!ev.target.matches('details')) return;
      if (ev.target.dataset.list === 'small') this.smallOpen = ev.target.open;
      else this.tugsOpen = ev.target.open;
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
    const bySize = (a, b) => (b.v.length || 0) - (a.v.length || 0) || String(a.v.name).localeCompare(String(b.v.name));
    const row = (e, note) => {
      const v = e.v;
      const country = countryName(v.flag);
      const what = [kindText(e), country].filter(Boolean).join(', ');
      const size = v.length != null ? `${Math.round(v.length)} m` : 'size unknown';
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
    const text = `Imagery: USGS The National Map, USDA NAIP aerial photos. Map data: © OpenStreetMap contributors. Channel: US Army Corps of Engineers. Ships: ${names}. Tide and clearance: NOAA CO-OPS.`;
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

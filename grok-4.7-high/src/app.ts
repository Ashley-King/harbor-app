import maplibregl from "maplibre-gl";
import type { HarborResponse, Ship, ShipsFeed } from "./types";
import { distanceToRingMeters, nearestBerthHeading, shipCenter } from "./geo";
import {
  channel,
  channelLabel,
  donHoltLabel,
  harborBounds,
  lamps,
  ravenelLabel,
  terminals,
  wandoChannel,
} from "./places";
import { drawScene, type ScreenLabel, type ScreenLamp, type ScreenLine, type Sprite } from "./render";
import { lookAmount, lookIsNight, sunState, type LookMode } from "./sun";

const REFRESH_MS = 10 * 60 * 1000;
const ALONGSIDE_M = 320;
const CHARLESTON = "America/New_York";
const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const NAV: Record<number, string> = {
  0: "Under way",
  1: "At anchor",
  2: "Not under command",
  3: "Restricted maneuverability",
  4: "Constrained by draught",
  5: "Moored",
  6: "Aground",
  7: "Fishing",
  8: "Under sail",
};

type Motion = {
  fromLat: number;
  fromLon: number;
  fromHdg: number;
  toLat: number;
  toLon: number;
  toHdg: number;
  start: number;
  dur: number;
  appear: number;
  fadeStart: number | null;
  opacity: number;
  trail: { lng: number; lat: number; t: number }[];
};

type Reading = { feet: number; asOf: string; stale: boolean };

type Placed = Ship & { placeLat: number; placeLon: number; placeHdg: number; terminalId: string | null };

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: CHARLESTON,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

export function start() {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;

  const mapNode = el("div");
  mapNode.id = "map";
  const canvas = el("canvas");
  canvas.id = "scene";
  const mast = el("header", "mast");
  const panel = el("aside", "panel");
  const card = el("article", "card");
  const credit = el("p", "credit");
  card.hidden = true;
  credit.textContent =
    "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community · Ships © Open Waters AIS · Tides and clearance © NOAA CO-OPS · Places © OpenStreetMap contributors";
  mast.append(
    p("eyebrow", "Live overhead"),
    Object.assign(el("h1"), { textContent: "Charleston Harbor" }),
  );
  app.append(mapNode, canvas, mast, panel, card, credit);

  const modeButtons = (["auto", "day", "night"] as LookMode[]).map((mode) => {
    const button = el("button");
    button.type = "button";
    button.textContent = mode === "auto" ? "Auto" : mode === "day" ? "Day" : "Night";
    button.dataset.mode = mode;
    return button;
  });
  const fitButton = el("button", "text-btn");
  fitButton.type = "button";
  fitButton.textContent = "Whole harbor";

  let mode = readMode();
  let sun = sunState();
  let shipsFeed: ShipsFeed = { ok: false, error: "Waiting for AIS" };
  let shipsAt: string | null = null;
  let tideReading: Reading | null = null;
  let clearanceReading: Reading | null = null;
  let selected: number | null = null;
  const motions = new Map<number, Motion>();
  const shipByMmsi = new Map<number, Ship>();
  let retriedEmpty = false;

  const map = new maplibregl.Map({
    container: mapNode,
    attributionControl: false,
    pitchWithRotate: false,
    dragRotate: false,
    maxPitch: 0,
    minZoom: 10,
    maxZoom: 18,
    bounds: harborBounds,
    fitBoundsOptions: { padding: mapPadding() },
    style: {
      version: 8,
      sources: {
        imagery: {
          type: "raster",
          tiles: [IMAGERY],
          tileSize: 256,
          maxzoom: 18,
          attribution: "Esri, Maxar, Earthstar Geographics",
        },
      },
      layers: [{ id: "imagery", type: "raster", source: "imagery" }],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "bottom-left");

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  function paintLook() {
    sun = sunState();
    const night = lookAmount(mode, sun.night);
    document.documentElement.dataset.look = lookIsNight(mode, sun.night) ? "night" : "day";
    for (const button of modeButtons) {
      button.setAttribute("aria-pressed", button.dataset.mode === mode ? "true" : "false");
    }
    if (map.isStyleLoaded() && map.getLayer("imagery")) {
      map.setPaintProperty("imagery", "raster-brightness-min", 0);
      map.setPaintProperty("imagery", "raster-brightness-max", 1 - night * 0.68);
      map.setPaintProperty("imagery", "raster-saturation", -0.4 * night);
      map.setPaintProperty("imagery", "raster-contrast", 0.04 + night * 0.06);
    }
  }

  map.on("load", () => {
    paintLook();
    map.fitBounds(harborBounds, { padding: mapPadding(), duration: 0 });
    resize();
    requestAnimationFrame(frame);
  });
  map.on("resize", resize);
  window.addEventListener("resize", resize);

  function resize() {
    const rect = mapNode.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(now: number) {
    if (map.isStyleLoaded()) {
      const night = lookAmount(mode, sun.night);
      const zoom = map.getZoom();
      const bearing = map.getBearing();
      const placed = placeShips(now);
      const sprites = placed.map((ship) => toSprite(ship, now, zoom, bearing, night));
      const screenLamps: ScreenLamp[] = lamps.map((lamp) => {
        const point = map.project([lamp.lng, lamp.lat]);
        return { x: point.x, y: point.y, kind: lamp.kind };
      });
      const lines: ScreenLine[] = [projectLine(channel), projectLine(wandoChannel)];
      const labels: ScreenLabel[] = [
        labelAt(ravenelLabel, "Ravenel Bridge", "bridge"),
        labelAt(donHoltLabel, "Don Holt Bridge", "bridge"),
        labelAt(channelLabel, "Shipping Channel", "channel"),
        ...terminals.map((terminal) => labelAt(terminal.label, terminal.name, "terminal")),
      ];
      const rect = mapNode.getBoundingClientRect();
      drawScene(ctx!, rect.width, rect.height, night, lines, screenLamps, sprites, labels, now);
    }
    requestAnimationFrame(frame);
  }

  function projectLine(line: [number, number][]): ScreenLine {
    return { points: line.map(([lng, lat]) => map.project([lng, lat])) };
  }

  function labelAt(lngLat: [number, number], text: string, kind: ScreenLabel["kind"]): ScreenLabel {
    const point = map.project(lngLat);
    return { x: point.x, y: point.y, text, kind };
  }

  function placeShips(now: number): Placed[] {
    const out: Placed[] = [];
    for (const ship of shipByMmsi.values()) {
      const motion = motions.get(ship.mmsi);
      if (!motion) continue;
      const sample = sampleMotion(motion, now);
      const faded = motion.fadeStart == null ? 1 : Math.max(0, 1 - (now - motion.fadeStart) / 1600);
      const appeared = Math.min(1, (now - motion.appear) / 700);
      if (faded <= 0) {
        motions.delete(ship.mmsi);
        continue;
      }
      const heading = sample.hdg;
      const center = shipCenter(sample.lat, sample.lon, heading, ship.toBow, ship.toStern, ship.toPort, ship.toStarboard, ship.lengthM);
      rememberTrail(motion, center.lon, center.lat, now);
      const terminalId = terminalFor(ship, center.lat, center.lon);
      out.push({ ...ship, placeLat: center.lat, placeLon: center.lon, placeHdg: heading, terminalId, sog: ship.sog });
      motion.opacity = faded * appeared;
    }
    return out;

    function rememberTrail(motion: Motion, lng: number, lat: number, time: number) {
      const last = motion.trail[motion.trail.length - 1];
      if (last && time - last.t < 350) return;
      if (last) {
        const moved = distanceMeters(last.lng, last.lat, lng, lat);
        if (moved < 8) return;
      }
      motion.trail.push({ lng, lat, t: time });
      const cutoff = time - 4 * 60 * 1000;
      motion.trail = motion.trail.filter((point) => point.t >= cutoff).slice(-18);
    }
  }

  function toSprite(ship: Placed, now: number, zoom: number, bearing: number, night: number): Sprite {
    const point = map.project([ship.placeLon, ship.placeLat]);
    const mpp = metersPerPixel(ship.placeLat, zoom);
    const scaled = scaledSize(ship, mpp);
    const lengthPx = scaled.lengthPx;
    const beamPx = scaled.beamPx;
    const motion = motions.get(ship.mmsi);
    const trail = (motion?.trail ?? [])
      .map((item) => map.project([item.lng, item.lat]))
      .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
    const angle = ((ship.placeHdg - bearing) * Math.PI) / 180;
    const screenAngle = ((sun.azimuth - bearing) * Math.PI) / 180;
    const sunScreenX = Math.sin(screenAngle);
    const sunScreenY = -Math.cos(screenAngle);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return {
      mmsi: ship.mmsi,
      x: point.x,
      y: point.y,
      lengthM: ship.lengthM,
      beamM: ship.beamM,
      lengthPx,
      beamPx,
      angle,
      model: visualModel(ship),
      sog: ship.sog ?? 0,
      opacity: motion?.opacity ?? 1,
      selected: selected === ship.mmsi,
      name: ship.name,
      showName: zoom >= 13.4 || selected === ship.mmsi,
      sunX: sunScreenX * c + sunScreenY * s,
      sunY: -sunScreenX * s + sunScreenY * c,
      sunAlt: sun.altitude,
      trail,
    };
  }

  map.on("click", (event) => {
    const hit = pickShip(event.point.x, event.point.y);
    selected = hit?.mmsi ?? null;
    renderPanel();
    renderCard();
    if (hit && map.getZoom() < 14) focusShip(hit);
  });
  map.on("mousemove", (event) => {
    map.getCanvas().style.cursor = pickShip(event.point.x, event.point.y) ? "pointer" : "";
  });

  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      mode = button.dataset.mode as LookMode;
      localStorage.setItem("harbor-look", mode);
      paintLook();
      renderPanel();
    });
  }
  fitButton.addEventListener("click", () => {
    map.fitBounds(harborBounds, { padding: mapPadding(), duration: 900 });
  });

  let scroll = 0;
  panel.addEventListener("scroll", () => {
    scroll = panel.scrollTop;
  });
  renderPanel();
  paintLook();
  void loadHarbor();
  window.setInterval(() => void loadHarbor(), REFRESH_MS);
  window.setInterval(() => {
    if (mode === "auto") paintLook();
  }, 60 * 1000);

  async function loadHarbor() {
    try {
      const res = await fetch("/api/harbor", { cache: "no-store" });
      if (!res.ok) throw new Error("bad status");
      const body = (await res.json()) as HarborResponse;
      applyFeed(body);
    } catch {
      if (shipsAt) shipsFeed = { ok: false, error: "AIS feed unavailable" };
      if (tideReading) tideReading = { ...tideReading, stale: true };
      if (clearanceReading) clearanceReading = { ...clearanceReading, stale: true };
    }
    renderPanel();
    renderCard();
    if (!shipsAt && !retriedEmpty) {
      retriedEmpty = true;
      window.setTimeout(() => {
        if (!shipsAt) void loadHarbor();
      }, 8000);
    }
  }

  function applyFeed(body: HarborResponse) {
    if (body.ships.ok) {
      shipsFeed = body.ships;
      shipsAt = body.ships.asOf;
      syncMotions(body.ships.vessels);
    } else if (shipsAt) {
      shipsFeed = { ok: false, error: body.ships.error };
    } else {
      shipsFeed = body.ships;
    }
    if (body.tide.ok) tideReading = { feet: body.tide.feet, asOf: body.tide.asOf, stale: false };
    else if (tideReading) tideReading = { ...tideReading, stale: true };
    if (body.clearance.ok) clearanceReading = { feet: body.clearance.feet, asOf: body.clearance.asOf, stale: false };
    else if (clearanceReading) clearanceReading = { ...clearanceReading, stale: true };
  }

  function syncMotions(vessels: Ship[]) {
    const now = performance.now();
    const seen = new Set<number>();
    shipByMmsi.clear();
    for (const ship of vessels) {
      seen.add(ship.mmsi);
      shipByMmsi.set(ship.mmsi, ship);
      const heading = headingFor(ship);
      const prev = motions.get(ship.mmsi);
      const current = prev ? sampleMotion(prev, now) : null;
      const trail = prev?.trail ?? [];
      motions.set(ship.mmsi, {
        fromLat: current?.lat ?? ship.lat,
        fromLon: current?.lon ?? ship.lon,
        fromHdg: current?.hdg ?? heading,
        toLat: ship.lat,
        toLon: ship.lon,
        toHdg: heading,
        start: now,
        dur: current ? 18000 : 0,
        appear: prev?.appear ?? now,
        fadeStart: null,
        opacity: prev?.opacity ?? 1,
        trail,
      });
    }
    for (const [mmsi, motion] of motions) {
      if (!seen.has(mmsi) && motion.fadeStart == null) motion.fadeStart = now;
    }
    if (selected != null && !seen.has(selected)) selected = null;
  }

  function renderPanel() {
    panel.replaceChildren();
    const modes = el("div", "row modes");
    modes.append(...modeButtons, fitButton);
    panel.append(modes, gauges(), feedLine(), ...groups());
    panel.scrollTop = scroll;
  }

  function gauges() {
    const wrap = el("div", "gauges");
    wrap.append(gauge("Tide", tideReading, "ft MLLW"), gauge("Ravenel clearance", clearanceReading, "ft"));
    return wrap;
  }

  function gauge(title: string, reading: Reading | null, unit: string) {
    const block = el("div", "gauge");
    const label = el("span");
    label.textContent = title;
    const value = el("strong");
    const note = el("em");
    if (reading) {
      value.textContent = `${reading.feet.toFixed(1)} ${unit}`;
      note.textContent = reading.stale ? `Stale · ${formatWhen(reading.asOf)}` : formatWhen(reading.asOf);
      if (reading.stale) note.className = "stale";
    } else {
      value.textContent = "—";
      note.textContent = "Waiting";
    }
    block.append(label, value, note);
    return block;
  }

  function feedLine() {
    const line = el("p", "feed");
    if (shipsFeed.ok) {
      const large = shipsFeed.vessels.filter((ship) => !isWork(ship)).length;
      line.textContent = `${large} large ship${large === 1 ? "" : "s"} · updated ${formatWhen(shipsFeed.asOf)}`;
    } else if (shipsAt) {
      line.className = "feed stale";
      line.textContent = `Ships stale · last good ${formatWhen(shipsAt)}`;
    } else {
      line.textContent = "Waiting for live ship positions";
    }
    return line;
  }

  function groups() {
    const waiting = !shipsFeed.ok && shipByMmsi.size === 0;
    const vessels = shipsFeed.ok ? shipsFeed.vessels : [...shipByMmsi.values()];
    const placed = vessels.map((ship) => ({ ship, terminalId: terminalFor(ship, ship.lat, ship.lon) }));
    const nodes = [];
    for (const terminal of terminals) {
      const rows = placed.filter((item) => item.terminalId === terminal.id).map((item) => item.ship);
      nodes.push(group(terminal.name, rows, waiting ? "Waiting" : "No large ships alongside"));
    }
    const harbor = placed.filter((item) => item.terminalId == null && !isWork(item.ship)).map((item) => item.ship);
    const boats = placed.filter((item) => item.terminalId == null && isWork(item.ship)).map((item) => item.ship);
    nodes.push(group("In the harbor", harbor, waiting ? "Waiting" : "None reported"));
    nodes.push(group("Tugs and pilots", boats, waiting ? "Waiting" : "None reported"));
    return nodes;
  }

  function group(title: string, rows: Ship[], empty: string) {
    const section = el("section", "group");
    const heading = el("h3");
    heading.textContent = title;
    section.append(heading);
    if (!rows.length) {
      section.append(p("empty", empty));
      return section;
    }
    const ordered = [...rows].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    for (const ship of ordered) {
      const button = el("button", "ship-btn");
      button.type = "button";
      if (selected === ship.mmsi) button.setAttribute("aria-current", "true");
      const name = el("b");
      name.textContent = ship.name ?? "Unknown";
      const meta = el("span");
      meta.textContent = shipMeta(ship);
      button.append(name, meta);
      button.addEventListener("click", () => {
        selected = ship.mmsi;
        renderPanel();
        renderCard();
        focusShip(ship);
      });
      section.append(button);
    }
    return section;
  }

  function renderCard() {
    const ship = selected == null ? null : shipByMmsi.get(selected) ?? null;
    card.hidden = !ship;
    card.replaceChildren();
    if (!ship) return;
    const header = el("header");
    const title = el("h2");
    title.textContent = ship.name ?? "Unknown";
    const close = el("button", "close");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      selected = null;
      renderPanel();
      renderCard();
    });
    header.append(title, close);
    const flag = el("p", "flag");
    flag.textContent = flagName(ship.flag);
    const fields = el("dl", "fields");
    addField(fields, "Type", ship.typeLabel);
    addField(fields, "IMO", ship.imo);
    addField(fields, "Size", sizeText(ship));
    addField(fields, "Speed", ship.sog == null ? null : `${ship.sog.toFixed(1)} kn`);
    addField(fields, "Status", ship.navStatus == null ? null : NAV[ship.navStatus] ?? null);
    addField(fields, "Draught", ship.draughtM == null ? null : meters(ship.draughtM));
    addField(fields, "Destination", ship.destination);
    addField(fields, "ETA", formatEta(ship.eta));
    addField(fields, "Last report", ship.seen ? formatWhen(ship.seen) : null);
    card.append(header, flag, fields);
  }

  function focusShip(ship: { lon: number; lat: number }) {
    map.easeTo({
      center: [ship.lon, ship.lat],
      zoom: Math.max(map.getZoom(), 15),
      padding: mapPadding(),
      duration: 1100,
    });
  }

  function pickShip(x: number, y: number): Ship | null {
    let best: { ship: Ship; score: number } | null = null;
    const zoom = map.getZoom();
    for (const ship of shipByMmsi.values()) {
      const motion = motions.get(ship.mmsi);
      if (!motion || motion.fadeStart != null) continue;
      const sample = sampleMotion(motion, performance.now());
      const heading = sample.hdg;
      const center = shipCenter(sample.lat, sample.lon, heading, ship.toBow, ship.toStern, ship.toPort, ship.toStarboard, ship.lengthM);
      const point = map.project([center.lon, center.lat]);
      const mpp = metersPerPixel(center.lat, zoom);
      const lengthPx = ship.lengthM == null ? 16 : Math.max(ship.lengthM / mpp, 8);
      const beamPx = ship.beamM == null ? 8 : Math.max(ship.beamM / mpp, 8);
      const angle = ((heading - map.getBearing()) * Math.PI) / 180;
      const dx = x - point.x;
      const dy = y - point.y;
      const c = Math.cos(-angle);
      const s = Math.sin(-angle);
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      const inside = Math.abs(lx) <= beamPx / 2 && Math.abs(ly) <= lengthPx / 2;
      const dist = Math.hypot(dx, dy);
      if (!inside && dist > 16) continue;
      const score = inside ? Math.abs(lx) + Math.abs(ly) : dist + 100;
      if (!best || score < best.score) best = { ship, score };
    }
    return best?.ship ?? null;
  }
}

function headingFor(ship: Ship): number {
  if (ship.heading != null) return ship.heading;
  if (ship.sog != null && ship.sog >= 0.5 && ship.cog != null) return ship.cog;
  let best: { dist: number; heading: number } | null = null;
  for (const terminal of terminals) {
    const dist = distanceToRingMeters(ship.lon, ship.lat, terminal.ring);
    if (dist > ALONGSIDE_M) continue;
    const heading = nearestBerthHeading(ship.lon, ship.lat, terminal.ring, ship.cog);
    if (heading == null) continue;
    if (!best || dist < best.dist) best = { dist, heading };
  }
  if (best) return best.heading;
  if (ship.cog != null) return ship.cog;
  return 0;
}

function terminalFor(ship: Ship, lat: number, lon: number): string | null {
  if (ship.navStatus === 1) return null;
  if (ship.sog != null && ship.sog > 1.2) return null;
  let best: { id: string; dist: number } | null = null;
  for (const terminal of terminals) {
    const dist = distanceToRingMeters(lon, lat, terminal.ring);
    if (!best || dist < best.dist) best = { id: terminal.id, dist };
  }
  return best && best.dist <= ALONGSIDE_M ? best.id : null;
}

function scaledSize(ship: { lengthM: number | null; beamM: number | null }, mpp: number) {
  if (ship.lengthM == null || ship.beamM == null) return { lengthPx: 16, beamPx: 6 };
  const trueLen = ship.lengthM / mpp;
  const trueBeam = ship.beamM / mpp;
  const floor = ship.lengthM >= 150 ? 48 : ship.lengthM >= 40 ? 14 : 8;
  const boost = Math.max(1, floor / Math.max(trueLen, 0.5));
  return { lengthPx: trueLen * boost, beamPx: trueBeam * boost };
}

function visualModel(ship: Placed): Ship["model"] {
  if (
    ship.model === "cargo" &&
    (ship.typeLabel == null || ship.typeLabel === "Cargo ship") &&
    (ship.lengthM ?? 0) >= 160 &&
    (ship.terminalId === "wando" || ship.terminalId === "north-charleston" || ship.terminalId === "leatherman")
  ) {
    return "container";
  }
  return ship.model;
}

function isWork(ship: Ship): boolean {
  return ship.model === "tug" || ship.model === "pilot";
}

function sampleMotion(motion: Motion, now: number): { lat: number; lon: number; hdg: number } {
  const t = motion.dur <= 0 ? 1 : smooth(Math.min(1, Math.max(0, (now - motion.start) / motion.dur)));
  return {
    lat: motion.fromLat + (motion.toLat - motion.fromLat) * t,
    lon: motion.fromLon + (motion.toLon - motion.fromLon) * t,
    hdg: lerpAngle(motion.fromHdg, motion.toHdg, t),
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerpAngle(from: number, to: number, t: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

function distanceMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const lat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const east = (lng2 - lng1) * 111320 * Math.cos(lat);
  const north = (lat2 - lat1) * 111320;
  return Math.hypot(east, north);
}

function mapPadding(): maplibregl.PaddingOptions {
  const narrow = window.innerWidth < 800;
  return narrow
    ? { top: 70, left: 16, right: 16, bottom: Math.round(window.innerHeight * 0.42) }
    : { top: 24, left: 24, right: 400, bottom: 24 };
}

function readMode(): LookMode {
  const saved = localStorage.getItem("harbor-look");
  return saved === "day" || saved === "night" || saved === "auto" ? saved : "auto";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return timeFmt.format(date);
}

function formatEta(eta: string | null): string | null {
  if (!eta) return null;
  const match = eta.trim().match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return eta.trim();
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return eta.trim();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[month - 1]} ${day}, ${match[3].padStart(2, "0")}:${match[4]}`;
}

function meters(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} m`;
}

function sizeText(ship: Ship): string | null {
  if (ship.lengthM == null && ship.beamM == null) return null;
  const length = ship.lengthM == null ? "unknown" : meters(ship.lengthM);
  const beam = ship.beamM == null ? "unknown" : meters(ship.beamM);
  return `${length} × ${beam}`;
}

function flagName(code: string | null): string {
  if (!code) return "Unknown flag";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function shipMeta(ship: Ship): string {
  if (ship.sog != null && ship.sog >= 0.5) return `${ship.sog.toFixed(1)} kn`;
  if (ship.navStatus != null && NAV[ship.navStatus]) return NAV[ship.navStatus];
  if (ship.sog === 0) return "Stopped";
  return "—";
}

function addField(list: HTMLDListElement, label: string, value: string | null) {
  const dt = el("dt");
  dt.textContent = label;
  const dd = el("dd");
  if (value) dd.textContent = value;
  else {
    dd.className = "unknown";
    dd.textContent = "unknown";
  }
  list.append(dt, dd);
}

function p(className: string, text: string) {
  const node = el("p", className);
  node.textContent = text;
  return node;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

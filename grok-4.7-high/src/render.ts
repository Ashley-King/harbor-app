import type { ShipModel } from "./types";

export type Point = { x: number; y: number };

export type Sprite = {
  mmsi: number;
  x: number;
  y: number;
  lengthM: number | null;
  beamM: number | null;
  lengthPx: number;
  beamPx: number;
  angle: number;
  model: ShipModel;
  sog: number;
  opacity: number;
  selected: boolean;
  name: string | null;
  showName: boolean;
  sunX: number;
  sunY: number;
  sunAlt: number;
  trail: Point[];
};

export type ScreenLamp = { x: number; y: number; kind: "bridge" | "tower" | "wharf" | "crane" | "street" };
export type ScreenLine = { points: Point[]; label?: string; labelAt?: Point };
export type ScreenLabel = { x: number; y: number; text: string; kind: "bridge" | "terminal" | "channel" };

const BOXES = ["#c8bba6", "#8d3a2c", "#1d4e89", "#e4ded2", "#2d6a4a", "#3e4750", "#a34532", "#d8c39a", "#16324f", "#8a6a32"];

export function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  night: number,
  lines: ScreenLine[],
  lamps: ScreenLamp[],
  ships: Sprite[],
  labels: ScreenLabel[],
  now: number,
) {
  ctx.clearRect(0, 0, width, height);
  for (const line of lines) drawChannel(ctx, line, night);
  if (night > 0.08) drawLamps(ctx, lamps, night, now);
  for (const ship of ships) drawTrail(ctx, ship, night);
  for (const ship of ships) drawShip(ctx, ship, night, now);
  for (const label of labels) drawLabel(ctx, label, night);
}

function drawChannel(ctx: CanvasRenderingContext2D, line: ScreenLine, night: number) {
  if (line.points.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(line.points[0].x, line.points[0].y);
  for (const point of line.points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.setLineDash([7, 8]);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = night > 0.5 ? `rgba(186, 224, 232, ${0.28 + night * 0.22})` : "rgba(255,255,255,0.72)";
  ctx.stroke();
  ctx.restore();
}

function drawLamps(ctx: CanvasRenderingContext2D, lamps: ScreenLamp[], night: number, now: number) {
  for (const lamp of lamps) {
    const pulse = 0.82 + 0.18 * Math.sin(now / 700 + lamp.x * 0.02);
    const alpha = night * pulse;
    if (lamp.kind === "tower") glow(ctx, lamp.x, lamp.y, 16, `rgba(255, 244, 214, ${0.55 * alpha})`);
    else if (lamp.kind === "crane") glow(ctx, lamp.x, lamp.y, 5.5, `rgba(255, 64, 48, ${0.8 * alpha})`);
    else if (lamp.kind === "bridge") glow(ctx, lamp.x, lamp.y, 4.2, `rgba(255, 236, 196, ${0.55 * alpha})`);
    else if (lamp.kind === "street") glow(ctx, lamp.x, lamp.y, 3.4, `rgba(255, 186, 96, ${0.45 * alpha})`);
    else glow(ctx, lamp.x, lamp.y, 6.5, `rgba(255, 244, 220, ${0.38 * alpha})`);
  }
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawTrail(ctx: CanvasRenderingContext2D, ship: Sprite, night: number) {
  if (ship.trail.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.2, ship.beamPx * 0.18);
  for (let i = 1; i < ship.trail.length; i++) {
    const fade = i / ship.trail.length;
    const alpha = fade * (night > 0.5 ? 0.28 : 0.4) * ship.opacity;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(ship.trail[i - 1].x, ship.trail[i - 1].y);
    ctx.lineTo(ship.trail[i].x, ship.trail[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShip(ctx: CanvasRenderingContext2D, ship: Sprite, night: number, now: number) {
  if (ship.lengthM == null || ship.beamM == null || ship.lengthM < 2) {
    drawMarker(ctx, ship, night);
    paintNavLights(ctx, ship, night, now);
    if (ship.showName) drawName(ctx, ship, night);
    return;
  }
  const ppm = ship.lengthPx / ship.lengthM;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  ctx.scale(ppm, ppm);
  ctx.globalAlpha = ship.opacity;
  paintHull(ctx, ship, night, now);
  if (ship.selected) {
    traceHull(ctx, ship.lengthM, ship.beamM, bowFactor(ship.model));
    ctx.strokeStyle = "#e4c27a";
    ctx.lineWidth = 2.2 / ppm;
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  ctx.scale(ppm, ppm);
  traceHull(ctx, ship.lengthM, ship.beamM, bowFactor(ship.model));
  ctx.strokeStyle = "rgba(6,8,12,0.9)";
  ctx.lineWidth = 1.7 / ppm;
  ctx.stroke();
  ctx.restore();
  drawWake(ctx, ship, night);
  paintNavLights(ctx, ship, night, now);
  if (ship.showName || ship.selected) drawName(ctx, ship, night);
}

function drawMarker(ctx: CanvasRenderingContext2D, ship: Sprite, night: number) {
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  ctx.globalAlpha = ship.opacity;
  ctx.fillStyle = night > 0.5 ? "#d9d3c6" : "#f4f1ea";
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(3.5, 7);
  ctx.lineTo(-3.5, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawName(ctx: CanvasRenderingContext2D, ship: Sprite, night: number) {
  if (!ship.name) return;
  ctx.save();
  ctx.font = "600 12px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 3;
  ctx.strokeStyle = night > 0.5 ? "rgba(6,10,16,0.85)" : "rgba(12,18,24,0.72)";
  ctx.fillStyle = night > 0.5 ? "#f6edd8" : "#ffffff";
  const y = ship.y - Math.max(10, ship.lengthPx / 2) - 4;
  ctx.strokeText(ship.name, ship.x, y);
  ctx.fillText(ship.name, ship.x, y);
  ctx.restore();
}

function paintHull(ctx: CanvasRenderingContext2D, ship: Sprite, night: number, now: number) {
  const length = ship.lengthM!;
  const beam = ship.beamM!;
  const bow = bowFactor(ship.model);
  const body = 1 - night * 0.22;
  ctx.save();
  ctx.globalAlpha *= body;
  drawShadow(ctx, length, beam, bow, ship);
  traceHull(ctx, length, beam, bow);
  ctx.fillStyle = hullColor(ship.model, ship.mmsi);
  ctx.fill();
  ctx.save();
  traceHull(ctx, length, beam, bow);
  ctx.clip();
  paintDeck(ctx, ship, length, beam);
  ctx.restore();
  traceHull(ctx, length, beam, bow);
  ctx.strokeStyle = night > 0.55 ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.38)";
  ctx.lineWidth = 0.55;
  ctx.stroke();
  ctx.restore();
  void now;
}

function paintDeck(ctx: CanvasRenderingContext2D, ship: Sprite, length: number, beam: number) {
  const hl = length / 2;
  if (ship.model === "container") paintContainers(ctx, ship.mmsi, length, beam);
  else if (ship.model === "tanker") paintTanker(ctx, length, beam);
  else if (ship.model === "bulk") paintHatches(ctx, length, beam, "#b7b1a4", "#8d877c");
  else if (ship.model === "roro") paintRoro(ctx, length, beam);
  else if (ship.model === "cruise") paintCruise(ctx, length, beam);
  else if (ship.model === "passenger") paintPassenger(ctx, length, beam);
  else if (ship.model === "tug") paintTug(ctx, length, beam);
  else if (ship.model === "pilot") paintPilot(ctx, length, beam);
  else paintHatches(ctx, length, beam, "#c2b8a6", "#7d776c");
  if (ship.model !== "tug" && ship.model !== "pilot") {
    paintHouse(ctx, length, beam, ship.model === "cruise" ? "#f7f8f6" : "#f3f0e8");
  }
  void hl;
}

function paintContainers(ctx: CanvasRenderingContext2D, mmsi: number, length: number, beam: number) {
  const hl = length / 2;
  const house = Math.min(34, length * 0.14);
  const bow = -hl + length * 0.07;
  const stern = hl - house - length * 0.03;
  const bay = 12.4;
  const gap = 0.45;
  const rows = Math.max(4, Math.round((beam * 0.86) / 2.55));
  const rowW = (beam * 0.86) / rows;
  const left = -((rows * rowW) / 2);
  let index = 0;
  for (let y = bow; y < stern - 4; y += bay) {
    const h = Math.min(bay - gap, stern - y);
    for (let r = 0; r < rows; r++) {
      const color = BOXES[Math.floor(hash(mmsi + index * 17 + r * 3) * BOXES.length)];
      ctx.fillStyle = color;
      ctx.fillRect(left + r * rowW + 0.2, y, rowW - 0.45, h);
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(left + r * rowW + 0.2, y, rowW - 0.45, Math.min(1.1, h * 0.18));
      index++;
    }
  }
}

function paintTanker(ctx: CanvasRenderingContext2D, length: number, beam: number) {
  const hl = length / 2;
  ctx.strokeStyle = "#d5d0c6";
  ctx.lineWidth = Math.max(0.7, beam * 0.035);
  for (const x of [-beam * 0.08, 0, beam * 0.08]) {
    ctx.beginPath();
    ctx.moveTo(x, -hl * 0.72);
    ctx.lineTo(x, hl * 0.48);
    ctx.stroke();
  }
  ctx.fillStyle = "#9d2e28";
  ctx.fillRect(-beam * 0.28, -hl * 0.02, beam * 0.56, Math.max(3.5, length * 0.018));
  ctx.fillStyle = "#ece7dc";
  ctx.fillRect(-beam * 0.28, -hl * 0.02 + 1.1, beam * 0.56, 0.8);
  const step = Math.max(16, length / 9);
  ctx.strokeStyle = "rgba(40,36,30,0.28)";
  ctx.lineWidth = 0.35;
  for (let y = -hl * 0.65; y < hl * 0.42; y += step) {
    ctx.beginPath();
    ctx.moveTo(-beam * 0.42, y);
    ctx.lineTo(beam * 0.42, y);
    ctx.stroke();
  }
}

function paintHatches(ctx: CanvasRenderingContext2D, length: number, beam: number, fill: string, line: string) {
  const hl = length / 2;
  const house = Math.min(32, length * 0.13);
  const top = -hl + length * 0.1;
  const bottom = hl - house - length * 0.04;
  const count = Math.max(4, Math.round((bottom - top) / Math.max(18, length / 8)));
  const gap = (bottom - top) / count;
  for (let i = 0; i < count; i++) {
    const y = top + i * gap + 1.2;
    const h = gap - 2.4;
    ctx.fillStyle = fill;
    ctx.fillRect(-beam * 0.34, y, beam * 0.68, h);
    ctx.strokeStyle = line;
    ctx.lineWidth = 0.45;
    ctx.strokeRect(-beam * 0.34, y, beam * 0.68, h);
  }
}

function paintRoro(ctx: CanvasRenderingContext2D, length: number, beam: number) {
  const hl = length / 2;
  ctx.fillStyle = "rgba(70,74,78,0.18)";
  const bands = Math.max(5, Math.round(length / 22));
  for (let i = 1; i < bands; i++) {
    const y = -hl + (length * i) / bands;
    ctx.fillRect(-beam * 0.42, y, beam * 0.84, 0.7);
  }
  ctx.strokeStyle = "rgba(60,64,68,0.45)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-beam * 0.2, hl * 0.72);
  ctx.lineTo(0, hl * 0.9);
  ctx.lineTo(beam * 0.2, hl * 0.72);
  ctx.stroke();
}

function paintCruise(ctx: CanvasRenderingContext2D, length: number, beam: number) {
  const hl = length / 2;
  const pools = length > 220 ? 3 : 2;
  for (let i = 0; i < pools; i++) {
    const y = -hl * 0.35 + i * Math.min(28, length * 0.08);
    ctx.fillStyle = "#2f86b0";
    ctx.beginPath();
    ctx.ellipse(0, y, beam * 0.16, Math.min(8, length * 0.02), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  ctx.fillStyle = "#f08a3c";
  const boats = Math.max(4, Math.round(length / 28));
  for (let i = 0; i < boats; i++) {
    const y = -hl * 0.45 + i * ((length * 0.62) / boats);
    ctx.fillRect(-beam * 0.48, y, beam * 0.08, 3.2);
    ctx.fillRect(beam * 0.4, y, beam * 0.08, 3.2);
  }
  ctx.fillStyle = "#f4f4f2";
  ctx.fillRect(-beam * 0.08, hl * 0.15, beam * 0.16, Math.min(16, length * 0.05));
  ctx.fillStyle = "#c4562a";
  ctx.fillRect(-beam * 0.05, hl * 0.15, beam * 0.1, Math.min(7, length * 0.02));
}

function paintPassenger(ctx: CanvasRenderingContext2D, length: number, beam: number) {
  const hl = length / 2;
  ctx.fillStyle = "#f7f7f5";
  ctx.fillRect(-beam * 0.32, -hl * 0.15, beam * 0.64, length * 0.38);
  ctx.fillStyle = "#243140";
  for (let y = -hl * 0.05; y < hl * 0.45; y += Math.max(2.2, length * 0.06)) {
    ctx.fillRect(-beam * 0.26, y, beam * 0.52, 0.7);
  }
}

function paintTug(ctx: CanvasRenderingContext2D, length: number, beam: number) {
  const hl = length / 2;
  ctx.fillStyle = "#f4f1ea";
  roundRect(ctx, -beam * 0.28, -hl * 0.05, beam * 0.56, length * 0.34, 1.2);
  ctx.fill();
  ctx.fillStyle = "#1b1b1b";
  const n = Math.max(3, Math.round(length / 6));
  for (let i = 0; i < n; i++) {
    const y = -hl * 0.7 + (i * length * 0.75) / n;
    ctx.beginPath();
    ctx.arc(-beam * 0.46, y, Math.max(0.6, beam * 0.06), 0, Math.PI * 2);
    ctx.arc(beam * 0.46, y, Math.max(0.6, beam * 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintPilot(ctx: CanvasRenderingContext2D, length: number, beam: number) {
  const hl = length / 2;
  ctx.fillStyle = "#f7f4ee";
  roundRect(ctx, -beam * 0.28, -hl * 0.05, beam * 0.56, length * 0.42, 1);
  ctx.fill();
  ctx.fillStyle = "#e07a2f";
  ctx.fillRect(-beam * 0.46, hl * 0.15, beam * 0.92, Math.max(0.8, length * 0.035));
}

function paintHouse(ctx: CanvasRenderingContext2D, length: number, beam: number, fill: string) {
  const hl = length / 2;
  const houseL = Math.min(32, Math.max(10, length * 0.12));
  const houseW = beam * (length > 100 ? 0.42 : 0.55);
  const stern = hl - Math.max(2, length * 0.025);
  const bow = stern - houseL;
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(-houseW / 2 + 1.2, bow + 1.4, houseW, houseL);
  ctx.fillStyle = fill;
  ctx.fillRect(-houseW / 2, bow, houseW, houseL);
  ctx.fillStyle = "#2b3440";
  const windows = Math.max(2, Math.round(houseL / 4));
  for (let i = 0; i < windows; i++) {
    const y = bow + 1.5 + (i * (houseL - 3)) / windows;
    ctx.fillRect(-houseW * 0.38, y, houseW * 0.76, 0.7);
  }
  ctx.fillStyle = "#d7d2c8";
  ctx.beginPath();
  ctx.arc(0, bow + houseL * 0.35, Math.max(1.2, beam * 0.035), 0, Math.PI * 2);
  ctx.fill();
}

function drawWake(ctx: CanvasRenderingContext2D, ship: Sprite, night: number) {
  if (ship.sog < 0.7 || ship.lengthPx < 4) return;
  const stern = Math.max(6, ship.lengthPx / 2);
  const beam = Math.max(3, ship.beamPx);
  const len = Math.min(80, 12 + ship.sog * 4.5);
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  ctx.globalAlpha = ship.opacity * (night > 0.5 ? 0.45 : 0.62);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(-beam * 0.28, stern * 0.82);
  ctx.quadraticCurveTo(-beam * 0.85, stern + len * 0.45, -beam * 1.15, stern + len);
  ctx.moveTo(beam * 0.28, stern * 0.82);
  ctx.quadraticCurveTo(beam * 0.85, stern + len * 0.45, beam * 1.15, stern + len);
  ctx.stroke();
  ctx.restore();
}

function paintNavLights(ctx: CanvasRenderingContext2D, ship: Sprite, night: number, now: number) {
  if (night < 0.12) return;
  const hl = Math.max(8, ship.lengthPx) / 2;
  const hw = Math.max(4, ship.beamPx) / 2;
  const pulse = 0.72 + 0.28 * Math.sin(now / 380 + ship.mmsi);
  const radius = Math.max(2.4, Math.min(7, ship.lengthPx * 0.045));
  const alpha = night * pulse * ship.opacity;
  const lights = [
    { x: -hw * 0.92, y: -hl * 0.58, color: `rgba(255,36,28,${0.95 * alpha})` },
    { x: hw * 0.92, y: -hl * 0.58, color: `rgba(42,255,96,${0.9 * alpha})` },
    { x: 0, y: -hl * 0.12, color: `rgba(255,255,255,${alpha})` },
    { x: 0, y: hl * 0.9, color: `rgba(255,255,255,${alpha})` },
  ];
  if ((ship.lengthM ?? 0) >= 50) {
    lights.push({ x: 0, y: hl * 0.18, color: `rgba(255,255,255,${0.9 * alpha})` });
  }
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  for (const light of lights) lamp(ctx, light.x, light.y, radius, light.color);
  ctx.restore();
}

function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawShadow(ctx: CanvasRenderingContext2D, length: number, beam: number, bow: number, ship: Sprite) {
  const alt = ship.sunAlt;
  ctx.save();
  if (alt > 2) {
    const stretch = Math.min(1.8, Math.cos((alt * Math.PI) / 180) / Math.max(0.2, Math.sin((alt * Math.PI) / 180)));
    const dist = beam * 0.55 * stretch;
    ctx.translate(-ship.sunX * dist, -ship.sunY * dist);
    traceHull(ctx, length, beam, bow);
    ctx.fillStyle = `rgba(0,0,0,${0.22 + Math.min(0.16, (50 - alt) / 200)})`;
    ctx.fill();
  } else {
    ctx.translate(0, beam * 0.05);
    ctx.scale(1.02, 0.94);
    traceHull(ctx, length, beam, bow);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fill();
  }
  ctx.restore();
}

function traceHull(ctx: CanvasRenderingContext2D, length: number, beam: number, bow: number) {
  const hl = length / 2;
  const hw = beam / 2;
  const bowY = -hl;
  const sternY = hl;
  ctx.beginPath();
  ctx.moveTo(0, bowY);
  ctx.bezierCurveTo(hw * 0.2, bowY + length * 0.02, hw * 0.96, bowY + length * bow, hw * 0.99, bowY + length * (bow + 0.1));
  ctx.lineTo(hw * 0.99, sternY - length * 0.07);
  ctx.quadraticCurveTo(hw * 0.62, sternY + length * 0.012, 0, sternY);
  ctx.quadraticCurveTo(-hw * 0.62, sternY + length * 0.012, -hw * 0.99, sternY - length * 0.07);
  ctx.lineTo(-hw * 0.99, bowY + length * (bow + 0.1));
  ctx.bezierCurveTo(-hw * 0.96, bowY + length * bow, -hw * 0.2, bowY + length * 0.02, 0, bowY);
  ctx.closePath();
}

function bowFactor(model: ShipModel): number {
  if (model === "roro") return 0.08;
  if (model === "tanker" || model === "bulk") return 0.14;
  if (model === "tug" || model === "pilot") return 0.22;
  if (model === "cruise") return 0.2;
  return 0.16;
}

function hullColor(model: ShipModel, mmsi: number): string {
  if (model === "container") return hash(mmsi) > 0.5 ? "#6e1f24" : "#1c3d34";
  if (model === "tanker") return "#6a6258";
  if (model === "bulk" || model === "cargo") return "#6d675c";
  if (model === "roro" || model === "cruise" || model === "passenger") return "#f4f6f5";
  if (model === "tug") return "#7c1f1c";
  if (model === "pilot") return "#163044";
  return "#6d675c";
}

function drawLabel(ctx: CanvasRenderingContext2D, label: ScreenLabel, night: number) {
  ctx.save();
  const size = label.kind === "channel" ? 15 : 14;
  ctx.font = `600 ${size}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (label.kind === "channel") ctx.letterSpacing = "0.16em";
  ctx.lineWidth = 4;
  ctx.strokeStyle = night > 0.5 ? "rgba(6,10,16,0.82)" : "rgba(16,22,28,0.7)";
  ctx.fillStyle = label.kind === "channel" ? (night > 0.5 ? "#d5eef3" : "#f7fbff") : night > 0.5 ? "#f6edd8" : "#ffffff";
  ctx.strokeText(label.text, label.x, label.y);
  ctx.fillText(label.text, label.x, label.y);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function hash(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x >>> 0) / 4294967296;
}

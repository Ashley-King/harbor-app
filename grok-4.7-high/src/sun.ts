import SunCalc from "suncalc";

const LAT = 32.78;
const LON = -79.93;

export type LookMode = "auto" | "day" | "night";

export type SunState = {
  altitude: number;
  azimuth: number;
  night: number;
};

export function sunState(date = new Date()): SunState {
  const position = SunCalc.getPosition(date, LAT, LON);
  const altitude = (position.altitude * 180) / Math.PI;
  const azimuth = (((position.azimuth * 180) / Math.PI + 180) % 360 + 360) % 360;
  const night = clamp((1.5 - altitude) / 3, 0, 1);
  return { altitude, azimuth, night };
}

export function lookIsNight(mode: LookMode, night: number): boolean {
  if (mode === "night") return true;
  if (mode === "day") return false;
  return night >= 0.5;
}

export function lookAmount(mode: LookMode, night: number): number {
  if (mode === "night") return 1;
  if (mode === "day") return 0;
  return night;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

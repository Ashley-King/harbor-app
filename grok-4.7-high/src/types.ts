export type ShipModel =
  | "container"
  | "tanker"
  | "bulk"
  | "roro"
  | "cruise"
  | "passenger"
  | "cargo"
  | "tug"
  | "pilot";

export type Ship = {
  mmsi: number;
  name: string | null;
  flag: string | null;
  imo: string | null;
  typeCode: number | null;
  typeLabel: string | null;
  model: ShipModel;
  lengthM: number | null;
  beamM: number | null;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
  destination: string | null;
  eta: string | null;
  draughtM: number | null;
  seen: string | null;
  lat: number;
  lon: number;
  toBow: number | null;
  toStern: number | null;
  toPort: number | null;
  toStarboard: number | null;
};

export type ShipsFeed =
  | { ok: true; asOf: string; vessels: Ship[] }
  | { ok: false; error: string };

export type LevelFeed =
  | { ok: true; asOf: string; feet: number; station: string; name: string }
  | { ok: false; error: string };

export type HarborResponse = {
  ships: ShipsFeed;
  tide: LevelFeed;
  clearance: LevelFeed;
};

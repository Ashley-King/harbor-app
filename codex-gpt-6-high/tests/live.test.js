import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAIS,
  normalizeNOAA,
  normalizeVessel,
} from "../server/normalize.js";
import { loadHarbor, AIS_URL } from "../server/live.js";
import { mergeSnapshot, terminalFor, isAged } from "../src/data.js";
const now = Date.parse("2026-11-22T16:00:00Z");
// Synthetic payloads are confined to unit tests and never imported by the application.
const vessel = (properties = {}) => ({
  type: "Feature",
  id: 123456789,
  geometry: { type: "Point", coordinates: [-79.9, 32.83] },
  properties: {
    mmsi: 123456789,
    type: 70,
    seen: "2026-11-22T15:59:00Z",
    ...properties,
  },
});
const collection = (features) => ({ type: "FeatureCollection", features });
const noaa = {
  metadata: { id: "8665530" },
  data: [{ t: "2026-11-22 15:54", v: "1.5", f: "0,0,0,0" }],
};
test("missing particulars and AIS sentinels become unknown rather than invented", () => {
  const v = normalizeVessel(
    vessel({ heading: 511, sog: 102.3, imo: 64, draught: 25.6 }),
  );
  assert.equal(v.heading, null);
  assert.equal(v.speed, null);
  assert.equal(v.imo, null);
  assert.equal(v.draught, null);
  assert.equal(v.name, null);
  assert.equal(v.model, "cargo");
  assert.equal(v.modelInferred, true);
  assert.equal(v.length, null);
});
test("only qualifying vessels and current, valid reports enter the app", () => {
  const data = normalizeAIS(
    collection([
      vessel(),
      vessel({ type: 37, length: 20 }),
      vessel({ seen: "2026-11-20T12:00:00Z" }),
      vessel({ kind: "aton" }),
      { ...vessel(), geometry: { type: "Point", coordinates: [0, 0] } },
    ]),
    now,
  );
  assert.equal(data.vessels.length, 1);
});
test("tugs and pilots qualify, including a zero speed and true heading", () => {
  const v = normalizeVessel(vessel({ type: 52, sog: 0, heading: 0 }));
  assert.equal(v.model, "tug");
  assert.equal(v.large, false);
  assert.equal(v.speed, 0);
  assert.equal(v.heading, 0);
});
test("reported particulars select five specific 3D vessel variants", () => {
  for (const [ship_type, model] of [
    ["Container Ship", "container"],
    ["Oil Tanker", "tanker"],
    ["Vehicle Carrier", "roro"],
    ["roll-on/roll-off ship", "roro"],
    ["Bulk Carrier", "bulk"],
    ["Cruise Ship", "cruise"],
  ])
    assert.equal(
      normalizeVessel(vessel({ particulars: { ship_type } })).model,
      model,
    );
});
test("NOAA readings preserve UTC, zero, flags and fail on no data", () => {
  assert.equal(normalizeNOAA(noaa).latest.time, "2026-11-22T15:54Z");
  assert.equal(
    normalizeNOAA({
      ...noaa,
      data: [{ t: "2026-11-22 15:54", v: "0", f: "1,0,0,0" }],
    }).latest.value,
    0,
  );
  assert.throws(() => normalizeNOAA({ error: { message: "No data" } }));
  assert.throws(() => normalizeNOAA({ data: [{ t: "x", v: "" }] }));
});
test("a failing feed retains its last good data and original timestamp, independently", async () => {
  const store = new Map();
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () =>
        url.startsWith("https://ais.") ? collection([vessel()]) : noaa,
    };
  };
  const first = await loadHarbor({ fetcher, now, store, details: false });
  assert.equal(first.ais.status, "live");
  assert.equal(first.ais.data.vessels.length, 1);
  assert.equal(requests[0].url, AIS_URL);
  assert.equal(requests[0].options.headers["User-Agent"], "harbor-bench/1.0");
  const second = await loadHarbor({
    fetcher: async (url) => {
      if (url.startsWith("https://ais.")) throw new Error("Offline");
      return { ok: true, json: async () => noaa };
    },
    now: now + 600000,
    store,
    details: false,
  });
  assert.equal(second.ais.status, "stale");
  assert.equal(second.ais.fetchedAt, first.ais.fetchedAt);
  assert.deepEqual(second.ais.data, first.ais.data);
  assert.equal(second.tide.status, "live");
});
test("cold-start failures never create ships; a successful empty snapshot clears ships", async () => {
  const fail = await loadHarbor({
    fetcher: async () => {
      throw new Error("Offline");
    },
    now,
    store: new Map(),
    details: false,
  });
  assert.equal(fail.ais.status, "unavailable");
  assert.equal(fail.ais.data, null);
  const prev = {
    ais: {
      status: "live",
      fetchedAt: new Date(now).toISOString(),
      data: { vessels: [{ id: "x" }] },
    },
  };
  assert.equal(mergeSnapshot(prev, fail).ais.status, "stale");
  assert.equal(mergeSnapshot(prev, fail).ais.fetchedAt, prev.ais.fetchedAt);
  const empty = { ...fail, ais: { status: "live", data: { vessels: [] } } };
  assert.deepEqual(mergeSnapshot(prev, empty).ais.data.vessels, []);
});
test("terminal proximity excludes moving ships and unrelated distant vessels", () => {
  assert.equal(
    terminalFor({ speed: 0, coordinates: [-79.8916, 32.8338] }),
    "wando",
  );
  assert.equal(
    terminalFor({ speed: 5, coordinates: [-79.8916, 32.8338] }),
    null,
  );
  assert.equal(terminalFor({ speed: 0, coordinates: [-79.85, 32.74] }), null);
  assert.equal(
    terminalFor({ speed: null, coordinates: [-79.8916, 32.8338] }),
    null,
  );
});
test("an old successful response becomes stale even without a request failure", () => {
  assert.equal(
    isAged(
      { status: "live", fetchedAt: new Date(now).toISOString() },
      now + 12 * 60000,
    ),
    true,
  );
});

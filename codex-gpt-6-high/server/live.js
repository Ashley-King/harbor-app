import { normalizeAIS, normalizeNOAA } from "./normalize.js";
export const AIS_URL =
  "https://ais.openwaters.io/v1/vessels?bbox=32.70,-80.05,32.95,-79.75&max_age=30m";
const lastGood = new Map();
const detailCache = new Map();
async function getJSON(url, fetcher, timeout = 16000) {
  const response = await fetcher(url, {
    headers: { "User-Agent": "harbor-bench/1.0", Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json();
}
function noaaURL(product, station, now) {
  const params = new URLSearchParams({
    product,
    station,
    application: "harbor-bench",
    time_zone: "gmt",
    units: "english",
    format: "json",
  });
  if (product === "water_level") {
    params.set("datum", "MLLW");
    params.set(
      "begin_date",
      new Date(now - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 16)
        .replace(/-/g, "")
        .replace("T", " "),
    );
    params.set("range", "24");
  } else params.set("date", "latest");
  return "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?" + params;
}
// Details refine the displayed type only. Snapshot position and timestamps always win.
async function enrich(data, fetcher, now) {
  const candidates = data.features
    .filter((f) => {
      const p = f.properties ?? {};
      return p.length > 150 || (p.type >= 60 && p.type <= 89);
    })
    .slice(0, 24);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < candidates.length) {
        const f = candidates[cursor++];
        const id = f.properties?.mmsi ?? f.id;
        let item = detailCache.get(id);
        if (
          !item ||
          now - item.time > (item.particulars ? 60 * 60 * 1000 : 5 * 60 * 1000)
        ) {
          try {
            const detail = await getJSON(
              "https://ais.openwaters.io/v1/vessels/" + id,
              fetcher,
              1800,
            );
            item = {
              time: now,
              particulars: detail.properties?.particulars ?? null,
            };
            detailCache.set(id, item);
          } catch {
            continue;
          }
        }
        if (item?.particulars)
          f.properties = { ...f.properties, particulars: item.particulars };
      }
    }),
  );
  return data;
}
export async function loadHarbor({
  fetcher = fetch,
  now = Date.now(),
  store = lastGood,
  details = true,
} = {}) {
  async function source(key, url, normalize) {
    try {
      let json = await getJSON(url, fetcher);
      if (key === "ais" && details) json = await enrich(json, fetcher, now);
      const data = normalize(json, now);
      const value = {
        status: "live",
        fetchedAt: new Date(now).toISOString(),
        error: null,
        data,
      };
      if (key !== "ais" && now - Date.parse(data.latest.time) > 20 * 60 * 1000)
        value.status = "stale";
      store.set(key, value);
      return value;
    } catch (error) {
      const old = store.get(key);
      return old
        ? { ...old, status: "stale", error: error.message }
        : {
            status: "unavailable",
            fetchedAt: null,
            error: error.message,
            data: null,
          };
    }
  }
  const [ais, tide, clearance] = await Promise.all([
    source("ais", AIS_URL, normalizeAIS),
    source("tide", noaaURL("water_level", "8665530", now), normalizeNOAA),
    source("clearance", noaaURL("air_gap", "8665353", now), normalizeNOAA),
  ]);
  return {
    requestedAt: new Date(now).toISOString(),
    refreshSeconds: 600,
    ais,
    tide,
    clearance,
  };
}

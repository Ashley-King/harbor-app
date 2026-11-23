// The harbor log: which large ships came and went, kept as one small JSON record.
// `updateLog` is a pure function. The Cloudflare Worker runs it every ten minutes
// with the live ship list and stores the result in Workers KV (worker/index.js).
//
// The record:
//   since    when the log began
//   present  ships in the harbor now, by MMSI, each with the time it arrived
//            (null for a ship that was already here when the log began)
//   days     one entry per Charleston calendar day, newest last, seven kept:
//            arrivals, departures, the biggest ship seen and how many ships were seen

const KEEP_DAYS = 7;
const HEARD_MINUTES = 30;      // a ship counts as here while it was heard this recently
const GONE_MINUTES = 60;       // and as departed after this long without a report
const MAX_EVENTS = 40;         // per day, per list

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

const brief = (v) => ({ mmsi: v.mmsi, name: v.name || null, flag: v.flag || null, type: v.type || null, length: v.length || null });

/** The next log, from the previous one (or null) and the vessels in the harbor now. */
export function updateLog(prev, vessels, now = Date.now()) {
  const started = !prev || !prev.present;
  const log = started ? { v: 1, since: new Date(now).toISOString(), present: {}, days: {} } : { ...prev, present: { ...prev.present }, days: { ...prev.days } };
  const today = dayKey.format(now);
  const day = { arrivals: [], departures: [], biggest: null, ships: [], ...log.days[today] };
  const at = new Date(now).toISOString();

  for (const v of vessels) {
    if (v.group !== 'ship' || !v.seen || now - Date.parse(v.seen) > HEARD_MINUTES * 60000) continue;
    const key = String(v.mmsi);
    const here = log.present[key];
    if (here) {
      log.present[key] = { ...here, ...brief(v), last: at };
    } else {
      log.present[key] = { ...brief(v), since: started ? null : at, last: at };
      if (!started && day.arrivals.length < MAX_EVENTS) day.arrivals = [...day.arrivals, { ...brief(v), t: at }];
    }
    if (!day.ships.includes(v.mmsi)) day.ships = [...day.ships, v.mmsi];
    if (v.length && (!day.biggest || v.length > day.biggest.length)) day.biggest = brief(v);
  }

  for (const [key, s] of Object.entries(log.present)) {
    if (now - Date.parse(s.last) <= GONE_MINUTES * 60000) continue;
    delete log.present[key];
    const stayHours = s.since ? Math.round((Date.parse(s.last) - Date.parse(s.since)) / 360000) / 10 : null;
    if (day.departures.length < MAX_EVENTS) day.departures = [...day.departures, { mmsi: s.mmsi, name: s.name, flag: s.flag, type: s.type, length: s.length, t: s.last, stayHours }];
  }

  log.days[today] = day;
  for (const key of Object.keys(log.days).sort().slice(0, -KEEP_DAYS)) delete log.days[key];
  log.updatedAt = at;
  return log;
}

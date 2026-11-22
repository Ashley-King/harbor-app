export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const D2R = Math.PI / 180;

/** Shortest signed difference between two compass angles in degrees. */
export const angleDiff = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;
export const lerpAngle = (a, b, t) => (a + angleDiff(a, b) * t + 360) % 360;

/** Small deterministic generator, so a ship looks the same on every screen. */
export function rng(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- formatting
// All clock times are shown in Charleston local time.

const TZ = 'America/New_York';
const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fmtTimeSec = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const fmtDayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtZone = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' });

export const clock = (ms) => fmtTime.format(ms);
export const clockSec = (ms) => fmtTimeSec.format(ms);
export const dayLabel = (ms) => fmtDay.format(ms);
export const zoneName = (ms = Date.now()) => fmtZone.formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value || 'ET';

/** "2:14 PM", with the day added when it is not today. */
export function clockSmart(ms, now = Date.now()) {
  return fmtDayKey.format(ms) === fmtDayKey.format(now) ? clock(ms) : `${dayLabel(ms)}, ${clock(ms)}`;
}

export function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 50) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

/** ISO country code to a name, or null when the code is not a country. */
export function countryName(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return null;
  try {
    const n = regionNames?.of(code);
    return n && n !== code ? n : null;
  } catch {
    return null;
  }
}

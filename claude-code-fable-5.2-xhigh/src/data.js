// Live data: calls to this app's own serverless functions every 10 minutes.
// One answer carries several feeds (ships, tide and bridge clearance in the main
// one), and each feed keeps its own state. When
// a feed fails, the last good data stays on screen, marked stale with the time it
// was fetched, and the next scheduled refresh tries again.

export const REFRESH_MS = 10 * 60 * 1000;
const MAIN_FEEDS = ['ais', 'tide', 'airGap'];

export class Feed {
  constructor(url = '/api/harbor', feeds = MAIN_FEEDS) {
    this.url = url;
    this.feeds = feeds;
    this.state = Object.fromEntries(feeds.map((f) => [f, { data: null, at: null, stale: false, error: null }]));
    this.lastAttempt = null;
    this.nextAt = Date.now();
    this.loading = false;
    this.listeners = [];
    this._timer = null;
  }

  onUpdate(fn) {
    this.listeners.push(fn);
  }

  start() {
    this.refresh();
    // Background tabs have their timers slowed down, so catch up when the tab returns.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() >= this.nextAt) this.refresh();
    });
    window.addEventListener('online', () => {
      if (this.feeds.some((f) => this.state[f].stale)) this.refresh();
    });
  }

  async refresh() {
    if (this.loading) return;
    this.loading = true;
    clearTimeout(this._timer);
    const started = Date.now();
    this.lastAttempt = started;
    this.nextAt = started + REFRESH_MS;
    this._emit();
    let body = null;
    let failure = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(this.url, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`the data service answered ${res.status}`);
      body = await res.json();
    } catch (err) {
      failure = err && err.name === 'AbortError' ? 'the data service did not answer in time' : String(err && err.message ? err.message : err);
    }
    for (const f of this.feeds) {
      const st = this.state[f];
      const block = body && body[f];
      if (block && block.ok) {
        st.data = block;
        st.at = Date.parse(block.fetchedAt) || started;
        st.stale = false;
        st.error = null;
      } else {
        st.stale = true;
        st.error = block && block.error ? block.error : failure || 'no data';
        // A cold start during an outage: the function may still hold an older good answer.
        if (!st.data && block && block.lastGood) {
          st.data = block.lastGood;
          st.at = Date.parse(block.lastGood.fetchedAt) || null;
        }
      }
    }
    this.loading = false;
    this._timer = setTimeout(() => this.refresh(), Math.max(1000, this.nextAt - Date.now()));
    this._emit();
  }

  _emit() {
    for (const fn of this.listeners) fn(this);
  }
}

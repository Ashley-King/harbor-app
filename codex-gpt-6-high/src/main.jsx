import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Anchor,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  Compass,
  Expand,
  Eye,
  Info,
  Layers,
  Maximize2,
  Minus,
  Moon,
  Navigation,
  Plus,
  RefreshCw,
  Search,
  Ship,
  Sun,
  Sunrise,
  Waves,
  X,
} from "lucide-react";
import SunCalc from "suncalc";
import { HarborMap } from "./HarborMap.jsx";
import VesselPreview from "./VesselPreview.jsx";
import {
  TERMINALS,
  REFRESH_MS,
  terminalFor,
  timeLocal,
  reportAge,
  isAged,
  mergeSnapshot,
  flagName,
  flagEmoji,
} from "./data.js";
import "./style.css";
const STORAGE = "charleston-observatory-last-good-v1",
  THEME = "charleston-observatory-light-v1";
function safeRead(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function solarTimes(now) {
  return SunCalc.getTimes(new Date(now), 32.8, -79.92);
}
function nextSolarEvent(now) {
  const today = solarTimes(now),
    tomorrow = solarTimes(now + 86400000);
  return [today.sunrise, today.sunset, tomorrow.sunrise, tomorrow.sunset]
    .map(Number)
    .filter((t) => t > now)
    .sort((a, b) => a - b)[0];
}
function currentSolarNight(now) {
  const { sunrise, sunset } = solarTimes(now);
  return now < +sunrise || now >= +sunset;
}
function typeLabel(v) {
  if (v.typeDescription) return v.typeDescription;
  return (
    {
      container: "Container ship",
      tanker: "Tanker",
      roro: "Ro/Ro carrier",
      bulk: "Bulk carrier",
      cruise: "Cruise ship",
      passenger: "Passenger vessel",
      cargo: "Cargo · subtype unknown",
      tug: "Tug / towing vessel",
      pilot: "Pilot boat",
      unknown: "unknown",
    }[v.model] ?? "unknown"
  );
}
function NumberValue({ value, unit }) {
  return (
    <>
      {value == null ? "unknown" : value.toFixed(1)}
      {value != null && <small>{unit}</small>}
    </>
  );
}
function Status({ source, now }) {
  const stale = isAged(source, now);
  return (
    <span className={`source-status ${stale ? "stale" : ""}`}>
      <i />
      {!source?.data ? "UNAVAILABLE" : stale ? "STALE" : "LIVE"}
    </span>
  );
}
function Sparkline({ readings }) {
  if (!readings?.length) return <div className="sparkline-empty" />;
  const values = readings.map((r) => r.value),
    min = Math.min(...values) - 0.3,
    max = Math.max(...values) + 0.3;
  const path = values
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${(i / (values.length - 1 || 1)) * 310},${48 - ((v - min) / (max - min)) * 40}`,
    )
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox="0 0 310 60"
      preserveAspectRatio="none"
      aria-label="Observed water level during the last 24 hours"
    >
      <defs>
        <linearGradient id="tide-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity=".25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L310,60 L0,60 Z`} fill="url(#tide-fill)" />
      <path
        d={path}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx="310"
        cy={48 - ((values.at(-1) - min) / (max - min)) * 40}
        r="3"
        fill="var(--accent)"
      />
    </svg>
  );
}
function VesselRow({ v, onSelect, now }) {
  return (
    <button className="vessel-row" onClick={() => onSelect(v)}>
      <span className={`vessel-icon ${v.model}`}>
        <Ship size={18} />
      </span>
      <span className="vessel-row-main">
        <b>{v.name ?? "unknown"}</b>
        <small>
          {typeLabel(v)} <span>·</span>{" "}
          {v.length == null ? "unknown length" : v.length + " m"}
        </small>
      </span>
      <span className="vessel-row-end">
        {v.speed == null ? "—" : v.speed.toFixed(1)}
        <small>kn</small>
      </span>
      <span
        className={`report-dot ${now - Date.parse(v.seen) > 15 * 60000 ? "old" : ""}`}
        title={`Reported ${reportAge(v.seen, now)}`}
      />
    </button>
  );
}
function VesselCard({ v, night, now, onClose, onFocus, active }) {
  return (
    <div className="vessel-detail">
      <button className="back-button" onClick={onClose}>
        <ChevronLeft size={15} /> HARBOR TRAFFIC
      </button>
      <div className="detail-heading">
        <span className="eyebrow">VESSEL PARTICULARS</span>
        <span
          className={`source-status ${!active || now - Date.parse(v.seen) > 15 * 60000 ? "stale" : ""}`}
        >
          <i />
          {active ? "AIS REPORT" : "LAST KNOWN"}
        </span>
      </div>
      <h2>{v.name ?? "unknown"}</h2>
      <p className="detail-subtitle">
        {flagEmoji(v.flag)} {flagName(v.flag)} <span> / </span> {typeLabel(v)}
      </p>
      <VesselPreview vessel={v} night={night} />
      <button className="focus-button" onClick={() => onFocus(v)}>
        <Navigation size={15} /> Locate vessel <ArrowUpRight size={15} />
      </button>
      <div className="vessel-metrics">
        <div>
          <small>SPEED OVER GROUND</small>
          <strong>
            <NumberValue value={v.speed} unit="kn" />
          </strong>
        </div>
        <div>
          <small>TRUE HEADING</small>
          <strong>{v.heading == null ? "unknown" : v.heading + "°"}</strong>
        </div>
      </div>
      <dl className="particulars">
        <div>
          <dt>IMO</dt>
          <dd>{v.imo ?? "unknown"}</dd>
        </div>
        <div>
          <dt>MMSI</dt>
          <dd>{v.mmsi}</dd>
        </div>
        <div>
          <dt>AIS type</dt>
          <dd>{v.type ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Length × beam</dt>
          <dd>
            {v.length ?? "unknown"} × {v.beam ?? "unknown"} m
          </dd>
        </div>
        <div>
          <dt>Draught</dt>
          <dd>{v.draught == null ? "unknown" : v.draught + " m"}</dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd>{v.destination ?? "unknown"}</dd>
        </div>
        <div>
          <dt>
            ETA <small>(AIS, UTC)</small>
          </dt>
          <dd>{v.eta ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Last report</dt>
          <dd>
            {timeLocal(v.seen)} ET · {reportAge(v.seen, now)}
          </dd>
        </div>
      </dl>
      {!active && (
        <p className="field-note warning-text">
          This vessel is no longer in the current response. The card retains its
          last report.
        </p>
      )}
      {v.modelInferred && (
        <p className="field-note">
          AIS does not confirm the exact subtype. The model shows a generic{" "}
          {v.model === "cargo"
            ? "cargo vessel"
            : v.model === "passenger"
              ? "passenger vessel"
              : "hull"}
          .
        </p>
      )}
      {(v.heading == null || !v.length || !v.beam || v.dimensionsSuspect) && (
        <p className="field-note warning-text">
          {v.heading == null
            ? "True heading unknown; course is used for orientation when available. "
            : ""}
          {!v.length || !v.beam
            ? "Unknown dimensions; no scaled 3D hull is drawn. "
            : ""}
          {v.dimensionsSuspect
            ? "AIS dimensions may be saturated or incorrect; values are shown as reported, and the scaled hull is hidden."
            : ""}
        </p>
      )}
    </div>
  );
}
function App() {
  const [snapshot, setSnapshot] = useState(() => {
    const saved = safeRead(STORAGE);
    if (!saved || saved.version !== 1) return null;
    return {
      ...saved.snapshot,
      ais: saved.snapshot.ais
        ? { ...saved.snapshot.ais, status: "stale" }
        : null,
      tide: saved.snapshot.tide
        ? { ...saved.snapshot.tide, status: "stale" }
        : null,
      clearance: saved.snapshot.clearance
        ? { ...saved.snapshot.clearance, status: "stale" }
        : null,
    };
  });
  const [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now()),
    [lastAttempt, setLastAttempt] = useState(null),
    [networkError, setNetworkError] = useState(false),
    [selected, setSelected] = useState(null),
    [tab, setTab] = useState("traffic"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("large"),
    [layersOpen, setLayersOpen] = useState(false),
    [infoOpen, setInfoOpen] = useState(false),
    [panelOpen, setPanelOpen] = useState(false),
    [showLabels, setShowLabels] = useState(true),
    [showChannel, setShowChannel] = useState(true),
    [showSupport, setShowSupport] = useState(true),
    [theme, setTheme] = useState(
      () =>
        safeRead(THEME) ?? { mode: "night", until: nextSolarEvent(Date.now()) },
    );
  const map = useRef(null),
    inflight = useRef(false),
    abort = useRef(null);
  const night =
    theme.mode === "auto" ? currentSolarNight(now) : theme.mode === "night";
  useEffect(() => {
    document.documentElement.dataset.theme = night ? "night" : "day";
  }, [night]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (theme.mode !== "auto" && theme.until && now >= theme.until)
      setTheme({ mode: "auto" });
  }, [now, theme]);
  useEffect(() => {
    try {
      localStorage.setItem(THEME, JSON.stringify(theme));
    } catch {}
  }, [theme]);
  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setLastAttempt(Date.now());
    abort.current = new AbortController();
    const timeout = setTimeout(() => abort.current?.abort(), 55000);
    try {
      const response = await fetch("/api/harbor", {
        cache: "no-store",
        signal: abort.current.signal,
      });
      if (!response.ok) throw new Error();
      const json = await response.json();
      if (!json.ais || !json.tide || !json.clearance) throw new Error();
      setSnapshot((previous) => {
        const merged = mergeSnapshot(previous, json);
        try {
          localStorage.setItem(
            STORAGE,
            JSON.stringify({ version: 1, snapshot: merged }),
          );
        } catch {}
        return merged;
      });
      setNetworkError(false);
    } catch {
      setNetworkError(true);
      setSnapshot((previous) => {
        if (!previous) return null;
        const result = { ...previous };
        for (const k of ["ais", "tide", "clearance"])
          if (result[k]) result[k] = { ...result[k], status: "stale" };
        return result;
      });
    } finally {
      clearTimeout(timeout);
      inflight.current = false;
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
      abort.current?.abort();
    };
  }, [refresh]);
  const vessels = snapshot?.ais?.data?.vessels ?? [],
    large = vessels.filter((v) => v.large),
    underway = large.filter((v) => (v.speed ?? 0) > 0.8),
    selectedCurrent = vessels.find((v) => v.id === selected?.id) ?? selected;
  const filtered = useMemo(
    () =>
      vessels
        .filter(
          (v) =>
            filter === "all" ||
            (filter === "large" && v.large) ||
            (filter === "moving" && (v.speed ?? 0) > 0.8),
        )
        .filter(
          (v) =>
            !search ||
            [v.name, v.mmsi, v.destination].some((x) =>
              x?.toLowerCase().includes(search.toLowerCase()),
            ),
        )
        .sort(
          (a, b) =>
            Number(b.large) - Number(a.large) ||
            (b.dimensionsSuspect ? 0 : (b.length ?? 0)) -
              (a.dimensionsSuspect ? 0 : (a.length ?? 0)),
        ),
    [vessels, filter, search],
  );
  const select = (v) => {
    setSelected(v);
    setPanelOpen(true);
    map.current?.focus(v);
  };
  const setMode = (mode) =>
    setTheme({
      mode,
      until: mode === "auto" ? null : nextSolarEvent(Date.now()),
    });
  const tide = snapshot?.tide?.data,
    clearance = snapshot?.clearance?.data,
    staleAIS = isAged(snapshot?.ais, now),
    nextRefresh = lastAttempt
      ? Math.max(0, Math.ceil((lastAttempt + REFRESH_MS - now) / 1000))
      : 600;
  const solar = solarTimes(now);
  const tideTrend =
    tide?.readings?.length > 1
      ? tide.latest.value - tide.readings.at(-2).value
      : null;
  return (
    <div className="app">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          aria-label="Charleston Harbor Observatory home"
        >
          <span className="brand-mark">
            <Anchor size={23} strokeWidth={1.5} />
          </span>
          <span>
            <b>CHARLESTON</b>
            <small>HARBOR OBSERVATORY</small>
          </span>
        </a>
        <div className="topbar-center">
          <span className="topbar-rule" />
          <span>
            SOUTH CAROLINA <i> / </i> 32.80° N, 79.92° W
          </span>
        </div>
        <div className="topbar-right">
          <div className="local-clock">
            <b>{timeLocal(now, true)}</b>
            <small>CHARLESTON · ET</small>
          </div>
          <button
            className="icon-button info-button"
            onClick={() => setInfoOpen(true)}
            aria-label="About the harbor observatory"
          >
            <Info size={18} />
          </button>
        </div>
      </header>
      <main>
        <section
          className="map-area"
          aria-label="Interactive Charleston Harbor aerial map"
        >
          <HarborMap
            ref={map}
            vessels={vessels}
            night={night}
            selected={selectedCurrent}
            onSelect={select}
            showLabels={showLabels}
            showChannel={showChannel}
            showSupport={showSupport}
          />
          <div className="map-top">
            <div className="overview-title">
              <div className="eyebrow">
                <span className={`live-dot ${staleAIS ? "stale" : ""}`} />
                {!snapshot?.ais?.data
                  ? "CONNECTING TO HARBOR"
                  : staleAIS
                    ? "LAST KNOWN TRAFFIC"
                    : "LIVE HARBOR TRAFFIC"}
              </div>
              <h1>A harbor in motion.</h1>
              <p>From the jetties to the working waterfront.</p>
            </div>
            <div className="map-buttons">
              <button
                className="map-button"
                onClick={() => map.current?.reset()}
                title="Fit the whole harbor"
              >
                <Maximize2 size={16} />
                <span>Harbor view</span>
              </button>
              <button
                className={`map-button ${layersOpen ? "active" : ""}`}
                onClick={() => setLayersOpen(!layersOpen)}
                aria-expanded={layersOpen}
              >
                <Layers size={16} />
                <span>Layers</span>
                <ChevronDown size={12} />
              </button>
            </div>
          </div>
          <div className="view-controls" aria-label="Map controls">
            <button
              onClick={() => map.current?.north()}
              aria-label="Reset north and overhead view"
              className="north-control"
            >
              <Compass size={22} />
              <small>N</small>
            </button>
            <div className="zoom-controls">
              <button onClick={() => map.current?.zoom(1)} aria-label="Zoom in">
                <Plus size={19} />
              </button>
              <button
                onClick={() => map.current?.zoom(-1)}
                aria-label="Zoom out"
              >
                <Minus size={19} />
              </button>
            </div>
            <button
              onClick={() => {
                if (document.fullscreenElement) document.exitFullscreen();
                else document.documentElement.requestFullscreen?.();
              }}
              aria-label="Toggle fullscreen"
            >
              <Expand size={18} />
            </button>
          </div>
          <div className="map-bottom">
            <div className="mode-switch" aria-label="Lighting mode">
              {[
                ["night", Moon, "Night"],
                ["day", Sun, "Day"],
                ["auto", Sunrise, "Auto"],
              ].map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  className={theme.mode === mode ? "active" : ""}
                  onClick={() => setMode(mode)}
                  title={
                    mode === "auto"
                      ? "Follow Charleston sunrise and sunset"
                      : `${label} until the next sunrise or sunset`
                  }
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
            <div className="map-legend">
              <span>
                <i className="legend-vessel" />
                Large vessels
              </span>
              <span>
                <i className="legend-tug" />
                Tugs & pilots
              </span>
              <span className="true-scale">TRUE AIS SCALE</span>
            </div>
          </div>
          {layersOpen && (
            <div className="layers-popover">
              <div className="popover-heading">
                <b>Map layers</b>
                <button
                  className="icon-button"
                  onClick={() => setLayersOpen(false)}
                  aria-label="Close map layers"
                >
                  <X size={15} />
                </button>
              </div>
              {[
                ["Ship names", showLabels, setShowLabels],
                ["Channel guide", showChannel, setShowChannel],
                ["Tugs & pilot boats", showSupport, setShowSupport],
              ].map(([label, checked, set]) => (
                <label key={label}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => set(e.target.checked)}
                  />
                  <span>{label}</span>
                  <span className={`switch ${checked ? "on" : ""}`} />
                </label>
              ))}
              <small>Real aerial imagery · 3D vessel models</small>
            </div>
          )}
          {(networkError ||
            snapshot?.ais?.status === "stale" ||
            snapshot?.ais?.status === "unavailable") && (
            <div className="feed-banner">
              <Info size={15} />
              <span>
                {snapshot?.ais?.data
                  ? "AIS feed unavailable. Retaining last good positions from " +
                    timeLocal(snapshot.ais.fetchedAt) +
                    " ET."
                  : "AIS feed unavailable. No ships have been invented."}{" "}
                Retrying every 10 minutes.
              </span>
            </div>
          )}
          <button
            className="mobile-panel-button"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            <Ship size={17} />
            {panelOpen
              ? "Hide harbor panel"
              : `Harbor panel · ${large.length} vessels`}
          </button>
        </section>
        <aside
          className={`sidebar ${panelOpen ? "mobile-open" : ""}`}
          aria-label="Live harbor information"
        >
          <div className="sidebar-top">
            <div>
              <span className="eyebrow">THE WATERFRONT, RIGHT NOW</span>
              <h2>Harbor watch</h2>
            </div>
            <button
              className="icon-button mobile-close"
              onClick={() => setPanelOpen(false)}
              aria-label="Close harbor panel"
            >
              <X size={20} />
            </button>
            <Status source={snapshot?.ais} now={now} />
          </div>
          <div className="harbor-stats">
            <div>
              <strong>
                {snapshot?.ais?.data
                  ? String(large.length).padStart(2, "0")
                  : "—"}
              </strong>
              <span>large vessels</span>
            </div>
            <div>
              <strong>
                {snapshot?.ais?.data
                  ? String(underway.length).padStart(2, "0")
                  : "—"}
              </strong>
              <span>under way</span>
            </div>
            <div>
              <strong>
                {snapshot?.ais?.data
                  ? String(vessels.filter((v) => !v.large).length).padStart(
                      2,
                      "0",
                    )
                  : "—"}
              </strong>
              <span>tugs & pilots</span>
            </div>
          </div>
          <div className="conditions-strip">
            <div>
              <Waves size={15} />
              <span>
                TIDE{" "}
                <b>
                  {tide?.latest?.value == null
                    ? "unknown"
                    : tide.latest.value.toFixed(1) + " ft"}
                </b>
              </span>
              <i className={isAged(snapshot?.tide, now) ? "stale" : ""} />
            </div>
            <div>
              <span>
                RAVENEL{" "}
                <b>
                  {clearance?.latest?.value == null
                    ? "unknown"
                    : clearance.latest.value.toFixed(1) + " ft"}
                </b>
              </span>
              <i className={isAged(snapshot?.clearance, now) ? "stale" : ""} />
            </div>
          </div>
          <div className="sidebar-scroll">
            {selectedCurrent ? (
              <VesselCard
                v={selectedCurrent}
                night={night}
                now={now}
                onClose={() => setSelected(null)}
                onFocus={(v) => map.current?.focus(v)}
                active={vessels.some((v) => v.id === selectedCurrent.id)}
              />
            ) : (
              <>
                <div
                  className="panel-tabs"
                  role="tablist"
                  aria-label="Vessel lists"
                >
                  <button
                    role="tab"
                    aria-selected={tab === "traffic"}
                    onClick={() => setTab("traffic")}
                  >
                    Vessel traffic <span>{large.length}</span>
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === "terminals"}
                    onClick={() => setTab("terminals")}
                  >
                    At terminals{" "}
                    <span>{large.filter((v) => terminalFor(v)).length}</span>
                  </button>
                </div>
                {tab === "traffic" ? (
                  <>
                    <div className="traffic-tools">
                      <label className="search">
                        <Search size={15} />
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Find a vessel"
                          aria-label="Search vessels"
                        />
                        <kbd>⌕</kbd>
                      </label>
                      <div className="filters">
                        {[
                          ["large", "Large vessels"],
                          ["moving", "Under way"],
                          ["all", "All traffic"],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            className={filter === key ? "active" : ""}
                            onClick={() => setFilter(key)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="vessel-list">
                      {filtered.map((v) => (
                        <VesselRow
                          key={v.id}
                          v={v}
                          onSelect={select}
                          now={now}
                        />
                      ))}
                      {!filtered.length && (
                        <div className="empty-state">
                          <Ship size={27} />
                          <b>
                            {busy && !snapshot
                              ? "Listening to the harbor…"
                              : "No matching vessels reported"}
                          </b>
                          <p>
                            {search
                              ? "Try a name, MMSI or destination."
                              : "Only real AIS reports from the last 30 minutes appear here."}
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="terminal-list">
                    {TERMINALS.map((t) => {
                      const ships = large.filter(
                        (v) => terminalFor(v) === t.id,
                      );
                      return (
                        <section key={t.id}>
                          <div className="terminal-heading">
                            <span className="terminal-monogram">{t.short}</span>
                            <b>{t.name}</b>
                            <span>
                              {ships.length.toString().padStart(2, "0")}
                            </span>
                          </div>
                          {ships.map((v) => (
                            <VesselRow
                              key={v.id}
                              v={v}
                              onSelect={select}
                              now={now}
                            />
                          ))}
                          {!ships.length && (
                            <p className="empty-terminal">
                              No stationary AIS vessels near this berth.
                            </p>
                          )}
                        </section>
                      );
                    })}
                    <p className="field-note">
                      Terminal grouping uses stationary AIS reports within 350 m
                      of the mapped berth. It is an approximate location, not a
                      confirmed berth assignment.
                    </p>
                  </div>
                )}
              </>
            )}
            <section className="conditions">
              <div className="section-heading">
                <span className="eyebrow">ON THE WATER</span>
                <Waves size={17} />
              </div>
              <div className="tide-heading">
                <div>
                  <h3>Charleston tide</h3>
                  <small>Station 8665530 · MLLW</small>
                </div>
                <Status source={snapshot?.tide} now={now} />
              </div>
              <div className="tide-value">
                <strong>
                  <NumberValue value={tide?.latest?.value} unit="ft" />
                </strong>
                <span>
                  {tideTrend == null ? (
                    "unknown trend"
                  ) : tideTrend >= 0 ? (
                    <>
                      <ArrowUpRight size={16} />
                      Rising
                    </>
                  ) : (
                    <>
                      <ArrowDownLeft size={16} />
                      Falling
                    </>
                  )}
                </span>
              </div>
              <Sparkline readings={tide?.readings} />
              <div className="sparkline-caption">
                <span>OBSERVED · LAST 24 HOURS</span>
                <span>{timeLocal(tide?.latest?.time)} ET</span>
              </div>
              <div className="clearance">
                <div className="bridge-symbol">
                  <svg viewBox="0 0 40 30">
                    <path d="M1 24H39M12 25V4M28 25V4M2 22L12 4L20 22L28 4L38 22M7 22L12 12L17 22M23 22L28 12L33 22" />
                  </svg>
                </div>
                <div>
                  <h3>Ravenel clearance</h3>
                  <small>
                    Station 8665353 · {timeLocal(clearance?.latest?.time)} ET
                  </small>
                </div>
                <strong>
                  <NumberValue value={clearance?.latest?.value} unit="ft" />
                </strong>
              </div>
              <div className="clearance-status">
                <Status source={snapshot?.clearance} now={now} />
                <span>
                  Measured air gap
                  {clearance?.latest?.flags?.split(",").some((f) => f === "1")
                    ? " · NOAA flagged"
                    : ""}
                </span>
              </div>
            </section>
            <div className="solar-note">
              <Sunrise size={16} />
              <span>
                Sunrise {timeLocal(solar.sunrise)}
                <i>·</i>Sunset {timeLocal(solar.sunset)} ET
              </span>
            </div>
          </div>
          <footer className="sidebar-footer">
            <div>
              <span className={`live-dot ${staleAIS ? "stale" : ""}`} />
              <span>
                {snapshot?.ais?.fetchedAt
                  ? `Fetched ${timeLocal(snapshot.ais.fetchedAt)} ET`
                  : "Awaiting first AIS response"}
                <small>
                  Refresh in {Math.floor(nextRefresh / 60)}:
                  {String(nextRefresh % 60).padStart(2, "0")}
                </small>
              </span>
            </div>
            <button
              className={`icon-button ${busy ? "refreshing" : ""}`}
              onClick={refresh}
              disabled={busy}
              aria-label="Refresh live harbor data"
            >
              <RefreshCw size={17} />
            </button>
          </footer>
        </aside>
      </main>
      <div className="bottom-bar">
        <span>
          <span className="tiny-cross">+</span> LIVE AIS · NOAA CO-OPS · USGS
          AERIAL IMAGERY
        </span>
        <button onClick={() => setInfoOpen(true)}>
          A living view. An observed harbor. <ArrowUpRight size={12} />
        </button>
        <span className="disclaimer">FOR EXPLORATION · NOT FOR NAVIGATION</span>
      </div>
      {infoOpen && (
        <div className="modal-backdrop" onClick={() => setInfoOpen(false)}>
          <div
            className="about-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setInfoOpen(false)}
              aria-label="Close about"
            >
              <X size={20} />
            </button>
            <Anchor size={28} />
            <span className="eyebrow">CHARLESTON HARBOR OBSERVATORY</span>
            <h2 id="about-title">A window onto the waterfront.</h2>
            <p>
              Current AIS reports become an overhead view of Charleston’s
              working harbor. Each refresh fetches new observations on the
              server. Positions transition smoothly over 20 seconds; ships are
              never projected into unreported future positions.
            </p>
            <p>
              <a
                href="https://openwaters.io/api/ais/"
                target="_blank"
                rel="noreferrer"
              >
                Open Waters AIS
              </a>{" "}
              supplies ship positions, with source credit to{" "}
              <a href="https://www.aishub.net" target="_blank" rel="noreferrer">
                AISHub
              </a>{" "}
              and{" "}
              <a href="https://aisstream.io" target="_blank" rel="noreferrer">
                aisstream.io
              </a>
              .{" "}
              <a
                href="https://api.tidesandcurrents.noaa.gov/api/prod/"
                target="_blank"
                rel="noreferrer"
              >
                NOAA CO-OPS
              </a>{" "}
              supplies measured water level and bridge air gap. Both refresh
              every ten minutes.
            </p>
            <p>
              <a
                href="https://www.usgs.gov/programs/national-geospatial-program/national-map"
                target="_blank"
                rel="noreferrer"
              >
                USGS / USDA NAIP
              </a>{" "}
              provides public aerial photography. Photography is historical:
              photographed boats are not live AIS vessels. Ship models, short
              wakes and night lighting are illustrative. The channel guide and
              terminal proximity groupings are approximate.
            </p>
            <p>
              Red lights mark port, green mark starboard, and white mark the
              masthead and stern. Lighting depicts navigation-light positions,
              not a full signal assessment. Generic cargo models are used when
              the feed cannot confirm subtype. “Unknown” means the source did
              not report a field.
            </p>
            <p>
              Night is the first-visit view. Manual lighting lasts until
              Charleston’s next sunrise or sunset, then follows the sun. Choose
              Auto to follow the sun immediately. An unavailable feed keeps its
              last successful observation and displays its original time as
              stale.
            </p>
            <div className="about-bottom">
              <span>NO KEYS. NO SIMULATED SHIPS.</span>
              <span>Not for navigation</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);

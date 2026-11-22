import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(workerUrl);
import * as THREE from "three";
import { createShip, disposeGroup, setShipNight } from "./models.js";
import {
  HARBOR_BOUNDS,
  TERMINALS,
  BRIDGES,
  CHANNEL,
  WANDO_CHANNEL,
  distanceMeters,
} from "./data.js";
import "maplibre-gl/dist/maplibre-gl.css";
const anchor = maplibregl.MercatorCoordinate.fromLngLat([-79.91, 32.81]);
const unit = anchor.meterInMercatorCoordinateUnits();
const local = (coordinate) => {
  const m = maplibregl.MercatorCoordinate.fromLngLat(coordinate);
  return [(m.x - anchor.x) / unit, (anchor.y - m.y) / unit];
};
const feature = (geometry, properties = {}) => ({
  type: "Feature",
  geometry,
  properties,
});
const collection = (features) => ({ type: "FeatureCollection", features });
function lightingPoints() {
  const points = [];
  const along = (line, count, kind) => {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      points.push(
        feature(
          {
            type: "Point",
            coordinates: [
              line[0][0] + (line[1][0] - line[0][0]) * t,
              line[0][1] + (line[1][1] - line[0][1]) * t,
            ],
          },
          { kind },
        ),
      );
    }
  };
  BRIDGES.forEach((b) => along(b.line, 60, "bridge"));
  TERMINALS.forEach((t) => {
    along(t.berth, 30, "terminal");
    for (let i = 0; i < 5; i++) {
      const p = t.berth[0],
        q = t.berth[1],
        n = i / 4;
      points.push(
        feature(
          {
            type: "Point",
            coordinates: [
              p[0] + (q[0] - p[0]) * n - 0.001,
              p[1] + (q[1] - p[1]) * n,
            ],
          },
          { kind: "crane" },
        ),
      );
    }
  });
  // Shoreline accent lighting is a visual treatment, not a live lighting feed.
  along(
    [
      [-79.9322, 32.7693],
      [-79.9275, 32.7905],
    ],
    28,
    "shore",
  );
  along(
    [
      [-79.9013, 32.7863],
      [-79.8901, 32.7949],
    ],
    15,
    "shore",
  );
  return collection(points);
}
function createLayer() {
  return {
    id: "vessel-models",
    type: "custom",
    renderingMode: "3d",
    ships: new Map(),
    night: true,
    onAdd(map, gl) {
      this.map = map;
      this.scene = new THREE.Scene();
      this.camera = new THREE.Camera();
      this.ambient = new THREE.AmbientLight("#c0d4dd", 1.8);
      this.scene.add(this.ambient);
      this.sun = new THREE.DirectionalLight("#fff2c6", 3);
      this.sun.position.set(-200, 400, 800);
      this.scene.add(this.sun);
      this.scene.add(new THREE.HemisphereLight("#c6e9f1", "#152e33", 1.2));
      this.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      this.renderer.autoClear = false;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      // Detailed architectural accents placed on the photographed bridges and working wharves.
      const infrastructure = new THREE.Group();
      const line3 = (a, b, color) => {
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...a),
          new THREE.Vector3(...b),
        ]);
        infrastructure.add(
          new THREE.Line(
            g,
            new THREE.LineBasicMaterial({
              color,
              transparent: true,
              opacity: 0.7,
            }),
          ),
        );
      };
      for (const bridge of BRIDGES) {
        const [a, b] = bridge.line.map(local);
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        if (bridge.cable) {
          for (const t of [0.4, 0.62]) {
            const p = [a[0] + dx * t, a[1] + dy * t];
            for (const side of [-1, 1]) {
              const o = side * 14;
              line3([p[0] + o, p[1], 52], [p[0], p[1], 172], "#c6d3d0");
              for (let i = -4; i <= 4; i++)
                line3(
                  [p[0], p[1], 172],
                  [p[0] + dx * i * 0.018, p[1] + dy * i * 0.018, 52],
                  "#a8b4ad",
                );
            }
          }
        } else {
          for (let i = 1; i <= 7; i++) {
            const t = i / 8;
            line3(
              [a[0] + dx * t, a[1] + dy * t, 42],
              [a[0] + dx * t, a[1] + dy * t, 80],
              "#aebaae",
            );
          }
        }
      }
      for (const terminal of TERMINALS) {
        if (terminal.id === "columbus") continue;
        const [a, b] = terminal.berth.map(local);
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          len = Math.hypot(dx, dy),
          nx = dy / len,
          ny = -dx / len;
        for (let i = 0; i < 5; i++) {
          const t = (i + 0.5) / 5,
            x = a[0] + dx * t,
            y = a[1] + dy * t;
          line3([x - 7, y - 7, 0], [x - 7, y - 7, 60], "#9aaea8");
          line3([x + 7, y + 7, 0], [x + 7, y + 7, 60], "#9aaea8");
          line3(
            [x - nx * 22, y - ny * 22, 60],
            [x + nx * 64, y + ny * 64, 60],
            "#b8bdae",
          );
          line3([x, y, 85], [x + nx * 64, y + ny * 64, 60], "#adb8ac");
        }
      }
      this.scene.add(infrastructure);
      this.infrastructure = infrastructure;
    },
    update(vessels, night) {
      this.night = night;
      if (!this.scene) {
        this.pending = { vessels, night };
        return;
      }
      const ids = new Set(vessels.map((v) => v.id));
      for (const [id, entry] of this.ships) {
        if (!ids.has(id)) {
          this.scene.remove(entry.group);
          disposeGroup(entry.group);
          this.ships.delete(id);
        }
      }
      for (const v of vessels) {
        let entry = this.ships.get(v.id);
        const signature = [v.model, v.length, v.beam].join(":");
        if (entry && entry.signature !== signature) {
          this.scene.remove(entry.group);
          disposeGroup(entry.group);
          this.ships.delete(v.id);
          entry = null;
        }
        const p = local(v.coordinates),
          heading = v.heading ?? v.course ?? 0;
        if (!entry) {
          const group = createShip(v);
          this.scene.add(group);
          entry = {
            group,
            from: p,
            to: p,
            fromHeading: heading,
            heading,
            started: performance.now(),
            signature,
            duration: 0,
          };
          this.ships.set(v.id, entry);
        } else if (
          distanceMeters(entry.coordinates ?? v.coordinates, v.coordinates) >
          0.1
        ) {
          entry.from = entry.renderedPoint ?? entry.to;
          entry.to = p;
          entry.fromHeading = entry.currentHeading ?? entry.heading;
          entry.heading = heading;
          entry.started = performance.now();
          entry.duration = window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? 0
            : 20000;
        }
        if (
          entry.heading !== heading &&
          distanceMeters(entry.coordinates ?? v.coordinates, v.coordinates) <=
            0.1
        ) {
          entry.from = entry.renderedPoint ?? entry.to;
          entry.to = p;
          entry.fromHeading = entry.currentHeading ?? entry.heading;
          entry.heading = heading;
          entry.started = performance.now();
          entry.duration = 20000;
        }
        entry.vessel = v;
        entry.coordinates = v.coordinates;
        setShipNight(entry.group, night);
      }
      this.ambient.intensity = night ? 1.35 : 2;
      this.sun.intensity = night ? 2 : 3.2;
    },
    render(gl, args) {
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        this.update(p.vessels, p.night);
      }
      const time = performance.now();
      let moving = false;
      for (const e of this.ships.values()) {
        const t = e.duration ? Math.min(1, (time - e.started) / e.duration) : 1;
        const ease = t * t * (3 - 2 * t);
        const x = e.from[0] + (e.to[0] - e.from[0]) * ease,
          y = e.from[1] + (e.to[1] - e.from[1]) * ease;
        const delta = ((e.heading - e.fromHeading + 540) % 360) - 180;
        const heading = e.fromHeading + delta * ease;
        e.currentHeading = heading;
        e.renderedPoint = [x, y];
        e.group.position.set(x, y, 1);
        e.group.rotation.z = (-heading * Math.PI) / 180;
        // AIS coordinates describe the antenna, so offset the model's center when offsets are available.
        const v = e.vessel;
        if (v.length && v.beam && v.toBow != null && v.toPort != null) {
          const ox = v.beam / 2 - v.toPort,
            oy = v.toBow - v.length / 2,
            r = (-heading * Math.PI) / 180;
          e.group.position.x += ox * Math.cos(r) - oy * Math.sin(r);
          e.group.position.y += ox * Math.sin(r) + oy * Math.cos(r);
        }
        moving ||= t < 1;
      }
      const m = new THREE.Matrix4().fromArray(
        args.defaultProjectionData.mainMatrix,
      );
      const transform = new THREE.Matrix4()
        .makeTranslation(anchor.x, anchor.y, anchor.z)
        .scale(new THREE.Vector3(unit, -unit, unit));
      this.camera.projectionMatrix = m.multiply(transform);
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
      if (moving) this.map.triggerRepaint();
    },
    onRemove() {
      for (const entry of this.ships.values()) disposeGroup(entry.group);
      disposeGroup(this.infrastructure);
      this.renderer.dispose();
    },
  };
}
export const HarborMap = forwardRef(function HarborMap(
  { vessels, night, selected, onSelect, showLabels, showChannel, showSupport },
  ref,
) {
  const container = useRef(null),
    mapRef = useRef(null),
    layerRef = useRef(null),
    markers = useRef(new Map()),
    latest = useRef({
      vessels,
      night,
      onSelect,
      showLabels,
      showSupport,
      showChannel,
    });
  latest.current = {
    vessels,
    night,
    onSelect,
    showLabels,
    showSupport,
    showChannel,
  };
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(11);
  const [imageryFailed, setImageryFailed] = useState(false);
  useImperativeHandle(ref, () => ({
    reset() {
      mapRef.current?.fitBounds(HARBOR_BOUNDS, {
        padding:
          window.innerWidth < 700
            ? { top: 100, bottom: 80, left: 35, right: 35 }
            : 90,
        duration: 1400,
      });
    },
    focus(v) {
      mapRef.current?.flyTo({
        center: v.coordinates,
        zoom: 15.5,
        pitch: 30,
        duration: 2000,
      });
    },
    zoom(delta) {
      mapRef.current?.zoomTo(mapRef.current.getZoom() + delta, {
        duration: 500,
      });
    },
    north() {
      mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 800 });
    },
  }));
  function sync() {
    const map = mapRef.current;
    if (!map || !map.getLayer("vessel-models") || !layerRef.current) return;
    const state = latest.current,
      visible = state.vessels.filter((v) => state.showSupport || v.large);
    layerRef.current.update(visible, state.night);
    const ids = new Set(visible.map((v) => v.id));
    for (const [id, entry] of markers.current) {
      if (!ids.has(id)) {
        entry.marker.remove();
        markers.current.delete(id);
      }
    }
    for (const v of visible) {
      let entry = markers.current.get(v.id);
      if (!entry) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "ship-target";
        const ring = document.createElement("span");
        ring.className = "ship-ring";
        const tag = document.createElement("span");
        tag.className = "ship-label";
        const dot = document.createElement("span");
        dot.className = "ship-dot";
        el.append(ring, dot, tag);
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          latest.current.onSelect(markers.current.get(v.id).vessel);
        });
        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat(v.coordinates)
          .addTo(map);
        entry = { marker, el, tag, vessel: v, position: v.coordinates };
        markers.current.set(v.id, entry);
      }
      entry.vessel = v;
      entry.el.setAttribute(
        "aria-label",
        `Inspect ${v.name ?? "unknown ship"}`,
      );
      entry.el.title = `${v.name ?? "unknown"} · ${v.speed == null ? "unknown speed" : v.speed + " kn"}`;
      entry.el.classList.toggle("support", !v.large);
      entry.el.classList.toggle("underway", (v.speed ?? 0) > 0.8);
      entry.tag.textContent = v.name ?? "unknown";
      entry.tag.style.display = state.showLabels && v.large ? "" : "none";
      entry.el.dataset.id = v.id;
      if (distanceMeters(entry.position, v.coordinates) > 0.1) {
        const from = entry.marker.getLngLat().toArray(),
          to = v.coordinates,
          start = performance.now();
        entry.animation && cancelAnimationFrame(entry.animation);
        const animate = () => {
          const t = window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? 1
              : Math.min(1, (performance.now() - start) / 20000),
            e = t * t * (3 - 2 * t);
          entry.marker.setLngLat([
            from[0] + (to[0] - from[0]) * e,
            from[1] + (to[1] - from[1]) * e,
          ]);
          if (t < 1) entry.animation = requestAnimationFrame(animate);
        };
        animate();
        entry.position = v.coordinates;
      }
    }
    const trails = visible
      .filter(
        (v) =>
          (v.speed ?? 0) > 0.8 &&
          Date.now() - Date.parse(v.seen) < 20 * 60 * 1000,
      )
      .flatMap((v) => {
        const h = v.course ?? v.heading;
        if (h == null) return [];
        const r = (h * Math.PI) / 180,
          len = Math.min(220, v.speed * 12);
        const back = [
          v.coordinates[0] -
            (Math.sin(r) * len) /
              (111320 * Math.cos((v.coordinates[1] * Math.PI) / 180)),
          v.coordinates[1] - (Math.cos(r) * len) / 111320,
        ];
        return [
          feature({ type: "LineString", coordinates: [back, v.coordinates] }),
        ];
      });
    map.getSource("wakes")?.setData(collection(trails));
    for (const id of ["channel", "channel-glow"])
      map.setLayoutProperty(
        id,
        "visibility",
        state.showChannel ? "visible" : "none",
      );
    map.setLayoutProperty(
      "shore-lights",
      "visibility",
      state.night ? "visible" : "none",
    );
    map.setLayoutProperty(
      "shore-glow",
      "visibility",
      state.night ? "visible" : "none",
    );
    map.setPaintProperty(
      "aerial",
      "raster-brightness-max",
      state.night ? 0.5 : 1,
    );
    map.setPaintProperty(
      "aerial",
      "raster-saturation",
      state.night ? -0.5 : -0.06,
    );
    map.setPaintProperty(
      "aerial",
      "raster-contrast",
      state.night ? 0.18 : 0.04,
    );
    map.triggerRepaint();
  }
  useEffect(() => {
    let map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: {
          version: 8,
          sources: {
            aerial: {
              type: "raster",
              tiles: [window.location.origin + "/imagery/{z}/{x}/{y}"],
              tileSize: 256,
              minzoom: 8,
              maxzoom: 16,
              attribution:
                '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS · USDA NAIP aerial imagery</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap annotations</a>',
            },
          },
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#0c2732" },
            },
            {
              id: "aerial",
              type: "raster",
              source: "aerial",
              paint: {
                "raster-brightness-max": 0.5,
                "raster-saturation": -0.5,
                "raster-fade-duration": 500,
              },
            },
          ],
        },
        center: [-79.91, 32.815],
        zoom: 11.3,
        minZoom: 9.5,
        maxZoom: 18,
        maxBounds: [
          [-80.16, 32.59],
          [-79.6, 33.06],
        ],
        pitch: 0,
        bearing: 0,
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
        fadeDuration: 300,
      });
    } catch {
      setError(
        "This browser cannot start the 3D harbor map. Enable WebGL or try another browser.",
      );
      setLoading(false);
      return;
    }
    mapRef.current = map;
    map.on("resize", () => {
      if (map.getZoom() < 12.5)
        map.fitBounds(HARBOR_BOUNDS, {
          padding:
            window.innerWidth < 700
              ? { top: 100, bottom: 80, left: 35, right: 35 }
              : 90,
          duration: 0,
        });
    });
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.ScaleControl({ unit: "nautical", maxWidth: 110 }),
      "bottom-left",
    );
    map.on("zoom", () => {
      setZoom(map.getZoom());
      container.current?.classList.toggle("close-map", map.getZoom() > 14.3);
    });
    map.on("error", (event) => {
      if (event.sourceId === "aerial") setImageryFailed(true);
    });
    map.on("load", () => {
      map.fitBounds(HARBOR_BOUNDS, {
        padding:
          window.innerWidth < 700
            ? { top: 100, bottom: 80, left: 35, right: 35 }
            : 90,
        duration: 0,
      });
      map.addSource("channel", {
        type: "geojson",
        data: collection(
          [CHANNEL, WANDO_CHANNEL].map((coordinates) =>
            feature({ type: "LineString", coordinates }),
          ),
        ),
      });
      map.addLayer({
        id: "channel-glow",
        type: "line",
        source: "channel",
        paint: {
          "line-color": "#8ddec6",
          "line-width": 9,
          "line-opacity": 0.055,
          "line-blur": 4,
        },
      });
      map.addLayer({
        id: "channel",
        type: "line",
        source: "channel",
        paint: {
          "line-color": "#9cd3c7",
          "line-width": 1,
          "line-opacity": 0.38,
          "line-dasharray": [4, 6],
        },
      });
      map.addSource("lights", { type: "geojson", data: lightingPoints() });
      map.addLayer({
        id: "shore-glow",
        type: "circle",
        source: "lights",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 16, 15],
          "circle-color": "#e9d59b",
          "circle-opacity": 0.26,
          "circle-blur": 1,
        },
      });
      map.addLayer({
        id: "shore-lights",
        type: "circle",
        source: "lights",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            0.55,
            16,
            2.2,
          ],
          "circle-color": "#fff2c4",
          "circle-opacity": 0.95,
        },
      });
      map.addSource("wakes", {
        type: "geojson",
        lineMetrics: true,
        data: collection([]),
      });
      map.addLayer({
        id: "wakes",
        type: "line",
        source: "wakes",
        paint: {
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 16, 7],
          "line-gradient": [
            "interpolate",
            ["linear"],
            ["line-progress"],
            0,
            "rgba(211,239,242,0)",
            1,
            "rgba(211,239,242,0.55)",
          ],
          "line-blur": 1,
        },
      });
      const layer = createLayer();
      layerRef.current = layer;
      map.addLayer(layer);
      for (const t of TERMINALS) {
        const el = document.createElement("button");
        el.className = "place-label terminal-label";
        el.innerHTML = `<span class="place-index">${t.short}</span><span>${t.name}<small>TERMINAL</small></span>`;
        el.setAttribute("aria-label", `View ${t.fullName}`);
        el.onclick = () =>
          map.flyTo({ center: t.coordinate, zoom: 14.3, duration: 1600 });
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat(t.label)
          .addTo(map);
      }
      for (const b of BRIDGES) {
        const el = document.createElement("span");
        el.className = "place-label bridge-label";
        el.textContent = b.name;
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat(b.coordinate)
          .addTo(map);
      }
      for (const [label, coordinates, className] of [
        ["CHARLESTON", [-79.947, 32.778], "city-label"],
        ["MOUNT PLEASANT", [-79.861, 32.803], "city-label"],
        ["ATLANTIC OCEAN", [-79.795, 32.725], "water-label"],
        ["SHIPPING CHANNEL", [-79.863, 32.757], "channel-label"],
        ["Charleston Harbor", [-79.889, 32.782], "harbor-label"],
        ["THE JETTIES", [-79.8, 32.74], "channel-label"],
      ]) {
        const el = document.createElement("span");
        el.className = `geographic-label ${className}`;
        el.textContent = label;
        new maplibregl.Marker({ element: el })
          .setLngLat(coordinates)
          .addTo(map);
      }
      setLoading(false);
      sync();
    });
    return () => {
      for (const e of markers.current.values())
        if (e.animation) cancelAnimationFrame(e.animation);
      markers.current.clear();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);
  useEffect(() => {
    sync();
  }, [vessels, night, showLabels, showChannel, showSupport]);
  useEffect(() => {
    for (const [id, e] of markers.current)
      e.el.classList.toggle("selected", id === selected?.id);
  }, [selected]);
  return (
    <div className={`map-stage ${night ? "night-map" : "day-map"}`}>
      <div className="map-canvas" ref={container} />
      <div className="map-vignette" />
      {loading && (
        <div className="map-notice">
          <span className="spinner" />
          Loading the aerial harbor…
        </div>
      )}
      {error && <div className="map-notice error">{error}</div>}
      {imageryFailed && (
        <div className="imagery-warning">
          Some aerial tiles are unavailable. Ship positions continue to refresh.
        </div>
      )}
      <div className="map-coordinate">
        32°48′ N &nbsp; 79°55′ W <span> / </span>{" "}
        {zoom > 14.3 ? "VESSEL DETAIL" : "HARBOR OVERVIEW"}
      </div>
    </div>
  );
});

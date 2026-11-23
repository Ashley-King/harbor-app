"""Build public/data/harbor.json: the fixed features the app draws and labels.

Everything is real map data, converted to the app's local metre frame (x east, y north):
  channel    - federal deep-draft channel reaches (US Army Corps of Engineers)
  bridges    - Ravenel and Don Holt bridge roadways (OpenStreetMap), towers read off the imagery
  terminals  - terminal outlines and their wharf faces (OpenStreetMap + the water mask)
  cranes     - ship-to-shore crane positions (OpenStreetMap; North Charleston read off the imagery)
  aids       - lit buoys and beacons (OpenStreetMap seamarks)
  piers      - pier and dock centre lines with widths (OpenStreetMap)
  labels     - names of places, as on a nautical chart
"""
import os
import json
import math
import urllib.request

import numpy as np
from PIL import Image

import geo

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(HERE, "..", "public", "data")

META = json.load(open(os.path.join(OUT, "geo.json")))
BASE = META["base"]
MASK = np.asarray(Image.open(os.path.join(OUT, "mask.png")))
MH, MW = MASK.shape[:2]


def W(lat, lon):
    x, y = geo.to_world(lat, lon)
    return [round(x, 1), round(y, 1)]


def water_at(x, y):
    """Water coverage 0..1 at a world position."""
    u = (x - BASE["west"]) / (BASE["east"] - BASE["west"]) * MW
    v = (BASE["north"] - y) / (BASE["north"] - BASE["south"]) * MH
    if not (0 <= u < MW and 0 <= v < MH):
        return 0.0
    return MASK[int(v), int(u), 0] / 255.0


def simplify(pts, tol):
    """Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    ab = b - a
    n = np.hypot(*ab) or 1.0
    d = [abs(ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0])) / n for p in pts[1:-1]]
    i = int(np.argmax(d))
    if d[i] <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[: i + 2], tol)[:-1] + simplify(pts[i + 1:], tol)


def simplify_ring(ring, tol):
    """Douglas-Peucker for a closed ring: split at the point farthest from the start."""
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    far = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
    return simplify(pts[: far + 1], tol)[:-1] + simplify(pts[far:] + [pts[0]], tol)[:-1]


def clip_rect(ring, west, south, east, north):
    """Sutherland-Hodgman clip of a ring to a rectangle. Returns the clipped ring."""
    def clip(pts, inside, cross):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            ia, ib = inside(a), inside(b)
            if ia and ib:
                out.append(b)
            elif ia and not ib:
                out.append(cross(a, b))
            elif ib:
                out.append(cross(a, b))
                out.append(b)
        return out

    def xcross(x):
        return lambda a, b: [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])]

    def ycross(y):
        return lambda a, b: [a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y]

    pts = ring[:-1] if ring[0] == ring[-1] else ring
    pts = clip(pts, lambda p: p[0] >= west, xcross(west))
    pts = clip(pts, lambda p: p[0] <= east, xcross(east))
    pts = clip(pts, lambda p: p[1] >= south, ycross(south))
    pts = clip(pts, lambda p: p[1] <= north, ycross(north))
    return pts


def centroid(ring):
    a = cx = cy = 0.0
    for i in range(len(ring)):
        x0, y0 = ring[i - 1]
        x1, y1 = ring[i]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-6:
        return [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]
    return [cx / (3 * a), cy / (3 * a)]


def area(ring):
    return 0.5 * sum(ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1] for i in range(len(ring)))


# ------------------------------------------------------------------ channel

def build_channel():
    d = json.load(open(os.path.join(CACHE, "usace_reach.geojson")))
    areas = {"CESAC_CH_01_CHE", "CESAC_CH_02_CHL", "CESAC_CH_03_CHU", "CESAC_CH_06_SYR"}
    rect = (BASE["west"] + 30, BASE["south"] + 30, BASE["east"] - 30, BASE["north"] - 30)
    reaches = []
    vertex_use = {}
    raw = []
    for f in d["features"]:
        p = f["properties"]
        if p["channelareaidfk"] not in areas or (p.get("depthmaintained") or 0) < 40:
            continue
        ring = [W(c[1], c[0]) for c in f["geometry"]["coordinates"][0]]
        raw.append((p, ring))
        for v in set(map(tuple, ring)):
            vertex_use[v] = vertex_use.get(v, 0) + 1
    for p, ring in raw:
        clipped = clip_rect(ring, *rect)
        if len(clipped) < 3:
            continue
        clipped = [[round(x, 1), round(y, 1)] for x, y in clipped]
        # Outline segments: skip the seams between neighbouring reaches and the clip edge.
        on_edge = lambda q: abs(q[0] - rect[0]) < 0.2 or abs(q[0] - rect[2]) < 0.2 or abs(q[1] - rect[1]) < 0.2 or abs(q[1] - rect[3]) < 0.2
        lines, cur = [], []
        n = len(clipped)
        for i in range(n):
            a, b = clipped[i], clipped[(i + 1) % n]
            shared = vertex_use.get(tuple(a), 0) >= 2 and vertex_use.get(tuple(b), 0) >= 2
            if shared or (on_edge(a) and on_edge(b)):
                if len(cur) > 1:
                    lines.append(cur)
                cur = []
                continue
            if not cur:
                cur = [a]
            cur.append(b)
        if len(cur) > 1:
            lines.append(cur)
        name = (p.get("sdsfeaturedescription") or p.get("sdsfeaturename") or "").title()
        name = name.replace("T.B.", "turning basin").replace("Mt.", "Mount").replace("Charleson", "Charleston")
        reaches.append({
            "name": name, "depthFt": p.get("depthmaintained"),
            "ring": clipped, "lines": lines, "at": [round(v, 1) for v in centroid(clipped)],
            "area": round(abs(area(clipped))),
        })
    return reaches


# ------------------------------------------------------------------ OSM features

OSM = json.load(open(os.path.join(CACHE, "osm_features.json")))["elements"]


def way_pts(e):
    return [W(g["lat"], g["lon"]) for g in e.get("geometry", [])]


def build_bridges():
    out = []
    spec = [
        ("ravenel", "Ravenel Bridge", "Arthur Ravenel Jr. Bridge", ["Ravenel"],
         {"towers": [W(32.80332, -79.91732), W(32.80266, -79.91228)], "style": "cable"}),
        ("holt", "Don Holt Bridge", "Don N. Holt Bridge", ["Holt", "Mark Clark"],
         {"towers": [W(32.89147, -79.96545), W(32.89103, -79.96285)], "style": "truss"}),
    ]
    for bid, label, full, keys, extra in spec:
        ways = []
        for e in OSM:
            t = e.get("tags", {})
            if e["type"] != "way" or "bridge" not in t or not t.get("highway"):
                continue
            name = (t.get("name", "") + " " + t.get("bridge:name", "") + " " + t.get("ref", ""))
            if not any(k.lower() in name.lower() for k in keys):
                continue
            pts = way_pts(e)
            if len(pts) < 2:
                continue
            lanes = t.get("lanes", "2").split(";")[0]
            ways.append({"pts": simplify(pts, 0.8), "lanes": int(lanes) if lanes.isdigit() else 2})
        towers = extra["towers"]
        if bid == "holt":
            # Keep the part of I-526 that is actually the river crossing.
            cx, cy = (towers[0][0] + towers[1][0]) / 2, (towers[0][1] + towers[1][1]) / 2
            ways = [w for w in ways if min(math.hypot(p[0] - cx, p[1] - cy) for p in w["pts"]) < 1400]
        mid = [round((towers[0][0] + towers[1][0]) / 2, 1), round((towers[0][1] + towers[1][1]) / 2, 1)]
        out.append({"id": bid, "label": label, "name": full, "ways": ways, "towers": towers, "span": mid, "style": extra["style"]})
        print("bridge", bid, len(ways), "ways", sum(len(w["pts"]) for w in ways), "pts")
    return out


TERMINALS = [
    # id, label, OSM name, container terminal?
    ("wando", "Wando Welch Terminal", "Wando Welch Intermodal Terminal", True),
    ("nct", "North Charleston Terminal", "North Charleston Terminal", True),
    ("leatherman", "Leatherman Terminal", "Hugh K. Leatherman Terminal", True),
    ("columbus", "Columbus Street Terminal", "Columbus Street Terminal", True),
    ("union", "Union Pier Terminal", "Union Pier Terminal", False),
    ("veterans", "Veterans Terminal", "Veterans Terminal", False),
]


def wharf_lines(ring, min_len=110.0):
    """Edges of a terminal outline that face open water, merged into wharf faces."""
    if area(ring) < 0:
        ring = ring[::-1]                      # counter-clockwise: outward normal is to the right
    n = len(ring)
    flags = []
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        if length < 1:
            flags.append((a, b, 0, False))
            continue
        nx, ny = dy / length, -dx / length
        hits = total = 0
        steps = max(1, int(length // 12))
        for s in range(steps + 1):
            t = (s + 0.5) / (steps + 1)
            px, py = a[0] + dx * t, a[1] + dy * t
            total += 1
            if all(water_at(px + nx * d, py + ny * d) > 0.9 for d in (30, 70, 150, 230)) and water_at(px - nx * 30, py - ny * 30) < 0.5:
                hits += 1
        flags.append((a, b, length, hits / total >= 0.75))
    # merge consecutive water-facing edges with nearly the same bearing
    lines, cur = [], None
    for a, b, length, wet in flags + flags[:1]:
        if not wet:
            if cur:
                lines.append(cur)
            cur = None
            continue
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        if cur and abs((ang - cur["ang"] + math.pi) % (2 * math.pi) - math.pi) < math.radians(14):
            cur["b"] = b
            cur["len"] += length
        else:
            if cur:
                lines.append(cur)
            cur = {"a": a, "b": b, "ang": ang, "len": length}
    if cur:
        lines.append(cur)
    out = []
    seen = set()
    for ln in lines:
        key = (tuple(ln["a"]), tuple(ln["b"]))
        if ln["len"] >= min_len and key not in seen:
            seen.add(key)
            dx, dy = ln["b"][0] - ln["a"][0], ln["b"][1] - ln["a"][1]
            L = math.hypot(dx, dy)
            out.append({"a": ln["a"], "b": ln["b"], "out": [round(dy / L, 4), round(-dx / L, 4)], "len": round(L)})
    return out


def build_terminals():
    out = []
    for tid, label, osm_name, container in TERMINALS:
        best = None
        for e in OSM:
            if e["type"] == "way" and e.get("tags", {}).get("name") == osm_name and e.get("geometry"):
                pts = way_pts(e)
                if best is None or abs(area(pts)) > abs(area(best)):
                    best = pts
        if best is None:
            print("MISSING terminal", osm_name)
            continue
        ring = simplify_ring(best, 2.0)
        wharves = wharf_lines(ring)
        out.append({"id": tid, "label": label, "container": container, "ring": ring,
                    "at": [round(v, 1) for v in centroid(ring)], "wharves": wharves})
        print("terminal", tid, len(ring), "pts", "wharves", [(w["len"], round(math.degrees(math.atan2(w["b"][0] - w["a"][0], w["b"][1] - w["a"][1])) % 360)) for w in wharves])
    return out


NCT_CRANES = [(32.9042, -79.9588), (32.9038, -79.9592), (32.9022, -79.9605), (32.9018, -79.9609), (32.9014, -79.9612), (32.9003, -79.9619)]


def build_cranes(terminals):
    """Ship-to-shore cranes, snapped to the wharf they stand on."""
    raw = []
    for e in OSM:
        t = e.get("tags", {})
        if t.get("man_made") != "crane":
            continue
        if e["type"] == "node":
            raw.append(W(e["lat"], e["lon"]))
        elif e.get("geometry"):
            raw.append([round(v, 1) for v in centroid(way_pts(e))])
    raw += [W(*p) for p in NCT_CRANES]
    cranes = []
    for x, y in raw:
        best = None
        for t in terminals:
            if not t["container"]:
                continue
            for w in t["wharves"]:
                ax, ay = w["a"]
                bx, by = w["b"]
                L = math.hypot(bx - ax, by - ay)
                ux, uy = (bx - ax) / L, (by - ay) / L
                s = max(8, min(L - 8, (x - ax) * ux + (y - ay) * uy))
                qx, qy = ax + ux * s, ay + uy * s
                dist = math.hypot(x - qx, y - qy)
                if dist < 120 and (best is None or dist < best[0]):
                    best = (dist, t["id"], qx, qy, w["out"])
        if best:
            cranes.append({"terminal": best[1], "at": [round(best[2], 1), round(best[3], 1)], "out": best[4]})
    print("cranes", len(cranes), "of", len(raw), {t["id"]: sum(1 for c in cranes if c["terminal"] == t["id"]) for t in terminals})
    return cranes


def build_aids():
    """Lit aids to navigation from OSM seamarks: lateral buoys and beacons."""
    aids = []
    for e in OSM:
        t = e.get("tags", {})
        st = t.get("seamark:type", "")
        if e["type"] != "node" or not (st.startswith("buoy") or st.startswith("beacon") or st == "light_minor" or st == "light_major"):
            continue
        colour = (t.get("seamark:light:colour") or t.get(f"seamark:{st}:colour") or "").split(";")[0]
        if colour not in ("red", "green", "white", "yellow"):
            continue
        x, y = W(e["lat"], e["lon"])
        if water_at(x, y) < 0.5 and not st.startswith("beacon"):
            continue
        aids.append({"at": [x, y], "c": colour[0], "lit": "seamark:light:colour" in t})
    print("aids", len(aids))
    return aids


USGS_TILE = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"
_tiles = {}


def photo_luma(x, y, z=16):
    """Brightness of the aerial photo at a world position (zoom-16 USGS tiles, cached on disk)."""
    lat, lon = geo.to_latlon(x, y)
    fx, fy = geo.tile_xy(lat, lon, z)
    tx, ty = int(fx), int(fy)
    key = (tx, ty)
    if key not in _tiles:
        path = os.path.join(CACHE, "tiles", str(z), f"{tx}_{ty}.jpg")
        try:
            if not os.path.exists(path) or os.path.getsize(path) < 500:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                req = urllib.request.Request(USGS_TILE.format(z=z, x=tx, y=ty), headers={"User-Agent": geo.UA})
                with urllib.request.urlopen(req, timeout=40) as r:
                    data = r.read()
                with open(path, "wb") as f:
                    f.write(data)
            _tiles[key] = np.asarray(Image.open(path).convert("L")).astype(np.float32)
        except Exception:
            _tiles[key] = None
    t = _tiles[key]
    if t is None:
        return None
    return float(t[min(255, int((fy - ty) * 256)), min(255, int((fx - tx) * 256))])


def measured_width(line):
    """Width of a pier read off the photo: the bright band across it, at its narrowest
    typical point so that boats tied alongside do not count."""
    widths = []
    for i in range(len(line) - 1):
        (ax, ay), (bx, by) = line[i], line[i + 1]
        seg = math.hypot(bx - ax, by - ay)
        if seg < 12:
            continue
        ux, uy = (bx - ax) / seg, (by - ay) / seg
        for k in range(max(1, int(seg // 14))):
            t = (k + 0.5) / max(1, int(seg // 14))
            cx, cy = ax + (bx - ax) * t, ay + (by - ay) * t
            prof = [photo_luma(cx - uy * o, cy + ux * o) for o in range(-16, 17)]
            if any(v is None for v in prof):
                return None
            prof = np.array(prof)
            water = np.median(np.concatenate([prof[:5], prof[-5:]]))
            core = prof[14:19].max()
            if core - water < 18:
                continue                                     # no clear deck here (shadow, or the line is off)
            half = water + (core - water) * 0.5
            c = 14 + int(np.argmax(prof[14:19]))
            lo = hi = c
            while lo > 0 and prof[lo - 1] > half:
                lo -= 1
            while hi < len(prof) - 1 and prof[hi + 1] > half:
                hi += 1
            widths.append(hi - lo + 1)
    if len(widths) < 3:
        return None
    return float(np.percentile(widths, 30))


def build_piers():
    """Piers and docks as centre lines with a width, so moored boats can be kept off them.

    OpenStreetMap draws most piers as a single line. For piers longer than 60 m the
    width is measured on the aerial photo. Shorter ones get a typical width. Piers
    drawn as outlines are reduced to their long axis.
    """
    out = []
    measured = 0
    for e in OSM:
        t = e.get("tags", {})
        if e["type"] != "way" or t.get("man_made") != "pier" or not e.get("geometry"):
            continue
        pts = way_pts(e)
        if len(pts) < 2:
            continue
        closed = len(pts) >= 4 and pts[0] == pts[-1]
        if closed:
            arr = np.array(pts[:-1], dtype=float)
            c = arr.mean(axis=0)
            _, _, vt = np.linalg.svd(arr - c)
            major, minor = vt[0], vt[1]
            a = (arr - c) @ major
            b = (arr - c) @ minor
            length, width = a.max() - a.min(), b.max() - b.min()
            mid = c + major * (a.max() + a.min()) / 2 + minor * (b.max() + b.min()) / 2
            if length > 2 and abs(area(pts)) / max(1e-6, length * width) > 0.55:
                p0, p1 = mid - major * length / 2, mid + major * length / 2
                out.append({"p": [round(float(v), 1) for v in (*p0, *p1)], "w": round(float(max(width, 1.5)), 1)})
                continue
            line, width = simplify(pts, 0.6), 1.2
        else:
            line = simplify(pts, 0.6)
            total = sum(math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]) for i in range(len(line) - 1))
            width = 5.0 if total >= 150 else 3.2 if total >= 40 else 2.4
            if total >= 60:
                m = measured_width(line)
                if m is not None:
                    # the photo is 2 m per pixel, which fattens a narrow deck by about a pixel
                    width = round(min(16.0, max(2.4, m - 1.4)), 1)
                    measured += 1
        out.append({"p": [v for q in line for v in q], "w": width})
    print("piers", len(out), "with", sum(len(x["p"]) // 2 for x in out), "points;", measured, "widths measured on the photo")
    return out


# Names set the way a nautical chart sets them: water in italics, land upright.
LABELS = [
    # text, lat, lon, kind, min zoom tier (0 = always)
    ("Cooper River", 32.8700, -79.9480, "water", 0),
    ("Wando River", 32.8480, -79.8940, "water", 0),
    ("Ashley River", 32.7850, -79.9680, "water", 0),
    ("Charleston Harbor", 32.7640, -79.9060, "water", 0),
    ("Atlantic Ocean", 32.7150, -79.7900, "water", 0),
    ("Charleston", 32.7830, -79.9390, "place", 0),
    ("North Charleston", 32.8790, -79.9930, "place", 0),
    ("Mount Pleasant", 32.8010, -79.8640, "place", 0),
    ("Daniel Island", 32.8580, -79.9140, "place", 0),
    ("James Island", 32.7350, -79.9430, "place", 0),
    ("Sullivan's Island", 32.7630, -79.8390, "place", 1),
    ("Morris Island", 32.7240, -79.8850, "place", 1),
    ("Fort Sumter", 32.7523, -79.8747, "landmark", 1),
    ("Castle Pinckney", 32.7737, -79.9110, "landmark", 2),
    ("Patriots Point", 32.7905, -79.9045, "landmark", 1),
    ("Drum Island", 32.8085, -79.9210, "landmark", 2),
    ("North jetty", 32.7385, -79.8215, "landmark", 1),
    ("South jetty", 32.7260, -79.8330, "landmark", 1),
    ("Naval Base piers", 32.8515, -79.9420, "landmark", 2),
]


def main():
    reaches = build_channel()
    terminals = build_terminals()
    data = {
        "source": {
            "channel": "US Army Corps of Engineers, National Channel Framework",
            "map": "OpenStreetMap contributors (ODbL)",
        },
        "bounds": {k: BASE[k] for k in ("west", "south", "east", "north")},
        "channel": reaches,
        "bridges": build_bridges(),
        "terminals": terminals,
        "cranes": build_cranes(terminals),
        "aids": build_aids(),
        "piers": build_piers(),
        "labels": [{"text": t, "at": W(la, lo), "kind": k, "tier": tier} for t, la, lo, k, tier in LABELS],
    }
    path = os.path.join(OUT, "harbor.json")
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print("harbor.json", os.path.getsize(path) // 1024, "KB;", len(reaches), "reaches")
    for r in sorted(reaches, key=lambda r: -r["area"])[:30]:
        print("  reach", r["name"], r["depthFt"], "ft", len(r["ring"]), "pts", len(r["lines"]), "lines", r["at"])


if __name__ == "__main__":
    main()

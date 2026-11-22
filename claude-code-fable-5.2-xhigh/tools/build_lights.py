"""Build public/data/lights.bin: where the night view puts its lights.

Street lights follow the real road network, terminal lights fill the real terminal
outlines, and dock lights sit on real piers (all from OpenStreetMap). The spacing
along each road is typical for its class. Individual lamp positions are not surveyed.

Format: little-endian Int16 triplets [x * 2, y * 2, kind] in the app's metre frame
(x east, y north, half-metre steps). Kinds:
  0 residential street   1 main road   2 highway   3 container terminal high mast
  4 bridge roadway       5 industrial yard         6 pier or dock
"""
import os
import json
import math
import random

import numpy as np
from PIL import Image

import geo

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(HERE, "..", "public", "data")
BASE = json.load(open(os.path.join(OUT, "geo.json")))["base"]
MASK = np.asarray(Image.open(os.path.join(OUT, "mask.png")))
MH, MW = MASK.shape[:2]
rnd = random.Random(8665530)

ROAD = {
    # class: (kind, spacing m, keep probability)
    "motorway": (2, 48, 1.0), "trunk": (2, 48, 1.0), "motorway_link": (2, 55, 0.9), "trunk_link": (2, 55, 0.9),
    "primary": (1, 46, 1.0), "primary_link": (1, 55, 0.9), "secondary": (1, 50, 0.95),
    "tertiary": (1, 58, 0.85), "residential": (0, 68, 0.62), "unclassified": (0, 75, 0.5), "living_street": (0, 70, 0.5),
}


def water_at(x, y):
    u = (x - BASE["west"]) / (BASE["east"] - BASE["west"]) * MW
    v = (BASE["north"] - y) / (BASE["north"] - BASE["south"]) * MH
    if not (0 <= u < MW and 0 <= v < MH):
        return None
    return MASK[int(v), int(u), 0] / 255.0


def along(pts, spacing, start=None):
    """Points every `spacing` metres along a polyline, with the local direction."""
    d = rnd.uniform(0, spacing) if start is None else start
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        seg = math.hypot(bx - ax, by - ay)
        if seg < 0.01:
            continue
        ux, uy = (bx - ax) / seg, (by - ay) / seg
        while d < seg:
            yield ax + ux * d, ay + uy * d, ux, uy
            d += spacing
        d -= seg


def inside(ring, x, y):
    c = False
    for i in range(len(ring)):
        x0, y0 = ring[i - 1]
        x1, y1 = ring[i]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def main():
    lights = []

    def add(x, y, kind):
        if BASE["west"] < x < BASE["east"] and BASE["south"] < y < BASE["north"]:
            lights.append((int(round(x * 2)), int(round(y * 2)), kind))

    # ---- roads
    roads = json.load(open(os.path.join(CACHE, "osm_roads.json")))["elements"]
    for e in roads:
        t = e.get("tags", {})
        spec = ROAD.get(t.get("highway"))
        g = e.get("geometry")
        if not spec or not g or t.get("tunnel") == "yes":
            continue
        kind, spacing, keep = spec
        bridge = "bridge" in t and t.get("bridge") != "no"
        pts = [geo.to_world(p["lat"], p["lon"]) for p in g]
        side = rnd.choice((-1, 1))
        for x, y, ux, uy in along(pts, spacing):
            if rnd.random() > keep:
                continue
            w = water_at(x, y)
            if w is None or (w > 0.5 and not bridge):
                continue
            off = (5.5 if kind else 4.0) * side + rnd.uniform(-1.5, 1.5)
            side = -side if kind == 2 or bridge else side
            add(x - uy * off, y + ux * off, 4 if bridge and w > 0.3 else kind)

    # ---- terminals and industrial yards
    feats = json.load(open(os.path.join(CACHE, "osm_features.json")))["elements"]
    harbor = json.load(open(os.path.join(OUT, "harbor.json")))
    container_rings = [t["ring"] for t in harbor["terminals"] if t["container"]]
    other_rings = [t["ring"] for t in harbor["terminals"] if not t["container"]]
    named = {"Wando Welch Intermodal Terminal", "North Charleston Terminal", "Hugh K. Leatherman Terminal",
             "Columbus Street Terminal", "Union Pier Terminal", "Veterans Terminal"}
    for e in feats:
        t = e.get("tags", {})
        if e["type"] == "way" and t.get("landuse") in ("industrial", "port", "harbour") and t.get("name") not in named and e.get("geometry"):
            other_rings.append([list(geo.to_world(p["lat"], p["lon"])) for p in e["geometry"]])

    def fill(ring, spacing, kind, jitter):
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        y = min(ys) + spacing * 0.35
        row = 0
        while y < max(ys):
            x = min(xs) + spacing * (0.3 if row % 2 else 0.8)
            while x < max(xs):
                px, py = x + rnd.uniform(-jitter, jitter), y + rnd.uniform(-jitter, jitter)
                if inside(ring, px, py) and (water_at(px, py) or 0) < 0.3:
                    add(px, py, kind)
                x += spacing
            y += spacing * 0.9
            row += 1

    for ring in container_rings:
        fill(ring, 88, 3, 10)
    for ring in other_rings:
        fill(ring, 115, 5, 22)

    # ---- piers and docks
    for e in feats:
        t = e.get("tags", {})
        g = e.get("geometry")
        if e["type"] != "way" or t.get("man_made") != "pier" or not g:
            continue
        pts = [geo.to_world(p["lat"], p["lon"]) for p in g]
        length = sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
        if length > 70:
            for x, y, ux, uy in along(pts, 34, start=12):
                add(x, y, 6)
        elif rnd.random() < 0.3:
            add(pts[-1][0], pts[-1][1], 6)

    arr = np.array(lights, dtype="<i2")
    path = os.path.join(OUT, "lights.bin")
    arr.tofile(path)
    kinds = np.bincount(arr[:, 2], minlength=7)
    print("lights.bin", len(arr), "lights", os.path.getsize(path) // 1024, "KB", dict(enumerate(kinds.tolist())))


if __name__ == "__main__":
    main()

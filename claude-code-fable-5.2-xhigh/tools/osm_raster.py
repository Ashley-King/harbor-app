"""Rasterise OpenStreetMap water and waterfront structures onto the zoom-15 pixel grid."""
import os
import json

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

import geo

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
# Twice the resolution of the base mosaic (zoom 14), on exactly the same extent.
_base = json.load(open(os.path.join(HERE, "..", "public", "data", "geo.json")))["base"]
Z = _base["zoom"] + 1
X0, Y0 = _base["tiles"][0] * 2, _base["tiles"][1] * 2
X1, Y1 = _base["tiles"][2] * 2 + 1, _base["tiles"][3] * 2 + 1
W, H = (X1 - X0 + 1) * 256, (Y1 - Y0 + 1) * 256
# Ground metres per pixel on this grid.
MPP = geo.CIRC / 2 ** Z / 256 * geo.K

Image.MAX_IMAGE_PIXELS = None


def px(lat, lon):
    x, y = geo.tile_xy(lat, lon, Z)
    return (x - X0) * 256, (y - Y0) * 256


def pts(geom):
    return [px(g["lat"], g["lon"]) for g in geom]


def join_rings(ways):
    """Join member ways end to end into closed rings."""
    segs = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while segs:
        ring = segs.pop()
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[-2::-1]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if len(ring) >= 4:
            rings.append(ring)
    return rings


def water_polygons():
    """OSM natural=water areas (rivers, creeks, ponds) as a boolean array."""
    d = json.load(open(os.path.join(CACHE, "osm_water.json")))
    img = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(img)
    holes = []
    for e in d["elements"]:
        t = e.get("tags", {})
        if t.get("natural") != "water" and t.get("waterway") != "riverbank":
            continue
        if e["type"] == "way":
            g = e.get("geometry") or []
            if len(g) >= 4 and (g[0]["lat"], g[0]["lon"]) == (g[-1]["lat"], g[-1]["lon"]):
                dr.polygon(pts(g), fill=255)
        elif e["type"] == "relation":
            outer, inner = [], []
            for m in e.get("members", []):
                if m.get("type") != "way" or not m.get("geometry"):
                    continue
                key = [(g["lat"], g["lon"]) for g in m["geometry"]]
                (inner if m.get("role") == "inner" else outer).append(key)
            for ring in join_rings(outer):
                dr.polygon([px(*p) for p in ring], fill=255)
            holes += join_rings(inner)
    for ring in holes:
        dr.polygon([px(*p) for p in ring], fill=0)
    return np.asarray(img) > 0


def sea(seeds):
    """Sea and harbor: everything reachable from the seed points without crossing a coastline."""
    d = json.load(open(os.path.join(CACHE, "osm_water.json")))
    img = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(img)
    for e in d["elements"]:
        if e.get("tags", {}).get("natural") == "coastline" and e.get("geometry"):
            dr.line(pts(e["geometry"]), fill=255, width=3)
    open_px = np.asarray(img) == 0
    labels, _ = ndimage.label(open_px)
    out = np.zeros((H, W), bool)
    for lat, lon in seeds:
        x, y = px(lat, lon)
        lab = labels[int(y), int(x)]
        if lab:
            out |= labels == lab
    # Close the 3 px coastline stroke on the water side.
    return ndimage.binary_dilation(out, iterations=2)


def structures():
    """Piers, breakwaters and road bridges: things that stand in or over the water."""
    d = json.load(open(os.path.join(CACHE, "osm_features.json")))
    img = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(img)

    def width_px(metres):
        return max(1, int(round(metres / MPP)))

    for e in d["elements"]:
        t = e.get("tags", {})
        g = e.get("geometry")
        if e["type"] != "way" or not g:
            continue
        p = pts(g)
        closed = len(g) >= 4 and (g[0]["lat"], g[0]["lon"]) == (g[-1]["lat"], g[-1]["lon"])
        mm = t.get("man_made")
        if mm in ("pier", "breakwater", "groyne", "quay"):
            if closed and (t.get("area") == "yes" or mm == "pier" and len(g) > 4):
                dr.polygon(p, fill=255)
            else:
                dr.line(p, fill=255, width=width_px({"pier": 5, "breakwater": 9, "groyne": 7, "quay": 6}[mm]))
        elif mm == "bridge" and closed:
            dr.polygon(p, fill=255)
        elif "bridge" in t and t.get("highway"):
            lanes = int(str(t.get("lanes", "2")).split(";")[0] or 2) if str(t.get("lanes", "2")).split(";")[0].isdigit() else 2
            dr.line(p, fill=255, width=width_px(lanes * 3.9 + 5), joint="curve")
    return np.asarray(img) > 0

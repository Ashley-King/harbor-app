"""Build public/data/chart.json: charted lights, buoys, beacons and wrecks.

Source: NOAA Office of Coast Survey, ENC Direct to GIS, harbour scale band (public
domain). These are the features printed on the official nautical charts, so each
light carries its real colour and flash sequence.

Output, all positions in the app's local metre frame:
  lights  [x, y, colour, range in nautical miles, height in metres, sequence]
          colour is w, r, g or y. The sequence lists seconds lit (positive) and
          seconds dark (negative) for one period. An empty list is a steady light.
  marks   [x, y, colour, shape]  shape: p pillar buoy, c can, n nun, k beacon on a pile
  wrecks  [x, y, kind, depth in metres or null, year charted]
          kind: h hull showing, m masts showing, d dangerous (submerged), n not dangerous
"""
import json
import os
import re
import urllib.parse
import urllib.request

import geo

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "data", "chart.json")
BASE = "https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_harbour/MapServer"
LAYERS = {"beacons": 1, "buoys": 6, "lights": 11, "wrecks": 36}
COLOURS = {"1": "w", "3": "r", "4": "g", "6": "y"}
BUOY_SHAPES = {"conical": "n", "can": "c", "barrel": "c", "pillar": "p", "spar": "p"}
# A flashing light charted without its timing gets the commonest one: 0.4 s every 4 s.
DEFAULT_FLASH = [0.4, -3.6]


def fetch(layer):
    lat0, lon0, lat1, lon1 = geo.BBOX
    q = urllib.parse.urlencode({
        "where": "1=1", "geometry": f"{lon0},{lat0},{lon1},{lat1}", "geometryType": "esriGeometryEnvelope",
        "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "returnGeometry": "true",
        "outSR": 4326, "f": "json",
    })
    req = urllib.request.Request(f"{BASE}/{layer}/query?{q}", headers={"User-Agent": geo.UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read()).get("features", [])


def sequence(sigseq, litchr):
    """S-57 SIGSEQ '00.3+(02.2)' -> [0.3, -2.2]. Brackets mark the dark intervals."""
    if sigseq:
        out = []
        for part in sigseq.split("+"):
            v = round(float(re.sub(r"[()]", "", part)), 1)
            out.append(-v if part.startswith("(") else v)
        return out
    return [] if litchr != 2 else DEFAULT_FLASH


def unique(rows, key):
    seen, out = set(), []
    for r in rows:
        k = key(r)
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def xy(lat, lon):
    x, y = geo.to_world(lat, lon)
    return [round(x, 1), round(y, 1)]


def build(lights, marks, wrecks):
    """Each argument is a list of plain tuples, already read from the chart features."""
    # The same feature is charted in more than one overlapping chart cell.
    lights = unique(lights, lambda r: (round(r[0], 4), round(r[1], 4), r[2]))
    marks = unique(marks, lambda r: (round(r[0], 4), round(r[1], 4)))
    wrecks = unique(wrecks, lambda r: (round(r[0], 4), round(r[1], 4)))
    return {
        "source": "NOAA Office of Coast Survey, ENC Direct to GIS",
        "lights": [xy(lat, lon) + [c, rng or 0, h or 0, seq] for lat, lon, c, rng, h, seq in lights if c],
        "marks": [xy(lat, lon) + [c, shape] for lat, lon, c, shape in marks if c],
        "wrecks": [xy(lat, lon) + [kind, depth, year] for lat, lon, kind, depth, year in wrecks],
    }


def wreck_kind(cat):
    cat = cat or ""
    return "h" if "hull" in cat else "m" if "mast" in cat else "n" if cat.startswith("non") else "d"


def write(chart):
    with open(OUT, "w") as f:
        json.dump(chart, f, separators=(",", ":"))
    print("lights", len(chart["lights"]), "marks", len(chart["marks"]), "wrecks", len(chart["wrecks"]))


if __name__ == "__main__":
    lights, marks, wrecks = [], [], []
    for f in fetch(LAYERS["lights"]):
        a, g = f["attributes"], f["geometry"]
        colour = COLOURS.get(str(a.get("COLOUR") or "").split(",")[0])
        height = round(a["HEIGHT"]) if a.get("HEIGHT") is not None else 0
        lights.append((g["y"], g["x"], colour, a.get("VALNMR"), height, sequence(a.get("SIGSEQ"), a.get("LITCHR"))))
    for name, shape_of in (("buoys", lambda a: BUOY_SHAPES.get(str(a.get("BOYSHP")).split(" ")[0], "p")), ("beacons", lambda a: "k")):
        for f in fetch(LAYERS[name]):
            a, g = f["attributes"], f["geometry"]
            marks.append((g["y"], g["x"], COLOURS.get(str(a.get("COLOUR") or "").split(",")[0]), shape_of(a)))
    for f in fetch(LAYERS["wrecks"]):
        a, g = f["attributes"], f["geometry"]
        year = int(str(a["SORDAT"])[:4]) if a.get("SORDAT") else None
        wrecks.append((g["y"], g["x"], wreck_kind(a.get("CATWRK")), a.get("VALSOU"), year))
    write(build(lights, marks, wrecks))

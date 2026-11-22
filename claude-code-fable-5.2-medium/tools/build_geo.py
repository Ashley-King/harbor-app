#!/usr/bin/env python3
"""Builds src/geo.json: static harbor geography from OpenStreetMap (ODbL) via Overpass.

Bridges, port terminal outlines, ship-to-shore crane positions, lighted aids to
navigation and charted channel lines. Geography only, no vessel data.
Run once: python3 tools/build_geo.py
"""
import json, os, urllib.parse, urllib.request

Q = """
[out:json][timeout:60][bbox:32.66,-80.10,32.97,-79.72];
(
  way["bridge"]["highway"="motorway"]["name"~"Ravenel|Mark Clark"];
  nwr["man_made"="crane"];
  way["industrial"="port"];
  node["seamark:type"~"buoy|beacon|light"];
  way["seamark:type"~"recommended_track|navigation_line"];
);
out body geom;
"""
req = urllib.request.Request("https://overpass-api.de/api/interpreter",
    data=urllib.parse.urlencode({"data": Q}).encode(), headers={"User-Agent": "harbor-bench/1.0"})
els = json.load(urllib.request.urlopen(req, timeout=90))["elements"]

def line(e): return [[round(p["lon"], 6), round(p["lat"], 6)] for p in e.get("geometry", [])]
def r6(v): return round(v, 6)

out = {"ravenel": [], "donHolt": [], "terminals": [], "cranes": [], "seamarks": [], "channel": []}
TERMS = {"Wando Welch": "wando", "North Charleston Terminal": "nct", "Leatherman Terminal": "leatherman",
         "Columbus Street": "columbus", "Union Pier": "unionpier", "Veterans Terminal": "veterans"}
for e in els:
    t = e.get("tags", {})
    name = t.get("name", "")
    if t.get("bridge") and "Ravenel" in name:
        out["ravenel"].append(line(e))
    elif t.get("bridge") and "Mark Clark" in name:
        b = e["bounds"]
        # The Don N. Holt Bridge is the I-526 crossing of the Cooper River.
        if b["minlon"] > -79.985 and b["maxlon"] < -79.936 and b["minlat"] > 32.882 and b["maxlat"] < 32.896:
            out["donHolt"].append(line(e))
    elif t.get("man_made") == "crane":
        if e["type"] == "node":
            out["cranes"].append([r6(e["lon"]), r6(e["lat"])])
        elif "bounds" in e:
            b = e["bounds"]
            out["cranes"].append([r6((b["minlon"] + b["maxlon"]) / 2), r6((b["minlat"] + b["maxlat"]) / 2)])
    elif t.get("industrial") == "port" and e["type"] == "way":
        for k, key in TERMS.items():
            if k in name and "Kinder" not in name:
                out["terminals"].append({"key": key, "name": name, "polygon": line(e)})
    elif t.get("seamark:type") in ("recommended_track", "navigation_line"):
        out["channel"].append({"kind": t["seamark:type"], "line": line(e)})
    elif e["type"] == "node" and t.get("seamark:type"):
        colour = t.get("seamark:light:colour") or t.get("seamark:light:1:colour")
        if not colour:
            continue
        per = t.get("seamark:light:period") or t.get("seamark:light:1:period")
        try: per = float(per)
        except (TypeError, ValueError): per = None
        out["seamarks"].append({"lon": r6(e["lon"]), "lat": r6(e["lat"]), "colour": colour.split(";")[0],
            "period": per, "char": t.get("seamark:light:character") or t.get("seamark:light:1:character"),
            "name": t.get("seamark:name")})
dst = os.path.join(os.path.dirname(__file__), "..", "src", "geo.json")
json.dump(out, open(dst, "w"), separators=(",", ":"))
print({k: len(v) for k, v in out.items()}, os.path.getsize(dst), "bytes")
print([t["name"] for t in out["terminals"]])

"""Download the OpenStreetMap features the app draws or lights.

Source: OpenStreetMap via the Overpass API (c) OpenStreetMap contributors, ODbL.
Writes raw responses to tools/.cache/osm_*.json. build_features.py and
build_lights.py turn them into the compact files under public/data.
"""
import os
import sys
import json
import urllib.parse
import urllib.request

import geo

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
B = "{},{},{},{}".format(*geo.BBOX)

QUERIES = {
    # Bridges, port land, cranes, piers, breakwaters and charted channel lines.
    "features": f"""[out:json][timeout:120][bbox:{B}];
(
  way["bridge"]["highway"~"motorway|trunk|primary|secondary"];
  way["man_made"="bridge"];
  node["man_made"="crane"]; way["man_made"="crane"];
  way["landuse"~"industrial|port|harbour"]["name"];
  relation["landuse"~"industrial|port"]["name"];
  way["man_made"~"pier|breakwater|groyne|quay"];
  way["seamark:type"]; node["seamark:type"];
  way["waterway"="fairway"]; way["waterway"="dock"];
);
out body geom qt;""",
    # Roads, used only to place street lights for the night view.
    "roads": f"""[out:json][timeout:180][bbox:{B}];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|motorway_link|trunk_link|primary_link|living_street)$"];
out tags geom qt;""",
    # Coastline and water polygons, used to check the water mask.
    "water": f"""[out:json][timeout:180][bbox:{B}];
(
  way["natural"="coastline"];
  way["natural"="water"]; relation["natural"="water"];
  way["waterway"="riverbank"];
);
out body geom qt;""",
}


def run(name, query):
    path = os.path.join(CACHE, f"osm_{name}.json")
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        print(name, "cached")
        return
    data = urllib.parse.urlencode({"data": query}).encode()
    err = None
    for url in ENDPOINTS * 2:
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": geo.UA})
            with urllib.request.urlopen(req, timeout=300) as r:
                body = r.read()
            json.loads(body)
            with open(path, "wb") as f:
                f.write(body)
            print(name, len(body) // 1024, "KB")
            return
        except Exception as e:
            err = e
            print(name, "retry after", repr(e)[:120])
    raise RuntimeError(f"{name} failed: {err}")


if __name__ == "__main__":
    os.makedirs(CACHE, exist_ok=True)
    for n in (sys.argv[1:] or QUERIES):
        run(n, QUERIES[n])

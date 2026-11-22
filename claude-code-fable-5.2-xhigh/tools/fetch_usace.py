"""Download the federal navigation channel outlines for Charleston Harbor.

Source: US Army Corps of Engineers National Channel Framework (public domain).
Writes tools/.cache/usace_area.geojson and usace_reach.geojson.
"""
import os
import json
import urllib.parse
import urllib.request

import geo

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
BASE = "https://services7.arcgis.com/n1YM8pTrFmm7L4hs/ArcGIS/rest/services/National_Channel_Framework/FeatureServer"
LAYERS = {"area": 1, "reach": 2}

if __name__ == "__main__":
    os.makedirs(CACHE, exist_ok=True)
    lat0, lon0, lat1, lon1 = geo.BBOX
    for name, layer in LAYERS.items():
        q = urllib.parse.urlencode({
            "where": "1=1", "geometry": f"{lon0},{lat0},{lon1},{lat1}", "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": 4326, "f": "geojson",
        })
        req = urllib.request.Request(f"{BASE}/{layer}/query?{q}", headers={"User-Agent": geo.UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
        d = json.loads(body)
        with open(os.path.join(CACHE, f"usace_{name}.geojson"), "wb") as f:
            f.write(body)
        print(name, len(d.get("features", [])), "features")

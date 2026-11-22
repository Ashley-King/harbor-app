"""Download USGS aerial imagery tiles for the harbor and stitch them into one mosaic.

Source: USGS The National Map "USGSImageryOnly" tile cache (public domain, NAIP
orthoimagery). Usage:

    python3 tools/fetch_imagery.py 14          # the base mosaic shipped with the app
    python3 tools/fetch_imagery.py 15 --scratch # larger mosaic for the analysis tools
"""
import io
import os
import sys
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

import geo

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(HERE, "..", "public", "data")
URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"


def fetch_tile(z, x, y):
    path = os.path.join(CACHE, "tiles", str(z), f"{x}_{y}.jpg")
    if os.path.exists(path) and os.path.getsize(path) > 500:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={"User-Agent": geo.UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
            Image.open(io.BytesIO(data)).verify()
            with open(path, "wb") as f:
                f.write(data)
            return path
        except Exception as e:  # retry, then give up loudly
            err = e
    raise RuntimeError(f"tile {z}/{x}/{y} failed: {err}")


def main():
    z = int(sys.argv[1]) if len(sys.argv) > 1 else 14
    scratch = "--scratch" in sys.argv
    x0, y0, x1, y1 = geo.tile_range(z)
    jobs = [(z, x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    print(f"z{z}: x {x0}..{x1}, y {y0}..{y1} -> {len(jobs)} tiles")
    with ThreadPoolExecutor(8) as ex:
        paths = list(ex.map(lambda j: fetch_tile(*j), jobs))
    w, h = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
    mosaic = Image.new("RGB", (w, h))
    for (zz, x, y), p in zip(jobs, paths):
        mosaic.paste(Image.open(p).convert("RGB"), ((x - x0) * 256, (y - y0) * 256))
    if scratch:
        out = os.path.join(CACHE, f"mosaic_z{z}.png")
        mosaic.save(out)
    else:
        os.makedirs(OUT, exist_ok=True)
        out = os.path.join(OUT, "base.jpg")
        mosaic.save(out, quality=84, optimize=True, progressive=True)
        mb = geo.range_merc_bounds(z, (x0, y0, x1, y1))
        w0 = geo.merc_to_world(mb[0], mb[1])
        w1 = geo.merc_to_world(mb[2], mb[3])
        meta = {
            "lat0": geo.LAT0, "lon0": geo.LON0, "bbox": geo.BBOX,
            "base": {"zoom": z, "tiles": [x0, y0, x1, y1], "size": [w, h],
                     "west": w0[0], "south": w0[1], "east": w1[0], "north": w1[1]},
        }
        with open(os.path.join(OUT, "geo.json"), "w") as f:
            json.dump(meta, f, indent=1)
    print("wrote", out, mosaic.size, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Builds public/watermask.png, a static land/water mask for the Charleston Harbor area.

Source: USGS National Map "USGSHydroCached" tiles (U.S. Geological Survey,
National Hydrography Dataset, public domain). Water-fill pixels are classified
by colour. This is
geography only; no vessel data is involved. Run once: python3 tools/build_watermask.py
"""
import io, math, os, sys, time, urllib.request
from PIL import Image, ImageFilter
import numpy as np

Z = 13
LON_MIN, LON_MAX = -80.20, -79.64
LAT_MIN, LAT_MAX = 32.62, 33.00
UA = "harbor-bench/1.0"

def tile_xy(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y

x0, y0 = tile_xy(LAT_MAX, LON_MIN, Z)
x1, y1 = tile_xy(LAT_MIN, LON_MAX, Z)
W, H = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
mosaic = Image.new("RGBA", (W, H))
for x in range(x0, x1 + 1):
    for y in range(y0, y1 + 1):
        url = f"https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{Z}/{y}/{x}"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            im = Image.open(io.BytesIO(r.read())).convert("RGBA")
        mosaic.paste(im, ((x - x0) * 256, (y - y0) * 256))
        time.sleep(0.03)
a = np.asarray(mosaic).astype(np.int16)
r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
# The hydro water fill is a pale blue (~190-215, 225-240, 255); labels and symbols are darker.
water = (al > 128) & (b > 235) & (g > 215) & (r > 170)
mask = Image.fromarray((water * 255).astype(np.uint8), "L")
# Close the small holes left by map labels and symbols, then soften the edge.
mask = mask.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(1.0))
out = os.path.join(os.path.dirname(__file__), "..", "public", "watermask.png")
mask.save(out, optimize=True)
n = 2 ** Z
def lon_of(x): return x / n * 360 - 180
def lat_of(y): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
print("size", W, H, "tiles x", x0, x1, "y", y0, y1)
print("bounds west,south,east,north:", lon_of(x0), lat_of(y1 + 1), lon_of(x1 + 1), lat_of(y0))
if "--debug" in sys.argv:
    mosaic.save("/tmp/hydro_mosaic_debug.png")

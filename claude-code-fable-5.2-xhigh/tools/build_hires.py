"""Build the sharp close-up imagery tiles under public/hires.

The USGS tile cache the app streams from stops at zoom 16 (about 2 m per pixel).
The photos behind it are the 2021 USDA NAIP flight, which was shot at 0.6 m. This
tool reads those same photos at full resolution from the public NAIP archive on
Microsoft's Planetary Computer (public domain imagery, no key) and bakes zoom-17
tiles at 512 px (0.5 m per pixel) for the places ships actually go: the terminals,
the banks of the deep-draft channel, the marinas and a few named spots.

Each tile is colour-matched to the USGS tile it replaces, so the two blend without
a seam. Open water is flattened, since the app redraws water anyway, which keeps
the files small.

Needs rasterio, Pillow, NumPy and SciPy.

Outputs: public/hires/17/<x>_<y>.webp and public/data/hires.json
"""
import io
import os
import sys
import json
import math
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor

# GDAL settings for reading cloud-hosted GeoTIFFs by byte range. Set through the
# process environment so every worker thread sees them.
os.environ.update({
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
    "GDAL_HTTP_MAX_RETRY": "4", "GDAL_HTTP_RETRY_DELAY": "2", "VSI_CACHE": "TRUE", "GDAL_CACHEMAX": "512",
})

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from affine import Affine
from scipy import ndimage

import geo

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
DATA = os.path.join(HERE, "..", "public", "data")
OUT = os.path.join(HERE, "..", "public", "hires")
Z = 17
SIZE = 512
YEAR = "2021"                       # the flight the USGS cache was built from
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SAS = "https://planetarycomputer.microsoft.com/api/sas/v1/token/naip"
USGS = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"
CHANNEL_REACH_M = 450               # land within this distance of the channel
TERMINAL_REACH_M = 200              # and this distance of a terminal
MARINA_REACH_M = 380                # and this distance of the middle of a marina
EXTRA = [                           # lat, lon, radius m
    (32.7905, -79.9085, 450),       # Patriots Point and the USS Yorktown
    (32.7523, -79.8747, 260),       # Fort Sumter
    (32.7737, -79.9110, 220),       # Castle Pinckney
    (32.7743, -79.9440, 320),       # Coast Guard Sector Charleston
]

base = json.load(open(os.path.join(DATA, "geo.json")))["base"]
harbor = json.load(open(os.path.join(DATA, "harbor.json")))
mask = np.asarray(Image.open(os.path.join(DATA, "mask.png")))
MH, MW = mask.shape[:2]
MPP = (base["east"] - base["west"]) / MW


def get_json(url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": geo.UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read())


def to_px(x, y):
    return (x - base["west"]) / (base["east"] - base["west"]) * MW, (base["north"] - y) / (base["north"] - base["south"]) * MH


def mask_window(z, tx, ty):
    b = geo.tile_merc_bounds(z, tx, ty)
    w0 = geo.merc_to_world(b[0], b[1])
    w1 = geo.merc_to_world(b[2], b[3])
    u0, v1 = to_px(*w0)
    u1, v0 = to_px(*w1)
    return u0, v0, u1, v1


def choose_tiles():
    """Zoom-17 tiles that hold land or structures near where ships go."""
    def raster(rings):
        im = Image.new("L", (MW, MH), 0)
        d = ImageDraw.Draw(im)
        for r in rings:
            d.polygon([to_px(*p) for p in r], fill=255)
        return np.asarray(im) > 0

    near = ndimage.distance_transform_edt(~raster([r["ring"] for r in harbor["channel"]])) * MPP < CHANNEL_REACH_M
    near |= ndimage.distance_transform_edt(~raster([t["ring"] for t in harbor["terminals"]])) * MPP < TERMINAL_REACH_M
    spots = Image.new("L", (MW, MH), 0)
    d = ImageDraw.Draw(spots)
    for lat, lon, r in EXTRA:
        u, v = to_px(*geo.to_world(lat, lon))
        d.ellipse([u - r / MPP, v - r / MPP, u + r / MPP, v + r / MPP], fill=255)
    # every marina, since that is where the small craft are
    osm = json.load(open(os.path.join(CACHE, "osm_features.json")))["elements"]
    for e in osm:
        if e.get("tags", {}).get("leisure") != "marina":
            continue
        g = e.get("geometry") or [{"lat": e.get("lat"), "lon": e.get("lon")}]
        if g[0]["lat"] is None:
            continue
        lat = sum(p["lat"] for p in g) / len(g)
        lon = sum(p["lon"] for p in g) / len(g)
        u, v = to_px(*geo.to_world(lat, lon))
        r = MARINA_REACH_M
        d.ellipse([u - r / MPP, v - r / MPP, u + r / MPP, v + r / MPP], fill=255)
    near |= np.asarray(spots) > 0
    land = (mask[..., 0] < 250) | (mask[..., 1] > 20)
    f = 2 ** (Z - base["zoom"])
    x0, y0, x1, y1 = base["tiles"][0] * f, base["tiles"][1] * f, base["tiles"][2] * f + f - 1, base["tiles"][3] * f + f - 1
    tiles = []
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            u0, v0, u1, v1 = mask_window(Z, tx, ty)
            sl = (slice(max(0, int(v0)), min(MH, math.ceil(v1))), slice(max(0, int(u0)), min(MW, math.ceil(u1))))
            if sl[0].stop <= sl[0].start or sl[1].stop <= sl[1].start:
                continue
            if land[sl].mean() >= 0.03 and near[sl].any():
                tiles.append((tx, ty))
    return tiles


def find_items():
    lat0, lon0, lat1, lon1 = geo.BBOX
    feats = []
    body = {"collections": ["naip"], "bbox": [lon0, lat0, lon1, lat1], "datetime": f"{YEAR}-01-01/{YEAR}-12-31", "limit": 200}
    page = get_json(STAC, body)
    feats += page["features"]
    token = get_json(SAS)["token"]
    items = []
    for f in feats:
        w, s, e, n = f["bbox"]
        items.append({"id": f["id"], "bounds": (geo.merc_x(w), geo.merc_y(s), geo.merc_x(e), geo.merc_y(n)), "href": f["assets"]["image"]["href"] + "?" + token})
    return items


local = threading.local()


def source(item):
    """One open reader per quad per thread (GDAL handles are not shared across threads)."""
    if not hasattr(local, "open"):
        local.open = {}
    if item["id"] not in local.open:
        local.open[item["id"]] = rasterio.open(item["href"])
    return local.open[item["id"]]


def read_photo(tx, ty, items):
    """The tile's pixels, warped from the quads' UTM grid to the map's Web Mercator grid."""
    b = geo.tile_merc_bounds(Z, tx, ty)
    res = (b[2] - b[0]) / SIZE
    grid = Affine.translation(b[0], b[3]) * Affine.scale(res, -res)
    out = np.zeros((SIZE, SIZE, 3), np.uint8)
    filled = np.zeros((SIZE, SIZE), bool)
    for it in items:
        ib = it["bounds"]
        if ib[0] >= b[2] or ib[2] <= b[0] or ib[1] >= b[3] or ib[3] <= b[1]:
            continue
        with WarpedVRT(source(it), crs="EPSG:3857", transform=grid, width=SIZE, height=SIZE, resampling=Resampling.cubic, add_alpha=True) as vrt:
            arr = vrt.read()
        ok = (arr[-1] > 0) & ~filled
        out[ok] = np.moveaxis(arr[:3], 0, -1)[ok]
        filled |= ok
        if filled.all():
            break
    return out, filled


def usgs_tile(z, x, y):
    path = os.path.join(CACHE, "tiles", str(z), f"{x}_{y}.jpg")
    if not os.path.exists(path) or os.path.getsize(path) < 500:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        req = urllib.request.Request(USGS.format(z=z, x=x, y=y), headers={"User-Agent": geo.UA})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=40) as r:
                    data = r.read()
                Image.open(io.BytesIO(data)).verify()
                with open(path, "wb") as f:
                    f.write(data)
                break
            except Exception as e:
                err = e
        else:
            raise RuntimeError(f"USGS tile {z}/{x}/{y}: {err}")
    return Image.open(path).convert("RGB")


def match_to_usgs(photo, tx, ty):
    """Give the sharp tile the tone of the USGS tile it replaces (same photo, different processing)."""
    parent = usgs_tile(Z - 1, tx // 2, ty // 2)
    qx, qy = (tx % 2) * 128, (ty % 2) * 128
    # take a little more than the quadrant so the blur has context at the edges
    pad = 16
    box = (qx - pad, qy - pad, qx + 128 + pad, qy + 128 + pad)
    canvas = Image.new("RGB", (256 + 2 * pad, 256 + 2 * pad))
    canvas.paste(parent, (pad, pad))
    # extend edge pixels into the padding
    arr = np.asarray(canvas).copy()
    arr[:pad] = arr[pad:pad + 1]
    arr[-pad:] = arr[-pad - 1:-pad]
    arr[:, :pad] = arr[:, pad:pad + 1]
    arr[:, -pad:] = arr[:, -pad - 1:-pad]
    ref = Image.fromarray(arr).crop((box[0] + pad, box[1] + pad, box[2] + pad, box[3] + pad))
    scale = SIZE // 128
    ref = np.asarray(ref.resize(((128 + 2 * pad) * scale, (128 + 2 * pad) * scale), Image.BICUBIC)).astype(np.float32)
    ref = ref[pad * scale:-pad * scale, pad * scale:-pad * scale]
    hi = photo.astype(np.float32)
    sigma = 9.0
    blur = lambda a: np.dstack([ndimage.gaussian_filter(a[..., c], sigma, mode="nearest") for c in range(3)])
    lo_ref, lo_hi = blur(ref), blur(hi)
    # contrast of the fine detail follows the local tone ratio, the tone itself comes from USGS
    gain = np.clip((lo_ref + 24.0) / (lo_hi + 24.0), 0.6, 1.6)
    return np.clip(lo_ref + (hi - lo_hi) * gain, 0, 255)


def flatten_water(img, tx, ty):
    """Smooth away detail on open water: the app paints water itself, so the bytes would be wasted."""
    u0, v0, u1, v1 = mask_window(Z, tx, ty)
    us = np.clip((u0 + (np.arange(SIZE) + 0.5) / SIZE * (u1 - u0)).astype(int), 0, MW - 1)
    vs = np.clip((v0 + (np.arange(SIZE) + 0.5) / SIZE * (v1 - v0)).astype(int), 0, MH - 1)
    m = mask[np.ix_(vs, us)]
    water = (m[..., 0] > 245) & (m[..., 1] < 8)
    water = ndimage.binary_erosion(water, iterations=10)        # keep a 5 m rim of real pixels at every edge
    if not water.any():
        return img, 0.0
    soft = ndimage.gaussian_filter(water.astype(np.float32), 4)
    flat = np.dstack([ndimage.gaussian_filter(img[..., c], 20, mode="nearest") for c in range(3)])
    return img * (1 - soft[..., None]) + flat * soft[..., None], float(water.mean())


def build(tile, items):
    tx, ty = tile
    path = os.path.join(OUT, str(Z), f"{tx}_{ty}.webp")
    if os.path.exists(path) and os.path.getsize(path) > 300:
        return tile, os.path.getsize(path), True
    photo, filled = read_photo(tx, ty, items)
    if filled.mean() < 0.999:
        return tile, 0, False                                    # outside the 2021 flight: leave it to the USGS tiles
    img = match_to_usgs(photo, tx, ty)
    img, _ = flatten_water(img, tx, ty)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(img.clip(0, 255).astype(np.uint8)).save(path, "WEBP", quality=QUALITY, method=6)
    return tile, os.path.getsize(path), True


QUALITY = 80

if __name__ == "__main__":
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    tiles = choose_tiles()
    print(len(tiles), "tiles chosen")
    if limit:
        tiles = tiles[:: max(1, len(tiles) // limit)][:limit]
    items = find_items()
    print(len(items), f"NAIP {YEAR} quads")
    done, total = [], 0
    with ThreadPoolExecutor(6) as ex:
        for i, (tile, size, ok) in enumerate(ex.map(lambda t: build(t, items), tiles)):
            if ok:
                done.append(tile)
                total += size
            if (i + 1) % 40 == 0:
                print(f"  {i + 1}/{len(tiles)}  {total / 1e6:.1f} MB", flush=True)
    if not limit:
        rows = {}
        for tx, ty in sorted(done, key=lambda t: (t[1], t[0])):
            rows.setdefault(ty, []).append(tx)
        manifest = {"zoom": Z, "size": SIZE, "source": f"USDA NAIP {YEAR}, read from the Planetary Computer archive", "rows": rows}
        with open(os.path.join(DATA, "hires.json"), "w") as f:
            json.dump(manifest, f, separators=(",", ":"))
    print(f"{len(done)} tiles written, {total / 1e6:.1f} MB, {len(tiles) - len(done)} skipped")

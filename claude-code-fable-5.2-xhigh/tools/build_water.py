"""Build the water mask and the water tint map.

The aerial photos contain whatever was afloat on the day they were flown: ships at
the terminals, barges at anchor, boat wakes. The app must only ever show vessels
from the live AIS feed, so the water is redrawn by a shader wherever this mask says
"water", which removes everything that was photographed on it. Fixed structures
(bridges, jetties, the museum ships at Patriots Point) are flagged so the shader
keeps their photographed pixels. Piers and docks are left as water here: the app
draws them itself from their map lines, which also clears away the boats that were
photographed in the marinas.

Inputs : tools/.cache/osm_water.json, osm_features.json (see fetch_osm.py)
         public/data/base.jpg (see fetch_imagery.py)
Outputs: public/data/mask.png  R = water coverage
                               G = fixed-structure zone (photo decides pixel by pixel)
                               B = distance from shore into the water, 2 m per step
         public/data/tint.jpg  smoothed colour of the photographed water
"""
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

import osm_raster as R

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "data")

# Sea seeds: open ocean off the jetties, mid-harbor, south channel.
SEEDS = [(32.72, -79.79), (32.77, -79.90), (32.715, -79.86)]

# Structures that OpenStreetMap does not carry as piers. Coordinates read off the imagery.
KEEP_POLYGONS = [
    # USS Yorktown, Patriots Point (museum ship, permanently berthed)
    [(32.79170, -79.90890), (32.79170, -79.90812), (32.79050, -79.90798), (32.78915, -79.90800), (32.78915, -79.90885), (32.79050, -79.90893)],
    # USS Laffey, alongside
    [(32.79000, -79.90806), (32.79000, -79.90772), (32.78868, -79.90772), (32.78868, -79.90806)],
]
# The harbor entrance jetties (low rubble mounds, awash for much of their length).
KEEP_LINES = [
    ([(32.75560, -79.84560), (32.74450, -79.83150), (32.72750, -79.81050)], 16),   # north jetty
    ([(32.73720, -79.87050), (32.73020, -79.84300), (32.71730, -79.81560)], 16),   # south jetty
]


def main():
    water = R.water_polygons() | R.sea(SEEDS)
    # Water runs under every structure, piers included.
    water |= R.structures(piers=True) & ndimage.binary_dilation(water, iterations=6)
    # Piers and docks are drawn by the app from their OpenStreetMap lines, so their
    # photographed pixels (and every boat photographed alongside them) are not kept.
    struct_img = Image.fromarray((R.structures(piers=False) * 255).astype(np.uint8))
    dr = ImageDraw.Draw(struct_img)
    for poly in KEEP_POLYGONS:
        dr.polygon([R.px(*p) for p in poly], fill=255)
    for line, width_m in KEEP_LINES:
        dr.line([R.px(*p) for p in line], fill=255, width=max(1, round(width_m / R.MPP)))
    struct = np.asarray(struct_img) > 0
    # Everything a structure touches counts as water underneath; the shader decides per pixel.
    water |= struct & ndimage.binary_dilation(water, iterations=6)
    # A structure zone slightly wider than the structure, so thin piers are fully inside it.
    zone = ndimage.binary_dilation(struct, iterations=1) & water

    h, w = water.shape
    half = lambda a: a.reshape(h // 2, 2, w // 2, 2).mean(axis=(1, 3))
    cover = ndimage.gaussian_filter(half(water.astype(np.float32)), 0.6)
    zone_h = ndimage.gaussian_filter(half(zone.astype(np.float32)).clip(0, 1) * 1.6, 0.5).clip(0, 1)
    land = half(water.astype(np.float32)) < 0.5
    dist = ndimage.distance_transform_edt(~land) * (R.MPP * 2)       # metres from shore
    rgb = np.dstack([
        (cover * 255).round().astype(np.uint8),
        (zone_h * 255).round().astype(np.uint8),
        (dist / 2.0).clip(0, 255).astype(np.uint8),
    ])
    Image.fromarray(rgb, "RGB").save(os.path.join(OUT, "mask.png"), optimize=True)
    print("mask.png", rgb.shape, os.path.getsize(os.path.join(OUT, "mask.png")) // 1024, "KB", "water %.3f" % cover.mean())

    # ---- water tint: robust local colour of open water, photographed objects rejected
    base = np.asarray(Image.open(os.path.join(OUT, "base.jpg")).convert("RGB")).astype(np.float32)
    assert base.shape[:2] == cover.shape, (base.shape, cover.shape)
    valid = (cover > 0.98) & (dist > 25) & (zone_h < 0.02) & (base.sum(axis=2) > 30)
    B = 8
    hh, ww = base.shape[0] // B, base.shape[1] // B
    blocks = base.reshape(hh, B, ww, B, 3).transpose(0, 2, 1, 3, 4).reshape(hh, ww, B * B, 3)
    vb = valid.reshape(hh, B, ww, B).transpose(0, 2, 1, 3).reshape(hh, ww, B * B)
    blocks = np.where(vb[..., None], blocks, np.nan)
    count = vb.sum(axis=2)
    with np.errstate(all="ignore"):
        med = np.nanmedian(blocks, axis=2)
    ok = count >= B * B // 3
    med = np.where(ok[..., None], med, 0)
    wgt = ok.astype(np.float32)

    def spread(sigma):
        num = np.dstack([ndimage.gaussian_filter(med[..., c] * wgt, sigma) for c in range(3)])
        den = ndimage.gaussian_filter(wgt, sigma)
        return num, den

    tint = np.zeros_like(med)
    filled = np.zeros(med.shape[:2], bool)
    for sigma in (4, 10, 25, 70, 200):
        num, den = spread(sigma)
        good = (den > 0.05) & ~filled
        tint[good] = num[good] / den[good][:, None]
        filled |= good
    mean_color = (med * wgt[..., None]).sum(axis=(0, 1)) / wgt.sum()
    tint[~filled] = mean_color
    # Pull the flight-strip seams together a little without losing the sediment plumes.
    tint = tint * 0.34 + mean_color * 0.66
    tint = np.dstack([ndimage.gaussian_filter(tint[..., c], 4.0) for c in range(3)])
    Image.fromarray(tint.clip(0, 255).astype(np.uint8), "RGB").save(os.path.join(OUT, "tint.jpg"), quality=92)
    print("tint.jpg", tint.shape, "mean colour", mean_color.round(1))


if __name__ == "__main__":
    main()

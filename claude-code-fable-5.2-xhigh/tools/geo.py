"""Shared geography helpers for the data build tools.

The app works in a local metric frame: Web Mercator, scaled by cos(lat0) so that
one unit is one metre on the ground at the harbor (the scale error across the
harbor is about 0.1 percent). Tiles stay exactly square in this frame.
"""
import math

# Area of interest (the AIS bounding box): min lat, min lon, max lat, max lon.
BBOX = (32.70, -80.05, 32.95, -79.75)
LAT0 = 32.825
LON0 = -79.90
R = 6378137.0
K = math.cos(math.radians(LAT0))
CIRC = 2 * math.pi * R

UA = "harbor-bench/1.0"


def merc_x(lon):
    return R * math.radians(lon)


def merc_y(lat):
    return R * math.asinh(math.tan(math.radians(lat)))


def to_world(lat, lon):
    """lat/lon -> (east, north) metres in the local frame."""
    return ((merc_x(lon) - merc_x(LON0)) * K, (merc_y(lat) - merc_y(LAT0)) * K)


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tile_range(z, bbox=BBOX):
    """Inclusive tile range covering the bbox at zoom z."""
    x0, y1 = tile_xy(bbox[0], bbox[1], z)
    x1, y0 = tile_xy(bbox[2], bbox[3], z)
    return int(math.floor(x0)), int(math.floor(y0)), int(math.floor(x1)), int(math.floor(y1))


def tile_merc_bounds(z, x, y):
    """Mercator bounds (minx, miny, maxx, maxy) of a tile."""
    size = CIRC / 2 ** z
    minx = -CIRC / 2 + x * size
    maxy = CIRC / 2 - y * size
    return minx, maxy - size, minx + size, maxy


def range_merc_bounds(z, rng):
    x0, y0, x1, y1 = rng
    a = tile_merc_bounds(z, x0, y1)
    b = tile_merc_bounds(z, x1, y0)
    return a[0], a[1], b[2], b[3]


def merc_to_world(mx, my):
    return ((mx - merc_x(LON0)) * K, (my - merc_y(LAT0)) * K)


def to_latlon(x, y):
    """Local metres (east, north) -> (lat, lon)."""
    mx = x / K + merc_x(LON0)
    my = y / K + merc_y(LAT0)
    return math.degrees(math.atan(math.sinh(my / R))), math.degrees(mx / R)

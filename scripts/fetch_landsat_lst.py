"""
Fetches a recent, cloud-free Landsat 8/9 Collection 2 Level-2 scene over
the DFW metro area from Microsoft Planetary Computer's STAC API, converts
the surface temperature band (ST_B10) to Fahrenheit, and writes it as a
data PNG + bounds/metadata JSON for the web app.

The output is temperature values, not colors — the web app colors pixels
at or above HOTSPOT_THRESHOLD_F (src/heatConfig.ts) at load time, so the
threshold can be changed without rerunning this script.

Cloud/shadow/cirrus-flagged pixels (QA_PIXEL, see BAD_QA_BITS) are filled
from their nearest good neighbor before a 3x3 median filter removes
per-pixel thermal-sensor noise (otherwise visible as salt-and-pepper
"static" even on perfectly clear pixels) — the fill keeps cloud values
from bleeding into their neighbors through the filter. The filled pixels
themselves aren't real readings, so they're still marked no-data.

Encoding: 16 bits packed into R+G over a fixed scale (DATA_SCALE_MIN_F to
DATA_SCALE_MAX_F), alpha 0/255 marking no-data (true nodata or
cloud/shadow/cirrus). Downsampled by DATA_DOWNSAMPLE_STRIDE to keep the
file small — see that constant for why.

Usage: python3 scripts/fetch_landsat_lst.py
Output: public/layers/surface-temperature-data.png
        public/layers/surface-temperature.json
"""

import json
from pathlib import Path

import numpy as np
import planetary_computer
import rasterio
from matplotlib import pyplot as plt
from pystac_client import Client
from rasterio.warp import transform_bounds
from rasterio.windows import bounds as window_bounds
from rasterio.windows import from_bounds
from scipy.ndimage import distance_transform_edt, median_filter

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
COLLECTION = "landsat-c2-l2"
ST_B10_ASSET = "lwir11"  # Planetary Computer's key for the ST_B10 band
QA_PIXEL_ASSET = "qa_pixel"

# QA_PIXEL bit meanings (Landsat Collection 2 Level-2)
BAD_QA_BITS = (1, 2, 3, 4)  # dilated cloud, cirrus, cloud, cloud shadow

MEDIAN_FILTER_SIZE = 3  # small — denoise without misrepresenting resolution

# west, south, east, north — Collin/Denton/Dallas/Tarrant counties (DFW metro)
BBOX = (-97.65, 32.55, -96.35, 33.47)

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "layers"
OUT_DATA_PNG = OUT_DIR / "surface-temperature-data.png"
OUT_JSON = OUT_DIR / "surface-temperature.json"

# Full resolution (30m) compresses to ~22MB and fully rewrites on every
# regen — real repo bloat. Stride 2 (60m cells) is still finer than the
# ~90m effective resolution the median filter already implies, and is
# what the browser colors and the click-to-inspect popup reads.
DATA_DOWNSAMPLE_STRIDE = 2
DATA_SCALE_MIN_F = -40.0
DATA_SCALE_MAX_F = 200.0


def dn_to_fahrenheit(dn: np.ndarray) -> np.ndarray:
    kelvin = dn.astype("float64") * 0.00341802 + 149.0
    celsius = kelvin - 273.15
    return celsius * 9.0 / 5.0 + 32.0


def write_data_png(path, fahrenheit: np.ndarray, good: np.ndarray) -> tuple[int, int]:
    """Encodes real Fahrenheit values (not colors) into a PNG: 16 bits
    packed into R+G over a fixed scale, alpha 0/255 marking no-data.
    Returns (width, height) of the grid."""
    small_f = fahrenheit[::DATA_DOWNSAMPLE_STRIDE, ::DATA_DOWNSAMPLE_STRIDE]
    small_good = good[::DATA_DOWNSAMPLE_STRIDE, ::DATA_DOWNSAMPLE_STRIDE]

    clipped = np.clip(small_f, DATA_SCALE_MIN_F, DATA_SCALE_MAX_F)
    q16 = np.round(
        (clipped - DATA_SCALE_MIN_F) / (DATA_SCALE_MAX_F - DATA_SCALE_MIN_F) * 65535
    ).astype(np.uint16)
    r = (q16 >> 8).astype(np.uint8)
    g = (q16 & 0xFF).astype(np.uint8)
    b = np.zeros_like(r)
    a = np.where(small_good, 255, 0).astype(np.uint8)

    plt.imsave(path, np.dstack([r, g, b, a]))
    height, width = small_f.shape
    return width, height


def point_in_polygon(point, ring):
    x, y = point
    inside = False
    n = len(ring)
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[i - 1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
    return inside


def bbox_fully_covered(item, bbox) -> bool:
    """A bbox search only requires intersection, not full coverage — an
    adjacent Landsat path/row can overlap just a corner. Check that the
    scene's actual footprint polygon contains every corner (and edge
    midpoints, in case of a concave/rotated footprint) of our bbox."""
    ring = item.geometry["coordinates"][0]
    west, south, east, north = bbox
    mid_lon, mid_lat = (west + east) / 2, (south + north) / 2
    test_points = [
        (west, south), (east, south), (east, north), (west, north),
        (mid_lon, south), (mid_lon, north), (west, mid_lat), (east, mid_lat),
    ]
    return all(point_in_polygon(p, ring) for p in test_points)


def find_scene():
    catalog = Client.open(STAC_URL)
    search = catalog.search(
        collections=[COLLECTION],
        bbox=BBOX,
        datetime="2022-01-01/..",
        query={
            "eo:cloud_cover": {"lt": 10},
            "platform": {"in": ["landsat-8", "landsat-9"]},
        },
        sortby=[{"field": "properties.datetime", "direction": "desc"}],
        max_items=50,
    )
    items = [item for item in search.items() if bbox_fully_covered(item, BBOX)]
    if not items:
        raise RuntimeError(
            "No single cloud-free Landsat scene fully covers the requested bbox "
            "(a bbox search can match scenes that only overlap part of it) — "
            "shrink the bbox or widen the date range"
        )
    return items[0]


def main():
    item = find_scene()
    print(f"Using scene {item.id} ({item.properties['datetime']}, "
          f"cloud cover {item.properties['eo:cloud_cover']}%)")

    signed = planetary_computer.sign(item)

    with rasterio.open(signed.assets[ST_B10_ASSET].href) as src:
        west, south, east, north = transform_bounds("EPSG:4326", src.crs, *BBOX)
        window = from_bounds(west, south, east, north, transform=src.transform)
        window = window.round_offsets().round_lengths()

        dn = src.read(1, window=window)
        nodata = src.nodata if src.nodata is not None else 0
        valid = dn != nodata

        actual_bounds = window_bounds(window, src.transform)
        out_west, out_south, out_east, out_north = transform_bounds(
            src.crs, "EPSG:4326", *actual_bounds
        )

    with rasterio.open(signed.assets[QA_PIXEL_ASSET].href) as src:
        qa = src.read(1, window=window)
    is_bad = np.zeros(qa.shape, dtype=bool)
    for bit in BAD_QA_BITS:
        is_bad |= ((qa >> bit) & 1).astype(bool)

    fahrenheit = dn_to_fahrenheit(dn)

    print(f"Cloud/shadow/cirrus: {100 * is_bad[valid].mean():.1f}% of pixels")

    # Fill contaminated (but not truly-missing) pixels from their nearest
    # good neighbor, so cloud values don't bleed into real readings through
    # the median filter below. They're still marked no-data in the output.
    needs_fill = is_bad & valid
    untrustworthy_source = needs_fill | ~valid
    nearest_good_idx = distance_transform_edt(
        untrustworthy_source, return_distances=False, return_indices=True
    )
    fahrenheit_filled = np.where(needs_fill, fahrenheit[tuple(nearest_good_idx)], fahrenheit)

    # Small median filter to remove per-pixel thermal-sensor noise that
    # otherwise looks like static even on unflagged, perfectly clear pixels.
    fahrenheit_smoothed = median_filter(fahrenheit_filled, size=MEDIAN_FILTER_SIZE)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    good = valid & ~is_bad
    data_width, data_height = write_data_png(OUT_DATA_PNG, fahrenheit_smoothed, good)

    metadata = {
        "west": out_west,
        "south": out_south,
        "east": out_east,
        "north": out_north,
        "sceneDate": item.properties["datetime"],
        "dataWidth": data_width,
        "dataHeight": data_height,
        "dataScaleMinF": DATA_SCALE_MIN_F,
        "dataScaleMaxF": DATA_SCALE_MAX_F,
    }
    OUT_JSON.write_text(json.dumps(metadata, indent=2))

    print(f"Wrote {OUT_DATA_PNG} ({data_width}x{data_height}) and {OUT_JSON}")
    good_f = fahrenheit_smoothed[good]
    for threshold in (110, 115, 120, 125):
        print(f"  at/above {threshold}F: {100 * (good_f >= threshold).mean():.0f}% of pixels")


if __name__ == "__main__":
    main()

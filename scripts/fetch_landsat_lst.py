"""
Fetches a recent, cloud-free Landsat 8/9 Collection 2 Level-2 scene over
the DFW metro area from Microsoft Planetary Computer's STAC API, converts
the surface temperature band (ST_B10) to Fahrenheit, colorizes it, and
writes a PNG + bounds/metadata JSON for the web app to load as a map
overlay.

The color scale is stretched to the 5th-95th percentile of land pixels
(water and cloud/shadow/cirrus excluded via QA_PIXEL, see BAD_QA_BITS)
rather than the raw min/max — water and contaminated/outlier pixels
otherwise compress the real ~30F of land variation into a sliver of the
colormap, making everything look like one flat color.

Cloud/shadow/cirrus-flagged pixels are filled from their nearest good
neighbor (a standard sparse-gap inpainting trick) rather than left as
visible holes, and a 3x3 median filter removes per-pixel thermal-sensor
noise that's otherwise visible as salt-and-pepper "static" even on
perfectly clear pixels.

A second PNG (surface-temperature-data.png) encodes the actual Fahrenheit
values (not colors) for the click-to-inspect feature — 16 bits packed
into the R+G channels over a fixed scale, alpha 0/255 marking no-data
(true nodata or cloud/shadow/cirrus — those are filled with an
interpolated value for the color display, but that's not a real
measurement, so the inspect tool should say "no data" rather than show
it as one). Downsampled by DATA_DOWNSAMPLE_STRIDE to keep the file small
— see that constant for why.

Usage: python3 scripts/fetch_landsat_lst.py
Output: public/layers/surface-temperature.png
        public/layers/surface-temperature-data.png
        public/layers/surface-temperature.json
"""

import json
from pathlib import Path

import numpy as np
import planetary_computer
import rasterio
from matplotlib import pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, Normalize
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
WATER_BIT = 7
BAD_QA_BITS = (1, 2, 3, 4)  # dilated cloud, cirrus, cloud, cloud shadow

MEDIAN_FILTER_SIZE = 3  # small — denoise without misrepresenting resolution

# Diverging blue -> warm cream -> deep red, replacing inferno so cold/hot
# read intuitively and the midtone matches this app's warm-neutral palette.
COLOR_STOPS = ["#2C6E9E", "#8FB8D9", "#EDE4CF", "#E2924D", "#A6281E"]
CMAP = LinearSegmentedColormap.from_list("blue_cream_red", COLOR_STOPS, N=256)

# west, south, east, north — Collin/Denton/Dallas/Tarrant counties (DFW metro)
BBOX = (-97.65, 32.55, -96.35, 33.47)

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "layers"
OUT_PNG = OUT_DIR / "surface-temperature.png"
OUT_DATA_PNG = OUT_DIR / "surface-temperature-data.png"
OUT_JSON = OUT_DIR / "surface-temperature.json"

# A full-resolution data PNG (same grid as the color image) compresses to
# ~22MB and fully rewrites on every regen — real repo bloat for a click
# tool. Stride 8 (~230m cells) is still finer than the ~90m effective
# resolution the median filter already implies, at ~500KB.
DATA_DOWNSAMPLE_STRIDE = 8
DATA_SCALE_MIN_F = -40.0
DATA_SCALE_MAX_F = 200.0


def dn_to_fahrenheit(dn: np.ndarray) -> np.ndarray:
    kelvin = dn.astype("float64") * 0.00341802 + 149.0
    celsius = kelvin - 273.15
    return celsius * 9.0 / 5.0 + 32.0


def write_data_png(path, fahrenheit: np.ndarray, good: np.ndarray) -> tuple[int, int]:
    """Encodes real Fahrenheit values (not colors) into a PNG for the
    click-to-inspect feature: 16 bits packed into R+G over a fixed scale,
    alpha 0/255 marking no-data. Returns (width, height) of the grid."""
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
    is_water = ((qa >> WATER_BIT) & 1).astype(bool)
    is_bad = np.zeros(qa.shape, dtype=bool)
    for bit in BAD_QA_BITS:
        is_bad |= ((qa >> bit) & 1).astype(bool)

    fahrenheit = dn_to_fahrenheit(dn)

    # Percentile stats from only trustworthy pixels — water and contaminated
    # (cloud/shadow/cirrus) pixels excluded, computed before any fill/smoothing.
    good_for_stats = valid & ~is_water & ~is_bad
    min_f, max_f = np.percentile(fahrenheit[good_for_stats], [5, 95])
    min_f, max_f = float(min_f), float(max_f)
    print(f"Masked out for stats: water {100 * is_water[valid].mean():.1f}%, "
          f"cloud/shadow/cirrus {100 * is_bad[valid].mean():.1f}%")

    # Fill contaminated (but not truly-missing) pixels from their nearest
    # good neighbor, so they don't render as holes or noisy garbage.
    needs_fill = is_bad & valid
    untrustworthy_source = needs_fill | ~valid
    nearest_good_idx = distance_transform_edt(
        untrustworthy_source, return_distances=False, return_indices=True
    )
    fahrenheit_filled = np.where(needs_fill, fahrenheit[tuple(nearest_good_idx)], fahrenheit)

    # Small median filter to remove per-pixel thermal-sensor noise that
    # otherwise looks like static even on unflagged, perfectly clear pixels.
    fahrenheit_smoothed = median_filter(fahrenheit_filled, size=MEDIAN_FILTER_SIZE)

    norm = Normalize(vmin=min_f, vmax=max_f, clip=True)
    rgba = CMAP(norm(fahrenheit_smoothed))
    rgba[..., 3] = np.where(valid, 1.0, 0.0)  # transparent nodata pixels

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    plt.imsave(OUT_PNG, rgba)

    # Water is a real measurement (only excluded from the percentile stats
    # above, not from the data itself) so it's "good" for the inspect tool;
    # cloud/shadow/cirrus pixels were only filled for the color display and
    # aren't real readings, so they stay excluded here.
    good_for_inspect = valid & ~is_bad
    data_width, data_height = write_data_png(OUT_DATA_PNG, fahrenheit_smoothed, good_for_inspect)

    metadata = {
        "west": out_west,
        "south": out_south,
        "east": out_east,
        "north": out_north,
        "minF": round(min_f, 1),
        "maxF": round(max_f, 1),
        "sceneDate": item.properties["datetime"],
        "dataWidth": data_width,
        "dataHeight": data_height,
        "dataScaleMinF": DATA_SCALE_MIN_F,
        "dataScaleMaxF": DATA_SCALE_MAX_F,
    }
    OUT_JSON.write_text(json.dumps(metadata, indent=2))

    print(f"Wrote {OUT_PNG}, {OUT_DATA_PNG} ({data_width}x{data_height}), and {OUT_JSON}")
    print(f"Range (land, 5th-95th percentile): {metadata['minF']}F - {metadata['maxF']}F")


if __name__ == "__main__":
    main()

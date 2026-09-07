"""
Fetches a recent, cloud-free Landsat 8/9 Collection 2 Level-2 scene over
Frisco, TX from Microsoft Planetary Computer's STAC API, converts the
surface temperature band (ST_B10) to Fahrenheit, colorizes it, and writes
a PNG + bounds/metadata JSON for the web app to load as a map overlay.

Usage: python3 scripts/fetch_landsat_lst.py
Output: public/layers/surface-temperature.png
        public/layers/surface-temperature.json
"""

import json
from pathlib import Path

import numpy as np
import planetary_computer
import rasterio
from matplotlib import pyplot as plt
from matplotlib.colors import Normalize
from pystac_client import Client
from rasterio.warp import transform_bounds
from rasterio.windows import bounds as window_bounds
from rasterio.windows import from_bounds

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
COLLECTION = "landsat-c2-l2"
ST_B10_ASSET = "lwir11"  # Planetary Computer's key for the ST_B10 band
COLORMAP = "inferno"  # swap to "magma" if preferred

# west, south, east, north — Frisco, TX
BBOX = (-96.90, 33.05, -96.75, 33.20)

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "layers"
OUT_PNG = OUT_DIR / "surface-temperature.png"
OUT_JSON = OUT_DIR / "surface-temperature.json"


def dn_to_fahrenheit(dn: np.ndarray) -> np.ndarray:
    kelvin = dn.astype("float64") * 0.00341802 + 149.0
    celsius = kelvin - 273.15
    return celsius * 9.0 / 5.0 + 32.0


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
        max_items=1,
    )
    items = list(search.items())
    if not items:
        raise RuntimeError("No cloud-free Landsat scene found for the given bbox/date range")
    return items[0]


def main():
    item = find_scene()
    print(f"Using scene {item.id} ({item.properties['datetime']}, "
          f"cloud cover {item.properties['eo:cloud_cover']}%)")

    signed = planetary_computer.sign(item)
    href = signed.assets[ST_B10_ASSET].href

    with rasterio.open(href) as src:
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

    fahrenheit = dn_to_fahrenheit(dn)
    min_f = float(fahrenheit[valid].min())
    max_f = float(fahrenheit[valid].max())

    norm = Normalize(vmin=min_f, vmax=max_f)
    cmap = plt.get_cmap(COLORMAP)
    rgba = cmap(norm(fahrenheit))
    rgba[..., 3] = np.where(valid, 1.0, 0.0)  # transparent nodata pixels

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    plt.imsave(OUT_PNG, rgba)

    metadata = {
        "west": out_west,
        "south": out_south,
        "east": out_east,
        "north": out_north,
        "minF": round(min_f, 1),
        "maxF": round(max_f, 1),
        "sceneDate": item.properties["datetime"],
    }
    OUT_JSON.write_text(json.dumps(metadata, indent=2))

    print(f"Wrote {OUT_PNG} and {OUT_JSON}")
    print(f"Range: {metadata['minF']}F - {metadata['maxF']}F")


if __name__ == "__main__":
    main()

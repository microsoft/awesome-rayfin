"""How much of the Oberstdorf valley can the photoreal core actually cover?

Two questions, and only one of them is about the GPU:

  1. **Does Bavaria survey it?** LDBV stops at the state border, and the west side of this valley is
     Austria (Kleinwalsertal, and the Fellhorn ridge itself). Asking the tile server is the only
     honest way to find out where the photoreal tier can go at all.
  2. **What would it cost?** Vertices, texture memory and download, scaled from the assets that
     exist today rather than from a guess.

Probes with HEAD requests only — nothing is downloaded.

Usage
  python tools/geodata/coverage_probe.py
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from utm import wgs84_to_utm32  # noqa: E402

MIRROR = "https://download1.bayernwolke.de"
DGM1_PATH = "a/dgm/dgm1"
USER_AGENT = "Gleitschirm-Insights/0.1 (open geodata pipeline; +https://geodaten.bayern.de)"

ROOT = Path(__file__).resolve().parents[2]

# Candidate areas. The current core is what ships; the others are built around places PLAN §4.2
# already resolved from OpenStreetMap, so no coordinate here is recalled.
#
#   Söllereck  47.3716886 / 10.2356574   |   Fellhorn 47.3449986 / 10.2236908
#   Oberstdorf 47.4104347 / 10.2774409   |   Nebelhorn 47.4218727 / 10.3423461
CANDIDATES = {
    "current core": dict(west=10.255, east=10.380, south=47.370, north=47.445),
    "valley + Söllereck": dict(west=10.215, east=10.385, south=47.355, north=47.450),
    "whole valley system": dict(west=10.190, east=10.390, south=47.330, north=47.460),
}


def tiles_for(bbox: dict) -> list[tuple[int, int]]:
    """The 1 km LDBV tile grid covering a bbox. Filenames encode UTM32 easting/northing in km."""
    corners = [
        wgs84_to_utm32(bbox["west"], bbox["south"]),
        wgs84_to_utm32(bbox["east"], bbox["south"]),
        wgs84_to_utm32(bbox["west"], bbox["north"]),
        wgs84_to_utm32(bbox["east"], bbox["north"]),
    ]
    eastings = [e for e, _ in corners]
    northings = [n for _, n in corners]
    e0, e1 = int(min(eastings) // 1000), int(max(eastings) // 1000)
    n0, n1 = int(min(northings) // 1000), int(max(northings) // 1000)
    return [(e, n) for e in range(e0, e1 + 1) for n in range(n0, n1 + 1)]


def exists(tile: tuple[int, int]) -> bool:
    url = f"{MIRROR}/{DGM1_PATH}/{tile[0]}_{tile[1]}.tif"
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - fixed host
            return response.status == 200
    except urllib.error.HTTPError:
        return False
    except OSError:
        return False


def span_km(bbox: dict) -> tuple[float, float]:
    mid_lat = (bbox["south"] + bbox["north"]) / 2
    width = (bbox["east"] - bbox["west"]) * 111.320 * math.cos(math.radians(mid_lat))
    depth = (bbox["north"] - bbox["south"]) * 111.130
    return width, depth


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--aoi",
        default=None,
        help="probe an AOI config's core and shell instead of the built-in Oberstdorf candidates",
    )
    args = parser.parse_args()

    descriptors = ROOT / "public" / "terrain" / "oberstdorf"
    drape = json.loads((descriptors / "drape.json").read_text(encoding="utf-8"))
    height = json.loads((descriptors / "heightmap_4m.json").read_text(encoding="utf-8"))
    landuse = json.loads((descriptors / "landuse.json").read_text(encoding="utf-8"))
    vegetation = json.loads((descriptors / "vegetation.json").read_text(encoding="utf-8"))

    base_w, base_d = span_km(CANDIDATES["current core"])
    base_area = base_w * base_d
    trees_per_km2 = vegetation["count"] / base_area

    if args.aoi:
        # ⚠️ A second site's core has to be checked for coverage before anything is built on it. The
        # Bavarian survey stops at the state border, and at Tegelberg the Säuling ridge IS that
        # border — so "is this box surveyed" is a real question with a real chance of no.
        config = json.loads((ROOT / "config" / "aoi" / f"{args.aoi}.json").read_text(encoding="utf-8"))
        candidates = {f"{args.aoi} core": config["bbox"]}
    else:
        candidates = CANDIDATES

    for name, bbox in candidates.items():
        width, depth = span_km(bbox)
        area = width * depth
        factor = area / base_area

        tiles = tiles_for(bbox)
        with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
            found = sum(pool.map(exists, tiles))

        print(f"\n=== {name} ===")
        print(f"  {width:.1f} x {depth:.1f} km = {area:.0f} km²   ({factor:.2f}x the current core)")
        print(f"  LDBV DGM1 tiles: {found}/{len(tiles)} available  ({found / len(tiles) * 100:.0f}% — the rest is Austria)")

        # Mesh: one vertex per 4 render cells, so vertices scale with area at fixed posting.
        cells_x = width * 1000 / height["resolutionM"]
        cells_y = depth * 1000 / height["resolutionM"]
        vertices = (cells_x / 4) * (cells_y / 4)

        # Textures, as uploaded: heightmap R16UI, land cover R8, drape RGBA8 with mipmaps (+33%).
        height_mb = cells_x * cells_y * 2 / 1e6
        landuse_mb = (width * 1000 / landuse["resolutionM"]) * (depth * 1000 / landuse["resolutionM"]) / 1e6
        drape_px = (width * 1000 / drape["resolutionM"]) * (depth * 1000 / drape["resolutionM"])
        drape_mb = drape_px * 4 * 1.33 / 1e6
        longest = max(width, depth) * 1000 / drape["resolutionM"]

        print(f"  mesh vertices     {vertices / 1000:>8.0f} k")
        print(f"  heightmap VRAM    {height_mb:>8.0f} MB")
        print(f"  land cover VRAM   {landuse_mb:>8.0f} MB")
        print(f"  drape @ {drape['resolutionM']:.2f} m   {drape_px / 1e6:>8.0f} Mpx -> {drape_mb:.0f} MB VRAM"
              f"{'   ⚠️ EXCEEDS 16384 px' if longest > 16384 else ''}")
        print(f"  trees (est.)      {trees_per_km2 * area / 1000:>8.0f} k")

        # What the drape resolution would have to be to hold today's texture budget.
        budget_px = drape["width"] * drape["height"]
        affordable_m = math.sqrt(area * 1e6 / budget_px)
        print(f"  -> drape at {affordable_m:.2f} m/px keeps the texture budget unchanged")


if __name__ == "__main__":
    main()

"""Download Baden-Württemberg survey (LGL) tiles for an AOI tier — PLAN Phase 6.

The second geobasis authority, and the point at which this engine stops being a Bavarian app.
Everything here is **dl-de/by-2-0**, attribution *Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0*,
and explicitly cleared for commercial and non-commercial use.

Four things about the LGL portal shape this script, and none of them are in any documentation:

**The download catalogue is hidden inside the map's vector tiles.** `opengeodata.lgl-bw.de` is an
Angular app with no REST API for the tile list; `/data/` returns 403 and every guessed index path
404s. What it *does* serve is the grid overlay at
`/tiles/vts/2x2Gitter/{z}/{x}/{y}.pbf`, and each grid-cell feature carries a JSON property listing
every product available for that cell together with its exact download path. Decompress the tile
and the whole manifest is in there as plain text. That is how the templates below were derived —
by reading the catalogue, not by guessing filenames.

**The grid is 2 km, and its origin is not where you would put it.** Cell south-west corners sit at
ODD eastings (…501, 503, 505…) and EVEN northings (…5372, 5374, 5376…) in kilometres. Snapping a
bbox to a 2 km multiple therefore misses by one kilometre in easting, which fails as a 404 rather
than as anything informative.

**Each 2 km archive contains four 1 km sub-tiles**, named for their own south-west corner. So the
unit you download and the unit you process are different sizes.

**DGM1 arrives as ASCII XYZ, not as a raster.** One line per square metre — `503000.50 5374999.50
430.13` — which is 29 MB per square kilometre and 1 000 000 lines. Bavaria ships GeoTIFF. Rather
than teach every downstream builder about a second input format, this script **converts XYZ to a
GeoTIFF carrying the same ModelTiepoint tag (33922) that `build_terrain.py` already reads from the
Bavarian tiles**. Normalising at the boundary means `build_terrain.py`, `build_shell.py` and the
registration gate are untouched by the existence of Baden-Württemberg.

Usage
  python tools/geodata/fetch_lgl_bw.py --aoi tuebingen                 # DGM1 for the core
  python tools/geodata/fetch_lgl_bw.py --aoi tuebingen --product lod2
  python tools/geodata/fetch_lgl_bw.py --aoi tuebingen --dry-run       # list cells and bytes
"""

from __future__ import annotations

import argparse
import io
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, TiffImagePlugin

from aoi import Tier, bbox_wsen, cache_dir, load_aoi
from utm import bbox_to_utm32

BASE = "https://opengeodata.lgl-bw.de"
USER_AGENT = "Campus-Insights/0.1 (open geodata pipeline; +https://opengeodata.lgl-bw.de)"

ATTRIBUTION = "Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0"

#: Download cells are 2 km squares.
CELL_KM = 2

#: ⚠️ The grid is anchored on ODD easting kilometres and EVEN northing kilometres. Verified against
#: the published catalogue: …497, 499, 501, 503… east and …5366, 5368, 5370… north.
EASTING_PARITY = 1
NORTHING_PARITY = 0


@dataclass(frozen=True)
class Product:
    """One LGL product: where its cells live, and what comes out of the archive."""

    #: Path template under the portal root. `{e}` and `{n}` are cell SW corner kilometres.
    template: str
    #: Which files inside the archive are worth keeping.
    suffixes: tuple[str, ...]
    #: True when the payload is ASCII XYZ that must become a GeoTIFF for the rest of the pipeline.
    xyz_to_tiff: bool = False


PRODUCTS: dict[str, Product] = {
    "dgm1": Product("/data/dgm/dgm1_32_{e}_{n}_2_bw.zip", (".xyz",), xyz_to_tiff=True),
    "ndom1": Product("/data/ndom1/ndom1_32_{e}_{n}_2_bw.zip", (".tif",)),
    "lod2": Product("/data/lod2/LoD2_32_{e}_{n}_2_bw.zip", (".gml",)),
    "dop20": Product("/data/dop20/dop20rgb_32_{e}_{n}_2_bw.zip", (".tif", ".jpg")),
}


def cells_for(bbox_utm: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """Every 2 km cell whose square intersects the bounding box."""
    min_e, min_n, max_e, max_n = bbox_utm

    def floor_to(value: float, parity: int) -> int:
        km = int(value // 1000)
        # Step back to the nearest kilometre of the right parity, so the cell contains the point.
        return km - ((km - parity) % CELL_KM)

    east_start = floor_to(min_e, EASTING_PARITY)
    north_start = floor_to(min_n, NORTHING_PARITY)
    east_end = floor_to(max_e, EASTING_PARITY)
    north_end = floor_to(max_n, NORTHING_PARITY)

    return [
        (e, n)
        for e in range(east_start, east_end + 1, CELL_KM)
        for n in range(north_start, north_end + 1, CELL_KM)
    ]


def fetch(url: str, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=900) as response:  # noqa: S310
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise
            last = exc
        except Exception as exc:  # noqa: BLE001 - network, retried below
            last = exc
        wait = 4 * (attempt + 1)
        print(f"    retrying in {wait}s ({last})")
        time.sleep(wait)
    raise RuntimeError(f"{url}: {last}")


def head_size(url: str) -> int | None:
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="HEAD")
        with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
            return int(response.headers.get("Content-Length") or 0)
    except Exception:  # noqa: BLE001 - a missing cell is a fact, not a failure
        return None


def xyz_to_geotiff(payload: bytes, out_path: Path) -> tuple[int, int]:
    """Convert one 1 km ASCII XYZ tile into a float32 GeoTIFF with a ModelTiepoint.

    The rows arrive north-to-south and west-to-east, but nothing guarantees that, so the position
    of every sample is computed from its own coordinates rather than assumed from its line number.
    A tile clipped at the state boundary simply leaves NaN where it has no data — the same
    convention the Bavarian reader produces, so `build_terrain.py` cannot tell the two apart.
    """
    values = np.array(payload.split(), dtype=np.float64)
    if values.size % 3:
        raise ValueError(f"{out_path.name}: not a multiple of three columns")
    values = values.reshape(-1, 3)

    eastings, northings, heights = values[:, 0], values[:, 1], values[:, 2]

    # Samples are cell CENTRES at x.50, so the tile's west edge is the floor of the minimum.
    origin_e = float(np.floor(eastings.min()))
    top_n = float(np.ceil(northings.max()))
    width = int(round(eastings.max() - origin_e + 0.5))
    height = int(round(top_n - northings.min() + 0.5))

    grid = np.full((height, width), np.nan, dtype=np.float32)
    cols = np.rint(eastings - origin_e - 0.5).astype(np.int64)
    rows = np.rint(top_n - northings - 0.5).astype(np.int64)
    inside = (cols >= 0) & (cols < width) & (rows >= 0) & (rows < height)
    grid[rows[inside], cols[inside]] = heights[inside].astype(np.float32)

    image = Image.fromarray(grid, mode="F")
    tags = TiffImagePlugin.ImageFileDirectory_v2()
    # 33550 ModelPixelScale, 33922 ModelTiepoint — the pair `build_terrain.py` reads.
    tags[33550] = (1.0, 1.0, 0.0)
    tags[33922] = (0.0, 0.0, 0.0, origin_e, top_n, 0.0)
    tags.tagtype[33550] = 12  # DOUBLE
    tags.tagtype[33922] = 12
    image.save(out_path, format="TIFF", tiffinfo=tags)
    return width, height


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="tuebingen")
    parser.add_argument("--product", default="dgm1", choices=sorted(PRODUCTS))
    parser.add_argument("--tier", default="core", choices=("core", "shell"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    product = PRODUCTS[args.product]
    tier: Tier = args.tier

    bbox_utm = bbox_to_utm32(*bbox_wsen(cfg, tier))
    cells = cells_for(bbox_utm)

    out_dir = cache_dir(args.product, cfg["id"])
    archive_dir = cache_dir("raw", "lgl", cfg["id"])

    print(f"AOI {cfg['id']} ({tier}) — {args.product}")
    print(f"  bbox UTM32: {bbox_utm[0]:.0f}/{bbox_utm[1]:.0f} .. {bbox_utm[2]:.0f}/{bbox_utm[3]:.0f}")
    print(f"  {len(cells)} cells of {CELL_KM} km: {', '.join(f'{e}_{n}' for e, n in cells)}")

    if args.dry_run:
        total = 0
        for e, n in cells:
            size = head_size(BASE + product.template.format(e=e, n=n))
            state = f"{size / 1e6:8.1f} MB" if size else "   missing"
            total += size or 0
            print(f"    {e}_{n}  {state}")
        print(f"  total {total / 1e6:.1f} MB")
        return

    written = 0
    for index, (e, n) in enumerate(cells, start=1):
        url = BASE + product.template.format(e=e, n=n)
        archive = archive_dir / f"{args.product}_{e}_{n}.zip"

        if not archive.exists() or args.force:
            print(f"[{index}/{len(cells)}] {url.rsplit('/', 1)[-1]}")
            try:
                archive.write_bytes(fetch(url))
            except urllib.error.HTTPError as exc:
                if exc.code == 404:
                    print("    not published for this cell — skipping")
                    continue
                raise
        else:
            print(f"[{index}/{len(cells)}] {archive.name} (cached)")

        with zipfile.ZipFile(archive) as zf:
            for name in zf.namelist():
                if not name.lower().endswith(product.suffixes):
                    continue
                leaf = Path(name).name
                if product.xyz_to_tiff:
                    target = out_dir / (Path(leaf).stem + ".tif")
                    if target.exists() and not args.force:
                        continue
                    width, height = xyz_to_geotiff(zf.read(name), target)
                    print(f"    {leaf} -> {target.name} ({width}x{height})")
                else:
                    target = out_dir / leaf
                    if target.exists() and not args.force:
                        continue
                    with zf.open(name) as src, target.open("wb") as dst:
                        shutil.copyfileobj(src, dst)
                    print(f"    {leaf} ({target.stat().st_size / 1e6:.1f} MB)")
                written += 1

    print(f"\n{written} files in {out_dir}")
    print(ATTRIBUTION)


if __name__ == "__main__":
    main()

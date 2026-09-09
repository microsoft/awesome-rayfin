"""Download Nordrhein-Westfalen survey (Geobasis NRW) tiles for an AOI tier — PLAN §37.

The **third** geobasis authority, added so the largest German universities could be built at all:
Köln, Aachen, Münster, Bochum, Duisburg-Essen and Bonn are all in NRW, and between them they carry
more students than any other state's share of the national top twenty. Everything here is
**dl-de/zero-2-0** — no attribution legally required, though the pipeline attributes anyway.

Four things about this portal, each measured rather than assumed:

**NRW is EASIER than Baden-Württemberg, not harder.** The LGL hides its catalogue inside the map's
vector tiles and ships DGM1 as 29 MB of ASCII XYZ per square kilometre, which `fetch_lgl_bw.py` has
to convert. NRW publishes DGM1 as a **float32 GeoTIFF carrying ModelPixelScale (33550) and
ModelTiepoint (33922)** — the exact pair `build_terrain.py` already reads from the Bavarian tiles.
Measured on `dgm1_32_356_5645_1_nw_2022.tif`: 1000x1000, mode F, tiepoint (356000, 5646000), scale
1.0. So there is no conversion step here at all, and no second input format to teach downstream.

**The tiles are 1 km, and there is no parity offset.** Baden-Württemberg's grid is 2 km anchored on
ODD eastings and EVEN northings, which is a genuine trap there. NRW simply steps every kilometre.

**⚠️ THE FILENAME CARRIES A PER-TILE YEAR, SO A URL TEMPLATE GUESSES WRONG.** `dgm1_…_nw_2022.tif`,
`ndom50_…_nw_2023.tif`, `dop10rgbi_…_nw_2025.jp2` — the vintage differs from tile to tile because
the state re-flies and re-scans in blocks. Templating the year works until it silently 404s on the
one tile that was updated. So this fetcher reads the product's own `index.json` (one request,
cached) and maps (easting, northing) to the exact published filename. LoD2 happens to carry no year
today; it is looked up the same way rather than being special-cased on that observation.

**⚠️ THE PRODUCT LIVES ONE FOLDER DEEPER THAN IT LOOKS.** The dataset is at
`geobasis/hm/dgm1_tiff/dgm1_tiff/`, not `geobasis/hm/dgm1_tiff/`. Asking the shallower path returns
404, which reads as "this product does not exist" rather than "you are one level up".

Usage
  python tools/geodata/fetch_nrw.py --aoi koeln                  # DGM1 for the core
  python tools/geodata/fetch_nrw.py --aoi koeln --product lod2
  python tools/geodata/fetch_nrw.py --aoi koeln --dry-run        # list tiles and bytes
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from aoi import Tier, bbox_wsen, cache_dir, load_aoi
from utm import bbox_to_utm32

BASE = "https://www.opengeodata.nrw.de/produkte/geobasis/"
USER_AGENT = "Campus-Scheduler/0.1 (open geodata pipeline; +https://www.opengeodata.nrw.de)"

ATTRIBUTION = "Datenquelle: Land NRW (Geobasis NRW), dl-de/zero-2-0"

#: Download tiles are 1 km squares, stepping every kilometre — no parity offset (unlike the LGL).
CELL_KM = 1


@dataclass(frozen=True)
class Product:
    """One NRW product: the folder its index lives in, and the suffix it publishes."""

    folder: str
    suffix: str


PRODUCTS: dict[str, Product] = {
    "dgm1": Product("hm/dgm1_tiff/dgm1_tiff/", ".tif"),
    "lod2": Product("3dg/lod2_gml/lod2_gml/", ".gml"),
    "ndom50": Product("hm/ndom50_tiff/ndom50_tiff/", ".tif"),
}

#: ⚠️ Tolerates BOTH separator conventions on purpose. DGM1 and LoD2 write `32_356_5645_1`, while
#: nDOM50 and bDOM50 write `32356_5645_1` with no underscore after the zone. Parsing the coordinates
#: out of the published name — rather than rebuilding the name from coordinates — means this script
#: does not have to know which product uses which, and a new one cannot break it quietly.
TILE_RE = re.compile(r"_32_?(\d{3})_(\d{4})_1_", re.IGNORECASE)


def cells_for(bbox_utm: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """Every 1 km tile whose square intersects the bounding box."""
    min_e, min_n, max_e, max_n = bbox_utm
    east_start, east_end = int(min_e // 1000), int(max_e // 1000)
    north_start, north_end = int(min_n // 1000), int(max_n // 1000)
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


def tile_catalogue(product: Product, aoi_id: str) -> dict[tuple[int, int], tuple[str, int]]:
    """Map (easting km, northing km) -> (published filename, byte size).

    The index is a few megabytes and describes the whole state, so it is cached per AOI run rather
    than fetched per tile. A tile the state has not published is simply absent from the map, which
    the caller reports as a gap instead of turning into a 404 traceback.
    """
    cache = cache_dir("raw", "nrw") / f"index_{product.folder.strip('/').replace('/', '_')}.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        payload = cache.read_bytes()
    else:
        print(f"  fetching product index {BASE + product.folder}index.json")
        payload = fetch(BASE + product.folder + "index.json")
        cache.write_bytes(payload)

    data = json.loads(payload)
    catalogue: dict[tuple[int, int], tuple[str, int]] = {}
    for dataset in data.get("datasets", []):
        for entry in dataset.get("files", []):
            name = entry.get("name") or ""
            if not name.lower().endswith(product.suffix):
                continue
            match = TILE_RE.search(name)
            if not match:
                continue
            key = (int(match.group(1)), int(match.group(2)))
            catalogue[key] = (name, int(entry.get("size") or 0))
    return catalogue


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="koeln")
    parser.add_argument("--product", default="dgm1", choices=sorted(PRODUCTS))
    parser.add_argument("--tier", default="core", choices=("core", "shell"))
    parser.add_argument("--dry-run", action="store_true", help="list the tiles and their size, download nothing")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    product = PRODUCTS[args.product]
    tier: Tier = args.tier

    bbox_utm = bbox_to_utm32(*bbox_wsen(cfg, tier))
    cells = cells_for(bbox_utm)

    out_dir = cache_dir(args.product, cfg["id"])
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"AOI {cfg['id']} ({tier}) — {args.product}")
    print(f"  {len(cells)} tiles of {CELL_KM} km over {bbox_utm}")

    catalogue = tile_catalogue(product, cfg["id"])
    print(f"  catalogue lists {len(catalogue)} published {args.product} tiles for NRW")

    wanted: list[tuple[tuple[int, int], str, int]] = []
    missing: list[tuple[int, int]] = []
    for cell in cells:
        hit = catalogue.get(cell)
        if hit is None:
            missing.append(cell)
            continue
        wanted.append((cell, hit[0], hit[1]))

    total = sum(size for _, _, size in wanted)
    print(f"  {len(wanted)} available, {len(missing)} not published, {total / 1e6:.1f} MB")
    if missing:
        # A tile outside the state boundary is a FACT about NRW, not a failure — the AOI shell can
        # legitimately reach into Niedersachsen or the Netherlands. Report it and carry on.
        print(f"  not published (outside NRW or not yet flown): {missing[:8]}{' …' if len(missing) > 8 else ''}")

    if args.dry_run:
        for (e, n), name, size in wanted[:20]:
            print(f"    {e} {n}  {name}  {size / 1e6:.1f} MB")
        return

    written = 0
    for index, ((e, n), name, size) in enumerate(wanted, start=1):
        target = out_dir / name
        if target.exists() and target.stat().st_size > 0:
            continue
        print(f"  [{index}/{len(wanted)}] {name} ({size / 1e6:.1f} MB)")
        payload = fetch(BASE + product.folder + name)
        target.write_bytes(payload)
        written += 1

    print(f"\n{written} new files in {out_dir} ({len(wanted)} tiles total)")
    print(ATTRIBUTION)


if __name__ == "__main__":
    sys.exit(main())

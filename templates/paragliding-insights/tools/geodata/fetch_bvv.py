"""Download Bavarian survey (LDBV) tiles for an AOI tier.

PLAN §5.1. Everything here is CC BY 4.0, attribution
*Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de*.

Two facts about the Bavarian open-data service shape this script:

**Tile discovery is arithmetic, not a catalogue.** Tile filenames encode the UTM32 easting and
northing of the tile's south-west corner in kilometres — `600_5250.tif` is the 1 km square whose
SW corner is E 600 000 / N 5 250 000. So the tile list for a bounding box is computed, not looked
up, and no catalogue request is needed before the first download. Verified 2026-07-29 against
`https://download1.bayernwolke.de/a/dgm/dgm1/595_5259.tif`.

**The Metalink catalogue supplies integrity, not discovery.** The per-municipality `.meta4`
catalogues carry per-tile size, SHA-256 and mirrors. They are keyed by AGS (municipality key),
and ⚠️ the AGS for the AOI is *not currently known* — probing `09780139` returned 74 tiles for a
municipality of ~230 km², so it is a neighbouring one. Rather than guess, this script derives the
tile list from the bbox and treats hashes as an *optional* enhancement: pass `--metalink <AGS>`
once the right key is known and every tile it covers gets verified.

Without a hash, integrity is still checked structurally — a tile has to open as a georeferenced
float32 raster of the expected size, at the expected UTM origin. That catches the failure that
actually happens (a truncated download or an HTML error page saved as .tif), which a size check
alone does not.

Usage
  python tools/geodata/fetch_bvv.py                     # DGM1 for the core
  python tools/geodata/fetch_bvv.py --product lod2
  python tools/geodata/fetch_bvv.py --metalink 09780139 # verify against published hashes
  python tools/geodata/fetch_bvv.py --dry-run           # list tiles and total size, download none
"""

from __future__ import annotations

import argparse
import hashlib
import io
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from aoi import Tier, bbox_wsen, cache_dir, load_aoi
from utm import bbox_to_utm32

# Both mirrors serve identical content. Alternating between them on retry is the documented way to
# get past a single node having a bad day, and costs nothing when the first one works.
MIRRORS = ("https://download1.bayernwolke.de", "https://download2.bayernwolke.de")
METALINK_BASE = "https://geodaten.bayern.de/odd"

TILE_KM = 1  # DGM1 and DOP20 tile edge, in kilometres
USER_AGENT = "Gleitschirm-Insights/0.1 (open geodata pipeline; +https://geodaten.bayern.de)"


@dataclass(frozen=True)
class Product:
    """One LDBV product: where its tiles live, and how big a tile is."""

    #: Path segment under the mirror root, e.g. "a/dgm/dgm1".
    path: str
    #: Path segment under the Metalink base, e.g. "a/dgm/dgm1/meta/metalink".
    metalink: str
    #: Tile edge length in kilometres. LoD2 ships in 2 km squares, the rasters in 1 km.
    tile_km: int
    suffix: str


PRODUCTS: dict[str, Product] = {
    "dgm1": Product("a/dgm/dgm1", "a/dgm/dgm1/meta/metalink", 1, ".tif"),
    "dop20": Product("a/dop20", "a/dop20/meta/metalink", 1, ".tif"),
    "lod2": Product("a/lod2/citygml", "a/lod2/citygml/meta/metalink", 2, ".gml"),
}


def tile_grid(cfg: dict, tier: Tier, tile_km: int) -> list[tuple[int, int]]:
    """Every tile whose square intersects the AOI envelope, as (easting_km, northing_km).

    The geographic bbox is projected corner-by-corner first: a lat/lon rectangle is not a rectangle
    in UTM, so its projected envelope bows outward and taking only the SW/NE corners would leave
    slivers of the AOI uncovered.
    """
    west, south, east, north = bbox_wsen(cfg, tier)
    min_e, min_n, max_e, max_n = bbox_to_utm32(west, south, east, north)

    step = tile_km * 1000
    e0 = int(min_e // step) * tile_km
    e1 = int(max_e // step) * tile_km
    n0 = int(min_n // step) * tile_km
    n1 = int(max_n // step) * tile_km
    return [
        (e, n)
        for e in range(e0, e1 + 1, tile_km)
        for n in range(n0, n1 + 1, tile_km)
    ]


def fetch_metalink(product: Product, ags: str) -> dict[str, tuple[int, str]]:
    """Return {filename: (size_bytes, sha256)} from a municipality's Metalink catalogue."""
    url = f"{METALINK_BASE}/{product.metalink}/{ags}.meta4"
    print(f"metalink: {url}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        tree = ET.fromstring(response.read())

    # Metalink 4 puts everything in one namespace; matching on the local name keeps this working
    # if the service ever revises the namespace URI.
    def local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    catalogue: dict[str, tuple[int, str]] = {}
    for element in tree.iter():
        if local(element.tag) != "file":
            continue
        name = element.get("name")
        if not name:
            continue
        size = 0
        digest = ""
        for child in element:
            if local(child.tag) == "size" and child.text:
                size = int(child.text)
            elif local(child.tag) == "hash" and child.get("type") == "sha-256" and child.text:
                digest = child.text.strip().lower()
        catalogue[Path(name).name] = (size, digest)
    print(f"  {len(catalogue)} tiles catalogued, {sum(1 for v in catalogue.values() if v[1])} with hashes")
    return catalogue


def download(url: str, timeout: int = 300) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def verify_raster(blob: bytes, easting_km: int, northing_km: int, tile_km: int) -> str | None:
    """Structural check on a downloaded raster tile. Returns an error string, or None if sound.

    ⚠️ This is not decoration. The failure that actually happens in practice is not corruption but
    substitution: a mirror answers a missing tile with an HTML error page, and a naive fetcher
    saves it as `600_5250.tif` and moves on. The mosaic then has a silent hole. Opening the tile
    and checking that it is a float32 raster, the right size, at the right UTM origin, catches
    that at download time instead of three steps later.
    """
    try:
        image = Image.open(io.BytesIO(blob))
    except Exception as exc:  # noqa: BLE001 — any decode failure means the same thing here
        return f"not a readable raster ({exc})"

    if image.mode != "F":
        return f"expected float32 samples, got mode {image.mode}"

    # ⚠️ Edge tiles are CLIPPED TO THE STATE BOUNDARY and are legitimately smaller than a full
    # square: 604_5245 on the Austrian border is 936 x 1000 px, not 1000 x 1000. So the size is
    # bounded, not fixed. Requiring an exact square rejected a perfectly good tile and would have
    # left a 218 m strip missing from the eastern edge of the AOI.
    expected_px = tile_km * 1000
    width, height = image.size
    if not (0 < width <= expected_px and 0 < height <= expected_px):
        return f"expected at most {expected_px}x{expected_px} px, got {width}x{height}"

    # Tag 33922 is the model tiepoint: (i, j, k, x, y, z). For a north-up tile the raster origin
    # maps to the NORTH-WEST corner, so the northing is the tile's north edge.
    tiepoint = image.tag_v2.get(33922)
    if not tiepoint or len(tiepoint) < 6:
        return "no model tiepoint — the tile is not georeferenced"

    origin_e, origin_n = float(tiepoint[3]), float(tiepoint[4])
    want_e = easting_km * 1000
    want_n = (northing_km + tile_km) * 1000
    span = tile_km * 1000

    # ⚠️ **A clipped tile does not necessarily keep its nominal origin**, and assuming it does cost
    # the second AOI a tile. This check used to require the tiepoint to equal the filename's corner
    # to within a metre, on the reasoning that border tiles lose cells off the east or south edge
    # and so keep their north-west corner. That is true at Oberstdorf. It is false at Tegelberg:
    # `631_5264` sits on the Austrian border and is clipped from the WEST, so it is georeferenced at
    # 631693 — 693 m east of where its name implies — and the fetcher rejected a perfectly good
    # tile, taking the whole pipeline run down with it.
    #
    # The honest rule is that the tiepoint must lie inside the square the filename names, and the
    # raster must not run past it. Placement is by tiepoint anyway (`build_terrain.py` reads tag
    # 33922 and never parses a filename), so a shifted origin is information rather than a problem.
    if not (want_e - 1 <= origin_e <= want_e + span + 1):
        return f"georeferenced at {origin_e:.0f} E, outside the {easting_km} km square"
    if not (want_n - span - 1 <= origin_n <= want_n + 1):
        return f"georeferenced at {origin_n:.0f} N, outside the {northing_km} km square"

    resolution = span / expected_px
    if origin_e + width * resolution > want_e + span + 1:
        return f"raster runs {origin_e + width * resolution - want_e - span:.0f} m past the east edge"
    if origin_n - height * resolution < want_n - span - 1:
        return f"raster runs {want_n - span - (origin_n - height * resolution):.0f} m past the south edge"

    return None


def fetch_tile(
    product: Product,
    easting_km: int,
    northing_km: int,
    destination: Path,
    catalogue: dict[str, tuple[int, str]],
    attempts: int = 3,
) -> tuple[bool, str]:
    """Download one tile, verify it, and write it. Returns (downloaded, note)."""
    name = f"{easting_km}_{northing_km}{product.suffix}"
    target = destination / name
    if target.exists() and target.stat().st_size > 0:
        return False, "cached"

    expected_size, expected_hash = catalogue.get(name, (0, ""))
    last_error = "no attempt made"

    for attempt in range(attempts):
        mirror = MIRRORS[attempt % len(MIRRORS)]
        url = f"{mirror}/{product.path}/{name}"
        try:
            blob = download(url)
        except urllib.error.HTTPError as exc:
            # 404 means this square is genuinely outside Bavaria — the AOI envelope is a rectangle
            # and the state border is not. That is expected at the edges and is not an error.
            if exc.code == 404:
                return False, "not published (outside coverage)"
            last_error = f"HTTP {exc.code}"
        except Exception as exc:  # noqa: BLE001
            last_error = str(exc)
        else:
            if expected_size and len(blob) != expected_size:
                last_error = f"size {len(blob)} != catalogued {expected_size}"
            elif expected_hash and hashlib.sha256(blob).hexdigest() != expected_hash:
                last_error = "sha-256 mismatch"
            else:
                problem = (
                    verify_raster(blob, easting_km, northing_km, product.tile_km)
                    if product.suffix == ".tif"
                    else None
                )
                if problem:
                    last_error = problem
                else:
                    target.write_bytes(blob)
                    verified = "sha-256" if expected_hash else "structure"
                    return True, f"{len(blob) / 1e6:.1f} MB, {verified} ok"

        if attempt < attempts - 1:
            time.sleep(1.5 * (attempt + 1))

    return False, f"FAILED after {attempts} attempts: {last_error}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument("--product", default="dgm1", choices=sorted(PRODUCTS))
    parser.add_argument("--tier", default="core", choices=["core", "shell"])
    parser.add_argument(
        "--metalink",
        default=None,
        metavar="AGS",
        help="municipality key, to verify tiles against published SHA-256 hashes",
    )
    parser.add_argument("--dry-run", action="store_true", help="list the tiles and stop")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    product = PRODUCTS[args.product]

    if args.tier == "shell" and args.product != "dgm1":
        parser.error("the shell tier is terrain only — use fetch_copdem.py")

    tiles = tile_grid(cfg, args.tier, product.tile_km)
    print(f"AOI {cfg['id']} / {args.tier}: {len(tiles)} {args.product} tiles of {product.tile_km} km")

    if args.dry_run:
        for easting_km, northing_km in tiles:
            print(f"  {MIRRORS[0]}/{product.path}/{easting_km}_{northing_km}{product.suffix}")
        return

    catalogue: dict[str, tuple[int, str]] = {}
    if args.metalink:
        try:
            catalogue = fetch_metalink(product, args.metalink)
        except Exception as exc:  # noqa: BLE001
            # An unusable catalogue must not stop the download — the structural check still runs,
            # and a wrong AGS is a known open question rather than a fault.
            print(f"  metalink unavailable ({exc}) — falling back to structural verification")

    destination = cache_dir(args.product, cfg["id"] if args.tier == "core" else f"{cfg['id']}-shell")
    downloaded = cached = missing = failed = 0
    started = time.time()

    for index, (easting_km, northing_km) in enumerate(tiles, start=1):
        did_download, note = fetch_tile(product, easting_km, northing_km, destination, catalogue)
        if did_download:
            downloaded += 1
        elif note == "cached":
            cached += 1
        elif note.startswith("FAILED"):
            failed += 1
            print(f"  [{index}/{len(tiles)}] {easting_km}_{northing_km}: {note}")
        else:
            missing += 1

        if did_download and (downloaded % 10 == 0 or index == len(tiles)):
            elapsed = time.time() - started
            print(f"  [{index}/{len(tiles)}] {downloaded} downloaded, {elapsed:.0f}s elapsed")

    print(
        f"\n{args.product}: {downloaded} downloaded, {cached} already cached, "
        f"{missing} outside coverage, {failed} failed"
    )
    print(f"  -> {destination}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()

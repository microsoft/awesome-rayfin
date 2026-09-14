"""Download Hamburg (LGV) survey tiles for an AOI tier — PLAN §37.

The **fourth** geobasis authority, added for Universität Hamburg (6th nationally, 42 193 students)
— the last of the top ten that this project can reach without a new kind of data source.

Hamburg is shaped differently from every state before it, and the difference is the whole reason
this file exists:

**IT PUBLISHES ONE ARCHIVE PER PRODUCT FOR THE WHOLE CITY.** There is no per-tile download. Taken
at face value a 1.5 km campus box costs **3.08 GB** of elevation and **468 MB** of buildings —
roughly 300x what the identical job costs in Nordrhein-Westfalen, for a box covering well under one
per cent of the download.

**SO THE ARCHIVES ARE READ IN PLACE, OVER HTTP RANGE REQUESTS.** A ZIP keeps its index at the END
of the file, and `archiv.transparenz.hamburg.de` honours `Range` (verified: `Accept-Ranges: bytes`,
206 responses). `RemoteZip` below gives `zipfile` a seekable file-like object backed by ranged GETs,
so the central directory arrives in **~90 KB** and only the AOI's own square kilometres are ever
transferred. Measured: 914 DGM1 members indexed with 0.09 MB, 788 LoD2 members with 0.07 MB.
Hamburg is now as cheap as NRW.

**⚠️ THE FILE EXTENSIONS DESCRIBE THE CONTENT, NOT THE CONTAINER.** The elevation archive is named
`…snap_1.ASCII` and the building archive `…snap_1.GML`. Both are ZIPs. Taking the names literally is
how you conclude that a 468 MB single XML has to be downloaded whole — it does not, it holds 788
per-tile CityGML files.

**⚠️ THE PORTAL ADVERTISES DEAD DOWNLOAD PATHS.** Everything under
`daten-hamburg.de/…/Digitales_Hoehenmodell/DGM1/` 404s on a real GET, not just on HEAD. The working
copies are on the ARCHIVE host. Likewise the DOP services: five `HH_WMS_DOP*` names are published
and all five are gone (see `fetch_dop20_hamburg.py`).

**⚠️ AND THE DATASET IS TITLED "DGM 1", WITH A SPACE.** Searching the catalogue for "DGM1" returns
the *Schummerung* — a 510 MB hillshade GeoTIFF, which is a rendered PICTURE of terrain rather than
elevations, and is very easy to accept by mistake.

Usage
  python tools/geodata/fetch_hamburg.py --aoi hamburg
  python tools/geodata/fetch_hamburg.py --aoi hamburg --product lod2
  python tools/geodata/fetch_hamburg.py --aoi hamburg --dry-run
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

from aoi import Tier, bbox_wsen, cache_dir, load_aoi
from fetch_lgl_bw import xyz_to_geotiff
from utm import bbox_to_utm32

ARCHIVE = "https://archiv.transparenz.hamburg.de/hmbtgarchive/HMDK/"
USER_AGENT = "Campus-Scheduler/0.1 (open geodata pipeline; +https://transparenz.hamburg.de)"

ATTRIBUTION = "Datenquelle: Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV), dl-de/by-2-0"

#: Tiles inside both archives are 1 km squares, despite the elevation archive's name saying 2x2 km.
CELL_KM = 1


@dataclass(frozen=True)
class Product:
    """One Hamburg archive: where it lives, what to keep out of it, and what to write."""

    archive: str
    suffix: str
    out_suffix: str
    xyz_to_tiff: bool = False


PRODUCTS: dict[str, Product] = {
    # ⚠️ The 2021 archive contains a folder dated 2020-03-29 — Hamburg names the archive for its
    # publication date and the data inside for its survey date. The elevations are 2020.
    "dgm1": Product(
        "dgm1_2x2km_xyz_hh_2021_04_01_107300_snap_1.ASCII", ".xyz", ".tif", xyz_to_tiff=True
    ),
    # ⚠️ 2016 vintage — the newest LoD2 Hamburg publishes openly. Buildings finished since then are
    # missing, which matters for HafenCity and is worth saying out loud rather than discovering.
    "lod2": Product("lod2-de_hh_2016-11-22_21283_snap_1.GML", ".xml", ".gml"),
}

#: ⚠️ TOLERATES BOTH NAMINGS, AND HAMBURG NEEDS IT. Elevation members carry the UTM zone
#: (`dgm1_32_548_5934_1_hh.xyz`); building members DO NOT (`LoD2_466_5974_1_HH.xml`). Every other
#: state in this repo writes the zone in both. Parsing the coordinates out of the published name —
#: rather than rebuilding the name from coordinates — means neither convention has to be special.
TILE_RE = re.compile(r"_(?:32_)?(\d{3})_(\d{4})_1_", re.IGNORECASE)


def cells_for(bbox_utm: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """Every 1 km tile whose square intersects the bounding box."""
    min_e, min_n, max_e, max_n = bbox_utm
    return [
        (e, n)
        for e in range(int(min_e // 1000), int(max_e // 1000) + 1, CELL_KM)
        for n in range(int(min_n // 1000), int(max_n // 1000) + 1, CELL_KM)
    ]


class RemoteZip(io.RawIOBase):
    """A seekable file-like view of a remote ZIP, backed by HTTP Range requests.

    `zipfile` only ever needs to seek to the end for the central directory and then to each member
    it is asked for, so handing it this instead of a local file turns a 3 GB download into a few
    megabytes. It counts what it transfers so the caller can report the saving honestly.
    """

    def __init__(self, url: str) -> None:
        self.url = url
        self.pos = 0
        self.fetched = 0
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="HEAD")
        with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310
            self.length = int(response.headers.get("Content-Length") or 0)
            if "bytes" not in (response.headers.get("Accept-Ranges") or ""):
                raise SystemExit(
                    f"{url}: the host does not advertise Range support, so the archive would have "
                    "to be downloaded whole. Refusing rather than pulling gigabytes silently."
                )

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        else:
            self.pos = self.length + offset
        return self.pos

    def tell(self) -> int:
        return self.pos

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def read(self, size: int = -1) -> bytes:  # type: ignore[override]
        if size < 0:
            size = self.length - self.pos
        if size <= 0:
            return b""
        end = min(self.pos + size, self.length) - 1
        blob = _ranged(self.url, self.pos, end)
        self.pos += len(blob)
        self.fetched += len(blob)
        return blob


def _ranged(url: str, start: int, end: int, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                url, headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{end}"}
            )
            with urllib.request.urlopen(request, timeout=600) as response:  # noqa: S310
                return response.read()
        except Exception as exc:  # noqa: BLE001 - network, retried below
            last = exc
        wait = 4 * (attempt + 1)
        print(f"    retrying range {start}-{end} in {wait}s ({last})")
        time.sleep(wait)
    raise RuntimeError(f"{url} [{start}-{end}]: {last}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="hamburg")
    parser.add_argument("--product", default="dgm1", choices=sorted(PRODUCTS))
    parser.add_argument("--tier", default="core", choices=("core", "shell"))
    parser.add_argument("--dry-run", action="store_true", help="list the tiles, transfer nothing")
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

    url = ARCHIVE + product.archive
    remote = RemoteZip(url)
    archive = zipfile.ZipFile(remote)
    index_bytes = remote.fetched
    print(f"  archive {remote.length / 1e9:.2f} GB, indexed with {index_bytes / 1e6:.2f} MB")

    wanted: dict[tuple[int, int], zipfile.ZipInfo] = {}
    for info in archive.infolist():
        if info.is_dir() or not info.filename.lower().endswith(product.suffix):
            continue
        match = TILE_RE.search(Path(info.filename).name)
        if match:
            wanted[(int(match.group(1)), int(match.group(2)))] = info

    have = [(cell, wanted[cell]) for cell in cells if cell in wanted]
    missing = [cell for cell in cells if cell not in wanted]
    stored = sum(info.compress_size for _, info in have)
    print(
        f"  {len(have)} of {len(cells)} tiles published, {stored / 1e6:.1f} MB to transfer "
        f"(the whole archive is {remote.length / 1e9:.2f} GB)"
    )
    if missing:
        # Hamburg is a city state: a shell box reaches Schleswig-Holstein and Niedersachsen, where
        # the LGV publishes nothing. That is a fact about Hamburg, not a failure.
        print(f"  outside Hamburg: {missing[:8]}{' …' if len(missing) > 8 else ''}")

    if args.dry_run:
        for cell, info in have[:20]:
            print(f"    {cell[0]} {cell[1]}  {Path(info.filename).name}  {info.compress_size / 1e6:.2f} MB")
        return

    written = 0
    for index, (cell, info) in enumerate(have, start=1):
        leaf = Path(info.filename).name
        target = out_dir / (Path(leaf).stem + product.out_suffix)
        if target.exists() and target.stat().st_size > 0:
            continue
        print(f"  [{index}/{len(have)}] {leaf} ({info.compress_size / 1e6:.2f} MB)")
        payload = archive.read(info)
        if product.xyz_to_tiff:
            xyz_to_geotiff(payload, target)
        else:
            target.write_bytes(payload)
        written += 1

    print(
        f"\n{written} new files in {out_dir} ({len(have)} tiles). "
        f"Transferred {remote.fetched / 1e6:.1f} MB instead of {remote.length / 1e9:.2f} GB."
    )
    print(ATTRIBUTION)


if __name__ == "__main__":
    sys.exit(main())

"""Fetch LVermGeo Schleswig-Holstein tiles for the AOI: terrain, surface model, buildings, photos.

PLAN §5. All four products are open under CC BY 4.0 and are published through the same download
client, which turned out to expose two entirely different machine-readable routes:

  1. `_ajax/overview.php?bbox[]=…&type[]=…` — a bbox query, one request per window.
  2. `single.php?file=<PRODUCT>_Massendownload.geojson&id=4` — a statewide catalogue, one request
     for everything, and **it carries the download URL for each tile directly**.

🔴 **This fetcher uses route 2, and the reason matters.** Route 1 throttles: a sequence of window
queries that had just returned 176 tiles began returning `{"success": true, "features": []}` —
success, with nothing in it. Route 2 is a single 9 MB download that is then filtered offline, so
there is no way to be throttled into silently believing the AOI is empty.

⚠️ The catalogue's `id=4` is not decorative. `single.php` without it answers HTTP 200 with a single
newline, which looks like an empty product rather than a missing parameter.

⚠️ **A downloaded .xyz has the website's HTML footer appended to it.** A tile is 1 000 000 points
followed by 32 lines of markup. Anything parsing these files must skip lines that are not three
numbers — see build_terrain.py.

Cache layout (all gitignored, safe to delete, re-downloadable at any time):
  data/lvermgeo/<product>_catalogue.geojson
  data/lvermgeo/<product>/<tile filename>

Usage
  python tools/geodata/fetch_lvermgeo.py --product dgm1
  python tools/geodata/fetch_lvermgeo.py --product dgm1 --dry-run
  python tools/geodata/fetch_lvermgeo.py --product lod2 --tier core
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from aoi import bbox_wsen, cache_dir, load_aoi
from utm import bbox_to_utm32

BASE = "https://geodaten.schleswig-holstein.de/gaialight-sh/_apps/dladownload"
USER_AGENT = "Maritime-Insights/0.1 (open geodata pipeline; CC BY 4.0 LVermGeo SH)"
CONTEXT = ssl.create_default_context()

#: Catalogue file names, read off each product's own download page rather than guessed. Note the
#: inconsistent double underscore in two of them — it is in the source, not a typo here.
CATALOGUES = {
    "dgm1": "DGM1_SH__Massendownload.geojson",
    "bdom": "bDOM_SH_Massendownload.geojson",
    "dop20": "DOP20_SH__Massendownload.geojson",
    "lod2": "LOD2_SH_Massendownload.geojson",
}

#: Tiles are 1 km squares named …_32_<easting km>_<northing km>_… in every product.
TILE_RE = re.compile(r"_32_(\d{3})_(\d{4})_")
TILE_M = 1000

#: Smallest plausible tile. A DGM1 .xyz is ~27-28 MB and the smallest LoD2 XML seen is a few
#: hundred kilobytes; anything under this is an error page or a truncated read wearing a tile's
#: filename. Deliberately generous — it is a floor against nonsense, not a size assertion.
MIN_TILE_BYTES = 50_000


def fetch(url: str, timeout: int = 300, attempts: int = 4) -> bytes:
    """Fetch a whole resource, retrying transport failures.

    🔴 `http.client.IncompleteRead` is NOT an `OSError`, so an earlier version of this catch list
    let a truncated chunked response kill a 5.6 GB download at tile 205 of 206. The server sent a
    Content-Length it then failed to honour; that is a transport failure like any other and
    deserves a retry, not a traceback.
    """
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                url, headers={"User-Agent": USER_AGENT, "Referer": f"{BASE}/dl-dgm1.html"}
            )
            with urllib.request.urlopen(request, timeout=timeout, context=CONTEXT) as response:
                blob = response.read()
            declared = response.headers.get("Content-Length")
            if declared and len(blob) != int(declared):
                raise http.client.IncompleteRead(blob, int(declared) - len(blob))
            return blob
        except (urllib.error.URLError, OSError, http.client.HTTPException) as exc:
            last = exc
            wait = 5 * (attempt + 1)
            print(f"    attempt {attempt + 1} failed ({type(exc).__name__}: {exc}) "
                  f"— retrying in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"failed after {attempts} attempts: {url} :: {last}")


def write_atomic(path: Path, blob: bytes) -> None:
    """Write via a temporary name and rename.

    A tile file that exists is treated as done by the next run, so a half-written one is worse
    than a missing one — it survives the retry and only surfaces much later as a parse error, or
    not at all.
    """
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_bytes(blob)
    os.replace(tmp, path)


def catalogue(product: str, force: bool = False) -> list[dict]:
    path = cache_dir("lvermgeo") / f"{product}_catalogue.geojson"
    if force or not path.exists():
        url = f"{BASE}/single.php?file={CATALOGUES[product]}&id=4"
        print(f"  catalogue: {url}")
        blob = fetch(url)
        # An empty answer here means the id was dropped or the product renamed — never a state
        # with no tiles. Fail loudly rather than caching a valid-looking empty file.
        if len(blob) < 10_000:
            raise RuntimeError(
                f"catalogue for '{product}' came back at {len(blob)} bytes — refusing to cache it"
            )
        path.write_bytes(blob)
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    print(f"  catalogue: {len(features)} tiles statewide ({path.stat().st_size / 1e6:.1f} MB)")
    return features


def tile_origin(link: str) -> tuple[int, int] | None:
    """South-west corner of a tile, in metres, parsed from its filename."""
    match = TILE_RE.search(link)
    if not match:
        return None
    return int(match.group(1)) * 1000, int(match.group(2)) * 1000


# ⚠️ The four catalogues do not agree on their own property names: dgm1/bdom/dop20 use
# `link_data` and `kachel`, LoD2 uses `data_link` and `id`. This is the same inconsistency the
# bbox index shows (`kaname` vs `kachel_n`), and it is why nothing here indexes a fixed key.
def link_of(feature: dict) -> str:
    props = feature["properties"]
    for key in ("link_data", "data_link", "link", "url"):
        if key in props:
            return props[key]
    raise KeyError(f"no download link in catalogue entry: {sorted(props)}")


def label_of(feature: dict) -> str:
    props = feature["properties"]
    return str(props.get("kachel") or props.get("id") or "?")


def filename_of(feature: dict) -> str:
    return link_of(feature).split("file=")[1].split("&")[0]


def select(features: list[dict], e0: float, n0: float, e1: float, n1: float) -> list[dict]:
    """Tiles whose 1 km square intersects the window. Newest wins where a tile repeats."""
    chosen: dict[tuple[int, int], dict] = {}
    unparsed = 0
    for feature in features:
        link = link_of(feature)
        origin = tile_origin(link)
        if origin is None:
            unparsed += 1
            continue
        te, tn = origin
        if te + TILE_M <= e0 or te >= e1 or tn + TILE_M <= n0 or tn >= n1:
            continue
        # ⚠️ The statewide catalogue holds several acquisition years for the same square — the
        # first DGM1 entry in the file is from 2005. Taking whatever comes first would mix a
        # twenty-year span into one terrain model.
        previous = chosen.get(origin)
        if previous is None or feature["properties"]["datum"] > previous["properties"]["datum"]:
            chosen[origin] = feature
    if unparsed:
        print(f"  ⚠️ {unparsed} catalogue entries had no parsable tile name and were skipped")
    return [chosen[key] for key in sorted(chosen)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--product", default="dgm1", choices=sorted(CATALOGUES))
    parser.add_argument("--tier", default="core", choices=("core", "shell"))
    parser.add_argument("--dry-run", action="store_true", help="list the tiles, download nothing")
    parser.add_argument("--force-catalogue", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="stop after N downloads (for a probe)")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    west, south, east, north = bbox_wsen(cfg, args.tier)
    # ⚠️ Use the envelope helper, not four hand-rolled calls to wgs84_to_utm32 — it takes
    # (lon, lat) and the first draft here passed (lat, lon). That does not raise; it returns
    # plausible-looking six-digit numbers in the wrong places, and the only symptom was
    # "0 tiles intersect the window" for an AOI that has hundreds.
    e0, n0, e1, n1 = bbox_to_utm32(west, south, east, north)
    print(f"AOI {cfg['id']} [{args.tier}] → UTM32 {e0:.0f} {n0:.0f} .. {e1:.0f} {n1:.0f} "
          f"({(e1 - e0) / 1000:.2f} x {(n1 - n0) / 1000:.2f} km)")

    features = catalogue(args.product, force=args.force_catalogue)
    wanted = select(features, e0, n0, e1, n1)
    years = sorted({f["properties"]["datum"][:4] for f in wanted})
    print(f"  {len(wanted)} tiles intersect the window, acquisition years {years}")

    out = cache_dir("lvermgeo", args.product)
    have = sum(1 for f in wanted if (out / filename_of(f)).exists())
    print(f"  {have} already cached, {len(wanted) - have} to fetch → {out}")

    if args.dry_run:
        for feature in wanted[:10]:
            print(f"    {label_of(feature)}  {feature['properties']['datum']}  "
                  f"{filename_of(feature)}")
        if len(wanted) > 10:
            print(f"    … and {len(wanted) - 10} more")
        return

    total = 0
    fetched = 0
    unavailable: list[str] = []
    started = time.time()
    for index, feature in enumerate(wanted, 1):
        name = filename_of(feature)
        path = out / name
        if path.exists() and path.stat().st_size > 0:
            total += path.stat().st_size
            continue
        blob = fetch(link_of(feature))
        if len(blob) < MIN_TILE_BYTES:
            # 🔴 The catalogue lists tiles the server does not serve: dgm1_32_581_6034_1_sh_2006
            # answers 962 bytes. Skipping is right, but silently skipping is not — a hole in the
            # terrain has to reach the coverage gate in build_terrain.py, not disappear here.
            print(f"  [{index:>4}/{len(wanted)}] {name}  UNAVAILABLE ({len(blob)} bytes) — skipped")
            unavailable.append(name)
            continue
        write_atomic(path, blob)
        total += len(blob)
        fetched += 1
        rate = total / max(time.time() - started, 0.001) / 1e6
        print(f"  [{index:>4}/{len(wanted)}] {name}  {len(blob) / 1e6:.1f} MB  "
              f"({total / 1e6:.0f} MB, {rate:.1f} MB/s)")
        if args.limit and fetched >= args.limit:
            print(f"  stopping at --limit {args.limit}")
            break

    print(f"\n{fetched} tiles downloaded, {total / 1e6:.0f} MB on disk in {out}")
    if unavailable:
        print(f"⚠️ {len(unavailable)} catalogued tiles were not served: "
              f"{', '.join(unavailable)}")
    print("Attribution: Landesamt für Vermessung und Geoinformation Schleswig-Holstein, "
          "CC BY 4.0 [Daten bearbeitet]")


if __name__ == "__main__":
    sys.exit(main())

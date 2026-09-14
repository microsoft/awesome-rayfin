"""Download the Bavarian single-tree cadastre region covering an AOI.

PLAN §5.1, §7 phase 1 step 8. `einzelbaeume` is a LiDAR-derived point per tree, carrying its
position, the ground height under it and its own height. It is published as one GeoPackage per
region — the Allgäu region is 344 MB, which is why this is a separate, cached step.

The region is resolved from the published KML index rather than hard-coded: the index carries a
polygon and a download link per region, so the one containing the AOI can be found rather than
guessed.

Output (into data/trees/<aoi-id>/):
  <region>_baeume.gpkg   as published, unmodified

Usage
  python tools/geodata/fetch_trees.py
  python tools/geodata/fetch_trees.py --list
"""

from __future__ import annotations

import argparse
import re
import urllib.request
from pathlib import Path

from aoi import bbox_wsen, cache_dir, load_aoi

KML_INDEX = "https://geodaten.bayern.de/odd/m/8/baeume3d/kml/Einzelbaumstandorte.kml?service=kml"
USER_AGENT = "Gleitschirm-Insights/0.1 (open geodata pipeline)"

GPKG_URL = re.compile(r"(https://geodaten\.bayern\.de/odd/m/8/baeume3d/data/\d+_baeume\.gpkg)")


def regions() -> list[dict]:
    """Every published region, with its outline and download link."""
    request = urllib.request.Request(KML_INDEX, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        kml = response.read().decode("utf-8", errors="replace")

    found: list[dict] = []
    # ⚠️ `<Placemark[^>]*>`, not `<Placemark>`. Every placemark in this file carries an id
    # attribute, and matching the bare tag silently finds nothing at all.
    for block in re.findall(r"<Placemark[^>]*>(.*?)</Placemark>", kml, flags=re.S):
        name = re.search(r"<name>(.*?)</name>", block, flags=re.S)
        coordinates = re.search(r"<coordinates>(.*?)</coordinates>", block, flags=re.S)
        url = GPKG_URL.search(block)
        if not (name and coordinates and url):
            continue

        points = []
        for token in coordinates.group(1).split():
            parts = token.split(",")
            if len(parts) >= 2:
                points.append((float(parts[0]), float(parts[1])))
        if len(points) < 3:
            continue

        lons = [p[0] for p in points]
        lats = [p[1] for p in points]
        found.append(
            {
                "name": name.group(1).strip(),
                "url": url.group(1),
                "west": min(lons),
                "east": max(lons),
                "south": min(lats),
                "north": max(lats),
            }
        )
    return found


def covering(area: list[dict], west: float, south: float, east: float, north: float) -> list[dict]:
    """Regions whose outline overlaps the AOI at all."""
    return [
        region
        for region in area
        if not (region["east"] < west or region["west"] > east or region["north"] < south or region["south"] > north)
    ]


def download(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=1800) as response:
        total = int(response.headers.get("Content-Length", 0))
        written = 0
        # Streamed to a temporary name and moved on success, so an interrupted download can never
        # be mistaken for a complete one by the next run.
        partial = target.with_suffix(".partial")
        with partial.open("wb") as handle:
            while chunk := response.read(1 << 20):
                handle.write(chunk)
                written += len(chunk)
                if total and written % (32 << 20) < (1 << 20):
                    print(f"  {written / 1e6:.0f} / {total / 1e6:.0f} MB")
        if total and written != total:
            partial.unlink(missing_ok=True)
            raise RuntimeError(f"got {written} bytes, expected {total}")
        partial.replace(target)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oth-regensburg")
    parser.add_argument("--list", action="store_true", help="list every published region and stop")
    args = parser.parse_args()

    published = regions()
    if args.list:
        for region in sorted(published, key=lambda r: r["name"]):
            print(f"  {region['name']:<40} {region['west']:.3f}..{region['east']:.3f} E  {region['south']:.3f}..{region['north']:.3f} N")
        return

    cfg = load_aoi(args.aoi)
    west, south, east, north = bbox_wsen(cfg, "core")
    matches = covering(published, west, south, east, north)
    if not matches:
        raise SystemExit(f"no tree region covers the AOI ({west}..{east} E, {south}..{north} N)")

    print(f"{len(published)} regions published, {len(matches)} overlap the AOI:")
    for region in matches:
        print(f"  {region['name']}")

    destination = cache_dir("trees", cfg["id"])
    for region in matches:
        target = destination / Path(region["url"]).name
        if target.exists() and target.stat().st_size > 0:
            print(f"cached: {target.name} ({target.stat().st_size / 1e6:.0f} MB)")
            continue
        print(f"downloading {region['url']}")
        download(region["url"], target)
        print(f"  -> {target} ({target.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()

"""Download indoor room geometry from OpenStreetMap.

PLAN Phase 2, step 1. This is the layer that makes exploding buildings possible: volunteers have
mapped individual rooms inside the Garching buildings using Simple Indoor Tagging, so the polygons
are real surveyed outlines rather than something this project invented.

⚠️ **The join key is `ref:tum`.** Rooms carry the official TUM room code (e.g. `5606.EG.041`) in
that tag, which is exactly the identifier NavigaTUM uses. Measured 2026-07-30: 2 804 rooms in the
Garching bbox carry one, on roughly two thirds of all mapped indoor rooms. Rooms without it are
kept — they are usually corridors, stairs and lavatories, which matter for how a floor plan reads
even though nothing can be joined to them.

⚠️ **The query MUST be split.** A single `nwr[indoor=room]` over this bbox returns HTTP 504 from
every Overpass mirror, every time. Split into quadrants it succeeds in seconds. Retrying the
over-large query instead of splitting it wastes several minutes and is rude to a donation-funded
service.

Output (data/raw/osm/<aoi>/):
  indoor.json   raw Overpass elements, with geometry, exactly as returned

Usage
  python tools/geodata/fetch_osm_indoor.py --aoi garching
"""

from __future__ import annotations

import argparse
import json
import time

from aoi import bbox_tuple, cache_dir, load_aoi
from overpass_client import overpass


def quadrants(
    south: float, west: float, north: float, east: float, splits: int
) -> list[tuple[float, float, float, float]]:
    """The bbox cut into `splits` x `splits` tiles."""
    boxes = []
    for row in range(splits):
        for col in range(splits):
            boxes.append(
                (
                    south + (north - south) * row / splits,
                    west + (east - west) * col / splits,
                    south + (north - south) * (row + 1) / splits,
                    west + (east - west) * (col + 1) / splits,
                )
            )
    return boxes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="garching")
    parser.add_argument(
        "--splits",
        type=int,
        default=2,
        help="cut the bbox into N x N queries; raise it if Overpass returns 504",
    )
    parser.add_argument("--force", action="store_true", help="re-query instead of using the cache")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    rooms_cfg = cfg.get("rooms")
    if not rooms_cfg:
        print(f"AOI '{cfg['id']}' declares no `rooms` block — nothing to fetch.")
        print("That is a statement about the site, not a failure: no indoor data exists here.")
        return

    out_path = cache_dir("raw", "osm", cfg["id"]) / "indoor.json"
    if out_path.exists() and not args.force:
        cached = json.loads(out_path.read_text(encoding="utf-8"))
        print(f"cached: {out_path} ({len(cached['elements'])} elements, --force to re-query)")
        return

    south, west, north, east = bbox_tuple(cfg, "core")
    boxes = quadrants(south, west, north, east, args.splits)
    print(f"AOI {cfg['id']}: indoor rooms in {len(boxes)} quadrant queries")

    seen: dict[tuple[str, int], dict] = {}
    for index, (s, w, n, e) in enumerate(boxes, start=1):
        # `out geom` rather than `out tags`: the polygon is the point of this step. It inflates the
        # response a lot, which is the other reason the query has to be split.
        query = f'[out:json][timeout:180];nwr["indoor"]({s},{w},{n},{e});out geom;'
        data = overpass(query)
        elements = data.get("elements", [])
        # Quadrant boundaries cut through buildings, so the same room comes back from two queries.
        for element in elements:
            seen[(element["type"], element["id"])] = element
        print(f"  [{index}/{len(boxes)}] {len(elements):>6} elements, {len(seen):>6} unique so far")
        if index < len(boxes):
            time.sleep(2)

    elements = list(seen.values())

    rooms = [e for e in elements if e.get("tags", {}).get("indoor") == "room"]
    ref_key = rooms_cfg.get("osmRefKey", "ref:tum")
    with_ref = [e for e in rooms if ref_key in e.get("tags", {})]
    with_geometry = [e for e in rooms if e.get("geometry") or e.get("members")]

    print(f"\n{len(elements)} indoor elements, of which {len(rooms)} are rooms")
    print(f"  with {ref_key:<9} {len(with_ref):>6}  ({len(with_ref) / max(len(rooms), 1):.0%})")
    print(f"  with geometry    {len(with_geometry):>6}")

    # A regression guard against a silent partial fetch. The AOI config records what a good run
    # looked like; a much smaller result means the query, the mirror or the bbox has changed.
    expected = sum(b["osmRooms"] for b in rooms_cfg.get("exploreBuildings", []))
    if expected and len(with_ref) < expected * 0.8:
        print(
            f"\n⚠️ only {len(with_ref)} rooms carry {ref_key}, but the AOI config records "
            f"{expected} across its explore buildings. Something fetched short."
        )

    out_path.write_text(
        json.dumps({"elements": elements}, ensure_ascii=False), encoding="utf-8"
    )
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"\nwrote {out_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()

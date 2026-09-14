"""Rasterise OpenStreetMap land cover and the transport network onto the terrain grid.

The terrain shader colours the ground by elevation alone, which makes the whole massif read as bare
stone. What it actually looks like is spruce forest on the flanks, Alpine pasture on the valley
floor and the alms, Latschenkiefer above the treeline, and bare rock and scree only on the summits.
This step turns the OSM polygons into a class raster the shader can sample, so the surface tells
you what it is — and so the treeline, which is where a pilot reads the terrain, is visible.

Two rules keep this honest:

  * The raster is *colour only*. Nothing derives a figure from it: no elevation, no statistic, no
    part of the flight analysis reads a single class id.
  * It shows land cover as mapped **today**, which for a flight recorded in 2021 is a caveat the
    app states rather than hides.

Output (public/terrain/<aoi>/)
  landuse_<res>m.u8z  one class id per cell, row 0 = north, matching the heightmap origin,
                      gzipped because a class raster compresses about 27:1. Not named ".gz":
                      some static servers answer that extension with Content-Encoding and inflate
                      it behind your back, others do not, and the two behave differently.
  landuse.json        grid metadata and the class table, under a fixed name so the app can read
                      the raster's filename and resolution from it rather than hard-coding them

Usage
  python tools/geodata/build_landuse.py
  python tools/geodata/build_landuse.py --resolution 4

Licence: OpenStreetMap contributors, ODbL. Attribution is mandatory — see NOTICE.md.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from aoi import load_aoi
from utm import wgs84_to_utm32

# Class ids are baked into the shader's palette, so they are append-only. 0 means "not mapped",
# which falls through to the elevation palette rather than guessing.
UNMAPPED = 0
CLASSES: dict[str, int] = {
    "landuse=vineyard": 1,
    "landuse=orchard": 2,
    "landuse=forest": 3,
    "natural=wood": 3,
    "landuse=farmland": 4,
    "landuse=meadow": 5,
    "landuse=grass": 5,
    "natural=grassland": 5,
    "landuse=village_green": 5,
    "landuse=recreation_ground": 5,
    "leisure=park": 6,
    "leisure=garden": 6,
    "leisure=pitch": 6,
    "leisure=golf_course": 6,
    "landuse=cemetery": 6,
    "landuse=allotments": 7,
    "landuse=greenhouse_horticulture": 7,
    "landuse=residential": 8,
    "landuse=commercial": 9,
    "landuse=retail": 9,
    "landuse=industrial": 9,
    "natural=scrub": 10,
    "natural=heath": 10,
    "natural=water": 11,
    "natural=wetland": 12,
    "natural=bare_rock": 13,
    "natural=scree": 13,
    "landuse=quarry": 13,
}

# Roads and rail sit on top of everything, so they take the highest ids.
ROAD_MAJOR = 20
ROAD_MINOR = 21
TRACK = 22
RAILWAY = 23

# What a road is made of decides how it reads on a hillside, and OpenStreetMap usually knows: an
# asphalt road is darker than almost any ground around it, a gravel farm track is paler than
# almost any. Drawing both in the same grey is what made the network vanish into the terrain.
#
# 58% of the segments here carry a `surface` tag. The rest fall back to the habit of their class,
# which is the same assumption a map reader makes: a `track` is unmade unless told otherwise, a
# residential street is not.
UNPAVED_SURFACES = {
    "ground",
    "dirt",
    "earth",
    "grass",
    "gravel",
    "fine_gravel",
    "compacted",
    "pebblestone",
    "unpaved",
    "sand",
    "mud",
    "woodchips",
    "rock",
}
PAVED_SURFACES = {
    "asphalt",
    "paved",
    "concrete",
    "concrete:plates",
    "paving_stones",
    "sett",
    "cobblestone",
    "metal",
    "wood",
    "chipseal",
}

# Drawn width in metres. A forestry track across a flank is a real part of how the slope looks, so
# it is kept, but thin.
LINE_WIDTH_M: dict[str, tuple[int, float]] = {
    "highway=motorway": (ROAD_MAJOR, 22.0),
    "highway=trunk": (ROAD_MAJOR, 16.0),
    "highway=primary": (ROAD_MAJOR, 13.0),
    "highway=secondary": (ROAD_MAJOR, 11.0),
    "highway=tertiary": (ROAD_MINOR, 9.0),
    "highway=unclassified": (ROAD_MINOR, 7.0),
    "highway=residential": (ROAD_MINOR, 7.0),
    "highway=living_street": (ROAD_MINOR, 6.0),
    "highway=service": (ROAD_MINOR, 4.0),
    "highway=track": (TRACK, 3.5),
    "railway=rail": (RAILWAY, 7.0),
    "railway=light_rail": (RAILWAY, 6.0),
    "railway=narrow_gauge": (RAILWAY, 5.0),
}

# Classes whose surface is assumed unmade when OSM does not say.
UNPAVED_BY_DEFAULT = {"highway=track"}


def surfaced_class(osm_class: str, class_id: int, surface: str | None) -> int:
    """Move a line between the paved and unpaved families according to what it is made of."""
    if class_id == RAILWAY:
        return class_id
    if surface in UNPAVED_SURFACES:
        return TRACK
    if surface in PAVED_SURFACES:
        return ROAD_MINOR if class_id == TRACK else class_id
    return TRACK if osm_class in UNPAVED_BY_DEFAULT else class_id

CLASS_LABELS: dict[int, str] = {
    UNMAPPED: "not mapped",
    1: "vineyard",
    2: "orchard",
    3: "forest",
    4: "farmland",
    5: "meadow and grass",
    6: "park and garden",
    7: "allotments",
    8: "residential",
    9: "commercial and industrial",
    10: "scrub and heath",
    11: "water",
    12: "wetland",
    13: "rock and quarry",
    ROAD_MAJOR: "paved road, major",
    ROAD_MINOR: "paved road, minor",
    TRACK: "unpaved track",
    RAILWAY: "railway",
}


def ring_to_pixels(
    ring: list[list[float]], origin_e: int, top_n: float, resolution: int
) -> list[tuple[float, float]]:
    """Project a lon/lat ring to grid pixel coordinates (x east, y south from the north edge)."""
    pixels = []
    for lon, lat in ring:
        e, n = wgs84_to_utm32(lon, lat)
        pixels.append(((e - origin_e) / resolution, (top_n - n) / resolution))
    return pixels


def ring_area_m2(pixels: list[tuple[float, float]], resolution: int) -> float:
    """Shoelace area, used only to order the painting."""
    if len(pixels) < 3:
        return 0.0
    total = 0.0
    for (x1, y1), (x2, y2) in zip(pixels, pixels[1:] + pixels[:1]):
        total += x1 * y2 - x2 * y1
    return abs(total) * 0.5 * resolution * resolution


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument("--landuse", type=Path, default=None)
    parser.add_argument("--terrain", type=Path, default=Path("public/terrain"))
    parser.add_argument(
        "--resolution",
        type=int,
        default=2,
        help=(
            "metres per cell. At 8 m every road rounded to a single cell, so a 4 m service road "
            "and a 13 m primary were both drawn 8 m wide and the network read as a chain of "
            "blocks. 2 m gives each class a width close to its real one."
        ),
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)

    # ⚠️ **Per AOI.** This used to default to a single shared `data/raw/osm/landuse.json`, so the
    # second site painted the FIRST site's polygons onto its own grid — they landed nowhere near it
    # and the step reported "mapped 0.0% of the AOI" while cheerfully claiming to have painted 1087
    # rings. A shared cache between two areas of interest is a silent wrong answer waiting for a
    # second area of interest, which is exactly what phase 7 is.
    landuse_path = args.landuse or Path("data/raw/osm") / cfg["id"] / "landuse.json"
    out_dir = args.terrain / cfg["id"]
    meta_path = out_dir / "heightmap_4m.json"
    if not meta_path.exists():
        raise SystemExit(f"missing {meta_path} — run build_terrain.py first")

    terrain = json.loads(meta_path.read_text(encoding="utf-8"))
    origin_e = int(terrain["origin"]["easting"])
    origin_n = int(terrain["origin"]["northing"])
    terrain_res = int(terrain["resolutionM"])

    # Cover exactly the same ground as the heightmap, so a uv in the shader means the same place
    # in both rasters regardless of the resolution difference.
    extent_w = terrain["width"] * terrain_res
    extent_h = terrain["height"] * terrain_res
    resolution = args.resolution
    width = extent_w // resolution
    height = extent_h // resolution
    top_n = origin_n + extent_h

    print(f"grid: {width} x {height} cells at {resolution} m")
    print(f"origin (UTM32): {origin_e} E, {origin_n} N")

    payload = json.loads(landuse_path.read_text(encoding="utf-8"))
    areas = payload["areas"]
    lines = payload["lines"]

    canvas = Image.new("L", (width, height), UNMAPPED)
    draw = ImageDraw.Draw(canvas)

    # Paint large polygons first so small ones land on top. Without this an alm or a clearing
    # inside a forest polygon disappears under it, and those clearings are exactly the detail that
    # makes a flank read as a mountainside rather than a green wall.
    prepared = []
    for area in areas:
        class_id = CLASSES.get(area["class"])
        if class_id is None:
            continue
        outers = [ring_to_pixels(r, origin_e, top_n, resolution) for r in area["outers"]]
        inners = [ring_to_pixels(r, origin_e, top_n, resolution) for r in area["inners"]]
        largest = max((ring_area_m2(r, resolution) for r in outers), default=0.0)
        prepared.append((largest, class_id, outers, inners))

    prepared.sort(key=lambda item: -item[0])
    painted = 0
    for _area, class_id, outers, inners in prepared:
        for ring in outers:
            if len(ring) >= 3:
                draw.polygon(ring, fill=class_id)
                painted += 1
        # Holes go back to unmapped rather than to a guess. A clearing in a wood is not a wood,
        # and a later, smaller polygon may still legitimately paint over it.
        for ring in inners:
            if len(ring) >= 3:
                draw.polygon(ring, fill=UNMAPPED)

    print(f"  painted {painted} area rings")

    # Roads last, and in ascending importance, so a motorway is never broken by a farm track.
    order = {TRACK: 0, ROAD_MINOR: 1, RAILWAY: 2, ROAD_MAJOR: 3}
    drawn_lines = []
    surfaced = 0
    for line in lines:
        spec = LINE_WIDTH_M.get(line["class"])
        if spec is None:
            continue
        class_id, width_m = spec
        surface = line.get("surface")
        if surface:
            surfaced += 1
        class_id = surfaced_class(line["class"], class_id, surface)
        drawn_lines.append((order[class_id], class_id, width_m, line["coords"]))
    drawn_lines.sort(key=lambda item: item[0])

    for _rank, class_id, width_m, coords in drawn_lines:
        pixels = ring_to_pixels(coords, origin_e, top_n, resolution)
        if len(pixels) < 2:
            continue
        draw.line(pixels, fill=class_id, width=max(1, round(width_m / resolution)), joint="curve")

    print(f"  drew {len(drawn_lines)} line segments ({surfaced} carried an OSM surface tag)")

    grid = np.array(canvas, dtype=np.uint8)

    out_dir.mkdir(parents=True, exist_ok=True)

    # Shipped gzipped, and it is not a marginal saving: a class raster is enormous runs of one
    # value, so 2 m compresses about 27:1 — 28.6 MB of grid crosses the wire as roughly 1 MB, less
    # than the old 8 m raster cost uncompressed. That is what makes this resolution affordable at
    # all. The Fabric static host does not compress responses itself (it answers these assets
    # chunked, with no content-encoding), so the file is stored compressed and the browser
    # inflates it with DecompressionStream.
    raw = grid.tobytes()
    # ⚠️ Deliberately NOT named ".gz". The Vite dev server sees that extension and answers with
    # `Content-Encoding: gzip`, so the browser inflates the body transparently; the Fabric static
    # host sets no encoding at all and hands over the compressed bytes. Identical file, opposite
    # handling, and the byte counter would be wrong in whichever environment we did not test. An
    # extension nobody special-cases makes both behave the same.
    bin_path = out_dir / f"landuse_{resolution}m.u8z"
    bin_path.write_bytes(gzip.compress(raw, 6))

    # Older builds wrote an uncompressed raster, and a rebuild at a different resolution leaves
    # its predecessor behind under another name. Either way it is megabytes nothing reads, sitting
    # in the deployed payload.
    superseded = [
        *out_dir.glob("landuse_*m.u8"),
        *out_dir.glob("landuse_*m.u8.gz"),
        *out_dir.glob("landuse_*m.u8z"),
    ]
    for stale in superseded:
        if stale.name != bin_path.name:
            stale.unlink()
            print(f"  removed superseded {stale.name}")

    histogram = {}
    total = grid.size
    for class_id, label in CLASS_LABELS.items():
        count = int((grid == class_id).sum())
        if count:
            histogram[label] = round(count / total * 100, 2)

    meta = {
        "aoi": cfg["id"],
        # The app reads this descriptor under a fixed name and takes the raster filename from it,
        # so the resolution can change here without touching a line of TypeScript.
        "file": bin_path.name,
        "compression": "gzip",
        "bytes": len(raw),
        "compressedBytes": bin_path.stat().st_size,
        "width": width,
        "height": height,
        "resolutionM": resolution,
        "origin": {"easting": origin_e, "northing": origin_n},
        "classes": {str(k): v for k, v in CLASS_LABELS.items()},
        "coveragePct": round(float((grid != UNMAPPED).mean()) * 100, 2),
        "sharePct": histogram,
        "attribution": "© OpenStreetMap contributors (ODbL)",
        "note": (
            "Land cover as currently mapped in OpenStreetMap, not as it stood in July 2021. "
            "Used for surface colour only; it takes no part in the simulation."
        ),
    }
    json_path = out_dir / "landuse.json"
    json_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    for orphan in out_dir.glob("landuse_*m.json"):
        orphan.unlink()

    ratio = len(raw) / max(bin_path.stat().st_size, 1)
    print(f"\nwrote {bin_path} ({bin_path.stat().st_size / 1024 / 1024:.2f} MB gzipped)")
    print(f"      {len(raw) / 1024 / 1024:.2f} MB inflated, {ratio:.1f}x")
    print(f"wrote {json_path}")
    print(f"\nmapped {meta['coveragePct']:.1f}% of the AOI")
    for label, share in sorted(histogram.items(), key=lambda kv: -kv[1]):
        print(f"  {label:<28} {share:5.2f}%")


if __name__ == "__main__":
    main()

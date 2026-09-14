"""Turn the Bavarian single-tree cadastre into instances the browser can draw.

PLAN §7 phase 1 step 8. `einzelbaeume` is LiDAR-derived: one point per detected tree, carrying its
position, the DGM height of the ground under it, and its own height. Those three are **measured**.

⚠️ **What the source does NOT contain, and what this script therefore refuses to assert.**

The Rhineland-Palatinate pipeline this replaces derived trees from DOM1 minus DGM1, which let it
measure crown radius from the canopy and separate conical from rounded crowns — so the app drew
conifers and broadleaves as different shapes, and that distinction was earned. The Bavarian product
gives position and height only. Two consequences:

  * **Crown radius is estimated from height**, using a single linear ratio. It is a stylisation
    that makes a tree look like a tree, and it is labelled as estimated in the output metadata and
    in the app. It is not a measurement and nothing reads it except the renderer.

  * **Species and crown form are not distinguished at all.** The Allgäu Bergwald is overwhelmingly
    spruce, so drawing every tree as a conifer would *look* right — and would be a species claim
    this dataset cannot support, on a hillside where larch, beech and mixed stands all occur. Every
    tree is drawn with one neutral crown instead, and `formKnown: false` tells the renderer to stop
    pretending otherwise. Looking right is not the same as being right.

Output (into public/terrain/<aoi-id>/):
  vegetation.bin    9 bytes per tree, fixed width
  vegetation.json   count, stride, provenance and the caveats above

Usage
  python tools/geodata/build_vegetation.py
  python tools/geodata/build_vegetation.py --spacing 12 --min-height 4
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import struct
from pathlib import Path

import numpy as np

from aoi import bbox_wsen, cache_dir, load_aoi, terrain_dir
from utm import bbox_to_utm32

#: Crown radius as a fraction of tree height.
#:
#: A stylisation, not an allometric fit — the source carries nothing to fit against. Chosen so a
#: 25 m spruce gets a ~5 m crown, which is roughly right for a closed mountain stand and, more to
#: the point, reads as a forest rather than as a field of poles.
CROWN_RATIO = 0.20
CROWN_MIN_M = 1.0
CROWN_MAX_M = 7.0

#: GeoPackage binary header: 'GP', version, flags, then the SRS id, before the WKB payload.
GPKG_MAGIC = b"GP"


def decode_point(blob: bytes) -> tuple[float, float] | None:
    """Decode a GeoPackage POINT into (easting, northing).

    Implemented directly rather than through a GIS library: a GeoPackage is a SQLite file and its
    point encoding is a fixed 8-byte header plus a 21-byte little-endian WKB point. Pulling in GDAL
    to read 29 bytes would add a large binary dependency to a repo whose whole toolchain is numpy,
    pillow and scipy.
    """
    if len(blob) < 8 or blob[:2] != GPKG_MAGIC:
        return None
    flags = blob[3]
    little_endian = bool(flags & 0x01)
    envelope = (flags >> 1) & 0x07
    # Envelope sizes, in doubles: none, xy, xyz, xym, xyzm.
    envelope_doubles = {0: 0, 1: 4, 2: 6, 3: 6, 4: 8}.get(envelope)
    if envelope_doubles is None:
        return None

    offset = 8 + envelope_doubles * 8
    wkb = blob[offset:]
    if len(wkb) < 21:
        return None

    order = "<" if wkb[0] == 1 else ">"
    geometry_type = struct.unpack(order + "I", wkb[1:5])[0]
    if geometry_type != 1:  # not a point
        return None
    easting, northing = struct.unpack(order + "dd", wkb[5:21])
    _ = little_endian
    return easting, northing


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument("--src", type=Path, default=None)
    parser.add_argument(
        "--spacing",
        type=float,
        default=9.0,
        help="minimum metres between drawn trees; thins a closed canopy that nobody can see into",
    )
    parser.add_argument("--min-height", type=float, default=3.0)
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    source_dir = args.src or cache_dir("trees", cfg["id"])
    packages = sorted(source_dir.glob("*.gpkg"))
    if not packages:
        raise SystemExit(
            f"no GeoPackage in {source_dir} — run tools/geodata/fetch_trees.py first"
        )

    meta_path = terrain_dir(cfg) / "heightmap_4m.json"
    if not meta_path.exists():
        raise SystemExit(f"{meta_path} not found — run tools/geodata/build_terrain.py first")
    terrain = json.loads(meta_path.read_text(encoding="utf-8"))
    origin_e = float(terrain["origin"]["easting"])
    origin_n = float(terrain["origin"]["northing"])
    width_m = terrain["width"] * terrain["resolutionM"]
    depth_m = terrain["height"] * terrain["resolutionM"]
    top_n = origin_n + depth_m

    min_e, min_n, max_e, max_n = bbox_to_utm32(*bbox_wsen(cfg, "core"))
    print(f"AOI: E {min_e:.0f}..{max_e:.0f}  N {min_n:.0f}..{max_n:.0f}")

    # A thinning grid rather than a distance test. Keeping at most one tree per cell is O(n) and
    # gives an even covering; a true minimum-distance filter is O(n log n) and produces a
    # near-identical picture at this density.
    cell = max(args.spacing, 0.5)
    claimed: set[tuple[int, int]] = set()

    records: list[tuple[int, int, int, int, int, int]] = []
    heights: list[float] = []
    scanned = 0
    outside = 0
    too_short = 0
    thinned = 0

    for package in packages:
        connection = sqlite3.connect(f"file:{package}?mode=ro", uri=True)
        cursor = connection.cursor()
        tables = [
            row[0]
            for row in cursor.execute(
                "SELECT table_name FROM gpkg_contents WHERE data_type = 'features'"
            )
        ]
        # Each table is a one-kilometre northing band, and its extent is in the catalogue. Skipping
        # the bands that cannot intersect the AOI turns a 344 MB scan into a few per cent of one.
        wanted: list[str] = []
        for table in tables:
            row = cursor.execute(
                "SELECT min_x, min_y, max_x, max_y FROM gpkg_contents WHERE table_name = ?",
                (table,),
            ).fetchone()
            if not row or row[0] is None:
                continue
            tmin_e, tmin_n, tmax_e, tmax_n = row
            if tmax_e < min_e or tmin_e > max_e or tmax_n < min_n or tmin_n > max_n:
                continue
            wanted.append(table)

        print(f"{package.name}: {len(tables)} bands, {len(wanted)} intersect the AOI")

        for table in wanted:
            for geom, ground, height in cursor.execute(
                f"SELECT geom, dgmhoehe, baumhoehe FROM '{table}'"  # noqa: S608 - name from catalogue
            ):
                scanned += 1
                if height is None or ground is None:
                    continue
                if height < args.min_height:
                    too_short += 1
                    continue
                point = decode_point(geom)
                if point is None:
                    continue
                easting, northing = point
                if not (origin_e <= easting <= origin_e + width_m and origin_n <= northing <= top_n):
                    outside += 1
                    continue

                key = (int((easting - origin_e) // cell), int((northing - origin_n) // cell))
                if key in claimed:
                    thinned += 1
                    continue
                claimed.add(key)

                # World metres: x east of the terrain centre, z south of it. The northing term is
                # negated because +Z is south once the terrain plane is rotated flat.
                x = easting - origin_e - width_m / 2
                z = (top_n - northing) - depth_m / 2

                radius = min(max(height * CROWN_RATIO, CROWN_MIN_M), CROWN_MAX_M)
                records.append(
                    (
                        int(round(x)),
                        int(round(z)),
                        int(round(min(max(ground, 0.0), 6553.5) * 10)),
                        int(round(min(height, 51.0) / 0.2)),
                        int(round(min(radius, 25.5) * 10)),
                        128,  # crown form: unknown, and deliberately constant. See the docstring.
                    )
                )
                heights.append(height)

        connection.close()

    if not records:
        raise SystemExit("no trees fell inside the AOI")

    array = np.array(heights)
    print(f"\nscanned {scanned:,} rows")
    print(f"  {outside:,} outside the terrain, {too_short:,} under {args.min_height:.0f} m, {thinned:,} thinned")
    print(f"  {len(records):,} trees kept at {cell:.0f} m spacing")
    print(f"  height {array.min():.1f} .. {array.max():.1f} m, median {np.median(array):.1f} m")

    payload = bytearray()
    for x, z, ground, height, radius, form in records:
        payload += struct.pack("<hhHBBB", x, z, ground, height, radius, form)

    out_dir = terrain_dir(cfg)
    out_dir.mkdir(parents=True, exist_ok=True)
    bin_path = out_dir / "vegetation.bin"
    bin_path.write_bytes(bytes(payload))

    json_path = out_dir / "vegetation.json"
    json_path.write_text(
        json.dumps(
            {
                "aoi": cfg["id"],
                "count": len(records),
                "stride": 9,
                "encoding": (
                    "int16 x (m), int16 z (m), uint16 ground (0.1 m), uint8 height (0.2 m), "
                    "uint8 crown radius (0.1 m), uint8 crown form"
                ),
                "minHeightM": args.min_height,
                "spacingM": cell,
                "formKnown": False,
                "crownRadiusMeasured": False,
                "crownRatio": CROWN_RATIO,
                "source": "Einzelbaumstandorte (einzelbaeume), Bayerische Vermessungsverwaltung (LDBV)",
                "licence": "CC BY 4.0",
                "attribution": (
                    "Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de "
                    "[Daten bearbeitet]"
                ),
                "note": (
                    "Position, Bodenhöhe und Baumhöhe sind gemessen (LiDAR). Der Kronenradius ist "
                    f"aus der Höhe geschätzt ({CROWN_RATIO:g} × Höhe) und keine Messung. Die "
                    "Baumart wird von dieser Datenquelle nicht erfasst — alle Bäume werden daher "
                    "mit einer einheitlichen Krone dargestellt; die Form sagt nichts über die Art."
                ),
                "noteEn": (
                    "Position, ground height and tree height are measured (LiDAR). Crown radius is "
                    f"estimated from height ({CROWN_RATIO:g} × height) and is not a measurement. "
                    "The source records no species, so every tree is drawn with one neutral crown "
                    "— the shape carries no species information."
                ),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    print(f"\nwrote {bin_path} ({bin_path.stat().st_size / 1e6:.2f} MB)")
    print(f"wrote {json_path}")


if __name__ == "__main__":
    main()

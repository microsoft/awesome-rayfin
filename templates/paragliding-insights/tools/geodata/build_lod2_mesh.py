"""Convert LoD2 CityGML into a compact binary mesh the browser can load.

PLAN §7 phase 1 step 8. LoD2 carries real roof shapes and measured heights, which is the difference
between Oberstdorf and a field of grey boxes. Buildings are context rather than subject here: they
give the eye something of known size to judge 1400 m of relief against, and they make the valley
floor recognisable to anyone who has stood in it.

Output (public/terrain/<aoi>/):
  buildings_lod2.bin   planar quantised vertex blocks
  buildings_lod2.json  per-building ground elevation and index range

The Bavarian tiles are CityGML 1.0 with absolute EPSG:25832 coordinates and DHHN2016 heights — the
same datum as DGM1 — so buildings and terrain need no reconciliation at all, unlike the shell.

Design notes
------------
* Triangulation is a fan over each planar CityGML polygon. LoD2 surfaces are convex or near-convex
  in practice, so a fan is adequate and avoids pulling in an ear-clipping dependency.
* Coordinates are emitted relative to the terrain centre, so the browser places buildings in the
  same world metres as the terrain without any projection maths of its own.
* Ground elevation per building comes from the CityGML GroundSurface, which is measured — better
  than sampling our own heightmap, and it is what lets the shader lift a building onto exaggerated
  terrain without stretching the building itself.

Usage
  python tools/geodata/build_lod2_mesh.py
  python tools/geodata/build_lod2_mesh.py --min-footprint 0     # keep every shed
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import struct
import xml.etree.ElementTree as ET
from pathlib import Path

from aoi import bbox_wsen, cache_dir, load_aoi, terrain_dir
from building_class import WALL_CLASS_NAMES, wall_class
from utm import bbox_to_utm32, wgs84_to_utm32

NS = {
    "bldg": "http://www.opengis.net/citygml/building/1.0",
    "gml": "http://www.opengis.net/gml",
}


def read_gml(path: Path) -> str:
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")


def polygons_of(element: ET.Element) -> list[list[tuple[float, float, float]]]:
    """Every gml:posList under an element, as lists of (easting, northing, height)."""
    rings: list[list[tuple[float, float, float]]] = []
    for pos in element.iter(f"{{{NS['gml']}}}posList"):
        if not pos.text:
            continue
        values = [float(v) for v in pos.text.split()]
        points = [
            (values[i], values[i + 1], values[i + 2]) for i in range(0, len(values) - 2, 3)
        ]
        if len(points) >= 4:
            rings.append(points)
    return rings


def ground_area_m2(rings: list[list[tuple[float, float, float]]]) -> float:
    """Area of the largest ground ring. Coordinates are already UTM metres, so this is direct."""
    best = 0.0
    for ring in rings:
        pts = ring[:-1] if ring[0] == ring[-1] else ring
        if len(pts) < 3:
            continue
        total = 0.0
        for (x1, y1, _), (x2, y2, _) in zip(pts, pts[1:] + pts[:1]):
            total += x1 * y2 - x2 * y1
        best = max(best, abs(total) * 0.5)
    return best


def write_roof_colours(
    out_dir: Path,
    roof_outlines: list[list[list[tuple[float, float]]]],
    roof_spans: list[list[tuple[int, list[list[tuple[float, float]]]]]],
) -> dict:
    """Sample every roof from the AOI's own orthophoto and write one RGBA byte quad per building.

    See tools/geodata/roof_colour.py for why the orthophoto is the only honest source and how the
    sample is cleaned. The fourth byte is a flag, not alpha: 255 where the colour was measured from
    the photograph and 0 where there were too few usable pixels and the building fell back. Keeping
    that distinction on the wire means the app can say how much of what it is showing was measured,
    which is the difference between a survey product and a mood board.

    A second, optional file carries per-SURFACE colours for the roofs that genuinely have more than
    one material — see `surface_variant`. Most do not, and get nothing.
    """
    drape_meta_path = out_dir / "drape.json"
    drape_image_path = out_dir / "drape.jpg"
    if not (drape_meta_path.exists() and drape_image_path.exists()):
        print("no drape.jpg yet — skipping roof colour (re-run after fetch_dop20.py)")
        return {"measured": 0, "total": len(roof_outlines), "state": "no-drape"}

    from PIL import Image  # local: the mesh build itself does not need Pillow

    from roof_colour import (
        DrapeRef,
        fallback_colour,
        measure_roof_colours,
        robust_colour,
        sample_polygons,
        surface_variant,
    )

    meta = json.loads(drape_meta_path.read_text(encoding="utf-8"))
    drape = DrapeRef(
        image=Image.open(drape_image_path).convert("RGB"),
        resolution_m=float(meta["resolutionM"]),
        origin_easting=float(meta["origin"]["easting"]),
        top_northing=float(meta["origin"]["northing"]) + float(meta["spanM"]["north"]),
    )

    colours, stats = measure_roof_colours(drape, roof_outlines)
    fallback = fallback_colour(colours)

    payload = bytearray()
    for colour in colours:
        if colour is None:
            payload += bytes((*fallback, 0))
        else:
            payload += bytes((*colour, 255))

    path = out_dir / "buildings_colour.bin"
    path.write_bytes(bytes(payload))

    # Per-surface variants, for the minority of roofs that are two materials rather than one.
    spans = bytearray()
    span_count = 0
    for index, surfaces in enumerate(roof_spans):
        building_colour = colours[index]
        if building_colour is None or len(surfaces) < 2:
            continue
        for vertex_start, rings in surfaces:
            pixels = sample_polygons(drape, rings)
            sampled = robust_colour(pixels)
            if sampled is None:
                continue
            variant = surface_variant(sampled, building_colour, len(pixels))
            if variant is None:
                continue
            spans += struct.pack("<I3B", vertex_start, *variant)
            span_count += 1

    spans_path = out_dir / "buildings_roof_spans.bin"
    spans_path.write_bytes(bytes(spans))

    share = stats["measured"] / max(stats["total"], 1)
    print(
        f"roof colour: {stats['measured']}/{stats['total']} measured ({share:.1%}), "
        f"fallback rgb{fallback} — wrote {path.name} ({len(payload) / 1024:.0f} KB)"
    )
    print(
        f"roof surfaces with their own material: {span_count} — wrote {spans_path.name} "
        f"({len(spans) / 1024:.0f} KB)"
    )
    return {
        "file": "buildings_colour.bin",
        "encoding": "uint8 r,g,b,measured per building, in the order of `buildings`",
        "measured": stats["measured"],
        "total": stats["total"],
        "fallback": list(fallback),
        "surfaceFile": "buildings_roof_spans.bin",
        "surfaceEncoding": (
            "little-endian uint32 vertexStart + uint8 r,g,b per roof surface that differs from "
            "its own building; 7 bytes each, ascending by vertexStart"
        ),
        "surfaceCount": span_count,
        "method": (
            "median of the DOP20 drape pixels inside each building's LoD2 roof outlines, with "
            "green-dominant pixels rejected and the darkest and brightest fifths trimmed, then "
            "re-centred in value to remove the aerial sun (tools/geodata/roof_colour.py)"
        ),
        "wallsAreNotMeasured": (
            "Wall colour is NOT derived from any survey. A wall is not visible in a vertical "
            "aerial photograph and OpenStreetMap carries building:colour for 0.02 % of buildings "
            "at Oberstdorf. Each building's `wall` class comes from its measured ALKIS function "
            "code and its measured size; the colour that class is painted is a convention."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument("--src", type=Path, default=None)
    parser.add_argument(
        "--min-footprint",
        type=float,
        default=18.0,
        help="square metres; the cadastre records bin stores and garden sheds too",
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    source = args.src or cache_dir("lod2", cfg["id"])
    tiles = sorted(source.glob("*.gml"))
    if not tiles:
        raise SystemExit(
            f"no CityGML tiles in {source} — run "
            "`python tools/geodata/fetch_bvv.py --product lod2` first"
        )

    # The terrain the buildings have to stand on. Reading the generated heightmap's metadata rather
    # than recomputing the grid keeps the two exactly aligned: a building placed against a
    # separately derived origin sits a few metres off its own footprint.
    meta_path = terrain_dir(cfg) / "heightmap_4m.json"
    if not meta_path.exists():
        raise SystemExit(f"{meta_path} not found — run tools/geodata/build_terrain.py first")
    terrain = json.loads(meta_path.read_text(encoding="utf-8"))
    origin_e = float(terrain["origin"]["easting"])
    origin_n = float(terrain["origin"]["northing"])
    width_m = terrain["width"] * terrain["resolutionM"]
    depth_m = terrain["height"] * terrain["resolutionM"]

    # Buildings are grouped by nearest named place purely so the summary is readable.
    places = [
        (*wgs84_to_utm32(p["lon"], p["lat"]), p["name"])
        for p in cfg.get("focusPlaces", [])
    ] or [(origin_e + width_m / 2, origin_n + depth_m / 2, cfg["id"])]

    print(f"terrain: {width_m / 1000:.1f} x {depth_m / 1000:.1f} km from {origin_e:.0f}/{origin_n:.0f}")
    print(f"tiles: {len(tiles)}")

    positions: list[float] = []
    buildings: list[dict] = []
    #: Roof outlines in UTM, parallel to `buildings`, kept only to sample the orthophoto below.
    roof_outlines: list[list[list[tuple[float, float]]]] = []
    #: Per building, one (vertexStart, outline) pair per individual roof SURFACE.
    roof_spans: list[list[tuple[int, list[list[tuple[float, float]]]]]] = []
    too_small = 0
    off_terrain = 0

    for path in tiles:
        root = ET.fromstring(read_gml(path))
        kept = 0

        for building in root.iter(f"{{{NS['bldg']}}}Building"):
            ground_rings: list[list[tuple[float, float, float]]] = []
            for ground in building.iter(f"{{{NS['bldg']}}}GroundSurface"):
                ground_rings.extend(polygons_of(ground))
            if not ground_rings:
                continue

            flat = [pt for ring in ground_rings for pt in ring]
            cx = sum(p[0] for p in flat) / len(flat)
            cy = sum(p[1] for p in flat) / len(flat)

            # A CityGML tile is 2 km, so the tiles covering the AOI reach past it on every side. A
            # building beyond the heightmap has no ground under it and hangs in the air.
            if not (origin_e <= cx <= origin_e + width_m and origin_n <= cy <= origin_n + depth_m):
                off_terrain += 1
                continue

            if ground_area_m2(ground_rings) < args.min_footprint:
                too_small += 1
                continue

            # ⚠️ **Roofs are separated from walls here, and that is a change of substance.**
            #
            # The previous version called polygons_of(building), which returns every gml:posList
            # under the building in document order and throws away the one thing that distinguishes
            # them: CityGML tags each surface as bldg:RoofSurface, bldg:WallSurface or
            # bldg:GroundSurface, and lod2_attribute_spike.py measured that ALL 13 223 buildings
            # across both AOIs carry all three. The renderer was then reduced to guessing which
            # faces were roofs from how high off the ground they were.
            #
            # Splitting them costs nothing on the wire. The triangles are emitted walls-and-ground
            # first, then roofs, and one index per building says where the roofs start — so the
            # client reconstructs a per-vertex roof flag from four bytes per building instead of a
            # byte per vertex, which would have been three quarters of a megabyte.
            roof_rings: list[list[tuple[float, float, float]]] = []
            roof_surfaces: list[list[list[tuple[float, float, float]]]] = []
            for roof in building.iter(f"{{{NS['bldg']}}}RoofSurface"):
                rings = polygons_of(roof)
                if rings:
                    roof_surfaces.append(rings)
                    roof_rings.extend(rings)
            other_rings: list[list[tuple[float, float, float]]] = []
            for kind in ("WallSurface", "GroundSurface", "ClosureSurface"):
                for surface in building.iter(f"{{{NS['bldg']}}}{kind}"):
                    other_rings.extend(polygons_of(surface))
            if not roof_rings and not other_rings:
                # A building modelled without semantic surfaces would land here. None exist in
                # either AOI, but falling back to the old undifferentiated read is better than
                # dropping it silently if one ever does.
                other_rings = polygons_of(building)
            if not roof_rings and not other_rings:
                continue

            def child_text(tag: str) -> str:
                node = building.find(f"{{{NS['bldg']}}}{tag}")
                return node.text.strip() if node is not None and node.text else ""

            function_code = child_text("function")
            try:
                measured_height = float(child_text("measuredHeight"))
            except ValueError:
                measured_height = 0.0

            start_vertex = len(positions) // 3

            def emit(rings: list[list[tuple[float, float, float]]]) -> None:
                for ring in rings:
                    # Drop the repeated closing vertex, then fan-triangulate.
                    pts = ring[:-1] if ring[0] == ring[-1] else ring
                    if len(pts) < 3:
                        continue
                    for i in range(1, len(pts) - 1):
                        for p in (pts[0], pts[i], pts[i + 1]):
                            # World space: x east of centre, y up, z south of centre. The northing
                            # term is negated because +Z is south once the terrain plane is
                            # rotated flat.
                            positions.append(p[0] - origin_e - width_m / 2)
                            positions.append(p[2])
                            positions.append((origin_n + depth_m) - p[1] - depth_m / 2)

            emit(other_rings)
            roof_start = len(positions) // 3
            # Roof surfaces are emitted one at a time and their vertex ranges recorded, so the
            # orthophoto can be sampled per SURFACE as well as per building. A church spire and its
            # nave, or a hall with a solar array on one pitch, are two materials on one roof.
            surface_spans: list[tuple[int, list[list[tuple[float, float]]]]] = []
            for surface in roof_surfaces:
                span_start = len(positions) // 3
                emit(surface)
                if len(positions) // 3 > span_start:
                    surface_spans.append(
                        (span_start, [[(p[0], p[1]) for p in ring] for ring in surface])
                    )

            vertex_count = len(positions) // 3 - start_vertex
            if vertex_count == 0:
                continue

            nearest = min(places, key=lambda c: (c[0] - cx) ** 2 + (c[1] - cy) ** 2)
            footprint = ground_area_m2(ground_rings)
            buildings.append(
                {
                    "village": nearest[2],
                    "groundElevM": round(min(p[2] for p in flat), 2),
                    "vertexStart": start_vertex,
                    "vertexCount": vertex_count,
                    "roofVertexStart": roof_start,
                    # What the building IS, from the cadastre plus its own measured size. Drives
                    # the wall treatment, which is ~70 % of the surface the photograph cannot see.
                    "wall": wall_class(function_code, footprint, measured_height),
                }
            )
            roof_outlines.append([[(p[0], p[1]) for p in ring] for ring in roof_rings])
            roof_spans.append(surface_spans)
            kept += 1

        if kept:
            print(f"  {path.name}: {kept}")

    if not buildings:
        raise SystemExit("no buildings fell inside the terrain extent")

    print(f"\n{len(buildings)} buildings, {len(positions) // 9} triangles")

    # Quantise. float32 is far more precision than a building corner has — the source is a cadastral
    # model and a centimetre is already below what LoD2 claims. Storing x and z as int16 and y as
    # uint16 halves the file.
    #
    # ⚠️ The scales are DERIVED FROM THE DATA, not fixed. A fixed 1 cm y-scale spans only 655 m in a
    # uint16, which is ample for a river valley and nowhere near enough here: this AOI runs from an
    # 800 m valley floor to a mountain station at 1930 m, so the buildings alone cover 1140 m and
    # the first run aborted on a rooftop at 1497 m. Deriving the scale means the encoding uses the
    # full 16 bits whatever the AOI, instead of silently assuming the relief of the last one.
    #
    # Written planar rather than interleaved so each block stays two-byte aligned and the browser
    # can wrap it in a typed array with no copy.
    xs = positions[0::3]
    ys = positions[1::3]
    zs = positions[2::3]

    y_offset = float(math.floor(min(ys))) if ys else 0.0
    y_span = (max(ys) - y_offset) if ys else 1.0
    y_scale = max(0.01, y_span / 65000)

    xz_extent = max(max(abs(v) for v in xs), max(abs(v) for v in zs)) if xs else 1.0
    xz_scale = max(0.25, xz_extent / 32000)

    print(
        f"quantisation: xz {xz_scale * 100:.1f} cm over +/-{xz_extent:.0f} m, "
        f"y {y_scale * 100:.1f} cm over {y_span:.0f} m from {y_offset:.0f} m"
    )

    def quantise(values: list[float], scale: float, offset: float, lo: int, hi: int) -> list[int]:
        out = []
        for value in values:
            q = int(round((value - offset) / scale))
            if q < lo or q > hi:
                raise SystemExit(
                    f"vertex {value} falls outside the quantisation range — this should be "
                    "impossible now the scales are derived; check for a stray coordinate"
                )
            out.append(q)
        return out

    qx = quantise(xs, xz_scale, 0.0, -32768, 32767)
    qy = quantise(ys, y_scale, y_offset, 0, 65535)
    qz = quantise(zs, xz_scale, 0.0, -32768, 32767)

    out_dir = terrain_dir(cfg)
    out_dir.mkdir(parents=True, exist_ok=True)
    bin_path = out_dir / "buildings_lod2.bin"
    bin_path.write_bytes(
        struct.pack(f"<{len(qx)}h", *qx)
        + struct.pack(f"<{len(qy)}H", *qy)
        + struct.pack(f"<{len(qz)}h", *qz)
    )

    # Roof colour, read off the orthophoto this AOI already ships. Optional on purpose: the drape
    # is fetched after this step in the default pipeline order, so on a first run there is nothing
    # to sample and the app falls back to a single colour exactly as before. Re-run once the drape
    # exists and the valley gets its own roofs.
    colour_summary = write_roof_colours(out_dir, roof_outlines, roof_spans)

    per_village: dict[str, int] = {}
    for building in buildings:
        per_village[building["village"]] = per_village.get(building["village"], 0) + 1

    json_path = out_dir / "buildings_lod2.json"
    json_path.write_text(
        json.dumps(
            {
                "aoi": cfg["id"],
                "count": len(buildings),
                "vertexCount": len(positions) // 3,
                "perVillage": per_village,
                "encoding": (
                    "planar int16 x (0.25 m), uint16 y (0.01 m above yOffsetM), int16 z (0.25 m)"
                ),
                "quantisation": {"xzScaleM": xz_scale, "yScaleM": y_scale, "yOffsetM": y_offset},
                "surfaces": (
                    "vertices [vertexStart, roofVertexStart) are wall and ground faces, "
                    "[roofVertexStart, vertexStart + vertexCount) are roof faces, from the "
                    "CityGML bldg:RoofSurface / bldg:WallSurface semantics"
                ),
                "roofColour": colour_summary,
                "wallClasses": {
                    str(value): name for value, name in WALL_CLASS_NAMES.items()
                },
                "wallClassSource": (
                    "per building `wall`, from the ALKIS bldg:function code and the survey's own "
                    "footprint and measuredHeight — see tools/geodata/building_class.py, where "
                    "every code is confirmed against the survey's own gml:name values"
                ),
                "source": "3D-Gebäudemodell LoD2, Bayerische Vermessungsverwaltung (LDBV)",
                "licence": "CC BY 4.0",
                "attribution": (
                    "Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de "
                    "[Daten bearbeitet]"
                ),
                "buildings": buildings,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    print(f"per place: {per_village}")
    print(f"skipped {too_small} structures under {args.min_footprint:.0f} m2")
    print(f"skipped {off_terrain} outside the terrain extent")
    print(f"wrote {bin_path} ({bin_path.stat().st_size / 1024 / 1024:.2f} MB)")
    print(f"wrote {json_path} ({json_path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()

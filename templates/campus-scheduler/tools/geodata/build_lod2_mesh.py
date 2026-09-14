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


def point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    hit = False
    for i in range(len(ring)):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % len(ring)][0], ring[(i + 1) % len(ring)][1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def institutional_rings(site: str) -> list[list[list[float]]]:
    """Footprints the site's OWN ownership test accepted — i.e. the university's buildings.

    ⚠️ THIS EXISTS BECAUSE THE CADASTRE DOES NOT SAY. At OTH the university's buildings carry ALKIS
    `31001_3020` and the wall rule catches them. At LMU **1 249 of 3 644 buildings on campus are
    `31001_9998`, "unspecified"** — and their names are `Frauenklinik`, `Klinik und Poliklinik für
    Dermatologie`. Left to the code alone, a third of the campus would be painted as flats.

    `9998` cannot simply be assumed institutional; much of it is ordinary housing. So the evidence
    comes from a different measured source: OpenStreetMap's `operator` tag, already filtered by the
    ownership test that built `config/buildings-<site>.json`.

    ⚠️ TWO FILES, ONE QUESTION, AND THE SECOND ONE IS NOT OPTIONAL DECORATION. The campus twins
    have no timetable and therefore no `buildings-<site>.json` — nothing ever ran the ownership
    test for them. At Garching that left 92 of 353 buildings on `31001_9998` at a median of 587 m²,
    including the LARGEST building in the view at 18 830 m², painted as housing. `campus-<aoi>.json`
    carries the campus outlines instead (tools/geodata/fetch_campus_outline.py); a building whose
    centroid falls inside the Technische Universität München outline is a university building
    whatever the cadastre declines to say. Both files are read; either may be absent, and at
    Tübingen both are, because that university has no campus to be inside.
    """
    config = Path(__file__).resolve().parents[2] / "config"
    rings = []
    for path in (config / f"buildings-{site}.json", config / f"campus-{site}.json"):
        if not path.exists():
            continue
        raw = json.loads(path.read_text(encoding="utf-8"))
        records = raw["buildings"] if isinstance(raw, dict) else raw
        for entry in records:
            if not isinstance(entry, dict):
                continue
            poly = entry.get("polygonUtm32")
            if not poly:
                continue
            rings.append(poly[0] if isinstance(poly[0][0], list) else poly)
    return rings


def write_roof_colours(
    out_dir: Path,
    roof_outlines: list[list[list[tuple[float, float]]]],
    roof_spans: list[list[tuple[int, list[list[tuple[float, float]]]]]],
) -> dict:
    """Sample every roof from the AOI's own orthophoto and write one RGBA byte quad per building.

    See tools/geodata/roof_colour.py for why the orthophoto is the only honest source and how the
    sample is cleaned. The fourth byte is a flag, not alpha: 255 where the colour was measured and
    0 where there were too few usable pixels and the building fell back. Keeping that on the wire
    means the app can say how much of what it shows was measured.

    ⚠️ THE DRAPE IS NOW FETCHED BEFORE THIS STEP, AND IT USED TO BE FETCHED AFTER. The note here
    said "a first run has no photograph and skips colour rather than failing — re-run the buildings
    step after the drape", which described the trap accurately and left it in place: nothing re-ran
    the step, so a NEW site shipped with every roof wearing its wall colour. It never bit an
    existing AOI, because a second build finds the drape the first one left behind; it bit FAU
    Erlangen and Köln on their first builds, at 0 of 9 013 and 0 of 5 928 roofs measured. The
    pipeline order is the fix (`drape` then `buildings`); this branch stays for a direct manual run
    and now says loudly what it is producing rather than logging a skip.
    """
    drape_meta_path = out_dir / "drape.json"
    drape_image_path = out_dir / "drape.jpg"
    if not (drape_meta_path.exists() and drape_image_path.exists()):
        print(
            "⚠️  NO drape.jpg — every roof will fall back to its WALL colour, which renders as one\n"
            "    flat city. This is a DEGRADED build, not a normal one. Fetch the drape first\n"
            "    (pipeline.py runs it before this step) and re-run build_lod2_mesh.py."
        )
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
        payload += bytes((*fallback, 0)) if colour is None else bytes((*colour, 255))
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
    print(f"roof surfaces with their own material: {span_count} ({len(spans) / 1024:.0f} KB)")
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
            "aerial photograph. Each building's `wall` class comes from its measured ALKIS "
            "function code, its measured size and — for the university's own buildings — the "
            "operator tag; the colour that class is painted is a convention."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oth-regensburg")
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
    meta_path = terrain_dir(cfg) / "heightmap.json"
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
    # Roof outlines per building, and per-surface spans within them, for the orthophoto sample.
    roof_outlines: list[list[list[tuple[float, float]]]] = []
    roof_spans: list[list[tuple[int, list[list[tuple[float, float]]]]]] = []
    campus_rings = institutional_rings(cfg.get("schedulerSite") or cfg["id"].split("-")[0])
    institutional = 0
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

            # ⚠️ ROOFS ARE SEPARATED FROM WALLS HERE, and that is a change of substance.
            #
            # The previous version called polygons_of(building), which returns every gml:posList
            # under the building in document order and throws away the one thing distinguishing
            # them: CityGML tags each surface as RoofSurface, WallSurface or GroundSurface, and
            # ALL 31 386 buildings at Regensburg and 41 863 at Munich carry all three. The renderer
            # was left guessing which faces were roofs from how high off the ground they sat.
            #
            # Splitting costs nothing on the wire: triangles are emitted walls-and-ground first,
            # then roofs, and ONE index per building says where the roofs start — so the client
            # rebuilds a per-vertex roof flag from four bytes per building instead of a byte per
            # vertex, which would have been megabytes.
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
                # either AOI, but falling back to the undifferentiated read beats dropping it.
                other_rings = polygons_of(building)
            if not roof_rings and not other_rings:
                continue

            def child_text(tag: str, node: ET.Element = building) -> str:
                found = node.find(f"{{{NS['bldg']}}}{tag}")
                return found.text.strip() if found is not None and found.text else ""

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
            # Roof surfaces go out one at a time with their vertex ranges recorded, so the
            # orthophoto can be sampled per SURFACE as well as per building — a hall with a solar
            # array on one pitch is two materials on one roof.
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
            owned = any(point_in_ring(cx, cy, ring) for ring in campus_rings)
            if owned:
                institutional += 1
            buildings.append(
                {
                    "village": nearest[2],
                    "groundElevM": round(min(p[2] for p in flat), 2),
                    "vertexStart": start_vertex,
                    "vertexCount": vertex_count,
                    "roofVertexStart": roof_start,
                    # What the building IS, from the cadastre plus its own measured size plus the
                    # site's ownership test. Drives the wall treatment, which is ~70% of the
                    # surface the photograph cannot see.
                    "wall": wall_class(function_code, footprint, measured_height, owned),
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

    per_village: dict[str, int] = {}
    for building in buildings:
        per_village[building["village"]] = per_village.get(building["village"], 0) + 1

    # ⚠️ AFTER the mesh is written, because the sample needs the roof outlines this build just
    # separated out — and because it is optional: no drape, no colour, and the app still renders.
    roof_colour_meta = write_roof_colours(out_dir, roof_outlines, roof_spans)

    wall_spread: dict[str, int] = {}
    for building in buildings:
        name = WALL_CLASS_NAMES[building["wall"]]
        wall_spread[name] = wall_spread.get(name, 0) + 1

    # ⚠️ THE ATTRIBUTION COMES FROM THE AOI, NOT FROM THIS FILE. It used to be the Bavarian notice
    # written inline, which was true of three AOIs and false of the fourth: Tübingen's LoD2 is the
    # LGL's under dl-de/by-2-0, and it shipped credited to the Bayerische Vermessungsverwaltung
    # under CC BY 4.0. A licence notice that names the wrong authority is worse than no notice.
    geobasis = cfg.get("geobasis", {})

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
                "roofColour": roof_colour_meta,
                "wallClasses": {
                    "names": {str(k): v for k, v in WALL_CLASS_NAMES.items()},
                    "spread": wall_spread,
                    "institutional": institutional,
                    "basis": (
                        "ALKIS bldg:function plus the building's own measured footprint and "
                        "height; buildings inside a footprint the site's ownership test accepted "
                        "are treated as institutional whatever the cadastre calls them, because "
                        "34% of LMU's campus is tagged 31001_9998 'unspecified' while carrying "
                        "names like 'Frauenklinik'. The CLASS is measured; the colour it is "
                        "painted is a convention."
                    ),
                },
                "source": f"3D-Gebäudemodell LoD2, {geobasis.get('authority', 'unbekannt')}",
                "licence": geobasis.get("licence", "unbekannt"),
                "attribution": geobasis.get("attribution", ""),
                "buildings": buildings,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    print(f"per place: {per_village}")
    print(f"wall classes: {wall_spread} ({institutional} institutional by operator)")
    print(f"skipped {too_small} structures under {args.min_footprint:.0f} m2")
    print(f"skipped {off_terrain} outside the terrain extent")
    print(f"wrote {bin_path} ({bin_path.stat().st_size / 1024 / 1024:.2f} MB)")
    print(f"wrote {json_path} ({json_path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()

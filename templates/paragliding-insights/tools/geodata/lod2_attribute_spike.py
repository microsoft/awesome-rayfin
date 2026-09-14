"""
What does the LoD2 survey actually carry per building? — PLAN §5.11 spike.

Realistic building colour has exactly two honest sources: something the survey measured, or
something a photograph shows. Everything else is invention with a confident finish. Before writing
a single line of renderer, this counts what is really in the CityGML — semantics, function codes,
roof types, and any appearance/material at all — so the colour model is built on what exists
rather than on what a code list says might exist.

Read-only. Writes nothing but a report to stdout.
"""

from __future__ import annotations

import collections
import gzip
import pathlib
import sys
import xml.etree.ElementTree as ET

NS = {
    "bldg": "http://www.opengis.net/citygml/building/1.0",
    "gml": "http://www.opengis.net/gml",
    "app": "http://www.opengis.net/citygml/appearance/1.0",
    "gen": "http://www.opengis.net/citygml/generics/1.0",
    "core": "http://www.opengis.net/citygml/1.0",
}


def open_gml(path: pathlib.Path):
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def probe(aoi: str, limit_tiles: int | None = None) -> None:
    root_dir = pathlib.Path("data/lod2") / aoi
    tiles = sorted(root_dir.glob("*.gml"))
    if limit_tiles:
        tiles = tiles[:limit_tiles]
    if not tiles:
        print(f"  no tiles under {root_dir}")
        return

    buildings = 0
    with_roof_surface = 0
    with_wall_surface = 0
    surface_kinds: collections.Counter = collections.Counter()
    functions: collections.Counter = collections.Counter()
    roof_types: collections.Counter = collections.Counter()
    storeys: collections.Counter = collections.Counter()
    generic_attrs: collections.Counter = collections.Counter()
    appearance_tags: collections.Counter = collections.Counter()
    all_child_tags: collections.Counter = collections.Counter()

    for tile in tiles:
        try:
            tree = ET.fromstring(open_gml(tile))
        except ET.ParseError as exc:  # pragma: no cover - diagnostic path
            print(f"  ! {tile.name}: {exc}")
            continue

        # Appearance lives at document level in CityGML, not per building.
        for element in tree.iter():
            name = local(element.tag)
            if name in {
                "Appearance",
                "X3DMaterial",
                "ParameterizedTexture",
                "GeoreferencedTexture",
                "diffuseColor",
                "surfaceDataMember",
            }:
                appearance_tags[name] += 1

        for building in tree.iter(f"{{{NS['bldg']}}}Building"):
            buildings += 1
            has_roof = False
            has_wall = False

            for child in building.iter():
                name = local(child.tag)
                if name in {
                    "RoofSurface",
                    "WallSurface",
                    "GroundSurface",
                    "ClosureSurface",
                    "OuterCeilingSurface",
                    "OuterFloorSurface",
                }:
                    surface_kinds[name] += 1
                    has_roof |= name == "RoofSurface"
                    has_wall |= name == "WallSurface"

            with_roof_surface += has_roof
            with_wall_surface += has_wall

            for child in building:
                all_child_tags[local(child.tag)] += 1

            def text_of(tag: str) -> str | None:
                node = building.find(f"{{{NS['bldg']}}}{tag}")
                return node.text.strip() if node is not None and node.text else None

            functions[text_of("function") or "(none)"] += 1
            roof_types[text_of("roofType") or "(none)"] += 1
            storeys[text_of("storeysAboveGround") or "(none)"] += 1

            for attr in building.iter(f"{{{NS['gen']}}}stringAttribute"):
                generic_attrs[attr.get("name") or "(unnamed)"] += 1
            for attr in building.iter(f"{{{NS['gen']}}}doubleAttribute"):
                generic_attrs[attr.get("name") or "(unnamed)"] += 1

    print(f"\n=== {aoi} — {len(tiles)} tiles, {buildings} buildings ===")
    print(f"  buildings with RoofSurface : {with_roof_surface} ({with_roof_surface / max(buildings,1):.1%})")
    print(f"  buildings with WallSurface : {with_wall_surface} ({with_wall_surface / max(buildings,1):.1%})")
    print("  surface kinds:")
    for kind, n in surface_kinds.most_common():
        print(f"    {kind:22s} {n}")
    print("  bldg:function:")
    for code, n in functions.most_common(12):
        print(f"    {code:22s} {n:6d}  ({n / max(buildings,1):.1%})")
    print("  bldg:roofType:")
    for code, n in roof_types.most_common(12):
        print(f"    {code:22s} {n:6d}  ({n / max(buildings,1):.1%})")
    print("  bldg:storeysAboveGround:")
    for code, n in storeys.most_common(8):
        print(f"    {code:22s} {n:6d}")
    print(f"  appearance / material tags anywhere in document: {dict(appearance_tags) or 'NONE'}")
    print("  generic attributes:")
    for name, n in generic_attrs.most_common(12):
        print(f"    {name:30s} {n}")
    print("  direct children of bldg:Building:")
    for name, n in all_child_tags.most_common(20):
        print(f"    {name:30s} {n}")


if __name__ == "__main__":
    for aoi in sys.argv[1:] or ["oberstdorf", "tegelberg"]:
        probe(aoi)

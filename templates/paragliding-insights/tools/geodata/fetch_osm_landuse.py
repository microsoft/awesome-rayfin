"""Fetch land use, land cover and the transport network for an AOI from OpenStreetMap.

The terrain is shaded by elevation alone, which reads as bare stone everywhere. That is wrong for
the Allgäu in a way that matters to this app: the treeline is the single most legible feature on an
Alpine flank, and it is exactly what a pilot reads the ground by. Below it, spruce and pasture;
above it, Latschenkiefer, then rock and scree. This step fetches what is actually growing where, so
the terrain can be tinted by it.

Polygons come from `landuse`, `natural` and `leisure`; the transport network comes from `highway`
and `railway`. Areas arrive both as closed ways and as multipolygon relations — a forest with a
clearing in it is a relation — so both are requested and both are kept, with their inner rings.

Usage
  python tools/geodata/fetch_osm_landuse.py
  python tools/geodata/fetch_osm_landuse.py --aoi <other-aoi> --out data/raw/osm

Licence: OpenStreetMap contributors, ODbL. Attribution is mandatory — see NOTICE.md.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from aoi import bbox_tuple, load_aoi
from overpass_client import overpass

# Only the tags that change how a surface should look. Anything not listed falls through to the
# elevation palette, which is the right default for unmapped ground.
AREA_TAGS = {
    "landuse": [
        "vineyard",
        "orchard",
        "forest",
        "farmland",
        "meadow",
        "grass",
        "allotments",
        "residential",
        "commercial",
        "industrial",
        "retail",
        "cemetery",
        "quarry",
        "village_green",
        "recreation_ground",
        "greenhouse_horticulture",
    ],
    "natural": ["wood", "scrub", "heath", "grassland", "water", "wetland", "bare_rock", "scree"],
    "leisure": ["park", "garden", "pitch", "golf_course"],
}

# Drawn as lines rather than areas. Widths are applied later, in the rasteriser.
LINE_TAGS = {
    "highway": [
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "unclassified",
        "residential",
        "service",
        "living_street",
        "track",
    ],
    "railway": ["rail", "light_rail", "narrow_gauge"],
}


def build_query(bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    b = f"{south},{west},{north},{east}"

    clauses: list[str] = []
    for key, values in AREA_TAGS.items():
        pattern = "|".join(values)
        # Ways and relations both: a wood with a clearing is a multipolygon relation, and dropping
        # relations silently loses some of the largest forests in the AOI.
        clauses.append(f'  way["{key}"~"^({pattern})$"]({b});')
        clauses.append(f'  relation["{key}"~"^({pattern})$"]({b});')
    for key, values in LINE_TAGS.items():
        pattern = "|".join(values)
        clauses.append(f'  way["{key}"~"^({pattern})$"]({b});')

    body = "\n".join(clauses)
    # `out geom` resolves node coordinates inline, including for relation members, so no second
    # round trip is needed to turn ids into geometry.
    return f"[out:json][timeout:280];\n(\n{body}\n);\nout geom;\n"


def classify(tags: dict) -> tuple[str, str] | None:
    """Return the (key, value) this element is kept for, preferring areas over lines."""
    for key, values in AREA_TAGS.items():
        value = tags.get(key)
        if value in values:
            return key, value
    for key, values in LINE_TAGS.items():
        value = tags.get(key)
        if value in values:
            return key, value
    return None


def way_geometry(element: dict) -> list[list[tuple[float, float]]]:
    geom = element.get("geometry") or []
    if len(geom) < 2:
        return []
    return [[(p["lon"], p["lat"]) for p in geom]]


def relation_rings(element: dict) -> tuple[list[list[tuple[float, float]]], list[list[tuple[float, float]]]]:
    """Split a multipolygon relation into outer and inner rings.

    Members arrive as unordered fragments, so rings are stitched by matching endpoints. Fragments
    that never close are still returned — a ring clipped by the AOI boundary is common and useful.
    """
    outers_raw: list[list[tuple[float, float]]] = []
    inners_raw: list[list[tuple[float, float]]] = []
    for member in element.get("members", []):
        geom = member.get("geometry") or []
        if len(geom) < 2:
            continue
        line = [(p["lon"], p["lat"]) for p in geom]
        (inners_raw if member.get("role") == "inner" else outers_raw).append(line)
    return stitch_rings(outers_raw), stitch_rings(inners_raw)


def stitch_rings(fragments: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """Chain fragments end-to-end into closed rings, greedily."""
    pending = [list(f) for f in fragments]
    rings: list[list[tuple[float, float]]] = []

    while pending:
        ring = pending.pop(0)
        extended = True
        while extended and ring[0] != ring[-1]:
            extended = False
            for i, candidate in enumerate(pending):
                if candidate[0] == ring[-1]:
                    ring.extend(candidate[1:])
                elif candidate[-1] == ring[-1]:
                    ring.extend(candidate[::-1][1:])
                elif candidate[-1] == ring[0]:
                    ring = candidate[:-1] + ring
                elif candidate[0] == ring[0]:
                    ring = candidate[::-1][:-1] + ring
                else:
                    continue
                pending.pop(i)
                extended = True
                break
        if len(ring) >= 3:
            rings.append(ring)
    return rings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument("--out", type=Path, default=Path("data/raw/osm"))
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    bbox = bbox_tuple(cfg)

    print(f"AOI {cfg['id']}  bbox(S,W,N,E)={bbox}")
    print("querying Overpass for land use and the transport network...")
    result = overpass(build_query(bbox))
    elements = result.get("elements", [])
    print(f"  {len(elements)} elements returned")

    areas: list[dict] = []
    lines: list[dict] = []
    counts: dict[str, int] = {}

    for element in elements:
        tags = element.get("tags", {})
        hit = classify(tags)
        if hit is None:
            continue
        key, value = hit
        label = f"{key}={value}"

        if key in LINE_TAGS:
            for ring in way_geometry(element):
                lines.append({"class": label, "coords": ring, "surface": tags.get("surface")})
                counts[label] = counts.get(label, 0) + 1
            continue

        if element["type"] == "relation":
            outers, inners = relation_rings(element)
            if not outers:
                continue
            areas.append({"class": label, "outers": outers, "inners": inners})
        else:
            outers = way_geometry(element)
            if not outers or len(outers[0]) < 3:
                continue
            areas.append({"class": label, "outers": outers, "inners": []})
        counts[label] = counts.get(label, 0) + 1

    args.out.mkdir(parents=True, exist_ok=True)
    payload = {
        "aoi": cfg["id"],
        "attribution": "© OpenStreetMap contributors (ODbL)",
        "note": (
            "Land cover as currently mapped in OpenStreetMap, not as it stood in July 2021. "
            "It is used for surface colour only and takes no part in the simulation."
        ),
        "counts": counts,
        "areas": areas,
        "lines": lines,
    }
    target = args.out / cfg["id"] / "landuse.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload), encoding="utf-8")

    print(f"\n  {len(areas)} areas, {len(lines)} line segments")
    for label, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"    {label:<34} {count}")
    print(f"\nwrote {target} ({target.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()

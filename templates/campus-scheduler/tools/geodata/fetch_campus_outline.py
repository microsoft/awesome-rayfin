"""Fetch the campus outlines a site's own institutions publish in OpenStreetMap.

WHY THIS EXISTS
---------------
`building_class.wall_class` decides how ~70 % of a building's visible surface is painted, and it
decides it from the cadastre. At OTH that works: the university's buildings carry ALKIS
`31001_3020` "Schule, Fachhochschule". At Tuebingen it works too, through the finer LGL codes
(`31001_3023`/`3024` are named `Institut fuer Hirnforschung`, `Alte Anatomie`).

**At TUM Garching it fails, and it fails on the biggest buildings in the view.** Measured on the
353 buildings inside the AOI: 92 of them carry `31001_9998` "unspecified" at a median of 587 m2,
and the single largest building on screen — 18 830 m2 — is one of them. Painted from the cadastre
alone, the research campus reads as a housing estate. That is exactly the LMU failure recorded in
lod2_building_colour.md §12.2, and the answer there is the answer here: **evidence from a second,
independent, measured source rather than a guess about a code that says nothing.**

OpenStreetMap carries that evidence as area features — `amenity=university`,
`amenity=research_institute`, `landuse=education` — each with a name and usually an operator. A
building whose centroid falls inside the Technische Universitaet Muenchen outline is a university
building whatever the cadastre declines to say about it.

WHAT THIS IS NOT
----------------
⚠️ **This is not for every site, and running it everywhere would make things worse.** Tuebingen's
university is threaded through a medieval town; there is no campus outline to fall inside, and
anything shaped like one would sweep in private housing and paint the old town as institutional.
A site uses this only where a campus genuinely exists as a fenced, mapped place. Absence of
`config/campus-<aoi>.json` is the normal case.

Output: `config/campus-<aoi>.json`, read by `build_lod2_mesh.institutional_rings`.

Usage
    python tools/geodata/fetch_campus_outline.py --aoi garching
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from aoi import bbox_tuple, load_aoi
from overpass_client import overpass
from utm import wgs84_to_utm32

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"

#: The tags that mark a place as belonging to a university or a research institution. Kept narrow
#: on purpose: `landuse=education` already includes schools and kindergartens, which the cadastre
#: classifies correctly on its own, so nothing is gained by widening this further.
AREA_TAGS = (
    ("amenity", "university"),
    ("amenity", "research_institute"),
    ("landuse", "education"),
)

#: Below this an "outline" is a single building or a signpost node's fallback area rather than a
#: campus, and treating it as ownership evidence would classify its neighbours by accident.
MIN_AREA_M2 = 2000.0


def ring_area_m2(ring: list[list[float]]) -> float:
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    if len(pts) < 3:
        return 0.0
    total = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        total += x1 * y2 - x2 * y1
    return abs(total) * 0.5


def rings_of(element: dict) -> list[list[list[float]]]:
    """Every closed outer ring of a way or relation, in UTM32 metres.

    ⚠️ `out geom` rather than `out tags geom` — the latter returns relations with ZERO members and
    the loss is silent (recorded in campus_scheduler.md; it cost the OTH build its three largest
    faculty buildings).
    """
    rings: list[list[list[float]]] = []
    if element["type"] == "way":
        geometry = element.get("geometry") or []
        if len(geometry) >= 4:
            rings.append([list(wgs84_to_utm32(p["lon"], p["lat"])) for p in geometry])
    elif element["type"] == "relation":
        for member in element.get("members", []):
            if member.get("role") not in ("outer", ""):
                continue
            geometry = member.get("geometry") or []
            if len(geometry) >= 4:
                rings.append([list(wgs84_to_utm32(p["lon"], p["lat"])) for p in geometry])
    return rings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="garching")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    south, west, north, east = bbox_tuple(cfg, "core")
    box = f"{south},{west},{north},{east}"
    clauses = "\n  ".join(f'way["{k}"="{v}"]({box});\n  relation["{k}"="{v}"]({box});' for k, v in AREA_TAGS)
    data = overpass(f"[out:json][timeout:180];\n(\n  {clauses}\n);\nout geom;")

    records: list[dict] = []
    rejected: list[str] = []
    for element in data["elements"]:
        tags = element.get("tags", {})
        for ring in rings_of(element):
            area = ring_area_m2(ring)
            label = f"{element['type']}/{element['id']} {tags.get('name', '(unnamed)')}"
            if area < MIN_AREA_M2:
                rejected.append(f"{label} — {area:.0f} m2, under the {MIN_AREA_M2:.0f} m2 floor")
                continue
            records.append(
                {
                    "osmId": f"{element['type']}/{element['id']}",
                    "name": tags.get("name"),
                    "operator": tags.get("operator"),
                    "tag": next((f"{k}={v}" for k, v in AREA_TAGS if tags.get(k) == v), None),
                    "areaM2": round(area, 1),
                    "polygonUtm32": [[round(e, 2), round(n, 2)] for e, n in ring],
                }
            )

    if not records:
        raise SystemExit(
            f"no campus outline found in the {args.aoi} core — this site has no mapped campus, "
            "which is a fact about the place and not a failure. Do not write an empty file."
        )

    records.sort(key=lambda r: -r["areaM2"])
    out = CONFIG_DIR / f"campus-{cfg['id']}.json"
    out.write_text(
        json.dumps(
            {
                "aoi": cfg["id"],
                "purpose": (
                    "Campus outlines used as ownership evidence for the wall class, where the "
                    "cadastre's function code does not say what a building is. See the module "
                    "note in tools/geodata/fetch_campus_outline.py."
                ),
                "source": "OpenStreetMap contributors",
                "licence": "ODbL 1.0",
                "attribution": "© OpenStreetMap contributors, ODbL 1.0",
                "crs": "EPSG:25832",
                "count": len(records),
                "buildings": records,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"{len(records)} campus outlines, {sum(r['areaM2'] for r in records) / 1e4:.1f} ha total")
    for record in records:
        print(f"  {record['areaM2']:>10.0f} m2  {record['osmId']:<16} {record['name']}")
    for note in rejected:
        print(f"  rejected: {note}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()

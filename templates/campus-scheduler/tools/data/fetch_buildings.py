"""Fetch the REAL university buildings the synthetic timetable will hang off.

PLAN §5.4 and the honesty rule. The timetable is invented; the buildings must not be. If a
synthetic room says it is in "Building K", something called K has to exist at a real coordinate
inside a real campus, or the 3D twin cannot colour it and the whole exercise becomes a diagram.

So this asks Overpass for every mapped building inside the campus boxes, keeps what it finds —
OSM id, name, centroid, storey count, footprint area — and writes it to the site's buildings
file. Nothing here is generated. What OSM does not know (a storey count for an unnamed shed)
stays null rather than being filled in.

⚠️ THE OWNERSHIP TEST IS PER-UNIVERSITY, and it is the part that has gone wrong most often.
OTH occupies two fenced campuses, so a point-in-polygon test against its campus outlines is most
of the answer. LMU does not: it is an urban university whose faculties stand in ordinary Munich
streets between the Alte Pinakothek and the Staatsbibliothek, and no polygon separates them.
What LMU has instead is an OSM **site relation** (relation/6441069, wikidata Q55044) listing its
buildings. An AOI therefore declares HOW to recognise its buildings, in an `ownership` block, and
this script applies whatever signals that block names.

Usage
  python tools/data/fetch_buildings.py --site oth
  python tools/data/fetch_buildings.py --site lmu
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "geodata"))
sys.path.insert(0, str(ROOT / "tools" / "data"))
from sites import add_site_argument, load_site  # noqa: E402
from utm import wgs84_to_utm32  # noqa: E402

OVERPASS_MIRRORS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)
USER_AGENT = "Campus-Scheduler/0.1 (open geodata pipeline; +https://geodaten.bayern.de)"

# Set in main() from --site. Module-level so the helpers below read like the original single-site
# script; the alternative was threading the site through eight signatures for no gain.
SITE = load_site("oth")
AOI: dict = SITE.aoi()
OUT: Path = SITE.buildings


def overpass(query: str, attempts: int = 3, timeout: int = 180) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for attempt in range(attempts):
        for endpoint in OVERPASS_MIRRORS:
            try:
                request = urllib.request.Request(
                    endpoint, data=body, headers={"User-Agent": USER_AGENT}
                )
                with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                    return json.loads(response.read())
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
                last = exc
                print(f"  {endpoint.split('/')[2]}: {exc}")
        wait = 15 * (attempt + 1)
        print(f"  attempt {attempt + 1} failed on every mirror — retrying in {wait}s")
        time.sleep(wait)
    raise RuntimeError(f"Overpass failed: {last}")


def footprint_area_m2(geometry: list[dict]) -> float:
    """Shoelace area in square metres, via UTM32 so the units are real."""
    pts = [wgs84_to_utm32(p["lon"], p["lat"]) for p in geometry]
    if len(pts) < 3:
        return 0.0
    area = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def centroid(geometry: list[dict]) -> tuple[float, float]:
    lat = sum(p["lat"] for p in geometry) / len(geometry)
    lon = sum(p["lon"] for p in geometry) / len(geometry)
    return lat, lon


def point_in_ring(lat: float, lon: float, ring: list[tuple[float, float]]) -> bool:
    """Ray casting. Plain geometry, no dependency, and exact enough at campus scale."""
    inside = False
    n = len(ring)
    for i in range(n):
        y1, x1 = ring[i]
        y2, x2 = ring[(i + 1) % n]
        if (y1 > lat) != (y2 > lat):
            x_at = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if x_at > lon:
                inside = not inside
    return inside


def ownership() -> dict:
    """How this university's buildings are recognised.

    Declared in the AOI so the rule is visible next to the coordinates it applies to. The default
    is OTH's original behaviour, unchanged: campus outlines from `campuses[].anchorSource`, the
    published building letters, and an `operator` tag naming the university.
    """
    default = {
        "outlineIds": [c["anchorSource"].split()[1] for c in AOI["campuses"]],
        "siteRelations": [],
        "operatorPattern": "ostbayerische technische hochschule",
        "namePattern": None,
        "extraIds": [],
    }
    return {**default, **AOI.get("ownership", {})}


def fetch_campus_outlines(ids: list[str]) -> list[list[tuple[float, float]]]:
    """The actual campus outlines, as rings.

    ⚠️ THIS IS WHY THE FUNCTION EXISTS. A first run selected buildings by campus BBOX and
    happily returned the Goethe-Gymnasium, the Barmherzige-Brüder hospital, a Rotkreuzheim, a
    company called Vector Informatik, and a row of Universität Regensburg buildings (Vielberth,
    UNIkato, Philosophie/Theologie). The AOI config already warned about exactly this — 'filter
    by the OTH relations, never by proximity' — and the bbox approach walked into it anyway.
    Synthetic lectures scheduled into a hospital would have been an excellent way to lose a
    customer's trust in one screenshot.

    Returns ONE flat list of rings rather than a per-campus mapping. For OTH the two are
    equivalent — its campuses are 2.5 km apart, so no building can fall in the other one's ring —
    but "inside ANY university outline" is the question actually being asked, and a site whose
    outlines interleave (LMU's do) would quietly get the wrong answer from the per-campus form.
    """
    if not ids:
        return []
    parts = []
    for raw in ids:
        kind, _, oid = raw.partition("/")
        parts.append(f"{kind}({oid});")
    data = overpass(f"[out:json][timeout:180];({''.join(parts)});out geom;")

    rings: list[list[tuple[float, float]]] = []
    for el in data.get("elements", []):
        if el["type"] == "way" and el.get("geometry"):
            rings.append([(p["lat"], p["lon"]) for p in el["geometry"]])
        elif el["type"] == "relation":
            for member in el.get("members", []):
                if member.get("geometry") and member.get("role") in ("outer", ""):
                    rings.append([(p["lat"], p["lon"]) for p in member["geometry"]])
    print(f"  {len(rings)} outline ring(s) from {', '.join(ids)}")
    return rings


def fetch_site_relation_members(ids: list[str]) -> set[str]:
    """Which OSM objects the university's own site relation claims.

    This is what replaces the polygon test for a university with no fence. `relation/6441069` is
    tagged `type=site`, `amenity=university`, `wikidata=Q55044` and lists 75 members — an
    explicit statement of membership by the people who mapped it, which beats any geometric
    heuristic over a city centre.

    ⚠️ Read the member list, then resolve nothing: the refs ARE the answer, and the recursive
    form (`relation(id);>>;out;`) 504s on both mirrors for a relation this size.
    """
    members: set[str] = set()
    for raw in ids:
        kind, _, oid = raw.partition("/")
        data = overpass(f"[out:json][timeout:180];{kind}({oid});out body;")
        for el in data.get("elements", []):
            for m in el.get("members", []):
                members.add(f"{m['type']}/{m['ref']}")
    print(f"  {len(members)} member(s) claimed by {', '.join(ids) or '(no site relation)'}")
    return members


def fetch_campus(campus: dict) -> list[dict]:
    """Every mapped building in a campus box — ways AND relations.

    ⚠️ RELATIONS ARE NOT OPTIONAL HERE. This query was `way["building"]` only, and the effect was
    invisible because it returned 300+ buildings per box and looked complete. But OSM maps larger
    or courtyard-shaped buildings as multipolygon RELATIONS, and at OTH that is precisely the set
    that matters: Fakultät Informatik und Mathematik (relation/18374230), Fakultät Maschinenbau
    (relation/59801) and Seminargebäude (relation/59800) were all missing from the "complete"
    building list. The IM faculty is Gebäude K — the one building with surveyed indoor rooms — so
    the omission quietly removed the entire basis for the exploding-building feature.
    """
    b = campus["bbox"]
    box = f"{b['south']},{b['west']},{b['north']},{b['east']}"
    # ⚠️ `out geom;` — NOT `out tags geom;`. For a WAY the two behave the same, which is why this
    # went unnoticed, but for a RELATION `out tags` means "tags only" and Overpass returns the
    # object with ZERO members. The relation came back, passed the name filter, and was then
    # discarded for having no geometry. Verified directly against relation/18374230: with
    # `out tags geom` it reports 0 members; the tags alone prove it is the right object
    # (`building=college`, `building:levels=3`, `operator=Ostbayerische Technische Hochschule
    # Regensburg`). Same family as the `out tags center bounds` 400 hit earlier in this project.
    query = f"""
    [out:json][timeout:180];
    (
      way["building"]({box});
      relation["building"]({box});
    );
    out geom;
    """
    data = overpass(query)

    rows: list[dict] = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})

        if el["type"] == "way":
            geom = el.get("geometry")
        else:
            # Multipolygon: take the largest OUTER ring as the footprint. Inner rings are
            # courtyards and holes; using one of those as the outline would put the building
            # inside its own hole. An empty role counts as outer — mappers omit it often enough
            # that requiring the literal string drops real buildings.
            outers = [
                m["geometry"]
                for m in el.get("members", [])
                if m.get("geometry")
                and m.get("role") in ("outer", "", "outline")
                and len(m["geometry"]) >= 3
            ]
            geom = max(outers, key=footprint_area_m2) if outers else None

        if not geom or len(geom) < 3:
            continue

        area = footprint_area_m2(geom)
        lat, lon = centroid(geom)
        levels = tags.get("building:levels")
        rows.append(
            {
                "osmId": f"{el['type']}/{el['id']}",
                "campusId": campus["id"],
                "name": tags.get("name"),
                "buildingTag": tags.get("building"),
                # OTH tags its own buildings with `operator`. A third, independent way to tell an
                # OTH building from a neighbour that happens to stand nearby.
                "operator": tags.get("operator"),
                "ref": tags.get("ref"),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "footprintM2": round(area),
                # ⚠️ null, not a guess. A storey count nobody surveyed is not a storey count.
                "levels": int(levels) if levels and levels.isdigit() else None,
                "heightM": float(tags["height"]) if tags.get("height", "").replace(".", "", 1).isdigit() else None,
                # The real outline in metres. Generated room layouts are laid out inside THIS,
                # so a synthetic interior still sits in a building of the right shape — an
                # earlier version stored only the centroid and area, which is enough to count
                # rooms and not nearly enough to draw them.
                "polygonUtm32": [
                    [round(x, 2), round(y, 2)]
                    for x, y in (wgs84_to_utm32(p["lon"], p["lat"]) for p in geom)
                ],
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    add_site_argument(parser)
    args = parser.parse_args()

    global SITE, AOI, OUT
    SITE = load_site(args.site)
    AOI = SITE.aoi()
    OUT = SITE.buildings

    own = ownership()
    print(f"=== {SITE.label}: campus outlines ===")
    rings = fetch_campus_outlines(own["outlineIds"])
    time.sleep(3)

    claimed: set[str] = set()
    if own["siteRelations"]:
        print(f"=== {SITE.label}: site relation membership ===")
        claimed = fetch_site_relation_members(own["siteRelations"])
        time.sleep(3)

    # ⚠️ THE POLYGON TEST ALONE IS NOT ENOUGH, and this cost the demo its best building. At OTH
    # each campus contributes ONE OSM outline — Seybothstraße 2 for Galgenberg — but the
    # Galgenberg campus is spread over four addresses (Seybothstraße 2, Galgenbergstraße 30 and
    # 32, Universitätsstraße 31). So the Fakultät Informatik und Mathematik, which is Gebäude K
    # at Galgenbergstraße 32, fell OUTSIDE the single Seybothstraße polygon and was discarded as
    # "not OTH" — taking with it the ONLY 28 rooms anyone has mapped indoors.
    #
    # A building the university itself lists by letter is a university building wherever it
    # stands, so the published name list is a second, independent way in. Union, not intersection.
    letters = SITE.read_json(SITE.letters, {}) or {}
    published_names = set(letters.get("osmNameToLetter", {}))

    operator_pattern = (own.get("operatorPattern") or "").lower()
    name_pattern = re.compile(own["namePattern"]) if own.get("namePattern") else None
    # An explicit allow-list, for the buildings no general signal can reach. It is deliberately
    # narrow and every entry has to justify itself in the AOI config — see LMU's relation/116031,
    # which is unnamed, has no operator and is not in the site relation, yet holds 526 of the 952
    # mapped rooms in the whole core.
    extra_ids = set(own.get("extraIds") or [])

    all_rows: list[dict] = []
    # ⚠️ CAMPUS BOXES MAY OVERLAP, and at OTH they now do: TechBase is 305 m from Seybothstraße, so
    # its box sits inside the Seybothstraße one. Without this, every building in the overlap is
    # fetched twice and lands in the dataset twice under two different `campusId`s — duplicate room
    # ids, doubled floor area, a building drawn on top of itself. The same family as the 125
    # duplicate roomIds the validator caught at LMU, and cheaper to prevent than to detect.
    #
    # A building belongs to the campus whose ANCHOR is nearest, which is deterministic and does not
    # depend on the order campuses happen to be listed in.
    seen: dict[str, dict] = {}
    for campus in AOI["campuses"]:
        print(f"\n=== {campus['id']} ===")
        rows = fetch_campus(campus)
        for r in rows:
            in_outline = any(point_in_ring(r["lat"], r["lon"], ring) for ring in rings)
            by_name = (r["name"] or "") in published_names
            # The university's own statement of ownership, in whichever form it makes it: an
            # `operator` tag (OTH does this) or membership of its OSM site relation (LMU does).
            # Both beat a polygon test and a name lookup.
            by_operator = bool(
                operator_pattern and operator_pattern in (r.get("operator") or "").lower()
            )
            by_relation = r["osmId"] in claimed
            by_pattern = bool(name_pattern and name_pattern.search(r["name"] or ""))
            signals = (
                ("outline", in_outline),
                ("published name", by_name),
                ("operator tag", by_operator),
                ("site relation", by_relation),
                ("name", by_pattern),
                ("allow-list", r["osmId"] in extra_ids),
            )
            r["isUniversityBuilding"] = any(ok for _, ok in signals)
            r["evidence"] = "+".join(x for x, ok in signals if ok) or None
            if SITE.id == "oth":
                # The original key names, kept so an OTH re-run stays diff-comparable against the
                # committed config/buildings-oth.json. New sites get the neutral names only.
                r["insideOthOutline"] = r["isUniversityBuilding"]
                r["othEvidence"] = r["evidence"]
        inside = sum(1 for r in rows if r["isUniversityBuilding"])
        by_name_only = sum(1 for r in rows if r["evidence"] == "published name")
        print(
            f"  {len(rows)} mapped buildings in the box, {inside} are {SITE.label} "
            f"({by_name_only} by published name alone)"
        )

        anchor = campus["anchor"]
        duplicates = 0
        for r in rows:
            if r["osmId"] in seen:
                duplicates += 1
                continue
            seen[r["osmId"]] = r
        if duplicates:
            print(f"  {duplicates} of those were already returned for another campus box")
        time.sleep(3)

    all_rows = list(seen.values())

    # ⚠️ ASSIGN THE CAMPUS FROM WHERE THE BUILDING IS, NOT FROM WHICH QUERY RETURNED IT. An
    # Overpass bbox query returns everything that INTERSECTS the box, so the 92 x 60 m TechBase
    # box also returned Fakultät Maschinenbau — 8,146 m², the largest OTH building, whose
    # footprint clips the corner. Keying the decision on the query box handed the flagship
    # Galgenberg building to a tech park it merely touches. Two earlier attempts got this wrong in
    # two different ways (nearest anchor in DEGREES, then smallest QUERY box), so the rule is now
    # stated in terms of the building's own position:
    #
    #   1. the smallest campus box that actually CONTAINS the centroid wins — a tight box drawn
    #      around one tenancy expresses more intent than a large campus box that overlaps it;
    #   2. if no box contains it, the nearest anchor in METRES wins — longitude at 49°N is 0.656
    #      of a degree of latitude, and ignoring that flipped Bauingenieurwesen by 8 m.
    def campus_for(row: dict) -> str:
        containing = []
        for c in AOI["campuses"]:
            bb = c["bbox"]
            if bb["south"] <= row["lat"] <= bb["north"] and bb["west"] <= row["lon"] <= bb["east"]:
                area = ((bb["north"] - bb["south"]) * 111_320) * (
                    (bb["east"] - bb["west"]) * 111_320 * math.cos(math.radians(row["lat"]))
                )
                containing.append((area, c["id"]))
        if containing:
            return min(containing)[1]
        best = None
        for c in AOI["campuses"]:
            a = c["anchor"]
            dy = (row["lat"] - a["lat"]) * 111_320
            dx = (row["lon"] - a["lon"]) * 111_320 * math.cos(math.radians(row["lat"]))
            d = math.hypot(dx, dy)
            if best is None or d < best[0]:
                best = (d, c["id"])
        return best[1]

    moved = 0
    for r in all_rows:
        assigned = campus_for(r)
        if assigned != r["campusId"]:
            moved += 1
        r["campusId"] = assigned
    if moved:
        print(f"\n{moved} buildings reassigned to the campus their centroid actually sits in")

    # Teaching buildings are the ones big enough to hold a lecture. The threshold is a judgement,
    # not a measurement, so it is stated rather than hidden: below ~250 m² a footprint is a shed,
    # a substation or a bike shelter, and no timetable is going to put 60 students in it.
    TEACHING_MIN_M2 = 250
    owned = [
        r for r in all_rows if r["isUniversityBuilding"] and r["footprintM2"] >= TEACHING_MIN_M2
    ]

    print(f"\n{len(all_rows)} buildings in the campus boxes")
    print(f"{sum(1 for r in all_rows if r['isUniversityBuilding'])} belong to {SITE.label}")
    print(f"{len(owned)} of those at or above {TEACHING_MIN_M2} m² — the teaching candidates\n")
    for r in sorted(owned, key=lambda r: -r["footprintM2"]):
        print(
            f"  {r['campusId']:<11} {r['footprintM2']:>6} m²  "
            f"levels={str(r['levels']):<5} {(r['name'] or '(unnamed)')[:55]}"
        )

    rejected = [
        r
        for r in all_rows
        if not r["isUniversityBuilding"] and r["name"] and r["footprintM2"] >= 1500
    ]
    print(f"\n{len(rejected)} large NAMED buildings rejected as not {SITE.label}, e.g.:")
    for r in sorted(rejected, key=lambda r: -r["footprintM2"])[:10]:
        print(f"  {r['footprintM2']:>6} m²  {r['name'][:60]}")

    payload = {
        "$comment": (
            "REAL buildings, fetched from OpenStreetMap on the date below. Nothing here is "
            "generated. The synthetic timetable anchors its rooms to these, so that a room the "
            "cockpit colours corresponds to a building the twin actually renders. `levels` and "
            "`heightM` are null where OSM does not know them — that is a fact about the map, and "
            "the room generator has to cope with it rather than have it filled in here."
        ),
        "$filterComment": (
            "`isUniversityBuilding` is a UNION of independent signals, never a bbox test, and "
            "`evidence` records which ones fired for each row. The first OTH run used the bbox "
            "and returned the Goethe-Gymnasium, the Barmherzige-Brüder hospital and several "
            "Universität Regensburg buildings — a campus sits inside a mixed-use city and "
            "proximity means nothing. Only rows with isUniversityBuilding=true may carry "
            "teaching rooms."
        ),
        "site": SITE.id,
        "signals": {
            "outlineIds": own["outlineIds"],
            "siteRelations": own["siteRelations"],
            "operatorPattern": own.get("operatorPattern"),
            "namePattern": own.get("namePattern"),
            "extraIds": sorted(extra_ids),
        },
        "source": "OpenStreetMap contributors, ODbL",
        "fetchedOn": time.strftime("%Y-%m-%d"),
        "teachingMinM2": TEACHING_MIN_M2,
        "counts": {
            "inBoxes": len(all_rows),
            "isUniversityBuilding": sum(1 for r in all_rows if r["isUniversityBuilding"]),
            "teachingCandidates": len(owned),
        },
        "buildings": sorted(all_rows, key=lambda r: (r["campusId"], -r["footprintM2"])),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()

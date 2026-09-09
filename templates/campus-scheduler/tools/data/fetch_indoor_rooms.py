"""Fetch the real indoor room polygons OSM does have, with geometry.

A probe can count rooms; only a polygon can be exploded. This pulls the outlines.

WHAT EACH SITE ACTUALLY HAS — both numbers measured, and they are nothing alike:

  **OTH Regensburg** — 29 rooms, all in **Gebäude K, the Fakultät Informatik und Mathematik**
  (refs K 001 … K 018, which the published campus plan confirms is the IM faculty building at
  Galgenbergstraße 32), all on level 0. That is one of the two faculties this dataset models, so
  the exploding-building demo can open on real geometry instead of a generated approximation.

  **LMU München** — 952 rooms inside the core box, of which **527 are LMU's**. 526 of those are
  a single building, the Institut für Informatik at Oettingenstraße 67, on three levels. The
  remainder belong to TUM, whose Stammgelände is 700 m from LMU's Hauptgebäude, plus the Mensa
  and the Bayerische Staatsbibliothek.

⚠️ THAT DIFFERENCE IS WHY `attributeToBuildings` EXISTS. At OTH everything mapped inside the
campus boxes is OTH's, so "every indoor=room in the box" is a correct filter. In Munich the same
filter hands LMU 425 of TUM's rooms, and the app would colour a competitor's lecture halls with
LMU's timetable. Where the flag is set in the AOI, a room is kept only if its centroid falls
inside a building the site's own ownership test already accepted
(`config/buildings-<site>.json`), and the containing building is recorded on the room.

Everything written here is MEASURED. The generated plates for the other buildings live in a
different file and are badged differently, on purpose.

    python tools/data/fetch_indoor_rooms.py --site oth
    python tools/data/fetch_indoor_rooms.py --site lmu
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "geodata"))
sys.path.insert(0, str(ROOT / "tools" / "data"))
from sites import add_site_argument, is_university_building, load_site  # noqa: E402
from utm import wgs84_to_utm32  # noqa: E402

OVERPASS_MIRRORS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)
USER_AGENT = "Campus-Scheduler/0.1 (open geodata pipeline; +https://geodaten.bayern.de)"


def overpass(query: str, attempts: int = 3) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for attempt in range(attempts):
        for endpoint in OVERPASS_MIRRORS:
            try:
                req = urllib.request.Request(endpoint, data=body, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=180) as r:  # noqa: S310
                    return json.loads(r.read())
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
                last = exc
                print(f"  {endpoint.split('/')[2]}: {exc}")
        time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"Overpass failed: {last}")


def shoelace_m2(pts: list[tuple[float, float]]) -> float:
    if len(pts) < 3:
        return 0.0
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


_REF_BASEMENT = re.compile(r"^(?:[A-Z])?U(\d{1,3})")
_REF_FLOOR = re.compile(r"^(?:[A-Z])?(\d{3})")


def level_from_ref(ref: str) -> int | None:
    """The floor a room number implies, or None.

    ⚠️ A DERIVATION, AND IT IS EVIDENCED RATHER THAN ASSUMED. 494 of LMU's 526 surveyed rooms
    carry NO OSM `level` tag, and a room without a floor cannot be placed in an exploded building
    — so without this, 94% of the only real interior on the site would be silently discarded and
    replaced by generated plates. The rule is the German room-numbering convention: the hundreds
    digit is the storey ('A 001' ground, 'A 105' first) and a U prefix is the Untergeschoss
    ('H U101'). It was CHECKED against the 32 rooms that do carry a tag and agreed with **32 of
    32** (temp/lmu_level_rule.py). A rule that agrees with nothing measurable is a guess; this one
    agrees with everything measurable.

    ⚠️ THE SPACE-STRIPPING IS LOAD-BEARING, and leaving it out is how this was first written.
    Refs come in three shapes — 'A 001', '075' and 'H U101' — and a pattern anchored on the raw
    string cannot see past the space in the third. The first production version matched 55
    basements where the validated rule found 154, i.e. it silently threw away 99 real rooms while
    reporting them as "unresolvable". The discrepancy was only visible because the rule had
    already been measured separately; had it been written straight into the fetcher, 105 rooms
    would have quietly become generated plates.

    Every room that uses this is badged `levelSource: "derived from ref"`, so the twin can never
    present a derived floor as a surveyed one.
    """
    r = (ref or "").strip().upper().replace(" ", "")
    if _REF_BASEMENT.match(r):
        return -1
    m = _REF_FLOOR.match(r)
    return int(m.group(1)) // 100 if m else None


def point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    """Ray casting in UTM metres — both the room and the building outline are already projected."""
    hit = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            x_at = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x_at > x:
                hit = not hit
    return hit


def owning_buildings(site) -> list[dict]:  # noqa: ANN001 - sites.Site
    """The university's own buildings, with their real footprints, to test containment against.

    Raises rather than returning an empty list: empty would drop every room and read exactly like
    "OSM has no indoor data here", which is the one conclusion this file exists to make reliable.
    """
    payload = site.read_json(site.buildings)
    if payload is None:
        raise SystemExit(
            f"{site.buildings} is missing — run tools/data/fetch_buildings.py --site {site.id} "
            "first. Rooms are attributed to real buildings; there is no fallback that guesses."
        )
    owned = [b for b in payload["buildings"] if is_university_building(b) and b.get("polygonUtm32")]
    if not owned:
        raise SystemExit(f"no {site.label} buildings carry a footprint — check fetch_buildings.py")
    print(f"  {len(owned)} {site.label} building footprints to attribute rooms to")
    return owned


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    add_site_argument(parser)
    args = parser.parse_args()

    site = load_site(args.site)
    aoi = site.aoi()
    attribute = bool(aoi.get("indoorProbe", {}).get("attributeToBuildings"))

    owned: list[dict] = []
    if attribute:
        print(f"=== {site.label}: buildings to attribute against ===")
        owned = owning_buildings(site)

    rooms: list[dict] = []
    rejected: Counter = Counter()
    out_of_range = 0
    for campus in aoi["campuses"]:
        b = campus["bbox"]
        box = f"{b['south']},{b['west']},{b['north']},{b['east']}"
        print(f"=== {campus['id']} ===")
        data = overpass(f'[out:json][timeout:180];way["indoor"="room"]({box});out tags geom;')
        for el in data.get("elements", []):
            geom = el.get("geometry")
            if not geom or len(geom) < 3:
                continue
            tags = el.get("tags", {})
            utm = [wgs84_to_utm32(p["lon"], p["lat"]) for p in geom]
            ref = (tags.get("ref") or "").strip()

            owner: str | None = None
            cand_levels: int | None = None
            if attribute:
                cx = sum(x for x, _ in utm) / len(utm)
                cy = sum(y for _, y in utm) / len(utm)
                for cand in owned:
                    if point_in_ring(cx, cy, cand["polygonUtm32"]):
                        owner = cand["osmId"]
                        cand_levels = cand.get("levels")
                        break
                if owner is None:
                    rejected[campus["id"]] += 1
                    continue

            tagged_level = (
                int(tags["level"]) if str(tags.get("level", "")).lstrip("-").isdigit() else None
            )

            rooms.append(
                {
                    "osmId": f"way/{el['id']}",
                    "campusId": campus["id"],
                    "ref": ref,
                    # "K 001 Großer Hörsaal" -> keep the descriptive part, it is real information
                    "name": (tags.get("name") or "").strip(),
                    # ⚠️ The first token of the ref. At OTH that IS the building ("K 001" is in
                    # Gebäude K). At LMU it is a WING of one building ("L 102" is Trakt L of
                    # Oettingenstraße 67), so it must not be read as a building id there —
                    # `buildingOsmId` is the authoritative link.
                    "buildingLetter": ref.split()[0] if ref else None,
                    "buildingOsmId": owner,
                    "level": tagged_level,
                    "levelSource": "osm level tag" if tagged_level is not None else None,
                    "areaM2": round(shoelace_m2(utm), 1),
                    "polygonUtm32": [[round(x, 2), round(y, 2)] for x, y in utm],
                    "_storeys": cand_levels,
                }
            )
        print(f"  {len([r for r in rooms if r['campusId'] == campus['id']])} indoor rooms with geometry")
        if rejected[campus["id"]]:
            print(
                f"  {rejected[campus['id']]} rejected — mapped inside the box but not inside a "
                f"{site.label} building"
            )
        time.sleep(3)

    # ── The level rule has to earn the right to be applied ───────────────────────────────────
    # ⚠️ THE PRODUCER MUST NOT BE THE ONLY WITNESS. Deriving a floor from a room number is a
    # convention, not a measurement, and a convention that is subtly wrong produces a building
    # whose storeys are confidently misassigned — which looks like data, not like an error. So
    # the rule is scored against the rooms that DO carry a surveyed `level` tag before it is
    # allowed anywhere near the rooms that do not. Perfect agreement or it is not used.
    #
    # This is not theoretical: the first version of the regex matched 55 basements where the
    # separately-validated rule found 154, because it could not see past the space in 'H U101'.
    # It reported the missing 99 as "unresolvable" and would have replaced them with generated
    # plates without a word.
    tagged = [r for r in rooms if r["level"] is not None]
    agree = sum(1 for r in tagged if level_from_ref(r["ref"]) == r["level"])
    derivation_trusted = bool(tagged) and agree == len(tagged)
    if tagged:
        print(
            f"\nlevel rule checked against {len(tagged)} surveyed level tags: "
            f"{agree} agree — {'applying it' if derivation_trusted else 'NOT applying it'}"
        )
    if tagged and not derivation_trusted:
        print(
            f"⚠ the room-number convention disagrees with {len(tagged) - agree} surveyed tag(s), "
            "so it is not trusted for the untagged rooms. They stay unplaced: a floor that is "
            "probably wrong is worse than a floor that is missing."
        )

    for r in rooms:
        storeys = r.pop("_storeys", None) or 0
        if r["level"] is not None or not derivation_trusted:
            continue
        guess = level_from_ref(r["ref"])
        # Bounded by the building it is in: relation/116031 has three storeys, so a ref deriving
        # level 6 (the '664N'/'666P' rooms) is a different numbering scheme, not a sixth floor.
        # Those stay unplaced rather than being put on a phantom storey.
        if guess is not None and -2 <= guess <= max(storeys - 1, 0):
            r["level"] = guess
            r["levelSource"] = "derived from ref"
        elif guess is not None:
            out_of_range += 1
    for r in rooms:
        r.pop("_storeys", None)

    named = [r for r in rooms if r["name"]]
    letters = sorted({r["buildingLetter"] for r in rooms if r["buildingLetter"]})
    by_building = Counter(r["buildingOsmId"] for r in rooms if r["buildingOsmId"])
    by_level_source = Counter(r["levelSource"] for r in rooms)
    placed = sum(1 for r in rooms if r["level"] is not None)
    print(f"\n{len(rooms)} rooms total, ref prefixes seen: {letters}")
    print(
        f"{placed} carry a floor — "
        + ", ".join(f"{n} {src or 'unplaced'}" for src, n in by_level_source.most_common())
    )
    if out_of_range:
        print(
            f"⚠ {out_of_range} refs implied a storey the building does not have and were left "
            "unplaced rather than invented onto a phantom floor"
        )
    if by_building:
        print("rooms per building:")
        for bid, n in by_building.most_common(10):
            print(f"  {n:>4}  {bid}")
    print(f"{len(named)} carry a descriptive name:")
    for r in sorted(named, key=lambda r: r["ref"])[:20]:
        print(f"  {r['ref']:<10} {r['areaM2']:>7.0f} m²  level {r['level']}  {r['name']}")

    payload = {
        "$comment": (
            "MEASURED indoor room polygons from OpenStreetMap (ODbL). This is the only real room "
            "geometry that exists for this site in open data. Everything else in the twin's "
            "interiors is generated and badged synthetic."
        ),
        "$attributionComment": (
            "`buildingOsmId` is the building whose real footprint contains the room's centroid. It "
            "is null only where the AOI did not ask for attribution, which is safe only where the "
            "campus boxes contain no other institution's interiors. In Munich they do — TUM's "
            "Stammgelände is 700 m from LMU's Hauptgebäude — and attribution is the difference "
            "between 527 rooms and 952."
        ),
        "site": site.id,
        "attributedToBuildings": attribute,
        "source": "OpenStreetMap contributors, ODbL",
        "fetchedOn": time.strftime("%Y-%m-%d"),
        "crs": "EPSG:25832",
        "counts": {
            "rooms": len(rooms),
            "withName": len(named),
            "buildingLetters": letters,
            "rejectedNotOwned": sum(rejected.values()),
            "byBuilding": dict(by_building),
            "byLevelSource": {str(k): v for k, v in by_level_source.items()},
            "refImpliedImpossibleStorey": out_of_range,
        },
        "rooms": rooms,
    }
    site.osm_rooms.parent.mkdir(parents=True, exist_ok=True)
    site.osm_rooms.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nwrote {site.osm_rooms}")


if __name__ == "__main__":
    main()

"""Generate the synthetic two-faculty timetable that phases 1-3 are demonstrated on.

PLAN §7 (data model) and §8 phase 0. Everything this writes is INVENTED and is badged as such
in `provenance.json`. What it is NOT allowed to invent is geography: rooms hang off real
university buildings fetched by `fetch_buildings.py`, so a room the cockpit colours corresponds
to a building the twin actually renders, on the campus it actually stands on.

Why two faculties rather than one (a locked decision): with a single faculty, room pressure is
an internal matter and the interesting conflict — two faculties wanting the same large lecture
hall in the same slot — cannot occur at all. Timetablers describe that as the hard part, so the
data has to be able to produce it.

Deterministic: same seed and same profile, same dataset, byte for byte. A demo that reshuffles
itself between runs cannot be discussed.

    python tools/data/generate_timetable.py --site oth
    python tools/data/generate_timetable.py --site lmu --seed 7

Writes one JSON file per table plus provenance.json, ready for the Delta load in tools/fabric/.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterator

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "geodata"))
sys.path.insert(0, str(ROOT / "tools" / "data"))
from sites import add_site_argument, is_university_building, load_site  # noqa: E402
from utm import wgs84_to_utm32  # noqa: E402

# ⚠️ WHAT IS INVENTED IS A FILE, NOT A CONSTANT. Faculties, programmes, subjects, the surname
# pool, the block scheme, which building belongs to whom and how much of a building is teaching
# space all come from `config/academic/<site>.json`. That is what makes a second university an
# entry rather than a fork — and it is not cosmetic: OTH teaches seven 90-minute blocks from
# 08:00 sine tempore, LMU six from 08:15 cum tempore, a 14% difference in weekly capacity before
# a single room is counted. As constants, the second customer would silently have inherited the
# first customer's teaching day.
#
# Everything below is bound in main() from --site. Module level, because nearly every function
# here reads them and threading a site object through twenty signatures would bury the logic.
SITE = load_site("oth")
AOI: dict = SITE.aoi()
PROFILE: dict = {}
BUILDINGS_FILE: Path = SITE.buildings
LETTERS_FILE: Path = SITE.letters
OSM_ROOMS_FILE: Path = SITE.osm_rooms
PLAN_ROOMS_FILE: Path | None = SITE.plan_rooms

# ── The block scheme ────────────────────────────────────────────────────────────────────────
# ⚠️ AN ASSUMPTION PER SITE, not a measurement — OTH's real scheme is open question §9.8 — which
# is exactly why it is configuration. The values here are placeholders; main() overwrites them
# before anything reads them.
DAYS: list[str] = []
BLOCKS: list[tuple[str, str]] = []
# Early and late blocks are the ones everybody avoids. The solver's soft objective needs a number
# to prefer against, and "avoid unpopular slots" is meaningless without one.
DESIRABILITY: list[float] = []

FACULTIES: list[dict] = []
PROGRAMMES: dict[str, list[str]] = {}
COHORT_SEMESTERS: list[int] = []

# Buildings the ownership test correctly accepts but no lecture is ever scheduled into. A
# JUDGEMENT, written down rather than applied silently: at OTH the polygon filter returns the
# Mensa, its Küche, the Musikpavillon and a Parkhaus, and a timetable that puts Thermodynamik in
# the canteen kitchen loses the room on the first slide.
NON_TEACHING: tuple[str, ...] = ()

# seats per m² of room floor, and the plausible area band for that type
ROOM_TYPES = {
    "Hörsaal": {"seatsPerM2": 0.90, "areaM2": (140, 380), "schedulable": True},
    "Seminarraum": {"seatsPerM2": 0.50, "areaM2": (45, 95), "schedulable": True},
    "Übungsraum": {"seatsPerM2": 0.50, "areaM2": (40, 80), "schedulable": True},
    "Labor": {"seatsPerM2": 0.20, "areaM2": (60, 140), "schedulable": True},
    "CIP-Pool": {"seatsPerM2": 0.35, "areaM2": (55, 100), "schedulable": True},
    # ⚠️ NON-TEACHING ROOMS EXIST AND MUST BE MODELLED, even though the timetable never touches
    # them. A first version made every room in every building a teaching room and then reported
    # 6.9% room utilisation — a figure that would have been quoted back at us, and one that is
    # simply false. A university building is mostly offices: the Campus-Insights survey of TUM
    # Garching found 2 918 Büros against 289 teaching rooms in 3 813 mapped rooms. Modelling them
    # fixes two things at once — the building interiors become plausible, and the utilisation
    # denominator becomes the TEACHING stock, which is the only denominator a timetabler cares
    # about.
    "Büro": {"seatsPerM2": 0.10, "areaM2": (14, 34), "schedulable": False},
    "Service": {"seatsPerM2": 0.05, "areaM2": (10, 60), "schedulable": False},
}

COURSE_TYPES = {
    # type            room type      sessions/week  share  group size (None = whole cohort)
    "Vorlesung": ("Hörsaal", 2, 0.30, None),
    "Seminar": ("Seminarraum", 1, 0.20, 30),
    "Übung": ("Übungsraum", 1, 0.26, 34),
    "Praktikum": ("Labor", 1, 0.16, 18),
    "Rechnerübung": ("CIP-Pool", 1, 0.08, 26),
}
# ⚠️ GROUPS ARE NOT A DETAIL, they are the reason timetabling is hard. A first version gave every
# session the FULL cohort headcount and then could not place 265 of 463 sessions, because it was
# trying to fit 239 students into a 28-seat lab. Universities do not do that: the lecture is one
# block of 239, and the Praktikum to go with it runs as 13 parallel groups of 18 — each needing
# its own room, its own slot and its own teacher. That multiplication IS the room shortage.

SUBJECTS: dict[str, list[str]] = {}

# Synthetic surnames. Deliberately a long pool of ordinary Bavarian names combined with a single
# initial: this dataset must never read as a roster of real staff. provenance.json says so and
# the UI badges it. ⚠️ The pool is PER SITE and not merely shuffled — Oberpfalz names for
# Regensburg, Munich ones for LMU — because a second university staffed by the first one's people
# is a tell that nothing behind the names is really different either.
SURNAMES: list[str] = []


def slot_rows() -> list[dict]:
    rows = []
    for d, day in enumerate(DAYS):
        for b, (start, end) in enumerate(BLOCKS):
            rows.append(
                {
                    "slotId": f"{day}-{b + 1}",
                    "day": day,
                    "dayIndex": d,
                    "block": b + 1,
                    "startTime": start,
                    "endTime": end,
                    "desirability": DESIRABILITY[b],
                }
            )
    return rows


def load_buildings() -> list[dict]:
    if not BUILDINGS_FILE.exists():
        raise SystemExit(
            f"{BUILDINGS_FILE} is missing — run tools/data/fetch_buildings.py --site {SITE.id} "
            "first.\nRooms are anchored to REAL buildings on purpose; there is no fallback that "
            "invents them."
        )
    payload = json.loads(BUILDINGS_FILE.read_text(encoding="utf-8"))
    teaching_min = payload["teachingMinM2"]
    rows, skipped = [], []
    for b in payload["buildings"]:
        if not is_university_building(b) or b["footprintM2"] < teaching_min:
            continue
        if any(word in (b["name"] or "").lower() for word in NON_TEACHING):
            skipped.append(b["name"])
            continue
        rows.append(b)
    if skipped:
        print(f"excluded as non-teaching: {', '.join(skipped)}")
    if not rows:
        raise SystemExit(
            f"no {SITE.label} teaching buildings found — check fetch_buildings.py output"
        )
    return rows


def owner_of(building: dict, name: str) -> str:
    """Which faculty a real building belongs to, per the site's ownership rules.

    Rules are evaluated IN ORDER and the first match wins, because that is what the original
    if/elif chain did and the order encodes precedence: a building named after a faculty beats a
    campus-wide default, and a shared lecture hall beats both.

    A rule may test any combination of `nameContains` (any word, case-folded), `nameIs` (an EXACT
    name, case-folded), `campusId`, `minFootprintM2` and `osmIds`; all the conditions a rule
    states must hold. `nameIs` and `osmIds` exist because a building's identity is not always a
    describable string: LMU's Hauptgebäude wings are called exactly "A" … "N", which no substring
    rule can single out without also matching every name containing an A, and Oettingenstraße 67
    — the one building on that site with a surveyed interior — has no name in OSM at all.
    """
    lowered = name.lower()
    ownership = PROFILE["buildingOwnership"]
    for rule in ownership["rules"]:
        tested = False
        words = rule.get("nameContains")
        if words:
            tested = True
            if not any(w in lowered for w in words):
                continue
        exact = rule.get("nameIs")
        if exact:
            tested = True
            if lowered not in {e.lower() for e in exact}:
                continue
        if "campusId" in rule:
            tested = True
            if building["campusId"] != rule["campusId"]:
                continue
        if "minFootprintM2" in rule:
            tested = True
            if building["footprintM2"] < rule["minFootprintM2"]:
                continue
        ids = rule.get("osmIds")
        if ids:
            tested = True
            if building["osmId"] not in ids:
                continue
        if not tested:
            continue  # a rule that tests nothing would swallow every building
        return rule["owner"]
    return ownership["fallback"]


def placeholder_ids(used: set[str]) -> "Iterator[str]":
    """Lower-case building ids we invented, in a stable order, that never run out.

    Lower case is the signal: anywhere in this dataset a lower-case building letter means the
    identifier is ours rather than the university's. Single letters first so a small site reads
    like OTH's, then two-letter pairs — 26 + 676 = 702, against LMU's 81 teaching buildings.
    """
    alphabet = "abcdefghijklmnopqrstuvwxyz"
    for first in alphabet:
        if first not in used:
            yield first
    for first in alphabet:
        for second in alphabet:
            candidate = first + second
            if candidate not in used:
                yield candidate


def building_rows(buildings: list[dict]) -> list[dict]:
    """Real buildings, each given a code letter so rooms can follow the site's own room pattern.

    ⚠️ WHERE THE LETTERS COME FROM DIFFERS BY SITE, and the difference is recorded per row in
    `letterSource` rather than assumed. OTH publishes its building letters (Standorte-und-
    Raumpläne, plus the campus PDF's text layer), so those are used verbatim. LMU has no such
    published list — but eight of its Hauptgebäude wings carry their letter as their OSM *name*
    (A, B, C, D, E, F, M, N), which is a weaker provenance than a PDF and still a measurement
    rather than an invention, so those are used too. Everything else gets a LOWER-CASE
    placeholder, which is what a lower-case letter means anywhere in this dataset: ours, not the
    university's.

    ⚠️ AND A LETTER DOES NOT MEAN THE SAME THING AT BOTH SITES. At OTH it identifies a building
    ('K 001' is in Gebäude K, which stands on its own). At LMU it identifies a WING of the
    Hauptgebäude. The generator can treat them alike — each is its own OSM polygon with its own
    footprint and storey count — but prose about them must not promote a wing to a building.
    See config/lmu-building-letters.json.

    OWNERSHIP is synthetic, and it is the single most load-bearing invention in the dataset: the
    shared lecture halls are what make two faculties compete for the same room, and the faculty
    whose practicals sit at the far campus is what makes a cohort cross the city between blocks.
    Both are the scenarios the product exists to handle. Neither is a claim about anyone's real
    estate. The rules live in `config/academic/<site>.json`.
    """
    rows = []
    used: set[str] = set()

    # ⚠️ PUBLISHED letters, not invented ones, WHERE THEY EXIST. An earlier version assigned OTH
    # letters from the first character of the building name and recorded in provenance.json that
    # "OTH's real letters are not public". They are: the university lists them on its Standorte-
    # und-Raumpläne page and the official campus PDF carries them in its text layer. Inventing an
    # identifier and then documenting the invention as a limitation of the source is the worst of
    # both worlds — it reads as diligence while being wrong. See config/oth-building-letters.json.
    # An absent file is a fact about the university, not an error: LMU has no such list.
    letters = SITE.read_json(LETTERS_FILE, {}) or {}
    name_to_letter: dict[str, str] = letters.get("osmNameToLetter", {})

    ordered = sorted(buildings, key=lambda b: (b["campusId"], -b["footprintM2"]))
    for b in ordered:
        name = b["name"] or f"Gebäude {b['osmId'].split('/')[1][-4:]}"

        published = name_to_letter.get(name)
        if published and published not in used:
            letter = published
            letter_source = "published"
        else:
            # No published letter for this outline. Use a lower-case placeholder so it is
            # obvious at a glance in any table or room code that this one is ours, not theirs.
            #
            # ⚠️ THE ALPHABET RUNS OUT, and it does so silently. OTH has 23 teaching buildings, so
            # single letters always sufficed and the original fell back to a literal "z" once they
            # did not. LMU has 81: every building after the 26th would have been called "z", which
            # collides room codes ("z 001" in four different buildings), and the semantic model
            # would then reject the duplicate key at refresh time — the Campus-Insights failure,
            # reproduced. Placeholders therefore continue "aa", "ab", … which is 702 of them.
            letter = next(placeholder_ids(used))
            letter_source = "placeholder — no published letter matches this outline"
        used.add(letter)

        # ⚠️ SCOPE, not just ownership. Both sites model TWO faculties out of eight (OTH) and
        # eighteen (LMU). Giving all the buildings to those two made OTH's room stock four times
        # the demand and produced an 8.5% utilisation figure — arithmetically correct and
        # completely misleading. Buildings of faculties we do not model come back as `other`:
        # they are REAL, they render in the twin, and they are excluded from the teaching stock
        # entirely. We cannot schedule their rooms and we cannot observe them, so counting them
        # as free capacity would be the same error as painting a room with no calendar 0%
        # instead of grey.
        owner = owner_of(b, name)

        easting, northing = wgs84_to_utm32(b["lon"], b["lat"])
        rows.append(
            {
                "buildingId": letter,
                "letterSource": letter_source,
                "name": name,
                "campusId": b["campusId"],
                "facultyId": owner,
                "osmId": b["osmId"],
                "lat": b["lat"],
                "lon": b["lon"],
                "easting": round(easting, 1),
                "northing": round(northing, 1),
                "footprintM2": b["footprintM2"],
                "levels": b["levels"] or 3,
                "levelsMeasured": b["levels"] is not None,
            }
        )
    return rows


def infer_room_type(name: str, area: float) -> str:
    """Classify a REAL room from what OSM actually calls it.

    Deliberately conservative: only the things the mapper wrote down are used. 'K 001 Großer
    Hörsaal' is a lecture hall because it says so, 'K 006 CIP-Pool' is a computer room because it
    says so, and everything else falls back to size. Guessing a Labor from a room number would be
    inventing usage for a building we can actually see.
    """
    low = name.lower()
    # ⚠️ "horsaal" IS NOT A TYPO GUARD, it is the OCR. The published floor plans are read back by
    # `build_plan_rooms.py`, and the recogniser drops the umlaut: the label under K 001 comes back
    # as "Groberhorsaal". Matching only the correctly-spelled word would classify OTH's largest
    # lecture hall as a Seminarraum on the strength of a diacritic the source never had.
    if "hörsaal" in low or "horsaal" in low:
        return "Hörsaal"
    if "cip" in low or "pool" in low:
        return "CIP-Pool"
    if area < 30:
        return "Büro"
    return "Seminarraum"


def real_rooms_by_building(buildings: list[dict]) -> dict[str, list[dict]]:
    """The measured rooms, grouped by the buildingId they belong to.

    Using surveyed geometry rather than generating over the top is the difference between a twin
    that shows a real floor and one that shows a plausible floor. OTH has one such building
    (Gebäude K, ground floor, 28 rooms); LMU has one too, and it is far richer (Oettingenstraße
    67, three levels, 526 rooms).

    ⚠️ TWO WAYS IN, AND THE OBVIOUS ONE IS WRONG FOR LMU. The original grouped by the ref's
    first letter, because at OTH the letter IS the building: 'K 001' belongs to Gebäude K. At LMU
    the ref letters are WINGS of Oettingenstraße 67 ('L 102' is Trakt L), the building itself is
    unnamed in OSM and therefore carries a lower-case placeholder letter — so a letter match
    would find nothing and all 526 surveyed rooms would vanish without a word, leaving generated
    plates in a building whose interior we actually have. Where the fetcher recorded which
    building contains the room (`buildingOsmId`), that is used; the letter remains the fallback
    for datasets fetched before attribution existed.
    """
    if not OSM_ROOMS_FILE.exists():
        return {}
    payload = json.loads(OSM_ROOMS_FILE.read_text(encoding="utf-8"))
    by_osm_id = {b["osmId"]: b["buildingId"] for b in buildings}
    letters_in_use = {b["buildingId"] for b in buildings}

    grouped: dict[str, list[dict]] = defaultdict(list)
    orphaned = 0
    for r in payload["rooms"]:
        if r.get("level") is None:
            continue
        owner = r.get("buildingOsmId")
        building_id = by_osm_id.get(owner) if owner else None
        if building_id is None:
            letter = r.get("buildingLetter")
            building_id = letter if letter and letter in letters_in_use else None
        if building_id is None:
            orphaned += 1
            continue
        grouped[building_id].append(r)

    kept = sum(len(v) for v in grouped.values())
    print(f"measured rooms  {kept} used across {len(grouped)} building(s), {orphaned} unmatched")
    if kept == 0 and payload["rooms"]:
        # Silence here would mean generated plates quietly replacing surveyed geometry.
        print(
            f"⚠ {len(payload['rooms'])} surveyed rooms were read and NONE could be matched to a "
            "teaching building — check that fetch_indoor_rooms.py ran for this site"
        )
    return grouped


#: Plan rooms this run refused, and why. Written as a table because a room dropped in silence is
#: indistinguishable from a room the extractor never read — and `planRooms.test.ts` holds the
#: contract that every room in `rooms-plan.json` is either USED by the timetable or listed here.
PLAN_ROOMS_REFUSED: list[dict] = []


def _ring_area(poly: list[list[float]]) -> float:
    """Shoelace area, about a LOCAL origin.

    ⚠️ Run on raw UTM the cross products are ~3.9e12 while a building contributes ~1e3, so the
    answer is mostly cancellation error — the same trap that once put a room's centroid 60 m
    outside its own bounding box. Subtracting the first vertex costs nothing and fixes it.
    """
    if len(poly) < 3:
        return 0.0
    ox, oy = poly[0]
    total = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i][0] - ox, poly[i][1] - oy
        x2, y2 = poly[(i + 1) % len(poly)][0] - ox, poly[(i + 1) % len(poly)][1] - oy
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def _ring_centroid(poly: list[list[float]]) -> tuple[float, float]:
    """Area centroid of a ring. Not the vertex mean — a traced outline carries hairline spurs that
    drag the mean off the room, and the two disagreed on 14 of the plan rooms once already.

    ⚠️ THE SHOELACE MUST RUN ABOUT A LOCAL ORIGIN, NOT ABOUT UTM ZERO. `x1·y2 − x2·y1` on a
    Regensburg coordinate is 3.9 × 10¹² and the room's own contribution to it is about 10²; in
    double precision the answer is mostly the cancellation error. Run straight on UTM this put
    K 106's centroid 60 m from its own bounding box, and the containment check that reads it
    declared 42 of 124 published rooms "outside every building" — a georeferencing failure that
    was never in the geometry, only in this arithmetic. Subtracting the first vertex leaves the
    centroid unchanged mathematically and the terms four orders of magnitude smaller.
    """
    n = len(poly)
    ox, oy = poly[0]
    twice_area = cx = cy = 0.0
    for i in range(n):
        x1, y1 = poly[i][0] - ox, poly[i][1] - oy
        x2, y2 = poly[(i + 1) % n][0] - ox, poly[(i + 1) % n][1] - oy
        cross = x1 * y2 - x2 * y1
        twice_area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(twice_area) < 1e-9:
        return sum(p[0] for p in poly) / n, sum(p[1] for p in poly) / n
    return cx / (3 * twice_area) + ox, cy / (3 * twice_area) + oy


def _in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    hit = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def _ring_distance(x: float, y: float, ring: list[list[float]]) -> float:
    """Shortest distance from a point to a ring, so "outside" can be measured, not just flagged."""
    best = float("inf")
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        span = dx * dx + dy * dy
        t = 0.0 if span == 0 else max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / span))
        best = min(best, math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
    return best


def plan_rooms_by_building(buildings: list[dict]) -> tuple[dict[str, list[dict]], str]:
    """The rooms read off the university's own published floor plans, grouped by building.

    ⚠️ THESE ROOMS EXISTED AS PICTURES ONLY. `build_plan_rooms.py` has been carving room outlines
    out of OTH's published CAD sheets for some time, and `build_room_geometry.py` drew them — but
    nothing ever put them in the DATASET, so the twin showed a room the timetable had never heard
    of. It could not be booked, could not be coloured by its occupancy, and the `planRooms` test
    called that decoration. This function is the missing half: a published plan is a room source,
    exactly as the OpenStreetMap survey already is.

    ⚠️ WHERE THE PUBLISHED LETTER IS A BUILDING, IT DECIDES — GEOMETRY DOES NOT GET A VOTE.
    `K 032` is in Gebäude K because that is what OTH calls it, and this dataset has a building K.
    Letting containment answer instead filed six of K's rooms under D, L and I, because the
    published sheet is georeferenced to about a metre and those rooms sit against a party wall.
    Deriving an answer that is already published is how a pipeline invents a fact it was given.

    ⚠️ FOR PRÜFENING THERE IS NO SUCH BUILDING, AND THE ALLOCATION IS INVENTED. OTH publishes the
    whole complex as one plan numbered `P …`. OpenStreetMap has it as six separate polygons, none
    carrying a ref, so this dataset knows them as `a`–`f`. There is no way to have both: either the
    six surveyed outlines are fused into one building nobody surveyed, or the published `P` is
    spread across them. The second invents less — each room goes to the polygon that CONTAINS it,
    or failing that the nearest one, since the extractor has already proved the room is inside the
    complex. The room keeps OTH's own number; what is invented is the claim that `P 172` belongs to
    `Gebäude 0404` rather than to a building called P. That claim is marked, not hidden: every such
    row carries `planBuilding` and `provenance = "plan"`, so the app says "published plan" and the
    card can show the letter on the door next to the building it was filed under.
    """
    if PLAN_ROOMS_FILE is None or not PLAN_ROOMS_FILE.exists():
        return {}, "site"
    payload = json.loads(PLAN_ROOMS_FILE.read_text(encoding="utf-8"))
    rooms = payload.get("rooms", [])
    # ⚠️ IS A PUBLISHED ROOM NUMBER UNIQUE ACROSS THE UNIVERSITY, OR ONLY INSIDE ITS BUILDING?
    # OTH's carry their building letter (`K 001`, `P 172`) and are unique on the site. LMU numbers
    # by Trakt, so `A 001` exists in Oettingenstraße 67 AND in the Hauptgebäude — the same clash
    # that produced 125 duplicate room ids the last time it was assumed away, and that Direct Lake
    # would refuse outright at refresh. The file states which it is; nothing here guesses.
    scope = payload.get("refScope", "site")
    if not rooms:
        return {}, scope

    surveyed = json.loads(BUILDINGS_FILE.read_text(encoding="utf-8"))["buildings"]
    outline_by_osm = {b["osmId"]: b["polygonUtm32"] for b in surveyed if b.get("polygonUtm32")}
    candidates = [
        (b["buildingId"], outline_by_osm[b["osmId"]])
        for b in buildings
        if b["osmId"] in outline_by_osm
    ]
    known = {bid for bid, _ in candidates}

    # ⚠️ A DECLARED MAPPING IS NOT AN INVENTED ONE, and reporting it as invented would be its own
    # small lie. LMU's Raumfinder identifies its buildings by an internal code (`bw7070`), and the
    # extractor records which surveyed polygon that code IS — `relation/116031`, stated in the file
    # it writes. That is a fact about the source, not a guess about geometry, so it is used
    # directly; only a published letter with nothing to bind it to falls through to containment.
    declared = {
        code: next((b["buildingId"] for b in buildings if b["osmId"] == osm_id), None)
        for code, osm_id in (payload.get("buildings") or {}).items()
    }
    declared = {code: bid for code, bid in declared.items() if bid}

    grouped: dict[str, list[dict]] = defaultdict(list)
    unplaced: list[str] = []
    allocated: Counter[tuple[str, str]] = Counter()
    for r in rooms:
        published = r["building"]
        if published in declared:
            grouped[declared[published]].append(r)
            continue
        if published in known:
            grouped[published].append(r)
            continue
        x, y = _ring_centroid(r["polygonUtm32"])
        owner = next((bid for bid, ring in candidates if _in_ring(x, y, ring)), None)
        if owner is None:
            # ⚠️ NEAREST, WITH NO DISTANCE CEILING, AND THE CEILING IS WHAT WAS WRONG. Whether a
            # room belongs to this complex at all was decided by the extractor, which checks every
            # vertex against the footprint the sheet was georeferenced to and drops what escapes.
            # By the time a room arrives here it is inside the building; the only open question is
            # which of the six polygons owns it. A second ceiling here answered a question already
            # answered, and answered it worse — OpenStreetMap's Prüfening mapping is partial, so a
            # room in an unmapped wing sits 21 m from the nearest mapped ring and was thrown away
            # for it, leaving one published room drawn in the twin that the timetable had never
            # heard of. Two gates for one fact is how a pipeline disagrees with itself.
            near = sorted((_ring_distance(x, y, ring), bid) for bid, ring in candidates)
            if not near:
                unplaced.append(r["ref"])
                continue
            owner = near[0][1]
        allocated[(published, owner)] += 1
        grouped[owner].append(r)

    # ⚠️ A FLOOR CANNOT HOLD MORE ROOM THAN THE BUILDING HAS GROUND, AND ONE OF THEM DID.
    #
    # The extractor georeferences a SHEET to ONE building and checks every room vertex against
    # THAT footprint. Prüfening's sheet draws "Gebäude P", a single L-shaped complex that
    # OpenStreetMap maps as six unnamed partial polygons, so the rooms pass the extractor and are
    # then spread across a–f up here by containment. Nothing downstream ever asked whether the
    # polygon each room landed on was big enough to hold it. Measured: building `f` received
    # 442 m² of rooms into a 353 m² footprint — 125 % — plus b 96 %, d 80 %, e 71 %. It is also
    # where the "super weird shapes" came from: a carve that has leaked into the corridors
    # produces 28-metre rooms filling 28 % of their own bounding box.
    #
    # The ceiling is read off the floors this project can actually MEASURE. Seyboth's K, the one
    # building with surveyed rooms to anchor the fit, comes out at 39.3 % and 33.7 %; OTH's real
    # floors run 23–40 %, the rest being corridors, stairs, walls and WCs. 60 % is therefore well
    # clear of every honest floor and well below every broken one — nothing sits near the line.
    #
    # Dropping the ALLOCATION rather than the sheet is deliberate: `a` (33.9 %) and `c` (23.3 %)
    # are plausible and keep their published door numbers. A building that fails falls back to
    # generated rooms, which are square and honestly badged — better than real door numbers on
    # outlines we can prove are in the wrong place.
    # ⚠️ PER FLOOR, NOT PER BUILDING. The first version of this gate summed every level against the
    # one footprint and duly refused K — the CONTROL, the one building whose fit is anchored on 24
    # surveyed rooms — because its two published floors are 39.3 % and 33.7 % and 73 % together.
    # A ceiling calibrated on floors has to be applied to floors.
    #
    # ⚠️ AND ONLY WHERE THE ALLOCATION WAS INVENTED. The second version applied the ceiling to every
    # building and threw away ALL 686 of LMU's plan rooms, whose fit is the best-evidenced in the
    # project — 521 named correspondences, RMS 0.95–1.28 m, rooms landing 0.82–1.40 m from their
    # surveyed twins. Oettingenstraße 67 genuinely runs at 73–76 % because it genuinely is that
    # dense, and a ceiling read off one university's corridors is not a fact about buildings.
    #
    # What actually distinguishes Prüfening is not the number, it is the PROVENANCE OF THE JOIN:
    # its rooms are published under a letter that matches no mapped building, so which polygon owns
    # them is decided up there by containment and is marked "(invented)". K and LMU's `ax` arrive
    # through a published letter or a declared mapping and are not guesses. So the gate asks the
    # ceiling only of the floors whose ownership was guessed — where being wrong is possible.
    MAX_PLAN_COVER = 0.60
    guessed = {owner for _published, owner in allocated}
    footprints = {bid: _ring_area(ring) for bid, ring in candidates}
    by_floor: dict[tuple[str, int], float] = defaultdict(float)
    for bid, rs in grouped.items():
        if bid not in guessed:
            continue
        for r in rs:
            by_floor[(bid, r.get("level", 0))] += r.get("areaM2") or 0.0

    refused_floors = {
        (bid, lvl) for (bid, lvl), area in by_floor.items()
        if footprints.get(bid, 0.0) > 0 and area / footprints[bid] > MAX_PLAN_COVER
    }
    for bid, lvl in sorted(refused_floors):
        foot = footprints[bid]
        print(
            f"⚠ plan rooms refused for building '{bid}' level {lvl}: "
            f"{by_floor[(bid, lvl)]:.0f} m² of rooms in a {foot:.0f} m² footprint "
            f"({by_floor[(bid, lvl)] / foot * 100:.0f}%) — ownership of these rooms was guessed and "
            f"the floor cannot hold them, so the guess is wrong"
        )
    if refused_floors:
        for bid in list(grouped):
            for r in grouped[bid]:
                if (bid, r.get("level", 0)) in refused_floors:
                    PLAN_ROOMS_REFUSED.append({
                        "ref": r["ref"],
                        "publishedBuilding": r["building"],
                        "filedUnder": bid,
                        "level": r.get("level", 0),
                        "areaM2": r.get("areaM2"),
                        "reason": "ownership guessed, and the floor it was filed under cannot hold it",
                    })
            grouped[bid] = [r for r in grouped[bid] if (bid, r.get("level", 0)) not in refused_floors]
            if not grouped[bid]:
                grouped.pop(bid)

    kept = sum(len(v) for v in grouped.values())
    print(f"plan rooms      {kept} used across {len(grouped)} building(s), {len(unplaced)} unplaced")
    for code, bid in sorted(declared.items()):
        n = sum(1 for r in rooms if r["building"] == code)
        if n:
            print(f"                {n} rooms published as '{code}' are building '{bid}' (declared)")
    for (published, filed), n in sorted(allocated.items()):
        print(f"                {n} rooms published as '{published}' allocated to '{filed}' (invented)")
    if unplaced:
        print(f"⚠ plan rooms outside every teaching footprint: {', '.join(sorted(unplaced)[:8])}")
    return grouped, scope


def mean_area(room_type: str) -> float:
    lo, hi = ROOM_TYPES[room_type]["areaM2"]
    return (lo + hi) / 2


def room_rows(rng: random.Random, buildings: list[dict]) -> list[dict]:
    """Synthetic rooms inside real buildings.

    Rooms are laid out by AREA, not by count. Usable floor is ~55% of the footprint times the
    storey count (the rest is circulation, walls and services), and rooms are drawn until that
    area is used up. Doing it this way is what makes a lecture-hall building contain a few very
    large rooms and a faculty building contain many small ones — an earlier count-based version
    derived 56 rooms for a Hörsaalgebäude, which is a corridor of broom cupboards, not a lecture
    building.

    ⚠️ Only a MINORITY of rooms are teaching rooms. The rest are offices and service space:
    never scheduled, but present, so that "how full is the building" and "how full is the
    teaching stock" stay different questions. And buildings owned by faculties this dataset does
    NOT model get no teaching rooms at all — see the ownership note above.

    ⚠️ WHERE REAL GEOMETRY EXISTS IT WINS. OSM has mapped the ground floor of OTH's Gebäude K
    (the Fakultät Informatik und Mathematik) — 28 rooms with real outlines, real areas and, for
    25 of them, real names — and all three levels of LMU's Oettingenstraße 67, which is 526.
    Those rooms are USED, not regenerated: their codes, areas and usage come from the survey and
    only their capacity is derived. Generating a plausible K 001 on top of a measured K 001 would
    be throwing away the only interior evidence this project has.
    """
    rows: list[dict] = []
    real_by_building = real_rooms_by_building(buildings)
    plan_by_building, plan_ref_scope = plan_rooms_by_building(buildings)

    for b in buildings:
        low = b["name"].lower()
        in_scope = b["facultyId"] != "other"

        # Measured rooms for this building, by the level they sit on.
        measured = real_by_building.get(b["buildingId"], [])
        measured_levels = {r["level"] for r in measured}
        for r in sorted(measured, key=lambda r: r["ref"]):
            room_type = infer_room_type(r["name"] or r["ref"], r["areaM2"])
            spec = ROOM_TYPES[room_type]
            # ⚠️ A ROOM CODE IS ONLY UNIQUE INSIDE ITS BUILDING, and taking the survey's ref as a
            # global id assumed otherwise. At OTH the assumption held by accident: the ref
            # already carries the building letter ("K 001" is in Gebäude K). At LMU it does not —
            # the 526 surveyed refs are Trakt letters inside Oettingenstraße 67 ("A 001"), while
            # a DIFFERENT building, the Hauptgebäude wing literally named "A", generates its own
            # "A 001". The validator caught 125 collisions; Direct Lake would have refused the
            # relationship outright, which is the Campus-Insights failure this gate exists for.
            # Prefixing with the building id unless the ref already starts with it leaves OTH's
            # codes untouched and makes LMU's unambiguous.
            prefix = f"{b['buildingId']} "
            code = r["ref"] if r["ref"].startswith(prefix) else f"{prefix}{r['ref']}"
            rows.append(
                {
                    "roomId": code,
                    "buildingId": b["buildingId"],
                    "campusId": b["campusId"],
                    "facultyId": b["facultyId"],
                    "level": r["level"],
                    "roomType": room_type,
                    "schedulable": spec["schedulable"] and in_scope,
                    "capacity": int(round(r["areaM2"] * spec["seatsPerM2"])),
                    "areaM2": round(r["areaM2"]),
                    "provenance": "measured",
                    "osmId": r["osmId"],
                    "displayName": r["name"] or None,
                    "planBuilding": None,
                    "planRef": None,
                }
            )

        # Rooms off the published floor plans. They come AFTER the survey and never overwrite it:
        # where OpenStreetMap already mapped a room the two sources describe the same room, the
        # survey row is the one the geometry builder joins its outline to, and a second row with
        # the same code would be a duplicate key — the failure this dataset's validator exists for.
        #
        # ⚠️ THE CODE IS OTH'S, NOT OURS. `P 172` is what is written on that door, so it is the
        # roomId; the building it is FILED under is the derived part and travels in `planBuilding`.
        # Prefixing these the way the survey's refs are prefixed would produce `a P 172`, an
        # identifier no one at the university has ever seen, to solve a collision that cannot occur
        # — a published code already carries its own building letter.
        drawn = plan_by_building.get(b["buildingId"], [])
        plan_levels = set()
        taken = {r["roomId"] for r in rows}
        by_code = {r["roomId"]: r for r in rows}
        for r in sorted(drawn, key=lambda r: (r["level"], r["ref"])):
            # ⚠️ THE CODE IS THE UNIVERSITY'S, BUT ONLY WHERE THE UNIVERSITY MADE IT UNIQUE. OTH's
            # published numbers carry their building letter, so `P 172` is the roomId as printed on
            # the door — prefixing it would produce `a P 172`, an identifier no one there has ever
            # seen, to solve a collision that cannot occur. LMU numbers by Trakt, so its `A 001`
            # must be namespaced exactly as the surveyed rooms already are. `planRef` then carries
            # what the plan calls it, so the geometry builder can still find the outline.
            code = r["ref"]
            if plan_ref_scope == "building":
                prefix = f"{b['buildingId']} "
                code = code if code.startswith(prefix) else f"{prefix}{code}"
            if code in taken:
                # ⚠️ THE SAME ROOM, SEEN TWICE — AND THE ARCHITECT'S DRAWING IS THE BETTER LOOK.
                # A room OpenStreetMap has surveyed AND the university has published is one room,
                # so it must not become two rows; the survey's row stays, because it carries the
                # measured area and name. But its SHAPE should be the plan's: OSM's indoor rooms
                # here are hand-drawn five-vertex quads that contradict the drawing, and at LMU
                # they carry no names at all. Pointing the surviving row at the published outline
                # upgrades 520 rooms from a sketch to the plan without inventing anything. Without
                # this the two sources simply passed each other: 686 rooms were read off LMU's
                # plans and only 187 of them ever reached the twin.
                existing = by_code.get(code)
                if existing is not None and not existing.get("planRef"):
                    existing["planRef"] = r["ref"]
                    existing["planBuilding"] = (
                        r["building"] if r["building"] != b["buildingId"] else None
                    )
                continue
            taken.add(code)
            plan_levels.add(r["level"])
            room_type = infer_room_type(r.get("usage") or r["ref"], r["areaM2"])
            spec = ROOM_TYPES[room_type]
            # ⚠️ A PLAN SAYS A ROOM EXISTS AND WHAT SHAPE IT IS. IT DOES NOT SAY WHAT IT IS FOR.
            # Where the sheet prints a use next to the number — OTH's do — that word decides. Where
            # it does not, only the area is left, and area cannot tell a 40 m² seminar room from a
            # 40 m² laboratory or a three-person office. Booking those anyway added 60 seminar
            # rooms to LMU that nobody had described as teaching space, pushed the teaching stock
            # up by a fifth against unchanged demand, and dropped utilisation to 9% — which the
            # validator refused, correctly. So an undescribed room is REAL and is drawn, and the
            # timetable does not claim it: the same treatment offices already get, for the same
            # reason. It is also the difference between finding rooms and inventing capacity.
            described = bool(r.get("usage"))
            rows.append(
                {
                    "roomId": code,
                    "buildingId": b["buildingId"],
                    "campusId": b["campusId"],
                    "facultyId": b["facultyId"],
                    "level": r["level"],
                    "roomType": room_type,
                    "schedulable": spec["schedulable"] and in_scope and described,
                    "capacity": int(round(r["areaM2"] * spec["seatsPerM2"])),
                    "areaM2": round(r["areaM2"]),
                    "provenance": "plan",
                    "osmId": None,
                    "displayName": None,
                    # ⚠️ SET ONLY WHEN THE ALLOCATION WAS INVENTED. Empty means the letter on the
                    # door and the building this row is filed under are the same thing, which is
                    # the normal case; a value means they are not, and the app should say so.
                    "planBuilding": r["building"] if r["building"] != b["buildingId"] else None,
                    # What the published plan calls this room, kept whenever the dataset had to
                    # rename it. `build_room_geometry` joins the drawn outline on this.
                    "planRef": r["ref"] if code != r["ref"] else None,
                }
            )

        # How much of a building is teaching space depends on what it is for. A Hörsaalgebäude is
        # nearly all teaching; a faculty building is mostly labs, workshops and offices with a
        # minority of centrally-bookable rooms.
        #
        # ⚠️ These shares were HALVED after the OSM relation fix recovered the two big faculty
        # buildings (Maschinenbau 8 146 m², Informatik und Mathematik 4 406 m²). At the old 40%
        # share those two alone contributed thousands of square metres of "teaching space",
        # 262 teaching rooms appeared for 3 386 students — one room per 13 students — and the
        # validator's utilisation gate refused the dataset at 10%. The gate was right: the error
        # was not the utilisation, it was believing that four tenths of a Maschinenbau faculty
        # building is a seminar room. It is a workshop, a test rig and a professor's office.
        if not in_scope:
            teaching_share = 0.0
        else:
            share_cfg = PROFILE["teachingShare"]
            teaching_share = share_cfg["default"]
            for band in share_cfg.get("byNameWords", []):
                if any(w in low for w in band["words"]):
                    teaching_share = band["share"]
                    break

        # ⚠️ INVENTED ROOMS MAY ONLY FILL THE FLOORS THEY ARE ACTUALLY GOING ON. This was
        # `footprintM2 * levels * 0.55` — the WHOLE building — while the rooms it sizes are then
        # placed only on the levels no plan or survey covers. Gebäude K's ground and first floors
        # are published, so three storeys of invented stock was crammed onto the one floor left:
        # 240 rooms against the 25 and 41 real ones beneath it. Prüfening's published ground floor
        # pushed three floors' worth onto two, giving building `a` 16 real rooms below 58 and 57
        # invented ones. On screen that reads as a sparse, large-roomed real floor under two dense
        # grids of identical boxes — which is precisely what it was.
        covered = measured_levels | plan_levels
        open_levels = [lv for lv in range(b["levels"]) if lv not in covered] or [b["levels"] - 1]
        # ⚠️ A PUBLISHED FLOOR PLAN MUST NOT SHRINK THE BUILDING IT DOCUMENTS.
        #
        # This was `0.0 if covered`: any building with a plan for ANY storey got NO invented rooms
        # at all. It was introduced to close a join gap — 175 sessions booked into rooms the twin
        # had stopped drawing — and it did, by removing the rooms instead of drawing them. The
        # side effect was perverse and, opened up, ugly: Prüfening publishes a ground-floor plan
        # for all six of its buildings and nothing above, so all six collapsed to ONE modelled
        # storey of three. Opening `a` showed sixteen plates floating in a dimmed void where a
        # three-storey building should be, and the campus held 15 of 936 sessions.
        #
        # A building with NO plan has every floor invented and badged. A building with a plan for
        # one floor now gets the same treatment for the floors that plan does not cover — which is
        # the consistent rule, and the only one under which more evidence does not mean less model.
        # The slab problem that motivated the original ban was a SIZING bug, fixed just above:
        # `len(open_levels)` puts one floor's worth of rooms on one floor, where the old
        # `levels` crammed three onto one.
        usable = b["footprintM2"] * len(open_levels) * 0.55

        teaching_area = usable * teaching_share
        picks: list[str] = []

        # ⚠️ LECTURE HALLS ARE DELIBERATELY SCARCE. An early pass gave a hall to every building
        # over 1300 m² and produced 16 of them for 150 hall sessions — 27% occupancy even if
        # perfectly packed, which means two faculties never want the same hall and the central
        # conflict of the product cannot occur in its own demo data. Halls exist only where a real
        # one plausibly is: a building the university names after its lecture halls, or a large
        # in-scope one. Both the words and the thresholds are per site, because "large" is not the
        # same number in Regensburg and in Maxvorstadt.
        halls = PROFILE["lectureHalls"]
        named_hall = any(w in low for w in halls["nameWords"])
        # ⚠️ AND IF THE PUBLISHED PLAN ALREADY SHOWS THIS BUILDING'S HALL, DO NOT INVENT MORE. The
        # survey names Gebäude K's lecture hall — `K 001 Großer Hörsaal`, 95 seats — and the
        # generator was adding `K 253` and `K 258` at 210 and 211 seats on the floor no plan
        # covers, so the two largest lecture halls in the building were both fictional. That is the
        # TechBase failure again: invented capacity, in a building whose real capacity is known,
        # inflating the hall stock the whole demo is calibrated against.
        already_has_hall = any(
            r["buildingId"] == b["buildingId"] and r["roomType"] == "Hörsaal" for r in rows
        )
        # ⚠️ `usable > 0` GATES THIS TOO. The hall picks are added before the area loop and so
        # ignored the "publish nothing invented into a published building" rule above — which left
        # exactly one invented hall on each undrawn floor of Prüfening `a` and LMU's `ax`, and with
        # them 30 and 37 sessions still pointing at rooms the twin does not draw. A room that is
        # never drawn must never be booked, and a lecture hall is the most bookable kind there is.
        if usable > 0 and in_scope and not already_has_hall and (
            named_hall or b["footprintM2"] >= halls["minFootprintM2"]
        ):
            picks += ["Hörsaal"] * (2 if b["footprintM2"] >= halls["secondHallMinFootprintM2"] else 1)

        # The rest of the teaching area, cycled through the types this building plausibly has.
        cycle = ["Seminarraum", "Übungsraum", "Seminarraum", "Labor"]
        if b["facultyId"] in PROFILE["cipPoolFaculties"]:
            cycle.append("CIP-Pool")
        i = 0
        while sum(mean_area(p) for p in picks) < teaching_area and len(picks) < 60:
            picks.append(cycle[i % len(cycle)])
            i += 1

        # Everything left over is offices and service space. Roughly three offices per service
        # room, which is what a corridor of a German Hochschule building actually looks like.
        remaining = max(0.0, usable - sum(mean_area(p) for p in picks))
        n_office = int(remaining * 0.75 / mean_area("Büro"))
        n_service = int(remaining * 0.25 / mean_area("Service"))
        picks += ["Büro"] * n_office + ["Service"] * n_service
        rng.shuffle(picks)

        # Generated rooms never land on a level that has been surveyed OR published. Building K's
        # ground floor is real and its first floor is drawn; inventing a second set of rooms for
        # either would put two K 003s in the model and the semantic model would reject the
        # duplicate at refresh time — the same class of bug the validator already caught once with
        # session ids. `open_levels` is computed above, where it also sizes the stock.
        used_codes = {r["roomId"] for r in rows if r["buildingId"] == b["buildingId"]}

        for i, room_type in enumerate(picks):
            level = open_levels[i % len(open_levels)]
            number = level * 100 + (i // len(open_levels)) + 1
            code = f"{b['buildingId']} {number:03d}"
            while code in used_codes:
                number += 1
                code = f"{b['buildingId']} {number:03d}"
            used_codes.add(code)

            spec = ROOM_TYPES[room_type]
            lo, hi = spec["areaM2"]
            area = rng.uniform(lo, hi)
            rows.append(
                {
                    "roomId": code,
                    "buildingId": b["buildingId"],
                    "campusId": b["campusId"],
                    "facultyId": b["facultyId"],
                    "level": level,
                    "roomType": room_type,
                    "schedulable": spec["schedulable"],
                    "capacity": int(round(area * spec["seatsPerM2"])),
                    "areaM2": round(area),
                    "provenance": "generated",
                    "osmId": None,
                    "displayName": None,
                    "planBuilding": None,
                    "planRef": None,
                }
            )
    return rows


def travel_time_rows(buildings: list[dict]) -> list[dict]:
    """How long it takes to get from one building to another.

    Prefers `travel_routed.json` — real shortest paths on the OpenStreetMap footpath network,
    written by `tools/data/build_walk_routes.py --matrix`. Falls back to straight lines, loudly,
    because the fallback is the thing this function used to do unconditionally and it is optimistic
    by roughly 11 % within a campus.

    ⚠️ THE TWO-PASS ORDER IS DELIBERATE AND HAS TO BE. The router needs `building.json` to know
    which letters exist and where they are, and this generator writes it — so a first pass
    bootstraps the buildings, the router measures them, and a second pass plans against the
    measurements. The generator is deterministic for fixed inputs, so the second pass differs from
    the first ONLY where a real walk is longer than the straight line, which is the entire point.

    ⚠️ Between campuses the number stays a BUS. 3.5 km on foot is 44 minutes and no break is that
    long; the router carries the bus figure through so this file keeps the same claim it always
    made rather than quietly making the plan impossible.
    """
    routed_path = SITE.synth / "travel_routed.json"
    if routed_path.exists():
        rows = json.loads(routed_path.read_text(encoding="utf-8"))
        known = {b["buildingId"] for b in buildings}
        covered = {r["fromBuildingId"] for r in rows} | {r["toBuildingId"] for r in rows}
        missing = known - covered
        if missing:
            # A partial matrix is worse than none: the placer reads an absent pair as "no travel
            # time at all", which is indistinguishable from "these rooms are next door".
            raise SystemExit(
                f"{routed_path.name} covers {len(covered)} buildings but the dataset has "
                f"{len(known)}; missing {sorted(missing)}. Re-run "
                f"`build_walk_routes.py --site {SITE.id} --matrix`."
            )
        walked = sum(1 for r in rows if r.get("mode") == "walk")
        print(f"travel      routed ({len(rows)} pairs, {walked} on foot) from {routed_path.name}")
        return rows

    print(
        f"travel      ⚠️  STRAIGHT-LINE fallback — {routed_path.name} is missing. "
        f"Run `python tools/data/build_walk_routes.py --site {SITE.id} --matrix` first."
    )
    rows = []
    for a in buildings:
        for b in buildings:
            d = math.dist((a["easting"], a["northing"]), (b["easting"], b["northing"]))
            same_campus = a["campusId"] == b["campusId"]
            if a["buildingId"] == b["buildingId"]:
                minutes = 0
            else:
                # ⚠️ JUDGE BY DISTANCE, NOT BY CAMPUS ID. This used to read "same campus = walk,
                # different campus = bus", which was true while OTH had two sites 2.5 km apart and
                # became wrong the moment TechBase was modelled: it is a DIFFERENT campus 305 m
                # away, and the campus-based branch billed a four-minute walk as a nine-minute bus
                # ride. Taking the quicker of the two modes is right at every distance and needs no
                # special case — which is also what `build_walk_routes.py --matrix` already does,
                # so the bootstrap pass and the routed pass now agree on the shape of the answer.
                walk = 1 + d / 1.35 / 60
                bus = 8 + d / 6.0 / 60
                minutes = round(min(walk, bus) if not same_campus else walk)
            rows.append(
                {
                    "fromBuildingId": a["buildingId"],
                    "toBuildingId": b["buildingId"],
                    "distanceM": round(d),
                    "minutes": minutes,
                    "sameCampus": same_campus,
                }
            )
    return rows


def teacher_rows(rng: random.Random) -> list[dict]:
    """One lecturer per teaching post, each with a name nobody else at this university has.

    ⚠️ THE POOL MUST COVER EVERY POST, AND RUNNING OUT IS AN ERROR RATHER THAN A WRAP.
    This read `pool[i % len(pool)]`, so when LMU grew to 102 posts against 82 names the index
    wrapped and twenty professors ended up sharing a full name with a colleague — in a DIFFERENT
    faculty, both carrying real teaching. That is not a cosmetic duplicate: `find_teacher` resolves
    a lecturer by surname, and both the assistant and `/api/calendar?scope=teacher` go through it,
    so asking about "Lengfelder" returned one of the two and reported the other's workload as
    confidently as if it were right. Wrapping silently produced a plausible, wrong answer; stopping
    produces a build failure that names the file to edit.
    """
    rows = []
    needed = sum(fac["teachers"] for fac in FACULTIES)
    unique = sorted(set(SURNAMES))
    if len(unique) < needed:
        raise SystemExit(
            f"{needed} teaching posts but only {len(unique)} distinct surnames in the profile — "
            f"add at least {needed - len(unique)} more to `surnames` in the site's "
            "config/academic/<site>.json. Reusing one would make two lecturers indistinguishable "
            "to every lookup that resolves a teacher by name."
        )

    pool = unique[:]
    rng.shuffle(pool)
    i = 0
    for fac in FACULTIES:
        for n in range(fac["teachers"]):
            surname = pool[i]
            i += 1
            rows.append(
                {
                    "teacherId": f"{fac['id']}-T{n + 1:03d}",
                    "name": f"Prof. Dr. {surname[0]}. {surname}",
                    "facultyId": fac["id"],
                    "contractSws": rng.choice([16, 18, 18, 18, 20, 9]),  # 9 = part time
                }
            )
    return rows


def availability_rows(rng: random.Random, teachers: list[dict], slots: list[dict]) -> list[dict]:
    """Who can teach when — the Excel this product replaces.

    Three states, exactly as the requirements describe them: verfügbar / eingeschränkt / nicht
    verfügbar. The shape is not random noise, it is the shape people actually produce: a research
    day nobody teaches on, a dislike of the 08:00 and the 18:30 block, and part-timers with whole
    days blocked. A solver fed uniform noise looks clever and proves nothing.
    """
    rows = []
    for t in teachers:
        blocked_day = rng.choice(DAYS) if rng.random() < 0.55 else None
        part_time = t["contractSws"] <= 9
        second_blocked = rng.choice(DAYS) if part_time else None
        dislikes_early = rng.random() < 0.45
        dislikes_late = rng.random() < 0.60
        for s in slots:
            state = "verfuegbar"
            if s["day"] in (blocked_day, second_blocked):
                state = "nicht_verfuegbar"
            elif s["block"] == 1 and dislikes_early:
                state = "eingeschraenkt"
            elif s["block"] >= 6 and dislikes_late:
                state = "eingeschraenkt" if s["block"] == 6 else "nicht_verfuegbar"
            rows.append({"teacherId": t["teacherId"], "slotId": s["slotId"], "state": state})
    return rows


def cohort_rows(rng: random.Random) -> list[dict]:
    rows = []
    for fac in FACULTIES:
        for prog in PROGRAMMES[fac["id"]]:
            for sem in COHORT_SEMESTERS:
                # Cohorts thin out over the course of a degree; first semesters are the big ones,
                # which is precisely why they need the halls two faculties are fighting over. The
                # first-semester band is wide on purpose: an Informatik intake of 200+ and a
                # Mathematik intake of 60 need very different rooms, and a solver that never sees
                # that spread never has to make the interesting choice.
                base = rng.randint(110, 240) if sem == 1 else rng.randint(40, 130)
                rows.append(
                    {
                        "cohortId": f"{fac['id']}-{prog[:4].upper()}-{sem}",
                        "programme": prog,
                        "facultyId": fac["id"],
                        "semester": sem,
                        "headcount": base,
                    }
                )
    return rows


def course_rows(
    rng: random.Random, teachers: list[dict], cohorts: list[dict]
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """Courses, their weekly sessions, the teaching groups, and who has to attend what."""
    courses: list[dict] = []
    sessions: list[dict] = []
    links: list[dict] = []
    groups: list[dict] = []

    types = list(COURSE_TYPES.items())
    weights = [spec[2] for _, spec in types]

    for cohort in cohorts:
        fac = cohort["facultyId"]
        staff = [t for t in teachers if t["facultyId"] == fac]
        subjects = SUBJECTS[fac][:]
        rng.shuffle(subjects)
        # A semester's worth. 7-9 modules, each of which may explode into parallel groups.
        for k in range(rng.randint(7, 9)):
            subject = subjects[k % len(subjects)]
            course_type = rng.choices([t for t, _ in types], weights=weights, k=1)[0]
            room_type, per_week, _, group_size = COURSE_TYPES[course_type]
            teacher = rng.choice(staff)
            course_id = f"{cohort['cohortId']}-C{k + 1}"
            courses.append(
                {
                    "courseId": course_id,
                    "title": f"{subject} ({course_type})",
                    "courseType": course_type,
                    "facultyId": fac,
                    "teacherId": teacher["teacherId"],
                    "requiredRoomType": room_type,
                    "sws": per_week * 2,
                }
            )
            links.append({"cohortId": cohort["cohortId"], "courseId": course_id, "mandatory": True})

            if group_size is None:
                units = [("ALL", cohort["cohortId"], cohort["headcount"], teacher["teacherId"])]
            else:
                n_groups = max(1, math.ceil(cohort["headcount"] / group_size))
                size = math.ceil(cohort["headcount"] / n_groups)
                units = []
                for g in range(n_groups):
                    group_id = f"{course_id}-G{g + 1}"
                    groups.append(
                        {
                            "groupId": group_id,
                            "cohortId": cohort["cohortId"],
                            "courseId": course_id,
                            "size": size,
                        }
                    )
                    # Parallel groups are shared out among the faculty's staff — one professor
                    # cannot personally run thirteen lab groups, and pretending otherwise would
                    # make teacher load meaningless.
                    units.append((f"G{g + 1}", group_id, size, rng.choice(staff)["teacherId"]))

            for unit_key, attendee_id, size, teacher_id in units:
                for n in range(per_week):
                    # ⚠️ THE COURSE ID BELONGS IN HERE. It was once `f"{attendee_id}-S{n+1}"`,
                    # which is unique for a group (the group id already carries the course) but
                    # NOT for a whole-cohort lecture, where attendee_id is just the cohort — so
                    # every Vorlesung a cohort attends produced the same "IM-INFO-1-S1". 44 ids
                    # collided. Nothing looked wrong: the generator's own conflict check keyed its
                    # dictionaries on sessionId, so the duplicates silently merged and it reported
                    # zero conflicts. The independent validator found it in one run, which is the
                    # whole argument for having one.
                    sessions.append(
                        {
                            "sessionId": f"{course_id}-{unit_key}-S{n + 1}",
                            "courseId": course_id,
                            "facultyId": fac,
                            "teacherId": teacher_id,
                            "cohortId": cohort["cohortId"],
                            "attendeeId": attendee_id,
                            "isWholeCohort": group_size is None,
                            "requiredRoomType": room_type,
                            "expectedAttendance": size,
                        }
                    )
    return courses, sessions, links, groups


def schedule(
    rng: random.Random,
    sessions: list[dict],
    rooms: list[dict],
    slots: list[dict],
    availability: list[dict],
    cohort_courses: list[dict],
    travel: list[dict],
) -> tuple[list[dict], list[dict]]:
    """A greedy baseline timetable — the "current plan" the cascade demo starts from.

    ⚠️ THIS IS NOT THE SOLVER. Phase 2 brings CP-SAT, which optimises; this only needs to produce
    a plausible published plan to disturb. Greedy is the right tool for that and the wrong tool
    for the product, and the difference is worth being explicit about: this places sessions one at
    a time and never revisits a decision, so it will strand a few sessions it could have placed.
    That is realistic — a hand-made plan has the same property — and those leftovers are the first
    thing the real solver gets to fix.

    Hard constraints honoured while placing: teacher availability, teacher double-booking, cohort
    double-booking, room double-booking, room type, capacity, and the campus-transition rule (a
    cohort cannot be at Prüfening at 09:45 and Seybothstraße at 11:30 if the bus takes longer than
    the break).
    """
    avail = {(a["teacherId"], a["slotId"]): a["state"] for a in availability}
    travel_min = {(t["fromBuildingId"], t["toBuildingId"]): t["minutes"] for t in travel}
    rooms_by_type: dict[str, list[dict]] = defaultdict(list)
    for r in rooms:
        # ⚠️ SCHEDULABLE ONLY. The placer used to index every room by type, which meant offices
        # were never picked (no session needs a "Büro") but a teaching room in a building owned by
        # an unmodelled faculty WAS — the plan booked lectures into rooms it has no right to.
        # Invisible until the validator started checking room ownership independently.
        if r.get("schedulable"):
            rooms_by_type[r["roomType"]].append(r)
    for rs in rooms_by_type.values():
        rs.sort(key=lambda r: r["capacity"])
    slot_index = {s["slotId"]: s for s in slots}
    building_of = {r["roomId"]: r["buildingId"] for r in rooms}

    # The break between consecutive blocks. Anything longer than this and the attendees cannot make it.
    BREAK_MIN = 15

    teacher_busy: set[tuple[str, str]] = set()
    room_busy: set[tuple[str, str]] = set()
    # A lecture blocks the whole cohort; a group session blocks only that group but must not clash
    # with its own cohort's lecture. Two groups of the same cohort running in parallel is the
    # normal case, not a conflict — getting this wrong either invents conflicts or hides them.
    lecture_busy: set[tuple[str, str]] = set()
    any_group_busy: set[tuple[str, str]] = set()
    group_busy: set[tuple[str, str]] = set()
    # Where people are, at the two granularities that actually share students: a cohort's own
    # whole-cohort lecture, and the set of buildings its groups occupy. Keyed on the COHORT in
    # both cases — keying the travel check on the attendee is what let a group be scheduled
    # across the city from the lecture its own students had just left.
    lecture_where: dict[tuple[str, str], str] = {}
    group_where: dict[tuple[str, str], set[str]] = {}
    teacher_where: dict[tuple[str, str], str] = {}

    assignments: list[dict] = []
    unplaced: list[dict] = []

    # Tightest first: the sessions with the fewest possible rooms have to choose before the ones
    # that fit anywhere, or they find nothing left.
    ordered = sorted(
        sessions,
        key=lambda s: (-s["expectedAttendance"], s["requiredRoomType"] != "Hörsaal"),
    )

    for s in ordered:
        cohort = s["cohortId"]
        attendee = s["attendeeId"]
        whole = s["isWholeCohort"]
        candidates = [
            r
            for r in rooms_by_type[s["requiredRoomType"]]
            if r["capacity"] >= s["expectedAttendance"]
        ]
        if not candidates:
            unplaced.append({**s, "reason": "no room of the required type is large enough"})
            continue

        best: tuple[float, dict, dict] | None = None
        for slot in slots:
            sid = slot["slotId"]
            state = avail.get((s["teacherId"], sid), "verfuegbar")
            if state == "nicht_verfuegbar":
                continue
            if (s["teacherId"], sid) in teacher_busy:
                continue
            if whole:
                if (cohort, sid) in lecture_busy or (cohort, sid) in any_group_busy:
                    continue
            else:
                if (attendee, sid) in group_busy or (cohort, sid) in lecture_busy:
                    continue

            for room in candidates:
                if (room["roomId"], sid) in room_busy:
                    continue
                if not transition_ok(
                    attendee, cohort, whole, s["teacherId"], slot, room,
                    lecture_where, group_where, teacher_where, travel_min, BREAK_MIN,
                ):
                    continue
                # Prefer good slots, prefer not wasting a 296-seat hall on 40 students, and
                # nudge away from "eingeschränkt" without forbidding it.
                waste = (room["capacity"] - s["expectedAttendance"]) / max(room["capacity"], 1)
                cost = (
                    (1 - slot["desirability"]) * 2.0
                    + waste
                    + (0.6 if state == "eingeschraenkt" else 0.0)
                    + rng.random() * 0.05
                )
                if best is None or cost < best[0]:
                    best = (cost, slot, room)
            if best is not None and best[0] < 0.15:
                break  # good enough; stop scanning slots

        if best is None:
            unplaced.append({**s, "reason": "no slot left where teacher, attendees and a room agree"})
            continue

        _, slot, room = best
        sid = slot["slotId"]
        teacher_busy.add((s["teacherId"], sid))
        room_busy.add((room["roomId"], sid))
        if whole:
            lecture_busy.add((cohort, sid))
        else:
            group_busy.add((attendee, sid))
            any_group_busy.add((cohort, sid))
        if whole:
            lecture_where[(cohort, sid)] = room["buildingId"]
        else:
            group_where.setdefault((cohort, sid), set()).add(room["buildingId"])
        teacher_where[(s["teacherId"], sid)] = room["buildingId"]
        assignments.append(
            {
                "draftId": "published",
                "sessionId": s["sessionId"],
                "courseId": s["courseId"],
                "cohortId": cohort,
                "attendeeId": attendee,
                "isWholeCohort": whole,
                "teacherId": s["teacherId"],
                "slotId": sid,
                "roomId": room["roomId"],
                "buildingId": building_of[room["roomId"]],
                "campusId": room["campusId"],
                "frozen": False,
            }
        )

    return assignments, unplaced


def _travel(travel_min: dict[tuple[str, str], int], a: str, b: str) -> int:
    """Minutes between two buildings, in whichever direction the table records them.

    ⚠️ A ONE-DIRECTION LOOKUP READS A MISSING PAIR AS "NO DISTANCE AT ALL", which is
    indistinguishable from "next door" and silently permits the transfer this module exists to
    refuse. The matrix is written both ways today; that is not a reason to depend on it.
    """
    if not a or not b or a == b:
        return 0
    return max(travel_min.get((a, b), 0), travel_min.get((b, a), 0))


def transition_ok(
    attendee: str,
    cohort: str,
    whole: bool,
    teacher: str,
    slot: dict,
    room: dict,
    lecture_where: dict[tuple[str, str], str],
    group_where: dict[tuple[str, str], set[str]],
    teacher_where: dict[tuple[str, str], str],
    travel_min: dict[tuple[str, str], int],
    break_min: int,
) -> bool:
    """Can these people physically get here from where they were in the adjacent block?

    This is the constraint the whole product exists for, so it is enforced in the baseline too —
    a "current plan" that already teleports students would make every later comparison meaningless.

    ⚠️ IT USED TO COMPARE ATTENDEE IDS, AND A GROUP IS NOT ITS COHORT'S ID. `MED-HUMA-1-C4-G7`
    never matched `MED-HUMA-1`, so the placer could put a cohort's whole-cohort lecture on one
    campus and, in the very next block, one of its own groups on the other — and every student in
    that group had just been sitting in the lecture. LMU shipped **37** such transfers. The clash
    logic beside this call already knew the relationship (`lecture_busy` is keyed on the cohort
    while `group_busy` is keyed on the attendee); only the travel check did not.

    ⚠️ TWO DIFFERENT GROUPS ARE DELIBERATELY NOT COMPARED. `…-C5-G2` and `…-C6-G1` are groups of
    two different courses, and this dataset has group SIZES but no membership, so whether one
    student sits in both is NOT DERIVABLE. Refusing those placements would enforce a constraint we
    cannot show anyone is real — the same fabrication the plan-quality lens nearly shipped as "147
    impossible transfers". The subset relation (whole cohort ⊇ any of its groups) is the only one
    the data actually supports, and it is the one enforced here.
    """
    for delta in (-1, 1):
        block = slot["block"] + delta
        if not 1 <= block <= len(BLOCKS):
            continue
        neighbour = f"{slot['day']}-{block}"
        here = room["buildingId"]

        if whole:
            # Everyone is in this lecture, so every group of this cohort is a neighbour.
            for other in group_where.get((cohort, neighbour), ()):
                if _travel(travel_min, other, here) >= break_min:
                    return False
        else:
            # This group's students were in their cohort's lecture if there was one.
            other = lecture_where.get((cohort, neighbour))
            if other and _travel(travel_min, other, here) >= break_min:
                return False

        # Either way, the same attendee cannot outrun the clock to reach itself.
        own = lecture_where.get((cohort, neighbour)) if whole else None
        if own and _travel(travel_min, own, here) >= break_min:
            return False

        # ⚠️ AND THE LECTURER, who was checked nowhere at all. A cohort's day is planned as one
        # block for one group; a lecturer gets handed two different cohorts in two faculties, so
        # they are the likelier of the two to be sent across the city between blocks.
        mine = teacher_where.get((teacher, neighbour))
        if mine and _travel(travel_min, mine, here) >= break_min:
            return False
    return True



def conflict_rows(
    assignments: list[dict], rooms: list[dict], travel: list[dict], sessions: list[dict]
) -> list[dict]:
    """Recompute conflicts from the assignment, independently of how it was produced.

    Deliberately shares no code with `schedule` — a checker that trusts the placer's bookkeeping
    only ever confirms the placer's opinion of itself.
    """
    capacity = {r["roomId"]: r["capacity"] for r in rooms}
    attendance = {s["sessionId"]: s["expectedAttendance"] for s in sessions}
    travel_min = {(t["fromBuildingId"], t["toBuildingId"]): t["minutes"] for t in travel}
    rows: list[dict] = []

    for key, field, kind in (
        ("teacherId", "teacher", "teacher_double_booked"),
        ("attendeeId", "attendees", "attendee_double_booked"),
        ("roomId", "room", "room_double_booked"),
    ):
        seen: dict[tuple[str, str], str] = {}
        for a in assignments:
            k = (a[key], a["slotId"])
            if k in seen:
                rows.append(
                    {
                        "draftId": a["draftId"],
                        "type": kind,
                        "severity": "hard",
                        "slotId": a["slotId"],
                        "entity": a[key],
                        "sessions": [seen[k], a["sessionId"]],
                    }
                )
            else:
                seen[k] = a["sessionId"]

    for a in assignments:
        if attendance[a["sessionId"]] > capacity[a["roomId"]]:
            rows.append(
                {
                    "draftId": a["draftId"],
                    "type": "capacity_exceeded",
                    "severity": "hard",
                    "slotId": a["slotId"],
                    "entity": a["roomId"],
                    "sessions": [a["sessionId"]],
                }
            )

    by_cohort_slot = {(a["attendeeId"], a["slotId"]): a for a in assignments}
    for a in assignments:
        day, block = a["slotId"].split("-")
        nxt = by_cohort_slot.get((a["attendeeId"], f"{day}-{int(block) + 1}"))
        if not nxt:
            continue
        minutes = travel_min.get((a["buildingId"], nxt["buildingId"]), 0)
        if minutes > 15:
            rows.append(
                {
                    "draftId": a["draftId"],
                    "type": "campus_transition",
                    "severity": "hard" if minutes > 25 else "soft",
                    "slotId": a["slotId"],
                    "entity": a["attendeeId"],
                    "sessions": [a["sessionId"], nxt["sessionId"]],
                    "minutesNeeded": minutes,
                }
            )
    return rows


def write(out_dir: Path, name: str, rows: list[dict]) -> None:
    path = out_dir / f"{name}.json"
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  {name:<16} {len(rows):>6} rows")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    add_site_argument(parser)
    parser.add_argument("--seed", type=int, default=20260730)
    parser.add_argument(
        "--out",
        default=None,
        help="override the output directory; defaults to the site's own (see tools/data/sites.py)",
    )
    args = parser.parse_args()

    global SITE, AOI, PROFILE, BUILDINGS_FILE, LETTERS_FILE, OSM_ROOMS_FILE, PLAN_ROOMS_FILE
    global DAYS, BLOCKS, DESIRABILITY, FACULTIES, PROGRAMMES, COHORT_SEMESTERS
    global SUBJECTS, SURNAMES, NON_TEACHING

    SITE = load_site(args.site)
    AOI = SITE.aoi()
    BUILDINGS_FILE = SITE.buildings
    LETTERS_FILE = SITE.letters
    OSM_ROOMS_FILE = SITE.osm_rooms
    PLAN_ROOMS_FILE = SITE.plan_rooms

    PROFILE = SITE.read_json(SITE.academic)
    if PROFILE is None:
        raise SystemExit(
            f"{SITE.academic} is missing. The invented half of the dataset lives in a profile so "
            "that a second university is a file rather than a fork; there is no built-in default, "
            "because a built-in default is how the second customer silently gets the first "
            "customer's faculties."
        )

    scheme = PROFILE["blockScheme"]
    DAYS = scheme["days"]
    BLOCKS = [tuple(b) for b in scheme["blocks"]]
    DESIRABILITY = scheme["desirability"]
    if not (len(BLOCKS) == len(DESIRABILITY)):
        raise SystemExit(
            f"{SITE.academic}: blockScheme has {len(BLOCKS)} blocks but "
            f"{len(DESIRABILITY)} desirability values — every block needs one."
        )

    FACULTIES = PROFILE["faculties"]
    PROGRAMMES = PROFILE["programmes"]
    COHORT_SEMESTERS = PROFILE["cohortSemesters"]
    SUBJECTS = PROFILE["subjects"]
    SURNAMES = PROFILE["surnames"]
    NON_TEACHING = tuple(PROFILE["nonTeachingNameWords"])

    faculty_ids = {f["id"] for f in FACULTIES}
    # A profile whose parts disagree produces a dataset that looks fine and is quietly wrong: a
    # faculty with no subjects generates no courses, an ownership rule naming a faculty that does
    # not exist silently sends a building to `other`. Both are cheaper to catch here.
    for fid in faculty_ids:
        for key, table in (("programmes", PROGRAMMES), ("subjects", SUBJECTS)):
            if not table.get(fid):
                raise SystemExit(f"{SITE.academic}: faculty '{fid}' has no {key}")
    for rule in PROFILE["buildingOwnership"]["rules"]:
        if rule["owner"] not in faculty_ids | {"shared", "other"}:
            raise SystemExit(
                f"{SITE.academic}: ownership rule assigns buildings to '{rule['owner']}', "
                f"which is not a faculty in this profile ({', '.join(sorted(faculty_ids))})"
            )

    rng = random.Random(args.seed)
    out_dir = (ROOT / args.out) if args.out else SITE.synth
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"=== {SITE.label} — {len(FACULTIES)} faculties, {len(BLOCKS)} blocks/day ===")

    slots = slot_rows()
    buildings = building_rows(load_buildings())
    rooms = room_rows(rng, buildings)
    travel = travel_time_rows(buildings)
    teachers = teacher_rows(rng)
    availability = availability_rows(rng, teachers, slots)
    cohorts = cohort_rows(rng)
    courses, sessions, cohort_courses, groups = course_rows(rng, teachers, cohorts)

    # ── What the data actually looks like ───────────────────────────────────────────────────
    by_campus: dict[str, int] = defaultdict(int)
    for b in buildings:
        by_campus[b["campusId"]] += 1
    print(f"\nbuildings   {len(buildings)}  " + "  ".join(f"{k}={v}" for k, v in by_campus.items()))

    by_type: dict[str, int] = defaultdict(int)
    for r in rooms:
        by_type[r["roomType"]] += 1
    print(f"rooms       {len(rooms)}  " + "  ".join(f"{k}={v}" for k, v in sorted(by_type.items())))

    halls = sorted((r for r in rooms if r["roomType"] == "Hörsaal"), key=lambda r: -r["capacity"])
    print(f"halls       {len(halls)}, capacities {[h['capacity'] for h in halls]}")

    print(f"\nteachers    {len(teachers)}")
    print(f"cohorts     {len(cohorts)}  headcount {sum(c['headcount'] for c in cohorts)}")
    print(f"courses     {len(courses)}")
    print(f"groups      {len(groups)} parallel teaching groups")
    print(f"sessions    {len(sessions)}  ({len(sessions) / len(cohorts):.1f} per cohort per week)")

    # The scarcity that makes the demo mean something: how many sessions can only be held in how
    # few rooms. If every session fits everywhere, there is nothing to solve.
    hall_sessions = [s for s in sessions if s["requiredRoomType"] == "Hörsaal"]
    demand = len(hall_sessions)
    supply = len(halls) * len(slots)
    print(f"\nhall demand {demand} sessions vs {supply} hall-slots — {demand / supply:.0%} if perfectly packed")
    tight = [
        s
        for s in hall_sessions
        if sum(1 for h in halls if h["capacity"] >= s["expectedAttendance"]) <= 3
    ]
    print(f"            {len(tight)} sessions fit in 3 halls or fewer")
    biggest = max(s["expectedAttendance"] for s in sessions)
    print(f"            largest cohort {biggest}, largest hall {halls[0]['capacity']}")
    if biggest > halls[0]["capacity"]:
        print("            ⚠ a cohort does not fit in ANY hall — the dataset is unsolvable as generated")

    unavailable = sum(1 for a in availability if a["state"] == "nicht_verfuegbar")
    print(f"availability {len(availability)} rows, {unavailable / len(availability):.0%} unavailable")

    # ── The baseline plan ────────────────────────────────────────────────────────────
    assignments, unplaced = schedule(
        rng, sessions, rooms, slots, availability, cohort_courses, travel
    )
    conflicts = conflict_rows(assignments, rooms, travel, sessions)
    drafts = [
        {
            "draftId": "published",
            "name": "Veröffentlichter Plan WS",
            "status": "published",
            "parentDraftId": None,
            "author": "generator",
            "createdAt": "2026-07-30",
        }
    ]

    placed = len(assignments)
    print(f"\nbaseline    {placed}/{len(sessions)} sessions placed ({placed / len(sessions):.0%})")
    if unplaced:
        reasons: dict[str, int] = defaultdict(int)
        for u in unplaced:
            reasons[u["reason"]] += 1
        for reason, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
            print(f"            {n:>3} unplaced — {reason}")

    hard = [c for c in conflicts if c["severity"] == "hard"]
    soft = [c for c in conflicts if c["severity"] == "soft"]
    print(f"conflicts   {len(hard)} hard, {len(soft)} soft (checked independently of the placer)")
    by_kind: dict[str, int] = defaultdict(int)
    for c in conflicts:
        by_kind[c["type"]] += 1
    for kind, n in sorted(by_kind.items(), key=lambda kv: -kv[1]):
        print(f"            {n:>3} {kind}")

    used = {(a["roomId"], a["slotId"]) for a in assignments}
    teaching = [r for r in rooms if r["schedulable"]]
    # ⚠️ THE DENOMINATOR IS THE TEACHING STOCK, not every room in the building. Dividing by all
    # rooms gave 6.9%, which is not a low utilisation — it is a wrong question, because nobody
    # ever tries to hold a lecture in a professor's office. Against the rooms that can actually
    # be booked, the figure is comparable to the 30.5% the Campus-Insights survey measured from
    # real TUMonline bookings at Garching, which is the sanity check that matters.
    print(f"room load   {len(used) / (len(teaching) * len(slots)):.1%} of TEACHING room-slots in use")
    print(f"            {len(used) / (len(rooms) * len(slots)):.1%} of all rooms incl. offices — not a timetabling figure")
    hall_used = sum(1 for a in assignments if a["roomId"] in {h["roomId"] for h in halls})
    print(f"            {hall_used / (len(halls) * len(slots)):.0%} of hall-slots in use")
    switches = sum(1 for c in conflicts if c["type"] == "campus_transition")
    # The SECOND campus, whichever it is. Hard-coding "pruefening" here reported 0 sessions at
    # LMU's Klinikum while 268 were sitting in the data — a summary line that is wrong is worse
    # than one that is missing, because it gets read out loud.
    second = AOI["campuses"][-1]["id"]
    second_name = AOI["campuses"][-1]["name"]["de"]
    cross = sum(1 for a in assignments if a["campusId"] == second)
    print(f"campus      {cross} sessions at {second_name}, {switches} tight transitions flagged")

    print("\nwriting:")
    write(out_dir, "time_slot", slots)
    write(out_dir, "building", buildings)
    write(out_dir, "room", rooms)
    write(out_dir, "travel_time", travel)
    write(out_dir, "teacher", teachers)
    write(out_dir, "availability", availability)
    write(out_dir, "cohort", cohorts)
    write(out_dir, "course", courses)
    write(out_dir, "course_session", sessions)
    write(out_dir, "cohort_course", cohort_courses)
    write(out_dir, "cohort_group", groups)
    write(out_dir, "plan_draft", drafts)
    write(out_dir, "plan_assignment", assignments)
    write(out_dir, "conflict", conflicts)
    write(out_dir, "unplaced_session", unplaced)
    write(out_dir, "plan_room_refused", PLAN_ROOMS_REFUSED)

    provenance = {
        "$comment": (
            "What in this dataset is real and what is invented. The distinction is not a "
            "formality: the demo shows a real university's real buildings, and anything that "
            "looks like a fact about OTH but is not has to be labelled before it reaches a slide."
        ),
        "seed": args.seed,
        "generatedBy": "tools/data/generate_timetable.py",
        "measured": {
            "building geometry, names, coordinates, campus membership":
                "OpenStreetMap, filtered by point-in-polygon against the real OTH campus outlines",
            "campus separation (2.48 km) and terrain heights":
                "LDBV DGM1 via the geodata pipeline",
            "room code shape (letter + three digits)":
                "measured from the 29 OTH rooms OSM does map (K 001, K 006 CIP-Pool)",
        },
        "derived": {
            "rooms per building": "usable floor (55% of footprint x storeys) filled by AREA with "
                                  "rooms of each type — not a room count, so a Hörsaalgebäude gets "
                                  "a few large rooms and a faculty building many small ones",
            "teaching vs office split": "share of usable floor given to teaching by building "
                                        "purpose (Hörsaalgebäude 85%, Labor/CIP 60%, otherwise 40%)",
            "room capacity": "area x seats-per-m² by room type",
            "travel time": "straight-line distance; walk at 1.35 m/s within a campus, bus between",
            "building code letters": "assigned deterministically — OTH's real letters are not public",
        },
        "synthetic": {
            "teachers and their names": "name pool + initial; NOT a roster of real OTH staff",
            "availability": "generated from plausible patterns (research day, early/late dislike)",
            "courses, cohorts, headcounts, sessions": "invented at a realistic scale for two faculties",
            "building ownership by faculty": "invented so that shared halls and a cross-campus "
                                             "Praktikum exist — not a claim about OTH's real estate",
            "block scheme": "7 x 90 min, an assumption pending OTH's real scheme (open question §9.8)",
        },
        "excludedOnPurpose": {
            "buildings of faculties we do not model": (
                "OTH has around eight faculties; this dataset models two. Buildings owned by the "
                "others (including ones really named Fakultät Architektur and Fakultät "
                "Bauingenieurwesen) are rendered but carry NO teaching rooms. They are not empty "
                "capacity — we can neither schedule nor observe them, and counting them as free "
                "would repeat the mistake of painting a room with no calendar 0% instead of grey."
            ),
            "non-teaching buildings": (
                "Bibliothek, Mensa, Verwaltung, Küche, Musikpavillon — real OTH buildings inside "
                "the campus outline that no timetable puts a lecture in."
            ),
        },
        "utilisationNote": (
            "Room utilisation must be read against the TEACHING stock. Dividing the same "
            "assignments by every room in every building gives ~3%, which is not a low "
            "utilisation but a wrong question — nobody holds a lecture in a professor's office."
        ),
    }
    (out_dir / "provenance.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  {'provenance':<16}      1 file")
    print(f"\nwrote {out_dir}")


if __name__ == "__main__":
    main()

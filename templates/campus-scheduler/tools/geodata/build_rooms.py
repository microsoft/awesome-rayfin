"""Join OpenStreetMap room polygons to NavigaTUM semantics and real bookings.

PLAN Phase 2, step 4 — the join and the geometry build, and the step the whole occupancy lens
stands on.

Three independent open sources meet here on the official TUM room code:

    OSM indoor room            NavigaTUM location           NavigaTUM calendar
      polygon, level, height     usage type, room name        real TUMonline bookings
      ref:tum = 5606.EG.041  ->  5606.EG.041             ->   lectures, week after week

What is measured, what is derived and what is invented is tracked explicitly, because a real
university's name is on the screen:

  * MEASURED   polygon outline, floor level, room height, usage type, bookings
  * DERIVED    floor area (shoelace over the real polygon), storey height, base elevation
  * SYNTHETIC  seat counts (floor area / a planning density) — and nothing else

⚠️ **No room is ever invented.** A building OpenStreetMap has not mapped indoors gets no rooms at
all and the app says so. Filling the gap with plausible boxes would be the single most dishonest
thing this project could do quietly.

Output (public/terrain/<aoi>/):
  rooms.bin        int16 polygon outlines, concatenated
  rooms.json       per-room attributes and index ranges, plus the coverage report
  occupancy.bin    per-room typical-week occupancy, one byte per slot

Usage
  python tools/geodata/build_rooms.py --aoi garching
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median

import numpy as np

from aoi import cache_dir, load_aoi, terrain_dir
from utm import wgs84_to_utm32

#: Polygon coordinates are stored as int16 at this resolution, relative to the terrain centre.
#: A 2.5 km core reaches +/-1260 m, which at 4 cm is +/-31500 — inside int16 with room to spare,
#: and four centimetres is far finer than the survey behind an indoor mapping trace.
XZ_SCALE_M = 0.04

#: Vertical values are uint16 centimetres above the terrain minimum.
Y_SCALE_M = 0.01

#: Added to the median room height to get a storey pitch. Floor slab, services and ceiling void.
SLAB_M = 0.45

#: Storey pitch is clamped into this band. Outside it the input is wrong, not the building.
STOREY_RANGE_M = (2.6, 7.0)

#: The occupancy grid: Monday-Friday, 07:00-20:59 local, one slot per hour.
OCC_DAYS = 5
OCC_FIRST_HOUR = 7
OCC_HOURS = 14
OCC_SLOTS = OCC_DAYS * OCC_HOURS

ROOM_CODE = re.compile(r"^(\d{4})\.")

try:  # stdlib since 3.9; the pipeline targets 3.11
    from zoneinfo import ZoneInfo

    LOCAL_TZ: object = ZoneInfo("Europe/Berlin")
except Exception:  # noqa: BLE001 - degrade rather than fail the whole build
    LOCAL_TZ = timezone.utc


def parse_level(raw: object) -> int | None:
    """The floor a room sits on.

    OSM allows a list (`-1;0;1;2;3`) for something spanning floors — a stairwell or a lift shaft.
    Those are drawn on their lowest level rather than repeated on every one, which keeps a floor's
    plan readable when the building is exploded.
    """
    if raw is None:
        return None
    text = str(raw).replace(",", ";").split(";")[0].strip()
    try:
        return int(round(float(text)))
    except ValueError:
        return None


def shoelace_m2(points: list[tuple[float, float]]) -> float:
    """Polygon area in square metres. Coordinates are already projected, so this is direct."""
    if len(points) < 3:
        return 0.0
    total = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
        total += x1 * y2 - x2 * y1
    return abs(total) * 0.5


class Terrain:
    """The generated heightmap, for sampling ground under a building."""

    def __init__(self, aoi_id: str) -> None:
        directory = terrain_dir({"id": aoi_id})
        self.meta = json.loads((directory / "heightmap.json").read_text(encoding="utf-8"))
        raw = (directory / self.meta["file"]).read_bytes()
        self.width = int(self.meta["width"])
        self.height = int(self.meta["height"])
        self.resolution = float(self.meta["resolutionM"])
        self.origin_e = float(self.meta["origin"]["easting"])
        self.origin_n = float(self.meta["origin"]["northing"])
        self.min_m = float(self.meta["heightMinM"])
        self.scale = float(self.meta["heightScale"])
        self.grid = np.frombuffer(raw, dtype="<u2").reshape(self.height, self.width)
        self.top_n = self.origin_n + self.height * self.resolution
        self.centre_e = self.origin_e + self.width * self.resolution / 2
        self.centre_n = self.origin_n + self.height * self.resolution / 2

    def sample(self, easting: float, northing: float) -> float:
        col = int(np.clip((easting - self.origin_e) / self.resolution, 0, self.width - 1))
        row = int(np.clip((self.top_n - northing) / self.resolution, 0, self.height - 1))
        return self.min_m + float(self.grid[row, col]) * self.scale

    def to_world(self, easting: float, northing: float) -> tuple[float, float]:
        """UTM metres to scene metres: +x east, +z south, origin at the terrain centre."""
        return easting - self.centre_e, self.centre_n - northing


def load_osm_rooms(aoi_id: str, ref_key: str) -> list[dict]:
    path = cache_dir("raw", "osm", aoi_id) / "indoor.json"
    if not path.exists():
        raise SystemExit(f"{path} not found — run tools/geodata/fetch_osm_indoor.py first")
    data = json.loads(path.read_text(encoding="utf-8"))
    rooms = []
    for element in data.get("elements", []):
        tags = element.get("tags", {})
        if tags.get("indoor") != "room":
            continue
        if element.get("type") != "way" or not element.get("geometry"):
            continue
        rooms.append(
            {
                "osmId": element["id"],
                "ref": (tags.get(ref_key) or "").strip() or None,
                "level": parse_level(tags.get("level")),
                "heightM": _float_or_none(tags.get("height")),
                "roomTag": tags.get("room"),
                "name": tags.get("name"),
                "geometry": element["geometry"],
            }
        )
    return rooms


def _float_or_none(raw: object) -> float | None:
    if raw is None:
        return None
    try:
        return float(str(raw).replace(",", ".").split()[0])
    except (ValueError, IndexError):
        return None


def load_navigatum(aoi_id: str) -> dict[str, dict]:
    path = cache_dir("raw", "navigatum", aoi_id) / "rooms.json"
    if not path.exists():
        return {}
    return {r["code"]: r for r in json.loads(path.read_text(encoding="utf-8"))}


def build_occupancy(aoi_id: str) -> tuple[dict[str, np.ndarray], dict[str, list[dict]]]:
    """A typical teaching week per room, from the real semester bookings, plus what runs there.

    Each slot counts the number of distinct calendar weeks in which that hour was booked. Counting
    weeks rather than events means a lecture running every Tuesday at 10:00 for a whole semester
    reads as a full slot, while a one-off room booking does not.

    The course titles come back too. A panel that can name `Grundlagen: Algorithmen und
    Datenstrukturen (IN0007)` is making a claim anyone at the university can check, which is worth
    a great deal more than another percentage.
    """
    path = cache_dir("raw", "navigatum", aoi_id) / "calendar.jsonl"
    if not path.exists():
        return {}, {}

    per_room: dict[str, defaultdict[int, set]] = defaultdict(lambda: defaultdict(set))
    titles: dict[str, Counter] = defaultdict(Counter)
    #: Every room the calendar API gave an answer for, booked or not.
    #
    # ⚠️ This is the difference between "never booked" and "we don't know", and they must not look
    # the same. The API returns a marker row — `{"room": …, "start": null, "empty": true}` — for a
    # room that publishes a calendar and had nothing in it all semester. The loop below skips those
    # rows because they carry no event, and for a long time that meant the room ended up with no
    # occupancy grid at all, which the UI renders grey as *unknown*.
    #
    # A room that is bookable and was never booked once in sixteen weeks is not unknown. It is 0 %,
    # and on a campus utilisation question it is the single most interesting kind of room there is.
    # There are 134 of them here against 179 that were booked, so treating them as missing data hid
    # 43 % of the answer and quietly inflated every mean by excluding the empty rooms from it.
    answered: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("room"):
            answered.add(event["room"])
        if not event.get("start") or not event.get("end"):
            continue
        try:
            start = datetime.fromisoformat(event["start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(event["end"].replace("Z", "+00:00"))
        except ValueError:
            continue
        # ⚠️ The API returns UTC. Munich is UTC+1/+2, so leaving these in UTC would shift every
        # lecture by an hour and put the 08:00 slot at 07:00 for half the semester.
        start = start.astimezone(LOCAL_TZ)
        end = end.astimezone(LOCAL_TZ)
        if start.weekday() >= OCC_DAYS or end <= start:
            continue

        week = start.isocalendar()[:2]
        if event.get("title"):
            titles[event["room"]][str(event["title"]).strip()] += 1
        # Every whole hour the booking touches. A 10:15-11:45 lecture occupies the 10:00 and
        # 11:00 slots, which is what a room-booking system means by "in use".
        first = start.hour
        last = (end.hour - 1) if end.minute == 0 else end.hour
        for hour in range(first, last + 1):
            if OCC_FIRST_HOUR <= hour < OCC_FIRST_HOUR + OCC_HOURS:
                slot = start.weekday() * OCC_HOURS + (hour - OCC_FIRST_HOUR)
                per_room[event["room"]][slot].add(week)

    grids: dict[str, np.ndarray] = {}
    for room, slots in per_room.items():
        grid = np.zeros(OCC_SLOTS, dtype=np.uint8)
        for slot, weeks in slots.items():
            grid[slot] = min(len(weeks), 255)
        grids[room] = grid

    # An all-zero week for every room that answered but was never booked. Same shape as any other
    # grid, so nothing downstream needs to special-case it — it simply reads 0 % everywhere.
    never_booked = sorted(answered - set(grids))
    for room in never_booked:
        grids[room] = np.zeros(OCC_SLOTS, dtype=np.uint8)
    if never_booked:
        print(
            f"  {len(grids) - len(never_booked)} rooms booked, "
            f"{len(never_booked)} published a calendar and were never booked"
        )

    top: dict[str, list[dict]] = {
        room: [{"title": title, "count": count} for title, count in counter.most_common(3)]
        for room, counter in titles.items()
    }
    return grids, top


# ── Synthetic substitute for the TUMonline calendar ──────────────────────────────────────────
#
# ⚠️ WHY THIS EXISTS. The room POLYGONS come from OpenStreetMap (ODbL) and are freely
# redistributable; only the SEMANTICS and the BOOKINGS come from NavigaTUM/TUMonline, whose
# redistribution terms are unresolved. Without a substitute, a public build loses the explode view
# entirely — and the explode view is geometry, which was never TUM's to withhold. So this
# generates a plausible teaching week instead, and the app badges it.
#
# ⚠️ WHAT IT DELIBERATELY DOES NOT DO: invent course titles. A percentage that is labelled
# synthetic is a modelling assumption; an invented lecture name attached to a real, checkable TUM
# room number is a false statement about a real place. `synthesise_occupancy` returns no courses,
# so the panel shows none.

#: Weeks in the modelled semester. A slot's value is "weeks booked", so this is its ceiling.
SYNTH_WEEKS = 16

#: Probability that a room of this kind carries a recurring booking in its BUSIEST hour.
#
# ⚠️ THESE ARE SLOT-OCCUPANCY ODDS, NOT A MEAN UTILISATION, because that is what the app measures:
# `rooms.ts` computes utilisation as the share of slots with ANY booking, not as a mean over week
# counts. A first cut drew every slot from `binomial(16, share)`, which put a non-zero value in
# nearly every slot and reported the campus at **86 % utilisation** — against a real measured mean
# of 30.5 %. A real timetable is close to binary: a slot either holds a lecture that recurs most
# of the semester, or it is empty.
SYNTH_UTILISATION: dict[str, float] = {
    "teaching": 0.90,
    "seminar": 0.70,
    "lab": 0.50,
    "office": 0.0,
    "service": 0.0,
    "other": 0.15,
}

#: Hour-of-day weighting, 07:00 to 20:00 inclusive. Teaching clusters 08:00-18:00 with a dip at
#: lunch; the first and last hours of the day are nearly empty.
SYNTH_HOUR_SHAPE = [
    0.05, 0.45, 0.85, 1.00, 0.95, 0.70, 0.90, 1.00, 0.95, 0.80, 0.55, 0.30, 0.12, 0.04,
]

#: Friday is materially lighter than the rest of the week at every German university.
SYNTH_DAY_SHAPE = [1.00, 1.00, 0.97, 0.95, 0.62]


#: OpenStreetMap `room=*` values mapped onto the vocabulary the rest of the app already speaks.
#
# ⚠️ THE VOCABULARY IS LOAD-BEARING, NOT COSMETIC. `src/twin3d/rooms.ts` decides what counts as a
# teaching room with a GERMAN regex (`hörsaal|seminarraum|übungsraum|…`), and the AOI config keys
# `seatDensityM2` by the same German names. Writing raw OSM values here produced a building with
# "0 Lehrräume von 395 Räumen" and no seat counts anywhere: the data was present and nothing could
# read it. Emitting NavigaTUM's vocabulary keeps one language in the pipeline.
OSM_USAGE_DE: dict[str, str] = {
    "auditorium": "Hörsaal",
    "lecture": "Hörsaal",
    "lecture_hall": "Hörsaal",
    "classroom": "Seminarraum",
    "class": "Seminarraum",
    "seminar": "Seminarraum",
    "study": "Studentenarbeitsraum",
    "computer": "Praktikumsraum - EDV",
    "computer_lab": "Praktikumsraum - EDV",
    "laboratory": "Labor",
    "lab": "Labor",
    "workshop": "Werkstatt",
    "office": "Büro",
    "administration": "Büro",
    "meeting": "Besprechungsraum",
    "conference": "Besprechungsraum",
    "library": "Bibliothek",
    "storage": "Lager",
    "stairs": "Treppenhaus",
    "staircase": "Treppenhaus",
    "corridor": "Flur",
    "elevator": "Aufzug",
    "toilet": "WC",
    "toilets": "WC",
    "restroom": "WC",
    "showers": "Sanitärraum",
    "kitchen": "Küche",
    "canteen": "Mensa",
    "technical": "Technikraum",
    "plant": "Technikraum",
    "server": "Technikraum",
    "hall": "Halle",
    "auditorium_seating": "Hörsaal",
}

#: Which bucket each usage label falls into, for the purposes of inventing a plausible week.
USAGE_BUCKETS: list[tuple[tuple[str, ...], str]] = [
    (("hörsaal", "auditorium", "audimax"), "teaching"),
    (("seminarraum", "übungsraum", "unterrichtsraum", "studentenarbeitsraum"), "seminar"),
    (("labor", "praktikumsraum", "werkstatt", "edv"), "lab"),
    (("büro", "besprechungsraum", "bibliothek", "sekretariat"), "office"),
]


def synth_usage(room_tag: str | None, name: str | None, area_m2: float) -> str:
    """A usage label for a room whose authoritative semantics are withheld.

    Two sources, in order of how much they can be trusted:

    1. The OpenStreetMap `room=*` tag, where it exists. That is MEASURED — somebody surveyed it.
       Only about 8 % of rooms here carry one.
    2. Floor area, for the rest. That is a GUESS, and it is why the whole layer is badged.

    ⚠️ THE AREA FALLBACK IS DELIBERATELY CONSERVATIVE. An earlier cut called every room over
    180 m² a lecture hall, which on a research campus is wrong in the common case — the real
    catalogue here is dominated by offices, plant rooms and stores, with lecture halls rare. A
    fallback that invents a campus full of Hörsäle would flatter the utilisation figure it then
    feeds.
    """
    tag = (room_tag or "").strip().lower()
    if tag in OSM_USAGE_DE:
        return OSM_USAGE_DE[tag]

    text = (name or "").lower()
    for keys, _bucket in USAGE_BUCKETS:
        if any(k in text for k in keys):
            # The name said what it is; keep the name's own word, title-cased for consistency.
            for k in keys:
                if k in text:
                    return k.title()

    if area_m2 >= 200:
        return "Hörsaal"
    if area_m2 >= 80:
        return "Seminarraum"
    if area_m2 >= 12:
        return "Büro"
    return "Technikraum"


def synth_bucket(usage: str | None) -> str:
    """Bucket a usage label for the occupancy model."""
    text = (usage or "").lower()
    for keys, bucket in USAGE_BUCKETS:
        if any(k in text for k in keys):
            return bucket
    if any(
        k in text
        for k in ("wc", "flur", "treppe", "aufzug", "lager", "technik", "sanitär", "küche")
    ):
        return "service"
    return "other"


def synthesise_occupancy(aoi_id: str, code: str, usage: str | None) -> np.ndarray:
    """A deterministic invented teaching week for one room.

    ⚠️ SEEDED PER ROOM CODE, so the same room gets the same week on every rebuild and a screenshot
    taken today still matches next month. Adding a room does not reshuffle the others — the same
    named-stream discipline `build_condition.py` uses for the Sanierungsstau grades.
    """
    digest = hashlib.sha256(f"{aoi_id}:{code}:occupancy".encode("utf-8")).digest()
    rng = np.random.default_rng(int.from_bytes(digest[:8], "big"))

    peak = SYNTH_UTILISATION[synth_bucket(usage)]
    grid = np.zeros(OCC_SLOTS, dtype=np.uint8)
    if peak <= 0:
        # Not a bookable room. An all-zero grid reads as 0 %, which is the honest answer for an
        # office — and is NOT the same as having no grid at all, which reads as "unknown".
        return grid

    # A room is not equally popular all semester; give each one its own character.
    room_factor = float(rng.uniform(0.55, 1.15))
    for day in range(OCC_DAYS):
        for hour in range(OCC_HOURS):
            share = peak * SYNTH_HOUR_SHAPE[hour] * SYNTH_DAY_SHAPE[day] * room_factor
            if rng.random() >= min(share, 1.0):
                continue  # empty slot, and most of them are
            # A booking that recurs for most of the semester, the way a weekly lecture does.
            # Never the full 16: reading weeks, public holidays and the odd cancellation.
            grid[day * OCC_HOURS + hour] = int(rng.integers(SYNTH_WEEKS - 5, SYNTH_WEEKS + 1))
    return grid


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="garching")
    parser.add_argument(
        "--semantics",
        choices=["navigatum", "synthetic"],
        default="navigatum",
        help=(
            "where room usage and bookings come from. 'synthetic' keeps the OpenStreetMap "
            "polygons — which is what the explode view actually needs — and invents the week, "
            "for builds that may not redistribute TUMonline data."
        ),
    )
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    rooms_cfg = cfg.get("rooms")
    if not rooms_cfg:
        print(f"AOI '{cfg['id']}' declares no `rooms` block — nothing to build.")
        print("That is a statement about the site: no indoor data exists here.")
        return

    synthetic_mode = args.semantics == "synthetic"

    ref_key = rooms_cfg.get("osmRefKey", "ref:tum")
    terrain = Terrain(cfg["id"])
    osm_rooms = load_osm_rooms(cfg["id"], ref_key)
    # ⚠️ In synthetic mode these two are not merely skipped — they must not be READ. Falling back
    # to "use the cache if it happens to be there" would silently publish TUM data from an earlier
    # internal build, which is the exact failure this mode exists to prevent.
    semantics = {} if synthetic_mode else load_navigatum(cfg["id"])
    occupancy, courses = ({}, {}) if synthetic_mode else build_occupancy(cfg["id"])

    print(f"{len(osm_rooms)} OSM room polygons")
    if synthetic_mode:
        print("semantics: SYNTHETIC — no NavigaTUM, no TUMonline, no course titles")
    else:
        print(f"{len(semantics)} NavigaTUM rooms")
        print(f"{len(occupancy)} rooms with bookings")

    # ── Group by building, so a floor is flat ────────────────────────────────────────────
    by_building: dict[str, list[dict]] = defaultdict(list)
    unreferenced = 0
    for room in osm_rooms:
        if not room["ref"]:
            unreferenced += 1
            continue
        match = ROOM_CODE.match(room["ref"])
        if not match:
            unreferenced += 1
            continue
        by_building[match.group(1)].append(room)

    print(f"{len(by_building)} buildings, {unreferenced} rooms without a usable {ref_key}")

    # ── Project, and work out each building's ground and storey pitch ────────────────────
    for building, rooms in by_building.items():
        eastings: list[float] = []
        northings: list[float] = []
        for room in rooms:
            # wgs84_to_utm32 returns a plain (easting, northing) tuple.
            projected = [wgs84_to_utm32(p["lon"], p["lat"]) for p in room["geometry"]]
            room["utm"] = projected
            eastings.extend(e for e, _ in projected)
            northings.extend(n for _, n in projected)

        # One ground elevation for the whole building. Sampling per room would make a single
        # floor undulate by a few centimetres, which is visible the moment it is exploded.
        centre_e = sum(eastings) / len(eastings)
        centre_n = sum(northings) / len(northings)
        ground = terrain.sample(centre_e, centre_n)

        heights = [r["heightM"] for r in rooms if r["heightM"]]
        # Storey pitch is DERIVED from the measured room heights rather than assumed, then clamped.
        # 3 806 of these rooms carry a surveyed `height` tag, so this is a real number for almost
        # every building; the config default only covers buildings where none do.
        if heights:
            pitch = median(heights) + SLAB_M
        else:
            pitch = float(rooms_cfg.get("storeyHeightM", 3.6))
        pitch = min(max(pitch, STOREY_RANGE_M[0]), STOREY_RANGE_M[1])

        for room in rooms:
            room["building"] = building
            room["ground"] = ground
            room["pitch"] = pitch

    # ── Emit ────────────────────────────────────────────────────────────────────────────
    vertices: list[int] = []
    records: list[dict] = []
    occupancy_rows: list[np.ndarray] = []
    seat_density = rooms_cfg.get("seatDensityM2", {})

    matched = 0
    skipped_small = 0
    usage_counts: Counter[str] = Counter()

    for building in sorted(by_building):
        for room in sorted(by_building[building], key=lambda r: (r["level"] or 0, r["ref"])):
            level = room["level"]
            if level is None:
                continue

            world = [terrain.to_world(e, n) for e, n in room["utm"]]
            # OSM closes a way by repeating the first node; the renderer does not need it.
            if len(world) > 1 and world[0] == world[-1]:
                world = world[:-1]
            if len(world) < 3:
                continue

            area = shoelace_m2(world)
            if area < 1.0:
                skipped_small += 1
                continue

            info = semantics.get(room["ref"], {})
            if synthetic_mode:
                # ⚠️ DERIVED, NOT MEASURED — and it must be in the same vocabulary the app reads,
                # or the teaching-room regex and the seat densities both silently find nothing.
                usage = synth_usage(room["roomTag"], room["name"], area)
            else:
                usage = info.get("usage") or room["roomTag"] or None
            usage_counts[usage or "(unknown)"] += 1
            if info.get("usage"):
                matched += 1

            height = room["heightM"] or (room["pitch"] - SLAB_M)
            base = room["ground"] + level * room["pitch"]

            # ⚠️ SYNTHETIC. Seats are not published anywhere: the OSM `capacity` tag is present on
            # about 1.5 % of rooms and NavigaTUM exposes none. They are derived from real floor
            # area and an ordinary planning density, and everything computed from them is badged
            # in the UI. The area itself is honest.
            density = seat_density.get(usage or "")
            seats = int(round(area / density)) if density else None

            offset = len(vertices) // 2
            for x, z in world:
                vertices.append(int(round(x / XZ_SCALE_M)))
                vertices.append(int(round(z / XZ_SCALE_M)))

            grid = occupancy.get(room["ref"])
            if grid is None and synthetic_mode:
                # ⚠️ EVERY room gets a grid here, including the ones the model says are never
                # booked. That is deliberate and mirrors the real path: an all-zero week reads as
                # 0 %, whereas no grid at all reads as *unknown*, and "this office is never
                # timetabled" is information.
                grid = synthesise_occupancy(cfg["id"], room["ref"], usage)
            occ_index = None
            if grid is not None:
                occ_index = len(occupancy_rows)
                occupancy_rows.append(grid)

            records.append(
                {
                    "code": room["ref"],
                    "building": building,
                    "level": level,
                    "usage": usage,
                    "name": info.get("name") or room["name"],
                    "areaM2": round(area, 1),
                    "seats": seats,
                    "baseM": round(base, 2),
                    "heightM": round(height, 2),
                    "vertexOffset": offset,
                    "vertexCount": len(world),
                    "occupancy": occ_index,
                    "courses": courses.get(room["ref"]) or None,
                }
            )

    out_dir = terrain_dir(cfg)
    bin_path = out_dir / "rooms.bin"
    bin_path.write_bytes(struct.pack(f"<{len(vertices)}h", *vertices))

    # ⚠️ A room is identified by its code, and a code can be drawn as more than one polygon.
    #
    # OpenStreetMap has 5532.Z1.003 mapped twice on the same level with different outlines — either
    # one room traced in two parts or a tagging slip; from here the two are indistinguishable. The
    # renderer wants every polygon, because that is what the floor looks like. Anything that counts
    # or joins rooms wants distinct CODES, because that is what a room is. Reporting both keeps the
    # difference visible instead of letting each consumer quietly pick one.
    distinct = {record["code"] for record in records}
    duplicates = len(records) - len(distinct)

    occ_path = out_dir / "occupancy.bin"
    if occupancy_rows:
        occ_path.write_bytes(np.concatenate(occupancy_rows).tobytes())
    elif occ_path.exists():
        occ_path.unlink()

    # ── Coverage report ─────────────────────────────────────────────────────────────────
    expected = {b["code"]: b["osmRooms"] for b in rooms_cfg.get("exploreBuildings", [])}
    per_building = Counter(r["building"] for r in records)
    coverage = []
    for code, want in sorted(expected.items()):
        got = per_building.get(code, 0)
        coverage.append({"building": code, "expected": want, "built": got})

    meta = {
        "aoi": cfg["id"],
        "count": len(records),
        "distinctRooms": len(distinct),
        "duplicatePolygons": duplicates,
        "buildings": len(per_building),
        "withUsage": matched,
        "withOccupancy": len(occupancy_rows),
        "encoding": f"int16 x,z at {XZ_SCALE_M} m, relative to the terrain centre; +x east, +z south",
        "quantisation": {"xzScaleM": XZ_SCALE_M, "yScaleM": Y_SCALE_M},
        "occupancyGrid": {
            "days": OCC_DAYS,
            "firstHour": OCC_FIRST_HOUR,
            "hours": OCC_HOURS,
            "slots": OCC_SLOTS,
            "meaning": (
                "invented weeks in a modelled semester in which the slot was booked"
                if synthetic_mode
                else "distinct calendar weeks in the reference semester in which the slot was booked"
            ),
            "semester": (
                f"synthetic-{SYNTH_WEEKS}w" if synthetic_mode else rooms_cfg["referenceSemester"]["id"]
            ),
        },
        # ⚠️ THE APP KEYS ITS BADGE OFF THIS FIELD, not off the AOI id. `rooms.ts` refuses to render
        # an occupancy layer whose semantics it cannot name, so a build that forgets to stamp this
        # fails loudly rather than presenting invented utilisation as measured.
        "semantics": "synthetic" if synthetic_mode else "navigatum",
        "provenance": {
            "geometry": "measured — OpenStreetMap Simple Indoor Tagging (ODbL 1.0)",
            "usage": (
                "derived — OpenStreetMap room tag and name where present, else floor area"
                if synthetic_mode
                else "measured — NavigaTUM / TUMonline"
            ),
            "bookings": (
                "SYNTHETIC — a seeded, invented teaching week per room. NOT TUM's timetable, "
                "and no course titles are generated. Badge it wherever it is shown."
                if synthetic_mode
                else "measured — NavigaTUM calendar (TUMonline)"
            ),
            "areaM2": "derived — shoelace over the real polygon in EPSG:25832",
            "baseM": "derived — terrain ground + level x storey pitch (median room height + slab)",
            "seats": "SYNTHETIC — floor area / a planning density; badge it wherever it is shown",
        },
        "coverage": coverage,
        "rooms": records,
    }
    (out_dir / "rooms.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    print(f"\n{len(records)} room polygons built across {len(per_building)} buildings")
    print(f"  {len(distinct)} distinct room codes ({duplicates} code drawn as several polygons)")
    print(f"  {matched} carry an authoritative usage type")
    print(f"  {len(occupancy_rows)} carry {'a synthetic week' if synthetic_mode else 'real bookings'}")
    print(f"  {skipped_small} skipped as under 1 m2")
    print("\ntop usage types:")
    for usage, count in usage_counts.most_common(12):
        print(f"  {str(usage)[:44]:<46} {count:>5}")
    print("\ncoverage against the AOI config's recorded probe:")
    for row in coverage:
        flag = "" if row["built"] >= row["expected"] * 0.8 else "   <-- short"
        print(f"  {row['building']}  expected {row['expected']:>4}  built {row['built']:>4}{flag}")
    print(f"\nwrote {bin_path} ({bin_path.stat().st_size / 1024:.0f} KB)")
    print(f"wrote {out_dir / 'rooms.json'} ({(out_dir / 'rooms.json').stat().st_size / 1024:.0f} KB)")
    if occupancy_rows:
        print(f"wrote {occ_path} ({occ_path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()

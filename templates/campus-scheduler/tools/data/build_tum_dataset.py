"""Build TUM Garching's scheduler dataset out of REAL TUMonline bookings — `data/tum/`.

⚠️ THIS SITE IS NOT LIKE THE OTHER TWO, AND THE DIFFERENCE IS THE POINT. OTH's and LMU's timetables
are invented from an academic profile and then PLACED by a solver: every session, cohort and
lecturer is generated. Garching's bookings are real — 41 695 of them from TUMonline over the winter
semester, in 179 rooms, 176 of which join the room geometry this repo already ships. So this builder
does not plan anything. It TRANSFORMS a real timetable into the shape the app reads, and the only
invented dimensions are the two the feed genuinely does not carry.

REAL here:
  · the session — room, day, start, end, exactly as TUMonline published it
  · the published plan — because the real timetable IS the published plan, no solver required
  · the room, and its join to the surveyed building
  · the course, wherever the title carries a TUM module code: `(IN0009)`, `[MA0902]`
  · parallel groups — the same course running in two rooms at once is a fact of the feed

INVENTED, and badged as such in `provenance.json`:
  · WHO teaches it — the feed has no `teacher`, `lecturer` or `organizer` field at all
  · WHICH cohort attends — no `cohort`, `group` or `curriculum` field either

⚠️ `IRIS Belegung` IS NOT TEACHING. 14 938 of the 41 695 rows carry that title — 36% — and it is the
room-booking system's placeholder, not an event. Left in, it would outnumber every real lecture put
together and make the busiest "course" at TUM a piece of software.

⚠️ THE FEED IS UTC; GARCHING IS NOT. `06:00Z` is an 08:00 lecture, and the semester crosses the
October DST change, so a fixed offset would put half the winter an hour wrong. Every timestamp is
converted through Europe/Berlin.

⚠️ A SEMESTER IS NOT A WEEK. The app reads one canonical teaching week; the feed is seventeen,
including the lecture-free ones. A weekly series is collapsed onto the slot it repeats in, and the
number of weeks it ran is kept — a booking that happened once is not the claim that one which
happened fourteen times is.

    python tools/data/build_tum_dataset.py
    python tools/data/build_tum_dataset.py --min-weeks 3
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import struct
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "navigatum" / "garching"
TERRAIN = ROOT / "public" / "terrain" / "garching"
GEOMETRY = TERRAIN / "rooms.json"
AOI = ROOT / "config" / "aoi" / "garching.json"
OUT = ROOT / "data" / "tum"

BERLIN = ZoneInfo("Europe/Berlin")
DAYS = ["Mo", "Di", "Mi", "Do", "Fr"]

# The hours TUM actually teaches in. Measured, not assumed: these eleven carry 99.9% of the
# repeating week, and the two strays outside them (07:00 and 20:00) are one series each.
FIRST_HOUR, LAST_HOUR = 8, 18

PLACEHOLDER_TITLES = {"iris belegung"}
MODULE_CODE = re.compile(r"[\(\[]([A-Z]{2}[0-9]{4})[\)\]]")

FACULTY_OF_PREFIX = {
    "IN": ("IN", "Informatik"),
    "MA": ("MA", "Mathematik"),
    "PH": ("PH", "Physik"),
    "CH": ("CH", "Chemie"),
    "MW": ("MW", "Maschinenwesen"),
    "EI": ("EI", "Elektro- und Informationstechnik"),
    "WI": ("WI", "Wirtschaftswissenschaften"),
    "BV": ("BV", "Bau und Umwelt"),
    "SG": ("SG", "Sport- und Gesundheitswissenschaften"),
    "LS": ("LS", "Life Sciences"),
}
DEFAULT_FACULTY = ("XX", "Fakultätsübergreifend")

# ⚠️ ORDINARY NAMES, DELIBERATELY, AND NEVER A REAL PERSON'S. The feed names nobody, so every
# lecturer below is fabricated. The pool is common Bavarian surnames with a single initial, so the
# result cannot be mistaken for — or matched against — an actual TUM staff directory.
SURNAMES = [
    "Achleitner", "Angermeier", "Baumgartner", "Brandstetter", "Deininger", "Eberl", "Ecker",
    "Fischbeck", "Forstner", "Gruber", "Gschwendtner", "Hammerl", "Hofstetter", "Innerhofer",
    "Kastner", "Kirchmeier", "Leitner", "Moosbauer", "Neuhauser", "Oberlechner", "Pichler",
    "Rieger", "Steinbacher", "Thalmeier", "Unterreiner", "Vogler", "Wimmer", "Zehetmair",
]
INITIALS = "ABCDEFGHIJKLMNOPRSTUVW"

ROOM_TYPE_FOR_KIND = {
    "Vorlesung": "Hörsaal",
    "Übung": "Seminarraum",
    "Seminar": "Seminarraum",
    "Tutorium": "Seminarraum",
    "Praktikum": "Labor",
    "Prüfung": "Hörsaal",
}

# ⚠️ SQUARE METRES PER SEAT, READ BACK OUT OF THE TERRAIN BUILD RATHER THAN INVENTED HERE. That
# build already estimated `seats` for 1 203 rooms, and dividing its area by its seats recovers the
# density it used: 0.8 for a lecture hall, 2.0 for a seminar room, 3.0 for a lab. It covers only
# the usages it recognised, so 27 rooms TUM genuinely teaches in — Zeichensaal, Versuchshalle,
# Praktikumsraum Physik — came out with no seats at all, and a capacity of zero would tell the
# solver those rooms hold nobody. The lab figure fills them, on the same basis as its neighbours.
M2_PER_SEAT_FALLBACK = 3.0


def stable(*parts: str) -> int:
    """A deterministic number from text, so a rebuild does not reshuffle every invented name."""
    return int(hashlib.sha1("\x1f".join(parts).encode("utf-8")).hexdigest()[:8], 16)


def building_positions(geometry: dict) -> dict[str, dict]:
    """Where each building actually stands, averaged over its real room polygons.

    ⚠️ MEASURED, NOT PLACED. `rooms.bin` stores every room's outline as int16 x/z at 0.04 m from
    the terrain centre — real OpenStreetMap indoor geometry — so a building's position is the mean
    of its own rooms rather than a guess, and the distances between buildings that follow are real
    metres. This matters because the travel matrix decides whether the planner thinks a lecturer
    can get from one room to the next in the ten minutes between blocks.
    """
    aoi = json.loads(AOI.read_text(encoding="utf-8"))
    bbox = aoi["bbox"]
    centre_lat = (bbox["south"] + bbox["north"]) / 2
    centre_lon = (bbox["west"] + bbox["east"]) / 2
    scale = geometry["quantisation"]["xzScaleM"]
    raw = (TERRAIN / "rooms.bin").read_bytes()
    verts = struct.unpack(f"<{len(raw) // 2}h", raw)

    sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0])
    for room in geometry["rooms"]:
        building = room.get("building")
        if not building:
            continue
        off, n = room["vertexOffset"], room["vertexCount"]
        if n <= 0 or (off + n) * 2 > len(verts):
            continue
        xs = verts[off * 2: (off + n) * 2: 2]
        zs = verts[off * 2 + 1: (off + n) * 2: 2]
        acc = sums[building]
        acc[0] += sum(xs) * scale
        acc[1] += sum(zs) * scale
        acc[2] += n

    metres_per_deg_lat = 111_320.0
    metres_per_deg_lon = 111_320.0 * math.cos(math.radians(centre_lat))
    positions: dict[str, dict] = {}
    for building, (sx, sz, n) in sums.items():
        if not n:
            continue
        east, south = sx / n, sz / n
        positions[building] = {
            "eastM": round(east, 1),
            "southM": round(south, 1),
            "lat": round(centre_lat - south / metres_per_deg_lat, 6),
            "lon": round(centre_lon + east / metres_per_deg_lon, 6),
        }
    return positions


def load_bookings() -> list[dict]:
    rows = [
        json.loads(line)
        for line in (RAW / "calendar.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    return [r for r in rows if not r.get("empty") and r.get("start") and r.get("end")]


def teaching_only(rows: list[dict]) -> tuple[list[dict], Counter, list[dict]]:
    """Split the feed into teaching, and what is merely OCCUPYING a room.

    ⚠️ THE THINGS THAT ARE NOT TEACHING STILL FILL THE ROOM. `IRIS Belegung` is a room-booking
    placeholder rather than a lecture, and `type=other` is everything from a recruitment talk to a
    doctoral defence — none of it belongs in a timetable, and all of it means the room is taken.
    Dropping them entirely would leave the solver believing 17 000 room-hours are free and cheerfully
    proposing that a lecture move into one, which is a confident, checkable, wrong answer: the exact
    failure this project treats as worse than no answer. They come back as `room_block` rows.
    """
    kept: list[dict] = []
    dropped: Counter = Counter()
    occupying: list[dict] = []
    for r in rows:
        placeholder = (r.get("title") or "").strip().lower() in PLACEHOLDER_TITLES
        start = datetime.fromisoformat(r["start"].replace("Z", "+00:00")).astimezone(BERLIN)
        if start.weekday() > 4:
            dropped["weekend"] += 1
            continue
        if placeholder:
            dropped["room-system placeholder (IRIS Belegung)"] += 1
            occupying.append(r)
            continue
        if r.get("type") not in ("lecture", "exam"):
            dropped[f"not teaching (type={r.get('type')})"] += 1
            # `barred` is the university deliberately taking a room OUT of use, which blocks it just
            # as firmly as a booking does.
            occupying.append(r)
            continue
        kept.append(r)
    return kept, dropped, occupying


def course_of(title: str) -> tuple[str | None, str]:
    """The module code the title carries, and the title with that code removed."""
    match = MODULE_CODE.search(title)
    if not match:
        return None, title.strip()
    cleaned = MODULE_CODE.sub("", title).strip(" -–—[]()").strip()
    return match.group(1), cleaned or match.group(1)


def kind_of(title: str) -> str:
    """Vorlesung, Übung, Praktikum, Seminar or Tutorium — read off the title TUM wrote."""
    low = title.lower()
    if "übung" in low or low.startswith("ue "):
        return "Übung"
    if "praktikum" in low:
        return "Praktikum"
    if "seminar" in low:
        return "Seminar"
    if "tutorium" in low:
        return "Tutorium"
    if "klausur" in low or "prüfung" in low:
        return "Prüfung"
    return "Vorlesung"


def capacity_of(geo: dict | None) -> int:
    """How many people a room holds — the terrain estimate, or the same sum where it is silent."""
    if not geo:
        return 30
    seats = int(geo.get("seats") or 0)
    if seats:
        return seats
    area = geo.get("areaM2") or 0
    return max(8, round(area / M2_PER_SEAT_FALLBACK)) if area else 30


def block_category(row: dict) -> str:
    """Why a room is unavailable — as a CATEGORY, never as the booking's own title.

    ⚠️ THE NON-TEACHING TITLES NAME REAL PEOPLE. TUMonline publishes them, so they are public, but
    they are also things like "Meeting Peter Buckel AMX" and "Prof. Timo Oksanen" — real staff of a
    real university, in room bookings that are nobody's business and add nothing to a demo. This
    project already fabricates every lecturer name it shows for exactly this reason, and it would be
    incoherent to fabricate the teaching staff and then ship a stranger's diary beside it.

    The COURSE titles are kept as published: a lecture's name is what the university teaches, it
    names no individual, and it is the whole point of using real data.
    """
    if (row.get("title") or "").strip().lower() in PLACEHOLDER_TITLES:
        return "Raumbuchung (Raumverwaltung)"
    if row.get("type") == "barred":
        return "gesperrt"
    return "sonstige Nutzung (kein Lehrbetrieb)"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--min-weeks", type=int, default=2,
                        help="a series must repeat this many weeks to enter the canonical week")
    args = parser.parse_args()

    print("=== TUM Garching — a REAL timetable, reshaped ===")
    raw_rows = load_bookings()
    bookings, dropped, occupying = teaching_only(raw_rows)
    print(f"teaching bookings {len(bookings):,} of {len(raw_rows):,}")
    for reason, n in dropped.most_common():
        print(f"                  {n:6,} dropped — {reason}")

    geometry = json.loads(GEOMETRY.read_text(encoding="utf-8"))
    geo_rooms = {r["code"]: r for r in geometry["rooms"] if r.get("code")}
    print(f"room geometry     {len(geo_rooms):,} surveyed rooms available")

    # ── collapse the semester onto one week ───────────────────────────────────────────
    series: dict[tuple, list[datetime]] = defaultdict(list)
    for r in bookings:
        start = datetime.fromisoformat(r["start"].replace("Z", "+00:00")).astimezone(BERLIN)
        end = datetime.fromisoformat(r["end"].replace("Z", "+00:00")).astimezone(BERLIN)
        key = (r["room"], start.weekday(), start.strftime("%H:%M"),
               end.strftime("%H:%M"), r["title"].strip())
        series[key].append(start)

    repeating = {k: v for k, v in series.items()
                 if len({t.isocalendar()[1] for t in v}) >= args.min_weeks}
    print(f"weekly series     {len(repeating):,} repeat {args.min_weeks}+ weeks "
          f"(of {len(series):,} room/day/time/title combinations)")

    # ── the slot grid, at the hour TUM starts on ──────────────────────────────────────
    #
    # ⚠️ OTH teaches seven 90-minute blocks from 08:00 and LMU six c.t. blocks from 08:15. Both are
    # facts about those universities and neither is a fact about this one. TUM's real starts run
    # hourly with a heavy c.t. tail, so the block is the HOUR and the exact published time rides
    # along on the session — the calendar shows 10:15 because the lecture is at 10:15.
    time_slots = []
    for day_i, day in enumerate(DAYS):
        for hour in range(FIRST_HOUR, LAST_HOUR + 1):
            block = hour - FIRST_HOUR + 1
            time_slots.append({
                "slotId": f"{day}-{block}",
                "day": day,
                "dayIndex": day_i,
                "block": block,
                "startTime": f"{hour:02d}:00",
                "endTime": f"{hour + 1:02d}:00",
                "desirability": 0.0,  # observed below, once the week is known
            })
    slot_by_key = {(s["day"], s["block"]): s for s in time_slots}

    def slot_for(weekday: int, start_hhmm: str) -> dict | None:
        hour = int(start_hhmm[:2])
        if not (FIRST_HOUR <= hour <= LAST_HOUR) or weekday > 4:
            return None
        return slot_by_key[(DAYS[weekday], hour - FIRST_HOUR + 1)]

    # ── merge cross-listings ──────────────────────────────────────────────────────────
    #
    # ⚠️ ONE ROOM AT ONE HOUR IS ONE EVENT, and TUMonline lists it more than once. Of the 226 pairs
    # sharing a room and an hour, 213 genuinely run in the same weeks — and reading them shows why:
    # `Technische Dynamik (Modul MW2098)` and `Technische Dynamik (MW2098)` are the same lecture
    # spelled twice, `Medical Technology 1` and `Introduction to Medical and Polymers Technology`
    # are one joint lecture cross-listed to two degrees, and `Seminar Angewandte Mikrotechnik` and
    # `Seminar Mechatronische Medizintechnik` share a seminar between two programmes. Treating
    # those as clashes would invent 192 room conflicts that TUM does not have; the titles are kept
    # so nothing is thrown away.
    events: dict[tuple, dict] = {}
    for key, times in sorted(repeating.items(), key=lambda kv: -len(kv[1])):
        room, weekday, start_s, end_s, title = key
        slot = slot_for(weekday, start_s)
        if slot is None:
            continue
        merge_key = (room, slot["slotId"])
        weeks = {t.isocalendar()[1] for t in times}
        existing = events.get(merge_key)
        if existing is None:
            events[merge_key] = {
                "room": room, "slot": slot, "title": title,
                "start": start_s, "end": end_s,
                "weeks": weeks, "alsoKnownAs": [],
            }
        elif existing["weeks"] & weeks:
            existing["alsoKnownAs"].append(title)
            existing["end"] = max(existing["end"], end_s)
            existing["weeks"] |= weeks
        else:
            # Disjoint weeks: two courses taking the room in sequence, not at once. Keeping the
            # longer-running one is a judgement, so it is recorded rather than silently dropped.
            existing["alsoKnownAs"].append(f"{title} (andere Semesterhälfte)")
    merged = sum(len(e["alsoKnownAs"]) for e in events.values())
    print(f"events            {len(events):,} after merging {merged:,} cross-listed titles")

    # ── courses ───────────────────────────────────────────────────────────────────────
    courses: dict[str, dict] = {}
    course_events: dict[str, list[dict]] = defaultdict(list)
    for event in events.values():
        title = event["title"]
        code, clean_title = course_of(title)
        kind = kind_of(title)
        # ⚠️ A module code alone is not an identity: `IN0009` covers both the Vorlesung and its
        # Übungen, which need different rooms and different groups. Key on code AND kind.
        suffix = kind[:2].upper()
        course_id = f"{code}-{suffix}" if code else f"T{stable(clean_title) % 100000:05d}-{suffix}"
        faculty_id, faculty_name = FACULTY_OF_PREFIX.get((code or "")[:2], DEFAULT_FACULTY)
        courses.setdefault(course_id, {
            "courseId": course_id,
            "title": clean_title,
            "moduleCode": code,
            "courseType": kind,
            "facultyId": faculty_id,
            "facultyName": faculty_name,
            "requiredRoomType": ROOM_TYPE_FOR_KIND.get(kind, "Seminarraum"),
            "provenance": "measured — title published by TUMonline"
                          if code else "measured — title published by TUMonline, no module code",
        })
        course_events[course_id].append(event)
    print(f"courses           {len(courses):,} distinct module/kind pairs")

    # ── teachers, INVENTED — but never double-booked ──────────────────────────────────
    #
    # ⚠️ HASHING A NAME ONTO A COURSE PRODUCES A BROKEN TIMETABLE. The first attempt did exactly
    # that and put one invented lecturer in eight rooms at once on Monday afternoon — 421 clashes
    # in a plan whose entire selling point is that it is real. The invention has to RESPECT the
    # timetable it is attached to: a lecturer may only take an hour they are still free for, and a
    # new one is hired when nobody is.
    #
    # ⚠️ AND IT IS PER SESSION, NOT PER COURSE. Assigning one lecturer to a whole course looks
    # right until a course runs four parallel Übung groups at 14:00 in four rooms — which TUM
    # really does — and that one person is now in all four. Parallel groups get their own tutors,
    # which is what a university actually staffs.
    teachers: dict[str, dict] = {}
    teacher_of_session: dict[str, str] = {}
    teacher_busy: dict[str, set[str]] = defaultdict(set)
    faculty_teachers: dict[str, list[str]] = defaultdict(list)
    taken_names: set[str] = set()

    def hire(faculty_id: str) -> str:
        teacher_id = f"{faculty_id}-T{len(faculty_teachers[faculty_id]) + 1:03d}"
        h = stable(teacher_id)
        # ⚠️ TWO LECTURERS MUST NOT SHARE A NAME. Hashing an initial and a surname independently
        # gave 127 people only 120 distinct names — seven collisions, because 28 surnames and 22
        # initials collide long before the pool runs out (OTH and LMU have none). A planner types a
        # surname, so a duplicate is not cosmetic: `find_teacher` cannot tell them apart and the
        # calendar returns "which one?" for a question that should have one answer. The hash still
        # picks the starting point, so names stay stable between rebuilds; it just walks on when
        # that name is taken.
        for attempt in range(len(INITIALS) * len(SURNAMES)):
            initial = INITIALS[(h + attempt) % len(INITIALS)]
            surname = SURNAMES[(h // 7 + (h + attempt) // len(INITIALS)) % len(SURNAMES)]
            name = f"Prof. Dr. {initial}. {surname}"
            if name not in taken_names:
                break
        else:  # pragma: no cover - 616 combinations against ~130 lecturers
            raise SystemExit("ran out of distinct lecturer names — widen SURNAMES")
        taken_names.add(name)
        teachers[teacher_id] = {
            "teacherId": teacher_id,
            "name": name,
            "facultyId": faculty_id,
            "contractSws": 9,
            "provenance": "invented — TUMonline publishes no lecturer for a booking",
        }
        faculty_teachers[faculty_id].append(teacher_id)
        return teacher_id

    def assign_teacher(faculty_id: str, slot_id: str, prefer: str | None) -> str:
        # Keep a course with its lead lecturer wherever the hour allows, so a lecturer's week
        # reads like a person's rather than a shuffle.
        if prefer and slot_id not in teacher_busy[prefer] and len(teacher_busy[prefer]) < 12:
            teacher_busy[prefer].add(slot_id)
            return prefer
        chosen = next(
            (t for t in faculty_teachers[faculty_id]
             if slot_id not in teacher_busy[t] and len(teacher_busy[t]) < 12),
            None,
        ) or hire(faculty_id)
        teacher_busy[chosen].add(slot_id)
        return chosen

    # ── cohorts, INVENTED — and likewise never double-booked ──────────────────────────
    #
    # Same trap, worse: seventeen hashed cohorts had one of them in twenty-two rooms at once. A
    # cohort is a group of students who can physically attend everything assigned to them, so it
    # is built the same way — fill a cohort until its week collides, then start the next one.
    # Parallel groups of ONE course are not a collision: that is the cohort splitting for Übungen,
    # which is what `isWholeCohort: false` and the group table exist to express.
    cohorts: dict[str, dict] = {}
    cohort_of_course: dict[str, str] = {}
    cohort_busy: dict[str, set[str]] = defaultdict(set)
    faculty_cohorts: dict[str, list[str]] = defaultdict(list)

    def enrol(faculty_id: str, programme: str) -> str:
        n = len(faculty_cohorts[faculty_id]) + 1
        cohort_id = f"{faculty_id}-{n}"
        cohorts[cohort_id] = {
            "cohortId": cohort_id,
            "programme": programme,
            "facultyId": faculty_id,
            # The stream number stands in for a year group; which real year it maps to is unknown,
            # so it is not claimed. Kept in range so the UI's semester filter stays meaningful.
            "semester": 1 + (n - 1) % 6,
            "headcount": 0,
            "provenance": "invented — TUMonline publishes no cohort for a booking",
        }
        faculty_cohorts[faculty_id].append(cohort_id)
        return cohort_id

    for course_id, evs in sorted(course_events.items()):
        course = courses[course_id]
        faculty_id = course["facultyId"]
        wanted = {e["slot"]["slotId"] for e in evs}
        chosen = next(
            (c for c in faculty_cohorts[faculty_id] if not (cohort_busy[c] & wanted)),
            None,
        ) or enrol(faculty_id, course["facultyName"])
        cohort_busy[chosen] |= wanted
        cohort_of_course[course_id] = chosen

    # ── sessions and the published plan ───────────────────────────────────────────────
    #
    # The real timetable IS the published plan, so unlike OTH and LMU nothing is placed here.
    sessions: list[dict] = []
    assignments: list[dict] = []
    groups: dict[str, dict] = {}
    used_slots: Counter = Counter()
    unmatched_rooms: set[str] = set()

    for course_id, evs in sorted(course_events.items()):
        course = courses[course_id]
        lead: str | None = None
        # Parallel groups are REAL: the same course in two rooms at the same hour is two groups.
        for group_i, event in enumerate(
            sorted(evs, key=lambda e: (e["slot"]["slotId"], e["room"])), start=1
        ):
            room, slot = event["room"], event["slot"]
            teacher_id = assign_teacher(course["facultyId"], slot["slotId"], lead)
            lead = lead or teacher_id
            geo = geo_rooms.get(room)
            room_type = (geo or {}).get("usage") or "Unbekannt"
            if geo is None:
                unmatched_rooms.add(room)
            group_id = f"{course_id}-G{group_i}"
            groups[group_id] = {
                "groupId": group_id,
                "cohortId": cohort_of_course[course_id],
                "courseId": course_id,
                "size": capacity_of(geo),
                "provenance": "invented — sized from the room TUM actually booked",
            }
            session_id = f"{group_id}-S1"
            sessions.append({
                "sessionId": session_id,
                "courseId": course_id,
                "facultyId": course["facultyId"],
                "teacherId": teacher_id,
                "cohortId": cohort_of_course[course_id],
                "attendeeId": group_id,
                "isWholeCohort": False,
                "durationBlocks": 1,
                # ⚠️ THE REQUIREMENT IS THE ROOM TUM CHOSE, NOT WHAT THE TITLE SOUNDS LIKE. Mapping
                # "Praktikum" to "Labor" produced 883 sessions supposedly in the wrong kind of
                # room — including `Praktikum: Grundlagen der Programmierung`, which TUM holds in a
                # Seminarraum because a programming practical needs desks, not fume hoods. When an
                # invented rule disagrees with a real timetable, the timetable is the evidence.
                "requiredRoomType": room_type,
                # ⚠️ CIRCULAR, AND WORTH SAYING SO. TUM publishes no attendance, so this is the
                # capacity of the room TUM chose — which means the validator's "does it fit?" check
                # passes by construction rather than by evidence. That is the honest position: the
                # real plan demonstrably fits the real rooms, and no headcount is being claimed.
                "expectedAttendance": groups[group_id]["size"],
                "title": course["title"],
                # The published times, kept exactly — the hour is the slot, this is the truth.
                "publishedStart": event["start"],
                "publishedEnd": event["end"],
                "observedWeeks": len(event["weeks"]),
                "alsoKnownAs": event["alsoKnownAs"],
                "provenance": "measured — published by TUMonline",
            })
            assignments.append({
                "draftId": "published",
                "sessionId": session_id,
                "courseId": course_id,
                "cohortId": cohort_of_course[course_id],
                "attendeeId": group_id,
                "isWholeCohort": False,
                "teacherId": teacher_id,
                "slotId": slot["slotId"],
                "roomId": room,
                "buildingId": (geo or {}).get("building"),
                "campusId": "garching",
                # ⚠️ NOT FROZEN, WHICH IS A DECISION AND NOT AN OVERSIGHT. Every one of these is a
                # lecture TUM is really holding, so the first version froze them all — the solver
                # could look but never propose. That also removed the entire point of putting a
                # planner on real data: "what would it cost to free this professor's Friday" is a
                # better question against a real timetable than an invented one. The honest
                # safeguard is not refusing to answer, it is answering against the REAL room
                # occupancy — see `room_block` — so a proposal cannot quietly move a lecture into a
                # room the university has already given to something else.
                "frozen": False,
                "source": "published",
                "provenance": "measured — this is where TUM actually holds it",
            })
            used_slots[slot["slotId"]] += 1

    # A course's room requirement is the kind of room its own sessions are held in — the commonest
    # one, where TUM uses more than one.
    types_per_course: dict[str, Counter] = defaultdict(Counter)
    for s in sessions:
        types_per_course[s["courseId"]][s["requiredRoomType"]] += 1
    for course_id, course in courses.items():
        seen = types_per_course.get(course_id)
        if seen:
            course["requiredRoomType"] = seen.most_common(1)[0][0]

    # Desirability, observed rather than assumed: how much of the real week sits on each slot.
    busiest = max(used_slots.values()) if used_slots else 1
    for slot in time_slots:
        slot["desirability"] = round(used_slots.get(slot["slotId"], 0) / busiest, 3)

    # Cohort headcount from the largest room the cohort is actually taught in.
    biggest: dict[str, int] = defaultdict(int)
    for a in assignments:
        seats = int((geo_rooms.get(a["roomId"]) or {}).get("seats") or 0)
        biggest[a["cohortId"]] = max(biggest[a["cohortId"]], seats)
    for cohort_id, cohort in cohorts.items():
        cohort["headcount"] = biggest.get(cohort_id, 0) or 30

    # ── rooms ─────────────────────────────────────────────────────────────────────────
    booked_rooms = {a["roomId"] for a in assignments}
    rooms = [{
        "roomId": code,
        "buildingId": geo.get("building"),
        "campusId": "garching",
        "facultyId": None,
        "level": geo.get("level"),
        "roomType": geo.get("usage") or "Unbekannt",
        # ⚠️ Schedulable means TUM SCHEDULES IT, which the bookings settle directly. Guessing from
        # the usage string would invent a teaching estate on top of a real one.
        "schedulable": code in booked_rooms,
        "capacity": capacity_of(geo),
        "areaM2": geo.get("areaM2"),
        # ⚠️ THE SHAPE IS REAL, THE SEAT COUNT IS NOT, and one row must not claim both. The
        # terrain build says so itself — `rooms.json` provenance marks `seats` as "SYNTHETIC —
        # floor area / a planning density; badge it wherever it is shown". Capacity drives which
        # rooms the solver will offer, so labelling it "measured" would be the most consequential
        # kind of overclaim this dataset could make.
        "provenance": "measured — OSM indoor geometry; teaching use from TUMonline bookings",
        "capacityProvenance": "derived — floor area over a planning density, not a published count",
    } for code, geo in sorted(geo_rooms.items())]

    # ⚠️ A ROOM TUM BOOKS BUT OPENSTREETMAP NEVER MAPPED IS STILL A ROOM. Two of the 122 booked
    # rooms have no surveyed outline, and dropping them would have silently deleted real teaching
    # from the plan; leaving them out of the room table while the assignments still pointed at them
    # is what the validator was objecting to. They are listed with no geometry and said to have
    # none, so the twin can decline to draw them without the timetable losing them.
    for code in sorted(unmatched_rooms):
        rooms.append({
            "roomId": code,
            "buildingId": code.split(".")[0],
            "campusId": "garching",
            "facultyId": None,
            "level": None,
            "roomType": "Unbekannt",
            "schedulable": True,
            "capacity": 30,
            "areaM2": None,
            "hasGeometry": False,
            "provenance": "measured — booked by TUMonline; no OSM indoor survey for this room",
            "capacityProvenance": "unknown — no area to estimate from; a nominal seminar size",
        })

    positions = building_positions(geometry)
    navigatum_names = {}
    buildings_raw = json.loads((RAW / "buildings.json").read_text(encoding="utf-8"))
    if isinstance(buildings_raw, dict):
        buildings_raw = list(buildings_raw.values())
    for b in buildings_raw:
        code = str(b.get("code") or b.get("id") or "")
        # ⚠️ Only a REAL name counts. NavigaTUM publishes `name: null` for most of the 55xx block
        # (they come from OSM, not from TUM's own register), and falling back to the code here
        # would have produced a building politely called "5501" that looked like a published name.
        if code and b.get("name"):
            navigatum_names[code] = b["name"]
    # An address per building, straight from NavigaTUM's room details — real, and the thing a
    # person actually navigates by.
    addresses: dict[str, str] = {}
    for line in (RAW / "detail.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        code = str(row.get("code") or "")
        if "." in code and row.get("address"):
            addresses.setdefault(code.split(".")[0], row["address"])

    building_ids = sorted({r["buildingId"] for r in rooms if r.get("buildingId")})
    buildings = []
    for code in building_ids:
        pos = positions.get(code, {})
        published = navigatum_names.get(code)
        buildings.append({
            "buildingId": code,
            "name": published or f"Gebäude {code}",
            "nameSource": "published — NavigaTUM" if published
                          else "placeholder — TUM publishes no name for this outline",
            "campusId": "garching",
            "facultyId": None,
            "address": addresses.get(code),
            "lat": pos.get("lat"),
            "lon": pos.get("lon"),
            "provenance": "measured — NavigaTUM name and address, position from OSM room geometry",
        })

    # ── travel time ───────────────────────────────────────────────────────────────────
    #
    # ⚠️ STRAIGHT LINES, AND SAID SO. These are real distances between real building centroids, but
    # a straight line is not a walk — the routed matrix `build_walk_routes.py --site tum --matrix`
    # produces is about a tenth longer on a campus like this. Every row is marked `straight` so a
    # later routed build can replace it without anyone having to guess which is which.
    WALK_M_PER_MIN = 80.0
    travel = []
    for a in building_ids:
        for b in building_ids:
            pa, pb = positions.get(a), positions.get(b)
            if pa is None or pb is None:
                continue
            dist = math.dist((pa["eastM"], pa["southM"]), (pb["eastM"], pb["southM"]))
            travel.append({
                "fromBuildingId": a,
                "toBuildingId": b,
                "distanceM": round(dist),
                "minutes": 0 if a == b else max(1, round(dist / WALK_M_PER_MIN)),
                "sameCampus": True,
                "mode": "none" if a == b else "straight",
            })

    # ── availability ──────────────────────────────────────────────────────────────────
    #
    # ⚠️ EMPTY ON PURPOSE, AND THAT IS THE HONEST ANSWER. OTH and LMU invent when a lecturer cannot
    # teach, which is defensible when the lecturer is invented too and the timetable has to be
    # built around something. Here the timetable is real and already satisfies whatever the actual
    # constraints were, so fabricating unavailability would do only one thing: mark real, published
    # sessions as violating a rule that does not exist. Everyone is recorded as available, which
    # states no constraint rather than inventing one.
    availability = [
        {"teacherId": t["teacherId"], "slotId": s["slotId"], "state": "verfuegbar",
         "provenance": "unknown — TUMonline publishes no lecturer availability"}
        for t in sorted(teachers.values(), key=lambda x: x["teacherId"])
        for s in time_slots
    ]

    # ── room blocks ─────────────────────────────────────────────────────────────────────
    #
    # ⚠️ WHAT THE SOLVER MAY NOT USE, because the university has already given it away. `occupied()`
    # in the store derives room-slot occupancy from the PLAN's own assignments, which is complete
    # for a generated university and badly incomplete for a real one: TUM's rooms are also full of
    # `IRIS Belegung` holds, doctoral defences and deliberately barred rooms. Without these rows an
    # unfrozen solver would move a lecture into a room that is genuinely in use and report success.
    #
    # A block that lands on an hour the room is ALREADY teaching in is dropped: TUMonline
    # cross-lists, so the same event can appear as both, and a block there would make the published
    # plan look conflicted with itself.
    taught_room_slots = {(a["roomId"], a["slotId"]) for a in assignments}
    block_reasons: dict[tuple[str, str], str] = {}
    for r in occupying:
        start = datetime.fromisoformat(r["start"].replace("Z", "+00:00")).astimezone(BERLIN)
        slot = slot_for(start.weekday(), start.strftime("%H:%M"))
        if slot is None:
            continue
        key = (r["room"], slot["slotId"])
        if key in taught_room_slots or key in block_reasons:
            continue
        block_reasons[key] = block_category(r)

    room_blocks = [
        {
            "roomId": room_id,
            "slotId": slot_id,
            "reason": reason,
            "provenance": "measured — TUMonline shows this room in use at this hour",
        }
        for (room_id, slot_id), reason in sorted(block_reasons.items())
    ]

    # ── write ─────────────────────────────────────────────────────────────────────────
    OUT.mkdir(parents=True, exist_ok=True)
    tables = {
        "time_slot": time_slots,
        "room": rooms,
        "building": buildings,
        "travel_time": travel,
        "availability": availability,
        "room_block": room_blocks,
        # The one draft is the real published timetable. `author` says TUMonline rather than
        # "generator" because nothing here was generated.
        "plan_draft": [{
            "draftId": "published",
            "name": "Veröffentlichter Plan WS 2025/26",
            "status": "published",
            "parentDraftId": None,
            "author": "TUMonline",
            "createdAt": datetime.now(BERLIN).strftime("%Y-%m-%d"),
        }],
        "teacher": sorted(teachers.values(), key=lambda t: t["teacherId"]),
        "cohort": sorted(cohorts.values(), key=lambda c: c["cohortId"]),
        "course": sorted(courses.values(), key=lambda c: c["courseId"]),
        "cohort_group": sorted(groups.values(), key=lambda g: g["groupId"]),
        "course_session": sessions,
        "plan_assignment": assignments,
    }
    for name, rows in tables.items():
        (OUT / f"{name}.json").write_text(
            json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"  {name:18s} {len(rows):6,}")

    schedulable = sum(1 for r in rooms if r["schedulable"])
    provenance = {
        "site": "tum",
        "campus": "Garching",
        "semester": "Wintersemester 2025/26",
        "summary": (
            "Sessions, rooms, times and the published plan are REAL, taken from TUMonline. "
            "Teachers and cohorts are INVENTED, because the feed carries neither."
        ),
        "measured": {
            "bookings_read": len(raw_rows),
            "teaching_bookings": len(bookings),
            "weekly_series": len(repeating),
            "sessions": len(sessions),
            "rooms_scheduled": schedulable,
            "rooms_surveyed": len(rooms),
            "source": "TUMonline via NavigaTUM, winter semester 2025/26",
        },
        "invented": {
            "teachers": len(teachers),
            "cohorts": len(cohorts),
            "why": (
                "TUMonline publishes room, start, end, type and title, and nothing else — no "
                "lecturer, no cohort, no group. The planner needs all three, so they are "
                "fabricated. No name in this dataset belongs to a real person."
            ),
        },
        "excluded": {reason: n for reason, n in dropped.most_common()},
    }
    (OUT / "provenance.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\nsessions          {len(sessions):,} across {len(courses):,} courses, "
          f"{len(teachers)} invented lecturers, {len(cohorts)} invented cohorts")
    print(f"rooms scheduled   {schedulable} of {len(rooms):,} surveyed")
    if unmatched_rooms:
        print(f"⚠️  {len(unmatched_rooms)} booked rooms have no surveyed geometry: "
              f"{', '.join(sorted(unmatched_rooms)[:6])}")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

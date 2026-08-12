"""Read OTH's real Untis export into this project's dataset tables.

PLAN §25.6 step 1. Turns the GPU files OTH sent on 2026-08-06 into `data/oth-real/*.json` with the
same shape the generated datasets use, so the app, the solver and the twin can read a real
timetable without any of them learning a new format.

    python tools/data/read_untis_gpu.py                  # build data/oth-real
    python tools/data/read_untis_gpu.py --report         # what it could not map, and why

Input (`04. Customer/01. EDU/OTH Regensburg/KI Hackathon/`):

  Untis-Export/Fak.{SG,IM,EI}.TXT, Fak BM.TXT   GPU001 — Stundenplan, one row per CLASS and period
  Untis-Export/BM - Vorlesungen.TXT             GPU002 — Unterricht, the lessons behind the grid
  Untis-Export/BM - Zeitwünsche.TXT             GPU016 — Zeitwünsche (lecturer time preferences)
  StVP-Excel/Winter2627-StVP-*.xlsx             the per-professor Stundenverteilungsplan

⚠️ THE GPU NUMBERS ABOVE WERE WRONG IN THIS FILE UNTIL 2026-08-06, and they are the vocabulary we
share with the customer's Untis admin. The grid was labelled GPU002, the lessons GPU001 — exactly
swapped — and the Zeitwünsche GPU005, which is the ROOM export. Checked against the Untis manual
(`ti_allgemeine-schnittstellen.htm`) and against the files themselves: `Fak BM.TXT` row 1 is
`1,"BM3a","Leha","BW_LOP","S051",4,6` — class, teacher, subject, room, day, period, i.e. a
timetable (GPU001); `BM - Vorlesungen.TXT` carries Wochenwert and a date range, i.e. lesson master
data (GPU002); `BM - Zeitwünsche.TXT` is `"L","Wob",1,1,-3`, element/day/period/weight (GPU016).
Nothing parsed differently — every reader here matches on CONTENT — but asking OTH to re-send
"GPU005" would have got us their room list.

⚠️ ENCODINGS DIFFER INSIDE ONE EXPORT — four files are cp1252 and the Zeitwünsche file is UTF-8.
Read per file or the umlauts mojibake silently (§25.1).

⚠️ ONE ROW PER CLASS, NOT PER LESSON. 606 of 1 200 Unterrichtsnummern carry more than one class, so
a lecture shared by four cohorts appears four times. Collapsing on `Unterrichtsnummer` is what
turns those back into one session with several attendees — and skipping that step reports a
four-cohort lecture as four room conflicts.

⚠️ WHAT IS MEASURED AND WHAT IS OURS. Sessions, times, rooms, classes, subjects and the
Zeitwünsche are OTH's. Room capacity, room type, class head counts and any lecturer's full name are
NOT in the export (§25.5) and must never be invented into these tables — `provenance.json` records
that, and the app hides what it cannot support.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from read_stvp_excel import match_teacher, read as read_stvp  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CUSTOMER = Path(
    r"C:\Users\alkorn\OneDrive - Microsoft\Dokumente\04. Customer\01. EDU\OTH Regensburg\KI Hackathon"
)
UNTIS = CUSTOMER / "Untis-Export"
OUT = ROOT / "data" / "oth-real"

TIMETABLE_FILES = {
    "BM": "Fak BM.TXT",
    "EI": "Fak.EI.TXT",
    "IM": "Fak.IM.TXT",
    "SG": "Fak.SG.TXT",
}
LESSONS_FILE = "BM - Vorlesungen.TXT"
WISHES_FILE = "BM - Zeitwünsche.TXT"

DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa"]

# ⚠️ MEASURED, NOT ASSUMED — and it corrects PLAN §9.1. The plan modelled OTH as "seven 90-minute
# blocks from 08:00 s.t.", flagged as an assumption. The Stundenverteilungsplan Excel that OTH
# actually sends its professors prints the real scheme, and it is SIX blocks starting 08:15 c.t.
# The WebUntis screenshot in the same mail agrees to the minute.
#
# ⚠️ The 7th period is INFERRED. The StVP form lists six; the export uses a 7th (209 rows of 9 973,
# mostly SG), so it exists but no document we hold gives its time. It is carried with a derived
# time rather than dropped — dropping it would delete real teaching — and marked as such.
BLOCKS = [
    ("08:15", "09:45", "measured"),
    ("10:00", "11:30", "measured"),
    ("12:00", "13:30", "measured"),
    ("13:45", "15:15", "measured"),
    ("15:30", "17:00", "measured"),
    ("17:15", "18:45", "measured"),
    ("19:00", "20:30", "derived"),
]

# Strings in the room column that are not rooms (§25.4). An online lecture handed a lecture hall
# would be a fabricated constraint, so these become "no room" rather than an unresolved room.
NON_ROOM = re.compile(r"^(virt|virtuell|exkurs|vbw)", re.I)

# GPU016 values. OTH's own StVP legend is the authority here: 1 = gut möglich, 0 = wenns sein muss,
# -1 = NICHT möglich — three states, which is exactly the vocabulary the app already carries.
WISH_STATE = {"-3": "nicht_verfuegbar", "-2": "nicht_verfuegbar", "-1": "eingeschraenkt",
              "0": "eingeschraenkt", "1": "verfuegbar", "2": "verfuegbar", "3": "verfuegbar"}


def read_rows(path: Path) -> list[list[str]]:
    """Read one GPU file, sniffing the encoding per file."""
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")
    return [r for r in csv.reader(io.StringIO(text), delimiter=",", quotechar='"')
            if r and any(c.strip() for c in r)]


def room_atoms(raw: str) -> list[str]:
    """`K003~K101` is two rooms; `virt (vl1)` is none; `K009~virt` is ONE room and a non-room.

    ⚠️ THE FILTER RUNS PER ATOM, NOT ON THE WHOLE STRING. Checking before the split let
    `K009~virt` through intact, and `virt` became a room called VIRT with its own building letter.
    A coupled booking can pair a real room with an online slot, so both steps are needed.
    """
    if not raw:
        return []
    return [p.strip() for p in raw.split("~")
            if p.strip() and not NON_ROOM.match(p.strip())]


def build() -> dict[str, Any]:
    report: dict[str, Any] = {"nonRoomSessions": 0, "unknownDay": [], "unknownPeriod": []}

    # ── the week grid ────────────────────────────────────────────────────────────────────────
    grid: list[dict[str, str]] = []
    for fak, fname in TIMETABLE_FILES.items():
        for r in read_rows(UNTIS / fname):
            if len(r) < 7:
                continue
            grid.append({"fak": fak, "nr": r[0], "klasse": r[1], "lehrer": r[2],
                         "fach": r[3], "raum": r[4], "tag": r[5], "std": r[6]})

    # ── collapse one row per class back into one lesson-occurrence ───────────────────────────
    # Key is (faculty, Unterrichtsnummer, day, period): the same lesson at the same hour, however
    # many classes attend it. ⚠️ The faculty must be in the key — Unterrichtsnummern restart per
    # faculty, so BM's lesson 1 and IM's lesson 1 are different lessons.
    occ: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for g in grid:
        key = (g["fak"], g["nr"], g["tag"], g["std"])
        e = occ.setdefault(key, {"fak": g["fak"], "nr": g["nr"], "tag": g["tag"], "std": g["std"],
                                 "klassen": set(), "lehrer": set(), "fach": g["fach"], "raeume": set()})
        if g["klasse"]:
            e["klassen"].add(g["klasse"])
        if g["lehrer"]:
            e["lehrer"].add(g["lehrer"])
        for a in room_atoms(g["raum"]):
            e["raeume"].add(a)
        if g["raum"] and not room_atoms(g["raum"]):
            report["nonRoomSessions"] += 1

    # ── slots ────────────────────────────────────────────────────────────────────────────────
    used_days = sorted({e["tag"] for e in occ.values()}, key=lambda d: int(d) if d.isdigit() else 99)
    used_periods = sorted({e["std"] for e in occ.values()}, key=lambda s: int(s) if s.isdigit() else 99)
    time_slot = []
    for d in used_days:
        di = int(d) - 1
        if not 0 <= di < len(DAYS):
            report["unknownDay"].append(d)
            continue
        for p in used_periods:
            pi = int(p) - 1
            if not 0 <= pi < len(BLOCKS):
                report["unknownPeriod"].append(p)
                continue
            start, end, prov = BLOCKS[pi]
            time_slot.append({
                "slotId": f"{DAYS[di]}-{p}", "day": DAYS[di], "dayIndex": di, "block": int(p),
                "startTime": start, "endTime": end,
                # ⚠️ No desirability is published, and inventing one would bias the solver's
                # objective with a number nobody at OTH chose. Flat until they tell us.
                "desirability": 1.0,
                "timeProvenance": prov,
            })
    slot_ids = {s["slotId"] for s in time_slot}

    # ── how attractive is each slot? LEARNED FROM OTH'S OWN PLAN ────────────────────────────
    # ⚠️ A FLAT PREFERENCE MAKES THE SOLVER PROPOSE SATURDAY AT 19:00. Measured: with every slot
    # equally good, the first real cascade moved four lectures to Mo-7, Mi-7, Do-5 and **Sa-7** —
    # each of them legal, none of them a proposal a planner would accept. The objective needs
    # something to prefer against (`tools.py` weights the term by `1 - desirability`).
    #
    # OTH publishes no desirability, and inventing a curve would put our taste into their plan. But
    # their EXISTING timetable is a record of what they find acceptable: a slot they fill 800 times
    # is evidently fine, and one they use twice is one they avoid. So the weight is the slot's own
    # share of real bookings, normalised against the busiest slot.
    #
    # ⚠️ FLOORED AT 0.05, NEVER 0. Zero would read as "impossible" and quietly turn a preference
    # into a hard constraint — the solver would refuse a repair rather than offer an unpopular one,
    # and the planner would be told there is no solution when there is a slightly awkward one.
    # ⚠️ And it is DERIVED, not measured: it describes what OTH did, not what OTH wants. Badged as
    # such in provenance.json, and it is the first thing a rules panel should expose (PLAN §26.2).
    usage: dict[str, int] = defaultdict(int)
    for e in occ.values():
        di, pi = int(e["tag"]) - 1, int(e["std"]) - 1
        if 0 <= di < len(DAYS) and 0 <= pi < len(BLOCKS):
            usage[f"{DAYS[di]}-{e['std']}"] += 1
    busiest = max(usage.values()) if usage else 1
    for slot in time_slot:
        share = usage.get(slot["slotId"], 0) / busiest
        slot["desirability"] = round(max(0.05, share), 3)
        slot["desirabilityProvenance"] = "derived_from_real_usage"
        slot["bookings"] = usage.get(slot["slotId"], 0)

    # ── teachers, classes, rooms, subjects ───────────────────────────────────────────────────
    teacher_fac: dict[str, str] = {}
    for e in occ.values():
        for t in e["lehrer"]:
            teacher_fac.setdefault(t, e["fak"])
    teacher = [{
        "teacherId": t,
        # ⚠️ THE SHORT CODE IS THE NAME. The export carries no full name (§25.5) and inventing one
        # would attach a fabricated person to a real lecture — the exact pairing TUM's refusal
        # exists to prevent. `nameProvenance` tells the app to withhold rather than display.
        "name": t, "nameProvenance": "untis_short_code",
        "facultyId": f, "contractSws": None,
    } for t, f in sorted(teacher_fac.items())]

    class_fac: dict[str, str] = {}
    for e in occ.values():
        for k in e["klassen"]:
            class_fac.setdefault(k, e["fak"])

    # ⚠️ DERIVED WHERE THE CODE SAYS SO, AND UNKNOWN WHERE IT DOES NOT. About 179 of the 229 class
    # codes read as <programme><semester><group> — `BM3a` is Business & Management, 3rd semester,
    # group a — and 50 do not: `MFC`, `EIWp`, `EI_ZWW_Bel` carry no semester at all, and a regex
    # loose enough to swallow them would invent a structure for a quarter of the data. Untis does
    # not publish what a class code MEANS, so the honest output is a derivation plus a gap, and the
    # gap is a question for OTH (PLAN §25.7) rather than something to pattern-match harder at.
    CLASS_CODE = re.compile(
        r"^(?P<prog>[A-Za-z]+)(?P<sem>\d{1,2})(?:(?P<group>[a-z])|(?P<track>[A-Z]{2,3}))?$")

    def decode_class(code: str) -> dict[str, Any]:
        m = CLASS_CODE.match(code)
        if not m:
            return {"programme": None, "semester": None, "group": None, "track": None,
                    "codeParsed": False,
                    "codeWhy": "the code carries no semester — Master, Wahlpflicht or a room booking"}
        sem = int(m.group("sem"))
        if not 1 <= sem <= 14:                 # a plausible semester, not a building number
            return {"programme": None, "semester": None, "group": None, "track": None,
                    "codeParsed": False, "codeWhy": f"'{sem}' is not a plausible semester"}
        # ⚠️ A LOWER-CASE SUFFIX AND AN UPPER-CASE ONE MEAN DIFFERENT THINGS, so they are kept
        # apart. `BM3a` is one of four PARALLEL GROUPS of the same cohort — they are taught
        # separately and must not collide with each other. `BW6FI` is a SPECIALISATION within the
        # 6th semester of BW. Merging them into one field would make the app treat a subject choice
        # as a room-splitting group, which is the distinction the whole timetable turns on.
        return {"programme": m.group("prog"), "semester": sem,
                "group": m.group("group"), "track": m.group("track"),
                "codeParsed": True}

    cohort = [{
        "cohortId": k, "facultyId": f,
        **decode_class(k),
        # ⚠️ NOT IN THE EXPORT. A head count drives room-capacity checks, so a guess here would
        # make the solver refuse or accept rooms on invented grounds.
        "headcount": None, "headcountProvenance": "not_published",
    } for k, f in sorted(class_fac.items())]
    report["classCodesParsed"] = sum(1 for c in cohort if c["codeParsed"])
    report["classCodesUnparsed"] = sorted(c["cohortId"] for c in cohort if not c["codeParsed"])

    room_ids = sorted({r for e in occ.values() for r in e["raeume"]})

    # ── buildings and travel: MEASURED, and shared with the generated site ──────────────────
    # ⚠️ These come from OpenStreetMap and a routed walk graph — they are the same real campus
    # whichever timetable is laid over it, so they are reused rather than re-derived. Reusing them
    # is not a shortcut: inventing a second set would mean the two OTH sites disagreed about where
    # a building is.
    generated = ROOT / "data" / "synthetic"
    buildings = json.loads((generated / "building.json").read_text(encoding="utf-8"))
    travel = json.loads((generated / "travel_time.json").read_text(encoding="utf-8"))
    known_buildings = {b["buildingId"] for b in buildings}
    campus_of = {b["buildingId"]: b.get("campusId") for b in buildings}

    # ── letter → campus, from OTH'S OWN PUBLISHED LIST ─────────────────────────────────
    # ⚠️ WITHOUT THIS, THE PRODUCT'S CENTRAL CONSTRAINT CANNOT FIRE ON REAL DATA. 666 of the real
    # sessions are in Prüfening rooms, and OpenStreetMap holds Prüfening as six UNNAMED polygons
    # with no letter — so every one of those rooms had `campusId: None`, and the campus-transition
    # rule (a cohort cannot cross 2.5 km in a 15-minute break) had nothing to compare. The demo's
    # whole story was invisible in the customer's own timetable.
    #
    # The fix is not geometry, it is a fact OTH publishes: `config/oth-buildings-official.json`
    # gives every building letter an ADDRESS, scraped from the university's own
    # "Standort und Raumpläne" page. A letter therefore names a campus even where no polygon does.
    # This is DECLARED evidence, in the same sense §23.2 uses for TUM's room ids — not a guess.
    ADDRESS_CAMPUS = {
        "galgenbergstraße": "seyboth",     # Galgenbergstraße 30 / 32 and Seybothstraße 2 are one
        "seybothstraße": "seyboth",        # contiguous campus, and the AOI models them as one
        "prüfeninger straße": "pruefening",
        "universitätsstraße": "universitaet",
    }
    letter_campus: dict[str, str] = {}
    letter_address: dict[str, str] = {}
    official = ROOT / "config" / "oth-buildings-official.json"
    if official.exists():
        for entry in json.loads(official.read_text(encoding="utf-8")).get("buildings", []):
            letter = str(entry.get("letter", "")).upper()
            address = str(entry.get("address", ""))
            letter_address[letter] = address
            low = address.lower()
            for frag, campus in ADDRESS_CAMPUS.items():
                if frag in low:
                    letter_campus[letter] = campus
                    break

    def letter_of(room_id: str) -> str | None:
        m = re.match(r"^([A-Za-z]+)", room_id or "")
        return m.group(1).upper() if m else None

    def building_of(room_id: str) -> str | None:
        letter = letter_of(room_id)
        # ⚠️ UNPLACED, NOT GUESSED. Untis uses P for Prüfening, which OpenStreetMap holds as six
        # unnamed polygons with no letter, and E/U for buildings the survey does not name.
        # Attaching those rooms to the nearest polygon would put real teaching in the wrong place;
        # leaving the BUILDING unplaced keeps the gap visible — while `campus_for` below still
        # places the room on the right SITE, which is what the travel rule needs.
        return letter if letter in known_buildings else None

    def campus_for(room_id: str) -> str | None:
        """The campus a room sits on, from geometry where we have it and from OTH's published
        address list where we do not."""
        bid = building_of(room_id)
        if bid and campus_of.get(bid):
            return campus_of[bid]
        letter = letter_of(room_id)
        return letter_campus.get(letter) if letter else None

    unplaced = sorted({r for r in room_ids if building_of(r) is None})
    report["roomsWithoutBuilding"] = unplaced
    report["roomsPlaced"] = len(room_ids) - len(unplaced)

    # ── room size, from OTH'S OWN FLOOR PLANS where they published one ─────────────────
    #
    # ⚠️ THE CAPACITY CHECK CANNOT FIRE WITHOUT THIS, AND THE SOLVER WAS FREE TO SHRINK A ROOM.
    # The Untis grid names rooms and nothing else — no size, no type — so every one of these 148
    # rooms had `capacity: None`, and a repair could move a lecture out of the 95-seat K 001 into
    # the 24-seat K 006 and call it clean.
    #
    # OTH did publish floor plans for building K, and this project already surveyed them for the
    # twin (`data/synthetic/room.json`, provenance `plan`). The Untis code `K001` and the plan code
    # `K 001` are the same room written two ways, so the join is a whitespace fold — not a guess.
    #
    # ⚠️ 26 OF 148, AND THE REST STAY NULL. Only building K has a published plan; A, D, E and the
    # Prüfening rooms have none, and inventing a size for them would put a number a planner could
    # quote next to one nobody measured. `capacityProvenance` says which is which, and §25.7 asks
    # OTH for the GPU005 (Räume) export — one file that would answer all 148 properly.
    plan_rooms: dict[str, dict] = {}
    plan_path = ROOT / "data" / "synthetic" / "room.json"
    if plan_path.exists():
        for pr in json.loads(plan_path.read_text(encoding="utf-8")):
            if pr.get("provenance") in ("plan", "measured") and pr.get("areaM2"):
                plan_rooms.setdefault(re.sub(r"\s+", "", pr["roomId"]).upper(), pr)

    def surveyed(code: str) -> dict:
        return plan_rooms.get(re.sub(r"\s+", "", code).upper()) or {}

    room = [{
        "roomId": r, "buildingId": building_of(r),
        "campusId": campus_for(r),
        "address": letter_address.get(letter_of(r) or ""),
        "facultyId": None, "level": surveyed(r).get("level"),
        "roomType": surveyed(r).get("roomType"), "schedulable": True,
        "capacity": surveyed(r).get("capacity"), "areaM2": surveyed(r).get("areaM2"),
        "capacityProvenance": (
            "oth_floor_plan" if surveyed(r).get("capacity") is not None else None
        ),
        "provenance": "untis", "displayName": r,
        "hasGeometry": building_of(r) is not None,
        "campusProvenance": ("osm" if building_of(r) else
                             "oth_published_address" if campus_for(r) else None),
    } for r in room_ids]

    report["roomCapacity"] = {
        "rooms": len(room),
        "fromFloorPlan": sum(1 for r in room if r["capacity"] is not None),
        "unknown": sum(1 for r in room if r["capacity"] is None),
        "$note": "Untis names rooms but not their size. Building K has a published plan; "
                 "the rest do not — ask OTH for the GPU005 (Räume) export.",
    }
    # ── lesson metadata: the only thing that can say whether two lessons share a week ────────
    # ⚠️ GPU001 IS A WEEKLY GRID AND CANNOT SAY WHICH WEEKS. Two lessons in one room at one hour
    # collide only if they run in the same weeks, and the grid does not know. GPU002 carries a date
    # range and a Wochenwert per lesson — but OTH sent GPU002 for BM ONLY, so three faculties have
    # no week information at all.
    #
    # Measured on this export: of BM's 343 lessons only 118 have Wochenwert >= 1.0 (they run every
    # week), and of its 70 room collisions exactly ONE has every participant weekly. So calling
    # these collisions "conflicts" would accuse OTH's own published plan of ~2 400 faults that are
    # almost entirely artefacts of a missing column — the "147 impossible transfers" mistake
    # (PLAN §20) at ten times the scale, and this time against a real customer.
    lesson_week: dict[tuple[str, str], dict[str, Any]] = {}
    lessons_path = UNTIS / LESSONS_FILE
    if lessons_path.exists():
        for r in read_rows(lessons_path):
            if len(r) < 16 or not r[0]:
                continue
            try:
                ww = float(r[10] or 0)
            except ValueError:
                ww = 0.0
            lesson_week.setdefault(("BM", r[0]), {
                "validFrom": r[14] or None, "validTo": r[15] or None, "wochenwert": ww,
            })

    def week_pattern(fak: str, nr: str) -> dict[str, Any]:
        m = lesson_week.get((fak, nr))
        if not m:
            return {"weekPattern": "unknown",
                    "weekPatternWhy": "no GPU002 lesson file for this faculty"}
        if m["wochenwert"] >= 1.0:
            return {"weekPattern": "weekly", "validFrom": m["validFrom"],
                    "validTo": m["validTo"], "wochenwert": m["wochenwert"]}
        return {"weekPattern": "unknown", "validFrom": m["validFrom"], "validTo": m["validTo"],
                "wochenwert": m["wochenwert"],
                "weekPatternWhy": "Wochenwert < 1: the lesson does not run every week"}
    # ── sessions and the plan ────────────────────────────────────────────────────────────────
    course_session, plan_assignment = [], []
    courses: dict[str, dict[str, Any]] = {}
    for (fak, nr, tag, std), e in sorted(occ.items()):
        di = int(tag) - 1
        pi = int(std) - 1
        if not (0 <= di < len(DAYS) and 0 <= pi < len(BLOCKS)):
            continue
        slot = f"{DAYS[di]}-{std}"
        if slot not in slot_ids:
            continue
        sid = f"{fak}-{nr}-{slot}"
        klassen = sorted(e["klassen"])
        lehrer = sorted(e["lehrer"])
        raeume = sorted(e["raeume"])
        cid = f"{fak}-{e['fach']}" if e["fach"] else f"{fak}-{nr}"
        courses.setdefault(cid, {
            "courseId": cid, "title": e["fach"] or nr, "courseType": None,
            "facultyId": fak, "teacherId": lehrer[0] if lehrer else None,
            "requiredRoomType": None, "sws": None,
        })
        course_session.append({
            "sessionId": sid, "courseId": cid, "facultyId": fak,
            "teacherId": lehrer[0] if lehrer else None,
            "teacherIds": lehrer,
            "cohortId": klassen[0] if klassen else None,
            "attendeeId": klassen[0] if klassen else None,
            "attendeeIds": klassen,
            "isWholeCohort": True,
            "requiredRoomType": None,
            # ⚠️ Unknown, not zero. Zero would read as "nobody attends".
            "expectedAttendance": None,
            "untisLessonNr": nr,
            # ⚠️ THE STRONGEST CLAIM THIS PROJECT CAN MAKE, AND IT HAS TO BE WRITTEN DOWN TO BE
            # MADE. `summary()` derives `timetableProvenance` by counting sessions whose own
            # `provenance` starts with "measured" — that is how TUM's published bookings earn the
            # green "Echte Buchungen" badge. Omitting it here left OTH's REAL week labelled exactly
            # like a generated one: the app was under-claiming, which is the rarer direction of
            # dishonesty and just as wrong.
            "provenance": "measured — OTH Untis GPU001 export",
            **week_pattern(fak, nr),
        })
        plan_assignment.append({
            "draftId": "published", "sessionId": sid, "courseId": cid,
            "cohortId": klassen[0] if klassen else None,
            "attendeeId": klassen[0] if klassen else None,
            "isWholeCohort": True,
            "teacherId": lehrer[0] if lehrer else None,
            "slotId": slot,
            "roomId": raeume[0] if raeume else None,
            "roomIds": raeume,
            "buildingId": building_of(raeume[0]) if raeume else None,
            "campusId": campus_for(raeume[0]) if raeume else None,
            # ⚠️ NOT frozen. What-if on a real plan is the product; freezing it would make the
            # solver unable to answer the only question OTH asked for.
            "frozen": False,
        })

    # ── availability, from the Zeitwünsche ───────────────────────────────────────────────────
    availability = []
    wishes = read_rows(UNTIS / WISHES_FILE)
    for w in wishes:
        if len(w) < 5 or w[0].strip().upper() != "L":
            continue
        who, tag, std, val = w[1], w[2], w[3], w[4].strip()
        di, pi = int(tag) - 1, int(std) - 1
        if not (0 <= di < len(DAYS) and 0 <= pi < len(BLOCKS)):
            continue
        slot = f"{DAYS[di]}-{std}"
        if slot not in slot_ids:
            continue
        state = WISH_STATE.get(val)
        if state is None:
            report.setdefault("unknownWishValue", []).append(val)
            continue
        availability.append({"teacherId": who, "slotId": slot, "state": state,
                             "source": "gpu016"})

    # ── availability from the Stundenverteilungsplan Excel ───────────────────────────────
    # ⚠️ THE GPU016 FILE COVERS 19 LECTURERS OF 414, AND NOT THE ONE THE UNIVERSITY SENT AN
    # EXAMPLE FOR. That lecturer's Zeitwünsche are not in the Untis export at all — they are in
    # their own availability workbook, which is where the process actually starts. Reading it is
    # what makes the demo the customer's own round trip rather than a re-enactment of it.
    subjects_by_teacher: dict[str, set[str]] = defaultdict(set)
    for e in occ.values():
        for t in e["lehrer"]:
            if e["fach"]:
                subjects_by_teacher[t].add(e["fach"])

    stvp_dir = CUSTOMER / "StVP-Excel"
    stvp_report: list[dict[str, Any]] = []
    for xlsx in sorted(stvp_dir.glob("*.xlsx")) if stvp_dir.exists() else []:
        try:
            sheet = read_stvp(xlsx)
        except SystemExit as exc:
            stvp_report.append({"file": xlsx.name, "error": str(exc)})
            continue
        match = match_teacher(sheet, subjects_by_teacher)
        entry = {"file": xlsx.name, "person": sheet["person"],
                 "courses": len(sheet["courses"]), "rows": len(sheet["availability"]),
                 **match}
        stvp_report.append(entry)
        tid = match.get("teacherId")
        if not tid:
            # ⚠️ Refused, not approximated. An availability constraint on the wrong lecturer would
            # move a different person's lectures, and the plan would look fine while being wrong.
            continue
        existing = {(a["teacherId"], a["slotId"]) for a in availability}
        for row in sheet["availability"]:
            if row["slotId"] not in slot_ids:
                continue
            if (tid, row["slotId"]) in existing:
                continue        # a Zeitwunsch Untis already carries wins: it is the later word
            availability.append({"teacherId": tid, "slotId": row["slotId"],
                                 "state": row["state"], "source": "stvp_excel"})
    report["stvp"] = stvp_report

    # ── seed the rest of the grid ────────────────────────────────────────────────────────────
    #
    # ⚠️ EVERY LECTURER × EVERY SLOT GETS A ROW, and the ones nobody stated are marked as such.
    # The table was 2% populated: OTH exported Zeitwünsche for the BM faculty only (19 lecturers,
    # 324 rows — all of which are used), so 394 of 414 lecturers had nothing on file at all.
    #
    # ⚠️ THE POINT IS THE `source` FIELD, NOT THE EXTRA ROWS. `availability_for` already returned
    # a full week by defaulting a missing pair to `verfuegbar`, so the panel and the spreadsheet
    # looked complete either way — and that is exactly the problem. "She told us this hour is
    # free" and "nobody ever asked her" both rendered as a green cell, and only one of them is a
    # statement about the world. Materialising the grid makes the difference part of the DATA
    # rather than an unwritten rule in one accessor, which is the same reason TUM ships an
    # explicit all-`verfuegbar` table (`build_tum_dataset.py`) instead of an empty one.
    #
    # `verfuegbar` remains the assumed state, because the alternative — inventing a block — would
    # mark real, published sessions as violating a constraint nobody ever stated.
    known_teachers = {t["teacherId"] for t in teacher}

    # ⚠️ Two lecturers in the Zeitwünsche (`Wob`, `Hg`) never appear in the GPU001 grids, so they
    # are not in `teacher.json` and their wishes pointed at nobody. Silently seeding around them
    # would have left 12 rows keyed to a lecturer the app cannot show.
    orphans = sorted({a["teacherId"] for a in availability if a["teacherId"] not in known_teachers})
    if orphans:
        report["availabilityOrphans"] = {
            "lecturers": orphans,
            "rowsDropped": sum(1 for a in availability if a["teacherId"] in orphans),
            "note": "in BM - Zeitwünsche.TXT but in none of the GPU001 grids, so they teach nothing we know of",
        }
        availability = [a for a in availability if a["teacherId"] in known_teachers]

    stated = {(a["teacherId"], a["slotId"]) for a in availability}
    for t in teacher:
        for s in time_slot:
            if (t["teacherId"], s["slotId"]) not in stated:
                availability.append({"teacherId": t["teacherId"], "slotId": s["slotId"],
                                     "state": "verfuegbar", "source": "assumed"})
    availability.sort(key=lambda a: (a["teacherId"], a["slotId"]))

    report["availability"] = {
        "rows": len(availability),
        "stated": len(stated),
        "assumed": len(availability) - len(stated),
        "lecturersWithAStatement": len({t for t, _ in stated}),
        "lecturers": len(known_teachers),
        "$sourceValues": "gpu016 = OTH's Zeitwünsche export · stvp_excel = a lecturer's own "
                         "Stundenverteilungsplan · assumed = nobody stated anything, "
                         "treated as available",
    }

    return {
        "time_slot": time_slot,
        "teacher": teacher,
        "cohort": cohort,
        "room": room,
        "building": buildings,
        "travel_time": travel,
        "course": sorted(courses.values(), key=lambda c: c["courseId"]),
        "course_session": course_session,
        "plan_assignment": plan_assignment,
        "availability": availability,
        "plan_draft": [{"draftId": "published", "name": "Untis-Export WS 2026/27",
                        "status": "published", "parentDraftId": None,
                        "author": "OTH Regensburg (Untis)", "createdAt": None}],
        "_report": report,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    if not UNTIS.exists():
        raise SystemExit(f"Untis export not found at {UNTIS}")

    tables = build()
    report = tables.pop("_report")
    args.out.mkdir(parents=True, exist_ok=True)
    for name, rows in tables.items():
        (args.out / f"{name}.json").write_text(
            json.dumps(rows, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    (args.out / "provenance.json").write_text(json.dumps({
        "$comment": "OTH Regensburg's real Untis export. See PLAN §25.",
        "source": "Untis GPU001/GPU002/GPU016, sent by OTH IT-Zentrum 2026-06-22 via Ines Garaplija",
        "generatedBy": "tools/data/read_untis_gpu.py",
        "measured": [
            "course sessions, their day and period",
            "rooms as Untis names them",
            "classes (Klassen) per lesson",
            "subjects (Fächer)",
            "lecturer short codes",
            "lecturer time preferences (Zeitwünsche, BM only)",
            "block start and end times, blocks 1-6, from the Stundenverteilungsplan",
        ],
        "derived": ["the 7th period's time — it is used by the export but no OTH document we hold "
                    "states it"],
        "notPublished": [
            "lecturer full names — the export carries short codes only",
            "class head counts",
            "room capacity and room type",
            "slot desirability",
            "the week pattern: GPU001 is a weekly grid and cannot say which weeks a "
            "fractional-Wochenwert lesson runs in",
        ],
        "mustNotBeInvented": [
            "a full name for a lecturer short code",
            "a head count for a class",
            "a capacity or type for a room",
        ],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"{args.out.relative_to(ROOT)}:")
    for name, rows in tables.items():
        print(f"   {name:<18} {len(rows):>6}")
    print()
    print(f"   faculties     {len({s['facultyId'] for s in tables['course_session']})}")
    print(f"   lecturers     {len(tables['teacher'])}")
    print(f"   classes       {len(tables['cohort'])}")
    print(f"   rooms         {len(tables['room'])}")
    print(f"   slots         {len(tables['time_slot'])}")
    print(f"   availability  {len(tables['availability'])} rows for "
          f"{len({a['teacherId'] for a in tables['availability']})} lecturers")
    for s in report.get("stvp", []):
        who = s.get("teacherId") or "NOT MATCHED"
        extra = s.get("matchedAliases") or s.get("reason") or s.get("error")
        print(f"   StVP {s['file'][:38]:<40} -> {who:<12} {extra}")
    if args.report or report.get("unknownWishValue") or report.get("unknownDay"):
        print()
        print("   report:", json.dumps(report, ensure_ascii=False)[:400])


if __name__ == "__main__":
    main()

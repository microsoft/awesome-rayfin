"""Validate the generated dataset. A GATE, not a report — it exits non-zero.

The generator already runs a conflict check, but a program checking its own output only proves
it is self-consistent. This reads the written JSON back with no access to the generator's
internals and asks the questions a loader, a semantic model and a solver will each ask.

The Campus-Insights precedent is the reason this exists at all: a duplicate room code sailed
through every visual check and was only caught when Direct Lake refused the relationship. Cheap
to catch here, expensive to catch there.

    python tools/data/validate_dataset.py --site oth
    python tools/data/validate_dataset.py --site lmu
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "data"))
from sites import add_site_argument, load_site  # noqa: E402

# Bound in main() from --site. The gate must be able to check EITHER dataset: a validator that
# only ever looks at the first customer's data is not a gate, it is a habit.
DATA: Path = ROOT / "data" / "synthetic"

problems: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    problems.append(msg)


def load(name: str) -> list[dict]:
    path = DATA / f"{name}.json"
    if not path.exists():
        raise SystemExit(f"{path} is missing — run tools/data/generate_timetable.py first")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    add_site_argument(parser)
    args = parser.parse_args()

    global DATA
    site = load_site(args.site)
    DATA = site.synth
    print(f"=== validating {site.label} ({DATA.name}) ===")

    slots = load("time_slot")
    buildings = load("building")
    rooms = load("room")
    travel = load("travel_time")
    teachers = load("teacher")
    availability = load("availability")
    cohorts = load("cohort")
    courses = load("course")
    sessions = load("course_session")
    groups = load("cohort_group")
    assignments = load("plan_assignment")
    drafts = load("plan_draft")

    # ── 1. Keys are unique ──────────────────────────────────────────────────────────────
    # ⚠️ Direct Lake refuses a duplicate on the one side of a relationship, and it refuses it at
    # model-refresh time, long after the data looked fine on screen.
    for name, rows, key in [
        ("room", rooms, "roomId"),
        ("building", buildings, "buildingId"),
        ("teacher", teachers, "teacherId"),
        ("course", courses, "courseId"),
        ("course_session", sessions, "sessionId"),
        ("cohort", cohorts, "cohortId"),
        ("time_slot", slots, "slotId"),
    ]:
        dupes = [k for k, n in Counter(r[key] for r in rows).items() if n > 1]
        if dupes:
            fail(f"{name}.{key} is not unique: {dupes[:5]} ({len(dupes)} in total)")

    # ── 2. Referential integrity ────────────────────────────────────────────────────────
    room_by_id = {r["roomId"]: r for r in rooms}
    slot_ids = {s["slotId"] for s in slots}
    building_ids = {b["buildingId"] for b in buildings}
    session_by_id = {s["sessionId"]: s for s in sessions}
    teacher_ids = {t["teacherId"] for t in teachers}
    draft_ids = {d["draftId"] for d in drafts}

    for r in rooms:
        if r["buildingId"] not in building_ids:
            fail(f"room {r['roomId']} points at unknown building {r['buildingId']}")
    for s in sessions:
        if s["teacherId"] not in teacher_ids:
            fail(f"session {s['sessionId']} points at unknown teacher {s['teacherId']}")
    for a in assignments:
        if a["sessionId"] not in session_by_id:
            fail(f"assignment points at unknown session {a['sessionId']}")
        if a["roomId"] not in room_by_id:
            fail(f"assignment points at unknown room {a['roomId']}")
        if a["slotId"] not in slot_ids:
            fail(f"assignment points at unknown slot {a['slotId']}")
        if a["draftId"] not in draft_ids:
            fail(f"assignment points at unknown draft {a['draftId']}")

    # ── 3. Nothing is scheduled into a room that cannot be scheduled ────────────────────
    for a in assignments:
        room = room_by_id.get(a["roomId"])
        if room and not room["schedulable"]:
            fail(f"assignment {a['sessionId']} is in {room['roomId']}, a {room['roomType']}")
        if room and room["facultyId"] == "other":
            fail(f"assignment {a['sessionId']} is in a building of an unmodelled faculty")

    # ── 4. Room fits the session ────────────────────────────────────────────────────────
    for a in assignments:
        room = room_by_id.get(a["roomId"])
        sess = session_by_id.get(a["sessionId"])
        if not room or not sess:
            continue
        if room["roomType"] != sess["requiredRoomType"]:
            fail(
                f"{sess['sessionId']} needs a {sess['requiredRoomType']} "
                f"but sits in a {room['roomType']}"
            )
        if room["capacity"] < sess["expectedAttendance"]:
            fail(
                f"{sess['sessionId']} has {sess['expectedAttendance']} attendees "
                f"in a {room['capacity']}-seat room"
            )

    # ── 5. Nothing is double-booked ─────────────────────────────────────────────────────
    room_slot = Counter((a["roomId"], a["slotId"]) for a in assignments)
    for (room_id, slot_id), n in room_slot.items():
        if n > 1:
            fail(f"room {room_id} is booked {n} times in {slot_id}")

    teacher_slot: Counter[tuple[str, str]] = Counter()
    for a in assignments:
        sess = session_by_id.get(a["sessionId"])
        if sess:
            teacher_slot[(sess["teacherId"], a["slotId"])] += 1
    for (teacher_id, slot_id), n in teacher_slot.items():
        if n > 1:
            fail(f"teacher {teacher_id} teaches {n} sessions in {slot_id}")

    # ── 6. Nobody teaches when they said they cannot ────────────────────────────────────
    unavailable = {
        (a["teacherId"], a["slotId"]) for a in availability if a["state"] == "nicht_verfuegbar"
    }
    for a in assignments:
        sess = session_by_id.get(a["sessionId"])
        if sess and (sess["teacherId"], a["slotId"]) in unavailable:
            fail(f"{sess['teacherId']} is scheduled in {a['slotId']} but is unavailable then")

    # ── 7. Travel-time matrix is complete and symmetric ─────────────────────────────────
    tt = {(t["fromBuildingId"], t["toBuildingId"]): t["minutes"] for t in travel}
    for a in building_ids:
        for b in building_ids:
            if (a, b) not in tt:
                fail(f"travel time missing for {a} -> {b}")
            elif tt.get((a, b)) != tt.get((b, a)):
                fail(f"travel time is asymmetric for {a}/{b}")

    # ── 8. The dataset can still produce the conflict the product is about ──────────────
    halls = [r for r in rooms if r["roomType"] == "Hörsaal"]
    hall_sessions = [s for s in sessions if s["requiredRoomType"] == "Hörsaal"]
    pressure = len(hall_sessions) / (len(halls) * len(slots))
    if pressure < 0.35:
        fail(
            f"lecture-hall pressure is only {pressure:.0%} — two faculties would never want the "
            "same hall, and the cascade demo has nothing to collide"
        )
    notes.append(f"lecture-hall pressure {pressure:.0%} ({len(hall_sessions)} sessions, {len(halls)} halls)")

    # Both faculties must actually be competing for those halls, not using separate ones.
    hall_ids = {h["roomId"] for h in halls}
    faculties_per_hall: dict[str, set[str]] = defaultdict(set)
    for a in assignments:
        if a["roomId"] in hall_ids:
            sess = session_by_id.get(a["sessionId"])
            if sess:
                faculties_per_hall[a["roomId"]].add(sess["facultyId"])
    shared_halls = [h for h, f in faculties_per_hall.items() if len(f) > 1]
    if not shared_halls:
        fail("no lecture hall is used by both faculties — the competition is only nominal")
    notes.append(f"{len(shared_halls)} of {len(halls)} halls are used by both faculties")

    # ── 9. Cross-campus teaching actually happens ───────────────────────────────────────
    #
    # ⚠️ ONLY WHERE THE UNIVERSITY HAS MORE THAN ONE CAMPUS. These two checks exist because OTH is
    # split across Prüfening, Seyboth and Galgenberg, and a generated plan that never sends anyone
    # between them would make the travel-time model decorative. TUM Garching is a single campus —
    # that is a fact about Garching, not a defect in its data — so asserting it here would fail a
    # real, published timetable for being accurate. The note is still printed either way.
    campuses = {a["campusId"] for a in assignments}
    per_campus = Counter(a["campusId"] for a in assignments)
    notes.append("sessions per campus: " + ", ".join(f"{k}={v}" for k, v in per_campus.items()))

    cohort_campus_days: dict[tuple[str, str], set[str]] = defaultdict(set)
    for a in assignments:
        sess = session_by_id.get(a["sessionId"])
        if sess:
            day = a["slotId"].split("-")[0]
            cohort_campus_days[(sess["cohortId"], day)].add(a["campusId"])
    switch_days = sum(1 for v in cohort_campus_days.values() if len(v) > 1)

    single_campus_site = len({r.get("campusId") for r in rooms if r.get("campusId")}) < 2
    if single_campus_site:
        notes.append("single-campus university — the cross-campus checks do not apply")
    else:
        if len(campuses) < 2:
            fail("every session is on one campus — the 2.5 km constraint can never bind")
        if switch_days == 0:
            fail("no cohort ever changes campus within a day — nothing for travel time to constrain")
    notes.append(f"{switch_days} cohort-days involve a campus change")

    # ── 10. Every teaching room belongs to a modelled faculty ───────────────────────────
    stray = [r for r in rooms if r["schedulable"] and r["facultyId"] == "other"]
    if stray:
        fail(f"{len(stray)} teaching rooms sit in buildings of unmodelled faculties")

    teaching = [r for r in rooms if r["schedulable"]]
    load_pct = len({(a["roomId"], a["slotId"]) for a in assignments}) / (len(teaching) * len(slots))
    notes.append(
        f"teaching stock {len(teaching)} rooms of {len(rooms)}; utilisation {load_pct:.0%}"
    )
    if not 0.10 <= load_pct <= 0.75:
        fail(
            f"teaching-room utilisation {load_pct:.0%} is outside anything a Hochschule would "
            "recognise — the room stock or the demand is wrong"
        )

    # ── Report ──────────────────────────────────────────────────────────────────────────
    print(f"{len(rooms)} rooms, {len(sessions)} sessions, {len(assignments)} assignments\n")
    for n in notes:
        print(f"  · {n}")

    if problems:
        print(f"\nDATASET INVALID — {len(problems)} problem(s):\n")
        for p in problems[:40]:
            print(f"  - {p}")
        if len(problems) > 40:
            print(f"  … and {len(problems) - 40} more")
        sys.exit(1)

    print(f"\ndataset valid — {10} independent checks agree")


if __name__ == "__main__":
    main()

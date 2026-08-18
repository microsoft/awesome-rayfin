"""Standortabhängigkeit: nobody crosses the city in a 15-minute break — student or professor.

Run: python tools/tests/test_campus_travel.py

Three separate defects sat behind this rule. The tests below pin all three, because fixing one
without the others just moves where the wrong answer comes from.

⚠️ 1. ONLY COHORTS WERE EVER CHECKED. `detect_conflicts` built `cohort_day` and nothing else, so a
professor could be sent 3 km between two back-to-back lectures and no tool would say a word. The
lecturer is arguably the worse case: a cohort's day is planned as one block for one group, while a
lecturer gets handed two different cohorts in two different faculties on two different campuses.

⚠️ 2. THE SOLVER ENFORCED NEITHER. Campus appeared in `propose_repairs` only as a soft `cost += 10`
for leaving a session's CURRENT campus, and no constraint related one block to the block beside it.
So the repair tool could return, and the assistant could recommend, a plan that `detect_conflicts`
would immediately call a HARD conflict. Two halves of one product disagreeing is worse than either
being wrong on its own, because whichever one the user happens to ask looks authoritative.

⚠️ 3. THE THRESHOLD DECIDES THE WHOLE SITE, AND IT USED TO MISS BY ONE MINUTE. Cross-campus travel
is modelled as a bus, `8 + d/6.0/60`, which lands every OTH pair on 14–15 minutes. The break is 15
and the test was `> BREAK_MIN`, so the worst crossing in the dataset was not a conflict — a
15-minute bus ride inside a 15-minute break, arriving exactly as the next lecture starts, with no
time to leave one room or enter the other. It is now `>=`, and `test_oth_boundary` pins the
coincidence so that retiming the buses or the break shows up as a named failure rather than
silently switching a safety rule on or off across a whole site.

⚠️ THE REAL NUMBERS ARE A QUESTION FOR OTH (PLAN §23.5, Tier 4). 8 minutes of overhead plus
21.6 km/h is our guess, not their timetable. Both figures are pending.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from schedule_store import ScheduleStore  # noqa: E402
from tools import (  # noqa: E402
    BREAK_MIN,
    _travel_minutes,
    detect_conflicts,
    propose_repairs,
)

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("  ok    " if ok else "  FAIL  ") + name + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)


def usable(store: ScheduleStore) -> list[str]:
    """Buildings a session can actually be placed in.

    ⚠️ Not `store.buildings`. Most of them have no schedulable rooms — OTH's only pairs over the
    break involve building `m`, which has none, so a test that ignored this would 'prove' the rule
    works using a crossing no timetable can ever contain.
    """
    return sorted({r["buildingId"] for r in store.rooms if r.get("schedulable")})


def transitions(store: ScheduleStore, moves: list[dict] | None = None) -> list[dict]:
    """⚠️ `conflicts` is a COUNT and `detail` is capped at 60. Use `byType` for exact totals."""
    return [c for c in detect_conflicts(store, moves=moves).get("detail", [])
            if c.get("type") == "campus_transition"]


def count(store: ScheduleStore, moves: list[dict] | None = None) -> int:
    return detect_conflicts(store, moves=moves).get("byType", {}).get("campus_transition", 0)


# ── 1. the travel table itself ────────────────────────────────────────────────────────────
oth = ScheduleStore.load("oth")
lmu = ScheduleStore.load("lmu")

pairs = [(a, b, m) for (a, b), m in oth.travel_min.items() if a != b]
check(
    "travel is found whichever way round the table records it",
    all(_travel_minutes(oth, a, b) == _travel_minutes(oth, b, a) for a, b, _ in pairs),
    f"{len(pairs)} pairs checked",
)

camp = {b["buildingId"]: b.get("campusId") for b in oth.buildings}
use = usable(oth)
cross = [_travel_minutes(oth, a, b) for a in use for b in use
         if a < b and camp.get(a) != camp.get(b)]
check(
    "OTH's two campuses are far enough apart to be worth modelling",
    bool(cross) and min(cross) > 10,
    f"{len(cross)} cross-campus pairs, {min(cross, default=0)}–{max(cross, default=0)} min",
)
check(
    "test_oth_boundary: OTH's crossings sit EXACTLY on the break, which is why `>=` decides them",
    max(cross, default=0) == BREAK_MIN,
    f"worst crossing {max(cross, default=0)} min vs BREAK_MIN {BREAK_MIN}, rule fires at >= {BREAK_MIN}",
)

# ── 2. a real lecturer, stranded, is flagged — tested where the rule CAN fire ──────────────
block_of = {s["slotId"]: (s["day"], s["block"]) for s in lmu.slots}
by_teacher: dict[tuple[str, str], list[tuple[int, str, str]]] = {}
for a in lmu.assignments:
    sess = lmu.session_by_id.get(a["sessionId"])
    room = lmu.room_by_id.get(a["roomId"])
    if not sess or not room or a["slotId"] not in block_of:
        continue
    day, block = block_of[a["slotId"]]
    by_teacher.setdefault((sess["teacherId"], day), []).append(
        (block, a["sessionId"], room["buildingId"])
    )

probe = None
for (teacher, _day), entries in by_teacher.items():
    entries.sort()
    for (b1, _s1, bld1), (b2, s2, bld2) in zip(entries, entries[1:]):
        if b2 != b1 + 1 or _travel_minutes(lmu, bld1, bld2) > BREAK_MIN:
            continue  # already stranded in the published plan — not proof the check works
        sess2 = lmu.session_by_id[s2]
        for room in lmu.rooms:
            if not room.get("schedulable") or room["roomType"] != sess2["requiredRoomType"]:
                continue
            if room["capacity"] < sess2["expectedAttendance"]:
                continue
            if _travel_minutes(lmu, bld1, room["buildingId"]) > BREAK_MIN:
                probe = (teacher, s2, room["roomId"], bld1, room["buildingId"])
                break
        if probe:
            break
    if probe:
        break

if probe:
    teacher, sid, room_id, bld_from, bld_to = probe
    base = count(lmu)
    after = transitions(lmu, moves=[{"sessionId": sid, "roomId": room_id}])
    mine = [c for c in after if c.get("teacherId") == teacher]
    check(
        "a LECTURER sent between two campuses back to back is flagged",
        bool(mine),
        f"{teacher}: {bld_from} -> {bld_to} ({_travel_minutes(lmu, bld_from, bld_to)} min)",
    )
    check(
        "the move makes it WORSE than the plan it started from",
        count(lmu, moves=[{"sessionId": sid, "roomId": room_id}]) > base,
        f"{base} -> {count(lmu, moves=[{'sessionId': sid, 'roomId': room_id}])}",
    )
    check("and it is hard, not advisory",
          bool(mine) and all(c.get("severity") == "hard" for c in mine))
    check(
        "the conflict says WHICH kind of person is stranded",
        bool(mine) and mine[0].get("ownerKind") == "teacher",
        str(mine[0].get("ownerKind")) if mine else "",
    )
else:
    check("a LECTURER sent between two campuses back to back is flagged", False,
          "the probe found no lecturer it could strand — nothing was actually tested")

# ── 3. the point of the whole exercise: the solver must not contradict the detector ────────
#
# ⚠️ THE DEMO TEACHER IS NOT A TEST OF THIS. The obvious version of this check — repair
# `store.demo_teacher()` and count crossings — PASSES WITH BOTH GUARDS DELETED. That lecturer's
# rooms sit on one campus, so the solver never wanted to cross in the first place and the check
# was measuring nothing. A guard nobody has watched fail is not a guard.
#
# These four teacher/day sets were found by sweeping all 163 multi-session sets with the guards
# disabled and keeping the ones where the unconstrained solver really did strand somebody: each
# reaches 103–104 crossings against a baseline of 102 with the guards off, and exactly 102 with
# them on. Deleting either `reachable_from_fixed` or the `by_owner_block` pair constraint in
# `propose_repairs` turns this check red, which is the property that makes it worth running.
DISCRIMINATING = [("MIS-T032", "Mo"), ("MED-T042", "Mo"), ("MED-T004", "Mi"), ("MIS-T023", "Mo")]

block_day = {s["slotId"]: s["day"] for s in lmu.slots}
sets: dict[tuple[str, str], list[str]] = {}
for a in lmu.assignments:
    sess = lmu.session_by_id.get(a["sessionId"])
    if not sess or a["slotId"] not in block_day:
        continue
    sets.setdefault((sess["teacherId"], block_day[a["slotId"]]), []).append(a["sessionId"])

usable_sets = [(t, d, sets[(t, d)]) for t, d in DISCRIMINATING if (t, d) in sets]
check(
    "the scenarios known to strand someone still exist in the data",
    len(usable_sets) == len(DISCRIMINATING),
    f"{len(usable_sets)}/{len(DISCRIMINATING)} found — regenerate the sweep if the data changed",
)

base = count(lmu)
check(
    "the PUBLISHED plan itself contains no crossing the detector would call hard",
    base == 0,
    f"{base} crossings in the plan as generated",
)
worst_overall = base
checked = 0
for teacher, day, ids in usable_sets:
    repair = propose_repairs(
        lmu, ids, k=3, forbid=[{"teacher": teacher, "day": day}], time_limit_s=10.0
    )
    options = repair.get("options") or []
    if not options:
        continue
    checked += 1
    for opt in options:
        moves = [
            {"sessionId": mv["sessionId"], "slotId": mv["to"]["slotId"],
             "roomId": mv["to"]["roomId"]}
            for mv in opt.get("moves", [])
        ]
        worst_overall = max(worst_overall, count(lmu, moves=moves))

check("the solver returned options for those scenarios", checked > 0, f"{checked} sets solved")
check(
    "NO option the solver offers ADDS a crossing it would itself call hard",
    checked > 0 and worst_overall <= base,
    f"plan starts at {base} crossings, worst option {worst_overall} (unguarded reaches 104)",
)

print()
if FAILURES:
    print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
    raise SystemExit(1)
print("ok — lecturers are checked too, and the solver no longer contradicts the detector")

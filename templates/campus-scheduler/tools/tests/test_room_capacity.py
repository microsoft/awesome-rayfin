"""Room size as a constraint — including when nobody published the headcount.

Run: `python tools/tests/test_room_capacity.py` (a script, not pytest — PLAN §19).
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from schedule_store import ScheduleStore  # noqa: E402
from tools import propose_repairs  # noqa: E402

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)


# ── the room table itself ────────────────────────────────────────────────────────────────
real = ScheduleStore.load("oth-real")
sized = [r for r in real.rooms if r.get("capacity") is not None]
check("the real dataset now knows some room sizes", len(sized) > 0, f"{len(sized)} of {len(real.rooms)}")
check("and every size that exists came from a published plan, not a guess",
      all(r.get("capacityProvenance") == "oth_floor_plan" for r in sized))
check("rooms without a published plan stay unknown rather than invented",
      all(r.get("capacity") is None for r in real.rooms if r.get("capacityProvenance") is None))

# The sizes have to be real numbers a planner could quote.
#
# ⚠️ THIS ASSERTION EARNED ITS KEEP IMMEDIATELY. It failed on a 3-seat room — `P068`, which OTH's
# own floor plan calls a `Büro` and which the Untis grid nevertheless schedules teaching into.
# That is a finding about the customer's data, not a reason to loosen the test, so the range check
# is scoped to rooms the plan calls teaching rooms and the office is reported separately.
TEACHING = {"Hörsaal", "Seminarraum", "Übungsraum", "Labor", "CIP-Pool"}
teaching = [r for r in sized if r.get("roomType") in TEACHING]
if teaching:
    caps = sorted(r["capacity"] for r in teaching)
    check("teaching-room sizes are plausible", caps[0] >= 10 and caps[-1] <= 1000,
          f"{caps[0]}..{caps[-1]} over {len(teaching)} rooms")

odd = [r for r in sized if r.get("roomType") not in TEACHING]
check("any non-teaching room that Untis schedules into is reported, not hidden",
      True, f"{len(odd)}: {[(r['roomId'], r.get('roomType'), r['capacity']) for r in odd]}")

# ── the constraint ───────────────────────────────────────────────────────────────────────
# ⚠️ THE CASE THIS EXISTS FOR. On OTH's export `expectedAttendance` is unknown for all 3 015
# sessions, so the absolute capacity check never fires. Without the "do not shrink" rule the
# solver would happily move a lecture out of the 95-seat K 001 into a 24-seat CIP-Pool and report
# it as a clean repair.
by_room: dict[str, list] = {}
for row in real.assignments:
    by_room.setdefault(row.get("roomId") or "", []).append(row)

big = max(
    (r for r in teaching if by_room.get(r["roomId"])),
    key=lambda r: r["capacity"],
    default=None,
)

if big is None:
    check("a sized teaching room carries at least one session", False, "none in use")
else:
    row = by_room[big["roomId"]][0]
    session_id = row["sessionId"]
    sess = real.session_by_id[session_id]
    check(f"the subject sits in {big['roomId']} ({big['capacity']} seats)",
          sess.get("expectedAttendance") is None,
          "and its headcount is unknown, which is the whole point")

    # Force it off its own day, so the solver has to look at other rooms rather than answering
    # "it can stay where it is" — which is what `minimise change` correctly does otherwise.
    day = str(row.get("slotId", "")).split("-")[0]
    result = propose_repairs(real, [session_id], k=3, forbid=[{"day": day}], time_limit_s=10.0)
    options = result.get("options") or []
    check("the solver still finds somewhere to put it", len(options) > 0,
          str(result.get("error") or result.get("note") or ""))

    # ⚠️ READ `move["to"]["roomId"]`. The first version of this test looked for `toRoomId`, found
    # nothing, compared None against nothing and PASSED — a green test that checked air. The
    # vacuity guard below is what would have caught it.
    offered: list[tuple[str, object]] = []
    moved = 0
    for option in options:
        for move in option.get("moves", []):
            if move.get("sessionId") != session_id:
                continue
            if move.get("changed"):
                moved += 1
            rid = (move.get("to") or {}).get("roomId") or ""
            offered.append((rid, real.room_by_id.get(rid, {}).get("capacity")))

    check("the options actually move it, so this is not a no-op", moved > 0, f"{moved} changed")
    check("every offered room was resolvable", offered and all(rid for rid, _ in offered),
          str(offered))

    shrunk = [(rid, cap) for rid, cap in offered
              if isinstance(cap, int) and cap < big["capacity"]]
    check("no option moves it into a smaller room", not shrunk,
          f"offered {offered} — smaller: {shrunk}")

    # ⚠️ AND NOW THE CASE THAT ACTUALLY EXERCISES THE RULE.
    #
    # Two earlier versions of this block passed with the rule DELETED, for two different reasons,
    # and both were green for the wrong reason until sabotage-checked:
    #
    #   1. `minimise change` keeps the session in K 001, so the filter was never asked anything.
    #   2. With K 001 closed the solver simply picked one of the 122 rooms whose size nobody has
    #      published — allowed by design, and invisible to an assertion that skips unknowns.
    #
    # Point 2 is a finding about the product, not only about the test: on OTH's real data this
    # rule almost never binds, because there is nearly always an unsized room to escape into. It
    # will bite properly once the GPU005 (Räume) export arrives and the sizes are known.
    #
    # To prove the rule works at all, close every room whose size we do NOT know, plus K 001
    # itself. What is left is building K's other rooms — all smaller than 95 — so the solver must
    # either refuse or shrink. Refusing is the correct answer.
    closed_rooms = [
        r for r in real.rooms
        if r.get("capacity") is None or r["roomId"] == big["roomId"]
    ]
    for r in closed_rooms:
        r["schedulable"] = False
    try:
        squeezed = propose_repairs(real, [session_id], k=3, forbid=[{"day": day}], time_limit_s=10.0)
        picked: list[tuple[str, object]] = []
        for option in squeezed.get("options") or []:
            for move in option.get("moves", []):
                if move.get("sessionId") != session_id:
                    continue
                rid = (move.get("to") or {}).get("roomId") or ""
                picked.append((rid, real.room_by_id.get(rid, {}).get("capacity")))

        smaller = [(rid, cap) for rid, cap in picked
                   if isinstance(cap, int) and cap < big["capacity"]]
        check("with only smaller sized rooms left, it is NOT crammed into one",
              not smaller,
              f"picked {picked} — smaller: {smaller} (error: {squeezed.get('error')})")
    finally:
        for r in closed_rooms:
            r["schedulable"] = True

print()
if FAILURES:
    print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
    raise SystemExit(1)
print("ok — a room's size is a constraint, and an unknown size is not a licence")

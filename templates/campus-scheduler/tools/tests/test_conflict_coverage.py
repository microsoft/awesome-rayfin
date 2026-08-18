"""A missing room must not exempt a session from the checks that do not need one.

Run: `python tools/tests/test_conflict_coverage.py` (a script, not pytest — PLAN §19).
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from schedule_store import ScheduleStore  # noqa: E402
from tools import detect_conflicts  # noqa: E402

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)


store = ScheduleStore.load("oth-real")
res = detect_conflicts(store)
by_type = res.get("byType") or {}

# ⚠️ THE DEFECT THIS GUARDS. `detect_conflicts` opened with
#     if not sess or not room or not slot: continue
# which reads as caution and is the opposite. OTH's export leaves `roomId` empty for 266 of 3 015
# sessions — a lecture with no room booked yet is an ordinary state — so 266 sessions were dropped
# before ANY check ran, including teacher availability and double-booking, neither of which needs
# a room. It reported 37 teacher-unavailable findings where counting by hand gives 41.
#
# Under-reporting is the dangerous direction: it says "clean" about something never looked at.

roomless = [
    s for s in store.sessions
    if (row := store.assignment_by_session.get(s["sessionId"])) is not None
    and store.room_by_id.get(row.get("roomId")) is None
]
check("the real export really does contain room-less sessions", len(roomless) > 0,
      f"{len(roomless)} of {len(store.sessions)}")
check("and they are reported as unchecked FOR THE ROOM, not silently dropped",
      (res.get("unchecked") or {}).get("room") == len(roomless),
      f"unchecked.room={(res.get('unchecked') or {}).get('room')} vs {len(roomless)}")

# The independent count: every published session sitting where its lecturer said no.
hand = sum(
    1 for s in store.sessions
    if (row := store.assignment_by_session.get(s["sessionId"])) is not None
    and (s.get("teacherId"), row.get("slotId")) in store.unavailable
)
check("every teacher-unavailable finding is reported",
      by_type.get("teacher_unavailable") == hand,
      f"reported {by_type.get('teacher_unavailable')}, by hand {hand}")

# ⚠️ AT LEAST ONE of them must be a room-less session, or this test would still pass with the bug
# in place — the 4 that were being lost are exactly the ones with no room.
roomless_blocked = [
    s["sessionId"] for s in roomless
    if (row := store.assignment_by_session.get(s["sessionId"])) is not None
    and (s.get("teacherId"), row.get("slotId")) in store.unavailable
]
check("and some of them have no room, which is what made the bug invisible",
      len(roomless_blocked) > 0, f"{len(roomless_blocked)}: {roomless_blocked[:4]}")

# Sanity: the totals must add up rather than drift.
check("hard total equals the sum of its types", res["hard"] == sum(by_type.values()),
      f"{res['hard']} vs {sum(by_type.values())}")
check("every session was examined", res.get("checked") == len(store.assignments),
      f"{res.get('checked')} of {len(store.assignments)}")

print()
if FAILURES:
    print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
    raise SystemExit(1)
print("ok — a missing room hides nothing except the room's own checks")

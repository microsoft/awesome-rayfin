"""Tests for the read-only calendar (PLAN §13.3).

Run: python -m pytest tools/tests/test_calendar.py  (or: python tools/tests/test_calendar.py)

These are plain asserts rather than a framework so they run with nothing installed beyond what the
server already needs.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from calendar_view import calendar_suggestions, calendar_view, resolve_subject  # noqa: E402
from schedule_store import ScheduleStore  # noqa: E402

store = ScheduleStore.load()
failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok    {name}{f' — {detail}' if detail else ''}")
    else:
        failures.append(name)
        print(f"  FAIL  {name}{f' — {detail}' if detail else ''}")


print("grid:")
# ⚠️ AND THE SURNAME ITSELF WAS STILL A SEED. This read `"Hinterberger"`, and the comment below
# already explains why pinning the faculty prefix was wrong — the name was the same mistake one
# level up. Regenerating the timetable reshuffles the surname pool, "Hinterberger" stopped existing
# at OTH, and `calendar_view` correctly returned `not_found` — which surfaced as `KeyError: 'slots'`
# three lines later, a confusing way to be told the fixture had rotted. Take a surname the store
# actually carries; the promise under test is that typing one resolves to that person.
demo_teacher = store.teachers[0]
demo_surname = demo_teacher["name"].split()[-1]
view = calendar_view(store, "teacher", demo_surname)
check("the lookup answered at all", "error" not in view, str(view.get("error")))
check("the grid is the data's own shape", len(view["slots"]) == len(store.slots),
      f"{len(view['slots'])} slots")
check("five teaching days", view["days"] == ["Mo", "Di", "Mi", "Do", "Fr"])
# ⚠️ THIS USED TO PIN THE FACULTY PREFIX (`IM-T`), WHICH IS A SEED AND NOT THE BEHAVIOUR. The
# published-plan rooms in `8ad034c` reshuffled the estate and Hinterberger moved to `M-T024`, so a
# correct lookup started failing for being correct. What the resolver actually promises is that a
# planner can type a surname instead of an id and get THAT person — so that is what is asserted:
# a real teacher in the store, whose name carries the surname that was searched for.
subject_id = view["subject"]["id"]
subject_name = view["subject"]["name"] or ""
check("subject resolved from a surname",
      subject_id in store.teacher_by_id and demo_surname.lower() in subject_name.lower(),
      f"{subject_id} {subject_name}")

print("entries:")
friday = [e for e in view["entries"] if e["slotId"].startswith("Fr")]
# ⚠️ AND THIS PINNED THE COUNT, for the same reason and with the same result: the cascade demo is
# "a professor drops Friday", so what has to be true is that the Friday is NOT EMPTY. Five was
# never the requirement, it was just what the generator happened to produce that week — exactly the
# mistake `calendar.spec.ts` made when it named cell `Fr-1` and broke on a data change that was
# fine. The count is printed so a drift is still visible without being fatal.
check("the Friday the cascade demo is about is not empty", len(friday) > 0, f"{len(friday)} sessions")
check("every entry names a room", all(e["roomId"] for e in view["entries"]))
check("every entry sits in a real slot",
      all(e["slotId"] in store.slot_by_id for e in view["entries"]))

# ⚠️ The reason this is asserted: a cohort's week has MORE entries than booked slots because
# Praktika run as parallel groups at the same hour in different rooms. A calendar that assumed one
# booking per cell would silently drop them, and the dropped ones are exactly the sessions that
# make the room shortage real.
cohort = calendar_view(store, "cohort", "IM-WIRT-1")
check("a cell may hold several parallel sessions",
      len(cohort["entries"]) > cohort["bookedSlots"],
      f"{len(cohort['entries'])} entries in {cohort['bookedSlots']} slots")

print("availability:")
check("a teacher view carries availability", "availability" in view)
check("a room view does not invent availability",
      "availability" not in calendar_view(store, "room", "D 104"))
# ⚠️ ASK A TEACHER WHO ACTUALLY HAS BLOCKED SLOTS. This read the demo teacher's week and asserted
# it contained some — 74 of the 80 lecturers do, and Hinterberger happens to be one of the six who
# do not, so a correct view failed for a correct reason. The behaviour under test is that a teacher
# view REPORTS the blocks the dataset holds, which needs a teacher who has them; the dataset is
# asked which one rather than told.
_blocked_by_teacher: dict[str, int] = {}
for _a in store.availability:
    if _a["state"] != "verfuegbar":
        _blocked_by_teacher[_a["teacherId"]] = _blocked_by_teacher.get(_a["teacherId"], 0) + 1
_busiest_blocked = max(_blocked_by_teacher, key=lambda k: _blocked_by_teacher[k], default=None)
check("the dataset blocks somebody's time at all", _busiest_blocked is not None,
      f"{len(_blocked_by_teacher)} of {len(store.teachers)} lecturers")
if _busiest_blocked:
    _blocked_view = calendar_view(store, "teacher", _busiest_blocked)
    blocked = [a for a in _blocked_view["availability"] if a["state"] != "verfuegbar"]
    check("the unavailable slots are reported", len(blocked) > 0,
          f"{_busiest_blocked}: {len(blocked)} blocked")

print("resolution:")
check("an exact room code resolves", calendar_view(store, "room", "D 104")["subject"]["id"] == "D 104")
# ⚠️ 'D 104' and 'd 104' are DIFFERENT rooms: upper case is a published OTH building letter, lower
# case is a placeholder this project invented. Resolving 'd104' by case picked the empty one and
# returned a confident, plausible, entirely wrong week.
#
# ⚠️ The PAIR is found in the data, not written in. `d 104` stopped existing the day buildings with
# a published plan stopped getting invented rooms, so this test failed for a room stock that had
# become MORE honest. 200 case collisions remain; the rule is what matters, not which pair proves it.
_collisions = {}
for _r in store.rooms:
    _collisions.setdefault(_r["roomId"].lower(), set()).add(_r["roomId"])
_pair = next((k for k, v in sorted(_collisions.items()) if len(v) > 1), None)
check("the estate still has a case-ambiguous code to test with", _pair is not None,
      str(sorted(_collisions.get(_pair, []))) if _pair else "none left")
ambiguous = calendar_view(store, "room", (_pair or "").replace(" ", ""))
check("a case-ambiguous room code asks instead of guessing",
      ambiguous.get("error") == "ambiguous",
      ", ".join(ambiguous.get("candidates", [])))
check("an unknown teacher is not found", calendar_view(store, "teacher", "Nonexistent")["error"] == "not_found")
check("a bad scope is refused", calendar_view(store, "sideways", "x")["error"] == "bad_scope")
check("a blank key is refused", resolve_subject(store, "teacher", "  ") is None)

print("suggestions:")
rooms = calendar_suggestions(store, "room")
check("suggestions are busiest first",
      all(rooms[i]["sessions"] >= rooms[i + 1]["sessions"] for i in range(len(rooms) - 1)),
      f"top {rooms[0]['id']} with {rooms[0]['sessions']}" if rooms else "none")
check("suggestions resolve back to a view",
      calendar_view(store, "room", rooms[0]["id"])["bookedSlots"] > 0 if rooms else False)

print("purity:")
before = {a["sessionId"]: dict(a) for a in store.assignments}
calendar_view(store, "teacher", "Hinterberger")
calendar_view(store, "cohort", "IM-WIRT-1")
calendar_view(store, "room", "D 104")
after = {a["sessionId"]: dict(a) for a in store.assignments}
check("reading the calendar changes nothing", before == after, f"{len(before)} assignments")

print()
if failures:
    raise SystemExit(f"{len(failures)} calendar check(s) failed: {', '.join(failures)}")
print(f"calendar ok — {len(store.slots)} slots, {len(store.assignments)} assignments")

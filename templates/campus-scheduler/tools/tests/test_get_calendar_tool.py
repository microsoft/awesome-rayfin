"""The agent's read-only view of a week — PLAN §13.5 step 5.

Two things are being guarded: that the tool answers the question it exists for ("when is this
free"), and that giving the agent a calendar did NOT give it a way to change one.
"""
import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from calendar_view import calendar_suggestions, calendar_view  # noqa: E402
from schedule_store import ScheduleStore, SITE  # noqa: E402
from tools import TOOL_IMPLEMENTATIONS, get_calendar  # noqa: E402

store = ScheduleStore.load()
failures: list[str] = []

# ⚠️ THIS SUITE IS ABOUT OTH, DELIBERATELY, AND WILL NOT SURVIVE ANOTHER SITE. It names Hinterberger,
# room `D 104` and cohort `IM-WIRT-1`, and its sharpest assertion — that `d104` is refused as
# AMBIGUOUS rather than guessed — depends on OTH having both a published upper-case `D` and a
# lower-case placeholder `d`. None of that is portable, and it should not be: the case-ambiguity
# rule was written for a real trap in OTH's estate. Run under `SCHEDULER_SITE=tum` it used to die
# with `KeyError: 'subject'` from a lookup that simply found nobody, which reads as a broken
# calendar rather than a test pointed at the wrong university.
if SITE != "oth":
    print(f"skipped — this suite is OTH-specific and SCHEDULER_SITE is '{SITE}'.")
    print("  Run it without SCHEDULER_SITE set, or with SCHEDULER_SITE=oth.")
    raise SystemExit(0)


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok    {name}{f' — {detail}' if detail else ''}")
    else:
        failures.append(name)
        print(f"  FAIL  {name}{f' — {detail}' if detail else ''}")


# ⚠️ THE FALLBACK WAS HALF-APPLIED, WHICH IS WORSE THAN NONE. This line already coped with
# "Hinterberger" no longer existing — the surname pool moves whenever the timetable is regenerated
# — but the LOOKUP below still asked for the literal name, so the fallback silently protected
# nothing and the test died on `KeyError: 'subject'` against a `not_found` payload. Ask for the
# surname of whoever was actually chosen.
teacher = store.find_teacher("Hinterberger") or store.teachers[0]
teacher_surname = teacher["name"].split()[-1]

print("answers the question it exists for:")
week = get_calendar(store, "teacher", teacher_surname)
check("the lookup answered at all", "error" not in week, str(week.get("error")))
check("a surname resolves", week["subject"]["id"] == teacher["teacherId"],
      week["subject"].get("name") or "")
check("booked sessions are listed", week["bookedCount"] > 0, f"{week['bookedCount']} booked")
check("free slots are listed", len(week["free"]) > 0, f"{len(week['free'])} free")
check("every booked slot names a room and a course",
      all(b["roomId"] and b["course"] for b in week["booked"]))

# ⚠️ The distinction the whole tool turns on: an empty slot somebody has said no to is NOT free.
# Reporting it as free is how a planner gets talked into a move that was never possible.
#
# ⚠️ Read a lecturer who HAS blocked time. 74 of 80 do, and the demo teacher is one of the six who
# do not — so this asserted an absence and called it a failure. What is under test is that the tool
# surfaces the blocks the dataset holds.
_blocked_counts: dict[str, int] = {}
for _a in store.availability:
    if _a["state"] != "verfuegbar":
        _blocked_counts[_a["teacherId"]] = _blocked_counts.get(_a["teacherId"], 0) + 1
_with_blocks = max(_blocked_counts, key=lambda k: _blocked_counts[k], default=None)
week_blocked = get_calendar(store, "teacher", _with_blocks) if _with_blocks else {"unavailable": []}
blocked = set(week_blocked["unavailable"])
check("a teacher has blocked slots at all", len(blocked) > 0,
      f"{_with_blocks}: {len(blocked)} blocked")
# ⚠️ SAME WEEK ON BOTH SIDES. Comparing one lecturer's blocked slots against another's free list
# reported "11 leaked" — a real-looking violation of a rule nothing had broken, invented purely by
# the test mixing two people. The claim is about ONE person's week: what is blocked for them must
# not be offered to them.
check("blocked slots are never offered as free",
      not (blocked & set(week_blocked["free"])),
      f"{len(blocked & set(week_blocked['free']))} leaked")
check("booked slots are never offered as free",
      not ({b['slotId'] for b in week['booked']} & set(week['free'])))

print("agrees with the grid the human sees:")
grid = calendar_view(store, "teacher", teacher_surname)
check("the same sessions appear in both surfaces",
      {b["slotId"] for b in week["booked"]} == {e["slotId"] for e in grid["entries"]},
      f"{week['bookedCount']} vs {len(grid['entries'])} entries")

print("rooms and cohorts:")
# ⚠️ AND THE ROOM WAS A SEED TOO. `D 104` still exists, but after the room stock grew the solver
# spread the week differently and it now holds NOTHING — so "a room week reads" failed against a
# perfectly good room. What is under test is that a room's week comes back populated, which needs
# a room the plan actually books; the suggestions endpoint already ranks them by exactly that.
busiest_room = calendar_suggestions(store, "room")[0]["id"]
room = get_calendar(store, "room", busiest_room)
check("a room week reads", room["bookedCount"] > 0, f"{busiest_room}: {room['bookedCount']} booked")
check("a room has no availability concept", not room["unavailable"])
cohort = get_calendar(store, "cohort", "IM-WIRT-1")
check("a cohort week reads", cohort["bookedCount"] > 0, f"{cohort['bookedCount']} booked")

print("refuses rather than guesses:")
# ⚠️ The colliding pair is found in the data. `d 104` stopped existing when buildings with a
# published plan stopped getting invented rooms, so a hard-coded code failed for an estate that had
# become more honest. The RULE is the subject, not the example.
_collide: dict[str, set] = {}
for _r in store.rooms:
    _collide.setdefault(_r["roomId"].lower(), set()).add(_r["roomId"])
_ambiguous_code = next((k for k, v in sorted(_collide.items()) if len(v) > 1), "")
check("an ambiguous room code asks",
      get_calendar(store, "room", _ambiguous_code.replace(" ", "")).get("error") == "ambiguous",
      _ambiguous_code)
check("an unknown subject is not found",
      get_calendar(store, "teacher", "Nonexistent").get("error") == "not_found")
check("a bad scope is refused", get_calendar(store, "sideways", "x").get("error") == "bad_scope")

print("it is a READ, and only a read:")
before = copy.deepcopy(store.assignments)
get_calendar(store, "teacher", teacher_surname)
get_calendar(store, "room", "D 104")
get_calendar(store, "cohort", "IM-WIRT-1")
check("reading a week changes nothing", store.assignments == before, f"{len(before)} assignments")

# Giving the agent a calendar must not have given it a way to change one.
surface = set(TOOL_IMPLEMENTATIONS)
check("the calendar tool is registered", "get_calendar" in surface)
check("still no write tool anywhere in the surface",
      not any(k in t for t in surface for k in ("apply", "draft", "proposal", "confirm", "set_", "move_")),
      ", ".join(sorted(surface)))

print()
if failures:
    raise SystemExit(f"{len(failures)} check(s) failed: {', '.join(failures)}")
print("the agent can read a week, and still cannot change one")

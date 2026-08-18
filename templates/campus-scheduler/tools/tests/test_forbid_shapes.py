"""`forbid` must survive the shapes a model actually sends.

A malformed `forbid` used to raise AttributeError inside propose_repairs. `_run_tool` turned that
into a tool error, the agent correctly refused to invent an answer, and the headline cascade demo
failed outright. These check the shapes observed in practice all produce the same blocked day.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from schedule_store import ScheduleStore  # noqa: E402
from tools import propose_repairs  # noqa: E402

store = ScheduleStore.load()
failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok    {name}{f' — {detail}' if detail else ''}")
    else:
        failures.append(name)
        print(f"  FAIL  {name}{f' — {detail}' if detail else ''}")


teacher = store.find_teacher("Hinterberger") or store.teachers[0]
friday = {s["slotId"] for s in store.slots if s["day"] == "Fr"}
targets = [
    a["sessionId"] for a in store.assignments
    if a.get("teacherId") == teacher["teacherId"] and a.get("slotId") in friday
]
print(f"{teacher.get('name')} — {len(targets)} Friday sessions\n")


def moved_off_friday(result: dict) -> bool:
    """The constraint was honoured: nothing the solver chose sits on a Friday."""
    if result.get("error"):
        return False
    opts = result.get("options") or []
    if not opts:
        return False
    return all(
        not (m["to"]["slotId"] or "").startswith("Fr")
        for m in opts[0]["moves"]
    )


SHAPES = {
    "documented objects": [{"teacher": teacher["teacherId"], "day": "Fr"}],
    "teacher by surname": [{"teacher": "Hinterberger", "day": "Fr"}],
    "bare day string": ["Fr"],
    "bare slot strings": sorted(friday),
    "object without a teacher": [{"day": "Fr"}],
    "slotId objects": [{"teacher": "Hinterberger", "slotId": s} for s in sorted(friday)],
}

print("shapes:")
for name, forbid in SHAPES.items():
    try:
        result = propose_repairs(store, targets, k=1, forbid=forbid)
        check(name, moved_off_friday(result),
              f"{(result.get('options') or [{}])[0].get('sessionsMoved', '?')} moved"
              if not result.get("error") else result.get("error", ""))
    except Exception as exc:  # noqa: BLE001 - the whole point is that nothing raises
        check(name, False, f"raised {type(exc).__name__}: {exc}")

print("\njunk is ignored rather than fatal:")
for name, forbid in {
    "empty list": [],
    "empty string": [""],
    "None entry": [None],
    "number entry": [42],
    "unknown teacher": [{"teacher": "Nonexistent", "day": "Fr"}],
}.items():
    try:
        result = propose_repairs(store, targets, k=1, forbid=forbid)
        check(name, not result.get("error"), result.get("error", "no error"))
    except Exception as exc:  # noqa: BLE001
        check(name, False, f"raised {type(exc).__name__}: {exc}")

print()
if failures:
    raise SystemExit(f"{len(failures)} forbid check(s) failed: {', '.join(failures)}")
print("forbid survives every shape observed from the model")

"""The confirm gate — PLAN §13.2 and §13.5 steps 2 and 4.

The single most important assertion in this file is the last one: after a proposal has been
created, previewed AND applied, the published plan is byte-identical. Everything else is detail.
"""
import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

import proposals  # noqa: E402
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


# The cascade the demo is about: a teacher drops a whole day.
teacher = store.find_teacher("Hinterberger") or store.teachers[0]
friday = [s for s in store.slots if s["day"] == "Fr"]
affected = [
    a["sessionId"]
    for a in store.assignments
    if a.get("teacherId") == teacher["teacherId"]
    and a.get("slotId") in {s["slotId"] for s in friday}
]
print(f"cascade: {teacher.get('name')} loses Friday — {len(affected)} sessions\n")

BEFORE = copy.deepcopy(store.assignments)

print("proposal:")
# `forbid` is the whole point of the tool: without it the solver is free to leave everything where
# it is, which once produced a confidently wrong "no conflict-free plan exists".
result = propose_repairs(
    store, affected, k=3, forbid=[{"teacher": teacher["teacherId"], "day": "Fr"}]
)
options = result.get("options") or []
check("the solver returned options", len(options) > 0, f"{len(options)} options")
check("the best option actually moves something",
      options and options[0]["sessionsMoved"] > 0,
      f"{options[0]['sessionsMoved']} moved" if options else "")

pid = proposals.register(options, question="Hinterberger kann freitags nicht mehr")
check("the proposal is stored under an id", proposals.get(pid) is not None, pid)

print("diff:")
d = proposals.diff(store, pid, 1)
check("the diff describes only real changes",
      all(c["from"]["slotId"] != c["to"]["slotId"] or c["from"]["roomId"] != c["to"]["roomId"]
          for c in d["changes"]),
      f"{d['sessionsMoved']} changes")
check("the diff counts the same moves as the option",
      d["sessionsMoved"] == options[0]["sessionsMoved"])
check("the diff names who is affected",
      bool(d["affects"]["teachers"]) and bool(d["affects"]["rooms"]),
      f"{len(d['affects']['teachers'])} teachers, {len(d['affects']['rooms'])} rooms")
check("every change leaves the forbidden day",
      all(not c["to"]["slotId"].startswith("Fr") for c in d["changes"]))
check("an unknown proposal is refused", proposals.diff(store, "nope", 1).get("error") == "unknown_proposal")
check("an unknown option is refused", proposals.diff(store, pid, 99).get("error") == "unknown_option")

print("confirm gate:")
# ⚠️ The point of the whole design: an unattributed apply is not an apply.
refused = proposals.apply(store, pid, 1, confirmed_by="")
check("applying without a confirmer is refused", refused.get("error") == "not_confirmed",
      refused.get("message", "")[:60])

applied = proposals.apply(store, pid, 1, confirmed_by="alkorn")
check("confirming creates a draft", applied.get("draftId", "").startswith("draft-"),
      applied.get("draftId", ""))
check("the draft records who confirmed it", applied.get("confirmedBy") == "alkorn")
check("the draft changed the expected number of sessions",
      applied["sessionsChanged"] == d["sessionsMoved"],
      f"{applied['sessionsChanged']}")

draft_id = applied["draftId"]
rows = proposals.assignments_for(store, draft_id)
moved = {c["sessionId"]: c for c in d["changes"]}
by_id = {r["sessionId"]: r for r in rows}
check("the draft holds the whole plan, not just the delta", len(rows) == len(store.assignments),
      f"{len(rows)} rows")
check("every moved session sits where the proposal said",
      all(by_id[sid]["slotId"] == c["to"]["slotId"] and by_id[sid]["roomId"] == c["to"]["roomId"]
          for sid, c in moved.items()))
check("no session moved to a Friday", all(not by_id[sid]["slotId"].startswith("Fr") for sid in moved))

print("published is untouched:")
# THE assertion. Everything above could work and still be a disaster if this fails.
check("the published plan is byte-identical after apply", store.assignments == BEFORE,
      f"{len(store.assignments)} assignments")
check("the published view still shows the original slots",
      all(store.assignment_by_session[sid]["slotId"] == c["from"]["slotId"]
          for sid, c in moved.items()))
check("published and draft genuinely differ",
      any(by_id[sid]["slotId"] != store.assignment_by_session[sid]["slotId"] for sid in moved))

print("undo:")
check("discarding a draft is a delete", proposals.discard(draft_id) is True)
check("a discarded draft falls back to published",
      proposals.assignments_for(store, draft_id) is store.assignments)

print("the agent cannot reach any of this:")
from tools import TOOL_IMPLEMENTATIONS  # noqa: E402

surface = set(TOOL_IMPLEMENTATIONS)
check("no apply tool", not any("apply" in t for t in surface))
check("no draft tool", not any("draft" in t for t in surface))
check("no proposal tool", not any("proposal" in t for t in surface))
# ⚠️ Pinned deliberately. Widening the agent's surface should be a decision someone made on
# purpose, not something that happens because a helper got imported — so adding a tool is meant to
# fail here once and be added by hand. `get_calendar` was added that way (§13.5 step 5): it reads a
# week and cannot write one.
check("the tool surface is read-only plus the solver", surface == {
    "detect_conflicts", "explain_infeasibility", "get_affected_sessions",
    "get_plan_overview", "get_calendar", "propose_repairs",
}, ", ".join(sorted(surface)))

print()
if failures:
    raise SystemExit(f"{len(failures)} confirm-gate check(s) failed: {', '.join(failures)}")
print("confirm gate ok — nothing is applied without an explicit, attributed confirmation")

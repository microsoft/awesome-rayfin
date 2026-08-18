"""The app must not name an invented lecturer against real teaching (PLAN §0).

Run: python tools/tests/test_teacher_attribution.py

⚠️ THE RULE ONLY BITES WHERE THE TWO ARE MIXED, so this test checks BOTH directions. OTH and LMU
invent the lecturer AND the lecture, so a question about one of them is a question about a coherent
fiction and must still be answered — a server that withheld everywhere would look safe and would
have broken the product. TUM's courses, rooms and hours are really TUM's and only the person at the
front is fabricated, which is the one combination that must be refused.

⚠️ Each site is probed in its own PROCESS. `SCHEDULER_SITE` is read at import time in
`schedule_store`, so all three cannot be loaded into one interpreter — an in-process version of this
test would silently check the default site three times and pass.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

PROBE = """
import json, sys
sys.path.insert(0, "server")
import schedule_store
from schedule_store import ScheduleStore
from calendar_view import calendar_view
from tools import get_affected_sessions, detect_conflicts, propose_repairs
import foundry

store = ScheduleStore.load()
surname = store.teachers[0]["name"].split()[-1]
some_session = store.assignments[0]["sessionId"]
prompt = foundry.SYSTEM_PROMPT
summary = store.summary()
print(json.dumps({
    "site": schedule_store.SITE,
    "flag": store.teacher_attribution_invented,
    "calendar_error": calendar_view(store, "teacher", surname).get("error"),
    "cascade_error": get_affected_sessions(store, surname, day="Fr").get("error"),
    # The same question expressed through the other two tools.
    "conflicts_error": detect_conflicts(
        store, unavailable=[{"teacher": surname, "day": "Fr"}]).get("error"),
    "repairs_error": propose_repairs(
        store, [some_session], k=1,
        forbid=[{"teacher": surname, "day": "Fr"}], time_limit_s=2.0).get("error"),
    # ...and the same tools with nobody named, which must keep working everywhere.
    "conflicts_plain_ok": "error" not in detect_conflicts(store),
    "room_ok": "error" not in calendar_view(store, "room", store.rooms[0]["roomId"]),
    # ⚠️ MATCH THE CLAIM, NOT THE WORD. A first version searched for "synthetisch" and failed on
    # TUM — whose note says "sage NIEMALS, dieser Stundenplan sei synthetisch". The word appears in
    # the instruction FORBIDDING the claim. What must never reach TUM is the assertion itself.
    "claims_synthetic": "Die Stundenplandaten sind synthetisch" in prompt,
    "claims_real": "ECHT" in prompt,
    "invented_attributes": summary["inventedAttributes"],
}))
"""

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok    {name}{f' — {detail}' if detail else ''}")
    else:
        failures.append(name)
        print(f"  FAIL  {name}{f' — {detail}' if detail else ''}")


def probe(site: str) -> dict:
    env = {**os.environ, "SCHEDULER_SITE": site, "PYTHONIOENCODING": "utf-8"}
    r = subprocess.run([sys.executable, "-c", PROBE], cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8", env=env)
    lines = [x for x in (r.stdout or "").splitlines() if x.startswith("{")]
    if not lines:
        raise SystemExit(f"probe for {site} produced no result:\n{r.stderr[-1500:]}")
    return json.loads(lines[-1])


print("a generated university answers questions about its own invented staff:")
for site in ("oth", "lmu"):
    d = probe(site)
    check(f"{site} does not withhold lecturers", d["flag"] is False)
    check(f"{site} answers a lecturer lookup", d["calendar_error"] is None,
          str(d["calendar_error"]))
    check(f"{site} answers the cascade", d["cascade_error"] is None, str(d["cascade_error"]))
    check(f"{site} runs a teacher-scoped conflict check", d["conflicts_error"] is None,
          str(d["conflicts_error"]))
    check(f"{site} runs a teacher-scoped repair", d["repairs_error"] is None,
          str(d["repairs_error"]))
    check(f"{site} tells the planner its plan is synthetic", d["claims_synthetic"] is True)
    # ⚠️ AND HIDES NOTHING ON THE GRID. Where the whole week is one coherent fiction the badge
    # covers it, and blanking the lecturer would throw away a working feature to solve a problem
    # this site does not have.
    check(f"{site} hides no field on the week grid", d["invented_attributes"] == [],
          str(d["invented_attributes"]))

print("\na real timetable with invented staff refuses to name them:")
tum = probe("tum")
check("tum knows its lecturers are fiction on real teaching", tum["flag"] is True)
check("the calendar refuses, and says why", tum["calendar_error"] == "teacher_not_published",
      str(tum["calendar_error"]))
# ⚠️ The cascade is the headline demo, so it is the most tempting place to let this slide.
check("the cascade refuses too", tum["cascade_error"] == "teacher_not_published",
      str(tum["cascade_error"]))
# ⚠️ AND THE TWO SIDE DOORS. Refusing only in `get_affected_sessions` left the identical question
# reachable through `detect_conflicts(unavailable=[{teacher}])` and
# `propose_repairs(forbid=[{teacher}])` — both resolve a name and act on it. A refusal that one
# tool enforces and two others ignore is not a refusal, it is a speed bump.
check("a teacher-scoped conflict check refuses",
      tum["conflicts_error"] == "teacher_not_published", str(tum["conflicts_error"]))
check("a teacher-scoped repair refuses",
      tum["repairs_error"] == "teacher_not_published", str(tum["repairs_error"]))
# ⚠️ AND IT MUST NOT OVER-REFUSE. The rooms and the hours ARE real; withholding those would throw
# away the entire reason for using this dataset.
check("a plain conflict check still runs", tum["conflicts_plain_ok"] is True)
check("rooms are still answerable — they are measured", tum["room_ok"] is True)

# ⚠️ THE ASSISTANT'S OWN PROSE IS PART OF THE CONTRACT. The system prompt carried one fixed line
# reading "Die Stundenplandaten sind synthetisch" for every site — including the one whose
# timetable is genuinely TUM's. It contradicted its own campus note two lines further down, and it
# is the provenance bug running in the direction nobody watches: disclaiming REAL data as invented.
check("tum is never told its real timetable is synthetic", tum["claims_synthetic"] is False)
check("tum is told the timetable is real", tum["claims_real"] is True)

# ⚠️ HIDING THE LECTURER SCOPE WAS NOT ENOUGH — THE NAME WAS STILL PRINTED ON THE GRID. In `room`
# scope, which is exactly what TUM now opens on, every entry read
#     "Höhere Mathematik 1 für MW/CIW [CIT513013] · 5510.EG.001 · Prof. Dr. R. Wimmer"
# — real module code, real room, invented professor, and a name ordinary enough that somebody at
# TUM may well hold it. The cohort beside it is invented too. Refusing to DISCUSS a fabricated
# person while displaying them is not a refusal.
check("tum names the fields that are fiction on a real lecture",
      sorted(tum["invented_attributes"]) == ["cohort", "teacher"],
      str(tum["invented_attributes"]))

if failures:
    print(f"\n{len(failures)} attribution check(s) failed: {', '.join(failures)}")
    raise SystemExit(1)
print("\nok — refused exactly where the lecturers are fiction on top of real teaching")

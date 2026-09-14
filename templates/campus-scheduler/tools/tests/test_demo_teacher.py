"""The app's own suggested question must lead somewhere that works (PLAN §17).

Run: python tools/tests/test_demo_teacher.py

The assistant writes its first suggestion from `summary()["exampleTeacher"]`:

    "{name} kann freitags nicht mehr. Was ist betroffen und wie planen wir um?"

That is the FIRST thing a visitor clicks, so it is the one question in the app that must not fail.
It used to be `busiest_teacher()`, on the reasoning that dropping a day is only interesting for
someone with sessions to move. That reasoning has two failure modes and the dataset has hit both:

  * the busiest lecturer holds so much of the week that freeing a day leaves the solver nowhere to
    put the overflow, and `propose_repairs` correctly answers `no_candidate`; and
  * the busiest lecturer teaches NOTHING on the day the question asks about, so the cascade is
    empty and the demo's opening move answers "nothing is affected" — which is not wrong, and is
    still a dud. LMU was in exactly this state.

⚠️ THE MIRROR MATTERS MORE THAN THE MAIN ASSERTION. A `demo_teacher()` that simply returned the
busiest name would pass "the suggestion resolves" on any site where the busiest happens to be fine.
So this also asserts that where the two names DIFFER, the busiest one really is the broken choice —
otherwise the fix is unfalsifiable.

⚠️ Each site is probed in its own PROCESS: `SCHEDULER_SITE` is read at import time in
`schedule_store`, so loading two sites into one interpreter would silently check one site twice.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

PROBE = """
import json, sys
sys.path.insert(0, "server")
import schedule_store
from schedule_store import ScheduleStore, DEMO_DAY
from tools import get_affected_sessions, propose_repairs

store = ScheduleStore.load()


def cascade(name):
    if not name:
        return {"name": name, "sessions": 0, "resolves": False, "why": "no name"}
    affected = get_affected_sessions(store, name, day=DEMO_DAY)
    if affected.get("error"):
        return {"name": name, "sessions": 0, "resolves": False, "why": affected["error"]}
    ids = [s["sessionId"] for s in affected.get("sessions", [])]
    if not ids:
        return {"name": name, "sessions": 0, "resolves": False, "why": "nothing on that day"}
    # The constraint IS the scenario. Without it the solver may put every session back where it
    # already was, so this returns "resolves" for everybody and asserts nothing. That is exactly
    # how the first version of this test passed while the shipped app answered no_candidate.
    found = store.find_teacher(name)
    forbid = [{"teacher": found["teacherId"] if found else name, "day": DEMO_DAY}]
    rep = propose_repairs(store, ids, k=1, forbid=forbid, time_limit_s=10.0)
    if rep.get("error"):
        return {"name": name, "sessions": len(ids), "resolves": False, "why": rep["error"]}
    ok = bool(rep.get("options"))
    return {"name": name, "sessions": len(ids), "resolves": ok, "why": "ok" if ok else "no options"}


print(json.dumps({
    "site": schedule_store.SITE,
    "invented": store.teacher_attribution_invented,
    "example": store.summary().get("exampleTeacher"),
    "demo": cascade(store.demo_teacher()),
    "busiest": cascade(store.busiest_teacher()),
}))
"""

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok    {name}")
    else:
        FAILURES.append(name)
        print(f"  FAIL  {name}  {detail}")


def probe(site: str) -> dict:
    env = {**dict(__import__("os").environ), "SCHEDULER_SITE": site, "PYTHONIOENCODING": "utf-8"}
    out = subprocess.run(
        [sys.executable, "-c", PROBE], cwd=ROOT, env=env,
        capture_output=True, text=True, encoding="utf-8",
    )
    if out.returncode != 0:
        raise SystemExit(f"probe for {site} failed:\n{out.stderr[-2000:]}")
    return json.loads(out.stdout.strip().splitlines()[-1])


for site in ("oth", "lmu"):
    print(f"\n{site}:")
    r = probe(site)
    demo, busiest = r["demo"], r["busiest"]
    print(f"  demo={demo['name']!r} ({demo['sessions']} sessions, {demo['why']})")
    print(f"  busiest={busiest['name']!r} ({busiest['sessions']} sessions, {busiest['why']})")

    check(f"{site}: a demo teacher is offered", bool(demo["name"]))
    check(
        f"{site}: the suggested question has something to move",
        demo["sessions"] > 0,
        f"{demo['sessions']} sessions on {site}",
    )
    check(
        f"{site}: the suggested question resolves",
        demo["resolves"],
        demo["why"],
    )
    check(
        f"{site}: summary() publishes the verified name, not the busiest",
        r["example"] == demo["name"],
        f"summary said {r['example']!r}",
    )
    # THE MIRROR: only meaningful where the pick actually moved.
    if demo["name"] != busiest["name"]:
        check(
            f"{site}: the busiest name really was the broken one",
            not busiest["resolves"],
            "busiest resolves too — then the pick moved for no reason",
        )
    else:
        print(f"  note  {site}: busiest was already repairable, so the pick correctly kept it")

print()
if FAILURES:
    raise SystemExit(f"{len(FAILURES)} failed: {', '.join(FAILURES)}")
print("ok — the app's first suggested question leads to a cascade that resolves")

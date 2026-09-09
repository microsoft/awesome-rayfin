"""End-to-end over HTTP: propose → preview → confirm → draft, published untouched.

The unit tests call the functions directly. This drives the same flow through the actual endpoints,
because the guarantee that matters is about the SERVICE, not about a module.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

import app as a  # noqa: E402
import proposals  # noqa: E402
from tools import propose_repairs  # noqa: E402

c = TestClient(a.app)
store = a.store
failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok    {name}{f' — {detail}' if detail else ''}")
    else:
        failures.append(name)
        print(f"  FAIL  {name}{f' — {detail}' if detail else ''}")


teacher = store.find_teacher("Hinterberger") or store.teachers[0]
friday = {s["slotId"] for s in store.slots if s["day"] == "Fr"}
affected = [
    x["sessionId"] for x in store.assignments
    if x.get("teacherId") == teacher["teacherId"] and x.get("slotId") in friday
]

# The published week, captured through the API before anything happens.
before = c.get("/api/calendar", params={"scope": "teacher", "key": teacher["teacherId"]}).json()
before_slots = {e["sessionId"]: e["slotId"] for e in before["entries"]}

result = propose_repairs(store, affected, k=3,
                         forbid=[{"teacher": teacher["teacherId"], "day": "Fr"}])
pid = proposals.register(result["options"], question="test")

print("preview over HTTP:")
d = c.get(f"/api/proposal/{pid}", params={"option": 1}).json()
check("the diff is served", d.get("sessionsMoved", 0) > 0, f"{d.get('sessionsMoved')} moves")
check("it names the affected teacher", teacher["teacherId"] in d["affects"]["teachers"])
check("previewing writes nothing",
      c.get("/api/calendar", params={"scope": "teacher", "key": teacher["teacherId"]}).json()[
          "entries"] == before["entries"])

print("the gate:")
r = c.post("/api/draft/apply", json={"proposalId": pid, "option": 1})
check("apply without confirmedBy is a 400", r.status_code == 400, str(r.status_code))
r = c.post("/api/draft/apply", json={"confirmedBy": "alkorn"})
check("apply without a proposalId is a 400", r.status_code == 400, str(r.status_code))

r = c.post("/api/draft/apply", json={"proposalId": pid, "option": 1, "confirmedBy": "alkorn"})
applied = r.json()
check("a confirmed apply succeeds", r.status_code == 200 and applied.get("draftId"),
      applied.get("draftId", ""))
draft_id = applied["draftId"]

print("after confirming:")
after_pub = c.get("/api/calendar", params={"scope": "teacher", "key": teacher["teacherId"]}).json()
check("the PUBLISHED week is unchanged",
      {e["sessionId"]: e["slotId"] for e in after_pub["entries"]} == before_slots,
      f"{len(before_slots)} sessions")

after_draft = c.get("/api/calendar", params={
    "scope": "teacher", "key": teacher["teacherId"], "draftId": draft_id}).json()
draft_slots = {e["sessionId"]: e["slotId"] for e in after_draft["entries"]}
check("the DRAFT week differs", draft_slots != before_slots)
check("the draft is labelled as such", after_draft.get("draftId") == draft_id)
check("no session remains on the forbidden day",
      not any(sid in draft_slots and draft_slots[sid].startswith("Fr")
              for sid in [ch["sessionId"] for ch in d["changes"]]))
check("the draft moved exactly what the preview promised",
      sum(1 for sid, slot in draft_slots.items()
          if before_slots.get(sid) and before_slots[sid] != slot) == d["sessionsMoved"])

print("drafts and undo:")
listed = c.get("/api/drafts").json()
check("the draft is listed", any(x["draftId"] == draft_id for x in listed["drafts"]))
check("discarding it works", c.delete(f"/api/draft/{draft_id}").json()["discarded"] is True)
check("after undo the draft view falls back to published",
      {e["sessionId"]: e["slotId"] for e in c.get("/api/calendar", params={
          "scope": "teacher", "key": teacher["teacherId"], "draftId": draft_id}).json()["entries"]
       } == before_slots)

print("the agent's surface:")
tools = c.get("/api/health").json()["tools"]
check("no write tool is exposed to the model",
      not any(k in t for t in tools for k in ("apply", "draft", "proposal", "confirm")),
      ", ".join(tools))

print()
if failures:
    raise SystemExit(f"{len(failures)} check(s) failed: {', '.join(failures)}")
print("propose → preview → confirm → draft works, and published never moved")

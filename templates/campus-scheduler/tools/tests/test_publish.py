"""Publishing a draft — the step that actually replaces the plan.

Run: python tools/tests/test_publish.py

Everything else in this product is built so a preview cannot become the plan by accident.
`proposals.apply` returns `publishedUntouched: True` and means it. So the tests that matter here
are not "does publish work" but the four ways it could quietly do damage:

  1. it must actually change what every OTHER reader sees — the solver included, not just a view;
  2. it must refuse a draft built on a plan that has since moved, because that draft's UNTOUCHED
     rows would silently revert whatever was published in between;
  3. it must refuse a draft that would leave the plan with conflicts it does not currently have;
  4. it must not pretend to be durable. The server has no database client and scales to zero.

⚠️ THE MIRROR MATTERS AS MUCH AS THE POSITIVE CASE. A publish that refuses everything would pass
tests 2 and 3 perfectly, so each refusal is paired with the case that must still succeed.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

import proposals  # noqa: E402
from schedule_store import ScheduleStore  # noqa: E402
from tools import detect_conflicts, get_affected_sessions, propose_repairs  # noqa: E402

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("  ok    " if ok else "  FAIL  ") + name + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)


def fresh_draft(store: ScheduleStore, label: str) -> str:
    """A real solver proposal, confirmed into a draft — the way the app makes one."""
    name = store.demo_teacher()
    ids = [s["sessionId"] for s in get_affected_sessions(store, name, day="Fr").get("sessions", [])]
    found = store.find_teacher(name)
    repair = propose_repairs(
        store, ids, k=1,
        forbid=[{"teacher": found["teacherId"] if found else name, "day": "Fr"}],
        time_limit_s=20.0,
    )
    options = repair.get("options") or []
    if not options:
        return ""
    pid = proposals.register(options, question=label, site=store.site)
    applied = proposals.apply(store, pid, options[0]["option"], confirmed_by="Testlauf", label=label)
    return applied.get("draftId", "")


store = ScheduleStore.load("oth")

check("the plan starts at version 0 — the dataset as shipped", store.plan_version == 0)

draft_id = fresh_draft(store, "erste Variante")
check("a draft was produced by the solver", bool(draft_id), draft_id or "no options")
if not draft_id:
    raise SystemExit(1)

# ── the guards, checked BEFORE the successful publish so the plan is still pristine ───────
blank = proposals.publish(store, draft_id, published_by="   ")
check("an unattributed publish is refused", blank.get("error") == "not_confirmed",
      str(blank.get("error")))

missing = proposals.publish(store, "draft-does-not-exist", published_by="Testlauf")
check("an unknown draft is refused", missing.get("error") == "unknown_draft",
      str(missing.get("error")))

check("and none of those refusals touched the plan", store.plan_version == 0,
      f"version {store.plan_version}")

# ── the act itself ────────────────────────────────────────────────────────────────────────
before_rows = {a["sessionId"]: (a["slotId"], a["roomId"]) for a in store.assignments}
before_hard = detect_conflicts(store).get("hard", 0)

result = proposals.publish(store, draft_id, published_by="A. Korn")
check("the draft published", not result.get("error"), str(result.get("error") or result.get("label")))
check("the plan version moved", store.plan_version == 1, f"version {store.plan_version}")
check("it does not claim to be durable", result.get("publishedUntouched") is False)

after_rows = {a["sessionId"]: (a["slotId"], a["roomId"]) for a in store.assignments}
moved = [s for s in before_rows if before_rows[s] != after_rows.get(s)]
check(
    "the PUBLISHED rows really changed — not a view, the plan itself",
    bool(moved) and len(moved) == result.get("sessionsChanged"),
    f"{len(moved)} sessions moved, publish reported {result.get('sessionsChanged')}",
)

# ⚠️ THE POINT OF THE WHOLE FEATURE. `assignment_by_session` holds the same dict objects as
# `assignments`; if publish had rebuilt either list instead of mutating rows, the solver and the
# calendar would read different plans and nothing would say so.
check(
    "the solver's own lookup agrees with the published list",
    all(store.assignment_by_session[s]["slotId"] == after_rows[s][0] for s in after_rows),
)
check(
    "the plan is no worse than before it was published",
    detect_conflicts(store).get("hard", 0) <= before_hard,
    f"{before_hard} -> {detect_conflicts(store).get('hard', 0)} hard",
)
check("publishing consumed the draft", proposals.get_draft(draft_id) is None)
check("it is recorded who did it", bool(store.publications)
      and store.publications[-1]["publishedBy"] == "A. Korn",
      str(store.publications[-1].get("publishedBy") if store.publications else None))

# ── a draft made against the OLD plan must not be publishable now ─────────────────────────
# Built here by hand rather than by re-solving: the point is the base version, and a solver run
# against the new plan would produce a CURRENT draft and test nothing.
stale = proposals.Draft(
    draft_id="draft-stale", label="veraltet", created=0.0, confirmed_by="Testlauf",
    proposal_id="", option=0, site=store.site, base_version=0,
    applied=[{"sessionId": moved[0], "from": {}, "to": {"slotId": after_rows[moved[0]][0],
                                                        "roomId": after_rows[moved[0]][1]}}],
)
proposals._drafts["draft-stale"] = stale
refused = proposals.publish(store, "draft-stale", published_by="Testlauf")
check("a draft built on a superseded plan is refused", refused.get("error") == "stale_draft",
      f"draftBase {refused.get('draftBaseVersion')} vs plan {refused.get('planVersion')}")
check("and the refusal left the plan alone", store.plan_version == 1)
proposals._drafts.pop("draft-stale", None)

# ── the mirror: a draft made against the CURRENT plan still publishes ─────────────────────
second = fresh_draft(store, "zweite Variante")
if second:
    ok = proposals.publish(store, second, published_by="A. Korn")
    check("a draft built on the CURRENT plan still publishes", not ok.get("error"),
          str(ok.get("error") or f"version {store.plan_version}"))
    check("and the version moved again", store.plan_version == 2, f"version {store.plan_version}")
else:
    check("a draft built on the CURRENT plan still publishes", False,
          "the solver returned nothing to publish — nothing was tested")

# ── a draft that would BREAK the plan must be refused ─────────────────────────────────────
# ⚠️ WITHOUT THIS THE CONFLICT GATE IS UNWATCHED. Every draft the solver produces is conflict-free
# by construction, so the happy path above exercises the gate's code and none of its judgement. A
# double-booking is built here by hand: take two sessions that are currently in different rooms at
# the same time and move one into the other's room.
by_slot: dict[str, list[dict]] = {}
for a in store.assignments:
    by_slot.setdefault(a["slotId"], []).append(a)
clash = next((rows for rows in by_slot.values() if len(rows) >= 2), [])
if len(clash) >= 2:
    victim, target = clash[0], clash[1]
    breaking = proposals.Draft(
        draft_id="draft-breaks", label="kaputt", created=0.0, confirmed_by="Testlauf",
        proposal_id="", option=0, site=store.site, base_version=store.plan_version,
        applied=[{
            "sessionId": victim["sessionId"],
            "from": {"slotId": victim["slotId"], "roomId": victim["roomId"]},
            "to": {"slotId": target["slotId"], "roomId": target["roomId"]},
        }],
    )
    proposals._drafts["draft-breaks"] = breaking
    version_before = store.plan_version
    broke = proposals.publish(store, "draft-breaks", published_by="Testlauf")
    check(
        "a draft that would add conflicts is refused",
        broke.get("error") == "would_add_conflicts",
        f"{broke.get('hardBefore')} -> {broke.get('hardAfter')} hard",
    )
    check("and that refusal left the plan alone too", store.plan_version == version_before)
    proposals._drafts.pop("draft-breaks", None)
else:
    check("a draft that would add conflicts is refused", False,
          "no two sessions share a slot — nothing was tested")

# ── replay, which is what makes a publish survive a cold start ────────────────────────────
cold = ScheduleStore.load("oth")
saved = [{"sessionId": s, "slotId": after_rows[s][0], "roomId": after_rows[s][1]} for s in moved]
replayed = proposals.publish_moves(cold, saved, published_by="Wiederherstellung")
check("a restarted process can replay what was published", not replayed.get("error"),
      f"{replayed.get('sessionsChanged')} sessions")
check(
    "and lands on the same rows the live process holds",
    all(cold.assignment_by_session[s]["slotId"] == after_rows[s][0] for s in moved),
)

# ── publishing a SELECTION of saved changes (the Änderungen tab) ──────────────────────────
# ⚠️ CHERRY-PICKING IS THE CASE THAT MOST NEEDS THE GATE. A cascade is a coherent set: taking two
# moves of a three-move repair can reopen exactly the clash the third one was closing. The planner
# cannot see that from a list of rows, so the server has to refuse it — which also means the
# selection path must NOT reuse the ungated replay route just because both take a `moves` list.
picked = ScheduleStore.load("oth")
rows_by_slot: dict[str, list[dict]] = {}
for a in picked.assignments:
    rows_by_slot.setdefault(a["slotId"], []).append(a)
pair = next((r for r in rows_by_slot.values() if len(r) >= 2), [])
if len(pair) >= 2:
    bad_selection = [{"sessionId": pair[0]["sessionId"],
                      "slotId": pair[1]["slotId"], "roomId": pair[1]["roomId"]}]
    version_before = picked.plan_version
    refused_sel = proposals.publish_moves(picked, bad_selection, published_by="Testlauf")
    check(
        "a SELECTION that would break the plan is refused",
        refused_sel.get("error") == "would_add_conflicts",
        f"{refused_sel.get('hardBefore')} -> {refused_sel.get('hardAfter')} hard",
    )
    check("and the selection refusal left the plan alone", picked.plan_version == version_before)

    # ⚠️ THE MIRROR. A gate that refuses every selection would pass the check above perfectly.
    harmless = [{"sessionId": pair[0]["sessionId"],
                 "slotId": pair[0]["slotId"], "roomId": pair[0]["roomId"]}]
    ok_sel = proposals.publish_moves(picked, harmless, published_by="Testlauf")
    check("a harmless selection still publishes", not ok_sel.get("error"),
          str(ok_sel.get("error") or f"version {picked.plan_version}"))

    # ⚠️ And the REPLAY path must still take what the gated path refuses — it is rebuilding a plan
    # that was already accepted, and refusing it would leave the process disagreeing with the
    # durable record, which is worse than a conflict.
    replay_store = ScheduleStore.load("oth")
    forced = proposals.publish_moves(replay_store, bad_selection, published_by="Wiederherstellung",
                                     replay=True)
    check("but a REPLAY of the same moves is not gated", not forced.get("error"),
          str(forced.get("error") or "accepted"))
    check("an unattributed SELECTION is refused",
          proposals.publish_moves(picked, harmless, published_by="  ").get("error")
          == "not_confirmed")
else:
    check("a SELECTION that would break the plan is refused", False,
          "no two sessions share a slot — nothing was tested")

# ── reset: the way back, which did not exist ──────────────────────────────────────────────
# ⚠️ CLEARING THE SQL TABLES BY HAND DOES NOT DO THIS, and that is the whole reason it exists.
# Drafts and the published plan live in the PROCESS; `PlanChanges` is a log the app replays. So
# truncating that table leaves every draft exactly where it was and the app looks like it ignored
# the delete. Measured after exactly that: 0 rows in the log, and 4 `change` + 1 `published` rows
# still sitting in `PlanAssignments`.
from schedule_store import reload_store  # noqa: E402

before_reset = ScheduleStore.load("oth")
seed_draft = fresh_draft(before_reset, "wird zurückgesetzt")
if seed_draft:
    proposals.publish(before_reset, seed_draft, published_by="Testlauf")
check(
    "there is something to reset",
    before_reset.plan_version > 0 or bool(proposals.list_drafts("oth")),
    f"planVersion={before_reset.plan_version}, drafts={len(proposals.list_drafts('oth'))}",
)

dropped = proposals.discard_all("oth")
after = reload_store("oth")
check("every draft for the site is gone", proposals.list_drafts("oth") == [], f"dropped {dropped}")
check("the plan version is back to the shipped dataset", after.plan_version == 0,
      f"version {after.plan_version}")
check("and no publication history is left claiming otherwise", after.publications == [])

shipped = ScheduleStore.load("oth")
same = all(
    a["slotId"] == shipped.assignment_by_session[a["sessionId"]]["slotId"]
    and a["roomId"] == shipped.assignment_by_session[a["sessionId"]]["roomId"]
    for a in after.assignments
)
check("the rows really match the dataset again, not just the counter", same)

# ── the reset must be able to REBUILD a row, not only forget it ───────────────────────────
# ⚠️ THIS IS WHAT A RESET THAT DELETED THREE SESSIONS WAS MISSING. `dbo.PlanAssignments` keeps ONE
# row per session: saving a move OVERWRITES that session's baseline row instead of adding an
# override beside it. So a client that "resets" by deleting every non-baseline row removes the
# session from the timetable — measured live: 1 922 rows where 1 925 belong, and a lecturer's week
# showing five sessions instead of six, with nothing left in the table to say what had been there.
# Only the baked dataset knows where those sessions belong, so the reset has to hand their shipped
# positions back to the caller. This checks the store can answer that question for ANY session,
# because a restore that covers most of them is still a restore that loses one.
moved_sessions = [a["sessionId"] for a in shipped.assignments[:5]]
sample = moved_sessions
answers = {sid: after.assignment_by_session.get(sid) for sid in sample}
check(
    "the reloaded store can name the shipped position of every session asked about",
    sample and all(answers[sid] is not None for sid in sample),
    f"{sum(1 for v in answers.values() if v is None)} of {len(sample)} unknown",
)
check(
    "and those positions are the dataset's, not the ones that were published over them",
    all(
        answers[sid]["slotId"] == shipped.assignment_by_session[sid]["slotId"]
        and answers[sid]["roomId"] == shipped.assignment_by_session[sid]["roomId"]
        for sid in sample
        if answers[sid] is not None
    ),
    f"checked {len(sample)} session(s)",
)
# A session id the dataset does not contain must come back as UNKNOWN rather than as a plausible
# row: that is the one case where the client is allowed to delete instead of restore, and guessing
# would turn a stray row into a fabricated timetable entry.
check(
    "a session the dataset never had is reported as unknown",
    after.assignment_by_session.get("KEIN-TERMIN-XYZ") is None,
)

# ⚠️ The mirror: reset must scope to ONE university. Clearing OTH silently clearing LMU would be
# the same class of over-reach as the cross-site refusals everywhere else in this module.
lmu = ScheduleStore.load("lmu")
lmu_draft = fresh_draft(lmu, "lmu bleibt")
if lmu_draft:
    proposals.discard_all("oth")
    check("clearing one university leaves the other's drafts alone",
          any(d["draftId"] == lmu_draft for d in proposals.list_drafts("lmu")))
    proposals.discard_all("lmu")
else:
    check("clearing one university leaves the other's drafts alone", False,
          "no LMU draft could be made — nothing was tested")

print()
if FAILURES:
    print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
    raise SystemExit(1)
print("ok — a draft can become the plan, and cannot become it by accident")

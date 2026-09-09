"""Proposals and drafts — PLAN §13.2 and §13.5 steps 2 and 4.

Two rules shape this module, and both exist because of things that have already gone wrong here:

⚠️ **A proposal is IMMUTABLE and is applied verbatim.** The moves a planner confirmed are the moves
that get written — never a fresh solve. `propose_repairs` returns several equal-cost optima (three
at cost 42 for the demo cascade), so re-solving on confirm is genuinely allowed to return a
different answer than the one on screen. Storing what was shown is the only way "apply" can mean
"apply THAT".

⚠️ **Nothing here is reachable by the agent.** These functions are called from HTTP handlers, and
`TOOL_SCHEMAS` does not mention them. The guarantee that a plan cannot change itself is structural,
not a sentence in a system prompt — a prompt is one bad generation away from being wrong, and this
project already has a case of the model confidently narrating something the tools did not do.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from schedule_store import ScheduleStore

# A demo does not need durability, and pretending otherwise would invite someone to trust a draft
# across a container restart that scales to zero. Proposals are short-lived by design.
PROPOSAL_TTL_S = 60 * 60
PUBLISHED = "published"


@dataclass
class Proposal:
    proposal_id: str
    created: float
    question: str | None
    options: list[dict[str, Any]]
    #: Which university this was solved for. See the note on `_proposals` below.
    site: str = ""

    def option(self, index: int) -> dict[str, Any] | None:
        for opt in self.options:
            if opt.get("option") == index:
                return opt
        return None


@dataclass
class Draft:
    draft_id: str
    label: str
    created: float
    confirmed_by: str
    proposal_id: str
    option: int
    #: Which university this draft belongs to.
    site: str = ""
    #: The published plan this draft was built ON TOP OF. A draft is a copy of the plan as it was
    #: at that moment, so once the plan moves underneath it the untouched rows stop meaning what
    #: the planner saw. `publish` refuses a draft whose base is not the current version.
    base_version: int = 0
    # sessionId → the assignment as it stands in THIS draft.
    assignments: dict[str, dict] = field(default_factory=dict)
    applied: list[dict] = field(default_factory=list)


# ⚠️ PROCESS-WIDE, AND THEREFORE SHARED BY EVERY UNIVERSITY THE CONTAINER SERVES (PLAN §21.1).
# While one container served one university this was the same thing as per-university state. It is
# not any more: without the `site` stamp, `/api/drafts` would hand OTH's planner a list of LMU's
# drafts, and a draft id from one university would resolve against another's plan. Every read is
# therefore filtered by site, and every lookup that crosses a site boundary is refused rather than
# served — the same rule `site-guard.spec.ts` enforces at the other end of the wire.
_proposals: dict[str, Proposal] = {}
_drafts: dict[str, Draft] = {}


def _expire() -> None:
    cutoff = time.time() - PROPOSAL_TTL_S
    for key in [k for k, v in _proposals.items() if v.created < cutoff]:
        _proposals.pop(key, None)


def register(options: list[dict[str, Any]], question: str | None = None, site: str = "") -> str:
    """Remember exactly what the solver offered, so it can be applied later unchanged."""
    _expire()
    proposal_id = uuid.uuid4().hex[:12]
    _proposals[proposal_id] = Proposal(
        proposal_id=proposal_id,
        created=time.time(),
        question=question,
        options=options,
        site=site,
    )
    return proposal_id


def summarise(options: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The headline per option — enough to choose one without downloading every move."""
    return [
        {
            "option": o.get("option"),
            "sessionsMoved": o.get("sessionsMoved"),
            "cost": o.get("cost"),
            "optimalityProven": o.get("optimalityProven"),
        }
        for o in options
    ]


def get(proposal_id: str) -> Proposal | None:
    _expire()
    return _proposals.get(proposal_id)


def diff(store: ScheduleStore, proposal_id: str, option: int = 1) -> dict[str, Any]:
    """What a confirmation would change, expressed the way the calendar draws it.

    Only `changed` moves are returned as changes. `propose_repairs` includes untouched sessions in
    its `moves` list — they are part of the solve — and showing them as changes would make a
    five-session repair look like a fifteen-session upheaval.
    """
    proposal = get(proposal_id)
    if not proposal:
        return {"error": "unknown_proposal", "proposalId": proposal_id}
    chosen = proposal.option(option)
    if not chosen:
        return {"error": "unknown_option", "proposalId": proposal_id, "option": option,
                "available": [o.get("option") for o in proposal.options]}

    changes = []
    for move in chosen.get("moves", []):
        if not move.get("changed"):
            continue
        session = store.session_by_id.get(move["sessionId"], {})
        frm = move.get("from") or {}
        to = move.get("to") or {}
        from_room = store.room_by_id.get(frm.get("roomId") or "", {})
        to_room = store.room_by_id.get(to.get("roomId") or "", {})
        assignment = store.assignment_by_session.get(move["sessionId"], {})
        changes.append({
            "sessionId": move["sessionId"],
            "course": move.get("course"),
            "teacherId": assignment.get("teacherId"),
            "cohortId": assignment.get("cohortId"),
            "attendance": session.get("expectedAttendance"),
            "from": {
                "slotId": frm.get("slotId"),
                "roomId": frm.get("roomId"),
                "buildingId": from_room.get("buildingId"),
                "campusId": from_room.get("campusId"),
            },
            "to": {
                "slotId": to.get("slotId"),
                "roomId": to.get("roomId"),
                "buildingId": to.get("buildingId") or to_room.get("buildingId"),
                "campusId": to.get("campusId") or to_room.get("campusId"),
            },
            # Named separately because they are the two changes a human judges differently: a new
            # time disrupts a week, a new campus disrupts a day.
            "slotChanged": frm.get("slotId") != to.get("slotId"),
            "roomChanged": frm.get("roomId") != to.get("roomId"),
            "campusChanged": (
                from_room.get("campusId") is not None
                and (to.get("campusId") or to_room.get("campusId")) != from_room.get("campusId")
            ),
        })

    return {
        "proposalId": proposal_id,
        "option": option,
        "options": summarise(proposal.options),
        "cost": chosen.get("cost"),
        "optimalityProven": chosen.get("optimalityProven"),
        "sessionsMoved": len(changes),
        "changes": changes,
        # The people and rooms whose weeks are affected, so the calendar can offer to open one of
        # them rather than making the planner guess which view shows the change.
        "affects": {
            "teachers": sorted({c["teacherId"] for c in changes if c["teacherId"]}),
            "cohorts": sorted({c["cohortId"] for c in changes if c["cohortId"]}),
            "rooms": sorted(
                {c["from"]["roomId"] for c in changes if c["from"]["roomId"]}
                | {c["to"]["roomId"] for c in changes if c["to"]["roomId"]}
            ),
        },
    }


def apply(
    store: ScheduleStore,
    proposal_id: str,
    option: int,
    confirmed_by: str,
    label: str | None = None,
) -> dict[str, Any]:
    """Write a proposal into a NEW draft. The published plan is never touched.

    `confirmed_by` is required by the caller, not defaulted here: a confirmation that a machine can
    supply for you is not a confirmation.
    """
    proposal = get(proposal_id)
    if not proposal:
        return {"error": "unknown_proposal", "proposalId": proposal_id}
    # ⚠️ A PROPOSAL FROM ANOTHER UNIVERSITY IS NOT "UNKNOWN OPTION", IT IS A REFUSAL. Applying it
    # would write one university's moves onto another's plan, against session ids that mostly do
    # not exist there — a partially applied draft rather than an error.
    if proposal.site and store.site and proposal.site != store.site:
        return {
            "error": "wrong_site",
            "proposalId": proposal_id,
            "proposalSite": proposal.site,
            "site": store.site,
        }
    chosen = proposal.option(option)
    if not chosen:
        return {"error": "unknown_option", "proposalId": proposal_id, "option": option}
    if not (confirmed_by or "").strip():
        return {"error": "not_confirmed",
                "message": "confirmedBy is required — an unattributed change is not a confirmation"}

    draft_id = f"draft-{uuid.uuid4().hex[:8]}"
    draft = Draft(
        draft_id=draft_id,
        label=label or f"Variante aus Vorschlag {option}",
        created=time.time(),
        confirmed_by=confirmed_by.strip(),
        proposal_id=proposal_id,
        option=option,
        site=store.site,
        base_version=store.plan_version,
    )

    # Start from the published plan, then overlay only what changed. Copying every row keeps the
    # draft self-contained, which is what makes "undo" a delete rather than a reverse-patch.
    for assignment in store.assignments:
        draft.assignments[assignment["sessionId"]] = dict(assignment)

    for move in chosen.get("moves", []):
        if not move.get("changed"):
            continue
        row = draft.assignments.get(move["sessionId"])
        if not row:
            continue
        to = move.get("to") or {}
        row["draftId"] = draft_id
        row["slotId"] = to.get("slotId")
        row["roomId"] = to.get("roomId")
        row["buildingId"] = to.get("buildingId") or row.get("buildingId")
        row["campusId"] = to.get("campusId") or row.get("campusId")
        draft.applied.append({
            "sessionId": move["sessionId"],
            "from": move.get("from"),
            "to": {"slotId": to.get("slotId"), "roomId": to.get("roomId")},
        })

    _drafts[draft_id] = draft
    return {
        "draftId": draft_id,
        "label": draft.label,
        "confirmedBy": draft.confirmed_by,
        "proposalId": proposal_id,
        "option": option,
        "sessionsChanged": len(draft.applied),
        "applied": draft.applied,
        "publishedUntouched": True,
    }


def get_draft(draft_id: str) -> Draft | None:
    return _drafts.get(draft_id)


def restore(
    store: ScheduleStore,
    moves: list[dict[str, Any]],
    restored_by: str,
    label: str | None = None,
) -> dict[str, Any]:
    """Rebuild a draft from moves that were COMMITTED earlier, and kept somewhere durable.

    ⚠️ THIS EXISTS BECAUSE `apply` CANNOT DO IT. `apply` takes a proposal id, and proposals live in
    the same module-level dict as drafts — so the moment the container scales to zero, the record
    of what the solver offered is gone along with the draft it produced. Replaying a saved decision
    through `apply` would therefore fail on exactly the occasion replay is needed for.

    ⚠️ WHAT IS STORED IS THE DECISION, NOT THE PLAN, AND THAT IS DELIBERATE. The published plan is
    rebuilt from the dataset baked into this image, so it is already reproducible; copying its ~980
    assignment rows into SQL would persist something derivable and create a second source of truth
    to keep in step. The current plan is therefore BASELINE + REPLAY, and this is the replay half.

    ⚠️ MOVES ARE APPLIED IN THE ORDER GIVEN, LAST WRITE WINS. The caller orders them by the time
    they were saved; a session moved twice must end where it was put last, and a set would lose
    that. Unknown sessions are REPORTED rather than skipped quietly — a saved change that no longer
    matches the dataset means the two have diverged, which is a thing to say out loud rather than
    absorb.
    """
    draft_id = f"draft-{uuid.uuid4().hex[:8]}"
    draft = Draft(
        draft_id=draft_id,
        label=label or "Gespeicherter Stand",
        created=time.time(),
        confirmed_by=(restored_by or "").strip() or "unbekannt",
        # No proposal produced this. Naming that plainly beats inventing an id that resolves to
        # nothing, which is how a "restored" draft would come to look like a solver result.
        proposal_id="",
        option=0,
        site=store.site,
        base_version=store.plan_version,
    )

    for assignment in store.assignments:
        draft.assignments[assignment["sessionId"]] = dict(assignment)

    unknown: list[str] = []
    for move in moves:
        session_id = (move.get("sessionId") or "").strip()
        row = draft.assignments.get(session_id)
        if not row:
            unknown.append(session_id)
            continue
        before = {"slotId": row.get("slotId"), "roomId": row.get("roomId")}
        row["draftId"] = draft_id
        row["slotId"] = move.get("slotId") or row.get("slotId")
        row["roomId"] = move.get("roomId") or row.get("roomId")
        draft.applied.append(
            {
                "sessionId": session_id,
                "from": before,
                "to": {"slotId": row["slotId"], "roomId": row["roomId"]},
            }
        )

    _drafts[draft_id] = draft
    return {
        "draftId": draft_id,
        "label": draft.label,
        "confirmedBy": draft.confirmed_by,
        "sessionsChanged": len(draft.applied),
        "applied": draft.applied,
        "unknownSessions": unknown,
        "publishedUntouched": True,
    }


def list_drafts(site: str | None = None) -> list[dict[str, Any]]:
    """Drafts for ONE university, or every one when the caller does not scope it.

    ⚠️ `site=None` is the unscoped legacy behaviour and is only correct for a single-university
    process. The HTTP layer always passes a site.
    """
    return [
        {
            "draftId": d.draft_id,
            "label": d.label,
            "confirmedBy": d.confirmed_by,
            "sessionsChanged": len(d.applied),
            "created": d.created,
            "baseVersion": d.base_version,
        }
        for d in sorted(_drafts.values(), key=lambda x: -x.created)
        if site is None or d.site == site
    ]


def discard(draft_id: str) -> bool:
    """Undo is a delete. That is the whole benefit of copying the plan rather than patching it."""
    return _drafts.pop(draft_id, None) is not None


def discard_all(site: str) -> int:
    """Drop every draft for one university, and the proposals behind them.

    ⚠️ DRAFTS ARE IN THIS PROCESS, NOT IN SQL, WHICH IS THE THING THAT SURPRISES PEOPLE. Somebody
    clearing the plan tables by hand finds the app still listing drafts afterwards and reasonably
    concludes the delete failed. It did not — it never reached them. This is the only thing that
    does, and it is scoped by site so clearing OTH does not silently clear LMU.

    Proposals go too: a proposal whose draft is gone can still be applied by id, which would put
    back a variant somebody had just cleared.
    """
    doomed = [k for k, v in _drafts.items() if not site or v.site == site]
    for k in doomed:
        _drafts.pop(k, None)
    for k in [k for k, v in _proposals.items() if not site or v.site == site]:
        _proposals.pop(k, None)
    return len(doomed)


def publish(store: ScheduleStore, draft_id: str, published_by: str) -> dict[str, Any]:
    """Promote a draft to BE the published plan — the step this product did not have.

    Everything else here is built so a preview cannot become the plan by accident, which is why
    promoting one is a separate verb with its own guards rather than a flag on `apply`.

    ⚠️ A DRAFT IS AN OVERLAY ON THE PLAN AS IT WAS WHEN THE DRAFT WAS MADE. If anything has been
    published since, the rows underneath it have moved and the draft's untouched sessions no longer
    say what the planner saw. Publishing it would silently revert that other change, so a draft
    built against an older `plan_version` is REFUSED rather than rebased — rebasing is a guess
    about intent, and this is the one operation where being wrong is not previewable.

    ⚠️ THE MOVES ARE RE-CHECKED AGAINST THE PLAN AS IT IS NOW, NOT AS IT WAS. `detect_conflicts`
    is the same judge the calendar and the assistant use, so a publish cannot introduce a conflict
    that the app would then report in the plan it just accepted. It is allowed to publish a plan
    that is no BETTER than the current one; it is not allowed to make it worse.
    """
    draft = _drafts.get(draft_id)
    if not draft:
        return {"error": "unknown_draft", "draftId": draft_id}
    if draft.site and store.site and draft.site != store.site:
        return {"error": "wrong_site", "draftId": draft_id,
                "draftSite": draft.site, "site": store.site}
    if not (published_by or "").strip():
        return {"error": "not_confirmed",
                "message": "publishedBy is required — an unattributed publish is not a publish"}
    if draft.base_version != store.plan_version:
        return {
            "error": "stale_draft",
            "draftId": draft_id,
            "draftBaseVersion": draft.base_version,
            "planVersion": store.plan_version,
            "message": "the plan has been published since this draft was made; re-run the repair",
        }
    if not draft.applied:
        return {"error": "nothing_to_publish", "draftId": draft_id}

    # Imported here rather than at module scope: `tools` is the solver and pulls in OR-Tools, and
    # this module is imported by the HTTP layer on every request path including the ones that
    # never publish anything.
    from tools import detect_conflicts

    moves = [
        {"sessionId": m["sessionId"],
         "slotId": (m.get("to") or {}).get("slotId"),
         "roomId": (m.get("to") or {}).get("roomId")}
        for m in draft.applied
    ]
    before = detect_conflicts(store).get("hard", 0)
    after = detect_conflicts(store, moves=moves).get("hard", 0)
    if after > before:
        return {
            "error": "would_add_conflicts",
            "draftId": draft_id,
            "hardBefore": before,
            "hardAfter": after,
            "message": "publishing this draft would leave the plan with conflicts it does not have",
        }

    result = store.publish(moves, published_by.strip(), label=draft.label)

    # ⚠️ EVERY OTHER DRAFT IS NOW AN OVERLAY ON A PLAN THAT NO LONGER EXISTS. Keeping them would
    # leave the planner a list of variants that quietly disagree with the plan underneath them,
    # and `stale_draft` would refuse each one at the moment they tried to use it — after they had
    # chosen. Dropping them here says it once, immediately.
    superseded = [d for d in _drafts if d != draft_id]
    for other in superseded:
        _drafts.pop(other, None)
    _drafts.pop(draft_id, None)

    return {
        **result,
        "draftId": draft_id,
        "planVersion": store.plan_version,
        "hardConflicts": after,
        "draftsSuperseded": len(superseded),
        # ⚠️ The counterpart to `publishedUntouched` on `apply`. Both are stated so a caller never
        # has to infer which of the two operations it just performed.
        "publishedUntouched": False,
    }


def publish_moves(store: ScheduleStore, moves: list[dict[str, Any]],
                  published_by: str, label: str | None = None,
                  replay: bool = False) -> dict[str, Any]:
    """Publish a set of moves that did not come from a live draft.

    Two callers, and the difference between them is the whole reason for the `replay` flag:

    **A planner picking individual saved changes** (`replay=False`). The Änderungen list shows what
    was saved to the plan store, and a planner may want three of those five in the plan of record
    and not the other two. That is a NEW decision about what the plan should be, so it is gated
    exactly like publishing a draft: attributed, and re-checked against the plan as it stands.
    ⚠️ Picking a SUBSET of a repair is the case that most needs the gate — a cascade is a coherent
    set, and taking two moves of a three-move repair can leave exactly the clash the third one was
    there to avoid. The gate is what makes cherry-picking safe to offer at all.

    **A cold process rebuilding what was already published** (`replay=True`). No gate, deliberately,
    and it is not the same decision: these moves were accepted once already, and refusing them now
    would leave the process serving a plan that DISAGREES with the durable record — worse than
    serving a plan with a conflict in it. This only reconstructs what already is.

    ⚠️ THIS EXISTS BECAUSE THE SERVER CANNOT REMEMBER ANYTHING. No database client, and the
    container scales to zero, so a published plan lives exactly as long as the process. The client
    holds the durable copy and replays it here on a cold start.
    """
    if not moves:
        return {"error": "nothing_to_publish"}

    if not replay:
        if not (published_by or "").strip():
            return {"error": "not_confirmed",
                    "message": "publishedBy is required — an unattributed publish is not a publish"}
        from tools import detect_conflicts

        before = detect_conflicts(store).get("hard", 0)
        after = detect_conflicts(store, moves=moves).get("hard", 0)
        if after > before:
            return {
                "error": "would_add_conflicts",
                "hardBefore": before,
                "hardAfter": after,
                "message": "publishing this selection would leave the plan with conflicts it does "
                           "not have — a partial repair can reopen the clash it was closing",
            }

    result = store.publish(
        moves,
        (published_by or "").strip() or "wiederhergestellt",
        label=label or ("Wiederhergestellter Stand" if replay else "Ausgewählte Änderungen"),
    )
    return {**result, "planVersion": store.plan_version, "replayed": replay,
            "publishedUntouched": False}


def assignments_for(store: ScheduleStore, draft_id: str | None) -> list[dict]:
    """The rows a view should read: the published plan, or a draft's copy of it.

    ⚠️ A draft belonging to ANOTHER university falls back to this store's published plan rather
    than being applied. Applying it would silently move sessions that do not exist here.
    """
    if not draft_id or draft_id == PUBLISHED:
        return store.assignments
    draft = _drafts.get(draft_id)
    if not draft or (draft.site and store.site and draft.site != store.site):
        return store.assignments
    return list(draft.assignments.values())

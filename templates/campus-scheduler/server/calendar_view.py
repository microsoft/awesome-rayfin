"""The week grid, read-only.

PLAN §13.3. This is deliberately a SEPARATE module from `tools.py`: everything in tools.py is
reachable by the agent, and the calendar is the thing the human looks at to decide whether the
agent was right. Keeping them apart makes it obvious that nothing here writes.

The agent DOES now get a read-only view of the same data (§13.5 step 5) — but through
`tools.get_calendar`, which returns a different SHAPE: booked/free/unavailable lists rather than a
35-cell grid, because a model reading a grid spends most of its context on empty cells. Both read
the same assignments, so the two surfaces cannot disagree about what is booked; only about how much
whitespace they describe.

The grid is not invented: `time_slot.json` already defines 5 days × 7 blocks with real start and
end times and a `desirability` weight, so the calendar renders the data's own shape.
"""

from __future__ import annotations

from typing import Any

from schedule_store import ScheduleStore

DAY_ORDER = ["Mo", "Di", "Mi", "Do", "Fr"]

SCOPES = ("teacher", "cohort", "room")


def _cohort_label(cohort: dict) -> str:
    """Cohorts carry no name field, only a programme and a semester.

    Falling back to the raw id would put "IM-INFO-1" in front of a planner who thinks in
    "Informatik, 1. Semester". Both are shown: the id is what the agent quotes.
    """
    programme = cohort.get("programme")
    semester = cohort.get("semester")
    if programme and semester:
        return f"{programme} {semester}. Semester"
    return programme or cohort["cohortId"]


def _room_subject(room: dict) -> dict[str, Any]:
    """A room, described the way the grid header needs it."""
    return {
        "id": room["roomId"],
        "name": room.get("displayName") or room["roomId"],
        "roomType": room.get("roomType"),
        "seats": room.get("capacity"),
        "buildingId": room.get("buildingId"),
        "campusId": room.get("campusId"),
        "schedulable": bool(room.get("schedulable")),
    }


def _slot_grid(store: ScheduleStore) -> list[dict[str, Any]]:
    """Every slot, ordered, with the fields a grid needs to lay itself out."""
    return [
        {
            "slotId": s["slotId"],
            "day": s["day"],
            "dayIndex": s["dayIndex"],
            "block": s["block"],
            "startTime": s["startTime"],
            "endTime": s["endTime"],
            "desirability": s.get("desirability"),
        }
        for s in sorted(store.slots, key=lambda s: (s["dayIndex"], s["block"]))
    ]


def _entry(store: ScheduleStore, assignment: dict) -> dict[str, Any]:
    """One booked cell, carrying enough to be read without a second lookup."""
    session = store.session_by_id.get(assignment["sessionId"], {})
    course = store.course_by_id.get(assignment.get("courseId"), {})
    room = store.room_by_id.get(assignment.get("roomId"), {})
    teacher = store.teacher_by_id.get(assignment.get("teacherId"), {})
    cohort = store.cohort_by_id.get(assignment.get("cohortId"), {})
    return {
        "sessionId": assignment["sessionId"],
        "slotId": assignment.get("slotId"),
        "course": course.get("title"),
        "courseId": assignment.get("courseId"),
        "kind": course.get("courseType"),
        "requiredRoomType": session.get("requiredRoomType"),
        "teacherId": assignment.get("teacherId"),
        "teacher": teacher.get("name"),
        "cohortId": assignment.get("cohortId"),
        "cohort": _cohort_label(cohort) if cohort else assignment.get("cohortId"),
        "attendeeId": assignment.get("attendeeId"),
        "wholeCohort": bool(session.get("isWholeCohort")),
        "roomId": assignment.get("roomId"),
        "roomType": room.get("roomType"),
        "seats": room.get("capacity"),
        "buildingId": assignment.get("buildingId"),
        "campusId": assignment.get("campusId"),
        "attendance": session.get("expectedAttendance"),
        "frozen": bool(assignment.get("frozen")),
    }


def resolve_subject(store: ScheduleStore, scope: str, key: str) -> dict[str, Any] | None:
    """Turn what a human typed into the thing the grid is about.

    A planner types "Hinterberger" or "D 104", never "IM-T029". Refusing anything but an id would
    make the person do lookup work for the machine.
    """
    key = (key or "").strip()
    if not key:
        return None

    if scope == "teacher":
        # See `calendar_view` above: the refusal is raised there with its own code so the caller
        # can say why. Returning None here keeps every other path (suggestions, the tools) from
        # naming an invented lecturer against real teaching.
        if store.teacher_attribution_invented:
            return None
        t = store.find_teacher(key)
        return {"id": t["teacherId"], "name": t.get("name")} if t else None

    if scope == "cohort":
        if key in store.cohort_by_id:
            c = store.cohort_by_id[key]
            return {"id": c["cohortId"], "name": _cohort_label(c),
                    "programme": c.get("programme"), "semester": c.get("semester"),
                    "headcount": c.get("headcount")}

        # ⚠️ A cohort has NO name field — only a programme and a semester. Matching on `name`
        # matched nothing at all, so "Informatik" and even "IM-INFO" both came back not_found and
        # the scope was only reachable by typing the exact id. Search what the record actually has.
        needle = key.lower()
        hits = [
            c for c in store.cohorts
            if needle in c["cohortId"].lower() or needle in (c.get("programme") or "").lower()
        ]
        if len(hits) == 1:
            c = hits[0]
            return {"id": c["cohortId"], "name": _cohort_label(c),
                    "programme": c.get("programme"), "semester": c.get("semester"),
                    "headcount": c.get("headcount")}
        if len(hits) > 1:
            return {"ambiguous": [c["cohortId"] for c in sorted(hits, key=lambda x: x["cohortId"])]}
        return None

    if scope == "room":
        if key in store.room_by_id:
            return _room_subject(store.room_by_id[key])

        # ⚠️ CASE IS SIGNIFICANT in a room code. Upper-case building letters are the published OTH
        # ones; lower-case are placeholders this project invented for buildings whose real letter is
        # unknown (config/oth-building-letters.json). "D 104" and "d 104" are DIFFERENT rooms — one
        # has 15 bookings, the other none.
        #
        # So only the fully-typed code above is treated as unambiguous. Anything looser that could
        # mean either room ASKS, rather than resolving by case and handing back a confident, empty
        # week. Case-sensitivity is not a distinction a planner can be expected to carry.
        squashed = key.replace(" ", "").lower()
        loose = [r for r in store.rooms if r["roomId"].replace(" ", "").lower() == squashed]
        if len(loose) == 1:
            return _room_subject(loose[0])
        if len(loose) > 1:
            return {"ambiguous": [r["roomId"] for r in sorted(loose, key=lambda x: x["roomId"])]}
        return None

    return None


def calendar_view(
    store: ScheduleStore,
    scope: str,
    key: str,
    assignments: list[dict] | None = None,
    draft_id: str | None = None,
) -> dict[str, Any]:
    """The week for one teacher, cohort or room.

    `assignments` defaults to the published plan. A draft passes its own copy of the rows, which is
    what lets a confirmed result be read in exactly the same grid as the proposal that produced it —
    one renderer, so the before and the after cannot drift apart visually.
    """
    if scope not in SCOPES:
        return {"error": "bad_scope", "message": f"scope must be one of {', '.join(SCOPES)}"}

    # ⚠️ "NOT FOUND" WOULD BE A LIE HERE. Where the lecturers are invented on top of real teaching
    # the person is not missing from the data, they were never real — and answering `not_found`
    # invites the reader to conclude this university simply has no such professor. The distinct
    # code lets the UI say what is actually true, and `apiError.ts` maps codes to translated text
    # so no server prose reaches the screen.
    if scope == "teacher" and store.teacher_attribution_invented:
        return {
            "error": "teacher_not_published",
            "scope": scope,
            "key": key,
            "message": (
                "this dataset's teaching is real but its lecturers are invented, so a lecturer "
                "cannot be looked up"
            ),
        }

    subject = resolve_subject(store, scope, key)
    if not subject:
        return {"error": "not_found", "scope": scope, "key": key,
                "message": f"no {scope} matches '{key}'"}
    if "ambiguous" in subject:
        why = (
            "these are different rooms; an upper-case building letter is a published OTH "
            "building, a lower-case one is a placeholder"
            if scope == "room"
            else f"several {scope}s match"
        )
        return {
            "error": "ambiguous",
            "scope": scope,
            "key": key,
            "candidates": subject["ambiguous"],
            "message": f"'{key}' matches {' and '.join(subject['ambiguous'])} — {why}. Say which.",
        }

    field = {"teacher": "teacherId", "cohort": "cohortId", "room": "roomId"}[scope]
    rows = store.assignments if assignments is None else assignments
    mine = [a for a in rows if a.get(field) == subject["id"]]

    entries = [_entry(store, a) for a in mine]
    entries.sort(key=lambda e: (
        store.slot_by_id.get(e["slotId"], {}).get("dayIndex", 99),
        store.slot_by_id.get(e["slotId"], {}).get("block", 99),
    ))

    view: dict[str, Any] = {
        "scope": scope,
        "subject": subject,
        "draftId": draft_id or "published",
        "days": DAY_ORDER,
        "blocks": sorted({s["block"] for s in store.slots}),
        "slots": _slot_grid(store),
        "entries": entries,
        "bookedSlots": len({e["slotId"] for e in entries}),
    }

    # Availability only means something for a person. A room being "unavailable" is a different
    # concept (maintenance) that this dataset does not model, and faking it would be a lie the
    # planner could act on.
    if scope == "teacher":
        view["availability"] = [
            {
                "slotId": s["slotId"],
                "state": (
                    "nicht_verfuegbar"
                    if (subject["id"], s["slotId"]) in store.unavailable
                    else "eingeschraenkt"
                    if (subject["id"], s["slotId"]) in store.restricted
                    else "verfuegbar"
                ),
            }
            for s in store.slots
        ]

    return view


def calendar_suggestions(store: ScheduleStore, scope: str, limit: int | None = None) -> list[dict[str, Any]]:
    """Every subject that has a timetable, busiest first.

    ⚠️ THIS USED TO RETURN ONLY THE TOP EIGHT, AND IT WAS THE WHOLE PICKER. The ordering is a good
    default — the grid should never open empty, and the caller takes the first entry — but the
    dropdown is built from this list and nothing else, so a cap here was a cap on what a planner
    could look at. OTH places 983 sessions across **105 rooms**; eight of them covered 18% of the
    week, and the other 97 rooms had a full timetable that no control in the app could reach.

    It read as "only a few rooms are scheduled", which is a statement about the data. It was a
    statement about the list length.

    `limit` stays available for callers that genuinely want a shortlist, and is not applied by
    default. A select with a hundred entries is ordinary; a select that hides ninety of them is not.
    """
    field = {"teacher": "teacherId", "cohort": "cohortId", "room": "roomId"}.get(scope)
    if not field:
        return []
    counts: dict[str, int] = {}
    for a in store.assignments:
        key = a.get(field)
        if key:
            counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    if limit is not None:
        ranked = ranked[:limit]
    out = []
    for key, count in ranked:
        subject = resolve_subject(store, scope, key)
        # Suggestions come from ids that came out of the data, so the exact-match branch always
        # wins and `ambiguous` cannot happen here. Guarded anyway: a suggestion that offered a
        # subject the grid then refuses to open would be a dead button.
        if subject and "ambiguous" not in subject:
            out.append({**subject, "sessions": count})
    return out

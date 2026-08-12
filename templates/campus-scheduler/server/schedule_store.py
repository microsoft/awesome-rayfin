"""The planning dataset, in memory, with the lookups the tools actually ask for.

Loaded once at start-up. The whole dataset is ~1 000 sessions and ~1 000 rooms — small enough
that every question a planner asks can be answered from RAM in microseconds, which is the
difference between a conversation and a progress bar.

⚠️ THE DATA IS NOT ALWAYS SYNTHETIC, AND THIS MODULE USED TO SAY IT ALWAYS WAS. OTH's and
LMU's timetables are generated (see the dataset's provenance.json) because neither university
publishes one. TUM Garching does: its 1 470 sessions are REAL bookings from TUMonline, and its
published plan is the plan TUM actually runs. Only the lecturers and cohorts there are invented,
because the feed carries neither. Read `provenance.json` rather than assuming.

⚠️ The GEOGRAPHY is real everywhere: rooms sit in real university buildings at real coordinates,
and where a building's interior was actually surveyed the room outlines are the surveyed ones —
Gebäude K's ground floor at OTH, all three levels of Oettingenstraße 67 at LMU, and the whole
55xx block at Garching. Anything this module reports about *where* something is, is true.

⚠️ **THE SITE IS NOW A PARAMETER, NOT A PROCESS-WIDE CONSTANT** (PLAN §21.1). It used to be read
from `SCHEDULER_SITE` at import, so one container served exactly one university and `SITE`, `DATA`,
`SITE_LABEL` were module-level. That was a deliberate decision, and its stated reason — "making the
site a per-request parameter would mean holding every dataset and threading the choice through the
solver for no benefit anyone has asked for" — was correct until the benefit was asked for: one twin
of German higher education rather than four separate deployments.

What that decision bought, and what replaces it:

* **Memory.** Every dataset is now resident. ~1 000 sessions and 1 000–9 300 rooms per site, loaded
  lazily per site and cached, so a container that is only ever asked about one university still
  holds only that one.
* **Wrong-university answers.** Every tool already takes `store` as its first argument, so the seam
  existed; nothing closes over a module default any more. `SCHEDULER_SITE` survives as the DEFAULT
  for a request that does not name a site, which keeps existing deployments byte-identical in
  behaviour.
* **Access control.** One container per university used to BE the isolation. It no longer is, and
  application-level scoping is a downgrade unless it is tested — see PLAN §21.1 and §17.3.
"""

from __future__ import annotations

import json
import os
import time
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Kept in step with tools/data/sites.py. Deliberately a small explicit map rather than an import:
# the container ships `server/` and `data/` and nothing from `tools/`, so importing the registry
# would work in development and fail in the image.
_SYNTH_DIRS = {
    "oth": ROOT / "data" / "synthetic",
    "lmu": ROOT / "data" / "synthetic-lmu",
    "tum": ROOT / "data" / "tum",
    # ⚠️ OTH's REAL timetable, read from the Untis export OTH sent (PLAN §25). It is a SEPARATE
    # site rather than a replacement for `oth`: the generated dataset is what every existing test
    # pins, and the two have to be comparable side by side. The directory name says which is which.
    "oth-real": ROOT / "data" / "oth-real",
}
_SITE_LABELS = {"oth": "OTH Regensburg", "lmu": "LMU München", "tum": "TUM Garching",
                "oth-real": "OTH Regensburg (Echtdaten)"}


def known_sites() -> list[str]:
    """Every university this build can serve. Sorted so callers get a stable order."""
    return sorted(_SYNTH_DIRS)


def resolve_site(site: str | None) -> str:
    """Normalise a requested site, falling back to the deployment default.

    ⚠️ REFUSES AN UNKNOWN SITE RATHER THAN QUIETLY SERVING THE DEFAULT. Answering a question about
    an unrecognised university with another university's timetable is the failure `site-guard`
    exists to catch, and it would look like a working app.
    """
    chosen = (site or DEFAULT_SITE).lower()
    if chosen not in _SYNTH_DIRS:
        raise KeyError(chosen)
    return chosen


#: The site a request gets when it does not name one. Keeps single-university deployments identical.
DEFAULT_SITE = os.environ.get("SCHEDULER_SITE", "oth").lower()
if DEFAULT_SITE not in _SYNTH_DIRS:
    raise SystemExit(
        f"SCHEDULER_SITE='{DEFAULT_SITE}' is not a known site. Known: {', '.join(known_sites())}"
    )

#: Back-compat aliases for the default site. Prefer `store.site` / `store.site_label`, which are
#: true for the store you are actually holding rather than for whatever the container defaults to.
SITE = DEFAULT_SITE
SITE_LABEL = _SITE_LABELS[DEFAULT_SITE]

#: The day the app's own suggested question asks about ("… kann freitags nicht mehr").
DEMO_DAY = "Fr"
#: How many lecturers to try before giving up. Measured: the first or second candidate resolves, so
#: this bound is a safety net rather than a working limit. Giving up now means NO suggested question
#: rather than an unverified one — see `_pick_demo_teacher`.
CANDIDATE_LIMIT = 6
#: Seconds per trial solve. Short on purpose — this runs once, but it runs inside a request.
DEMO_SOLVE_S = 2.0
DATA = _SYNTH_DIRS[DEFAULT_SITE]

# Which script rebuilds a site, for the error a missing table should raise. TUM is not built by
# the generator at all — pointing someone at `generate_timetable.py` would invite them to overwrite
# a real timetable with an invented one.
_BUILDERS = {
    "oth": "tools/data/generate_timetable.py --site oth",
    "lmu": "tools/data/generate_timetable.py --site lmu",
    "tum": "tools/data/build_tum_dataset.py",
    # ⚠️ NOT generate_timetable. Pointing a real dataset at the generator invites somebody to
    # overwrite OTH's own timetable with an invented one — the same trap TUM's entry exists for.
    "oth-real": "tools/data/read_untis_gpu.py",
}
_BUILDER = _BUILDERS[DEFAULT_SITE]


def _load(name: str, site: str) -> list[dict]:
    path = _SYNTH_DIRS[site] / f"{name}.json"
    if not path.exists():
        raise FileNotFoundError(
            f"{path} is missing — run {_BUILDERS[site]} before starting the server"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def _load_optional(name: str, site: str) -> list[dict]:
    """A table only some universities have. Absence is a fact, not a failure.

    OTH and LMU have no `room_block`: their timetables are generated, so the plan's own assignments
    are the complete truth about which room is busy when. TUM's are real, and a real university's
    rooms are also full of things that are not teaching.
    """
    path = _SYNTH_DIRS[site] / f"{name}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


@dataclass
class ScheduleStore:
    #: Which university this store holds. Carried on the instance so a tool can never be confident
    #: about a site it is not actually serving — the wrong-university answer is the whole risk of
    #: one container serving many.
    site: str = ""
    site_label: str = ""
    slots: list[dict] = field(default_factory=list)
    buildings: list[dict] = field(default_factory=list)
    rooms: list[dict] = field(default_factory=list)
    travel: list[dict] = field(default_factory=list)
    teachers: list[dict] = field(default_factory=list)
    availability: list[dict] = field(default_factory=list)
    cohorts: list[dict] = field(default_factory=list)
    courses: list[dict] = field(default_factory=list)
    sessions: list[dict] = field(default_factory=list)
    assignments: list[dict] = field(default_factory=list)

    # ── lookups ─────────────────────────────────────────────────────────────────────────
    room_by_id: dict[str, dict] = field(default_factory=dict)
    slot_by_id: dict[str, dict] = field(default_factory=dict)
    session_by_id: dict[str, dict] = field(default_factory=dict)
    teacher_by_id: dict[str, dict] = field(default_factory=dict)
    cohort_by_id: dict[str, dict] = field(default_factory=dict)
    course_by_id: dict[str, dict] = field(default_factory=dict)
    building_by_id: dict[str, dict] = field(default_factory=dict)
    assignment_by_session: dict[str, dict] = field(default_factory=dict)
    travel_min: dict[tuple[str, str], int] = field(default_factory=dict)

    # ── memoised demo pick ──────────────────────────────────────────────────────────────
    # `demo_teacher()` runs the solver, so the answer is computed once per process and kept.
    _demo_teacher: str | None = field(default=None, init=False, repr=False, compare=False)
    _demo_teacher_ready: bool = field(default=False, init=False, repr=False, compare=False)
    unavailable: set[tuple[str, str]] = field(default_factory=set)
    restricted: set[tuple[str, str]] = field(default_factory=set)
    room_blocks: list[dict] = field(default_factory=list)
    blocked_room_slots: set[tuple[str, str]] = field(default_factory=set)

    #: Counts edits to who can teach when. Separate from `plan_version` on purpose: changing a
    #: lecturer's availability does NOT change the plan — it changes what the plan is judged
    #: against, and a client needs to be able to tell those two apart.
    availability_version: int = 0

    # ── the published plan, after anyone has published to it ────────────────────────────
    #: 0 means "exactly the dataset baked into this image". Every publish increments it, so a
    #: client can tell that the plan it is holding has been superseded without diffing it.
    plan_version: int = 0
    #: One entry per publish: who, when, how many sessions, and which draft it came from. The
    #: plan itself does not record how it came to be, and "who changed my Friday" is the first
    #: question a planner asks.
    publications: list[dict] = field(default_factory=list)

    def publish(self, moves: list[dict], published_by: str, label: str | None = None) -> dict:
        """Make these moves THE plan. Mutates the published assignments in place.

        ⚠️ THIS IS THE ONE PLACE THE PUBLISHED PLAN CHANGES AT RUNTIME, and until now nothing did.
        `proposals.apply` deliberately returns `publishedUntouched: True` — a draft is an overlay
        and never the plan. That guarantee is what makes preview safe, so promoting a draft cannot
        be done by loosening it; it needs a separate, named, audited act. This is that act.

        ⚠️ IN-PROCESS ONLY, AND THE CALLER MUST KNOW IT. This server has no database client of any
        kind (`requirements.txt` is fastapi, uvicorn, httpx, ortools, azure-identity), and the
        container scales to zero. So a publish lives exactly as long as this process does. What
        makes it survive is the caller writing the same moves to Fabric SQL and replaying them on
        a cold start — the "baseline + replay" model the drafts already use. Calling this alone
        and telling a planner their plan is published would be a lie with a green banner.

        ⚠️ Rows are mutated, NOT replaced, because `assignment_by_session` holds the same dict
        objects as `assignments`. Rebuilding either list would silently desynchronise the two and
        the solver reads one while the calendar reads the other.
        """
        applied: list[dict] = []
        unknown: list[str] = []
        for move in moves:
            sid = move.get("sessionId")
            row = self.assignment_by_session.get(sid) if sid else None
            if not row:
                # A saved move whose session no longer exists means the dataset moved under the
                # decision. Reported, never skipped in silence — the same rule as `restore`.
                unknown.append(str(sid))
                continue
            before = {"slotId": row.get("slotId"), "roomId": row.get("roomId")}
            to = move.get("to") or move
            slot_id = to.get("slotId") or row.get("slotId")
            room_id = to.get("roomId") or row.get("roomId")
            room = self.room_by_id.get(room_id) or {}
            row["slotId"] = slot_id
            row["roomId"] = room_id
            row["buildingId"] = room.get("buildingId") or row.get("buildingId")
            row["campusId"] = room.get("campusId") or row.get("campusId")
            # The published plan is the published plan whatever route a row took to get here.
            row["draftId"] = "published"
            if before["slotId"] != slot_id or before["roomId"] != room_id:
                # ⚠️ buildingId and campusId RIDE ALONG because the client writes this straight back
                # into SQL to make the publish durable, and `savePlanAssignments` updates those two
                # columns on every write. Omitting them here would send empty strings and blank a
                # field the baseline seed had filled — losing data by "updating" it.
                applied.append({
                    "sessionId": sid,
                    "from": before,
                    "to": {"slotId": slot_id, "roomId": room_id,
                           "buildingId": row.get("buildingId"), "campusId": row.get("campusId")},
                    "teacherId": row.get("teacherId"), "cohortId": row.get("cohortId"),
                    "courseId": row.get("courseId"),
                })

        self.plan_version += 1
        # The demo suggestion is memoised and was computed against the plan this just replaced.
        self._demo_teacher = None
        self._demo_teacher_ready = False
        entry = {
            "version": self.plan_version,
            "at": time.time(),
            "publishedBy": published_by,
            "label": label or "",
            "sessionsChanged": len(applied),
            "unknownSessions": unknown,
        }
        self.publications.append(entry)
        return {**entry, "applied": applied}

    # ── who can teach when ──────────────────────────────────────────────────────────────
    #: The three states the dataset uses. German, because they are dataset VALUES that the
    #: generator writes and every table already carries — not display strings.
    AVAILABILITY_STATES = ("verfuegbar", "eingeschraenkt", "nicht_verfuegbar")

    def sessions_blocked_by(self, teacher_id: str, states: dict[str, str] | None = None) -> list[dict]:
        """The lecturer's own sessions that sit in a slot they are marked unavailable for.

        ⚠️ THIS IS THE ANSWER A PREVIEW HAS TO GIVE, AND IT MUST NOT WRITE TO GET IT. The import
        endpoint offers a dry run precisely so a planner can see the damage before accepting a
        spreadsheet — but the count that matters is "how many of their lectures does this make
        illegal", and computing it by applying the change and looking afterwards would make the
        preview a write. Measured on the live app: uploading a sheet that blocked four slots the
        lecturer teaches in previewed as "4 changes" and said nothing about the four lectures it
        was about to invalidate.

        `states` overlays proposed values on top of the stored ones, keyed by slot id, so the same
        function answers both "what IS broken" (no overlay) and "what WOULD break" (overlay).
        """
        blocked = {
            a["slotId"] for a in self.availability
            if a["teacherId"] == teacher_id and a["state"] == "nicht_verfuegbar"
        }
        if states:
            for slot_id, state in states.items():
                if state == "nicht_verfuegbar":
                    blocked.add(slot_id)
                else:
                    blocked.discard(slot_id)

        clashes = []
        for sess in self.sessions:
            if sess.get("teacherId") != teacher_id:
                continue
            row = self.assignment_by_session.get(sess["sessionId"])
            if row and row.get("slotId") in blocked:
                course = self.course_by_id.get(sess.get("courseId"), {})
                clashes.append({
                    "sessionId": sess["sessionId"],
                    "slotId": row["slotId"],
                    "roomId": row.get("roomId"),
                    "course": course.get("title") or sess.get("courseId"),
                })
        return clashes

    def set_availability(self, teacher: str, entries: list[dict], changed_by: str = "") -> dict:
        """Change when one lecturer can teach, and say what that breaks.

        ⚠️ THE ANSWER IS NOT "SAVED". Marking a slot unavailable that the lecturer is ALREADY
        teaching in does not move anything — it makes the existing plan illegal. That is a
        perfectly reasonable thing for a planner to do (it is the first half of the cascade this
        product exists for), but a UI that replies "gespeichert" and nothing else has hidden the
        only fact that mattered. So every write returns the sessions it has just put in conflict,
        and the caller is expected to put that number on screen.

        ⚠️ ROWS ARE MUTATED IN PLACE and the derived sets rebuilt from `self.availability`,
        for the same reason `publish` mutates: `unavailable` and `restricted` are projections,
        and rebuilding one without the other leaves the solver and the calendar disagreeing
        about who is free.

        ⚠️ IN-PROCESS ONLY, exactly like `publish`. Durability is the caller writing the same
        rows to Fabric SQL and replaying them on a cold start.
        """
        t = self.find_teacher(teacher)
        if not t:
            return {"error": "teacher_not_found", "teacher": teacher,
                    "didYouMean": self.suggest_teachers(teacher)}
        tid = t["teacherId"]

        by_slot = {a["slotId"]: a for a in self.availability if a["teacherId"] == tid}
        applied: list[dict] = []
        unknown_slots: list[str] = []
        bad_states: list[str] = []
        for e in entries:
            slot_id = str(e.get("slotId") or "")
            state = str(e.get("state") or "")
            if slot_id not in self.slot_by_id:
                unknown_slots.append(slot_id)
                continue
            if state not in self.AVAILABILITY_STATES:
                bad_states.append(state)
                continue
            row = by_slot.get(slot_id)
            before = row["state"] if row else "verfuegbar"
            if before == state:
                continue
            if row is None:
                # A lecturer with no row for a slot is treated as available everywhere else in
                # this file, so an absent row and "verfuegbar" mean the same thing. Writing the
                # row makes the decision explicit rather than leaving it to that convention.
                row = {"teacherId": tid, "slotId": slot_id, "state": state}
                self.availability.append(row)
                by_slot[slot_id] = row
            else:
                row["state"] = state
            applied.append({"slotId": slot_id, "from": before, "to": state})

        self.unavailable = {
            (a["teacherId"], a["slotId"]) for a in self.availability
            if a["state"] == "nicht_verfuegbar"
        }
        self.restricted = {
            (a["teacherId"], a["slotId"]) for a in self.availability
            if a["state"] == "eingeschraenkt"
        }
        if applied:
            self.availability_version += 1
            # The demo suggestion is chosen by running a cascade, and this changed the constraints
            # that cascade is solved under.
            self._demo_teacher = None
            self._demo_teacher_ready = False

        # What the change has just made illegal: sessions this lecturer holds in a slot they are
        # now marked unavailable for.
        clashes = self.sessions_blocked_by(tid)

        return {
            "teacherId": tid,
            "teacher": t.get("name"),
            "changed": len(applied),
            "applied": applied,
            "unknownSlots": unknown_slots,
            "invalidStates": bad_states,
            "availabilityVersion": self.availability_version,
            "changedBy": changed_by,
            # ⚠️ Named `nowInConflict`, not `conflicts`: these sessions did not move and nothing
            # about them is wrong — the rule they are judged by changed underneath them.
            "nowInConflict": clashes,
        }

    def availability_for(self, teacher: str) -> dict:
        """One lecturer's week as states, with the slots that carry them."""
        t = self.find_teacher(teacher)
        if not t:
            return {"error": "teacher_not_found", "teacher": teacher,
                    "didYouMean": self.suggest_teachers(teacher)}
        tid = t["teacherId"]
        by_slot = {a["slotId"]: a["state"] for a in self.availability if a["teacherId"] == tid}
        # ⚠️ WHERE THE STATE CAME FROM TRAVELS WITH IT. "She said this hour is free" and "nobody
        # ever asked her" are both `verfuegbar`, and a green cell that cannot tell them apart
        # invites a planner to treat an assumption as a statement. Only OTH's real export sets
        # this to anything but `assumed` — see `read_untis_gpu.py`, which seeds the rest.
        src_by_slot = {
            a["slotId"]: a.get("source") for a in self.availability if a["teacherId"] == tid
        }
        taught = {
            row["slotId"]: sess["sessionId"]
            for sess in self.sessions if sess.get("teacherId") == tid
            for row in [self.assignment_by_session.get(sess["sessionId"])] if row
        }
        return {
            "teacherId": tid,
            "teacher": t.get("name"),
            "availabilityVersion": self.availability_version,
            "slots": [
                {
                    "slotId": s["slotId"],
                    "day": s.get("day"),
                    "block": s.get("block"),
                    "startTime": s.get("startTime"),
                    "endTime": s.get("endTime"),
                    "state": by_slot.get(s["slotId"], "verfuegbar"),
                    # A site whose dataset predates the seed has no row at all, and "assumed" is
                    # the honest reading of a missing one — same default as the state above.
                    "source": src_by_slot.get(s["slotId"]) or "assumed",
                    # So the editor can warn BEFORE the click rather than after the write.
                    "teaches": taught.get(s["slotId"]),
                }
                for s in self.slots
            ],
        }

    @classmethod
    def load(cls, site: str | None = None) -> "ScheduleStore":
        chosen = resolve_site(site)
        s = cls(
            site=chosen,
            site_label=_SITE_LABELS[chosen],
            slots=_load("time_slot", chosen),
            buildings=_load("building", chosen),
            rooms=_load("room", chosen),
            travel=_load("travel_time", chosen),
            teachers=_load("teacher", chosen),
            availability=_load("availability", chosen),
            cohorts=_load("cohort", chosen),
            courses=_load("course", chosen),
            sessions=_load("course_session", chosen),
            assignments=_load("plan_assignment", chosen),
        )
        s.room_blocks = _load_optional("room_block", chosen)
        s.blocked_room_slots = {(b["roomId"], b["slotId"]) for b in s.room_blocks}
        s.room_by_id = {r["roomId"]: r for r in s.rooms}
        s.slot_by_id = {x["slotId"]: x for x in s.slots}
        s.session_by_id = {x["sessionId"]: x for x in s.sessions}
        s.teacher_by_id = {x["teacherId"]: x for x in s.teachers}
        s.cohort_by_id = {x["cohortId"]: x for x in s.cohorts}
        s.course_by_id = {x["courseId"]: x for x in s.courses}
        s.building_by_id = {x["buildingId"]: x for x in s.buildings}
        s.assignment_by_session = {a["sessionId"]: a for a in s.assignments}
        s.travel_min = {(t["fromBuildingId"], t["toBuildingId"]): t["minutes"] for t in s.travel}
        s.unavailable = {
            (a["teacherId"], a["slotId"]) for a in s.availability if a["state"] == "nicht_verfuegbar"
        }
        s.restricted = {
            (a["teacherId"], a["slotId"])
            for a in s.availability
            if a["state"] == "eingeschraenkt"
        }
        return s

    # ── the questions the agent asks ────────────────────────────────────────────────────
    def find_teacher(self, needle: str) -> dict | None:
        """Match a teacher by id or by any part of the displayed name.

        The planner types "Meier", not "IM-T017". An agent that can only accept ids forces the
        human to look things up for the machine, which is exactly backwards.

        ⚠️ AN EXACT SURNAME BEATS A SUBSTRING, AND THIS ORDER IS THE WHOLE POINT. A plain
        `needle in name` scan returns whoever happens to come first in the file, so at OTH
        "Leitner" resolved to **Achleitner** and at LMU "Berger" to **Blomberger** — a real
        timetable for a real person, just not the one who was asked about, with nothing on screen
        to reveal it. Measured: 2 such collisions at each site.

        ⚠️ AND AN AMBIGUOUS SUBSTRING RESOLVES TO NOTHING RATHER THAN TO THE FIRST HIT. Returning a
        plausible guess when the match is genuinely unclear is the failure this repo has already
        shipped twice; the caller offers `suggest_teachers` as a question instead.
        """
        needle = _fold(needle)
        if not needle:
            return None
        if needle.upper() in self.teacher_by_id:
            return self.teacher_by_id[needle.upper()]

        def surname(t: dict) -> str:
            name = t.get("name") or ""
            return _fold(name.split()[-1]) if name else ""

        exact = [
            t for t in self.teachers
            if needle == surname(t)
            or needle == _fold(t.get("name") or "")
            or needle == _fold(t["teacherId"])
        ]
        if len(exact) == 1:
            return exact[0]
        if exact:
            return None  # two lecturers really do share this surname — ask, do not pick

        partial = [t for t in self.teachers if needle in _fold(t.get("name") or "")]
        return partial[0] if len(partial) == 1 else None

    def suggest_teachers(self, needle: str, limit: int = 3) -> list[str]:
        """Names close to something that did not match — candidates to ASK about, never to use.

        ⚠️ THIS DELIBERATELY DOES NOT RESOLVE. Returning the nearest name from `find_teacher` would
        answer a question about Professor A with Professor B's timetable, and the planner would have
        no way to tell: every number that came back would be real, just about the wrong person. That
        is the exact failure this project guards hardest against, and it is worse than "not found".
        So the near miss is offered as a QUESTION — the same treatment an ambiguous room code gets.

        Matched on the SURNAME as well as the whole string, because every generated lecturer is
        rendered "Prof. Dr. X. Surname": comparing a typed surname against that full string scores
        badly enough that a one-letter slip would fall below any sensible cutoff.
        """
        import difflib

        needle = _fold(needle)
        if not needle or not self.teachers:
            return []

        scored: list[tuple[float, str]] = []
        for t in self.teachers:
            name = t.get("name", "")
            surname = name.split()[-1] if name else ""
            best = max(
                difflib.SequenceMatcher(None, needle, _fold(name)).ratio(),
                difflib.SequenceMatcher(None, needle, _fold(surname)).ratio(),
            )
            if best >= 0.7:
                scored.append((best, name))
        scored.sort(key=lambda x: -x[0])
        return [name for _, name in scored[:limit]]

    def sessions_of_teacher(self, teacher_id: str) -> list[dict]:
        return [s for s in self.sessions if s["teacherId"] == teacher_id]

    def slots_of_day(self, day: str) -> list[str]:
        return [s["slotId"] for s in self.slots if s["day"].lower() == day.lower()]

    def building_of_room(self, room_id: str) -> str | None:
        room = self.room_by_id.get(room_id)
        return room["buildingId"] if room else None

    def occupied(self) -> tuple[set, set, set]:
        """(room-slot, teacher-slot, attendee-slot) currently taken.

        ⚠️ ROOM OCCUPANCY IS NOT ONLY THE PLAN'S OWN DOING. For a generated university it is: every
        booking in the dataset came from the placer. For TUM it is not — the same rooms carry
        `IRIS Belegung` holds, doctoral defences and rooms the university has deliberately barred,
        none of which is teaching and all of which means the room is taken. Leaving those out let
        the solver move a lecture into a room that is genuinely in use and call it a repair, which
        is the confident-and-wrong failure this project guards hardest against.
        """
        room_slot = set(self.blocked_room_slots)
        teacher_slot = set()
        attendee_slot = set()
        for a in self.assignments:
            sess = self.session_by_id.get(a["sessionId"])
            if not sess:
                continue
            room_slot.add((a["roomId"], a["slotId"]))
            teacher_slot.add((sess["teacherId"], a["slotId"]))
            attendee_slot.add((sess["attendeeId"], a["slotId"]))
        return room_slot, teacher_slot, attendee_slot

    @property
    def teacher_attribution_invented(self) -> bool:
        """Are the lecturers fiction attached to REAL teaching?

        ⚠️ THE COMBINATION IS WHAT MATTERS, NOT EITHER HALF. OTH's and LMU's lecturers are invented
        too, but so is every session they teach — a question about one of them is a question about a
        coherent fiction, and the badge covers it. TUM is different in kind: the courses, the rooms
        and the hours are really TUM's, published by TUMonline, and only the person standing at the
        front is made up. "Who teaches IN0009?" would then get a confident, specific, false answer
        about a real module, which is the most misleading pairing this project can produce.

        Derived from the data rather than hard-coded to a site id, so a future dataset that mixes
        the two the same way inherits the same refusal without anyone remembering to add it.
        """
        teachers_invented = any(
            str(t.get("provenance", "")).startswith("invented") for t in self.teachers
        )
        sessions_measured = any(
            str(s.get("provenance", "")).startswith("measured") for s in self.sessions
        )
        return teachers_invented and sessions_measured

    def summary(self) -> dict:
        teaching = [r for r in self.rooms if r.get("schedulable")]
        measured = [r for r in self.rooms if r.get("provenance") == "measured"]
        # ⚠️ WHETHER THE TIMETABLE ITSELF IS REAL is a claim only the dataset can make, and until now
        # nothing carried it. Every site's ROOMS already declare their provenance; the SESSIONS did
        # not, so the app had no way to distinguish a week it invented from one a university
        # published — and TUM's is published. It is the strongest thing this project can say, and it
        # was invisible.
        sessions_measured = sum(
            1 for s in self.sessions if str(s.get("provenance", "")).startswith("measured")
        )
        return {
            "site": self.site,
            "siteLabel": self.site_label,
            "sessions": len(self.sessions),
            "timetableProvenance": "measured" if sessions_measured else "generated",
            # Can a lecturer be looked up at all here? False where the people are invented over
            # real teaching — the UI uses it to stop OFFERING a scope it would only ever refuse.
            "lecturerLookup": not self.teacher_attribution_invented,
            # ⚠️ WHICH FIELDS ON A REAL LECTURE ARE FICTION. Hiding the lecturer SCOPE was not
            # enough: the week grid prints the person and the cohort beside the course and the room
            # on every entry, so Garching read
            #     "Höhere Mathematik 1 für MW/CIW [CIT513013] · 5510.EG.001 · Prof. Dr. R. Wimmer"
            # where the module code and the room are genuinely TUM's and the professor does not
            # exist. Three true fields make the fourth look just as true, and the name is ordinary
            # enough that somebody at TUM may well hold it.
            #
            # A list rather than a boolean because the UI must hide exactly these and nothing more:
            # withholding the room or the course would throw away the measured data that makes this
            # dataset worth using. Empty on a generated site, where the whole week is one coherent
            # fiction and the badge already covers it.
            "inventedAttributes": ["teacher", "cohort"] if self.teacher_attribution_invented else [],
            "blockedRoomHours": len(self.blocked_room_slots),
            "assignments": len(self.assignments),
            "teachers": len(self.teachers),
            "cohorts": len(self.cohorts),
            "rooms": len(self.rooms),
            "teachingRooms": len(teaching),
            "surveyedRooms": len(measured),
            "buildings": len(self.buildings),
            "slots": len(self.slots),
            # ⚠️ AND DO NOT HAND OUT A NAME THE APP WILL THEN REFUSE TO DISCUSS. The assistant uses
            # this to write its example question — "Prof. X fällt Freitag aus, was nun?" — so on a
            # site whose lecturers are invented over real teaching it was inviting exactly the
            # question `teacher_not_published` exists to decline. Offering the name and then
            # refusing it is worse than either alone: it looks like the app is broken rather than
            # careful.
            "exampleTeacher": None if self.teacher_attribution_invented else self.demo_teacher(),
            # ⚠️ WHAT THE UI MUST NOT PRESENT AS ORDINARY. A real export is honest by omission: it
            # names lecturers only by an Untis short code, places rooms on a campus it cannot draw
            # inside, and publishes no capacities. The app has to SAY those things rather than
            # render `Ant` as if it were a person's name and a missing interior as if the building
            # were empty. Each flag is derived from the data, never hard-coded per site, so the
            # generated universities keep their existing behaviour untouched.
            "lecturerNamesAreCodes": any(
                t.get("nameProvenance") == "untis_short_code" for t in self.teachers
            ),
            "roomsWithoutGeometry": sum(1 for r in self.rooms if r.get("hasGeometry") is False),
            "roomsCampusOnly": sorted({
                r.get("campusId") for r in self.rooms
                if r.get("hasGeometry") is False and r.get("campusId")
            }),
            "capacityPublished": any(r.get("capacity") is not None for r in self.rooms),
        }

    def demo_teacher(self) -> str | None:
        """A teacher whose Friday cascade the solver can actually repair.

        ⚠️ THE BUSIEST TEACHER IS THE ONE THE DEMO MUST NOT USE, WHICH IS THE OPPOSITE OF WHAT
        `busiest_teacher()` ASSUMED. Its reasoning was that dropping a day is only interesting for
        someone with sessions to move, and that is true right up to the point where they have so
        many that nothing can move. OTH's busiest lecturer holds 24 of 35 slots, so freeing Friday
        leaves the solver nowhere to put the overflow and `propose_repairs` correctly answers
        `no_candidate`. The app's own suggested question — the FIRST thing a visitor clicks —
        therefore led straight to the one cascade in the dataset that cannot be resolved.
        Measured: 11 of the 12 busiest lecturers are repairable, and exactly that one is not.

        So the pick is VERIFIED rather than assumed: candidates are tried busiest-first and the
        first whose Friday cascade actually resolves is returned. Still the busiest teacher it can
        honestly offer, just not one whose answer is an apology.

        Cached, because this runs the solver. Falls back to the busiest name if none resolve — a
        suggestion that might fail is better than an empty chat with no way in.
        """
        if self._demo_teacher_ready:
            return self._demo_teacher

        self._demo_teacher = self._pick_demo_teacher()
        self._demo_teacher_ready = True
        return self._demo_teacher

    def _pick_demo_teacher(self) -> str | None:
        # Imported here, not at module scope: `tools` imports this module, and a top-level import
        # would be a cycle.
        from tools import get_affected_sessions, propose_repairs

        ranked = self.teachers_by_load()
        if not ranked:
            return None

        for teacher_id in ranked[:CANDIDATE_LIMIT]:
            name = (self.teacher_by_id.get(teacher_id) or {}).get("name")
            if not name:
                continue
            affected = get_affected_sessions(self, name, day=DEMO_DAY)
            session_ids = [s["sessionId"] for s in affected.get("sessions", [])]
            if not session_ids:
                continue
            # ⚠️ `forbid` IS THE WHOLE SCENARIO, AND LEAVING IT OUT MAKES THIS CHECK VACUOUS.
            # Without it the solver is free to put every session back exactly where it was, so
            # "can this cascade be repaired" is answered by the identity move and EVERY candidate
            # passes. Measured on OTH: 6 of 6 candidates "resolved" unconstrained, while with the
            # constraint the busiest — the one this function exists to avoid — is the single
            # `no_candidate`. The unconstrained version therefore picked precisely the broken name
            # it was written to reject, and looked verified doing it.
            repair = propose_repairs(
                self,
                session_ids,
                k=1,
                forbid=[{"teacher": teacher_id, "day": DEMO_DAY}],
                time_limit_s=DEMO_SOLVE_S,
            )
            if not repair.get("error") and repair.get("options"):
                return name

        # ⚠️ NO UNVERIFIED FALLBACK. This used to return the busiest teacher when nothing passed,
        # which is the exact name the check is meant to rule out — a silent path straight back to
        # the defect. `None` is already a supported answer (TUM returns it, because its lecturers
        # are not published), and the UI omits the suggested question rather than offering one the
        # solver will refuse.
        return None

    def teachers_by_load(self) -> list[str]:
        """Teacher ids, most sessions first. Ties broken by id so the pick is reproducible."""
        counts: dict[str, int] = defaultdict(int)
        for session in self.sessions:
            counts[session["teacherId"]] += 1
        return sorted(counts, key=lambda k: (-counts[k], k))

    def busiest_teacher(self) -> str | None:
        """The teacher with the most sessions. See `demo_teacher()` before using this in the UI.

        ⚠️ THE UI USED TO HARD-CODE ONE. 'Prof. Hinterberger' is a name from the OTH surname pool,
        and it was still the suggested question in the LMU build — where no such person exists, so
        the assistant's first answer to the demo's first click would have been that it cannot find
        them. A name shown to a user has to come from the dataset being served.

        ⚠️ THIS IS NO LONGER WHAT THE EXAMPLE QUESTION USES. "Busiest" was chosen because dropping
        a day is only interesting for someone with sessions to move; it turned out to select the one
        lecturer whose cascade is unrepairable. `demo_teacher()` verifies instead of assuming.
        """
        ranked = self.teachers_by_load()
        if not ranked:
            return None
        return (self.teacher_by_id.get(ranked[0]) or {}).get("name")


# ── one process, many universities ──────────────────────────────────────────────────────
#
# ⚠️ LAZY AND CACHED, DELIBERATELY. Loading every dataset at import would make a container that is
# only ever asked about one university pay for all of them, which is the memory cost the old
# one-site-per-container design was right to avoid. A store is built the first time its university
# is actually asked about, and kept because `demo_teacher()` memoises a solver run on it.
_STORES: dict[str, "ScheduleStore"] = {}


def _fold(text: str) -> str:
    """Lower-case and strip German diacritics, so "Beutlhäuser" and "Beutlhauser" are one name.

    ⚠️ THE GENERATED SURNAME POOL IS MOSTLY ASCII AND THE PLANNER IS NOT. Measured: 3 of OTH's 80
    lecturers carry an umlaut and 7 of LMU's 102, so most Bavarian surnames are stored flattened —
    `Beutlhauser`, `Neuhauser`, `Girnghuber`. A German speaker types `Beutlhäuser`, which matched
    nothing, and the lookup answered "no such lecturer" about somebody plainly in the list.

    ⚠️ BOTH SIDES MUST USE THIS, WHICH IS THE MISTAKE WORTH NAMING. A normaliser applied to only
    one side is worse than none: it silently changes which names are reachable rather than fixing
    the comparison, and this project has already shipped that once with a stopword list where
    "universität" survived a filter written as "universitat".

    Diacritics only — NOT the `ue` → `u` digraph collapse. That would fold "Bauer" to "Baur" and
    make two different surnames the same, which is the confident-wrong failure this whole lookup
    is being hardened against. A planner who types "Mueller" for "Müller" gets the near-miss
    suggestion instead, which is the honest answer to a genuinely ambiguous spelling.
    """
    lowered = (text or "").strip().lower().replace("ß", "ss")
    return "".join(
        c for c in unicodedata.normalize("NFKD", lowered) if not unicodedata.combining(c)
    )


def store_for(site: str | None = None) -> "ScheduleStore":

    """The store for one university, built on first use.

    Raises `KeyError` for an unknown site — see `resolve_site`. Callers at the HTTP edge must turn
    that into a 4xx rather than letting it fall back to the default university.
    """
    chosen = resolve_site(site)
    if chosen not in _STORES:
        _STORES[chosen] = ScheduleStore.load(chosen)
    return _STORES[chosen]


def reload_store(site: str | None = None) -> "ScheduleStore":
    """Throw away everything published in this process and re-read the baked dataset.

    ⚠️ THIS IS THE ONLY WAY BACK TO THE SHIPPED PLAN, and it exists because there was no way at
    all. `publish` mutates the assignment rows in place and there is no rollback, so once a plan
    had been published the process served it until the container recycled. Somebody trying to get
    a clean slate had to guess — and truncating the SQL tables by hand does NOT do it, because the
    drafts and the published plan live in this process's memory, not in the database.

    Rebuilding from `load()` rather than un-applying the moves: the dataset on disk is the
    definition of the baseline, so re-reading it cannot drift, whereas reversing a list of moves
    is only as good as the record of what they were.
    """
    chosen = resolve_site(site)
    _STORES[chosen] = ScheduleStore.load(chosen)
    return _STORES[chosen]

"""Campus-Scheduler backend: scheduling tools + a Foundry agent that calls them.

Same shape as the wind-farm digital twin's Container App (PLAN §4): a thin service that owns the
Azure OpenAI conversation and the deterministic tools, with an app-key gate in front so the
static Fabric app can reach it without exposing the model endpoint.

  GET  /api/health              what is loaded and whether Foundry is configured
  GET  /api/plan/summary        counts for the cockpit header
  POST /api/tools/{name}        call a tool directly — no LLM involved
  POST /api/assistant/stream    NDJSON: the agent, calling those same tools

⚠️ The tools are reachable WITHOUT the agent on purpose. A planner has to be able to press a
button and get the same answer the chat gave, or the chat becomes the only witness to its own
claims.

    uvicorn app:app --port 8080 --app-dir server
"""

from __future__ import annotations

import json
import os
import re
import time
import unicodedata
from collections import deque
from datetime import datetime, timezone
from typing import Any, Iterator

from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
# ⚠️ The Untis connection test blocks on a socket. Off the event loop it goes, or one planner
# pressing "test" against an unresponsive server stalls every other request for the timeout.
from starlette.concurrency import run_in_threadpool

import availability_xlsx
import untis
from foundry import FoundryClient, FoundryConfig
from calendar_view import calendar_suggestions, calendar_view
import proposals
from schedule_store import ScheduleStore, known_sites, reload_store, store_for
from tools import TOOL_IMPLEMENTATIONS

APP_KEY = os.getenv("BACKEND_APP_KEY", "")

# ⚠️ X-App-Key is NOT a secret. It is compiled into the Vite bundle, and that bundle is served
# anonymously from the Fabric static host — a plain GET of /assets/index-*.js returns it to anyone.
# It stops a casual caller who has not looked, and nothing more. It is a speed bump, not auth.
#
# The exposure that matters is cost: /api/assistant/stream spends Azure OpenAI tokens per call.
# So the two controls below do not pretend to authenticate anyone; they cap the blast radius.
# ⚠️ DEFAULTS TO NOTHING, NOT TO A HOSTNAME. This used to default to the one Fabric host this
# app happened to be deployed on, which meant every clone of this template shipped somebody
# else's origin in its allowlist and none of its own. An empty list plus the loopback regex below
# is the honest default: local development works, and a deployment must name its own origin
# through ALLOWED_ORIGINS. Getting that wrong fails visibly in the browser, which is the right
# direction for a security control to fail in.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]

# Loopback on ANY port, rather than a list of dev ports. Vite auto-increments when its port is
# taken, so a stale dev server from another repo silently moves this app to 4177 and a hard-coded
# 4175 stops matching — which is exactly how this broke once already, and it presented as the
# assistant "not answering" rather than as a CORS error anyone would look for.
#
# This is not a hole worth worrying about: a page an attacker controls cannot be served from the
# victim's own loopback, so 127.0.0.1 is not a useful origin to forge.
ALLOWED_ORIGIN_REGEX = os.getenv(
    "ALLOWED_ORIGIN_REGEX", r"http://(localhost|127\.0\.0\.1)(:\d+)?"
)

# Per-IP ceiling on the expensive endpoint. Deliberately crude: an in-process deque, because the
# app runs a single replica and a real limiter would need shared state this demo does not have.
ASSISTANT_CALLS_PER_HOUR = int(os.getenv("ASSISTANT_CALLS_PER_HOUR", "60"))
_calls: dict[str, deque[float]] = {}

app = FastAPI(title="Campus-Scheduler backend", version="0.1.0")
app.add_middleware(
    # An explicit list, not "*". This does not stop curl — nothing sent from a browser can — but it
    # does stop another origin's page from spending this subscription's tokens in a visitor's tab.
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-App-Key"],
)

#: The default deployment's store, kept so a request that names no site behaves exactly as it did
#: when one container served one university.
store = ScheduleStore.load()
config = FoundryConfig()
client = FoundryClient(config)


def _store(site: str | None) -> ScheduleStore:
    """The store for the university this request is about.

    ⚠️ AN UNKNOWN SITE IS A 400, NOT THE DEFAULT. Falling back would answer a question about one
    university with another university's timetable, and the caller would have no way to tell — the
    exact failure `site-guard.spec.ts` exists to catch, arriving from the server side instead.
    """
    try:
        return store_for(site)
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail=f"unknown site '{site}' — known: {', '.join(known_sites())}",
        ) from None


def _check_key(x_app_key: str | None) -> None:
    # An empty BACKEND_APP_KEY means "local development" and the gate is off. In the deployed
    # container it is always set — see the Container App environment.
    if APP_KEY and x_app_key != APP_KEY:
        raise HTTPException(status_code=401, detail="bad or missing X-App-Key")


# German transliteration first, so a name survives as a German reader expects it. Doing this with
# NFKD alone turns "Obermüller" into "Obermuller", which is a different surname to anyone reading
# the folder — and these files are named after people who will read them.
_UMLAUTS = str.maketrans({
    "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss",
})


def _filename_part(text: str) -> str:
    """Fold one field into something safe to put in a Content-Disposition filename.

    ⚠️ ASCII ON PURPOSE. A raw `filename="…"` header is not UTF-8, so an umlaut here arrives
    mangled or gets the download rejected outright depending on the browser. The alternative is
    the RFC 5987 `filename*=` form, which is more machinery than a lecturer's name needs.

    Punctuation goes because "Prof. Dr. D. Danzer" would otherwise carry dots into a filename and
    invite something downstream to read ".xlsx" from the wrong one.
    """
    folded = unicodedata.normalize("NFKD", text.translate(_UMLAUTS))
    ascii_only = folded.encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", ascii_only).strip("_")
    # A name that folds away to nothing (all non-Latin) must not produce "Verfuegbarkeit_oth__.xlsx".
    return (cleaned or "unbenannt")[:60]


def _stamp() -> str:
    """`YYYY-MM-DD_HHMM` for the filename, in the university's own timezone.

    ⚠️ BERLIN, NOT UTC. The container runs UTC, so a file downloaded at 22:15 in Regensburg would
    be stamped `2015` and look like it came from the afternoon — worse than no timestamp, because
    it is confidently wrong about the one thing it exists to say.

    Date alone is not enough: availability gets corrected repeatedly during a planning session,
    and two downloads on the same day would collide in a Downloads folder with nothing but the
    browser's "(1)" to tell the newer from the older.
    """
    try:
        from zoneinfo import ZoneInfo

        now = datetime.now(ZoneInfo("Europe/Berlin"))
    except Exception:  # noqa: BLE001 - a slim image may ship no tzdata; a UTC stamp still beats none
        now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d_%H%M")


def _check_rate(request: Request) -> None:
    """Cap model spend per caller. Raises 429 once the hourly ceiling is reached."""
    if ASSISTANT_CALLS_PER_HOUR <= 0:
        return
    # Container Apps terminates TLS upstream, so the peer address is the ingress. X-Forwarded-For
    # is the only view of the real caller here — spoofable, which is fine: this is a cost cap, not
    # an identity check, and a spoofer still pays the cost of rotating addresses.
    forwarded = request.headers.get("x-forwarded-for", "")
    caller = forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")

    now = time.monotonic()
    window = _calls.setdefault(caller, deque())
    while window and now - window[0] > 3600:
        window.popleft()
    if len(window) >= ASSISTANT_CALLS_PER_HOUR:
        raise HTTPException(status_code=429, detail="hourly limit reached for this caller")
    window.append(now)


def _run_tool(name: str, args: dict[str, Any], st: ScheduleStore | None = None) -> dict[str, Any]:
    fn = TOOL_IMPLEMENTATIONS.get(name)
    if not fn:
        return {"error": "unknown_tool", "name": name}
    target = st or store
    try:
        result = fn(target, **args)
    except TypeError as exc:
        return {"error": "bad_arguments", "name": name, "message": str(exc)}
    except Exception as exc:  # noqa: BLE001 - a tool failure must not kill the stream
        return {"error": "tool_failed", "name": name, "message": str(exc)}

    # ⚠️ REGISTER THE OPTIONS HERE, NOT IN THE AGENT LOOP. Until now only `foundry.py` did this, so
    # a repair reached through the chat could be confirmed and an identical repair reached by
    # calling the tool directly could not — the caller got the moves but no `proposalId`, and
    # `/api/draft/apply` takes an id. That made the confirm gate an accident of which door you came
    # through.
    #
    # The reason an id exists at all is unchanged: `propose_repairs` returns SEVERAL equal-cost
    # optima, so re-solving when the planner clicks "übernehmen" may legitimately return a different
    # answer than the one on screen. Storing the options is what makes "apply" mean "apply THAT".
    if name == "propose_repairs" and isinstance(result, dict):
        options = result.get("options") or []
        if options and not result.get("proposalId"):
            result = {
                **result,
                "proposalId": proposals.register(
                    options, question=str(args), site=target.site
                ),
                "options": proposals.summarise(options),
            }
    return result


@app.get("/api/health")
def health(x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Liveness for anyone; the estate only for a caller that holds the key.

    ⚠️ THIS ROUTE WAS ANSWERING A STRANGER IN FULL, and what it said was worse than the room count.
    Probed from a clean client with no credentials it returned the university's name, its session,
    teacher, cohort, room and building counts, a real-looking lecturer name — and
    `foundry.endpoint`, which is the address of an internal Azure OpenAI resource. Naming your own
    model endpoint to the open internet is free reconnaissance; the counts are merely a briefing.

    ⚠️ AND IT MUST NOT SIMPLY BE GATED. The route is a health check: Container Apps and every
    deploy verifier reach it before they hold anything, so requiring a key here risks taking the
    service down to protect a room count. The fix is therefore to say LESS, not to answer less
    often. `status` and whether a key is required stay public, because a caller has to be able to
    discover that it needs one; everything describing the estate or the infrastructure moves behind
    the key.
    """
    public: dict[str, Any] = {"status": "ok", "appKeyRequired": bool(APP_KEY)}
    if APP_KEY and x_app_key != APP_KEY:
        return public
    return {
        **public,
        "data": store.summary(),
        # Which universities this container can answer for. One image now serves all of them
        # (PLAN §21.1), so "what am I" is a list rather than a single name.
        "sites": known_sites(),
        "defaultSite": store.site,
        "foundry": config.status(),
        "tools": sorted(TOOL_IMPLEMENTATIONS),
    }


@app.get("/api/plan/summary")
def plan_summary(
    site: str = "",
    x_app_key: str | None = Header(default=None),
) -> dict[str, Any]:
    # Nothing probes this one, so it is gated outright — it is a description of the estate and its
    # utilisation, which is the substance of the demo rather than a liveness signal.
    _check_key(x_app_key)
    st = _store(site or None)
    room_slot, _, _ = st.occupied()
    teaching = [r for r in st.rooms if r.get("schedulable")]
    return {
        **st.summary(),
        "teachingRoomUtilisation": round(len(room_slot) / max(1, len(teaching) * len(st.slots)), 4),
        "campuses": sorted({b["campusId"] for b in st.buildings}),
    }


# ── Calendar (PLAN §13.3) ────────────────────────────────────────────────────────────────
#
# GET, and not registered as an agent tool. The calendar is how a human checks the agent's claim,
# so it deliberately does not sit in the same surface the agent can reach — see §13.2.
@app.get("/api/calendar")
def calendar(
    scope: str = "teacher",
    key: str = "",
    draftId: str = "",  # noqa: N803 - query names are the client's vocabulary
    site: str = "",
    x_app_key: str | None = Header(default=None),
) -> dict[str, Any]:
    _check_key(x_app_key)
    st = _store(site or None)
    rows = proposals.assignments_for(st, draftId or None)
    return calendar_view(st, scope, key, assignments=rows, draft_id=draftId or None)


@app.get("/api/calendar/suggestions")
def calendar_suggestions_endpoint(
    scope: str = "teacher",
    site: str = "",
    x_app_key: str | None = Header(default=None),
) -> dict[str, Any]:
    _check_key(x_app_key)
    return {"scope": scope, "subjects": calendar_suggestions(_store(site or None), scope)}


# ── Proposals and drafts (PLAN §13.2) ────────────────────────────────────────────────────
#
# ⚠️ NONE OF THESE IS AN AGENT TOOL. `/api/draft/apply` is the only thing in this service that
# changes a plan, and it is reachable exclusively over HTTP by a human-driven client. The agent's
# surface is `TOOL_SCHEMAS`, which does not mention it — so "the assistant cannot apply a change
# on its own" is a property of the wiring rather than a promise in a prompt.
@app.get("/api/proposal/{proposal_id}")
def proposal_diff(
    proposal_id: str,
    option: int = 1,
    site: str = "",
    x_app_key: str | None = Header(default=None),
) -> dict[str, Any]:
    _check_key(x_app_key)
    return proposals.diff(_store(site or None), proposal_id, option)


@app.post("/api/draft/apply")
async def draft_apply(request: Request, x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    _check_key(x_app_key)
    body = await request.json() or {}
    proposal_id = (body.get("proposalId") or "").strip()
    confirmed_by = (body.get("confirmedBy") or "").strip()
    # Both are required rather than defaulted. A confirmation the caller did not have to supply is
    # indistinguishable from no confirmation at all.
    if not proposal_id or not confirmed_by:
        raise HTTPException(
            status_code=400,
            detail="proposalId and confirmedBy are both required",
        )
    return proposals.apply(
        _store((body.get("site") or "").strip() or None),
        proposal_id,
        int(body.get("option") or 1),
        confirmed_by,
        body.get("label"),
    )


@app.post("/api/draft/restore")
async def draft_restore(request: Request, x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Rebuild a draft from changes the client read back out of durable storage.

    The plan the app shows is the baked baseline plus the decisions that were saved against it.
    This is what turns those decisions back into a plan the SOLVER also knows about — replaying
    them only in the browser would leave every conflict count and every new proposal reasoning
    about a plan that no longer exists, which is worse than not replaying at all.
    """
    _check_key(x_app_key)
    body = await request.json() or {}
    moves = body.get("moves") or []
    if not isinstance(moves, list) or not moves:
        raise HTTPException(status_code=400, detail="moves must be a non-empty list")
    return proposals.restore(
        _store((body.get("site") or "").strip() or None),
        moves,
        (body.get("restoredBy") or "").strip(),
        body.get("label"),
    )


@app.post("/api/plan/publish")
async def plan_publish(request: Request, x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Make a draft THE published plan — the step this product did not have.

    ⚠️ THIS IS THE ONLY ROUTE THAT CHANGES THE PLAN EVERY OTHER READER SEES. Confirming a repair
    creates a draft and says `publishedUntouched: true`; that guarantee is what makes previewing
    safe, so promoting one has to be a separate act with a name, an author and an audit entry
    rather than a flag on the same call.

    ⚠️ IT DOES NOT SURVIVE THIS PROCESS ON ITS OWN. The backend has no database client and scales
    to zero, so the client must ALSO write the moves to Fabric SQL and replay them with
    `mode: "replay"` on a cold start. The response says `durable: false` so a caller cannot mistake
    a successful publish for a persisted one.

    Three modes, deliberately separate verbs on one route:
      draftId          — a planner promoting everything they previewed. Re-checked; refused if stale.
      moves            — a planner promoting a SELECTION of saved changes. Re-checked the same way,
                         because cherry-picking part of a cascade can reopen the clash the rest of
                         it was closing.
      moves + replay   — a cold process rebuilding a plan that was already published. Not gated.
    """
    _check_key(x_app_key)
    body = await request.json() or {}
    store = _store((body.get("site") or "").strip() or None)

    moves = body.get("moves")
    if moves:
        if not isinstance(moves, list):
            raise HTTPException(status_code=400, detail="moves must be a list")
        result = proposals.publish_moves(
            store, moves, (body.get("publishedBy") or "").strip(), body.get("label"),
            replay=bool(body.get("replay")),
        )
    else:
        draft_id = (body.get("draftId") or "").strip()
        if not draft_id:
            raise HTTPException(status_code=400, detail="draftId or moves is required")
        result = proposals.publish(store, draft_id, (body.get("publishedBy") or "").strip())

    if result.get("error"):
        # A refusal is an answer, not a server fault: the planner asked whether this may become the
        # plan and was told no, with a reason they can act on.
        return {**result, "planVersion": store.plan_version, "durable": False}
    return {**result, "durable": False}


@app.post("/api/plan/reset")
async def plan_reset(request: Request, x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Back to the plan as shipped: no drafts, no publications, the baked dataset.

    ⚠️ THIS EXISTS BECAUSE CLEARING THE SQL TABLES BY HAND DOES NOT WORK, and nothing said so.
    Drafts and the published plan live in THIS PROCESS's memory; `dbo.PlanChanges` is a log the
    app replays, not the state it serves. Truncating that table leaves every draft exactly where
    it was, which reads as a delete that failed. It also leaves `dbo.PlanAssignments` untouched —
    a different table, still holding the `change` and `published` rows — so the two disagree, and
    the next cold start replays a plan whose history has been erased.

    So a reset is three things at once, and the caller must do the third: this drops the drafts and
    re-reads the dataset, and the CLIENT puts the non-baseline rows back. Doing only part of it is
    what produced the half-cleared state this endpoint is named after.

    ⚠️ IT ANSWERS WITH THE BAKED POSITIONS, BECAUSE "RESET" IS NOT "DELETE". `dbo.PlanAssignments`
    holds ONE row per session — a saved move OVERWRITES that session's baseline row rather than
    adding to it — so a client that resets by deleting every non-baseline row does not restore the
    session, it ERASES it. Measured: a reset over three moved sessions left the table with 1 922
    rows where 1 925 belong, and one lecturer's week showed five sessions instead of six. The
    missing row is unrecoverable from the table itself; only the baked dataset knows where those
    sessions belong, and this process has just re-read it. So the caller sends the session ids it
    holds dirty rows for and gets their shipped positions back, in the same round trip that
    guarantees the store was reloaded first.
    """
    _check_key(x_app_key)
    body = await request.json() or {}
    site = (body.get("site") or "").strip() or None
    store = _store(site)
    dropped = proposals.discard_all(store.site)
    fresh = reload_store(store.site)

    wanted = [str(s) for s in (body.get("sessionIds") or []) if s]
    baseline: list[dict[str, Any]] = []
    unknown: list[str] = []
    for sid in wanted:
        row = fresh.assignment_by_session.get(sid)
        if row is None:
            # A row for a session the shipped dataset does not contain: the client may delete that
            # one, and is told so rather than left to infer it from an absence.
            unknown.append(sid)
            continue
        baseline.append(
            {
                "sessionId": sid,
                "slotId": row.get("slotId", ""),
                "roomId": row.get("roomId", ""),
                "buildingId": row.get("buildingId", ""),
                "campusId": row.get("campusId", ""),
            }
        )

    return {
        "site": fresh.site,
        "draftsDropped": dropped,
        "planVersion": fresh.plan_version,
        "assignments": len(fresh.assignments),
        "baseline": baseline,
        "unknownSessions": unknown,
        # Stated so nobody reads a successful reset as "the database is clean".
        "storeRowsUntouched": True,
    }


@app.get("/api/availability")
def availability_get(site: str = "", teacher: str = "",
                     x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    """One lecturer's week: which slots they can teach, and where they already do."""
    _check_key(x_app_key)
    store = _store(site or None)
    if not teacher:
        return {"error": "teacher_required"}
    return store.availability_for(teacher)


@app.post("/api/availability")
async def availability_set(request: Request,
                           x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Change when one lecturer can teach.

    ⚠️ THIS DOES NOT MOVE ANYTHING, AND THE ANSWER SAYS SO. Blocking a slot somebody already
    teaches in makes the current plan illegal rather than wrong — `nowInConflict` lists exactly
    which sessions, and the caller is expected to show that number rather than a bare "saved".
    Repairing it is the cascade, and the cascade is a separate, confirmed act.
    """
    _check_key(x_app_key)
    body = await request.json() or {}
    store = _store((body.get("site") or "").strip() or None)
    result = store.set_availability(
        (body.get("teacher") or "").strip(),
        body.get("entries") or [],
        (body.get("changedBy") or "").strip(),
    )
    # ⚠️ Durability is the caller's half, exactly as it is for publish: this process scales to
    # zero. Saying so in the payload keeps a UI from promising permanence the server cannot give.
    return {**result, "durable": False}


@app.get("/api/availability/template")
def availability_template(site: str = "", teacher: str = "", key: str = "",
                          x_app_key: str | None = Header(default=None)) -> Response:
    """The spreadsheet a planner fills in — pre-filled with what we currently believe.

    ⚠️ PRE-FILLED, NOT BLANK. An empty grid asks somebody to retype what the system already knows
    and invites a silent overwrite with defaults; a filled one asks them to correct it, and the
    difference is the whole point of sending it out.

    ⚠️ `?key=` IS ACCEPTED HERE AND NOWHERE ELSE. A download happens by navigating, and a
    navigation cannot carry a custom header — so the gate would make the file unreachable from a
    plain link. It costs nothing: the app key is compiled into the anonymously-served bundle
    (PLAN §16) and has never been a secret. It is not accepted on any route that WRITES.
    """
    _check_key(x_app_key if x_app_key is not None else (key or None))
    store = _store(site or None)
    data = availability_xlsx.build_template(store, teacher or None)

    # ⚠️ THE PERSON'S NAME, NOT THEIR KÜRZEL. This file is mailed to a lecturer and mailed back;
    # `Verfuegbarkeit_oth_IM-T007.xlsx` tells the recipient nothing and tells the planner sorting
    # a folder of returns even less. `IM-T007` is still inside the sheet, in the Kürzel column, so
    # the import path is unaffected by what the file happens to be called.
    who = "alle"
    if teacher:
        found = store.find_teacher(teacher)
        # Fall back to what was asked for rather than inventing a name: an id that resolves to
        # nobody is a real state here (a stale link), and a file called "alle" would be a lie.
        who = (found or {}).get("name") or teacher
    name = f"Verfuegbarkeit_{store.site}_{_filename_part(who)}_{_stamp()}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.post("/api/availability/import")
async def availability_import(file: UploadFile = File(...), site: str = "", apply: bool = False,
                              changed_by: str = "",
                              x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Read a returned spreadsheet. With `apply=false` (the default) it writes NOTHING.

    ⚠️ TWO STEPS ON PURPOSE. A file that has been round-tripped through somebody's laptop can
    carry a deleted column, a renamed sheet or the word "Urlaub" where a state belongs. The
    planner sees what it would do — how many lecturers, how many changes, what could not be read —
    and then decides. A one-click import of a file nobody has looked at is how an availability
    table quietly loses a morning somebody said they could not teach.
    """
    _check_key(x_app_key)
    store = _store(site or None)
    raw = await file.read()
    parsed = availability_xlsx.parse_upload(store, raw)
    if parsed.get("error"):
        return parsed

    changes: list[dict] = []
    for tid, entries in parsed["teachers"].items():
        current = {a["slotId"]: a["state"] for a in store.availability if a["teacherId"] == tid}
        diff = [e for e in entries if current.get(e["slotId"], "verfuegbar") != e["state"]]
        if diff:
            # ⚠️ WHAT IT WOULD BREAK, COMPUTED WITHOUT WRITING. A dry run that reports only "4
            # changes" has answered the easy half; the half a planner is actually deciding on is
            # how many of that lecturer's own lectures the change makes illegal. Measured on the
            # live app before this existed: a sheet blocking four slots the lecturer teaches in
            # previewed as four changes and said nothing about the four lectures affected.
            would = store.sessions_blocked_by(tid, {e["slotId"]: e["state"] for e in diff})
            changes.append({"teacherId": tid, "teacher": parsed["names"].get(tid, ""),
                            "entries": diff, "changed": len(diff),
                            "wouldConflict": would})

    summary = {
        "fileName": file.filename,
        "sheet": parsed["sheet"],
        "teachersRead": len(parsed["teachers"]),
        "teachersChanged": len(changes),
        "changes": changes,
        # The same number the per-lecturer entries carry, totalled, so a caller showing one line
        # does not have to add it up and risk showing a different figure from the detail below.
        "wouldConflict": [s for c in changes for s in c["wouldConflict"]],
        "unknownTeachers": parsed["unknownTeachers"],
        "unknownColumns": parsed["unknownColumns"],
        "badValues": parsed["badValues"],
        "applied": False,
    }
    if not apply:
        return summary

    results = []
    for c in changes:
        results.append(store.set_availability(c["teacherId"], c["entries"], changed_by))
    return {**summary, "applied": True, "results": results,
            "nowInConflict": [s for r in results for s in r.get("nowInConflict", [])],
            "durable": False}


@app.get("/api/plan/publications")
def plan_publications(site: str = "", x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Who published what, and when. The plan itself does not record how it came to be."""
    _check_key(x_app_key)
    store = _store(site or None)
    return {
        "planVersion": store.plan_version,
        "publications": store.publications,
        # Stated rather than implied: this list is as old as the process, and a reader comparing it
        # with the durable record needs to know which of the two can be short.
        "durable": False,
    }


@app.get("/api/drafts")
def drafts(site: str = "", x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    _check_key(x_app_key)
    # Scoped: an unscoped list would show one university's planner the other universities' drafts.
    store = _store(site or None)
    return {
        "drafts": proposals.list_drafts(store.site),
        "published": "published",
        "planVersion": store.plan_version,
    }


@app.get("/api/integration/status")
def integration_status(site: str = "", x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Which source is feeding this site, and whether the API is configured at all.

    ⚠️ CONFIGURED IS NOT CONNECTED, and this endpoint deliberately does not blur them. It performs
    no network call: opening a settings panel must not fire a login attempt at somebody's WebUntis
    server, and a status that quietly went off and tried would also make the panel as slow as the
    slowest thing it can reach. Pressing the button is what tries.
    """
    _check_key(x_app_key)
    store = _store(site or None)
    cfg = untis.UntisConfig.from_env()
    return {
        "site": store.site,
        "sources": [
            untis.describe_file_source(store),
            {
                "id": "webuntis",
                "label": "WebUntis API",
                "active": False,
                "state": "configured" if cfg.configured else "unconfigured",
                "config": cfg.public(),
                "note": (
                    "Zugangsdaten kommen aus der Umgebung des Backends (UNTIS_SERVER, "
                    "UNTIS_SCHOOL, UNTIS_USER, UNTIS_PASSWORD) und werden nie an den Browser "
                    "zurückgegeben."
                ),
            },
        ],
        "writeback": untis.writeback_readiness(),
    }


@app.post("/api/integration/untis/test")
async def integration_untis_test(
    request: Request, x_app_key: str | None = Header(default=None)
) -> dict[str, Any]:
    """Actually attempt a WebUntis login and report what happened.

    ⚠️ THE BODY MAY OVERRIDE THE ENVIRONMENT, WHICH IS THE WHOLE POINT AND ALSO THE RISK. Being
    able to try a server before anyone puts it in a container's environment is what makes this
    usable during a call with OTH. It also means an arbitrary caller can name the host this backend
    connects to — server-side request forgery — so `untis._safe_endpoint` refuses anything that is
    not https on a publicly-routable address, and fixes the path itself.

    Nothing from the request is persisted. A test is a test; storing a password because someone
    typed it into a text box is how a credential ends up somewhere nobody remembers putting it.
    """
    _check_key(x_app_key)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 — an empty body means "test what is configured"
        body = {}
    if not isinstance(body, dict):
        body = {}

    env_cfg = untis.UntisConfig.from_env()
    cfg = untis.UntisConfig(
        server=str(body.get("server") or env_cfg.server).strip(),
        school=str(body.get("school") or env_cfg.school).strip(),
        username=str(body.get("username") or env_cfg.username).strip(),
        # Falling back to the environment password lets the panel re-test a stored login without
        # ever having been sent it.
        password=str(body.get("password") or env_cfg.password),
    )
    return await run_in_threadpool(untis.test_connection, cfg)


@app.delete("/api/draft/{draft_id}")
def draft_discard(draft_id: str, x_app_key: str | None = Header(default=None)) -> dict[str, Any]:
    _check_key(x_app_key)
    return {"discarded": proposals.discard(draft_id), "draftId": draft_id}


@app.post("/api/tools/{name}")
async def call_tool(
    name: str,
    request: Request,
    site: str = "",
    x_app_key: str | None = Header(default=None),
) -> dict:
    _check_key(x_app_key)
    try:
        args = await request.json()
    except Exception:  # noqa: BLE001 - an empty body is a legitimate no-argument call
        args = {}
    return _run_tool(name, args or {}, _store(site or None))


@app.post("/api/assistant/stream")
async def assistant_stream(
    request: Request,
    site: str = "",
    x_app_key: str | None = Header(default=None),
):
    _check_key(x_app_key)
    _check_rate(request)
    body = await request.json()
    prompt = (body or {}).get("prompt", "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    # Resolved BEFORE the stream opens, so an unknown site is a 400 rather than an error event
    # halfway through a response that has already introduced itself as some university.
    st = _store(site or (body or {}).get("site") or None)

    def events() -> Iterator[bytes]:
        # ⚠️ The client does NOT render this text — `PlannerChat` shows its own translated line
        # keyed on the event type, because prose written here cannot follow the interface language
        # and cannot be changed without redeploying the container. Kept readable for log-reading.
        yield _line({"type": "status", "message": "Frage wird geprüft und durchgerechnet ..."})
        for event in client.stream_with_tools(
            prompt, lambda name, args: _run_tool(name, args, st), site=st.site
        ):
            yield _line(event)

    return StreamingResponse(events(), media_type="application/x-ndjson")


def _line(obj: dict) -> bytes:
    return (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")

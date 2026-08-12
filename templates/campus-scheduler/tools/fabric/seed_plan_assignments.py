"""Load the whole timetable into dbo.PlanAssignments, so no assignment lives only in the app.

WHY A TOOL AND NOT THE APP. The requirement is that every assignment is queryable in SQL. The app
upserts a session when a planner MOVES it, which covers the rows that are not reproducible from
anything else — but a reader querying the table would still see only the edits. The other ~1 965
rows are the baked baseline, and something has to put them there once.

WHY TDS AND NOT THE DATA LAYER. Rayfin's data-plane endpoint wants a Rayfin session, which exists
only inside the hosted app: it rejects the publishable key alone and rejects a Power BI token. So
this connects to the Fabric SQL database directly with an AAD token, the same way the table itself
was verified.

⚠️ THE ID MUST MATCH `assignmentId()` IN `src/api/planStore.ts`, BYTE FOR BYTE. Both writers key a
row on site + sessionId, and if the two disagree by so much as a nibble the app's upsert misses the
seeded row and INSERTS A SECOND ONE — leaving two rows claiming to be the current position of the
same session, which is precisely the failure this table exists to prevent. The algorithm is
reimplemented here rather than approximated, and `--verify-ids` checks a sample against values
computed by the TypeScript so the duplication cannot drift silently.

    python tools/fabric/seed_plan_assignments.py --site oth --dry-run
    python tools/fabric/seed_plan_assignments.py            # both sites, writes, prunes
    python tools/fabric/seed_plan_assignments.py --no-prune # leave stale baseline rows in place
"""

from __future__ import annotations

import argparse
import json
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SITES = {
    "oth": ROOT / "data" / "synthetic",
    "lmu": ROOT / "data" / "synthetic-lmu",
}

# Fabric SQL database `campus-scheduler` in workspace `Rayfin Apps`.
SERVER = "ngetv7da5wve3ew7d7pu75n4cu-bm4esur7kqvu5k32hhk245rt5a.database.fabric.microsoft.com,1433"
DATABASE = "campus-scheduler-48542a7b-b62d-4070-8ce8-e3c33f5cb652"


def assignment_id(site: str, session_id: str) -> str:
    """The same deterministic UUID the app computes — see the warning in the module docstring.

    FNV-1a over `${site}:${sessionId}`, four salted passes to fill 16 bytes, folded into the
    RFC-4122 v4 layout. The version and variant nibbles are set only so a uniqueidentifier column
    accepts the value; this is a stable identifier, not a random or a secure one.
    """
    key = f"{site}:{session_id}"
    parts = []
    for salt in range(4):
        h = (0x811C9DC5 ^ salt) & 0xFFFFFFFF
        for ch in key:
            h ^= ord(ch)
            h = (h * 0x01000193) & 0xFFFFFFFF
        parts.append(f"{h:08x}")
    raw = "".join(parts)
    return "-".join(
        [
            raw[0:8],
            raw[8:12],
            "4" + raw[13:16],
            f"{(int(raw[16], 16) & 0x3) | 0x8:x}" + raw[17:20],
            raw[20:32],
        ]
    )


def token() -> bytes:
    """An AAD access token for the SQL data plane, packed the way the ODBC driver wants it."""
    raw = subprocess.run(
        ["az", "account", "get-access-token", "--resource", "https://database.windows.net/",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True, shell=True,
    ).stdout.strip()
    encoded = raw.encode("utf-16-le")
    return struct.pack("<i", len(encoded)) + encoded


#: The order `rows_for()` emits, and the order the MERGE parameters expect.
#:
#: ⚠️ THIS EXISTS BECAUSE ADDING ONE COLUMN SILENTLY BROKE THE GATE. `verify_plan_assignments.py`
#: read the slot and room out of these tuples as `[7]` and `[8]`; inserting `teacher` at index 6
#: shifted everything after it, and the gate then reported all 1 954 rows as drifted with messages
#: like "slot Mo-3->IM-WIRT-3" — a cohort id where a slot was expected. The data was correct and
#: the checker was reading the wrong fields. Consumers now resolve positions BY NAME from here.
COLUMNS = (
    "id", "site", "sessionId", "courseId", "course", "teacherId", "teacher", "cohortId",
    "slotId", "roomId", "buildingId", "campusId", "frozen", "source", "updatedBy",
)


def rows_for(site: str) -> list[tuple]:
    folder = SITES[site]
    assignments = json.loads((folder / "plan_assignment.json").read_text(encoding="utf-8"))
    courses = {c["courseId"]: c for c in json.loads((folder / "course.json").read_text(encoding="utf-8"))}
    # ⚠️ THE LECTURER'S NAME IS DENORMALISED IN, EXACTLY AS THE COURSE TITLE ALREADY IS.
    # `teacherId` alone resolves to nothing in this database: the lecturers live in the baked
    # datasets, and the warehouse is a downstream reporting mirror rather than a normalised schema.
    # The obvious repair — joining to `dbo.Users` — cannot work and fails three ways at once:
    # `Users` is EMPTY, its `Id` is a `uniqueidentifier` against an nvarchar `'IM-T009'` (SQL Server
    # raises "Conversion failed when converting from a character string to uniqueidentifier"), and
    # the two are different domains anyway — `Users` is who SIGNED IN, not who teaches.
    teachers = {
        t["teacherId"]: t
        for t in json.loads((folder / "teacher.json").read_text(encoding="utf-8"))
    }

    out = []
    for a in assignments:
        course = courses.get(a.get("courseId"), {})
        teacher = teachers.get(a.get("teacherId"), {})
        out.append(
            (
                assignment_id(site, a["sessionId"]),
                site,
                a["sessionId"],
                a.get("courseId") or "",
                (course.get("title") or course.get("name") or a.get("courseId") or "")[:200],
                a.get("teacherId") or "",
                (teacher.get("name") or "")[:200],
                a.get("cohortId") or "",
                a.get("slotId") or "",
                a.get("roomId") or "",
                a.get("buildingId") or "",
                a.get("campusId") or "",
                1 if a.get("frozen") else 0,
                "baseline",
                "tools/fabric/seed_plan_assignments.py",
            )
        )
    return out


#: Added after the table already existed, so the seeder brings its own column rather than needing a
#: migration step somebody has to remember to run.
ADD_TEACHER_COLUMN = """
IF COL_LENGTH('dbo.PlanAssignments', 'teacher') IS NULL
    ALTER TABLE dbo.PlanAssignments ADD teacher nvarchar(200) NULL;
"""


# ⚠️ MERGE, NOT INSERT. Seeding must be repeatable, and it must never overwrite a row a planner
# has moved: `WHEN MATCHED AND target.source = 'baseline'` leaves anything marked `change` alone.
# Re-running this after a planner has worked is therefore safe, which is the only way a seeding
# tool is any use.
MERGE = """
MERGE dbo.PlanAssignments AS target
USING (SELECT ? AS id, ? AS site, ? AS sessionId, ? AS courseId, ? AS course, ? AS teacherId,
              ? AS teacher, ? AS cohortId, ? AS slotId, ? AS roomId, ? AS buildingId,
              ? AS campusId, ? AS frozen, ? AS source, ? AS updatedBy) AS src
ON target.id = src.id
WHEN MATCHED AND target.source = 'baseline' THEN UPDATE SET
    site = src.site, sessionId = src.sessionId, courseId = src.courseId, course = src.course,
    teacherId = src.teacherId, teacher = src.teacher, cohortId = src.cohortId,
    slotId = src.slotId, roomId = src.roomId,
    buildingId = src.buildingId, campusId = src.campusId, frozen = src.frozen,
    source = src.source, updatedBy = src.updatedBy, updatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT
    (id, site, sessionId, courseId, course, teacherId, teacher, cohortId, slotId, roomId,
     buildingId, campusId, frozen, source, updatedBy, updatedAt)
    VALUES (src.id, src.site, src.sessionId, src.courseId, src.course, src.teacherId,
            src.teacher, src.cohortId, src.slotId, src.roomId, src.buildingId, src.campusId,
            src.frozen, src.source, src.updatedBy, SYSUTCDATETIME());
"""

# ⚠️ MERGE ALONE LEAVES THE TABLE STALE, AND IT DOES IT SILENTLY.
#
# MERGE updates what matches and inserts what is new, but it has no opinion about rows that are no
# longer produced by anything. Regenerating the timetable changed how cohorts are split —
# `MED-EPID-1-C1-G1-S1` became `MED-EPID-1-C1-ALL-S1` — so ~911 rows were left pointing at sessions
# that no longer exist while ~900 real sessions had no row at all. Every one of those rows still
# looked perfectly valid in SQL: a plausible course, in a plausible room, at a plausible hour. That
# is the whole problem. `lmu / MIS-MEDI-1-C4-G2-S1 / b 204` is what the user saw and reported as
# "data does not match the app".
#
# The prune keys on the SERVER's clock, not the client's, and not on a list of ids: every row this
# run touched gets `updatedAt = SYSUTCDATETIME()`, so a baseline row still carrying an older stamp
# is by definition one the current datasets did not produce.
#
# ⚠️ `source = 'baseline'` IS THE SAFETY RAIL AND IS NOT OPTIONAL. A planner's move is written as
# `change`; it is not reproducible from the datasets and must survive a re-seed. Dropping that
# predicate would make this tool delete exactly the rows that cannot be recreated.
PRUNE = """
DELETE FROM dbo.PlanAssignments
 WHERE site = ? AND source = 'baseline' AND updatedAt < ?;
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the plan into Fabric SQL.")
    parser.add_argument("--site", choices=sorted(SITES), help="only this site")
    parser.add_argument("--dry-run", action="store_true", help="build the rows, write nothing")
    parser.add_argument(
        "--no-prune",
        action="store_true",
        help="keep baseline rows the current datasets no longer produce (they will be stale)",
    )
    args = parser.parse_args()

    sites = [args.site] if args.site else sorted(SITES)
    batches = {site: rows_for(site) for site in sites}
    for site, rows in batches.items():
        print(f"{site}: {len(rows)} assignments  e.g. {rows[0][2]} -> {rows[0][8]} @ {rows[0][7]}")
        print(f"       id {rows[0][0]}")
    if args.dry_run:
        print("\ndry run — nothing written")
        return

    import pyodbc  # imported late so --dry-run works without a driver

    with pyodbc.connect(
        f"Driver={{ODBC Driver 18 for SQL Server}};Server={SERVER};Database={DATABASE};"
        "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=60",
        attrs_before={1256: token()},
    ) as conn:
        cur = conn.cursor()
        cur.fast_executemany = False  # MERGE with parameters does not batch reliably
        cur.execute(ADD_TEACHER_COLUMN)
        for site, rows in batches.items():
            # The SERVER's clock, read before the first write: comparing against a client clock
            # would prune by however far the two disagree.
            cur.execute("SELECT SYSUTCDATETIME()")
            started = cur.fetchone()[0]
            for row in rows:
                cur.execute(MERGE, row)
            if not args.no_prune:
                cur.execute(PRUNE, site, started)
                pruned = cur.rowcount
                if pruned:
                    print(f"{site}: pruned {pruned} baseline rows the datasets no longer produce")
            conn.commit()
            cur.execute("SELECT COUNT(*) FROM dbo.PlanAssignments WHERE site = ?", site)
            print(f"{site}: {cur.fetchone()[0]} rows now in dbo.PlanAssignments")

        cur.execute("SELECT source, COUNT(*) FROM dbo.PlanAssignments GROUP BY source")
        print("\nby source:", {r[0]: r[1] for r in cur.fetchall()})


if __name__ == "__main__":
    main()

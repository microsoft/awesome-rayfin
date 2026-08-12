"""Prove `dbo.PlanAssignments` still matches the plan the app serves.

A GATE, not a report: it exits non-zero, so it can be run after any dataset regeneration and before
a demo. Companion to `verify_model_agreement.py`, which does the same job for the semantic model.

⚠️ THIS EXISTS BECAUSE THE TABLE WENT WRONG SILENTLY. `seed_plan_assignments.py` used to MERGE and
never delete, so regenerating the timetable — which changes how cohorts are split, and therefore the
sessionIds — left 911 rows describing sessions that no longer existed. Nothing looked broken: each
orphan named a real course in a real room at a real hour, and SQL has no way to know the app stopped
producing it. The only way to see it is to recompute what the datasets say and compare.

Three failure modes are reported separately, because they have different causes:

  orphans  rows the current datasets do not produce   (a prune did not run)
  missing  assignments with no row at all             (a seed did not run)
  drifted  rows whose slot or room disagree           (a seed ran against older data)

    python tools/fabric/verify_plan_assignments.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import seed_plan_assignments as seed  # noqa: E402


def main() -> None:
    import pyodbc  # imported late so --help works without a driver

    wanted: dict[str, tuple] = {}
    for site in sorted(seed.SITES):
        for row in seed.rows_for(site):
            wanted[str(row[0]).lower()] = row

    with pyodbc.connect(
        f"Driver={{ODBC Driver 18 for SQL Server}};Server={seed.SERVER};Database={seed.DATABASE};"
        "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=60",
        attrs_before={1256: seed.token()},
    ) as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, site, sessionId, slotId, roomId, source FROM dbo.PlanAssignments")
        # ⚠️ NORMALISE THE ID. pyodbc hands back `uniqueidentifier` as a UUID object; comparing that
        # to the computed hex string matches nothing and reports EVERY row as an orphan. That false
        # alarm cost a diagnosis once — it read as the id scheme itself being broken.
        rows = [(str(r[0]).lower(), r[1], r[2], r[3], r[4], r[5]) for r in cur.fetchall()]

    present = {r[0] for r in rows}
    baseline = [r for r in rows if r[5] == "baseline"]
    orphans = [r for r in baseline if r[0] not in wanted]
    missing = [i for i in wanted if i not in present]
    # ⚠️ BY NAME, NOT BY MAGIC INDEX. These used to be literal 7 and 8; adding a `teacher` column
    # to the seeder shifted the tuple and the gate silently began comparing a cohort id against a
    # slot, reporting every row as drifted. `seed.COLUMNS` is the single declaration of that order.
    SLOT = seed.COLUMNS.index("slotId")
    ROOM = seed.COLUMNS.index("roomId")
    drifted = [
        r
        for r in baseline
        if r[0] in wanted
        and ((r[3] or "") != (wanted[r[0]][SLOT] or "") or (r[4] or "") != (wanted[r[0]][ROOM] or ""))
    ]

    print(f"datasets produce : {len(wanted)}")
    print(f"table holds      : {len(rows)}  ({len(baseline)} baseline)")
    print(f"stale orphans    : {len(orphans)}")
    print(f"missing rows     : {len(missing)}")
    print(f"drifted rows     : {len(drifted)}")

    for r in orphans[:10]:
        print(f"  orphan  {r[1]:<5} {r[2]:<28} room={r[4]}")
    for r in drifted[:10]:
        w = wanted[r[0]]
        print(f"  drift   {r[2]:<28} slot {r[3]}->{w[SLOT]}  room {r[4]}->{w[ROOM]}")

    if orphans or missing or drifted:
        raise SystemExit(
            f"\nMISMATCH: {len(orphans)} orphaned, {len(missing)} missing, {len(drifted)} drifted."
            "\nRun: python tools/fabric/seed_plan_assignments.py"
        )
    print("\nok — every assignment the app serves has exactly one row, and no row outlives it")


if __name__ == "__main__":
    main()

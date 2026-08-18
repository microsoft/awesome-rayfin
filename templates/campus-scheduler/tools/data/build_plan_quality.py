"""Plan quality — REQUIREMENTS.md 5.1's last two rules, measured only where the data allows.

Seven of the eight planning rules are already visible somewhere in the app. The two that were not:
"Vermeidung unguenstiger Zeitfenster" and "Verteilung ueber den Tag hinweg". The app could prove a
plan was conflict-FREE while saying nothing about whether it was good to study under, which is
what section 3 asks the planner's interface to let them check.

⚠️ WHAT THIS DELIBERATELY DOES NOT DO, AND WHY.
A first version measured a per-STUDENT day by assuming a student in group 1 of one course is in
group 1 of every other. Nothing in the data says that. It produced 178 impossible days (two
sessions in one block) and, through the negative break times those cause, 147 fake "impossible
transfers" — a defect that does not exist, in a plan the solver correctly calls conflict-free.

`cohort_group` records group SIZES, not membership, so there is no student entity and a true
per-student day is NOT derivable here. That is not a gap to paper over: it is exactly the mapping
an Untis export supplies (REQUIREMENTS 4.2), and naming it is more useful than inventing it.

So only exact units are written:
  1. WHOLE-COHORT LECTURE DAYS — every student in the cohort attends precisely these, so the
     shape is a fact about all of them. Verified free of same-block collisions.
  2. SESSIONS IN UNATTRACTIVE SLOTS — per session, straight from the slot's own desirability.
  3. A CHECKED PROPERTY — no group ever clashes with its own cohort's lectures, over every
     (group, cohort-lectures) combination. Reported as a count so it cannot rot silently.

    python tools/data/build_plan_quality.py --site oth
    python tools/data/build_plan_quality.py --all
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from sites import SITES, load_site


def minutes_of(hhmm: str) -> int:
    hours, mins = hhmm.split(":")[:2]
    return int(hours) * 60 + int(mins)


def build(site_id: str) -> Path:
    site = load_site(site_id)
    read = site.read_json
    assignments = read(site.synth / "plan_assignment.json", [])
    slots = read(site.synth / "time_slot.json", [])
    cohorts = read(site.synth / "cohort.json", [])
    travel = read(site.synth / "travel_time.json", [])
    if not assignments:
        raise SystemExit(f"{site.synth} has no plan — run generate_timetable.py --site {site.id}")

    slot_by_id = {s["slotId"]: s for s in slots}
    cohort_by_id = {c["cohortId"]: c for c in cohorts}
    travel_row = {(t["fromBuildingId"], t["toBuildingId"]): t for t in travel}
    published = [a for a in assignments if a.get("draftId") == "published"]

    whole = [a for a in published if a.get("isWholeCohort")]
    grouped = [a for a in published if not a.get("isWholeCohort")]

    # ── 1. The day every student in a cohort actually shares ──────────────────────────────────
    per_day: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for a in whole:
        slot = slot_by_id.get(a["slotId"])
        if slot:
            per_day[(a["cohortId"], slot["day"])].append({**a, "_slot": slot})

    cohort_days: list[dict] = []
    for (cohort_id, day), items in sorted(per_day.items()):
        items.sort(key=lambda s: s["_slot"]["block"])
        blocks = [s["_slot"]["block"] for s in items]
        span = blocks[-1] - blocks[0] + 1
        cohort = cohort_by_id.get(cohort_id, {})

        campus_changes = tight = worst = 0
        for first, second in zip(items, items[1:]):
            if first["buildingId"] == second["buildingId"]:
                continue
            row = travel_row.get((first["buildingId"], second["buildingId"]))
            if not row:
                continue
            if not row["sameCampus"]:
                campus_changes += 1
            available = minutes_of(second["_slot"]["startTime"]) - minutes_of(
                first["_slot"]["endTime"]
            )
            if row["minutes"] > available:
                tight += 1
                worst = max(worst, row["minutes"] - available)

        cohort_days.append({
            "cohortId": cohort_id,
            "programme": cohort.get("programme"),
            "facultyId": cohort.get("facultyId"),
            "semester": cohort.get("semester"),
            "headcount": cohort.get("headcount"),
            "day": day,
            "dayIndex": items[0]["_slot"]["dayIndex"],
            "sessions": len(items),
            "firstBlock": blocks[0],
            "lastBlock": blocks[-1],
            "spanBlocks": span,
            "idleBlocks": span - len(set(blocks)),
            "campusChanges": campus_changes,
            "tightTransfers": tight,
            "worstShortfallMin": worst,
        })

    # ── 2. Sessions parked in the slots nobody wants ──────────────────────────────────────────
    desirability = {s["slotId"]: s.get("desirability") for s in slots}
    scale = sorted({d for d in desirability.values() if d is not None})
    # The bottom third of the scale this site actually uses — not a hard-coded hour, because the
    # two universities run different block schemes (OTH 7 x 45 s.t., LMU 6 c.t.).
    threshold = scale[max(0, len(scale) // 3 - 1)] if scale else 0
    unpopular = []
    for a in published:
        value = desirability.get(a["slotId"])
        if value is None or value > threshold:
            continue
        slot = slot_by_id.get(a["slotId"], {})
        unpopular.append({
            "sessionId": a["sessionId"],
            "cohortId": a["cohortId"],
            "slotId": a["slotId"],
            "day": slot.get("day"),
            "block": slot.get("block"),
            "startTime": slot.get("startTime"),
            "desirability": value,
        })
    unpopular.sort(key=lambda r: (r["desirability"], r["slotId"]))

    # ── 3. A property worth checking rather than assuming ─────────────────────────────────────
    whole_by_cohort: dict[str, list[dict]] = defaultdict(list)
    for a in whole:
        whole_by_cohort[a["cohortId"]].append(a)
    by_group: dict[str, list[dict]] = defaultdict(list)
    for a in grouped:
        by_group[a["attendeeId"]].append(a)

    combos = collisions = 0
    for rows in by_group.values():
        merged = rows + whole_by_cohort.get(rows[0]["cohortId"], [])
        seen: dict[str, set] = defaultdict(set)
        clash = False
        for a in merged:
            slot = slot_by_id.get(a["slotId"])
            if not slot:
                continue
            if slot["block"] in seen[slot["day"]]:
                clash = True
            seen[slot["day"]].add(slot["block"])
        combos += 1
        collisions += 1 if clash else 0

    model = {
        "$comment": (
            "Day shape over WHOLE-COHORT lectures only — the sessions every student in a cohort "
            "attends. Per-student days are not derivable: cohort_group records sizes, not "
            "membership."
        ),
        "aoi": site.aoi_id,
        "site": site.id,
        "provenance": "derived",
        "sourceProvenance": "synthetic",
        "syntheticWarning": (
            "Der Stundenplan ist synthetisch. Die Tagesform ist echt daraus gerechnet, "
            "beschreibt aber einen erfundenen Plan."
        ),
        "blocksPerDay": max((s["block"] for s in slots), default=0),
        "unpopularThreshold": threshold,
        "groupCheck": {"combinations": combos, "collisions": collisions},
        # ⚠️ Read by the UI. The lens states this limitation on screen, not only in a comment.
        "studentGroupMappingModelled": False,
        "cohortDays": cohort_days,
        "unpopularSessions": unpopular,
    }

    out = site.terrain_dir() / "plan-quality.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(model, ensure_ascii=False, indent=1), encoding="utf-8")

    gap_days = [d for d in cohort_days if d["idleBlocks"] > 0]
    print(f"{site.label}: {len(cohort_days)} cohort lecture-days")
    print(f"  with an idle block: {len(gap_days)}   idle blocks total: "
          f"{sum(d['idleBlocks'] for d in cohort_days)}")
    print(f"  longest day: {max((d['spanBlocks'] for d in cohort_days), default=0)} blocks"
          f"   campus changes: {sum(d['campusChanges'] for d in cohort_days)}"
          f"   tight transfers: {sum(d['tightTransfers'] for d in cohort_days)}")
    print(f"  sessions in unattractive slots (<= {threshold}): {len(unpopular)}")
    print(f"  group/lecture combinations checked: {combos}, collisions: {collisions}")
    print(f"  -> {out.relative_to(Path(__file__).resolve().parents[2])}")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", choices=sorted(SITES), default="oth")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    for site_id in sorted(SITES) if args.all else [args.site]:
        build(site_id)


if __name__ == "__main__":
    main()

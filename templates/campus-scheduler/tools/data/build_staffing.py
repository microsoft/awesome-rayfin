"""Roll the timetable up into teaching load per lecturer — the Einsatzplanung question.

Campus-Scheduler answers "which room, which hour". The Einsatzplanung apps
(`repos/Einsatzplanung-Universitaet`) answer a different one that the same plan already implies:
**who is teaching all of this, and is it more than their contract allows.** German university
staffing runs on SWS (Semesterwochenstunden) — a lecturer has a contractual Deputat, and a plan
that quietly exceeds it is not a plan, it is a problem deferred to a person.

⚠️ NOTHING HERE IS INVENTED. Both halves already exist in the generated dataset:
`course.json` carries `sws` and `teacherId`, `teacher.json` carries `contractSws`. This script only
joins them. That matters, because the join immediately exposes something the app could not
previously see anywhere: in the OTH plan seven lecturers are over contract — one at twice it —
while three have no course at all. The scheduler produced that imbalance itself.

Only raw facts are written. Percentages, thresholds and rollups are computed in
`src/lenses/staffing/staffingData.ts`, where they can be unit-tested against hand-worked cases
rather than trusted because a script emitted them.

⚠️ The professorale Quote — the accreditation rule at the centre of the Einsatzplanung app, where
at least half of teaching must be delivered by professors — is deliberately NOT computed. Every
teacher this generator produces is named "Prof. Dr.", so the quota would be 100% by construction:
a green light that measures nothing. It needs a lecturer-type split in the generator first, and
inventing one to make a demo look richer is the opposite of what the rest of this dataset does.
`lecturerTypesModelled` records that honestly for the UI to read.

    python tools/data/build_staffing.py --site oth
    python tools/data/build_staffing.py --site lmu
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from sites import SITES, load_site


def build(site_id: str) -> Path:
    site = load_site(site_id)
    teachers = site.read_json(site.synth / "teacher.json", [])
    courses = site.read_json(site.synth / "course.json", [])
    if not teachers or not courses:
        raise SystemExit(
            f"{site.synth} has no teacher.json/course.json — run generate_timetable.py --site {site.id}"
        )

    faculties = {f["id"]: f for f in site.read_json(site.academic, {}).get("faculties", [])}

    planned: dict[str, float] = defaultdict(float)
    course_count: dict[str, int] = defaultdict(int)
    for course in courses:
        teacher_id = course.get("teacherId")
        if not teacher_id:
            continue
        planned[teacher_id] += float(course.get("sws") or 0)
        course_count[teacher_id] += 1

    rows = [
        {
            "teacherId": t["teacherId"],
            "name": t["name"],
            "facultyId": t["facultyId"],
            "contractSws": float(t["contractSws"]),
            "plannedSws": planned.get(t["teacherId"], 0.0),
            "courseCount": course_count.get(t["teacherId"], 0),
        }
        for t in teachers
    ]
    rows.sort(key=lambda r: r["teacherId"])

    model = {
        "$comment": (
            "Teaching load per lecturer, joined from course.sws and teacher.contractSws. "
            "Derived from the generated timetable — no figure here is independently invented."
        ),
        "aoi": site.aoi_id,
        "site": site.id,
        "provenance": "derived",
        "sourceProvenance": "synthetic",
        "syntheticWarning": (
            "Der Stundenplan ist synthetisch. Die Deputatsrechnung darauf ist echt gerechnet, "
            "aber sie beschreibt einen erfundenen Plan."
        ),
        # ⚠️ Read by the UI to explain why no quota is shown. See the module note.
        "lecturerTypesModelled": False,
        "faculties": [
            {"id": fid, "name": f.get("name", fid)} for fid, f in sorted(faculties.items())
        ],
        "teachers": rows,
    }

    out = site.terrain_dir() / "staffing.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(model, ensure_ascii=False, indent=1), encoding="utf-8")

    over = [r for r in rows if r["plannedSws"] > r["contractSws"]]
    idle = [r for r in rows if r["plannedSws"] == 0]
    total_planned = sum(r["plannedSws"] for r in rows)
    total_contract = sum(r["contractSws"] for r in rows)
    print(f"{site.label}: {len(rows)} lecturers, {total_planned:.0f} of {total_contract:.0f} SWS "
          f"contracted ({total_planned / total_contract:.0%})")
    print(f"  over contract: {len(over)}   without a course: {len(idle)}")
    for r in sorted(over, key=lambda r: -r["plannedSws"] / r["contractSws"])[:5]:
        print(f"    {r['teacherId']} {r['name'][:28]:<28} "
              f"{r['plannedSws']:.0f} of {r['contractSws']:.0f} SWS "
              f"= {r['plannedSws'] / r['contractSws']:.0%}")
    print(f"  -> {out.relative_to(Path(__file__).resolve().parents[2])}")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", choices=sorted(SITES), default="oth")
    parser.add_argument("--all", action="store_true", help="build every registered site")
    args = parser.parse_args()

    for site_id in sorted(SITES) if args.all else [args.site]:
        build(site_id)


if __name__ == "__main__":
    main()

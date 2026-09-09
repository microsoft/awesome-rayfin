"""Verify the semantic model by asking it questions — PLAN §8.

⚠️ **A successful deployment proves nothing.** A Direct Lake partition that points at a path which
does not exist frames zero rows and reports no error; every visual is simply empty. The only honest
check is to query the measures and compare the answers against the source the model was built from.

So this runs DAX against the published model and compares it with the curated CSVs on disk. If the
two disagree, something between the CSV and the semantic model lost the data, and the run fails.

Usage
  python tools/fabric/verify_model.py
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from setup_lakehouse import FABRIC_API, WORKSPACE_NAME, find_item, find_workspace, request, token_for

POWERBI_API = "https://api.powerbi.com/v1.0/myorg"
POWERBI_RESOURCE = "https://analysis.windows.net/powerbi/api"
MODEL_NAME = "Gleitschirm-Insights"
CURATED = Path(__file__).resolve().parents[2] / "data" / "curated"


def dax(token: str, workspace_id: str, model_id: str, query: str) -> list[dict]:
    status, payload, _ = request(
        "POST",
        f"{POWERBI_API}/groups/{workspace_id}/datasets/{model_id}/executeQueries",
        token,
        {"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}},
    )
    if status != 200:
        raise SystemExit(f"DAX failed: {status} {str(payload)[:600]}")
    return payload["results"][0]["tables"][0]["rows"]


def rows_in(name: str) -> int:
    path = CURATED / name
    if not path.exists():
        return -1
    with path.open(encoding="utf-8", newline="") as handle:
        return sum(1 for _ in csv.DictReader(handle))


def main() -> None:
    fabric_token = token_for(FABRIC_API)
    workspace_id = find_workspace(fabric_token, WORKSPACE_NAME)
    model = find_item(fabric_token, workspace_id, MODEL_NAME, "SemanticModel")
    if not model:
        raise SystemExit(f"semantic model not found: {MODEL_NAME}")

    token = token_for(POWERBI_RESOURCE)
    print(f"model {model['id']}\n")

    # ── Does every table hold what the CSV held? ───────────────────────────
    counts = dax(
        token,
        workspace_id,
        model["id"],
        """
        EVALUATE
        ROW (
            "Flug", COUNTROWS ( 'Flug' ),
            "Flugpunkt", COUNTROWS ( 'Flugpunkt' ),
            "Windprofil", COUNTROWS ( 'Windprofil' ),
            "Wetter", COUNTROWS ( 'Wetter' )
        )
        """,
    )[0]

    expected = {
        "Flug": rows_in("flight_summary.csv"),
        "Flugpunkt": rows_in("flight_fix.csv"),
        "Windprofil": rows_in("flight_wind.csv"),
        "Wetter": rows_in("weather.csv"),
    }

    failures = 0
    print(f"{'table':<14}{'model':>10}{'csv':>10}")
    for table, want in expected.items():
        got = counts.get(f"[{table}]") or 0
        mark = "ok" if got == want else "MISMATCH"
        if got != want:
            failures += 1
        print(f"{table:<14}{got:>10,}{want:>10,}   {mark}")

    if failures == 0 and all(v > 0 for v in expected.values()):
        print("\nall tables framed — Direct Lake is reading the Delta files")
    elif any((counts.get(f'[{t}]') or 0) == 0 for t in expected):
        print("\n⚠️ a table framed ZERO rows. That is the schemaName symptom — see create_semantic_model.py")

    # ── Do the measures agree with the data? ───────────────────────────────
    measures = dax(
        token,
        workspace_id,
        model["id"],
        """
        EVALUATE
        ROW (
            "Fluege", [Flüge],
            "Hoechster Punkt", [Höchster Punkt],
            "Bestes Steigen", [Bestes Steigen],
            "Streckenlaenge", [Streckenlänge],
            "Wolkenbasis", [Wolkenbasis],
            "Thermikstaerke", [Thermikstärke],
            "Nullgradgrenze", [Nullgradgrenze],
            "Gemessener Wind", [Gemessener Wind]
        )
        """,
    )[0]

    print("\nmeasures:")
    for key, value in measures.items():
        label = key.strip("[]")
        if value is None:
            print(f"  {label:<20} —   (no rows matched the filter, which may be correct)")
        elif isinstance(value, (int, float)):
            print(f"  {label:<20} {value:,.2f}")
        else:
            print(f"  {label:<20} {value}")

    # Cross-check one measure against the source, so this is a comparison and not a screenshot.
    summary = list(csv.DictReader((CURATED / "flight_summary.csv").open(encoding="utf-8")))
    if summary:
        want_ceiling = max(int(r["alt_max_m"]) for r in summary)
        got_ceiling = measures.get("[Hoechster Punkt]")
        agree = got_ceiling is not None and abs(float(got_ceiling) - want_ceiling) < 0.5
        print(f"\nceiling: model {got_ceiling} vs csv {want_ceiling}   {'ok' if agree else 'MISMATCH'}")
        if not agree:
            failures += 1

    if failures:
        raise SystemExit(f"\n{failures} check(s) failed")
    print("\nverified")


if __name__ == "__main__":
    main()

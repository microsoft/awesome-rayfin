"""Export Mode D's numbers from the Direct Lake model — PLAN §3 Mode D, phase 5.

The app is deployed as static hosting, which cannot hold a Fabric token, so Mode D reads a snapshot
rather than querying live. That is a deliberate and stated limitation, not a pretence: the file
carries the model run it came from and when it was taken, and the interface says so.

⚠️ **The numbers still come from the semantic model, not from the CSVs.** It would have been easier
to read `data/curated/*.csv` directly and skip Fabric entirely — and it would have made Mode D a lie,
because the whole claim is that these figures come out of Direct Lake. Every value below is the
answer to a DAX query against the published model, so if the model breaks, this breaks with it.

Usage
  python tools/fabric/export_day.py
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from setup_lakehouse import FABRIC_API, WORKSPACE_NAME, find_item, find_workspace, request, token_for

POWERBI_API = "https://api.powerbi.com/v1.0/myorg"
POWERBI_RESOURCE = "https://analysis.windows.net/powerbi/api"
MODEL_NAME = "Gleitschirm-Insights"
ROOT = Path(__file__).resolve().parents[2]

# ⚠️ **Every query below is filtered to one area of interest, and that is not decoration.**
#
# `--aoi` used to select nothing at all: it named the output file and stamped the JSON, while the
# DAX aggregated the whole `Wetter` table. With one site loaded that is accidentally correct, which
# is why it survived phase 5 and a review. With two it silently averages two mountain ranges 35 km
# apart and writes the result to a file that says which single site it describes — and Mode E then
# quotes those numbers as measured fact. A cloud base that is the mean of two valleys is exactly
# the kind of plausible, precise, wrong figure §2.2 exists to prevent.
#
# `{aoi}` is substituted from a validated id (see `known_aoi`), never from free text.
DAY_QUERY = """
EVALUATE
SUMMARIZECOLUMNS (
    'Wetter'[Gültig],
    'Wetter'[Vorhersagestunde],
    FILTER ( ALL ( 'Wetter'[Gebiet] ), 'Wetter'[Gebiet] = "{aoi}" ),
    "Basis", CALCULATE ( AVERAGE ( 'Wetter'[Mittel] ), 'Wetter'[Parameter] = "hbas_sc", 'Wetter'[Abdeckung] > 0.02 ),
    "BasisAbdeckung", CALCULATE ( AVERAGE ( 'Wetter'[Abdeckung] ), 'Wetter'[Parameter] = "hbas_sc" ),
    "Obergrenze", CALCULATE ( AVERAGE ( 'Wetter'[Mittel] ), 'Wetter'[Parameter] = "htop_sc", 'Wetter'[Abdeckung] > 0.02 ),
    "Cape", CALCULATE ( AVERAGE ( 'Wetter'[Mittel] ), 'Wetter'[Parameter] = "cape_ml" ),
    "Bewoelkung", CALCULATE ( AVERAGE ( 'Wetter'[Mittel] ), 'Wetter'[Parameter] = "clct" ),
    "Boeen", CALCULATE ( AVERAGE ( 'Wetter'[Maximum] ), 'Wetter'[Parameter] = "vmax_10m" ),
    "Temperatur", CALCULATE ( AVERAGE ( 'Wetter'[Mittel] ), 'Wetter'[Parameter] = "t_2m" ),
    "Nullgrad", CALCULATE ( AVERAGE ( 'Wetter'[Mittel] ), 'Wetter'[Parameter] = "hzerocl" )
)
ORDER BY 'Wetter'[Vorhersagestunde]
"""

# Wind aloft, by pressure level. u and v are components; the app turns them into speed and bearing,
# because a number of degrees is what a pilot reads and a pair of components is not.
WIND_QUERY = """
EVALUATE
SUMMARIZECOLUMNS (
    'Wetter'[Druckfläche],
    'Wetter'[Vorhersagestunde],
    FILTER ( ALL ( 'Wetter'[Gebiet] ), 'Wetter'[Gebiet] = "{aoi}" ),
    "U", CALCULATE ( AVERAGE ( 'Wetter'[Mittel] ), 'Wetter'[Parameter] = "u" ),
    "V", CALCULATE ( AVERAGE ( 'Wetter'[Mittel] ), 'Wetter'[Parameter] = "v" )
)
"""

# The flight measures live on 'Flug'; the filter reaches 'Windprofil' through the relationship, so
# [Gemessener Wind] is the wind of THIS site's flights rather than of every flight in the model.
FLIGHT_QUERY = """
EVALUATE
CALCULATETABLE (
    ROW (
        "Fluege", [Flüge],
        "Hoechster Punkt", [Höchster Punkt],
        "Bestes Steigen", [Bestes Steigen],
        "Streckenlaenge", [Streckenlänge],
        "Gemessener Wind", [Gemessener Wind]
    ),
    'Flug'[Gebiet] = "{aoi}"
)
"""

RUN_QUERY = """
EVALUATE ROW ( "Lauf", CALCULATE ( MAX ( 'Wetter'[Modelllauf] ), 'Wetter'[Gebiet] = "{aoi}" ) )
"""


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


def value(row: dict, *names: str):
    for name in names:
        if name in row:
            return row[name]
    return None


def known_aoi(aoi: str) -> str:
    """Reject anything that is not a shipped AOI, before it reaches a DAX string."""
    if not (ROOT / "config" / "aoi" / f"{aoi}.json").is_file():
        available = sorted(p.stem for p in (ROOT / "config" / "aoi").glob("*.json"))
        raise SystemExit(f"unknown AOI {aoi!r} — available: {', '.join(available)}")
    return aoi


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    args = parser.parse_args()
    aoi = known_aoi(args.aoi)

    fabric_token = token_for(FABRIC_API)
    workspace_id = find_workspace(fabric_token, WORKSPACE_NAME)
    model = find_item(fabric_token, workspace_id, MODEL_NAME, "SemanticModel")
    if not model:
        raise SystemExit("semantic model not found — run create_semantic_model.py first")

    token = token_for(POWERBI_RESOURCE)

    run = value(dax(token, workspace_id, model["id"], RUN_QUERY.format(aoi=aoi))[0], "[Lauf]")
    if run is None:
        raise SystemExit(
            f"no weather rows for {aoi!r} in the model — harvest and load it first:\n"
            f"  python tools/weather/harvest_icond2.py --aoi {aoi}\n"
            f"  python tools/fabric/setup_lakehouse.py && python tools/fabric/load_tables.py"
        )
    flights = dax(token, workspace_id, model["id"], FLIGHT_QUERY.format(aoi=aoi))[0]

    hours = []
    for row in dax(token, workspace_id, model["id"], DAY_QUERY.format(aoi=aoi)):
        base = value(row, "[Basis]")
        hours.append(
            {
                "validTs": value(row, "'Wetter'[Gültig]", "Wetter[Gültig]"),
                "stepH": value(row, "'Wetter'[Vorhersagestunde]", "Wetter[Vorhersagestunde]"),
                "cloudBaseM": round(base) if base else None,
                "cloudCoverage": round(value(row, "[BasisAbdeckung]") or 0, 3),
                "cloudTopM": round(value(row, "[Obergrenze]")) if value(row, "[Obergrenze]") else None,
                "capeJkg": round(value(row, "[Cape]") or 0),
                "cloudPct": round(value(row, "[Bewoelkung]") or 0),
                "gustMs": round(value(row, "[Boeen]") or 0, 1),
                "tempC": round((value(row, "[Temperatur]") or 273.15) - 273.15, 1),
                "freezingM": round(value(row, "[Nullgrad]") or 0),
            }
        )
    hours.sort(key=lambda h: h["stepH"] or 0)

    wind = []
    for row in dax(token, workspace_id, model["id"], WIND_QUERY.format(aoi=aoi)):
        level = value(row, "'Wetter'[Druckfläche]", "Wetter[Druckfläche]")
        u = value(row, "[U]")
        v = value(row, "[V]")
        if not level or u is None or v is None:
            continue
        wind.append(
            {
                "levelHpa": int(level),
                "stepH": value(row, "'Wetter'[Vorhersagestunde]", "Wetter[Vorhersagestunde]"),
                "u": round(u, 2),
                "v": round(v, 2),
            }
        )
    wind.sort(key=lambda w: (w["stepH"] or 0, -w["levelHpa"]))

    payload = {
        "aoi": aoi,
        "source": "Direct Lake semantic model 'Gleitschirm-Insights' over the Fabric Lakehouse",
        "modelRun": run,
        "exportedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "flights": {
            # COUNTROWS returns BLANK, not 0, for a site with no flights. The app distinguishes
            # "nobody flew here" from "we do not know", so the count is a real 0 and the rest stay
            # null rather than becoming zeros that read as measurements.
            "count": int(value(flights, "[Fluege]") or 0),
            "ceilingM": value(flights, "[Hoechster Punkt]"),
            "bestClimbMs": value(flights, "[Bestes Steigen]"),
            "distanceKm": value(flights, "[Streckenlaenge]"),
            "measuredWindMs": value(flights, "[Gemessener Wind]"),
        },
        "hours": hours,
        "windAloft": wind,
    }

    target = ROOT / "public" / "day" / f"{aoi}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    flyable = [h for h in hours if h["cloudBaseM"]]
    print(f"model run {run}")
    print(f"{len(hours)} forecast hours, {len(flyable)} with convection, {len(wind)} wind rows")
    if flyable:
        best = max(flyable, key=lambda h: h["cloudBaseM"])
        print(f"  best base {best['cloudBaseM']} m at {best['validTs']} ({best['cloudCoverage'] * 100:.0f}% of the AOI)")
    print(f"→ {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

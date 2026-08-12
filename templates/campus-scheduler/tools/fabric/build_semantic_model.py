"""Generate and publish the Direct Lake semantic model.

PLAN Phase 4. This is what turns a 3D map into a platform demo: the same rooms and bookings the
app draws become a model anyone can query with DAX, build a report on, or ask a question of in
natural language.

The TMDL is generated rather than hand-written so the model cannot drift from the tables — the
column list comes from the same place the Delta writer used.

⚠️ **Two things fail silently if you get them wrong, and both are handled here.**

1. `entityName` in a partition must be the DELTA table name (`room_hour`), not the model's
   display name (`'Room Hour'`). TMDL accepts either at deploy time; the wrong one fails at query
   time with "cannot find table".
2. A freshly deployed Direct Lake model must be REFRAMED before it will answer anything. Without
   it every query fails even though the deployment reported success.

Usage
  python tools/fabric/build_semantic_model.py
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "fabric" / "CampusScheduler.SemanticModel"

from fabric_ids import lakehouse_id, workspace_id

WORKSPACE_ID = workspace_id()
LAKEHOUSE_ID = lakehouse_id()
MODEL_NAME = "Campus Scheduler — Raum & Belegung"
EXPRESSION = "DirectLake - campus_lh"

AZ = shutil.which("az") or "az"

#: Slots in a teaching week — Monday to Friday, 07:00-20:59. Mirrors OCC_SLOTS in build_rooms.py.
WEEK_SLOTS = 70

#: Deterministic lineage tags, so republishing does not churn the definition.
NAMESPACE = uuid.UUID("6f1d1c4e-9f1a-4b7c-9c0e-2f7a5a1b8d33")


def tag(name: str) -> str:
    return str(uuid.uuid5(NAMESPACE, name))


def token(resource: str) -> str:
    out = subprocess.run(  # noqa: S603
        [AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


# ── The model, as data ──────────────────────────────────────────────────────────────────
# (display name, delta table, [(column, dataType, summarizeBy, description)])
TABLES: list[tuple[str, str, list[tuple[str, str, str, str]]]] = [
    (
        "Building",
        "building",
        [
            ("building_code", "string", "none", "Official TUM Gebäudekennung."),
            ("room_count", "int64", "sum", "Rooms mapped indoors in OpenStreetMap."),
            ("area_m2", "double", "sum", "Sum of room floor areas. Derived from the polygons."),
            ("level_count", "int64", "none", "Storeys with at least one mapped room."),
            ("rooms_with_calendar", "int64", "sum", "Rooms TUMonline publishes a calendar for."),
        ],
    ),
    (
        "Room",
        "room",
        [
            ("room_code", "string", "none", "Official TUM Raumkennung, e.g. 5606.EG.041."),
            ("building_code", "string", "none", "Gebäudekennung this room belongs to."),
            ("level", "int64", "none", "Storey. 0 is ground level, negative is below it."),
            ("usage", "string", "none", "Controlled usage type from NavigaTUM."),
            ("category", "string", "none", "teaching, service or other."),
            ("room_name", "string", "none", "Room name where TUMonline publishes one."),
            ("area_m2", "double", "sum", "Floor area, computed from the surveyed outline."),
            (
                "seats_synthetic",
                "int64",
                "sum",
                "⚠️ SYNTHETIC. Floor area divided by a planning density — seat counts are not "
                "published. Every figure derived from this is synthetic too.",
            ),
            ("has_calendar", "boolean", "none", "Whether TUMonline publishes bookings for it."),
        ],
    ),
    (
        "Usage Type",
        "usage_type",
        [
            ("usage", "string", "none", "Controlled usage type from NavigaTUM."),
            ("category", "string", "none", "teaching, service or other."),
        ],
    ),
    (
        "Time Slot",
        "time_slot",
        [
            ("slot", "int64", "none", "0-69: Monday 07:00 through Friday 20:00."),
            ("weekday", "int64", "none", "0 = Monday."),
            ("day_de", "string", "none", "Wochentag."),
            ("day_en", "string", "none", "Weekday."),
            ("hour", "int64", "none", "Hour of day, 7-20."),
            ("label", "string", "none", "Short label, e.g. 'Di 10:00'."),
        ],
    ),
    (
        "Room Hour",
        "room_hour",
        [
            ("room_code", "string", "none", "Raumkennung."),
            ("slot", "int64", "none", "Hour of the teaching week."),
            (
                "weeks_booked",
                "int64",
                "sum",
                "Distinct semester weeks in which this hour carried a booking. A room used every "
                "week reads high; one used twice does not.",
            ),
        ],
    ),
    (
        "Course",
        "course",
        [
            ("room_code", "string", "none", "Raumkennung."),
            ("title", "string", "none", "Course title as TUMonline publishes it."),
            ("bookings", "int64", "sum", "Bookings this course made in this room."),
        ],
    ),
]

RELATIONSHIPS = [
    ("Building", "building_code", "Room", "building_code"),
    ("Room", "room_code", "Room Hour", "room_code"),
    ("Time Slot", "slot", "Room Hour", "slot"),
    ("Usage Type", "usage", "Room", "usage"),
    ("Room", "room_code", "Course", "room_code"),
]

# (name, expression, formatString, description)
MEASURES: list[tuple[str, str, str, str]] = [
    ("Räume", "COUNTROWS('Room')", "#,0", "Rooms mapped indoors and joined to a usage type."),
    ("Gebäude", "COUNTROWS('Building')", "#,0", "Buildings with indoor mapping."),
    (
        "Räume mit Kalender",
        "CALCULATE(COUNTROWS('Room'), 'Room'[has_calendar] = TRUE())",
        "#,0",
        "Rooms TUMonline publishes bookings for. The rest are unknown, not empty.",
    ),
    ("Lehrräume", "CALCULATE(COUNTROWS('Room'), 'Room'[category] = \"teaching\")", "#,0",
     "Hörsäle, Seminarräume, Übungsräume and the like."),
    ("Fläche m2", "SUM('Room'[area_m2])", "#,0", "Floor area, computed from surveyed outlines."),
    (
        "Lehrfläche m2",
        "CALCULATE(SUM('Room'[area_m2]), 'Room'[category] = \"teaching\")",
        "#,0",
        "Floor area of teaching space.",
    ),
    (
        "Plätze (synthetisch)",
        "SUM('Room'[seats_synthetic])",
        "#,0",
        "⚠️ SYNTHETIC. Seat counts are not published anywhere; these are floor area divided by a "
        "planning density. Shown only where it is labelled as such.",
    ),
    (
        "m2 je Platz",
        "DIVIDE([Fläche m2], [Plätze (synthetisch)])",
        "#,0.0",
        "⚠️ Partly synthetic — the numerator is measured, the denominator is not.",
    ),
    (
        "Belegte Stunden",
        "COUNTROWS('Room Hour')",
        "#,0",
        "Hours of the teaching week that carried at least one booking, summed over rooms.",
    ),
    (
        "Verfügbare Stunden",
        f"[Räume mit Kalender] * {WEEK_SLOTS}",
        "#,0",
        f"{WEEK_SLOTS} hours per week (Mo-Fr, 07:00-20:59) for every room with a calendar.",
    ),
    (
        "Zeitliche Auslastung %",
        # ⚠️ AVERAGEX per room, NOT total booked / total available. The app averages each room's
        # own utilisation, and a sum-over-sum would quietly weight big rooms more heavily and
        # disagree with it. This is the measure the agreement gate checks.
        #
        # ⚠️ COALESCE is load-bearing. 'Room Hour' is sparse — a room that was never booked has no
        # rows at all — so COUNTROWS returns BLANK, DIVIDE returns BLANK, and AVERAGEX *skips*
        # blanks rather than treating them as zero. Without it the average silently runs over only
        # the rooms that were booked, which is how this measure read 53.8 % when the honest figure
        # across all 310 calendared rooms is 30.5 %. The 134 never-booked rooms are the finding,
        # not noise to be excluded.
        "AVERAGEX(\n"
        "                    FILTER('Room', 'Room'[has_calendar] = TRUE()),\n"
        f"                    DIVIDE(COALESCE(CALCULATE(COUNTROWS('Room Hour')), 0), {WEEK_SLOTS})\n"
        "                )",
        "0.0%",
        "Share of the teaching week a room is committed, averaged over rooms with a calendar.",
    ),
    (
        "Zeitliche Auslastung Lehrräume %",
        "AVERAGEX(\n"
        "                    FILTER('Room', 'Room'[has_calendar] = TRUE() && 'Room'[category] = \"teaching\"),\n"
        f"                    DIVIDE(COALESCE(CALCULATE(COUNTROWS('Room Hour')), 0), {WEEK_SLOTS})\n"
        "                )",
        "0.0%",
        "The same measure restricted to teaching space — what the app's building panel shows.",
    ),
    (
        "Räume ohne Belegung",
        # COUNTROWS over an empty filter returns BLANK, not 0 — so this read as "no answer" where
        # the app reads "none", and the agreement gate rejected it. A count of nothing is zero.
        "COALESCE(\n"
        "                    COUNTROWS(\n"
        "                        FILTER(\n"
        "                            FILTER('Room', 'Room'[has_calendar] = TRUE()),\n"
        "                            ISBLANK(CALCULATE(COUNTROWS('Room Hour')))\n"
        "                        )\n"
        "                    ),\n"
        "                    0\n"
        "                )",
        "#,0",
        "Rooms that publish a calendar and were never booked in the reference semester.",
    ),
]


def table_tmdl(display: str, delta: str, columns: list[tuple[str, str, str, str]]) -> str:
    lines = [f"table '{display}'", f"\tlineageTag: {tag(display)}", ""]
    for name, data_type, summarize, description in columns:
        for part in description.split("\n"):
            lines.append(f"\t/// {part}")
        lines.append(f"\tcolumn {name}")
        lines.append(f"\t\tdataType: {data_type}")
        lines.append(f"\t\tlineageTag: {tag(display + '.' + name)}")
        lines.append(f"\t\tsummarizeBy: {summarize}")
        lines.append(f"\t\tsourceColumn: {name}")
        lines.append("")
    # ⚠️ entityName is the DELTA table, not the display name.
    lines.append(f"\tpartition '{delta}' = entity")
    lines.append("\t\tmode: directLake")
    lines.append("\t\tsource")
    lines.append(f"\t\t\tentityName: {delta}")
    lines.append(f"\t\t\texpressionSource: '{EXPRESSION}'")
    lines.append("")
    return "\n".join(lines)


def measure_tmdl() -> str:
    lines = ["table 'Measure'", f"\tlineageTag: {tag('Measure')}", ""]
    # A single hidden row. Direct Lake tables cannot host measures, so the model needs one small
    # calculated table to put them on — which is also what keeps them findable in one place.
    lines.append("\tcolumn 'Value'")
    lines.append("\t\tdataType: int64")
    lines.append("\t\tisHidden")
    lines.append(f"\t\tlineageTag: {tag('Measure.Value')}")
    lines.append("\t\tsummarizeBy: none")
    lines.append("\t\tsourceColumn: [Value]")
    lines.append("")
    for name, expression, fmt, description in MEASURES:
        for part in description.split("\n"):
            lines.append(f"\t/// {part}")
        if "\n" in expression:
            # ⚠️ Nothing after the '=' for a multi-line measure, or the deploy fails with
            # "UnsupportedObjectType - VAR is not a supported property".
            lines.append(f"\tmeasure '{name}' =")
            for part in expression.split("\n"):
                lines.append(f"\t\t\t{part.strip() if part.strip().startswith(')') else part}")
        else:
            lines.append(f"\tmeasure '{name}' = {expression}")
        lines.append(f"\t\tformatString: {fmt}")
        lines.append(f"\t\tlineageTag: {tag('measure.' + name)}")
        lines.append("")
    lines.append("\tpartition 'Measure' = calculated")
    lines.append("\t\tmode: import")
    lines.append("\t\tsource = {0}")
    lines.append("")
    return "\n".join(lines)


def build_parts() -> dict[str, str]:
    parts: dict[str, str] = {}

    parts[".platform"] = json.dumps(
        {
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
            "metadata": {"type": "SemanticModel", "displayName": MODEL_NAME},
            "config": {"version": "2.0", "logicalId": tag("model")},
        },
        indent=2,
    )
    parts["definition.pbism"] = json.dumps(
        {"version": "4.0", "settings": {"qnaEnabled": True}}, indent=2
    )
    parts["definition/database.tmdl"] = "database\n\tcompatibilityLevel: 1605\n"
    parts["definition/model.tmdl"] = (
        "model Model\n"
        "\tculture: de-DE\n"
        "\tdefaultPowerBIDataSourceVersion: powerBI_V3\n"
        "\tdiscourageImplicitMeasures\n"
        "\tsourceQueryCulture: de-DE\n"
        "\tdataAccessOptions\n"
        "\t\tlegacyRedirects\n"
        "\t\treturnErrorValuesAsNull\n"
        "\n"
        + "".join(f"ref table '{display}'\n" for display, _, _ in TABLES)
        + "ref table 'Measure'\n"
    )
    parts["definition/expressions.tmdl"] = (
        f"expression '{EXPRESSION}' =\n"
        "\t\tlet\n"
        f'\t\t\tSource = AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/'
        f'{WORKSPACE_ID}/{LAKEHOUSE_ID}", [HierarchicalNavigation=true])\n'
        "\t\tin\n"
        "\t\t\tSource\n"
        f"\tlineageTag: {tag('expression')}\n"
        "\n"
        "\tannotation PBI_IncludeFutureArtifacts = False\n"
    )

    relationship_lines = []
    for from_table, from_col, to_table, to_col in RELATIONSHIPS:
        name = tag(f"{from_table}-{to_table}")
        relationship_lines.append(f"relationship {name}")
        relationship_lines.append(f"\tfromColumn: '{to_table}'.{to_col}")
        relationship_lines.append(f"\ttoColumn: '{from_table}'.{from_col}")
        relationship_lines.append("")
    parts["definition/relationships.tmdl"] = "\n".join(relationship_lines)

    for display, delta, columns in TABLES:
        parts[f"definition/tables/{display}.tmdl"] = table_tmdl(display, delta, columns)
    parts["definition/tables/Measure.tmdl"] = measure_tmdl()
    return parts


def publish(parts: dict[str, str]) -> str:
    fabric = token("https://api.fabric.microsoft.com")
    headers = {"Authorization": f"Bearer {fabric}", "Content-Type": "application/json"}

    listing = json.loads(
        urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(
                f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels",
                headers=headers,
            ),
            timeout=120,
        ).read()
    )
    existing = next((m for m in listing.get("value", []) if m["displayName"] == MODEL_NAME), None)

    definition = {
        "parts": [
            {
                "path": path,
                "payload": base64.b64encode(content.encode("utf-8")).decode("ascii"),
                "payloadType": "InlineBase64",
            }
            for path, content in parts.items()
        ]
    }

    if existing:
        print(f"updating existing model {existing['id']}")
        url = (
            f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}"
            f"/semanticModels/{existing['id']}/updateDefinition"
        )
        body: dict = {"definition": definition}
    else:
        print("creating model")
        url = f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels"
        body = {"displayName": MODEL_NAME, "definition": definition}

    try:
        response = urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"),
            timeout=300,
        )
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"publish failed: {exc.code}\n{exc.read().decode('utf-8', 'replace')}")

    if response.status == 202:
        location = response.headers.get("Location")
        for _ in range(60):
            time.sleep(4)
            status = json.loads(
                urllib.request.urlopen(  # noqa: S310
                    urllib.request.Request(location, headers=headers), timeout=120
                ).read()
            )
            state = status.get("status")
            if state in {"Succeeded", "Failed"}:
                if state == "Failed":
                    raise SystemExit(f"publish failed: {json.dumps(status, indent=2)}")
                break

    listing = json.loads(
        urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(
                f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels",
                headers=headers,
            ),
            timeout=120,
        ).read()
    )
    model = next(m for m in listing["value"] if m["displayName"] == MODEL_NAME)
    return model["id"]


def reframe(model_id: str) -> None:
    """Reframe a Direct Lake model so it can answer queries.

    ⚠️ Not optional and not obvious. A model that has just deployed successfully will fail every
    query with "cannot find table" until it has been reframed once.
    """
    powerbi = token("https://analysis.windows.net/powerbi/api")
    url = f"https://api.powerbi.com/v1.0/myorg/groups/{WORKSPACE_ID}/datasets/{model_id}/refreshes"
    try:
        urllib.request.urlopen(  # noqa: S310
            urllib.request.Request(
                url,
                data=b'{"type":"full"}',
                headers={"Authorization": f"Bearer {powerbi}", "Content-Type": "application/json"},
                method="POST",
            ),
            timeout=120,
        )
        print("  reframe requested")
    except urllib.error.HTTPError as exc:
        print(f"  reframe returned {exc.code}: {exc.read().decode('utf-8', 'replace')[:200]}")
    time.sleep(20)


def main() -> None:
    parts = build_parts()

    # Written to disk as well as published: the model belongs in the repository, where it can be
    # reviewed and diffed like anything else.
    for path, content in parts.items():
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    print(f"wrote {len(parts)} TMDL parts to {OUT.relative_to(ROOT)}")

    model_id = publish(parts)
    print(f"model id: {model_id}")
    reframe(model_id)
    print(f"\nOpen it: https://app.fabric.microsoft.com/groups/{WORKSPACE_ID}/datasets/{model_id}")


if __name__ == "__main__":
    main()

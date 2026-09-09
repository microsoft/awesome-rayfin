"""Phase 5 — the Direct Lake semantic model over the flight and weather Lakehouse.

PLAN §6 names Direct Lake as one of the four hero capabilities, and Mode D is what it is for:
aggregate day statistics with no import step and no refresh window.

Three conventions are followed deliberately, and the first one is a scar:

⚠️ **Direct Lake partitions must OMIT `schemaName` on a lakehouse that is not schema-enabled.**
Tables sit at `Tables/{name}`; writing `schemaName: dbo` points at a non-existent `Tables/dbo/{name}`
and every table **silently fails to frame** — no error, no warning, just empty visuals. This is the
single most expensive thing to get wrong here, which is why it is the first thing in this docstring.

* **German Title Case table and column names, with spaces.** The model is what a business user
  sees, not a database. `flight_summary` is a file; `Flug` is a thing a person understands.
* **Every measure lives on a dedicated `Measure` table**, so the field list stays navigable.

⚠️ **Column types are read from the Delta log, not declared here.** A TMDL column whose `dataType`
disagrees with the Parquet underneath is the other way Direct Lake fails quietly, and the CSV loader
infers types on its own — so guessing them in this file would be a bet re-placed on every schema
change. `_delta_log/…json` carries the authoritative schema; this reads it.

Usage
  python tools/fabric/create_semantic_model.py --dry-run
  python tools/fabric/create_semantic_model.py
"""

from __future__ import annotations

import argparse
import base64
import json
import time
import uuid

from setup_lakehouse import (
    FABRIC_API,
    ONELAKE_DFS,
    STORAGE_RESOURCE,
    WORKSPACE_NAME,
    find_item,
    find_workspace,
    request,
    token_for,
)

MODEL_NAME = "Gleitschirm-Insights"
LAKEHOUSE_NAME = "GleitschirmInsightsLakehouse"

# Delta table -> the name a person sees. Title Case, German, spaces allowed.
TABLES = {
    "flight_summary": "Flug",
    "flight_fix": "Flugpunkt",
    "flight_wind": "Windprofil",
    "weather": "Wetter",
}

# Delta column -> display name. Anything unmapped keeps its raw name, which is a visible reminder
# that it was not thought about.
COLUMNS = {
    "flight_id": "Flug-ID",
    "aoi": "Gebiet",
    "flight_date": "Datum",
    "fixes": "Messpunkte",
    "duration_s": "Dauer (s)",
    "alt_min_m": "Minimale Höhe",
    "alt_max_m": "Maximale Höhe",
    "height_gain_m": "Höhengewinn",
    "vario_max_ms": "Bestes Steigen",
    "vario_min_ms": "Stärkstes Sinken",
    "net_distance_m": "Luftlinie",
    "track_distance_m": "Streckenlänge",
    "wind_bands": "Windbänder",
    "logger": "Gerät",
    "ts": "Zeitpunkt",
    "t_s": "Flugzeit (s)",
    "lat": "Breite",
    "lon": "Länge",
    "alt_m": "Höhe",
    "vario_ms": "Steigen",
    "ground_ms": "Geschwindigkeit",
    "band_alt_m": "Höhenband",
    "speed_ms": "Windgeschwindigkeit",
    "from_deg": "Windrichtung",
    "samples": "Messungen",
    "run_ts": "Modelllauf",
    "valid_ts": "Gültig",
    "step_h": "Vorhersagestunde",
    "parameter": "Parameter",
    "level_hpa": "Druckfläche",
    "mean": "Mittel",
    "min": "Minimum",
    "max": "Maximum",
    "cells": "Gitterzellen",
    "coverage": "Abdeckung",
}

# Delta/Parquet type -> TMDL dataType.
DATA_TYPES = {
    "string": "string",
    "long": "int64",
    "integer": "int64",
    "short": "int64",
    "byte": "int64",
    "double": "double",
    "float": "double",
    "boolean": "boolean",
    "timestamp": "dateTime",
    "timestamp_ntz": "dateTime",
    "date": "dateTime",
}

FORMAT_STRINGS = {
    "int64": "#,0",
    "double": "#,0.00",
    "dateTime": "General Date",
}

# ⚠️ Every measure that reads `Wetter` filters on a parameter name, because the table is long: one
# row per parameter per forecast step. A measure that averaged the whole column would be averaging
# cloud base against CAPE against temperature, and would produce a confident, meaningless number.
#
# `Wolkenbasis` additionally filters on coverage. ICON-D2 reports 0 where there is no shallow
# convection, and the harvester already excludes those cells — but a step where almost nothing was
# convective still reports a base from a handful of cells, and calling that "today's cloud base"
# would be the same overclaim in a different place.
MEASURES = [
    ("Flüge", "COUNTROWS ( 'Flug' )", "#,0", "Anzahl der Flüge im Filterkontext."),
    ("Messpunkte gesamt", "SUM ( 'Flug'[Messpunkte] )", "#,0", "Aufgezeichnete Positionen."),
    (
        "Höchster Punkt",
        "MAX ( 'Flug'[Maximale Höhe] )",
        "#,0 \"m\"",
        "Die größte erreichte Höhe über NN.",
    ),
    (
        "Bestes Steigen",
        "MAX ( 'Flug'[Bestes Steigen] )",
        "#,0.0 \"m/s\"",
        "Stärkstes gemessenes Steigen. Aus der Druckhöhe abgeleitet, nicht aus GPS.",
    ),
    (
        "Streckenlänge",
        "DIVIDE ( SUM ( 'Flug'[Streckenlänge] ), 1000 )",
        "#,0.0 \"km\"",
        "Über Grund geflogene Strecke.",
    ),
    (
        "Wolkenbasis",
        "CALCULATE ( AVERAGE ( 'Wetter'[Mittel] ), 'Wetter'[Parameter] = \"hbas_sc\", 'Wetter'[Abdeckung] > 0.02 )",
        "#,0 \"m\"",
        "Basis flacher Konvektion aus ICON-D2, gemittelt über die Zellen mit Quellbewölkung. Schritte ohne nennenswerte Konvektion bleiben außen vor.",
    ),
    (
        "Thermikstärke",
        "CALCULATE ( AVERAGE ( 'Wetter'[Mittel] ), 'Wetter'[Parameter] = \"cape_ml\" )",
        "#,0 \"J/kg\"",
        "CAPE aus ICON-D2 — ein Maß dafür, wie kräftig die Thermik trägt.",
    ),
    (
        "Nullgradgrenze",
        "CALCULATE ( AVERAGE ( 'Wetter'[Mittel] ), 'Wetter'[Parameter] = \"hzerocl\" )",
        "#,0 \"m\"",
        "Höhe der Nullgradgrenze aus ICON-D2.",
    ),
    (
        "Bodenwind",
        "CALCULATE ( AVERAGE ( 'Wetter'[Maximum] ), 'Wetter'[Parameter] = \"vmax_10m\" )",
        "#,0.0 \"m/s\"",
        "Stärkste Böe in 10 m über Grund im Gebiet.",
    ),
    (
        "Gemessener Wind",
        "AVERAGE ( 'Windprofil'[Windgeschwindigkeit] )",
        "#,0.0 \"m/s\"",
        "Aus der Kreisdrift des Fluges gemessen — kein Modell, keine Vorhersage.",
    ),
]

RELATIONSHIPS = [
    ("Flug", "Flug-ID", "Flugpunkt", "Flug-ID"),
    ("Flug", "Flug-ID", "Windprofil", "Flug-ID"),
]


def tag() -> str:
    return str(uuid.uuid4())


def b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def delta_schema(token: str, workspace_id: str, lakehouse_id: str, table: str) -> list[tuple[str, str]]:
    """Columns and types of a Delta table, read from its transaction log.

    ⚠️ **The newest `metaData` action, not the oldest.** Reading
    `_delta_log/00000000000000000000.json` gives the schema the table was *created* with, which is a
    different thing the moment anything overwrites it — and an overwrite is exactly how these tables
    are reloaded. That produced a model still describing a column as `dateTime` after the source had
    been fixed to `string`, with no error anywhere: the log entry was real, valid, and stale.
    """
    directory = f"{lakehouse_id}/Tables/{table}/_delta_log"
    status, payload, _ = request(
        "GET",
        f"{ONELAKE_DFS}/{workspace_id}?resource=filesystem&recursive=false&directory={directory}",
        token,
    )
    if status != 200:
        raise SystemExit(f"cannot list the delta log for {table}: {status} {str(payload)[:300]}")

    entries = payload.get("paths", []) if isinstance(payload, dict) else []
    logs = sorted(
        (e["name"] for e in entries if e.get("name", "").endswith(".json")),
        reverse=True,
    )
    if not logs:
        raise SystemExit(f"no delta log entries for {table}")

    for log in logs:
        status, payload, _ = request("GET", f"{ONELAKE_DFS}/{workspace_id}/{log}", token)
        if status != 200:
            continue
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        for line in body.decode("utf-8").splitlines():
            if not line.strip():
                continue
            action = json.loads(line)
            if "metaData" in action:
                schema = json.loads(action["metaData"]["schemaString"])
                return [(f["name"], f["type"]) for f in schema["fields"]]

    raise SystemExit(f"no metaData action in any delta log entry for {table}")


def table_tmdl(display: str, source: str, columns: list[tuple[str, str]]) -> str:
    lines = [f"table '{display}'", f"\tlineageTag: {tag()}", ""]

    for name, delta_type in columns:
        kind = delta_type.split("(")[0]
        data_type = DATA_TYPES.get(kind)
        if data_type is None:
            raise SystemExit(f"unmapped Delta type '{delta_type}' on {source}.{name}")
        label = COLUMNS.get(name, name)
        lines.append(f"\tcolumn '{label}'")
        lines.append(f"\t\tdataType: {data_type}")
        lines.append(f"\t\tsourceColumn: {name}")
        lines.append(f"\t\tlineageTag: {tag()}")
        lines.append(f"\t\tsummarizeBy: none")
        if data_type in FORMAT_STRINGS:
            lines.append(f"\t\tformatString: {FORMAT_STRINGS[data_type]}")
        lines.append("")

    # ⚠️ No `schemaName`. See the module docstring — this is the line whose absence makes it work.
    lines += [
        f"\tpartition '{display}' = entity",
        "\t\tmode: directLake",
        "\t\tsource",
        f"\t\t\tentityName: {source}",
        "\t\t\texpressionSource: DatabaseQuery",
        "",
    ]
    return "\n".join(lines)


def measure_tmdl() -> str:
    lines = ["table 'Measure'", f"\tlineageTag: {tag()}", ""]
    for name, expression, format_string, description in MEASURES:
        # ⚠️ TMDL takes a description as a `///` comment **before** the object, not as a property.
        # `description:` parses as an unknown keyword and fails the whole import.
        lines.append(f"\t/// {description}")
        lines.append(f"\tmeasure '{name}' = {expression}")
        lines.append(f"\t\tformatString: {format_string}")
        lines.append(f"\t\tlineageTag: {tag()}")
        lines.append("")

    # A measure table needs somewhere to live. One hidden column, no data, no partition source —
    # the standard shape, and the reason the field list shows measures rather than a stray column.
    lines += [
        "\tcolumn 'Platzhalter'",
        "\t\tdataType: string",
        "\t\tisHidden",
        f"\t\tlineageTag: {tag()}",
        "\t\tsummarizeBy: none",
        "\t\tsourceColumn: [Platzhalter]",
        "",
        "\tpartition 'Measure' = calculated",
        "\t\tmode: import",
        '\t\tsource = ROW("Platzhalter", BLANK())',
        "",
    ]
    return "\n".join(lines)


def relationships_tmdl() -> str:
    lines = []
    for from_table, from_column, to_table, to_column in RELATIONSHIPS:
        lines.append(f"relationship {tag()}")
        lines.append("\tfromCardinality: many")
        lines.append("\ttoCardinality: one")
        lines.append(f"\tfromColumn: '{to_table}'.'{to_column}'")
        lines.append(f"\ttoColumn: '{from_table}'.'{from_column}'")
        lines.append("")
    return "\n".join(lines)


def model_tmdl(display_names: list[str]) -> str:
    refs = "\n".join(f"ref table '{name}'" for name in display_names)
    return (
        "model Model\n"
        "\tculture: de-DE\n"
        "\tdefaultPowerBIDataSourceVersion: powerBI_V3\n"
        "\tdiscourageImplicitMeasures\n"
        "\tsourceQueryCulture: de-DE\n"
        "\n"
        f"{refs}\n"
        "\n"
        "ref cultureInfo de-DE\n"
    )


def expressions_tmdl(connection: str, database: str) -> str:
    return (
        "expression DatabaseQuery =\n"
        "\t\tlet\n"
        f'\t\t\tdatabase = Sql.Database("{connection}", "{database}")\n'
        "\t\tin\n"
        "\t\t\tdatabase\n"
        "\tlineageTag: " + tag() + "\n"
        "\tannotation PBI_IncludeFutureArtifacts = False\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", default=WORKSPACE_NAME)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = token_for(FABRIC_API)
    workspace_id = find_workspace(token, args.workspace)
    if not workspace_id:
        raise SystemExit(f"workspace not found: {args.workspace}")

    lakehouse = find_item(token, workspace_id, LAKEHOUSE_NAME, "Lakehouse")
    if not lakehouse:
        raise SystemExit(f"lakehouse not found: {LAKEHOUSE_NAME} — run setup_lakehouse.py first")

    status, payload, _ = request(
        "GET", f"{FABRIC_API}/v1/workspaces/{workspace_id}/lakehouses/{lakehouse['id']}", token
    )
    sql = payload["properties"]["sqlEndpointProperties"]
    print(f"lakehouse {lakehouse['id']}")
    print(f"  SQL endpoint {sql['connectionString']}")

    storage_token = token_for(STORAGE_RESOURCE)
    parts: list[dict] = []
    display_names: list[str] = []

    for source, display in TABLES.items():
        columns = delta_schema(storage_token, workspace_id, lakehouse["id"], source)
        print(f"  {source} -> '{display}' ({len(columns)} columns)")
        parts.append(
            {
                "path": f"definition/tables/{display}.tmdl",
                "payload": b64(table_tmdl(display, source, columns)),
                "payloadType": "InlineBase64",
            }
        )
        display_names.append(display)

    display_names.append("Measure")
    parts.append(
        {
            "path": "definition/tables/Measure.tmdl",
            "payload": b64(measure_tmdl()),
            "payloadType": "InlineBase64",
        }
    )
    parts.append(
        {
            "path": "definition/relationships.tmdl",
            "payload": b64(relationships_tmdl()),
            "payloadType": "InlineBase64",
        }
    )
    parts.append(
        {
            "path": "definition/expressions.tmdl",
            "payload": b64(expressions_tmdl(sql["connectionString"], sql["id"])),
            "payloadType": "InlineBase64",
        }
    )
    parts.append(
        {
            "path": "definition/model.tmdl",
            "payload": b64(model_tmdl(display_names)),
            "payloadType": "InlineBase64",
        }
    )
    parts.append(
        {
            "path": "definition/database.tmdl",
            "payload": b64("database\n\tcompatibilityLevel: 1604\n"),
            "payloadType": "InlineBase64",
        }
    )
    parts.append(
        {
            "path": "definition.pbism",
            "payload": b64(json.dumps({"version": "4.2", "settings": {}})),
            "payloadType": "InlineBase64",
        }
    )

    if args.dry_run:
        print(f"\nwould create semantic model '{MODEL_NAME}' with {len(parts)} definition parts:")
        for part in parts:
            print(f"  {part['path']}")
        print("\n--- Flug.tmdl ---")
        print(base64.b64decode(parts[0]["payload"]).decode("utf-8")[:1200])
        return

    existing = find_item(token, workspace_id, MODEL_NAME, "SemanticModel")
    if existing:
        print(f"  updating {existing['id']}")
        status, payload, headers = request(
            "POST",
            f"{FABRIC_API}/v1/workspaces/{workspace_id}/semanticModels/{existing['id']}/updateDefinition",
            token,
            {"definition": {"parts": parts}},
        )
    else:
        status, payload, headers = request(
            "POST",
            f"{FABRIC_API}/v1/workspaces/{workspace_id}/semanticModels",
            token,
            {"displayName": MODEL_NAME, "definition": {"parts": parts}},
        )

    if status not in (200, 201, 202):
        raise SystemExit(f"creating the semantic model failed: {status} {str(payload)[:900]}")

    location = headers.get("Location")
    if status == 202 and location:
        for _ in range(60):
            time.sleep(3)
            s, p, _ = request("GET", location, token)
            state = p.get("status") if isinstance(p, dict) else None
            if state in ("Succeeded", "Completed"):
                break
            if state == "Failed":
                raise SystemExit(f"semantic model operation failed: {json.dumps(p)[:600]}")

    model = find_item(token, workspace_id, MODEL_NAME, "SemanticModel")
    print(f"\nsemantic model '{MODEL_NAME}' ready: {model['id'] if model else '?'}")
    print(
        f"portal: https://app.fabric.microsoft.com/groups/{workspace_id}/datasets/"
        f"{model['id'] if model else ''}"
    )


if __name__ == "__main__":
    main()

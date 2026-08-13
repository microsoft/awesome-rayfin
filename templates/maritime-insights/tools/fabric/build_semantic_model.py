"""Generate and deploy the Direct Lake semantic model (PLAN §8, Phase 6).

The model is generated rather than hand-written so that it can be regenerated from one place when
the Delta tables change, and so every lineage tag is a real GUID instead of a copy-paste.

🔴 **The measures here are not new definitions.** Each headline measure restates, in DAX, a figure
the app already computes in TypeScript. That duplication is the point of the phase: two independent
implementations of the same definition, checked against each other by
`verify_model_agreement.py`. Where the two could drift, they are commented.

The one that matters most is `Vessels Under Way`. The app counts a passage as under way in an hour
if its interval *overlaps* that hour — not if it happens to report a position inside it. A
group-by on positions would look right, produce plausible numbers, and quietly disagree. Hence the
disconnected `Hour` table.
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import time
import uuid
from pathlib import Path

import ids

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "fabric" / "MaritimeInsights.SemanticModel"

WORKSPACE_ID = ids.workspace_id()
LAKEHOUSE_ID = ids.lakehouse_id()
MODEL_NAME = "Maritime-Insights — Verkehr & Sicht"
AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
EXPRESSION = "DirectLake - MaritimeInsightsLakehouse"


def tag() -> str:
    return str(uuid.uuid4())


def column(name: str, source: str, dtype: str, *, fmt: str | None = None,
           summarize: str = "none", hidden: bool = False,
           category: str | None = None) -> str:
    lines = [f"\tcolumn '{name}'", f"\t\tdataType: {dtype}"]
    if hidden:
        lines.append("\t\tisHidden")
    if fmt:
        lines.append(f"\t\tformatString: {fmt}")
    lines += [f"\t\tlineageTag: {tag()}", f"\t\tsummarizeBy: {summarize}",
              f"\t\tsourceColumn: {source}"]
    if category:
        lines.append(f"\t\tdataCategory: {category}")
    lines.append("")
    lines.append("\t\tannotation SummarizationSetBy = Automatic")
    lines.append("")
    return "\n".join(lines)


def direct_lake_table(model_name: str, entity: str, columns: list[str]) -> str:
    body = [f"table '{model_name}'", f"\tlineageTag: {tag()}", ""]
    body += columns
    # 🔴 The lakehouse is NOT schema-enabled, so its tables live at Tables/{name} with no schema
    # folder. Writing `schemaName: dbo` here would point at Tables/dbo/{name}, which does not
    # exist, and every table would silently fail to frame.
    body += [f"\tpartition '{entity}' = entity",
             "\t\tmode: directLake",
             "\t\tsource",
             f"\t\t\tentityName: {entity}",
             f"\t\t\texpressionSource: '{EXPRESSION}'",
             ""]
    return "\n".join(body)


MEASURES = [
    ("Passages", "COUNTROWS('Passage')", "#,0",
     "One row per continuous transit through the AOI. The app calls these Fahrten."),
    ("Positions", "COUNTROWS('Position')", "#,0",
     "Every AIS report that survived the AOI filter."),
    ("Vessels Under Way",
     "VAR HourStart = MIN('Hour'[hour_start_second])\n"
     "VAR HourEnd = MAX('Hour'[hour_end_second])\n"
     "RETURN\n"
     "CALCULATE(\n"
     "    COUNTROWS('Passage'),\n"
     "    FILTER(ALL('Passage'), 'Passage'[from_second] < HourEnd "
     "&& 'Passage'[to_second] >= HourStart)\n"
     ")", "#,0",
     "INTERVAL OVERLAP, matching deriveBeats() in the app. A passage counts for an hour it "
     "crosses even if it reported no position inside it. Grouping positions by hour instead "
     "would be plausible, easy, and wrong."),
    ("Peak Vessels Under Way",
     "MAXX(ALL('Hour'), [Vessels Under Way])", "#,0",
     "The busiest hour's count — the app's Verkehrsspitze beat."),
    ("Peak Hour",
     "VAR Peak = [Peak Vessels Under Way]\n"
     "RETURN\n"
     "MINX(FILTER(ALL('Hour'), [Vessels Under Way] = Peak), 'Hour'[hour_label])", None,
     "MINX breaks ties towards the earlier hour, exactly as the app's loop does."),
    ("Quietest Vessels Under Way",
     "MINX(ALL('Hour'), [Vessels Under Way])", "#,0", None),
    ("Quietest Hour",
     "VAR Quiet = [Quietest Vessels Under Way]\n"
     "RETURN\n"
     "MINX(FILTER(ALL('Hour'), [Vessels Under Way] = Quiet), 'Hour'[hour_label])", None,
     None),
    ("Average Vessels Under Way",
     "AVERAGEX(ALL('Hour'), [Vessels Under Way])", "#,0.0",
     "The day's own mean, used as the IBCS reference. With a single day there is no prior period "
     "to compare against, so inventing one would be decoration; the daily average is a real "
     "baseline that the hourly profile genuinely varies around."),
    ("Average Speed (kn)", "AVERAGE('Position'[Speed kn])", "#,0.0",
     "⚠️ DAX resolves the MODEL column name ('Speed kn'), not the physical sourceColumn "
     "('speed_kn'). TMDL accepts the wrong one at deploy time and only fails at query time."),
    ("Commercial Passages",
     "CALCULATE(COUNTROWS('Passage'), 'Vessel Class'[is_commercial] = TRUE())", "#,0",
     "Classes that ship with dimensions. The rest are anonymised further — see NOTICE.md."),
    ("Commercial Share",
     "DIVIDE([Commercial Passages], [Passages])", "0.0%", None),
    ("Median Passage Duration (min)",
     "DIVIDE(MEDIANX('Passage', 'Passage'[Duration s]), 60)", "#,0.0", None),

    # ── Committed sensor plans (PLAN §13.12) ────────────────────────────────────────────────
    # 🔴 These are the measures the APP CANNOT PRODUCE, and that is the point of them. The app
    # shows one configuration at a time — correctly, that is what it is for. The model holds
    # every plan ever committed, so "how did our answer move over six weeks" and "what does 90 %
    # of the traffic cost in mast metres across all our sites" become questions with answers.
    # Until this existed the Power BI surface only mirrored the app, which is a poor reason for
    # it to exist.
    ("Committed Plans", "COUNTROWS('Plan')", "#,0",
     "Sensor plans a planner committed to the lakehouse from the app."),
    # 🔴 DAX resolves the MODEL column name, never `sourceColumn`. Writing the Delta name here
    # deploys clean and then fails at query time with "column cannot be found" — which is why the
    # verifier runs every measure instead of trusting a successful deploy.
    ("Planned Masts", "SUM('Plan'[Masts])", "#,0", None),
    ("Planned Mast Metres", "SUM('Plan'[Mast Metres])", "#,0",
     "⚠️ Total mast height, never a price. Mast cost depends on civil works, site access and "
     "frame agreements, none of which is in any dataset here — see PLAN §13.7. This is the "
     "quantity a customer's own price list is applied to, and it is checkable."),
    ("Best Observed Share",
     "MAXX('Plan', 'Plan'[Observed Share])", "0.0%",
     "The best committed plan's share of transits observed."),
    ("Mast Metres per Point",
     "DIVIDE([Planned Mast Metres], MAXX('Plan', 'Plan'[Observed Share]) * 100)", "#,0.0",
     "Value for money, from measured quantities only: metres of mast per percentage point of "
     "traffic observed. Lower is leaner."),
    ("Plans Missing Vegetation",
     # COALESCE because COUNTROWS answers BLANK, not 0, when nothing matches — and a blank in a
     # caveat counter reads as "not computed" rather than "none affected". Those mean opposite
     # things to a reviewer deciding whether the coverage figures can be compared.
     "COALESCE(CALCULATE(COUNTROWS('Plan'), 'Plan'[Includes Vegetation] = FALSE()), 0)", "#,0",
     "🔴 Plans whose blocking surface carried no measured vegetation. Their coverage figures are "
     "an UPPER BOUND and are not comparable with the rest — the caveat travels into the model "
     "with the figure, because a share queried here is further from its definition than one read "
     "on the screen, not closer to it."),
]


def measure_table() -> str:
    lines = ["table 'Measure'", f"\tlineageTag: {tag()}", "",
             "\tcolumn 'Value'", "\t\tdataType: int64", "\t\tisHidden",
             f"\t\tlineageTag: {tag()}", "\t\tsourceColumn: [Value]",
             "\t\tsummarizeBy: none", ""]
    for name, expr, fmt, note in MEASURES:
        if note:
            for line in note.split(". "):
                lines.append(f"\t/// {line.strip().rstrip('.')}.")
        # TMDL reads everything after `=` on the same line as the whole expression, so a
        # multi-line measure must put NOTHING after the `=` and indent its body one level
        # deeper. Getting this wrong parses the second line as a property and the deploy fails
        # with `UnsupportedObjectType - VAR is not a supported property`.
        if "\n" in expr:
            lines.append(f"\tmeasure '{name}' =")
            lines += [f"\t\t\t{line}" for line in expr.split("\n")]
        else:
            lines.append(f"\tmeasure '{name}' = {expr}")
        if fmt:
            lines.append(f"\t\tformatString: {fmt}")
        lines.append(f"\t\tlineageTag: {tag()}")
        lines.append("")
    lines += ["\tpartition 'Measure' = calculated", "\t\tmode: import", "\t\tsource = {0}", ""]
    return "\n".join(lines)


def build() -> dict[str, str]:
    position = direct_lake_table("Position", "vessel_position", [
        column("Position Key", "position_key", "int64", hidden=True),
        column("Track Key", "track_key", "int64", hidden=True),
        column("Vessel Type", "vessel_type", "string"),
        column("Observed At", "observed_at", "dateTime", fmt="General Date"),
        column("Second Of Day", "second_of_day", "int64", hidden=True),
        column("Hour Of Day", "hour_of_day", "int64", fmt="#,0"),
        column("Latitude", "latitude", "double", fmt="#,0.000000", category="Latitude"),
        column("Longitude", "longitude", "double", fmt="#,0.000000", category="Longitude"),
        column("Cell Latitude", "cell_latitude", "double", fmt="#,0.0000",
               category="Latitude", hidden=True),
        column("Cell Longitude", "cell_longitude", "double", fmt="#,0.0000",
               category="Longitude", hidden=True),
        column("Cell Key", "cell_key", "string", hidden=True),
        column("Scene X m", "scene_x_m", "double", fmt="#,0", hidden=True),
        column("Scene Z m", "scene_z_m", "double", fmt="#,0", hidden=True),
        column("Speed kn", "speed_kn", "double", fmt="#,0.0", summarize="none"),
    ])
    passage = direct_lake_table("Passage", "vessel_track", [
        column("Track Key", "track_key", "int64", hidden=True),
        column("Vessel Type", "vessel_type", "string"),
        column("from_second", "from_second", "int64", hidden=True),
        column("to_second", "to_second", "int64", hidden=True),
        column("Duration s", "duration_s", "int64", fmt="#,0"),
        column("Position Count", "position_count", "int64", fmt="#,0"),
        column("Started At", "started_at", "dateTime", fmt="General Date"),
    ])
    hour = direct_lake_table("Hour", "hour_of_day", [
        column("Hour Of Day", "hour_of_day", "int64", fmt="#,0"),
        column("hour_label", "hour_label", "string"),
        column("hour_start_second", "hour_start_second", "int64", hidden=True),
        column("hour_end_second", "hour_end_second", "int64", hidden=True),
    ])
    vessel_class = direct_lake_table("Vessel Class", "vessel_class", [
        column("Vessel Type", "vessel_type", "string"),
        column("is_commercial", "is_commercial", "boolean"),
        column("carries_dimensions", "carries_dimensions", "boolean"),
    ])

    # ── Committed sensor plans (PLAN §13.12) ──────────────────────────────────────
    # Written by the app into `Files/sensor-plans`, promoted to Delta by
    # tools/fabric/publish_plans.py. The app shows one configuration; these hold every
    # configuration anyone ever committed, which is the half a 3D view cannot cover.
    plan = direct_lake_table("Plan", "sensor_plan", [
        column("plan_id", "plan_id", "string", hidden=True),
        column("Committed At", "committed_utc", "dateTime", fmt="General Date"),
        column("AOI", "aoi", "string"),
        column("Plan Name", "plan_name", "string"),
        # ⚠️ Named for what it is. The backend never sees the app's Entra token and cannot verify
        # who committed; a column called "Author" in a model would imply otherwise.
        column("Author (asserted)", "author_asserted", "string"),
        column("Scenario", "scenario", "string"),
        column("Track Date", "track_date", "string"),
        column("Masts", "sites", "int64", fmt="#,0"),
        column("Mast Metres", "mast_metres", "double", fmt="#,0"),
        column("Target Height m", "target_m", "double", fmt="#,0"),
        column("Transits", "transits", "int64", fmt="#,0"),
        column("Observed Transits", "observed_transits", "int64", fmt="#,0"),
        column("Observed Share", "observed_share", "double", fmt="0.0%"),
        column("Visible km2", "visible_km2", "double", fmt="#,0.0"),
        column("Worst Case Loss Transits", "worst_case_loss_transits", "int64", fmt="#,0"),
        column("Excluded Stationary", "excluded_stationary", "int64", fmt="#,0"),
        column("Stationary Below km", "stationary_below_km", "double", fmt="#,0.0"),
        column("Includes Vegetation", "includes_vegetation", "boolean"),
        column("Geometry Only", "geometry_only", "boolean"),
    ])
    plan_site = direct_lake_table("Plan Site", "sensor_plan_site", [
        column("plan_id", "plan_id", "string", hidden=True),
        column("Site", "site_index", "int64", fmt="#,0"),
        column("Latitude", "lat", "double", fmt="#,0.000000", category="Latitude"),
        column("Longitude", "lon", "double", fmt="#,0.000000", category="Longitude"),
        column("grid_col", "grid_col", "int64", hidden=True),
        column("grid_row", "grid_row", "int64", hidden=True),
        column("Mast m", "mast_m", "double", fmt="#,0"),
        column("Ground m", "ground_m", "double", fmt="#,0.0"),
        column("Eye m", "eye_m", "double", fmt="#,0.0"),
        column("Horizon km", "horizon_km", "double", fmt="#,0.0"),
        column("Observed Passages", "observed_passages", "int64", fmt="#,0"),
        column("Unique Passages", "unique_passages", "int64", fmt="#,0"),
    ])

    relationships = "\n".join([
        f"relationship {tag()}",
        "\tfromColumn: Position.'Track Key'",
        "\ttoColumn: Passage.'Track Key'",
        "",
        f"relationship {tag()}",
        "\tfromColumn: Passage.'Vessel Type'",
        "\ttoColumn: 'Vessel Class'.'Vessel Type'",
        "",
        # One plan, many sites. The plan table is the "one" side because a plan exists whether or
        # not its per-site rows could be read back from the document.
        f"relationship {tag()}",
        "\tfromColumn: 'Plan Site'.plan_id",
        "\ttoColumn: Plan.plan_id",
        "",
    ])

    expressions = "\n".join([
        f"expression '{EXPRESSION}' =",
        "\t\tlet",
        f'\t\t    Source = AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/'
        f'{WORKSPACE_ID}/{LAKEHOUSE_ID}", [HierarchicalNavigation=true])',
        "\t\tin",
        "\t\t    Source",
        f"\tlineageTag: {tag()}",
        "",
        "\tannotation PBI_IncludeFutureArtifacts = False",
        "",
    ])

    model = "\n".join([
        "model Model",
        "\tculture: de-DE",
        "\tdefaultPowerBIDataSourceVersion: powerBI_V3",
        "\tdiscourageImplicitMeasures",
        "\tsourceQueryCulture: de-DE",
        "\tdataAccessOptions",
        "\t\tlegacyRedirects",
        "\t\treturnErrorValuesAsNull",
        "",
        f'annotation PBI_QueryOrder = ["{EXPRESSION}"]',
        "",
        'annotation PBI_ProTooling = ["DirectLakeOnOneLakeInWeb","WebModelingEdit"]',
        "",
        "ref table Position",
        "ref table Passage",
        "ref table Hour",
        "ref table 'Vessel Class'",
        "ref table Plan",
        "ref table 'Plan Site'",
        "ref table 'Measure'",
        "",
    ])

    return {
        ".platform": json.dumps({
            "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/"
                       "platformProperties/2.0.0/schema.json",
            "metadata": {"type": "SemanticModel", "displayName": MODEL_NAME},
            "config": {"version": "2.0", "logicalId": str(uuid.uuid4())},
        }, indent=2, ensure_ascii=False) + "\n",
        "definition.pbism": json.dumps({"version": "4.0", "settings": {}}, indent=2) + "\n",
        "definition/database.tmdl": "database\n\tcompatibilityLevel: 1604\n",
        "definition/model.tmdl": model,
        "definition/expressions.tmdl": expressions,
        "definition/relationships.tmdl": relationships,
        "definition/tables/Position.tmdl": position,
        "definition/tables/Passage.tmdl": passage,
        "definition/tables/Hour.tmdl": hour,
        "definition/tables/Vessel Class.tmdl": vessel_class,
        "definition/tables/Plan.tmdl": plan,
        "definition/tables/Plan Site.tmdl": plan_site,
        "definition/tables/Measure.tmdl": measure_table(),
    }


def token(resource: str) -> str:
    out = subprocess.run([AZ, "account", "get-access-token", "--resource", resource,
                          "--query", "accessToken", "-o", "tsv"],
                         capture_output=True, text=True, check=True)
    return out.stdout.strip()


def deploy(parts: dict[str, str]) -> None:
    import urllib.error
    import urllib.request

    tok = token("https://api.fabric.microsoft.com")
    headers = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

    listing = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels",
        headers=headers)).read())
    existing = next((i for i in listing["value"] if i["displayName"] == MODEL_NAME), None)

    definition = {"parts": [
        {"path": path,
         "payload": base64.b64encode(content.encode("utf-8")).decode("ascii"),
         "payloadType": "InlineBase64"}
        for path, content in parts.items()
    ]}

    if existing:
        url = (f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}"
               f"/semanticModels/{existing['id']}/updateDefinition")
        body = {"definition": definition}
        print(f"updating existing model {existing['id']}")
    else:
        url = f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels"
        body = {"displayName": MODEL_NAME, "definition": definition}
        print("creating model")

    request = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                     headers=headers, method="POST")
    try:
        response = urllib.request.urlopen(request)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{error.code}: {error.read().decode('utf-8', 'replace')[:1200]}")

    if response.status == 202:
        location = response.headers.get("Location")
        for _ in range(60):
            time.sleep(4)
            status = json.loads(urllib.request.urlopen(
                urllib.request.Request(location, headers=headers)).read())
            if status.get("status") in {"Succeeded", "Failed"}:
                print(f"operation {status['status']}")
                if status["status"] == "Failed":
                    raise SystemExit(json.dumps(status, indent=2)[:1500])
                break
    else:
        print(json.loads(response.read()).get("id", "created"))


def frame(model_id: str) -> None:
    """Reframe the Direct Lake model.

    🔴 Not optional and not cosmetic. A freshly deployed Direct Lake model holds its tables in
    metadata but the engine cannot resolve them until it has been framed — every query fails with
    `Cannot find table`, which reads exactly like a broken TMDL and is not. The deploy reports
    Succeeded either way, so this step has to be part of deployment rather than something you
    remember.
    """
    import urllib.request

    tok = token("https://analysis.windows.net/powerbi/api")
    url = (f"https://api.powerbi.com/v1.0/myorg/groups/{WORKSPACE_ID}"
           f"/datasets/{model_id}/refreshes")
    request = urllib.request.Request(url, data=b'{"type":"full"}', method="POST", headers={
        "Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    urllib.request.urlopen(request)
    print("reframe queued")
    time.sleep(15)


def model_id(tok: str) -> str:
    import urllib.request

    listing = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels",
        headers={"Authorization": f"Bearer {tok}"})).read())
    for item in listing["value"]:
        if item["displayName"] == MODEL_NAME:
            return item["id"]
    raise SystemExit("model not found after deploy")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deploy", action="store_true")
    args = parser.parse_args()

    parts = build()
    for path, content in parts.items():
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")
    print(f"wrote {len(parts)} parts to {OUT.relative_to(REPO)}")
    print(f"  {len(MEASURES)} measures on the Measure table")

    if args.deploy:
        deploy(parts)
        identifier = model_id(token("https://api.fabric.microsoft.com"))
        frame(identifier)
        print(f"model {identifier} deployed and framed")


if __name__ == "__main__":
    main()

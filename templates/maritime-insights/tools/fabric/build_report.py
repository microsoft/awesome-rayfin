"""Generate and deploy the Power BI report over the semantic model (Phase 6).

One page, built around the figure the phase is actually about: **vessels under way, hour by hour**,
which is the same profile the app derives its story beats from. The gate
(`verify_model_agreement.py`) proves the numbers on this page are the numbers on the 3D screen.

Chart choice follows the house IBCS rule: the category is time, so it is a **column** chart, not a
bar. The reference tier is the day's own average rather than a prior period — with a single day
there is no prior period, and manufacturing one would be notation without information. Variance
against the daily mean is a real comparison and is what the hourly profile genuinely varies around.

The IBCS visual is not a marketplace visual, so it is bundled into the report itself
(`resourcePackages` + `CustomVisuals/`).
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import ids

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "fabric" / "MaritimeInsights.Report"
# The IBCS column visual is not redistributed with this repo — it is a marketplace visual. Point
# `IBCS_VISUAL_SOURCE` at a folder holding `<GUID>/package.json` + `<GUID>/resources/<GUID>.pbiviz.json`;
# the report already carries the matching `resourcePackages` entry.
IBCS_SOURCE = Path(os.environ.get("IBCS_VISUAL_SOURCE") or (REPO / "fabric" / "CustomVisuals"))
IBCS_COLUMN = "ibcsMultiTierColumnB84BA14B8B6A4201A7F698B3B38DD148"

WORKSPACE_ID = ids.workspace_id()
MODEL_NAME = "Maritime-Insights — Verkehr & Sicht"
REPORT_NAME = "Maritime-Insights — Verkehr"
AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"

W, H = 1920, 1080
NAVY = "#0B1D3A"
TEAL = "#147A67"


def token(resource: str) -> str:
    return subprocess.run([AZ, "account", "get-access-token", "--resource", resource,
                           "--query", "accessToken", "-o", "tsv"],
                          capture_output=True, text=True, check=True).stdout.strip()


def literal(value: str) -> dict:
    return {"Literal": {"Value": f"'{value}'"}}


def visual(name: str, x: float, y: float, w: float, h: float, z: int, body: dict) -> dict:
    return {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/"
                   "visualContainer/1.4.0/schema.json",
        "name": name,
        "position": {"x": x, "y": y, "z": z, "width": w, "height": h},
        "visual": body,
    }


def measure_ref(entity: str, prop: str) -> dict:
    return {"Measure": {"Expression": {"SourceRef": {"Entity": entity}}, "Property": prop}}


def column_ref(entity: str, prop: str) -> dict:
    return {"Column": {"Expression": {"SourceRef": {"Entity": entity}}, "Property": prop}}


def card(name: str, x: float, y: float, w: float, prop: str, label: str) -> dict:
    return visual(name, x, y, w, 132, 10, {
        "visualType": "card",
        "query": {"queryState": {"Values": {"projections": [
            {"field": measure_ref("Measure", prop), "queryRef": f"Measure.{prop}",
             "nativeQueryRef": prop}]}}},
        "objects": {
            "labels": [{"properties": {
                "color": {"solid": {"color": {"expr": literal(NAVY)}}},
                "fontSize": {"expr": {"Literal": {"Value": "34D"}}},
                "fontFamily": {"expr": literal("Segoe UI Semibold")}}}],
            # The card's own category label repeats the measure's English name under a German
            # title, which reads like a translation bug. Switched off.
            "categoryLabels": [{"properties": {
                "show": {"expr": {"Literal": {"Value": "false"}}}}}],
        },
        "visualContainerObjects": {
            "title": [{"properties": {
                "show": {"expr": {"Literal": {"Value": "true"}}},
                "text": {"expr": literal(label)},
                "fontSize": {"expr": {"Literal": {"Value": "12D"}}},
                "fontColor": {"solid": {"color": {"expr": literal("#5A6B77")}}}}}],
            # Kills the auto-subtitle scroll bar that otherwise appears on every titled visual.
            "subTitle": [{"properties": {"show": {"expr": {"Literal": {"Value": "false"}}}}}],
            "background": [{"properties": {
                "show": {"expr": {"Literal": {"Value": "true"}}},
                "color": {"solid": {"color": {"expr": literal("#FFFFFF")}}},
                "transparency": {"expr": {"Literal": {"Value": "0D"}}}}}],
        },
    })


def build_page() -> dict:
    visuals = [
        # Header band + title.
        visual("headerband", 0, 0, W, 66.8, 1, {
            "visualType": "shape",
            # ⚠️ The fill needs TWO entries — one carrying `show`, one carrying `fillColor` with
            # `selector.id = default`. Collapsed into one object it silently renders in the
            # theme's default blue instead of the colour asked for.
            "objects": {
                "shape": [{"properties": {"tileShape": {"expr": literal("rectangle")}}}],
                "fill": [
                    {"properties": {"show": {"expr": {"Literal": {"Value": "true"}}}}},
                    {"properties": {"fillColor": {"solid": {"color": {
                        "expr": literal(NAVY)}}}}, "selector": {"id": "default"}},
                ],
            },
            "visualContainerObjects": {
                "general": [{"properties": {
                    "keepLayerOrder": {"expr": {"Literal": {"Value": "true"}}}}}],
                "background": [{"properties": {
                    "show": {"expr": {"Literal": {"Value": "false"}}}}}],
            },
        }),
        visual("headertitle", 24, 10, 900, 46, 2, {
            "visualType": "textbox",
            "objects": {"general": [{"properties": {"paragraphs": [{"textRuns": [{
                "value": "Maritime-Insights — Schiffsverkehr Kieler Förde",
                "textStyle": {"fontSize": "20pt", "fontWeight": "bold", "color": "#FFFFFF",
                              "fontFamily": "Segoe UI Semibold"}}]}]}}]},
            # Without this the textbox paints a white card over the navy band.
            "visualContainerObjects": {
                "background": [{"properties": {
                    "show": {"expr": {"Literal": {"Value": "false"}}}}}],
                "border": [{"properties": {
                    "show": {"expr": {"Literal": {"Value": "false"}}}}}],
            },
        }),
        card("kpiPassages", 24, 92, 300, "Passages", "Fahrten"),
        card("kpiPositions", 340, 92, 300, "Positions", "AIS-Positionen"),
        card("kpiPeak", 656, 92, 300, "Peak Hour", "Verkehrsspitze"),
        card("kpiQuiet", 972, 92, 300, "Quietest Hour", "Ruhigste Stunde"),
        card("kpiCommercial", 1288, 92, 300, "Commercial Share", "Anteil gewerblich"),
        card("kpiSpeed", 1604, 92, 292, "Average Speed (kn)", "Ø Geschwindigkeit"),

        # 🔴 Full width, and not for looks: at 1160 px the visual sized its columns to ~78 px and
        # silently clipped the day at 09:00 — losing the 19:00 peak, which is the entire point of
        # the chart. 24 categories × 78 px is what it actually needs.
        visual("ibcsHourly", 24, 248, 1872, 404, 11, {
            "visualType": IBCS_COLUMN,
            "query": {"queryState": {
                "category": {"projections": [
                    {"field": column_ref("Hour", "hour_label"),
                     "queryRef": "Hour.hour_label", "nativeQueryRef": "hour_label",
                     "active": True}]},
                "actual": {"projections": [
                    {"field": measure_ref("Measure", "Vessels Under Way"),
                     "queryRef": "Measure.Vessels Under Way",
                     "nativeQueryRef": "Vessels Under Way"}]},
                "reference": {"projections": [
                    {"field": measure_ref("Measure", "Average Vessels Under Way"),
                     "queryRef": "Measure.Average Vessels Under Way",
                     "nativeQueryRef": "Average Vessels Under Way"}]},
            }},
            # 🔴 `maxVisibleCategories` defaults to 10, so the chart silently showed only
            # 00:00–09:00 at ANY width — the day looked complete and was missing its own peak.
            # The visual's capabilities allow 30 000 categories; the display cap is what clips.
            "objects": {"general": [{"properties": {
                "scenario": {"expr": literal("PY")},
                "maxVisibleCategories": {"expr": {"Literal": {"Value": "24D"}}},
            }}]},
            "visualContainerObjects": {
                "title": [{"properties": {
                    "show": {"expr": {"Literal": {"Value": "true"}}},
                    "text": {"expr": literal(
                        "Schiffe unterwegs je Stunde — Abweichung vom Tagesmittel")},
                    "fontSize": {"expr": {"Literal": {"Value": "14D"}}},
                    "fontColor": {"solid": {"color": {"expr": literal(NAVY)}}}}}],
                "subTitle": [{"properties": {"show": {"expr": {"Literal": {"Value": "false"}}}}}],
                "background": [{"properties": {
                    "show": {"expr": {"Literal": {"Value": "true"}}},
                    "color": {"solid": {"color": {"expr": literal("#FFFFFF")}}}}}],
            },
        }),

        # Vessel class mix — a structural category, so a bar chart.
        visual("classMix", 24, 668, 900, 356, 12, {
            "visualType": "barChart",
            "query": {"queryState": {
                "Category": {"projections": [
                    {"field": column_ref("Vessel Class", "Vessel Type"),
                     "queryRef": "Vessel Class.Vessel Type",
                     "nativeQueryRef": "Vessel Type"}]},
                "Y": {"projections": [
                    {"field": measure_ref("Measure", "Passages"),
                     "queryRef": "Measure.Passages", "nativeQueryRef": "Passages"}]},
            }},
            "objects": {"dataPoint": [{"properties": {
                "fill": {"solid": {"color": {"expr": literal(TEAL)}}}}}]},
            "visualContainerObjects": {
                "title": [{"properties": {
                    "show": {"expr": {"Literal": {"Value": "true"}}},
                    "text": {"expr": literal("Fahrten nach Schiffsklasse")},
                    "fontSize": {"expr": {"Literal": {"Value": "14D"}}},
                    "fontColor": {"solid": {"color": {"expr": literal(NAVY)}}}}}],
                "subTitle": [{"properties": {"show": {"expr": {"Literal": {"Value": "false"}}}}}],
                "background": [{"properties": {
                    "show": {"expr": {"Literal": {"Value": "true"}}},
                    "color": {"solid": {"color": {"expr": literal("#FFFFFF")}}}}}],
            },
        }),

        # The same positions the 3D scene draws, from the same bytes — binned to a ~550 m grid so
        # the map plots a density picture rather than choking on 44 084 points.
        # ⚠️ A map takes Latitude/Longitude ROLES with an explicit aggregate. Averaging the cell
        # centres is exact here because every point in a cell shares one centre; SUM would put a
        # single bubble in the Atlantic, which is precisely what the first attempt did.
        visual("trackMap", 948, 668, 948, 356, 13, {
            "visualType": "map",
            "query": {"queryState": {
                "Category": {"projections": [
                    {"field": column_ref("Position", "Cell Key"),
                     "queryRef": "Position.Cell Key", "nativeQueryRef": "Cell Key"}]},
                "Latitude": {"projections": [
                    {"field": {"Aggregation": {
                        "Expression": column_ref("Position", "Cell Latitude"), "Function": 1}},
                     "queryRef": "Avg(Position.Cell Latitude)",
                     "nativeQueryRef": "Cell Latitude"}]},
                "Longitude": {"projections": [
                    {"field": {"Aggregation": {
                        "Expression": column_ref("Position", "Cell Longitude"), "Function": 1}},
                     "queryRef": "Avg(Position.Cell Longitude)",
                     "nativeQueryRef": "Cell Longitude"}]},
                "Size": {"projections": [
                    {"field": measure_ref("Measure", "Positions"),
                     "queryRef": "Measure.Positions", "nativeQueryRef": "Positions"}]},
            }},
            "visualContainerObjects": {
                "title": [{"properties": {
                    "show": {"expr": {"Literal": {"Value": "true"}}},
                    "text": {"expr": literal(
                        "AIS-Positionen — dieselben Bytes, die die 3D-Szene zeichnet")},
                    "fontSize": {"expr": {"Literal": {"Value": "14D"}}},
                    "fontColor": {"solid": {"color": {"expr": literal(NAVY)}}}}}],
                "subTitle": [{"properties": {"show": {"expr": {"Literal": {"Value": "false"}}}}}],
            },
        }),

        visual("footnote", 24, 1032, 1872, 30, 14, {
            "visualType": "textbox",
            "objects": {"general": [{"properties": {"paragraphs": [{"textRuns": [{
                "value": "AIS: Danish Maritime Authority, 2026-07-01 — ohne MMSI und ohne "
                         "Schiffsnamen. Eine Fahrt ist eine durchgehende Passage durch das "
                         "Gebiet; das Modell zählt Fahrten, nicht unterscheidbare Schiffe.",
                "textStyle": {"fontSize": "9pt", "color": "#5A6B77"}}]}]}}]},
        }),
    ]

    return {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/"
                   "page/1.6.0/schema.json",
        "name": "pageVerkehr",
        "displayName": "Verkehr",
        "displayOption": "FitToPage",
        "height": H,
        "width": W,
        "objects": {"background": [{"properties": {
            "color": {"solid": {"color": {"expr": literal("#EEF4F6")}}},
            "transparency": {"expr": {"Literal": {"Value": "0D"}}}}}]},
    }, visuals


def build(model_id: str) -> dict[str, bytes]:
    page, visuals = build_page()
    parts: dict[str, bytes] = {}

    def put(path: str, obj) -> None:
        text = obj if isinstance(obj, str) else json.dumps(obj, indent=2, ensure_ascii=False)
        parts[path] = text.encode("utf-8")

    put(".platform", json.dumps({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/"
                   "platformProperties/2.0.0/schema.json",
        "metadata": {"type": "Report", "displayName": REPORT_NAME},
        "config": {"version": "2.0", "logicalId": str(uuid.uuid4())},
    }, indent=2, ensure_ascii=False))

    put("definition.pbir", json.dumps({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/"
                   "definitionProperties/1.0.0/schema.json",
        "version": "4.0",
        "datasetReference": {"byConnection": {
            "connectionString": None, "pbiServiceModelId": None,
            "pbiModelVirtualServerName": "sobe_wowvirtualserver",
            "pbiModelDatabaseName": model_id,
            "name": "EntityDataSource", "connectionType": "pbiServiceXmlaStyleLive"}},
    }, indent=2))

    put("definition/report.json", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/"
                   "report/2.0.0/schema.json",
        "themeCollection": {"baseTheme": {"name": "CY24SU10", "reportVersionAtImport": "5.55",
                                          "type": "SharedResources"}},
        "resourcePackages": [{
            # ⚠️ The item type is CustomVisualMetadata, not CustomVisual, and name == path ==
            # "<GUID>.pbiviz.json". The package itself is type CustomVisual. Getting the item
            # type wrong fails the import with a bare "does not match any schemas from 'anyOf'".
            "name": IBCS_COLUMN, "type": "CustomVisual",
            "items": [{"name": f"{IBCS_COLUMN}.pbiviz.json",
                       "path": f"{IBCS_COLUMN}.pbiviz.json",
                       "type": "CustomVisualMetadata"}],
        }, {
            "name": "SharedResources", "type": "SharedResources",
            "items": [{"name": "CY24SU10", "path": "BaseThemes/CY24SU10.json",
                       "type": "BaseTheme"}],
        }],
        "settings": {"useStylableVisualContainerHeader": True},
    })

    put("definition/version.json", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/"
                   "versionMetadata/1.0.0/schema.json",
        "version": "2.0.0",
    })
    put("definition/pages/pages.json", {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/"
                   "pagesMetadata/1.0.0/schema.json",
        "pageOrder": ["pageVerkehr"], "activePageName": "pageVerkehr",
    })
    put("definition/pages/pageVerkehr/page.json", page)
    for v in visuals:
        put(f"definition/pages/pageVerkehr/visuals/{v['name']}/visual.json", v)

    # Bundle the non-marketplace IBCS visual.
    src = IBCS_SOURCE / IBCS_COLUMN
    if not src.exists():
        raise SystemExit(f"IBCS bundle not found at {src}")
    for file in src.rglob("*"):
        if file.is_file():
            parts[f"CustomVisuals/{IBCS_COLUMN}/{file.relative_to(src).as_posix()}"] = \
                file.read_bytes()
    return parts


def deploy(parts: dict[str, bytes]) -> str:
    import urllib.error
    import urllib.request

    tok = token("https://api.fabric.microsoft.com")
    headers = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    listing = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/reports",
        headers=headers)).read())
    existing = next((i for i in listing["value"] if i["displayName"] == REPORT_NAME), None)

    definition = {"parts": [
        {"path": path, "payload": base64.b64encode(blob).decode("ascii"),
         "payloadType": "InlineBase64"}
        for path, blob in parts.items()]}

    if existing:
        url = (f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}"
               f"/reports/{existing['id']}/updateDefinition")
        body = {"definition": definition}
    else:
        url = f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/reports"
        body = {"displayName": REPORT_NAME, "definition": definition}

    request = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                     headers=headers, method="POST")
    try:
        response = urllib.request.urlopen(request)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{error.code}: {error.read().decode('utf-8', 'replace')[:1500]}")

    if response.status == 202:
        location = response.headers["Location"]
        for _ in range(60):
            time.sleep(4)
            status = json.loads(urllib.request.urlopen(
                urllib.request.Request(location, headers=headers)).read())
            if status.get("status") in {"Succeeded", "Failed"}:
                if status["status"] == "Failed":
                    raise SystemExit(json.dumps(status, indent=2)[:1500])
                break
        print("operation Succeeded")
    else:
        print("created", json.loads(response.read()).get("id"))
    return (existing or {}).get("id", "")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deploy", action="store_true")
    args = parser.parse_args()

    import urllib.request
    tok = token("https://api.fabric.microsoft.com")
    models = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels",
        headers={"Authorization": f"Bearer {tok}"})).read())
    model = next(m for m in models["value"] if m["displayName"] == MODEL_NAME)

    parts = build(model["id"])
    if OUT.exists():
        shutil.rmtree(OUT)
    for path, blob in parts.items():
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob)
    print(f"wrote {len(parts)} parts to {OUT.relative_to(REPO)}")

    if args.deploy:
        deploy(parts)


if __name__ == "__main__":
    main()

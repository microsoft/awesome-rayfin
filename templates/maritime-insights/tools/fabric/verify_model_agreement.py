"""The Phase 6 gate: does the semantic model agree with the app on every headline figure?

The point of a reporting layer next to an application is that a number quoted in a meeting is the
same number somebody sees on the screen. That is easy to claim and rarely checked, so this checks
it — by computing each figure **twice, independently**:

* the **app** side, in Python, using the same definitions `App.tsx` and `deriveBeats()` use, read
  from the same shipped asset the browser downloads;
* the **model** side, in DAX, over Direct Lake tables in Fabric.

Anything that disagrees is printed and the script exits non-zero. It is not a smoke test: it is
the phase's acceptance criterion, and it is designed to fail if either implementation drifts.

Run:  python tools/fabric/verify_model_agreement.py
"""

from __future__ import annotations

import gzip
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

import ids

REPO = Path(__file__).resolve().parents[2]
AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
MODEL_NAME = "Maritime-Insights — Verkehr & Sicht"
WORKSPACE_ID = ids.workspace_id()
ASSET = REPO / "public" / "terrain" / "kieler-foerde"


def token(resource: str) -> str:
    out = subprocess.run([AZ, "account", "get-access-token", "--resource", resource,
                          "--query", "accessToken", "-o", "tsv"],
                         capture_output=True, text=True, check=True)
    return out.stdout.strip()


def find_model(tok: str) -> str:
    url = f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/semanticModels"
    data = json.loads(urllib.request.urlopen(urllib.request.Request(
        url, headers={"Authorization": f"Bearer {tok}"})).read())
    for item in data["value"]:
        if item["displayName"] == MODEL_NAME:
            return item["id"]
    raise SystemExit(f"semantic model {MODEL_NAME!r} not found in the workspace")


def dax(dataset_id: str, tok: str, query: str) -> list[dict]:
    # Dataset-scoped, not group-scoped: the group form returns 401 GroupNotAccessible when you
    # have dataset access without workspace membership.
    url = f"https://api.powerbi.com/v1.0/myorg/datasets/{dataset_id}/executeQueries"
    body = json.dumps({"queries": [{"query": query}],
                       "serializerSettings": {"includeNulls": True}}).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(request)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"DAX failed ({error.code}): "
                         f"{error.read().decode('utf-8', 'replace')[:900]}\n\nquery:\n{query}")
    return json.loads(response.read())["results"][0]["tables"][0]["rows"]


# ---------------------------------------------------------------- the app side


def app_figures() -> dict:
    """Every figure computed exactly as the app computes it, from the asset it downloads."""
    meta = json.loads((ASSET / "tracks.json").read_text(encoding="utf-8"))
    raw = gzip.decompress((ASSET / meta["file"]).read_bytes())
    n = meta["pointCount"]
    speed = np.frombuffer(raw, dtype=np.uint8, count=n, offset=6 * n).astype(np.float64)
    tracks = meta["tracks"]

    # deriveBeats() in App.tsx, transliterated. Interval overlap, not a group-by.
    per_hour = []
    for hour in range(24):
        start, end = hour * 3600, (hour + 1) * 3600
        per_hour.append(sum(1 for t in tracks if t["fromS"] < end and t["toS"] >= start))

    busiest = max(range(24), key=lambda h: (per_hour[h], -h))
    quietest = min(range(24), key=lambda h: (per_hour[h], h))
    # Match the app's loop, which keeps the FIRST hour reaching the extreme.
    busiest = next(h for h in range(24) if per_hour[h] == max(per_hour))
    quietest = next(h for h in range(24) if per_hour[h] == min(per_hour))

    private = {"Pleasure", "Sailing", "Undefined", "Other", ""}
    commercial = sum(1 for t in tracks if (t["type"] or "Undefined") not in private)
    durations = sorted(t["toS"] - t["fromS"] for t in tracks)

    by_type: dict[str, int] = {}
    for t in tracks:
        key = t["type"] or "Undefined"
        by_type[key] = by_type.get(key, 0) + 1

    return {
        "passages": len(tracks),
        "positions": n,
        "per_hour": per_hour,
        "peak_hour": f"{busiest:02d}:00",
        "peak_vessels": per_hour[busiest],
        "quiet_hour": f"{quietest:02d}:00",
        "quiet_vessels": per_hour[quietest],
        "avg_speed": round(float((speed * meta["speedStepKn"]).round(2).mean()), 1),
        "commercial": commercial,
        "median_duration_min": round(float(np.median(durations)) / 60, 1),
        "by_type": by_type,
    }


# ---------------------------------------------------------------- the model side


def model_figures(dataset_id: str, tok: str) -> dict:
    scalars = dax(dataset_id, tok, """
        EVALUATE ROW(
            "passages", [Passages],
            "positions", [Positions],
            "peak_hour", [Peak Hour],
            "peak_vessels", [Peak Vessels Under Way],
            "quiet_hour", [Quietest Hour],
            "quiet_vessels", [Quietest Vessels Under Way],
            "avg_speed", [Average Speed (kn)],
            "commercial", [Commercial Passages],
            "median_duration_min", [Median Passage Duration (min)]
        )
    """)[0]

    hourly = dax(dataset_id, tok, """
        EVALUATE
        SUMMARIZECOLUMNS(
            'Hour'[Hour Of Day],
            "vessels", [Vessels Under Way]
        )
        ORDER BY 'Hour'[Hour Of Day]
    """)
    per_hour = [0] * 24
    for row in hourly:
        per_hour[int(row["Hour[Hour Of Day]"])] = int(row["[vessels]"] or 0)

    mix = dax(dataset_id, tok, """
        EVALUATE
        SUMMARIZECOLUMNS(
            'Passage'[Vessel Type],
            "passages", [Passages]
        )
    """)
    by_type = {row["Passage[Vessel Type]"]: int(row["[passages]"]) for row in mix}

    return {
        "passages": int(scalars["[passages]"]),
        "positions": int(scalars["[positions]"]),
        "per_hour": per_hour,
        "peak_hour": scalars["[peak_hour]"],
        "peak_vessels": int(scalars["[peak_vessels]"]),
        "quiet_hour": scalars["[quiet_hour]"],
        "quiet_vessels": int(scalars["[quiet_vessels]"]),
        "avg_speed": round(float(scalars["[avg_speed]"]), 1),
        "commercial": int(scalars["[commercial]"]),
        "median_duration_min": round(float(scalars["[median_duration_min]"]), 1),
        "by_type": by_type,
    }


def main() -> None:
    fabric_token = token("https://api.fabric.microsoft.com")
    dataset_id = find_model(fabric_token)
    pbi_token = token("https://analysis.windows.net/powerbi/api")
    print(f"model {dataset_id}\n")

    app = app_figures()
    model = model_figures(dataset_id, pbi_token)

    failures: list[str] = []

    def compare(label: str, left, right) -> None:
        ok = left == right
        mark = "ok  " if ok else "FAIL"
        print(f"  {mark}  {label:34} app={left!s:<14} model={right!s}")
        if not ok:
            failures.append(label)

    print("headline figures")
    for key, label in [
        ("passages", "Fahrten"),
        ("positions", "Positionen"),
        ("peak_hour", "Verkehrsspitze (Stunde)"),
        ("peak_vessels", "Verkehrsspitze (Schiffe)"),
        ("quiet_hour", "Ruhigste Stunde"),
        ("quiet_vessels", "Ruhigste Stunde (Schiffe)"),
        ("avg_speed", "Ø Geschwindigkeit (kn)"),
        ("commercial", "Gewerbliche Fahrten"),
        ("median_duration_min", "Median Fahrtdauer (min)"),
    ]:
        compare(label, app[key], model[key])

    print("\nvessels under way, every hour of the day")
    mismatched = [h for h in range(24) if app["per_hour"][h] != model["per_hour"][h]]
    if mismatched:
        for h in mismatched:
            print(f"  FAIL  {h:02d}:00  app={app['per_hour'][h]}  model={model['per_hour'][h]}")
        failures.append("per-hour profile")
    else:
        print(f"  ok    all 24 hours agree  "
              f"(min {min(app['per_hour'])}, max {max(app['per_hour'])})")

    print("\nvessel class mix")
    keys = sorted(set(app["by_type"]) | set(model["by_type"]))
    bad = [k for k in keys if app["by_type"].get(k, 0) != model["by_type"].get(k, 0)]
    if bad:
        for k in bad:
            print(f"  FAIL  {k:<18} app={app['by_type'].get(k, 0)}  "
                  f"model={model['by_type'].get(k, 0)}")
        failures.append("vessel class mix")
    else:
        print(f"  ok    all {len(keys)} classes agree")

    print()
    if failures:
        raise SystemExit(f"model and app disagree on: {', '.join(failures)}")
    print("PHASE 6 GATE PASSED — model and app agree on every headline figure")


if __name__ == "__main__":
    main()

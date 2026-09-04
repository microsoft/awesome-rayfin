"""Promote committed sensor plans from OneLake *Files* into Delta *Tables* (PLAN §13.12).

🔴 **Why this step exists at all.** The app writes a plan the moment a planner commits it: a JSON
document per plan and a row in an NDJSON ledger, both under `Files/`. That is the right shape for a
write — small, atomic, no schema to migrate, and writable from a Node service whose entire
dependency list is one package. It is the wrong shape for a *reader*: nothing in Fabric will build a
Direct Lake model over a folder of JSON.

So the loop is: **app writes Files → this promotes to Tables → Direct Lake → Power BI.** That is not
a workaround, it is the normal Fabric shape — the landing zone and the served model are different
things on purpose, and keeping them separate is what lets the write path stay dependency-free while
the read path gets columnar storage.

**What Power BI gets that the app cannot give it.** The app shows one configuration at a time; that
is what it is for. The model holds *every plan ever committed* — so "how did our answer change over
six weeks", "which planner commits the most redundant networks", "what does 90 % of the traffic cost
in mast metres across all our sites" become questions with answers. None of those is a question a
3D view can answer, which is the point: the Power BI surface stops mirroring the app and starts
earning its place.

⚠️ **Rebuild, not append.** Every run overwrites both tables from the ledger, because the ledger is
the record and these tables are a projection of it. An incremental load would introduce a second
place where "which plans exist" is decided, and the two would eventually disagree.

Run:
    python tools/fabric/publish_plans.py            # promote everything
    python tools/fabric/publish_plans.py --dry-run  # build and report, write nothing
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import pyarrow as pa
from deltalake import write_deltalake

import ids

WORKSPACE_ID = ids.workspace_id()
LAKEHOUSE_ID = ids.lakehouse_id()
AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"

DFS = "https://onelake.dfs.fabric.microsoft.com"
PLANS_DIR = "Files/sensor-plans"
LEDGER = f"{PLANS_DIR}/index.ndjson"


def onelake_token() -> str:
    out = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", "https://storage.azure.com",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def read_file(token: str, path: str) -> str | None:
    req = urllib.request.Request(f"{DFS}/{WORKSPACE_ID}/{LAKEHOUSE_ID}/{path}")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            return res.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def parse_ledger(text: str | None) -> list[dict]:
    """Tolerate a truncated final line — appends are not atomic across readers."""
    rows = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            print("  ⚠️  skipping a malformed ledger line (expected for a partial append)")
    return rows


def utc(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = onelake_token()
    ledger = parse_ledger(read_file(token, LEDGER))
    if not ledger:
        print(f"no plans in {LEDGER} — nothing to promote")
        return
    print(f"ledger: {len(ledger)} committed plan(s)")

    plan_rows: list[dict] = []
    site_rows: list[dict] = []
    missing_documents = 0

    for row in ledger:
        plan_id = row.get("id")
        aoi = row.get("aoi")
        plan_rows.append({
            "plan_id": plan_id,
            "committed_utc": utc(row.get("committedUtc")),
            "aoi": aoi,
            "plan_name": row.get("name"),
            "author_asserted": row.get("authorAsserted"),
            "scenario": row.get("scenario"),
            "track_date": row.get("trackDate"),
            "sites": row.get("sites"),
            "mast_metres": float(row.get("mastMetres") or 0),
            "target_m": row.get("targetM"),
            "transits": row.get("transits"),
            "observed_transits": row.get("observedTransits"),
            "observed_share": row.get("observedShare"),
            "visible_km2": row.get("visibleKm2"),
            "worst_case_loss_transits": row.get("worstCaseLossTransits"),
            # 🔴 The caveats travel with the figures into the model, for the same reason they
            # travel into the ledger: a share queried in Power BI is further from its definition
            # than one read on screen, not closer to it.
            "excluded_stationary": row.get("excludedStationary"),
            "stationary_below_km": row.get("stationaryBelowKm"),
            "includes_vegetation": row.get("includesVegetation"),
            "geometry_only": bool(row.get("geometryOnly", True)),
        })

        # The per-site grain lives only in the document; the ledger deliberately stays flat.
        body = read_file(token, f"{PLANS_DIR}/{aoi}/{plan_id}.json")
        if body is None:
            missing_documents += 1
            continue
        doc = json.loads(body)
        for site in doc.get("report", {}).get("sites", []):
            site_rows.append({
                "plan_id": plan_id,
                "site_index": site.get("index"),
                "lat": site.get("lat"),
                "lon": site.get("lon"),
                "grid_col": site.get("col"),
                "grid_row": site.get("row"),
                "mast_m": float(site.get("mastM") or 0),
                "ground_m": site.get("groundM"),
                "eye_m": site.get("eyeM"),
                "horizon_km": site.get("horizonKm"),
                "observed_passages": site.get("observedPassages"),
                "unique_passages": site.get("uniquePassages"),
            })

    if missing_documents:
        # Reported loudly: a ledger row without its document means the index and the store have
        # diverged, which is exactly the state the "document first, ledger second" write order
        # exists to make impossible.
        print(f"  ⚠️  {missing_documents} ledger row(s) had no document — index and store disagree")

    plan_schema = pa.schema([
        ("plan_id", pa.string()), ("committed_utc", pa.timestamp("us", tz="UTC")),
        ("aoi", pa.string()), ("plan_name", pa.string()), ("author_asserted", pa.string()),
        ("scenario", pa.string()), ("track_date", pa.string()),
        ("sites", pa.int32()), ("mast_metres", pa.float64()), ("target_m", pa.float64()),
        ("transits", pa.int32()), ("observed_transits", pa.int32()),
        ("observed_share", pa.float64()), ("visible_km2", pa.float64()),
        ("worst_case_loss_transits", pa.int32()),
        ("excluded_stationary", pa.int32()), ("stationary_below_km", pa.float64()),
        ("includes_vegetation", pa.bool_()), ("geometry_only", pa.bool_()),
    ])
    site_schema = pa.schema([
        ("plan_id", pa.string()), ("site_index", pa.int32()),
        ("lat", pa.float64()), ("lon", pa.float64()),
        ("grid_col", pa.int32()), ("grid_row", pa.int32()),
        ("mast_m", pa.float64()), ("ground_m", pa.float64()), ("eye_m", pa.float64()),
        ("horizon_km", pa.float64()),
        ("observed_passages", pa.int32()), ("unique_passages", pa.int32()),
    ])

    tables = {
        "sensor_plan": pa.Table.from_pylist(plan_rows, schema=plan_schema),
        "sensor_plan_site": pa.Table.from_pylist(site_rows, schema=site_schema),
    }
    for name, table in tables.items():
        print(f"  {name}: {table.num_rows} rows x {table.num_columns} columns")

    if args.dry_run:
        print("dry run — nothing written")
        return

    root = f"abfss://{WORKSPACE_ID}@onelake.dfs.fabric.microsoft.com/{LAKEHOUSE_ID}"
    options = {"bearer_token": token, "use_fabric_endpoint": "true"}
    print(f"\nwriting to {root}/Tables/")
    for name, table in tables.items():
        write_deltalake(f"{root}/Tables/{name}", table, mode="overwrite",
                        storage_options=options, schema_mode="overwrite")
        print(f"  wrote {name}")

    sync_sql_endpoint(sorted(tables))
    print("done — now run build_semantic_model.py --deploy to frame the model")


def sync_sql_endpoint(expected: list[str]) -> None:
    """Force the lakehouse SQL endpoint to notice tables written straight to OneLake.

    🔴 Writing Delta files into `Tables/` does NOT register a table. The files are there, the
    lakehouse table list does not show them, and a Direct Lake reframe fails with "one or multiple
    source tables either do not exist or access was denied" — which reads like a permissions
    problem and is not one. Discovered here the expensive way: the deploy said Succeeded, the
    reframe said Failed, and every measure answered "cannot be determined".

    So the sync belongs in this script, not in a runbook. A step a human has to remember is a step
    that gets skipped.
    """
    api = "https://api.fabric.microsoft.com/v1"
    head = {"Authorization": f"Bearer {fabric_token()}", "Content-Type": "application/json"}

    lake = request_json("GET", f"{api}/workspaces/{WORKSPACE_ID}/lakehouses/{LAKEHOUSE_ID}", head)
    endpoint_id = lake["properties"]["sqlEndpointProperties"]["id"]

    print(f"\nsyncing SQL endpoint {endpoint_id}")
    request_json("POST",
                 f"{api}/workspaces/{WORKSPACE_ID}/sqlEndpoints/{endpoint_id}"
                 "/refreshMetadata?preview=true",
                 head, body={})

    # Poll the lakehouse table list rather than trusting the call — the sync is asynchronous and
    # returning 200 only means it was accepted.
    deadline = time.time() + 180
    while time.time() < deadline:
        listed = request_json(
            "GET", f"{api}/workspaces/{WORKSPACE_ID}/lakehouses/{LAKEHOUSE_ID}/tables", head)
        names = {t["name"] for t in listed.get("data", listed.get("value", []))}
        missing = [t for t in expected if t not in names]
        if not missing:
            print(f"  registered: {', '.join(expected)}")
            return
        time.sleep(5)
    raise SystemExit(f"SQL endpoint still does not list {missing} after 180 s — "
                     "the semantic model will not frame until it does")


def fabric_token() -> str:
    out = subprocess.run([AZ, "account", "get-access-token",
                          "--resource", "https://api.fabric.microsoft.com",
                          "--query", "accessToken", "-o", "tsv"],
                         capture_output=True, text=True, check=True)
    return out.stdout.strip()


def request_json(method: str, url: str, headers: dict, body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    for key, value in headers.items():
        req.add_header(key, value)
    with urllib.request.urlopen(req, timeout=300) as res:
        raw = res.read().decode("utf-8")
    return json.loads(raw) if raw.strip() else {}


if __name__ == "__main__":
    main()

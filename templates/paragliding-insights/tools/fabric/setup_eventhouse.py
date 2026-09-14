"""Phase 4 — create the Eventhouse and the KQL database that receives live traffic.

PLAN §6 names Real-Time Intelligence as one of the hero capabilities, and live glider telemetry is
the one thing in this app that is genuinely real-time — so it is the one thing that belongs in an
Eventhouse rather than in the Lakehouse.

The database is created **with its schema attached** as a `DatabaseSchema.kql` definition part
(`fabric/kql/01_live_traffic.kql`). That is worth the base64 dance: the alternative is to create an
empty database and then run the DDL against the Kusto management endpoint, which needs a *second*
token for a different audience. This way the whole setup runs on one Fabric token.

⚠️ **Token audiences, measured rather than assumed** (2026-07-29, MCAPS tenant):

    https://api.fabric.microsoft.com    ✅ works — control plane, and this script
    https://kusto.kusto.windows.net     ✅ works — the Kusto data plane, used by ingest_live.py
    https://kusto.fabric.microsoft.com  ❌ AADSTS500011, no such resource principal in the tenant

The middle one is the audience for ingestion. The last one looks like the obvious choice for a
Fabric Eventhouse and is not a resource principal at all.

Usage
  python tools/fabric/setup_eventhouse.py --dry-run
  python tools/fabric/setup_eventhouse.py
"""

from __future__ import annotations

import argparse
import base64
import json
import time
from pathlib import Path

from setup_lakehouse import FABRIC_API, WORKSPACE_NAME, find_item, find_workspace, request, token_for

EVENTHOUSE_NAME = "GleitschirmInsightsEventhouse"
DATABASE_NAME = "GleitschirmInsightsLive"
SCHEMA_PATH = Path(__file__).resolve().parents[2] / "fabric" / "kql" / "01_live_traffic.kql"


def b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def wait_for(token: str, headers: dict, label: str) -> None:
    """Fabric item creation is a long-running operation; poll the Location header until it settles."""
    location = headers.get("Location")
    if not location:
        return
    for _ in range(60):
        time.sleep(3)
        status, payload, _ = request("GET", location, token)
        state = payload.get("status") if isinstance(payload, dict) else None
        if state in ("Succeeded", "Completed"):
            print(f"  {label}: {state}")
            return
        if state == "Failed":
            raise SystemExit(f"{label} failed: {json.dumps(payload)[:500]}")
    raise SystemExit(f"{label} did not finish in time")


def create_eventhouse(token: str, workspace_id: str) -> str:
    existing = find_item(token, workspace_id, EVENTHOUSE_NAME, "Eventhouse")
    if existing:
        print(f"  eventhouse exists: {existing['id']}")
        return existing["id"]

    status, payload, headers = request(
        "POST",
        f"{FABRIC_API}/v1/workspaces/{workspace_id}/eventhouses",
        token,
        {
            "displayName": EVENTHOUSE_NAME,
            "description": "Gleitschirm-Insights — live OGN traffic over Oberstdorf / Nebelhorn",
        },
    )
    if status not in (200, 201, 202):
        raise SystemExit(f"creating the eventhouse failed: {status} {payload}")

    if status == 202:
        wait_for(token, headers, "eventhouse")
        created = find_item(token, workspace_id, EVENTHOUSE_NAME, "Eventhouse")
        if not created:
            raise SystemExit("eventhouse reported success but is not listed")
        return created["id"]

    return payload["id"]


def create_database(token: str, workspace_id: str, eventhouse_id: str) -> None:
    existing = find_item(token, workspace_id, DATABASE_NAME, "KQLDatabase")
    if existing:
        print(f"  KQL database exists: {existing['id']} — schema left untouched")
        return

    properties = {
        "databaseType": "ReadWrite",
        "parentEventhouseItemId": eventhouse_id,
        # One day, matching the retention policy in the schema — which is set by OGN's licence, not
        # by taste: raw OGN data may not be redistributed once it is more than 24 hours old. There
        # is no point caching or storing what the retention policy has already soft-deleted.
        "oneLakeCachingPeriod": "P1D",
        "oneLakeStandardStoragePeriod": "P1D",
    }

    status, payload, headers = request(
        "POST",
        f"{FABRIC_API}/v1/workspaces/{workspace_id}/kqlDatabases",
        token,
        {
            "displayName": DATABASE_NAME,
            "definition": {
                "parts": [
                    {
                        "path": "DatabaseProperties.json",
                        "payload": b64(json.dumps(properties)),
                        "payloadType": "InlineBase64",
                    },
                    {
                        "path": "DatabaseSchema.kql",
                        "payload": b64(SCHEMA_PATH.read_text(encoding="utf-8")),
                        "payloadType": "InlineBase64",
                    },
                ]
            },
        },
    )
    if status not in (200, 201, 202):
        raise SystemExit(f"creating the KQL database failed: {status} {payload}")
    wait_for(token, headers, "kql database")
    print(f"  KQL database created with the schema from {SCHEMA_PATH.name}")


def endpoints(token: str, workspace_id: str, eventhouse_id: str) -> dict:
    status, payload, _ = request(
        "GET", f"{FABRIC_API}/v1/workspaces/{workspace_id}/eventhouses/{eventhouse_id}", token
    )
    if status != 200:
        raise SystemExit(f"reading the eventhouse failed: {status} {payload}")
    return payload.get("properties", {})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", default=WORKSPACE_NAME)
    parser.add_argument("--dry-run", action="store_true", help="resolve and print, create nothing")
    args = parser.parse_args()

    if not SCHEMA_PATH.exists():
        raise SystemExit(f"schema not found: {SCHEMA_PATH}")

    token = token_for(FABRIC_API)
    workspace_id = find_workspace(token, args.workspace)
    if not workspace_id:
        raise SystemExit(f"workspace not found: {args.workspace}")
    print(f"workspace {args.workspace} = {workspace_id}")

    if args.dry_run:
        print(f"would create eventhouse '{EVENTHOUSE_NAME}'")
        print(f"would create KQL database '{DATABASE_NAME}' with {SCHEMA_PATH}")
        print(f"  schema is {len(SCHEMA_PATH.read_text(encoding='utf-8'))} characters")
        existing_eh = find_item(token, workspace_id, EVENTHOUSE_NAME, "Eventhouse")
        existing_db = find_item(token, workspace_id, DATABASE_NAME, "KQLDatabase")
        print(f"  eventhouse already present: {bool(existing_eh)}")
        print(f"  database already present:   {bool(existing_db)}")
        return

    eventhouse_id = create_eventhouse(token, workspace_id)
    create_database(token, workspace_id, eventhouse_id)

    props = endpoints(token, workspace_id, eventhouse_id)
    print("\nendpoints — pass these to tools/fabric/ingest_live.py")
    print(f"  query  : {props.get('queryServiceUri')}")
    print(f"  ingest : {props.get('ingestionServiceUri')}")
    print(f"  database: {DATABASE_NAME}")


if __name__ == "__main__":
    main()

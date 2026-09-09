"""Convert the uploaded CSVs into Delta tables in the Lakehouse.

Uses the Fabric Load Table API rather than a Spark notebook: it is a single call per table, needs
no session warm-up, and keeps the whole Phase 5 path scriptable.

  POST /v1/workspaces/{ws}/lakehouses/{lh}/tables/{table}/load

Usage
  python tools/fabric/load_tables.py
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from setup_lakehouse import FABRIC_API, request, token_for

# CSV in OneLake Files -> Delta table name. Flattened rather than placed under a schema folder
# because the lakehouse is not schema-enabled, and a schema folder would break Direct Lake
# partition resolution (see /memories/fabric_rest_api.md).
#
# The set is the PLAN §6 Mode D grain: one row per fix, one row per flight, the derived per-flight
# wind, and the ICON-D2 archive that grows by a run a day. It is written here rather than
# discovered from the folder so that a curated file appearing by accident does not silently become
# a table.
TABLES = {
    "flight_fix": "curated/flight_fix.csv",
    "flight_summary": "curated/flight_summary.csv",
    "flight_wind": "curated/flight_wind.csv",
    "weather": "curated/weather.csv",
}


def load_table(token: str, workspace_id: str, lakehouse_id: str, table: str, path: str) -> None:
    url = f"{FABRIC_API}/v1/workspaces/{workspace_id}/lakehouses/{lakehouse_id}/tables/{table}/load"
    body = {
        "relativePath": f"Files/{path}",
        "pathType": "File",
        "mode": "Overwrite",
        "formatOptions": {"format": "Csv", "header": True, "delimiter": ","},
    }
    status, payload, headers = request("POST", url, token, body)

    if status == 202:
        location = headers.get("Location")
        for _ in range(80):
            time.sleep(3)
            s, p, _ = request("GET", location, token)
            state = p.get("status") if isinstance(p, dict) else None
            if state == "Succeeded":
                print(f"  {table}: loaded")
                return
            if state == "Failed":
                raise SystemExit(f"  {table}: failed -> {p}")
        raise SystemExit(f"  {table}: timed out")
    if status in (200, 201):
        print(f"  {table}: loaded")
        return
    raise SystemExit(f"  {table}: {status} {payload}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ids", type=Path, default=Path("tools/fabric/.fabric-ids.json"))
    args = parser.parse_args()

    ids = json.loads(args.ids.read_text(encoding="utf-8"))
    token = token_for(FABRIC_API)

    print(f"lakehouse {ids['lakehouseId']}")
    for table, path in TABLES.items():
        load_table(token, ids["workspaceId"], ids["lakehouseId"], table, path)

    status, payload, _ = request(
        "GET",
        f"{FABRIC_API}/v1/workspaces/{ids['workspaceId']}/lakehouses/{ids['lakehouseId']}/tables",
        token,
    )
    if status == 200:
        print("\ntables now in the lakehouse:")
        for t in payload.get("data", payload.get("value", [])):
            print(f"  {t.get('name')}  ({t.get('type')}, {t.get('format')})")


if __name__ == "__main__":
    main()

"""Step 9 - verify the whole chain end to end.

Checks, in the order that actually localises a fault:

  1. Eventstream topology - every node Running. Pausing the capacity pauses the Eventhouse
     *destination*, and resuming the capacity does NOT resume it. The source and the stream keep
     reporting Running, the producer notebook keeps completing, and the events simply have
     nowhere to land. Pass --resume to fix it.
  2. Kusto - row counts and how far behind the newest event is.
  3. DAX - the query the app itself issues, through executeQueries.

A telling split: `Number_Positions` (all-time count) returns a large number while the vehicle
table is empty. That means ingestion stopped more than two hours ago, not that auth is broken.
"""

import argparse
import json
from datetime import datetime, timezone

from _fabric import (
    FABRIC_API,
    POWERBI_API,
    POWERBI_RESOURCE,
    call,
    load_state,
    need,
    workspace,
)

KQL = """
last_vehicle_position
| summarize vehicles = count(), newest = max(timestamp)
"""

DAX = """
EVALUATE
ROW(
    "vehicles", COUNTROWS('Last Vehicle Position'),
    "routes", DISTINCTCOUNT('Last Vehicle Position'[trip_route_id])
)
"""


def check_eventstream(resume: bool) -> bool:
    eventstream_id = need("eventstream_id")
    status, _headers, topology = call(
        "GET", f"{FABRIC_API}/workspaces/{workspace()}/eventstreams/{eventstream_id}/topology"
    )
    if status != 200:
        print(f"  topology unreadable: HTTP {status}")
        return False

    nodes = [
        (kind, node.get("name"), node.get("status"))
        for kind in ("sources", "streams", "destinations")
        for node in topology.get(kind, [])
    ]
    for kind, name, state in nodes:
        marker = "ok  " if state == "Running" else "STOP"
        print(f"  {marker} {kind[:-1]:12} {name:32} {state}")

    paused = [n for n in nodes if n[2] != "Running"]
    if paused and resume:
        # There is no per-node resume route - /topology/destinations/{id}/resume is 404.
        # startType is required; "Now" skips the backlog.
        status, _headers, body = call(
            "POST",
            f"{FABRIC_API}/workspaces/{workspace()}/eventstreams/{eventstream_id}/resume",
            {"startType": "Now"},
        )
        print(f"  resume: HTTP {status} {json.dumps(body)[:200] if body else ''}")
        print("  nodes go Paused -> Resuming -> Running in about 30 s; re-run to confirm")
    elif paused:
        print("  -> pass --resume to restart the eventstream")

    return not paused


def check_kusto() -> bool:
    cluster = need("kusto_cluster")
    database = need("kql_database_name")
    status, _headers, body = call(
        "POST", f"{cluster}/v1/rest/query", {"db": database, "csl": KQL}, resource=cluster
    )
    if status != 200:
        print(f"  query failed: HTTP {status} {json.dumps(body)[:300]}")
        return False

    rows = body["Tables"][0]["Rows"][0]
    vehicles, newest = rows[0], rows[1]
    print(f"  vehicles in the last-position view: {vehicles}")
    if not newest:
        print("  no events at all - check the eventstream destination and the notebook")
        return False

    newest_dt = datetime.fromisoformat(newest.replace("Z", "+00:00"))
    lag = (datetime.now(timezone.utc) - newest_dt).total_seconds()
    print(f"  newest event: {newest} ({lag:.0f} s behind)")
    if lag > 900:
        print("  -> ingestion has stalled; the app's 2 h window will empty out")
        return False
    return True


def check_dax() -> bool:
    model_id = need("semantic_model_id")
    status, _headers, body = call(
        "POST",
        f"{POWERBI_API}/groups/{workspace()}/datasets/{model_id}/executeQueries",
        {"queries": [{"query": DAX}], "serializerSettings": {"includeNulls": True}},
        resource=POWERBI_RESOURCE,
    )
    if status != 200:
        print(f"  executeQueries failed: HTTP {status} {json.dumps(body)[:400]}")
        print("  -> HTTP 400 DatasetExecuteQueriesError usually means step 6 was not run")
        return False
    print("  " + json.dumps(body["results"][0]["tables"][0]["rows"][0]))
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resume", action="store_true",
                        help="resume the eventstream if any node is not Running")
    args = parser.parse_args()

    print("state:", json.dumps(load_state(), indent=2))

    results = []
    for label, check in (
        ("eventstream", lambda: check_eventstream(args.resume)),
        ("kusto", check_kusto),
        ("dax", check_dax),
    ):
        print(f"\n== {label}")
        results.append((label, check()))

    print()
    for label, ok in results:
        print(f"{'PASS' if ok else 'FAIL'}  {label}")
    if not all(ok for _label, ok in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()

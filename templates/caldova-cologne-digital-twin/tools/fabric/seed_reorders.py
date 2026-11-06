"""Seed the 8 deterministic reorders into the app's own SQL database.

Same idea as the original `data/reorder-seed.js`: the history lives where the app writes (its own
SQL database, mirrored into OneLake for the model), and the seed is IDEMPOTENT: every seeded id is
deleted before it is inserted, so a re-run cannot double it and live reorders are left alone.

Writes only to the SQL database whose id is `appSqlDatabaseId` in tools/fabric/target.json (the one
`npx rayfin up` created for this app). Columns are read from INFORMATION_SCHEMA, not assumed.

Usage:  python tools/fabric/seed_reorders.py --aoi koeln-messe
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import struct

import pyodbc

from fabric_api import ROOT, api, config, token

SQL_COPT_SS_ACCESS_TOKEN = 1256


def connect(server: str, database: str) -> pyodbc.Connection:
    raw = token("https://database.windows.net/").encode("utf-16-le")
    attrs = {SQL_COPT_SS_ACCESS_TOKEN: struct.pack(f"<I{len(raw)}s", len(raw), raw)}
    cs = f"Driver={{ODBC Driver 18 for SQL Server}};Server=tcp:{server},1433;Database={database};Encrypt=yes;TrustServerCertificate=no"
    # A Fabric SQL database auto-pauses; the first connect answers 40613 "not currently available"
    # while it wakes up (measured after a capacity resume). Retried with backoff, then raised.
    import time  # noqa: PLC0415

    for attempt in range(6):
        try:
            return pyodbc.connect(cs, attrs_before=attrs, timeout=60)
        except pyodbc.Error as exc:
            if "40613" not in str(exc) or attempt == 5:
                raise
            print(f"  database waking up (40613), retry {attempt + 1} in {15 * (attempt + 1)} s")
            time.sleep(15 * (attempt + 1))
    raise AssertionError("unreachable")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="koeln-messe")
    args = ap.parse_args()
    cfg = config()
    ws, db = cfg["workspaceId"], cfg.get("appSqlDatabaseId")
    if not db:
        raise SystemExit("set appSqlDatabaseId in tools/fabric/target.json (the app's SQL database, created by `npx rayfin up`)")
    _, info, _ = api("GET", f"/workspaces/{ws}/sqlDatabases/{db}")
    props = info.get("properties", {})
    server, database = props.get("serverFqdn", "").split(",")[0], props.get("databaseName")
    if not server or not database:
        raise SystemExit(f"no connection properties for SQL database {db}: {props}")
    with (ROOT / "data" / "operations" / args.aoi / "stock" / "restock_requests.csv").open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    con = connect(server, database)
    cur = con.cursor()
    cols = [r[0] for r in cur.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='RestockRequests' ORDER BY ORDINAL_POSITION"
    ).fetchall()]
    print("dbo.RestockRequests columns:", cols)
    need = {"id", "store_id", "sku", "qty", "requested_by", "requested_by_id", "requested_at", "status", "note"}
    if not need <= set(cols):
        raise SystemExit(f"table lacks {sorted(need - set(cols))}")
    ids = [r["request_id"] for r in rows]
    cur.execute(f"DELETE FROM dbo.RestockRequests WHERE id IN ({','.join('?' * len(ids))})", ids)
    for r in rows:
        cur.execute(
            "INSERT INTO dbo.RestockRequests (id, store_id, sku, qty, requested_by, requested_by_id, requested_at, status, note) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            r["request_id"], r["store_id"], r["sku"], int(r["qty"]), r["requested_by"], r["requested_by_id"],
            dt.datetime.fromisoformat(r["requested_at"].replace("Z", "+00:00")).replace(tzinfo=None), r["status"], r["note"],
        )
    con.commit()
    n = cur.execute(f"SELECT COUNT(*) FROM dbo.RestockRequests WHERE id IN ({','.join('?' * len(ids))})", ids).fetchone()[0]
    total = cur.execute("SELECT COUNT(*) FROM dbo.RestockRequests").fetchone()[0]
    print(f"seeded {n} of {len(ids)} reorders (table now holds {total}); the mirror reaches OneLake within ~1 min")


if __name__ == "__main__":
    main()

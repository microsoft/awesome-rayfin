"""Write the Caldova Cologne tables into the lakehouse in tools/fabric/target.json (caldova_cologne).

Two sources, both generated locally and never computed here:
  * data/operations/<aoi>/stock/*.csv   (tools/data/generate_stock.cjs, Caldova's own generator,
                                          Cologne stores): stores, products, inventory, sales
  * data/operations/<aoi>/tables/*.json (tools/data/generate_operations.py): tour, drop, vehicle,
                                          dc_zone, time_slot

Schemas are DECLARED (engine lesson: inferred types drift between runs and Direct Lake then refuses
to refresh). Column names and types of the four Caldova tables match the original caldova-operations
model exactly, so its measures port unchanged. `restock_requests.csv` is NOT loaded when the app's
SQL database is configured: reorders live there and reach the model through its OneLake mirror (as
in the original). Reframe the model after a write (publish_model.py does).

Usage:  python tools/fabric/build_lakehouse_tables.py --aoi koeln-messe [--only dc_zone ...]
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
from pathlib import Path

import pyarrow as pa
from deltalake import write_deltalake

from fabric_api import ROOT, config, token

STOCK = {
    "stores": pa.schema([("store_id", pa.string()), ("name", pa.string()), ("city", pa.string()),
                         ("region", pa.string()), ("manager_upn", pa.string())]),
    "products": pa.schema([("sku", pa.string()), ("name", pa.string()), ("category", pa.string()),
                           ("unit_price", pa.float64()), ("pack_size", pa.string())]),
    "inventory": pa.schema([("store_id", pa.string()), ("sku", pa.string()), ("on_hand_qty", pa.int64()),
                            ("reorder_point", pa.int64()), ("safety_stock", pa.int64())]),
    "sales": pa.schema([("date", pa.date32()), ("store_id", pa.string()), ("sku", pa.string()),
                        ("units_sold", pa.int64()), ("revenue", pa.float64())]),
}
#: Only where no app SQL database is configured yet: same columns as dbo.RestockRequests.
RESTOCK = pa.schema([("id", pa.string()), ("store_id", pa.string()), ("sku", pa.string()), ("qty", pa.int64()),
                     ("requested_by", pa.string()), ("requested_by_id", pa.string()),
                     ("requested_at", pa.timestamp("us")), ("status", pa.string()), ("note", pa.string())])
OPS = {
    "tour": pa.schema([("tourId", pa.string()), ("wave", pa.int32()), ("waveTime", pa.string()),
                       ("departSlot", pa.int32()), ("returnSlot", pa.int32()), ("drops", pa.int32()),
                       ("lines", pa.int64()), ("distanceKm", pa.float64()), ("kmPerDrop", pa.float64()),
                       ("onTimeDrops", pa.int32()), ("vehicleId", pa.string()), ("vehicleType", pa.string()),
                       ("vehicleClass", pa.string()), ("gCo2", pa.int64()), ("withinEvRange", pa.bool_()),
                       ("routed", pa.bool_())]),
    "drop": pa.schema([("dropId", pa.string()), ("tourId", pa.string()), ("pharmacyId", pa.string()),
                       ("wave", pa.int32()), ("sequence", pa.int32()), ("plannedSlot", pa.int32()),
                       ("lines", pa.int64()), ("onTimeInFull", pa.bool_())]),
    "vehicle": pa.schema([("vehicleId", pa.string()), ("type", pa.string()), ("vehicleClass", pa.string()),
                          ("rangeKm", pa.int32()), ("gCo2PerKm", pa.int32())]),
    "dc_zone": pa.schema([("id", pa.string()), ("name", pa.string()),
                          ("kind", pa.string()), ("sequence", pa.int32()), ("colour", pa.string()),
                          ("note", pa.string()), ("areaM2", pa.float64()),
                          ("spanM", pa.float64()), ("widthM", pa.float64()), ("centreAlongM", pa.float64()),
                          ("rackRows", pa.int32()), ("tempC", pa.float64()), ("lineShare", pa.float64()),
                          ("peakFte", pa.int32())]),
    "time_slot": pa.schema([("slotId", pa.int32()), ("minute", pa.int32()), ("label", pa.string()),
                            ("hour", pa.int32()), ("shift", pa.string()), ("lines", pa.int64())]),
}


def typed(rows: list[dict], schema: pa.Schema, name: str) -> pa.Table:
    if not rows:
        raise SystemExit(f"{name}: no rows")
    declared = {f.name for f in schema}
    present = set(rows[0].keys())
    if present != declared:
        raise SystemExit(f"{name}: schema mismatch — extra {sorted(present - declared)}, missing {sorted(declared - present)}")
    cols = {}
    for f in schema:
        vals = [r.get(f.name) for r in rows]
        if pa.types.is_date32(f.type):
            vals = [dt.date.fromisoformat(v) for v in vals]
        elif pa.types.is_timestamp(f.type):
            pass
        elif pa.types.is_integer(f.type):
            vals = [None if v in (None, "") else int(v) for v in vals]
        elif pa.types.is_floating(f.type):
            vals = [None if v in (None, "") else float(v) for v in vals]
        cols[f.name] = vals
    return pa.table(cols, schema=schema)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="koeln-messe")
    ap.add_argument("--only", nargs="+", metavar="TABLE",
                    help="write only these tables (every consistency check still runs over all of them)")
    args = ap.parse_args()
    cfg = config()
    ws, lh = cfg["workspaceId"], cfg.get("lakehouseId")
    if not lh:
        raise SystemExit("no lakehouseId: run setup_lakehouse.py first")

    root = f"abfss://{ws}@onelake.dfs.fabric.microsoft.com/{lh}"
    opts = {"bearer_token": token("https://storage.azure.com"), "use_fabric_endpoint": "true"}
    base = ROOT / "data" / "operations" / args.aoi
    # ⚠️ BUILD AND CHECK EVERYTHING FIRST, THEN WRITE: a check that
    # fails after an overwrite has already replaced good tables with bad ones.
    tables: dict[str, pa.Table] = {}
    for name, schema in STOCK.items():
        with (base / "stock" / f"{name}.csv").open(encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
        tables[name] = typed(rows, schema, name)
    for name, schema in OPS.items():
        tables[name] = typed(json.loads((base / "tables" / f"{name}.json").read_text(encoding="utf-8")), schema, name)
    if not cfg.get("appSqlDatabaseId"):
        # No app SQL database configured (app not deployed yet): the seeded reorders live in this
        # lakehouse instead (publish_model.py binds RestockRequests here and says so).
        with (base / "stock" / "restock_requests.csv").open(encoding="utf-8", newline="") as fh:
            seed = list(csv.DictReader(fh))
        for r in seed:
            r["id"] = r.pop("request_id")
            r["requested_at"] = dt.datetime.fromisoformat(r["requested_at"].replace("Z", "+00:00")).replace(tzinfo=None)
        tables["restock_requests"] = typed(seed, RESTOCK, "restock_requests")
    counts = {n: t.num_rows for n, t in tables.items()}
    tours = json.loads((base / "tables" / "tour.json").read_text(encoding="utf-8"))
    if sum(t["drops"] for t in tours) != counts["drop"]:
        raise SystemExit("tour.drops does not sum to the drop table — nothing written")
    if counts["inventory"] != counts["stores"] * counts["products"]:
        raise SystemExit("inventory is not stores x products — nothing written")
    if not set(tables["drop"].column("pharmacyId").to_pylist()) <= set(tables["stores"].column("store_id").to_pylist()):
        raise SystemExit("a drop names a pharmacy that is not a store — nothing written")
    print("consistency ok (checked before writing)")
    if args.only:
        unknown = set(args.only) - set(tables)
        if unknown:
            raise SystemExit(f"--only names unknown tables {sorted(unknown)} — nothing written")
        tables = {n: t for n, t in tables.items() if n in args.only}
    for name, table in tables.items():
        write_deltalake(f"{root}/Tables/{name}", table, mode="overwrite", schema_mode="overwrite", storage_options=opts)
        print(f"  {name:<12} {table.num_rows:>8,} rows")
    print("\n⚠️ reframe the semantic model (publish_model.py), or Direct Lake serves the previous data.")


if __name__ == "__main__":
    main()

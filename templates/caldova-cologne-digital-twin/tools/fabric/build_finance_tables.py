"""Write the Finance tab's tables into the Caldova Cologne lakehouse.

Reads data/operations/<aoi>/finance/*.json (tools/data/generate_finance.py) and writes Delta tables
`fin_*` into the lakehouse in tools/fabric/target.json (caldova_cologne). The model
`caldova-cologne-finance` maps them onto the table shapes of Michael Tenner's Finance Cockpit
('Sales Demo', 'dim-account', 'fact-pnl' ...), so the cockpit's DAX runs unchanged.

Types follow the cockpit's model exactly (HigherIsBetter boolean, DisplayInvert/VarianceInvert TEXT
"true"/"false", SortOrder/SignConvention int64): its parsers expect them that way.
Delta column names have no spaces (no column mapping needed); the model renames where the cockpit
expects a space ('Month Name', 'AC Value' …).

Usage:  python tools/fabric/build_finance_tables.py [--aoi koeln-messe]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json

import pyarrow as pa
from deltalake import write_deltalake

from fabric_api import ROOT, config, token

S, I, F, B, D = pa.string(), pa.int64(), pa.float64(), pa.bool_(), pa.date32()
TABLES = {
    "fin_sales": ("sales_demo", pa.schema([("Date", D), ("Scenario", S), ("Product", S), ("Category", S),
                                           ("Country", S), ("Region", S), ("KPI", S), ("Value", F)])),
    "fin_dim_kpi": ("dim_kpi", pa.schema([("KPI", S), ("KPI_Group", S), ("Unit", S), ("Format", S),
                                          ("HigherIsBetter", B), ("SortOrder", I)])),
    "fin_dim_market": ("dim_market", pa.schema([("Country", S), ("Region", S), ("ISO2", S), ("Currency", S),
                                                ("Latitude", F), ("Longitude", F), ("ClimateLocation", S), ("MarketMaturity", S)])),
    "fin_dim_product": ("dim_product", pa.schema([("Product", S), ("ProductID", S), ("Category", S), ("ProductLine", S),
                                                  ("LaunchDate", D), ("TargetMargin_pct", F), ("Lifecycle", S), ("Color", S)])),
    "fin_dim_scenario": ("dim_scenario", pa.schema([("Scenario", S), ("Scenario_Name", S), ("Scenario_Short", S),
                                                    ("IBCS", S), ("Type", S), ("SortOrder", I)])),
    "fin_calender": ("calender", pa.schema([("Date", D), ("Year", I), ("Month", I), ("Quarter", I),
                                            ("Month_Name", S), ("Year_Month_Number", I)])),
    "fin_dim_account": ("dim_account", pa.schema([("AccountID", S), ("ParentAccountID", S), ("Name", S),
                                                  *[(f"L{i}", S) for i in range(1, 7)], ("SortOrder", I), ("RowType", S),
                                                  ("FormulaDef", S), ("SignConvention", I), ("DisplayInvert", S),
                                                  ("VarianceInvert", S), ("Comment", S)])),
    "fin_fact_pnl": ("fact_pnl", pa.schema([("AccountID", S), ("Month", S), ("Date", D), ("AC", F), ("PY", F),
                                            ("PL", F), ("FC", F), ("FC_FY", F), ("PL_FY", F)])),
}
RENAME = {"Month Name": "Month_Name", "Year Month Number": "Year_Month_Number"}


def typed(rows: list[dict], schema: pa.Schema, name: str) -> pa.Table:
    rows = [{RENAME.get(k, k): v for k, v in r.items()} for r in rows]
    declared = {f.name for f in schema}
    present = set(rows[0]) if rows else set()
    if present != declared:
        raise SystemExit(f"{name}: schema mismatch, extra {sorted(present - declared)}, missing {sorted(declared - present)}")
    cols = {}
    for f in schema:
        vals = [r[f.name] for r in rows]
        if f.type == D:
            vals = [dt.date.fromisoformat(v) if v else None for v in vals]
        elif f.type == S:
            vals = [("true" if v else "false") if isinstance(v, bool) else ("" if v is None else str(v)) for v in vals]
        cols[f.name] = pa.array(vals, type=f.type)
    return pa.table(cols, schema=schema)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="koeln-messe")
    args = ap.parse_args()
    cfg = config()
    ws, lh = cfg["workspaceId"], cfg.get("lakehouseId")
    if not lh:
        raise SystemExit("no lakehouseId: run setup_lakehouse.py first")
    src = ROOT / "data" / "operations" / args.aoi / "finance"
    if not (src / "meta.json").exists():
        raise SystemExit(f"no finance data in {src}: run tools/data/generate_finance.py first")

    # ⚠️ BUILD AND CHECK EVERYTHING FIRST, THEN WRITE (as build_lakehouse_tables.py).
    tables = {name: typed(json.loads((src / f"{file}.json").read_text(encoding="utf-8")), schema, name)
              for name, (file, schema) in TABLES.items()}
    kpis = set(tables["fin_dim_kpi"].column("KPI").to_pylist())
    scen = set(tables["fin_dim_scenario"].column("Scenario").to_pylist())
    markets = set(tables["fin_dim_market"].column("Country").to_pylist())
    products = set(tables["fin_dim_product"].column("Product").to_pylist())
    accounts = set(tables["fin_dim_account"].column("AccountID").to_pylist())
    dates = set(tables["fin_calender"].column("Date").to_pylist())
    sales = tables["fin_sales"]
    for col, allowed in (("KPI", kpis), ("Scenario", scen), ("Country", markets), ("Product", products), ("Date", dates)):
        if not set(sales.column(col).to_pylist()) <= allowed:
            raise SystemExit(f"fin_sales.{col} has values its dimension lacks: nothing written")
    fact = tables["fin_fact_pnl"]
    if not set(fact.column("AccountID").to_pylist()) <= accounts or not set(fact.column("Date").to_pylist()) <= dates:
        raise SystemExit("fin_fact_pnl references an account or date its dimension lacks: nothing written")
    if len(set(tables["fin_dim_account"].column("AccountID").to_pylist())) != tables["fin_dim_account"].num_rows:
        raise SystemExit("duplicate AccountID: nothing written")
    print("consistency ok (checked before writing)")

    root = f"abfss://{ws}@onelake.dfs.fabric.microsoft.com/{lh}"
    opts = {"bearer_token": token("https://storage.azure.com"), "use_fabric_endpoint": "true"}
    for name, table in tables.items():
        write_deltalake(f"{root}/Tables/{name}", table, mode="overwrite", schema_mode="overwrite", storage_options=opts)
        print(f"  {name:<18} {table.num_rows:>8,} rows")
    print("\n⚠️ reframe the finance model (publish_model.py --model finance), or Direct Lake serves the previous data.")


if __name__ == "__main__":
    main()

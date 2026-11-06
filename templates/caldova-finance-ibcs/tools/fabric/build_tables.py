"""Write the statements as Delta tables into the app's lakehouse, from the tracked snapshot.

Source: public/data/statements.json (accounts, months, values per scenario). That file is the deliverable of the
generator and ships with the template, so a fresh clone can rebuild the lakehouse without the generator's input.
Checks everything before writing anything: every value names a known account, month and scenario.
After writing, reframe the model (publish_model.py), or Direct Lake serves the previous data.

Usage:  python tools/fabric/build_tables.py
"""
from __future__ import annotations

import json

import pyarrow as pa
from deltalake import write_deltalake

from fabric_api import ROOT, config, guard, token

S, I, F, B = pa.string(), pa.int64(), pa.float64(), pa.bool_()
SNAPSHOT = ROOT / "public" / "data" / "statements.json"
SCENARIOS = [("AC", "Actual"), ("PY", "Previous year"), ("PL", "Budget"), ("FC", "Forecast")]


def direction(v) -> str:
    return "up" if v is True else "down" if v is False else "none"


def main() -> None:
    cfg = config()
    ws, lh = cfg["workspaceId"], cfg["lakehouseId"]
    guard(ids=[ws, lh], names=[cfg["lakehouseName"]])
    snap = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    acc, mon = snap["accounts"], snap["months"]
    fact = [(a, m, s, float(v)) for s, by_month in snap["values"].items() for m, vals in by_month.items() for a, v in vals.items()]

    tables = {
        "fin_dim_account": pa.table({
            "AccountID": pa.array([a["id"] for a in acc], S),
            "Statement": pa.array([a["statement"] for a in acc], S),
            "ParentID": pa.array([a["parentId"] or "" for a in acc], S),
            "Name": pa.array([a["name"] for a in acc], S),
            "RowType": pa.array([a["rowType"] for a in acc], S),
            "Sign": pa.array([a["sign"] for a in acc], I),
            "Formula": pa.array([a["formula"] for a in acc], S),
            "GoodDirection": pa.array([direction(a["goodUp"]) for a in acc], S),
            "Sort": pa.array([a["sort"] for a in acc], I),
        }),
        "fin_dim_month": pa.table({
            "Month": pa.array([m["id"] for m in mon], S),
            "Year": pa.array([m["year"] for m in mon], I),
            "MonthNo": pa.array([m["monthNo"] for m in mon], I),
            "MonthName": pa.array([m["label"] for m in mon], S),
            "Closed": pa.array([m["closed"] for m in mon], B),
        }),
        "fin_dim_scenario": pa.table({
            "Scenario": pa.array([s for s, _ in SCENARIOS], S),
            "Name": pa.array([n for _, n in SCENARIOS], S),
            "Sort": pa.array(list(range(1, len(SCENARIOS) + 1)), I),
        }),
        "fin_fact_statement": pa.table({
            "AccountID": pa.array([r[0] for r in fact], S),
            "Month": pa.array([r[1] for r in fact], S),
            "Scenario": pa.array([r[2] for r in fact], S),
            "Value": pa.array([r[3] for r in fact], F),
        }),
    }
    # The dwg contract tables (tools/contract_tables.py): same numbers, the shapes the P&L Statement visual expects.
    import sys  # noqa: PLC0415
    import datetime as dt  # noqa: PLC0415

    sys.path.insert(0, str(ROOT / "tools"))
    from contract_tables import build as build_contract  # noqa: PLC0415

    D = pa.date32()
    contract = build_contract(snap)
    typed = {"Date": D, "Year": I, "Month": I, "L1 Sort": I, "SortOrder": I, "SignConvention": I,
             "Closed": B, "ReportingDate": B, "AC": F, "PY": F, "PL": F, "FC": F}
    for name, rows in contract.items():
        cols = {}
        for c in rows[0]:
            t = typed.get(c, S)
            vals = [r[c] for r in rows]
            if t == D:
                vals = [dt.date.fromisoformat(v) if v else None for v in vals]
            cols[c.replace(' ', '_')] = pa.array(vals, t)  # Delta: no spaces; the model maps L1_Sort to 'L1 Sort'
        tables[f"fin_{name}"] = pa.table(cols)
    ids, months, scens = {a["id"] for a in acc}, {m["id"] for m in mon}, {s for s, _ in SCENARIOS}
    if len(ids) != len(acc):
        raise SystemExit("duplicate account id: nothing written")
    for a, m, s, _ in fact:
        if a not in ids or m not in months or s not in scens:
            raise SystemExit(f"value with an unknown key {(a, m, s)}: nothing written")
    print("consistency ok (checked before writing)")

    root = f"abfss://{ws}@onelake.dfs.fabric.microsoft.com/{lh}"
    opts = {"bearer_token": token("https://storage.azure.com"), "use_fabric_endpoint": "true"}
    # Some networks reach only the regional OneLake host (target.json "oneLakeBlobEndpoint", e.g.
    # https://swedencentral-onelake.blob.fabric.microsoft.com); the global one then times out.
    if cfg.get("oneLakeBlobEndpoint"):
        opts["azure_endpoint"] = cfg["oneLakeBlobEndpoint"]
    for name, table in tables.items():
        write_deltalake(f"{root}/Tables/{name}", table, mode="overwrite", schema_mode="overwrite", storage_options=opts)
        print(f"  {name:<20} {table.num_rows:>7,} rows")
    print("\n⚠️ reframe the model now (publish_model.py), or Direct Lake serves the previous data.")


if __name__ == "__main__":
    main()

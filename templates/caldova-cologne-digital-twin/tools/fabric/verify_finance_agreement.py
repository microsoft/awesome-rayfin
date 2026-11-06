"""GATE: the Finance tab's numbers agree three ways.

1. AGREEMENT: the generator's files (Python) == the published model `caldova-cologne-finance` (DAX), per
   scenario × KPI × year for the cube and per scenario × P&L block for the P&L.
2. RECONCILIATION with the twin: `caldova-cologne-finance` against the twin's own operations model
   `caldova-cologne-operations`, per district × category, EXACT by construction:
     - the twin's sales window MIN/MAX(Sales[date]) is the one the generator used,
     - September units           == twin September units,
     - August units              == twin August units × 31/24 (1..7 Aug at the twin's August rate),
     - October FC3 units         == twin October units × 31/16 (open month: twin 1..16 + its rate),
     - September net revenue     == twin September sell-out × price factor × (1 − discount).
3. OPEN MONTH: no actual in October 2026 anywhere; 'P&L Last Actual Month' = 2026-09.

⚠️ SHARES NO CODE WITH THE GENERATOR beyond reading its output and its stated constants (meta.json).
Exit 1 on any difference beyond 1e-6 (relative).

Usage:  python tools/fabric/verify_finance_agreement.py [--aoi koeln-messe]
"""
from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict

from bake_reorder_snapshot import Model
from fabric_api import ROOT, config

TOL = 1e-6


#: The generator stores values rounded to cents (round(v, 2)); the twin side is exact. Half a cent per cell.
CENT = 0.0051


def close(a: float, b: float, abs_tol: float = 1e-3) -> bool:
    return math.isclose(a or 0.0, b or 0.0, rel_tol=TOL, abs_tol=abs_tol)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="koeln-messe")
    args = ap.parse_args()
    cfg = config()
    if not cfg.get("financeModelId") or not cfg.get("semanticModelId"):
        raise SystemExit("publish both models first (publish_model.py and publish_model.py --model finance)")
    fin = Model({**cfg, "semanticModelId": cfg["financeModelId"]})
    ops = Model(cfg)
    src = ROOT / "data" / "operations" / args.aoi / "finance"
    meta = json.loads((src / "meta.json").read_text(encoding="utf-8"))
    sales = json.loads((src / "sales_demo.json").read_text(encoding="utf-8"))
    fact = json.loads((src / "fact_pnl.json").read_text(encoding="utf-8"))
    konten = {a["AccountID"]: a for a in json.loads((src / "dim_account.json").read_text(encoding="utf-8"))}
    problems: list[str] = []
    checks = 0

    # ── 1a. cube: scenario × KPI × year ────────────────────────────────────────────────────────────
    py = defaultdict(float)
    for r in sales:
        py[(r["Scenario"], r["KPI"], int(r["Date"][:4]))] += r["Value"]
    dax = fin.rows("""
EVALUATE SUMMARIZECOLUMNS('Sales Demo'[Scenario], 'dim-kpi'[KPI], Calender[Year], "V", SUM('Sales Demo'[Value]))""")
    seen = set()
    for r in dax:
        k = (r["Sales Demo[Scenario]"], r["dim-kpi[KPI]"], r["Calender[Year]"])
        seen.add(k)
        checks += 1
        if not close(r["[V]"], py[k]):
            problems.append(f"cube {k}: DAX {r['[V]']} vs Python {py[k]}")
    if seen != set(py):
        problems.append(f"cube keys differ: only Python {sorted(set(py) - seen)[:5]}, only DAX {sorted(seen - set(py))[:5]}")

    # ── 1b. P&L: scenario column × top-level block × year (leaf accounts, unsigned) ───────────────
    def top(aid: str) -> str:
        while konten[aid]["ParentAccountID"]:
            aid = konten[aid]["ParentAccountID"]
        return aid
    pg = defaultdict(float)
    for r in fact:
        if konten[r["AccountID"]]["RowType"] != "Account":
            continue
        for col in ("AC", "PY", "PL", "FC"):
            pg[(col, top(r["AccountID"]), int(r["Month"][:4]))] += r[col] or 0.0
    leaves = [a for a, v in konten.items() if v["RowType"] == "Account"]
    by_top = defaultdict(list)
    for a in leaves:
        by_top[top(a)].append(a)
    for block, accs in by_top.items():
        ids = ", ".join('"' + a.replace('"', '""') + '"' for a in accs)
        rows = fin.rows(f"""
EVALUATE SUMMARIZECOLUMNS(Calender[Year], TREATAS({{{ids}}}, 'dim-account'[AccountID]),
  "AC", [P&L AC], "PY", [P&L PY], "PL", [P&L PL], "FC", [P&L FC])""")
        for r in rows:
            for col in ("AC", "PY", "PL", "FC"):
                checks += 1
                if not close(r[f"[{col}]"], pg[(col, block, r["Calender[Year]"])]):
                    problems.append(f"P&L {block} {col} {r['Calender[Year]']}: DAX {r[f'[{col}]']} vs Python {pg[(col, block, r['Calender[Year]'])]}")

    # ── 2. reconciliation with the twin's operations model ─────────────────────────────────────────
    win = ops.rows('EVALUATE ROW("first", MIN(Sales[date]), "last", MAX(Sales[date]))')[0]
    if win["[first]"][:10] != meta["twinWindow"][0] or win["[last]"][:10] != meta["twinWindow"][1]:
        problems.append(f"twin window {win} != generator {meta['twinWindow']}")
    twin = defaultdict(lambda: {"units": 0.0, "sellout": 0.0})
    for r in ops.rows("""
EVALUATE SUMMARIZECOLUMNS(Stores[region], Products[category], 'Sales'[date],
  "U", SUM(Sales[units_sold]), "R", SUM(Sales[revenue]))"""):
        m = r["Sales[date]"][:7]
        k = (r["Stores[region]"], r["Products[category]"], m)
        twin[k]["units"] += r["[U]"]
        twin[k]["sellout"] += r["[R]"]
    finq = defaultdict(float)
    for r in fin.rows("""
EVALUATE SUMMARIZECOLUMNS('dim-market'[Country], 'dim-product'[Product], 'Sales Demo'[Date], 'dim-scenario'[Scenario], 'dim-kpi'[KPI],
  TREATAS({"AC", "FC3"}, 'dim-scenario'[Scenario]), TREATAS({"Units Sold", "Revenue"}, 'dim-kpi'[KPI]),
  TREATAS({DATE(2026,8,1), DATE(2026,9,1), DATE(2026,10,1)}, 'Sales Demo'[Date]), "V", SUM('Sales Demo'[Value]))"""):
        finq[(r["dim-market[Country]"], r["dim-product[Product]"], r["Sales Demo[Date]"][:7], r["dim-scenario[Scenario]"], r["dim-kpi[KPI]"])] = r["[V]"]
    cat_name = {en: v[0] for en, v in meta["categories"].items()}
    disc = {v[0]: v[4] for v in meta["categories"].values()}
    districts = sorted({k[0] for k in twin})
    for dist in districts:
        for cat in cat_name.values():
            t = lambda m: twin[(dist, cat, m)]  # noqa: E731
            for got, want, what in (
                (finq[(dist, cat, "2026-09", "AC", "Units Sold")], t("2026-09")["units"], "Sep units"),
                (finq[(dist, cat, "2026-08", "AC", "Units Sold")], t("2026-08")["units"] * 31 / 24, "Aug units"),
                (finq[(dist, cat, "2026-10", "FC3", "Units Sold")], t("2026-10")["units"] * 31 / 16, "Oct FC3 units"),
                (finq[(dist, cat, "2026-09", "AC", "Revenue")], t("2026-09")["sellout"] * meta["priceFactor"] * (1 - disc[cat]), "Sep revenue"),
            ):
                checks += 1
                if not close(got, want, CENT):
                    problems.append(f"reconcile {dist}/{cat} {what}: finance {got} vs twin {want}")

    # ── 3. open month ──────────────────────────────────────────────────────────────────────────────
    om = fin.rows("""EVALUATE ROW("last", [P&L Last Actual Month],
  "octAC", CALCULATE(SUM('Sales Demo'[Value]), 'Sales Demo'[Scenario] = "AC", 'Sales Demo'[Date] >= DATE(2026,10,1)),
  "octPnlAC", CALCULATE([P&L AC], 'fact-pnl'[Month] = "2026-10"))""")[0]
    checks += 1
    if om["[last]"] != "2026-09" or om["[octAC]"] not in (None, 0) or om["[octPnlAC]"] not in (None, 0):
        problems.append(f"open month: {om}")

    if problems:
        print(f"FINANCE AGREEMENT FAILED ({len(problems)} of {checks}):")
        for p in problems[:25]:
            print("  -", p)
        raise SystemExit(1)
    print(f"FINANCE AGREEMENT OK: {checks} checks (Python == DAX, finance == twin, October open), {fin.calls + ops.calls} queries")


if __name__ == "__main__":
    main()

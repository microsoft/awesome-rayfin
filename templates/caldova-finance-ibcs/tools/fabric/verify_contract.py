"""The dwg contract in the model tells the same story as the app's snapshot (DAX against the live model).

Checks for the cut-off month and the open year's December: balance sheet blocks (BS AC/FC), cash at month end vs
the cash-flow closing (opening + flows), P&L net income YTD vs the snapshot. Exit 1 on any difference.

Usage:  python tools/fabric/verify_contract.py
"""
from __future__ import annotations

import json
import sys

from fabric_api import ROOT, config, dax, guard

snap = json.loads((ROOT / "public" / "data" / "statements.json").read_text(encoding="utf-8"))
cutoff = snap["meta"]["cutoff"]
year = cutoff[:4]


def rows(q):
    return [{k[k.rfind("[") + 1:-1]: v for k, v in r.items()} for r in dax(q)]


def main() -> None:
    cfg = config()
    guard(ids=[cfg["workspaceId"], cfg["modelId"]])
    bad = []
    for month, meas, scen in ((cutoff, "BS AC", "AC"), (f"{year}-12", "BS FC", "FC")):
        bs = {r["L1"]: r["v"] for r in rows(f"""EVALUATE SUMMARIZECOLUMNS ( 'BS Account'[L1], TREATAS ( {{ "{month}" }}, 'Calendar'[Period] ), "v", [{meas}] )""")}
        want = {k: v for k, v in snap["values"][scen][month].items()}
        assets = sum(want[k] for k in want if k.startswith(("B-FA", "B-CA")))
        eq = sum(want[k] for k in want if k.startswith("B-EQ"))
        if abs(bs.get("Assets", 0) - assets) > 1 or abs(bs.get("Assets", 0) - bs.get("Equity", 0) - bs.get("Liabilities", 0)) > 1 or abs(bs.get("Equity", 0) - eq) > 1:
            bad.append(f"{month} {meas}: model {bs} vs snapshot assets {assets:.0f} equity {eq:.0f}")
        cf = rows(f"""EVALUATE ROW ( "close", CALCULATE ( [{meas.replace('BS', 'CF')}], TREATAS ( {{ "{month}" }}, 'Calendar'[Period] ) ) )""")[0]["close"]
        if abs(cf - want["B-CA-CASH"]) > 1:
            bad.append(f"{month}: cash flow opening + flows {cf:.0f} vs balance sheet cash {want['B-CA-CASH']:.0f}")
        print(f"{month} {meas}: assets {bs.get('Assets', 0):,.0f} = equity {bs.get('Equity', 0):,.0f} + liabilities {bs.get('Liabilities', 0):,.0f}; cash {cf:,.0f}")
    ni = rows(f"""EVALUATE ROW ( "ni", CALCULATE ( SUMX ( VALUES ( 'P&L Account'[SignConvention] ), [P&L AC] * 'P&L Account'[SignConvention] ), 'Calendar'[Year] = {year}, 'Calendar'[Closed] = TRUE () ) )""")[0]["ni"]
    want_ni = sum(snap["values"]["AC"][m]["C-OP-NI"] for m in snap["values"]["AC"] if m.startswith(year) and m <= cutoff)
    print(f"P&L net income {year} YTD: model {ni:,.0f}, snapshot {want_ni:,.0f}")
    if abs(ni - want_ni) > 1:
        bad.append(f"net income YTD {ni:.0f} vs {want_ni:.0f}")
    if bad:
        print("CONTRACT DIFFERS:\n  " + "\n  ".join(bad))
        sys.exit(1)
    print("contract ok: the model's dwg tables match the app's snapshot")


if __name__ == "__main__":
    main()

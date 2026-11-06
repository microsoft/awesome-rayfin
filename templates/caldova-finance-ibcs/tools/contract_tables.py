"""The dwg data contract for Caldova Finance, in English.

dwg cli (github.com/Losveratos/dwg-cli, MIT, Michael Tenner · Daten-WG) renders the original P&L Statement byDatenWG
visual in a Fabric App and as a Power BI report from one spec. Its templates T04B (P&L with ΔPL waterfall), T05A
(balance sheet at the reporting date) and T05B (cash-flow bridge) expect the table shapes of its showcase contract
(`examples/showcase/CONTRACT.md`): per statement an account table with levels L1/L2, a row type with the visual's
tokens (`Account stock`, `Account opening`, `Formula stock`), formulas by account NAME, sign conventions, and a fact
table with AC, PY, PL and FC per month. This module builds those tables, with English names, from the snapshot the
app ships (public/data/statements.json), so the contract always holds the same numbers as the app.

Values are stored POSITIVE with the account's SignConvention (as the visual expects); AC is empty after the cut-off.

Usage: imported by tools/fabric/build_tables.py; `python tools/contract_tables.py` prints the tables' sizes and checks.
"""
from __future__ import annotations

import calendar
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "public" / "data" / "statements.json"
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# ── balance sheet: three blocks so the equity ratio can name its parts (the visual's formulas take names) ─
BS = [  # id, name, L1, L1 sort, sort, row type, formula, variance invert (higher = unfavourable)
    ("B-FA-FLEET", "Vehicles", "Assets", 10, 11, "Account stock", "", False),
    ("B-FA-EQUIP", "Warehouse equipment & IT", "Assets", 10, 12, "Account stock", "", False),
    ("B-CA-INV", "Inventories", "Assets", 10, 13, "Account stock", "", True),
    ("B-CA-REC", "Trade receivables", "Assets", 10, 14, "Account stock", "", True),
    ("B-CA-CASH", "Cash", "Assets", 10, 15, "Account stock", "", False),
    ("B-EQ-CAP", "Share capital", "Equity", 20, 21, "Account stock", "", False),
    ("B-EQ-RE", "Retained earnings", "Equity", 20, 22, "Account stock", "", False),
    ("B-EQ-NI", "Net income for the year", "Equity", 20, 23, "Account stock", "", False),
    ("B-PR-TAX", "Tax provisions", "Liabilities", 30, 31, "Account stock", "", True),
    ("B-PR-OTH", "Other provisions", "Liabilities", 30, 32, "Account stock", "", True),
    ("B-LI-LOAN", "Bank loans", "Liabilities", 30, 33, "Account stock", "", True),
    ("B-LI-PAY", "Trade payables", "Liabilities", 30, 34, "Account stock", "", True),
    ("F-EQL", "Equity and liabilities", "Equity and liabilities", 40, 40, "Formula stock", "[Equity] + [Liabilities]", False),
    ("K-EQR", "Equity ratio", "Equity ratio", 50, 50, "KPI", "[Equity] / [Equity and liabilities]", False),
]
# ── cash flow: opening, three flows, closing (as T05B: opening token, closing as a stock formula) ───────
CF = [  # id, name, L1, L1 sort, sort, row type, formula, source account in the snapshot
    ("CF-OPEN", "Opening cash", "Opening cash", 10, 10, "Account opening", "", "C-OPEN"),
    ("CF-NI", "Net income", "Operating cash flow", 20, 21, "Account", "", "C-OP-NI"),
    ("CF-DA", "Depreciation", "Operating cash flow", 20, 22, "Account", "", "C-OP-DA"),
    ("CF-REC", "Change in trade receivables", "Operating cash flow", 20, 23, "Account", "", "C-OP-REC"),
    ("CF-INV", "Change in inventories", "Operating cash flow", 20, 24, "Account", "", "C-OP-INV"),
    ("CF-PAY", "Change in trade payables", "Operating cash flow", 20, 25, "Account", "", "C-OP-PAY"),
    ("CF-PR", "Change in provisions", "Operating cash flow", 20, 26, "Account", "", "C-OP-PR"),
    ("CF-FLEET", "Purchase of vehicles", "Investing cash flow", 30, 31, "Account", "", "C-IN-FLEET"),
    ("CF-EQUIP", "Purchase of equipment & IT", "Investing cash flow", 30, 32, "Account", "", "C-IN-EQUIP"),
    ("CF-LOAN", "Loan repayments", "Financing cash flow", 40, 41, "Account", "", "C-FI-LOAN"),
    ("CF-DIV", "Dividends paid", "Financing cash flow", 40, 42, "Account", "", "C-FI-DIV"),
    ("CF-CLOSE", "Closing cash", "Closing cash", 50, 50, "Formula stock",
     "[Opening cash] + [Operating cash flow] + [Investing cash flow] + [Financing cash flow]", "C-CLOSE"),
]
SCENARIOS = ("AC", "PY", "PL", "FC")


def _account_row(aid, parent, name, l1, l1_sort, l2, sort, row_type, formula, sign, display_invert, variance_invert):
    return {"AccountID": aid, "ParentID": parent, "Account": name, "L1": l1, "L1 Sort": l1_sort, "L2": l2,
            "SortOrder": sort, "RowType": row_type, "FormulaDef": formula or None, "SignConvention": sign,
            "DisplayInvert": "true" if display_invert else "false",
            "VarianceInvert": "true" if variance_invert else "false", "Comment": None}


def build(snapshot: dict | None = None) -> dict[str, list[dict]]:
    snap = snapshot or json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    cutoff = snap["meta"]["cutoff"]
    months = [m["id"] for m in snap["months"]]
    values = snap["values"]
    accounts = {a["id"]: a for a in snap["accounts"]}

    calendar_rows = []
    for m in snap["months"]:
        y, mo = m["year"], m["monthNo"]
        calendar_rows.append({"Date": dt.date(y, mo, 1).isoformat(), "Year": y, "Month": mo, "MonthName": MONTH_ABBR[mo - 1],
                              "Period": m["id"], "Quarter": f"Q{(mo - 1) // 3 + 1}", "Closed": m["id"] <= cutoff})

    # ── P&L: two levels. Top-level subtotals stay; leaves hang under their top-level ancestor (the
    # intermediate groups of the app's tree, e.g. revenue per category, flatten into L2). ────────────────
    pl = sorted((a for a in snap["accounts"] if a["statement"] == "PL"), key=lambda a: a["sort"])
    name = {a["id"]: a["name"] for a in pl}

    def top(aid: str) -> dict:
        a = accounts[aid]
        while a["parentId"]:
            a = accounts[a["parentId"]]
        return a

    def by_name(formula: str) -> str:
        for aid, nm in sorted(name.items(), key=lambda kv: -len(kv[0])):
            formula = formula.replace(f"[{aid}]", f"[{nm}]")
        return formula

    pl_accounts, pl_leaves = [], []
    for a in pl:
        sign = a["sign"]
        cost = sign < 0
        if a["rowType"] == "Subtotal" and a["parentId"] is None:
            pl_accounts.append(_account_row(a["id"], None, a["name"], None, a["sort"], None, a["sort"], "Subtotal", "", sign, cost, False))
        elif a["rowType"] == "Account":
            t = top(a["id"])
            pl_accounts.append(_account_row(a["id"], t["id"], a["name"], t["name"], t["sort"], a["name"], a["sort"], "Account", "", sign, cost, False))
            pl_leaves.append(a)
        elif a["rowType"] in ("Formula", "KPI"):
            pl_accounts.append(_account_row(a["id"], None, a["name"], a["name"], a["sort"], None, a["sort"], a["rowType"], by_name(a["formula"]), 1, False, False))
        # intermediate subtotals (rowType Subtotal with a parent) are left out: L1/L2 carry the structure

    def fact_rows(leaf_ids, source_of, sign_of):
        rows = []
        for m in months:
            for aid in leaf_ids:
                src = source_of(aid)
                row = {"Date": f"{m}-01", "AccountID": aid}
                for s in SCENARIOS:
                    v = values[s].get(m, {}).get(src)
                    if s == "AC" and m > cutoff:
                        v = None
                    row[s] = None if v is None else round(sign_of(aid) * v, 2)
                rows.append(row)
        return rows

    pl_sign = {a["id"]: a["sign"] for a in pl_leaves}
    pl_fact = fact_rows([a["id"] for a in pl_leaves], lambda aid: aid, lambda aid: pl_sign[aid])  # signed -> positive

    bs_accounts = [_account_row(i, None, n, l1, s1, n if rt.startswith("Account") else None, so, rt, f, 1, False, vi)
                   for i, n, l1, s1, so, rt, f, vi in BS]
    # Reporting date: the last closed month of every year (December, and the cut-off in the open year).
    years = sorted({m[:4] for m in months})
    reporting = {max(m for m in months if m.startswith(y) and m <= cutoff) for y in years if any(m.startswith(y) and m <= cutoff for m in months)}
    bs_fact = fact_rows([r[0] for r in BS if r[5].startswith("Account")], lambda aid: aid, lambda aid: 1)
    for r in bs_fact:
        r["ReportingDate"] = r["Date"][:7] in reporting

    cf_src = {r[0]: r[7] for r in CF}
    cf_accounts = [_account_row(i, None, n, l1, s1, n if rt == "Account" else None, so, rt, f, 1, False, False)
                   for i, n, l1, s1, so, rt, f, _ in CF]
    cf_fact = fact_rows([r[0] for r in CF if r[5].startswith("Account")], lambda aid: cf_src[aid], lambda aid: 1)

    tables = {"calendar": calendar_rows, "pl_account": pl_accounts, "pl_fact": pl_fact,
              "bs_account": bs_accounts, "bs_fact": bs_fact, "cf_account": cf_accounts, "cf_fact": cf_fact}
    check(tables, snap)
    return tables


def check(t: dict, snap: dict) -> None:
    """The contract must tell the same story as the app: balance, articulation, net income."""
    cutoff = snap["meta"]["cutoff"]
    for scen in SCENARIOS:
        for m in [x["Period"] for x in t["calendar"]]:
            if scen == "AC" and m > cutoff:
                continue
            bs = {r["AccountID"]: r[scen] for r in t["bs_fact"] if r["Date"][:7] == m}
            if not bs or any(v is None for v in bs.values()):
                continue
            assets = sum(v for k, v in bs.items() if k.startswith(("B-FA", "B-CA")))
            eql = sum(v for k, v in bs.items() if k.startswith(("B-EQ", "B-PR", "B-LI")))
            assert abs(assets - eql) < 0.05, (scen, m, assets, eql)
            cf = {r["AccountID"]: r[scen] for r in t["cf_fact"] if r["Date"][:7] == m}
            closing = sum(v for v in cf.values() if v is not None)  # opening + every flow
            assert abs(closing - bs["B-CA-CASH"]) < 0.5, (scen, m, closing, bs["B-CA-CASH"])
            sign = {a["AccountID"]: a["SignConvention"] for a in t["pl_account"] if a["RowType"] == "Account"}
            ni = sum(sign[r["AccountID"]] * r[scen] for r in t["pl_fact"] if r["Date"][:7] == m and r[scen] is not None)
            assert abs(ni - cf["CF-NI"]) < 0.05, (scen, m, ni, cf["CF-NI"])


if __name__ == "__main__":
    tables = build()
    for k, v in tables.items():
        print(f"{k:<11} {len(v):>5} rows")
    print("checks ok: balance sheet balances, cash flow closes on cash, P&L net income = cash flow net income")

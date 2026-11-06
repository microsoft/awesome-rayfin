"""Caldova GmbH: the three financial statements for the IBCS Financial Statements app.

Input: the P&L that the Caldova Köln twin derives from its own sales and tours
(`caldova-koeln-zwilling/tools/data/generate_finance.py`, output `data/operations/koeln-messe/finance`).
This script translates it to English and adds a driver-based balance sheet and an indirect cash flow
statement that articulate with it, month by month and scenario by scenario.

⚠️ EVERYTHING HERE IS FICTIONAL. Caldova is the invented wholesaler of a public Microsoft demo; the balance
sheet drivers below are stated assumptions, not data.

Scenarios: AC (actual, closed months up to the cut-off), PL (budget), FC (latest forecast: AC up to the
cut-off, forecast after it), PY (AC of the same month one year earlier). P&L and cash flow values are monthly
flows, balance sheet values are month-end balances.

Usage:  python tools/generate_statements.py [--source <finance dir>]
Writes data/statements/*.json and public/data/statements.json, and prints its own checks.
"""
from __future__ import annotations

import argparse
import calendar
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT.parent / "caldova-koeln-zwilling" / "data" / "operations" / "koeln-messe" / "finance"

COMPANY = "Caldova GmbH"
CURRENCY = "EUR"
CUTOFF = "2026-09"          # last closed month; October 2026 is open
YEARS = (2025, 2026)
TAX_RATE = 0.3166           # same rate as the P&L's tax lines

# ── stated balance sheet drivers (a pharma wholesaler turns stock and receivables fast) ───────────────
DSO, DIO, DPO = 21.0, 18.0, 30.0      # days of net revenue, of COGS, of COGS
OPENING = {                           # balance sheet at 31 Dec 2023, EUR (cash is the balancing item)
    "B-FA-FLEET": 420_000.0, "B-FA-EQUIP": 520_000.0,
    "B-EQ-CAP": 500_000.0, "B-EQ-RE": 1_050_000.0, "B-EQ-NI": 0.0,
    "B-PR-TAX": 28_000.0, "B-PR-OTH": 160_000.0,
    "B-LI-LOAN": 1_500_000.0,
}
OPENING_FLOWS_2023_DEC = {"revenue": 2_850_000.0, "cogs": 2_520_000.0}  # December 2023, for receivables/stock/payables
LOAN_REPAYMENT = 18_000.0             # per month
DIVIDEND_SHARE, DIVIDEND_MONTH = 0.5, 5   # half of the prior year's net income, paid in May
CAPEX = {                             # per year: (fleet by month, equipment by month)
    2024: ({4: 60_000.0}, {m: 7_000.0 for m in range(1, 13)}),
    2025: ({4: 75_000.0, 10: 40_000.0}, {m: 7_500.0 for m in range(1, 13)}),
    2026: ({4: 90_000.0, 9: 45_000.0}, {m: 8_000.0 for m in range(1, 13)}),
}
TAX_PAYMENT_MONTHS = {1: 4, 2: 4, 3: 4, 4: 7, 5: 7, 6: 7, 7: 10, 8: 10, 9: 10, 10: 1, 11: 1, 12: 1}  # accrual month -> paid in

# ── English P&L tree (ids kept from the source, names translated) ──────────────────────────────────
CATEGORY = {"Allergy": "Allergy", "Cold & flu": "Cold & flu", "Digestive": "Digestive", "First aid": "First aid",
            "Pain relief": "Pain relief", "Vitamins": "Vitamins"}
PL_NAMES = {
    "N-REV": "Net revenue", "N-COGS": "Cost of goods sold", "N-COGS-HW": "Merchandise",
    "F-GP": "Gross profit", "K-GM": "Gross margin %",
    "N-OPEX": "Operating expenses", "N-OPEX-PER": "Personnel", "N-OPEX-LOG": "Fleet & logistics",
    "N-OPEX-RAU": "Premises", "N-OPEX-SON": "Other expenses",
    "6000": "Warehouse & picking staff", "6010": "Drivers", "6020": "Administration & sales staff",
    "6100": "Energy (diesel, power)", "6110": "Maintenance & tyres", "6120": "Vehicle leasing",
    "6130": "Tolls & insurance", "6500": "Distribution centre rent", "6510": "Utilities & cooling",
    "6600": "IT & digital", "6610": "Packaging & cool boxes", "6620": "Advisory & audit",
    "N-OOR": "Other operating result", "6900": "Other operating income", "6910": "Other operating expenses",
    "F-EBITDA": "EBITDA", "K-EBITDA": "EBITDA margin %",
    "N-DA": "Depreciation", "7000": "Depreciation fleet", "7010": "Depreciation equipment & IT",
    "F-EBIT": "EBIT", "N-FIN": "Financial result", "7500": "Interest income", "7510": "Interest expense",
    "F-EBT": "Earnings before tax", "N-TAX": "Income taxes", "8000": "Corporate income tax", "8010": "Trade tax",
    "F-NI": "Net income", "K-NM": "Net margin %",
}


def pl_name(aid: str) -> str:
    if aid in PL_NAMES:
        return PL_NAMES[aid]
    if aid.startswith("N-REV-"):
        return CATEGORY[aid[6:]]
    if aid.startswith("4000-"):
        return f"Gross sales {CATEGORY[aid[5:]].lower()}"
    if aid.startswith("4100-"):
        return f"Discounts {CATEGORY[aid[5:]].lower()}"
    if aid.startswith("5000-"):
        return CATEGORY[aid[5:]]
    raise KeyError(aid)


# ── balance sheet and cash flow trees ──────────────────────────────────────────────────────────────
# (id, parent, name, row type, sign: +1 adds to the parent, -1 subtracts)
BS_TREE = [
    ("B-ASSETS", None, "Total assets", "Subtotal", 1),
    ("B-FA", "B-ASSETS", "Non-current assets", "Subtotal", 1),
    ("B-FA-FLEET", "B-FA", "Vehicles", "Account", 1),
    ("B-FA-EQUIP", "B-FA", "Warehouse equipment & IT", "Account", 1),
    ("B-CA", "B-ASSETS", "Current assets", "Subtotal", 1),
    ("B-CA-INV", "B-CA", "Inventories", "Account", 1),
    ("B-CA-REC", "B-CA", "Trade receivables", "Account", 1),
    ("B-CA-CASH", "B-CA", "Cash", "Account", 1),
    ("B-EQL", None, "Total equity & liabilities", "Subtotal", 1),
    ("B-EQ", "B-EQL", "Equity", "Subtotal", 1),
    ("B-EQ-CAP", "B-EQ", "Share capital", "Account", 1),
    ("B-EQ-RE", "B-EQ", "Retained earnings", "Account", 1),
    ("B-EQ-NI", "B-EQ", "Net income for the year", "Account", 1),
    ("B-PR", "B-EQL", "Provisions", "Subtotal", 1),
    ("B-PR-TAX", "B-PR", "Tax provisions", "Account", 1),
    ("B-PR-OTH", "B-PR", "Other provisions", "Account", 1),
    ("B-LI", "B-EQL", "Liabilities", "Subtotal", 1),
    ("B-LI-LOAN", "B-LI", "Bank loans", "Account", 1),
    ("B-LI-PAY", "B-LI", "Trade payables", "Account", 1),
]
CF_TREE = [
    ("C-OP", None, "Cash flow from operating activities", "Subtotal", 1),
    ("C-OP-NI", "C-OP", "Net income", "Account", 1),
    ("C-OP-DA", "C-OP", "Depreciation", "Account", 1),
    ("C-OP-REC", "C-OP", "Change in trade receivables", "Account", 1),
    ("C-OP-INV", "C-OP", "Change in inventories", "Account", 1),
    ("C-OP-PAY", "C-OP", "Change in trade payables", "Account", 1),
    ("C-OP-PR", "C-OP", "Change in provisions", "Account", 1),
    ("C-IN", None, "Cash flow from investing activities", "Subtotal", 1),
    ("C-IN-FLEET", "C-IN", "Purchase of vehicles", "Account", 1),
    ("C-IN-EQUIP", "C-IN", "Purchase of equipment & IT", "Account", 1),
    ("C-FI", None, "Cash flow from financing activities", "Subtotal", 1),
    ("C-FI-LOAN", "C-FI", "Loan repayments", "Account", 1),
    ("C-FI-DIV", "C-FI", "Dividends paid", "Account", 1),
    ("C-NET", None, "Change in cash", "Formula", 1),
    ("C-OPEN", None, "Cash at beginning of period", "Balance", 1),
    ("C-CLOSE", None, "Cash at end of period", "Balance", 1),
]
# Higher is better? For the variance colour (IBCS: colour by impact). None = no inherent direction (totals,
# fixed assets, provisions, payables): such variances are drawn grey, not green or red.
BS_GOOD_UP = {"B-CA-CASH": True, "B-EQ": True, "B-EQ-RE": True, "B-EQ-NI": True,
              "B-CA-INV": False, "B-CA-REC": False, "B-LI-LOAN": False}


def months(y0: int, m0: int, y1: int, m1: int):
    y, m = y0, m0
    while (y, m) <= (y1, m1):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def key(y: int, m: int) -> str:
    return f"{y}-{m:02d}"


def days(y: int, m: int) -> int:
    return calendar.monthrange(y, m)[1]


def load_pl(source: Path):
    """Signed monthly P&L leaves (revenue +, costs -) per scenario series, from the source fact table."""
    accounts = json.loads((source / "dim_konten.json").read_text(encoding="utf-8"))
    fact = json.loads((source / "fact_guv.json").read_text(encoding="utf-8"))
    sign = {a["AccountID"]: a["SignConvention"] for a in accounts}
    leaves = [a["AccountID"] for a in accounts if a["RowType"] == "Account"]
    series = {"AC": {}, "PL": {}, "FC": {}}
    for r in fact:
        aid, ym = r["AccountID"], r["Monat"]
        if aid not in leaves:
            continue
        y = int(ym[:4])
        s = sign[aid]
        if r["AC"] is not None:
            series["AC"].setdefault(ym, {})[aid] = s * r["AC"]
        if y == 2025:  # PY of 2025 = AC 2024
            series["AC"].setdefault(key(2024, int(ym[5:])), {})[aid] = s * r["PY"]
        series["PL"].setdefault(ym, {})[aid] = s * r["PL"]
        series["FC"].setdefault(ym, {})[aid] = s * r["FC"]
    return accounts, leaves, series


def pl_totals(g: dict) -> dict:
    """The P&L figures the balance sheet needs, from signed leaves of one month."""
    rev = sum(v for a, v in g.items() if a.startswith(("4000", "4100")))
    cogs = -sum(v for a, v in g.items() if a.startswith("5000"))
    dep = -(g.get("7000", 0.0) + g.get("7010", 0.0))
    tax = -(g.get("8000", 0.0) + g.get("8010", 0.0))
    ni = sum(g.values())
    return {"revenue": rev, "cogs": cogs, "dep_fleet": -g.get("7000", 0.0), "dep_equip": -g.get("7010", 0.0),
            "dep": dep, "tax": tax, "ni": ni}


def roll(opening: dict, pl_by_month: list, tax_due: dict, prior_year_ni: float | None = None):
    """Roll the balance sheet forward month by month.

    opening: closing balances of the month before the first one; pl_by_month: [(y, m, signed P&L leaves)];
    tax_due: tax accrued but not yet paid, keyed by payment month (1, 4, 7, 10); prior_year_ni: net income of
    the previous year, needed (for the dividend) only when the roll starts after January.
    Returns {key: (balances, cash flow lines, tax due after the month)}.
    """
    bal = dict(opening)
    due = defaultdict(float, tax_due)
    out = {}
    for y, m, g in pl_by_month:
        t = pl_totals(g)
        b = dict(bal)
        if m == 1:  # the year's result moves to retained earnings
            prior_year_ni = b["B-EQ-NI"]
            b["B-EQ-RE"] += b["B-EQ-NI"]
            b["B-EQ-NI"] = 0.0
        if prior_year_ni is None:
            raise ValueError(f"a roll that starts in {key(y, m)} needs the prior year's net income")
        dividend = DIVIDEND_SHARE * max(0.0, prior_year_ni) if m == DIVIDEND_MONTH else 0.0
        b["B-EQ-RE"] -= dividend
        b["B-EQ-NI"] += t["ni"]
        fleet_capex = CAPEX[y][0].get(m, 0.0)
        equip_capex = CAPEX[y][1].get(m, 0.0)
        b["B-FA-FLEET"] += fleet_capex - t["dep_fleet"]
        b["B-FA-EQUIP"] += equip_capex - t["dep_equip"]
        b["B-CA-REC"] = t["revenue"] * DSO / days(y, m)
        b["B-CA-INV"] = t["cogs"] * DIO / days(y, m)
        b["B-LI-PAY"] = t["cogs"] * DPO / days(y, m)
        b["B-LI-LOAN"] -= LOAN_REPAYMENT
        due[TAX_PAYMENT_MONTHS[m]] += t["tax"]
        paid = due.pop(m, 0.0) if m in (1, 4, 7, 10) else 0.0
        b["B-PR-TAX"] += t["tax"] - paid
        cf = {
            "C-OP-NI": t["ni"], "C-OP-DA": t["dep"],
            "C-OP-REC": -(b["B-CA-REC"] - bal["B-CA-REC"]),
            "C-OP-INV": -(b["B-CA-INV"] - bal["B-CA-INV"]),
            "C-OP-PAY": b["B-LI-PAY"] - bal["B-LI-PAY"],
            "C-OP-PR": (b["B-PR-TAX"] - bal["B-PR-TAX"]) + (b["B-PR-OTH"] - bal["B-PR-OTH"]),
            "C-IN-FLEET": -fleet_capex, "C-IN-EQUIP": -equip_capex,
            "C-FI-LOAN": -LOAN_REPAYMENT, "C-FI-DIV": -dividend,
        }
        net = sum(cf.values())
        b["B-CA-CASH"] = bal["B-CA-CASH"] + net
        cf.update({"C-NET": net, "C-OPEN": bal["B-CA-CASH"], "C-CLOSE": b["B-CA-CASH"]})
        out[key(y, m)] = (b, cf, dict(due))
        bal = b
    return out


def subtotal(tree, leaf_values: dict) -> dict:
    """Values for every node of a tree from its leaves (sign +1/-1 into the parent)."""
    vals = defaultdict(float)
    parent = {i: p for i, p, *_ in tree}
    sign = {i: s for i, _, _, _, s in tree}
    for i, v in leaf_values.items():
        if i not in parent:
            continue
        vals[i] += v
        p, s = parent[i], sign[i]
        while p:
            vals[p] += s * v
            s *= sign[p]
            p = parent[p]
    return vals


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    args = ap.parse_args()
    pl_accounts, leaves, series = load_pl(args.source)

    # ── opening balance 31 Dec 2023, cash balancing ───────────────────────────────────────────────
    o = dict(OPENING)
    o["B-CA-REC"] = OPENING_FLOWS_2023_DEC["revenue"] * DSO / 31
    o["B-CA-INV"] = OPENING_FLOWS_2023_DEC["cogs"] * DIO / 31
    o["B-LI-PAY"] = OPENING_FLOWS_2023_DEC["cogs"] * DPO / 31
    eql = o["B-EQ-CAP"] + o["B-EQ-RE"] + o["B-EQ-NI"] + o["B-PR-TAX"] + o["B-PR-OTH"] + o["B-LI-LOAN"] + o["B-LI-PAY"]
    o["B-CA-CASH"] = eql - (o["B-FA-FLEET"] + o["B-FA-EQUIP"] + o["B-CA-INV"] + o["B-CA-REC"])
    assert o["B-CA-CASH"] > 0, o["B-CA-CASH"]
    # The opening tax provision is Q4 2023 tax, paid in January 2024.
    opening_due = {1: o["B-PR-TAX"]}

    # ── AC: Jan 2024 .. cut-off ───────────────────────────────────────────────────────────────────
    cy, cm = int(CUTOFF[:4]), int(CUTOFF[5:])
    ac_months = [(y, m, series["AC"][key(y, m)]) for y, m in months(2024, 1, cy, cm)]
    ac = roll(o, ac_months, opening_due)

    def start_after(ref: str):
        """Opening state for a roll that starts the month after `ref` (an AC month)."""
        b, _, due = ac[ref]
        return dict(b), due

    def prior_ni(y: int) -> float:
        return ac[key(y - 1, 12)][0]["B-EQ-NI"]

    # ── PL: each year from the AC balance at the previous year-end ─────────────────────────────────
    pl = {}
    for y in YEARS:
        b, due = start_after(key(y - 1, 12))
        pl.update(roll(b, [(y, m, series["PL"][key(y, m)]) for m in range(1, 13)], due))
    # ── FC: AC up to the cut-off, then forecast months from the AC balance at the cut-off ──────────
    fc = {k: v for k, v in ac.items() if k >= "2025-01"}
    b, due = start_after(CUTOFF)
    fc_rest = [(y, m, series["FC"][key(y, m)]) for y, m in months(cy, cm + 1, 2026, 12)] if cm < 12 else []
    fc.update(roll(b, fc_rest, due, prior_ni(cy)))

    # ── checks: balance, articulation ─────────────────────────────────────────────────────────────
    worst = 0.0
    for name, path in (("AC", ac), ("PL", pl), ("FC", fc)):
        prev_cash = None
        for k, (b, cf, _) in sorted(path.items()):
            # PL restarts every January from the AC year-end; AC and FC run through.
            if name == "PL" and k.endswith("-01"):
                prev_cash = None
            assets = b["B-FA-FLEET"] + b["B-FA-EQUIP"] + b["B-CA-INV"] + b["B-CA-REC"] + b["B-CA-CASH"]
            eql = b["B-EQ-CAP"] + b["B-EQ-RE"] + b["B-EQ-NI"] + b["B-PR-TAX"] + b["B-PR-OTH"] + b["B-LI-LOAN"] + b["B-LI-PAY"]
            worst = max(worst, abs(assets - eql))
            assert abs(assets - eql) < 0.01, (name, k, assets, eql)
            assert abs(cf["C-CLOSE"] - cf["C-OPEN"] - cf["C-NET"]) < 0.01, (name, k)
            if prev_cash is not None:
                assert abs(cf["C-OPEN"] - prev_cash) < 0.01, (name, k, cf["C-OPEN"], prev_cash)
            prev_cash = cf["C-CLOSE"]
            assert b["B-CA-CASH"] > 0, (name, k, b["B-CA-CASH"])
    print(f"balance sheets balance (worst {worst:.4f} EUR), cash flow = change in cash, every month and scenario")

    # ── output tables ─────────────────────────────────────────────────────────────────────────────
    dim_account = []
    sort = 0
    for a in pl_accounts:
        sort += 1
        if a["RowType"] == "Separator":
            continue
        dim_account.append({"AccountID": a["AccountID"], "Statement": "PL", "ParentID": a["ParentAccountID"] or None,
                            "Name": pl_name(a["AccountID"]), "RowType": a["RowType"], "Sign": a["SignConvention"],
                            "Formula": translate_formula(a["FormulaDef"]), "GoodUp": True,  # values are signed: higher is always better
                            "Sort": sort})
    for tree, st in ((BS_TREE, "BS"), (CF_TREE, "CF")):
        for i, p, n, rt, s in tree:
            sort += 1
            dim_account.append({"AccountID": i, "Statement": st, "ParentID": p, "Name": n, "RowType": rt, "Sign": s,
                                "Formula": "", "GoodUp": BS_GOOD_UP.get(i) if st == "BS" else True, "Sort": sort})

    pl_leaf_set = set(leaves)
    fact = []

    def emit(scen, k, pl_g, path):
        for aid, v in pl_g.items():
            fact.append({"AccountID": aid, "Month": k, "Scenario": scen, "Value": round(v, 2)})
        if k in path:
            b, cf, _ = path[k]
            for aid, v in b.items():
                fact.append({"AccountID": aid, "Month": k, "Scenario": scen, "Value": round(v, 2)})
            for aid, v in cf.items():
                fact.append({"AccountID": aid, "Month": k, "Scenario": scen, "Value": round(v, 2)})

    for y in YEARS:
        for m in range(1, 13):
            k = key(y, m)
            if k <= CUTOFF:
                emit("AC", k, series["AC"][k], ac)
            emit("PL", k, series["PL"][k], pl)
            emit("FC", k, series["AC"][k] if k <= CUTOFF else series["FC"][k], fc)
            emit("PY", k, series["AC"][key(y - 1, m)], {k: ac[key(y - 1, m)]})
    assert all(r["AccountID"] in pl_leaf_set or r["AccountID"][0] in "BC" for r in fact)

    out = ROOT / "data" / "statements"
    out.mkdir(parents=True, exist_ok=True)
    dim_month = [{"Month": key(y, m), "Year": y, "MonthNo": m, "MonthName": calendar.month_abbr[m],
                  "Closed": key(y, m) <= CUTOFF} for y in YEARS for m in range(1, 13)]
    dim_scenario = [{"Scenario": s, "Name": n, "Sort": i + 1} for i, (s, n) in
                    enumerate([("AC", "Actual"), ("PY", "Previous year"), ("PL", "Budget"), ("FC", "Forecast")])]
    drivers = {"company": COMPANY, "currency": CURRENCY, "cutoff": CUTOFF, "taxRate": TAX_RATE,
               "dso": DSO, "dio": DIO, "dpo": DPO, "loanRepayment": LOAN_REPAYMENT,
               "dividendShare": DIVIDEND_SHARE, "dividendMonth": DIVIDEND_MONTH,
               "capex": {str(y): {"fleet": f, "equipment": e} for y, (f, e) in CAPEX.items()},
               "taxPaymentMonths": TAX_PAYMENT_MONTHS,
               "fcStart": {"balances": {k: round(v, 2) for k, v in ac[CUTOFF][0].items()},
                           "taxDue": {str(k): round(v, 2) for k, v in ac[CUTOFF][2].items()},
                           "priorYearNetIncome": round(prior_ni(cy), 2)}}
    for name, rows in {"dim_account": dim_account, "dim_month": dim_month, "dim_scenario": dim_scenario,
                       "fact_statement": fact}.items():
        (out / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    # Tracked next to the model: the bake (tools/bake-snapshot.mjs) ships them with the snapshot.
    (ROOT / "fabric" / "drivers.json").write_text(json.dumps(drivers, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    write_snapshot(dim_account, dim_month, fact, drivers, source="generator (offline, not baked from a model)")

    # ── golden fixtures: the oracle the TypeScript engine must reproduce ─────────────
    sign = {a["AccountID"]: a["SignConvention"] for a in pl_accounts}
    fc_months = [(y, m) for y, m in months(cy, cm + 1, 2026, 12)]
    first, last = key(*fc_months[0]), key(*fc_months[-1])
    sets = {
        "revenue-up": [{"accountId": "4000-Vitamins", "month": first, "amount": 250_000.0}],
        "cost-up-open-month": [{"accountId": "6500", "month": first, "amount": 100_000.0},
                               {"accountId": "6600", "month": last, "amount": 20_000.0}],
        "loss-month-no-tax": [{"accountId": "6000", "month": key(*fc_months[1]), "amount": 2_000_000.0}],
        "before-tax-payment": [{"accountId": "5000-Pain relief", "month": key(*fc_months[-1]), "amount": -80_000.0},
                               {"accountId": "4100-Allergy", "month": first, "amount": 15_000.0}],
    }
    golden = {}
    for name, adjs in sets.items():
        rows = []
        for y, m in fc_months:
            g = dict(series["FC"][key(y, m)])
            hit = [x for x in adjs if x["month"] == key(y, m)]
            for x in hit:
                g[x["accountId"]] = g.get(x["accountId"], 0.0) + sign[x["accountId"]] * x["amount"]
            if hit:  # taxes on positive EBT, split evenly (as the source P&L)
                ebt = sum(v for k, v in g.items() if k not in ("8000", "8010"))
                tax = max(0.0, ebt) * TAX_RATE
                g["8000"], g["8010"] = -tax / 2, -tax / 2
            rows.append((y, m, g))
        b0, due0 = start_after(CUTOFF)
        path = roll(b0, rows, due0, prior_ni(cy))
        golden[name] = {"adjustments": adjs, "values": {
            k: {**{a: round(v, 2) for a, v in g.items()}, **{a: round(v, 2) for a, v in path[k][0].items()},
                **{a: round(v, 2) for a, v in path[k][1].items()}}
            for k, g in ((key(y, m), g) for y, m, g in rows)}}
        for k in path:
            bb = path[k][0]
            assert abs(sum(bb[a] for a in ("B-FA-FLEET", "B-FA-EQUIP", "B-CA-INV", "B-CA-REC", "B-CA-CASH"))
                       - sum(bb[a] for a in ("B-EQ-CAP", "B-EQ-RE", "B-EQ-NI", "B-PR-TAX", "B-PR-OTH", "B-LI-LOAN", "B-LI-PAY"))) < 0.01, (name, k)
    fx = ROOT / "src" / "domain" / "__fixtures__" / "golden.json"
    fx.parent.mkdir(parents=True, exist_ok=True)
    fx.write_text(json.dumps(golden, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"golden fixtures: {', '.join(golden)}")

    fy = defaultdict(float)
    for r in fact:
        if r["Scenario"] == "FC" and r["Month"].startswith("2026"):
            fy[r["AccountID"]] += r["Value"]
    ni_fy = sum(v for a, v in fy.items() if a in pl_leaf_set)
    dec = fc[key(2026, 12)][0]
    print(f"{len(dim_account)} accounts, {len(fact):,} values; FY 2026 FC net income {ni_fy / 1e3:,.0f} kEUR, "
          f"cash Dec 2026 {dec['B-CA-CASH'] / 1e3:,.0f} kEUR, equity ratio "
          f"{(dec['B-EQ-CAP'] + dec['B-EQ-RE'] + dec['B-EQ-NI']) / sum(dec[a] for a in ('B-FA-FLEET', 'B-FA-EQUIP', 'B-CA-INV', 'B-CA-REC', 'B-CA-CASH')):.1%}")


def write_snapshot(dim_account, dim_month, fact, drivers, source: str, baked_at: str | None = None) -> Path:
    """The file the app reads (src/domain/types.ts#Snapshot). Also used by tools/bake_snapshot.py."""
    import datetime as dt
    values: dict = {s: {} for s in ("AC", "PY", "PL", "FC")}
    for r in fact:
        values[r["Scenario"]].setdefault(r["Month"], {})[r["AccountID"]] = r["Value"]
    snap = {
        "meta": {"company": drivers["company"], "currency": drivers["currency"], "cutoff": drivers["cutoff"],
                 "bakedAt": baked_at or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "source": source},
        "accounts": [{"id": a["AccountID"], "statement": a["Statement"], "parentId": a["ParentID"], "name": a["Name"],
                      "rowType": a["RowType"], "sign": a["Sign"], "formula": a["Formula"], "goodUp": a["GoodUp"],
                      "sort": a["Sort"]} for a in dim_account],
        "months": [{"id": m["Month"], "year": m["Year"], "monthNo": m["MonthNo"], "label": m["MonthName"],
                    "closed": m["Closed"]} for m in dim_month],
        "values": values,
        "drivers": drivers,
    }
    path = ROOT / "public" / "data" / "statements.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snap, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path


def translate_formula(f: str) -> str:
    for de, en in (("[Umsatzerlöse]", "[N-REV]"), ("[Wareneinsatz]", "[N-COGS]"), ("[Rohertrag]", "[F-GP]"),
                   ("[Betriebliche Aufwendungen]", "[N-OPEX]"), ("[Sonstiges betriebliches Ergebnis]", "[N-OOR]"),
                   ("[EBITDA]", "[F-EBITDA]"), ("[Abschreibungen]", "[N-DA]"), ("[EBIT]", "[F-EBIT]"),
                   ("[Finanzergebnis]", "[N-FIN]"), ("[EBT]", "[F-EBT]"),
                   ("[Steuern vom Einkommen und vom Ertrag]", "[N-TAX]"), ("[Jahresergebnis]", "[F-NI]")):
        f = f.replace(de, en)
    return f


if __name__ == "__main__":
    main()

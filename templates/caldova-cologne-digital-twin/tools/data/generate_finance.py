"""Caldova Cologne finance data for the Finance tab.

Derives a monthly KPI cube and a wholesaler P&L from the twin's own data, in the table shapes of
Michael Tenner's Finance Cockpit, so the cockpit's DAX runs unchanged against `caldova-cologne-finance`.

⚠️ WHAT IS THE TWIN'S AND WHAT IS SYNTHETIC (every assumption also goes into the tab's provenance note):
- Units sold per district × category are the twin's Sales EXACTLY on the twin's days
  (2026-08-08..2026-10-16). September is a full twin month and reconciles exactly; August is
  1..7 Aug backcast + the twin's 8..31 Aug; October is the OPEN month: only the latest forecast
  (FC3) carries it, as the twin's 1..16 Oct + 15 days at the twin's October rate.
- The twin's `revenue` is pharmacy SELL-OUT at consumer prices (e.g. ibuprofen 24 ct EUR 8.49). Caldova
  is the wholesaler and sells at the pharmacy purchase price: gross = sell-out / 1.19 VAT / 1.35
  pharmacy mark-up (synthetic factor, see PRICE_FACTOR), less pharmacy discounts per category.
- The 60 SKUs are OTC: wholesale margins are freely negotiated, so the gross margin is a stated
  table per category (MARGIN). The German wholesale surcharge regulation (AMPreisV) applies to Rx only and is not used.
- Tours and drops have NO date: they are one routed operating day. Monthly logistics = that day ×
  delivery days (Mon..Sat) × a small volume elasticity. Costs per km, driver hours and fixed costs are
  stated rates (RATES), drops and km allocated to districts via drop → pharmacy → region, and to
  categories by units share.
- Before 2026-08-08 everything is a seeded backcast with gentle seasonality anchored at September,
  prior year growth 3 to 6 %; plans and forecasts follow the rules below. Nothing pretends to be real.

Usage:  python tools/data/generate_finance.py [--aoi koeln-messe]
Writes data/operations/<aoi>/finance/*.json (git-ignored, regenerable) and prints its own checks.
"""
from __future__ import annotations

import argparse
import calendar
import csv
import datetime as dt
import json
import math
import random
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = "CALDOVA-KOELN-FINANZEN-20261020"

# ── stated synthetic assumptions ───────────────────────────────────────────────────────────────────
PRICE_FACTOR = 1 / 1.19 / 1.35  # consumer price incl. VAT -> pharmacy purchase price (AEP), OTC
CATEGORIES = {  # twin category -> display name, group, product line, gross margin, discount, season amplitude, peak month
    "Pain relief": ("Pain relief", "Medicines", "Self-medication", 0.095, 0.030, 0.03, 1),
    "Cold & flu": ("Cold & flu", "Medicines", "Self-medication", 0.105, 0.030, 0.10, 1),
    "Allergy": ("Allergy", "Medicines", "Self-medication", 0.105, 0.025, 0.10, 5),
    "Digestive": ("Digestive", "Medicines", "Self-medication", 0.110, 0.025, 0.02, 1),
    "Vitamins": ("Vitamins", "Food supplements", "Health & prevention", 0.140, 0.035, 0.06, 1),
    "First aid": ("First aid", "Medical devices", "Supplies", 0.130, 0.030, 0.05, 7),
}
RATES = {
    "energy_per_km": {("truck", "diesel"): 0.46, ("truck", "electric"): 0.24, ("van", "diesel"): 0.17, ("van", "electric"): 0.08},
    "maint_per_km": {"truck": 0.09, "van": 0.05},
    "driver_eur_h": 33.0,  # fully loaded hourly cost
    "lease_month": {"truck": 2900.0, "van": 780.0},
    "toll_insurance_month": {"truck": 650.0, "van": 210.0},
    "volume_elasticity": 0.3,  # logistics volume follows sales volume only partly
}
FIXED_MONTH_2026 = {  # monthly fixed costs 2026 (ranges a Cologne DC of this size would plausibly carry)
    "6000": 85_000.0,   # staff warehouse & picking (about 21 FTE fully loaded)
    "6020": 30_000.0,   # staff admin & sales (about 7 FTE)
    "6500": 27_500.0,   # rent logistics centre Confex (about 3,500 m² at ~EUR 7.9/m²)
    "6510": 9_800.0,    # utilities & cooling
    "6600": 12_500.0,   # IT & digital
    "6610": 8_400.0,    # packaging & cool boxes
    "6620": 3_100.0,    # consulting & audit
    "6900": 2_400.0,    # other operating income
    "6910": 1_600.0,    # other operating expenses
    "7000": 6_900.0,    # depreciation fleet (owned share)
    "7010": 7_800.0,    # depreciation warehouse equipment & IT
    "7500": 350.0,      # interest income
    "7510": 4_200.0,    # interest expense
}
COST_INFLATION_2026 = 0.035  # fixed costs 2025 = 2026 / (1 + this)
TAX_RATE = 0.3166            # corporate income tax + solidarity surcharge + Cologne trade tax (multiplier 475 %), on positive EBT only
TRADE_TAX_SHARE = 0.5        # split of the tax line into trade tax vs corporate income tax
GROWTH_PY = (0.03, 0.06)     # 2026 vs 2025 by category
PLAN = {"PL1": {"volume": 1.065, "cost_per_drop": 0.97}, "PL2": {"volume": 1.095, "cost_per_drop": 0.92}}  # budget mildly ambitious, stretch more so
FORECASTS = {"FC1": 3, "FC2": 6, "FC3": 9}  # cut-off month of the actuals each forecast knows
OPEN_MONTH = (2026, 10)
TWIN_FIRST, TWIN_LAST = dt.date(2026, 8, 8), dt.date(2026, 10, 16)
NOISE = 0.015

MONTHS_2025 = [(2025, m) for m in range(1, 13)]
MONTHS_2026 = [(2026, m) for m in range(1, 13)]
KPIS = [  # id, group, unit, higher is better, sort (ids are the cockpit's model names, labels live in its code)
    ("Revenue", "Result", "EUR", True, 1),
    ("COGS", "Cost", "EUR", False, 2),
    ("Gross Profit", "Result", "EUR", True, 3),
    ("Logistics Cost", "Cost", "EUR", False, 4),
    ("Profit", "Result", "EUR", True, 5),
    ("Units Sold", "Volume", "units", True, 6),
    ("Drops", "Volume", "count", True, 7),
    ("Tour km", "Volume", "km", False, 8),
]
SCENARIOS = [  # Scenario, Scenario_Name, Scenario_Short, IBCS, Type, SortOrder
    ("AC", "Actual", "AC", "AC", "Actual", 1),
    ("PL1", "Budget (approved)", "PL1", "PL", "Plan", 2),
    ("PL2", "Stretch plan", "PL2", "PL", "Plan", 3),
    ("FC1", "Forecast after Q1", "FC1", "FC", "Forecast", 4),
    ("FC2", "Forecast after Q2", "FC2", "FC", "Forecast", 5),
    ("FC3", "Forecast after Q3", "FC3", "FC", "Forecast", 6),
]
# Cologne districts (Stadtbezirke, proper names) and their side of the Rhine.
LEFT_RHINE = {"Innenstadt", "Rodenkirchen", "Lindenthal", "Ehrenfeld", "Nippes", "Chorweiler"}
LEFT_BANK, RIGHT_BANK = "Left bank", "Right bank"
CORE_AREA, OUTER_AREA = "Core area", "Outer area"
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
               "November", "December"]
BEZIRK_NR = {"Innenstadt": 1, "Rodenkirchen": 2, "Lindenthal": 3, "Ehrenfeld": 4, "Nippes": 5, "Chorweiler": 6,
             "Porz": 7, "Kalk": 8, "Mülheim": 9}


def days_in(y: int, m: int) -> int:
    return calendar.monthrange(y, m)[1]


def delivery_days(y: int, m: int) -> int:
    """Mon..Sat: German pharmacy wholesalers deliver six days a week."""
    return sum(1 for d in range(1, days_in(y, m) + 1) if dt.date(y, m, d).weekday() < 6)


def season(cat: str, m: int) -> float:
    """Seasonal index, 1.0 in September (the twin's only full month)."""
    amp, peak = CATEGORIES[cat][5], CATEGORIES[cat][6]
    raw = lambda mm: 1 + amp * math.cos(2 * math.pi * (mm - peak) / 12)  # noqa: E731
    return raw(m) / raw(9)


def load_twin(base: Path):
    cat = {r["sku"]: r["category"] for r in csv.DictReader((base / "stock" / "products.csv").open(encoding="utf-8"))}
    region = {r["store_id"]: r["region"] for r in csv.DictReader((base / "stock" / "stores.csv").open(encoding="utf-8"))}
    sales = defaultdict(lambda: {"units": 0, "sellout": 0.0})  # (district, cat, date) -> totals
    for r in csv.DictReader((base / "stock" / "sales.csv").open(encoding="utf-8")):
        k = (region[r["store_id"]], cat[r["sku"]], r["date"])
        sales[k]["units"] += int(r["units_sold"])
        sales[k]["sellout"] += float(r["revenue"])
    tours = json.loads((base / "tables" / "tour.json").read_text(encoding="utf-8"))
    drops = json.loads((base / "tables" / "drop.json").read_text(encoding="utf-8"))
    vehicles = json.loads((base / "tables" / "vehicle.json").read_text(encoding="utf-8"))
    pharmacies = json.loads((base / "tables" / "pharmacy.json").read_text(encoding="utf-8"))
    return cat, region, sales, tours, drops, vehicles, pharmacies


def account_tree(cats: list[str]) -> list[dict]:
    """The P&L account tree (dim-account): about 40 accounts plus subtotal, formula, KPI and separator rows.

    ⚠️ SHAPE FOLLOWS THE COCKPIT'S P&L ENGINE (lib/pnl/engine.ts), which finds its lines BY NAME: the second
    level of revenue accounts is a "division" with price and volume levers (here: the category, gross sales AND
    its pharmacy discounts, so a price lever moves the net price), and cost of goods sold is block
    "Merchandise" > category, so volume pulls the category's cost of goods along (VOLUME_ELASTICITY).
    Module level so tools/fabric/translate_snapshots.py can check its names against the shipped snapshot.
    """
    accounts: list[dict] = []
    sort = 0

    def add(aid, parent, name, row_type, sign, formula="", path=None, disp_inv=False, var_inv=False, comment=""):
        nonlocal sort
        sort += 6
        levels = (path or []) + [""] * 6
        accounts.append({"AccountID": aid, "ParentAccountID": parent or "", "Name": name,
                         **{f"L{i + 1}": levels[i] for i in range(6)}, "SortOrder": sort, "RowType": row_type,
                         "FormulaDef": formula, "SignConvention": sign, "DisplayInvert": disp_inv,
                         "VarianceInvert": var_inv, "Comment": comment})

    rev, cogs, opex, oor = "Revenue", "Cost of goods sold", "Operating expenses", "Other operating result"
    dep, fin, tax = "Depreciation", "Financial result", "Income taxes"
    add("N-REV", None, rev, "Subtotal", 1)
    for c in cats:
        cn = CATEGORIES[c][0]
        add(f"N-REV-{c}", "N-REV", cn, "Subtotal", 1)
        add(f"4000-{c}", f"N-REV-{c}", f"Gross sales {cn}", "Account", 1, path=[rev, cn, f"Gross sales {cn}"])
        add(f"4100-{c}", f"N-REV-{c}", f"Sales deductions {cn}", "Account", -1, path=[rev, cn, f"Sales deductions {cn}"], var_inv=True)
    add("N-COGS", None, cogs, "Subtotal", -1, disp_inv=True, var_inv=True)
    add("N-COGS-HW", "N-COGS", "Merchandise", "Subtotal", -1, disp_inv=True, var_inv=True)
    for c in cats:
        cn = CATEGORIES[c][0]
        add(f"5000-{c}", "N-COGS-HW", cn, "Account", -1, path=[cogs, "Merchandise", cn], disp_inv=True, var_inv=True)
    add("F-GP", None, "Gross profit", "Formula", 1, formula=f"[{rev}] + [{cogs}]")
    add("K-GM", None, "Gross margin %", "KPI", 1, formula=f"[Gross profit] / [{rev}]")
    add("SEP-1", None, "———", "Separator", 1)
    add("N-OPEX", None, opex, "Subtotal", -1, disp_inv=True, var_inv=True)
    groups = [
        ("N-OPEX-PER", "Personnel", [("6000", "Staff warehouse & picking"), ("6010", "Staff drivers"), ("6020", "Staff admin & sales")]),
        ("N-OPEX-LOG", "Fleet & logistics", [("6100", "Energy (diesel, electricity)"), ("6110", "Maintenance & tyres"), ("6120", "Vehicle leasing"), ("6130", "Tolls & insurance")]),
        ("N-OPEX-RAU", "Premises", [("6500", "Rent logistics centre Confex"), ("6510", "Utilities & cooling")]),
        ("N-OPEX-SON", "Other expenses", [("6600", "IT & digital"), ("6610", "Packaging & cool boxes"), ("6620", "Consulting & audit")]),
    ]
    for gid, gname, accs in groups:
        add(gid, "N-OPEX", gname, "Subtotal", -1, disp_inv=True, var_inv=True)
        for aid, aname in accs:
            add(aid, gid, aname, "Account", -1, path=[opex, gname, aname], disp_inv=True, var_inv=True)
    add("N-OOR", None, oor, "Subtotal", 1)
    add("6900", "N-OOR", "Other operating income", "Account", 1, path=[oor, "Other operating income"])
    add("6910", "N-OOR", "Other operating expenses", "Account", -1, path=[oor, "Other operating expenses"], var_inv=True)
    add("F-EBITDA", None, "EBITDA", "Formula", 1, formula=f"[Gross profit] + [{opex}] + [{oor}]")
    add("K-EBITDA", None, "EBITDA margin %", "KPI", 1, formula=f"[EBITDA] / [{rev}]")
    add("SEP-2", None, "———", "Separator", 1)
    add("N-DA", None, dep, "Subtotal", -1, disp_inv=True, var_inv=True)
    add("7000", "N-DA", "Depreciation fleet", "Account", -1, path=[dep, "Depreciation fleet"], disp_inv=True, var_inv=True)
    add("7010", "N-DA", "Depreciation warehouse equipment & IT", "Account", -1, path=[dep, "Depreciation warehouse equipment & IT"], disp_inv=True, var_inv=True)
    add("F-EBIT", None, "EBIT", "Formula", 1, formula=f"[EBITDA] + [{dep}]")
    add("N-FIN", None, fin, "Subtotal", 1)
    add("7500", "N-FIN", "Interest income", "Account", 1, path=[fin, "Interest income"])
    add("7510", "N-FIN", "Interest expense", "Account", -1, path=[fin, "Interest expense"], var_inv=True)
    add("F-EBT", None, "EBT", "Formula", 1, formula=f"[EBIT] + [{fin}]")
    add("N-TAX", None, tax, "Subtotal", -1, disp_inv=True, var_inv=True)
    add("8000", "N-TAX", "Corporate income tax & solidarity surcharge", "Account", -1, path=[tax, "Corporate income tax & solidarity surcharge"], disp_inv=True, var_inv=True)
    add("8010", "N-TAX", "Trade tax", "Account", -1, path=[tax, "Trade tax"], disp_inv=True, var_inv=True)
    add("F-NI", None, "Net income", "Formula", 1, formula=f"[EBT] + [{tax}]")
    add("K-NM", None, "Return on sales %", "KPI", 1, formula=f"[Net income] / [{rev}]")
    return accounts


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="koeln-messe")
    args = ap.parse_args()
    base = ROOT / "data" / "operations" / args.aoi
    out = base / "finance"
    rng = random.Random(SEED)
    cat_of, region_of, sales, tours, drops, vehicles, pharmacies = load_twin(base)

    districts = sorted({region_of[p["pharmacyId"]] for p in pharmacies if p["pharmacyId"] in region_of})
    cats = sorted(CATEGORIES)
    sales_days = sorted({d for (_, _, d) in sales})
    assert sales_days[0] == TWIN_FIRST.isoformat() and sales_days[-1] == TWIN_LAST.isoformat(), sales_days[[0, -1]]

    # ── the twin's months per district × category ──────────────────────────────────────────────────
    twin = defaultdict(lambda: {"units": 0, "sellout": 0.0, "days": 0})  # (district, cat, (y, m))
    days_per_month = defaultdict(set)
    for (dist, c, day), v in sales.items():
        y, m = int(day[:4]), int(day[5:7])
        twin[(dist, c, (y, m))]["units"] += v["units"]
        twin[(dist, c, (y, m))]["sellout"] += v["sellout"]
        days_per_month[(y, m)].add(day)
    twin_days = {ym: len(ds) for ym, ds in days_per_month.items()}
    assert twin_days == {(2026, 8): 24, (2026, 9): 30, (2026, 10): 16}, twin_days

    def rate(dist, c, ym):  # twin daily units and sell-out in that month
        t = twin[(dist, c, ym)]
        return t["units"] / twin_days[ym], t["sellout"] / twin_days[ym]

    noise = defaultdict(lambda: 1 + rng.uniform(-NOISE, NOISE))  # stable per key (draw order is fixed below)
    growth = {c: rng.uniform(*GROWTH_PY) for c in cats}

    # ── actual units and sell-out per district × category × month (2024..2026, 2024 for PY of 2025) ─
    def actual_volume(dist, c, y, m):
        """(units, sellout, twin_part) for a closed month; twin_part = the exact twin share (reconciliation)."""
        if (y, m) == (2026, 9):
            t = twin[(dist, c, (2026, 9))]
            return t["units"], t["sellout"], {"units": t["units"], "sellout": t["sellout"]}
        if (y, m) == (2026, 8):
            t = twin[(dist, c, (2026, 8))]
            u, s = rate(dist, c, (2026, 8))
            return t["units"] + 7 * u, t["sellout"] + 7 * s, {"units": t["units"], "sellout": t["sellout"]}
        su, ss = rate(dist, c, (2026, 9))
        f = season(c, m) * days_in(y, m) * noise[(dist, c, y, m)]
        if y < 2026:
            f /= (1 + growth[c]) ** (2026 - y)
        return su * f, ss * f, None

    # ── logistics: one routed day, allocated to districts ──────────────────────────────────────────
    veh = {v["vehicleId"]: v for v in vehicles}
    by_tour = defaultdict(list)
    for d in drops:
        by_tour[d["tourId"]].append(d)
    day_logi = defaultdict(lambda: {"drops": 0.0, "km": 0.0, "energy": 0.0, "maint": 0.0, "driver": 0.0})
    for t in tours:
        v = veh[t["vehicleId"]]
        ds = by_tour[t["tourId"]]
        hours = (t["returnSlot"] - t["departSlot"]) * 0.25  # 15-minute slots
        for d in ds:
            dist = region_of[d["pharmacyId"]]
            share = 1 / len(ds)
            day_logi[dist]["drops"] += 1
            day_logi[dist]["km"] += t["distanceKm"] * share
            day_logi[dist]["energy"] += t["distanceKm"] * share * RATES["energy_per_km"][(v["vehicleClass"], v["type"])]
            day_logi[dist]["maint"] += t["distanceKm"] * share * RATES["maint_per_km"][v["vehicleClass"]]
            day_logi[dist]["driver"] += hours * RATES["driver_eur_h"] * share
    assert abs(sum(x["drops"] for x in day_logi.values()) - len(drops)) < 1e-9
    fleet_fixed = sum(RATES["lease_month"][v["vehicleClass"]] for v in vehicles)
    fleet_toll = sum(RATES["toll_insurance_month"][v["vehicleClass"]] for v in vehicles)
    sep_units_total = sum(twin[(d, c, (2026, 9))]["units"] for d in districts for c in cats)

    # ── build every scenario on one driver structure ───────────────────────────────────────────────
    def kpis_from(units_by_dc, sellout_by_dc, y, m, cost_per_drop_factor=1.0):
        """Cube values per (district, cat) and the P&L drivers for one month."""
        month_units = sum(units_by_dc.values())
        vol_index = month_units / (sep_units_total / 30 * days_in(y, m)) if month_units else 0
        dd = delivery_days(y, m) * (1 + RATES["volume_elasticity"] * (vol_index - 1))
        cube, guv = {}, defaultdict(float)
        for dist in districts:
            dist_units = sum(units_by_dc[(dist, c)] for c in cats)
            L = day_logi[dist]
            var_cost = (L["energy"] + L["maint"] + L["driver"]) * dd * cost_per_drop_factor
            fixed_share = (fleet_fixed + fleet_toll) * (L["drops"] / len(drops))
            for c in cats:
                u, so = units_by_dc[(dist, c)], sellout_by_dc[(dist, c)]
                gross = so * PRICE_FACTOR
                disc = gross * CATEGORIES[c][4]
                rev = gross - disc
                cogs = rev * (1 - CATEGORIES[c][3])
                ushare = u / dist_units if dist_units else 0
                logi = (var_cost + fixed_share) * ushare
                cube[(dist, c)] = {
                    "Revenue": rev, "COGS": cogs, "Gross Profit": rev - cogs, "Logistics Cost": logi,
                    "Profit": rev - cogs - logi, "Units Sold": u, "Drops": L["drops"] * dd * ushare,
                    "Tour km": L["km"] * dd * ushare,
                }
                guv[f"4000-{c}"] += gross
                guv[f"4100-{c}"] += disc
                guv[f"5000-{c}"] += cogs
            guv["6010"] += L["driver"] * dd * cost_per_drop_factor
            guv["6100"] += L["energy"] * dd * cost_per_drop_factor
            guv["6110"] += L["maint"] * dd * cost_per_drop_factor
        guv["6120"] += fleet_fixed
        guv["6130"] += fleet_toll
        infl = 1 if y >= 2026 else 1 / (1 + COST_INFLATION_2026) ** (2026 - y)
        for acc, v in FIXED_MONTH_2026.items():
            guv[acc] += v * infl
        return cube, guv

    def scale(vol_dc, factor_by_cat):
        return {k: v * factor_by_cat[k[1]] for k, v in vol_dc.items()}

    actual_units, actual_sellout, twin_parts = {}, {}, {}
    for y, m in [(2024, mm) for mm in range(1, 13)] + MONTHS_2025 + [(2026, mm) for mm in range(1, 10)]:
        u_dc, s_dc = {}, {}
        for dist in districts:
            for c in cats:
                u, s, part = actual_volume(dist, c, y, m)
                u_dc[(dist, c)], s_dc[(dist, c)] = u, s
                if part:
                    twin_parts[f"{y}-{m:02d}|{dist}|{c}"] = part
        actual_units[(y, m)], actual_sellout[(y, m)] = u_dc, s_dc

    # Open month October 2026: the twin's 1..16 Oct + 15 days at the twin's October rate (latest estimate).
    oct_u, oct_s = {}, {}
    for dist in districts:
        for c in cats:
            t = twin[(dist, c, (2026, 10))]
            u, s = rate(dist, c, (2026, 10))
            oct_u[(dist, c)], oct_s[(dist, c)] = t["units"] + 15 * u, t["sellout"] + 15 * s
            twin_parts[f"2026-10|{dist}|{c}"] = {"units": t["units"], "sellout": t["sellout"]}

    def plan_volume(y, m, scen):
        """Budget: prior-year actual of the same month × volume target, smoothed (no noise)."""
        ref_y = y - 1
        base_u = actual_units[(ref_y, m)]
        base_s = actual_sellout[(ref_y, m)]
        f = PLAN[scen]["volume"]
        return ({k: v * f / noise[(k[0], k[1], ref_y, m)] for k, v in base_u.items()},
                {k: v * f / noise[(k[0], k[1], ref_y, m)] for k, v in base_s.items()})

    def forecast_volume(scen, y, m):
        cut = FORECASTS[scen]
        if m <= cut:
            return actual_units[(y, m)], actual_sellout[(y, m)]
        if scen == "FC3" and (y, m) == OPEN_MONTH:
            return oct_u, oct_s
        # trend: actual vs budget over the known months, damped by half
        pu, _ = zip(*[plan_volume(y, mm, "PL1") for mm in range(1, cut + 1)])
        ratio = sum(sum(actual_units[(y, mm)].values()) for mm in range(1, cut + 1)) / sum(sum(p.values()) for p in pu)
        trend = 1 + (ratio - 1) * 0.5
        bu, bs = plan_volume(y, m, "PL1")
        return {k: v * trend for k, v in bu.items()}, {k: v * trend for k, v in bs.items()}

    sales_rows = []
    guv_vals = defaultdict(lambda: defaultdict(float))  # (scenario, y, m) -> account -> value

    def emit(scen, y, m, units_dc, sellout_dc, cpd=1.0):
        cube, guv = kpis_from(units_dc, sellout_dc, y, m, cpd)
        for (dist, c), kv in cube.items():
            for k, v in kv.items():
                sales_rows.append({"Date": f"{y}-{m:02d}-01", "Scenario": scen, "Product": CATEGORIES[c][0],
                                   "Category": CATEGORIES[c][1], "Country": dist,
                                   "Region": LEFT_BANK if dist in LEFT_RHINE else RIGHT_BANK,
                                   "KPI": k, "Value": round(v, 2)})
        guv_vals[(scen, y, m)] = guv

    for y, m in MONTHS_2025 + [(2026, mm) for mm in range(1, 10)]:
        emit("AC", y, m, actual_units[(y, m)], actual_sellout[(y, m)])
    for scen in PLAN:
        for y, m in MONTHS_2025 + MONTHS_2026:
            u, s = plan_volume(y, m, scen)
            emit(scen, y, m, u, s, PLAN[scen]["cost_per_drop"])
    for scen in FORECASTS:
        for y, m in MONTHS_2026:
            u, s = forecast_volume(scen, y, m)
            emit(scen, y, m, u, s)
    for y, m in [(2024, mm) for mm in range(1, 13)]:  # PY of 2025 for the P&L fact only
        guv_vals[("AC", y, m)] = kpis_from(actual_units[(y, m)], actual_sellout[(y, m)], y, m)[1]

    # ── P&L account tree (compact, about 40 accounts, see account_tree) ───────────────────────────────
    accounts = account_tree(cats)
    leaf_ids = [a["AccountID"] for a in accounts if a["RowType"] == "Account"]
    sign = {a["AccountID"]: a["SignConvention"] for a in accounts}

    def add_taxes(g):
        """Taxes on positive EBT of the month (signed values: revenue +, costs -)."""
        ebt = sum(sign[a] * g.get(a, 0.0) for a in leaf_ids if not a.startswith("80"))
        tax = max(0.0, ebt) * TAX_RATE
        g["8010"] = tax * TRADE_TAX_SHARE
        g["8000"] = tax * (1 - TRADE_TAX_SHARE)
        return g

    for key in list(guv_vals):
        add_taxes(guv_vals[key])

    # ── fact-pnl rows: 2025-01..2026-12, AC / PY / PL / FC / FC_FY / PL_FY (values positive) ───────
    fact = []
    for y, m in MONTHS_2025 + MONTHS_2026:
        latest_fc = "FC3" if y == 2026 else "AC"
        pl_fy = {a: sum(guv_vals[("PL1", y, mm)].get(a, 0.0) for mm in range(1, 13)) for a in leaf_ids}
        fc_fy = {a: sum(guv_vals[(latest_fc, y, mm)].get(a, 0.0) for mm in range(1, 13)) for a in leaf_ids}
        closed = (y, m) < OPEN_MONTH
        for a in [x["AccountID"] for x in accounts]:
            leaf = a in leaf_ids
            def val(scen, yy=y):  # noqa: E306
                return round(guv_vals[(scen, yy, m)].get(a, 0.0), 2) if leaf else 0.0
            fact.append({"AccountID": a, "Month": f"{y}-{m:02d}", "Date": f"{y}-{m:02d}-01",
                         "AC": val("AC") if closed else None,
                         "PY": val("AC", y - 1),
                         "PL": val("PL1"),
                         "FC": val(latest_fc),
                         "FC_FY": round(fc_fy[a], 2) if leaf else 0.0,
                         "PL_FY": round(pl_fy[a], 2) if leaf else 0.0})

    # ── dimensions ─────────────────────────────────────────────────────────────────────────────────
    hub = (50.9441324, 6.9747092)
    coords = defaultdict(list)
    for p in pharmacies:
        coords[region_of[p["pharmacyId"]]].append((p["lat"], p["lon"], p["distanceKm"]))
    dim_market = [{"Country": d, "Region": LEFT_BANK if d in LEFT_RHINE else RIGHT_BANK,
                   "ISO2": f"SB{BEZIRK_NR[d]}", "Currency": "EUR",
                   "Latitude": round(sum(c[0] for c in coords[d]) / len(coords[d]), 5),
                   "Longitude": round(sum(c[1] for c in coords[d]) / len(coords[d]), 5),
                   "ClimateLocation": "Cologne",
                   "MarketMaturity": CORE_AREA if sum(c[2] for c in coords[d]) / len(coords[d]) < 3.0 else OUTER_AREA}
                  for d in districts]
    dim_product = [{"Product": CATEGORIES[c][0], "ProductID": f"K-{i + 1:02d}", "Category": CATEGORIES[c][1],
                    "ProductLine": CATEGORIES[c][2], "LaunchDate": "2020-01-01",
                    "TargetMargin_pct": round(CATEGORIES[c][3] * 100, 1), "Lifecycle": "Mature", "Color": ""}
                   for i, c in enumerate(cats)]
    dim_kpi = [{"KPI": k, "KPI_Group": g, "Unit": u, "Format": "#,0", "HigherIsBetter": hb, "SortOrder": so}
               for k, g, u, hb, so in KPIS]
    dim_scenario = [dict(zip(("Scenario", "Scenario_Name", "Scenario_Short", "IBCS", "Type", "SortOrder"), r)) for r in SCENARIOS]
    calender = []
    d0 = dt.date(2024, 1, 1)
    while d0 <= dt.date(2026, 12, 31):
        calender.append({"Date": d0.isoformat(), "Year": d0.year, "Month": d0.month, "Quarter": (d0.month - 1) // 3 + 1,
                         "Month Name": MONTH_NAMES[d0.month - 1],
                         "Year Month Number": d0.year * 100 + d0.month})
        d0 += dt.timedelta(days=1)

    # ── self-checks (before anything is written) ───────────────────────────────────────────────────
    # 1. September AC units per district × category = the twin exactly.
    sep = defaultdict(float)
    for r in sales_rows:
        if r["Scenario"] == "AC" and r["Date"] == "2026-09-01" and r["KPI"] == "Units Sold":
            sep[(r["Country"], r["Product"])] += r["Value"]
    for dist in districts:
        for c in cats:
            want = twin[(dist, c, (2026, 9))]["units"]
            got = sep[(dist, CATEGORIES[c][0])]
            assert abs(got - want) < 1e-6, (dist, c, got, want)
    # 2. Cube and P&L tell the same story per month (AC): revenue, COGS, logistics.
    for y, m in [(2026, mm) for mm in range(1, 10)]:
        cube_rev = sum(r["Value"] for r in sales_rows if r["Scenario"] == "AC" and r["Date"] == f"{y}-{m:02d}-01" and r["KPI"] == "Revenue")
        g = guv_vals[("AC", y, m)]
        guv_rev = sum(g[f"4000-{c}"] - g[f"4100-{c}"] for c in cats)
        assert abs(cube_rev - guv_rev) / guv_rev < 1e-6, (y, m, cube_rev, guv_rev)
        cube_logi = sum(r["Value"] for r in sales_rows if r["Scenario"] == "AC" and r["Date"] == f"{y}-{m:02d}-01" and r["KPI"] == "Logistics Cost")
        guv_logi = g["6010"] + g["6100"] + g["6110"] + g["6120"] + g["6130"]
        assert abs(cube_logi - guv_logi) / guv_logi < 1e-6, (y, m, cube_logi, guv_logi)
    # 3. Plausibility of the P&L 2026 (forecast year): margins in a wholesaler's range.
    fy = defaultdict(float)
    for mm in range(1, 13):
        for a, v in guv_vals[("FC3", 2026, mm)].items():
            fy[a] += sign[a] * v
    rev_fy = sum(fy[f"4000-{c}"] + fy[f"4100-{c}"] for c in cats)
    gp = rev_fy + sum(fy[f"5000-{c}"] for c in cats)
    ebit = sum(v for a, v in fy.items() if not a.startswith(("75", "80")))
    print("FY 2026 (FC3), signed, kEUR: " + ", ".join(f"{a} {v / 1e3:,.0f}" for a, v in sorted(fy.items())))
    assert 0.08 < gp / rev_fy < 0.14, gp / rev_fy
    assert 0.003 < ebit / rev_fy < 0.03, ebit / rev_fy

    out.mkdir(parents=True, exist_ok=True)
    tables = {"sales_demo": sales_rows, "dim_kpi": dim_kpi, "dim_market": dim_market, "dim_product": dim_product,
              "dim_scenario": dim_scenario, "calender": calender, "dim_account": accounts, "fact_pnl": fact}
    for name, rows in tables.items():
        (out / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    meta = {
        "seed": SEED, "twinWindow": [TWIN_FIRST.isoformat(), TWIN_LAST.isoformat()], "openMonth": "2026-10",
        "priceFactor": PRICE_FACTOR, "categories": {c: CATEGORIES[c][:5] for c in cats}, "rates": {
            k: ({f"{a}/{b}": x for (a, b), x in v.items()} if k == "energy_per_km" else v) for k, v in RATES.items()},
        "fixedMonth2026": FIXED_MONTH_2026, "taxRate": TAX_RATE, "growthPY": growth, "plans": PLAN,
        "forecastCutoffs": FORECASTS, "twinParts": twin_parts,
        "fy2026": {"revenue": rev_fy, "grossProfit": gp, "ebit": ebit},
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"finance data: {len(sales_rows):,} cube values, {len(accounts)} accounts ({len(leaf_ids)} leaves), {len(fact):,} P&L rows")
    print(f"FY 2026 (FC3): revenue EUR {rev_fy / 1e6:,.2f}m, gross margin {gp / rev_fy:.1%}, EBIT {ebit / 1e3:,.0f} kEUR ({ebit / rev_fy:.2%})")
    print("checks ok: September units == twin, cube == P&L (revenue, logistics), margins plausible")


if __name__ == "__main__":
    main()

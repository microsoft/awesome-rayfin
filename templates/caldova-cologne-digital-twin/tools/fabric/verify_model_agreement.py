"""GATE: every headline figure computed twice — Python over the generated files, DAX over the
published model, and the two must agree.

⚠️ SHARES NO CODE WITH THE MODEL (engine rule): a shared helper's bug would cancel out. The Python
side re-implements the measure definitions from their documented meaning; the DAX side asks the
published Direct Lake model after a reframe.

Exit 1 on any disagreement beyond 1e-4 (relative) or a figure the model could not answer.

Usage:  python tools/fabric/verify_model_agreement.py --aoi koeln-messe
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import sys
import urllib.request
from collections import defaultdict

from fabric_api import ROOT, config, token

SLOTS = {"0600": 24, "1145": 47, "1630": 66}


def round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5)) if x >= 0 else -int(math.floor(-x + 0.5))


def python_side(aoi: str) -> tuple[dict, list[tuple[str, str]]]:
    base = ROOT / "data" / "operations" / aoi
    tours = json.loads((base / "tables" / "tour.json").read_text(encoding="utf-8"))
    drops = json.loads((base / "tables" / "drop.json").read_text(encoding="utf-8"))
    by_tour = {t["tourId"]: t for t in tours}
    f: dict[str, float] = {}
    f["Tours"] = len(tours)
    f["Drops"] = len(drops)
    km = sum(t["distanceKm"] for t in tours)
    f["Drops per Tour"] = len(drops) / len(tours)
    f["km per Drop"] = km / len(drops)
    trucks = [t for t in tours if t["vehicleClass"] == "truck"]
    f["Truck Share of Tours"] = len(trucks) / len(tours)
    f["Truck Share of Drops"] = sum(1 for d in drops if by_tour[d["tourId"]]["vehicleClass"] == "truck") / len(drops)
    f["Truck Share of km"] = sum(t["distanceKm"] for t in trucks) / km
    for label, s in SLOTS.items():
        n = 0
        for t in tours:
            span = (t["returnSlot"] - t["departSlot"] + 96) % 96
            since = (s - t["departSlot"] + 96) % 96
            n += 1 if span > 0 and since <= span else 0
        f[f"Tours on the Road {label}"] = n

    stock = base / "stock"
    with (stock / "inventory.csv").open(encoding="utf-8") as fh:
        inv = list(csv.DictReader(fh))
    units = defaultdict(int)
    dates = set()
    with (stock / "sales.csv").open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        dates.add(r["date"])
    latest = max(dt.date.fromisoformat(d) for d in dates)
    start = latest - dt.timedelta(days=27)
    for r in rows:
        if start <= dt.date.fromisoformat(r["date"]) <= latest:
            units[(r["store_id"], r["sku"])] += int(r["units_sold"])
    low_pairs, pressured = 0, set()
    days_of, suggested = {}, {}
    for r in inv:
        key = (r["store_id"], r["sku"])
        demand = units[key] / 28
        if demand == 0:
            continue
        on_hand = int(r["on_hand_qty"])
        days = on_hand / demand
        days_of[key] = days
        suggested[key] = max(round_half_up(demand * 21 + int(r["safety_stock"]) - on_hand), 0)
        if days < 7:
            low_pairs += 1
            pressured.add(r["store_id"])
    # Seeded reorders (seed_reorders.py) as the model sees them through the SQL-DB mirror.
    with (stock / "restock_requests.csv").open(encoding="utf-8") as fh:
        seeds = list(csv.DictReader(fh))
    f["Open Restock Requests"] = sum(1 for r in seeds if r["status"] == "submitted")
    f["Restock Requests"] = len(seeds)
    f["Products Running Low"] = low_pairs
    f["Stores Under Pressure"] = len(pressured)
    heroes = sorted(days_of, key=lambda k: days_of[k])[:6]
    engineered = [(h["store_id"], h["sku"]) for h in json.loads((stock / "heroes.json").read_text(encoding="utf-8"))]
    not_low = [h for h in engineered if not days_of.get(h, 99) < 2]
    if not_low:
        raise SystemExit(f"engineered hero pairs are not critically low: {not_low}")
    print(f"  engineered hero pairs all below 2 days of stock: {engineered}")
    for st, sku in heroes:
        f[f"Days of Stock {st}/{sku}"] = days_of[(st, sku)]
        f[f"Suggested Reorder Units {st}/{sku}"] = suggested[(st, sku)]
    return f, heroes


def dax_side(cfg: dict, heroes: list[tuple[str, str]]) -> dict:
    cols = [
        '"Tours", [Tours]', '"Drops", [Drops]', '"Drops per Tour", [Drops per Tour]', '"km per Drop", [km per Drop]',
        '"Truck Share of Tours", [Truck Share of Tours]', '"Truck Share of Drops", [Truck Share of Drops]',
        '"Truck Share of km", [Truck Share of km]', '"Products Running Low", [Products Running Low]',
        '"Stores Under Pressure", [Stores Under Pressure]',
        '"Open Restock Requests", [Open Restock Requests]', '"Restock Requests", [Restock Requests] + 0',
        '"German name PAIN-003", CALCULATE(SELECTEDVALUE(Products[name]), Products[sku] = "PAIN-003")',
    ]
    for label, s in SLOTS.items():
        cols.append(f'"Tours on the Road {label}", CALCULATE([Tours on the Road], TimeSlots[slotId] = {s})')
    for st, sku in heroes:
        flt = f'Stores[store_id] = "{st}", Products[sku] = "{sku}"'
        cols.append(f'"Days of Stock {st}/{sku}", CALCULATE([Days of Stock], {flt})')
        cols.append(f'"Suggested Reorder Units {st}/{sku}", CALCULATE([Suggested Reorder Units], {flt})')
    query = "EVALUATE ROW(" + ", ".join(cols) + ")"
    url = f"https://api.powerbi.com/v1.0/myorg/groups/{cfg['workspaceId']}/datasets/{cfg['semanticModelId']}/executeQueries"
    body = json.dumps({"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}}).encode()
    headers = {"Authorization": f"Bearer {token('https://analysis.windows.net/powerbi/api')}", "Content-Type": "application/json"}
    with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers, method="POST"), timeout=300) as r:  # noqa: S310
        row = json.loads(r.read())["results"][0]["tables"][0]["rows"][0]
    return {k.strip("[]"): v for k, v in row.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="koeln-messe")
    args = ap.parse_args()
    cfg = config()
    if not cfg.get("semanticModelId"):
        raise SystemExit("no semanticModelId: run publish_model.py first")
    py, heroes = python_side(args.aoi)
    dx = dax_side(cfg, heroes)
    bad = 0
    want_name = "CaldoPain Paracetamol 500 mg"
    got_name = dx.get("German name PAIN-003")
    if got_name != want_name:
        bad += 1
    print(f"  {'ok ' if got_name == want_name else 'BAD'} German product name PAIN-003 {got_name!r}")
    for name, want in py.items():
        got = dx.get(name)
        ok = got is not None and abs(float(got) - float(want)) <= 1e-4 * max(1.0, abs(float(want)))
        bad += 0 if ok else 1
        print(f"  {'ok ' if ok else 'BAD'} {name:<44} python {want:>12.4f}   dax {got if got is not None else 'null'}")
    print(f"\n{len(py) - bad} of {len(py)} figures agree")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()

"""Bake the Reorder tab's stock figures from the live Cologne operations model.

The tab does not query the model at run time: the `fabric-semanticmodel` connector runs through a
delegated User Data Function and makes the deployed app open ONLY for its owner (see
tools/verify_no_owner_lock.py). Instead this script runs the app's OWN `.dax` files against the model
and writes what they return to `public/data/reorder/snapshot.json`, in the model's own column names,
so the app's parsers read the snapshot exactly as they read the connector.

⚠️ THE FIGURES ARE THE MODEL'S, NOT A RE-IMPLEMENTATION. Only `sales-rate` is not run once per
parameter (7,200 store/product pairs): one batched query with the same measures and windows answers
all of them, and the app's exact per-pair query on a sample must agree, or the bake fails.

Reorders are NOT baked: they are live in the app's database and read through the data client.
`[ReordersSentToday]` is therefore blanked in the snapshot.

Usage:
    python tools/fabric/bake_reorder_snapshot.py            # write the snapshot
    python tools/fabric/bake_reorder_snapshot.py --check    # re-run, exit 1 if the model drifted
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.request

from fabric_api import ROOT, config, token

QUERIES = ROOT / "src" / "reorder" / "queries"
OUT = ROOT / "public" / "data" / "reorder" / "snapshot.json"
SAMPLE_SEED = 20261019
SAMPLE_RANDOM = 25
REL_TOL = 1e-9

STATIC = {
    "headlineTiles": "regional-dashboard/headline-tiles.dax",
    "lowStockQueue": "regional-dashboard/low-stock-queue.dax",
    "demandTrend": "regional-dashboard/demand-trend.dax",
    "lowStockTrend": "regional-dashboard/low-stock-trend.dax",
    "productDemand": "regional-dashboard/product-demand.dax",
}
LIVE_COLUMNS = {"headlineTiles": ["[ReordersSentToday]"]}


def dax_string(value: str) -> str:
    """Same quoting as src/reorder/queries/dax-literals.ts."""
    return '"' + value.replace('"', '""') + '"'


def with_parameters(query: str, params: dict[str, str]) -> str:
    for name, value in params.items():
        query = query.replace("{{" + name + "}}", dax_string(value))
    if "{{" in query:
        raise SystemExit("unfilled placeholder in query")
    return query


PARALLEL = 8


class Model:
    def __init__(self, cfg: dict) -> None:
        self.url = (
            f"https://api.powerbi.com/v1.0/myorg/groups/{cfg['workspaceId']}"
            f"/datasets/{cfg['semanticModelId']}/executeQueries"
        )
        self.headers = {
            "Authorization": f"Bearer {token('https://analysis.windows.net/powerbi/api')}",
            "Content-Type": "application/json",
        }
        self.calls = 0
        self._lock = threading.Lock()
        self._next = 0.0

    def _pace(self) -> None:
        """executeQueries allows 120 queries per minute per user: one START every 0.6 s, across threads."""
        with self._lock:
            now = time.monotonic()
            wait = max(0.0, self._next - now)
            self._next = max(now, self._next) + 0.6
            self.calls += 1
        if wait:
            time.sleep(wait)

    def rows(self, query: str) -> list[dict]:
        body = json.dumps({"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}}).encode()
        for attempt in range(6):
            self._pace()
            try:
                req = urllib.request.Request(self.url, data=body, headers=self.headers, method="POST")
                with urllib.request.urlopen(req, timeout=300) as r:  # noqa: S310
                    result = json.loads(r.read())["results"][0]
            except urllib.error.HTTPError as err:
                if err.code in (429, 500, 502, 503) and attempt < 5:
                    time.sleep(5 * (attempt + 1))
                    continue
                raise SystemExit(f"model refused a query ({err.code}): {err.read()[:400]!r}") from err
            if "error" in result:
                raise SystemExit(f"model error: {json.dumps(result['error'])[:400]}")
            return result["tables"][0]["rows"]
        raise SystemExit("model kept throttling")


def columnar(rows: list[dict], columns: list[str] | None = None) -> dict:
    cols = columns or (list(rows[0].keys()) if rows else [])
    return {"columns": cols, "rows": [[r.get(c) for c in cols] for r in rows]}


def same(a, b) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return math.isclose(a, b, rel_tol=REL_TOL, abs_tol=1e-12)
    return a == b


def encode(table: dict) -> dict:
    """Lossless dictionary encoding: a column whose values are all text is stored as indices into
    `dict[column]`. Store names and dates repeat tens of thousands of times; numbers stay exact."""
    out = {"columns": table["columns"], "rows": [list(r) for r in table["rows"]], "dict": {}}
    for i, col in enumerate(table["columns"]):
        values = [r[i] for r in table["rows"]]
        if values and all(isinstance(v, str) for v in values):
            uniq = sorted(set(values))
            index = {v: n for n, v in enumerate(uniq)}
            for r in out["rows"]:
                r[i] = index[r[i]]
            out["dict"][col] = uniq
    return out


def decode(table: dict) -> dict:
    rows = [list(r) for r in table["rows"]]
    for col, uniq in table.get("dict", {}).items():
        i = table["columns"].index(col)
        for r in rows:
            r[i] = uniq[r[i]]
    return {"columns": table["columns"], "rows": rows}


def canonical(table: dict) -> list[list]:
    """Rows sorted by their text columns (the natural keys: store, sku, date, name).

    ⚠️ TOPN ties and ORDER BY on names are not a stable order between runs,
    so `--check` compares as sets keyed by the text columns, never by position."""
    text = [i for i, _ in enumerate(table["columns"]) if any(isinstance(r[i], str) for r in table["rows"])]
    return sorted(table["rows"], key=lambda r: tuple(str(r[i]) for i in text) + tuple(repr(v) for v in r))


def same_table(a: dict, b: dict, ordered: bool = True) -> str | None:
    """None when equal. `ordered=False` compares canonically sorted rows (the drift gate)."""
    if a["columns"] != b["columns"]:
        return f"columns {a['columns']} vs {b['columns']}"
    if len(a["rows"]) != len(b["rows"]):
        return f"{len(a['rows'])} vs {len(b['rows'])} rows"
    rows_a, rows_b = (a["rows"], b["rows"]) if ordered else (canonical(a), canonical(b))
    for i, (ra, rb) in enumerate(zip(rows_a, rows_b, strict=True)):
        for c, va, vb in zip(a["columns"], ra, rb, strict=True):
            if not same(va, vb):
                return f"row {i} {c}: {va!r} vs {vb!r}"
    return None


SALES_RATE_PAIRS = """
EVALUATE
VAR Anchor = [Latest Sales Date]
VAR WeekWindow = FILTER(ALL(Sales[date]), Sales[date] > Anchor - 7)
VAR MonthWindow = FILTER(ALL(Sales[date]), Sales[date] > Anchor - 28)
RETURN
ADDCOLUMNS(
    SUMMARIZE(Inventory, Stores[store_id], Products[sku]),
    "StoreWeek", CALCULATE([Avg Daily Sales], WeekWindow),
    "StoreMonth", CALCULATE([Avg Daily Sales], MonthWindow),
    "SuggestedUnits", CALCULATE([Suggested Reorder Units]),
    "DaysOfStock", CALCULATE([Days of Stock])
)
"""
SALES_RATE_REGION = """
EVALUATE
VAR Anchor = [Latest Sales Date]
VAR WeekWindow = FILTER(ALL(Sales[date]), Sales[date] > Anchor - 7)
VAR MonthWindow = FILTER(ALL(Sales[date]), Sales[date] > Anchor - 28)
RETURN
ADDCOLUMNS(
    VALUES(Products[sku]),
    "RegionWeek", CALCULATE([Avg Daily Sales], WeekWindow),
    "RegionMonth", CALCULATE([Avg Daily Sales], MonthWindow)
)
"""
SALES_RATE_CONSTANTS = 'EVALUATE ROW("TargetCoverDays", [Target Cover Days], "ThresholdDays", [Low Stock Threshold Days])'
SALES_RATE_COLUMNS = [
    "[StoreWeek]", "[StoreMonth]", "[RegionWeek]", "[RegionMonth]",
    "[SuggestedUnits]", "[DaysOfStock]", "[TargetCoverDays]", "[ThresholdDays]",
]
DIMENSIONS = """
EVALUATE SELECTCOLUMNS(Stores, "id", Stores[store_id], "name", Stores[name], "region", Stores[region])
"""
PRODUCTS = 'EVALUATE SELECTCOLUMNS(Products, "sku", Products[sku], "name", Products[name])'


def sales_rate_row(table: dict, sku: str, store: str) -> dict:
    """What the loader returns for `salesRate|<sku>|<store>`: the pair's row without its key columns."""
    rows = [r[2:] for r in table["rows"] if r[0] == sku and r[1] == store]
    return {"columns": table["columns"][2:], "rows": rows}


def bake(model: Model) -> dict:
    queries: dict[str, dict] = {}
    for key, path in STATIC.items():
        table = columnar(model.rows((QUERIES / path).read_text(encoding="utf-8")))
        for col in LIVE_COLUMNS.get(key, []):
            i = table["columns"].index(col)
            for row in table["rows"]:
                row[i] = None
        queries[key] = table
        print(f"  {key}: {len(table['rows'])} rows")

    stores = model.rows(DIMENSIONS)
    products = model.rows(PRODUCTS)
    skus = sorted(p["[sku]"] for p in products)

    stock_dax = (QUERIES / "product-detail" / "stock-by-store.dax").read_text(encoding="utf-8")
    # ⚠️ IN PARALLEL: one query after the other took about 20 min per bake. Same queries, same
    # answers; Model._pace keeps the start rate under the API limit.
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        tables = list(pool.map(lambda sku: columnar(model.rows(with_parameters(stock_dax, {"sku": sku}))), skus))
    for sku, table in zip(skus, tables, strict=True):
        queries[f"stockByStore|{sku}"] = table
    print(f"  stockByStore: {len(skus)} products")

    # sales-rate: batched, then the app's own per-pair query on a sample must agree.
    pairs = model.rows(SALES_RATE_PAIRS)
    region = {r["Products[sku]"]: r for r in model.rows(SALES_RATE_REGION)}
    const = model.rows(SALES_RATE_CONSTANTS)[0]
    combined = []
    for p in pairs:
        sku, store = p["Products[sku]"], p["Stores[store_id]"]
        row = {
            "[StoreWeek]": p["[StoreWeek]"], "[StoreMonth]": p["[StoreMonth]"],
            "[RegionWeek]": region[sku]["[RegionWeek]"], "[RegionMonth]": region[sku]["[RegionMonth]"],
            "[SuggestedUnits]": p["[SuggestedUnits]"], "[DaysOfStock]": p["[DaysOfStock]"],
            "[TargetCoverDays]": const["[TargetCoverDays]"], "[ThresholdDays]": const["[ThresholdDays]"],
        }
        combined.append({"Products[sku]": sku, "Stores[store_id]": store, **row})
    # ONE table keyed by sku and store; the app asks for `salesRate|<sku>|<store>` and the loader
    # (src/reorder-live/snapshot.ts) returns that pair's row with the key columns removed.
    combined.sort(key=lambda r: (r["Products[sku]"], r["Stores[store_id]"]))
    queries["salesRate"] = columnar(combined, ["Products[sku]", "Stores[store_id]", *SALES_RATE_COLUMNS])
    print(f"  salesRate: {len(pairs)} pairs")

    rate_dax = (QUERIES / "product-detail" / "sales-rate.dax").read_text(encoding="utf-8")
    queue = queries["lowStockQueue"]
    qi, si = queue["columns"].index("Products[sku]"), queue["columns"].index("Stores[store_id]")
    sample = {(r[qi], r[si]) for r in queue["rows"]}
    rng = random.Random(SAMPLE_SEED)
    every = sorted((p["Products[sku]"], p["Stores[store_id]"]) for p in pairs)
    sample |= set(rng.sample(every, SAMPLE_RANDOM))
    ordered = sorted(sample)
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        exacts = list(pool.map(
            lambda pair: columnar(model.rows(with_parameters(rate_dax, {"sku": pair[0], "storeId": pair[1]})), SALES_RATE_COLUMNS),
            ordered,
        ))
    for (sku, store), exact in zip(ordered, exacts, strict=True):
        diff = same_table(exact, sales_rate_row(queries["salesRate"], sku, store))
        if diff:
            raise SystemExit(f"BATCHED sales-rate disagrees with the app's own query for {sku}/{store}: {diff}")
    print(f"  salesRate: batched == exact on {len(sample)} sampled pairs")

    return {
        "stores": {s["[id]"]: {"name": s["[name]"], "region": s["[region]"]} for s in stores},
        "products": {p["[sku]"]: {"name": p["[name]"]} for p in products},
        "queries": queries,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="re-run and fail if the model no longer gives the snapshot")
    args = ap.parse_args()
    cfg = config()
    if not cfg.get("semanticModelId"):
        raise SystemExit("no semanticModelId: run publish_model.py first")
    model = Model(cfg)
    body = bake(model)
    payload = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    version = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
    latest = body["queries"]["headlineTiles"]["rows"][0][body["queries"]["headlineTiles"]["columns"].index("[LatestSalesDate]")]

    if args.check:
        if not OUT.exists():
            raise SystemExit(f"SNAPSHOT MISSING: {OUT} — run without --check first")
        shipped = json.loads(OUT.read_text(encoding="utf-8"))
        for key, table in body["queries"].items():
            have = shipped["queries"].get(key)
            have = decode(have) if have is not None else None
            diff = "missing in snapshot" if have is None else same_table(table, have, ordered=False)
            if diff:
                raise SystemExit(f"SNAPSHOT DRIFT on {key}: {diff} — re-bake before deploying")
        extra = set(shipped["queries"]) - set(body["queries"])
        if extra or shipped["stores"] != body["stores"] or shipped["products"] != body["products"]:
            raise SystemExit("SNAPSHOT DRIFT in dimensions or keys — re-bake before deploying")
        print(f"SNAPSHOT OK: {len(body['queries'])} query results match the live model ({model.calls} calls)")
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    encoded = {k: encode(v) for k, v in body["queries"].items()}
    for k, v in encoded.items():
        if decode(v) != body["queries"][k]:
            raise SystemExit(f"encoding is not lossless for {k}")
    body = {**body, "queries": encoded}
    doc = {
        "version": version,
        "modelId": cfg["semanticModelId"],
        "latestSalesDate": latest,
        "bakedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **body,
    }
    # Atomic: an interrupted multi-minute bake never leaves a truncated snapshot.
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, OUT)
    print(f"snapshot {version}: {len(body['queries'])} query results, {OUT.stat().st_size / 1e6:.2f} MB, {model.calls} calls")


if __name__ == "__main__":
    sys.exit(main())

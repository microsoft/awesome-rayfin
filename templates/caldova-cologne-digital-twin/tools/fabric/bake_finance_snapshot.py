"""Bake the Finance tab's data from the live model `caldova-cologne-finance`.

1. Runs tools/finance/query-manifest.ts (vite-node): EVERY query the tab can send, built by the app's own
   query builders (cockpit queries, P&L queries per year and block, DatenWG dwg page tiles).
2. Sends each one to the model (executeQueries) and stores the answer under the exact query text, the
   key src/finance/lib/snapshot.ts looks up. Text columns dictionary-encoded, round trip asserted,
   atomic write to public/data/finance/snapshot.json.

`--check` re-runs the manifest and every query and fails when the model no longer gives the shipped
answers (a drift gate to run before deploying), or when a query of the app has no baked answer.

⚠️ No connector, no Functions: a delegated semantic-model connector makes the deployed app open only for
its owner. The snapshot is how the tab gets the model's answers without one.

Usage:  python tools/fabric/bake_finance_snapshot.py [--check] [--aoi koeln-messe]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

from bake_reorder_snapshot import Model, decode, encode, same_table
from fabric_api import ROOT, config

OUT = ROOT / "public" / "data" / "finance" / "snapshot.json"
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


def query_key(q: str) -> str:
    """Same normalisation as queryKey() in src/finance/lib/snapshot.ts."""
    return q.replace("\r\n", "\n").strip()


def manifest(aoi: str) -> list[dict]:
    fin = ROOT / "data" / "operations" / aoi / "finance"
    out = fin / "queries.json"
    npx = shutil.which("npx.cmd") or shutil.which("npx") or "npx"
    rc = subprocess.run([npx, "vite-node", "tools/finance/query-manifest.ts", str(out), str(fin / "dim_account.json")],  # noqa: S603
                        cwd=ROOT, check=False).returncode
    if rc != 0:
        raise SystemExit("query manifest failed")
    return json.loads(out.read_text(encoding="utf-8"))


def data_type(values: list) -> str:
    v = next((x for x in values if x is not None), None)
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "int64"
    if isinstance(v, float):
        return "double"
    if isinstance(v, str) and ISO.match(v):
        return "dateTime"
    return "string"


def table_of(rows: list[dict]) -> dict:
    names = list(rows[0].keys()) if rows else []
    body = [[r.get(c) for c in names] for r in rows]
    return {"columns": names, "rows": body, "types": [data_type([r[i] for r in body]) for i in range(len(names))]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--aoi", default="koeln-messe")
    args = ap.parse_args()
    cfg = config()
    if not cfg.get("financeModelId"):
        raise SystemExit("no financeModelId: run publish_model.py --model finance first")
    model = Model({**cfg, "semanticModelId": cfg["financeModelId"]})
    entries = manifest(args.aoi)

    results: dict[str, dict] = {}
    for e in entries:
        key = query_key(e["query"])
        if key in results:
            continue
        results[key] = table_of(model.rows(e["query"]))
        print(f"  {e['source']:<55} {len(results[key]['rows']):>6} rows")
    # The manifest's years come from the generator output; the model's own `jahre` answer must agree, or the
    # page offers a year the snapshot has no answer for.
    jahre = results[query_key(next(e["query"] for e in entries if e["source"] == "guv/jahre"))]
    model_years = sorted(int(r[jahre["columns"].index("Calender[Year]")]) for r in jahre["rows"])
    manifest_years = sorted({int(m.group(1)) for e in entries if (m := re.match(r"guv/kontowerte (\d{4})$", e["source"]))})
    if model_years != manifest_years:
        raise SystemExit(f"FINANCE YEARS DIFFER: model {model_years}, manifest {manifest_years} (regenerate the finance data)")
    info = results[query_key(next(e["query"] for e in entries if e["source"] == "cockpit/info"))]
    last_ac = info["rows"][0][info["columns"].index("[lastAC]")] if info["rows"] else ""

    if args.check:
        if not OUT.exists():
            raise SystemExit(f"FINANCE SNAPSHOT MISSING: {OUT} (run without --check first)")
        shipped = json.loads(OUT.read_text(encoding="utf-8"))["results"]
        for e in entries:
            key = query_key(e["query"])
            have = shipped.get(key)
            if have is None:
                raise SystemExit(f"FINANCE SNAPSHOT lacks a query of the app: {e['source']} (re-bake)")
            have_t = decode({"columns": [c["name"] for c in have["columns"]], "rows": have["rows"],
                             "dict": have.get("dict", {})})
            want_t = {"columns": results[key]["columns"], "rows": results[key]["rows"]}
            diff = same_table(want_t, have_t, ordered=False)
            if diff:
                raise SystemExit(f"FINANCE SNAPSHOT DRIFT on {e['source']}: {diff} (re-bake before deploying)")
        print(f"FINANCE SNAPSHOT OK: {len(entries)} queries of the app match the live model ({model.calls} calls)")
        return

    baked = {}
    for key, t in results.items():
        enc = encode({"columns": t["columns"], "rows": t["rows"]})
        if decode(enc) != {"columns": t["columns"], "rows": t["rows"]}:
            raise SystemExit("encoding is not lossless")
        baked[key] = {"columns": [{"name": n, "dataType": d} for n, d in zip(t["columns"], t["types"], strict=True)],
                      "rows": enc["rows"], **({"dict": enc["dict"]} if enc["dict"] else {})}
    payload = json.dumps(baked, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    doc = {"version": hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16], "modelId": cfg["financeModelId"],
           "bakedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "lastActual": last_ac, "results": baked}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, OUT)
    print(f"finance snapshot {doc['version']}: {len(baked)} queries, {OUT.stat().st_size / 1e6:.2f} MB, {model.calls} calls")


if __name__ == "__main__":
    sys.exit(main())

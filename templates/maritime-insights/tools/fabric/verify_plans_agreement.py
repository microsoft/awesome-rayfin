"""Does the semantic model agree with the committed plans?

🔴 The repo's rule, applied again: **a gate is a script, not a claim.** `verify_model_agreement.py`
already computes every traffic figure twice — Python from the shipped asset, and DAX over Direct
Lake — and exits non-zero on drift. This does the same for the writeback path, and the two sources
are genuinely independent:

  * the **ledger** in `Files/sensor-plans/index.ndjson`, which the app wrote at commit time;
  * the **model**, reached by DAX over the Delta tables that `publish_plans.py` projected from it.

If those disagree, a plan a customer committed is being reported differently from how it was
recorded — which is precisely the failure that makes a decision record worse than no record.

Run:  python tools/fabric/verify_plans_agreement.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.request

import ids

WORKSPACE_ID = ids.workspace_id()
LAKEHOUSE_ID = ids.lakehouse_id()
MODEL_ID = ids.model_id()
AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
DFS = "https://onelake.dfs.fabric.microsoft.com"


def token(resource: str) -> str:
    out = subprocess.run([AZ, "account", "get-access-token", "--resource", resource,
                          "--query", "accessToken", "-o", "tsv"],
                         capture_output=True, text=True, check=True)
    return out.stdout.strip()


def ledger_rows() -> list[dict]:
    req = urllib.request.Request(
        f"{DFS}/{WORKSPACE_ID}/{LAKEHOUSE_ID}/Files/sensor-plans/index.ndjson")
    req.add_header("Authorization", f"Bearer {token('https://storage.azure.com')}")
    with urllib.request.urlopen(req, timeout=180) as res:
        text = res.read().decode("utf-8")
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return rows


def dax(query: str) -> list[dict]:
    body = json.dumps({"queries": [{"query": query}],
                       "serializerSettings": {"includeNulls": True}}).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.powerbi.com/v1.0/myorg/datasets/{MODEL_ID}/executeQueries",
        data=body, method="POST")
    req.add_header("Authorization", f"Bearer {token('https://analysis.windows.net/powerbi/api')}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            payload = json.load(res)
    except urllib.error.HTTPError as exc:
        # 🔴 The body is the whole diagnosis and the status code is none of it. A Direct Lake model
        # that has not been reframed answers "Cannot find table", which reads exactly like broken
        # TMDL until you look — see PLAN §9 phase 6.
        detail = exc.read().decode("utf-8", "replace")[:600]
        raise SystemExit(f"DAX failed ({exc.code}):\n{detail}\n\nquery was:\n{query}") from exc
    result = payload["results"][0]
    # 🔴 A measure that fails to evaluate comes back as HTTP **200** with an empty table and the
    # real message tucked in `error`. Reading only `rows` turns "your DAX is wrong" into
    # `IndexError: list index out of range`, which is how a column-name bug survived a deploy
    # that said Succeeded. Check for the error first.
    if result.get("error"):
        raise SystemExit(f"DAX error: {result['error'].get('message')}\n\nquery was:\n{query}")
    return result["tables"][0]["rows"]


def check(label: str, expected, actual, tolerance: float = 0.0) -> bool:
    if isinstance(expected, float) or isinstance(actual, float):
        ok = abs(float(expected) - float(actual)) <= tolerance
    else:
        ok = expected == actual
    mark = "ok  " if ok else "FAIL"
    print(f"  [{mark}] {label:<38} ledger={expected!r:<24} model={actual!r}")
    return ok


def main() -> None:
    rows = ledger_rows()
    if not rows:
        print("no committed plans — nothing to verify")
        return
    print(f"ledger: {len(rows)} committed plan(s)\n")

    summary = dax(
        "EVALUATE ROW("
        '"Plans", [Committed Plans],'
        '"Masts", [Planned Masts],'
        '"MastMetres", [Planned Mast Metres],'
        '"BestShare", [Best Observed Share],'
        '"NoVegetation", [Plans Missing Vegetation]'
        ")")[0]

    passed = [
        check("committed plans", len(rows), summary["[Plans]"]),
        check("planned masts", sum(r.get("sites") or 0 for r in rows), summary["[Masts]"]),
        check("planned mast metres",
              float(sum(r.get("mastMetres") or 0 for r in rows)),
              float(summary["[MastMetres]"]), 0.001),
        check("best observed share",
              max(float(r.get("observedShare") or 0) for r in rows),
              float(summary["[BestShare]"]), 1e-9),
        check("plans without vegetation",
              sum(1 for r in rows if r.get("includesVegetation") is False),
              summary["[NoVegetation]"]),
    ]

    # Per-plan, so a single wrong row cannot hide inside a matching total.
    print()
    rows_by_id = {r.get("id"): r for r in rows}
    per_plan = dax("EVALUATE SUMMARIZECOLUMNS('Plan'[plan_id], "
                   '"Masts", SUM(\'Plan\'[Masts]), '
                   '"Metres", SUM(\'Plan\'[Mast Metres]))')
    if not per_plan:
        print("  [FAIL] the model returned no per-plan rows")
        passed.append(False)
    for row in per_plan:
        plan_id = row.get("Plan[plan_id]")
        match = rows_by_id.get(plan_id)
        if match is None:
            print(f"  [FAIL] model has plan {plan_id} which the ledger does not")
            passed.append(False)
            continue
        passed.append(check(f"{plan_id} masts", match.get("sites"), row["[Masts]"]))
        passed.append(check(f"{plan_id} mast metres",
                            float(match.get("mastMetres") or 0),
                            float(row["[Metres]"]), 0.001))
    missing = [pid for pid in rows_by_id if pid not in {r.get("Plan[plan_id]") for r in per_plan}]
    for pid in missing:
        print(f"  [FAIL] ledger has plan {pid} which the model does not")
        passed.append(False)

    print()
    if all(passed):
        print(f"all {len(passed)} checks agree — the model reports what the app committed")
        return
    print(f"{sum(1 for p in passed if not p)} of {len(passed)} checks DISAGREE")
    sys.exit(1)


if __name__ == "__main__":
    main()

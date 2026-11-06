"""Publish a Direct Lake semantic model of this template and reframe it.

Reads fabric/caldova-cologne-operations.SemanticModel (a port of the AI Tour caldova-operations model
plus the twin's tour tables) or, with `--model finance`, fabric/caldova-cologne-finance.SemanticModel,
binds its sources and publishes through the Fabric REST API:

  DatabaseQuery  -> OneLake path of the lakehouse in tools/fabric/target.json (caldova_cologne)
  RayfinDatabase -> OneLake mirror of the app's SQL database (dbo.RestockRequests), when
                    appSqlDatabaseId is set; otherwise the lakehouse table restock_requests

Creates the model if no model of that name exists in the workspace, otherwise updates it, and
records its id in tools/fabric/target.json.

Usage:  python tools/fabric/publish_model.py [--model operations|finance]
"""
from __future__ import annotations

import base64
from pathlib import Path
import time
import urllib.request

from fabric_api import ROOT, api, config, save_config, token

MODEL_DIR = ROOT / "fabric" / "caldova-cologne-operations.SemanticModel"
#: --model finance: the Finance tab's model. Same lakehouse, its own config keys.
MODELS = {
    "operations": {"dir": MODEL_DIR, "name_key": "semanticModelName", "id_key": "semanticModelId",
                   "default_name": "caldova-cologne-operations",
                   "description": "Caldova Cologne: stock, reorders and tours (synthetic data, fictional company)."},
    "finance": {"dir": ROOT / "fabric" / "caldova-cologne-finance.SemanticModel", "name_key": "financeModelName",
                "id_key": "financeModelId", "default_name": "caldova-cologne-finance",
                "description": "Caldova Cologne finance: KPI cube and P&L for the Finance tab (derived from the twin, synthetic where stated)."},
}


def parts(ws: str, lh: str, sqldb: str | None, model_dir: Path = MODEL_DIR) -> list[dict]:
    out = []
    for f in sorted(p for p in model_dir.rglob("*") if p.is_file()):
        rel = f.relative_to(model_dir).as_posix()
        text = f.read_text(encoding="utf-8")
        if rel == "definition/model.tmdl":
            text = text.replace("{{DATABASE_QUERY_SOURCE}}", f'AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/{ws}/{lh}")')
            # Without an app SQL database (the app not deployed yet) the reorders come from this
            # lakehouse's restock_requests table: the same columns, seeded the same way.
            restock_item = sqldb or lh
            text = text.replace("{{RESTOCK_QUERY_SOURCE}}", f'AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/{ws}/{restock_item}")')
            if "{{" in text:
                raise SystemExit("unbound placeholder left in model.tmdl")
        if rel == "definition/tables/RestockRequests.tmdl" and not sqldb:
            before = text
            text = text.replace(
                "\t\t\tentityName: RestockRequests\n\t\t\tschemaName: dbo\n",
                "\t\t\tentityName: restock_requests\n",
            )
            text = "/// No app SQL database configured: read from the lakehouse table restock_requests.\n" + text
            if text.endswith(before) or "entityName: restock_requests" not in text:
                raise SystemExit("could not re-point RestockRequests to the lakehouse")
        out.append({"path": rel, "payload": base64.b64encode(text.encode("utf-8")).decode("ascii"), "payloadType": "InlineBase64"})
    return out


def refresh(ws: str, model_id: str) -> None:
    """Reframe Direct Lake: without it the model serves the previous version of every table."""
    headers = {"Authorization": f"Bearer {token('https://analysis.windows.net/powerbi/api')}", "Content-Type": "application/json"}
    base = f"https://api.powerbi.com/v1.0/myorg/groups/{ws}/datasets/{model_id}/refreshes"
    urllib.request.urlopen(urllib.request.Request(base, data=b'{"type":"full"}', headers=headers, method="POST"), timeout=120)  # noqa: S310
    for _ in range(60):
        time.sleep(5)
        import json  # noqa: PLC0415

        with urllib.request.urlopen(urllib.request.Request(base + "?$top=1", headers=headers), timeout=120) as r:  # noqa: S310
            state = json.loads(r.read())["value"][0]
        if state.get("status") == "Completed":
            print("  reframed (refresh completed)")
            return
        if state.get("status") == "Failed":
            raise SystemExit(f"refresh failed: {state.get('serviceExceptionJson')}")
    raise SystemExit("refresh did not complete")


def main() -> None:
    import argparse  # noqa: PLC0415

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=sorted(MODELS), default="operations")
    which = MODELS[ap.parse_args().model]
    cfg = config()
    ws, lh, sqldb = cfg["workspaceId"], cfg.get("lakehouseId"), cfg.get("appSqlDatabaseId") or None
    name = cfg.get(which["name_key"]) or which["default_name"]
    if not lh:
        raise SystemExit("no lakehouseId in tools/fabric/target.json: run setup_lakehouse.py first")
    definition = {"parts": parts(ws, lh, sqldb, which["dir"])}
    _, listing, _ = api("GET", f"/workspaces/{ws}/semanticModels")
    existing = next((m for m in listing.get("value", []) if m["displayName"] == name), None)
    if existing:
        print(f"updating {name} ({existing['id']})")
        api("POST", f"/workspaces/{ws}/semanticModels/{existing['id']}/updateDefinition", {"definition": definition})
        model_id = existing["id"]
    else:
        print(f"creating {name}")
        api("POST", f"/workspaces/{ws}/semanticModels", {"displayName": name, "definition": definition,
                                                          "description": which["description"]})
        _, listing, _ = api("GET", f"/workspaces/{ws}/semanticModels")
        model_id = next(m["id"] for m in listing["value"] if m["displayName"] == name)
    cfg[which["id_key"]] = model_id
    cfg[which["name_key"]] = name
    save_config(cfg)
    print(f"  model id {model_id} (recorded in tools/fabric/target.json)")
    refresh(ws, model_id)


if __name__ == "__main__":
    main()

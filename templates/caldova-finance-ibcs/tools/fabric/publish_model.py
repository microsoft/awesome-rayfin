"""Publish the Direct Lake model `caldova-finance` on the app's lakehouse and reframe it (idempotent).

Usage:  python tools/fabric/publish_model.py
"""
from __future__ import annotations

import base64
import json
import time
import urllib.request

from fabric_api import ROOT, api, config, guard, save_config, token

MODEL_DIR = ROOT / "fabric" / "caldova-finance.SemanticModel"


def parts(ws: str, lh: str) -> list[dict]:
    out = []
    for f in sorted(p for p in MODEL_DIR.rglob("*") if p.is_file()):
        rel = f.relative_to(MODEL_DIR).as_posix()
        if rel == ".platform":
            continue
        text = f.read_text(encoding="utf-8")
        if rel == "definition/model.tmdl":
            text = text.replace("{{DATABASE_QUERY_SOURCE}}", f'AzureStorage.DataLake("https://onelake.dfs.fabric.microsoft.com/{ws}/{lh}")')
        if "{{" in text:
            raise SystemExit(f"unbound placeholder left in {rel}")
        out.append({"path": rel, "payload": base64.b64encode(text.encode("utf-8")).decode("ascii"), "payloadType": "InlineBase64"})
    return out


def refresh(ws: str, model_id: str) -> None:
    """Reframe Direct Lake. A new Delta table can take about two minutes to be visible: retry then."""
    headers = {"Authorization": f"Bearer {token('https://analysis.windows.net/powerbi/api')}", "Content-Type": "application/json"}
    base = f"https://api.powerbi.com/v1.0/myorg/groups/{ws}/datasets/{model_id}/refreshes"
    for attempt in range(6):
        urllib.request.urlopen(urllib.request.Request(base, data=b'{"type":"full"}', headers=headers, method="POST"), timeout=120)  # noqa: S310
        for _ in range(60):
            time.sleep(5)
            with urllib.request.urlopen(urllib.request.Request(base + "?$top=1", headers=headers), timeout=120) as r:  # noqa: S310
                state = json.loads(r.read())["value"][0]
            if state.get("status") == "Completed":
                print("  reframed (refresh completed)")
                return
            if state.get("status") == "Failed":
                err = state.get("serviceExceptionJson", "")
                if "do not exist" in err and attempt < 5:
                    print("  tables not visible yet, retrying in 30 s")
                    time.sleep(30)
                    break
                raise SystemExit(f"refresh failed: {err}")
        else:
            raise SystemExit("refresh did not complete")
    raise SystemExit("refresh kept failing")


def main() -> None:
    cfg = config()
    ws, lh, name = cfg["workspaceId"], cfg["lakehouseId"], cfg["modelName"]
    guard(ids=[ws, lh], names=[name])
    definition = {"parts": parts(ws, lh)}
    _, listing, _ = api("GET", f"/workspaces/{ws}/semanticModels")
    existing = next((m for m in listing.get("value", []) if m["displayName"] == name), None)
    if existing:
        if cfg.get("modelId") and cfg["modelId"] != existing["id"]:
            raise SystemExit(f"a model named {name} exists with another id than recorded: nothing written")
        cfg["modelId"] = existing["id"]
        save_config(cfg)
        guard(ids=[existing["id"]])
        print(f"updating {name} ({existing['id']})")
        api("POST", f"/workspaces/{ws}/semanticModels/{existing['id']}/updateDefinition", {"definition": definition})
        model_id = existing["id"]
    else:
        print(f"creating {name}")
        api("POST", f"/workspaces/{ws}/semanticModels", {
            "displayName": name, "definition": definition,
            "description": "Caldova Finance: income statement, balance sheet and cash flow (fictional company, generated data).",
        })
        _, listing, _ = api("GET", f"/workspaces/{ws}/semanticModels")
        model_id = next(m["id"] for m in listing["value"] if m["displayName"] == name)
        cfg["modelId"] = model_id
        save_config(cfg)
    print(f"  model id recorded in target.json")
    refresh(ws, model_id)


if __name__ == "__main__":
    main()

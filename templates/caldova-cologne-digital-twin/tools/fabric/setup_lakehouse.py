"""Create (or find) the Caldova Cologne lakehouse (default name `caldova_cologne`).

Idempotent: finds an existing lakehouse of that name instead of creating a second one, and records
its id in tools/fabric/target.json.

Usage:  python tools/fabric/setup_lakehouse.py
"""
from __future__ import annotations

from fabric_api import api, config, save_config


def main() -> None:
    cfg = config()
    ws, name = cfg["workspaceId"], cfg.get("lakehouseName") or "caldova_cologne"
    _, listing, _ = api("GET", f"/workspaces/{ws}/lakehouses")
    found = next((i for i in listing.get("value", []) if i["displayName"] == name), None)
    if found:
        print(f"lakehouse exists: {name} ({found['id']})")
    else:
        print(f"creating lakehouse {name} in workspace {ws} ...")
        api("POST", f"/workspaces/{ws}/lakehouses", {
            "displayName": name,
            "description": "Caldova Cologne digital twin: stock, sales and tours (synthetic data, fictional company).",
        })
        _, listing, _ = api("GET", f"/workspaces/{ws}/lakehouses")
        found = next((i for i in listing.get("value", []) if i["displayName"] == name), None)
        if not found:
            raise SystemExit("lakehouse not visible after create")
        print(f"created {name} ({found['id']})")
    cfg["lakehouseName"] = name
    cfg["lakehouseId"] = found["id"]
    save_config(cfg)
    print("recorded in tools/fabric/target.json")


if __name__ == "__main__":
    main()

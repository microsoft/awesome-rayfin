"""Create (or find) the lakehouse of Caldova Finance and record its id in target.json (idempotent).

Usage:  python tools/fabric/setup_lakehouse.py
"""
from __future__ import annotations

from fabric_api import api, config, guard, save_config


def main() -> None:
    cfg = config()
    ws, name = cfg["workspaceId"], cfg["lakehouseName"]
    guard(ids=[ws], names=[name])
    _, listing, _ = api("GET", f"/workspaces/{ws}/lakehouses")
    found = next((i for i in listing.get("value", []) if i["displayName"] == name), None)
    if found:
        print(f"lakehouse exists: {name} ({found['id']})")
    else:
        print(f"creating lakehouse {name} ...")
        api("POST", f"/workspaces/{ws}/lakehouses", {
            "displayName": name,
            "description": "Caldova Finance: income statement, balance sheet and cash flow (fictional company, generated data).",
        })
        _, listing, _ = api("GET", f"/workspaces/{ws}/lakehouses")
        found = next((i for i in listing.get("value", []) if i["displayName"] == name), None)
        if not found:
            raise SystemExit("lakehouse not visible after create")
        print(f"created {name} ({found['id']})")
    cfg["lakehouseId"] = found["id"]
    save_config(cfg)


if __name__ == "__main__":
    main()

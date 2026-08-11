"""Phase 5 — create the Fabric Lakehouse and load the curated tables.

Creates (or reuses) a Lakehouse in the target workspace, uploads the curated CSVs to OneLake Files,
and reports what to do next. Delta conversion is done by `load_tables.py`; this script's job is to
get the data there reproducibly.

PLAN §6: items live in the existing `Rayfin Apps` workspace and every item carries the
`Gleitschirm-Insights` prefix, because that workspace is shared with other apps.

⚠️ `az rest --subscription` silently resolves to the CORP tenant. Tokens are therefore acquired
explicitly and the HTTP calls issued here (see /memories/fabric_rest_api.md).

Usage
  python tools/fabric/setup_lakehouse.py --dry-run
  python tools/fabric/setup_lakehouse.py
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
FABRIC_API = "https://api.fabric.microsoft.com"
ONELAKE_DFS = "https://onelake.dfs.fabric.microsoft.com"
STORAGE_RESOURCE = "https://storage.azure.com"

WORKSPACE_NAME = "Rayfin Apps"
LAKEHOUSE_NAME = "GleitschirmInsightsLakehouse"


def token_for(resource: str) -> str:
    result = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def request(
    method: str, url: str, token: str, body: dict | None = None, raw: bytes | None = None
) -> tuple[int, dict | bytes, dict]:
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:  # noqa: S310 - fixed hosts
            payload = resp.read()
            try:
                parsed = json.loads(payload) if payload else {}
            except json.JSONDecodeError:
                parsed = payload
            return resp.status, parsed, dict(resp.headers)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        return exc.code, {"error": detail}, dict(exc.headers or {})


def find_workspace(token: str, name: str) -> str | None:
    status, payload, _ = request("GET", f"{FABRIC_API}/v1/workspaces", token)
    if status != 200:
        raise SystemExit(f"listing workspaces failed: {status} {payload}")
    for ws in payload.get("value", []):
        if ws.get("displayName") == name:
            return ws["id"]
    print("  available workspaces: " + ", ".join(w.get("displayName", "?") for w in payload.get("value", [])))
    return None


def find_item(token: str, workspace_id: str, name: str, item_type: str) -> dict | None:
    status, payload, _ = request("GET", f"{FABRIC_API}/v1/workspaces/{workspace_id}/items", token)
    if status != 200:
        raise SystemExit(f"listing items failed: {status} {payload}")
    for item in payload.get("value", []):
        if item.get("displayName") == name and item.get("type") == item_type:
            return item
    return None


def create_lakehouse(token: str, workspace_id: str, name: str) -> dict:
    status, payload, headers = request(
        "POST",
        f"{FABRIC_API}/v1/workspaces/{workspace_id}/lakehouses",
        token,
        {"displayName": name, "description": "Gleitschirm-Insights — Oberstdorf / Nebelhorn flight and weather tables"},
    )
    if status in (200, 201):
        return payload
    if status == 202:  # long-running operation
        location = headers.get("Location")
        for _ in range(60):
            time.sleep(3)
            s, p, _ = request("GET", location, token)
            if s == 200 and p.get("status") in (None, "Succeeded"):
                return p
        raise SystemExit("lakehouse creation did not complete")
    raise SystemExit(f"lakehouse creation failed: {status} {payload}")


def upload_file(token: str, workspace_id: str, lakehouse_id: str, local: Path, remote: str) -> None:
    """Upload via the OneLake DFS API: create, append, flush."""
    base = f"{ONELAKE_DFS}/{workspace_id}/{lakehouse_id}/Files/{remote}"
    payload = local.read_bytes()

    status, body, _ = request("PUT", f"{base}?resource=file", token)
    if status not in (201, 202):
        raise SystemExit(f"create {remote} failed: {status} {body}")

    status, body, _ = request("PATCH", f"{base}?action=append&position=0", token, raw=payload)
    if status not in (202, 200):
        raise SystemExit(f"append {remote} failed: {status} {body}")

    status, body, _ = request("PATCH", f"{base}?action=flush&position={len(payload)}", token)
    if status not in (200, 201):
        raise SystemExit(f"flush {remote} failed: {status} {body}")

    print(f"  uploaded {remote} ({len(payload) / 1024:.0f} KB)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", default=WORKSPACE_NAME)
    parser.add_argument("--lakehouse", default=LAKEHOUSE_NAME)
    parser.add_argument("--curated", type=Path, default=Path("data/curated"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    fabric_token = token_for(FABRIC_API)
    print(f"workspace: {args.workspace}")
    workspace_id = find_workspace(fabric_token, args.workspace)
    if not workspace_id:
        raise SystemExit(f"workspace '{args.workspace}' not found")
    print(f"  id {workspace_id}")

    existing = find_item(fabric_token, workspace_id, args.lakehouse, "Lakehouse")
    if existing:
        print(f"lakehouse '{args.lakehouse}' already exists: {existing['id']}")
        lakehouse_id = existing["id"]
    elif args.dry_run:
        print(f"[dry run] would create lakehouse '{args.lakehouse}'")
        return
    else:
        created = create_lakehouse(fabric_token, workspace_id, args.lakehouse)
        lakehouse_id = created.get("id")
        print(f"created lakehouse {lakehouse_id}")

    files = sorted(args.curated.glob("*.csv"))
    total_mb = sum(f.stat().st_size for f in files) / 1024 / 1024
    print(f"\n{len(files)} curated files, {total_mb:.1f} MB")
    if args.dry_run:
        for f in files:
            print(f"  [dry run] would upload {f.name}")
        return

    storage_token = token_for(STORAGE_RESOURCE)
    for f in files:
        upload_file(storage_token, workspace_id, lakehouse_id, f, f"curated/{f.name}")

    print("\nnext: run tools/fabric/load_tables.py to convert the CSVs into Delta tables")
    print(
        f"portal: https://app.fabric.microsoft.com/groups/{workspace_id}/lakehouses/{lakehouse_id}"
    )
    Path("tools/fabric/.fabric-ids.json").write_text(
        json.dumps({"workspaceId": workspace_id, "lakehouseId": lakehouse_id}, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

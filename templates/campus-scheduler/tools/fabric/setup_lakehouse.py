"""Create (or find) the Lakehouse that backs the semantic model.

PLAN Phase 4. Idempotent: run it as often as you like, it will not make a second Lakehouse.

The workspace is the same one the Fabric App is deployed into, so the app, its data and its model
sit together and a reviewer opening the workspace sees the whole thing rather than an app pointing
at something elsewhere.

Usage
  python tools/fabric/setup_lakehouse.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request

from fabric_ids import folder_id, workspace_id

WORKSPACE_ID = workspace_id()
#: ⚠️ NOT `campus_lh`. That name belongs to Campus-Insights' lakehouse, which lives in the same
#: workspace; reusing it would make two items indistinguishable in every list and every error
#: message while both existed. This repo owns its own.
LAKEHOUSE_NAME = "campus_scheduler_lh"
#: The workspace folder to create the item in, if any. Placed on creation rather than created at
#: the root and moved, because a failed move would leave the item loose.
FOLDER_ID = folder_id()
FABRIC_API = "https://api.fabric.microsoft.com/v1"

AZ = shutil.which("az") or "az"


def token(resource: str) -> str:
    """An access token from the signed-in az session.

    Deliberately shelling out to `az` rather than pulling in an auth library: the developer is
    already signed in for everything else in this repo, and a second credential store is a second
    thing to get wrong.
    """
    out = subprocess.run(  # noqa: S603
        [AZ, "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def api(method: str, path: str, body: dict | None = None) -> tuple[int, dict, dict]:
    request = urllib.request.Request(
        f"{FABRIC_API}{path}",
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={
            "Authorization": f"Bearer {token('https://api.fabric.microsoft.com')}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {}), dict(response.headers)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{method} {path} failed: {exc.code} {exc.read().decode('utf-8', 'replace')}")


def main() -> None:
    status, listing, _ = api("GET", f"/workspaces/{WORKSPACE_ID}/lakehouses")
    existing = next(
        (item for item in listing.get("value", []) if item["displayName"] == LAKEHOUSE_NAME), None
    )
    if existing:
        print(f"lakehouse already exists: {LAKEHOUSE_NAME} ({existing['id']})")
        lakehouse_id = existing["id"]
    else:
        print(f"creating lakehouse {LAKEHOUSE_NAME}...")
        status, created, headers = api(
            "POST",
            f"/workspaces/{WORKSPACE_ID}/lakehouses",
            {
                "displayName": LAKEHOUSE_NAME,
                "description": "Campus Scheduler room and booking data",
                "folderId": FOLDER_ID,
            },
        )
        if status == 202:
            # Provisioning is asynchronous; poll until the item exists rather than guessing a wait.
            for _ in range(30):
                time.sleep(4)
                _, listing, _ = api("GET", f"/workspaces/{WORKSPACE_ID}/lakehouses")
                created = next(
                    (i for i in listing.get("value", []) if i["displayName"] == LAKEHOUSE_NAME), None
                )
                if created:
                    break
        if not created:
            raise SystemExit("lakehouse creation did not complete")
        lakehouse_id = created["id"]
        print(f"  created: {lakehouse_id}")

    print("\nAdd these to tools/fabric/build_lakehouse_tables.py and build_semantic_model.py:")
    print(f'  WORKSPACE_ID = "{WORKSPACE_ID}"')
    print(f'  LAKEHOUSE_ID = "{lakehouse_id}"')


if __name__ == "__main__":
    main()

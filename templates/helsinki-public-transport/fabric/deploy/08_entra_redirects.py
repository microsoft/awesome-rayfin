"""Step 8 - register the app origins as SPA redirect URIs (standalone sign-in only).

Only needed for the Power BI transport, i.e. when the app is opened in its own tab rather than
embedded in the Fabric portal. Inside the portal the host bridge is used and no token is acquired
in the browser at all, so this step can be skipped entirely.

MSAL validates the redirect URI *before* the account picker, so a missing origin fails with
AADSTS50011 for every account.

    PBI_CLIENT_ID   the SPA app registration to extend
    APP_ORIGINS     comma-separated origins, e.g.
                    "https://<app>.webapp.fabricapps.net,http://localhost:5173"

The update is strictly additive - existing URIs are never removed.
"""

import json
import os
import subprocess
import sys
import tempfile

from _fabric import _az, env


def az(*args: str) -> str:
    result = subprocess.run([_az(), *args], capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit("az failed: " + result.stderr.strip()[:600])
    return result.stdout.strip()


def main() -> None:
    client_id = env("PBI_CLIENT_ID", required=True)
    origins = [o.strip() for o in env("APP_ORIGINS", required=True).split(",") if o.strip()]

    object_id = az("ad", "app", "show", "--id", client_id, "--query", "id", "-o", "tsv")
    current = json.loads(
        az("ad", "app", "show", "--id", client_id, "--query", "spa.redirectUris", "-o", "json")
    )
    merged = list(dict.fromkeys([*current, *origins]))

    if len(merged) == len(current):
        print(f"all {len(origins)} origin(s) already registered; nothing to do")
        return

    handle, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(handle, "w", encoding="utf-8") as stream:
        json.dump({"spa": {"redirectUris": merged}}, stream)
    try:
        az("rest", "--method", "PATCH",
           "--uri", f"https://graph.microsoft.com/v1.0/applications/{object_id}",
           "--headers", "Content-Type=application/json",
           "--body", f"@{path}")
    finally:
        os.unlink(path)

    after = json.loads(
        az("ad", "app", "show", "--id", client_id, "--query", "spa.redirectUris", "-o", "json")
    )
    print(f"redirect URIs: {len(current)} -> {len(after)}")
    for origin in origins:
        print(("  ok   " if origin in after else "  MISS ") + origin)


if __name__ == "__main__":
    main()

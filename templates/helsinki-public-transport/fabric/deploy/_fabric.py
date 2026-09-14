"""Shared plumbing for the deployment scripts in this folder.

Everything talks to the Fabric / Power BI REST APIs with an Azure CLI token, so the only
prerequisite is `az login` against the target tenant. Nothing here stores a secret: tokens are
fetched per run and kept in memory.

Configuration comes from environment variables so the same scripts work against any tenant:

    FABRIC_TENANT_ID       required - tenant that owns the workspace
    FABRIC_WORKSPACE_ID    required - workspace to deploy into
    FABRIC_FOLDER_ID       optional - folder inside the workspace to file the items under

    HSL_EVENTHOUSE_NAME    default HSL_EH
    HSL_EVENTSTREAM_NAME   default ES_HSL_Events
    HSL_NOTEBOOK_NAME      default NB_Helsinki_Realtime_Tracker
    HSL_MODEL_NAME         default HSL_KQL_SM

Ids of the things that get created are written to `.state.json` next to this file, so each step
can pick up where the previous one left off. That file is git-ignored - it is deployment state,
not source.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

FABRIC_API = "https://api.fabric.microsoft.com/v1"
POWERBI_API = "https://api.powerbi.com/v1.0/myorg"
POWERBI_RESOURCE = "https://analysis.windows.net/powerbi/api"

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
STATE_PATH = HERE / ".state.json"

_token_cache: dict[tuple[str, str], str] = {}


# --------------------------------------------------------------------------- config


def env(name: str, default: str | None = None, *, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and not value:
        sys.exit(
            f"{name} is not set. Export it first, e.g.\n"
            f'  $env:{name} = "..."   (PowerShell)\n'
            f"  export {name}=...     (bash)"
        )
    return value or ""


def tenant() -> str:
    return env("FABRIC_TENANT_ID", required=True)


def workspace() -> str:
    return env("FABRIC_WORKSPACE_ID", required=True)


def folder_id() -> str:
    return env("FABRIC_FOLDER_ID", "")


NAMES = {
    "eventhouse": lambda: env("HSL_EVENTHOUSE_NAME", "HSL_EH"),
    "eventstream": lambda: env("HSL_EVENTSTREAM_NAME", "ES_HSL_Events"),
    "notebook": lambda: env("HSL_NOTEBOOK_NAME", "NB_Helsinki_Realtime_Tracker"),
    "model": lambda: env("HSL_MODEL_NAME", "HSL_KQL_SM"),
}


# --------------------------------------------------------------------------- state


def load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {}


def save_state(**values) -> dict:
    state = load_state()
    state.update({k: v for k, v in values.items() if v is not None})
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    return state


def need(key: str) -> str:
    """Read a value an earlier step was supposed to record."""
    state = load_state()
    if key not in state:
        sys.exit(f"'{key}' is missing from {STATE_PATH.name} - run the earlier steps first.")
    return state[key]


# --------------------------------------------------------------------------- auth


def _az() -> str:
    found = shutil.which("az") or shutil.which("az.cmd")
    if found:
        return found
    fallback = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
    if Path(fallback).exists():
        return fallback
    sys.exit("Azure CLI not found on PATH. Install it and run `az login --tenant <tenant>`.")


def token(resource: str = "https://api.fabric.microsoft.com") -> str:
    """Bearer token for `resource` in the configured tenant.

    Note the Kusto audience: `https://kusto.fabric.microsoft.com` is not registered in every
    tenant, so pass the *cluster URI* as the resource when talking to an Eventhouse.
    """
    key = (tenant(), resource)
    if key not in _token_cache:
        result = subprocess.run(
            [_az(), "account", "get-access-token", "--tenant", tenant(),
             "--resource", resource, "--query", "accessToken", "-o", "tsv"],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            sys.exit(
                "Could not get a token. Sign in first:\n"
                f"  az login --tenant {tenant()}\n\n" + result.stderr.strip()[:600]
            )
        _token_cache[key] = result.stdout.strip()
    return _token_cache[key]


# --------------------------------------------------------------------------- http


def call(method: str, url: str, body=None, resource: str = "https://api.fabric.microsoft.com"):
    """Returns (status, headers, parsed_body)."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Authorization", "Bearer " + token(resource))
    if data:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
            return response.status, dict(response.headers), (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as error:
        payload = error.read()
        try:
            payload = json.loads(payload)
        except Exception:
            payload = payload.decode(errors="replace")
        return error.code, dict(error.headers), payload


def lro(status: int, headers: dict, body, timeout: int = 900):
    """Resolve a Fabric long-running operation. Item creation almost always returns 202."""
    if status != 202:
        return status, body
    location = headers.get("Location") or headers.get("location")
    if not location:
        return status, body
    started = time.time()
    while time.time() - started < timeout:
        time.sleep(4)
        poll_status, _headers, poll_body = call("GET", location)
        if isinstance(poll_body, dict) and poll_body.get("status") in ("Succeeded", "Failed"):
            if poll_body["status"] == "Failed":
                return 500, poll_body
            return call("GET", location.rstrip("/") + "/result")[0::2]
        if poll_status == 200 and isinstance(poll_body, dict) and "id" in poll_body:
            return 200, poll_body
    return 408, {"error": "long-running operation timed out"}


def fail(step: str, status: int, body) -> None:
    print(f"FAILED {step}: HTTP {status}")
    print(json.dumps(body, indent=2)[:1500] if body else "")
    sys.exit(1)


# --------------------------------------------------------------------------- items


def find_item(item_type: str, display_name: str) -> dict | None:
    """`item_type` is the REST collection, e.g. 'eventhouses' or 'semanticModels'."""
    status, _headers, body = call("GET", f"{FABRIC_API}/workspaces/{workspace()}/{item_type}")
    if status != 200 or not isinstance(body, dict):
        fail(f"list {item_type}", status, body)
    for item in body.get("value", []):
        if item.get("displayName") == display_name:
            return item
    return None


def create_item(item_type: str, body: dict) -> dict:
    if folder_id():
        body.setdefault("folderId", folder_id())
    status, headers, response = call(
        "POST", f"{FABRIC_API}/workspaces/{workspace()}/{item_type}", body
    )
    status, response = lro(status, headers, response)
    if status not in (200, 201):
        fail(f"create {item_type}", status, response)
    return response


def inline_part(path: str, payload: bytes) -> dict:
    import base64

    return {
        "path": path,
        "payload": base64.b64encode(payload).decode(),
        "payloadType": "InlineBase64",
    }

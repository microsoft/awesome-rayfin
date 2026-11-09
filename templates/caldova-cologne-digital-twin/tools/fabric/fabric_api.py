"""Shared Fabric helpers for the optional Fabric back end of this template.

The target workspace and item ids come from ONE local file, `tools/fabric/target.json`, which is
git-ignored. Copy `tools/fabric/target.example.json`, fill in your workspace id, and the scripts
record every item id they create (lakehouse, semantic models) back into it.

Tokens come from the Azure CLI (`az login` first). If `tenantId` is set in target.json, the token is
requested for that tenant and its `tid` claim is checked, so a stale default subscription cannot send
writes to a different tenant without anyone noticing.
"""
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "target.json"
EXAMPLE_PATH = Path(__file__).resolve().parent / "target.example.json"
AZ = shutil.which("az") or "az"


def config() -> dict:
    if not CONFIG_PATH.exists():
        raise SystemExit(
            f"{CONFIG_PATH.relative_to(ROOT).as_posix()} not found: copy "
            f"{EXAMPLE_PATH.relative_to(ROOT).as_posix()} to it and set your workspaceId"
        )
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not cfg.get("workspaceId") or "<" in cfg["workspaceId"]:
        raise SystemExit("set workspaceId in tools/fabric/target.json")
    return cfg


def save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def token(resource: str) -> str:
    tenant = config().get("tenantId") or ""
    scope = ["--tenant", tenant] if tenant and "<" not in tenant else []
    out = subprocess.run(  # noqa: S603
        [AZ, "account", "get-access-token", *scope, "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=False,
    )
    if out.returncode != 0 or not out.stdout.strip():
        raise SystemExit(f"no token for {resource} (run `az login` first): {out.stderr.strip()}")
    tok = out.stdout.strip()
    if scope:
        body = tok.split(".")[1]
        tid = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))).get("tid")
        if tid != tenant:
            raise SystemExit("token tenant does not match tenantId in tools/fabric/target.json")
    return tok


def api(method: str, path: str, body: dict | None = None, base: str = "https://api.fabric.microsoft.com/v1") -> tuple[int, dict, dict]:
    """(status, json, headers) for a Fabric REST call; follows a 202 long-running operation."""
    headers = {"Authorization": f"Bearer {token('https://api.fabric.microsoft.com')}", "Content-Type": "application/json"}
    url = path if path.startswith("http") else f"{base}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=300) as r:  # noqa: S310
            status, raw, hdrs = r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{method} {url} -> {exc.code}\n{exc.read().decode('utf-8', 'replace')}") from exc
    if status == 202 and hdrs.get("Location"):
        location = hdrs["Location"]
        for _ in range(90):
            time.sleep(float(hdrs.get("Retry-After", 4)))
            with urllib.request.urlopen(urllib.request.Request(location, headers=headers), timeout=120) as r:  # noqa: S310
                state = json.loads(r.read() or b"{}")
            if state.get("status") in ("Succeeded", "Completed"):
                try:
                    with urllib.request.urlopen(urllib.request.Request(location + "/result", headers=headers), timeout=120) as r:  # noqa: S310
                        return 200, json.loads(r.read() or b"{}"), {}
                except urllib.error.HTTPError:
                    return 200, state, {}
            if state.get("status") == "Failed":
                raise SystemExit(f"{method} {url} failed: {json.dumps(state, indent=1)}")
        raise SystemExit(f"{method} {url}: long-running operation did not finish")
    return status, (json.loads(raw) if raw else {}), hdrs

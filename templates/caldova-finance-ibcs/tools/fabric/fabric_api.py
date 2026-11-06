"""Shared Fabric helpers for Caldova Finance.

Target ids live in tools/fabric/target.json (git-ignored: tenant-specific). Start from target.example.json.

⚠️ EVERY TOKEN NAMES THE TENANT (`tenantId` in target.json): `az` without it uses the default subscription's
tenant, and every call then fails with a 404 that reads as "the workspace does not exist".

⚠️ GUARD: this tooling writes only to items it created itself. `guard()` refuses any item id that is not the
workspace or recorded in target.json, and any name other than the configured lakehouse and model names. The
workspace "Rayfin Apps" also holds the twin, the Finance Cockpit and other demos.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).resolve().parent / "target.json"
AZ = shutil.which("az") or shutil.which("az.cmd") or "az"
OWN_ID_KEYS = ("lakehouseId", "modelId", "appItemId", "reportId")


def config() -> dict:
    if not CONFIG_PATH.exists():
        raise SystemExit(f"{CONFIG_PATH} missing: copy target.example.json and fill in workspace and tenant")
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def guard(ids: list[str] | None = None, names: list[str] | None = None) -> None:
    cfg = config()
    allowed_ids = {cfg["workspaceId"].lower(), *(cfg[k].lower() for k in OWN_ID_KEYS if cfg.get(k))}
    allowed_names = {cfg["lakehouseName"], cfg["modelName"], cfg.get("reportName", "Caldova Finance (Power BI)")}
    bad = [i for i in ids or [] if i.lower() not in allowed_ids] + [n for n in names or [] if n not in allowed_names]
    if bad:
        raise SystemExit(f"guard refused {bad}: not an item of this app. Nothing was written.")


def token(resource: str) -> str:
    out = subprocess.run(  # noqa: S603
        [AZ, "account", "get-access-token", "--tenant", config()["tenantId"], "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=False,
    )
    if out.returncode != 0 or not out.stdout.strip():
        raise SystemExit(f"no token for {resource}: {out.stderr.strip()}")
    return out.stdout.strip()


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


def dax(query: str) -> list[dict]:
    """Rows of one DAX query against the app's model (Power BI executeQueries, the caller's own token)."""
    cfg = config()
    url = f"https://api.powerbi.com/v1.0/myorg/groups/{cfg['workspaceId']}/datasets/{cfg['modelId']}/executeQueries"
    body = json.dumps({"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}}).encode("utf-8")
    headers = {"Authorization": f"Bearer {token('https://analysis.windows.net/powerbi/api')}", "Content-Type": "application/json"}
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers, method="POST"), timeout=300) as r:  # noqa: S310
                return json.loads(r.read())["results"][0]["tables"][0]["rows"]
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 503) and attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise SystemExit(f"DAX failed {exc.code}: {exc.read().decode('utf-8', 'replace')[:800]}") from exc
    raise SystemExit("DAX failed after retries")

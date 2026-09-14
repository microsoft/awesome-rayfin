#!/usr/bin/env python3
"""Check that this tree carries no tenant-specific identifiers.

The template ships clean. It stops being clean the moment you deploy it: `rayfin up` writes your
workspace, item and publishable key into `rayfin/.env`, `fabric/deploy` records ids in
`.state.json`, and it is easy to paste a model id into a source file "just for now". Run this
before you share your copy, fork it publicly, or contribute a change back.

Two independent audits run over every file git would carry into a fresh clone, minus the
directories listed in .templateignore:

  1. restricted paths - files that must never ship at all (hard fail, no allowlist)
  2. a pattern census  - regexes for tenant identifiers, each with a path allowlist that
     records *why* a hit in that path is acceptable

Exit codes:
  0  clean
  1  unreviewed hits
  2  the scan itself was inconclusive (git returned nothing, or nothing was read)

Usage:
  python tools/verify_publishable.py [--verbose]
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# 1. paths that must not ship
# ---------------------------------------------------------------------------

PLACEHOLDER_GUID = "00000000-0000-0000-0000-000000000000"

RESTRICTED_PATHS: list[tuple[str, str]] = [
    ("rayfin/.env", "Rayfin publishable key and deployment ids"),
    ("rayfin/.deployments.json", "deployment state for a specific workspace"),
    (".env.local", "generated env, carries workspace and tenant ids"),
]

# ---------------------------------------------------------------------------
# 2. pattern census
# ---------------------------------------------------------------------------

PATTERNS: dict[str, re.Pattern[bytes]] = {
    # Any GUID. Deliberately broad - GUIDs are how workspaces, items, capacities,
    # app registrations and tenants are all named.
    "guid": re.compile(rb"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"),
    # A deployed Fabric App or Kusto cluster hostname identifies the tenant it lives in.
    "endpoint": re.compile(rb"webapp\.fabricapps\.net|kusto\.fabric\.microsoft\.com|pbidedicated|msit\.powerbi\.com"),
    # Fabric capacity names used by this account.
    "capacity": re.compile(rb"\bprd(?:sweden|small\d+)\b", re.IGNORECASE),
    # Rayfin publishable key.
    "key": re.compile(rb"pk-[A-Za-z0-9]{16,}"),
    # Corporate identities.
    "identity": re.compile(rb"[A-Za-z0-9._%+-]+@microsoft\.com"),
}

# path prefix -> reason it is allowed to contain that pattern
ALLOWED: dict[str, list[tuple[str, str]]] = {
    "guid": [
        ("src/cesium/helsinkiOpenData.ts", "City of Helsinki open data catalogue ids - public, and the whole point of the map"),
        ("fabric/", "item definitions ship with placeholder ids; fabric/deploy fills them in at provisioning time"),
        (".env.example", "all-zero placeholder GUIDs"),
        ("package-lock.json", "npm integrity metadata"),
        ("tools/verify_publishable.py", "this file"),
    ],
    "endpoint": [
        ("fabric/", "item definitions ship with a placeholder cluster; fabric/deploy fills it in at provisioning time"),
        ("tools/verify_publishable.py", "this file"),
        ("README.md", "explains the portal-embedded vs standalone transports"),
        ("src/services/auth.ts", "comment naming the home cluster a corp identity gets redirected to - no tenant of ours"),
    ],
    "capacity": [
        ("tools/verify_publishable.py", "this file"),
    ],
    "key": [
        ("tools/verify_publishable.py", "this file"),
    ],
    "identity": [
        ("tools/verify_publishable.py", "this file"),
    ],
}


def template_ignored_prefixes() -> list[str]:
    path = ROOT / ".templateignore"
    if not path.exists():
        return []
    prefixes: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        prefixes.append(line.rstrip("/"))
    return prefixes


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return [p for p in result.stdout.decode("utf-8").split("\0") if p]


def is_ignored(rel: str, prefixes: list[str]) -> bool:
    return any(rel == p or rel.startswith(p + "/") or rel.endswith(p) for p in prefixes)


def is_allowed(kind: str, rel: str) -> str | None:
    for prefix, reason in ALLOWED.get(kind, []):
        if rel == prefix or rel.startswith(prefix):
            return reason
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verbose", action="store_true", help="also print allowed hits")
    args = parser.parse_args()

    files = tracked_files()
    if not files:
        print("verify_publishable: git listed no files - run this inside the repository", file=sys.stderr)
        return 2

    ignored = template_ignored_prefixes()
    scanned = 0
    violations: list[str] = []
    allowed_hits: list[str] = []

    for rel in files:
        if is_ignored(rel, ignored):
            continue
        for restricted, reason in RESTRICTED_PATHS:
            if rel == restricted or rel.startswith(restricted.rstrip("/") + "/"):
                violations.append(f"[restricted path] {rel} - {reason}")

        blob = (ROOT / rel).read_bytes() if (ROOT / rel).exists() else b""
        if not blob:
            continue
        scanned += 1

        for kind, pattern in PATTERNS.items():
            hits = pattern.findall(blob)
            if not hits:
                continue
            reason = is_allowed(kind, rel)
            unique = sorted({h.decode("utf-8", "replace") for h in hits})
            # An all-zero GUID is the template's own placeholder, never a real identifier.
            unique = [h for h in unique if h != PLACEHOLDER_GUID]
            if not unique:
                continue
            summary = ", ".join(unique[:4]) + (f" (+{len(unique) - 4} more)" if len(unique) > 4 else "")
            if reason:
                allowed_hits.append(f"[{kind}] {rel}: {summary} - allowed: {reason}")
            else:
                violations.append(f"[{kind}] {rel}: {summary}")

    if scanned == 0:
        print("verify_publishable: nothing was read - refusing to report success", file=sys.stderr)
        return 2

    if args.verbose:
        for line in allowed_hits:
            print(line)

    print(f"verify_publishable: scanned {scanned} files, {len(allowed_hits)} reviewed hits")

    if violations:
        print(f"\n{len(violations)} unreviewed hit(s) - resolve or add a path allowlist entry with a reason:\n")
        for line in violations:
            print(f"  {line}")
        return 1

    print("clean - no unreviewed tenant-specific values")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

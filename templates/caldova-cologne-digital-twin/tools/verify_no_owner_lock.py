"""GATE: nothing in a deploy may make the app owner-only.

Measured on the original caldova-reorder app: a `fabric-semanticmodel` connector (delegated only,
runs through a User Data Function) or a Functions binding with delegated auth makes Fabric open the
deployed app ONLY for its owner; any other workspace member is locked out.

Fails (exit 1) when:
  * rayfin/rayfin.yml has a top-level `connectors:` block, or `services.functions.enabled` is not false
  * a `rayfin/functions` folder exists again (rayfin up would pick it up the moment the flag flips)
  * the built bundle in dist/ references the semantic-model connector or a functions invoke

Usage:  python tools/verify_no_owner_lock.py [--no-dist]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
YML = ROOT / "rayfin" / "rayfin.yml"
DIST = ROOT / "dist"
BUNDLE_MARKERS = ("rayfin-connector-fabric-semanticmodel", "fabricSemanticModel", "/functions/", "executeQuery")


def functions_enabled(text: str) -> object:
    """services.functions.enabled, parsed as YAML. An indentation regex read a nested
    `enabled: false` under a sub-key and passed `enabled: true`. Anything but literal False fails."""
    doc = yaml.safe_load(text) or {}
    services = doc.get("services") if isinstance(doc, dict) else None
    functions = services.get("functions") if isinstance(services, dict) else None
    return functions.get("enabled") if isinstance(functions, dict) else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-dist", action="store_true", help="skip the bundle scan (before a build)")
    args = ap.parse_args()
    problems: list[str] = []

    text = YML.read_text(encoding="utf-8")
    doc = yaml.safe_load(text) or {}
    if re.search(r"^connectors\s*:", text, re.M) or (isinstance(doc, dict) and doc.get("connectors")):
        problems.append("rayfin.yml has a top-level `connectors:` block")
    enabled = functions_enabled(text)
    if enabled is not False:
        problems.append(f"rayfin.yml services.functions.enabled is {enabled!r}, must be false")
    if (ROOT / "rayfin" / "functions").exists():
        problems.append("rayfin/functions exists again (keep the old UDF under tools/reference/)")

    if not args.no_dist:
        files = [p for p in DIST.rglob("*.js")] if DIST.exists() else []
        if not files:
            problems.append("dist/ has no JavaScript to scan; build first or pass --no-dist")
        for p in files:
            body = p.read_text(encoding="utf-8", errors="replace")
            for marker in BUNDLE_MARKERS:
                if marker in body:
                    problems.append(f"{p.relative_to(ROOT)} contains {marker!r}")

    if problems:
        print("OWNER-LOCK GATE FAILED:")
        for p in problems:
            print("  -", p)
        return 1
    print("owner-lock gate ok: no connector, functions disabled and absent, bundle clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())

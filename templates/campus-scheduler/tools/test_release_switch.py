"""Sabotage-test the public-release switch.

Flips config/release.json into each release posture, runs the unit suite, and restores the file
in a `finally` block. The point is to watch the switch actually take effect: a guard nobody has
seen fire is an assumption, not a test.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CFG = ROOT / "config" / "release.json"

# ⚠️ Vitest prints ✓/✗ and box-drawing characters. A Windows console defaults to cp1252, which
# cannot encode them, so echoing the output crashes the harness with a UnicodeEncodeError that
# looks like a test failure and is not one.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def run(label: str) -> int:
    print(f"\n{'=' * 70}\n{label}\n{'=' * 70}", flush=True)
    proc = subprocess.run(
        ["npx", "vitest", "run", "src/config", "src/geo"],
        cwd=ROOT,
        shell=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    tail = [ln for ln in (proc.stdout + proc.stderr).splitlines() if ln.strip()][-14:]
    print("\n".join(tail), flush=True)
    print(f"exit={proc.returncode}", flush=True)
    return proc.returncode


def set_flags(**flags) -> None:
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    cfg.update(flags)
    CFG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


POSTURES: list[tuple[str, dict]] = [
    ("include   (internal demo)", {"navigatumData": "include", "excludeAois": []}),
    ("synthetic (publishable, explode survives)", {"navigatumData": "synthetic", "excludeAois": []}),
    ("exclude   (no interiors)", {"navigatumData": "exclude", "excludeAois": []}),
    ("site removed", {"navigatumData": "include", "excludeAois": ["garching"]}),
    ("synthetic + site removed", {"navigatumData": "synthetic", "excludeAois": ["garching"]}),
    # ⚠️ A TYPO MUST FAIL CLOSED. `release.ts` resolves an unrecognised value to `exclude`, not to
    # `include` — withholding too much is a far smaller mistake than publishing TUM's timetable.
    ("typo -> must fail closed to exclude", {"navigatumData": "syntetic", "excludeAois": []}),
]


def main() -> int:
    original = CFG.read_text(encoding="utf-8")
    results: dict[str, int] = {}
    try:
        for label, flags in POSTURES:
            CFG.write_text(original, encoding="utf-8")
            set_flags(**flags)
            results[label] = run(label)
    finally:
        CFG.write_text(original, encoding="utf-8")
        print(f"\nrestored {CFG.relative_to(ROOT)}", flush=True)

    print("\n" + "=" * 70)
    for k, v in results.items():
        print(f"{'PASS' if v == 0 else 'FAIL'}  {k}")
    return 0 if all(v == 0 for v in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())

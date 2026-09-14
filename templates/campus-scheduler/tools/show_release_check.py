"""Show what `npm run check:release` says in each posture, then restore the config.

The interesting case is `synthetic`: the checker must PASS when `rooms.json` carries the synthetic
stamp and FAIL when it is a leftover from an internal build, even though the filename is identical.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CFG = ROOT / "config" / "release.json"

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def check() -> tuple[int, str]:
    proc = subprocess.run(
        ["npm", "run", "check:release"],
        cwd=ROOT,
        shell=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    body = "\n".join(
        ln for ln in proc.stdout.splitlines() if ln.strip() and not ln.startswith(">")
    )
    return proc.returncode, body


def main() -> int:
    original = CFG.read_text(encoding="utf-8")
    try:
        for mode in ("include", "synthetic", "exclude"):
            cfg = json.loads(original)
            cfg["navigatumData"] = mode
            CFG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            code, body = check()
            print(f"\n{'=' * 70}\nnavigatumData = {mode}   (exit {code})\n{'=' * 70}")
            print(body)
    finally:
        CFG.write_text(original, encoding="utf-8")
        print(f"\nrestored {CFG.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

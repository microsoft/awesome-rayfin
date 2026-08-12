"""Show which pipeline steps Garching gets in each release posture, and restore the config.

The point is to SEE the gate move. `synthetic` must keep `osm-indoor` and `rooms` — those are the
OpenStreetMap polygons the explode view is made of — while dropping the two TUM fetchers and the
flow build.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CFG = ROOT / "config" / "release.json"
INDOOR = ("osm-indoor", "navigatum", "calendar", "rooms", "flows")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def steps_for(aoi: str = "garching") -> dict[str, str]:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "geodata" / "pipeline.py"), "--aoi", aoi, "--list"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    section = "applicable"
    out: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        if "not for this area" in line:
            section = "skipped"
            continue
        name = line.strip().split(" ")[0] if line.startswith("  ") else None
        if name in INDOOR:
            out[name] = section
    return out


def main() -> int:
    original = CFG.read_text(encoding="utf-8")
    try:
        for mode in ("include", "synthetic", "exclude"):
            cfg = json.loads(original)
            cfg["navigatumData"] = mode
            CFG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            got = steps_for()
            print(f"\nnavigatumData = {mode}")
            for name in INDOOR:
                state = got.get(name, "absent")
                mark = "run " if state == "applicable" else "SKIP"
                print(f"  {mark}  {name}")
    finally:
        CFG.write_text(original, encoding="utf-8")
        print(f"\nrestored {CFG.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

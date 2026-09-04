"""Build every browser asset for one AOI, in dependency order.

⚠️ **This file was referenced before it existed.** `package.json`, the README and the app's own
"terrain data missing" screen all told the reader to run `python tools/geodata/pipeline.py`, and
there was no such file — a broken instruction shown to exactly the person least able to work around
it. Building a second AOI meant running the chain by hand twice, which is what made the gap
obvious, so the runner is now the thing the documentation always claimed.

The order below is a dependency order, not a preference:

    fetch_lvermgeo  → DGM1 tiles          (≈6 GB, cached and reused across AOIs)
    build_terrain   → heightmap + landmask (needs the tiles)
    fetch_copdem    → shell window        (COG range reads, a few MB)
    build_shell     → horizon tier        (needs the window AND the heightmap, for the seam)
    fetch_dop20     → orthophoto drape
    build_lod2_mesh → buildings
    fetch_ais       → one day, filtered to the AOI
    build_tracks    → replay tracks       (needs the filtered day)
    resolve_places  → reviewed place list (written for inspection, NOT into the config)
    resolve_assets  → protected assets
    fetch_bdom      → measured surface top (≈23 GB streamed and discarded — see --skip-bdom)
    build_los_surface → the blocking surface (LAST: it folds in buildings and the surface top)

🔴 `build_los_surface` must run after **both** `build_lod2_mesh` and `fetch_bdom`, or it silently
writes a thinner surface and every coverage figure downstream comes out too high. It is last here
for that reason, and re-running it alone is the cheap way to pick up a late bDOM.

Usage
  python tools/geodata/pipeline.py                      # the default AOI, everything
  python tools/geodata/pipeline.py --aoi schlei
  python tools/geodata/pipeline.py --aoi schlei --skip-bdom
  python tools/geodata/pipeline.py --aoi schlei --only build_los_surface
  python tools/geodata/pipeline.py --aoi schlei --dry-run
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

#: (module path relative to the repo, extra arguments, what it produces).
#: `--aoi` is appended to every one of them; a step that does not accept it does not belong here.
STEPS: list[tuple[str, list[str], str]] = [
    ("tools/geodata/fetch_lvermgeo.py", [], "DGM1 tiles"),
    ("tools/geodata/build_terrain.py", [], "heightmap + landmask"),
    ("tools/geodata/fetch_copdem.py", [], "Copernicus shell window"),
    ("tools/geodata/build_shell.py", [], "horizon tier"),
    ("tools/geodata/fetch_dop20.py", [], "orthophoto drape"),
    ("tools/geodata/build_lod2_mesh.py", [], "LoD2 buildings"),
    ("tools/ais/fetch_ais.py", [], "one AIS day, filtered"),
    ("tools/ais/build_tracks.py", [], "replay tracks"),
    ("tools/geodata/resolve_assets.py", [], "protected assets"),
    ("tools/geodata/fetch_bdom.py", [], "measured surface top (bDOM)"),
    ("tools/geodata/build_los_surface.py", [], "blocking surface"),
]

#: Steps skipped by `--skip-bdom`. Kept as a name list rather than an index, because an index
#: silently points at the wrong step the moment someone inserts one above it.
BDOM_STEPS = {"tools/geodata/fetch_bdom.py"}


def run(script: str, extra: list[str], aoi: str, dry_run: bool) -> float:
    command = [sys.executable, "-u", str(REPO / script), "--aoi", aoi, *extra]
    print(f"\n{'=' * 78}\n$ {' '.join(command[1:])}\n{'=' * 78}", flush=True)
    if dry_run:
        return 0.0
    started = time.time()
    # cwd is the repo root: several steps write to relative paths like public/terrain/<aoi>.
    result = subprocess.run(command, cwd=REPO)
    if result.returncode != 0:
        raise SystemExit(f"\n{script} failed with exit code {result.returncode} — stopping, "
                         f"because every step after this one would build on a missing input")
    return time.time() - started


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--skip-bdom", action="store_true",
                        help="skip the ~23 GB surface-top stream; the blocking surface then "
                             "carries terrain and buildings only, and the app labels its coverage "
                             "an explicit UPPER BOUND rather than pretending otherwise")
    parser.add_argument("--only", nargs="+", metavar="STEP",
                        help="run just these steps, by script name (e.g. build_los_surface)")
    parser.add_argument("--dry-run", action="store_true", help="print the plan and stop")
    args = parser.parse_args()

    steps = STEPS
    if args.skip_bdom:
        steps = [s for s in steps if s[0] not in BDOM_STEPS]
    if args.only:
        wanted = {name.removesuffix(".py") for name in args.only}
        steps = [s for s in steps if Path(s[0]).stem in wanted]
        unknown = wanted - {Path(s[0]).stem for s in STEPS}
        if unknown:
            raise SystemExit(f"unknown step(s): {', '.join(sorted(unknown))}\n"
                             f"available: {', '.join(Path(s[0]).stem for s in STEPS)}")
    if not steps:
        raise SystemExit("nothing selected")

    print(f"AOI {args.aoi}: {len(steps)} step(s)")
    for script, _, produces in steps:
        print(f"  {Path(script).stem:22} {produces}")

    timings: list[tuple[str, float]] = []
    for script, extra, _ in steps:
        timings.append((Path(script).stem, run(script, extra, args.aoi, args.dry_run)))

    if args.dry_run:
        print("\ndry run — nothing was executed")
        return

    print(f"\n{'=' * 78}\nAOI {args.aoi} built")
    for name, seconds in timings:
        print(f"  {name:22} {seconds / 60:6.1f} min")
    print(f"  {'total':22} {sum(t for _, t in timings) / 60:6.1f} min")
    out = REPO / "public" / "terrain" / args.aoi
    print(f"\nassets in {out}")
    if args.skip_bdom:
        print("⚠️  built WITHOUT the surface top — coverage figures are an upper bound. Run "
              f"fetch_bdom.py --aoi {args.aoi} and then build_los_surface.py to remove that.")


if __name__ == "__main__":
    main()

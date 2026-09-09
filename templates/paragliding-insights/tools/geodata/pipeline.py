"""Run the whole geodata pipeline end to end.

One command from a fresh clone to a runnable app. Every step downloads from an open source and is
safe to re-run — downloads are cached and verified, and the build steps are idempotent.

    python tools/geodata/pipeline.py

Roughly 380 MB is downloaded on a first run and about 17 MB of derived assets end up in
`public/terrain/`. Sources and licences are listed in NOTICE.md; the attribution is not optional.

Steps
  1. places      OpenStreetMap settlements, aerialway stations, peaks and free-flying sites
  2. dgm1        LDBV 1 m terrain tiles for the core
  3. terrain     DGM1 -> 4 m heightmap
  4. copdem      Copernicus DEM window for the coarse shell (a COG range read, not a download)
  5. shell       shell heightmap, with the seam offset measured against the core
  6. verify      registration proof against published peak elevations  <- FAILS THE RUN if wrong
  7. osm-landuse OpenStreetMap land cover and transport network
  8. landuse     land cover raster for surface colour
  9. lod2        LDBV LoD2 CityGML tiles
 10. buildings   CityGML -> quantised building mesh
 11. cableway    the Nebelhornbahn, from OpenStreetMap
 12. drape       DOP20 orthophoto, requested at AOI extent through the WMS

⚠️ Step 6 is a gate, not a report. It compares the generated terrain against every published summit
elevation in the box, and a run that gets there with the model in the wrong place stops rather than
carrying on to decorate it. That check has already caught a real fault — an AOI coordinate 4.6 km
from the town it named.

The tree layer is fetched separately (`fetch_trees.py` then `build_vegetation.py`) because the
Bavarian tree cadastre is published per region as a 344 MB GeoPackage, which is worth downloading
once and keeping rather than folding into a routine full run.
"""

from __future__ import annotations

import argparse
import ast
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]

# ⚠️ Some steps resolve `public/terrain/...` from the working directory rather than from `__file__`,
# so a run started anywhere but the repo root fails at whichever step gets there first — with a
# "missing heightmap" message that blames the previous step for something it did correctly. The
# pipeline is a repo-scoped tool; it should not care where it was invoked from.
os.chdir(ROOT)

STEPS: list[tuple[str, list[str], str]] = [
    ("places", ["resolve_places.py"], "OpenStreetMap places, stations, peaks and flying sites"),
    ("dgm1", ["fetch_bvv.py"], "LDBV 1 m terrain tiles"),
    ("terrain", ["build_terrain.py"], "4 m core heightmap"),
    ("copdem", ["fetch_copdem.py"], "Copernicus DEM window for the shell"),
    ("shell", ["build_shell.py"], "coarse shell with the measured seam offset"),
    ("verify", ["verify_registration.py"], "registration proof against published elevations"),
    ("osm-landuse", ["fetch_osm_landuse.py"], "land cover and transport network"),
    ("landuse", ["build_landuse.py"], "land cover raster for surface colour"),
    # ⚠️ These two were NOT pipeline steps until phase 7, so building a second site produced a
    # treeless one. They were always `--aoi`-aware — they had simply been run by hand once for
    # Oberstdorf and then forgotten, which is indistinguishable from working until there is a
    # second area of interest. If a script has to run to make a site complete, it belongs here.
    ("trees", ["fetch_trees.py"], "canopy source data"),
    ("vegetation", ["build_vegetation.py"], "tree instances from the canopy model"),
    ("lod2", ["fetch_bvv.py", "--product", "lod2"], "LoD2 CityGML tiles"),
    ("buildings", ["build_lod2_mesh.py"], "LoD2 building mesh"),
    ("cableway", ["build_cableway.py"], "aerialways, from OpenStreetMap"),
    ("drape", ["fetch_dop20.py"], "DOP20 orthophoto drape, via the LDBV WMS"),
]


def preflight() -> None:
    """Compile every step before anything is downloaded.

    ⚠️ **This exists because two steps stayed broken for two phases without anyone noticing.** The
    pipeline is resumable and its outputs are cached, so once Oberstdorf was built, steps 7 and 8
    never ran again — and an edit that left `build_landuse.py` with an unterminated docstring, plus
    a deletion that removed the module `fetch_osm_landuse.py` imported, both sat there silently
    until a second AOI needed a run from scratch. The first surfaced after 25 seconds of tile
    downloads; the second after a 1.1 MB Overpass query and a polite wait.

    A second of parsing up front turns "fails somewhere in the middle" into "fails before it
    starts", which is the difference between a typo and a wasted quarter of an hour.
    """
    problems: list[str] = []

    for name, script, _ in STEPS:
        path = HERE / script[0]
        if not path.exists():
            problems.append(f"{name}: {script[0]} does not exist")
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as exc:
            problems.append(f"{name}: {script[0]} line {exc.lineno}: {exc.msg}")
            continue

        # Sibling imports only — stdlib and third-party are not this check's business. A module that
        # sits next to the step is one this repo owns, and one it can therefore delete by accident.
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or node.level != 0 or not node.module:
                continue
            head = node.module.split(".")[0]
            if head in sys.stdlib_module_names or (HERE / f"{head}.py").exists():
                continue
            try:
                __import__(head)
            except ImportError:
                problems.append(f"{name}: {script[0]} imports '{head}', which is not there")

    if problems:
        print("preflight failed — nothing was downloaded:\n")
        for problem in problems:
            print(f"  {problem}")
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument("--from-step", default=None, help="start at this step")
    parser.add_argument("--only", default=None, help="run just this step")
    parser.add_argument("--list", action="store_true", help="list the steps and stop")
    args = parser.parse_args()

    if args.list:
        for name, script, description in STEPS:
            print(f"  {name:<14} {description}   ({' '.join(script)})")
        return

    preflight()

    steps = STEPS
    if args.only:
        steps = [s for s in STEPS if s[0] == args.only]
        if not steps:
            raise SystemExit(f"no step '{args.only}' — try --list")
    elif args.from_step:
        names = [s[0] for s in STEPS]
        if args.from_step not in names:
            raise SystemExit(f"no step '{args.from_step}' — try --list")
        steps = STEPS[names.index(args.from_step) :]

    started = time.time()
    for index, (name, script, description) in enumerate(steps, start=1):
        print(f"\n{'=' * 72}\n[{index}/{len(steps)}] {name} — {description}\n{'=' * 72}")
        step_started = time.time()
        result = subprocess.run(
            [sys.executable, str(HERE / script[0]), *script[1:], "--aoi", args.aoi],
            # ⚠️ The repo ROOT, not this directory. Steps take repo-root-relative defaults
            # (`public/terrain`, `data/raw/osm/...`), so running them from `tools/geodata` sent
            # `build_landuse.py` looking for `tools/geodata/public/terrain` and reporting the
            # heightmap missing — blaming the previous step for something it had done correctly.
            # It never showed up at Oberstdorf because that raster was built by running the script
            # directly, from the root, where the defaults are right.
            cwd=ROOT,
        )
        if result.returncode != 0:
            print(f"\nstep '{name}' failed with exit code {result.returncode} — stopping")
            sys.exit(result.returncode)
        print(f"\n[{name}] done in {time.time() - step_started:.0f}s")

    print(f"\n{'=' * 72}\npipeline complete in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()

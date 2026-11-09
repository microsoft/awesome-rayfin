"""Run the geodata pipeline for the Cologne twin end to end.

One command from a fresh clone to a runnable twin. Every step downloads from an open source and is
safe to re-run: downloads are cached and verified, and the build steps are idempotent.

    python tools/geodata/pipeline.py --aoi koeln-messe

Sources and licences are listed in NOTICE.md; the attribution is not optional.

Steps (Geobasis NRW core, Copernicus shell, OpenStreetMap context)
  1. places             OpenStreetMap places, stations and any published elevation references
  2. dgm1-nrw           Geobasis NRW 1 m terrain tiles for the core
  3. terrain            DGM1 -> core heightmap
  4. copdem             Copernicus DEM window for the coarse shell (a COG range read, not a download)
  5. shell              shell heightmap, with the seam offset measured against the core
  6. verify             registration proof against published elevations  <- FAILS THE RUN if wrong
  7. osm-landuse        OpenStreetMap land cover and transport network
  8. landuse            land cover raster for surface colour
  9. ndom-nrw           Geobasis NRW nDOM50 tiles (normalised surface model)
 10. vegetation-ndom-nrw tree instances from the nDOM (NRW publishes no tree cadastre)
 11. lod2-nrw           Geobasis NRW LoD2 CityGML tiles
 12. drape-nrw          DOP orthophoto, requested at AOI extent through the Geobasis NRW WMS
 13. buildings          CityGML -> quantised building mesh, roof colours measured from the drape
 14. water              Rhine surface from the OpenStreetMap water polygons
 15. mesh-core-nrw      Geobasis NRW 3D-Mesh: select + range-fetch the core nodes (texel-targeted)
 16. mesh-core-bake-nrw core nodes -> GLB tiles in the scene frame (public/terrain/<aoi>/mesh)
 17. mesh-verify-nrw    mesh registration against DGM1 + nDOM50, vertical and XY  <- FAILS THE RUN
 18. mesh-ring-nrw      Geobasis NRW 3D-Mesh: the coarse ring around the core (one 5 m texel target)
 19. mesh-ring-bake-nrw ring nodes -> GLB tiles (public/terrain/<aoi>/mesh-ring), clipped against the core
 20. dgm1-ring-nrw      Geobasis NRW DGM1 over the whole shell: road heights for the ~6 km delivery ring

⚠️ Steps 6 and 17 are gates, not reports. A run that gets there with the model in the wrong place
stops rather than carrying on to decorate it.

The mesh is read from one 220 GB SLPK by HTTP Range: the first run fetches its 140 MB central
directory once and caches it under `cache/mesh/`, then only the selected nodes. The operations data
(`tools/data/*`) is a separate command (`npm run data:ops`), see README.md.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

HERE = Path(__file__).parent
ROOT = HERE.parents[1]

# ⚠️ Some steps resolve `public/terrain/...` from the working directory rather than from `__file__`,
# so a run started anywhere but the repo root fails at whichever step gets there first, with a
# "missing heightmap" message that blames the previous step for something it did correctly. The
# pipeline is a repo-scoped tool; it should not care where it was invoked from.
os.chdir(ROOT)


@dataclass(frozen=True)
class Step:
    name: str
    script: list[str]
    what: str
    # ⚠️ ASK THE AOI, DO NOT LIST THE SITES. A step applies where the configuration says it
    # applies (here: where the survey authority is Geobasis NRW), so a second NRW site needs only
    # its own AOI file.
    when: Callable[[dict], bool] = field(default=lambda aoi: True)


def _authority(aoi: dict) -> str:
    return str((aoi.get("geobasis") or {}).get("authority", ""))


def in_nordrhein_westfalen(aoi: dict) -> bool:
    """The survey authority this template's twin is built from (Geobasis NRW, dl-de/zero-2-0)."""
    return "Geobasis NRW" in _authority(aoi) or "Nordrhein-Westfalen" in _authority(aoi)


STEPS: list[Step] = [
    Step("places", ["resolve_places.py"], "OpenStreetMap places, stations and elevation references"),
    # ⚠️ NRW needs no conversion step: Geobasis NRW publishes DGM1 as a float32 GeoTIFF carrying the
    # ModelTiepoint/ModelPixelScale pair `build_terrain.py` reads.
    Step("dgm1-nrw", ["fetch_nrw.py"], "Geobasis NRW 1 m terrain tiles", in_nordrhein_westfalen),
    Step("terrain", ["build_terrain.py"], "4 m core heightmap"),
    Step("copdem", ["fetch_copdem.py"], "Copernicus DEM window for the shell"),
    Step("shell", ["build_shell.py"], "coarse shell with the measured seam offset"),
    Step("verify", ["verify_registration.py"], "registration proof against published elevations"),
    Step("osm-landuse", ["fetch_osm_landuse.py"], "land cover and transport network"),
    Step("landuse", ["build_landuse.py"], "land cover raster for surface colour"),
    # NRW publishes no tree cadastre, but it does publish nDOM50, so the canopy comes from the
    # normalised surface model.
    Step("ndom-nrw", ["fetch_nrw.py", "--product", "ndom50"], "Geobasis NRW nDOM50 tiles", in_nordrhein_westfalen),
    Step("vegetation-ndom-nrw", ["build_vegetation_ndom.py"], "canopy from the NRW nDOM", in_nordrhein_westfalen),
    Step("lod2-nrw", ["fetch_nrw.py", "--product", "lod2"], "Geobasis NRW LoD2 CityGML tiles", in_nordrhein_westfalen),
    # ⚠️ THE DRAPE MUST COME BEFORE THE BUILDINGS. `build_lod2_mesh.py` measures every roof's colour
    # from the DOP pixels inside its own LoD2 outline. With no drape on disk it does not fail: it
    # writes `roofColour.state: "no-drape"`, measures 0 roofs, and every building falls back to its
    # wall colour. That only bites a NEW site on its first build, which is exactly when nobody has a
    # previous version to compare against.
    Step("drape-nrw", ["fetch_dop20_nrw.py"], "DOP orthophoto drape, via the Geobasis NRW WMS", in_nordrhein_westfalen),
    Step("buildings", ["build_lod2_mesh.py"], "LoD2 building mesh"),
    Step("water", ["build_water.py"], "water surfaces from OpenStreetMap"),
    # The photoreal Geobasis NRW 3D-Mesh. The texel targets (Confex 0.25 m, Dom 0.5 m, 1.6 m within
    # 3.5 km of the hero, 3 m elsewhere; ring 5 m) and the 5 m clip margin are constants in
    # fetch_nrw_mesh.py / bake_nrw_mesh.py, the same ones the reference build was made with.
    # ⚠️ ORDER: the bake reads heightmap.json (the scene frame, step 3), the gate reads nDOM50 (step 9),
    # and the ring bake adds itself to the mesh.json the core bake wrote, so the core comes first.
    # The gate sits between the core and the ring: a misregistered core stops the run before the
    # ring is fetched.
    Step("mesh-core-nrw", ["fetch_nrw_mesh.py", "--tier", "core"], "3D-Mesh core nodes (HTTP Range from the SLPK)", in_nordrhein_westfalen),
    Step("mesh-core-bake-nrw", ["bake_nrw_mesh.py", "--tier", "core"], "3D-Mesh core -> GLB tiles", in_nordrhein_westfalen),
    Step("mesh-verify-nrw", ["verify_mesh_registration.py"], "mesh registration against DGM1 + nDOM50", in_nordrhein_westfalen),
    Step("mesh-ring-nrw", ["fetch_nrw_mesh.py", "--tier", "ring"], "3D-Mesh ring nodes (coarse level)", in_nordrhein_westfalen),
    Step("mesh-ring-bake-nrw", ["bake_nrw_mesh.py", "--tier", "ring"], "3D-Mesh ring -> GLB tiles", in_nordrhein_westfalen),
    # ⚠️ NOT FOR THE TERRAIN, FOR THE ROADS. `tools/data/build_road_graph.py` gives every road node a
    # DGM1 height across the whole delivery ring (~6 km around the hub). With only the core's 16 tiles
    # it does not fail: every node outside the core silently gets the 45 m fallback height, and the
    # vans float or sink along most of their tours. build_terrain.py ignores tiles outside its grid,
    # so the extra tiles cost download time and nothing else.
    Step("dgm1-ring-nrw", ["fetch_nrw.py", "--tier", "shell"], "Geobasis NRW DGM1 over the delivery ring (road heights)", in_nordrhein_westfalen),
]


def preflight() -> None:
    """Compile every step before anything is downloaded.

    ⚠️ The pipeline is resumable and its outputs are cached, so a step that was broken by an edit
    (an unterminated docstring, an import of a deleted module) can sit unnoticed until a run from
    scratch reaches it after minutes of downloads. A second of parsing up front turns "fails
    somewhere in the middle" into "fails before it starts".
    """
    problems: list[str] = []

    for step in STEPS:
        path = HERE / step.script[0]
        if not path.exists():
            problems.append(f"{step.name}: {step.script[0]} does not exist")
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as exc:
            problems.append(f"{step.name}: {step.script[0]} line {exc.lineno}: {exc.msg}")
            continue

        # Sibling imports only: stdlib and third-party are not this check's business. A module that
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
                problems.append(f"{step.name}: {step.script[0]} imports '{head}', which is not there")

    if problems:
        print("preflight failed, nothing was downloaded:\n")
        for problem in problems:
            print(f"  {problem}")
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--aoi", default="koeln-messe")
    parser.add_argument("--from-step", default=None, help="start at this step")
    parser.add_argument("--only", default=None, help="run just this step")
    parser.add_argument("--list", action="store_true", help="list the steps and stop")
    args = parser.parse_args()

    aoi = json.loads((ROOT / "config" / "aoi" / f"{args.aoi}.json").read_text(encoding="utf-8"))

    applicable = [step for step in STEPS if step.when(aoi)]
    skipped = [step for step in STEPS if not step.when(aoi)]

    if args.list:
        print(f"steps for {args.aoi}:")
        for step in applicable:
            print(f"  {step.name:<20} {step.what}   ({' '.join(step.script)})")
        if skipped:
            print("\nnot for this area of interest:")
            for step in skipped:
                print(f"  {step.name:<20} {step.what}")
        return

    preflight()

    steps = applicable
    if args.only:
        steps = [s for s in STEPS if s.name == args.only]
        if not steps:
            raise SystemExit(f"no step '{args.only}', try --list")
    elif args.from_step:
        names = [s.name for s in applicable]
        if args.from_step not in names:
            raise SystemExit(f"no step '{args.from_step}' for {args.aoi}, try --list")
        steps = applicable[names.index(args.from_step) :]

    started = time.time()
    for index, step in enumerate(steps, start=1):
        print(f"\n{'=' * 72}\n[{index}/{len(steps)}] {step.name}: {step.what}\n{'=' * 72}")
        step_started = time.time()
        result = subprocess.run(
            [sys.executable, str(HERE / step.script[0]), *step.script[1:], "--aoi", args.aoi],
            # ⚠️ The repo ROOT, not this directory. Steps take repo-root-relative defaults
            # (`public/terrain`, `data/raw/osm/...`).
            cwd=ROOT,
            # ⚠️ Windows console encoding: on a cp1252 console the `verify` step can crash on the
            # 'Δ' in its own control-point table, which looks exactly like "the model is in the
            # wrong place". Forcing UTF-8 here fixes every step at once.
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            check=False,
        )
        if result.returncode != 0:
            print(f"\nstep '{step.name}' failed with exit code {result.returncode}, stopping")
            sys.exit(result.returncode)
        print(f"\n[{step.name}] done in {time.time() - step_started:.0f}s")

    print(f"\n{'=' * 72}\npipeline complete in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()

"""Run the whole geodata pipeline end to end.

One command from a fresh clone to a runnable app. Every step downloads from an open source and is
safe to re-run — downloads are cached and verified, and the build steps are idempotent.

    python tools/geodata/pipeline.py --aoi oth-regensburg

Sources and licences are listed in NOTICE.md; the attribution is not optional.

Steps
  1. places      OpenStreetMap places, stations and any published elevation references
  2. dgm1        LDBV 1 m terrain tiles for the core
  3. terrain     DGM1 -> core heightmap
  4. copdem      Copernicus DEM window for the coarse shell (a COG range read, not a download)
  5. shell       shell heightmap, with the seam offset measured against the core
  6. verify      registration proof against published elevations  <- FAILS THE RUN if wrong
  7. osm-landuse OpenStreetMap land cover and transport network
  8. landuse     land cover raster for surface colour
  9. trees       canopy source data
 10. vegetation  tree instances from the canopy model
 11. lod2        LDBV LoD2 CityGML tiles
 12. buildings   CityGML -> quantised building mesh
 13. drape       DOP20 orthophoto, requested at AOI extent through the WMS

⚠️ Step 6 is a gate, not a report. A run that gets there with the model in the wrong place stops
rather than carrying on to decorate it. That check has already caught a real fault in the app this
pipeline came from — an AOI coordinate 4.6 km from the town it named.

⚠️ The registration strategy is per-AOI. An Alpine box proves itself against published summit
elevations; a campus on a gravel plain has no summits and uses control points instead. OTH
Regensburg sits in between: 54 ele-tagged nodes across the shell, seven of them usable, six being
named landforms around the Danube valley (see `verification` in its AOI config).

⚠️ THIS AOI HOLDS TWO CAMPUSES 2.5 km APART plus the corridor between them, so the core box is
wider than a single campus and contains far more building stock — 8,193 buildings against 263 at
Garching. `buildings` therefore applies the LoD policy from the AOI config rather than extruding
everything at full detail.
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
# so a run started anywhere but the repo root fails at whichever step gets there first — with a
# "missing heightmap" message that blames the previous step for something it did correctly. The
# pipeline is a repo-scoped tool; it should not care where it was invoked from.
os.chdir(ROOT)


@dataclass(frozen=True)
class Step:
    name: str
    script: list[str]
    what: str
    # ⚠️ ASK THE AOI, DO NOT LIST THE SITES. A step applies where the configuration says it
    # applies: Bavarian tiles where the survey authority is the LDBV, Baden-Württemberg tiles
    # where it is the LGL, indoor steps where the AOI declares a `rooms` block. A hard-coded list
    # of site ids would need editing every time one is added — which is one of the ways Garching
    # and Tübingen ended up here with their assets and without the tools that make them.
    when: Callable[[dict], bool] = field(default=lambda aoi: True)
    # ⚠️ ARGUMENTS THAT DEPEND ON THE AOI, not just on the step. `build_rooms.py` needs
    # `--semantics synthetic` when the TUM feed is withheld but the OSM polygons remain, and that
    # is a property of the release posture rather than of the step, so it cannot be baked into
    # `script` the way `--product ndom50` is.
    extra: Callable[[dict], list[str]] = field(default=lambda aoi: [])


def _authority(aoi: dict) -> str:
    return str((aoi.get("geobasis") or {}).get("authority", ""))


def in_bavaria(aoi: dict) -> bool:
    return "LDBV" in _authority(aoi) or "Bayer" in _authority(aoi)


def in_baden_wuerttemberg(aoi: dict) -> bool:
    return "LGL" in _authority(aoi) or "Baden-Württemberg" in _authority(aoi)


def in_nordrhein_westfalen(aoi: dict) -> bool:
    """The third survey authority, added for the largest German universities.

    Köln, Aachen, Münster, Bochum, Duisburg-Essen and Bonn are all in NRW, so without this the
    'top ten by student numbers' set could not be built past the two Munich sites and FAU.
    """
    return "Geobasis NRW" in _authority(aoi) or "Nordrhein-Westfalen" in _authority(aoi)


def in_hamburg(aoi: dict) -> bool:
    """The fourth survey authority, added for Universität Hamburg (6th nationally).

    Hamburg is the only state so far that publishes ONE archive per product for the whole city
    rather than per-tile downloads, which is why `fetch_hamburg.py` reads those archives in place
    over HTTP range requests instead of downloading 3.5 GB to build a 1.5 km box.
    """
    return "LGV" in _authority(aoi) or "Hamburg" in _authority(aoi)


def _release() -> dict:
    """The public-release switch, shared with the app (`src/config/release.ts`).

    ⚠️ ONE FILE FOR BOTH SIDES ON PURPOSE. A flag that lived only here would let the app keep
    offering a lens whose assets were never built; a flag that lived only in the app would let
    the pipeline write `public/terrain/garching/occupancy.bin` into a build that claims not to
    carry TUM data. Missing or malformed, the file means "exclude nothing" — the pre-existing
    behaviour, so this cannot break a normal internal build.
    """
    path = ROOT / "config" / "release.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def navigatum_mode() -> str:
    """`include` | `synthetic` | `exclude`, mirroring `NAVIGATUM_MODE` in `src/config/release.ts`.

    ⚠️ AN UNRECOGNISED VALUE FAILS CLOSED, to `exclude`. A typo must not resolve to `include` and
    quietly fetch data a public build may not redistribute.
    """
    mode = _release().get("navigatumData", "include")
    return mode if mode in ("include", "synthetic", "exclude") else "exclude"


def has_osm_indoor(aoi: dict) -> bool:
    """Does this AOI have room polygons in OpenStreetMap that this build may ship?

    ⚠️ THIS IS A DIFFERENT QUESTION FROM `from_navigatum`, AND CONFLATING THEM COST THE EXPLODE
    VIEW. Both indoor steps used to hang off the TUM gate, so withholding TUM data also stopped
    the OSM fetch — and the room POLYGONS are OpenStreetMap's under ODbL. They were never TUM's
    to withhold. Keying on `osmRefKey` asks who actually supplies the geometry.

    ⚠️ `exclude` STILL TAKES THEM AWAY, and that is the difference between the two withholding
    modes. `synthetic` says "the geometry is fine, the week is not"; `exclude` says "no interiors
    at all". Reading this gate as purely a question about OpenStreetMap would build rooms into a
    release that asked for none.
    """
    rooms = aoi.get("rooms") or {}
    if not rooms.get("osmRefKey"):
        return False
    if rooms.get("navigatumBase") and navigatum_mode() == "exclude":
        return False
    return True


def from_navigatum(aoi: dict) -> bool:
    """Does this AOI's interior SEMANTICS come from NavigaTUM and TUMonline?

    ⚠️ `rooms` IS THE WRONG TEST, and it selected the wrong three sites when it was tried: OTH,
    LMU and Garching all carry a `rooms` block, because in this repository that block means "the
    app has room geometry". Where that geometry COMES FROM is a different question, and only one
    AOI answers it with a TUM API. Keying on `navigatumBase` asks the question actually being
    asked; keying on `rooms` would have handed OTH four TUM scripts that can only fail.

    ⚠️ `config/release.json` can switch this off. Only the two TUM FETCHERS hang off it now — the
    OSM indoor fetch and the rooms build hang off `has_osm_indoor`, so they still run and the
    building still opens.
    """
    if navigatum_mode() != "include":
        return False
    return bool((aoi.get("rooms") or {}).get("navigatumBase"))


def flows_available(aoi: dict) -> bool:
    """Flow is routed from REAL consecutive course bookings, so it cannot be substituted.

    Inventing where people walk across a campus is a materially bigger claim than inventing a
    utilisation percentage, and it would look just as authoritative on screen. So `synthetic`
    keeps the occupancy lens and drops this one.
    """
    return from_navigatum(aoi)


def rooms_semantics_args(aoi: dict) -> list[str]:
    """`--semantics synthetic` once the TUM feed is withheld but the polygons remain."""
    return [] if from_navigatum(aoi) else ["--semantics", "synthetic"]


STEPS: list[Step] = [
    Step("places", ["resolve_places.py"], "OpenStreetMap places, stations, peaks and flying sites"),
    # ── terrain, chosen by who surveyed the state ────────────────────────────────────────
    Step("dgm1", ["fetch_bvv.py"], "LDBV 1 m terrain tiles", in_bavaria),
    Step("dgm1-bw", ["fetch_lgl_bw.py"], "LGL Baden-Württemberg terrain tiles", in_baden_wuerttemberg),
    # ⚠️ NRW needs no conversion step. The LGL ships DGM1 as ASCII XYZ that `fetch_lgl_bw.py` has
    # to rewrite as a GeoTIFF; Geobasis NRW publishes it already as a float32 GeoTIFF carrying the
    # same ModelTiepoint/ModelPixelScale pair `build_terrain.py` reads from the Bavarian tiles.
    Step("dgm1-nrw", ["fetch_nrw.py"], "Geobasis NRW 1 m terrain tiles", in_nordrhein_westfalen),
    Step("dgm1-hh", ["fetch_hamburg.py"], "Hamburg LGV 1 m terrain tiles", in_hamburg),
    Step("terrain", ["build_terrain.py"], "4 m core heightmap"),
    Step("copdem", ["fetch_copdem.py"], "Copernicus DEM window for the shell"),
    Step("shell", ["build_shell.py"], "coarse shell with the measured seam offset"),
    Step("verify", ["verify_registration.py"], "registration proof against published elevations"),
    Step("osm-landuse", ["fetch_osm_landuse.py"], "land cover and transport network"),
    Step("landuse", ["build_landuse.py"], "land cover raster for surface colour"),
    # ⚠️ These two were NOT pipeline steps until phase 7, so building a second site produced a
    # treeless one. They were always `--aoi`-aware — they had simply been run by hand once for
    # Oberstdorf and then forgotten, which is indistinguishable from working until there is a
    # second area of interest. If a script has to run to make a site complete, it belongs here.
    #
    # ⚠️ AND BADEN-WÜRTTEMBERG PUBLISHES NO TREE CADASTRE. Bavaria does; the LGL does not, so
    # Tübingen's canopy comes out of the normalised surface model instead. Two routes to one
    # layer, picked by the survey authority rather than by the site's name.
    Step("trees", ["fetch_trees.py"], "canopy source data", in_bavaria),
    Step("vegetation", ["build_vegetation.py"], "tree instances from the canopy model", in_bavaria),
    Step("vegetation-ndom", ["build_vegetation_ndom.py"], "canopy from the nDOM, where no tree cadastre exists", in_baden_wuerttemberg),
    # NRW publishes no tree cadastre either, but it does publish nDOM50 — so the canopy comes the
    # Baden-Württemberg way, from the normalised surface model, using the same builder.
    Step("ndom-nrw", ["fetch_nrw.py", "--product", "ndom50"], "Geobasis NRW nDOM50 tiles", in_nordrhein_westfalen),
    Step("vegetation-ndom-nrw", ["build_vegetation_ndom.py"], "canopy from the NRW nDOM", in_nordrhein_westfalen),
    # ── buildings and drape, same split ──────────────────────────────────────────────────
    Step("lod2", ["fetch_bvv.py", "--product", "lod2"], "LoD2 CityGML tiles", in_bavaria),
    Step("lod2-bw", ["fetch_lgl_bw.py", "--product", "lod2"], "LGL LoD2 CityGML tiles", in_baden_wuerttemberg),
    Step("lod2-nrw", ["fetch_nrw.py", "--product", "lod2"], "Geobasis NRW LoD2 CityGML tiles", in_nordrhein_westfalen),
    Step("lod2-hh", ["fetch_hamburg.py", "--product", "lod2"], "Hamburg LGV LoD2 CityGML tiles", in_hamburg),
    # ⚠️ THE DRAPE MUST COME BEFORE THE BUILDINGS, AND IT USED TO COME AFTER.
    #
    # `build_lod2_mesh.py` measures every roof's colour from the DOP pixels inside its own LoD2
    # outline. With no drape on disk it does not fail — it writes `roofColour.state: "no-drape"`,
    # measures 0 roofs, and every building falls back to wearing its WALL colour. That is the
    # "one flat city" fault this repo already fixed once, when Garching and Tübingen arrived as
    # assets without the tools that make them.
    #
    # The old order was invisible for years because every AOI here had been built more than once:
    # the second run finds the drape the first run left behind. It only bites a NEW site, on its
    # first build, which is exactly when nobody has a previous version to compare against — FAU
    # Erlangen and Köln both shipped 0 of 9 013 and 0 of 5 928 roofs measured, and looked plausible.
    # After the reorder they measure 99.6% and 99.8%.
    Step("drape", ["fetch_dop20.py"], "DOP20 orthophoto drape, via the LDBV WMS", in_bavaria),
    Step("drape-bw", ["fetch_dop20_bw.py"], "DOP20 orthophoto drape, via the LGL WMS", in_baden_wuerttemberg),
    Step("drape-nrw", ["fetch_dop20_nrw.py"], "DOP orthophoto drape, via the Geobasis NRW WMS", in_nordrhein_westfalen),
    Step("drape-hh", ["fetch_dop20_hamburg.py"], "DOP20 orthophoto drape, via the Hamburg LGV WMS", in_hamburg),
    # Now that the photograph is on disk, the mesh can measure its roofs from it.
    Step("buildings", ["build_lod2_mesh.py"], "LoD2 building mesh"),
    # ── interiors, where an AOI actually has them ────────────────────────────────────────
    #
    # ⚠️ THESE WERE DROPPED IN THE FORK, AND THAT DECISION EXPIRED WITHOUT ANYONE NOTICING. The
    # note that stood here said the indoor steps were removed because none of it exists for OTH —
    # 29 mapped rooms in one building at Seybothstraße, zero at Prüfening, no NavigaTUM equivalent
    # — and that four scripts permanently reporting "nothing to do" reads like a broken pipeline.
    # All of that was true, and it stopped being the whole picture the moment Garching joined this
    # repository: its occupancy AND flow lenses are built from exactly these steps, and it arrived
    # carrying their OUTPUT while the tools that produce it stayed behind in the origin app. That
    # is the same fault that stranded `build_condition.py` — a site rendered from assets nobody
    # here could rebuild. Conditional now rather than absent, so a run says "not for this AOI"
    # instead of pretending there was never anything to do.
    # ⚠️ THE FIRST TWO HANG OFF `has_osm_indoor`, NOT `from_navigatum`. The room polygons come
    # from OpenStreetMap under ODbL; only the semantics and the bookings are TUM's. Gating the
    # geometry on the TUM feed is what used to take the explode view away with it.
    Step("osm-indoor", ["fetch_osm_indoor.py"], "OpenStreetMap indoor room polygons", has_osm_indoor),
    Step("navigatum", ["fetch_navigatum.py"], "NavigaTUM room catalogue", from_navigatum),
    Step("calendar", ["fetch_navigatum_calendar.py"], "real TUMonline bookings", from_navigatum),
    Step(
        "rooms",
        ["build_rooms.py"],
        "indoor room geometry and occupancy",
        has_osm_indoor,
        rooms_semantics_args,
    ),
    Step("flows", ["build_flows.py"], "cohort movements between bookings", flows_available),
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
                problems.append(f"{step.name}: {step.script[0]} imports '{head}', which is not there")

    if problems:
        print("preflight failed — nothing was downloaded:\n")
        for problem in problems:
            print(f"  {problem}")
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oth-regensburg")
    parser.add_argument("--from-step", default=None, help="start at this step")
    parser.add_argument("--only", default=None, help="run just this step")
    parser.add_argument("--list", action="store_true", help="list the steps and stop")
    args = parser.parse_args()

    aoi = json.loads((ROOT / "config" / "aoi" / f"{args.aoi}.json").read_text(encoding="utf-8"))

    # ⚠️ REFUSE AN EXCLUDED SITE RATHER THAN BUILDING IT QUIETLY. `config/release.json` is what a
    # public build is configured with; if it says this site does not ship, building its assets
    # anyway is how a stripped repository ends up with an unstripped `dist/`.
    if args.aoi in (_release().get("excludeAois") or []):
        print(
            f"'{args.aoi}' is listed in config/release.json -> excludeAois, so it does not ship.\n"
            f"Remove it from that list to build this site again.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    # ⚠️ WHICH STEPS APPLY IS A PROPERTY OF THE AOI, and `--list` must say so or it describes a
    # pipeline nobody runs. Listing every step for every site is how "Tübingen needs the LGL
    # fetcher" stays invisible until a rebuild fails.
    applicable = [step for step in STEPS if step.when(aoi)]
    skipped = [step for step in STEPS if not step.when(aoi)]

    if args.list:
        print(f"steps for {args.aoi}:")
        for step in applicable:
            print(f"  {step.name:<16} {step.what}   ({' '.join(step.script)})")
        if skipped:
            print("\nnot for this area of interest:")
            for step in skipped:
                print(f"  {step.name:<16} {step.what}")
        return

    preflight()

    steps = applicable
    if args.only:
        steps = [s for s in STEPS if s.name == args.only]
        if not steps:
            raise SystemExit(f"no step '{args.only}' — try --list")
    elif args.from_step:
        names = [s.name for s in applicable]
        if args.from_step not in names:
            raise SystemExit(f"no step '{args.from_step}' for {args.aoi} — try --list")
        steps = applicable[names.index(args.from_step) :]

    started = time.time()
    for index, step in enumerate(steps, start=1):
        print(f"\n{'=' * 72}\n[{index}/{len(steps)}] {step.name} — {step.what}\n{'=' * 72}")
        step_started = time.time()
        result = subprocess.run(
            [
                sys.executable,
                str(HERE / step.script[0]),
                *step.script[1:],
                "--aoi",
                args.aoi,
                *step.extra(aoi),
            ],
            # ⚠️ The repo ROOT, not this directory. Steps take repo-root-relative defaults
            # (`public/terrain`, `data/raw/osm/...`), so running them from `tools/geodata` sent
            # `build_landuse.py` looking for `tools/geodata/public/terrain` and reporting the
            # heightmap missing — blaming the previous step for something it had done correctly.
            cwd=ROOT,
            # ⚠️ Windows console encoding, and it is not cosmetic: on a cp1252 console the
            # `verify` step CRASHED with UnicodeEncodeError on the 'Δ' it prints in its control-
            # point table — after checks A, B and C had all passed. A registration GATE that
            # fails because of a character in its own report is the worst possible failure mode:
            # it looks exactly like "the model is in the wrong place". Forcing UTF-8 here fixes
            # every step at once rather than one print statement at a time.
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        if result.returncode != 0:
            print(f"\nstep '{step.name}' failed with exit code {result.returncode} — stopping")
            sys.exit(result.returncode)
        print(f"\n[{step.name}] done in {time.time() - step_started:.0f}s")

    print(f"\n{'=' * 72}\npipeline complete in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()

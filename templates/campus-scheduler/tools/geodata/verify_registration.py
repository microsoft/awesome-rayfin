"""Prove the terrain model is where it claims to be.

PLAN rule 1. This is the step that earns the right to draw anything on top of the terrain: rooms
and utilisation figures over a misregistered campus are worse than no map at all, because they look
authoritative.

⚠️ **This check is not decoration — it has already caught real faults.** In the app this pipeline
came from, the AOI config carried an `Oberstdorf` coordinate 4.6 km from the town; nothing in the
code could tell, because the pipeline happily built a heightmap and sampled that point. In *this*
project the same class of error appeared during Phase 0 setup, when a name search returned a
student fraternity instead of Schloss Hohentübingen.

⚠️ **The evidence has to suit the terrain.** The original version of this gate demanded at least
five published summit elevations inside the core, which is a fine test for an Alpine box and a
useless one for a research campus on the Münchner Schotterebene: Garching's core contains exactly
zero `ele`-tagged nodes, and 20 m of relief across two kilometres means that even a two-kilometre
horizontal error would still sample about 475 m. Demanding summits here would have meant either
failing forever or — far worse — quietly deleting the gate.

So the gate is a *composite*, and it is deliberately harder to satisfy by accident than by being
correct. Each check below is independent, and the run fails if any hard check fails or if too few
sources of evidence were available to prove anything at all:

  A. **Coverage** — the mosaic actually covers the box. Catches a wrong or partial tile set.
  B. **Plausibility** — measured elevations fall inside the range the AOI declares. Catches
     fetching an entirely different region.
  C. **Focus places** — every named place is inside the grid and on plausible ground. Catches an
     AOI drawn around the wrong thing, which is the fault that started all of this.
  D. **Control points** — published elevations, sampled from whichever tier covers them.
  E. **Cross-source agreement** — the seam offset between the state survey's airborne-laser
     bare-earth model and Copernicus's satellite surface model, measured on open ground. This is
     the strongest check available on flat terrain: two entirely independent surveys, different
     sensors, different datums, different decades. Agreement to a few decimetres is not something
     a misplaced grid produces.

     ⚠️ THE AUTHORITY IS READ FROM THE AOI, NOT NAMED HERE. This check used to print "LDBV laser
     vs Copernicus radar" for every site, so Köln's registration proof — the document that says
     this twin is correctly georeferenced — credited the BAVARIAN survey for Nordrhein-Westfalen's
     data. The numbers were right and the sentence was false, which is the shape of provenance bug
     this project is least able to afford.
  F. **Summits** — the original distribution test, run automatically wherever a box happens to
     contain enough published peaks.

Usage
  python tools/geodata/verify_registration.py --aoi garching
"""

from __future__ import annotations

import argparse
import json
import sys

import numpy as np

from aoi import cache_dir, load_aoi, terrain_dir
from utm import wgs84_to_utm32

#: A gridded terrain samples a convex summit slightly low, and published summit elevations are
#: themselves rounded. Anything inside this band is agreement, not error.
EXPECTED_SUMMIT_BIAS_M = (-12.0, 2.0)

#: Beyond this, a residual is a different mountain rather than a sampling artefact.
OUTLIER_M = 60.0

#: How many independent checks must actually produce evidence. Below this the gate is not
#: "passing", it is uninformed — and an uninformed gate that reports success is worse than none.
MIN_EVIDENCE = 4


class Terrain:
    """A generated heightmap, with the sampling maths the check needs."""

    def __init__(self, aoi_id: str, name: str = "heightmap") -> None:
        directory = terrain_dir({"id": aoi_id})
        meta_path = directory / f"{name}.json"
        if not meta_path.exists():
            raise SystemExit(f"{meta_path} not found — run tools/geodata/build_terrain.py first")
        self.meta = json.loads(meta_path.read_text(encoding="utf-8"))
        raw = (directory / self.meta["file"]).read_bytes()

        self.width = int(self.meta["width"])
        self.height = int(self.meta["height"])
        self.resolution = float(self.meta["resolutionM"])
        self.origin_e = float(self.meta["origin"]["easting"])
        self.origin_n = float(self.meta["origin"]["northing"])
        self.top_n = self.origin_n + self.height * self.resolution

        quantised = np.frombuffer(raw, dtype="<u2").reshape(self.height, self.width)
        self.grid = (
            quantised.astype(np.float32) * float(self.meta["heightScale"])
            + float(self.meta["heightMinM"])
        )

    def contains(self, lat: float, lon: float) -> bool:
        easting, northing = wgs84_to_utm32(lon, lat)
        col = (easting - self.origin_e) / self.resolution
        row = (self.top_n - northing) / self.resolution
        return 0 <= col < self.width - 1 and 0 <= row < self.height - 1

    def sample(self, lat: float, lon: float) -> float:
        """Bilinear elevation at a geographic point."""
        easting, northing = wgs84_to_utm32(lon, lat)
        col = (easting - self.origin_e) / self.resolution
        row = (self.top_n - northing) / self.resolution
        col = float(np.clip(col, 0, self.width - 1.001))
        row = float(np.clip(row, 0, self.height - 1.001))

        c0, r0 = int(col), int(row)
        fc, fr = col - c0, row - r0
        top = self.grid[r0, c0] * (1 - fc) + self.grid[r0, c0 + 1] * fc
        bottom = self.grid[r0 + 1, c0] * (1 - fc) + self.grid[r0 + 1, c0 + 1] * fc
        return float(top * (1 - fr) + bottom * fr)

    def sample_max(self, lat: float, lon: float, radius_m: float) -> float:
        """Highest elevation within a radius — the fair comparison for a published summit.

        A peak node is placed by hand and a metre or two of horizontal slop is normal, so comparing
        a published summit against the single cell under its node measures the placement of the
        node as much as the registration of the model.
        """
        easting, northing = wgs84_to_utm32(lon, lat)
        col = (easting - self.origin_e) / self.resolution
        row = (self.top_n - northing) / self.resolution
        span = max(1, int(round(radius_m / self.resolution)))
        c0 = int(np.clip(col - span, 0, self.width - 1))
        c1 = int(np.clip(col + span + 1, 1, self.width))
        r0 = int(np.clip(row - span, 0, self.height - 1))
        r1 = int(np.clip(row + span + 1, 1, self.height))
        return float(self.grid[r0:r1, c0:c1].max())


def published_peaks(aoi_id: str) -> list[dict]:
    """OSM peaks with an `ele` tag, from the cached Overpass response."""
    path = cache_dir("osm", aoi_id) / "overpass_places.json"
    if not path.exists():
        raise SystemExit(f"{path} not found — run tools/geodata/resolve_places.py first")
    data = json.loads(path.read_text(encoding="utf-8"))

    peaks = []
    for element in data["elements"]:
        tags = element.get("tags", {})
        if tags.get("natural") != "peak" or "ele" not in tags:
            continue
        raw = str(tags["ele"]).replace(",", ".").split()
        try:
            elevation = float(raw[0])
        except (ValueError, IndexError):
            continue
        if element["type"] != "node":
            continue
        peaks.append(
            {
                "name": tags.get("name", "(unnamed)"),
                "lat": element["lat"],
                "lon": element["lon"],
                "publishedM": elevation,
            }
        )
    return peaks


def describe(residuals: np.ndarray) -> dict[str, float]:
    return {
        "count": int(residuals.size),
        "median": float(np.median(residuals)),
        "mean": float(np.mean(residuals)),
        "stdev": float(np.std(residuals)),
        "min": float(residuals.min()),
        "max": float(residuals.max()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oth-regensburg")
    parser.add_argument("--summit-radius", type=float, default=12.0)
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    rules = cfg.get("verification", {})
    tolerance = float(rules.get("toleranceM", 3.0))

    core = Terrain(cfg["id"])
    directory = terrain_dir(cfg)
    print(
        f"terrain: {core.width} x {core.height} at {core.resolution} m, "
        f"{core.meta['heightMinM']:.1f} .. {core.meta['heightMaxM']:.1f} m"
    )

    failures: list[str] = []
    evidence = 0

    # ── A. Coverage ───────────────────────────────────────────────────────────────────────
    print("\n=== A. coverage ===")
    minimum = float(rules.get("minCoveragePct", 99.0))
    coverage = float(core.meta.get("coveragePct", 0.0))
    print(f"  measured cells {coverage:.2f}%   (need >= {minimum:.2f}%)   "
          f"{'OK' if coverage >= minimum else 'FAIL'}")
    if coverage < minimum:
        failures.append(f"coverage {coverage:.2f}% is below the required {minimum:.2f}%")
    else:
        evidence += 1

    # ── B. Plausibility ───────────────────────────────────────────────────────────────────
    print("\n=== B. elevation plausibility ===")
    declared = cfg["elevationRangeM"]
    lo, hi = float(core.meta["heightMinM"]), float(core.meta["heightMaxM"])
    inside = declared["min"] <= lo and hi <= declared["max"]
    print(
        f"  measured {lo:.1f} .. {hi:.1f} m   declared {declared['min']} .. {declared['max']} m"
        f"   {'OK' if inside else 'FAIL'}"
    )
    if not inside:
        failures.append(
            f"measured range {lo:.1f}..{hi:.1f} m falls outside the declared "
            f"{declared['min']}..{declared['max']} m — wrong region, or the AOI is mis-declared"
        )
    else:
        evidence += 1

    # ── C. Focus places ───────────────────────────────────────────────────────────────────
    print("\n=== C. focus places ===")
    places = cfg.get("focusPlaces", [])
    place_failures = 0
    for place in places:
        if not core.contains(place["lat"], place["lon"]):
            failures.append(f"focus place '{place['id']}' is outside the terrain grid")
            place_failures += 1
            print(f"  {place['name']:<40} OUTSIDE THE GRID")
            continue
        ground = core.sample(place["lat"], place["lon"])
        ok = declared["min"] <= ground <= declared["max"]
        print(f"  {place['name']:<40} ground {ground:7.1f} m   {'OK' if ok else 'IMPLAUSIBLE'}")
        if not ok:
            failures.append(f"focus place '{place['id']}' sits at an implausible {ground:.1f} m")
            place_failures += 1
    if places and place_failures == 0:
        evidence += 1

    # ── D. Control points ─────────────────────────────────────────────────────────────────
    # Sampled from whichever tier covers them. On a flat AOI the published references tend to sit
    # in the surrounding shell rather than in the core, which is fine: they still prove the model
    # describes this place and not another one.
    controls = rules.get("controlPoints", [])
    if controls:
        print("\n=== D. control points vs published elevation ===")
        shell: Terrain | None = None
        if (directory / "shell.json").exists():
            try:
                shell = Terrain(cfg["id"], "shell")
            except SystemExit:
                shell = None

        checked = 0
        for point in controls:
            tier, model = "core", None
            if core.contains(point["lat"], point["lon"]):
                model = core.sample(point["lat"], point["lon"])
            elif shell is not None and shell.contains(point["lat"], point["lon"]):
                tier, model = "shell", shell.sample(point["lat"], point["lon"])
            if model is None:
                print(f"  {point['name']:<40} not covered by either tier — skipped")
                continue
            delta = model - float(point["publishedM"])
            # The shell is a SURFACE model: it includes canopy and buildings, so a point in a
            # built-up or wooded cell reads high by design. Its tolerance is looser for that
            # reason, not to make the test easier to pass.
            limit = tolerance if tier == "core" else float(rules.get("shellToleranceM", 12.0))
            ok = abs(delta) <= limit
            checked += 1
            print(
                f"  {point['name']:<40} {tier:<5} model {model:7.2f}   "
                f"published {float(point['publishedM']):7.2f}   Δ {delta:+6.2f} m   "
                f"{'OK' if ok else 'FAIL'}"
            )
            if not ok:
                failures.append(
                    f"control point '{point['name']}' is off by {delta:+.2f} m (limit {limit} m)"
                )
        if checked:
            evidence += 1

    # ── E. Cross-source agreement ─────────────────────────────────────────────────────────
    # The core comes from whichever state surveyed it; only the shell is always Copernicus. Naming
    # the wrong authority in a registration proof is a false statement about where the data came
    # from, so the label is built from the AOI rather than written here.
    core_authority = str((cfg.get("geobasis") or {}).get("authority", "state survey"))
    print(f"\n=== E. cross-source agreement ({core_authority} laser vs Copernicus radar) ===")
    shell_meta_path = directory / "shell.json"
    if shell_meta_path.exists():
        shell_meta = json.loads(shell_meta_path.read_text(encoding="utf-8"))
        offset = float(shell_meta.get("seamOffsetM", 0.0))
        limit = float(rules.get("maxSeamOffsetM", 3.0))
        ok = abs(offset) <= limit
        print(
            f"  seam offset on open ground {offset:+.2f} m   (limit ±{limit:.2f} m)   "
            f"{'OK' if ok else 'FAIL'}"
        )
        print("  two independent surveys — different sensors, datums and decades — agreeing at")
        print("  this level is the strongest registration evidence available on flat ground.")
        if not ok:
            failures.append(
                f"seam offset {offset:+.2f} m exceeds ±{limit:.2f} m — the two tiers disagree "
                f"about where the ground is"
            )
        else:
            evidence += 1
    else:
        print("  no shell built — skipped")

    # ── F. Summits ────────────────────────────────────────────────────────────────────────
    peaks = [p for p in published_peaks(cfg["id"]) if core.contains(p["lat"], p["lon"])]
    min_peaks = int(rules.get("minPeaks", 5))
    if len(peaks) >= min_peaks:
        print(f"\n=== F. published summits inside the core ({len(peaks)}) ===")
        residuals = np.array(
            [
                core.sample_max(p["lat"], p["lon"], args.summit_radius) - p["publishedM"]
                for p in peaks
            ]
        )
        stats = describe(residuals)
        print(
            f"  median {stats['median']:+.1f} m   mean {stats['mean']:+.1f} m   "
            f"stdev {stats['stdev']:.1f} m   range {stats['min']:+.1f} .. {stats['max']:+.1f} m"
        )
        low, high = EXPECTED_SUMMIT_BIAS_M
        if not (low <= stats["median"] <= high):
            failures.append(
                f"summit residual median {stats['median']:+.1f} m is outside the expected "
                f"{low:+.1f}..{high:+.1f} m band"
            )
        else:
            evidence += 1
        for peak, residual in zip(peaks, residuals):
            if abs(residual) > OUTLIER_M:
                failures.append(f"summit '{peak['name']}' is off by {float(residual):+.1f} m")
    else:
        print("\n=== F. published summits inside the core ===")
        print(f"  {len(peaks)} found, {min_peaks} needed — skipped.")
        print("  Expected on flat terrain; checks A-E carry the proof here.")

    # ── Verdict ───────────────────────────────────────────────────────────────────────────
    print(f"\n{'=' * 72}")
    if evidence < MIN_EVIDENCE:
        failures.append(
            f"only {evidence} of {MIN_EVIDENCE} required independent checks produced evidence — "
            f"this run proves too little to be called a pass"
        )

    if failures:
        print(f"REGISTRATION FAILED ({len(failures)} problem(s)):\n")
        for problem in failures:
            print(f"  - {problem}")
        print("\nNothing further should be built on this terrain until it is fixed.")
        sys.exit(1)

    print(f"registration verified — {evidence} independent checks agree")


if __name__ == "__main__":
    main()

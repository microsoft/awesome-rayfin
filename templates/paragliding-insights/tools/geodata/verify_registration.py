"""Prove the terrain model is where it claims to be.

PLAN §7 phase 1 step 7. This is the step that earns the right to draw anything on top of the
terrain: a flight track over a misregistered mountain is worse than no map at all, because it looks
authoritative.

⚠️ **This check is not decoration — it has already caught a real fault.** The AOI config carried an
`Oberstdorf` coordinate 4.6 km from the town. Nothing in the code could tell: the pipeline happily
built a heightmap, sampled that point, and reported 1115 m. The only thing that exposed it was
comparing that number against an elevation somebody else had published (813 m). Hence this script,
and hence its shape:

  1. **Every published elevation in the box, not a spot-check.** Every OSM `natural=peak` node
     carrying an `ele` tag inside the core is sampled against the model — typically a few hundred
     independent points placed by people who have never seen this pipeline.
  2. **The residuals are read as a distribution, not one at a time.** A registration error shows up
     as a *biased* residual (the model sits consistently high, or low, or skews with easting). A
     scatter of small residuals with a near-zero median is what correct-but-imprecise looks like.
  3. **A longitudinal profile**, Oberstdorf → Nebelhorn, so the shape between the endpoints is
     checked and not just the endpoints themselves.

A summit is the hardest possible test for a gridded model: it is the one place where the terrain is
locally convex, so a 4 m cell inevitably samples slightly *below* the true peak. A small negative
median bias is therefore expected and correct. A large one, or a positive one, is not.

Usage
  python tools/geodata/verify_registration.py
  python tools/geodata/verify_registration.py --profile-samples 400
"""

from __future__ import annotations

import argparse
import json
import math
import sys

import numpy as np

from aoi import cache_dir, load_aoi, terrain_dir
from utm import wgs84_to_utm32

#: A gridded terrain samples a convex summit slightly low, and published summit elevations are
#: themselves rounded. Anything inside this band is agreement, not error.
EXPECTED_SUMMIT_BIAS_M = (-12.0, 2.0)

#: Beyond this, a residual is a different mountain rather than a sampling artefact.
OUTLIER_M = 60.0


class Terrain:
    """The generated heightmap, with the sampling maths the check needs."""

    def __init__(self, aoi_id: str, name: str = "heightmap_4m") -> None:
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
        node as much as the registration of the model. Taking the local maximum removes that.
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
        "p10": float(np.percentile(residuals, 10)),
        "p90": float(np.percentile(residuals, 90)),
        "min": float(residuals.min()),
        "max": float(residuals.max()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument("--profile-samples", type=int, default=240)
    parser.add_argument("--summit-radius", type=float, default=12.0)
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    terrain = Terrain(cfg["id"])
    print(
        f"terrain: {terrain.width} x {terrain.height} at {terrain.resolution} m, "
        f"{terrain.meta['heightMinM']:.1f} .. {terrain.meta['heightMaxM']:.1f} m"
    )

    failures: list[str] = []

    # ── 1. Named places and flying sites, against their published elevations ───────────────
    print("\n=== named places vs published elevation ===")
    named: list[tuple[str, float, float, float]] = []
    for place in cfg.get("focusPlaces", []):
        published = None
        for peak in published_peaks(cfg["id"]):
            if peak["name"] == place["name"]:
                published = peak["publishedM"]
                break
        if published is not None:
            named.append((place["name"], place["lat"], place["lon"], published))
    for site in cfg.get("flyingSites", []):
        if site.get("publishedEleM"):
            named.append((site["name"], site["lat"], site["lon"], float(site["publishedEleM"])))

    for name, lat, lon, published in named:
        if not terrain.contains(lat, lon):
            failures.append(f"{name} is outside the terrain grid")
            print(f"  {name:<32} OUTSIDE THE GRID")
            continue
        modelled = terrain.sample(lat, lon)
        print(f"  {name:<32} model {modelled:7.1f} m   published {published:7.1f} m   Δ {modelled - published:+6.1f} m")

    # ── 2. Every published peak in the box ────────────────────────────────────────────────
    print("\n=== published peaks inside the core ===")
    inside = [p for p in published_peaks(cfg["id"]) if terrain.contains(p["lat"], p["lon"])]
    if len(inside) < 5:
        failures.append(f"only {len(inside)} published peaks inside the AOI — too few to prove anything")
    else:
        residuals = np.array(
            [
                terrain.sample_max(p["lat"], p["lon"], args.summit_radius) - p["publishedM"]
                for p in inside
            ]
        )
        stats = describe(residuals)
        print(f"  {stats['count']} peaks compared (local max within {args.summit_radius:.0f} m)")
        print(f"  median  {stats['median']:+7.2f} m      mean {stats['mean']:+7.2f} m")
        print(f"  p10     {stats['p10']:+7.2f} m      p90  {stats['p90']:+7.2f} m")
        print(f"  spread  {stats['stdev']:7.2f} m      range {stats['min']:+.1f} .. {stats['max']:+.1f} m")

        low, high = EXPECTED_SUMMIT_BIAS_M
        if not (low <= stats["median"] <= high):
            failures.append(
                f"median summit residual {stats['median']:+.2f} m is outside the expected "
                f"{low:+.0f}..{high:+.0f} m band — the model is not registered where it claims"
            )

        outliers = [
            (p, float(r)) for p, r in zip(inside, residuals) if abs(r) > OUTLIER_M
        ]
        if outliers:
            print(f"\n  {len(outliers)} peaks differ by more than {OUTLIER_M:.0f} m:")
            for peak, residual in sorted(outliers, key=lambda x: -abs(x[1]))[:10]:
                print(f"    {peak['name']:<30} Δ {residual:+7.1f} m  ({peak['lat']:.5f}, {peak['lon']:.5f})")
            # A handful of outliers among hundreds is OSM data quality, not registration. A large
            # share of them is the model being in the wrong place.
            share = len(outliers) / len(inside)
            print(f"    -> {share * 100:.1f}% of peaks")
            if share > 0.15:
                failures.append(
                    f"{share * 100:.0f}% of published peaks differ by more than {OUTLIER_M:.0f} m"
                )

        # A registration error usually skews with position. A genuine sampling bias does not.
        eastings = np.array([wgs84_to_utm32(p["lon"], p["lat"])[0] for p in inside])
        northings = np.array([wgs84_to_utm32(p["lon"], p["lat"])[1] for p in inside])
        for axis, values in (("easting", eastings), ("northing", northings)):
            if values.std() > 0:
                correlation = float(np.corrcoef(values, residuals)[0, 1])
                print(f"  residual vs {axis}: r = {correlation:+.3f}")
                if abs(correlation) > 0.5:
                    failures.append(
                        f"residuals correlate with {axis} (r={correlation:+.2f}) — "
                        "the grid is probably shifted or scaled"
                    )

    # ── 3. Longitudinal profile ───────────────────────────────────────────────────────────
    places = {p["id"]: p for p in cfg.get("focusPlaces", [])}
    start, end = places.get("oberstdorf"), places.get("nebelhorn")
    if start and end:
        print("\n=== longitudinal profile: Oberstdorf -> Nebelhorn ===")
        e0, n0 = wgs84_to_utm32(start["lon"], start["lat"])
        e1, n1 = wgs84_to_utm32(end["lon"], end["lat"])
        distance = math.hypot(e1 - e0, n1 - n0)
        fractions = np.linspace(0, 1, args.profile_samples)
        heights = np.array(
            [
                terrain.sample(
                    start["lat"] + (end["lat"] - start["lat"]) * f,
                    start["lon"] + (end["lon"] - start["lon"]) * f,
                )
                for f in fractions
            ]
        )
        print(f"  {distance / 1000:.2f} km, {args.profile_samples} samples")
        print(f"  start {heights[0]:.1f} m  ->  end {heights[-1]:.1f} m   (gain {heights[-1] - heights[0]:+.1f} m)")
        print(f"  lowest {heights.min():.1f} m at {fractions[heights.argmin()] * distance / 1000:.2f} km")
        print(f"  highest {heights.max():.1f} m at {fractions[heights.argmax()] * distance / 1000:.2f} km")

        # A profile out of a real mountain is continuous. A tile seam or a misplaced tile shows up
        # as a step far larger than any real slope over 30 m of ground.
        step = float(np.abs(np.diff(heights)).max())
        spacing = distance / (args.profile_samples - 1)
        print(f"  largest step between samples: {step:.1f} m over {spacing:.0f} m of ground")
        if step > spacing * 2.0:
            failures.append(
                f"a {step:.0f} m step over {spacing:.0f} m of ground — that is a seam, not a slope"
            )

        # Sanity: the profile must actually climb the mountain.
        if heights[-1] - heights[0] < 1000:
            failures.append("the profile gains less than 1000 m — the endpoints are not where they should be")

        bar_max = heights.max()
        for index in range(0, args.profile_samples, max(1, args.profile_samples // 20)):
            filled = int(heights[index] / bar_max * 48)
            print(f"  {fractions[index] * distance / 1000:5.2f} km {heights[index]:7.1f} m |{'#' * filled}")

    print()
    if failures:
        print("REGISTRATION CHECK FAILED")
        for failure in failures:
            print(f"  - {failure}")
        sys.exit(1)
    print("registration check passed")


if __name__ == "__main__":
    main()

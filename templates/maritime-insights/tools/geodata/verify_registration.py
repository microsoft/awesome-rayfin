"""The Phase 1 gate: fail the build if the terrain is not where it claims to be.

PLAN §4.4. This is a gate rather than a report, and the reason is specific to this app: a coverage
shadow drawn over a misregistered coast still looks authoritative. A wrong map that announces
nothing is worse than no map.

Four checks, in ascending order of how much they can prove:

1. **Focus places** sit on plausible ground. Weak on its own — it only catches gross errors — but
   free, and it is what caught a 4.6 km coordinate error in a sibling repo.
2. **Published light height.** ⚠️ A seamark's `height` tag is the focal plane above *sea level*,
   not the ground elevation, so this can only ever be a BOUND: the ground under a light must be
   below its focal height and above the water. Stating it as an equality would be inventing a
   check.
3. 🔴 **The coastline.** Independently surveyed by OpenStreetMap, and it is the zero contour of a
   bare-earth model — so sampling the heightmap along it must straddle zero. A horizontal shift,
   a mirrored raster or a wrong origin all break this immediately, and none of them break check 1.
4. 🔴 **The AIS witness** — ships are in the water, so any track over rendered land is a defect.
   Strongest of the four and it costs nothing, but it needs Phase 3 data. Until then it reports as
   unavailable rather than passing silently, because a check that quietly does nothing is worse
   than a check that is missing.

Usage
  python tools/geodata/verify_registration.py
  python tools/geodata/verify_registration.py --aoi kieler-foerde
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
from pathlib import Path

import numpy as np

from aoi import cache_dir, load_aoi, terrain_dir
from resolve_places import overpass
from utm import wgs84_to_utm32

#: How far the sampled coastline may sit from zero before the registration is suspect. The Baltic
#: is tideless to ~0.2 m and OSM's coastline is drawn from imagery rather than surveyed to the
#: centimetre, so this is loose on purpose — it is testing for a shift of metres, not for accuracy.
COASTLINE_TOLERANCE_M = 3.0

#: How far inland an AIS position may sit before the terrain is suspect, at the 90th percentile.
#:
#: 🔴 The first version of this check used a *share* of positions on land and justified it as
#: moorings. **Measurement said otherwise**: 6.0 % of positions from vessels doing more than eight
#: knots also land on "land", and a moving ship is not moored. What the data actually shows is a
#: boundary-precision effect — the on-land positions sit a median of **4 m** inland, p90 **27 m**,
#: with 91.3 % within 40 m of water, because the mask is a 4 m raster thresholded at 0.05 m and
#: quay-lined basins, the lock approaches and a 100 m canal are exactly where that is least sharp.
#:
#: So the share is the wrong statistic and the DISTANCE is the right one. A mirrored or shifted
#: terrain does not put traffic a few metres inland; it puts it hundreds of metres to kilometres
#: inland, which this threshold catches and moorings never trip.
AIS_INLAND_P90_M = 120.0


class Heightmap:
    def __init__(self, aoi_dir: Path):
        descriptors = sorted(aoi_dir.glob("heightmap_*m.json"))
        if not descriptors:
            raise SystemExit(f"no heightmap in {aoi_dir} — run build_terrain.py first")
        self.meta = json.loads(descriptors[0].read_text(encoding="utf-8"))
        blob = (aoi_dir / self.meta["file"]).read_bytes()
        # Detect gzip by content, never by extension — see build_terrain.py.
        if blob[:2] == b"\x1f\x8b":
            blob = gzip.decompress(blob)
        expected = self.meta["width"] * self.meta["height"] * 2
        if len(blob) != expected:
            raise SystemExit(f"heightmap is {len(blob)} bytes, expected {expected}")
        self.raw = np.frombuffer(blob, dtype="<u2").reshape(
            self.meta["height"], self.meta["width"]
        )
        mask_name = self.meta.get("landMaskFile")
        self.land = None
        if mask_name and (aoi_dir / mask_name).exists():
            mask = gzip.decompress((aoi_dir / mask_name).read_bytes())
            self.land = np.frombuffer(mask, dtype=np.uint8).reshape(self.raw.shape).astype(bool)

    def sample(self, lat: float, lon: float) -> float | None:
        easting, northing = wgs84_to_utm32(lon, lat)
        res = self.meta["resolutionM"]
        col = int((easting - self.meta["origin"]["easting"]) / res)
        row = int((self.meta["origin"]["northing"] + self.meta["height"] * res - northing) / res)
        if not (0 <= col < self.meta["width"] and 0 <= row < self.meta["height"]):
            return None
        return self.meta["heightMinM"] + float(self.raw[row, col]) * self.meta["heightScale"]


def coastline(cfg: dict) -> list[tuple[float, float]]:
    """Coastline vertices inside the core bbox, cached."""
    path = cache_dir("osm", cfg["id"]) / "coastline.json"
    if not path.exists():
        b = cfg["bbox"]
        query = (f'[out:json][timeout:180];way["natural"="coastline"]'
                 f'({b["south"]},{b["west"]},{b["north"]},{b["east"]});out geom;')
        # ⚠️ This used to open one hard-coded mirror directly and die on the first 504, which is
        # what it did the first time a second AOI needed a fresh coastline. `overpass()` already
        # carries the mirror list, the retry loop and — importantly — the rule that a zero-element
        # answer is a failure rather than a fact. There is no reason for a second, weaker client.
        payload = overpass(query)
        path.write_text(json.dumps(payload), encoding="utf-8")
    payload = json.loads(path.read_text(encoding="utf-8"))
    points: list[tuple[float, float]] = []
    b = cfg["bbox"]
    for way in payload["elements"]:
        for node in way.get("geometry", []):
            # `out geom` returns the WHOLE geometry of any way that merely intersects the bbox,
            # so clip here rather than trusting the query.
            if b["south"] <= node["lat"] <= b["north"] and b["west"] <= node["lon"] <= b["east"]:
                points.append((node["lat"], node["lon"]))
    return points


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    hm = Heightmap(terrain_dir(cfg))
    print(f"heightmap {hm.meta['width']} x {hm.meta['height']} at {hm.meta['resolutionM']} m, "
          f"{hm.meta['heightMinM']:.2f} .. {hm.meta['heightMaxM']:.2f} m, "
          f"coverage {hm.meta.get('coverage', 0) * 100:.2f}%")

    failures: list[str] = []

    print("\n1. focus places on plausible ground")
    for place in cfg["focusPlaces"]:
        ground = hm.sample(place["lat"], place["lon"])
        if ground is None:
            failures.append(f"{place['name']} falls outside the heightmap")
            print(f"   FAIL {place['name']:<22} outside the grid")
            continue
        ok = -1.0 <= ground <= 80.0
        print(f"   {'ok  ' if ok else 'FAIL'} {place['name']:<22} {ground:7.2f} m")
        if not ok:
            failures.append(f"{place['name']} sampled at {ground:.2f} m")

    print("\n2. published light heights (a bound, not an equality)")
    for light in cfg["registrationChecks"].get("publishedLightHeights", []):
        ground = hm.sample(light["lat"], light["lon"])
        if ground is None:
            failures.append(f"light {light['name']} outside the heightmap")
            continue
        ok = -1.0 <= ground <= light["heightM"]
        print(f"   {'ok  ' if ok else 'FAIL'} {light['name']:<22} ground {ground:6.2f} m "
              f"vs published focal height {light['heightM']} m")
        if not ok:
            failures.append(f"light {light['name']}: ground {ground:.2f} m")

    print("\n3. the coastline straddles zero")
    points = coastline(cfg)
    samples = np.array([v for v in (hm.sample(lat, lon) for lat, lon in points) if v is not None])
    if samples.size < 100:
        failures.append(f"only {samples.size} coastline samples landed on the grid")
        print(f"   FAIL only {samples.size} samples")
    else:
        median = float(np.median(samples))
        p10, p90 = (float(x) for x in np.percentile(samples, [10, 90]))
        ok = abs(median) <= COASTLINE_TOLERANCE_M
        print(f"   {'ok  ' if ok else 'FAIL'} {samples.size} vertices, median {median:+.2f} m, "
              f"p10 {p10:+.2f}, p90 {p90:+.2f} (tolerance ±{COASTLINE_TOLERANCE_M} m)")
        if not ok:
            failures.append(f"coastline median elevation {median:+.2f} m")
        if hm.land is not None:
            print(f"   land/sea split from the mask: sea {(1 - hm.land.mean()) * 100:.1f}%, "
                  f"land {hm.land.mean() * 100:.1f}%")

    print("\n4. AIS witness (any track on land means the terrain is wrong)")
    tracks_meta_path = terrain_dir(cfg) / "tracks.json"
    ais_share: float | None = None
    if not tracks_meta_path.exists():
        print("   UNAVAILABLE — no vessel tracks built yet. Not a pass.")
    elif hm.land is None:
        print("   UNAVAILABLE — no land mask. Not a pass.")
    else:
        tracks_meta = json.loads(tracks_meta_path.read_text(encoding="utf-8"))
        blob = gzip.decompress((terrain_dir(cfg) / tracks_meta["file"]).read_bytes())
        n = tracks_meta["pointCount"]
        xs = np.frombuffer(blob, dtype="<i2", count=n, offset=0).astype(np.float64)
        zs = np.frombuffer(blob, dtype="<i2", count=n, offset=2 * n).astype(np.float64)
        easting = xs + tracks_meta["originUtm"]["easting"]
        northing = tracks_meta["originUtm"]["northing"] - zs

        res = hm.meta["resolutionM"]
        col = ((easting - hm.meta["origin"]["easting"]) / res).astype(np.int64)
        row = ((hm.meta["origin"]["northing"] + hm.meta["height"] * res - northing)
               / res).astype(np.int64)
        inside = ((col >= 0) & (col < hm.meta["width"])
                  & (row >= 0) & (row < hm.meta["height"]))
        on_land = hm.land[row[inside], col[inside]]
        ais_share = float(on_land.mean())

        # Distance from water for the positions that landed on land. `distance_transform_edt`
        # measures, for every land cell, how far it is from the nearest water cell.
        from scipy import ndimage  # local import: only this check needs it

        inland_m = ndimage.distance_transform_edt(hm.land) * res
        landed = inland_m[row[inside][on_land], col[inside][on_land]]
        p90 = float(np.percentile(landed, 90)) if landed.size else 0.0
        median = float(np.median(landed)) if landed.size else 0.0
        ok = p90 <= AIS_INLAND_P90_M
        print(f"   {'ok  ' if ok else 'FAIL'} {int(inside.sum()):,} positions in the grid, "
              f"{int(on_land.sum()):,} on a land cell ({ais_share * 100:.2f} %)")
        print(f"        those sit median {median:.0f} m inland, p90 {p90:.0f} m "
              f"(threshold p90 ≤ {AIS_INLAND_P90_M:.0f} m)")
        if not ok:
            failures.append(f"AIS positions reach {p90:.0f} m inland at p90")

    print()
    if failures:
        for failure in failures:
            print(f"FAILED: {failure}")
        print(f"\nregistration gate FAILED ({len(failures)} checks)")
        return 1
    print("registration gate PASSED")
    (terrain_dir(cfg) / "registration.json").write_text(
        json.dumps({"passedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "coastlineSamples": int(samples.size),
                    "coastlineMedianM": round(float(np.median(samples)), 3),
                    "aisPositionsOnLandShare": (None if ais_share is None
                                                else round(ais_share, 5))}, indent=2),
        encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())

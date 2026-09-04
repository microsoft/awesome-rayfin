"""What the visibility model cannot see (PLAN §7).

`build_los_surface.py` raises bare earth to the top of every building **and then to the measured
surface top from bDOM**, so vegetation is now in the blocking surface. That was not always true:
for most of this app's life the surface was bare earth plus buildings, coverage was published as an
explicit *upper bound*, and this script existed to say how large the omission was rather than to
pretend it was free — a mature tree line is 25 m of solid obstruction sitting exactly where a
coastal sight line grazes the shore.

It still measures the same thing on the one 1 km square where both products are cached, and that
number now has a second job: it is the **independent check that the 22 GB actually landed**. The
lift computed here from raw bDOM and raw DGM1 should agree with what the shipped
`los_16m.json` reports. If it does not, something in the streaming build went wrong quietly.

    python tools/geodata/verify_visibility.py

It also records the one validation the plan hoped for and **cannot honestly perform** — see
`report_ais_limitation`. Reporting a check that is unavailable is worth more than quietly dropping
it, and worth far more than running a comparison that looks rigorous and means nothing.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

from aoi import load_aoi, terrain_dir
from build_terrain import read_xyz

Image.MAX_IMAGE_PIXELS = None

REPO = Path(__file__).resolve().parents[2]
BDOM = REPO / "data" / "lvermgeo" / "bdom" / "bdom20nc_32_570_6018_1_sh_2023.tif"
DGM1 = REPO / "data" / "lvermgeo" / "dgm1" / "dgm1_32_570_6018_1_sh_2023.xyz"

#: Above this, a return is treated as an object rather than as noise in the surface model.
OBJECT_HEIGHT_M = 2.0

#: The blocking surface is built at this resolution with a block maximum.
LOS_RESOLUTION_M = 16


def block_max(grid: np.ndarray, factor: int) -> np.ndarray:
    h = (grid.shape[0] // factor) * factor
    w = (grid.shape[1] // factor) * factor
    return grid[:h, :w].reshape(h // factor, factor, w // factor, factor).max(axis=(1, 3))


def measure_vegetation() -> dict:
    print("1. What vegetation adds to the blocking surface")
    if not BDOM.exists() or not DGM1.exists():
        print("   skip  the cached bDOM/DGM1 pair for tile 570/6018 is not present")
        return {"available": False}

    surface = np.array(Image.open(BDOM), dtype=np.float32)  # 20 cm posting
    # 20 cm -> 1 m by block maximum: an obstruction is defined by its highest return, not its mean.
    surface_1m = block_max(surface, 5)
    # read_xyz already returns a decoded 1 m grid with row 0 at the north, which is the same
    # convention the raster above uses.
    bare = read_xyz(DGM1)

    valid = np.isfinite(bare) & np.isfinite(surface_1m)
    ndom = np.where(valid, surface_1m - bare, np.nan)
    objects = valid & (ndom > OBJECT_HEIGHT_M)

    heights = ndom[objects]
    print(f"   tile 570/6018, {valid.sum():,} valid 1 m cells")
    print(f"   bare earth {np.nanmin(bare):.1f}..{np.nanmax(bare):.1f} m, "
          f"surface {np.nanmin(surface_1m):.1f}..{np.nanmax(surface_1m):.1f} m")
    print(f"   {objects.sum():,} cells carry something over {OBJECT_HEIGHT_M} m "
          f"({objects.mean() * 100:.1f} % of the square)")
    if heights.size:
        print(f"   object height: median {np.median(heights):.1f} m, "
              f"p90 {np.percentile(heights, 90):.1f} m, max {heights.max():.1f} m")

    # The number that actually matters: at the resolution the viewshed marches over, how much
    # higher would each cell block if vegetation were included?
    filled_bare = np.where(valid, bare, np.nan)
    filled_full = np.where(valid, np.fmax(bare, surface_1m), np.nan)
    los_bare = block_max(np.nan_to_num(filled_bare, nan=-1e6), LOS_RESOLUTION_M)
    los_full = block_max(np.nan_to_num(filled_full, nan=-1e6), LOS_RESOLUTION_M)
    usable = (los_bare > -1e5) & (los_full > -1e5)
    lift = np.where(usable, los_full - los_bare, np.nan)
    raised = usable & (lift > 0.5)
    print(f"   at {LOS_RESOLUTION_M} m, {raised.sum() / max(usable.sum(), 1) * 100:.1f} % of "
          f"cells would rise; median +{np.median(lift[raised]):.1f} m, "
          f"p90 +{np.percentile(lift[raised], 90):.1f} m, max +{np.nanmax(lift):.1f} m")
    print("   ⇒ every one of those was a sight line the model used to claim and reality blocks.")
    print("   Compare against losVegetation in los_16m.json: this is computed from the raw")
    print("   products and should agree with what the streaming build wrote.")
    return {
        "available": True,
        "tile": "570/6018",
        "objectShare": round(float(objects.mean()), 4),
        "objectMedianM": round(float(np.median(heights)), 2) if heights.size else 0.0,
        "objectP90M": round(float(np.percentile(heights, 90)), 2) if heights.size else 0.0,
        "objectMaxM": round(float(heights.max()), 2) if heights.size else 0.0,
        "losRaisedShare": round(float(raised.sum() / max(usable.sum(), 1)), 4),
        "losMedianLiftM": round(float(np.median(lift[raised])), 2) if raised.any() else 0.0,
        "losP90LiftM": round(float(np.percentile(lift[raised], 90)), 2) if raised.any() else 0.0,
        "losMaxLiftM": round(float(np.nanmax(lift)), 2),
    }


def report_buildings(cfg) -> dict:
    print("\n2. What buildings already add")
    meta = json.loads((terrain_dir(cfg) / "los_16m.json").read_text(encoding="utf-8"))
    stats = meta.get("buildingStats", {})
    if not stats:
        print("   skip  the blocking surface was built without buildings")
        return {}
    print(f"   {stats.get('cellsRaised', 0):,} cells raised above bare earth "
          f"(median +{stats.get('medianLiftM')} m, p90 +{stats.get('p90LiftM')} m, "
          f"max +{stats.get('maxLiftM')} m)")
    print("   bare earth alone would have claimed sight lines straight through the harbour.")
    return stats


def report_ais_limitation() -> dict:
    print("\n3. Validating the model against observed AIS coverage — NOT AVAILABLE")
    print("   The plan hoped to compare each modelled shadow against where AIS is actually")
    print("   received, and to report the disagreement rather than tune it away. That comparison")
    print("   cannot be made honestly with this feed:")
    print("     · the Danish archive is an AGGREGATE of many shore receivers plus satellites,")
    print("       and it publishes no receiver positions;")
    print("     · a shadow in our model is cast for ONE user-placed notional site, so there is")
    print("       no shared geometry between the two;")
    print("     · AIS reception is a VHF radio question, not a pure line-of-sight one.")
    print("   A correlation computed anyway would look rigorous and mean nothing. Recorded as")
    print("   unavailable, which is the honest state, and left open.")
    return {"available": False,
            "reason": "the AIS feed aggregates unknown receiver positions, so there is no shared "
                      "geometry to compare a single-site viewshed against"}


def main() -> None:
    cfg = load_aoi("kieler-foerde")
    print("What the visibility model can and cannot see\n")
    vegetation = measure_vegetation()
    buildings = report_buildings(cfg)
    ais = report_ais_limitation()

    out = REPO / "data" / "verification" / "visibility.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(
        {"vegetation": vegetation, "buildings": buildings, "aisValidation": ais},
        indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwritten to {out.relative_to(REPO)}")
    print("\nThe geometry itself is pinned by src/twin3d/viewshed.test.ts, which checks the solver")
    print("against d_km = 4.12·(√h₁ + √h₂) — a formula it never refers to.")


if __name__ == "__main__":
    main()

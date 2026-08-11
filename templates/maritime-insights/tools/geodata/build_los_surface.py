"""Build the surface that blocks a line of sight (PLAN §7, Phase 4).

The terrain heightmap is *bare earth*: DGM1 is a ground model, so a 30 m silo on the pier is not in
it. A visibility model built on bare earth alone would claim sight lines straight through the
harbour. This raster is what the viewshed actually marches against:

    blocking height = max(bare earth, top of any building standing on the cell)

Two deliberate choices, both of which push the model towards **claiming less coverage**:

1. **Downsampling uses the MAXIMUM, not the mean.** A mean erases ridges, and a ridge is precisely
   the thing that casts a shadow. Averaging a 20 m dune with the beach beside it invents a sight
   line over the dune that does not exist. Taking the maximum can only ever add shadow.
2. **Buildings are rasterised from their vertices**, so a building contributes its own roof height
   to every cell it touches.

Where the model is wrong it should be wrong in the direction of promising less. A planning tool
that overstates coverage is worse than useless; it is misleading.

**Vegetation is included when it has been built.** `fetch_bdom.py` streams the state's 20 cm image
surface model (~22 GB for this AOI) and reduces it to a 4 m surface top; this script folds that in
by maximum, on land only. Without it the surface is bare earth plus buildings and coverage is an
explicit **upper bound** — the descriptor says which of the two was built, so nothing downstream
has to guess.
"""

from __future__ import annotations

import argparse
import gzip
import json
import time
from pathlib import Path

import numpy as np

from aoi import load_aoi, terrain_dir

#: Metres per cell in the blocking surface. The heightmap is 4 m; a viewshed shadow is a
#: kilometre-scale shape, so 16 m costs nothing visually and makes the runtime solver fast enough
#: to re-run while a slider is dragged.
LOS_RESOLUTION_M = 16

#: Vertical step of the stored raster. Coarser than the terrain's 0.05 m because a line of sight
#: over 10 km does not care about centimetres, and this raster is read per ray-march step.
LOS_VERTICAL_STEP_M = 0.25


def load_heightmap(out: Path) -> tuple[np.ndarray, dict]:
    meta = json.loads((out / "heightmap_4m.json").read_text(encoding="utf-8"))
    raw = gzip.decompress((out / meta["file"]).read_bytes())
    grid = np.frombuffer(raw, dtype="<u2").reshape(meta["height"], meta["width"])
    elevation = grid.astype(np.float32) * meta["heightScale"] + meta["heightMinM"]
    return elevation, meta


def load_land_mask(out: Path, meta: dict) -> np.ndarray:
    """The current land/sea mask, as `True` where there is land."""
    raw = gzip.decompress((out / meta["landMaskFile"]).read_bytes())
    return np.frombuffer(raw, dtype=np.uint8).reshape(meta["height"], meta["width"]).astype(bool)


def building_tops(out: Path, meta: dict) -> tuple[np.ndarray, dict]:
    """Rasterise the highest building point standing on each 4 m cell."""
    bmeta = json.loads((out / "buildings_lod2.json").read_text(encoding="utf-8"))
    raw = gzip.decompress((out / bmeta["file"]).read_bytes())
    n = bmeta["vertexCount"]
    q = bmeta["quantisation"]
    xs = np.frombuffer(raw, dtype="<i2", count=n, offset=0).astype(np.float32) * q["xzScaleM"]
    ys = (np.frombuffer(raw, dtype="<u2", count=n, offset=2 * n).astype(np.float32)
          * q["yScaleM"] + q["yOffsetM"])
    zs = np.frombuffer(raw, dtype="<i2", count=n, offset=4 * n).astype(np.float32) * q["xzScaleM"]

    # Building coordinates are centred on the AOI centre; the raster starts at its north-west
    # corner. +z is south, and row 0 is north, so both axes grow the same way.
    res = meta["resolutionM"]
    half_w = meta["width"] * res / 2
    half_d = meta["height"] * res / 2
    col = np.floor((xs + half_w) / res).astype(np.int64)
    row = np.floor((zs + half_d) / res).astype(np.int64)
    inside = (col >= 0) & (col < meta["width"]) & (row >= 0) & (row < meta["height"])
    dropped = int((~inside).sum())

    tops = np.full((meta["height"], meta["width"]), -np.inf, dtype=np.float32)
    flat = row[inside] * meta["width"] + col[inside]
    np.maximum.at(tops.reshape(-1), flat, ys[inside])
    touched = int(np.isfinite(tops).sum())
    return tops, {
        "buildings": bmeta["count"],
        "vertices": n,
        "verticesOutsideGrid": dropped,
        "cellsTouched": touched,
    }


def surface_top(cfg) -> tuple[np.ndarray, dict] | tuple[None, dict]:
    """The measured top of everything standing, from bDOM, if it has been built.

    Optional on purpose: a fresh clone has no 22 GB stream behind it, and the blocking surface is
    still worth building without one — it simply goes back to being an upper bound, and says so.
    """
    derived = Path(__file__).resolve().parents[2] / "data" / "derived" / cfg["id"]
    descriptor = derived / "surface_top_4m.json"
    if not descriptor.exists():
        return None, {}
    meta = json.loads(descriptor.read_text(encoding="utf-8"))
    raw = gzip.decompress((derived / meta["file"]).read_bytes())
    grid = np.frombuffer(raw, dtype="<u2").reshape(meta["height"], meta["width"])
    return grid.astype(np.float32) * meta["heightScale"] + meta["heightMinM"], meta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--no-buildings", action="store_true",
                        help="bare earth only — used by the verifier to measure what buildings add")
    parser.add_argument("--no-vegetation", action="store_true",
                        help="ignore the measured surface top, to compare against it")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    out = terrain_dir(cfg)
    started = time.time()

    elevation, meta = load_heightmap(out)
    res = meta["resolutionM"]
    if LOS_RESOLUTION_M % res:
        raise SystemExit(f"{LOS_RESOLUTION_M} m must be a whole multiple of the {res} m heightmap")
    factor = LOS_RESOLUTION_M // res
    print(f"heightmap {meta['width']}x{meta['height']} @ {res} m "
          f"-> blocking surface @ {LOS_RESOLUTION_M} m (factor {factor})")

    # No-data cells (the open Baltic beyond the survey) must not block anything. They are sea.
    surface = np.where(np.isfinite(elevation), elevation, meta["seaLevelM"]).astype(np.float32)
    bare = surface.copy()

    stats: dict = {}
    if not args.no_buildings:
        tops, stats = building_tops(out, meta)
        raised = np.isfinite(tops) & (tops > surface)
        lift = tops[raised] - surface[raised]
        surface = np.where(np.isfinite(tops), np.maximum(surface, tops), surface)
        stats.update({
            "cellsRaised": int(raised.sum()),
            "medianLiftM": round(float(np.median(lift)), 2) if lift.size else 0.0,
            "p90LiftM": round(float(np.percentile(lift, 90)), 2) if lift.size else 0.0,
            "maxLiftM": round(float(lift.max()), 2) if lift.size else 0.0,
        })
        print(f"  buildings raised {stats['cellsRaised']:,} cells "
              f"(median +{stats['medianLiftM']} m, p90 +{stats['p90LiftM']} m, "
              f"max +{stats['maxLiftM']} m)")

    # 🔴 The measured surface top, if it exists. Folded in AFTER buildings and by maximum, so it can
    # only ever add shadow — bDOM sees trees and masts that LoD2 does not model, and LoD2
    # occasionally models a roof the imagery matched short. Neither is allowed to lower anything.
    vegetation: dict = {}
    if not args.no_vegetation:
        top, vmeta = surface_top(cfg)
        if top is None:
            print("  no measured surface top — coverage stays an explicit UPPER BOUND")
        elif top.shape != surface.shape:
            raise SystemExit(f"surface top is {top.shape}, heightmap is {surface.shape}")
        else:
            # 🔴 Re-apply the land gate HERE, against the mask as it is now.
            #
            # `fetch_bdom.py` already drops the measured surface over water — image matching there
            # returns wave texture, not a surface — but it did so against whatever mask existed on
            # the day it streamed 23 GB, and nobody is going to re-stream 23 GB because the mask
            # improved. When the water rule was corrected, ~650 000 Schlei cells became water; any
            # canopy height still sitting on them would have become a phantom obstruction floating
            # on the inlet, blocking sight lines across the very water the app measures. A gate
            # that lives only at fetch time is a gate that goes stale.
            land = load_land_mask(out, meta)
            over_water = int((np.isfinite(top) & (top > surface + 0.5) & ~land).sum())
            top = np.where(land, top, -np.inf)

            raised = top > surface + 0.5
            lift = top[raised] - surface[raised]
            surface = np.maximum(surface, np.where(np.isfinite(top), top, surface))
            vegetation = {
                "source": vmeta.get("source"),
                "cellsRaised": int(raised.sum()),
                "medianLiftM": round(float(np.median(lift)), 2) if lift.size else 0.0,
                "p90LiftM": round(float(np.percentile(lift, 90)), 2) if lift.size else 0.0,
                "maxLiftM": round(float(lift.max()), 2) if lift.size else 0.0,
                "droppedOverWaterAtFetch": vmeta.get("droppedOverWater"),
                "droppedOverWaterAtBuild": over_water,
            }
            print(f"  measured surface raised {vegetation['cellsRaised']:,} cells beyond "
                  f"buildings (median +{vegetation['medianLiftM']} m, "
                  f"p90 +{vegetation['p90LiftM']} m, max +{vegetation['maxLiftM']} m)")
            print(f"  re-gated against the current land mask: {over_water:,} cells dropped as "
                  f"water (a canopy height on water is a phantom obstruction)")

    # Trim to a whole number of output cells, then take the block MAXIMUM.
    h = (meta["height"] // factor) * factor
    w = (meta["width"] // factor) * factor
    blocks = surface[:h, :w].reshape(h // factor, factor, w // factor, factor)
    los = blocks.max(axis=(1, 3))

    mean_blocks = bare[:h, :w].reshape(h // factor, factor, w // factor, factor).mean(axis=(1, 3))
    max_over_mean = float(np.percentile(los - mean_blocks, 90))
    print(f"  block max vs block mean: p90 difference {max_over_mean:.2f} m "
          f"(this is the shadow a mean would have erased)")

    lo = float(los.min())
    hi = float(los.max())
    levels = (hi - lo) / LOS_VERTICAL_STEP_M
    if levels > 65535:
        raise SystemExit(f"{hi - lo:.1f} m of relief needs {levels:.0f} levels — coarsen the step")
    raw = np.rint((los - lo) / LOS_VERTICAL_STEP_M).astype(np.uint16)

    name = f"los_{LOS_RESOLUTION_M}m.u16z"
    payload = gzip.compress(raw.tobytes(), 6)
    (out / name).write_bytes(payload)

    descriptor = {
        "width": int(los.shape[1]),
        "height": int(los.shape[0]),
        "resolutionM": LOS_RESOLUTION_M,
        "crs": meta["crs"],
        "verticalDatum": meta["verticalDatum"],
        "origin": meta["origin"],
        "heightMinM": round(lo, 3),
        "heightMaxM": round(hi, 3),
        "heightScale": LOS_VERTICAL_STEP_M,
        "encoding": "uint16-le, row-major, row 0 = north, gzip",
        "file": name,
        "bytes": int(raw.nbytes),
        "compressedBytes": len(payload),
        "seaLevelM": meta["seaLevelM"],
        "downsampling": "block maximum — a mean erases the ridges that cast the shadows, and "
                        "erasing a ridge invents a sight line that does not exist",
        "includesBuildings": not args.no_buildings,
        "includesVegetation": bool(vegetation),
        "vegetationNote": (
            "Bare earth, raised to the top of every building, then to the measured surface top "
            "(bDOM 20 cm) wherever that is higher. Vegetation and unmodelled structures are "
            "therefore included on land. Over water the measured surface is deliberately ignored: "
            "image matching there returns wave texture, and a phantom obstruction on the fjord "
            "would corrupt every coverage figure this app publishes."
            if vegetation else
            "Bare earth plus buildings. Tree heights (bDOM) are not included, so coverage is an "
            "UPPER BOUND; run fetch_bdom.py and rebuild to remove that caveat."
        ),
        "buildingStats": stats,
        "vegetationStats": vegetation,
        "source": ("DGM1 + LoD2 + bDOM, Landesamt für Vermessung und Geoinformation "
                   "Schleswig-Holstein" if vegetation else
                   "DGM1 + LoD2, Landesamt für Vermessung und Geoinformation Schleswig-Holstein"),
        "licence": "CC BY 4.0",
        "attribution": meta["attribution"],
        "builtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out / f"los_{LOS_RESOLUTION_M}m.json").write_text(
        json.dumps(descriptor, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"  {los.shape[1]}x{los.shape[0]} cells, {lo:.2f} .. {hi:.2f} m")
    print(f"  {name}: {raw.nbytes / 1e6:.2f} MB raw -> {len(payload) / 1e6:.2f} MB gzipped")
    print(f"done in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()

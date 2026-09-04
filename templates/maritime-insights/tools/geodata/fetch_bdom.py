"""Fold the measured surface top (bDOM) into the AOI, so the viewshed stops ignoring trees.

PLAN §13 tier 2 #6. Until now the blocking surface has been **bare earth raised to the top of every
building**, and the app has said so: coverage was published as an explicit *upper bound* because a
mature tree line is 25 m of solid obstruction sitting exactly where a coastal sight line grazes the
shore. `verify_visibility.py` measured the cost of that omission on the one cached tile — 90.8 % of
land cells would rise, by a median 9.6 m — which is a large enough correction that leaving it in
place in front of an engineering audience was a risk.

**What this is, precisely.** LVermGeo's bDOM is an image-matched *digital surface model* at 20 cm:
the top of whatever the aerial imagery saw, trees and structures alike, on the same DHHN2016 datum
as the DGM1 bare earth. It is therefore not a "vegetation layer" and this file does not call it one
— it is a measured surface, and what it adds over bare earth is trees, masts, cranes, and anything
else standing that LoD2 does not model.

Three decisions worth stating, because each pushes the model towards **claiming less coverage**:

1. **Block maximum, never mean**, at every reduction. A mean erases the ridge that casts the
   shadow. Taking the maximum can only ever add shadow, and the app's whole argument is that it
   does not overstate what a sensor can see.
2. 🔴 **Land only.** bDOM is image-matched, so over water it carries wave texture, wakes, moored
   boats and matching noise. Letting that into the blocking surface would invent obstructions
   **on the fjord itself** — the one place this app must never put a phantom shadow, since every
   figure it publishes is about seeing ships. The land mask decides, exactly as it does in the
   renderer and in `build_los_surface.py`.
3. **Streamed and discarded.** The AOI needs 213 tiles at ~105 MB, about 22 GB, which does not
   belong in a repository. Each tile is fetched, reduced to the 4 m grid and dropped, so peak disk
   is one tile. `--keep` overrides that when a tile is wanted for verification.

Usage
  python tools/geodata/fetch_bdom.py
  python tools/geodata/fetch_bdom.py --limit 4      # a quick partial run
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image

from aoi import load_aoi, terrain_dir
from fetch_lvermgeo import catalogue, fetch, filename_of, link_of, select, tile_origin

Image.MAX_IMAGE_PIXELS = None

REPO = Path(__file__).resolve().parents[2]

#: bDOM posting in metres. 20 cm, five samples to the metre.
BDOM_STEP_M = 0.2

#: Vertical step of the stored raster, matching the blocking surface it feeds.
VERTICAL_STEP_M = 0.25

#: A surface return this far below the bare earth under it is matching noise, not ground.
MAX_BELOW_BARE_M = 5.0

#: And this far above is a matching blunder rather than a tree — the tallest structure in the AOI
#: is well under this, and a single bad cell at 400 m would black out a whole sector.
MAX_ABOVE_BARE_M = 120.0


def block_max(grid: np.ndarray, factor: int) -> np.ndarray:
    h = (grid.shape[0] // factor) * factor
    w = (grid.shape[1] // factor) * factor
    return grid[:h, :w].reshape(h // factor, factor, w // factor, factor).max(axis=(1, 3))


def load_heightmap(out: Path) -> tuple[np.ndarray, np.ndarray, dict]:
    meta = json.loads((out / "heightmap_4m.json").read_text(encoding="utf-8"))
    raw = gzip.decompress((out / meta["file"]).read_bytes())
    grid = np.frombuffer(raw, dtype="<u2").reshape(meta["height"], meta["width"])
    elevation = grid.astype(np.float32) * meta["heightScale"] + meta["heightMinM"]
    land = np.frombuffer(
        gzip.decompress((out / meta["landMaskFile"]).read_bytes()), dtype=np.uint8,
    ).reshape(meta["height"], meta["width"]).astype(bool)
    return elevation, land, meta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--limit", type=int, default=0, help="stop after N tiles (a smoke test)")
    parser.add_argument("--keep", action="store_true", help="cache each tile instead of dropping it")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    out = terrain_dir(cfg)
    bare, land, meta = load_heightmap(out)
    res = meta["resolutionM"]
    if res % 1:
        raise SystemExit("this builder assumes a whole-metre heightmap posting")

    e0 = meta["origin"]["easting"]
    n0 = meta["origin"]["northing"]
    north_edge = n0 + meta["height"] * res
    east_edge = e0 + meta["width"] * res

    # 🔴 The reduction below is a plain reshape, which is only correct because the 4 m grid divides
    # evenly into the 1 km tiles. Asserted rather than assumed: a half-cell offset here would shift
    # every tree in the AOI by two metres and nothing would look wrong.
    if (e0 % res) or (north_edge % res):
        raise SystemExit("heightmap grid is not aligned to the 1 km tile lattice")
    per_tile = int(1000 // res)

    features = select(catalogue("bdom"), e0, n0, east_edge, north_edge)
    if args.limit:
        features = features[: args.limit]
    print(f"{len(features)} bDOM tiles cover the AOI "
          f"({len(features) * 105 / 1024:.1f} GB to stream)")

    top = np.full(bare.shape, -np.inf, dtype=np.float32)
    cache = REPO / "data" / "lvermgeo" / "bdom"
    started = time.time()
    bytes_read = 0
    placed = 0

    for index, feature in enumerate(features, start=1):
        name = filename_of(feature)
        origin = tile_origin(link_of(feature))
        if not origin:
            print(f"  skip {name}: no tile origin in the link")
            continue
        # ⚠️ `tile_origin` already returns METRES, not tile-kilometres. Multiplying again put every
        # window 570 000 km east of the AOI, so nothing was placed and nothing complained.
        te, tn = origin

        cached = cache / name
        if cached.exists():
            blob = cached.read_bytes()
        else:
            blob = fetch(link_of(feature))
            if args.keep:
                cache.mkdir(parents=True, exist_ok=True)
                cached.write_bytes(blob)
        bytes_read += len(blob)

        surface = np.array(Image.open(io.BytesIO(blob)), dtype=np.float32)
        # 20 cm -> 1 m -> the heightmap posting, by maximum at every step.
        metre = block_max(surface, int(round(1 / BDOM_STEP_M)))
        cells = block_max(metre, int(res))

        # Tile north-west corner in grid indices. Exact by the assertion above.
        col0 = int((te - e0) // res)
        row0 = int((north_edge - (tn + 1000)) // res)
        c_lo, c_hi = max(col0, 0), min(col0 + per_tile, meta["width"])
        r_lo, r_hi = max(row0, 0), min(row0 + per_tile, meta["height"])
        if c_lo >= c_hi or r_lo >= r_hi:
            continue
        patch = cells[r_lo - row0: r_hi - row0, c_lo - col0: c_hi - col0]
        window = top[r_lo:r_hi, c_lo:c_hi]
        np.maximum(window, patch, out=window)
        placed += 1

        if index % 20 == 0 or index == len(features):
            rate = bytes_read / 1e6 / max(time.time() - started, 1e-6)
            print(f"  {index}/{len(features)} tiles  {bytes_read / 1e9:.1f} GB  {rate:.0f} MB/s")

    if not placed:
        raise SystemExit("no tiles were placed — nothing to write")

    # ── the two corrections, both stated in the descriptor ───────────────────
    have = np.isfinite(top)
    lift = np.where(have, top - bare, np.nan)

    # Matching noise below the ground, and blunders far above anything that stands here.
    plausible = have & (lift > -MAX_BELOW_BARE_M) & (lift < MAX_ABOVE_BARE_M)
    dropped_implausible = int((have & ~plausible).sum())

    # 🔴 Land only. See the header: image matching over water is wave texture, and a phantom
    # obstruction on the fjord would corrupt every figure this app publishes.
    usable = plausible & land
    dropped_water = int((plausible & ~land).sum())

    surface_top = np.where(usable, np.maximum(top, bare), bare).astype(np.float32)
    raised = usable & (surface_top > bare + 0.5)
    lifts = (surface_top - bare)[raised]

    print(f"\nplaced {placed} tiles over {int(have.sum()):,} cells")
    print(f"  dropped {dropped_implausible:,} implausible, {dropped_water:,} over water")
    print(f"  {int(raised.sum()):,} land cells rise "
          f"({raised.sum() / max(int(land.sum()), 1) * 100:.1f} % of land)")
    if lifts.size:
        print(f"  lift: median +{np.median(lifts):.1f} m, p90 +{np.percentile(lifts, 90):.1f} m, "
              f"max +{lifts.max():.1f} m")

    lo = float(surface_top.min())
    hi = float(surface_top.max())
    raw = np.rint((surface_top - lo) / VERTICAL_STEP_M).astype(np.uint16)
    derived = REPO / "data" / "derived" / cfg["id"]
    derived.mkdir(parents=True, exist_ok=True)
    (derived / "surface_top_4m.u16z").write_bytes(gzip.compress(raw.tobytes(), 6))
    (derived / "surface_top_4m.json").write_text(json.dumps({
        "width": int(meta["width"]),
        "height": int(meta["height"]),
        "resolutionM": res,
        "crs": meta["crs"],
        "verticalDatum": meta["verticalDatum"],
        "origin": meta["origin"],
        "heightMinM": round(lo, 3),
        "heightMaxM": round(hi, 3),
        "heightScale": VERTICAL_STEP_M,
        "encoding": "uint16-le, row-major, row 0 = north, gzip",
        "file": "surface_top_4m.u16z",
        "tilesPlaced": placed,
        "bytesStreamed": bytes_read,
        "landCellsRaised": int(raised.sum()),
        "landRaisedShare": round(float(raised.sum() / max(int(land.sum()), 1)), 4),
        "medianLiftM": round(float(np.median(lifts)), 2) if lifts.size else 0.0,
        "p90LiftM": round(float(np.percentile(lifts, 90)), 2) if lifts.size else 0.0,
        "maxLiftM": round(float(lifts.max()), 2) if lifts.size else 0.0,
        "droppedImplausible": dropped_implausible,
        "droppedOverWater": dropped_water,
        "waterNote": "bDOM is image-matched and carries wave texture over water. Only land cells "
                     "contribute, so no phantom obstruction can appear on the fjord.",
        "surface": "DSM — vegetation and structures, not bare earth",
        "source": "bDOM 20 cm, Landesamt für Vermessung und Geoinformation Schleswig-Holstein",
        "licence": "CC BY 4.0",
        "attribution": "Datenquelle: Landesamt für Vermessung und Geoinformation "
                       "Schleswig-Holstein (LVermGeo SH), CC BY 4.0 [Daten bearbeitet]",
        "builtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwritten to {derived / 'surface_top_4m.u16z'}")
    print("now re-run build_los_surface.py to fold it into the blocking surface")


if __name__ == "__main__":
    main()

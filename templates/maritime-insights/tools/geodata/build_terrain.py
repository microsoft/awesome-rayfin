"""Turn LVermGeo SH DGM1 tiles into the browser's heightmap.

PLAN §4. Input is one ASCII XYZ file per 1 km tile at 1 m posting; output is a single uint16
heightmap at the AOI's render resolution, plus the land/sea mask that everything else keys off.

Three things about this AOI that the sibling repos' terrain builders never had to handle:

🔴 **The downloaded .xyz has the website's HTML footer appended to it.** A tile is exactly
1 000 000 numeric lines followed by ~32 lines of markup. A parser that trusts the file to be
numeric to the end fails on the last line, and one that skips silently would accept a truncated
tile. Both are wrong: the count is checked against the tile geometry.

🔴 **Most of this AOI is water**, so most of the grid is one repeated value. That is why the
heightmap ships gzipped — it costs nothing to compress and removes more than half the payload.

⚠️ **The output is deliberately NOT named .gz.** A dev server sets `Content-Encoding: gzip` on that
extension and the browser inflates it transparently, while a static host sets nothing and hands
over raw bytes — the same file, opposite behaviour. The extension is neutral and the loader detects
the `1f 8b` magic by content.

Usage
  python tools/geodata/build_terrain.py
  python tools/geodata/build_terrain.py --aoi kieler-foerde --resolution 4
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from scipy import ndimage

from aoi import bbox_wsen, cache_dir, grids, load_aoi, terrain_dir
from utm import bbox_to_utm32, utm32_to_wgs84

TILE_M = 1000
TILE_RE = re.compile(r"_32_(\d{3})_(\d{4})_")

#: DHHN2016 puts mean sea level at 0.
SEA_LEVEL_M = 0.0

#: Elevation below which a cell is **confidently** water, used only to seed the search below.
SEA_SEED_EPS_M = 0.05

#: How far above the datum a surveyed water surface is still accepted as water — but **only where
#: it connects to water that is already confident**.
#:
#: 🔴 A single global threshold is wrong here, and the second AOI proved it. `SEA_EPS_M = 0.05` was
#: tuned on the first AOI, whose Baltic values straddle zero. On the Schlei the surveyed water
#: surface sits at **+0.07 m** over whole flight blocks: 572 707 cells at exactly that height were
#: therefore classified *land*, drawn on top of the water plane, and rendered wearing the
#: orthophoto's picture of water — a dark, speckled inlet. Worse, the boundary between the correct
#: and incorrect regions was a **straight diagonal line**: a lidar acquisition seam, because the
#: water level differed between flights. No constant can be right for every block.
#:
#: So water is defined as *at water level* **and** *connected to water*. 0.20 m is the repo's own
#: stated figure for how tideless the Baltic is (§ the AOI configs' `sea` note): wind set-up in a
#: tideless basin is of that order, so a legitimate water surface can sit this far off datum. The
#: connectivity requirement is what stops a low inland field at +0.15 m from becoming a lake — it
#: has to be reachable from open water.
#:
#: Measured effect: Schlei sea 9.6 % → 14.6 % of the grid (+652 841 cells, 93 % of them in blobs
#: of 1000 cells or more — water arrives in bodies, noise arrives as confetti). Kieler Förde
#: 23.3 % → 24.9 %, mostly the isolated speckle that was already visible inside the open Baltic.
WATER_CEILING_M = 0.20

#: Vertical quantisation step, in metres. NOT chosen for the payload — chosen because DGM1's own
#: stated height accuracy is of the order of a decimetre, so anything finer is storing measurement
#: noise and calling it terrain.
#:
#: 🔴 This replaced a scale of `(max - min) / 65535`, which spread the full 16-bit range across a
#: 72 m span and produced a **1.1 mm** step. Measured effect of the step on the gzipped heightmap:
#: 0.001 m = 21.19 MB · 0.01 m = 15.89 · 0.02 m = 13.49 · **0.05 m = 9.79** · 0.10 m = 7.05.
#: Less than half the payload, and not one millimetre of real information given up.
VERTICAL_STEP_M = 0.05


def read_xyz(path: Path) -> np.ndarray:
    """Return the tile's 1 m elevations as a (rows, cols) array, row 0 = NORTH.

    The file is a regular grid written row-major from the north-west corner, so the x and y
    columns are redundant — but they are read and checked rather than assumed, because a silently
    transposed or reordered tile is exactly the sort of fault that only shows up as a mirrored
    coastline much later.
    """
    blob = path.read_bytes()
    # Truncate the appended HTML rather than filtering line by line: the first '<' is the start of
    # the markup, and there is no '<' anywhere in a numeric grid.
    cut = blob.find(b"<")
    if cut != -1:
        blob = blob[:cut]
    values = np.fromstring(blob.decode("ascii", "ignore"), dtype=np.float64, sep=" ")
    if values.size % 3:
        raise ValueError(f"{path.name}: {values.size} numbers is not a multiple of 3")
    points = values.reshape(-1, 3)
    # 🔴 NOT every tile is a complete 1000 x 1000 grid. The 2023 tiles are; the 2006 tiles over
    # the northern water are not — dgm1_32_577_6032_1_sh_2006 carries 999 999 points. An equality
    # check here rejected a perfectly usable tile and killed the whole build. What matters is that
    # every point lands inside the square the filename claims; the gaps become nodata and are
    # reported by the coverage figure rather than hidden by an average.
    if points.shape[0] > TILE_M * TILE_M:
        raise ValueError(
            f"{path.name}: {points.shape[0]} points, more than the {TILE_M * TILE_M} a tile holds"
        )

    match = TILE_RE.search(path.name)
    if not match:
        raise ValueError(f"{path.name}: no tile coordinates in the filename")
    origin_e, origin_n = int(match.group(1)) * 1000, int(match.group(2)) * 1000

    # Cell centres sit on the half metre; the grid runs east across a row and south down the rows.
    col = np.rint(points[:, 0] - origin_e - 0.5).astype(np.int32)
    row = np.rint(origin_n + TILE_M - points[:, 1] - 0.5).astype(np.int32)
    if col.min() < 0 or col.max() >= TILE_M or row.min() < 0 or row.max() >= TILE_M:
        raise ValueError(f"{path.name}: points fall outside the tile named in the filename")

    grid = np.full((TILE_M, TILE_M), np.nan, dtype=np.float32)
    grid[row, col] = points[:, 2]
    return grid


# ⚡ Parsing 28 MB of ASCII per tile costs ~10 s, and this AOI has 206 of them — half an hour of
# CPU for a build that will be re-run every time a colour ramp changes. The decoded grid is cached
# as .npy (4 MB, loads in milliseconds) and the parse is spread across cores. Measure before
# optimising further: the cost is in float parsing, not in I/O.
def decode_tile(path: Path) -> Path:
    npy = path.with_suffix(".npy")
    if npy.exists() and npy.stat().st_mtime >= path.stat().st_mtime:
        return npy
    np.save(npy, read_xyz(path))
    return npy


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--resolution", type=int, default=0, help="override renderResolutionM")
    parser.add_argument("--allow-missing", action="store_true",
                        help="build from whatever is cached (for a pipeline probe)")
    parser.add_argument("--workers", type=int, default=0,
                        help="parallel tile decoders (0 = let the pool decide)")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    res = args.resolution or grids(cfg, "core")["renderResolutionM"]
    west, south, east, north = bbox_wsen(cfg, "core")
    e0, n0, e1, n1 = bbox_to_utm32(west, south, east, north)

    # Snap the window outwards to whole render cells so a cell always means the same ground.
    e0 = np.floor(e0 / res) * res
    n0 = np.floor(n0 / res) * res
    e1 = np.ceil(e1 / res) * res
    n1 = np.ceil(n1 / res) * res
    width = int((e1 - e0) / res)
    height = int((n1 - n0) / res)
    print(f"AOI {cfg['id']}: {width} x {height} cells at {res} m "
          f"({width * height / 1e6:.1f} M, {(e1 - e0) / 1000:.2f} x {(n1 - n0) / 1000:.2f} km)")

    accum = np.zeros((height, width), dtype=np.float64)
    count = np.zeros((height, width), dtype=np.int32)

    # ⚡ The source is 1 m, the render grid is a whole multiple of it, and both are snapped to the
    # same modulus — so a tile maps onto an exact block of render cells and the resampling is a
    # reshape-and-mean, not a scatter. The first version used `np.add.at` over a million indices
    # per tile and had not finished 205 tiles after several minutes; this does the same arithmetic
    # in one vectorised pass. Alignment is asserted rather than assumed, because if it ever fails
    # the fast path would silently shift the terrain by up to one cell.
    if TILE_M % res:
        raise SystemExit(f"tile size {TILE_M} m is not a multiple of the render resolution {res} m")
    block = TILE_M // res

    tiles = sorted(cache_dir("lvermgeo", "dgm1").glob("*.xyz"))
    print(f"  {len(tiles)} cached DGM1 tiles")
    if not tiles:
        raise SystemExit("no tiles cached — run tools/geodata/fetch_lvermgeo.py --product dgm1")

    def in_window(path: Path) -> bool:
        match = TILE_RE.search(path.name)
        if not match:
            return False
        te, tn = int(match.group(1)) * 1000, int(match.group(2)) * 1000
        return not (te + TILE_M <= e0 or te >= e1 or tn + TILE_M <= n0 or tn >= n1)

    tiles = [t for t in tiles if in_window(t)]
    stale = [t for t in tiles
             if not (t.with_suffix(".npy").exists()
                     and t.with_suffix(".npy").stat().st_mtime >= t.stat().st_mtime)]
    if stale:
        print(f"  decoding {len(stale)} tiles ({len(tiles) - len(stale)} already cached as .npy)")
        started = time.time()
        with ProcessPoolExecutor(max_workers=args.workers or None) as pool:
            for done, _ in enumerate(pool.map(decode_tile, stale), 1):
                if done % 20 == 0 or done == len(stale):
                    rate = done / max(time.time() - started, 0.001)
                    print(f"    {done}/{len(stale)} decoded ({rate:.1f} tiles/s)")

    used = 0
    started = time.time()
    for index, path in enumerate(tiles, 1):
        match = TILE_RE.search(path.name)
        if not match:
            continue
        te, tn = int(match.group(1)) * 1000, int(match.group(2)) * 1000
        grid = np.load(path.with_suffix(".npy"))
        used += 1

        # Where this tile's north-west corner lands in the render grid.
        col0 = (te - e0) / res
        row0 = (n1 - (tn + TILE_M)) / res
        if col0 != int(col0) or row0 != int(row0):
            raise SystemExit(
                f"{path.name} is not aligned to the {res} m render grid "
                f"(col {col0}, row {row0}) — the fast resample would shift the terrain"
            )
        col0, row0 = int(col0), int(row0)

        # Clip the tile to the grid, keeping whole render blocks so the mean stays exact.
        src_r0 = max(0, -row0) * res
        src_c0 = max(0, -col0) * res
        src_r1 = TILE_M - max(0, (row0 + block) - height) * res
        src_c1 = TILE_M - max(0, (col0 + block) - width) * res
        if src_r1 <= src_r0 or src_c1 <= src_c0:
            continue
        sub = grid[src_r0:src_r1, src_c0:src_c1]
        rows_out = (src_r1 - src_r0) // res
        cols_out = (src_c1 - src_c0) // res

        # Mean of each res x res block, ignoring gaps. `nan` contributes to neither sum nor count,
        # so a partially measured cell still gets the average of what was measured.
        blocks = sub.reshape(rows_out, res, cols_out, res)
        finite_blocks = np.isfinite(blocks)
        sums = np.where(finite_blocks, blocks, 0.0).sum(axis=(1, 3), dtype=np.float64)
        counts = finite_blocks.sum(axis=(1, 3), dtype=np.int32)

        dst_r = row0 + src_r0 // res
        dst_c = col0 + src_c0 // res
        accum[dst_r:dst_r + rows_out, dst_c:dst_c + cols_out] += sums
        count[dst_r:dst_r + rows_out, dst_c:dst_c + cols_out] += counts

        if index % 25 == 0 or index == len(tiles):
            print(f"  [{index:>4}/{len(tiles)}] {used} used, "
                  f"{time.time() - started:.0f}s elapsed")

    covered = count > 0
    print(f"  coverage: {covered.mean() * 100:.2f}% of the grid from {used} tiles")
    if covered.mean() < 0.999 and not args.allow_missing:
        raise SystemExit(
            f"only {covered.mean() * 100:.2f}% of the grid is covered — fetch the remaining tiles, "
            "or pass --allow-missing to build a partial model on purpose"
        )

    elevation = np.full((height, width), np.nan, dtype=np.float32)
    elevation[covered] = (accum[covered] / count[covered]).astype(np.float32)

    finite = np.isfinite(elevation)
    lo = float(np.nanmin(elevation))
    hi = float(np.nanmax(elevation))
    print(f"  elevation {lo:.2f} .. {hi:.2f} m ({finite.mean() * 100:.2f}% of cells)")

    # Land/sea mask. Not cosmetic: it is what lets the heightmap compress, it is what the
    # visibility model uses to know where a target can be, and it is what decides which cells get
    # pushed under the water plane instead of being drawn on top of it.
    #
    # 🔴 Two stages, because one threshold cannot survive a lidar acquisition seam — see
    # WATER_CEILING_M. Stage one is the confident water; stage two grows it into cells that are at
    # water level *and touch water already found*. `binary_propagation` is exactly that flood fill.
    seed = finite & (elevation <= SEA_LEVEL_M + SEA_SEED_EPS_M)
    reachable = finite & (elevation <= SEA_LEVEL_M + WATER_CEILING_M)
    sea = ndimage.binary_propagation(seed, mask=reachable)
    recovered = int((sea & ~seed).sum())
    land = finite & ~sea
    print(f"  sea {sea.mean() * 100:.1f}%  land {land.mean() * 100:.1f}%  "
          f"nodata {(~finite).mean() * 100:.2f}%")
    print(f"  water: {int(seed.sum()):,} cells at or below {SEA_LEVEL_M + SEA_SEED_EPS_M:.2f} m, "
          f"plus {recovered:,} recovered up to {SEA_LEVEL_M + WATER_CEILING_M:.2f} m by "
          f"connection (a surveyed water surface sits above datum where the wind piled it up)")

    # Quantise. Gaps and sea both take the floor value so the raster is flat there.
    #
    # ⚠️ The plan assumed this raster would compress heavily "because most of the AOI is water and
    # therefore a constant". **Measured, and it is wrong twice.** DGM1 carries real varying values
    # under water (-11.38 .. 0.05 m, std 4.59 m — it is not a constant), and flattening the sea
    # anyway only moved 21.11 MB to 18.14 MB, because the payload is dominated by LAND detail.
    # The lever that actually worked was the vertical step above.
    quant = elevation.copy()
    quant[~finite] = lo
    scale = VERTICAL_STEP_M
    levels = (hi - lo) / scale
    if levels > 65535:
        raise SystemExit(
            f"{hi - lo:.1f} m of relief at a {scale} m step needs {levels:.0f} levels, "
            "which does not fit in uint16 — coarsen VERTICAL_STEP_M"
        )
    raw = np.rint((quant - lo) / scale).astype(np.uint16)

    out = terrain_dir(cfg)
    out.mkdir(parents=True, exist_ok=True)
    name = f"heightmap_{res}m.u16z"
    payload = gzip.compress(raw.tobytes(), 6)
    (out / name).write_bytes(payload)
    mask_name = f"landmask_{res}m.u8z"
    (out / mask_name).write_bytes(gzip.compress(land.astype(np.uint8).tobytes(), 6))

    lon_w, lat_s = utm32_to_wgs84(e0, n0)
    lon_e, lat_n = utm32_to_wgs84(e1, n1)
    descriptor = {
        "width": width,
        "height": height,
        "resolutionM": res,
        "crs": "EPSG:25832",
        "verticalDatum": cfg["verticalDatum"],
        "origin": {"easting": e0, "northing": n0},
        "heightMinM": round(lo, 3),
        "heightMaxM": round(hi, 3),
        "heightScale": scale,
        "heightScaleNote": "Vertical step in metres. Chosen to sit inside DGM1's own stated "
                           "accuracy, not to hit a payload target.",
        "encoding": "uint16-le, row-major, row 0 = north, gzip",
        "file": name,
        "bytes": int(raw.nbytes),
        "compressedBytes": len(payload),
        "landMaskFile": mask_name,
        "seaLevelM": SEA_LEVEL_M,
        "seaSeedEpsM": SEA_SEED_EPS_M,
        "waterCeilingM": WATER_CEILING_M,
        "seaRecoveredCells": recovered,
        "seaRuleNote": ("Water is what sits at water level AND connects to water. A single "
                        "threshold fails across a lidar acquisition seam, where the surveyed "
                        "water surface differs between flights — on one AOI whole blocks sat at "
                        "+0.07 m and rendered as land on top of the water plane."),
        "seaShare": round(float(sea.mean()), 5),
        "coverage": round(float(finite.mean()), 5),
        "boundsWgs84": {"west": round(lon_w, 6), "south": round(lat_s, 6),
                        "east": round(lon_e, 6), "north": round(lat_n, 6)},
        "tilesUsed": used,
        "source": "DGM1, Landesamt für Vermessung und Geoinformation Schleswig-Holstein",
        "licence": "CC BY 4.0",
        "attribution": "Datenquelle: Landesamt für Vermessung und Geoinformation "
                       "Schleswig-Holstein (LVermGeo SH), CC BY 4.0 [Daten bearbeitet]",
        "builtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out / f"heightmap_{res}m.json").write_text(
        json.dumps(descriptor, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"\n  {name}  {raw.nbytes / 1e6:.1f} MB raw -> {len(payload) / 1e6:.2f} MB gzipped "
          f"({raw.nbytes / max(len(payload), 1):.1f}x)")

    # 🔴 A rendered picture is part of the build, not an afterthought. Every serious defect this
    # family of projects has hit — a mirrored raster, a nodata cliff, a whole valley coloured
    # wrong — was invisible to type checks and unit tests and obvious in one frame. The preview
    # is written every time so there is no version of "built successfully" that nobody looked at.
    try:
        from PIL import Image
    except ImportError:
        print("  (Pillow not installed — no preview written)")
    else:
        shaded = np.zeros((height, width, 3), dtype=np.float32)
        relief = np.clip((elevation - lo) / max(hi - lo, 1e-6), 0, 1)
        # Hillshade from central differences, low north-west sun — without it low terrain reads
        # as a flat grey mass, and this AOI has only ~70 m of relief to work with.
        gy, gx = np.gradient(np.nan_to_num(elevation, nan=0.0), res)
        lambert = np.clip((-gx * 0.55 + gy * 0.55 + 1.0) / np.sqrt(gx**2 + gy**2 + 1.0), 0, 1)
        tone = np.clip(0.45 + 0.35 * relief, 0, 1) * (0.55 + 0.45 * lambert)
        shaded[..., 0] = tone
        shaded[..., 1] = tone * 0.98
        shaded[..., 2] = tone * 0.92
        shaded[sea] = np.array([0.16, 0.32, 0.46], dtype=np.float32)
        shaded[~finite] = np.array([0.90, 0.25, 0.25], dtype=np.float32)
        preview = Image.fromarray(np.clip(shaded * 255, 0, 255).astype(np.uint8))
        preview.thumbnail((900, 900))
        preview.save(out / "preview.png")
        print(f"  preview.png  {preview.size[0]}x{preview.size[1]} "
              "(grey = land, blue = sea, red = no survey data)")

    print(f"  written to {out}")


if __name__ == "__main__":
    main()

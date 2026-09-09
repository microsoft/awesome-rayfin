"""Derive tree instances from the normalised surface model — PLAN Phase 6.

Bavaria publishes a tree cadastre: every tree surveyed, with a species, a height and a position.
**Baden-Württemberg publishes no such thing.** The nearest available truth is the nDOM — the
normalised digital surface model, which is the laser-scanned surface minus the bare-earth terrain,
so each pixel is the height of whatever stands on the ground at that square metre.

That is a genuinely weaker claim and the output says so. A tree here is *derived*: a local maximum
in a canopy-height raster, not a surveyed stem. Some are real trees, some are two trees read as
one, and a few are almost certainly a hedge. What they are not is invented — every one sits on a
metre of measured canopy.

**Buildings are the trap.** The nDOM does not know what a roof is; a 15 m gable is a 15 m local
maximum and would plant a tree on it. So detection is restricted to land cover that is actually
vegetation, using the OSM raster the terrain already carries. That loses street trees on paved
roads, which is the honest trade: a missing tree is invisible, a forest growing out of the
Stiftskirche is not.

Output is byte-identical in layout to `build_vegetation.py`, so the renderer cannot tell which AOI
it is drawing.

Usage
  python tools/geodata/build_vegetation_ndom.py --aoi tuebingen
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import struct
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from aoi import cache_dir, load_aoi, terrain_dir

Image.MAX_IMAGE_PIXELS = None

#: Land-cover classes where a tall return is plausibly a plant. Everything else is excluded, which
#: is what keeps roofs out of the tree layer. Codes come from build_landuse.py.
VEGETATION_CLASSES = {1, 2, 3, 5, 6, 7, 10}  # vineyard, orchard, forest, meadow, park, allotment, scrub

CROWN_RATIO = 0.28
CROWN_MIN_M = 1.5
CROWN_MAX_M = 12.0

#: ⚠️ TOLERATES BOTH STATES' NAMING. Baden-Württemberg writes `ndom1_32_503_5374_1_bw.tif`;
#: Nordrhein-Westfalen writes `ndom50_32353_5643_1_nw_2025.tif` — no underscore after the zone, a
#: different state suffix, and a trailing vintage. The original pattern ended in a literal `_bw`,
#: so every NRW tile was simply unreadable.
TILE_RE = re.compile(r"_32_?(\d{3})_(\d{4})_(\d+)_(?:bw|nw)", re.I)


def tile_origin(path: Path) -> tuple[float, float, float]:
    """South-west corner of an nDOM tile in UTM32 metres, and the kilometres it spans.

    Taken from the filename rather than the GeoTIFF tags: the LGL writes these without a model
    tiepoint, and the name is authoritative — `ndom1_32_503_5374_1_bw.tif` is the square kilometre
    at E 503 000 / N 5 374 000, and NRW's `ndom50_32353_5643_1_nw_2025.tif` is the one at
    E 353 000 / N 5 643 000.
    """
    match = TILE_RE.search(path.name)
    if not match:
        raise ValueError(f"{path.name}: cannot read a tile origin from the name")
    return (
        float(match.group(1)) * 1000.0,
        float(match.group(2)) * 1000.0,
        float(match.group(3)) * 1000.0,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="tuebingen")
    parser.add_argument("--min-height", type=float, default=3.0, help="metres of canopy")
    parser.add_argument("--max-height", type=float, default=50.0)
    parser.add_argument("--spacing", type=float, default=6.0, help="minimum metres between stems")
    parser.add_argument("--limit", type=int, default=60_000)
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    out_dir = terrain_dir(cfg)

    # ⚠️ THE SURVEY AUTHORITY COMES FROM THE AOI, NOT FROM THIS FILE. These three strings used to
    # be hard-coded to the LGL, because Tübingen was the only AOI that had ever taken this route.
    # The moment a second state uses it, that constant credits Baden-Württemberg for Nordrhein-
    # Westfalen's data — a false attribution printed in the app's own provenance block, which is
    # the one kind of error this project cannot afford to make quietly.
    _geobasis = cfg.get("geobasis") or {}
    geobasis_authority = _geobasis.get("authority", "unknown survey authority")
    geobasis_licence = _geobasis.get("licence", "unknown")
    geobasis_attribution = _geobasis.get("attribution", "")

    terrain_meta = json.loads((out_dir / "heightmap.json").read_text(encoding="utf-8"))
    origin_e = float(terrain_meta["origin"]["easting"])
    origin_n = float(terrain_meta["origin"]["northing"])
    res = float(terrain_meta["resolutionM"])
    grid_w = int(terrain_meta["width"])
    grid_h = int(terrain_meta["height"])
    width_m = grid_w * res
    depth_m = grid_h * res
    top_n = origin_n + depth_m

    heights_u16 = np.frombuffer(
        (out_dir / "heightmap.u16").read_bytes(), dtype="<u2"
    ).reshape(grid_h, grid_w)
    # `heightScale` is (max - min) / 65535, so the decode is linear. Taken from the metadata rather
    # than recomputed, because this must match what the browser does to the same bytes.
    h_min = float(terrain_meta["heightMinM"])
    h_scale = float(terrain_meta["heightScale"])
    ground_grid = h_min + heights_u16.astype(np.float32) * h_scale

    # ── canopy mosaic on the terrain grid ────────────────────────────────────
    canopy = np.zeros((grid_h, grid_w), dtype=np.float32)
    # ⚠️ TWO PRODUCT NAMES, ONE LAYER. Baden-Württemberg publishes `nDOM1` at 1 m; Nordrhein-
    # Westfalen publishes `nDOM50` at 50 cm. They are the same KIND of thing — a normalised surface
    # model, height above ground — and this builder only cares about that, so it accepts either
    # rather than making the caller lie about which one it downloaded.
    #
    # The lazy fix was to have the NRW fetcher write into `data/ndom1/`, which would have worked
    # today and left a directory of 50 cm rasters filed under a name that says 1 m. A resolution
    # recorded wrongly is the kind of thing that is believed later.
    tiles: list[Path] = []
    ndom_product = "nDOM"
    for product in ("ndom1", "ndom50"):
        found = sorted(cache_dir(product, cfg["id"]).glob("*.tif"))
        if found:
            ndom_product = product.replace("ndom", "nDOM")
        tiles.extend(found)
    if not tiles:
        raise SystemExit(
            f"no nDOM tiles for '{cfg['id']}' — run "
            f"tools/geodata/fetch_lgl_bw.py --aoi {cfg['id']} --product ndom1 (Baden-Württemberg) "
            f"or tools/geodata/fetch_nrw.py --aoi {cfg['id']} --product ndom50 (Nordrhein-Westfalen)"
        )

    placed = 0
    for path in tiles:
        tile_e, tile_n, span_m = tile_origin(path)
        data = np.asarray(Image.open(path), dtype=np.float32)
        tile_h, tile_w = data.shape

        # ⚠️ THE GROUND RESOLUTION IS DERIVED, NOT ASSUMED. This loop used to read
        # `tile_top = tile_n + tile_h  # 1 m posting`, which is true for Baden-Württemberg's nDOM1
        # and false for Nordrhein-Westfalen's nDOM50: the NRW tile covers the same square kilometre
        # in 2000 x 2000 pixels at 50 cm. Left alone, that arithmetic puts the tile's top edge a
        # kilometre too far north and samples it at half scale — and it raises NOTHING. The canopy
        # would simply have appeared in the wrong place, or not at all, with a plausible tile count
        # printed underneath it.
        pixel_m = span_m / tile_w
        tile_top = tile_n + span_m

        # Sample the tile at the terrain grid's cell centres.
        #
        # ⚠️ THE `- 0.5` AND THE `rint` ARE LOAD-BEARING, NOT STYLE. Dividing by `pixel_m` and
        # switching to a plain `floor` looks equivalent and is not: `cols - tile_e` lands on exact
        # integers here, where `rint(x - 0.5)` rounds half-to-even and `floor(x)` does not, so the
        # two disagree by one pixel on every sample. Measured — the "equivalent" version changed
        # Tübingen's vegetation.bin. Scale the coordinate, keep the rounding.
        cols = np.arange(grid_w) * res + origin_e + res / 2
        rows = top_n - (np.arange(grid_h) * res + res / 2)
        cx = np.rint((cols - tile_e) / pixel_m - 0.5).astype(np.int64)
        ry = np.rint((tile_top - rows) / pixel_m - 0.5).astype(np.int64)
        col_ok = (cx >= 0) & (cx < tile_w)
        row_ok = (ry >= 0) & (ry < tile_h)
        if not col_ok.any() or not row_ok.any():
            continue
        patch = data[np.ix_(ry[row_ok], cx[col_ok])]
        target = canopy[np.ix_(np.where(row_ok)[0], np.where(col_ok)[0])]
        canopy[np.ix_(np.where(row_ok)[0], np.where(col_ok)[0])] = np.maximum(target, patch)
        placed += 1

    canopy[~np.isfinite(canopy)] = 0.0
    print(f"canopy: {placed} nDOM tiles, max {canopy.max():.1f} m")

    # ── restrict to vegetated land cover ─────────────────────────────────────
    landuse_meta_path = out_dir / "landuse.json"
    if not landuse_meta_path.exists():
        raise SystemExit("landuse.json missing — run build_landuse.py first")
    landuse_meta = json.loads(landuse_meta_path.read_text(encoding="utf-8"))
    raw = gzip.decompress((out_dir / landuse_meta["file"]).read_bytes())
    landuse = np.frombuffer(raw, dtype=np.uint8).reshape(
        int(landuse_meta["height"]), int(landuse_meta["width"])
    )
    vegetated = np.isin(landuse, list(VEGETATION_CLASSES))
    print(f"vegetated land cover: {vegetated.mean():.1%} of the AOI")

    # ── local maxima = stems ─────────────────────────────────────────────────
    candidate = canopy.copy()
    candidate[~vegetated] = 0.0
    candidate[candidate < args.min_height] = 0.0
    candidate[candidate > args.max_height] = 0.0

    window = max(3, int(round(args.spacing / res)) | 1)
    peaks = (candidate == ndimage.maximum_filter(candidate, size=window)) & (candidate > 0)
    rows_idx, cols_idx = np.nonzero(peaks)
    print(f"{len(rows_idx):,} local maxima at {window * res:.0f} m window")

    order = np.argsort(-candidate[rows_idx, cols_idx])
    rows_idx, cols_idx = rows_idx[order], cols_idx[order]

    cell = max(args.spacing, res)
    claimed: set[tuple[int, int]] = set()
    records: list[tuple[int, int, int, int, int, int]] = []
    kept_heights: list[float] = []

    for r, c in zip(rows_idx, cols_idx):
        height = float(candidate[r, c])
        easting = origin_e + (c + 0.5) * res
        northing = top_n - (r + 0.5) * res
        key = (int((easting - origin_e) // cell), int((northing - origin_n) // cell))
        if key in claimed:
            continue
        claimed.add(key)

        ground = float(ground_grid[r, c])
        x = easting - origin_e - width_m / 2
        z = (top_n - northing) - depth_m / 2
        radius = min(max(height * CROWN_RATIO, CROWN_MIN_M), CROWN_MAX_M)
        records.append(
            (
                int(round(x)),
                int(round(z)),
                int(round(min(max(ground, 0.0), 6553.5) * 10)),
                int(round(min(height, 51.0) / 0.2)),
                int(round(min(radius, 25.5) * 10)),
                128,  # crown form: unknown, and constant — the nDOM records no species either.
            )
        )
        kept_heights.append(height)
        if len(records) >= args.limit:
            break

    if not records:
        raise SystemExit("no canopy found inside the AOI")

    payload = bytearray()
    for x, z, ground, height, radius, form in records:
        payload += struct.pack("<hhHBBB", x, z, ground, height, radius, form)

    (out_dir / "vegetation.bin").write_bytes(bytes(payload))
    stats = np.array(kept_heights)
    (out_dir / "vegetation.json").write_text(
        json.dumps(
            {
                "aoi": cfg["id"],
                "count": len(records),
                "stride": 9,
                "encoding": "int16 x, int16 z (m, terrain centre), uint16 ground (dm), "
                "uint8 height (0.2 m), uint8 crown radius (dm), uint8 form",
                "heightM": {
                    "min": round(float(stats.min()), 1),
                    "median": round(float(np.median(stats)), 1),
                    "max": round(float(stats.max()), 1),
                },
                "source": f"Normalisiertes Oberflächenmodell {ndom_product}, {geobasis_authority}",
                "licence": geobasis_licence,
                "attribution": geobasis_attribution,
                "provenance": "derived",
                "derivationNote": (
                    "⚠️ DERIVED, not surveyed. This state publishes no tree cadastre, so "
                    "each tree here is a local maximum in the nDOM canopy-height raster, "
                    f"thresholded at {args.min_height:.0f} m and thinned to {cell:.0f} m spacing. "
                    "Detection is restricted to vegetated OSM land cover because the nDOM cannot "
                    "tell a gable from a crown, so street trees on paved surfaces are missing by "
                    "design. Heights are measured; positions and counts are inferred; crown radius "
                    f"is {CROWN_RATIO:.2f} x height and species is unknown."
                ),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\n{len(records):,} trees, {stats.min():.1f} / {np.median(stats):.1f} / {stats.max():.1f} m")
    print(f"wrote {out_dir / 'vegetation.bin'} ({len(payload) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()

"""Build the coarse terrain shell — the horizon around the photoreal core.

PLAN §4.1 / §7 phase 1 step 4. The shell does two jobs. It stops a cross-country flight from
running off the edge of the map, and it *is* the horizon: a photoreal box that ends in a cliff of
nothing reads as a diorama, whereas Alps continuing into the distance read as Alps.

The interesting part is the seam, because the two tiers do not measure the same thing:

  core   LDBV DGM1  — bare earth,  DHHN2016, 1 m
  shell  Copernicus — canopy+roofs, EGM2008, 30 m

So the shell sits *above* the core where they meet. ⚠️ That offset is **measured in the overlap
ring and never assumed to be zero** — and the measurement is deliberately split in two, because
the two contributions mean different things. Over all cells the median difference is dominated by
**canopy**, which is a real difference in what the datasets measure and must not be removed. Over
**open ground** what remains is the systematic part — the datum difference — and that is what gets
subtracted globally.

For this AOI the split is stark: +3.2 m over all cells, −0.1 m over open ground. Applying the
former would have pushed every open valley in the shell three metres underground in order to make
the forests line up.

The residual local mismatch is feathered across a transition band by the renderer, which blends
shell elevations toward core elevations as it approaches the core boundary.

Output (into public/terrain/<aoi-id>/):
  shell_30m.u16   uint16 little-endian, row-major, row 0 = north
  shell_30m.json  grid, UTM origin, the measured offset, and the core rectangle in shell metres

Usage
  python tools/geodata/build_shell.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from aoi import bbox_wsen, cache_dir, load_aoi, load_world, terrain_dir
from utm import bbox_to_utm32, utm32_to_wgs84, utm32_to_wgs84_array

#: Width of the ring, inside the core boundary, used to measure the seam offset. Wide enough to
#: average over a few hundred shell cells, narrow enough that it describes the seam rather than the
#: whole AOI.
RING_WIDTH_M = 900.0

#: Cells where the shell stands more than this above the core are canopy or buildings, not datum.
#: Used only to report the two contributions separately — the applied offset uses the median of all
#: of them, because all of them are what has to be removed for the join to disappear.
OPEN_GROUND_MAX_M = 3.0


def sample_geographic(
    grid: np.ndarray, meta: dict, lon: np.ndarray, lat: np.ndarray
) -> np.ndarray:
    """Bilinear sample of a north-up geographic raster at arrays of lon/lat."""
    col = (lon - meta["lonWest"]) / meta["lonStep"]
    row = (meta["latNorth"] - lat) / meta["latStep"]

    height, width = grid.shape
    col = np.clip(col, 0, width - 1.001)
    row = np.clip(row, 0, height - 1.001)

    c0 = col.astype(np.int32)
    r0 = row.astype(np.int32)
    fc = (col - c0).astype(np.float32)
    fr = (row - r0).astype(np.float32)

    top = grid[r0, c0] * (1 - fc) + grid[r0, c0 + 1] * fc
    bottom = grid[r0 + 1, c0] * (1 - fc) + grid[r0 + 1, c0 + 1] * fc
    return top * (1 - fr) + bottom * fr


def load_core(aoi_id: str) -> tuple[np.ndarray, dict]:
    directory = terrain_dir({"id": aoi_id})
    meta = json.loads((directory / "heightmap_4m.json").read_text(encoding="utf-8"))
    raw = (directory / meta["file"]).read_bytes()
    quantised = np.frombuffer(raw, dtype="<u2").reshape(meta["height"], meta["width"])
    grid = quantised.astype(np.float32) * float(meta["heightScale"]) + float(meta["heightMinM"])
    return grid, meta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument(
        "--world",
        help="build the union shell for a world in config/world/, spanning every site (PLAN §8)",
    )
    parser.add_argument("--resolution", type=int, default=None)
    args = parser.parse_args()

    cfg = load_world(args.world) if args.world else load_aoi(args.aoi)

    # A world shell reconciles itself against EVERY site's core; a per-AOI shell against its own.
    # This is the only structural difference between the two modes.
    site_ids: list[str] = cfg["sites"] if args.world else [cfg["id"]]

    resolution = args.resolution or int(cfg["shellGrids"]["renderResolutionM"])

    source_dir = cache_dir("copdem", cfg["id"])
    array_path = source_dir / "shell.npy"
    if not array_path.exists():
        raise SystemExit(f"{array_path} not found — run tools/geodata/fetch_copdem.py first")
    dem = np.load(array_path)
    dem_meta = json.loads((source_dir / "shell.json").read_text(encoding="utf-8"))
    print(f"source: {dem.shape[1]} x {dem.shape[0]} geographic cells, {dem.min():.0f}..{dem.max():.0f} m")

    # ── Output grid, in UTM32 so it shares a coordinate system with the core ──────────────
    min_e, min_n, max_e, max_n = bbox_to_utm32(*bbox_wsen(cfg, "shell"))
    origin_e = int(min_e // resolution * resolution)
    origin_n = int(min_n // resolution * resolution)
    width = int((max_e - origin_e) // resolution) + 1
    height = int((max_n - origin_n) // resolution) + 1
    top_n = origin_n + height * resolution
    print(f"shell grid: {width} x {height} at {resolution} m ({width * resolution / 1000:.1f} x {height * resolution / 1000:.1f} km)")

    eastings = origin_e + (np.arange(width, dtype=np.float64) + 0.5) * resolution
    northings = top_n - (np.arange(height, dtype=np.float64) + 0.5) * resolution
    grid_e, grid_n = np.meshgrid(eastings, northings)
    lon, lat = utm32_to_wgs84_array(grid_e, grid_n)
    shell = sample_geographic(dem, dem_meta, lon, lat).astype(np.float32)
    print(f"resampled: {shell.min():.1f} .. {shell.max():.1f} m")

    # ── The seam offset, measured ────────────────────────────────────────────────────────
    #
    # ⚠️ Measured against EVERY core, and pooled. The offset being removed is the systematic
    # EGM2008-vs-DHHN2016 datum difference, which is a property of the region rather than of one
    # valley — so with several sites the honest estimate is one median over the pooled ring cells
    # of all of them, not a per-site fudge. The residual difference at each individual boundary is
    # what the transition band exists to absorb, and it is sub-metre here either way.
    core_rects: list[dict] = []
    core_grids: list[tuple[np.ndarray, dict]] = []
    pooled_difference: list[np.ndarray] = []
    per_site_offset: dict[str, float] = {}

    for site_id in site_ids:
        core, core_meta = load_core(site_id)
        core_grids.append((core, core_meta))
        core_origin_e = float(core_meta["origin"]["easting"])
        core_origin_n = float(core_meta["origin"]["northing"])
        core_res = float(core_meta["resolutionM"])
        core_top_n = core_origin_n + core_meta["height"] * core_res
        core_east = core_origin_e + core_meta["width"] * core_res

        core_rects.append(
            {
                "site": site_id,
                "easting": core_origin_e,
                "northing": core_origin_n,
                "widthM": core_meta["width"] * core_res,
                "heightM": core_meta["height"] * core_res,
            }
        )

        # Shell cell centres, in this core's grid coordinates.
        core_col = (grid_e - core_origin_e) / core_res
        core_row = (core_top_n - grid_n) / core_res
        inside_core = (
            (core_col >= 0)
            & (core_col < core_meta["width"] - 1)
            & (core_row >= 0)
            & (core_row < core_meta["height"] - 1)
        )

        # Distance from each shell cell to the nearest core edge, positive inside.
        depth_m = np.minimum.reduce(
            [
                grid_e - core_origin_e,
                core_east - grid_e,
                grid_n - core_origin_n,
                core_top_n - grid_n,
            ]
        )
        ring = inside_core & (depth_m > 0) & (depth_m < RING_WIDTH_M)
        if ring.sum() < 50:
            raise SystemExit(
                f"the overlap ring for '{site_id}' is too small to measure an offset "
                f"({int(ring.sum())} cells) — is its core inside the shell bbox?"
            )

        core_at_ring = core[core_row[ring].astype(np.int32), core_col[ring].astype(np.int32)]
        site_difference = shell[ring] - core_at_ring
        pooled_difference.append(site_difference)

        site_open = site_difference[site_difference <= OPEN_GROUND_MAX_M]
        per_site_offset[site_id] = float(np.median(site_open))
        print(
            f"  {site_id:<12} ring {int(ring.sum()):>6} cells, "
            f"open-ground median {per_site_offset[site_id]:+.2f} m"
        )

    difference = np.concatenate(pooled_difference)

    offset_all = float(np.median(difference))
    open_ground = difference[difference <= OPEN_GROUND_MAX_M]
    offset_open = float(np.median(open_ground))

    # ⚠️ Which median to apply matters, and the two disagree by metres.
    #
    # Over ALL cells the median is dominated by forest, because the shell is a surface model and
    # the core is bare earth — that difference is canopy, not datum, and it is a real difference in
    # what the two datasets measure rather than an error to be removed. Subtracting it would push
    # every open valley in the shell below its true elevation to make the forests line up.
    #
    # Over OPEN GROUND ONLY, what is left is the systematic part: the EGM2008 vs DHHN2016 datum
    # difference plus any bias in the source. That is the component that should be removed
    # globally. The residual canopy mismatch at the boundary is what the transition band is for.
    offset = offset_open

    print(f"\n=== seam offset, pooled over {len(site_ids)} core(s), {difference.size} ring cells ===")
    print(f"  median over all cells : {offset_all:+.2f} m   (dominated by canopy)")
    print(f"  mean over all cells   : {np.mean(difference):+.2f} m")
    print(f"  p10 / p90             : {np.percentile(difference, 10):+.2f} / {np.percentile(difference, 90):+.2f} m")
    print(
        f"  median on open ground : {offset_open:+.2f} m   <- applied "
        f"({open_ground.size} of {difference.size} cells at or below {OPEN_GROUND_MAX_M:.0f} m)"
    )

    shell -= offset

    # ── Quantise ─────────────────────────────────────────────────────────────────────────
    z_min = float(shell.min())
    z_max = float(shell.max())
    scale = (z_max - z_min) / 65535.0
    quantised = np.round((shell - z_min) / scale).astype(np.uint16)

    lon_w, lat_s = utm32_to_wgs84(origin_e, origin_n)
    lon_e, lat_n = utm32_to_wgs84(origin_e + width * resolution, top_n)

    metadata = {
        "width": width,
        "height": height,
        "resolutionM": resolution,
        "crs": "EPSG:25832",
        "origin": {"easting": origin_e, "northing": origin_n},
        "heightMinM": round(z_min, 3),
        "heightMaxM": round(z_max, 3),
        "heightScale": scale,
        "encoding": "uint16-le, row-major, row 0 = north",
        "boundsWgs84": {
            "west": round(lon_w, 6),
            "south": round(lat_s, 6),
            "east": round(lon_e, 6),
            "north": round(lat_n, 6),
        },
        # The core rectangle, in the same UTM metres, so the renderer can fade the shell into the
        # core and then stop drawing it where the core takes over.
        #
        # `core` stays for a single-site shell so nothing that reads it has to change; `cores` is
        # the list every site contributes to and is what a world shell is really about.
        "core": {
            "easting": core_rects[0]["easting"],
            "northing": core_rects[0]["northing"],
            "widthM": core_rects[0]["widthM"],
            "heightM": core_rects[0]["heightM"],
        },
        "cores": core_rects,
        "sites": site_ids,
        "transitionBandM": cfg["shellGrids"]["transitionBandM"],
        "seamOffsetM": round(offset, 3),
        "seamOffsetPerSiteM": {k: round(v, 3) for k, v in per_site_offset.items()},
        "seamOffsetAllCellsM": round(offset_all, 3),
        "seamOffsetNote": (
            "Median of (shell - core) over open ground in a "
            f"{RING_WIDTH_M:.0f} m ring inside the core boundary "
            f"({int(open_ground.size)} of {int(difference.size)} ring cells). Open ground is "
            f"isolated because the shell is a SURFACE model and the core is bare earth: over all "
            f"cells the median is {offset_all:+.2f} m, but that figure is canopy height, which is "
            "a genuine difference in what the two datasets measure rather than an error. What "
            "remains on open ground is the systematic part - the EGM2008 vs DHHN2016 datum "
            "difference - and only that is removed globally. It is a seam alignment, not a "
            "geodetic datum determination, and must not be cited as one."
        ),
        "verticalDatum": "shifted onto the core's DHHN2016 by the measured seam offset",
        "source": dem_meta["source"],
        "licence": dem_meta["licence"],
        "attribution": dem_meta["attribution"],
        "surface": dem_meta["surface"],
        "sourceAcquisition": "Copernicus DEM GLO-30, retrieved 2026-07",
    }

    out_dir = terrain_dir(cfg)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"shell_{resolution}m"
    raw_path = out_dir / f"{name}.u16"
    raw_path.write_bytes(quantised.astype("<u2").tobytes())
    metadata["file"] = raw_path.name
    meta_path = out_dir / f"{name}.json"
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"\nshell after offset: {z_min:.1f} .. {z_max:.1f} m")
    print(f"wrote {raw_path} ({raw_path.stat().st_size / 1e6:.1f} MB)")
    print(f"wrote {meta_path}")


if __name__ == "__main__":
    main()

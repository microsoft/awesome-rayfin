"""Mosaic the LDBV DGM1 tiles into the browser terrain grid for the AOI core.

PLAN §4.3 / §7 phase 1 step 3: 1 m source, **4 m render grid**, mesh decimated 4× to 16 m posting.

Output (into public/terrain/<aoi-id>/):
  heightmap_4m.u16        uint16 little-endian, row-major, north-to-south (image order)
  heightmap_4m_nodata.u8  255 where the cell was filled rather than measured
  heightmap_4m.json       grid size, UTM origin, height scale/offset, focus places, attribution

uint16 rather than float32 halves the download for no meaningful loss. The core spans about
1 400 m of relief, so 65 535 steps give ~2 cm of vertical resolution — an order of magnitude finer
than DGM1's own stated accuracy.

Two things about the Bavarian tiles differ from the Rhineland-Palatinate ones this pipeline was
originally written against, and both matter:

  * **Edge tiles are clipped to the state boundary.** `604_5245.tif` on the Austrian border is
    936 × 1000 px. So a tile's extent is read from its GeoTIFF tiepoint and its actual shape, never
    inferred from its filename.
  * **Tiles carry −9999 nodata inside them**, where the state border cuts across a full square.
    Those cells are filled from the nearest measured neighbour and flagged in the nodata mask.

Usage
  python tools/geodata/build_terrain.py
  python tools/geodata/build_terrain.py --resolution 2 --name heightmap_2m
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from aoi import bbox_wsen, cache_dir, load_aoi, terrain_dir
from utm import bbox_to_utm32, utm32_to_wgs84, wgs84_to_utm32

#: DGM1 marks unmeasured ground with −9999. Anything near it is nodata, not a very deep valley.
NODATA_BELOW = -1000.0

#: Guard against a tile that is georeferenced somewhere else entirely. The AOI is ~8 × 9 km, so a
#: tile more than this far outside the grid is a fetch or naming fault, not an edge case.
MAX_STRAY_M = 5000


def read_tile(path: Path) -> tuple[np.ndarray, float, float]:
    """Return (elevations, origin_easting, origin_northing) for one DGM1 tile.

    The origin is the tile's NORTH-WEST corner, taken from the GeoTIFF model tiepoint. Reading it
    from the file rather than parsing the filename is what makes clipped border tiles work: they
    keep their nominal origin and simply lose cells off the east or south edge.
    """
    image = Image.open(path)
    tiepoint = image.tag_v2.get(33922)
    if not tiepoint or len(tiepoint) < 6:
        raise ValueError(f"{path.name}: no model tiepoint")
    data = np.array(image, dtype=np.float32)
    data[data <= NODATA_BELOW] = np.nan
    return data, float(tiepoint[3]), float(tiepoint[4])


def build(
    tile_dir: Path,
    bbox_utm: tuple[float, float, float, float],
    resolution: int,
    focus_places: list[dict] | None = None,
    flying_sites: list[dict] | None = None,
) -> tuple[np.ndarray, dict, np.ndarray]:
    min_e, min_n, max_e, max_n = bbox_utm

    # Snap the grid origin to a whole multiple of the resolution so cells line up with the source.
    origin_e = int(min_e // resolution * resolution)
    origin_n = int(min_n // resolution * resolution)
    width = int((max_e - origin_e) // resolution) + 1
    height = int((max_n - origin_n) // resolution) + 1
    top_n = origin_n + height * resolution
    print(f"grid: {width} x {height} cells at {resolution} m")
    print(f"origin (UTM32): {origin_e} E, {origin_n} N")

    grid = np.full((height, width), np.nan, dtype=np.float32)

    tiles = sorted(tile_dir.glob("*.tif"))
    if not tiles:
        raise SystemExit(f"no DGM1 tiles in {tile_dir} — run tools/geodata/fetch_bvv.py first")
    print(f"mosaicking {len(tiles)} tiles...")

    placed = 0
    for index, path in enumerate(tiles, start=1):
        data, tile_e, tile_top_n = read_tile(path)

        # Subsample from 1 m to the render resolution. The offset keeps the sampled cells aligned
        # to the output grid: a tile whose origin is not a multiple of the resolution would
        # otherwise be written half a cell out of place, which shows up as a 2 m ripple along every
        # tile seam once the hillshade lands on it.
        col_offset = int((-(tile_e - origin_e)) % resolution)
        row_offset = int((-(top_n - tile_top_n)) % resolution)
        sub = data[row_offset::resolution, col_offset::resolution]
        rows, cols = sub.shape

        col0 = int((tile_e + col_offset - origin_e) // resolution)
        row0 = int((top_n - tile_top_n + row_offset) // resolution)

        if col0 < -MAX_STRAY_M or row0 < -MAX_STRAY_M:
            raise ValueError(f"{path.name} is georeferenced far outside the AOI grid")

        src_r0 = max(0, -row0)
        src_c0 = max(0, -col0)
        dst_r0 = max(0, row0)
        dst_c0 = max(0, col0)
        copy_rows = min(rows - src_r0, height - dst_r0)
        copy_cols = min(cols - src_c0, width - dst_c0)
        if copy_rows <= 0 or copy_cols <= 0:
            continue

        patch = sub[src_r0 : src_r0 + copy_rows, src_c0 : src_c0 + copy_cols]
        target = grid[dst_r0 : dst_r0 + copy_rows, dst_c0 : dst_c0 + copy_cols]
        # Only write where this tile actually measured something, so a tile that is mostly nodata
        # cannot punch a hole in ground its neighbour already covered.
        np.copyto(target, patch, where=np.isfinite(patch))
        placed += 1

        if index % 25 == 0:
            print(f"  {index}/{len(tiles)}")

    print(f"  {placed} tiles intersected the grid")

    filled = np.isfinite(grid)
    coverage = filled.mean() * 100
    print(f"coverage: {coverage:.1f}% of cells have data")
    if coverage < 50:
        raise SystemExit("less than half the grid has data — the tile set does not match the AOI")

    z_min = float(np.nanmin(grid))
    z_max = float(np.nanmax(grid))
    print(f"elevation range: {z_min:.2f} .. {z_max:.2f} m")

    # Gaps are structural, not accidental: the AOI envelope reaches across the Austrian border
    # where this dataset stops, and the UTM envelope of a geographic bbox bows outside the bbox
    # itself at the corners.
    #
    # Fill them from the NEAREST measured cell. Filling with a constant creates a visible cliff at
    # the AOI edge, and filling with the minimum is worse still — it drops a pit into the terrain
    # exactly where the eye is drawn along the border. Nearest-neighbour blends in, and the nodata
    # mask records which cells were invented so nothing downstream mistakes them for survey.
    gaps = ~filled
    if gaps.any():
        print(f"  {gaps.sum()} cells ({gaps.mean() * 100:.2f}%) have no data -> nearest-neighbour fill")
        _, indices = ndimage.distance_transform_edt(gaps, return_indices=True)
        grid = grid[tuple(indices)]
    nodata_mask = gaps

    scale = (z_max - z_min) / 65535.0
    quantised = np.round((grid - z_min) / scale).astype(np.uint16)

    lon_w, lat_s = utm32_to_wgs84(origin_e, origin_n)
    lon_e, lat_n = utm32_to_wgs84(origin_e + width * resolution, top_n)

    # Project the focus places into normalised grid coordinates so the front end can frame them
    # without carrying a projection implementation of its own.
    def project(entries: list[dict]) -> list[dict]:
        out = []
        for entry in entries:
            e, n = wgs84_to_utm32(entry["lon"], entry["lat"])
            u = (e - origin_e) / (width * resolution)
            v = (top_n - n) / (height * resolution)  # row 0 = north
            if not (0 <= u <= 1 and 0 <= v <= 1):
                print(f"  {entry['name']}: OUTSIDE the terrain grid (u={u:.3f} v={v:.3f}) - skipped")
                continue
            row = int(np.clip(v * height, 0, height - 1))
            col = int(np.clip(u * width, 0, width - 1))
            ground = float(grid[row, col])
            record = {
                "id": entry["id"],
                "name": entry["name"],
                "u": round(float(u), 5),
                "v": round(float(v), 5),
                "groundM": round(ground, 2),
            }
            if entry.get("kind"):
                record["kind"] = entry["kind"]
            # An independent elevation, where one is published, is the only thing that can say
            # whether this coordinate is where it claims to be. It is reported, never rendered.
            published = entry.get("publishedEleM")
            if published:
                record["publishedEleM"] = published
                print(
                    f"  {entry['name']}: u={u:.3f} v={v:.3f} ground={ground:.1f} m "
                    f"(published {published} m, delta {ground - published:+.1f} m)"
                )
            else:
                print(f"  {entry['name']}: u={u:.3f} v={v:.3f} ground={ground:.1f} m")
            out.append(record)
        return out

    places = project(focus_places or [])
    sites = project(flying_sites or [])

    metadata = {
        "width": width,
        "height": height,
        "resolutionM": resolution,
        "crs": "EPSG:25832",
        "verticalDatum": "DHHN2016",
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
        "coveragePct": round(coverage, 2),
        "focusPlaces": places,
        "flyingSites": sites,
        "nodataFill": "nearest",
        "nodataNote": (
            "Cells without DGM1 data — the AOI envelope reaches across the Austrian border where "
            "this dataset stops, and the UTM envelope of a geographic bbox bows outside the bbox "
            "at its corners — are filled from the nearest measured cell for appearance, and "
            "flagged in the nodata mask. See PLAN.md §4.1."
        ),
        "source": "DGM1, Bayerische Vermessungsverwaltung (LDBV)",
        "sourceAcquisition": "LDBV open data, retrieved 2026-07",
        "attribution": (
            "Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de "
            "[Daten bearbeitet]"
        ),
        "licence": "CC BY 4.0",
    }
    return quantised, metadata, nodata_mask


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument("--tiles", type=Path, default=None)
    parser.add_argument("--resolution", type=int, default=None, help="output grid spacing, metres")
    parser.add_argument("--name", default=None, help="output basename (default heightmap_<res>m)")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    resolution = args.resolution or int(cfg["grids"]["renderResolutionM"])
    tile_dir = args.tiles or cache_dir("dgm1", cfg["id"])
    bbox_utm = bbox_to_utm32(*bbox_wsen(cfg, "core"))

    grid, metadata, nodata_mask = build(
        tile_dir, bbox_utm, resolution, cfg.get("focusPlaces"), cfg.get("flyingSites")
    )

    out_dir = terrain_dir(cfg)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = args.name or f"heightmap_{resolution}m"

    raw_path = out_dir / f"{name}.u16"
    raw_path.write_bytes(grid.astype("<u2").tobytes())
    metadata["file"] = raw_path.name

    nodata_path = out_dir / f"{name}_nodata.u8"
    nodata_path.write_bytes((nodata_mask * 255).astype(np.uint8).tobytes())
    metadata["nodataFile"] = nodata_path.name

    meta_path = out_dir / f"{name}.json"
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"\nwrote {raw_path} ({raw_path.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"wrote {meta_path}")


if __name__ == "__main__":
    main()

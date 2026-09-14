"""Pack the Copernicus DEM window into the browser's coarse horizon tier.

PLAN §4.1. Without this the photoreal core sits on the sea as a slab and reads as a diorama; it is
also what gives a ~41 km sensor horizon real coastline to end on rather than the edge of the data.

🔴 **The two tiers do not share a vertical datum, and the offset is MEASURED rather than assumed.**
The core is bare-earth DGM1 on DHHN2016; the shell is Copernicus GLO-30, a **surface** model on
EGM2008 that includes canopy and buildings. The offset is taken over the overlap ring **on land
only** — over water the comparison is meaningless, and over forest it would be measuring canopy
height and calling it a datum. What is removed is the systematic part, and the note in the
descriptor says plainly that this is a seam alignment and not a geodetic datum determination.

Usage
  python tools/geodata/build_shell.py
"""

from __future__ import annotations

import argparse
import gzip
import json
import time

import numpy as np

from aoi import bbox_wsen, cache_dir, load_aoi, terrain_dir
from utm import bbox_to_utm32, utm32_to_wgs84_array

#: Same reasoning as the core: a step inside the source's own accuracy, not a payload target.
#: GLO-30 is a 30 m global product; a decimetre is already far below what it resolves.
VERTICAL_STEP_M = 0.25

#: 🔴 Store the shell at the posting it is actually DRAWN at.
#:
#: The renderer had been decimating the 30 m grid by 3 before building the horizon mesh, so eight
#: of every nine stored samples were downloaded, gzipped, shipped and then skipped. Block-meaning
#: to 90 m here costs nothing visible — it is the same geometry the scene was already producing —
#: and it is what pays for the window being several times wider than before.
#:
#: A MEAN, not the block maximum used for the line-of-sight surface: this tier is scenery seen
#: from 40 km away, where averaging reads as gentler relief, whereas the LOS surface must never
#: lose a ridge because a ridge is what casts a shadow.
STORE_FACTOR = 3


def block_mean(grid: np.ndarray, factor: int) -> np.ndarray:
    """Average factor x factor blocks, ignoring NaN so coastal gaps do not eat whole cells."""
    h = (grid.shape[0] // factor) * factor
    w = (grid.shape[1] // factor) * factor
    blocks = grid[:h, :w].reshape(h // factor, factor, w // factor, factor)
    with np.errstate(invalid="ignore"):
        return np.nanmean(blocks, axis=(1, 3)).astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    source = cache_dir("copdem", cfg["id"])
    array_path = source / "shell.npy"
    meta_path = source / "shell.json"
    if not array_path.exists():
        raise SystemExit("no Copernicus window cached — run tools/geodata/fetch_copdem.py")

    shell = np.load(array_path).astype(np.float32)
    src = json.loads(meta_path.read_text(encoding="utf-8"))
    print(f"source {shell.shape[1]} x {shell.shape[0]} @ "
          f"{cfg['shellGrids']['sourceResolutionM']} m")

    if STORE_FACTOR > 1:
        shell = block_mean(shell, STORE_FACTOR)
        # The corner longitudes/latitudes still bound the same window; only the sample count
        # changes, and linspace below rebuilds the axes from those corners.
        print(f"stored  {shell.shape[1]} x {shell.shape[0]} @ "
              f"{cfg['shellGrids']['sourceResolutionM'] * STORE_FACTOR} m "
              f"(block mean {STORE_FACTOR}x{STORE_FACTOR})")

    height, width = shell.shape
    print(f"shell {width} x {height}, {np.nanmin(shell):.1f} .. {np.nanmax(shell):.1f} m")

    # 🔴 Do NOT build the grid from `latStep`'s sign. The reader stores it as a positive magnitude
    # while row 0 is the NORTH edge, so `latNorth + i * latStep` walks upwards out of the window
    # and every overlap test comes back empty — which is exactly what happened, and it reported as
    # "0 overlap cells" rather than as an error. The two corners are unambiguous; use them.
    lons = np.linspace(src["lonWest"], src["lonEast"], width)
    lats = np.linspace(src["latNorth"], src["latSouth"], height)

    # ------------------------------------------------------------------ seam
    core = json.loads((terrain_dir(cfg) / "heightmap_4m.json").read_text(encoding="utf-8"))
    core_raw = np.frombuffer(
        gzip.decompress((terrain_dir(cfg) / core["file"]).read_bytes()), dtype="<u2"
    ).reshape(core["height"], core["width"])
    core_elev = core["heightMinM"] + core_raw.astype(np.float32) * core["heightScale"]
    core_land = np.frombuffer(
        gzip.decompress((terrain_dir(cfg) / core["landMaskFile"]).read_bytes()), dtype=np.uint8
    ).reshape(core_elev.shape).astype(bool)

    res = core["resolutionM"]
    core_e0 = core["origin"]["easting"]
    core_n1 = core["origin"]["northing"] + core["height"] * res

    # Compare by walking the CORE and sampling the shell, not the other way round: the core grid
    # is regular in UTM and `utm32_to_wgs84_array` is vectorised, where projecting every shell
    # cell meant 7.3 M Python calls.
    stride = 8
    rows_c = np.arange(0, core["height"], stride)
    cols_c = np.arange(0, core["width"], stride)
    cc, rr = np.meshgrid(cols_c, rows_c)
    east_c = core_e0 + (cc + 0.5) * res
    north_c = core_n1 - (rr + 0.5) * res
    lon_c, lat_c = utm32_to_wgs84_array(east_c, north_c)

    shell_col = np.rint((lon_c - src["lonWest"]) / (lons[1] - lons[0])).astype(np.int32)
    shell_row = np.rint((lat_c - src["latNorth"]) / (lats[1] - lats[0])).astype(np.int32)
    inside = ((shell_col >= 0) & (shell_col < width)
              & (shell_row >= 0) & (shell_row < height))

    core_sample = core_elev[rr, cc]
    land_sample = core_land[rr, cc]
    shell_sample = np.full(core_sample.shape, np.nan, dtype=np.float32)
    shell_sample[inside] = shell[shell_row[inside], shell_col[inside]]

    on_land = inside & land_sample & np.isfinite(shell_sample)
    diff = shell_sample[on_land] - core_sample[on_land]
    offset = float(np.median(diff)) if diff.size else 0.0
    every = inside & np.isfinite(shell_sample)
    all_diff = shell_sample[every] - core_sample[every]
    print(f"  overlap samples {int(every.sum())}, of which land {int(on_land.sum())}")
    print(f"  seam offset over LAND ONLY : {offset:+.3f} m  (this is what gets removed)")
    print(f"  offset over ALL cells      : {float(np.median(all_diff)):+.3f} m  "
          f"(canopy, buildings and water — NOT a datum)")

    aligned = shell - offset

    # ------------------------------------------------------------------ pack
    lo = float(np.nanmin(aligned))
    hi = float(np.nanmax(aligned))
    levels = (hi - lo) / VERTICAL_STEP_M
    if levels > 65535:
        raise SystemExit(f"{hi - lo:.0f} m at {VERTICAL_STEP_M} m needs {levels:.0f} levels")
    quantised = np.rint((np.nan_to_num(aligned, nan=lo) - lo) / VERTICAL_STEP_M).astype(np.uint16)
    payload = gzip.compress(quantised.tobytes(), 6)

    west, south, east_deg, north_deg = bbox_wsen(cfg, "core")
    ce0, cn0, ce1, cn1 = bbox_to_utm32(west, south, east_deg, north_deg)

    out = terrain_dir(cfg)
    # 🔴 Name the file after what is actually in it. Storing 90 m samples in something called
    # `shell_30m` is the sort of quiet lie that survives for years and gets cited as a source
    # resolution by someone who was not here.
    stored_res = int(cfg["shellGrids"]["sourceResolutionM"]) * STORE_FACTOR
    stem = f"shell_{stored_res}m"
    (out / f"{stem}.u16z").write_bytes(payload)
    descriptor = {
        "width": width,
        "height": height,
        "resolutionM": stored_res,
        "sourceResolutionM": int(cfg["shellGrids"]["sourceResolutionM"]),
        "resolutionNote": (
            f"Source is Copernicus GLO-30 at 30 m, stored here at {stored_res} m by a "
            f"{STORE_FACTOR}x{STORE_FACTOR} block MEAN. The renderer was already decimating the "
            "30 m grid before building the horizon mesh, so the finer samples were shipped and "
            "then skipped; storing what is drawn is what pays for the wider window."
        ),
        "lonWest": src["lonWest"],
        "lonEast": src["lonEast"],
        "latNorth": src["latNorth"],
        "latSouth": src["latSouth"],
        "lonStep": src["lonStep"],
        "latStep": src["latStep"],
        "heightMinM": round(lo, 3),
        "heightMaxM": round(hi, 3),
        "heightScale": VERTICAL_STEP_M,
        "encoding": "uint16-le, row-major, row 0 = north, gzip",
        "file": f"{stem}.u16z",
        "bytes": int(quantised.nbytes),
        "compressedBytes": len(payload),
        "seamOffsetM": round(offset, 3),
        "seamOffsetAllCellsM": round(float(np.median(all_diff)), 3),
        "seamOffsetNote": (
            "Median of (shell - core) over the overlap, ON LAND ONLY. The shell is a SURFACE "
            "model on EGM2008 and the core is bare earth on DHHN2016, so over canopy and "
            "buildings the difference is object height rather than datum; over water it is "
            "meaningless. Only the land-only figure is removed. This is a seam alignment and "
            "must not be cited as a geodetic datum determination."
        ),
        # The renderer cuts this rectangle out of the shell so the two tiers never overlap.
        "coreUtm": {"e0": ce0, "n0": cn0, "e1": ce1, "n1": cn1},
        "surface": "DSM (canopy and buildings included)",
        "verticalDatum": "shifted onto the core's DHHN2016 by the measured seam offset",
        "source": src.get("source", "Copernicus DEM GLO-30"),
        "licence": src.get("licence", ""),
        "attribution": src.get("attribution", ""),
        "builtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out / f"{stem}.json").write_text(
        json.dumps(descriptor, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n  {stem}.u16z  {quantised.nbytes / 1e6:.1f} MB raw -> "
          f"{len(payload) / 1e6:.2f} MB gzipped ({quantised.nbytes / len(payload):.1f}x)")
    print(f"  written to {out}")


if __name__ == "__main__":
    main()


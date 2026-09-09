"""Fetch the Copernicus DEM window for the AOI's coarse shell tier.

PLAN §5.2. The shell is the horizon (§4.1): a photoreal box that ends in a cliff of nothing reads
as a diorama, so the terrain has to continue into the distance. It also has to cross the Austrian
border, where LDBV stops — which is why this uses a pan-European source rather than stitching the
Vorarlberg and Tirol portals onto the fetcher.

**This reads the file as a Cloud-Optimized GeoTIFF rather than downloading it.** A GLO-30 tile is
one degree square and 40 MB; the Oberstdorf shell is 0.4° × 0.3° of it. A COG stores its raster in
independently compressed tiles and publishes their byte ranges in the header, so the fetcher reads
the ~34 KB header, works out which tiles overlap the AOI, and range-requests only those. For this
AOI that is 4 tiles of 16 — about a quarter of the file, and it would be a far smaller fraction
for a smaller AOI.

⚠️ Two caveats, both real and both handled downstream in build_shell.py rather than hidden here:

  * **It is a DSM, not a DTM.** Copernicus DEM includes canopy and buildings; DGM1 is bare earth.
    The shell therefore sits roughly a tree-height above the core where they meet.
  * **It is on EGM2008, not DHHN2016.** The two tiers do not share a vertical datum, so the offset
    between them is *measured in the overlap ring* and never assumed to be zero.

Output (into data/copdem/<aoi-id>/):
  shell.npy   float32 elevation, row-major, row 0 = NORTH
  shell.json  window geographic bounds, pixel size, source tiles, attribution

Usage
  python tools/geodata/fetch_copdem.py
  python tools/geodata/fetch_copdem.py --aoi oberstdorf --force
"""

from __future__ import annotations

import argparse
import io
import json
import urllib.request
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from aoi import bbox_wsen, cache_dir, load_aoi

USER_AGENT = "Gleitschirm-Insights/0.1 (open geodata pipeline)"

# TIFF tags this reader needs.
TAG_TILE_WIDTH = 322
TAG_TILE_LENGTH = 323
TAG_TILE_OFFSETS = 324
TAG_TILE_BYTECOUNTS = 325
TAG_COMPRESSION = 259
TAG_PREDICTOR = 317
TAG_BITS_PER_SAMPLE = 258
TAG_SAMPLE_FORMAT = 339
TAG_PIXEL_SCALE = 33550
TAG_TIEPOINT = 33922
TAG_GEO_KEYS = 34735

COMPRESSION_NONE = 1
COMPRESSION_DEFLATE_ADOBE = 8
COMPRESSION_DEFLATE = 32946

#: GeoTIFF GTRasterTypeGeoKey. 1 = PixelIsArea (tiepoint is a pixel *corner*),
#: 2 = PixelIsPoint (tiepoint is a pixel *centre*). Half a pixel is 15 m here, which is nothing at
#: 90 m posting — but it is exactly the kind of quiet half-cell shift that shows up later as a
#: seam between the two tiers, so it is read rather than assumed.
GEOKEY_RASTER_TYPE = 1025
RASTER_PIXEL_IS_AREA = 1


@dataclass(frozen=True)
class CogHeader:
    width: int
    height: int
    tile_width: int
    tile_height: int
    tile_offsets: tuple[int, ...]
    tile_bytecounts: tuple[int, ...]
    compression: int
    predictor: int
    lon_origin: float
    lat_origin: float
    lon_step: float
    lat_step: float

    @property
    def tiles_across(self) -> int:
        return (self.width + self.tile_width - 1) // self.tile_width

    def lon_of(self, col: float) -> float:
        return self.lon_origin + col * self.lon_step

    def lat_of(self, row: float) -> float:
        return self.lat_origin - row * self.lat_step


def http_range(url: str, start: int, length: int) -> bytes:
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{start + length - 1}"}
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status != 206:
            raise RuntimeError(f"server ignored the range request (HTTP {response.status})")
        return response.read()


def read_header(url: str, probe_bytes: int = 65536) -> CogHeader:
    """Parse the COG header from its first few kilobytes.

    A COG is laid out header-first precisely so this works: the IFD and the tile offset table sit
    at the front of the file, before any raster data.
    """
    blob = http_range(url, 0, probe_bytes)
    image = Image.open(io.BytesIO(blob))
    tags = image.tag_v2

    bits = tags.get(TAG_BITS_PER_SAMPLE, (32,))
    sample_format = tags.get(TAG_SAMPLE_FORMAT, (3,))
    if tuple(bits) != (32,) or tuple(sample_format) != (3,):
        raise RuntimeError(f"expected 32-bit float samples, got bits={bits} format={sample_format}")

    scale = tags.get(TAG_PIXEL_SCALE)
    tiepoint = tags.get(TAG_TIEPOINT)
    if not scale or not tiepoint:
        raise RuntimeError("raster is not georeferenced — no pixel scale or tiepoint")

    lon_origin = float(tiepoint[3])
    lat_origin = float(tiepoint[4])
    lon_step = float(scale[0])
    lat_step = float(scale[1])

    # GeoTIFF geo keys are a flat list of 4-tuples after a 4-value header.
    raster_type = RASTER_PIXEL_IS_AREA
    keys = tags.get(TAG_GEO_KEYS)
    if keys:
        for index in range(4, len(keys), 4):
            if keys[index] == GEOKEY_RASTER_TYPE:
                raster_type = keys[index + 3]
                break
    if raster_type == RASTER_PIXEL_IS_AREA:
        # Move the origin to the centre of the first pixel, so `lon_of`/`lat_of` mean the same
        # thing regardless of which convention the file uses.
        lon_origin += lon_step / 2
        lat_origin -= lat_step / 2

    offsets = tags.get(TAG_TILE_OFFSETS)
    counts = tags.get(TAG_TILE_BYTECOUNTS)
    if not offsets or not counts:
        raise RuntimeError("raster is stripped, not tiled — this reader needs a tiled COG")

    return CogHeader(
        width=image.size[0],
        height=image.size[1],
        tile_width=int(tags[TAG_TILE_WIDTH]),
        tile_height=int(tags[TAG_TILE_LENGTH]),
        tile_offsets=tuple(int(v) for v in offsets),
        tile_bytecounts=tuple(int(v) for v in counts),
        compression=int(tags.get(TAG_COMPRESSION, COMPRESSION_NONE)),
        predictor=int(tags.get(TAG_PREDICTOR, 1)),
        lon_origin=lon_origin,
        lat_origin=lat_origin,
        lon_step=lon_step,
        lat_step=lat_step,
    )


def undo_float_predictor(raw: np.ndarray, rows: int, cols: int) -> np.ndarray:
    """Reverse TIFF predictor 3, the floating-point predictor.

    Predictor 3 does two things to each row before compression: it splits every float into its
    bytes and groups all the most-significant bytes together, then all the second bytes, and so on
    (so that similar exponents end up adjacent and compress well), then delta-encodes the result
    horizontally. Both are undone here, in reverse order.

    ⚠️ The byte planes are stored MOST-SIGNIFICANT FIRST, regardless of the file's byte order.
    libtiff writes plane `b` into byte `bps-1-b` of each little-endian sample, so un-shuffling the
    planes in their natural order produces every float byte-reversed — which does not fail, it
    silently yields values around ±3.4e38. Getting an elevation model back that spans the entire
    float range is the symptom of exactly this.
    """
    row_bytes = raw.reshape(rows, cols * 4)

    # Horizontal accumulate, byte-wise with uint8 wraparound.
    accumulated = np.cumsum(row_bytes, axis=1, dtype=np.uint8)

    # De-shuffle: plane 0 holds the most significant byte, so the planes are reversed to get
    # little-endian sample order back.
    planes = accumulated.reshape(rows, 4, cols)
    interleaved = planes[:, ::-1, :].transpose(0, 2, 1)
    return np.ascontiguousarray(interleaved).view("<f4").reshape(rows, cols)


def decode_tile(blob: bytes, header: CogHeader) -> np.ndarray:
    if header.compression in (COMPRESSION_DEFLATE_ADOBE, COMPRESSION_DEFLATE):
        raw = zlib.decompress(blob)
    elif header.compression == COMPRESSION_NONE:
        raw = blob
    else:
        raise RuntimeError(f"unsupported TIFF compression {header.compression}")

    expected = header.tile_width * header.tile_height * 4
    if len(raw) != expected:
        raise RuntimeError(f"tile decompressed to {len(raw)} bytes, expected {expected}")

    if header.predictor == 3:
        return undo_float_predictor(
            np.frombuffer(raw, dtype=np.uint8), header.tile_height, header.tile_width
        )
    if header.predictor == 1:
        return np.frombuffer(raw, dtype="<f4").reshape(header.tile_height, header.tile_width)
    raise RuntimeError(f"unsupported TIFF predictor {header.predictor}")


def read_window(
    url: str, header: CogHeader, west: float, south: float, east: float, north: float
) -> tuple[np.ndarray, dict]:
    """Read just the tiles overlapping a geographic window."""
    # Pixel indices of the requested window, clamped to the raster.
    col0 = int(np.floor((west - header.lon_origin) / header.lon_step))
    col1 = int(np.ceil((east - header.lon_origin) / header.lon_step))
    row0 = int(np.floor((header.lat_origin - north) / header.lat_step))
    row1 = int(np.ceil((header.lat_origin - south) / header.lat_step))
    col0, col1 = max(0, col0), min(header.width - 1, col1)
    row0, row1 = max(0, row0), min(header.height - 1, row1)
    if col1 <= col0 or row1 <= row0:
        raise RuntimeError("the AOI window does not overlap this DEM tile")

    tile_c0, tile_c1 = col0 // header.tile_width, col1 // header.tile_width
    tile_r0, tile_r1 = row0 // header.tile_height, row1 // header.tile_height
    wanted = (tile_c1 - tile_c0 + 1) * (tile_r1 - tile_r0 + 1)
    total = len(header.tile_offsets)
    print(f"  window: cols {col0}..{col1}, rows {row0}..{row1}")
    print(f"  reading {wanted} of {total} COG tiles")

    out_h = row1 - row0 + 1
    out_w = col1 - col0 + 1
    window = np.full((out_h, out_w), np.nan, dtype=np.float32)

    fetched_bytes = 0
    for tile_row in range(tile_r0, tile_r1 + 1):
        for tile_col in range(tile_c0, tile_c1 + 1):
            index = tile_row * header.tiles_across + tile_col
            offset = header.tile_offsets[index]
            count = header.tile_bytecounts[index]
            if count == 0:
                continue  # sparse COGs are allowed to omit empty tiles
            blob = http_range(url, offset, count)
            fetched_bytes += len(blob)
            tile = decode_tile(blob, header)

            # Where this tile lands in the output window.
            src_r0 = max(0, row0 - tile_row * header.tile_height)
            src_c0 = max(0, col0 - tile_col * header.tile_width)
            src_r1 = min(header.tile_height, row1 + 1 - tile_row * header.tile_height)
            src_c1 = min(header.tile_width, col1 + 1 - tile_col * header.tile_width)
            dst_r0 = tile_row * header.tile_height + src_r0 - row0
            dst_c0 = tile_col * header.tile_width + src_c0 - col0
            window[
                dst_r0 : dst_r0 + (src_r1 - src_r0), dst_c0 : dst_c0 + (src_c1 - src_c0)
            ] = tile[src_r0:src_r1, src_c0:src_c1]

    print(f"  fetched {fetched_bytes / 1e6:.1f} MB of raster")

    meta = {
        "width": out_w,
        "height": out_h,
        "lonWest": header.lon_of(col0),
        "lonEast": header.lon_of(col1),
        "latNorth": header.lat_of(row0),
        "latSouth": header.lat_of(row1),
        "lonStep": header.lon_step,
        "latStep": header.lat_step,
        "fetchedBytes": fetched_bytes,
    }
    return window, meta


def mosaic(windows: list[tuple[np.ndarray, dict]]) -> tuple[np.ndarray, dict]:
    """Stitch several 1°×1° DEM windows into one grid.

    One tile covered the whole Alpine shell, so this stayed unwritten — deliberately, with a loud
    `NotImplementedError` rather than untested code that would silently produce a wrong map. The
    Tübingen shell is 19 km wide and straddles 9°E, so it is now a real case.

    The tiles are pasted, not resampled. Copernicus GLO-30 varies its longitude spacing by latitude
    band, but every tile here sits in the same band, so the grids share a step and align exactly.
    That assumption is asserted rather than assumed — a mismatch would show up as terrain sheared
    by a fraction of a pixel per column, which is exactly the kind of error nobody sees until the
    horizon looks subtly wrong.
    """
    lon_steps = {round(m["lonStep"], 12) for _, m in windows}
    lat_steps = {round(m["latStep"], 12) for _, m in windows}
    if len(lon_steps) != 1 or len(lat_steps) != 1:
        raise RuntimeError(
            f"DEM tiles disagree on pixel spacing (lon {lon_steps}, lat {lat_steps}) — "
            "they are from different latitude bands and cannot be pasted together"
        )

    lon_step = windows[0][1]["lonStep"]
    lat_step = windows[0][1]["latStep"]
    lon_west = min(m["lonWest"] for _, m in windows)
    lon_east = max(m["lonEast"] for _, m in windows)
    lat_north = max(m["latNorth"] for _, m in windows)
    lat_south = min(m["latSouth"] for _, m in windows)

    width = int(round((lon_east - lon_west) / lon_step)) + 1
    height = int(round((lat_north - lat_south) / lat_step)) + 1
    out = np.full((height, width), np.nan, dtype=np.float32)

    print(f"\nmosaicking {len(windows)} DEM windows -> {width}x{height}")
    for data, m in windows:
        col = int(round((m["lonWest"] - lon_west) / lon_step))
        row = int(round((lat_north - m["latNorth"]) / lat_step))
        patch = out[row : row + data.shape[0], col : col + data.shape[1]]
        # Neighbouring tiles share their edge column; prefer whichever one actually has data.
        out[row : row + data.shape[0], col : col + data.shape[1]] = np.where(
            np.isfinite(data), data, patch
        )
        print(f"  {m['lonWest']:.4f}..{m['lonEast']:.4f} E at column {col}, row {row}")

    meta = {
        "width": width,
        "height": height,
        "lonWest": lon_west,
        "lonEast": lon_east,
        "latNorth": lat_north,
        "latSouth": lat_south,
        "lonStep": lon_step,
        "latStep": lat_step,
        "fetchedBytes": sum(m["fetchedBytes"] for _, m in windows),
        "mosaickedTiles": len(windows),
    }
    return out, meta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oth-regensburg")
    parser.add_argument("--force", action="store_true", help="re-fetch even if the window is cached")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    shell = cfg["shellGeobasis"]
    west, south, east, north = bbox_wsen(cfg, "shell")

    destination = cache_dir("copdem", cfg["id"])
    array_path = destination / "shell.npy"
    meta_path = destination / "shell.json"
    if array_path.exists() and meta_path.exists() and not args.force:
        print(f"cached: {array_path} (use --force to re-fetch)")
        return

    print(f"shell window: {west}..{east} E, {south}..{north} N")

    windows: list[tuple[np.ndarray, dict]] = []
    for tile_id in shell["tiles"]:
        ns, ew = tile_id.split("_")
        url = shell["cogUrlTemplate"].format(
            NS=ns[0], lat=int(ns[1:]), EW=ew[0], lon=int(ew[1:])
        )
        print(f"\n{tile_id}: {url}")
        header = read_header(url)
        print(
            f"  {header.width}x{header.height}, tiles {header.tile_width}x{header.tile_height}, "
            f"compression {header.compression}, predictor {header.predictor}"
        )
        windows.append(read_window(url, header, west, south, east, north))

    if len(windows) == 1:
        window, meta = windows[0]
    else:
        window, meta = mosaic(windows)

    finite = np.isfinite(window)
    print(f"\nelevation: {np.nanmin(window):.1f} .. {np.nanmax(window):.1f} m")
    print(f"coverage: {finite.mean() * 100:.1f}%")

    # ⚠️ Sanity gate on the decode, not on the data. A mis-applied TIFF predictor does not raise —
    # it returns a full array of plausible-looking float32 that happens to span ±3.4e38. Checking
    # that the result looks like ground is the only thing standing between a byte-order slip and a
    # terrain model built from nonsense.
    low, high = float(np.nanmin(window)), float(np.nanmax(window))
    if not (-500 < low < 9000 and -500 < high < 9000):
        raise RuntimeError(
            f"decoded elevations span {low:.1f}..{high:.1f} m, which is not terrain — "
            "the compression or predictor handling is wrong"
        )

    np.save(array_path, window)
    meta.update(
        {
            "aoi": cfg["id"],
            "tier": "shell",
            "source": shell["authority"],
            "licence": shell["licence"],
            "attribution": shell["attribution"],
            "tiles": shell["tiles"],
            "verticalDatum": "EGM2008",
            "surface": "DSM (canopy and buildings included)",
            "elevationMinM": float(np.nanmin(window)),
            "elevationMaxM": float(np.nanmax(window)),
        }
    )
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"\nwrote {array_path} ({array_path.stat().st_size / 1e6:.1f} MB)")
    print(f"wrote {meta_path}")


if __name__ == "__main__":
    main()

"""Bake the Baden-Württemberg DOP20 orthophoto drape — PLAN Phase 6.

The Bavarian drape (`fetch_dop20.py`) asks a WMS for one big image in UTM32 and is done. LGL has no
equivalent open WMS, so this takes the other route the portal exposes: the **GeoWebCache layer
`DOP_20_C`**, which serves the same 20 cm imagery as 256 px JPEG tiles in Web Mercator.

Two consequences, and both are the whole reason this file exists rather than a flag on the Bavarian
script:

**The tiles are EPSG:3857 and everything else here is EPSG:25832.** A drape that disagrees with the
terrain by even a few metres does not look like a projection error — it looks like the *buildings*
are in the wrong place, which this project has already learned the expensive way. So the output is
resampled pixel by pixel: for every cell of the UTM32 output grid, project to WGS84, then to Web
Mercator, then sample. The same inverse projection the Copernicus shell already uses.

**Zoom 18, not the finest available.** The service goes to 0.299 m/px at zoom 19, which over this
AOI would be an 8 600 px drape for a mesh at 4 m posting. Zoom 18 gives 0.597 m/px — within a
percent of Garching's 0.62 — so the two sites look like the same app.

Source: Digitale Orthophotos DOP20, LGL Baden-Württemberg.
Licence: dl-de/by-2-0 — *Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0*.

Usage
  python tools/geodata/fetch_dop20_bw.py --aoi tuebingen
"""

from __future__ import annotations

import argparse
import concurrent.futures
import io
import json
import math
import time
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

from aoi import cache_dir, load_aoi, terrain_dir
from utm import utm32_to_wgs84_array

TILE_BASE = "https://opengeodata.lgl-bw.de/tiles"
LAYER = "DOP_20_C"
GRIDSET = "GoogleMapsCompatible"
USER_AGENT = "Campus-Insights/0.1 (open geodata pipeline; +https://opengeodata.lgl-bw.de)"

ATTRIBUTION = "Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0"
TILE_PX = 256
EARTH = 20037508.3427892

#: Deepest level the cache is seeded to, measured by probing: 0.299 m/px. Beyond it the service
#: 404s rather than rendering on demand.
MAX_ZOOM = 19

Image.MAX_IMAGE_PIXELS = None


def tile_url(z: int, x: int, y_xyz: int) -> str:
    """GeoWebCache's on-disk path, which is what this service exposes.

    ⚠️ Two things here are not guessable and both were found by watching the portal rather than by
    reading anything:

    **It is not an XYZ endpoint.** GWC serves its `FilePathGenerator` layout directly:
    `{layer}/{gridset}_{zz}/{x/half}_{y/half}/{x}_{y}.jpeg`, where `half = 2 << (z / 2)` and the
    zero-padding width is `digits` for the folder and `2 * digits` for the file. Every plausible
    XYZ or TMS-service URL 404s.

    **The Y axis is TMS, counted from the south.** The first working request the portal made was
    `…_09/08_10/0268_0335.jpeg`, and 335 is 511 − 176 — the XYZ row for this latitude mirrored.
    Feeding XYZ rows straight in returns 404 for every tile on earth, which reads exactly like
    "outside coverage" and is why the first run of this script fetched 675 tiles and got nothing.
    """
    y = (2**z) - 1 - y_xyz
    half = 2 << (z // 2)
    digits = 1 if half <= 10 else math.ceil(math.log10(half))
    return (
        f"{TILE_BASE}/{LAYER}/{GRIDSET}_{z:02d}/"
        f"{x // half:0{digits}d}_{y // half:0{digits}d}/"
        f"{x:0{2 * digits}d}_{y:0{2 * digits}d}.jpeg"
    )


def mercator(lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """WGS84 degrees to EPSG:3857 metres."""
    x = np.radians(lon) * 6378137.0
    y = np.log(np.tan(np.pi / 4 + np.radians(np.clip(lat, -85.05, 85.05)) / 2)) * 6378137.0
    return x, y


def fetch_tile(z: int, x: int, y: int, attempts: int = 3) -> Image.Image | None:
    url = tile_url(z, x, y)
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": USER_AGENT, "Referer": "https://opengeodata.lgl-bw.de/"},
            )
            with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
                return Image.open(io.BytesIO(response.read())).convert("RGB")
        except urllib.error.HTTPError as exc:
            # Outside the published extent is a fact about the coverage, not a failure.
            if exc.code in (404, 204):
                return None
        except Exception:  # noqa: BLE001 - network, retried
            pass
        time.sleep(2 * (attempt + 1))
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="tuebingen")
    parser.add_argument("--zoom", type=int, default=18)
    parser.add_argument("--max-px", type=int, default=None)
    parser.add_argument("--quality", type=int, default=88)
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    meta_path = terrain_dir(cfg) / "heightmap.json"
    if not meta_path.exists():
        raise SystemExit(f"{meta_path} not found — run build_terrain.py first")
    terrain = json.loads(meta_path.read_text(encoding="utf-8"))

    # ⚠️ The drape is pinned to the HEIGHTMAP's grid, not recomputed from the config bbox. The two
    # differ by a few metres because the terrain grid snaps to whole multiples of its resolution,
    # and taking the config would offset the photograph against the ground it is painted on.
    origin_e = float(terrain["origin"]["easting"])
    origin_n = float(terrain["origin"]["northing"])
    span_e = terrain["width"] * terrain["resolutionM"]
    span_n = terrain["height"] * terrain["resolutionM"]
    top_n = origin_n + span_n

    max_px = args.max_px or int(cfg.get("drape", {}).get("maxPx", 4096))
    resolution = max(span_e, span_n) / max_px
    width = int(round(span_e / resolution))
    height = int(round(span_n / resolution))

    print(f"AOI {cfg['id']} — DOP20 (LGL GeoWebCache, zoom {args.zoom})")
    print(f"  ground: {span_e:.0f} x {span_n:.0f} m from {origin_e:.0f}/{origin_n:.0f}")
    print(f"  drape:  {width} x {height} px at {resolution:.3f} m/px")

    # Output pixel centres in UTM32, then the same points in Web Mercator.
    xs = origin_e + (np.arange(width) + 0.5) * resolution
    ys = top_n - (np.arange(height) + 0.5) * resolution
    grid_e, grid_n = np.meshgrid(xs, ys)
    lon, lat = utm32_to_wgs84_array(grid_e, grid_n)
    merc_x, merc_y = mercator(lon, lat)

    scale = (2 * EARTH) / (TILE_PX * 2**args.zoom)  # metres per pixel at this zoom
    px = (merc_x + EARTH) / scale
    py = (EARTH - merc_y) / scale

    tile_x0, tile_x1 = int(np.floor(px.min() / TILE_PX)), int(np.floor(px.max() / TILE_PX))
    tile_y0, tile_y1 = int(np.floor(py.min() / TILE_PX)), int(np.floor(py.max() / TILE_PX))
    columns = tile_x1 - tile_x0 + 1
    rows = tile_y1 - tile_y0 + 1
    print(f"  tiles:  {columns} x {rows} = {columns * rows}")

    cache = cache_dir("raw", "lgl", cfg["id"], f"dop20_z{args.zoom}")
    mosaic = np.zeros((rows * TILE_PX, columns * TILE_PX, 3), dtype=np.uint8)

    def load(job: tuple[int, int]) -> tuple[int, int, Image.Image | None]:
        tx, ty = job
        path = cache / f"{tx}_{ty}.jpg"
        if path.exists():
            try:
                return tx, ty, Image.open(path).convert("RGB")
            except Exception:  # noqa: BLE001 - a corrupt cache entry is re-fetched
                path.unlink(missing_ok=True)
        tile = fetch_tile(args.zoom, tx, ty)
        if tile is not None:
            tile.save(path, quality=92)
        return tx, ty, tile

    jobs = [(tx, ty) for ty in range(tile_y0, tile_y1 + 1) for tx in range(tile_x0, tile_x1 + 1)]
    missing = 0
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for tx, ty, tile in pool.map(load, jobs):
            done += 1
            if tile is None:
                missing += 1
                continue
            oy = (ty - tile_y0) * TILE_PX
            ox = (tx - tile_x0) * TILE_PX
            mosaic[oy : oy + TILE_PX, ox : ox + TILE_PX] = np.asarray(tile)
            if done % 50 == 0:
                print(f"    {done}/{len(jobs)} tiles")
    if missing:
        print(f"  {missing} tiles outside coverage")

    # Nearest-neighbour resample. The output is finer than the mesh under it and a bilinear pass
    # over a photograph mostly costs sharpness.
    src_x = np.clip((px - tile_x0 * TILE_PX).astype(np.int64), 0, mosaic.shape[1] - 1)
    src_y = np.clip((py - tile_y0 * TILE_PX).astype(np.int64), 0, mosaic.shape[0] - 1)
    drape = mosaic[src_y, src_x]

    out_dir = terrain_dir(cfg)
    out_path = out_dir / "drape.jpg"
    Image.fromarray(drape).save(out_path, quality=args.quality, optimize=True)

    (out_dir / "drape.json").write_text(
        json.dumps(
            {
                "aoi": cfg["id"],
                "file": "drape.jpg",
                "width": width,
                "height": height,
                "resolutionM": round(resolution, 4),
                "crs": "EPSG:25832",
                "origin": {"easting": origin_e, "northing": origin_n},
                "spanM": {"east": span_e, "north": span_n},
                "encoding": "JPEG, row 0 = north — same orientation as the heightmap",
                "source": "Digitale Orthophotos DOP20, LGL Baden-Württemberg",
                "service": f"{TILE_BASE}/{LAYER} (GeoWebCache, EPSG:3857, TMS rows)",
                "zoom": args.zoom,
                "licence": "dl-de/by-2-0",
                "attribution": ATTRIBUTION,
                "resolutionNote": (
                    "The source is 20 cm. This drape is resampled to about 0.6 m per pixel because "
                    "the terrain mesh beneath it is at 4 m posting. Reprojected from Web Mercator "
                    "to UTM32 against the heightmap's own grid. It is a photograph of the ground, "
                    "not a measurement, and nothing is derived from it."
                ),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\nwrote {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)")
    print(ATTRIBUTION)


if __name__ == "__main__":
    main()

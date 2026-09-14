"""Fetch the DOP20 orthophoto drape for the AOI core, via the LDBV WMS.

PLAN §7 phase 1 step 9 — the last terrain layer, and the one that makes the map photoreal rather
than cartographic.

⚠️ **This replaces the tile-download plan in §5.1, and the saving is large.** The plan assumed
DOP20 had to be pulled as 1 km GeoTIFF tiles — roughly 6 GB raw for this AOI — and mitigated that
with a streaming fetcher that downsampled and deleted each tile as it went. It turns out DOP20 is
not published as addressable tiles at all: the catalogue offers it by municipality, by district, or
as a **WMS**. A WMS is strictly better for a drape, because the request specifies the exact extent
*and the exact output resolution*. So instead of downloading 6 GB at 20 cm and throwing 97 % of it
away, this asks for the AOI once at the resolution the browser will actually use, and gets about
ten megabytes.

Resolution is a deliberate trade, not the source resolution:

  * 20 cm over a 9.6 x 8.5 km core would be 48 000 x 42 000 px — 2 gigapixels, which no browser
    will hold and no GPU will sample.
  * The terrain mesh underneath is at 16 m posting. Detail far finer than that has nothing to sit
    on and only costs download.
  * 8192 px on the long side gives ~1.2 m per pixel, which is sharp enough to read individual
    buildings, roads and the treeline, and fits inside the 8192 texture limit that WebGL2
    guarantees.

The WMS caps a single request at 6500 px, so the mosaic is stitched from a few requests.

Output (public/terrain/<aoi-id>/):
  drape.jpg    the mosaic
  drape.json   extent, resolution, attribution

Usage
  python tools/geodata/fetch_dop20.py
  python tools/geodata/fetch_dop20.py --max-px 4096      # a lighter drape
"""

from __future__ import annotations

import argparse
import io
import json
import time
import urllib.parse
import urllib.request

from PIL import Image

from aoi import bbox_wsen, load_aoi, terrain_dir
from utm import bbox_to_utm32

WMS = "https://dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD"

#: Verified 2026-07-29 against the service's GetCapabilities. `by_dop20c` is the true-colour
#: layer; the generic names the catalogue text suggests (`DOP20`, `dop20`) answer with a small
#: placeholder rather than imagery, which is exactly the failure that looks like success.
LAYER = "sh_dop20_rgb"

#: The service's advertised per-request limit.
MAX_REQUEST_PX = 6500

#: 🔴 A SECOND, UNADVERTISED limit: the service also caps how many *source* tiles one request may
#: touch ("max_tile_limit: 500"). The first AOI never hit it because its box is narrow; the second
#: one is 4 km wider and a full-width patch asked for 621 tiles, which fails with a WMS
#: ServiceException rather than a truncated image. Ground extent therefore has to bound the split
#: as well as pixel count. 50 km² per request leaves a wide margin under the observed ceiling
#: (621 tiles came from roughly 155 km²) and costs only a few more HTTP calls.
MAX_REQUEST_KM2 = 50.0

USER_AGENT = "Maritime-Insights/0.1 (open geodata pipeline; CC BY 4.0 LVermGeo SH)"


def get_map(bbox: tuple[float, float, float, float], width: int, height: int) -> Image.Image:
    """One WMS GetMap, in EPSG:25832.

    WMS 1.3.0 uses each CRS's own axis order. EPSG:25832 is easting-then-northing, so the bbox goes
    out as minE,minN,maxE,maxN — the same order everything else in this pipeline uses. (For a
    geographic CRS such as EPSG:4326 it would be latitude first, which is the classic WMS 1.3.0
    trap and the reason this stays in UTM throughout.)
    """
    params = {
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": "1.3.0",
        "LAYERS": LAYER,
        "STYLES": "",
        "CRS": "EPSG:25832",
        "BBOX": f"{bbox[0]:.2f},{bbox[1]:.2f},{bbox[2]:.2f},{bbox[3]:.2f}",
        "WIDTH": str(width),
        "HEIGHT": str(height),
        "FORMAT": "image/jpeg",
    }
    url = f"{WMS}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=300) as response:
        blob = response.read()
        content_type = response.headers.get("Content-Type", "")

    # A WMS reports failure as a 200 with an XML service exception. Saving that as .jpg and
    # carrying on is how a drape ends up as a grey rectangle three steps later.
    if "xml" in content_type or blob[:5] == b"<?xml":
        raise RuntimeError(f"WMS service exception: {blob[:400].decode('utf-8', 'replace')}")

    return Image.open(io.BytesIO(blob)).convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--max-px", type=int, default=8192, help="long side of the mosaic")
    parser.add_argument("--quality", type=int, default=84, help="output JPEG quality")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    out_dir = terrain_dir(cfg)
    out_dir.mkdir(parents=True, exist_ok=True)
    image_path = out_dir / "drape.jpg"
    meta_path = out_dir / "drape.json"
    if image_path.exists() and meta_path.exists() and not args.force:
        print(f"cached: {image_path} (use --force to re-fetch)")
        return

    # ⚠️ The drape has to line up with the heightmap exactly, so its extent is read from the
    # terrain metadata rather than recomputed from the bbox. build_terrain.py snaps the grid origin
    # to a whole multiple of the resolution; recomputing here would land a few metres off and slide
    # the whole photograph sideways across the mountain.
    terrain_meta_path = out_dir / "heightmap_4m.json"
    if terrain_meta_path.exists():
        terrain = json.loads(terrain_meta_path.read_text(encoding="utf-8"))
        min_e = float(terrain["origin"]["easting"])
        min_n = float(terrain["origin"]["northing"])
        max_e = min_e + terrain["width"] * terrain["resolutionM"]
        max_n = min_n + terrain["height"] * terrain["resolutionM"]
        print("extent taken from the generated heightmap")
    else:
        min_e, min_n, max_e, max_n = bbox_to_utm32(*bbox_wsen(cfg, "core"))
        print("⚠️ no heightmap yet — extent derived from the AOI bbox, which may not match")

    span_e = max_e - min_e
    span_n = max_n - min_n
    print(f"core: {span_e / 1000:.2f} x {span_n / 1000:.2f} km from {min_e:.0f}/{min_n:.0f}")

    if span_e >= span_n:
        width = args.max_px
        height = int(round(args.max_px * span_n / span_e))
    else:
        height = args.max_px
        width = int(round(args.max_px * span_e / span_n))

    print(f"mosaic: {width} x {height} px, {span_e / width:.2f} m per pixel")

    # How many requests each axis needs to stay inside the service's limits — both of them. The
    # pixel cap splits a large mosaic; the ground-area cap splits a large *footprint*, and they are
    # not the same constraint: a 202 km² AOI rendered at 8192 px needs one split for pixels and
    # four for tiles.
    cols = -(-width // MAX_REQUEST_PX)
    rows = -(-height // MAX_REQUEST_PX)
    while (span_e / cols) * (span_n / rows) / 1e6 > MAX_REQUEST_KM2:
        if span_e / cols >= span_n / rows:
            cols += 1
        else:
            rows += 1
    print(f"requests: {cols} x {rows} "
          f"({(span_e / cols) / 1000:.1f} x {(span_n / rows) / 1000:.1f} km each)")

    mosaic = Image.new("RGB", (width, height))
    started = time.time()
    done = 0

    for row in range(rows):
        # Pixel bounds of this patch. Computing them by rounding the fractional split keeps the
        # patches exactly adjacent — deriving each patch's size independently leaves one-pixel
        # seams that show up as a grid across the finished drape.
        y0 = round(row * height / rows)
        y1 = round((row + 1) * height / rows)
        for col in range(cols):
            x0 = round(col * width / cols)
            x1 = round((col + 1) * width / cols)

            # Pixel bounds back to ground coordinates. Row 0 is the NORTH edge, so northing
            # decreases as the row index grows.
            patch_bbox = (
                min_e + span_e * x0 / width,
                max_n - span_n * y1 / height,
                min_e + span_e * x1 / width,
                max_n - span_n * y0 / height,
            )
            patch = get_map(patch_bbox, x1 - x0, y1 - y0)
            mosaic.paste(patch, (x0, y0))
            done += 1
            print(f"  [{done}/{cols * rows}] {x1 - x0} x {y1 - y0} px, {time.time() - started:.0f}s")

    mosaic.save(image_path, "JPEG", quality=args.quality, optimize=True, progressive=True)

    meta = {
        "aoi": cfg["id"],
        "file": image_path.name,
        "width": width,
        "height": height,
        "resolutionM": round(span_e / width, 4),
        "crs": "EPSG:25832",
        "origin": {"easting": min_e, "northing": min_n},
        "spanM": {"east": span_e, "north": span_n},
        "encoding": "JPEG, row 0 = north — same orientation as the heightmap",
        "source": "Digitale Orthophotos DOP20, Landesamt für Vermessung und Geoinformation "
                  "Schleswig-Holstein (LVermGeo SH)",
        "service": WMS,
        "layer": LAYER,
        "licence": "CC BY 4.0",
        "attribution": (
            "Datenquelle: Landesamt für Vermessung und Geoinformation Schleswig-Holstein "
            "(LVermGeo SH), CC BY 4.0 [Daten bearbeitet]"
        ),
        "resolutionNote": (
            "The source is 20 cm. This drape is resampled by the WMS to about "
            f"{span_e / width:.1f} m per pixel, because the terrain mesh beneath it is at 16 m "
            "posting and a 2-gigapixel texture is neither loadable nor useful. It is a "
            "photograph of the ground, not a measurement, and nothing is derived from it."
        ),
        "acquisition": "LVermGeo SH Befliegung; the flight date varies by tile and is not "
                       "per-pixel. The catalogue dates the DOP20 tiles over this AOI to 2025, "
                       "two years after the DGM1 they are draped on.",
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\nwrote {image_path} ({image_path.stat().st_size / 1e6:.1f} MB)")
    print(f"wrote {meta_path}")


if __name__ == "__main__":
    main()

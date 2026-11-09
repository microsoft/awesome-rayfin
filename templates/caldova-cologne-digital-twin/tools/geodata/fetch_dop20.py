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

  * 20 cm over a large core would be gigapixels, which no browser will hold and no GPU will sample.
  * The terrain mesh underneath is at 4 m posting. Detail far finer than that has nothing to sit
    on and only costs download.
  * The long side is capped so the browser can build a full mipmap chain for it — see the note in
    `main()`. This is a rendering limit, not a limit of the imagery.

The WMS caps a single request at 6500 px, so the mosaic is stitched from a few requests.

Output (public/terrain/<aoi-id>/):
  drape.jpg    the mosaic
  drape.json   extent, resolution, attribution

⚠️ **`--extent shell` renders the SAME imagery over the coarse outer tier**, and it is the reason
the horizon stopped being a lie. The shell was painted by a hypsometric ramp — pasture green
low, rock white high — which on the Isar gravel plain is 60 m of relief over 20 km, i.e. one flat
pale-green sheet where Munich, the Isar, the Forstenrieder Park and the airport all render as the
same colour. Ten kilometres of invented land around a photographed campus reads as a model on a
table. The same orthophoto at a coarser sampling makes the boundary invisible instead, because
both tiers then show the SAME ground at two sharpnesses.

⚠️ **Size the shell mosaic to the SCREEN, not to the source.** One texel per screen pixel when the
whole shell is in frame is the most that can ever be seen: 21.8 km across a 1600 px viewport is
13.6 m per pixel. Asking for more costs texture memory — the number that decides whether the app
runs — and buys nothing at any camera this app allows.

Usage
  python tools/geodata/fetch_dop20.py
  python tools/geodata/fetch_dop20.py --max-px 4096      # a lighter drape
  python tools/geodata/fetch_dop20.py --extent shell --max-px 1600
"""

from __future__ import annotations

import argparse
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image, ImageStat

from aoi import bbox_wsen, load_aoi, terrain_dir
from utm import active_zone, bbox_to_utm

WMS = "https://geoservices.bayern.de/od/wms/dop/v1/dop20"

#: Verified 2026-07-29 against the service's GetCapabilities. `by_dop20c` is the true-colour
#: layer; the generic names the catalogue text suggests (`DOP20`, `dop20`) answer with a small
#: placeholder rather than imagery, which is exactly the failure that looks like success.
LAYER = "by_dop20c"

#: The service's advertised per-request limit.
MAX_REQUEST_PX = 6500

USER_AGENT = "caldova-cologne-digital-twin/0.1 (open geodata pipeline)"

#: ⚠️ PROVENANCE IS REBINDABLE, LIKE THE ENDPOINT. These four strings were written inline into
#: drape.json, so every adapter that reused this mosaic logic by rebinding WMS/LAYER (Berlin, and
#: Spain since 2026-10-06) still credited the Bayerische Vermessungsverwaltung for its photograph.
#: The defaults are the Bavarian text verbatim, so a Bavarian drape.json is unchanged.
DRAPE_SOURCE = "Digitale Orthophotos DOP20, Bayerische Vermessungsverwaltung (LDBV)"
DRAPE_LICENCE = "CC BY 4.0"
DRAPE_ATTRIBUTION = (
    "Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de "
    "[Daten bearbeitet]"
)
DRAPE_ACQUISITION = "LDBV Bayernbefliegung; the flight date varies by tile and is not per-pixel"
DRAPE_SOURCE_GSD = "20 cm"

#: ⚠️ FOR A SERVICE THAT DOES NOT SPEAK UTM. Every adapter so far could ask its WMS for the AOI's own
#: zone. Portugal's DGT orthophoto WMS answers only in EPSG:3763 (PT-TM06) and 3857. With these two
#: rebound, each patch is requested in that CRS around the patch's footprint and resampled
#: bilinearly onto the UTM pixel grid, so the drape still lines up with the heightmap cell for cell.
#: `TO_REQUEST_CRS(lon, lat) -> (x, y)` must be vectorised and easting-first. None = plain UTM.
REQUEST_CRS: str | None = None
TO_REQUEST_CRS = None


def get_map(bbox: tuple[float, float, float, float], width: int, height: int) -> Image.Image:
    """One WMS GetMap, in the AOI's own UTM zone.

    WMS 1.3.0 uses each CRS's own axis order. EPSG:258xx is easting-then-northing, so the bbox goes
    out as minE,minN,maxE,maxN — the same order everything else in this pipeline uses. (For a
    geographic CRS such as EPSG:4326 it would be latitude first, which is the classic WMS 1.3.0
    trap and the reason this stays in UTM throughout.)

    ⚠️ THE CRS IS DERIVED, NOT WRITTEN DOWN. It was `EPSG:25832` until TU Berlin, which is
    EPSG:25833. `load_aoi` binds the zone from the AOI's `workingCrs` before this is ever called,
    and the bbox handed in here was projected into that same zone — so asking the WMS for a
    different one would fetch a photograph of somewhere several hundred kilometres away and fit it
    neatly over the campus. Deriving it from the same source as the coordinates makes the two
    unable to disagree.
    """
    if REQUEST_CRS is not None:
        return _get_map_resampled(bbox, width, height)
    return _request(bbox, width, height, f"EPSG:258{active_zone()}")


def _request(bbox: tuple[float, float, float, float], width: int, height: int, crs: str) -> Image.Image:
    params = {
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": "1.3.0",
        "LAYERS": LAYER,
        "STYLES": "",
        "CRS": crs,
        "BBOX": f"{bbox[0]:.2f},{bbox[1]:.2f},{bbox[2]:.2f},{bbox[3]:.2f}",
        "WIDTH": str(width),
        "HEIGHT": str(height),
        "FORMAT": "image/jpeg",
    }
    url = f"{WMS}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    # A gateway error is the service, not the request: IGN's PNOA WMS answered 502 to one patch in
    # four on 2026-10-07 and 200 to the same request a minute later. Retry those, briefly; anything
    # else (a 4xx, a service exception) is the request's fault and fails at once.
    for attempt in range(1, 5):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                blob = response.read()
                content_type = response.headers.get("Content-Type", "")
            break
        except urllib.error.HTTPError as exc:
            if exc.code < 500 or attempt == 4:
                raise
            print(f"    HTTP {exc.code}, retrying in {10 * attempt}s")
        except urllib.error.URLError as exc:
            if attempt == 4:
                raise
            print(f"    {exc.reason}, retrying in {10 * attempt}s")
        time.sleep(10 * attempt)

    # A WMS reports failure as a 200 with an XML service exception. Saving that as .jpg and
    # carrying on is how a drape ends up as a grey rectangle three steps later.
    if "xml" in content_type or blob[:5] == b"<?xml":
        raise RuntimeError(f"WMS service exception: {blob[:400].decode('utf-8', 'replace')}")

    return Image.open(io.BytesIO(blob)).convert("RGB")


def _get_map_resampled(bbox: tuple[float, float, float, float], width: int, height: int) -> Image.Image:
    """One UTM patch, fetched in REQUEST_CRS and resampled onto the UTM pixel grid."""
    import numpy as np
    from scipy import ndimage

    from utm import utm_to_wgs84_array

    min_e, min_n, max_e, max_n = bbox
    px_e = (max_e - min_e) / width
    px_n = (max_n - min_n) / height
    centres_e = min_e + (np.arange(width) + 0.5) * px_e
    centres_n = max_n - (np.arange(height) + 0.5) * px_n
    grid_e, grid_n = np.meshgrid(centres_e, centres_n)
    lon, lat = utm_to_wgs84_array(grid_e, grid_n)
    x, y = TO_REQUEST_CRS(lon, lat)
    # The source request covers the footprint plus two pixels, at the same pixel size, so a
    # bilinear sample at the edge never reaches outside the image it was fetched with.
    margin = 2 * max(px_e, px_n)
    sx0, sx1 = float(x.min()) - margin, float(x.max()) + margin
    sy0, sy1 = float(y.min()) - margin, float(y.max()) + margin
    sw = int(np.ceil((sx1 - sx0) / px_e))
    sh = int(np.ceil((sy1 - sy0) / px_n))
    source = np.asarray(_request((sx0, sy0, sx1, sy1), sw, sh, REQUEST_CRS), dtype=np.float32)
    cols = (x - sx0) / ((sx1 - sx0) / sw) - 0.5
    rows = (sy1 - y) / ((sy1 - sy0) / sh) - 0.5
    out = np.stack(
        [ndimage.map_coordinates(source[..., c], [rows, cols], order=1, mode="nearest") for c in range(3)],
        axis=-1,
    )
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="koeln-messe")
    parser.add_argument(
        "--max-px",
        type=int,
        default=None,
        help="long side of the mosaic (default: the AOI's drape.maxPx, else 4096)",
    )
    parser.add_argument("--quality", type=int, default=84, help="output JPEG quality")
    parser.add_argument(
        "--extent",
        choices=("core", "shell"),
        default="core",
        help="which tier to photograph (default: core)",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    # ⚠️ **Long side, and it is a rendering constraint rather than a photographic one.**
    #
    # This defaulted to 8192 px on the reasoning that WebGL2 guarantees an 8192 texture limit.
    # That is true and it is not the binding constraint: the drape is uploaded WITH MIPMAPS, and
    # an 8192 x 6788 RGBA mipmap chain is roughly 300 MB. Chromium accepted the texture, silently
    # failed to complete the mipmap chain, and every sample came back BLACK — a campus rendered as
    # a black lozenge under correctly-lit buildings, with no error anywhere.
    #
    # 4096 px keeps the chain near 75 MB, which uploads reliably. For a 2.5 km core that is about
    # 0.6 m per pixel: still far finer than the 4 m terrain mesh underneath it, and sharp enough to
    # read road markings. Mipmaps are worth more than the extra pixels, because the drape is almost
    # always viewed at a grazing angle where the missing ones shimmer.
    max_px = args.max_px or int(cfg.get("drape", {}).get("maxPx", 4096))
    shell_tier = args.extent == "shell"
    if shell_tier and args.max_px is None:
        # See the module note: one texel per screen pixel at the widest shot, and no more.
        max_px = int(cfg.get("shellDrape", {}).get("maxPx", 1600))
    out_dir = terrain_dir(cfg)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = "shell-drape" if shell_tier else "drape"
    image_path = out_dir / f"{stem}.jpg"
    meta_path = out_dir / f"{stem}.json"
    if image_path.exists() and meta_path.exists() and not args.force:
        print(f"cached: {image_path} (use --force to re-fetch)")
        return

    # ⚠️ The drape has to line up with the heightmap exactly, so its extent is read from the
    # terrain metadata rather than recomputed from the bbox. build_terrain.py snaps the grid origin
    # to a whole multiple of the resolution; recomputing here would land a few metres off and slide
    # the whole photograph sideways across the mountain.
    #
    # ⚠️ The same argument applies to the shell, against `shell.json` — and it matters MORE there,
    # because the shell mesh is positioned from that origin while the core is the world origin. An
    # extent recomputed from the bbox would slide the photograph across the shell by whatever
    # build_shell.py's own snapping moved it.
    terrain_meta_path = out_dir / ("shell.json" if shell_tier else "heightmap.json")
    grids = cfg.get("shellGrids" if shell_tier else "grids", {})
    under_m = grids.get("renderResolutionM", "?")
    if terrain_meta_path.exists():
        terrain = json.loads(terrain_meta_path.read_text(encoding="utf-8"))
        under_m = terrain["resolutionM"]
        min_e = float(terrain["origin"]["easting"])
        min_n = float(terrain["origin"]["northing"])
        max_e = min_e + terrain["width"] * terrain["resolutionM"]
        max_n = min_n + terrain["height"] * terrain["resolutionM"]
        print(f"extent taken from the generated {terrain_meta_path.name}")
    else:
        min_e, min_n, max_e, max_n = bbox_to_utm(*bbox_wsen(cfg, args.extent))
        print("⚠️ no heightmap yet — extent derived from the AOI bbox, which may not match")

    span_e = max_e - min_e
    span_n = max_n - min_n
    print(f"{args.extent}: {span_e / 1000:.2f} x {span_n / 1000:.2f} km from {min_e:.0f}/{min_n:.0f}")

    if span_e >= span_n:
        width = max_px
        height = int(round(max_px * span_n / span_e))
    else:
        height = max_px
        width = int(round(max_px * span_e / span_n))

    print(f"mosaic: {width} x {height} px, {span_e / width:.2f} m per pixel")

    # How many requests each axis needs to stay inside the service's limit.
    cols = -(-width // MAX_REQUEST_PX)
    rows = -(-height // MAX_REQUEST_PX)
    print(f"requests: {cols} x {rows}")

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

    # ⚠️ A WMS outside its own coverage answers 200 with a valid, uniformly blank image, not an
    # exception. DGT's ortos2021 did exactly that over Lisbon (the 2021 flight is north-only) and
    # the result was a 0.1 MB all-white drape that would have shipped. A photograph has texture.
    spread = max(ImageStat.Stat(mosaic).stddev)
    if spread < 2.0:
        raise RuntimeError(
            f"drape is uniform (pixel std {spread:.2f}): the WMS returned blank tiles, which means "
            "the AOI is outside this layer's coverage. Nothing written."
        )

    mosaic.save(image_path, "JPEG", quality=args.quality, optimize=True, progressive=True)

    meta = {
        "aoi": cfg["id"],
        "file": image_path.name,
        "width": width,
        "height": height,
        "resolutionM": round(span_e / width, 4),
        # Derived from the bound zone, like the GetMap CRS: this said EPSG:25832 for every site.
        "crs": f"EPSG:258{active_zone()}",
        "origin": {"easting": min_e, "northing": min_n},
        "spanM": {"east": span_e, "north": span_n},
        "encoding": "JPEG, row 0 = north — same orientation as the heightmap",
        "source": DRAPE_SOURCE,
        "service": WMS,
        "layer": LAYER,
        **({"requestCrs": REQUEST_CRS, "resampledTo": f"EPSG:258{active_zone()} (bilinear, per patch)"} if REQUEST_CRS else {}),
        "licence": DRAPE_LICENCE,
        "attribution": DRAPE_ATTRIBUTION,
        "resolutionNote": (
            f"The source is {DRAPE_SOURCE_GSD}. This drape is resampled by the WMS to about "
            f"{span_e / width:.1f} m per pixel, because the terrain heightmap beneath it is at "
            f"{under_m} m and a full-resolution "
            "texture is neither loadable nor useful. It is a photograph of the ground, not a "
            "measurement. The one thing derived from it is each building's roof colour "
            "(tools/geodata/roof_colour.py), where the site has buildings."
        ),
        "acquisition": DRAPE_ACQUISITION,
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\nwrote {image_path} ({image_path.stat().st_size / 1e6:.1f} MB)")
    print(f"wrote {meta_path}")


if __name__ == "__main__":
    main()

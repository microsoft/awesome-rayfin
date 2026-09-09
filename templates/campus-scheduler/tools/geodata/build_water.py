"""Build the water surface — PLAN Phase 6, the Neckar.

A river is the one thing in this scene that is genuinely flat, and that is exactly why leaving it
to the terrain looks wrong. DGM1 is a bare-earth model: over water the laser returns from the
surface, but the surrounding banks, weirs and the island at the Platanenallee leave the channel
reading as a shallow trough with a few centimetres of noise in it. Rendered with the hillshade
everything else uses, the Neckar looks like wet tarmac.

So the water gets its own surface, and the honest way to place it is to **measure** it:

**Where** comes from OpenStreetMap, via the land-cover raster the terrain already carries — class
11 is water, so no new download is needed and the river is clipped to exactly the cells the app
already colours blue.

**How high** comes from the DGM1 itself. Each connected body of water is levelled to the *median*
terrain elevation of its own cells. Median rather than mean because the trough's banks and the odd
bridge deck are outliers, and a mean would lift the river onto them. The Neckar drops about a metre
across this AOI, which is under the noise floor of the surface it is replacing, so one level per
body is not a simplification worth apologising for — but it is recorded in the metadata rather
than hidden.

Output (public/terrain/<aoi>/):
  water.bin    quantised triangles, same encoding as the buildings
  water.json   per-body elevation, area and provenance

Usage
  python tools/geodata/build_water.py --aoi tuebingen
"""

from __future__ import annotations

import argparse
import gzip
import json
import struct

import numpy as np
from scipy import ndimage

from aoi import load_aoi, terrain_dir

#: Land-cover code for water in build_landuse.py.
WATER_CLASS = 11

#: Ignore puddles. A body smaller than this is more likely a mapping artefact than a river.
MIN_AREA_M2 = 400.0

XZ_SCALE_M = 0.25


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="tuebingen")
    parser.add_argument("--min-area", type=float, default=MIN_AREA_M2)
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    out_dir = terrain_dir(cfg)

    terrain = json.loads((out_dir / "heightmap.json").read_text(encoding="utf-8"))
    grid_w, grid_h = int(terrain["width"]), int(terrain["height"])
    res = float(terrain["resolutionM"])
    width_m, depth_m = grid_w * res, grid_h * res
    h_min = float(terrain["heightMinM"])
    h_scale = float(terrain["heightScale"])

    heights = np.frombuffer((out_dir / "heightmap.u16").read_bytes(), dtype="<u2").reshape(
        grid_h, grid_w
    )
    ground = h_min + heights.astype(np.float64) * h_scale

    landuse_meta = json.loads((out_dir / "landuse.json").read_text(encoding="utf-8"))
    landuse = np.frombuffer(
        gzip.decompress((out_dir / landuse_meta["file"]).read_bytes()), dtype=np.uint8
    ).reshape(int(landuse_meta["height"]), int(landuse_meta["width"]))
    if landuse.shape != (grid_h, grid_w):
        raise SystemExit(f"land cover {landuse.shape} does not match terrain {(grid_h, grid_w)}")

    mask = landuse == WATER_CLASS
    if not mask.any():
        print(f"no water mapped in '{cfg['id']}' — nothing to build")
        return

    labels, count = ndimage.label(mask)
    cell_area = res * res
    print(f"water cells: {mask.sum():,} ({mask.mean():.2%} of the AOI), {count} bodies")

    vertices: list[int] = []
    bodies: list[dict] = []
    y_min = float(ground[mask].min()) - 2.0
    y_scale = 0.01

    for body in range(1, count + 1):
        cells = labels == body
        area = float(cells.sum()) * cell_area
        if area < args.min_area:
            continue

        # ⚠️ Median, not mean. The channel's own banks and any bridge deck inside the polygon are
        # outliers that a mean would ride up onto, lifting the river above its shore.
        level = float(np.median(ground[cells]))
        rows, cols = np.nonzero(cells)

        for r, c in zip(rows, cols):
            # Cell corners in world metres: +x east, +z south, centred on the terrain.
            x0 = c * res - width_m / 2
            x1 = x0 + res
            z0 = r * res - depth_m / 2
            z1 = z0 + res
            y = int(round((level - y_min) / y_scale))
            for xx, zz in ((x0, z0), (x1, z0), (x1, z1), (x0, z0), (x1, z1), (x0, z1)):
                vertices.append(int(round(xx / XZ_SCALE_M)))
                vertices.append(y)
                vertices.append(int(round(zz / XZ_SCALE_M)))

        bodies.append(
            {
                "id": body,
                "levelM": round(level, 2),
                "areaM2": round(area, 1),
                "cells": int(cells.sum()),
            }
        )

    if not bodies:
        print(f"every water body is under {args.min_area:.0f} m2 — nothing to build")
        return

    bodies.sort(key=lambda b: -b["areaM2"])
    count_v = len(vertices) // 3
    payload = bytearray()
    payload += struct.pack(f"<{count_v}h", *vertices[0::3])
    payload += struct.pack(f"<{count_v}H", *vertices[1::3])
    payload += struct.pack(f"<{count_v}h", *vertices[2::3])
    (out_dir / "water.bin").write_bytes(bytes(payload))

    (out_dir / "water.json").write_text(
        json.dumps(
            {
                "aoi": cfg["id"],
                "vertexCount": count_v,
                "triangleCount": count_v // 3,
                "bodyCount": len(bodies),
                "quantisation": {"xzScaleM": XZ_SCALE_M, "yScaleM": y_scale, "yOffsetM": y_min},
                "encoding": "planar int16 x (0.25 m), uint16 y (0.01 m above yOffsetM), int16 z",
                "bodies": bodies,
                "source": "Extent: OpenStreetMap water polygons (ODbL) via the land-cover raster. "
                "Surface elevation: DGM1 laser returns inside each body.",
                "method": (
                    "Each connected body is levelled to the MEDIAN measured terrain elevation of "
                    "its own cells. Median rather than mean because banks and bridge decks inside "
                    "the polygon are outliers that would lift the surface above its shore. One "
                    "level per body: the Neckar falls about a metre across this AOI, which is "
                    "below the noise of the bare-earth model it replaces."
                ),
                "provenance": "measured",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    total = sum(b["areaM2"] for b in bodies)
    print(f"{len(bodies)} bodies, {total / 1e4:.1f} ha, {count_v // 3:,} triangles")
    for body in bodies[:5]:
        print(f"  body {body['id']:>3}: {body['levelM']:.2f} m, {body['areaM2'] / 1e4:.2f} ha")
    print(f"wrote {out_dir / 'water.bin'} ({len(payload) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()

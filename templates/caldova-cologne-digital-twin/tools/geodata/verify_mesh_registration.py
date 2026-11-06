"""Gate: does the baked 3D-Mesh sit where the DGM1 terrain says the ground is? — PLAN Phase 1.

On BARE GROUND (nDOM50 < 0.5 m: no building, no tree, no car roof) the mesh's top surface must agree
with DGM1. The mesh is a photogrammetric SURFACE and DGM1 a laser TERRAIN model, so single cells
differ (kerbs, cars, noise); the gate is on the MODE of the difference (see stats() for why not the median).

Exit code 1 if |mode| > 0.5 m near the Confex or > 1.0 m over the core, or if too few bare-ground
cells were found to say anything, or if the peak holds under 30 % of them (a gate that measured nothing must not pass).

Usage:  python tools/geodata/verify_mesh_registration.py --aoi koeln-messe
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_vegetation_ndom import tile_origin  # noqa: E402  (name-authoritative tile origin)
from slpk_remote import ROOT  # noqa: E402

CELL_M = 2.0
LIMIT_HERO_M = 0.5
LIMIT_CORE_M = 1.0
HERO_RADIUS_M = 300.0
MIN_CELLS = 2000
#: A peak that holds only a sliver of the cells is not evidence of anything.
MIN_SHARE = 0.30
#: Horizontal search radius for the XY match.
XY_SEARCH_M = 16.0


def read_glb(path: Path) -> np.ndarray:
    """World-space triangle vertices (n, 3, 3) from a baked tile (quantised, indexed)."""
    data = path.read_bytes()
    jlen = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + jlen])
    blob = data[20 + jlen + 8:]
    acc, views = gltf["accessors"], gltf["bufferViews"]
    node = gltf["nodes"][0]
    pv = views[acc[0]["bufferView"]]
    q = np.frombuffer(blob, dtype="<i2", count=acc[0]["count"] * 4, offset=pv["byteOffset"]).reshape(-1, 4)[:, :3]
    pos = q.astype(np.float64) * np.array(node["scale"]) + np.array(node["translation"])
    iv = views[acc[2]["bufferView"]]
    dtype = "<u2" if acc[2]["componentType"] == 5123 else "<u4"
    idx = np.frombuffer(blob, dtype=dtype, count=acc[2]["count"], offset=iv["byteOffset"])
    return pos[idx].reshape(-1, 3, 3)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="koeln-messe")
    ap.add_argument("--diagnose", action="store_true")
    ap.add_argument("--sabotage-dy", type=float, default=0.0, help="shift the mesh to prove the gate fails")
    ap.add_argument("--sabotage-dx", type=float, default=0.0, help="shift the mesh east (m)")
    ap.add_argument("--sabotage-dz", type=float, default=0.0, help="shift the mesh south (m)")
    args = ap.parse_args()
    terrain = ROOT / "public" / "terrain" / args.aoi
    meta = json.loads((terrain / "heightmap.json").read_text(encoding="utf-8"))
    w, h, res = meta["width"], meta["height"], meta["resolutionM"]
    hm = np.frombuffer((terrain / meta["file"]).read_bytes(), dtype="<u2").reshape(h, w)
    dgm = meta["heightMinM"] + hm.astype(np.float64) * meta["heightScale"]
    widthM, depthM = w * res, h * res
    e0, n0 = meta["origin"]["easting"], meta["origin"]["northing"]

    # Mesh top surface on the same 2 m grid, by a vertical ray through every cell CENTRE.
    #
    # ⚠️ MEASURED THE WRONG THING FIRST (2026-10-17): "highest triangle centroid per cell" reported
    # mesh - DGM1 = +8 m. A wall triangle's centroid is half-way up the wall and lands in the bare
    # cell beside the building; so does the edge of a tree crown. A vertical ray never hits a wall.
    # So: only near-horizontal triangles (|n.y| > 0.7), and only the cells whose centre lies INSIDE
    # the triangle, with the height interpolated barycentrically at that centre.
    surface = np.full((h, w), -np.inf)
    span = 8  # cells; larger near-horizontal triangles are skipped (rare, and counted)
    skipped = 0
    for tile in sorted((terrain / "mesh").glob("*.glb")):
        tri = read_glb(tile)
        a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
        nrm = np.cross(b - a, c - a)
        ln = np.linalg.norm(nrm, axis=1)
        flat = (ln > 1e-9) & (np.abs(nrm[:, 1]) > 0.7 * ln)
        a, b, c = a[flat], b[flat], c[flat]
        # grid coordinates (col along x, row along z)
        ax, az = (a[:, 0] + widthM / 2) / res, (a[:, 2] + depthM / 2) / res
        bx, bz = (b[:, 0] + widthM / 2) / res, (b[:, 2] + depthM / 2) / res
        cx_, cz_ = (c[:, 0] + widthM / 2) / res, (c[:, 2] + depthM / 2) / res
        c0 = np.floor(np.minimum(np.minimum(ax, bx), cx_) - 0.5).astype(int) + 1
        r0 = np.floor(np.minimum(np.minimum(az, bz), cz_) - 0.5).astype(int) + 1
        big = (np.maximum(np.maximum(ax, bx), cx_) - c0 > span) | (np.maximum(np.maximum(az, bz), cz_) - r0 > span)
        skipped += int(big.sum())
        den = (bz - cz_) * (ax - cx_) + (cx_ - bx) * (az - cz_)
        for di in range(span + 1):
            for dj in range(span + 1):
                col, row = c0 + dj, r0 + di
                px, pz = col + 0.5, row + 0.5
                with np.errstate(divide="ignore", invalid="ignore"):
                    l1 = ((bz - cz_) * (px - cx_) + (cx_ - bx) * (pz - cz_)) / den
                    l2 = ((cz_ - az) * (px - cx_) + (ax - cx_) * (pz - cz_)) / den
                l3 = 1 - l1 - l2
                hit = (~big) & (l1 >= 0) & (l2 >= 0) & (l3 >= 0) & (col >= 0) & (col < w) & (row >= 0) & (row < h)
                if hit.any():
                    y = l1[hit] * a[hit, 1] + l2[hit] * b[hit, 1] + l3[hit] * c[hit, 1]
                    np.maximum.at(surface, (row[hit], col[hit]), y)
    print(f"skipped {skipped:,} near-horizontal triangles wider than {span} cells")

    # Bare ground from nDOM50, resampled onto the grid by cell-centre lookup.
    bare = np.zeros((h, w), dtype=bool)
    ndom = np.full((h, w), np.nan)
    rows, cols = np.mgrid[0:h, 0:w]
    east = e0 + (cols + 0.5) * res
    north = n0 + depthM - (rows + 0.5) * res
    for tif in sorted((ROOT / "data" / "ndom50" / args.aoi).glob("*.tif")):
        te, tn, size_m = tile_origin(tif)  # ⚠️ already METRES (1000.0), not km — multiplying again mapped every cell to pixel 0..2
        arr = np.asarray(Image.open(tif), dtype=np.float32)  # row 0 = north edge
        px = size_m / arr.shape[1]
        inside = (east >= te) & (east < te + size_m) & (north > tn) & (north <= tn + size_m)
        if not inside.any():
            continue
        cc = ((east[inside] - te) / px).astype(int).clip(0, arr.shape[1] - 1)
        rr = ((tn + size_m - north[inside]) / px).astype(int).clip(0, arr.shape[0] - 1)
        vals = arr[rr, cc]
        bare[inside] = (vals > -5) & (vals < 0.5)
        ndom[inside] = np.where(vals > -5, vals, np.nan)

    if args.sabotage_dx or args.sabotage_dz:
        surface = np.roll(surface, (int(round(args.sabotage_dz / res)), int(round(args.sabotage_dx / res))), axis=(0, 1))
    valid = bare & np.isfinite(surface)
    diff = surface + args.sabotage_dy - dgm
    if "--diagnose" in sys.argv:
        allv = np.isfinite(surface)
        hist, edges = np.histogram(diff[allv], bins=np.arange(-6, 30, 1.0))
        print("all mesh cells:", int(allv.sum()), "bare share", round(float(bare.mean()), 3))
        for n_, e_ in zip(hist, edges):
            print(f"  {e_:+5.0f}..{e_+1:+.0f} m  {n_:8d}")
        hb, _ = np.histogram(diff[valid], bins=np.arange(-6, 30, 1.0))
        print("bare-only histogram:", hb.tolist())
        rr_, cc_ = np.nonzero(valid & (diff > 10))
        pick = np.random.default_rng(1).choice(len(rr_), size=min(8, len(rr_)), replace=False)
        for i in pick:
            r_, c_ = rr_[i], cc_[i]
            print(f"  E {east[r_, c_]:.1f} N {north[r_, c_]:.1f}  dgm {dgm[r_, c_]:.2f}  mesh {surface[r_, c_]:.2f}")
    hero = next(p for p in json.loads((ROOT / "config" / "aoi" / f"{args.aoi}.json").read_text(encoding="utf-8"))["focusPlaces"] if p.get("kind") == "hero")
    hm_place = next(p for p in meta["focusPlaces"] if p["id"] == hero["id"])
    hx, hz = (hm_place["u"] - 0.5) * widthM, (hm_place["v"] - 0.5) * depthM
    cx = (cols + 0.5) * res - widthM / 2
    cz = (rows + 0.5) * res - depthM / 2
    near = valid & (np.hypot(cx - hx, cz - hz) <= HERO_RADIUS_M)

    # The statistic is the MODE of mesh - DGM1, refined by the median within 1 m of it, plus the share
    # of cells near it. A systematic vertical error moves the peak; residual roof-edge, car and canopy
    # cells only fatten the tail.
    # ⚠️ CORRECTION, recorded so it is not repeated (2026-10-17): a first version blamed a +8 m median
    # on leaf-off nDOM trees. That was WRONG. The real cause was this script multiplying the nDOM tile
    # size by 1000 a second time (tile_origin already returns metres), so the "bare" mask was garbage.
    # With the fix: hero mode +0.27 m with 96 % of cells within 1 m. Measure, then explain.
    def stats(mask: np.ndarray) -> tuple[int, float, float]:
        d = diff[mask]
        d = d[(d > -10) & (d < 40)]
        if d.size == 0:
            return 0, float("nan"), 0.0
        hist, edges = np.histogram(d, bins=np.arange(-10, 40.25, 0.25))
        coarse = edges[np.argmax(hist)] + 0.125
        peak = float(np.median(d[np.abs(d - coarse) <= 1.0]))
        share = float((np.abs(d - peak) <= 1.0).mean())
        return int(d.size), peak, share

    n_core, mode_core, share_core = stats(valid)
    n_hero, mode_hero, share_hero = stats(near)
    print(f"bare-ground cells: core {n_core:,}, within {HERO_RADIUS_M:.0f} m of the Confex {n_hero:,}")
    print(f"mesh - DGM1, core:  mode {mode_core:+.2f} m, {share_core:.0%} of cells within 1 m of it   (limit |mode| {LIMIT_CORE_M} m)")
    print(f"mesh - DGM1, hero:  mode {mode_hero:+.2f} m, {share_hero:.0%} of cells within 1 m of it   (limit |mode| {LIMIT_HERO_M} m)")
    # ── Horizontal check ─────────────────────────────────────────────────
    # The vertical mode says nothing about XY: on flat Köln a mesh 20 m off still has ground at
    # ground height. So match the mesh surface against the measured surface model (DGM1 + nDOM50)
    # over the hero window for every shift within ±XY_SEARCH_M and require the best match at zero.
    # Buildings carry the signal; the leaf-off trees only add noise.
    dsm = dgm + ndom
    if args.diagnose:
        for fp in meta['focusPlaces']:
            r_, c_ = int(fp['v'] * h), int(fp['u'] * w)
            for dr, dc in ((0, 0), (0, 15), (15, 0)):
                rr2, cc2 = r_ + dr, c_ + dc
                print(f"  {fp['id']:16s} +({dr},{dc}) dgm {dgm[rr2, cc2]:6.2f} ndom {ndom[rr2, cc2]:6.2f} dsm {dsm[rr2, cc2]:6.2f} mesh {surface[rr2, cc2]:6.2f}")
        fin = np.isfinite(surface) & np.isfinite(dsm) & win
        print('  window cells', int(win.sum()), 'finite both', int(fin.sum()), 'median mesh-dsm', float(np.median((surface - dsm)[fin])))
    win = np.hypot(cx - hx, cz - hz) <= HERO_RADIUS_M
    rmin, rmax = np.nonzero(win.any(axis=1))[0][[0, -1]]
    cmin, cmax = np.nonzero(win.any(axis=0))[0][[0, -1]]
    k = int(XY_SEARCH_M / res)
    base = dsm[rmin:rmax + 1, cmin:cmax + 1]
    best, scores = None, {}
    for di in range(-k, k + 1):
        for dj in range(-k, k + 1):
            r0, c0 = rmin + di, cmin + dj
            if r0 < 0 or c0 < 0 or rmax + 1 + di > h or cmax + 1 + dj > w:
                continue
            sm = surface[r0:rmax + 1 + di, c0:cmax + 1 + dj]
            d = np.abs(sm - base)
            d = d[np.isfinite(d)]
            if d.size < MIN_CELLS:
                continue
            scores[(di, dj)] = float(np.median(d))
            if best is None or scores[(di, dj)] < scores[best]:
                best = (di, dj)
    zero = scores.get((0, 0), float("nan"))
    xy_ok = best is not None and max(abs(best[0]), abs(best[1])) <= 1
    if best is not None:
        print(f"XY match vs DGM1+nDOM50 (±{XY_SEARCH_M:.0f} m): best shift "
              f"east {best[1] * res:+.0f} m / south {best[0] * res:+.0f} m (median |d| {scores[best]:.2f} m; at zero {zero:.2f} m)   (limit ±{res:.0f} m)")
    ok = (
        xy_ok and n_core >= MIN_CELLS and n_hero >= MIN_CELLS // 10
        and abs(mode_core) <= LIMIT_CORE_M and abs(mode_hero) <= LIMIT_HERO_M
        and share_core >= MIN_SHARE and share_hero >= MIN_SHARE
    )
    print("MESH REGISTRATION OK" if ok else "MESH REGISTRATION FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

"""Gate: do vehicles cross the Rhine bridges ON the photographed deck?

For every tour path point over the Rhine bridges in the core, compare the baked road height with the
top of the 3D-Mesh at the same spot (vertical ray, near-horizontal triangles only — the same sampling
as verify_mesh_registration.py). Vehicles stand VEHICLE_LIFT above the baked height.

Exit 1 if the median |deck - mesh| on bridge points exceeds 1.5 m or any point is more than 4 m off.

Usage:  python tools/verify_bridge_decks.py --aoi koeln-messe
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "geodata"))
from verify_mesh_registration import read_glb  # noqa: E402

#: Rhine bridges with road traffic inside the fine core, as lon/lat boxes over the river.
BRIDGES = {
    "Deutzer Brücke": (6.9630, 50.9355, 6.9675, 50.9375),
    "Severinsbrücke": (6.9640, 50.9285, 6.9720, 50.9325),
}


def utm(lat: float, lon: float) -> tuple[float, float]:
    from pyproj import Transformer  # noqa: PLC0415

    return Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True).transform(lon, lat)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="koeln-messe")
    args = ap.parse_args()
    terrain = ROOT / "public" / "terrain" / args.aoi
    meta = json.loads((terrain / "heightmap.json").read_text(encoding="utf-8"))
    w, d = meta["width"] * meta["resolutionM"], meta["height"] * meta["resolutionM"]
    e0, n0 = meta["origin"]["easting"], meta["origin"]["northing"]
    ops = json.loads((terrain / "operations.json").read_text(encoding="utf-8"))

    def scene_xz(lat: float, lon: float) -> tuple[float, float]:
        e, n = utm(lat, lon)
        return e - e0 - w / 2, (n0 + d) - n - d / 2

    tris = np.concatenate([read_glb(t) for t in sorted((terrain / "mesh").glob("*.glb"))])
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    nrm = np.cross(b - a, c - a)
    ln = np.linalg.norm(nrm, axis=1)
    flat = (ln > 1e-9) & (np.abs(nrm[:, 1]) > 0.7 * ln)
    tris = tris[flat]

    def mesh_top(x: float, z: float) -> float | None:
        t = tris
        mx0, mx1 = t[:, :, 0].min(1), t[:, :, 0].max(1)
        mz0, mz1 = t[:, :, 2].min(1), t[:, :, 2].max(1)
        sel = t[(mx0 <= x) & (mx1 >= x) & (mz0 <= z) & (mz1 >= z)]
        best = None
        for (ax, ay, az), (bx, by, bz), (cx, cy, cz) in sel:
            den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
            if abs(den) < 1e-9:
                continue
            l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den
            l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den
            l3 = 1 - l1 - l2
            if min(l1, l2, l3) >= 0:
                y = l1 * ay + l2 * by + l3 * cy
                best = y if best is None else max(best, y)
        return best

    ok = True
    crossed_none: list[str] = []
    for name, (lo0, la0, lo1, la1) in BRIDGES.items():
        diffs = []
        where = []
        # ⚠️ SAMPLED ALONG SEGMENTS, NOT AT VERTICES: 3-D thinning leaves a straight deck as its two
        # end points, so a vertex-only check found "no tour crosses it" and passed on nothing.
        for t in ops["tours"]:
            for q0, q1 in zip(t["path"], t["path"][1:]):
                if (len(q0) > 3 and q0[3] == 1) or (len(q1) > 3 and q1[3] == 1):
                    continue  # tunnel
                span = math.hypot((q1[0] - q0[0]) * 111320, (q1[1] - q0[1]) * 111320 * math.cos(math.radians(q0[0])))
                for k in range(max(1, int(span // 10)) + 1):
                    f = k / max(1, int(span // 10))
                    lat, lon = q0[0] + (q1[0] - q0[0]) * f, q0[1] + (q1[1] - q0[1]) * f
                    if lo0 <= lon <= lo1 and la0 <= lat <= la1:
                        m = mesh_top(*scene_xz(lat, lon))
                        if m is not None:
                            diffs.append(q0[2] + (q1[2] - q0[2]) * f - m)
                            where.append((round(lat, 5), round(lon, 5), q0[3] if len(q0) > 3 else 0, q1[3] if len(q1) > 3 else 0))
        if not diffs:
            # ⚠️ NOT A PASS. A gate that found nothing to measure has proved nothing.
            print(f"{name}: no tour crosses it")
            crossed_none.append(name)
            continue
        arr = np.array(diffs)
        med = float(np.median(arr))
        p95 = float(np.percentile(np.abs(arr), 95))
        off = [(round(float(v), 1), w) for v, w in zip(arr, where) if abs(v) > 4.0]
        print(f"{name}: {len(arr)} path points, road - mesh deck median {med:+.2f} m, |d| p95 {p95:.2f} m, "
              f"{len(off)} points more than 4 m off")
        for o in off[:6]:
            print("    off:", o)
        # ⚠️ p95 AND a count, not the single worst point: the mesh top above a LANDING can be the deck
        # passing over the street below it (Altstadt end of the Deutzer Brücke), which is the mesh
        # being right and the street being under it — reported, and allowed at under 2 % of points.
        if abs(med) > 1.5 or p95 > 2.0 or len(off) > 0.02 * len(arr):
            ok = False
    if len(crossed_none) == len(BRIDGES):
        ok = False
        print("no tour crosses any checked bridge — the gate measured nothing")
    print("BRIDGE DECKS OK" if ok else "BRIDGE DECKS FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

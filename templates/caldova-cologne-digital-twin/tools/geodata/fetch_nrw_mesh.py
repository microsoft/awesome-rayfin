"""Select and fetch the NRW 3D-Mesh nodes for the AOI core — PLAN Phase 1.

Measured layer facts (probe_mesh_layer.py, 2026-10-17, Mesh_KB1450T12_nw_2025):
- IntegratedMesh, I3S 1.7, `meshpyramids`, `node-switching` LoD: a node's children REPLACE it,
  so any cut through the tree that covers the area once is a valid, gap-free mesh.
- spatialReference wkid 25832, vcsWkid 7837 (DHHN2016), gravity-related heights — the SAME frame as
  DGM1 and LoD2. No geoid shift. (Read from the metadata, not assumed.)
- 64 nodes per node page; every node carries an OBB, children, and a 256 x 256 texture hint.
- geometry buffer 0 = legacy uncompressed (8-byte header, position f32x3, uv0 f32x2, featureId,
  faceRange); buffer 1 = Draco. We read buffer 0 so Python needs no Draco decoder.

⚠️ THE CUT IS CHOSEN BY TEXEL SIZE, NOT BY LoD NUMBER. A node's ground resolution is roughly its OBB
footprint divided by the side of its texture. Descend until that is at or below the target for the
node's distance from the hero building (PLAN M2 texel rings), then stop.

Usage:
  python tools/geodata/fetch_nrw_mesh.py --aoi koeln-messe --dry-run     # count only
  python tools/geodata/fetch_nrw_mesh.py --aoi koeln-messe               # fetch geometry + textures
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from slpk_remote import CACHE, ROOT, RemoteSlpk  # noqa: E402

from pyproj import Transformer  # noqa: E402

URL = "https://www.opengeodata.nrw.de/produkte/geobasis/lusat/akt/3dmesh/3dmesh/Mesh_KB1450T12_nw_2025.slpk"
PER_PAGE = 64

#: Detail spots: (name, lat, lon, radius m, target ground texel m). Everything else gets BACKGROUND.
#:
#: ⚠️ MEASURED 2026-10-17: the mesh LoD steps are coarse — ~120 m nodes at ~0.11 m texel, then ~1 km
#: nodes at 1.2–2.5 m. A "1 m ring" therefore falls through to the 0.11 m level and the selection
#: costs 127 Mtexel. So the finest level is used ONLY at named spots, and `bake_nrw_mesh.py`
#: downsamples their textures to the spot's target texel. Selection decides GEOMETRY detail; the bake
#: decides TEXTURE memory.
#:
#: The Dom coordinate is only a texel-targeting centre, not a shown fact (that comes from OSM).
SPOTS = [
    ("logistikzentrum", 50.9441324, 6.9747092, 250.0, 0.25),
    ("dom", 50.94130, 6.95828, 200.0, 0.50),
]
NEAR = (3500.0, 1.6)  # whole core: the 3 m level read as blobs in the foreground (measured 2026-10-17, +5 nodes)
BACKGROUND = 3.0
_SPOTS_UTM: list[tuple[float, float, float, float]] = []


def _spots_utm() -> list[tuple[float, float, float, float]]:
    if not _SPOTS_UTM:
        t = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
        for _, lat, lon, radius, texel in SPOTS:
            x, y = t.transform(lon, lat)
            _SPOTS_UTM.append((x, y, radius, texel))
    return _SPOTS_UTM


def target_texel_at(x: float, y: float, half: float, hero: tuple[float, float]) -> float:
    """Finest texel any spot asks for at a node centred (x, y) with half-extent `half`."""
    best = BACKGROUND
    for sx, sy, radius, texel in _spots_utm():
        if max(0.0, math.hypot(x - sx, y - sy) - half) <= radius:
            best = min(best, texel)
    if max(0.0, math.hypot(x - hero[0], y - hero[1]) - half) <= NEAR[0]:
        best = min(best, NEAR[1])
    return best


def load_aoi(aoi_id: str) -> dict:
    return json.loads((ROOT / "config" / "aoi" / f"{aoi_id}.json").read_text(encoding="utf-8"))


def core_box_utm(aoi: dict) -> tuple[float, float, float, float]:
    t = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
    b = aoi["bbox"]
    xs, ys = zip(*(t.transform(lon, lat) for lon in (b["west"], b["east"]) for lat in (b["south"], b["north"])))
    return min(xs), min(ys), max(xs), max(ys)


def shell_box_utm(aoi: dict) -> tuple[float, float, float, float]:
    """The delivery ring: the AOI shell box, in UTM metres."""
    t = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
    b = aoi["shell"]
    xs, ys = zip(*(t.transform(lon, lat) for lon in (b["west"], b["east"]) for lat in (b["south"], b["north"])))
    return min(xs), min(ys), max(xs), max(ys)


#: Ring tier (a coarse NRW mesh for the ring): one texel everywhere.
RING_TEXEL = 5.0  # measured LoD steps 2.4 / 4.9 / 12.7 m: 2.4 m costs 243 nodes (~90 MB), 4.9 m 80 nodes (~20 MB)


def hero_utm(aoi: dict) -> tuple[float, float]:
    t = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
    hero = next(p for p in aoi["focusPlaces"] if p.get("kind") == "hero")
    return t.transform(hero["lon"], hero["lat"])


def obb_xy_extent(node: dict) -> tuple[float, float, float, float]:
    """Axis-aligned XY bounds of a (possibly rotated) OBB. Conservative: the rotated box's corners."""
    cx, cy, cz = node["obb"]["center"]
    hx, hy, hz = node["obb"]["halfSize"]
    qx, qy, qz, qw = node["obb"]["quaternion"]
    # rotation matrix from quaternion
    r = [
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
    ]
    ex = abs(r[0][0]) * hx + abs(r[0][1]) * hy + abs(r[0][2]) * hz
    ey = abs(r[1][0]) * hx + abs(r[1][1]) * hy + abs(r[1][2]) * hz
    return cx - ex, cy - ey, cx + ex, cy + ey


def node_texel(node: dict) -> float:
    x0, y0, x1, y1 = obb_xy_extent(node)
    side = math.sqrt((node.get("mesh") or {}).get("material", {}).get("texelCountHint", 65536))
    return max(x1 - x0, y1 - y0) / side


class Pages:
    def __init__(self, slpk: RemoteSlpk):
        self.slpk = slpk
        self.cache: dict[int, list[dict]] = {}

    def node(self, index: int) -> dict:
        page = index // PER_PAGE
        if page not in self.cache:
            self.cache[page] = self.slpk.read_json(f"nodepages/{page}.json.gz")["nodes"]
        return self.cache[page][index % PER_PAGE]


def select(slpk: RemoteSlpk, box, hero, skip_inside=None, fixed_texel: float | None = None) -> list[dict]:
    """A node-switching cut over `box`. With `skip_inside`, nodes lying wholly inside that box are
    left out (the ring around an already-baked core); with `fixed_texel`, one target everywhere."""
    pages = Pages(slpk)
    bx0, by0, bx1, by1 = box
    chosen: list[dict] = []
    stack = [0]
    while stack:
        node = pages.node(stack.pop())
        x0, y0, x1, y1 = obb_xy_extent(node)
        if x1 < bx0 or x0 > bx1 or y1 < by0 or y0 > by1:
            continue
        if skip_inside is not None:
            sx0, sy0, sx1, sy1 = skip_inside
            if x0 >= sx0 and x1 <= sx1 and y0 >= sy0 and y1 <= sy1:
                continue
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        target = fixed_texel if fixed_texel is not None else target_texel_at(cx, cy, max(x1 - x0, y1 - y0) / 2, hero)
        node["_targetTexel"] = target
        kids = node.get("children") or []
        good_enough = "mesh" in node and node_texel(node) <= target
        if good_enough or not kids:
            if "mesh" in node:
                chosen.append(node)
            continue
        stack.extend(kids)
    return chosen


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="koeln-messe")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--tier", choices=["core", "ring"], default="core")
    args = ap.parse_args()

    aoi = load_aoi(args.aoi)
    slpk = RemoteSlpk(URL)
    hero = hero_utm(aoi)
    if args.tier == "core":
        box = core_box_utm(aoi)
        nodes = select(slpk, box, hero)
    else:
        box = shell_box_utm(aoi)
        nodes = select(slpk, box, hero, skip_inside=core_box_utm(aoi), fixed_texel=RING_TEXEL)
    texels = sum((n["mesh"]["material"].get("texelCountHint", 65536)) for n in nodes)
    verts = sum(n["mesh"]["geometry"]["vertexCount"] for n in nodes)
    by_ring: dict[float, int] = {}
    baked = 0.0
    for n in nodes:
        by_ring[n["_targetTexel"]] = by_ring.get(n["_targetTexel"], 0) + 1
        hint = n["mesh"]["material"].get("texelCountHint", 65536)
        baked += hint * min(1.0, (node_texel(n) / n["_targetTexel"]) ** 2)
    print(f"{args.tier} box UTM {tuple(round(v) for v in box)}; hero {tuple(round(v) for v in hero)}")
    print(f"selected {len(nodes)} nodes, {verts:,} vertices, {texels / 1e6:.1f} Mtexel source, "
          f"~{baked / 1e6:.1f} Mtexel after bake; nodes per target texel {by_ring}")

    out_dir = CACHE / "selection"
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = "" if args.tier == "core" else ".ring"
    (out_dir / f"{args.aoi}{suffix}.nodes.json").write_text(json.dumps(nodes), encoding="utf-8")
    if args.dry_run:
        return

    def fetch(n: dict) -> int:
        r = n["mesh"]["geometry"]["resource"]
        total = len(slpk.read(f"nodes/{r}/geometries/0.bin.gz"))
        total += len(slpk.read(f"nodes/{n['mesh']['material']['resource']}/textures/0.jpg"))
        return total

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        got = sum(pool.map(fetch, nodes))
    print(f"fetched {got / 1e6:.1f} MB for {len(nodes)} nodes")


if __name__ == "__main__":
    main()

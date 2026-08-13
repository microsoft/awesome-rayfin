"""
Does the orthophoto do large buildings, towers and churches justice? — PLAN §5.11 follow-up.

Roof colour is sampled from a vertical photograph, which is the right source for a house: a house
is mostly roof when seen from above and mostly roof-plus-a-little-wall when seen from a hillside.
The claim under test is that this breaks down for the buildings people actually look at — a church
with a spire, a castle with towers, a big hall — because for those the roof is a small part of what
is visible and the walls, which the photograph cannot see, are most of it.

This measures it rather than arguing about it:

  1. For every building, the share of its own surface area that is roof versus wall. If a church
     tower is 80 % wall, then 80 % of it is currently a hash-picked cream.
  2. How many drape pixels the sample actually got, by building size. A small footprint is a small
     sample, and a tower has a small footprint by definition.
  3. What the survey knows about these buildings that is NOT being used — bldg:function, roofType,
     gml:name — and whether those codes really identify a church, checked against buildings whose
     identity is known independently.
"""

from __future__ import annotations

import argparse
import collections
import gzip
import json
import pathlib
import statistics
import xml.etree.ElementTree as ET

NS = {
    "bldg": "http://www.opengis.net/citygml/building/1.0",
    "gml": "http://www.opengis.net/gml",
}


def read_gml(path: pathlib.Path) -> str:
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")


def rings_of(element: ET.Element) -> list[list[tuple[float, float, float]]]:
    out = []
    for pos in element.iter(f"{{{NS['gml']}}}posList"):
        if not pos.text:
            continue
        v = [float(x) for x in pos.text.split()]
        pts = [(v[i], v[i + 1], v[i + 2]) for i in range(0, len(v) - 2, 3)]
        if len(pts) >= 4:
            out.append(pts)
    return out


def polygon_area_3d(ring: list[tuple[float, float, float]]) -> float:
    """True 3D area — a steep roof has far more surface than its footprint suggests."""
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    if len(pts) < 3:
        return 0.0
    nx = ny = nz = 0.0
    for (x1, y1, z1), (x2, y2, z2) in zip(pts, pts[1:] + pts[:1]):
        nx += (y1 - y2) * (z1 + z2)
        ny += (z1 - z2) * (x1 + x2)
        nz += (x1 - x2) * (y1 + y2)
    return 0.5 * (nx * nx + ny * ny + nz * nz) ** 0.5


def footprint_area(rings: list[list[tuple[float, float, float]]]) -> float:
    best = 0.0
    for ring in rings:
        pts = ring[:-1] if ring[0] == ring[-1] else ring
        if len(pts) < 3:
            continue
        total = 0.0
        for (x1, y1, _), (x2, y2, _) in zip(pts, pts[1:] + pts[:1]):
            total += x1 * y2 - x2 * y1
        best = max(best, abs(total) * 0.5)
    return best


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    args = parser.parse_args()

    tiles = sorted((pathlib.Path("data/lod2") / args.aoi).glob("*.gml"))
    drape_meta = json.loads(
        (pathlib.Path("public/terrain") / args.aoi / "drape.json").read_text(encoding="utf-8")
    )
    res = float(drape_meta["resolutionM"])

    records = []
    named: list[tuple[str, str, str, float]] = []
    function_by_tall: collections.Counter = collections.Counter()

    for tile in tiles:
        root = ET.fromstring(read_gml(tile))
        for b in root.iter(f"{{{NS['bldg']}}}Building"):
            ground = []
            for g in b.iter(f"{{{NS['bldg']}}}GroundSurface"):
                ground.extend(rings_of(g))
            if not ground:
                continue
            fp = footprint_area(ground)
            if fp < 18:
                continue

            roof_area = sum(
                polygon_area_3d(r)
                for s in b.iter(f"{{{NS['bldg']}}}RoofSurface")
                for r in rings_of(s)
            )
            wall_area = sum(
                polygon_area_3d(r)
                for s in b.iter(f"{{{NS['bldg']}}}WallSurface")
                for r in rings_of(s)
            )

            def text(tag: str) -> str:
                node = b.find(f"{{{NS['bldg']}}}{tag}")
                return node.text.strip() if node is not None and node.text else ""

            height = float(text("measuredHeight") or 0)
            name_node = b.find(f"{{{NS['gml']}}}name")
            name = name_node.text.strip() if name_node is not None and name_node.text else ""

            records.append(
                {
                    "fp": fp,
                    "roof": roof_area,
                    "wall": wall_area,
                    "h": height,
                    "fn": text("function"),
                    "roofType": text("roofType"),
                    "name": name,
                }
            )
            if name:
                named.append((name, text("function"), text("roofType"), height))
            if height >= 20:
                function_by_tall[text("function")] += 1

    print(f"=== {args.aoi}: {len(records)} buildings ===\n")

    print("1. how much of a building is WALL rather than roof (3D surface area)")
    print(f"   {'height band':16s} {'n':>5s} {'median wall share':>18s} {'median roof m²':>15s}")
    bands = [(0, 8, "under 8 m"), (8, 12, "8–12 m"), (12, 20, "12–20 m"), (20, 200, "over 20 m")]
    for lo, hi, label in bands:
        sel = [r for r in records if lo <= r["h"] < hi and (r["roof"] + r["wall"]) > 0]
        if not sel:
            continue
        shares = sorted(r["wall"] / (r["roof"] + r["wall"]) for r in sel)
        roofs = sorted(r["roof"] for r in sel)
        print(
            f"   {label:16s} {len(sel):5d} {shares[len(shares)//2]:17.0%} "
            f"{roofs[len(roofs)//2]:15.0f}"
        )

    print("\n2. drape pixels available for the roof sample, by footprint")
    for lo, hi, label in [(18, 50, "18–50 m²"), (50, 150, "50–150 m²"), (150, 500, "150–500 m²"), (500, 1e9, "over 500 m²")]:
        sel = [r for r in records if lo <= r["fp"] < hi]
        if not sel:
            continue
        px = sorted(r["fp"] / (res * res) for r in sel)
        print(f"   {label:14s} {len(sel):5d}   median footprint pixels {px[len(px)//2]:6.0f}")

    print("\n3. what the survey knows and the renderer ignores")
    tall = [r for r in records if r["h"] >= 20]
    print(f"   buildings 20 m and taller: {len(tall)}")
    for fn, n in function_by_tall.most_common(8):
        print(f"     function {fn or '(none)':14s} {n:4d}")
    print(f"   buildings with a gml:name: {len(named)}")
    for name, fn, rt, h in sorted(named, key=lambda x: -x[3])[:14]:
        print(f"     {h:6.1f} m  fn={fn:12s} roofType={rt:5s}  {name[:52]}")

    tallest = sorted(records, key=lambda r: -r["h"])[:10]
    print("\n   the ten tallest, named or not:")
    for r in tallest:
        share = r["wall"] / max(r["roof"] + r["wall"], 1)
        print(
            f"     {r['h']:6.1f} m  fp {r['fp']:7.0f} m²  wall share {share:4.0%}  "
            f"fn={r['fn']:12s} rt={r['roofType']:5s} {r['name'][:34]}"
        )

    print(f"\n   median building height {statistics.median(r['h'] for r in records):.1f} m")


if __name__ == "__main__":
    main()

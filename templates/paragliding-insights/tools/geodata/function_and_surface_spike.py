"""
Two questions before combining CityGML with the orthophoto — PLAN §5.11 follow-up.

The wall/roof measurement showed that roughly 70 % of every building's surface is wall, which the
photograph cannot see, and that the survey names and classifies buildings the renderer ignores.
Two things still need measuring before any of that is acted on:

  1. **Do the ALKIS function codes mean what they appear to mean?** St. Johannes Baptist and the
     Christuskirche both carry 31001_3041, which is suggestive but not proof. This lists every code
     with its named examples, its size and its height, so the mapping is read off the data instead
     of off a half-remembered code list.

  2. **Within one building, do the roof surfaces actually differ?** Roof colour is currently pooled
     per building, deliberately: a gable's two pitches differ mostly because of the sun, and pooling
     averages that out. But a church whose spire is copper and whose nave is tile, or a hall with a
     solar array on one pitch, has real differences that pooling destroys. This measures the spread
     of hue and saturation between the surfaces of one building — the quantity that decides whether
     per-surface sampling is worth its complexity.
"""

from __future__ import annotations

import argparse
import collections
import colorsys
import gzip
import json
import pathlib
import statistics
import sys
import xml.etree.ElementTree as ET

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from roof_colour import DrapeRef, robust_colour, sample_polygons  # noqa: E402

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


def footprint_area(rings) -> float:
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


def hue_distance(a: float, b: float) -> float:
    d = abs(a - b) % 1.0
    return min(d, 1.0 - d)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    args = parser.parse_args()

    aoi_dir = pathlib.Path("public/terrain") / args.aoi
    dm = json.loads((aoi_dir / "drape.json").read_text(encoding="utf-8"))
    drape = DrapeRef(
        image=Image.open(aoi_dir / "drape.jpg").convert("RGB"),
        resolution_m=float(dm["resolutionM"]),
        origin_easting=float(dm["origin"]["easting"]),
        top_northing=float(dm["origin"]["northing"]) + float(dm["spanM"]["north"]),
    )

    by_code: dict[str, dict] = collections.defaultdict(
        lambda: {"n": 0, "names": [], "fp": [], "h": []}
    )
    spreads: list[tuple[float, float, float, str, str]] = []

    for tile in sorted((pathlib.Path("data/lod2") / args.aoi).glob("*.gml")):
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

            def text(tag: str) -> str:
                node = b.find(f"{{{NS['bldg']}}}{tag}")
                return node.text.strip() if node is not None and node.text else ""

            code = text("function")
            height = float(text("measuredHeight") or 0)
            name_node = b.find(f"{{{NS['gml']}}}name")
            name = name_node.text.strip() if name_node is not None and name_node.text else ""

            entry = by_code[code]
            entry["n"] += 1
            entry["fp"].append(fp)
            entry["h"].append(height)
            if name and len(entry["names"]) < 6:
                entry["names"].append(name)

            # Per-surface sampling, but only where it could matter: the big and the tall.
            if fp < 300 and height < 15:
                continue
            surface_colours = []
            for surface in b.iter(f"{{{NS['bldg']}}}RoofSurface"):
                rings = [[(p[0], p[1]) for p in r] for r in rings_of(surface)]
                if not rings:
                    continue
                colour = robust_colour(sample_polygons(drape, rings))
                if colour:
                    surface_colours.append(colorsys.rgb_to_hsv(*(c / 255 for c in colour)))
            if len(surface_colours) < 2:
                continue

            hues = [c[0] for c in surface_colours if c[1] > 0.10]
            sats = [c[1] for c in surface_colours]
            vals = [c[2] for c in surface_colours]
            hue_spread = (
                max(hue_distance(a, b2) for a in hues for b2 in hues) if len(hues) > 1 else 0.0
            )
            spreads.append(
                (hue_spread, max(sats) - min(sats), max(vals) - min(vals), name, code)
            )

    print(f"=== {args.aoi} — ALKIS function codes, read off the data ===")
    for code, e in sorted(by_code.items(), key=lambda kv: -kv[1]["n"])[:16]:
        print(
            f"  {code or '(none)':14s} n={e['n']:5d}  median fp {statistics.median(e['fp']):6.0f} m²  "
            f"median h {statistics.median(e['h']):5.1f} m"
        )
        if e["names"]:
            print(f"       named: {'; '.join(e['names'])[:110]}")

    print(f"\n=== within-building roof surface spread ({len(spreads)} large or tall buildings) ===")
    for label, index in (("hue", 0), ("saturation", 1), ("value", 2)):
        xs = sorted(s[index] for s in spreads)
        if not xs:
            continue
        print(
            f"  {label:11s} median {xs[len(xs)//2]:.3f}   p75 {xs[3*len(xs)//4]:.3f}   "
            f"p90 {xs[9*len(xs)//10]:.3f}   max {xs[-1]:.3f}"
        )

    print("\n  the ten with the most varied roofs (hue spread):")
    for h, s, v, name, code in sorted(spreads, key=lambda x: -x[0])[:10]:
        print(f"    hue {h:.3f}  sat {s:.3f}  val {v:.3f}  fn={code:12s} {name[:40]}")


if __name__ == "__main__":
    main()

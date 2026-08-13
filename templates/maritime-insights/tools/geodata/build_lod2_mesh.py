"""Turn LVermGeo SH LoD2 CityGML into a quantised mesh the browser can draw.

PLAN §9 phase 2. Input is one CityGML file per 1 km tile; output is a single planar binary of
vertices plus a small JSON index.

🔴 **`public/` is the public internet, and CityGML is cadastral data.** Every building in the source
carries a cadastral identifier (`gml:id="DESHPDHK0001os2H"`), a municipality key and an ALKIS
function code. **None of it is written here.** A sibling repo published exactly this combination —
cadastral id, exact footprint, building function — for 2 080 real buildings, answering HTTP 200 to
anyone, because the code that dropped those fields lived in the UI rather than in the exporter. The
filter belongs where the file is written. What ships is geometry and a ground elevation.

Encoding, inherited and measured in a sibling repo (60 MB → 26 MB): vertices are written **planar**
as int16 x, uint16 y, int16 z — three separate blocks, so the browser wraps each in a typed array
with no copy — rather than interleaved float32, which is far more precision than a cadastral corner
has.

Usage
  python tools/geodata/build_lod2_mesh.py
  python tools/geodata/build_lod2_mesh.py --min-footprint 20
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import struct
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from aoi import bbox_wsen, cache_dir, load_aoi, terrain_dir
from utm import bbox_to_utm32

NS = {
    "bldg": "http://www.opengis.net/citygml/building/1.0",
    "gml": "http://www.opengis.net/gml",
}
TILE_RE = re.compile(r"_32_(\d{3})_(\d{4})_")
TILE_M = 1000


def rings_of(element: ET.Element) -> list[list[tuple[float, float, float]]]:
    """Every gml:posList under an element, as (easting, northing, height) triples."""
    rings: list[list[tuple[float, float, float]]] = []
    for pos in element.iter(f"{{{NS['gml']}}}posList"):
        if not pos.text:
            continue
        values = [float(v) for v in pos.text.split()]
        points = [(values[i], values[i + 1], values[i + 2])
                  for i in range(0, len(values) - 2, 3)]
        if len(points) >= 4:
            rings.append(points)
    return rings


def ring_area_m2(ring: list[tuple[float, float, float]]) -> float:
    """Shoelace area. The coordinates are already UTM metres, so this is direct."""
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    if len(pts) < 3:
        return 0.0
    total = 0.0
    for (x1, y1, _), (x2, y2, _) in zip(pts, pts[1:] + pts[:1]):
        total += x1 * y2 - x2 * y1
    return abs(total) * 0.5


def read_citygml(path: Path) -> ET.Element:
    """Parse a downloaded CityGML tile.

    🔴 The download service appends the website's HTML footer to whatever it serves — the same
    behaviour that puts `</html>` on the end of every .xyz terrain tile. An XML parser reports it
    as "junk after document element" and refuses the whole file, so the document is cut at its own
    closing tag first. Cutting rather than filtering is deliberate: it fails loudly if the closing
    tag is missing, which is what a genuinely truncated download looks like.
    """
    blob = path.read_bytes()
    end = blob.rfind(b"</core:CityModel>")
    if end == -1:
        raise SystemExit(f"{path.name}: no closing CityModel tag — the download is truncated")
    return ET.fromstring(blob[: end + len(b"</core:CityModel>")])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--min-footprint", type=float, default=20.0,
                        help="drop buildings whose ground surface is smaller, in m²")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    west, south, east, north = bbox_wsen(cfg, "core")
    e0, n0, e1, n1 = bbox_to_utm32(west, south, east, north)
    centre_e = (e0 + e1) / 2
    centre_n = (n0 + n1) / 2

    tiles = sorted(cache_dir("lvermgeo", "lod2").glob("*.xml"))
    if not tiles:
        raise SystemExit("no LoD2 tiles cached — run fetch_lvermgeo.py --product lod2")

    def in_window(path: Path) -> bool:
        match = TILE_RE.search(path.name)
        if not match:
            return False
        te, tn = int(match.group(1)) * 1000, int(match.group(2)) * 1000
        return not (te + TILE_M <= e0 or te >= e1 or tn + TILE_M <= n0 or tn >= n1)

    tiles = [t for t in tiles if in_window(t)]
    print(f"AOI {cfg['id']}: {len(tiles)} LoD2 tiles in the window")

    positions: list[float] = []
    buildings: list[dict] = []
    dropped_small = 0
    dropped_outside = 0
    started = time.time()

    for index, path in enumerate(tiles, 1):
        root = read_citygml(path)

        for building in root.iter(f"{{{NS['bldg']}}}Building"):
            ground_rings = [ring
                            for surface in building.iter(f"{{{NS['bldg']}}}GroundSurface")
                            for ring in rings_of(surface)]
            footprint = max((ring_area_m2(r) for r in ground_rings), default=0.0)
            if footprint < args.min_footprint:
                dropped_small += 1
                continue

            all_rings = rings_of(building)
            if not all_rings:
                continue

            # Clip on the ground centroid: a 1 km tile band reaches past the AOI and those
            # buildings would have no terrain under them.
            source = ground_rings or all_rings
            total_points = sum(len(r) for r in source)
            cx = sum(p[0] for r in source for p in r) / total_points
            cy = sum(p[1] for r in source for p in r) / total_points
            if not (e0 <= cx <= e1 and n0 <= cy <= n1):
                dropped_outside += 1
                continue

            ground_elev = min((p[2] for r in ground_rings for p in r),
                              default=min(p[2] for r in all_rings for p in r))

            start = len(positions) // 3
            for ring in all_rings:
                pts = ring[:-1] if ring[0] == ring[-1] else ring
                if len(pts) < 3:
                    continue
                # Fan triangulation. LoD2 surfaces are planar and simple, which is exactly the
                # case a fan handles correctly; anything more general would be unearned machinery.
                ax, ay, az = pts[0]
                for b, c in zip(pts[1:-1], pts[2:]):
                    for px, py, pz in ((ax, ay, az), b, c):
                        # Scene axes: +x east, +z SOUTH, y up. The terrain raster has row 0 at the
                        # north, so z must grow southwards or every building sits mirrored against
                        # its own ground.
                        positions.extend((px - centre_e, pz, centre_n - py))
            count = len(positions) // 3 - start
            if count:
                buildings.append({
                    "groundElevM": round(ground_elev, 2),
                    "vertexStart": start,
                    "vertexCount": count,
                })

        if index % 20 == 0 or index == len(tiles):
            print(f"  [{index:>3}/{len(tiles)}] {len(buildings)} buildings, "
                  f"{len(positions) // 9} triangles, {time.time() - started:.0f}s")

    if not buildings:
        raise SystemExit("no buildings survived the filters — check the AOI window before "
                         "assuming the tiles are empty")

    print(f"\n  {len(buildings)} buildings, {len(positions) // 3} vertices, "
          f"{len(positions) // 9} triangles")
    print(f"  dropped: {dropped_small} under {args.min_footprint} m², "
          f"{dropped_outside} outside the terrain extent")

    xs = positions[0::3]
    ys = positions[1::3]
    zs = positions[2::3]

    # int16 spans 32 767 steps, so the step suits the AOI rather than being fixed: a quarter metre
    # reaches ±8.19 km, which is not enough for a 17.7 km fjord. The scale travels in the metadata
    # and the loader dequantises with it, so widening it costs the app nothing.
    reach_m = max((abs(v) for v in xs + zs), default=0.0)
    xz_scale = next((s for s in (0.25, 0.5, 1.0, 2.0) if reach_m / s <= 32767), 2.0)
    y_scale = 0.01
    y_offset = math.floor(min(ys)) if ys else 0.0
    print(f"  vertices reach {reach_m:.0f} m from the centre -> x/z step {xz_scale} m")

    def quantise(values: list[float], scale: float, offset: float, lo: int, hi: int) -> list[int]:
        out = []
        for v in values:
            q = int(round((v - offset) / scale))
            if q < lo or q > hi:
                raise SystemExit(
                    f"vertex {v:.1f} falls outside the quantisation range — widen it before "
                    "shipping a bigger AOI"
                )
            out.append(q)
        return out

    qx = quantise(xs, xz_scale, 0.0, -32768, 32767)
    qy = quantise(ys, y_scale, y_offset, 0, 65535)
    qz = quantise(zs, xz_scale, 0.0, -32768, 32767)

    out_dir = terrain_dir(cfg)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = (struct.pack(f"<{len(qx)}h", *qx)
           + struct.pack(f"<{len(qy)}H", *qy)
           + struct.pack(f"<{len(qz)}h", *qz))

    # 🔴 **Two obvious reductions were measured and both fail**, which is worth knowing before
    # anyone reaches for them again:
    #
    #  * **Indexing.** Only 24.5 % of vertex positions are unique, so deduplication looks like an
    #    easy 4x. It is not: 13.9 M uint32 indices cost 55.7 MB, more than the 20.5 MB of shared
    #    vertices saves. 83.62 MB -> 76.22 MB, for a whole new asset format.
    #  * **Dropping small buildings.** The payload is spread evenly rather than sitting in a tail:
    #    the largest 25 % of buildings hold only 49 % of the vertices, and discarding 43 % of the
    #    stock still leaves 65 MB.
    #
    # The mesh is large because there are genuinely 54 000 buildings. What does pay is gzip on the
    # wire (2.7x), so the download is ~31 MB while the GPU buffer stays the raw figure. For scale,
    # a sibling repo ships 3.6 M triangles at 61.7 MB and holds 16.7 ms on an integrated GPU.
    payload = gzip.compress(raw, 6)
    (out_dir / "buildings_lod2.binz").write_bytes(payload)

    # ⚠️ This dict is the privacy boundary. Adding a field here publishes it. gml:id, the
    # municipality key, the ALKIS function code and the footprint rings all exist in the source
    # and none of them are written.
    meta = {
        "aoi": cfg["id"],
        "count": len(buildings),
        "vertexCount": len(positions) // 3,
        "encoding": (f"planar int16 x ({xz_scale} m), uint16 y ({y_scale} m above yOffsetM), "
                     f"int16 z ({xz_scale} m); +x east, +z south"),
        "quantisation": {"xzScaleM": xz_scale, "yScaleM": y_scale, "yOffsetM": y_offset},
        "originUtm": {"easting": centre_e, "northing": centre_n},
        "file": "buildings_lod2.binz",
        "bytes": len(raw),
        "compressedBytes": len(payload),
        "minFootprintM2": args.min_footprint,
        "source": "3D-Gebäudemodell LoD2, Landesamt für Vermessung und Geoinformation "
                  "Schleswig-Holstein",
        "licence": "CC BY 4.0",
        "attribution": "Datenquelle: Landesamt für Vermessung und Geoinformation "
                       "Schleswig-Holstein (LVermGeo SH), CC BY 4.0 [Daten bearbeitet]",
        "privacyNote": "Cadastral identifiers, municipality keys, ALKIS function codes and "
                       "footprint rings exist in the source and are deliberately NOT exported.",
        "builtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "buildings": buildings,
    }
    (out_dir / "buildings_lod2.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    print(f"\n  buildings_lod2.binz  {len(raw) / 1e6:.2f} MB raw -> "
          f"{len(payload) / 1e6:.2f} MB gzipped ({len(raw) / len(payload):.1f}x)")
    print(f"  buildings_lod2.json  "
          f"{(out_dir / 'buildings_lod2.json').stat().st_size / 1e6:.2f} MB")
    print(f"  written to {out_dir}")


if __name__ == "__main__":
    main()

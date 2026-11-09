"""Generate the distribution centre's interior layout and its 24-hour operating day.

⚠️ READ THIS BEFORE TRUSTING ANY NUMBER THIS FILE PRODUCES.

CALDOVA COLOGNE: the building ENVELOPE is measured — footprint polygon and orientation from the
OpenStreetMap survey of the Confex at Koelnmesse (way/888175931), ground height from the Geobasis NRW
DGM1, building height from the NRW nDOM50. Caldova and its use of the Confex are fictional. Everything INSIDE that envelope is invented — zone layout, rack counts,
A-frame channels, pick volumes, headcount, temperatures, tour composition, CO2 factors. No
pharmaceutical wholesaler publishes its floor plan or its throughput, and the building belongs to a
real company (Koelnmesse), so this is a PLAUSIBLE full-line wholesaler configuration and not a claim about this site.
Every figure derived from here carries `provenance: "synthetic"` and the UI badges it.

⚠️ NAMED RNG STREAMS, NOT ONE SEQUENCE. Each attribute draws from `sha256(f"{seed}:{name}")` rather
than from a single walked generator. That means adding an attribute later does NOT shift the values
of the ones already there — screenshots, the spoken demo script and the Power BI report stay valid
across a regeneration. A single `random.seed(n)` looks equivalent and is not: insert one new draw
near the top and every number downstream moves.

The output is deliberately split in two:
  * `public/terrain/<aoi>/operations.json` — what the BROWSER needs, bundled, so the 24 h scrubber
    never waits on a network round trip for geometry it could already hold.
  * `data/operations/<aoi>/tables/*.json` — flat, tabular, one file per table, for the Fabric
    Lakehouse. The semantic model is built from these, and the app's KPI figures come back out of
    the model. Same source, two consumers, so the app and the Power BI report cannot disagree.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "geodata"))

from overpass_client import overpass as _shared_overpass  # noqa: E402  (path set above)

# ── the operating day ────────────────────────────────────────────────────────────────────────────
# 96 slots of 15 minutes. Fine enough that the night pick ramp, the three tour waves and the evening
# cut-off are all distinguishable when scrubbing; coarse enough that the whole day is ~50 KB.
SLOTS_PER_DAY = 96
MINUTES_PER_SLOT = 24 * 60 // SLOTS_PER_DAY

#: Electric van range, and the share of it a planner will commit to.
#:
#: ⚠️ THE APP CARRIES THE SAME TWO NUMBERS in `src/data/whatIf.ts`, because the what-if panel has to
#: print them as stated assumptions. Two copies are two chances to disagree, so
#: `whatIfAgreement.test.ts` reproduces the `withinEvRange` flags below from the app's constants and
#: fails if they ever drift apart.
EV_RANGE_KM = 210
EV_USABLE_FRACTION = 0.8


def rng(seed: int, name: str):
    """A named, independent random stream.

    Returns a closure yielding uniforms in [0,1). The stream is keyed by NAME, so `rng(s,"lines")`
    and `rng(s,"temp")` never interfere and neither moves when the other is added.
    """
    state = hashlib.sha256(f"{seed}:{name}".encode()).digest()
    counter = 0

    def nxt() -> float:
        nonlocal counter, state
        block = hashlib.sha256(state + counter.to_bytes(8, "little")).digest()
        counter += 1
        return struct.unpack("<Q", block[:8])[0] / 2**64

    return nxt


def gauss(u: callable, mu: float, sigma: float) -> float:
    """Box-Muller from a uniform stream, so the named-stream property survives."""
    a, b = max(u(), 1e-12), u()
    return mu + sigma * math.sqrt(-2 * math.log(a)) * math.cos(2 * math.pi * b)


def apportion(total: int, weights: list[float]) -> list[int]:
    """Split an integer total across weights so the parts sum to EXACTLY the total.

    ⚠️ THIS EXISTS BECAUSE ROUNDING EACH SHARE INDEPENDENTLY DOES NOT ADD UP, AND THE MODEL
    NOTICES. The day's order lines are apportioned twice — once across the 96 quarter-hours, and
    again across the zones within each quarter-hour — and every one of those tables becomes a fact
    table in the semantic model. Rounding each share on its own leaves the slot totals a few lines
    short of the drop totals, which would put two different answers to "how many lines a day" into
    one model, reachable by two obvious measures. That is precisely the defect the app-vs-model
    agreement gate exists to catch, and it would have been self-inflicted.

    Largest remainder: floor everything, then hand the shortfall to the largest fractional parts.
    """
    if total <= 0 or not weights:
        return [0] * len(weights)
    mass = sum(weights)
    if mass <= 0:
        return [0] * len(weights)
    exact = [total * w / mass for w in weights]
    floors = [int(x) for x in exact]
    shortfall = total - sum(floors)
    order = sorted(range(len(weights)), key=lambda i: exact[i] - floors[i], reverse=True)
    for i in order[:shortfall]:
        floors[i] += 1
    return floors


# ── geometry helpers ─────────────────────────────────────────────────────────────────────────────
def utm32(lat: float, lon: float) -> tuple[float, float]:
    a, f = 6378137.0, 1 / 298.257223563
    k0, lon0 = 0.9996, math.radians(9.0)
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    la, lo = math.radians(lat), math.radians(lon)
    n = a / math.sqrt(1 - e2 * math.sin(la) ** 2)
    t = math.tan(la) ** 2
    c = ep2 * math.cos(la) ** 2
    aa = (lo - lon0) * math.cos(la)
    m = a * (
        (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256) * la
        - (3 * e2 / 8 + 3 * e2**2 / 32 + 45 * e2**3 / 1024) * math.sin(2 * la)
        + (15 * e2**2 / 256 + 45 * e2**3 / 1024) * math.sin(4 * la)
        - (35 * e2**3 / 3072) * math.sin(6 * la)
    )
    x = k0 * n * (aa + (1 - t + c) * aa**3 / 6 + (5 - 18 * t + t**2 + 72 * c - 58 * ep2) * aa**5 / 120) + 500000
    y = k0 * (
        m
        + n
        * math.tan(la)
        * (aa**2 / 2 + (5 - t + 9 * c + 4 * c**2) * aa**4 / 24 + (61 - 58 * t + t**2 + 600 * c - 330 * ep2) * aa**6 / 720)
    )
    return x, y


def polygon_area(points: list[tuple[float, float]]) -> float:
    """Shoelace about a LOCAL origin.

    ⚠️ Never run this on raw UTM coordinates: x1*y2 is ~3.9e12 while a warehouse contributes ~1e4,
    so the answer is almost entirely floating-point cancellation. This engine has already published
    one wrong geometry finding from exactly that mistake.
    """
    if len(points) < 3:
        return 0.0
    ox, oy = points[0]
    s = 0.0
    for i in range(len(points)):
        x1, y1 = points[i][0] - ox, points[i][1] - oy
        x2, y2 = points[(i + 1) % len(points)][0] - ox, points[(i + 1) % len(points)][1] - oy
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def _hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Convex hull, counter-clockwise (monotone chain)."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    upper: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def principal_axis(points: list[tuple[float, float]]) -> tuple[float, tuple[float, float], float, float]:
    """Orientation, centre and extent of a footprint: its MINIMUM-AREA bounding rectangle.

    Returns (heading_rad, centre, length_along, width_across). The process chain is laid out along
    the LONG side of the real building rather than along north — a hall's flow follows its shape,
    and a chain drawn on the compass would cut diagonally through the walls.

    ⚠️ NOT THE VERTEX COVARIANCE (measured 2026-10-21: with it the orientation of the inside of
    the building did not match). The Confex outline has 28 corners on two wall directions (main
    hall 61.5°, west wing −7.5°); the covariance of its vertices gave 32°, wrong for both walls, and
    its extent box was 219 × 143 m against a 16,084 m² building. One side of the minimum-area
    rectangle always lies on a hull edge, i.e. on a real wall: 61.5°, 191 × 132 m. Decision
    2026-10-21: one rectangle over the whole building.

    The heading points east (north when exactly north-south), the same rule as footprintRect() in
    src/twin3d/footprintRect.ts, so goods-in and the docks land at the same ends in both frames.
    """
    hull = _hull(points)
    best = None
    for i in range(len(hull)):
        a, b = hull[i], hull[(i + 1) % len(hull)]
        t = math.atan2(b[1] - a[1], b[0] - a[0])
        ct, st = math.cos(t), math.sin(t)
        al = [p[0] * ct + p[1] * st for p in points]
        ac = [-p[0] * st + p[1] * ct for p in points]
        area = (max(al) - min(al)) * (max(ac) - min(ac))
        if best is None or area < best[0] - 1e-9:
            best = (area, t, min(al), max(al), min(ac), max(ac))
    _, t, a0, a1, c0, c1 = best
    if (c1 - c0) > (a1 - a0):  # the long side is the along axis
        t += math.pi / 2
        ct, st = math.cos(t), math.sin(t)
        al = [p[0] * ct + p[1] * st for p in points]
        ac = [-p[0] * st + p[1] * ct for p in points]
        a0, a1, c0, c1 = min(al), max(al), min(ac), max(ac)
    if math.cos(t) < -1e-9 or (abs(math.cos(t)) <= 1e-9 and math.sin(t) < 0):
        t += math.pi
        a0, a1, c0, c1 = -a1, -a0, -c1, -c0
    t = math.atan2(math.sin(t), math.cos(t))
    ct, st = math.cos(t), math.sin(t)
    am, cm = (a0 + a1) / 2, (c0 + c1) / 2
    centre = (am * ct - cm * st, am * st + cm * ct)
    return t, centre, a1 - a0, c1 - c0


def measured_height(aoi_id: str, ring: list[tuple[float, float]]) -> tuple[float, float, str]:
    """(eaves, roof plant, source) from nDOM50 samples inside the UTM footprint ring."""
    import re  # noqa: PLC0415

    import numpy as np  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415

    xs, ys = [q[0] for q in ring], [q[1] for q in ring]

    def inside(x: float, y: float) -> bool:
        c = False
        for i in range(len(ring)):
            x1, y1 = ring[i]
            x2, y2 = ring[i - 1]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                c = not c
        return c

    tiles = {}
    for f in (ROOT / "data" / "ndom50" / aoi_id).glob("ndom50_*.tif"):
        m = re.search(r"_32_?(\d{3})_(\d{4})_", f.name)
        if m:
            tiles[(int(m.group(1)), int(m.group(2)))] = f
    cache: dict = {}
    vals = []
    step = 2.0
    y = min(ys)
    while y <= max(ys):
        x = min(xs)
        while x <= max(xs):
            if inside(x, y):
                k = (int(x // 1000), int(y // 1000))
                if k in tiles:
                    if k not in cache:
                        cache[k] = np.asarray(Image.open(tiles[k]), dtype=np.float32)
                    a = cache[k]
                    col = int((x - k[0] * 1000) / 0.5)
                    row = int(((k[1] + 1) * 1000 - y) / 0.5)
                    v = float(a[min(row, a.shape[0] - 1), min(col, a.shape[1] - 1)])
                    if v > -5:
                        vals.append(v)
            x += step
        y += step
    if len(vals) < 50:
        return 10.0, 2.0, f"assumed (only {len(vals)} nDOM samples in the footprint)"
    vals.sort()
    med = vals[len(vals) // 2]
    p95 = vals[int(len(vals) * 0.95)]
    return round(med, 1), round(max(0.5, p95 - med), 1), (
        f"measured: NRW nDOM50 over the footprint, median {med:.1f} m / p95 {p95:.1f} m ({len(vals)} samples)"
    )


def measured_roof(aoi_id: str, ring: list[tuple[float, float]], eaves_m: float) -> dict | None:
    """The hall's ROOF as measured by the NRW nDOM50 (0.5 m), inside the OSM outline plus 5 m.

    ⚠️ THE OSM OUTLINE IS NOT THE BUILDING (measured 2026-10-21 on the DOP orthophoto). way/888175931
    "Halle Confex" also takes in the forecourt west and south of the hall (paving, green strips, part of
    the rail embankment): 16,084 m² on two wall directions, while the hall itself is one rectangle. The
    roof is every cell standing at least 60 % of the eaves height above ground; the largest connected
    patch is the hall (trees and neighbours fall out), closed and hole-filled for the rooftop plant.

    Returns {points (UTM cell centres), areaM2, eavesM, roofM, samples} or None without nDOM tiles.
    """
    import re  # noqa: PLC0415

    import numpy as np  # noqa: PLC0415
    from matplotlib.path import Path as MPath  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415
    from scipy import ndimage  # noqa: PLC0415

    res, margin = 0.5, 5.0
    xs, ys = [q[0] for q in ring], [q[1] for q in ring]
    e0, e1 = math.floor(min(xs) - margin), math.ceil(max(xs) + margin)
    n0, n1 = math.floor(min(ys) - margin), math.ceil(max(ys) + margin)
    tiles = {}
    for f in (ROOT / "data" / "ndom50" / aoi_id).glob("ndom50_*.tif"):
        m = re.search(r"_32_?(\d{3})_(\d{4})_", f.name)
        if m:
            tiles[(int(m.group(1)), int(m.group(2)))] = f
    if not tiles:
        return None
    w, h = int((e1 - e0) / res), int((n1 - n0) / res)
    ex = e0 + (np.arange(w) + 0.5) * res
    ny = n1 - (np.arange(h) + 0.5) * res
    gx, gy = np.meshgrid(ex, ny)
    grid = np.full((h, w), np.nan, dtype=np.float32)
    for (tx, ty), f in tiles.items():
        sel = (gx // 1000 == tx) & (gy // 1000 == ty)
        if not sel.any():
            continue
        a = np.asarray(Image.open(f), dtype=np.float32)
        rows = np.clip(((ty + 1) * 1000 - gy[sel]) / res, 0, a.shape[0] - 1).astype(int)
        cols = np.clip((gx[sel] - tx * 1000) / res, 0, a.shape[1] - 1).astype(int)
        grid[sel] = a[rows, cols]
    poly = MPath(ring)
    pts = np.column_stack([gx.ravel(), gy.ravel()])
    # radius sign depends on the ring's winding; one of the two grows the outline by the margin
    near = (poly.contains_points(pts, radius=2 * margin) | poly.contains_points(pts, radius=-2 * margin)).reshape(h, w)
    roof = near & (np.nan_to_num(grid, nan=-99) >= 0.6 * eaves_m)
    lab, n = ndimage.label(roof)
    if n == 0:
        return None
    sizes = ndimage.sum(roof, lab, range(1, n + 1))
    hall = ndimage.binary_fill_holes(ndimage.binary_closing(lab == int(np.argmax(sizes)) + 1, iterations=2))
    vals = np.sort(grid[hall & ~np.isnan(grid)])
    if len(vals) < 200:
        return None
    r_idx, c_idx = np.nonzero(hall)
    return {
        "points": list(zip(ex[c_idx].tolist(), ny[r_idx].tolist())),
        "areaM2": float(hall.sum() * res * res),
        "eavesM": round(float(vals[len(vals) // 2]), 1),
        "roofM": round(max(0.5, float(vals[int(len(vals) * 0.95)] - vals[len(vals) // 2])), 1),
        "samples": int(len(vals)),
    }


def overpass(query: str) -> dict:
    # ⚠️ The shared client, not a private copy: the copy that lived here sent no User-Agent, so
    # overpass-api.de answered 406 on every attempt and a fresh `npm run data:ops` died here.
    try:
        return _shared_overpass(query)
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"Overpass failed: {exc}") from exc


# ── the zone chain ───────────────────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class ZoneSpec:
    id: str
    en: str
    #: share of the hall's long axis this zone occupies
    span: float
    kind: str
    #: share of the day's picked lines that come out of this zone
    lineShare: float
    #: people on the floor here at the night-shift peak
    peakFte: int
    tempC: float | None
    colour: str
    #: Zone description, shown in the app's most-read panel.
    noteEn: str


#: The process chain of a full-line pharmaceutical wholesaler, goods-in to docks.
#:
#: ⚠️ The SHAPE is the real industry pattern — an A-frame automatic dispenser doing the fast-moving
#: bulk of the lines, a manual zone for everything too big, too slow or too odd for it, a separate
#: 2-8 °C room, a locked narcotics safe, then consolidation and staging behind the docks. The
#: NUMBERS are invented. A wholesaler would recognise the layout and should not recognise the data.
ZONES: list[ZoneSpec] = [
    ZoneSpec("goods_in", "Goods-in", 0.11, "inbound", 0.00, 6, None, "#7c8b9a",
             "Pallets in from pre-wholesale and manufacturers. No order lines are picked here."),
    ZoneSpec("bulk_storage", "Bulk storage", 0.17, "storage", 0.05, 5, None, "#8d9bad",
             "Reserve stock. Replenishes the pick faces; only slow, large-volume lines ship direct."),
    ZoneSpec("a_frame", "A-frame dispenser", 0.16, "automation", 0.46, 4, None, "#fbba00",
             "The machine that makes this industry work: fast movers ejected onto a belt, no human "
             "touch. Fewest people, most lines, which is the whole point and is visible in the twin."),
    ZoneSpec("manual_pick", "Manual pick", 0.20, "pick", 0.39, 34, None, "#92d400",
             "Everything the A-frame cannot hold: bulky, slow-moving, fragile, oversized."),
    ZoneSpec("cold_room", "Cold room 2-8 °C", 0.09, "coldchain", 0.07, 5, 5.0, "#74d2fc",
             "GDP-regulated. An excursion here is not a delay, it is potential write-off."),
    ZoneSpec("btm_safe", "Narcotics safe", 0.04, "secure", 0.01, 2, None, "#8c1896",
             "Controlled substances. Smallest zone in the hall, most regulated square metres in it."),
    ZoneSpec("consolidation", "Consolidation", 0.10, "merge", 0.02, 9, None, "#c9a227",
             "Totes from every zone merged into one delivery per pharmacy."),
    ZoneSpec("staging", "Staging", 0.08, "buffer", 0.00, 5, None, "#a0a8b4",
             "Sorted by tour, in load sequence: last drop loaded first."),
    ZoneSpec("docks", "Docks", 0.05, "outbound", 0.00, 7, None, "#099775",
             "Where the twin stops being a building and becomes a network."),
]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aoi", default="koeln-messe")
    ap.add_argument("--force", action="store_true", help="re-query Overpass for the site geometry")
    args = ap.parse_args()

    from aoi import load_aoi  # noqa: E402

    cfg = load_aoi(args.aoi)
    site = cfg["site3d"]
    seed = int(site["seed"])

    # ── 1. the measured envelope ────────────────────────────────────────────────────────────────
    cache_dir = ROOT / "data" / "operations" / cfg["id"]
    cache_dir.mkdir(parents=True, exist_ok=True)
    geom_cache = cache_dir / "site_geometry.json"

    if geom_cache.exists() and not args.force:
        print(f"site geometry from cache: {geom_cache}")
        raw = json.loads(geom_cache.read_text(encoding="utf-8"))
    else:
        b = cfg["bbox"]
        print("querying Overpass for the site buildings ...")
        raw = overpass(
            f"""[out:json][timeout:120];
            (
              way["building"]({b['south']},{b['west']},{b['north']},{b['east']});
            );
            out geom;"""
        )
        geom_cache.write_text(json.dumps(raw), encoding="utf-8")

    hero_id = int(site["heroBuilding"].split("/")[1])
    hero = next((e for e in raw["elements"] if e["id"] == hero_id), None)
    if hero is None:
        raise SystemExit(
            f"hero building {site['heroBuilding']} not in the site geometry. "
            "Re-run with --force, or fix `site3d.heroBuilding` in the AOI config."
        )

    ring_ll = [(p["lat"], p["lon"]) for p in hero["geometry"]]
    ring = [utm32(la, lo) for la, lo in ring_ll]
    if ring[0] == ring[-1]:
        ring = ring[:-1]
    footprint_m2 = polygon_area(ring)
    heading, (cx, cy), length_m, width_m = principal_axis(ring)

    # ── how tall is the hall? ───────────────────────────────────────────────────────────────────
    # The hero building carries no height tag of its own, and the height is not invented: it is
    # measured (below) rather than assumed or taken from a round number that looked right.
    # ⚠️ MEASURED FROM THE NRW nDOM50, NOT FROM A SIBLING TAG. The Confex carries no height tag and
    # is not in LoD2 yet (opened 2024). nDOM50 (surface minus terrain, 0.5 m) is sampled over the
    # footprint: the median is the main roof (eaves), the 95th percentile minus it the rooftop plant.
    # The exploded interior rises from THIS height, so it clears the real roof in the mesh
    # (An interior below the photographed roof would be swallowed by it.)
    eaves_m, roof_m, height_source = measured_height(cfg["id"], ring)
    # Terrain origin, so the app can place the interior in ITS coordinate frame without re-deriving.
    hm = json.loads((ROOT / "public" / "terrain" / cfg["id"] / "heightmap.json").read_text(encoding="utf-8"))
    origin_e = hm["origin"]["easting"]
    origin_n = hm["origin"]["northing"]

    # ── the hall itself: its measured roof, not the OSM outline (see measured_roof) ─────────────
    osm_footprint_m2 = footprint_m2
    hall_rect = None
    roof = measured_roof(cfg["id"], ring, eaves_m)
    if roof is not None:
        heading, (cx, cy), length_m, width_m = principal_axis(roof["points"])
        footprint_m2 = roof["areaM2"]
        eaves_m, roof_m = roof["eavesM"], roof["roofM"]
        height_source = (
            f"measured: NRW nDOM50 over the hall roof, median {eaves_m:.1f} m / roof plant {roof_m:.1f} m "
            f"({roof['samples']} samples)"
        )
        ct, st = math.cos(heading), math.sin(heading)
        # Goods-in end first (along -L/2), then counter-clockwise.
        hall_rect = [
            (cx + a * ct - c * st, cy + a * st + c * ct)
            for a, c in ((-length_m / 2, -width_m / 2), (length_m / 2, -width_m / 2), (length_m / 2, width_m / 2), (-length_m / 2, width_m / 2))
        ]
    globals()["_HALL"] = (osm_footprint_m2, hall_rect)

    print(f"\n=== measured envelope ({site['heroBuilding']}) ===")
    print(f"  OSM outline    {osm_footprint_m2:,.0f} m2   ({len(ring)} vertices, includes the forecourt)")
    print(f"  hall roof      {footprint_m2:,.0f} m2   [{'nDOM50' if roof else 'NOT MEASURED, OSM outline used'}]")
    print(f"  principal axis {math.degrees(heading):+.1f}°   {length_m:.0f} m along x {width_m:.0f} m across")
    print(f"  centroid UTM32 {cx:,.1f} E  {cy:,.1f} N")
    print(f"  eaves {eaves_m:.1f} m + roof {roof_m:.1f} m   [{height_source}]")

    globals()["_ENVELOPE_HEIGHT"] = (eaves_m, roof_m, height_source)

    # ── 2. lay the process chain along the long axis ────────────────────────────────────────────
    u_rack = rng(seed, "rack_rows")
    zones = []
    cursor = -length_m / 2
    for z in ZONES:
        span = length_m * z.span
        centre_along = cursor + span / 2
        cursor += span
        # Rack rows only where racking makes sense; the A-frame and the docks have none.
        # ⚠️ 3.9 m is the pitch of a pallet-racking aisle — roughly a 1.1 m deep rack against a
        # 2.8 m working aisle. The first version used 7.5 m, which is a road, and produced half
        # the rows a hall this wide actually holds.
        rows = 0
        if z.kind in ("storage", "pick"):
            rows = max(2, int(round(width_m / 3.9 + gauss(u_rack, 0, 0.6))))
        zones.append(
            {
                "id": z.id,
                "name": {"en": z.en},
                "kind": z.kind,
                "sequence": len(zones),
                "colour": z.colour,
                "note": {"en": z.noteEn},
                "areaM2": round(footprint_m2 * z.span, 1),
                "spanM": round(span, 2),
                "widthM": round(width_m, 2),
                "centreAlongM": round(centre_along, 2),
                "rackRows": rows,
                "tempC": z.tempC,
                "lineShare": z.lineShare,
                "peakFte": z.peakFte,
            }
        )

    # ── 3. the operating day ────────────────────────────────────────────────────────────────────
    pharm_path = cache_dir / "pharmacies.json"
    if not pharm_path.exists():
        raise SystemExit(
            f"{pharm_path} not found — run tools/data/fetch_pharmacies.py first. "
            "The drop points are real and are not invented here."
        )
    pharmacies = json.loads(pharm_path.read_text(encoding="utf-8"))["pharmacies"]

    # Deliveries per pharmacy per day: the German full-line wholesale norm is 2-3.
    u_serve = rng(seed, "served")
    u_freq = rng(seed, "delivery_frequency")
    served = []
    for p in pharmacies:
        # Not every pharmacy in the region is served by any single wholesaler. A plausible share is
        # modelled, and the UI must never name which real pharmacy is or is not a customer.
        # Caldova: the ~120 fictional drop points ARE the modelled customer base, so
        # nothing is filtered here. The draw is kept so the named RNG stream stays aligned.
        u_serve()
        p = dict(p)
        p["deliveriesPerDay"] = 2 if u_freq() < 0.45 else 3
        served.append(p)
    drops_per_day = sum(p["deliveriesPerDay"] for p in served)

    print("\n=== modelled operating day (SYNTHETIC) ===")
    print(f"  pharmacies in region      {len(pharmacies):,}   (measured, OpenStreetMap)")
    print(f"  modelled as served        {len(served):,}")
    print(f"  drops per day             {drops_per_day:,}")

    write_outputs(cfg, seed, zones, ring_ll, ring, footprint_m2, heading, (cx, cy),
                  length_m, width_m, origin_e, origin_n, served, drops_per_day, hero)


def write_outputs(cfg, seed, zones, ring_ll, ring, footprint_m2, heading, centroid,
                  length_m, width_m, origin_e, origin_n, served, drops_per_day, hero) -> None:
    """Split the result into the browser asset and the Lakehouse tables. See the module docstring."""
    aoi_id = cfg["id"]

    # ── the road network ────────────────────────────────────────────────────────────────────────
    # Optional: the pipeline still produces a complete day without it, on straight lines. Which of
    # the two produced the tours is written into the output, because "is this a real route" is the
    # first question anyone in logistics asks about a map like this.
    router = None
    graph_path = ROOT / "data" / "operations" / aoi_id / "road_graph.json"
    if graph_path.exists():
        from road_router import RoadRouter  # noqa: PLC0415

        router = RoadRouter(graph_path)
        print(
            f"  road graph                {router.node_count:,} nodes, "
            f"{router.edge_count:,} edges"
        )
    else:
        print(f"  ⚠️ no road graph at {graph_path} — tours fall back to straight lines")
    routed_tours = 0
    straight_tours = 0

    # ── tours and drops ─────────────────────────────────────────────────────────────────────────
    #
    # ⚠️ BUILT BEFORE THE DAY CURVE, AND THAT ORDERING IS THE FIX FOR A REAL DEFECT. The first
    # version invented a day's worth of order lines up front, then built tours in a second pass
    # that silently kept only a fraction of them: the summary printed "501 drops per day" while the
    # `drop` table held 200, and the two numbers appeared in the same console output without
    # anything noticing. A twin whose own two outputs disagree is worse than one with no numbers.
    # Now the drops are enumerated ONCE and everything downstream — lines, tours, KPIs — is derived
    # from that single list, so the figures cannot drift apart.
    waves = cfg["site3d"]["shiftPattern"]["tourWaves"]
    hub = next(p for p in cfg["focusPlaces"] if p.get("kind") == "hero")

    u_lines = rng(seed, "lines_per_drop")
    u_otif = rng(seed, "otif")
    u_veh = rng(seed, "vehicle")

    # Assign each pharmacy's deliveries to waves. Everyone gets the morning wave — that is the one
    # that has to be there when the door opens; the second and third are top-ups.
    by_wave: list[list[dict]] = [[] for _ in waves]
    for p in served:
        by_wave[0].append(p)
        if p["deliveriesPerDay"] >= 2:
            by_wave[1].append(p)
        if p["deliveriesPerDay"] >= 3:
            by_wave[2].append(p)

    def bearing(p) -> float:
        return math.atan2(p["lon"] - hub["lon"], p["lat"] - hub["lat"]) % (2 * math.pi)

    #: Drops per van. A real tour is limited by time window and cage capacity, not by a round
    #: number — this is a model parameter and is surfaced as one.
    DROPS_PER_TOUR = int(cfg["site3d"].get("dropsPerTour", 18))

    tours, drops = [], []
    tour_seq = 0
    for w_index, wave_time in enumerate(waves):
        wave_pharm = sorted(by_wave[w_index], key=bearing)
        for start in range(0, len(wave_pharm), DROPS_PER_TOUR):
            chunk = wave_pharm[start : start + DROPS_PER_TOUR]
            if not chunk:
                continue
            # ⚠️ NEAREST-NEIGHBOUR CHAINING, NOT A SORT BY DISTANCE FROM THE HUB.
            #
            # Sorting the drops by how far they are from the warehouse looks reasonable in a table
            # and is badly wrong on a map: consecutive drops can sit on opposite sides of the
            # sector, and the leg home always runs from the single furthest point. Drawn, 31 tours
            # built that way rendered as a STARBURST of long spokes radiating from the site —
            # nothing that reads as a delivery round.
            #
            # Chaining each drop to the nearest one not yet visited produces the compact
            # out-and-back shape a van actually drives, and it shortens the modelled distance
            # because it stops criss-crossing.
            #
            # It is still explicitly NOT a route optimisation, and the UI still says so: a real
            # tour is built from time windows, cage capacity and road speed. This is a greedy
            # heuristic over straight lines.
            remaining = list(chunk)
            chain = []
            cursor = (hub["lat"], hub["lon"])
            while remaining:
                nxt = min(remaining, key=lambda p: haversine_km(cursor[0], cursor[1], p["lat"], p["lon"]))
                remaining.remove(nxt)
                chain.append(nxt)
                cursor = (nxt["lat"], nxt["lon"])
            chunk = chain
            tour_seq += 1
            tour_id = f"T{tour_seq:03d}"
            hh, mm = (int(x) for x in wave_time.split(":"))
            depart = (hh * 60 + mm) // MINUTES_PER_SLOT

            # ── the shape of the round ──────────────────────────────────────────────────────────
            #
            # ⚠️ ROUTED ON THE REAL ROAD NETWORK where the graph is available. The previous version
            # was a straight-line chain multiplied by 1,32 — a defensible estimate of DISTANCE and
            # an indefensible PICTURE: drawn across a region the legs cut over the river, through
            # rail yards and across open farmland.
            #
            # The straight-line form is kept as a fallback so the pipeline still runs before the
            # road graph has been built, and which one was used is recorded in the output rather
            # than left to be inferred from how the map looks.
            stops = [(p["lat"], p["lon"]) for p in chunk]
            routed = None
            if router is not None:
                sequence = (
                    [router.hub_node]
                    + [router.attach[p["pharmacyId"]] for p in chunk]
                    + [router.hub_node]
                )
                polyline: list[list[float]] = []
                stop_indices: list[int] = []
                metres = 0.0
                for a, b in zip(sequence, sequence[1:]):
                    leg = router.route_leg(a, b)
                    if leg is None:
                        polyline = []
                        break
                    leg_m, _leg_s, points = leg
                    metres += leg_m
                    if not polyline:
                        polyline.extend(points)
                    else:
                        polyline.extend(points[1:])
                    stop_indices.append(len(polyline) - 1)
                if polyline:
                    # The final index is the return to the warehouse, which is not a delivery.
                    routed = (metres / 1000.0, polyline, stop_indices[:-1])

            if routed is not None:
                km, path, stop_at = routed
                routed_tours += 1
            else:
                # ⚠️ Straight-line chain inflated by a detour factor, NOT a routed distance.
                km = chunk[0]["distanceKm"]
                for a, b in zip(chunk, chunk[1:]):
                    km += haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])
                km += chunk[-1]["distanceKm"]
                km *= 1.32
                path = [[round(lat, 6), round(lon, 6)] for lat, lon in stops]
                stop_at = list(range(len(stops)))
                straight_tours += 1

            ev = u_veh() < 0.28
            g_per_km = 106 if ev else 286
            range_km = 210 if ev else 720  # noqa: F841 (kept for the vehicle table)
            tour_lines = 0
            on_time = 0
            for i, p in enumerate(chunk):
                dl = max(3, round(gauss(u_lines, 22.0, 9.0)))
                tour_lines += dl
                ok = u_otif() < 0.968
                on_time += 1 if ok else 0
                drops.append(
                    {
                        "dropId": f"{tour_id}-{i + 1:02d}",
                        "tourId": tour_id,
                        "pharmacyId": p["pharmacyId"],
                        "wave": w_index + 1,
                        "sequence": i + 1,
                        "plannedSlot": (depart + 2 + i) % SLOTS_PER_DAY,
                        "lines": dl,
                        "onTimeInFull": ok,
                    }
                )
            duration_slots = max(4, int(len(chunk) * 0.9 + km / 28 * 4))
            tours.append(
                {
                    "tourId": tour_id,
                    "wave": w_index + 1,
                    "waveTime": wave_time,
                    "departSlot": depart,
                    "returnSlot": (depart + duration_slots) % SLOTS_PER_DAY,
                    "drops": len(chunk),
                    "lines": tour_lines,
                    "distanceKm": round(km, 2),
                    "kmPerDrop": round(km / len(chunk), 2),
                    "onTimeDrops": on_time,
                    "vehicleId": f"V{tour_seq:03d}",
                    "vehicleType": "electric" if ev else "diesel",
                    "gCo2": round(km * g_per_km),
                    # ⚠️ ALWAYS THE ELECTRIC RANGE, WHATEVER THIS TOUR ACTUALLY RUNS ON. The field
                    # asks "could an electric van physically do this round?", and the semantic
                    # model documents it that way. It used to be evaluated against `range_km`,
                    # which is 720 km for a diesel tour — so a diesel round was judged against a
                    # diesel tank and could be reported as EV-reachable when it is not. Every tour
                    # here is 42-122 km so both thresholds agree today and the output is byte for
                    # byte the same; the bug was masked, not absent, and a longer rural round would
                    # have surfaced it as a wrong claim in the one KPI the EV story rests on.
                    "withinEvRange": km <= EV_RANGE_KM * EV_USABLE_FRACTION,
                    "pharmacyIds": [p["pharmacyId"] for p in chunk],
                    "path": path,
                    # Which points on the path are deliveries. With a routed path most points are
                    # road geometry; without this the app cannot tell a junction from a customer.
                    "stopIndices": stop_at,
                    "routed": routed is not None,
                }
            )

    # ── which tours run a truck (by volume) ──────────────────────
    # The tours carrying the most order lines — the top `truckShare` — get a 7.5 t box truck, the
    # rest a Sprinter-size van. Ranked, not thresholded, so the share holds whatever the volumes are.
    share = float(cfg["site3d"].get("vehicles", {}).get("truckShare", 0.0))
    n_trucks = round(len(tours) * share)
    for rank, t in enumerate(sorted(tours, key=lambda t: (-t["lines"], t["tourId"]))):
        t["vehicleClass"] = "truck" if rank < n_trucks else "van"
    print(f"  vehicles                  {n_trucks} trucks (7.5 t), {len(tours) - n_trucks} vans")

    # ── bridge decks from the photographed mesh ────────────────
    # Interpolating between landings left the Deutzer Brücke deck 4.6 m and the Severinsbrücke 8.5 m
    # below the real deck (tools/verify_bridge_decks.py): Rhine bridges rise for shipping clearance.
    # So bridge segments (both ends flagged 2) are densified every DECK_STEP_M and every point takes
    # the top of the 3D-Mesh inside a window around the interpolated deck — high enough to reach the
    # real deck, bounded so a pylon, a cable or the river cannot capture it. A point with no mesh
    # surface in the window keeps the interpolated height and is counted.
    DECK_STEP_M, DECK_WINDOW = 15.0, (-3.0, 15.0)
    surface = None
    if router is not None and (ROOT / "public" / "terrain" / aoi_id / "mesh.json").exists():
        sys.path.insert(0, str(ROOT / "tools" / "geodata"))
        from mesh_surface import MeshSurface  # noqa: PLC0415

        surface = MeshSurface(ROOT / "public" / "terrain" / aoi_id)
    if surface is not None:
        sampled = kept_interp = 0
        for t in tours:
            old_path, old_stops = t["path"], t["stopIndices"]
            new_path: list[list[float]] = []
            remap_idx: dict[int, int] = {}
            for i, q in enumerate(old_path):
                if i > 0:
                    p0 = old_path[i - 1]
                    if len(p0) > 3 and len(q) > 3 and p0[3] == 2 and q[3] == 2:
                        dy = (q[0] - p0[0]) * 111320.0
                        dx = (q[1] - p0[1]) * 111320.0 * math.cos(math.radians(p0[0]))
                        n_extra = int(math.hypot(dx, dy) // DECK_STEP_M)
                        for k in range(1, n_extra + 1):
                            f = k / (n_extra + 1)
                            new_path.append([round(p0[0] + (q[0] - p0[0]) * f, 6),
                                             round(p0[1] + (q[1] - p0[1]) * f, 6),
                                             round(p0[2] + (q[2] - p0[2]) * f, 2), 2])
                remap_idx[i] = len(new_path)
                new_path.append(list(q))
            hit = [False] * len(new_path)

            def deck(k: int) -> bool:
                return 0 <= k < len(new_path) and len(new_path[k]) > 3 and new_path[k][3] == 2

            for i_q, q in enumerate(new_path):
                # A LANDING (first/last deck point of a run, next to a street point) stays at the
                # approach height from the graph: the mesh there can be a structure crossing above
                # (measured +10 m at a landing near 50.9465 / 6.9916).
                if deck(i_q) and deck(i_q - 1) and deck(i_q + 1):
                    e, n = utm32(q[0], q[1])
                    m = surface.top(e, n, q[2] + DECK_WINDOW[0], q[2] + DECK_WINDOW[1])
                    if m is not None:
                        q[2] = round(m, 2)
                        hit[i_q] = True
                        sampled += 1
            # Landings continue the street they join: the path's own neighbour, so the vehicle can
            # never step up or down at the bridge end (graph landings missed ways that end on
            # another raised way, measured 7.7 m below the approach near 50.9018 / 6.9928).
            for i_q, q in enumerate(new_path):
                if deck(i_q):
                    if 0 < i_q and not deck(i_q - 1):
                        q[2] = new_path[i_q - 1][2]
                    elif i_q + 1 < len(new_path) and not deck(i_q + 1):
                        q[2] = new_path[i_q + 1][2]
                        # A deck point with no mesh surface in its window (a hole in the photogrammetry, measured
            # at the Zoobrücke ramp) takes the line between the nearest SAMPLED deck points on the same
            # run — not the landing-interpolated graph height, which can be 10 m below the deck.
            for i_q, q in enumerate(new_path):
                if deck(i_q) and deck(i_q - 1) and deck(i_q + 1) and not hit[i_q]:
                    lo_i = next((j for j in range(i_q - 1, -1, -1) if hit[j]), None)
                    hi_i = next((j for j in range(i_q + 1, len(new_path)) if hit[j]), None)
                    run_ok = lambda a, b: all(len(new_path[k]) > 3 and new_path[k][3] == 2 for k in range(min(a, b), max(a, b) + 1))  # noqa: E731
                    if lo_i is not None and hi_i is not None and run_ok(lo_i, hi_i):
                        f = (i_q - lo_i) / (hi_i - lo_i)
                        q[2] = round(new_path[lo_i][2] + (new_path[hi_i][2] - new_path[lo_i][2]) * f, 2)
                    elif lo_i is not None and run_ok(lo_i, i_q):
                        q[2] = new_path[lo_i][2]
                    elif hi_i is not None and run_ok(i_q, hi_i):
                        q[2] = new_path[hi_i][2]
                    kept_interp += 1
            t["path"] = new_path
            t["stopIndices"] = [remap_idx[i] for i in old_stops]
        print(f"  bridge decks from mesh    {sampled:,} points on the photographed deck, {kept_interp:,} filled from deck neighbours")

    # ── slope limiter (measured 2026-10-17) ───────────────────────────────────────────────────
    # DGM1 is bare earth sampled at the road CENTRELINE. Where a road runs in a trough (tunnel ramps
    # at Markmannsgasse / Rheinufertunnel), beside the sunken Ebertplatz, or onto a bridge approach,
    # one vertex catches the trough wall and the path jumps 4-6 m over 5-10 m. Real streets do not.
    # Each violating segment has both ends moved half-way towards each other until no grade exceeds
    # MAX_GRADE. Every adjustment is counted, and one larger than MAX_ADJUST_M fails the build — a
    # limiter that silently absorbed a 20 m error would hide exactly the bug the gate exists for.
    MAX_GRADE, MAX_ADJUST_M = 0.12, 4.0
    if router is not None and router.elev is not None:
        moved, biggest = 0, 0.0
        where = None
        for t in tours:
            path = t["path"]
            original = [q[2] for q in path]
            converged = False
            for _ in range(5000):
                changed = False
                for i in range(len(path) - 1):
                    p0, p1 = path[i], path[i + 1]
                    if (len(p0) > 3 and p0[3] == 1) or (len(p1) > 3 and p1[3] == 1):
                        continue
                    dy = (p1[0] - p0[0]) * 111320.0
                    dx = (p1[1] - p0[1]) * 111320.0 * math.cos(math.radians(p0[0]))
                    run = max(math.hypot(dx, dy), 0.5)
                    rise = p1[2] - p0[2]
                    allowed = max(2.0, MAX_GRADE * run)
                    if abs(rise) > allowed + 1e-3:
                        # Unrounded while iterating: rounding each step to 1 cm made it oscillate.
                        excess = (abs(rise) - allowed) / 2 * (1 if rise > 0 else -1)
                        p0[2] = p0[2] + excess
                        p1[2] = p1[2] - excess
                        changed = True
                if not changed:
                    converged = True
                    break
            if not converged:
                raise SystemExit(f"slope limiter did not converge on {t['tourId']}")
            for q in path:
                q[2] = round(q[2], 2)
            for i_q, (q, h0) in enumerate(zip(path, original)):
                # Deck/landing points carry the bridge-end ramp (Zoobrücke interchange: 10 m over a
                # few points) and may move up to 6 m, like tunnel portals in the graph; others 4 m.
                d = abs(q[2] - h0) - (2.0 if len(q) > 3 and q[3] == 2 else 0.0)
                if d > 0.01:
                    moved += 1
                    if d > biggest:
                        biggest = d
                        where = (t["tourId"], q[0], q[1], h0, q[2], q[3] if len(q) > 3 else 0,
                                 [round(x[2], 1) for x in path[max(0, i_q - 3):i_q + 4]],
                                 [round(o, 1) for o in original[max(0, i_q - 3):i_q + 4]],
                                 [x[3] if len(x) > 3 else 0 for x in path[max(0, i_q - 3):i_q + 4]])
        print(f"  slope limiter             {moved} path points adjusted, largest {biggest:.1f} m over its allowance "
              "(4 m; 6 m on bridge decks and landings)")
        if biggest > 0:
            print(f"    largest at {where}")
        if biggest > MAX_ADJUST_M:
            raise SystemExit(f"the slope limiter had to move a point by {biggest:.1f} m — that is a height error, not a trough wall")

    # ── do the baked heights make sense? ─────────────────────────────────────
    # A vertex-to-vertex grade steeper than 12 % over more than 2 m of rise is not a road: it is a
    # bridge deck that lost its interpolation, a DGM fallback, or a tunnel portal done wrong.
    if router is not None and router.elev is not None:
        bad, total = 0, 0
        worst = (0.0, "")
        for t in tours:
            for p0, p1 in zip(t["path"], t["path"][1:]):
                if (len(p0) > 3 and p0[3] == 1) or (len(p1) > 3 and p1[3] == 1):
                    continue  # tunnel: underground on purpose
                dy = (p1[0] - p0[0]) * 111320.0
                dx = (p1[1] - p0[1]) * 111320.0 * math.cos(math.radians(p0[0]))
                run = max(math.hypot(dx, dy), 0.5)
                rise = abs(p1[2] - p0[2])
                total += 1
                if rise > 2.0 and rise / run > 0.12:
                    bad += 1
                    if rise > worst[0]:
                        worst = (rise, f"{t['tourId']} at {p0[0]:.5f},{p0[1]:.5f}")
        print(f"  height jumps              {bad} of {total:,} segments (worst {worst[0]:.1f} m, {worst[1]})")
        if bad > total * 0.002:
            raise SystemExit(f"{bad} path segments climb more than 12 % over 2 m — check bridge/tunnel heights")

    # The drop list is now the single source of truth for the day's volume.
    total_lines = sum(d["lines"] for d in drops)
    if len(drops) != drops_per_day:
        raise SystemExit(
            f"internal inconsistency: {drops_per_day} drops were modelled but {len(drops)} were "
            "built into tours. Every modelled delivery must end up on exactly one tour."
        )
    print(f"  order lines per day       {total_lines:,}")

    # ── did the tours actually follow roads? ────────────────────────────────────────────────────
    #
    # ⚠️ A PARTLY ROUTED DAY IS THE WORST OUTCOME AND THE EASIEST TO SHIP. Some tours snapped to
    # streets and some cutting across the Rhine looks, at a glance, like a rendering artefact
    # rather than a data problem — so it survives review. Either the network was used or it was
    # not, and mixing the two silently is what this refuses to allow.
    if router is not None:
        print(f"  routed on real roads      {routed_tours} of {routed_tours + straight_tours}")
        if router.unroutable:
            print(f"  ⚠️ {router.unroutable} legs could not be routed at all")
        if straight_tours:
            raise SystemExit(
                f"a road graph is present but {straight_tours} of "
                f"{routed_tours + straight_tours} tours fell back to straight lines. That is a "
                "disconnected graph or a bad attachment, not something to ship half-done — "
                "rebuild with tools/data/build_road_graph.py and check the reachability report."
            )

        # ⚠️ A ROUTED PATH CAN STILL LOOK LIKE A STRAIGHT LINE, AND DID. Simplifying each leg at a
        # 12 m tolerance left a median segment of 177 m and one straight run of 6 km: correct as
        # distance, and from the ride-along camera indistinguishable from the straight-line routing
        # this whole module exists to remove. "Routed" is not the property that matters to a
        # viewer; "follows the bend in the road" is. So the geometry is measured, not assumed.
        segments = []
        for tour in tours:
            path = tour["path"]
            for a, b in zip(path, path[1:]):
                dy = (b[0] - a[0]) * 111320.0
                dx = (b[1] - a[1]) * 111320.0 * math.cos(math.radians(a[0]))
                segments.append(math.hypot(dx, dy))
        segments.sort()
        median = segments[len(segments) // 2] if segments else 0.0
        print(f"  median path segment       {median:.0f} m ({len(segments):,} segments)")
        if median > 120:
            raise SystemExit(
                f"the routed paths have a median segment of {median:.0f} m. At that spacing a van "
                "cuts the corner off every gentle curve and drives beside the road rather than on "
                "it — which is what a viewer calls a straight line. Lower simplify_m in "
                "tools/data/road_router.py."
            )

    # ── the day curve ───────────────────────────────────────────────────────────────────────────
    # Night picking is the operating reality: the bulk of the work happens between 21:00 and 04:00
    # so the first wave can be on the road before pharmacies open. The curve below is a model of
    # that shape, not a measurement of it.
    u_noise = rng(seed, "slot_noise")

    def shift_weight(slot: int) -> float:
        minute = slot * MINUTES_PER_SLOT
        hour = minute / 60.0
        # three humps: the big night pick, a midday top-up, a smaller late-afternoon run
        night = math.exp(-(((hour - 1.0 + (24 if hour > 12 else 0)) % 24 - 1.0) ** 2) / 18.0)
        if hour >= 21:
            night = max(night, math.exp(-((hour - 23.5) ** 2) / 6.0))
        midday = 0.42 * math.exp(-((hour - 9.5) ** 2) / 4.0)
        late = 0.28 * math.exp(-((hour - 14.5) ** 2) / 3.0)
        return max(night + midday + late, 0.02)

    weights = [shift_weight(s) * (0.9 + 0.2 * u_noise()) for s in range(SLOTS_PER_DAY)]
    # `total_lines` comes from the drop list built above — the single source of truth for volume.
    lines_by_slot = apportion(total_lines, weights)

    slots = []
    for s in range(SLOTS_PER_DAY):
        minute = s * MINUTES_PER_SLOT
        h, m = divmod(minute, 60)
        hour = minute / 60
        shift = "night" if (hour >= 21 or hour < 5) else "early" if hour < 12 else "day" if hour < 18 else "late"
        slots.append(
            {
                "slotId": s,
                "minute": minute,
                "label": f"{h:02d}:{m:02d}",
                "hour": h,
                "shift": shift,
                "lines": lines_by_slot[s],
            }
        )

    # ── per-zone, per-slot picking ──────────────────────────────────────────────────────────────
    # Apportioned, not rounded independently: SUM(pick_event) must equal SUM(time_slot) must equal
    # SUM(drop) or the semantic model holds two different day volumes. See `apportion`.
    u_zone = rng(seed, "zone_slot")
    u_fte = rng(seed, "fte")
    picking_zones = [z for z in zones if z["lineShare"] > 0]
    peak_slot_lines = max(lines_by_slot) or 1
    pick_rows = []
    for s in slots:
        zone_weights = [z["lineShare"] * (0.85 + 0.3 * u_zone()) for z in picking_zones]
        zone_lines = apportion(s["lines"], zone_weights)
        active = s["lines"] / peak_slot_lines
        for z, lines in zip(picking_zones, zone_lines):
            fte = max(1, round(z["peakFte"] * (0.25 + 0.75 * active) * (0.9 + 0.2 * u_fte())))
            pick_rows.append(
                {
                    "zoneId": z["id"],
                    "slotId": s["slotId"],
                    "lines": lines,
                    "fte": fte,
                    "linesPerFteHour": round(lines / fte * (60 / MINUTES_PER_SLOT), 1),
                }
            )

    # ── cold chain ──────────────────────────────────────────────────────────────────────────────
    # 2-8 °C, with the door-opening excursions that a real cold room has and a perfect model does
    # not. A cold chain that never leaves band is not a reassuring demo, it is an unbelievable one.
    u_temp = rng(seed, "cold_temp")
    u_exc = rng(seed, "cold_excursion")
    cold_rows = []
    excursion_minutes = 0
    for s in slots:
        temp = gauss(u_temp, 4.6, 0.55)
        # door traffic tracks picking activity
        load = s["lines"] / max(max(lines_by_slot), 1)
        if u_exc() < 0.045 * (0.3 + load):
            temp += 3.0 + 2.5 * u_exc()
        in_range = 2.0 <= temp <= 8.0
        if not in_range:
            excursion_minutes += MINUTES_PER_SLOT
        cold_rows.append(
            {
                "zoneId": "cold_room",
                "slotId": s["slotId"],
                "tempC": round(temp, 2),
                "inRange": in_range,
            }
        )

    vehicles = [
        {
            "vehicleId": t["vehicleId"],
            "type": t["vehicleType"],
            # 7.5 t truck or Sprinter-size van. ⚠️ Range and gCO2/km below are still van
            # figures for both classes — CO2 is out of v1 (D9), recorded as a known simplification.
            "vehicleClass": t.get("vehicleClass", "van"),
            "rangeKm": 210 if t["vehicleType"] == "electric" else 720,
            "gCo2PerKm": 106 if t["vehicleType"] == "electric" else 286,
        }
        for t in tours
    ]

    # ── headline figures ────────────────────────────────────────────────────────────────────────
    total_drops = len(drops)
    on_time_drops = sum(1 for d in drops if d["onTimeInFull"])
    total_km = sum(t["distanceKm"] for t in tours)
    total_co2 = sum(t["gCo2"] for t in tours)
    peak_lines_hour = max(lines_by_slot) * (60 / MINUTES_PER_SLOT)
    within_range = sum(1 for t in tours if t["withinEvRange"])
    run_electric = sum(1 for t in tours if t["vehicleType"] == "electric")

    kpis = {
        "linesPerDay": total_lines,
        "peakLinesPerHour": round(peak_lines_hour),
        "otifPct": round(100 * on_time_drops / max(total_drops, 1), 2),
        "coldChainExcursionMinutes": excursion_minutes,
        "dropsPerDay": total_drops,
        "toursPerDay": len(tours),
        "dropsPerTour": round(total_drops / max(len(tours), 1), 2),
        "kmPerDrop": round(total_km / max(total_drops, 1), 2),
        "totalKm": round(total_km, 1),
        "gCo2PerDrop": round(total_co2 / max(total_drops, 1)),
        # ⚠️ TWO NUMBERS, NOT ONE, AND THE GAP BETWEEN THEM IS THE FINDING.
        # `withinEvRangePct` asks whether an electric van could physically do the tour;
        # `runElectricPct` asks whether one is doing it today. In a region this dense the first is
        # essentially 100 % — every tour is well inside a 210 km range — so reporting it alone
        # produces a triumphant, useless "100 % electrifiable". Reported together they say what is
        # actually true: the constraint on electrifying this fleet is capital and charging
        # infrastructure, not physics. That is a conversation a CFO can act on.
        "withinEvRangePct": round(100 * within_range / max(len(tours), 1), 1),
        "runElectricPct": round(100 * run_electric / max(len(tours), 1), 1),
    }

    print("\n=== headline figures (SYNTHETIC — badge everywhere) ===")
    for k, v in kpis.items():
        print(f"  {k:<28} {v:,}" if isinstance(v, (int, float)) else f"  {k:<28} {v}")

    # ── internal consistency gate ──────────────────────────────────────────────────────
    # Three tables state the day's volume and they must state the SAME volume, because all three
    # become fact tables in the semantic model and a report author can reach any of them.
    slot_total = sum(s["lines"] for s in slots)
    pick_total = sum(r["lines"] for r in pick_rows)
    if not (total_lines == slot_total == pick_total):
        raise SystemExit(
            "internal inconsistency: the day's order lines disagree across tables — "
            f"drops {total_lines:,}, time slots {slot_total:,}, pick events {pick_total:,}. "
            "All three feed the semantic model; two answers to one question is not shippable."
        )
    print(f"  consistency: drops = slots = pick events = {total_lines:,} lines ✓")

    # ── browser asset ───────────────────────────────────────────────────────────────────────────
    terrain_dir = ROOT / "public" / "terrain" / aoi_id
    terrain_dir.mkdir(parents=True, exist_ok=True)
    browser = {
        "aoi": aoi_id,
        "provenance": {
            "envelope": "measured",
            "envelopeSource": "Hall roof measured from Geobasis NRW nDOM50 inside the OpenStreetMap outline; ground from DGM1",
            "dropPoints": "measured",
            "dropPointsSource": "OpenStreetMap amenity=pharmacy",
            "interior": "synthetic",
            "operations": "synthetic",
            "$note": (
                "The building outline and the pharmacy locations are real. The zone layout, the "
                "throughput, the temperatures, the tours and the emissions are a seeded model of a "
                "plausible full-line wholesaler and are not anybody's real data."
            ),
        },
        "seed": seed,
        "envelope": {
            "heroBuilding": cfg["site3d"]["heroBuilding"],
            "footprintM2": round(footprint_m2, 1),
            "eavesM": globals().get("_ENVELOPE_HEIGHT", (10.0, 2.0, "assumed"))[0],
            "roofM": globals().get("_ENVELOPE_HEIGHT", (10.0, 2.0, "assumed"))[1],
            "heightSource": globals().get("_ENVELOPE_HEIGHT", (10.0, 2.0, "assumed"))[2],
            "headingRad": round(heading, 6),
            "lengthM": round(length_m, 2),
            "widthM": round(width_m, 2),
            "centroidUtm": [round(centroid[0], 2), round(centroid[1], 2)],
            "osmFootprintM2": round(globals().get("_HALL", (footprint_m2, None))[0], 1),
            # The hall rectangle the interior is laid out in (UTM32, goods-in end first), measured from
            # the nDOM50 roof. Absent without nDOM tiles: the app then fits the OSM ring.
            **(
                {"hallRectUtm": [[round(e, 2), round(n, 2)] for e, n in globals()["_HALL"][1]]}
                if globals().get("_HALL", (0, None))[1]
                else {}
            ),
            "terrainOriginUtm": [origin_e, origin_n],
            "ringLatLon": [[round(la, 7), round(lo, 7)] for la, lo in ring_ll],
        },
        "zones": zones,
        "slots": slots,
        "shiftPattern": cfg["site3d"]["shiftPattern"],
        "coldChain": cold_rows,
        "pickByZoneSlot": pick_rows,
        "tours": tours,
        "routing": {
            # Stated in the data rather than left to be inferred from how the map looks. "Is this
            # a real route" is the first question anyone in logistics asks about a picture like
            # this, and the answer should not depend on the viewer squinting at a river crossing.
            "mode": "osm-network" if router is not None else "straight-line",
            "source": router.source if router is not None else None,
            "attribution": router.attribution if router is not None else None,
            "note": (
                "The road NETWORK is real (OpenStreetMap). One-way streets are honoured, turn "
                "restrictions are not, speeds are a model and the stop order is a nearest-neighbour "
                "heuristic. Heights per path point are baked from DGM1, bridges interpolated."
            ),
            "routedTours": routed_tours,
            "straightLineTours": straight_tours,
        },
        "kpis": kpis,
        "pharmacies": [
            {"id": p["pharmacyId"], "name": p["name"], "lat": p["lat"], "lon": p["lon"],
             "km": p["distanceKm"]}
            for p in served
        ],
    }
    out = terrain_dir / "operations.json"
    out.write_text(json.dumps(browser, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\nwrote {out}  ({out.stat().st_size / 1e6:.2f} MB)")

    # ── Lakehouse tables ────────────────────────────────────────────────────────────────────────
    tables_dir = ROOT / "data" / "operations" / aoi_id / "tables"
    tables_dir.mkdir(parents=True, exist_ok=True)
    tables = {
        # ⚠️ FLATTEN THE LOCALISED FIELDS. The browser asset carries `name` and `note` as {en} objects
        # (the shape the UI's locale lookup reads); a Delta column is a plain string, so every downstream
        # DAX measure and report visual reads one. One shape per consumer, flattened at the boundary.
        "dc_zone": [
            {k: v for k, v in z.items() if k not in ("name", "note")}
            | {"name": z["name"]["en"], "note": z["note"]["en"]}
            for z in zones
        ],
        "time_slot": slots,
        "pick_event": pick_rows,
        "cold_chain_reading": cold_rows,
        "tour": [
            {k: v for k, v in t.items() if k not in ("path", "pharmacyIds", "stopIndices")}
            for t in tours
        ],
        "drop": drops,
        "vehicle": vehicles,
        "pharmacy": [
            {
                "pharmacyId": p["pharmacyId"],
                "name": p["name"],
                "lat": p["lat"],
                "lon": p["lon"],
                "distanceKm": p["distanceKm"],
            }
            for p in served
        ],
    }
    for name, rows in tables.items():
        path = tables_dir / f"{name}.json"
        path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        print(f"  {name:<20} {len(rows):>7,} rows -> {path.name}")

    (tables_dir / "_kpis.json").write_text(json.dumps(kpis, indent=1), encoding="utf-8")


def haversine_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = p2 - p1
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


if __name__ == "__main__":
    main()

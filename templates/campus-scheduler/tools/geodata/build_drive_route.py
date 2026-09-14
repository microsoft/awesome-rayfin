"""The drivable route between an AOI's campuses — for the shuttle in the twin.

⚠️ **WHY NOT REUSE `walk-routes.json`.** That file already holds a measured 3.5 km path between
OTH's two campuses, and driving a bus along it would have cost nothing. It is a PEDESTRIAN route:
it runs over footways, through a park and across a footbridge. A bus following it would drive
where no bus can go, in a photoreal twin, in front of the people who know that ground better than
anyone in the room. The walking path answers "how long on foot"; this answers "how long by road",
and they are different paths.

What this does, which is the smallest thing that is honest:

  1. fetch the road network around both campus anchors from OpenStreetMap
  2. build a graph whose nodes are JUNCTIONS, not OSM ids
  3. Dijkstra from one campus to the other, on distance
  4. write the polyline, its length, and a driving time derived from OSM's own speed classes

⚠️ **NODES ARE KEYED BY ROUNDED COORDINATE, NOT BY OSM NODE ID.** Ways that meet at a junction do
not necessarily share a node id in the extract, so an id-keyed graph comes out as a heap of
disconnected islands and Dijkstra reports no route between two places plainly joined by a road.
Snapping to half a metre and keying on the coordinate is what actually welds the junctions. This
is PHOENIX's lesson (`build_road_graph.py`), paid for once already; it is not re-learned here.

Run:  python tools/geodata/build_drive_route.py --aoi oth-regensburg
      python tools/geodata/build_drive_route.py --all
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from overpass_client import overpass  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
AOI_DIR = ROOT / "config" / "aoi"
OUT_DIR = ROOT / "public" / "terrain"

# Roads a scheduled shuttle could actually use. Service roads, tracks and pedestrian ways are out:
# the first two are car parks and field access, the third is the mistake this file exists to avoid.
ROAD_SPEED_KMH: dict[str, int] = {
    "motorway": 100,
    "motorway_link": 60,
    "trunk": 80,
    "trunk_link": 50,
    "primary": 60,
    "primary_link": 40,
    "secondary": 55,
    "secondary_link": 40,
    "tertiary": 50,
    "tertiary_link": 35,
    "unclassified": 40,
    "residential": 30,
    "living_street": 12,
}

# Half a metre. Fine enough that two genuinely different junctions never collide, coarse enough
# that the same junction written twice by two ways lands on one key.
SNAP_M = 0.5


def bbox_for(anchors: list[dict[str, float]], margin_m: float = 900.0) -> tuple[float, float, float, float]:
    """A box containing every campus, plus enough margin to route AROUND rather than through."""
    lats = [a["lat"] for a in anchors]
    lons = [a["lon"] for a in anchors]
    dlat = margin_m / 111_320.0
    mid = math.radians(sum(lats) / len(lats))
    dlon = margin_m / (111_320.0 * max(math.cos(mid), 0.2))
    return (min(lats) - dlat, min(lons) - dlon, max(lats) + dlat, max(lons) + dlon)


def metres_between(a: tuple[float, float], b: tuple[float, float], lat0: float) -> float:
    """Local flat-earth distance. Over a few kilometres the error is centimetres."""
    k = math.cos(math.radians(lat0))
    dx = (a[1] - b[1]) * 111_320.0 * k
    dy = (a[0] - b[0]) * 111_320.0
    return math.hypot(dx, dy)


def fetch_roads(bbox: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    south, west, north, east = bbox
    kinds = "|".join(ROAD_SPEED_KMH)
    query = (
        f"[out:json][timeout:180];"
        f'way["highway"~"^({kinds})$"]({south:.6f},{west:.6f},{north:.6f},{east:.6f});'
        f"out geom;"
    )
    data = overpass(query)
    ways = [e for e in data.get("elements", []) if e.get("type") == "way" and e.get("geometry")]
    # ⚠️ A 200 with no roads is a FAILURE, not an empty region. A mirror returned exactly that for
    # a box with a motorway through it; treating it as "no roads here" would have written an empty
    # route file and called the build a success.
    if not ways:
        raise SystemExit(
            "Overpass returned 200 but no roads for a box that certainly has some — "
            "treat as a failed fetch and re-run rather than writing an empty route."
        )
    return ways


def build_graph(ways: list[dict[str, Any]], lat0: float) -> tuple[list[tuple[float, float]], list[list[tuple[int, float, float]]]]:
    """Junction graph. Returns (coords as (lat, lon), adjacency of (node, metres, seconds))."""
    index: dict[tuple[int, int], int] = {}
    coords: list[tuple[float, float]] = []
    adjacency: list[list[tuple[int, float, float]]] = []
    k = math.cos(math.radians(lat0))

    def node_for(lat: float, lon: float) -> int:
        # Snap in METRES, so the tolerance means the same thing at every latitude.
        key = (
            int(round(lat * 111_320.0 / SNAP_M)),
            int(round(lon * 111_320.0 * k / SNAP_M)),
        )
        got = index.get(key)
        if got is None:
            got = len(coords)
            index[key] = got
            coords.append((lat, lon))
            adjacency.append([])
        return got

    for way in ways:
        speed = ROAD_SPEED_KMH.get(way.get("tags", {}).get("highway", ""), 30)
        geom = way["geometry"]
        previous = None
        for point in geom:
            current = node_for(point["lat"], point["lon"])
            if previous is not None and previous != current:
                metres = metres_between(coords[previous], coords[current], lat0)
                seconds = metres / (speed / 3.6)
                # Undirected: one-ways are not modelled. For a 3 km hop between two campuses the
                # difference is a block or two, and pretending otherwise would need turn
                # restrictions too — a much bigger claim than this picture makes.
                adjacency[previous].append((current, metres, seconds))
                adjacency[current].append((previous, metres, seconds))
            previous = current

    return coords, adjacency


def largest_component(adjacency: list[list[tuple[int, float, float]]]) -> set[int]:
    """The main road network, without the islands a clipped bbox leaves behind."""
    seen: set[int] = set()
    best: set[int] = set()
    for start in range(len(adjacency)):
        if start in seen:
            continue
        stack, group = [start], set()
        seen.add(start)
        while stack:
            node = stack.pop()
            group.add(node)
            for neighbour, _m, _s in adjacency[node]:
                if neighbour not in seen:
                    seen.add(neighbour)
                    stack.append(neighbour)
        if len(group) > len(best):
            best = group
    return best


def nearest(coords: list[tuple[float, float]], allowed: set[int], lat: float, lon: float, lat0: float) -> int:
    return min(allowed, key=lambda i: metres_between(coords[i], (lat, lon), lat0))


def dijkstra(adjacency: list[list[tuple[int, float, float]]], start: int, goal: int) -> tuple[list[int], float, float]:
    dist = {start: 0.0}
    prev: dict[int, int] = {}
    queue = [(0.0, start)]
    seen: set[int] = set()
    while queue:
        d, u = heapq.heappop(queue)
        if u in seen:
            continue
        seen.add(u)
        if u == goal:
            break
        for v, metres, _sec in adjacency[u]:
            nd = d + metres
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(queue, (nd, v))
    if goal not in dist:
        raise SystemExit("no road route between the campuses — check the bbox margin")

    path = [goal]
    while path[-1] != start:
        path.append(prev[path[-1]])
    path.reverse()

    seconds = 0.0
    for a, b in zip(path, path[1:]):
        for v, _m, sec in adjacency[a]:
            if v == b:
                seconds += sec
                break
    return path, dist[goal], seconds


def build(aoi_id: str) -> dict[str, Any] | None:
    config = json.loads((AOI_DIR / f"{aoi_id}.json").read_text("utf-8"))
    campuses = config.get("campuses") or []
    if len(campuses) < 2:
        print(f"{aoi_id}: {len(campuses)} campus — nothing to drive between, skipped")
        return None

    anchors = [c["anchor"] for c in campuses]
    lat0 = sum(a["lat"] for a in anchors) / len(anchors)
    bbox = bbox_for(anchors)
    print(f"{aoi_id}: fetching roads for {bbox}")
    ways = fetch_roads(bbox)
    coords, adjacency = build_graph(ways, lat0)
    main = largest_component(adjacency)
    print(f"   {len(ways)} ways -> {len(coords)} junctions, {len(main)} in the main network")

    legs = []
    for a, b in zip(campuses, campuses[1:]):
        start = nearest(coords, main, a["anchor"]["lat"], a["anchor"]["lon"], lat0)
        goal = nearest(coords, main, b["anchor"]["lat"], b["anchor"]["lon"], lat0)
        path, metres, seconds = dijkstra(adjacency, start, goal)
        # ⚠️ The route starts at the nearest JUNCTION, which is not the campus centre. Saying how
        # far that is keeps the picture honest: the shuttle appears at the roadside, not inside a
        # lecture hall, and the gap is the walk nobody is claiming to have modelled.
        legs.append({
            "from": a["id"],
            "to": b["id"],
            "distanceM": round(metres),
            "driveSeconds": round(seconds),
            "startOffsetM": round(metres_between(coords[start], (a["anchor"]["lat"], a["anchor"]["lon"]), lat0)),
            "endOffsetM": round(metres_between(coords[goal], (b["anchor"]["lat"], b["anchor"]["lon"]), lat0)),
            "points": [[round(coords[i][1], 6), round(coords[i][0], 6)] for i in path],
        })
        print(f"   {a['id']} -> {b['id']}: {metres / 1000:.2f} km, "
              f"{seconds / 60:.1f} min driving, {len(path)} points")

    return {
        "$comment": (
            "Drivable route between this AOI's campuses, for the shuttle in the twin. Geometry and "
            "length are MEASURED on the OpenStreetMap road network. The driving time is DERIVED "
            "from OSM's highway classes at free-flow speed — no traffic, no lights, no one-ways, "
            "no turn restrictions — so it is a floor, not a timetable. Built by "
            "tools/geodata/build_drive_route.py."
        ),
        "aoi": aoi_id,
        "provenance": "measured geometry, derived duration",
        "source": "OpenStreetMap highway network",
        "roadClasses": ROAD_SPEED_KMH,
        "legs": legs,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aoi")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    targets = (
        sorted(p.stem for p in AOI_DIR.glob("*.json")) if args.all else [args.aoi]
    )
    if not targets or targets == [None]:
        ap.error("pass --aoi <id> or --all")

    for aoi_id in targets:
        result = build(aoi_id)
        if result is None:
            continue
        out = OUT_DIR / aoi_id / "drive-route.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"   wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()

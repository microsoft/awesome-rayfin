"""Campus Flow — PLAN Phase 8, and decision D5.

Movement derived from the **real lecture timetable**, routed on the **real footpath network**.

The chain, and which link is which kind of claim:

  1. **measured** — TUMonline bookings say a course is in room A until 10:00 and in room B from
     10:15. That is a real cohort with a real reason to walk.
  2. **measured** — room centroids come from the OSM indoor polygons already built for the
     occupancy lens, so an origin is a room and not a building label.
  3. **measured** — the route is a shortest path on the OSM pedestrian graph. Nobody walks through
     a building or across the Isar; the graph decides, not a straight line.
  4. **SYNTHETIC** — how many people. TUMonline publishes no attendance, so cohort size is derived
     seats times a fill factor, and both are invented. It is the one number here that is, and it is
     labelled everywhere it surfaces.

⚠️ **Steps cost more than flat ground, and that is a model, not a measurement.** The graph is
walked with a cost of metres, with stairs weighted ×2.2 — roughly the effort ratio people actually
reveal in routing studies. Without it, a router sends everyone down the Schlossberg stairs because
they are short, which is exactly the wrong answer for a bottleneck lens.

Output (public/terrain/<aoi>/):
  flows.bin    edge polylines, quantised like the buildings
  flows.json   per-edge per-slot load, bottlenecks, provenance

Usage
  python tools/geodata/build_flows.py --aoi garching
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import struct
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np

from aoi import cache_dir, load_aoi, terrain_dir
from utm import wgs84_to_utm32

LOCAL_TZ = timezone(timedelta(hours=1))

#: 15-minute resolution, Monday to Friday, 07:00 to 20:59 — fine enough that a rush forms and
#: dissolves rather than appearing as one flat hour.
SLOT_MINUTES = 15
FIRST_HOUR = 7
HOURS = 14
SLOTS_PER_DAY = HOURS * (60 // SLOT_MINUTES)
DAYS = 5
SLOTS = DAYS * SLOTS_PER_DAY

#: A cohort has to plausibly be the same people. More than this between events and it is two
#: different groups who happen to share a course code.
MAX_GAP_MIN = 45

#: Stairs cost this much more than level ground per metre walked. A model, not a measurement.
STEPS_PENALTY = 2.2

#: ⚠️ SYNTHETIC. Share of derived seats assumed to actually walk between two consecutive events.
FILL_FACTOR = 0.55

XZ_SCALE_M = 0.25


def haversine_utm(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.dist(a, b)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="garching")
    parser.add_argument("--max-routes", type=int, default=4000)
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    out_dir = terrain_dir(cfg)

    rooms_meta_path = out_dir / "rooms.json"
    if not rooms_meta_path.exists():
        print(f"'{cfg['id']}' has no indoor rooms — flow cannot be derived from a timetable here.")
        return

    terrain = json.loads((out_dir / "heightmap.json").read_text(encoding="utf-8"))
    origin_e = float(terrain["origin"]["easting"])
    origin_n = float(terrain["origin"]["northing"])
    width_m = terrain["width"] * terrain["resolutionM"]
    depth_m = terrain["height"] * terrain["resolutionM"]
    top_n = origin_n + depth_m

    # ── room centroids, from the measured indoor polygons ────────────────────
    rooms_meta = json.loads(rooms_meta_path.read_text(encoding="utf-8"))
    quant = rooms_meta["quantisation"]
    raw = (out_dir / "rooms.bin").read_bytes()
    coords = np.frombuffer(raw, dtype="<i2")

    centroid: dict[str, tuple[float, float]] = {}
    seats: dict[str, int] = {}
    for room in rooms_meta["rooms"]:
        start = int(room["vertexOffset"]) * 2
        count = int(room["vertexCount"]) * 2
        ring = coords[start : start + count].astype(np.float64) * float(quant["xzScaleM"])
        if ring.size < 6:
            continue
        xs, zs = ring[0::2], ring[1::2]
        code = room["code"]
        if code in centroid:
            continue
        centroid[code] = (
            float(xs.mean()) + origin_e + width_m / 2,
            top_n - (float(zs.mean()) + depth_m / 2),
        )
        if room.get("seats"):
            seats[code] = int(room["seats"])

    print(f"{len(centroid)} room centroids")

    # ── pedestrian graph ─────────────────────────────────────────────────────
    paths_path = cache_dir("raw", "osm", cfg["id"]) / "footpaths.json"
    if not paths_path.exists():
        raise SystemExit(
            f"{paths_path} not found — run tools/geodata/fetch_osm_footpaths.py --aoi {cfg['id']}"
        )
    ways = json.loads(paths_path.read_text(encoding="utf-8"))["ways"]

    node_xy: dict[int, tuple[float, float]] = {}
    adjacency: dict[int, list[tuple[int, float, int]]] = defaultdict(list)
    edge_points: dict[int, tuple[tuple[float, float], tuple[float, float]]] = {}
    edge_index: dict[tuple[int, int], int] = {}

    # ⚠️ Nodes are keyed by rounded COORDINATE, not by OSM node id.
    #
    # Overpass `out geom` returns each way's geometry but not its node ids, so joining on ids
    # produced a graph of zero nodes — every way was silently skipped by a length check. Keying on
    # position is also the better model: two ways that meet at the same point are connected whether
    # or not the mapper shared a node, which is common where a footway meets a service road.
    #
    # Half a metre is fine enough to keep genuinely distinct junctions apart and coarse enough to
    # absorb the coordinate noise between separately drawn ways.
    key_of: dict[tuple[int, int], int] = {}

    def node_at(lon: float, lat: float) -> int:
        easting, northing = wgs84_to_utm32(lon, lat)
        grid = (int(round(easting * 2)), int(round(northing * 2)))
        node = key_of.get(grid)
        if node is None:
            node = len(key_of)
            key_of[grid] = node
            node_xy[node] = (easting, northing)
        return node

    for way in ways:
        geometry = way["geometry"]
        if len(geometry) < 2:
            continue
        penalty = STEPS_PENALTY if way["steps"] else 1.0
        previous_node = node_at(*geometry[0])
        for lon, lat in geometry[1:]:
            current = node_at(lon, lat)
            if current == previous_node:
                continue
            length = haversine_utm(node_xy[previous_node], node_xy[current])
            if length > 0:
                pair = (min(previous_node, current), max(previous_node, current))
                if pair not in edge_index:
                    edge_index[pair] = len(edge_index)
                    edge_points[edge_index[pair]] = (
                        node_xy[previous_node],
                        node_xy[current],
                    )
                index = edge_index[pair]
                adjacency[previous_node].append((current, length * penalty, index))
                adjacency[current].append((previous_node, length * penalty, index))
            previous_node = current

    print(f"graph: {len(node_xy):,} nodes, {len(edge_index):,} edges")

    # Snap each room to its nearest graph node.
    node_ids = list(node_xy)
    node_array = np.array([node_xy[n] for n in node_ids])

    def nearest(point: tuple[float, float]) -> int:
        d = np.hypot(node_array[:, 0] - point[0], node_array[:, 1] - point[1])
        return node_ids[int(d.argmin())]

    room_node: dict[str, int] = {code: nearest(xy) for code, xy in centroid.items()}

    # ── cohort transitions from the real timetable ───────────────────────────
    calendar_path = cache_dir("raw", "navigatum", cfg["id"]) / "calendar.jsonl"
    events: dict[str, list[tuple[datetime, datetime, str]]] = defaultdict(list)
    for line in calendar_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if not event.get("start") or not event.get("end") or not event.get("title"):
            continue
        room = event["room"]
        if room not in room_node:
            continue
        start = datetime.fromisoformat(event["start"].replace("Z", "+00:00")).astimezone(LOCAL_TZ)
        end = datetime.fromisoformat(event["end"].replace("Z", "+00:00")).astimezone(LOCAL_TZ)
        events[str(event["title"]).strip()].append((start, end, room))

    transitions: dict[tuple[str, str, int], int] = defaultdict(int)
    for title, occurrences in events.items():
        occurrences.sort()
        for i in range(len(occurrences) - 1):
            _, end, room_a = occurrences[i]
            start, _, room_b = occurrences[i + 1]
            if room_a == room_b:
                continue
            gap = (start - end).total_seconds() / 60
            if gap < 0 or gap > MAX_GAP_MIN or start.date() != end.date():
                continue
            if start.weekday() >= DAYS:
                continue
            minutes = (start.hour - FIRST_HOUR) * 60 + start.minute
            if not (0 <= minutes < HOURS * 60):
                continue
            slot = start.weekday() * SLOTS_PER_DAY + minutes // SLOT_MINUTES
            transitions[(room_a, room_b, slot)] += 1

    print(f"{len(transitions):,} cohort transitions from {len(events):,} courses")
    if not transitions:
        print("no consecutive same-course bookings — nothing to route")
        return

    # ── route and accumulate ─────────────────────────────────────────────────
    route_cache: dict[tuple[int, int], list[int]] = {}

    def route(source: int, target: int) -> list[int]:
        key = (source, target)
        if key in route_cache:
            return route_cache[key]
        distances = {source: 0.0}
        previous: dict[int, tuple[int, int]] = {}
        queue = [(0.0, source)]
        seen: set[int] = set()
        while queue:
            cost, node = heapq.heappop(queue)
            if node in seen:
                continue
            seen.add(node)
            if node == target:
                break
            for neighbour, weight, edge in adjacency[node]:
                nxt = cost + weight
                if nxt < distances.get(neighbour, math.inf):
                    distances[neighbour] = nxt
                    previous[neighbour] = (node, edge)
                    heapq.heappush(queue, (nxt, neighbour))
        edges: list[int] = []
        node = target
        while node in previous:
            node, edge = previous[node]
            edges.append(edge)
        route_cache[key] = edges if node == source else []
        return route_cache[key]

    load: dict[tuple[int, int], float] = defaultdict(float)
    # ⚠️ Kept separate from `load` on purpose. Summing edge loads answers "person-metres of walking"
    # — a cohort crossing twenty edges lands twenty times — which is a fine measure of network
    # burden and a badly wrong answer to "how many people are walking". The first version reported
    # 9 399 people at the Thursday peak on a campus whose largest lecture hall seats a few hundred.
    people_per_slot: dict[int, float] = defaultdict(float)
    routed = unreachable = 0
    for (room_a, room_b, slot), count in sorted(
        transitions.items(), key=lambda kv: -kv[1]
    )[: args.max_routes]:
        edges = route(room_node[room_a], room_node[room_b])
        if not edges:
            unreachable += 1
            continue
        routed += 1
        # ⚠️ SYNTHETIC head count. Seats are already derived; the fill factor is invented.
        people = max(1.0, seats.get(room_a, 25) * FILL_FACTOR) * (count / 16.0)
        people_per_slot[slot] += people
        for edge in edges:
            load[(edge, slot)] += people

    print(f"routed {routed:,} transitions, {unreachable:,} unreachable, {len(load):,} edge-slots")

    # ── emit ─────────────────────────────────────────────────────────────────
    used_edges = sorted({edge for edge, _ in load})
    remap = {edge: i for i, edge in enumerate(used_edges)}
    vertices: list[int] = []
    for edge in used_edges:
        (ax, ay), (bx, by) = edge_points[edge]
        for e, n in ((ax, ay), (bx, by)):
            vertices.append(int(round((e - origin_e - width_m / 2) / XZ_SCALE_M)))
            vertices.append(int(round(((top_n - n) - depth_m / 2) / XZ_SCALE_M)))

    payload = bytearray()
    payload += struct.pack(f"<{len(vertices)}h", *vertices)
    (out_dir / "flows.bin").write_bytes(bytes(payload))

    sparse = [
        [remap[edge], slot, round(value, 1)] for (edge, slot), value in sorted(load.items())
    ]
    totals = defaultdict(float)
    for (edge, _), value in load.items():
        totals[edge] += value
    busiest = sorted(totals.items(), key=lambda kv: -kv[1])[:20]

    (out_dir / "flows.json").write_text(
        json.dumps(
            {
                "aoi": cfg["id"],
                "provenance": "derived",
                "syntheticNote": (
                    "Routes and timings are derived from real TUMonline bookings on the real "
                    "OpenStreetMap footpath network. ⚠️ HEAD COUNTS ARE SYNTHETIC: seats are "
                    f"derived from room area and a fill factor of {FILL_FACTOR:.0%} is assumed. "
                    f"Stair segments are weighted x{STEPS_PENALTY:.1f}, which is a model of "
                    "effort, not a measurement."
                ),
                "edgeCount": len(used_edges),
                "slots": SLOTS,
                "slotMinutes": SLOT_MINUTES,
                "firstHour": FIRST_HOUR,
                "days": DAYS,
                "quantisation": {"xzScaleM": XZ_SCALE_M},
                "transitions": routed,
                "courses": len(events),
                "peakSlot": int(max(people_per_slot, key=people_per_slot.get)),
                "slotTotals": [round(people_per_slot.get(s, 0.0), 1) for s in range(SLOTS)],
                "bottlenecks": [{"edge": remap[e], "load": round(v, 1)} for e, v in busiest],
                "load": sparse,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    peak = max(people_per_slot, key=people_per_slot.get)
    day = ["Mo", "Di", "Mi", "Do", "Fr"][peak // SLOTS_PER_DAY]
    minute = (peak % SLOTS_PER_DAY) * SLOT_MINUTES
    print(
        f"peak {day} {FIRST_HOUR + minute // 60:02d}:{minute % 60:02d} "
        f"with {people_per_slot[peak]:.0f} people walking"
    )
    size = (out_dir / "flows.json").stat().st_size
    print(f"wrote flows.json ({size / 1e6:.2f} MB) and flows.bin ({len(payload) / 1e3:.0f} KB)")


if __name__ == "__main__":
    main()

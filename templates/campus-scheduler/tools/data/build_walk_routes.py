"""Route the walk between buildings on the paths that actually exist — PLAN §16, phase 4.

The dataset has carried a `travel_time.json` since phase 0, and every figure in it is a **straight
line**: `provenance.json` says so in as many words ("straight-line distance; walk at 1.35 m/s within
a campus, bus between"). That is fine as a placeholder and wrong as an answer. Nobody walks through
a building, across the Galgenberg embankment or over a railway line, and the whole reason a
timetable cares about walking time is the cases where the direct line is not available.

So this builds the real thing: a pedestrian graph from OpenStreetMap, an access point per building,
and a shortest path between every pair. What comes out is both a **number** (how long the walk
really takes) and a **line** (where it goes), because the number alone cannot be checked by anyone
looking at the screen, and a campus map that draws the route is exactly how a person verifies that
the answer is sane.

⚠️ WHAT IS MEASURED AND WHAT IS ASSUMED

  * measured — the path geometry, its length, and which segments are stairs (OpenStreetMap)
  * measured — the building outlines and their centroids (OSM, already validated in phase 0)
  * ASSUMED — walking speed 1.35 m/s on the flat, and a stairs penalty
  * ASSUMED — the access point. OSM has no `entrance=*` node on most of these buildings, so the
    walk starts at the nearest point of the path network to the building centroid. The distance
    from the centroid to that point is reported per building as `approachM`, so a building whose
    door is on the far side is visible as a large approach rather than hidden inside a total.
  * ASSUMED — `transitMin`, the bus between the two campuses, taken unchanged from the dataset's
    own `travel_time.json`. There is no timetable behind it.

⚠️ BETWEEN CAMPUSES THE WALK IS NOT THE TRANSFER. Galgenberg to Prüfening is 3.2 km on foot; the
plan assumes a bus and always did. Both numbers are emitted so the app can judge the transfer by
the mode people use and still show what the walk would cost.

Output
  public/terrain/<aoi>/walk-routes.json   coordinates + one route per building pair

Usage
  python tools/data/build_walk_routes.py --site oth
  python tools/data/build_walk_routes.py --site lmu --debug
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
from pathlib import Path

import sites

ROOT = Path(__file__).resolve().parents[2]

# Metres per second on the flat. The dataset already assumed this for the straight-line matrix, and
# keeping it means the comparison at the end isolates the ROUTE, not a change of pace.
WALK_MS = 1.35

# ⚠️ Stairs are kept in the graph and penalised, never excluded. A router that avoids steps produces
# a beautiful, useless answer that walks everyone the long way round; one that ignores the effort
# claims a flight of stairs is as quick as a corridor. The factor is a cost multiplier on LENGTH,
# which is how a step penalty stays comparable with distance.
STEPS_PENALTY = 3.0

# How far a building may be from the nearest path before the snap is not believable. Beyond this the
# building is reported as unreachable rather than being connected by an invented link.
MAX_SNAP_M = 120.0

# ⚠️ A BUILDING HAS MORE THAN ONE DOOR, AND SNAPPING TO ONE VERTEX INVENTS A WALL.
# The first version connected each building to its single nearest path vertex. That produced a 444 m
# walk between two Prüfening buildings 33 m apart, and the giveaway was that the same few buildings
# (e, S, T) appeared in every bad pair — geography does not cluster like that, modelling artefacts do.
# The nearest vertex sometimes sits on a service-road stub that only rejoins the network far away,
# so every route through that building took the long way round a car park.
#
# Real routers attach a point of interest to the network at several places and let the search pick.
# Every path vertex within this radius of the centroid becomes a candidate door, weighted by the
# distance across the forecourt; the shortest path then chooses which one to use.
DOOR_RADIUS_M = 90.0
#: No matter how empty the surroundings, keep at least this many candidates so a building beside a
#: single long path is not left with one arbitrary attachment point.
MIN_DOORS = 6

# Drawn geometry only. OSM records a vertex wherever a path bends by a degree, and at campus scale
# most of those are invisible — LMU's full-detail file came to 1.7 MB, which is a lot of bandwidth
# to spend on wiggles nobody can see. The DISTANCES are always measured on the full graph; this
# tolerance affects the line that gets drawn, never the number that gets reported.
SIMPLIFY_M = 2.0

# A campus can make you walk round a building; it does not make you walk three times the direct
# line. Above this the access points are wrong, and the build refuses rather than shipping a
# plausible-looking map of a walk nobody takes.
MAX_SAME_CAMPUS_DETOUR = 3.0


def haversine(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Metres between two lon/lat pairs."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def local_scale(lat: float) -> tuple[float, float]:
    """Metres per degree of longitude and latitude at this latitude.

    Planar maths is accurate to well under a metre over a 3 km campus and makes the nearest-point
    projection below simple. The haversine above is kept for the edge lengths that get reported.
    """
    return 111320.0 * math.cos(math.radians(lat)), 110540.0


class Graph:
    """An undirected pedestrian graph keyed on shared coordinates.

    ⚠️ JUNCTIONS ARE SHARED COORDINATES, NOT PROXIMITY. Two OSM ways meet where they name the same
    node, and that node has one position — so keying vertices on the rounded coordinate joins
    exactly the ways that are genuinely connected. Joining by nearness instead would weld a footpath
    to the road on the bridge above it, which is how a router ends up walking people through a wall.
    """

    def __init__(self) -> None:
        self.ids: dict[tuple[int, int], int] = {}
        self.lon: list[float] = []
        self.lat: list[float] = []
        self.adj: list[list[tuple[int, float, float]]] = []  # (to, cost, metres)

    def vertex(self, lon: float, lat: float) -> int:
        key = (round(lon * 1e7), round(lat * 1e7))
        found = self.ids.get(key)
        if found is not None:
            return found
        index = len(self.lon)
        self.ids[key] = index
        self.lon.append(lon)
        self.lat.append(lat)
        self.adj.append([])
        return index

    def link(self, a: int, b: int, metres: float, steps: bool) -> None:
        if a == b:
            return
        cost = metres * (STEPS_PENALTY if steps else 1.0)
        self.adj[a].append((b, cost, metres))
        self.adj[b].append((a, cost, metres))


def build_graph(ways: list[dict]) -> Graph:
    graph = Graph()
    for way in ways:
        geometry = way.get("geometry") or []
        steps = bool(way.get("steps"))
        previous = None
        for point in geometry:
            lon, lat = float(point[0]), float(point[1])
            current = graph.vertex(lon, lat)
            if previous is not None:
                graph.link(previous, current, haversine(
                    graph.lon[previous], graph.lat[previous], lon, lat), steps)
            previous = current
    return graph


def candidate_doors(graph: Graph, lon: float, lat: float) -> list[tuple[int, float]]:
    """Every plausible way onto the path network from this building, nearest first.

    Returns `(vertex, metres)` pairs. The metres are the walk across the forecourt from the centroid
    to that point on the network — an approximation of getting out of the door, and reported rather
    than buried so a building whose entrance is genuinely far from a path stays visible.
    """
    mx, my = local_scale(lat)
    scored: list[tuple[float, int]] = []
    for index in range(len(graph.lon)):
        dx = (graph.lon[index] - lon) * mx
        dy = (graph.lat[index] - lat) * my
        scored.append((math.sqrt(dx * dx + dy * dy), index))
    scored.sort()

    doors = [(index, distance) for distance, index in scored if distance <= DOOR_RADIUS_M]
    if len(doors) < MIN_DOORS:
        doors = [(index, distance) for distance, index in scored[:MIN_DOORS]]
    return doors


def dijkstra(
    graph: Graph, source: int, targets: set[int], terminal: set[int]
) -> tuple[dict[int, float], dict[int, float], dict[int, int]]:
    """Cost-first search from one building, stopping once every other building is settled.

    ⚠️ `terminal` holds the building vertices, and they are NEVER EXPANDED except at the source.
    Buildings were attached to the network as real vertices so the search could choose a door, and
    that quietly made every building a shortcut: a route from A to B could enter C by its north door
    and leave by its south one, walking straight through the lecture theatre. Doors connect a
    building to the paths, not the paths to each other.
    """
    cost = {source: 0.0}
    metres = {source: 0.0}
    previous: dict[int, int] = {}
    settled: set[int] = set()
    remaining = set(targets)
    queue: list[tuple[float, int]] = [(0.0, source)]

    while queue and remaining:
        here_cost, here = heapq.heappop(queue)
        if here in settled:
            continue
        settled.add(here)
        remaining.discard(here)
        if here in terminal and here != source:
            continue
        for other, edge_cost, edge_m in graph.adj[here]:
            if other in settled:
                continue
            through = here_cost + edge_cost
            if through < cost.get(other, float("inf")):
                cost[other] = through
                metres[other] = metres[here] + edge_m
                previous[other] = here
                heapq.heappush(queue, (through, other))
    return cost, metres, previous


def trace(previous: dict[int, int], source: int, target: int) -> list[int]:
    path = [target]
    while path[-1] != source:
        step = previous.get(path[-1])
        if step is None:
            return []
        path.append(step)
    path.reverse()
    return path


def simplify(points: list[tuple[float, float]], tolerance_m: float, lat: float) -> list[int]:
    """Douglas-Peucker, returning the INDICES of the points worth drawing.

    Endpoints are always kept, so a simplified route still starts at one building and ends at the
    other.
    """
    if len(points) < 3:
        return list(range(len(points)))
    mx, my = local_scale(lat)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True

    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        ax, ay = points[first][0] * mx, points[first][1] * my
        bx, by = points[last][0] * mx, points[last][1] * my
        dx, dy = bx - ax, by - ay
        span = math.hypot(dx, dy)
        worst, worst_at = -1.0, first
        for index in range(first + 1, last):
            px, py = points[index][0] * mx, points[index][1] * my
            if span < 1e-9:
                distance = math.hypot(px - ax, py - ay)
            else:
                distance = abs(dy * px - dx * py + bx * ay - by * ax) / span
            if distance > worst:
                worst, worst_at = distance, index
        if worst > tolerance_m:
            keep[worst_at] = True
            stack.append((first, worst_at))
            stack.append((worst_at, last))
    return [i for i, k in enumerate(keep) if k]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", default="oth", choices=["oth", "lmu"])
    parser.add_argument(
        "--all-buildings",
        action="store_true",
        help="route between every building, not only those with schedulable rooms",
    )
    parser.add_argument(
        "--matrix",
        action="store_true",
        help=(
            "also write data/synthetic*/travel_routed.json — the routed distance between EVERY "
            "pair of buildings, which the timetable generator plans against. Implies "
            "--all-buildings, because the solver has to know about rooms in buildings the app "
            "does not draw a route for."
        ),
    )
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    site = sites.load_site(args.site)
    aoi_id = site.aoi_id

    paths_file = ROOT / "data" / "raw" / "osm" / aoi_id / "footpaths.json"
    if not paths_file.exists():
        raise SystemExit(
            f"missing {paths_file}\n"
            f"run: python tools/geodata/fetch_osm_footpaths.py --aoi {aoi_id}"
        )

    ways = json.loads(paths_file.read_text(encoding="utf-8"))["ways"]
    graph = build_graph(ways)
    print(f"graph: {len(graph.lon)} vertices from {len(ways)} ways")

    buildings = json.loads((site.synth / "building.json").read_text(encoding="utf-8"))
    rooms = json.loads((site.synth / "room.json").read_text(encoding="utf-8"))

    # ⚠️ Only buildings that actually host timetabled teaching. The question this answers is "can I
    # get from the room I am teaching in to the next one", so a route to a workshop nobody is
    # scheduled into is weight without an answer behind it — and at LMU routing all 79 buildings
    # produced a 1.7 MB asset for 37 buildings' worth of usable pairs.
    teaching = {room["buildingId"] for room in rooms if room.get("schedulable")}
    if not (args.all_buildings or args.matrix):
        buildings = [b for b in buildings if b["buildingId"] in teaching]
    print(
        f"buildings: {len(buildings)} "
        f"({'all' if args.all_buildings or args.matrix else 'teaching only'})"
    )

    # ⚠️ Each building becomes a REAL VERTEX in the graph, linked to every candidate door. That is
    # what lets one Dijkstra per building answer "which exit is best for this destination" instead
    # of the question being settled in advance by a nearest-neighbour lookup that knows nothing
    # about where the walk is going.
    access: dict[str, dict] = {}
    for building in buildings:
        lon, lat = float(building["lon"]), float(building["lat"])
        doors = candidate_doors(graph, lon, lat)
        nearest = doors[0][1] if doors else float("inf")
        node = graph.vertex(lon, lat)
        for vertex, metres in doors:
            if metres <= MAX_SNAP_M:
                graph.link(node, vertex, metres, steps=False)
        access[building["buildingId"]] = {
            "node": node,
            "approachM": round(nearest, 1),
            "doors": sum(1 for _, m in doors if m <= MAX_SNAP_M),
            "campusId": building["campusId"],
            "reachable": nearest <= MAX_SNAP_M,
        }
        if args.debug:
            print(
                f"  {building['buildingId']:>2} nearest door {nearest:6.1f} m, "
                f"{access[building['buildingId']]['doors']:2} candidates  {building['name']}"
            )

    stranded = [b for b, a in access.items() if not a["reachable"]]
    if stranded:
        # Loud rather than silent: a building the path network cannot reach would otherwise appear
        # in the matrix with a plausible number derived from a snap 300 m away.
        print(f"⚠️  {len(stranded)} building(s) further than {MAX_SNAP_M:.0f} m from any path: {stranded}")

    usable = {b: a for b, a in access.items() if a["reachable"]}
    targets = {a["node"] for a in usable.values()}
    terminal = {a["node"] for a in access.values()}

    coords: list[tuple[float, float]] = []
    coord_index: dict[int, int] = {}

    def emit(vertex: int) -> int:
        found = coord_index.get(vertex)
        if found is not None:
            return found
        coord_index[vertex] = len(coords)
        coords.append((round(graph.lon[vertex], 6), round(graph.lat[vertex], 6)))
        return coord_index[vertex]

    routes: dict[str, dict] = {}
    unreachable_pairs = 0

    for from_id, from_access in sorted(usable.items()):
        _, metres, previous = dijkstra(graph, from_access["node"], targets, terminal)
        for to_id, to_access in sorted(usable.items()):
            if from_id >= to_id:
                continue
            walked = metres.get(to_access["node"])
            if walked is None:
                unreachable_pairs += 1
                continue
            node_path = trace(previous, from_access["node"], to_access["node"])
            if not node_path:
                unreachable_pairs += 1
                continue

            # `walked` already contains both forecourt legs, because the building vertices are in
            # the graph and the door links carry their distance.
            approach = from_access["approachM"] + to_access["approachM"]
            full = [(graph.lon[v], graph.lat[v]) for v in node_path]
            kept = simplify(full, SIMPLIFY_M, graph.lat[node_path[0]])
            routes[f"{from_id}|{to_id}"] = {
                "distanceM": round(walked),
                "approachM": round(approach),
                "minutes": max(1, round(walked / WALK_MS / 60)),
                "sameCampus": from_access["campusId"] == to_access["campusId"],
                "points": [emit(node_path[i]) for i in kept],
            }

    # ── Refuse to ship geometry that cannot be true ──────────────────────────────────────
    # ⚠️ THIS GATE EXISTS BECAUSE THE FIRST VERSION LOOKED FINE AND WAS NOT. Every route obeyed the
    # triangle inequality, so a "routed >= straight line" check passed while two buildings 33 m
    # apart were 444 m by path. The number that actually exposed it was the DETOUR RATIO: a campus
    # does not make you walk thirteen times the direct line, and a handful of buildings appearing in
    # every bad pair is the signature of a modelling artefact rather than of geography.
    #
    # It runs BEFORE the write. A gate that reports after the file is on disk is a log message.
    centres = {b["buildingId"]: (float(b["lon"]), float(b["lat"])) for b in buildings}
    impossible: list[str] = []
    worst_ratio, worst_pair = 0.0, ""
    for key, route in routes.items():
        left, right = key.split("|")
        direct = haversine(*centres[left], *centres[right])
        if route["distanceM"] + 1.5 < direct:
            impossible.append(f"{key}: walked {route['distanceM']} m < direct {direct:.0f} m")
        if direct > 25 and route["sameCampus"]:
            ratio = route["distanceM"] / direct
            if ratio > worst_ratio:
                worst_ratio, worst_pair = ratio, key

    if impossible:
        raise SystemExit(
            "REFUSING TO WRITE: routes shorter than the straight line between the same two "
            "buildings:\n  " + "\n  ".join(impossible[:10])
        )
    print(f"worst same-campus detour {worst_ratio:.2f}x ({worst_pair})")
    if worst_ratio > MAX_SAME_CAMPUS_DETOUR:
        raise SystemExit(
            f"REFUSING TO WRITE: {worst_pair} detours {worst_ratio:.1f}x the direct line on one "
            f"campus, over the {MAX_SAME_CAMPUS_DETOUR}x limit. That is normally an access-point "
            f"problem (a building attached to a stub of the network), not real geography — check "
            f"whether the same few buildings appear in every bad pair."
        )

    # ── What the plan itself assumes, carried along ────────────────────────────────────────────
    # ⚠️ BETWEEN CAMPUSES NOBODY WALKS, AND THE PLAN NEVER SAID THEY DID. `provenance.json` records
    # the assumption in as many words: "walk at 1.35 m/s within a campus, bus between". The routed
    # walk from Galgenberg to Prüfening is 3.2 km and 44 minutes, and reading that as the transfer
    # time would have declared 163 of this plan's transfers impossible — a fabricated defect in a
    # plan that is correct under its own documented model. The bus time travels with the route so
    # the app can judge a campus change by the mode people actually use, and still show the walk.
    #
    # ⚠️ BUT "CROSS-CAMPUS" IS NOT THE SAME QUESTION AS "IS THERE A BUS". TechBase is a different
    # campus 305 m from Seybothstraße — a four-minute walk — and attaching a bus figure to it would
    # invent a service nobody rides and let the app report a stroll across the road as a transit
    # leg. A transit claim is only made where the walk is long enough for one to be plausible, and
    # the threshold is written down rather than implied.
    TRANSIT_MIN_WALK = 15  # minutes on foot, below which nobody would wait for a bus
    transit: dict[str, int] = {}
    straight_file = site.synth / "travel_time.json"
    skipped_short = 0
    if straight_file.exists():
        for row in json.loads(straight_file.read_text(encoding="utf-8")):
            key = f"{row['fromBuildingId']}|{row['toBuildingId']}"
            if key not in routes or row["sameCampus"]:
                continue
            if routes[key]["minutes"] < TRANSIT_MIN_WALK:
                skipped_short += 1
                continue
            transit[key] = row["minutes"]
    for key, minutes in transit.items():
        routes[key]["transitMin"] = minutes
    if skipped_short:
        print(
            f"transit     {len(transit)} cross-campus routes carry a bus figure; "
            f"{skipped_short} are walkable in under {TRANSIT_MIN_WALK} min and carry none"
        )

    # ── Which campus each building is on, and one stand-in per campus ─────────────────────────
    # ⚠️ A ROOM WHOSE BUILDING IS UNKNOWN IS NOT A ROOM WITH NO PLACE. OTH's own Untis export
    # numbers the whole Prüfeninger Straße complex `P …` and OSM maps it as six unnamed polygons,
    # so 666 of their real sessions land on a campus we can name and in a building we cannot. With
    # only the building-keyed routes below, the app skipped those sessions entirely and a professor
    # teaching across town looked like someone who never leaves Galgenberg — the plan's single most
    # important transfer, silently missing, on the customer's own week.
    #
    # The anchor is the biggest teaching building on the campus, and it is a STAND-IN that the app
    # must label as such: the answer it produces is "between these two SITES", which is exactly the
    # precision OTH's data supports (PLAN §25.7 — campus-level placement, said on screen).
    campus_of = {
        b["buildingId"]: b["campusId"] for b in buildings if b["buildingId"] in usable
    }
    anchors: dict[str, str] = {}
    for campus in sorted(set(campus_of.values())):
        on_campus = [b for b in buildings if campus_of.get(b["buildingId"]) == campus]
        # Largest footprint wins; the id breaks a tie so a rebuild never quietly moves the anchor.
        best = max(on_campus, key=lambda b: (b["footprintM2"], b["buildingId"]))
        anchors[campus] = best["buildingId"]
    print(
        "campus anchors "
        + ", ".join(f"{campus}->{building}" for campus, building in sorted(anchors.items()))
    )

    out = {
        "$comment": (
            "Walking routes between buildings on the OpenStreetMap pedestrian network. Path "
            "geometry and length are measured; walking speed (1.35 m/s), the stairs penalty and "
            "the access point (nearest path vertex to the building centroid) are assumptions — see "
            "tools/data/build_walk_routes.py. `transitMin` is the dataset's own bus assumption, "
            "NOT a measured service, and appears only on cross-campus routes whose walk exceeds "
            f"{TRANSIT_MIN_WALK} minutes — a 305 m hop between campuses is walked, not ridden. "
            "`campusAnchors` names one stand-in building per campus, for sessions whose room is "
            "known to be on a campus but not in a building; a route resolved through it is "
            "campus-to-campus and the app says so."
        ),
        "aoi": aoi_id,
        "site": args.site,
        "provenance": "derived",
        "walkSpeedMs": WALK_MS,
        "stepsPenalty": STEPS_PENALTY,
        "coordinates": [c for pair in coords for c in pair],
        "access": {b: {"approachM": a["approachM"], "doors": a["doors"]} for b, a in usable.items()},
        "campuses": campus_of,
        "campusAnchors": anchors,
        "unreachableBuildings": stranded,
        "routes": routes,
    }

    out_dir = site.terrain_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "walk-routes.json"

    # ⚠️ A `--matrix` run routes EVERY building, and that asset is 1.7 MB at LMU for pairs the app
    # never draws. The two outputs therefore come from two runs: this one feeds the solver, the
    # plain run feeds the browser. Writing the app asset here would quietly replace the small file
    # with the big one and nothing would look wrong until someone measured the download.
    if not args.matrix:
        out_path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        size_kb = out_path.stat().st_size / 1024
        print(
            f"wrote {out_path.relative_to(ROOT)} — {len(routes)} routes, "
            f"{len(coords)} points, {size_kb:.0f} KB"
        )

    # ── The matrix the solver plans against ────────────────────────────────────────────────────
    if args.matrix:
        """
        ⚠️ SYMMETRIC AND COMPLETE, because the generator indexes it by ordered pair and expects a
        row for every combination including a building with itself. A sparse matrix would not fail
        loudly — it would silently return "no travel time" for the pairs it lacked, which the
        placer reads as "no constraint" and happily books an impossible transfer.
        """
        matrix: list[dict] = []
        for left in buildings:
            for right in buildings:
                a, b = left["buildingId"], right["buildingId"]
                same = left["campusId"] == right["campusId"]
                if a == b:
                    matrix.append(
                        {
                            "fromBuildingId": a,
                            "toBuildingId": b,
                            "distanceM": 0,
                            "minutes": 0,
                            "sameCampus": True,
                            "mode": "none",
                        }
                    )
                    continue

                route = routes.get(f"{a}|{b}") or routes.get(f"{b}|{a}")
                if route is None:
                    # No path at all. Refusing is right: a missing row would be read as "free".
                    raise SystemExit(
                        f"REFUSING TO WRITE the matrix: no route between {a} and {b}. "
                        f"The generator would treat the gap as an unconstrained transfer."
                    )

                walk = route["minutes"]
                bus = route.get("transitMin")
                use_bus = bus is not None and bus < walk
                matrix.append(
                    {
                        "fromBuildingId": a,
                        "toBuildingId": b,
                        "distanceM": route["distanceM"],
                        "minutes": bus if use_bus else walk,
                        "sameCampus": same,
                        "mode": "transit" if use_bus else "walk",
                    }
                )

        matrix_path = site.synth / "travel_routed.json"
        matrix_path.write_text(json.dumps(matrix, ensure_ascii=False, indent=1), encoding="utf-8")
        walks = sum(1 for row in matrix if row["mode"] == "walk")
        print(
            f"wrote {matrix_path.relative_to(ROOT)} — {len(matrix)} pairs "
            f"({walks} on foot, {len(matrix) - walks - len(buildings)} by bus)"
        )
    if unreachable_pairs:
        print(f"⚠️  {unreachable_pairs} pair(s) had no path at all")

    # ── The comparison that makes the change worth making ──────────────────────────────────────
    # ⚠️ THE STRAIGHT LINE IS RECOMPUTED HERE, NOT READ FROM `travel_time.json`. That file used to
    # hold straight-line distances, and comparing against it was a real measurement; now the
    # generator writes the ROUTED figures into it, so reading it back compared routed against
    # routed and printed a serene "median 1.00x" — a check that agrees with itself no matter how
    # wrong the routing is. Computing the direct line from the building coordinates keeps the two
    # sides independent, which is the only thing that makes the ratio worth printing.
    centres_ll = {
        b["buildingId"]: (float(b["lon"]), float(b["lat"])) for b in buildings
    }
    ratios = []
    for key, route in routes.items():
        left, right = key.split("|")
        direct = haversine(*centres_ll[left], *centres_ll[right])
        if direct > 20:
            ratios.append(route["distanceM"] / direct)
    if ratios:
        ratios.sort()
        print(
            f"detour vs straight line: median {ratios[len(ratios) // 2]:.2f}x, "
            f"worst {ratios[-1]:.2f}x, best {ratios[0]:.2f}x"
        )


if __name__ == "__main__":
    main()

"""Route a delivery round over the real road network.

⚠️ WHY THIS EXISTS. Tours were straight-line chains multiplied by a 1,32 detour factor. That is a
defensible ESTIMATE of distance and an indefensible PICTURE: drawn across a delivery region the
legs cut over the river, through rail yards and across open farmland. The audience for this app
reads delivery maps for a living.

⚠️ ROUTED BY TIME, REPORTED IN DISTANCE. A driver does not pick the shortest path, they pick the
quickest one — which is why a van joins the A 656 for two junctions instead of threading the
Innenstadt. Routing on metres would produce shorter, denser, and less realistic rounds. The
distance that comes back is the distance of the quickest path, which is the number a planner
actually lives with.

⚠️ A* WITH AN ADMISSIBLE HEURISTIC, NOT DIJKSTRA. There are around 560 legs to route over a graph
of a few hundred thousand nodes; plain Dijkstra explores the whole region for every leg. The
heuristic is straight-line distance divided by the fastest road class in the graph, which can never
overestimate the remaining time and therefore cannot produce a wrong path — only a slower search if
it is loose.
"""
from __future__ import annotations

import heapq
import json
import math
from pathlib import Path


class RoadRouter:
    """The drivable network, with shortest-time routing between attached points."""

    def __init__(self, path: Path):
        raw = json.loads(path.read_text(encoding="utf-8"))
        self.coords: list[tuple[float, float]] = [tuple(c) for c in raw["coords"]]
        self.lonlat: list[tuple[float, float]] = [tuple(c) for c in raw["lonlat"]]
        self.adjacency: list[list[tuple[int, float, float]]] = [
            [(int(to), float(m), float(s)) for to, m, s in row] for row in raw["adjacency"]
        ]
        #: Baked node heights (DHHN2016, bridges and tunnels resolved) — None for an older graph.
        self.elev: list[float] | None = raw.get("elev")
        #: Underground nodes (tunnel interiors). Emitted as a 4th path value 1 so the app can hide a
        #: vehicle while it is in a tunnel and the height gate can skip intentional dives.
        self.tunnel: set[int] = set(raw.get("tunnel", []))
        #: Bridge deck nodes (incl. landings). Emitted as a 4th path value 2: the generator re-reads
        #: their height from the 3D-Mesh, because the real deck rises above its approaches.
        self.bridge: set[int] = set(raw.get("bridge", []))
        self.hub_node: int = int(raw["hubNode"])
        self.attach: dict[str, int] = {k: int(v) for k, v in raw["attach"].items()}
        self.attribution: str = raw.get("attribution", "")
        self.source: str = raw.get("source", "")
        self.node_count: int = len(self.coords)
        #: Directed edges (one-way streets are modelled since the Cologne build).
        self.edge_count: int = sum(len(a) for a in self.adjacency)

        # The fastest class present, in m/s, for the heuristic. Read from the graph rather than
        # hard-coded: a heuristic that assumes 100 km/h on a graph whose fastest road is 50 stops
        # being admissible only if it is too LOW, so deriving it keeps the guarantee.
        fastest = 1.0
        for row in self.adjacency:
            for _to, metres, seconds in row:
                if seconds > 0:
                    fastest = max(fastest, metres / seconds)
        self.fastest_mps = fastest

        #: Legs that could not be routed at all. Counted, never silently substituted.
        self.unroutable = 0

    def route(self, start: int, goal: int) -> tuple[float, float, list[int]] | None:
        """Quickest path as (metres, seconds, node indices), or None if disconnected."""
        if start == goal:
            return 0.0, 0.0, [start]

        gx, gy = self.coords[goal]

        def h(n: int) -> float:
            x, y = self.coords[n]
            return math.hypot(x - gx, y - gy) / self.fastest_mps

        best_time = {start: 0.0}
        best_metres = {start: 0.0}
        came: dict[int, int] = {}
        seen: set[int] = set()
        queue: list[tuple[float, float, int]] = [(h(start), 0.0, start)]

        while queue:
            _f, time_so_far, u = heapq.heappop(queue)
            if u in seen:
                continue
            seen.add(u)
            if u == goal:
                path = [u]
                while u in came:
                    u = came[u]
                    path.append(u)
                path.reverse()
                return best_metres[goal], time_so_far, path
            for v, metres, seconds in self.adjacency[u]:
                if v in seen:
                    continue
                t = time_so_far + seconds
                if t < best_time.get(v, math.inf):
                    best_time[v] = t
                    best_metres[v] = best_metres[u] + metres
                    came[v] = u
                    heapq.heappush(queue, (t + h(v), t, v))
        return None

    def route_leg(
        self, start: int, goal: int, simplify_m: float = 2.0
    ) -> tuple[float, float, list[list[float]]] | None:
        """One leg as (metres, seconds, [[lat, lon], ...]), thinned, or None if disconnected.

        ⚠️ SIMPLIFIED PER LEG, NEVER OVER THE WHOLE ROUND. Thinning a concatenated round shifts
        every index after the first removed point, and the indices are what say WHERE THE VAN
        STOPS. Doing it leg by leg keeps each stop exactly on a polyline vertex, so a delivery
        cannot drift to the middle of a street.

        ⚠️ AND THE TOLERANCE IS 2 m, NOT 12. Twelve metres was chosen while the only view of a tour
        was from 22 km up, where it is invisible. Measured on the built data it left a median
        segment of 177 m, 45 % of segments over 200 m and one straight run of 6 km — so a van
        crossing a gently curving arterial cut the corner off it and drove across the fields
        beside. From the ride-along camera added later that is not a simplification, it is the
        straight-line routing this whole module exists to remove. Costs roughly a megabyte in the
        bundle and buys a van that stays on its road at every zoom.

        The DISTANCE is unaffected either way: it comes from the graph traversal, not from the
        thinned line, so the tolerance cannot move a single reported kilometre.
        """
        found = self.route(start, goal)
        if found is None:
            self.unroutable += 1
            return None
        metres, seconds, nodes = found
        return metres, seconds, self.polyline(nodes, simplify_m)

    def polyline(self, nodes: list[int], simplify_m: float = 12.0) -> list[list[float]]:
        """Node indices to a drawable [lat, lon(, height)] polyline, thinned to what the eye can resolve.

        With baked heights the thinning is 3-D, so a bridge deck's rise and fall survives it.

        ⚠️ THINNED, BECAUSE THE RAW PATH IS FAR MORE DETAIL THAN THE PICTURE CARRIES. A routed round
        can run to several thousand OSM nodes; at 22 km almost all of them land inside one pixel,
        and shipping them all would inflate `operations.json` for nothing. Douglas-Peucker keeps
        every bend that is visible and drops the ones that are not.
        """
        def out(n: int) -> list[float]:
            lon, lat = self.lonlat[n]
            row = [round(lat, 6), round(lon, 6)]
            if self.elev is not None:
                row.append(round(self.elev[n], 2))
                if n in self.tunnel:
                    row.append(1)
                elif n in self.bridge:
                    row.append(2)
            return row

        if len(nodes) <= 2:
            return [out(n) for n in nodes]
        if self.elev is not None:
            pts = [(self.coords[n][0], self.coords[n][1], self.elev[n]) for n in nodes]
        else:
            pts = [(self.coords[n][0], self.coords[n][1], 0.0) for n in nodes]
        kept = set(_douglas_peucker(pts, simplify_m))
        # ⚠️ NEVER THIN AWAY A TRANSITION. Where a node changes between street / deck / tunnel, it is
        # kept: thinning dropped the Deutzer Brücke's west landing, so the 370 m main span became one
        # deck-to-street segment, was never treated as deck, and sat 4 m below the photographed deck.
        def flag(n: int) -> int:
            return 1 if n in self.tunnel else (2 if n in self.bridge else 0)

        flags = [flag(n) for n in nodes]
        for i in range(1, len(nodes)):
            if flags[i] != flags[i - 1]:
                kept.add(i - 1)
                kept.add(i)
        return [out(nodes[i]) for i in sorted(kept)]


def _douglas_peucker(points: list[tuple[float, float, float]], epsilon: float) -> list[int]:
    """Indices of the points worth keeping, by 3-D distance. Iterative, so a long path cannot blow
    the stack."""
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        ax, ay, az = points[first]
        bx, by, bz = points[last]
        dx, dy, dz = bx - ax, by - ay, bz - az
        length2 = dx * dx + dy * dy + dz * dz
        worst = 0.0
        index = -1
        for i in range(first + 1, last):
            px, py, pz = points[i]
            if length2 < 1e-12:
                d = math.dist((px, py, pz), (ax, ay, az))
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / length2))
                d = math.dist((px, py, pz), (ax + t * dx, ay + t * dy, az + t * dz))
            if d > worst:
                worst = d
                index = i
        if index >= 0 and worst > epsilon:
            keep[index] = True
            stack.append((first, index))
            stack.append((index, last))
    return [i for i, k in enumerate(keep) if k]

"""Fetch the drivable road network for the delivery region and build a routing graph.

⚠️ WHY THIS EXISTS. The tours were straight-line chains inflated by a 1.32 detour factor. Labelled
honestly, and still not credible to the audience this app is for: drawn across a delivery region
they visibly cut over the river, through rail yards and across open farmland. Anyone in logistics
reads a map for a living and would see it in the first ten seconds.

WHAT IS BUILT
  * `data/osm/<aoi>/roads_raw.json`   the Overpass response, cached
  * `data/operations/<aoi>/road_graph.json`  nodes, edges and the hub/pharmacy attachment points

⚠️ THE ROAD CLASSES ARE A DELIVERY VAN'S, NOT A CAR'S AND NOT A PEDESTRIAN'S. `service` and `track`
are excluded: including them pulls in every car-park aisle and field path in 1.500 km² and roughly
triples the graph for routes no van would take between towns. `living_street` and `residential` are
IN, because the last 200 m to a pharmacy is almost always one of them.

⚠️ KEY GRAPH NODES BY ROUNDED COORDINATE, NOT BY OSM NODE ID. Overpass `out geom` returns geometry
WITHOUT node ids, so joining ways on ids silently produces a graph with zero connections — every
way an island, every route a failure, and no error anywhere. This engine has already lost time to
exactly that. Rounding to 0,5 m and keying on the coordinate is what actually joins two ways that
share a junction.
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "geodata"))

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    # ⚠️ MORE THAN TWO, BECAUSE TWO WAS NOT ENOUGH. A run died with 504s on the first mirror and
    # 502s on the second within the same minute — public Overpass instances share load and tend to
    # be busy at the same times, so "try the other one" is not the independent fallback it looks
    # like. These are the remaining public endpoints that answer the same query language.
    # ⚠️ NOT overpass.osm.ch: it holds Switzerland only and answers a Cologne query with HTTP 200 and
    # zero elements, which this fallback would have taken as an empty road network (measured
    # 2026-11-05).
    "https://overpass.private.coffee/api/interpreter",
]
HEADERS = {
    "Content-Type": "text/plain; charset=utf-8",
    # Without a User-Agent overpass-api.de answers 406 on every request — recorded the hard way.
    "User-Agent": "caldova-cologne-digital-twin/0.1 (digital twin demo; contact via repository)",
    "Accept": "application/json",
}

#: What a delivery van will drive. Ordered fastest first; the speeds are a model and are stated as
#: one in the UI, but the SHAPE of the network is real.
ROAD_SPEED_KMH = {
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

#: Metres. Two way-ends closer than this are the same junction.
SNAP_M = 0.5

#: Radius around a bridge landing searched for the approach level (embankment top).
LANDING_RADIUS_M = 30.0
#: How far along a deck a landing's height is propagated (longer than any Cologne Rhine bridge span).
BRIDGE_REACH_M = 1500.0
#: Steepest grade a street keeps after limiting (see the slope limiter).
MAX_GRADE = 0.12

#: How far below its portals a tunnel interior is drawn — enough to vanish under the mesh.
TUNNEL_DEPTH_M = 6.0
#: Height used where no DGM1 tile exists (should not happen inside the ring; counted when it does).
DGM_FALLBACK_M = 45.0


class Dgm1:
    """Bilinear DGM1 lookup over the 1 km NRW tiles fetched by fetch_nrw.py (lazy, cached)."""

    def __init__(self, folder: Path):
        import re  # noqa: PLC0415

        self.tiles: dict[tuple[int, int], Path] = {}
        for f in folder.glob("dgm1_*.tif"):
            m = re.search(r"_32_?(\d{3})_(\d{4})_", f.name)
            if m:
                self.tiles[(int(m.group(1)), int(m.group(2)))] = f
        self.cache: dict[tuple[int, int], object] = {}
        self.hits = 0
        self.misses = 0

    def at(self, x: float, y: float) -> float:
        import numpy as np  # noqa: PLC0415
        from PIL import Image  # noqa: PLC0415

        k = (int(x // 1000), int(y // 1000))
        if k not in self.tiles:
            self.misses += 1
            return DGM_FALLBACK_M
        if k not in self.cache:
            self.cache[k] = np.asarray(Image.open(self.tiles[k]), dtype=np.float32)
        a = self.cache[k]
        col = x - k[0] * 1000 - 0.5
        row = (k[1] + 1) * 1000 - y - 0.5  # row 0 = north edge
        c0 = int(max(0, min(998, math.floor(col))))
        r0 = int(max(0, min(998, math.floor(row))))
        fx = min(1.0, max(0.0, col - c0))
        fy = min(1.0, max(0.0, row - r0))
        v = (a[r0, c0] * (1 - fx) * (1 - fy) + a[r0, c0 + 1] * fx * (1 - fy)
             + a[r0 + 1, c0] * (1 - fx) * fy + a[r0 + 1, c0 + 1] * fx * fy)
        self.hits += 1
        return float(v)


def overpass(query: str, min_elements: int = 0) -> dict:
    """POST a query, trying every mirror.

    ⚠️ AN EMPTY 200 IS A FAILURE, NOT AN ANSWER. A mirror answered HTTP 200 with zero elements for
    an 11 x 11 km box of a German metropolitan region, which contains, in reality, several thousand
    roads. Treated as success it cached an empty quadrant, and because the cache is what makes a
    re-run resumable, that hole would have been preserved by every subsequent run and shown up only
    as tours mysteriously refusing to route through the north-west.

    So a response that carries less than the caller expects is retried like any other failure, and
    if every mirror agrees on nothing, the caller is told rather than quietly handed a hole.
    """
    last: Exception | None = None
    body = query.encode("utf-8")
    for mirror in MIRRORS:
        host = mirror.split("/")[2]
        for attempt in range(3):
            try:
                req = urllib.request.Request(mirror, data=body, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=300) as resp:  # noqa: S310
                    data = json.loads(resp.read().decode("utf-8"))
                count = len(data.get("elements", []))
                if count < min_elements:
                    raise RuntimeError(
                        f"HTTP 200 but only {count} elements, expected at least {min_elements}"
                    )
                return data
            except Exception as exc:  # noqa: BLE001
                last = exc
                print(f"    {host} attempt {attempt + 1}: {exc}", file=sys.stderr, flush=True)
                # A 504 means the mirror is overloaded, and hammering it 6 seconds later is what
                # an overloaded server least needs. Backs off to half a minute before giving up on
                # this mirror and trying the next.
                time.sleep(min(10 * (attempt + 1) ** 2, 40))
    raise SystemExit(f"Overpass failed on every mirror: {last}")


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


def key(x: float, y: float) -> tuple[int, int]:
    """Graph node identity: the rounded coordinate. See the module note."""
    return (int(round(x / SNAP_M)), int(round(y / SNAP_M)))


def split(box, n: int):
    s, w, north, e = box
    for i in range(n):
        for j in range(n):
            yield (
                s + (north - s) * i / n,
                w + (e - w) * j / n,
                s + (north - s) * (i + 1) / n,
                w + (e - w) * (j + 1) / n,
            )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aoi", default="koeln-messe")
    ap.add_argument("--radius-km", type=float, default=None, help="default: pharmacy radius + 1 km")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    from aoi import load_aoi  # noqa: E402

    cfg = load_aoi(args.aoi)
    hub = next(p for p in cfg["focusPlaces"] if p.get("kind") == "hero")
    if args.radius_km is None:
        args.radius_km = float(cfg["site3d"]["pharmacies"]["radiusKm"]) + 1.0

    dlat = args.radius_km / 111.32
    dlon = args.radius_km / (111.32 * math.cos(math.radians(hub["lat"])))
    box = (hub["lat"] - dlat, hub["lon"] - dlon, hub["lat"] + dlat, hub["lon"] + dlon)

    cache = ROOT / "data" / "osm" / cfg["id"] / "roads_raw.json"
    cache.parent.mkdir(parents=True, exist_ok=True)

    if cache.exists() and not args.force:
        print(f"roads from cache: {cache}")
        elements = json.loads(cache.read_text(encoding="utf-8"))["elements"]
    else:
        classes = "|".join(ROAD_SPEED_KMH)
        quads = list(split(box, 4))
        elements = []
        seen: set[int] = set()

        # ⚠️ ONE CACHE FILE PER QUADRANT, WRITTEN AS SOON AS IT ARRIVES.
        #
        # The first version accumulated every quadrant in memory and wrote the cache after the
        # loop. Overpass then 504'd on quadrant 3 of 16 and the run exited — throwing away the
        # 4.541 ways it had already downloaded and leaving nothing to resume from. Public Overpass
        # mirrors go down often enough that a fetch measured in tens of minutes WILL meet an
        # outage; the question is only whether the outage costs one quadrant or all of them.
        #
        # Re-running now resumes: quadrants already on disk are skipped, so a failed run is
        # progress rather than a loss.
        for i, (s, w, n, e) in enumerate(quads, 1):
            part = cache.parent / f"roads_q{i:02d}.json"
            if part.exists():
                data = json.loads(part.read_text(encoding="utf-8"))
                cached_ways = len(data.get("elements", []))
                # ⚠️ AN EMPTY CACHED QUADRANT IS TREATED AS ABSENT. One was written from a mirror
                # that answered 200 with nothing; without this the resume logic would skip it for
                # ever and the region would keep a silent hole in its road network.
                if cached_ways == 0:
                    print(f"[{i}/{len(quads)}] cached but EMPTY — refetching", flush=True)
                    part.unlink()
                else:
                    print(f"[{i}/{len(quads)}] cached ({cached_ways} ways)")

            if not part.exists():
                print(f"[{i}/{len(quads)}] roads in {s:.3f},{w:.3f},{n:.3f},{e:.3f}", flush=True)
                data = overpass(
                    f"""[out:json][timeout:280];
                    way["highway"~"^({classes})$"]({s},{w},{n},{e});
                    out geom;""",
                    # Every quadrant here is inhabited German land. A hundred is far below what any
                    # of them really holds (the smallest so far is 1.405) and far above zero.
                    min_elements=100,
                )
                part.write_text(json.dumps(data), encoding="utf-8")
                print(f"    saved {part.name} ({len(data.get('elements', []))} ways)", flush=True)

            fresh = 0
            for el in data.get("elements", []):
                if el["id"] in seen:
                    continue
                seen.add(el["id"])
                elements.append(el)
                fresh += 1
            print(f"    +{fresh} new (total {len(elements)})", flush=True)

        cache.write_text(json.dumps({"elements": elements}), encoding="utf-8")
        print(f"merged cache written: {cache}")

    # ── build the graph ─────────────────────────────────────────────────────────────────────────
    nodes: dict[tuple[int, int], int] = {}
    coords: list[tuple[float, float]] = []
    # ⚠️ THE ORIGINAL LAT/LON, CARRIED THROUGH. A routed path has to be DRAWN, which means going
    # back to geographic coordinates — and the honest way to do that is to keep the coordinate the
    # data arrived with, not to write an inverse UTM projection and hope it agrees with the forward
    # one. An inverse that is subtly wrong would put every routed van a few metres off its street,
    # which reads as the terrain being misaligned rather than as a projection bug.
    lonlat: list[tuple[float, float]] = []
    adjacency: list[list[tuple[int, float, float]]] = []  # (to, metres, seconds)

    def node_id(x: float, y: float, lat: float, lon: float) -> int:
        k = key(x, y)
        found = nodes.get(k)
        if found is not None:
            return found
        index = len(coords)
        nodes[k] = index
        coords.append((x, y))
        lonlat.append((lon, lat))
        adjacency.append([])
        return index

    # ── ground heights ─────────────────────────────────────────
    # Every node gets an absolute height (DHHN2016) baked HERE, offline, so the browser never
    # ray-casts the mesh per vehicle per frame. DGM1 is bare earth, which is right for a street and
    # wrong on a bridge: under the Deutzer or Severinsbrücke DGM1 is the Rhine bed. So bridge ways
    # take a straight deck between their two landings, and tunnel interiors sit below ground.
    dgm = Dgm1(ROOT / "data" / "dgm1" / cfg["id"])
    node_elev: dict[int, float] = {}
    override: dict[int, float] = {}
    #: Nodes on tunnel ways, and nodes on any surface way. A tunnel node that is ALSO on a surface
    #: way is a portal and keeps its ground height; every other tunnel node stays underground, even
    #: where OSM splits one tunnel into several ways (each split used to pop back up to ground).
    tunnel_nodes: set[int] = set()
    surface_nodes: set[int] = set()
    #: Bridge decks: nodes on bridge ways, the deck network between them, and the nodes that are also
    #: on an ordinary street (the landings).
    bridge_nodes: set[int] = set()
    street_nodes: set[int] = set()
    bridge_links: dict[int, list[tuple[int, float]]] = {}

    oneway_count = 0
    bridge_ways = tunnel_ways = 0
    for el in elements:
        geometry = el.get("geometry") or []
        if len(geometry) < 2:
            continue
        tags = el.get("tags", {})
        speed = ROAD_SPEED_KMH.get(tags.get("highway", ""), 30)
        # ⚠️ ONE-WAY IS MODELLED HERE (the engine this came from did not). In Cologne the motorways, the
        # Ring and the Rheinufer arterials are mapped as SEPARATE one-way carriageways; ignoring
        # `oneway` let a truck drive against traffic on them, which a logistics viewer notices first.
        # Turn restrictions are still NOT modelled, so a route can contain a forbidden turn — stated
        # in the output note.
        ow = tags.get("oneway")
        if ow is None and (tags.get("junction") == "roundabout" or tags.get("highway") in ("motorway", "motorway_link")):
            ow = "yes"
        forward = ow != "-1"
        backward = ow not in ("yes", "true", "1", "-1")
        if not (forward and backward):
            oneway_count += 1
        points = [(utm32(p["lat"], p["lon"]), p["lat"], p["lon"]) for p in geometry]
        ids = []
        for (x, y), lat, lon in points:
            nid = node_id(x, y, lat, lon)
            if nid not in node_elev:
                node_elev[nid] = dgm.at(x, y)
            ids.append(nid)
        is_bridge = tags.get("bridge") not in (None, "no")
        try:
            raised = int(str(tags.get("layer", "0")).split(";")[0]) > 0
        except ValueError:
            raised = False
        is_tunnel = tags.get("tunnel") not in (None, "no", "building_passage")
        (tunnel_nodes if is_tunnel else surface_nodes).update(ids)
        if (is_bridge or raised) and not is_tunnel:
            bridge_ways += 1
            bridge_nodes.update(ids)
            for u, v in zip(ids, ids[1:]):
                d = math.dist(coords[u], coords[v])
                bridge_links.setdefault(u, []).append((v, d))
                bridge_links.setdefault(v, []).append((u, d))
        elif not is_tunnel:
            street_nodes.update(ids)
        if is_tunnel:
            tunnel_ways += 1
        previous = ids[0]
        for current in ids[1:]:
            if current == previous:
                continue
            metres = math.dist(coords[previous], coords[current])
            seconds = metres / (speed / 3.6)
            if forward:
                adjacency[previous].append((current, metres, seconds))
            if backward:
                adjacency[current].append((previous, metres, seconds))
            previous = current
    # ── bridge decks ─────────────────────────────────────────────
    # ⚠️ A LANDING TAKES THE APPROACH LEVEL, NOT THE BARE EARTH UNDER IT. The first version used
    # DGM1 at the bridge way's end nodes: at the Deutzer Brücke those sit over the Kennedy-Ufer and the
    # Rheinufer trough, so the deck came out 45.5–47 m — LOWER than both approaches (50–51 m), with
    # 1:1 vehicles driving inside the photographed deck. Now: a landing is a deck node that is also
    # on an ordinary street, at the highest DGM1 within LANDING_RADIUS_M (the embankment/approach).
    # Deck nodes are interpolated along the deck network from their two nearest landings, so a bridge
    # that OSM splits into several ways stays one straight deck instead of sagging at each split.
    import heapq as _hq  # noqa: PLC0415

    def landing_height(n: int) -> float:
        x0, y0 = coords[n]
        best = node_elev[n]
        r = LANDING_RADIUS_M
        steps = int(r // 5)
        for i in range(-steps, steps + 1):
            for j in range(-steps, steps + 1):
                if (i * 5) ** 2 + (j * 5) ** 2 <= r * r:
                    best = max(best, dgm.at(x0 + i * 5, y0 + j * 5))
        return best

    landings = {n: landing_height(n) for n in bridge_nodes & street_nodes}
    near: dict[int, list[tuple[float, int]]] = {}
    for start, h_start in landings.items():
        dist = {start: 0.0}
        queue = [(0.0, start)]
        while queue:
            d, u = _hq.heappop(queue)
            if d > dist.get(u, math.inf) or d > BRIDGE_REACH_M:
                continue
            if u != start:
                near.setdefault(u, []).append((d, start))
            if u in landings and u != start:
                continue  # interpolate between landings, never across one
            for v, w in bridge_links.get(u, []):
                nd = d + w
                if nd < dist.get(v, math.inf):
                    dist[v] = nd
                    _hq.heappush(queue, (nd, v))
    for n, h in landings.items():
        override[n] = h
    decks = 0
    for n in bridge_nodes - set(landings):
        cands = sorted(near.get(n, []))[:2]
        if not cands:
            continue
        if len(cands) == 1:
            override[n] = landings[cands[0][1]]
        else:
            (d0, a), (d1, b) = cands
            override[n] = (landings[a] * d1 + landings[b] * d0) / max(d0 + d1, 1e-6)
        decks += 1
    print(f"  bridge decks: {len(landings):,} landings at approach level, {decks:,} deck nodes interpolated")

    node_elev.update(override)
    underground = tunnel_nodes - surface_nodes
    for nid in underground:
        node_elev[nid] = node_elev[nid] - TUNNEL_DEPTH_M

    # ── slope limiter on the SHARED graph ─────────────────────────
    # DGM1 sampled at a road centreline catches trough walls (tunnel ramps, the sunken Ebertplatz).
    # Limiting grades per TOUR gave one junction different heights in different tours and stopped at a
    # pass cap with violations left. Here every edge of the one graph is limited, until it converges.
    adjust_start = dict(node_elev)
    passes = 0
    while True:
        passes += 1
        changed = 0
        for u in range(len(coords)):
            if u in underground:
                continue
            for v, metres, _sec in adjacency[u]:
                if v in underground:
                    continue
                rise = node_elev[v] - node_elev[u]
                allowed = max(2.0, MAX_GRADE * max(metres, 0.5))
                if abs(rise) > allowed + 1e-6:
                    excess = (abs(rise) - allowed) / 2 * (1 if rise > 0 else -1)
                    node_elev[u] += excess
                    node_elev[v] -= excess
                    changed += 1
        if not changed or passes >= 2000:
            break
    moved = [abs(node_elev[n] - adjust_start[n]) for n in node_elev if abs(node_elev[n] - adjust_start[n]) > 0.01]
    worst_move = max(moved, default=0.0)
    print(f"  slope limiter: {'converged' if not changed else 'NOT converged'} after {passes} passes, "
          f"{len(moved):,} nodes moved, largest {worst_move:.1f} m")
    if changed:
        raise SystemExit("slope limiter did not converge")
    # The cap applies inside the delivery area. Beyond the DGM1 tiles (road-box edge, fallback
    # height) large moves are expected and no tour drives there.
    hx, hy = utm32(hub["lat"], hub["lon"])
    area_m = float(cfg["site3d"]["pharmacies"]["radiusKm"]) * 1000 + 500
    # Nodes next to a tunnel portal sit in a trough whose walls DGM1 catches; they may move up to
    # 6 m (measured: 5.0 m at the Rheinufertunnel portal by the Frankenwerft). Everywhere else 4 m.
    def portal_adjacent(n: int) -> bool:
        return any(v in underground for v, _m, _s in adjacency[n])

    inside = [
        abs(node_elev[n] - adjust_start[n]) - (2.0 if portal_adjacent(n) else 0.0)
        for n in node_elev if math.dist(coords[n], (hx, hy)) <= area_m
    ]
    worst_inside = max(inside, default=0.0)
    print(f"  slope limiter inside the delivery area: largest move over its limit {worst_inside - 4.0:+.1f} m "
          "(limit 4 m, 6 m next to a tunnel portal)")
    for d, n in sorted(((abs(node_elev[n] - adjust_start[n]), n) for n in node_elev if math.dist(coords[n], (hx, hy)) <= area_m), reverse=True)[:5]:
        lon, lat = lonlat[n]
        tag = "landing" if n in landings else ("bridge" if n in bridge_nodes else ("tunnel-adj" if any(v in underground for v, _m, _s in adjacency[n]) else "street"))
        print(f"    in area: moved {d:4.1f} m at {lat:.5f},{lon:.5f} ({tag}, {adjust_start[n]:.1f} -> {node_elev[n]:.1f})")
    if worst_inside > 4.0:
        raise SystemExit("the slope limiter moved a delivery-area node by more than 4 m — a height error, not a trough wall")
    top = sorted(((abs(node_elev[n] - adjust_start[n]), n) for n in node_elev), reverse=True)[:6]
    for d, n in top:
        lon, lat = lonlat[n]
        tag = "bridge" if n in bridge_nodes else ("landing" if n in landings else "street")
        print(f"    moved {d:5.1f} m at {lat:.5f},{lon:.5f} ({tag}, {adjust_start[n]:.1f} -> {node_elev[n]:.1f})")

    print(f"\ngraph: {len(coords):,} nodes, {sum(len(x) for x in adjacency):,} directed edges")
    print(f"  {len(elements):,} ways, {oneway_count:,} one-way (modelled), {bridge_ways} bridges, {tunnel_ways} tunnels")
    print(f"  DGM1 heights: {dgm.hits:,} sampled, {dgm.misses:,} outside the DGM1 tiles (fallback {DGM_FALLBACK_M} m)")

    # ── keep only the network you can actually drive around ─────────────────────────────────────
    #
    # ⚠️ A ROAD GRAPH CUT OUT OF A BOX IS NOT ONE NETWORK. It is one big network plus hundreds of
    # fragments: stubs clipped at the bbox edge, a service road whose only connection lies outside
    # the box, a car park loop that touches nothing. Attaching a pharmacy to the NEAREST node lands
    # some of them on such a fragment, and from there nothing is reachable — three tours failed to
    # route for exactly this reason, which the generator then reported as "the graph is
    # disconnected" without saying which part.
    #
    # Only the largest component is kept. Attachment then cannot pick an island, because there are
    # none left to pick.
    # ⚠️ WITH ONE-WAYS THE RIGHT NOTION IS *STRONGLY* CONNECTED: a node you can reach but never leave
    # (a one-way stub at the box edge) traps a route just like an island does. Kosaraju, iterative;
    # the largest SCC is kept.
    n_nodes = len(coords)
    reverse: list[list[int]] = [[] for _ in range(n_nodes)]
    for u in range(n_nodes):
        for v, _m, _s in adjacency[u]:
            reverse[v].append(u)
    order: list[int] = []
    visited = [False] * n_nodes
    for start in range(n_nodes):
        if visited[start]:
            continue
        visited[start] = True
        stack = [(start, 0)]
        while stack:
            u, i = stack[-1]
            if i < len(adjacency[u]):
                stack[-1] = (u, i + 1)
                v = adjacency[u][i][0]
                if not visited[v]:
                    visited[v] = True
                    stack.append((v, 0))
            else:
                order.append(u)
                stack.pop()
    component = [-1] * n_nodes
    sizes: list[int] = []
    for start in reversed(order):
        if component[start] != -1:
            continue
        label = len(sizes)
        component[start] = label
        todo = [start]
        count = 0
        while todo:
            u = todo.pop()
            count += 1
            for v in reverse[u]:
                if component[v] == -1:
                    component[v] = label
                    todo.append(v)
        sizes.append(count)

    main_label = max(range(len(sizes)), key=lambda i: sizes[i])
    keep = [i for i in range(len(coords)) if component[i] == main_label]
    dropped = len(coords) - len(keep)
    print(f"  {len(sizes):,} strongly connected components; keeping the largest ({len(keep):,} nodes, dropping {dropped:,})")
    if len(keep) < len(coords) * 0.75:
        raise SystemExit(
            f"the largest strongly connected component holds only {100 * len(keep) / len(coords):.0f}% "
            "of the nodes — check one-way handling and the node keying."
        )

    remap = {old: new for new, old in enumerate(keep)}
    elev = [round(node_elev.get(i, DGM_FALLBACK_M), 2) for i in keep]
    coords = [coords[i] for i in keep]
    lonlat = [lonlat[i] for i in keep]
    adjacency = [
        [(remap[v], m, s) for v, m, s in adjacency[i] if v in remap] for i in keep
    ]

    # ── attach the hub and every pharmacy to their nearest junction ─────────────────────────────
    pharmacies = json.loads(
        (ROOT / "data" / "operations" / cfg["id"] / "pharmacies.json").read_text(encoding="utf-8")
    )["pharmacies"]

    # A uniform grid over the nodes: 200.000 nodes is far too many for a linear scan per lookup.
    CELL = 250.0
    buckets: dict[tuple[int, int], list[int]] = {}
    for index, (x, y) in enumerate(coords):
        buckets.setdefault((int(x // CELL), int(y // CELL)), []).append(index)

    def nearest(x: float, y: float) -> tuple[int, float]:
        cx, cy = int(x // CELL), int(y // CELL)
        for ring in range(0, 12):
            candidates: list[int] = []
            for i in range(cx - ring, cx + ring + 1):
                for j in range(cy - ring, cy + ring + 1):
                    if ring > 0 and abs(i - cx) != ring and abs(j - cy) != ring:
                        continue
                    candidates.extend(buckets.get((i, j), ()))
            if candidates:
                best = min(candidates, key=lambda n: math.dist(coords[n], (x, y)))
                return best, math.dist(coords[best], (x, y))
        raise SystemExit("no road node within 3 km — the graph or the coordinate is wrong")

    hub_x, hub_y = utm32(hub["lat"], hub["lon"])
    hub_node, hub_dist = nearest(hub_x, hub_y)
    print(f"  hub attaches {hub_dist:.0f} m from its nearest road node")

    attach: dict[str, int] = {}
    far = []
    for p in pharmacies:
        x, y = utm32(p["lat"], p["lon"])
        node, distance = nearest(x, y)
        attach[p["pharmacyId"]] = node
        if distance > 150:
            far.append((p["pharmacyId"], round(distance)))
    if far:
        # A pharmacy 400 m from any road is almost always a mis-tagged point, not a remote one.
        print(f"  ⚠️ {len(far)} pharmacies attach more than 150 m from a road: {far[:5]}")

    out = ROOT / "data" / "operations" / cfg["id"] / "road_graph.json"
    out.write_text(
        json.dumps(
            {
                "provenance": "measured",
                "source": "OpenStreetMap highway network",
                "attribution": "© OpenStreetMap contributors, ODbL 1.0",
                "$note": (
                    "The NETWORK is real. Speeds are a model; one-way streets are honoured, turn "
                    "restrictions are NOT modelled. Heights: DGM1 (Geobasis NRW) per node, bridge "
                    "decks interpolated between their landings, tunnel interiors below ground."
                ),
                "roadClasses": ROAD_SPEED_KMH,
                "nodeCount": len(coords),
                "edgeCount": sum(len(a) for a in adjacency),
                "coords": [[round(x, 1), round(y, 1)] for x, y in coords],
                "lonlat": [[round(lon, 6), round(lat, 6)] for lon, lat in lonlat],
                "adjacency": [[[to, round(m, 1), round(s, 2)] for to, m, s in row] for row in adjacency],
                "elev": elev,
                "tunnel": [remap[i] for i in sorted(underground) if i in remap],
                "bridge": [remap[i] for i in sorted(bridge_nodes) if i in remap],
                "hubNode": hub_node,
                "attach": attach,
            }
        ),
        encoding="utf-8",
    )
    size = out.stat().st_size / 1e6
    print(f"\nwrote {out} ({size:.1f} MB)")

    # ── prove it routes ─────────────────────────────────────────────────────────────────────────
    # A graph that looks fine and routes nothing is the failure mode here, and it is silent.
    def dijkstra(start: int, goals: set[int]) -> dict[int, float]:
        dist = {start: 0.0}
        seen: set[int] = set()
        queue = [(0.0, start)]
        found: dict[int, float] = {}
        while queue and len(found) < len(goals):
            d, u = heapq.heappop(queue)
            if u in seen:
                continue
            seen.add(u)
            if u in goals:
                found[u] = d
            for v, metres, _sec in adjacency[u]:
                nd = d + metres
                if nd < dist.get(v, math.inf):
                    dist[v] = nd
                    heapq.heappush(queue, (nd, v))
        return found

    sample = {attach[p["pharmacyId"]] for p in pharmacies[:40]}
    reached = dijkstra(hub_node, sample)
    print(f"routing check: {len(reached)}/{len(sample)} of the nearest pharmacies reachable from the hub")
    if len(reached) < len(sample) * 0.9:
        raise SystemExit(
            "the road graph is disconnected — more than 10 % of nearby pharmacies cannot be "
            "reached from the warehouse. Joining ways by coordinate is what makes this work; "
            "check SNAP_M and that `out geom` was used."
        )
    straight = math.dist(coords[hub_node], coords[attach[pharmacies[0]["pharmacyId"]]])
    routed = reached.get(attach[pharmacies[0]["pharmacyId"]])
    if routed:
        print(f"  nearest pharmacy: {straight/1000:.2f} km straight, {routed/1000:.2f} km routed "
              f"({routed/max(straight,1):.2f}x)")


if __name__ == "__main__":
    main()

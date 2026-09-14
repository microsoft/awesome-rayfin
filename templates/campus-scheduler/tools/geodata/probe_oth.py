"""Probe the OTH Regensburg site in OpenStreetMap — before a single coordinate enters config.

PLAN §5.1 and the rule inherited from `Campus-Insights` / `Gleitschirm-Insights`:
**no coordinate enters an AOI config without being looked up.** That rule exists because an
earlier project shipped an AOI built around a place node 4.6 km from the town it named.

This asks Overpass what is actually there:

  stage `sites`   which OSM features carry the OTH Regensburg name/operator, and where they are
  stage `detail`  what is inside each campus box — buildings, trees, paths, PT stops
  stage `indoor`  the decisive question of PLAN §5.4: does OSM have indoor room mapping for OTH?
  stage `aoi`     per-category counts over the whole AOI — what the twin has to render
  stage `ele`     `ele`-tagged nodes, i.e. candidate control points for the registration gate

Raw responses are written to the temp folder; the summary is what gets read into config.

Usage
  python tools/geodata/probe_oth.py --stage sites
  python tools/geodata/probe_oth.py --stage detail
  python tools/geodata/probe_oth.py --stage indoor
  python tools/geodata/probe_oth.py --stage ele
"""

from __future__ import annotations

import argparse
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Kumi first — measured in Campus-Insights: the main instance 504s reproducibly on the larger
# queries this kind of probe needs, while the same query returns in seconds here.
OVERPASS_MIRRORS = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)
USER_AGENT = "Campus-Scheduler/0.1 (open geodata probe; +https://geodaten.bayern.de)"

OUT_DIR = Path(r"C:\Users\alkorn\repos\temp")

# A generous first look around Regensburg. Deliberately wider than any AOI would be: the point is
# to find out where things are, not to confirm a box somebody already decided on.
WIDE = {"west": 12.00, "east": 12.20, "south": 48.95, "north": 49.06}


def overpass(query: str, attempts: int = 3, timeout: int = 180) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for attempt in range(attempts):
        for endpoint in OVERPASS_MIRRORS:
            try:
                request = urllib.request.Request(
                    endpoint, data=body, headers={"User-Agent": USER_AGENT}
                )
                with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                    return json.loads(response.read())
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
                last = exc
                print(f"  {endpoint.split('/')[2]} failed: {exc}")
        wait = 15 * (attempt + 1)
        print(f"  attempt {attempt + 1} failed on every mirror — retrying in {wait}s")
        time.sleep(wait)
    raise RuntimeError(f"Overpass failed after {attempts} attempts: {last}")


def centre(element: dict) -> tuple[float, float] | None:
    if "lat" in element and "lon" in element:
        return element["lat"], element["lon"]
    if "center" in element:
        return element["center"]["lat"], element["center"]["lon"]
    if "bounds" in element:
        b = element["bounds"]
        return (b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2
    return None


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371008.8
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def box(bounds: dict[str, float]) -> str:
    return f"{bounds['south']},{bounds['west']},{bounds['north']},{bounds['east']}"


def dump(name: str, payload: dict) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"oth-probe-{name}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def stage_sites() -> None:
    """Which OSM features claim to be the OTH, and where are they?"""
    b = box(WIDE)
    query = f"""
    [out:json][timeout:180];
    (
      nwr["amenity"="university"]({b});
      nwr["amenity"="college"]({b});
      nwr["operator"~"Ostbayerische|OTH",i]({b});
      nwr["name"~"Ostbayerische Technische Hochschule|OTH Regensburg",i]({b});
    );
    out tags center;
    """
    data = overpass(query)
    print(f"raw -> {dump('sites', data)}")

    rows = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        c = centre(el)
        if not c:
            continue
        rows.append(
            {
                "type": el["type"],
                "id": el["id"],
                "name": tags.get("name", ""),
                "amenity": tags.get("amenity", ""),
                "operator": tags.get("operator", ""),
                "street": f"{tags.get('addr:street', '')} {tags.get('addr:housenumber', '')}".strip(),
                "lat": round(c[0], 6),
                "lon": round(c[1], 6),
                "bounds": el.get("bounds"),
            }
        )

    print(f"\n{len(rows)} candidate features\n")
    for r in sorted(rows, key=lambda r: r["name"]):
        print(
            f"  {r['type']:8} {r['id']:<12} {r['lat']:.5f},{r['lon']:.5f}  "
            f"{r['name'][:60]:<60} | {r['amenity']:<10} | {r['street']}"
        )

    oth = [r for r in rows if "Ostbayerische" in r["name"] or "OTH" in r["name"] or "Ostbayerische" in r["operator"]]
    if len(oth) >= 2:
        print("\ndistances between OTH features:")
        for i, a in enumerate(oth):
            for bb in oth[i + 1 :]:
                d = haversine_m((a["lat"], a["lon"]), (bb["lat"], bb["lon"]))
                if d > 300:
                    print(f"  {a['name'][:35]:<35} <-> {bb['name'][:35]:<35} {d / 1000:.2f} km")


def stage_detail(bounds: dict[str, float], label: str) -> None:
    """What is inside a candidate campus box?"""
    b = box(bounds)
    query = f"""
    [out:json][timeout:180];
    (
      way["building"]({b});
      relation["building"]({b});
      node["natural"="tree"]({b});
      way["highway"~"^(footway|path|steps|pedestrian)$"]({b});
      node["public_transport"="platform"]({b});
      node["highway"="bus_stop"]({b});
    );
    out count;
    """
    data = overpass(query)
    print(f"raw -> {dump(f'detail-{label}', data)}")
    for el in data.get("elements", []):
        if el.get("type") == "count":
            t = el.get("tags", {})
            print(f"\n{label}: total={t.get('total')} nodes={t.get('nodes')} ways={t.get('ways')} relations={t.get('relations')}")


def stage_indoor(bounds: dict[str, float], label: str) -> None:
    """PLAN §5.4 — the decisive question. Does OTH have OSM indoor room mapping?"""
    b = box(bounds)
    query = f"""
    [out:json][timeout:180];
    (
      nwr["indoor"="room"]({b});
      nwr["indoor"="corridor"]({b});
      nwr["indoor"="level"]({b});
      nwr["building:levels"]({b});
    );
    out count;
    """
    data = overpass(query)
    print(f"raw -> {dump(f'indoor-{label}', data)}")
    for el in data.get("elements", []):
        if el.get("type") == "count":
            print(f"\n{label} indoor+levels: {el.get('tags', {})}")

    rooms = f"""
    [out:json][timeout:180];
    nwr["indoor"="room"]({b});
    out tags center;
    """
    data = overpass(rooms)
    els = data.get("elements", [])
    print(f"{label}: {len(els)} indoor=room features")
    for el in els[:15]:
        t = el.get("tags", {})
        print(f"    ref={t.get('ref', '-')!s:<12} name={t.get('name', '-')!s:<30} level={t.get('level', '-')}")


def stage_aoi(bounds: dict[str, float]) -> None:
    """Per-category counts over the whole AOI — what the twin will actually have to render."""
    b = box(bounds)
    categories = {
        "buildings": f'way["building"]({b});relation["building"]({b});',
        "buildings_with_levels": f'way["building"]["building:levels"]({b});',
        "trees": f'node["natural"="tree"]({b});',
        "tree_rows": f'way["natural"="tree_row"]({b});',
        "wood_landuse": f'way["landuse"~"^(forest|grass|meadow|village_green)$"]({b});relation["landuse"~"^(forest|grass|meadow)$"]({b});',
        "footways": f'way["highway"~"^(footway|path|steps|pedestrian|cycleway)$"]({b});',
        "roads": f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|service|unclassified)$"]({b});',
        "pt_stops": f'node["highway"="bus_stop"]({b});node["railway"="tram_stop"]({b});node["public_transport"="platform"]({b});',
        "water": f'way["natural"="water"]({b});way["waterway"]({b});relation["natural"="water"]({b});',
    }
    results: dict[str, str] = {}
    for name, body in categories.items():
        query = f"[out:json][timeout:180];({body});out count;"
        data = overpass(query)
        total = "?"
        for el in data.get("elements", []):
            if el.get("type") == "count":
                total = el.get("tags", {}).get("total", "?")
        results[name] = total
        print(f"  {name:<22} {total}")
        time.sleep(3)
    dump("aoi-counts", results)


def stage_bounds(ids: list[str]) -> None:
    """True extent of named OSM features — turns a guessed campus box into a measured one."""
    parts = []
    for raw in ids:
        kind, _, oid = raw.partition("/")
        parts.append(f"{kind}({oid});")
    query = f"[out:json][timeout:180];({''.join(parts)});out geom;"
    data = overpass(query)
    print(f"raw -> {dump('bounds', data)}")
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        b = el.get("bounds")
        if not b:
            print(f"  {el['type']}/{el['id']} — no bounds returned")
            continue
        w_m = haversine_m((b["minlat"], b["minlon"]), (b["minlat"], b["maxlon"]))
        h_m = haversine_m((b["minlat"], b["minlon"]), (b["maxlat"], b["minlon"]))
        print(
            f"\n  {el['type']}/{el['id']}  {tags.get('name', '')[:50]}\n"
            f"    west={b['minlon']:.5f} east={b['maxlon']:.5f} "
            f"south={b['minlat']:.5f} north={b['maxlat']:.5f}\n"
            f"    extent {w_m:.0f} x {h_m:.0f} m"
        )


def stage_ele(bounds: dict[str, float]) -> None:
    """Candidate control points for the registration gate."""
    b = box(bounds)
    query = f"""
    [out:json][timeout:180];
    node["ele"]({b});
    out tags center;
    """
    data = overpass(query)
    print(f"raw -> {dump('ele', data)}")
    els = data.get("elements", [])
    print(f"\n{len(els)} ele-tagged nodes")
    for el in els:
        t = el.get("tags", {})
        print(
            f"  node/{el['id']:<12} {el['lat']:.6f},{el['lon']:.6f}  ele={t.get('ele'):<10} "
            f"{t.get('name', '')[:40]:<40} {[k for k in t if k not in ('ele', 'name')][:4]}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True, choices=["sites", "detail", "indoor", "aoi", "bounds", "ele"])
    parser.add_argument("--ids", nargs="*", default=[], help="e.g. relation/1733231 way/28938080")
    parser.add_argument("--west", type=float)
    parser.add_argument("--east", type=float)
    parser.add_argument("--south", type=float)
    parser.add_argument("--north", type=float)
    parser.add_argument("--label", default="box")
    args = parser.parse_args()

    bounds = WIDE.copy()
    for key in ("west", "east", "south", "north"):
        if getattr(args, key) is not None:
            bounds[key] = getattr(args, key)

    if args.stage == "sites":
        stage_sites()
    elif args.stage == "detail":
        stage_detail(bounds, args.label)
    elif args.stage == "indoor":
        stage_indoor(bounds, args.label)
    elif args.stage == "aoi":
        stage_aoi(bounds)
    elif args.stage == "bounds":
        stage_bounds(args.ids)
    else:
        stage_ele(bounds)


if __name__ == "__main__":
    main()

"""Probe a university site in OpenStreetMap — before a single coordinate enters config.

The site-agnostic successor to `probe_oth.py`. Same rule, inherited from `Campus-Insights` /
`Gleitschirm-Insights`: **no coordinate enters an AOI config without being looked up.** That rule
exists because an earlier project shipped an AOI built around a place node 4.6 km from the town it
named, and `probe_oth.py` earned it again — the OTH campus outline it measured turned out to be
half the separation the customer conversation had assumed.

`probe_oth.py` hard-codes Regensburg. It is deliberately left alone: it is the record of how the
OTH AOI was measured. This module carries the same stages with the site as an argument, so the
second university is a registry entry rather than a copied file.

  stage `sites`   which OSM features carry the university's name/operator, and where they are
  stage `bounds`  the true extent of named features — turns a guessed box into a measured one
  stage `detail`  what is inside a candidate campus box — buildings, trees, paths, PT stops
  stage `indoor`  does OSM have indoor room mapping here? (decides whether rooms can be real)
  stage `aoi`     per-category counts over the whole AOI — what the twin has to render
  stage `ele`     `ele`-tagged nodes, i.e. candidate control points for the registration gate

Raw responses are written to the temp folder; the summary is what gets read into config.

Usage
  python tools/geodata/probe_site.py --site lmu --stage sites
  python tools/geodata/probe_site.py --site lmu --stage bounds --ids way/123 relation/456
  python tools/geodata/probe_site.py --site lmu --stage indoor --west 11.57 --east 11.59 \
      --south 48.14 --north 48.16 --label stammgelaende
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

# The search area for each site, deliberately WIDER than any AOI would be: the point of a probe is
# to find out where a university actually is, not to confirm a box somebody already drew. The
# `match` regex is what separates this university from the others in the same city — in München
# that matters, because TUM, HM and LMU all sit inside the same few square kilometres.
PROBE_SITES: dict[str, dict] = {
    "oth": {
        "label": "OTH Regensburg",
        "wide": {"west": 12.00, "east": 12.20, "south": 48.95, "north": 49.06},
        "match": "Ostbayerische Technische Hochschule|OTH Regensburg",
        "operator": "Ostbayerische|OTH",
    },
    "lmu": {
        "label": "LMU München",
        # Munich and its south-western/northern fringes: the Stammgelände is in Maxvorstadt, but
        # LMU faculties are known to sit well outside the Altstadt ring, so the box has to be wide
        # enough for the probe to FIND them rather than confirm the ones already thought of.
        "wide": {"west": 11.30, "east": 11.72, "south": 48.05, "north": 48.32},
        "match": "Ludwig-Maximilians|LMU",
        "operator": "Ludwig-Maximilians|LMU",
    },
}


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


def dump(site: str, name: str, payload: dict | list) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{site}-probe-{name}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def stage_sites(site: str, cfg: dict) -> None:
    """Which OSM features claim to be this university, and where are they?"""
    b = box(cfg["wide"])
    query = f"""
    [out:json][timeout:240];
    (
      nwr["amenity"="university"]({b});
      nwr["operator"~"{cfg['operator']}",i]({b});
      nwr["name"~"{cfg['match']}",i]({b});
    );
    out tags center;
    """
    data = overpass(query)
    print(f"raw -> {dump(site, 'sites', data)}")

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
            }
        )

    # Only the rows that actually name THIS university. Everything else in the dump is context —
    # in a city with several universities, "amenity=university" is not an identification.
    import re

    pattern = re.compile(cfg["match"], re.IGNORECASE)
    mine = [r for r in rows if pattern.search(r["name"]) or pattern.search(r["operator"])]

    print(f"\n{len(rows)} university-ish features in the wide box, {len(mine)} of them {cfg['label']}\n")
    for r in sorted(mine, key=lambda r: (r["lat"], r["lon"])):
        print(
            f"  {r['type']:8} {r['id']:<12} {r['lat']:.5f},{r['lon']:.5f}  "
            f"{r['name'][:55]:<55} | {r['amenity']:<10} | {r['street']}"
        )

    if len(mine) >= 2:
        print("\nseparations over 300 m (this is what decides the AOI):")
        seen: set[tuple[int, int]] = set()
        for i, a in enumerate(mine):
            for bb in mine[i + 1 :]:
                key = (min(a["id"], bb["id"]), max(a["id"], bb["id"]))
                if key in seen:
                    continue
                seen.add(key)
                d = haversine_m((a["lat"], a["lon"]), (bb["lat"], bb["lon"]))
                if d > 300:
                    print(f"  {a['name'][:32]:<32} <-> {bb['name'][:32]:<32} {d / 1000:6.2f} km")


def stage_detail(site: str, bounds: dict[str, float], label: str) -> None:
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
    print(f"raw -> {dump(site, f'detail-{label}', data)}")
    for el in data.get("elements", []):
        if el.get("type") == "count":
            t = el.get("tags", {})
            print(
                f"\n{label}: total={t.get('total')} nodes={t.get('nodes')} "
                f"ways={t.get('ways')} relations={t.get('relations')}"
            )


def stage_indoor(site: str, bounds: dict[str, float], label: str) -> None:
    """The decisive question for room-level analytics: is there indoor mapping here?"""
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
    print(f"raw -> {dump(site, f'indoor-{label}', data)}")
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
    for el in els[:25]:
        t = el.get("tags", {})
        print(f"    ref={t.get('ref', '-')!s:<12} name={t.get('name', '-')!s:<34} level={t.get('level', '-')}")


def stage_aoi(site: str, bounds: dict[str, float]) -> None:
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
        query = f"[out:json][timeout:240];({body});out count;"
        data = overpass(query)
        total = "?"
        for el in data.get("elements", []):
            if el.get("type") == "count":
                total = el.get("tags", {}).get("total", "?")
        results[name] = total
        print(f"  {name:<22} {total}")
        time.sleep(3)
    dump(site, "aoi-counts", results)


def stage_bounds(site: str, ids: list[str]) -> None:
    """True extent of named OSM features — turns a guessed campus box into a measured one.

    ⚠️ `out geom;`, never `out tags geom;` — the latter returns relations with ZERO members, which
    silently hides exactly the large multi-part campus outlines this stage exists to measure.
    """
    parts = []
    for raw in ids:
        kind, _, oid = raw.partition("/")
        parts.append(f"{kind}({oid});")
    query = f"[out:json][timeout:240];({''.join(parts)});out geom;"
    data = overpass(query)
    print(f"raw -> {dump(site, 'bounds', data)}")
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


def stage_ele(site: str, bounds: dict[str, float]) -> None:
    """Candidate control points for the registration gate."""
    b = box(bounds)
    query = f"""
    [out:json][timeout:180];
    node["ele"]({b});
    out tags center;
    """
    data = overpass(query)
    print(f"raw -> {dump(site, 'ele', data)}")
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
    parser.add_argument("--site", default="lmu", choices=sorted(PROBE_SITES))
    parser.add_argument(
        "--stage", required=True, choices=["sites", "detail", "indoor", "aoi", "bounds", "ele"]
    )
    parser.add_argument("--ids", nargs="*", default=[], help="e.g. relation/1733231 way/28938080")
    parser.add_argument("--west", type=float)
    parser.add_argument("--east", type=float)
    parser.add_argument("--south", type=float)
    parser.add_argument("--north", type=float)
    parser.add_argument("--label", default="box")
    args = parser.parse_args()

    cfg = PROBE_SITES[args.site]
    bounds = dict(cfg["wide"])
    for key in ("west", "east", "south", "north"):
        if getattr(args, key) is not None:
            bounds[key] = getattr(args, key)

    if args.stage == "sites":
        stage_sites(args.site, cfg)
    elif args.stage == "detail":
        stage_detail(args.site, bounds, args.label)
    elif args.stage == "indoor":
        stage_indoor(args.site, bounds, args.label)
    elif args.stage == "aoi":
        stage_aoi(args.site, bounds)
    elif args.stage == "bounds":
        stage_bounds(args.site, args.ids)
    else:
        stage_ele(args.site, bounds)


if __name__ == "__main__":
    main()

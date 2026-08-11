"""Resolve a candidate second site from OpenStreetMap, before any of it is written into config.

PLAN §4.2 and the hard rule behind it: **no coordinate enters config without being looked up.** That
rule exists because the Oberstdorf AOI shipped for a while built around a place node 4.6 km from the
town, and the thing that caught it was the terrain putting that point at 1115 m against a published
813 m.

So this asks Overpass what is actually in a candidate box — the mountain, the cable car, the castles
the site is famous for, and the flying sites — and prints coordinates and elevations. The bbox in
`config/aoi/tegelberg.json` is then built around what came back, not around what anyone remembers.

Usage
  python tools/geodata/probe_site.py
  python tools/geodata/probe_site.py --west 10.68 --east 10.80 --south 47.53 --north 47.61
"""

from __future__ import annotations

import argparse
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request

OVERPASS = "https://overpass-api.de/api/interpreter"
USER_AGENT = "Gleitschirm-Insights/0.1 (open geodata pipeline; +https://overpass-api.de)"


def overpass(query: str, attempts: int = 4) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=180) as response:  # noqa: S310 - fixed host
                return json.loads(response.read())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last = exc
            # Overpass is free, shared and donation-funded, and it rate-limits hard. One query per
            # run and a long backoff is the price of being welcome back.
            wait = 15 * (attempt + 1)
            print(f"  attempt {attempt + 1} failed ({exc}) — retrying in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"Overpass failed after {attempts} attempts: {last}")


def centre(element: dict) -> tuple[float, float] | None:
    if "lat" in element and "lon" in element:
        return element["lat"], element["lon"]
    if "center" in element:
        return element["center"]["lat"], element["center"]["lon"]
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    # A generous first look around Schwangau. Deliberately wider than any AOI would be: the point is
    # to find out where things are, not to confirm a box already decided on.
    parser.add_argument("--west", type=float, default=10.66)
    parser.add_argument("--east", type=float, default=10.82)
    parser.add_argument("--south", type=float, default=47.51)
    parser.add_argument("--north", type=float, default=47.63)
    args = parser.parse_args()

    box = f"{args.south},{args.west},{args.north},{args.east}"
    query = f"""
    [out:json][timeout:180];
    (
      node["natural"="peak"]({box});
      node["place"~"^(town|village|hamlet)$"]({box});
      way["aerialway"~"^(cable_car|gondola|mixed_lift)$"]({box});
      node["aerialway"="station"]({box});
      way["historic"="castle"]({box});
      relation["historic"="castle"]({box});
      node["tourism"="attraction"]["name"~"Neuschwanstein|Hohenschwangau"]({box});
      node["site"="takeoff"]({box});
      way["site"="takeoff"]({box});
      node["aeroway"="takeoff"]({box});
      way["aeroway"="landing"]({box});
      node["sport"="free_flying"]({box});
      way["sport"="free_flying"]({box});
    );
    out center tags;
    """

    print(f"probing {args.west}–{args.east} E, {args.south}–{args.north} N …")
    data = overpass(query)
    elements = data.get("elements", [])
    print(f"{len(elements)} elements\n")

    groups: dict[str, list[dict]] = {}
    for element in elements:
        tags = element.get("tags", {})
        if tags.get("natural") == "peak":
            key = "peaks"
        elif tags.get("place"):
            key = "settlements"
        elif tags.get("aerialway") in ("cable_car", "gondola", "mixed_lift"):
            key = "cableways"
        elif tags.get("aerialway") == "station":
            key = "aerialway stations"
        elif tags.get("historic") == "castle" or "Neuschwanstein" in tags.get("name", "") or "Hohenschwangau" in tags.get("name", ""):
            key = "castles"
        else:
            key = "flying sites"
        groups.setdefault(key, []).append(element)

    interesting: list[tuple[float, float, str]] = []

    for key in ("peaks", "settlements", "cableways", "aerialway stations", "castles", "flying sites"):
        items = groups.get(key, [])
        if not items:
            print(f"=== {key}: none")
            continue
        print(f"=== {key} ({len(items)})")
        for element in sorted(items, key=lambda e: e.get("tags", {}).get("name", "zzz")):
            tags = element.get("tags", {})
            name = tags.get("name") or tags.get("ref") or "(unnamed)"
            point = centre(element)
            if not point:
                continue
            lat, lon = point
            ele = tags.get("ele", "")
            extra = f"  {ele} m" if ele else ""
            print(f"  {name:<38} {lat:.7f} {lon:.7f}{extra}   {element['type']}/{element['id']}")
            if name != "(unnamed)":
                interesting.append((lat, lon, name))
        print()

    # What box would actually be needed to hold the named things found?
    if interesting:
        lats = [p[0] for p in interesting]
        lons = [p[1] for p in interesting]
        mid = (min(lats) + max(lats)) / 2
        width = (max(lons) - min(lons)) * 111.320 * math.cos(math.radians(mid))
        depth = (max(lats) - min(lats)) * 111.130
        print("=" * 74)
        print(f"everything named sits inside {min(lons):.4f}–{max(lons):.4f} E, {min(lats):.4f}–{max(lats):.4f} N")
        print(f"  which is {width:.1f} × {depth:.1f} km")
        print("\n⚠️ That is the *extent of what was found*, not a proposed AOI. A core box is chosen")
        print("   around the subject; the shell is what stops a cross-country flight running off the")
        print("   edge of the map. Both still have to be decided deliberately.")


if __name__ == "__main__":
    main()

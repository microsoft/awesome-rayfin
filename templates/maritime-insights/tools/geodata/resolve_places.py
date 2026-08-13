"""Resolve the AOI's places from OpenStreetMap — verified, never recalled.

PLAN §4.4. In the sibling repo an AOI shipped for a while with a place node 4.6 km from the town it
named, and what caught it was the terrain: the heightmap put that point 300 m above the published
elevation. The rule that came out of it is absolute — **no coordinate enters config/aoi/*.json
without a query whose result a human has looked at.**

For a coastal AOI there is a second, stronger check available, and it is free: **ships are in the
water.** Any AIS track that lands on rendered land means the terrain, the coastline or the
projection is wrong. That check belongs in verify_registration.py; this script only resolves the
places, the seamark lights (whose published elevations are the vertical check) and the coastline.

Output goes to data/osm/<aoi>/places.json for inspection. It is deliberately NOT written straight
into the AOI config: a coordinate becomes canonical when a human has looked at it.

Usage
  python tools/geodata/resolve_places.py
  python tools/geodata/resolve_places.py --bbox 54.30 10.05 54.47 10.30
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

# 🔴 Measured 2026-07-29, and this is a TRAP worth keeping: `overpass.osm.ch` answers fast and with
# HTTP 200 — and returns ZERO elements for a German bbox, because it is the SWISS instance and only
# carries a regional extract. A reachability probe therefore says "OK" while the data is silently
# absent. Any mirror list must be validated with a query whose answer is known to be non-empty, and
# a zero-element response has to be treated as a failure worth retrying elsewhere, never as a fact.
MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
USER_AGENT = "Maritime-Insights/0.1 (open geodata pipeline)"

# Generous first-pass window. The core bbox is chosen AFTER seeing where the places actually are —
# that order matters, and getting it the other way round is what produced the sibling repo's bug.
DEFAULT_BBOX = (54.30, 10.05, 54.47, 10.30)  # south, west, north, east


def overpass(query: str, attempts: int = 3) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for attempt in range(attempts):
        for mirror in MIRRORS:
            try:
                request = urllib.request.Request(
                    mirror, data=body, headers={"User-Agent": USER_AGENT}
                )
                with urllib.request.urlopen(request, timeout=180) as response:
                    payload = json.loads(response.read())
                    # An empty answer is not an answer — see the MIRRORS note. A regional mirror
                    # returns 200 with nothing in it, which would otherwise be recorded as "this
                    # AOI has no places".
                    if not payload.get("elements"):
                        raise RuntimeError("returned zero elements (regional mirror?)")
                    print(f"  (answered by {urllib.parse.urlparse(mirror).netloc})")
                    return payload
            except Exception as exc:  # noqa: BLE001
                last = exc
                print(f"  {urllib.parse.urlparse(mirror).netloc}: {exc}")
        wait = 20 * (attempt + 1)
        print(f"  all mirrors failed — retrying in {wait}s")
        time.sleep(wait)
    raise RuntimeError(f"Overpass failed: {last}")


def centre(element: dict) -> tuple[float, float] | None:
    if element["type"] == "node":
        return element["lat"], element["lon"]
    c = element.get("center")
    return (c["lat"], c["lon"]) if c else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--bbox", nargs=4, type=float, metavar=("S", "W", "N", "E"),
                        default=list(DEFAULT_BBOX))
    args = parser.parse_args()
    s, w, n, e = args.bbox
    box = f"{s},{w},{n},{e}"

    # ONE combined query. Overpass is free, shared and donation-funded; four quick separate
    # queries earn an immediate 429 and deserve to.
    query = f"""
    [out:json][timeout:180];
    (
      node["place"~"city|town|village|hamlet|suburb|quarter|island"]({box});
      node["seamark:type"="light_major"]({box});
      node["seamark:type"="light_minor"]({box});
      node["man_made"="lighthouse"]({box});
      node["seamark:type"="harbour"]({box});
      way["seamark:type"="lock_basin"]({box});
      node["amenity"="ferry_terminal"]({box});
      way["amenity"="ferry_terminal"]({box});
    );
    out center tags;
    """
    print(f"querying Overpass for {box}")
    data = overpass(query)
    elements = data.get("elements", [])
    print(f"  {len(elements)} elements")

    groups: dict[str, list[dict]] = {}
    for element in elements:
        point = centre(element)
        if not point:
            continue
        tags = element.get("tags", {})
        if tags.get("place"):
            group = f"place:{tags['place']}"
        elif tags.get("seamark:type", "").startswith("light") or tags.get("man_made") == "lighthouse":
            group = "light"
        elif tags.get("amenity") == "ferry_terminal":
            group = "ferry"
        else:
            group = tags.get("seamark:type", "other")
        record = {
            "id": f"{element['type']}/{element['id']}",
            "name": tags.get("name") or tags.get("seamark:name") or "(unnamed)",
            "lat": round(point[0], 7),
            "lon": round(point[1], 7),
        }
        # Published elevations are the vertical registration check — keep every one offered.
        for key in ("ele", "seamark:light:height", "height", "seamark:light:range",
                    "seamark:light:character", "population"):
            if key in tags:
                record[key.replace("seamark:light:", "light_")] = tags[key]
        groups.setdefault(group, []).append(record)

    for group in sorted(groups):
        rows = sorted(groups[group], key=lambda r: r["name"])
        print(f"\n=== {group} ({len(rows)}) ===")
        for row in rows:
            extra = " ".join(f"{k}={v}" for k, v in row.items()
                             if k not in ("id", "name", "lat", "lon"))
            print(f"  {row['name']:<34} {row['lat']:.5f},{row['lon']:.5f}  {extra}")

    out = Path("data/osm") / args.aoi / "places.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"bbox": {"south": s, "west": w, "north": n, "east": e},
                    "queriedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "groups": groups}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\nwritten to {out}")


if __name__ == "__main__":
    main()

"""Resolve AOI place coordinates from OpenStreetMap — verified, never recalled.

PLAN §4.2. A recalled coordinate for Oberstdorf in an earlier draft was 4.4 km off, which would
have framed the camera on the wrong valley. This script is the antidote: every coordinate that
enters config/aoi/*.json comes out of a query whose result you can inspect.

It also answers PLAN §4.2's open questions, which are explicitly deferred to "resolve from
Overpass — not invented":

  * the Nebelhornbahn's actual `aerialway=station` nodes, rather than the ticket office beside one
  * the paragliding launch sites and the official landing zone
  * the cable-car line geometry for §5.7

Output is printed for inspection and written to data/osm/<aoi>/places.json. It is deliberately
NOT written straight into the AOI config: a coordinate becomes canonical when a human has looked
at it, which is the whole point.

Usage
  python tools/geodata/resolve_places.py
  python tools/geodata/resolve_places.py --name Oberstdorf
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request

from aoi import bbox_tuple, cache_dir, load_aoi

OVERPASS = "https://overpass-api.de/api/interpreter"
USER_AGENT = "Gleitschirm-Insights/0.1 (open geodata pipeline)"


def overpass(query: str, attempts: int = 4) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                OVERPASS, data=body, headers={"User-Agent": USER_AGENT}
            )
            with urllib.request.urlopen(request, timeout=240) as response:
                return json.loads(response.read())
        except Exception as exc:  # noqa: BLE001
            last = exc
            # ⚠️ Overpass is a free, shared, donation-funded service and it rate-limits hard: four
            # separate queries in quick succession earned an immediate HTTP 429. Hence ONE combined
            # query per run, a cached response, and a long backoff. Being impolite to Overpass is
            # both rude and self-defeating.
            wait = 15 * (attempt + 1)
            print(f"  Overpass attempt {attempt + 1} failed ({exc}) — retrying in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"Overpass failed after {attempts} attempts: {last}")


def centre_of(element: dict) -> tuple[float, float] | None:
    if element["type"] == "node":
        return element["lat"], element["lon"]
    centre = element.get("center")
    if centre:
        return centre["lat"], centre["lon"]
    return None


def report(title: str, elements: list[dict], limit: int = 25) -> list[dict]:
    print(f"\n=== {title} ({len(elements)}) ===")
    rows = []
    for element in elements[:limit]:
        point = centre_of(element)
        if not point:
            continue
        tags = element.get("tags", {})
        name = tags.get("name") or tags.get("ref") or "(unnamed)"
        kind = ", ".join(
            f"{k}={v}"
            for k, v in tags.items()
            if k
            in {
                "place",
                "aerialway",
                "natural",
                "sport",
                "leisure",
                "aeroway",
                "tourism",
                "ele",
                "operator",
            }
        )
        print(f"  {element['type']}/{element['id']:>12}  {point[0]:.7f}  {point[1]:.7f}  {name}  [{kind}]")
        rows.append(
            {
                "osmType": element["type"],
                "osmId": element["id"],
                "name": name,
                "lat": round(point[0], 7),
                "lon": round(point[1], 7),
                "tags": tags,
            }
        )
    if len(elements) > limit:
        print(f"  ... {len(elements) - limit} more")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument("--force", action="store_true", help="re-query Overpass instead of using the cache")
    parser.add_argument("--filter", default=None, help="only report entries whose name contains this")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    south, west, north, east = bbox_tuple(cfg, "shell")
    box = f"{south},{west},{north},{east}"

    cache = cache_dir("osm", cfg["id"]) / "overpass_places.json"
    if cache.exists() and not args.force:
        print(f"using cached Overpass response: {cache}")
        data = json.loads(cache.read_text(encoding="utf-8"))
    else:
        print(f"querying Overpass for the shell box {box}")
        # One query, several statements. Everything this script needs comes back in a single
        # response, which is both far kinder to the service and much faster.
        data = overpass(
            f"""[out:json][timeout:240];
            (
              node["place"~"^(city|town|village|hamlet)$"]({box});
              node["aerialway"="station"]({box});
              way["aerialway"~"^(cable_car|gondola|chair_lift)$"]({box});
              node["natural"="peak"]["ele"]({box});
              node["sport"="free_flying"]({box});
              way["sport"="free_flying"]({box});
              node["paragliding"]({box});
              way["paragliding"]({box});
              way["aeroway"="airstrip"]({box});
            );
            out body center;"""
        )
        cache.write_text(json.dumps(data), encoding="utf-8")
        print(f"cached {len(data['elements'])} elements to {cache}")

    elements = data["elements"]
    if args.filter:
        needle = args.filter.casefold()
        elements = [
            e for e in elements if needle in str(e.get("tags", {}).get("name", "")).casefold()
        ]
        print(f"filtered to {len(elements)} elements matching '{args.filter}'")

    def tagged(predicate) -> list[dict]:  # type: ignore[no-untyped-def]
        return [e for e in elements if predicate(e.get("tags", {}))]

    results: dict[str, list[dict]] = {}

    # Settlements. A `place` node is the label point a map renderer uses, which is what we want for
    # framing the camera — not the centroid of the municipality's administrative area, which for an
    # Alpine municipality can sit several kilometres away up a valley.
    results["settlements"] = report(
        "settlements (place nodes)",
        sorted(tagged(lambda t: "place" in t), key=lambda e: e.get("tags", {}).get("name", "")),
        limit=200 if args.filter else 15,
    )

    results["aerialway"] = report(
        "aerialway stations and lines",
        tagged(lambda t: "aerialway" in t),
        limit=200 if args.filter else 15,
    )

    # Named peaks, sorted by published elevation. These are the independent check for the
    # registration proof in §7 step 7: a summit elevation published by someone else is the only
    # thing that can tell us our terrain model is in the right place.
    def elevation(element: dict) -> float:
        raw = str(element.get("tags", {}).get("ele", "")).replace(",", ".").split()
        try:
            return float(raw[0]) if raw else 0.0
        except ValueError:
            return 0.0

    results["peaks"] = report(
        "named peaks with published elevations",
        sorted(tagged(lambda t: t.get("natural") == "peak"), key=elevation, reverse=True),
        limit=200 if args.filter else 20,
    )

    # Free-flying sites. OSM tags these inconsistently, so the query is deliberately broad and the
    # results are reported for a human to choose from rather than picked automatically.
    results["freeFlying"] = report(
        "free-flying sites",
        tagged(
            lambda t: t.get("sport") == "free_flying"
            or "paragliding" in t
            or t.get("aeroway") == "airstrip"
        ),
        limit=60,
    )

    destination = cache_dir("osm", cfg["id"]) / "places.json"
    destination.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {destination}")


if __name__ == "__main__":
    main()

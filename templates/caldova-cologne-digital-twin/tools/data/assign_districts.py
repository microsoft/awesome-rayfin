"""Assign every Caldova pharmacy to its real Cologne city district (Stadtbezirk).

The nine Stadtbezirke are the "regions" of the regional-manager view (the RegionalManager role of
the original Caldova model). Boundaries come from OpenStreetMap (boundary=administrative,
admin_level=9, the nine official names); the managers are fictional.

Writes `data/operations/<aoi>/stores.json`: one row per pharmacy with store_id (= pharmacyId),
fictional name, city, region (Stadtbezirk), a fictional manager_upn per district and a seeded
store_factor for the stock generator.

Usage:  python tools/data/assign_districts.py --aoi koeln-messe
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.request
from pathlib import Path

from shapely.geometry import LineString, Point
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parents[2]
MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
HEADERS = {"User-Agent": "caldova-cologne-digital-twin/0.1 (digital twin demo)", "Content-Type": "text/plain; charset=utf-8"}

#: The nine official city districts of Cologne, with the slug used for the fictional manager address.
DISTRICTS = {
    "Innenstadt": "innenstadt", "Rodenkirchen": "rodenkirchen", "Lindenthal": "lindenthal",
    "Ehrenfeld": "ehrenfeld", "Nippes": "nippes", "Chorweiler": "chorweiler",
    "Porz": "porz", "Kalk": "kalk", "Mülheim": "muelheim",
}


def overpass(query: str) -> dict:
    last = None
    for mirror in MIRRORS:
        for attempt in range(4):
            try:
                req = urllib.request.Request(mirror, data=query.encode("utf-8"), headers=HEADERS)
                with urllib.request.urlopen(req, timeout=300) as r:  # noqa: S310
                    data = json.loads(r.read().decode("utf-8"))
                if len(data.get("elements", [])) < 9:
                    raise RuntimeError(f"only {len(data.get('elements', []))} boundaries")
                return data
            except Exception as exc:  # noqa: BLE001
                last = exc
                print(f"  {mirror.split('/')[2]} attempt {attempt + 1}: {exc}", file=sys.stderr)
                time.sleep(10 * (attempt + 1))
    raise SystemExit(f"Overpass failed: {last}")


def unit(key: str) -> float:
    return int(hashlib.sha256(key.encode()).hexdigest()[:12], 16) / 0xFFFFFFFFFFFF


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default="koeln-messe")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    cfg = json.loads((ROOT / "config" / "aoi" / f"{args.aoi}.json").read_text(encoding="utf-8"))
    seed = int(cfg["site3d"]["seed"])

    cache = ROOT / "data" / "osm" / args.aoi / "stadtbezirke_raw.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists() and not args.force:
        raw = json.loads(cache.read_text(encoding="utf-8"))
    else:
        names = "|".join(DISTRICTS)
        raw = overpass(
            f'[out:json][timeout:180];relation["boundary"="administrative"]["admin_level"="9"]'
            f'["name"~"^({names})$"](50.83,6.77,51.09,7.17);out geom;'
        )
        cache.write_text(json.dumps(raw), encoding="utf-8")

    polygons = {}
    for rel in raw["elements"]:
        tags = rel.get("tags", {})
        name = tags.get("name")
        if name not in DISTRICTS or name in polygons:
            continue
        # Same-named level-9 units exist elsewhere in the box; Cologne's carry the regional key 05315.
        key = tags.get("de:regionalschluessel") or tags.get("de:amtlicher_gemeindeschluessel") or ""
        if key and not key.startswith("05315"):
            continue
        lines = [
            LineString([(g["lon"], g["lat"]) for g in m["geometry"]])
            for m in rel.get("members", [])
            if m.get("type") == "way" and m.get("role") in ("outer", "") and len(m.get("geometry", [])) >= 2
        ]
        polys = list(polygonize(unary_union(lines)))
        if not polys:
            raise SystemExit(f"{name}: boundary did not close into a polygon")
        polygons[name] = unary_union(polys)
    missing = set(DISTRICTS) - set(polygons)
    if missing:
        raise SystemExit(f"Stadtbezirke not found in OSM: {sorted(missing)}")

    pharm = json.loads((ROOT / "data" / "operations" / args.aoi / "pharmacies.json").read_text(encoding="utf-8"))["pharmacies"]
    stores, unassigned = [], []
    for p in pharm:
        pt = Point(p["lon"], p["lat"])
        district = next((n for n, poly in polygons.items() if poly.contains(pt)), None)
        inside = district is not None
        if district is None:
            # Just outside Cologne (Leverkusen, Bergisch Gladbach …) within the 6 km ring: nearest district.
            district = min(polygons, key=lambda n: polygons[n].distance(pt))
            unassigned.append(p["pharmacyId"])
        stores.append({
            "store_id": p["pharmacyId"],
            "name": p["name"],
            "city": "Köln",
            "region": district,
            "manager_upn": f"leitung.{DISTRICTS[district]}@caldova.demo",
            "store_factor": round(0.82 + 0.40 * unit(f"{seed}:store_factor:{p['pharmacyId']}"), 3),
            "inCityBoundary": inside,
        })
    out = ROOT / "data" / "operations" / args.aoi / "stores.json"
    out.write_text(json.dumps({
        "provenance": "district boundaries measured (OpenStreetMap admin_level 9); managers and store factors fictional",
        "attribution": "© OpenStreetMap contributors, ODbL 1.0",
        "stores": stores,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    from collections import Counter  # noqa: PLC0415

    print(f"{len(stores)} stores -> {out}")
    for name, n in Counter(s["region"] for s in stores).most_common():
        print(f"  {name:<14} {n}")
    if unassigned:
        print(f"  {len(unassigned)} outside the city boundary, given the nearest district: {unassigned}")


if __name__ == "__main__":
    main()

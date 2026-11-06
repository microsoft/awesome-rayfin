"""Fetch the real pharmacy LOCATIONS in the delivery region from OpenStreetMap (Caldova Cologne).

⚠️ CALDOVA RULE: only the COORDINATES are used. A seeded sample of ~120 locations gets FICTIONAL
names ("Caldova Partner Pharmacy 017"); no OSM name, address or id leaves this script except the raw
Overpass cache under data/ (gitignored, never bundled).


These are the drop points. They are the one part of the last-mile model that is entirely REAL:
`amenity=pharmacy` is one of the best-maintained tags in OSM in Germany, and a full-line pharmaceutical
wholesaler's customer base is exactly this: independent pharmacies across a region.

⚠️ WHAT THIS DOES NOT KNOW. OSM says a pharmacy exists at a coordinate. It does NOT say who supplies
it, how often, or with what. Nothing downstream may claim that a pharmacy on this map is a customer
of any real wholesaler: the tours are a plausible model of how a distribution centre of this size
serves a region of this shape, drawn over real locations, and the UI says so. Drawing an invented
commercial relationship onto a named real business is precisely the line this project does not cross.

⚠️ OVERPASS 504s ON LARGE REGIONS. The public instance times out on big boxes regularly, so the query
is quadrant-split with backoff across two mirrors (the documented remedy in this codebase). `out
center` is used rather than `out geom`: a pharmacy is a point of delivery, not a shape, and asking for
geometry on hundreds of features is what turns a 5-second query into a 504.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "geodata"))

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

#: ⚠️ WITHOUT THIS, overpass-api.de ANSWERS 406 Not Acceptable — EVERY TIME, ON EVERY QUERY.
#: It reads exactly like the service refusing the query, so the first run of this script fell back
#: to the slow mirror on all nine quadrants and took minutes per tile while the fast mirror was
#: sitting there perfectly healthy. The public instance simply declines requests that do not
#: identify themselves. A contact address is the documented courtesy for a scripted client.
HEADERS = {
    "Content-Type": "text/plain; charset=utf-8",
    "User-Agent": "caldova-cologne-digital-twin/0.1 (digital twin demo; contact via repository)",
    "Accept": "application/json",
}


def overpass(query: str) -> dict:
    """POST a query, trying each mirror three times with growing backoff."""
    last: Exception | None = None
    body = query.encode("utf-8")
    for mirror in MIRRORS:
        host = mirror.split("/")[2]
        for attempt in range(3):
            try:
                req = urllib.request.Request(mirror, data=body, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=180) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except Exception as exc:  # noqa: BLE001
                last = exc
                print(f"    {host} attempt {attempt + 1}: {exc}", file=sys.stderr)
                time.sleep(4 + 4 * attempt)
    raise SystemExit(f"Overpass failed on every mirror: {last}")


def haversine_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = p2 - p1
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def split(box: tuple[float, float, float, float], n: int) -> list[tuple[float, float, float, float]]:
    """Split a bbox into an n x n grid. One query over the whole region reliably 504s."""
    s, w, north, e = box
    out = []
    for i in range(n):
        for j in range(n):
            out.append(
                (
                    s + (north - s) * i / n,
                    w + (e - w) * j / n,
                    s + (north - s) * (i + 1) / n,
                    w + (e - w) * (j + 1) / n,
                )
            )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aoi", default="koeln-messe")
    ap.add_argument("--radius-km", type=float, default=None, help="delivery region radius (default: site3d.pharmacies.radiusKm)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    from aoi import load_aoi  # noqa: E402  (path set above)

    cfg = load_aoi(args.aoi)
    hub = next(p for p in cfg["focusPlaces"] if p.get("kind") == "hero")
    spec = cfg["site3d"]["pharmacies"]
    if args.radius_km is None:
        args.radius_km = float(spec["radiusKm"])
    hub_lat, hub_lon = hub["lat"], hub["lon"]

    # A degree of latitude is ~111.32 km; a degree of longitude shrinks with the cosine.
    dlat = args.radius_km / 111.32
    dlon = args.radius_km / (111.32 * math.cos(math.radians(hub_lat)))
    box = (hub_lat - dlat, hub_lon - dlon, hub_lat + dlat, hub_lon + dlon)

    cache_dir = ROOT / "data" / "osm" / cfg["id"]
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache = cache_dir / "pharmacies_raw.json"

    if cache.exists() and not args.force:
        print(f"using cached Overpass response: {cache}")
        elements = json.loads(cache.read_text(encoding="utf-8"))["elements"]
    else:
        print(f"hub {hub['name']} at {hub_lat},{hub_lon}")
        print(f"delivery region {args.radius_km} km -> bbox {box[0]:.4f},{box[1]:.4f} .. {box[2]:.4f},{box[3]:.4f}")
        elements = []
        seen: set[tuple[str, int]] = set()
        quads = split(box, 3)
        for i, (s, w, n, e) in enumerate(quads, 1):
            b = f"{s},{w},{n},{e}"
            print(f"[{i}/{len(quads)}] {b}")
            data = overpass(
                f"""[out:json][timeout:120];
                (
                  node["amenity"="pharmacy"]({b});
                  way["amenity"="pharmacy"]({b});
                );
                out center tags;"""
            )
            fresh = 0
            for el in data.get("elements", []):
                key = (el["type"], el["id"])
                if key in seen:
                    continue
                seen.add(key)
                elements.append(el)
                fresh += 1
            print(f"    +{fresh} (total {len(elements)})")
        cache.write_text(json.dumps({"elements": elements}), encoding="utf-8")

    located = []
    for el in elements:
        centre = el.get("center") or {"lat": el.get("lat"), "lon": el.get("lon")}
        lat, lon = centre.get("lat"), centre.get("lon")
        if lat is None or lon is None:
            continue
        km = haversine_km(hub_lat, hub_lon, lat, lon)
        if km > args.radius_km:
            continue  # the bbox is a square, the region is a circle
        located.append((f"{el['type']}/{el['id']}", round(lat, 6), round(lon, 6), round(km, 3)))

    # ⚠️ A SEEDED SAMPLE, ORDERED BY A HASH OF THE OSM ID — not "the nearest 120", which would pack
    # every drop into Deutz, and not Python's random, whose stream shifts if anything else draws.
    import hashlib  # noqa: PLC0415
    seed = int(cfg["site3d"]["seed"])
    located.sort(key=lambda r: hashlib.sha256(f"{seed}:pharmacy:{r[0]}".encode()).hexdigest())
    chosen = sorted(located[: int(spec["count"])], key=lambda r: r[3])
    rows = []
    for i, (_osm, lat, lon, km) in enumerate(chosen, 1):
        rows.append(
            {
                "pharmacyId": f"P{i:03d}",
                "name": f"Caldova Partner Pharmacy {i:03d}",
                "lat": lat,
                "lon": lon,
                "distanceKm": km,
                "provenance": "location measured (OpenStreetMap), name and relationship fictional",
            }
        )

    rows.sort(key=lambda r: r["distanceKm"])

    out = ROOT / "data" / "operations" / cfg["id"]
    out.mkdir(parents=True, exist_ok=True)
    path = out / "pharmacies.json"
    payload = {
        "aoi": cfg["id"],
        "hub": {"id": hub["id"], "name": hub["name"], "lat": hub_lat, "lon": hub_lon},
        "radiusKm": args.radius_km,
        "provenance": "locations measured, names fictional",
        "source": "OpenStreetMap amenity=pharmacy (coordinates only)",
        "attribution": "© OpenStreetMap contributors, ODbL 1.0",
        "$note": (
            "Coordinates of real pharmacies, FICTIONAL names. Caldova is fictional; no "
            "real pharmacy is named or claimed as a customer."
        ),
        "locatedInRadius": len(located),
        "count": len(rows),
        "pharmacies": rows,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n{len(located)} real pharmacy locations within {args.radius_km} km; {len(rows)} sampled -> {path}")
    for band in (1, 2, 3, 4, 5, 6):
        n = sum(1 for r in rows if r["distanceKm"] <= band)
        print(f"  within {band} km: {n}")


if __name__ == "__main__":
    main()

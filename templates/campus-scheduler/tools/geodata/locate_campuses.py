"""Find each university's campuses in OpenStreetMap — and say plainly when it cannot.

PLAN §22.7/§22.8. The registry (`config/universities.json`) carries name, enrolment, city and state
but NOT geometry: the DESTATIS coordinates are CITY centroids, so all five TUM sites share central
München and Garching sits 16 km from its own point.

⚠️ THIS TOOL PROPOSES. IT DOES NOT DECIDE. It writes ranked candidates with the evidence for each,
and nothing downstream may build an AOI from a candidate that has not been confirmed. That is not
caution for its own sake — it is what the probe measured:

  * **Hamburg** — a substring match on the university's name reduces to "hambur" and then matches
    every school in the city: Katholische Schule Harburg, HAW Hamburg, Technologiezentrum
    Finkenwerder. **A university named after its city cannot be found by its city name.**
  * **Bochum** — DESTATIS calls it "Universität Bochum", OSM calls it "Ruhr-Universität Bochum".
    Zero name matches, and an unfiltered fallback then offered a Gesamtschule as the campus.

So candidates carry a `confidence` naming the evidence that produced them, and the weakest tier is
reported as needing review rather than silently used. **A fallback that returns something plausible
when the match found nothing is worse than an empty result** — the same defect shape as the vacuous
`propose_repairs` check and the unverified `demo_teacher` fallback recorded elsewhere in this repo.

Usage
  python tools/geodata/locate_campuses.py --limit 6        # propose for the six largest
  python tools/geodata/locate_campuses.py                  # all of them (slow; cached)
  python tools/geodata/locate_campuses.py --only "Köln"
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from overpass_client import overpass  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "config" / "universities.json"
OUT = ROOT / "config" / "campus-candidates.json"
CACHE = ROOT / "data" / "osm" / "campus"

#: Words that carry no institution-specific information. A token left after removing these is what
#: makes a name searchable; a name with nothing left (e.g. "Universität Bochum") is the hard case.
#:
#: ⚠️ NORMALISED THROUGH `norm()` BELOW, AND THE FIRST VERSION WAS NOT. `norm()` folds ä→a, so
#: "universität" became "universitat" and never matched this list — the single most generic word in
#: German higher education survived as a "distinctive" token and matched every university in the
#: country. Measured: TUM's best candidate came back as Ludwig-Maximilians-Universität, and FOM
#: Essen's as Universität Duisburg-Essen. A stopword list that does not share the normaliser it is
#: compared against is not a stopword list.
_STOP_RAW = {
    "universität", "universitaet", "university", "technische", "technischen", "hochschule",
    "hoch", "fachhochschule", "u", "tu", "th", "h", "fh", "priv", "in", "im", "der", "die", "das",
    "für", "fuer", "und", "von", "zu", "am", "an", "siehe", "ab", "ohne", "gesamthochschule",
    "ostbayerische", "freie", "duale", "medizinische", "sciences", "applied", "of", "campus",
    "institut", "institute", "fakultät", "klinikum", "management", "ökon", "oekon",
}

#: A campus is not a city. One `amenity=university` multipolygon can cover every site a university
#: owns — Hamburg's produced a 25 x 13 km "campus" — which is a fact about the institution, not a
#: box anything can be built from. Members larger than this are reported and excluded from extents.
MAX_CAMPUS_KM = 4.0

#: How far apart two education areas may be and still be called one campus, in km. Bigger than a
#: campus so a faculty across a street joins it; smaller than a city so Hamburg's sites stay apart.
CLUSTER_KM = 1.2


def norm(text: str) -> str:
    text = text.lower()
    for a, b in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
        text = text.replace(a, b)
    return re.sub(r"[^a-z0-9 ]", " ", text)


#: Built AFTER `norm` exists, and through it, so the two can never drift apart again.
STOP = {w for raw in _STOP_RAW for w in norm(raw).split()}


def tokens(name: str, city: str | None) -> set[str]:
    """Distinctive tokens: the name, minus generic words and minus its own city."""
    bad = set(STOP)
    if city:
        bad |= set(norm(city).split())
    return {t for t in norm(name).split() if len(t) > 2 and t not in bad}


def fetch_city(city: str) -> list[dict]:
    """Every `amenity=university` area in one city. Cached — Overpass 504s under repetition."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cache = CACHE / f"{re.sub(r'[^A-Za-z0-9]+', '_', city)}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    # ⚠️ `amenity=university` ONLY. `landuse=education` sweeps in every school in the city, which is
    # exactly how a Gesamtschule was offered as the Ruhr-Universität.
    query = f"""
[out:json][timeout:120];
area["name"="{city}"]["boundary"="administrative"]->.a;
(
  way["amenity"="university"](area.a);
  relation["amenity"="university"](area.a);
);
out tags bb;
"""
    data = overpass(query)
    els = [e for e in data.get("elements", []) if e.get("bounds")]
    cache.write_text(json.dumps(els, ensure_ascii=False), encoding="utf-8")
    time.sleep(1.0)
    return els


def cluster(areas: list[dict]) -> list[dict]:
    """Group areas into campuses by proximity, keeping each cluster's own bbox."""
    out: list[dict] = []
    for a in sorted(areas, key=lambda x: -area_km2(x)):
        b = a["bounds"]
        clat = (b["minlat"] + b["maxlat"]) / 2
        clon = (b["minlon"] + b["maxlon"]) / 2
        for c in out:
            dy = (clat - c["lat"]) * 110.54
            dx = (clon - c["lon"]) * 111.32 * math.cos(math.radians(clat))
            if math.hypot(dx, dy) <= CLUSTER_KM:
                c["members"].append(a)
                c["minlat"] = min(c["minlat"], b["minlat"])
                c["maxlat"] = max(c["maxlat"], b["maxlat"])
                c["minlon"] = min(c["minlon"], b["minlon"])
                c["maxlon"] = max(c["maxlon"], b["maxlon"])
                break
        else:
            out.append(
                {
                    "lat": clat, "lon": clon, "members": [a],
                    "minlat": b["minlat"], "maxlat": b["maxlat"],
                    "minlon": b["minlon"], "maxlon": b["maxlon"],
                }
            )
    return out


def area_km2(el: dict) -> float:
    b = el["bounds"]
    h = (b["maxlat"] - b["minlat"]) * 110.54
    w = (b["maxlon"] - b["minlon"]) * 111.32 * math.cos(math.radians((b["minlat"] + b["maxlat"]) / 2))
    return max(h, 0.0) * max(w, 0.0)


def score(cluster_: dict, want: set[str], official: str) -> tuple[str, str]:
    """Return (confidence, evidence). Confidence is the NAME OF THE EVIDENCE, not a number.

    ⚠️ THERE IS NO "BEST GUESS" TIER, DELIBERATELY. An earlier version ranked unmatched clusters by
    whether they carried a `wikidata` tag, which sounds like evidence and is not: it says the place
    is notable, not that it is THIS university. It confidently offered Hochschule München as the top
    candidate for both TUM and LMU, and Fachhochschule Aachen for RWTH. Unmatched clusters are now
    reported as unmatched, listing what is actually there so a human can choose.
    """
    names = [
        (m.get("tags", {}).get("name") or m.get("tags", {}).get("operator") or "").strip()
        for m in cluster_["members"]
    ]
    for m in cluster_["members"]:
        t = m.get("tags", {})
        blob = norm(f"{t.get('name', '')} {t.get('operator', '')}")
        if want and want & set(blob.split()):
            hit = sorted(want & set(blob.split()))
            return "name-token", f"matched {hit} in {t.get('name') or t.get('operator')!r}"
    here = ", ".join(n for n in names if n)[:120] or "(unnamed areas)"
    return (
        "review-unmatched",
        f"nothing in {official!r} matched a name here; this cluster contains: {here}",
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default=None)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    unis = reg["universities"]
    if args.only:
        unis = [u for u in unis if args.only.lower() in u["name"].lower()]
    if args.limit:
        unis = unis[: args.limit]

    results = []
    for u in unis:
        cities = sorted({s["city"] for s in u["sites"] if s.get("city")})
        want = tokens(u["name"], cities[0] if len(cities) == 1 else None)
        found: list[dict] = []
        oversized = 0
        for city in cities[:4]:
            try:
                areas = fetch_city(city)
            except Exception as exc:  # noqa: BLE001
                print(f"  !! {u['name'][:34]} / {city}: {type(exc).__name__}")
                continue
            # An institution-wide multipolygon is not a campus box — drop it from the extents and
            # count it, rather than letting one member define a 25 km "campus".
            usable = []
            for a in areas:
                b = a["bounds"]
                h = (b["maxlat"] - b["minlat"]) * 110.54
                w = (b["maxlon"] - b["minlon"]) * 111.32 * math.cos(math.radians(b["minlat"]))
                if max(h, w) > MAX_CAMPUS_KM:
                    oversized += 1
                    continue
                usable.append(a)
            for c in cluster(usable):
                conf, why = score(c, want, u["name"])
                found.append(
                    {
                        "city": city,
                        "confidence": conf,
                        "evidence": why,
                        "areas": len(c["members"]),
                        "km2": round(sum(area_km2(m) for m in c["members"]), 3),
                        "bbox": {
                            "south": c["minlat"], "west": c["minlon"],
                            "north": c["maxlat"], "east": c["maxlon"],
                        },
                        "widthKm": round((c["maxlon"] - c["minlon"]) * 111.32 * math.cos(math.radians(c["lat"])), 2),
                        "heightKm": round((c["maxlat"] - c["minlat"]) * 110.54, 2),
                    }
                )
        order = {"name-token": 0, "review-unmatched": 1}
        found.sort(key=lambda f: (order[f["confidence"]], -f["km2"]))
        results.append(
            {"key": u["key"], "name": u["name"], "students": u["students"],
             "aoi": u.get("aoi"), "tier": u.get("tier"), "candidates": found[:4]}
        )

        best = found[0]["confidence"] if found else "NONE"
        mark = {"name-token": "ok  ", "review-unmatched": "??  ", "NONE": "NONE"}[best]
        print(
            f"  {mark} {u['name'][:42]:<42} {len(found)} cluster(s), best={best}"
            + (f", {oversized} oversized dropped" if oversized else "")
        )
        if found:
            f = found[0]
            print(f"        {f['widthKm']} x {f['heightKm']} km @ {f['bbox']['south']:.4f},{f['bbox']['west']:.4f} — {f['evidence'][:88]}")

    confident = [r for r in results if r["candidates"] and r["candidates"][0]["confidence"] == "name-token"]
    none = [r for r in results if not r["candidates"]]
    print(
        f"\n{len(confident)} of {len(results)} matched on a distinctive name token; "
        f"{len(results) - len(confident) - len(none)} need review; {len(none)} found nothing."
    )
    print("⚠️  Nothing here is confirmed. No AOI may be built from a candidate that has not been reviewed.")

    args.out.write_text(
        json.dumps(
            {"$comment": "PROPOSALS ONLY — see locate_campuses.py. Confirm before building an AOI.",
             "generated": time.strftime("%Y-%m-%d"), "universities": results},
            ensure_ascii=False, indent=1,
        ),
        encoding="utf-8",
    )
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()

"""Build the national index: one dot per university, and the outline to place it on.

The dropdown does not scale and the twins do not either. Thirty universities is too many names
in a menu to choose from, and thirty BUILT twins is tens of gigabytes of terrain — so the app
needs a level of detail BELOW a twin: a map of the country with a dot per located campus, where
picking one is what loads it.

This writes two files:

  config/campus-index.json     the dots — id, name, city, state, centre, box, and whether a twin
                               exists for it yet
  config/germany-outline.json  the country border, so the dots read as a map rather than a scatter

⚠️ THE CENTRE IS THE CAMPUS, NOT THE CITY. `universities.json` carries a `cityPoint`, which is the
town hall and is up to several kilometres from the campus — Garching is 12 km from Munich's. Where
`campus-candidates.json` has resolved a real campus box from OpenStreetMap evidence, the dot is the
centre of the LARGEST such box. The city point is only a fallback, and entries that use it are
marked `centreFrom: "city"` so the map can be honest about which dots are precise.

⚠️ NOTHING IS INVENTED HERE. A university with no resolved campus and no city point is left out
rather than placed approximately: a dot on a map is a claim about where something is.

Source of the outline: Natural Earth 1:110m admin-0, public domain, via the natural-earth-vector
repository. Recorded in NOTICE.md.
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "config" / "universities.json"
CANDIDATES = ROOT / "config" / "campus-candidates.json"
AOI_DIR = ROOT / "config" / "aoi"
OUT_INDEX = ROOT / "config" / "campus-index.json"
OUT_OUTLINE = ROOT / "config" / "germany-outline.json"

# 1:50m rather than 1:110m. At 110m Germany is 58 points: the Alps, the Rhine bend and the whole
# Baltic coast collapse into straight lines, and a dot near a border can land visibly outside the
# country. Still only tens of kilobytes.
NE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_50m_admin_0_countries.geojson"
)


def usable_campuses(entry: dict) -> list[dict]:
    """The clusters the matcher accepted — neither too small to be a campus nor too wide to be one."""
    return [
        c
        for c in (entry.get("campuses") or [])
        if not c.get("tooSmall") and not c.get("tooWide")
    ]


def centre_of(box: dict) -> tuple[float, float]:
    return (
        (box["minLat"] + box["maxLat"]) / 2,
        (box["minLon"] + box["maxLon"]) / 2,
    )


def built_aoi_centres() -> dict[str, dict]:
    """The exact box of every AOI that has been built, keyed by its id.

    ⚠️ THIS BEATS BOTH OTHER SOURCES AND HAS TO BE CHECKED FIRST. A built twin's bbox was chosen
    by hand, argued for in its own `$comment`, and verified against published elevations by the
    pipeline's registration gate. Falling through to the city point instead puts TUM's dot on
    Munich's town hall — Garching is 12 km north of it — and the whole point of a map is that the
    dot is where the thing is.
    """
    out: dict[str, dict] = {}
    for path in sorted(AOI_DIR.glob("*.json")):
        aoi = json.loads(path.read_text("utf-8"))
        box = aoi.get("bbox") or {}
        if not all(k in box for k in ("west", "east", "south", "north")):
            continue
        out[aoi["id"]] = {
            "minLat": box["south"],
            "maxLat": box["north"],
            "minLon": box["west"],
            "maxLon": box["east"],
        }
    return out


def build_index() -> dict:
    reg = json.loads(REGISTRY.read_text("utf-8"))
    cand = json.loads(CANDIDATES.read_text("utf-8"))["results"]
    built = built_aoi_centres()

    dots: list[dict] = []
    skipped: list[dict] = []

    for u in reg["universities"]:
        uid = u["id"]
        entry = cand.get(uid) or {}
        kept = usable_campuses(entry)
        aoi_id = u.get("aoi")

        if aoi_id and aoi_id in built:
            bbox = built[aoi_id]
            lat, lon = centre_of(bbox)
            centre_from = "twin"
        elif kept:
            # The largest cluster is the main campus; the others are outposts. The dot marks the
            # main one, and `campusCount` says how many more there are.
            main = max(kept, key=lambda c: c["widthKm"] * c["heightKm"])
            lat, lon = centre_of(main["bbox"])
            centre_from = "campus"
            bbox = main["bbox"]
        else:
            point = None
            for site in u.get("sites") or []:
                if site.get("cityPoint"):
                    point = site["cityPoint"]
                    break
            if not point:
                skipped.append({"id": uid, "name": u["name"], "why": "no campus and no city point"})
                continue
            lat, lon = point["lat"], point["lon"]
            centre_from = "city"
            bbox = None

        dots.append(
            {
                "id": uid,
                "name": u["name"],
                # ⚠️ THE CITY THE EVIDENCE CAME FROM, not the one the registry records, where the
                # two disagree. `find_campus_areas.CITY_OVERRIDES` exists because DESTATIS puts
                # Universität Hohenheim in Ostfildern while the campus is in Stuttgart; the
                # candidate entry stores the city actually SEARCHED. Taking the registry's value
                # here put a dot 12 km away in Stuttgart under a panel reading "Ostfildern" — the
                # position fixed and the label still wrong, which is worse than both being wrong
                # together because it looks settled.
                #
                # The registry's value is kept rather than dropped: it is what the official source
                # says, and a reader comparing the two should not have to go and find that out.
                "city": entry.get("city") or u.get("city"),
                "cityPerRegistry": (
                    u.get("city")
                    if entry.get("city") and entry["city"] != u.get("city")
                    else None
                ),
                "state": u.get("state"),
                "students": u.get("students"),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "centreFrom": centre_from,
                "campusCount": len(kept),
                "bbox": bbox,
                # Present only when a full twin exists — this is what makes the dot enterable.
                "aoi": u.get("aoi"),
            }
        )

    dots.sort(key=lambda d: -(d.get("students") or 0))
    return {
        "$note": (
            "GENERATED by tools/data/build_campus_index.py — do not edit by hand. "
            "One dot per university. `centreFrom` says how precise the position is: "
            "`twin` is a built AOI's own verified box, `campus` a box resolved out of "
            "OpenStreetMap evidence, `city` only the town centre. `aoi` is set only "
            "where a built twin exists, and is what makes a dot enterable."
        ),
        "$skipped": skipped,
        "universities": dots,
    }


def build_outline() -> dict:
    with urllib.request.urlopen(NE_URL, timeout=120) as fh:
        world = json.loads(fh.read().decode("utf-8"))

    for feat in world["features"]:
        props = feat["properties"]
        if props.get("ADMIN") == "Germany" or props.get("ISO_A3") == "DEU":
            return {
                "$note": (
                    "Germany's border, Natural Earth 1:110m admin-0 (public domain). Used only to "
                    "give the university dots a country to sit in; it is a backdrop, not survey "
                    "data, and nothing is measured against it."
                ),
                "$source": NE_URL,
                "geometry": feat["geometry"],
            }
    raise SystemExit("Germany not found in the Natural Earth feature collection")


def main() -> None:
    index = build_index()
    OUT_INDEX.write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    from collections import Counter

    precision = Counter(d["centreFrom"] for d in index["universities"])
    built = sum(1 for d in index["universities"] if d.get("aoi"))
    print(
        f"config/campus-index.json: {len(index['universities'])} universities "
        f"({dict(precision)}, {built} with a built twin, "
        f"{len(index['$skipped'])} skipped)"
    )

    outline = build_outline()
    OUT_OUTLINE.write_text(
        json.dumps(outline, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    rings = outline["geometry"]["coordinates"]
    points = sum(len(r[0]) if outline["geometry"]["type"] == "MultiPolygon" else len(r) for r in rings)
    print(f"config/germany-outline.json: {outline['geometry']['type']}, {points} points")


if __name__ == "__main__":
    main()

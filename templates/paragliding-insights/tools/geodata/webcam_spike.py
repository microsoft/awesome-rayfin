"""Phase-9a spike — are there webcams at these two sites, and where exactly?

PLAN §5.9, decision 26, open question 7. Mode F wants a clickable webcam marker standing at the
camera's real position. Two things have to be true before any of that is worth writing:

  1. a camera exists at or near the site, and
  2. its position is KNOWN rather than guessed — a marker asserts "the camera is here, looking that
     way", and §4.2 does not allow that to be recalled.

OpenStreetMap is asked first because it is a source this app already uses and licenses (ODbL), and
because anything found here comes with coordinates rather than with a marketing page. Operator
cameras (a Bergbahn's own webcam page) are the other candidate and are NOT discoverable this way —
those need a human to read a website, which is the same wall the wind half hit with Holfuy.

⚠️ This probe answers "does one exist and where", NOT "may we use it". Licence is a separate
question and the harder one: an NC clause makes a camera unusable however well mapped it is.

Read-only. One Overpass query per AOI.

Usage
  python tools/geodata/webcam_spike.py
  python tools/geodata/webcam_spike.py --aoi tegelberg
"""

from __future__ import annotations

import argparse
import math

from aoi import bbox_tuple, load_aoi
from overpass_client import overpass

# Webcams are mapped inconsistently, so ask broadly and report what comes back rather than
# assuming one tagging scheme. `man_made=surveillance` is the documented one; the rest are how
# tourist cameras actually appear in the wild.
QUERY = """
[out:json][timeout:60];
(
  node["man_made"="surveillance"]({bbox});
  way["man_made"="surveillance"]({bbox});
  node["surveillance:type"="webcam"]({bbox});
  node["camera:type"]({bbox});
  node["contact:webcam"]({bbox});
  way["contact:webcam"]({bbox});
  node["webcam"]({bbox});
  way["webcam"]({bbox});
);
out center tags;
"""


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * 6371.0088 * math.asin(math.sqrt(a))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default=None, help="one AOI; default is every shipped site")
    args = parser.parse_args()

    sites = [args.aoi] if args.aoi else ["oberstdorf", "tegelberg"]

    for site in sites:
        cfg = load_aoi(site)
        south, west, north, east = bbox_tuple(cfg, "core")
        bbox = f"{south},{west},{north},{east}"
        name = cfg["site"]["name"]["de"]

        print(f"\n=== {name} ({site}) — core {bbox} ===")
        data = overpass(QUERY.format(bbox=bbox))
        elements = data.get("elements", [])
        print(f"  elements: {len(elements)}")

        if not elements:
            print("  none mapped in OpenStreetMap.")
            print("  -> operator cameras, if any, need a human to find and to licence-check.")
            continue

        centre_lat = (south + north) / 2
        centre_lon = (west + east) / 2
        for element in elements:
            lat = element.get("lat") or element.get("center", {}).get("lat")
            lon = element.get("lon") or element.get("center", {}).get("lon")
            tags = element.get("tags", {})
            label = tags.get("name") or tags.get("operator") or "(unnamed)"
            url = (
                tags.get("contact:webcam")
                or tags.get("webcam")
                or tags.get("website")
                or tags.get("url")
                or "—"
            )
            distance = (
                f"{haversine_km(centre_lat, centre_lon, lat, lon):5.1f} km"
                if lat and lon
                else "   ?   "
            )
            print(
                f"  {element['type']}/{element['id']:<12} {distance}  {label[:34]:<34} "
                f"dir={tags.get('direction', '—')}  {url[:60]}"
            )


if __name__ == "__main__":
    main()

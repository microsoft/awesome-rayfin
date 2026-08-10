"""Does OpenStreetMap know what colour these buildings are? — PLAN §5.11 spike.

Wall colour cannot be measured from an orthophoto: a wall is not visible from above. Before falling
back to a regional palette — which is invention, however plausible — this checks the one open
source that could in principle carry the real answer. Counts rather than impressions, because
"OSM probably has nothing out here" is exactly the kind of assumption this project keeps catching
itself in.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

OVERPASS = "https://overpass-api.de/api/interpreter"

BBOXES = {
    "oberstdorf": (47.37, 10.255, 47.445, 10.38),
    "tegelberg": (47.53, 10.70, 47.60, 10.80),
}

TAGS = ["building:colour", "roof:colour", "building:material", "roof:material", "roof:shape"]


def count(bbox: tuple[float, float, float, float], selector: str) -> int:
    s, w, n, e = bbox
    query = f"[out:json][timeout:120];(way[{selector}]({s},{w},{n},{e});relation[{selector}]({s},{w},{n},{e}););out count;"
    data = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(
        OVERPASS, data=data, headers={"User-Agent": "Gleitschirm-Insights/0.1 (geodata spike)"}
    )
    # Overpass is a shared public service and answers 429 when leaned on. Back off rather than
    # hammer it — the answer is worth waiting for and the service is somebody else's.
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = json.loads(response.read())
            return int(payload["elements"][0]["tags"]["total"])
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 504):
                raise
            time.sleep(15 * (attempt + 1))
    raise SystemExit("Overpass kept refusing; try again later")


def main() -> None:
    for aoi in sys.argv[1:] or list(BBOXES):
        bbox = BBOXES[aoi]
        total = count(bbox, "building")
        print(f"\n=== {aoi} — {total} OSM buildings in the AOI bbox ===")
        for tag in TAGS:
            n = count(bbox, f'"{tag}"')
            print(f"  {tag:20s} {n:6d}   {n / max(total, 1):7.3%}", flush=True)
            time.sleep(4)


if __name__ == "__main__":
    main()

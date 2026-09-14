"""One Overpass client, for every step that needs OpenStreetMap.

⚠️ **This module exists because deleting a file broke the pipeline in a way nothing noticed for two
phases.** `fetch_osm.py` was removed as flood residue — correctly, it fetched an Ahr river
centreline — but `fetch_osm_landuse.py` imported its `overpass()` helper. Oberstdorf's terrain was
already built, so the land-cover step never ran again and the break stayed invisible until a second
AOI needed a fresh pipeline run and stopped dead at step six.

Two lessons, both worth more than the twenty lines below:

* A reference check that only asks *"is this file imported?"* is not enough when the answer is "yes,
  by a step that happens to be cached". The pipeline is resumable, which is exactly what let a
  broken step hide.
* Three scripts had each grown their own copy of this function. That is what made the fourth one's
  import look incidental rather than load-bearing.

Overpass is free, shared and donation-funded, and it rate-limits hard. One query per run, a long
backoff, and an honest User-Agent are the price of being welcome back.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

OVERPASS_MIRRORS = (
    # Kumi first: the main instance returns 504 on the indoor-room queries this project needs,
    # reproducibly, while the same query succeeds here in a couple of seconds. Measured during the
    # Phase 2 data probe, not assumed.
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)
USER_AGENT = "Campus-Scheduler/0.1 (open geodata pipeline; +https://geodaten.bayern.de)"


def overpass(query: str, attempts: int = 4, timeout: int = 180) -> dict:
    """Run an Overpass QL query and return the parsed response.

    Every mirror is tried before the backoff lengthens, because the usual failure is one busy
    server rather than a bad query. Hammering them is both rude and counter-productive.

    ⚠️ Large queries need splitting by the CALLER, not just retrying. A single
    `nwr[indoor=room]` over the Garching bbox 504s on every mirror and every attempt; the same
    query split into four quadrants succeeds immediately. Retrying an over-large query just costs
    everyone time.
    """
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
            except (
                urllib.error.HTTPError,
                urllib.error.URLError,
                TimeoutError,
                json.JSONDecodeError,
            ) as exc:
                last = exc
        wait = 15 * (attempt + 1)
        print(f"  Overpass attempt {attempt + 1} failed on all mirrors ({last}) — waiting {wait}s")
        time.sleep(wait)

    raise RuntimeError(f"Overpass failed after {attempts} attempts: {last}")

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

OVERPASS = "https://overpass-api.de/api/interpreter"
USER_AGENT = "Gleitschirm-Insights/0.1 (open geodata pipeline; +https://geodaten.bayern.de)"


def overpass(query: str, attempts: int = 4, timeout: int = 180) -> dict:
    """Run an Overpass QL query and return the parsed response.

    Retries with a lengthening backoff, because the usual failure is a busy server rather than a
    bad query, and hammering it is both rude and counter-productive.
    """
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None

    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                OVERPASS, data=body, headers={"User-Agent": USER_AGENT}
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                return json.loads(response.read())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            wait = 15 * (attempt + 1)
            print(f"  Overpass attempt {attempt + 1} failed ({exc}) — retrying in {wait}s")
            time.sleep(wait)

    raise RuntimeError(f"Overpass failed after {attempts} attempts: {last}")

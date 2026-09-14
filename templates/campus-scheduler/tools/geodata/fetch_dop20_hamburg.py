"""Fetch the DOP20 orthophoto drape for a Hamburg AOI core, via the LGV WMS — PLAN §37.

Like `fetch_dop20_nrw.py`, this deliberately does NOT copy `fetch_dop20.py`'s mosaic logic — the
patch splitting, the seam arithmetic, taking the extent from the generated heightmap so the
photograph cannot slide against the terrain, and treating an XML body on a 200 as the failure it
is. None of that is Bavarian. Only the endpoint and the layer differ.

⚠️ **HAMBURG'S PORTAL ADVERTISES FIVE DOP SERVICES AND ALL FIVE ARE GONE.** `HH_WMS_DOP`,
`HH_WMS_DOP20`, `HH_WMS_Cache_DOP20`, `HH_WMS_Cache_DOP20_2017` and `HH_WMS_DOP_belaubt` every one
404s. The live services are lower-case and time-series named, and were found only by asking the
catalogue to list its own service URLs rather than by guessing at the documented ones. Guessing
would have concluded that Hamburg publishes no orthophotos at all.

Measured 2026-08-10 over the Von-Melle-Park campus, EPSG:25832, easting-first: mean channel 107.9
(belaubt) and 81.3 (unbelaubt), 256 distinct greys each — real photography, not the uniform white
tile an out-of-coverage request returns.

⚠️ **`belaubt` IS THE RIGHT CHOICE AND IT IS A CHOICE.** Hamburg flies the city twice: *belaubt* in
leaf and *unbelaubt* in winter. The winter imagery is sharper on buildings and is what a surveyor
wants; the summer imagery is what a campus LOOKS like, and this drape sits under a tree layer and a
building mesh that are drawn separately. Picking the bare-branch flight would put a winter city
under summer trees.

Usage
  python tools/geodata/fetch_dop20_hamburg.py --aoi hamburg
"""

from __future__ import annotations

import sys

import fetch_dop20

WMS = "https://geodienste.hamburg.de/wms_dop_zeitreihe_belaubt"

LAYER = "dop_zeitreihe_belaubt"

USER_AGENT = "Campus-Scheduler/0.1 (open geodata pipeline; +https://geodienste.hamburg.de)"

ATTRIBUTION = (
    "Datenquelle: Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV), "
    "dl-de/by-2-0"
)


def main() -> None:
    # Rebind the service constants on the module that owns the mosaic logic; `get_map` reads these
    # as globals at call time, so there is no second implementation to keep in step.
    fetch_dop20.WMS = WMS
    fetch_dop20.LAYER = LAYER
    fetch_dop20.USER_AGENT = USER_AGENT
    fetch_dop20.main()
    print(ATTRIBUTION)


if __name__ == "__main__":
    sys.exit(main())

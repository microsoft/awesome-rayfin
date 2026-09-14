"""Fetch the DOP orthophoto drape for an NRW AOI core, via the Geobasis NRW WMS — PLAN §37.

⚠️ **THIS FILE DELIBERATELY DOES NOT COPY `fetch_dop20.py`.** The Bavarian fetcher is ~200 lines of
mosaic logic that is entirely generic: split the core into patches that respect the service's
6500 px request cap, round the patch bounds off the fractional split so the tiles stay exactly
adjacent (independent sizing leaves one-pixel seams that read as a grid across the finished drape),
take the extent from the generated heightmap rather than the bbox so the photograph cannot slide
sideways against the terrain, and treat an XML body on a 200 as the failure it is. None of that is
Bavarian. The only things that differ for Nordrhein-Westfalen are the endpoint, the layer name and
the attribution, so those are the only things this module changes.

The alternative — a third near-identical copy beside `fetch_dop20.py` and `fetch_dop20_bw.py` —
would mean the next fix to the seam arithmetic has to be made in three places, and would be found
in two of them.

Measured 2026-08-07 before writing this: `GetCapabilities` on the service below lists `nw_dop_rgb`,
and GetMap over Köln, Aachen and Münster returns real photography (mean channel 105-123, 235-250
distinct greys, 79-93 KB per 512 px tile).

⚠️ **EPSG:25832 IS EASTING-FIRST IN WMS 1.3.0.** Passing northing first does not error — it answers
**HTTP 200 with a uniform white 1819-byte JPEG**, which looks exactly like a working service and
would be saved as a blank drape. `fetch_dop20.get_map` already orders the bbox correctly and
documents why; this note exists because the probe that chose this service hit the white tile first.

Usage
  python tools/geodata/fetch_dop20_nrw.py --aoi koeln
"""

from __future__ import annotations

import sys

import fetch_dop20

#: Geobasis NRW open orthophoto service. dl-de/zero-2-0.
WMS = "https://www.wms.nrw.de/geobasis/wms_nw_dop"

#: ⚠️ The RGB layer, named explicitly. The service also publishes `nw_dop_cir` and `nw_dop_nir`
#: (colour-infrared and near-infrared), which return plausible-looking imagery in false colour —
#: a drape that would make the campus look like a heat map and raise no error at all.
LAYER = "nw_dop_rgb"

USER_AGENT = "Campus-Scheduler/0.1 (open geodata pipeline; +https://www.opengeodata.nrw.de)"

ATTRIBUTION = "Datenquelle: Land NRW (Geobasis NRW), dl-de/zero-2-0"


def main() -> None:
    # Rebind the service constants on the module that owns the mosaic logic. `get_map` reads these
    # as globals at call time, so this is sufficient and there is no second implementation to keep
    # in step.
    fetch_dop20.WMS = WMS
    fetch_dop20.LAYER = LAYER
    fetch_dop20.USER_AGENT = USER_AGENT
    fetch_dop20.main()
    print(ATTRIBUTION)


if __name__ == "__main__":
    sys.exit(main())

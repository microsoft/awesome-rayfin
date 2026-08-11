"""Phase 0 gate: probe every data source the plan depends on, and report what is actually there.

PLAN §5 and §9. The schedule risk in this project is not the rendering, it is the assumption that a
pipeline written against one German state survey office transfers to another. It does not transfer
endpoint-for-endpoint, and the honest way to find that out is to ask the servers rather than to
reason about them.

This script makes no claim it has not measured. Every row it prints is an HTTP status code it
received, and every candidate URL that fails is left in the table rather than deleted, because
"we tried this and it 404s" is worth more to the next person than a short list of winners.

It is deliberately stdlib-only — no requests, no GDAL — so it runs on a bare checkout.

Usage
  python tools/geodata/verify_sources.py
  python tools/geodata/verify_sources.py --layer terrain
  python tools/geodata/verify_sources.py --json data/verification/sources.json
"""

from __future__ import annotations

import argparse
import json
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path

USER_AGENT = "Maritime-Insights/0.1 (open geodata pipeline; source verification)"
TIMEOUT = 30

# The AOI is not settled until this script says the data exists, so the probe uses a point inside
# the candidate core rather than a configured bbox. Inner Kieler Foerde, mid-water.
PROBE_LAT = 54.3800
PROBE_LON = 10.1600
PROBE_TILE_NS, PROBE_TILE_LAT = "N", 54
PROBE_TILE_EW, PROBE_TILE_LON = "E", 10


@dataclass
class Probe:
    id: str
    layer: str
    what: str
    url: str
    method: str = "GET"
    body: bytes | None = None
    range_bytes: int = 2048
    expect: str = ""  # substring expected in the body, if any
    # 🔴 Two sources here answer HTTP 200 with an EMPTY payload rather than an error, and both
    # cost real time before they were noticed: a regional Overpass mirror returns 200 and zero
    # elements for a German bbox, and the LVermGeo tile index returns {"success": true,
    # "features": []} when it is throttling. Reachability is not availability. A probe that can
    # be empty must say what "not empty" looks like.
    forbid: str = ""


@dataclass
class Result:
    id: str
    layer: str
    what: str
    url: str
    status: int | str = 0
    content_type: str = ""
    length: str = ""
    signature: str = ""
    matched_expect: bool | None = None
    note: str = ""
    ok: bool = False
    excerpt: str = ""


OVERPASS_PING = b"data=" + urllib.parse.quote(
    # Deliberately a query with a KNOWN non-empty answer inside the AOI. A count query would come
    # back "0" from a regional mirror and look like a pass.
    '[out:json][timeout:25];node["place"="city"](54.30,10.05,54.40,10.20);out ids;'
).encode()

# Recovered 2026-07-29 by a Playwright network capture on the LVermGeo download page: the tile
# index is not a static catalogue but a bbox query. Static analysis of the page failed because the
# app is a minified bundle — watching the network is what found it.
SH_INDEX = (
    "https://geodaten.schleswig-holstein.de/gaialight-sh/_apps/dladownload/_ajax/overview.php"
    "?bbox%5B%5D=570000&bbox%5B%5D=6018000&bbox%5B%5D=576000&bbox%5B%5D=6024000"
    "&crs=EPSG%3A25832&type%5B%5D="
)


PROBES: list[Probe] = [
    # ------------------------------------------------- state survey products (LVermGeo SH, CC BY)
    # ⚠️ The four products do NOT share a property schema: dgm1 carries `kaname` and `kachelname`,
    # while bdom/dop20/lod2 carry `kachel_n`, and only lod2 carries `d_format`. `filepath` is the
    # one key all four have, which is why the probe keys off it. A fetcher must not assume one
    # shape from having seen another.
    Probe("sh-index-dgm1", "terrain", "LVermGeo SH tile index - DGM1 (terrain)",
          SH_INDEX + "dgm1", range_bytes=60000, expect="filepath", forbid='"features": []'),
    Probe("sh-index-bdom", "terrain", "LVermGeo SH tile index - bDOM (surface model, for trees)",
          SH_INDEX + "bdom", range_bytes=60000, expect="filepath", forbid='"features": []'),
    Probe("sh-index-lod2", "buildings", "LVermGeo SH tile index - LoD2 (3D buildings)",
          SH_INDEX + "lod2", range_bytes=60000, expect="filepath", forbid='"features": []'),
    Probe("sh-index-dop20", "drape", "LVermGeo SH tile index - DOP20 (orthophoto)",
          SH_INDEX + "dop20", range_bytes=60000, expect="filepath", forbid='"features": []'),
    Probe("sh-ckan-dgm1", "terrain", "SH open data portal record for DGM1 (licence check)",
          "https://opendata.schleswig-holstein.de/api/3/action/package_search"
          "?q=name:digitales-gelandemodell-1-dgm1&rows=1",
          range_bytes=20000, expect="cc-by"),

    # ------------------------------------------------------------------- orthophoto, live service
    Probe("sh-dop20-wms", "drape", "DOP20 WMS GetCapabilities (confirmed service name)",
          "https://dienste.gdi-sh.de/WMS_SH_DOP20col_OpenGBD"
          "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities",
          range_bytes=8000, expect="WMS_Capabilities"),

    # ------------------------------------------------------------------------------ shell terrain
    Probe("copdem-tile", "shell",
          f"Copernicus DEM GLO-30 tile {PROBE_TILE_NS}{PROBE_TILE_LAT} {PROBE_TILE_EW}{PROBE_TILE_LON:03d}",
          "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/"
          f"Copernicus_DSM_COG_10_{PROBE_TILE_NS}{PROBE_TILE_LAT:02d}_00_{PROBE_TILE_EW}{PROBE_TILE_LON:03d}_00_DEM/"
          f"Copernicus_DSM_COG_10_{PROBE_TILE_NS}{PROBE_TILE_LAT:02d}_00_{PROBE_TILE_EW}{PROBE_TILE_LON:03d}_00_DEM.tif",
          range_bytes=512),

    # --------------------------------------------------------------------------------------- OSM
    Probe("overpass-main", "osm", "Overpass primary", "https://overpass-api.de/api/interpreter",
          method="POST", body=OVERPASS_PING, range_bytes=8000, expect="elements",
          forbid='"elements": []'),
    Probe("overpass-kumi", "osm", "Overpass mirror kumi.systems",
          "https://overpass.kumi.systems/api/interpreter",
          method="POST", body=OVERPASS_PING, range_bytes=8000, expect="elements",
          forbid='"elements": []'),
    Probe("overpass-coffee", "osm", "Overpass mirror private.coffee",
          "https://overpass.private.coffee/api/interpreter",
          method="POST", body=OVERPASS_PING, range_bytes=8000, expect="elements",
          forbid='"elements": []'),

    # --------------------------------------------------------------------------------------- AIS
    Probe("ais-dk-day", "ais", "Danish open AIS archive, one day (replay source)",
          "http://aisdata.ais.dk/aisdk-2026-07-01.zip", range_bytes=4000),
    Probe("aisstream-root", "ais", "aisstream.io (live websocket provider, needs a free key)",
          "https://aisstream.io/", range_bytes=4000),

    # ------------------------------------------------------------------------- water level, gauge
    Probe("pegelonline-stations", "gauge", "PEGELONLINE stations (WSV open REST API)",
          "https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json",
          range_bytes=8192, expect="shortname"),

    # -------------------------------------------------------------------------------- bathymetry
    Probe("emodnet-wcs", "bathymetry", "EMODnet Bathymetry WCS GetCapabilities",
          "https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=2.0.1&request=GetCapabilities",
          range_bytes=4096, expect="Capabilities"),
    Probe("bsh-geoseaportal", "bathymetry", "BSH GeoSeaPortal root", "https://www.geoseaportal.de/"),
]


def probe(item: Probe) -> Result:
    result = Result(id=item.id, layer=item.layer, what=item.what, url=item.url)
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if item.range_bytes:
        headers["Range"] = f"bytes=0-{item.range_bytes - 1}"
    if item.method == "POST":
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    request = urllib.request.Request(
        item.url, data=item.body, headers=headers, method=item.method
    )
    context = ssl.create_default_context()
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT, context=context) as response:
            body = response.read(max(item.range_bytes, 2048))
            result.status = response.status
            result.content_type = (response.headers.get("Content-Type") or "").split(";")[0]
            result.length = response.headers.get("Content-Range") or response.headers.get(
                "Content-Length"
            ) or ""
    except urllib.error.HTTPError as exc:
        body = exc.read(2048) if exc.fp else b""
        result.status = exc.code
        result.content_type = (exc.headers.get("Content-Type") or "").split(";")[0] if exc.headers else ""
        result.note = exc.reason or ""
    except (urllib.error.URLError, socket.timeout, ssl.SSLError, ConnectionError) as exc:
        result.status = "ERR"
        result.note = str(getattr(exc, "reason", exc))[:120]
        body = b""

    result.note = (result.note + f" {time.time() - started:.1f}s").strip()
    result.signature = body[:4].hex() if body else ""
    text = body.decode("utf-8", errors="replace")
    result.excerpt = " ".join(text.split())[:200]
    if item.expect:
        result.matched_expect = item.expect.lower() in text.lower()

    result.ok = isinstance(result.status, int) and 200 <= result.status < 300
    if result.matched_expect is False:
        result.ok = False
    if item.forbid and item.forbid.replace(" ", "") in text.replace(" ", ""):
        result.ok = False
        result.note = (result.note + " EMPTY PAYLOAD (reachable but carries nothing)").strip()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--layer", help="only probe one layer (terrain, drape, buildings, shell, osm, ais, gauge, bathymetry)")
    parser.add_argument("--only", help="only probe one id")
    parser.add_argument("--json", default="data/verification/sources.json")
    args = parser.parse_args()

    selected = [
        p for p in PROBES
        if (not args.layer or p.layer == args.layer) and (not args.only or p.id == args.only)
    ]
    if not selected:
        raise SystemExit("no probes selected")

    results: list[Result] = []
    layer = None
    for item in selected:
        if item.layer != layer:
            layer = item.layer
            print(f"\n=== {layer.upper()} " + "=" * (60 - len(layer)))
        result = probe(item)
        results.append(result)
        mark = "OK  " if result.ok else "FAIL"
        expect = "" if result.matched_expect is None else (" match" if result.matched_expect else " NO-MATCH")
        print(f"{mark} {result.status:>5}  {item.id:<22} {result.content_type:<26}{expect}")
        if not result.ok and result.excerpt:
            print(f"       {result.excerpt[:150]}")
        elif result.ok and result.length:
            print(f"       {result.length}")

    out = Path(args.json)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "probedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "probePoint": {"lat": PROBE_LAT, "lon": PROBE_LON},
                "results": [asdict(r) for r in results],
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    passed = sum(1 for r in results if r.ok)
    print(f"\n{passed}/{len(results)} probes reachable — written to {out}")


if __name__ == "__main__":
    main()

"""Is there a FREE, openly-licensed photograph for the vessels this app actually sees?

VesselFinder's photos are user-submitted and copyright the photographer; the only programmatic
access is a paid API. So the question is not "can we take theirs" but "does an open source have
these hulls at all". Wikidata carries IMO (P458) and MMSI (P587) and links images (P18) hosted on
Wikimedia Commons under CC / public-domain terms — free to display with attribution, no key, and
CORS-enabled so the browser can fetch them directly.

Measure before building: a picture feature that resolves for 3 % of a fjord's traffic is worse
than the honest silhouette it would replace, because it makes the silhouette look like a failure
rather than a choice.

⚠️ Uses the **MediaWiki Action API**, not the SPARQL endpoint. WDQS is frequently degraded (it was
rate-limiting to one request per minute when this was written) and it is not the right tool for a
key lookup anyway — `haswbstatement` on CirrusSearch is.

Run: python tools/ais/measure_vessel_photos.py [--aoi kieler-foerde]
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = "https://www.wikidata.org/w/api.php"
AGENT = "Maritime-Insights-coverage-probe/1.0 (open-data demo; contact via repo)"

IMO_PROP = "P458"
MMSI_PROP = "P587"
IMAGE_PROP = "P18"

# Seconds between calls to a free public API.
PAUSE_S = 0.4


def get(params: dict) -> dict:
    url = f"{API}?{urllib.parse.urlencode({**params, 'format': 'json'})}"
    req = urllib.request.Request(url, headers={"User-Agent": AGENT})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                # Be a good citizen: this is a free public API and the whole point of the probe is
                # that it is free. Pacing costs a few seconds and keeps it that way.
                time.sleep(PAUSE_S)
                return json.load(res)
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 503) and attempt < 5:
                wait = exc.headers.get("Retry-After")
                time.sleep(float(wait) if wait and wait.isdigit() else 5 * (attempt + 1))
                continue
            raise
    return {}


def chunked(values: list[str], size: int):
    for i in range(0, len(values), size):
        yield values[i:i + size]


def find_items(values: list[str], prop: str) -> dict[str, str]:
    """identifier -> Q-id, for those Wikidata knows.

    🔴 **One request per value, deliberately.** The first version batched twenty identifiers into a
    single `haswbstatement:P458=a OR haswbstatement:P458=b ...` clause and reported **0 hits out of
    203** — which I nearly wrote up as "open data has no pictures of Baltic traffic". It was the
    query: validated against three ships that certainly have items and photographs (Queen Mary 2,
    Ever Given, Color Magic), the single-value form found **3 of 3** and the OR-batched form found
    **none**. A measurement of zero is exactly as likely to mean the instrument is broken as that
    there is nothing there, so it has to be validated against a known-positive before it is
    believed.
    """
    found: dict[str, str] = {}
    for index, value in enumerate(values, 1):
        data = get({"action": "query", "list": "search",
                    "srsearch": f"haswbstatement:{prop}={value}", "srlimit": 5})
        hits = data.get("query", {}).get("search", [])
        if hits:
            found[value] = hits[0]["title"]
        if index % 25 == 0:
            print(f"    {index}/{len(values)} ...")
    return found


def entity_details(qids: list[str]) -> dict[str, dict]:
    """For each item: its IMO, MMSI and image file name (if any)."""
    out: dict[str, dict] = {}
    for chunk in chunked(qids, 50):
        data = get({"action": "wbgetentities", "ids": "|".join(chunk), "props": "claims"})
        for qid, entity in data.get("entities", {}).items():
            claims = entity.get("claims", {})

            def first(prop: str, claims=claims):
                for claim in claims.get(prop, []):
                    value = claim.get("mainsnak", {}).get("datavalue", {}).get("value")
                    if value is not None:
                        return value
                return None

            out[qid] = {
                "imo": first(IMO_PROP),
                "mmsi": first(MMSI_PROP),
                "image": first(IMAGE_PROP),
            }
    return out


def commons_url(filename: str) -> str:
    name = str(filename).replace(" ", "_")
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(name)}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--aoi", default="kieler-foerde")
    args = parser.parse_args()

    meta = json.loads((ROOT / "public" / "terrain" / args.aoi / "tracks.json").read_text("utf-8"))
    tracks = meta["tracks"]

    by_mmsi: dict[str, dict] = {}
    for track in tracks:
        mmsi = track.get("mmsi")
        if not mmsi:
            continue
        entry = by_mmsi.setdefault(str(mmsi), {"name": None, "imo": None, "passages": 0})
        entry["passages"] += 1
        entry["name"] = entry["name"] or track.get("name")
        entry["imo"] = entry["imo"] or track.get("imo")

    imos = sorted({str(v["imo"]) for v in by_mmsi.values() if v["imo"]})
    mmsis = sorted(by_mmsi)
    total_passages = sum(v["passages"] for v in by_mmsi.values())

    print(f"AOI {args.aoi}: {len(tracks)} passages, {len(mmsis)} distinct vessels with an MMSI, "
          f"{len(imos)} of them also broadcasting an IMO\n")

    qids: set[str] = set()
    if imos:
        print(f"searching Wikidata by IMO   ({len(imos)} values) ...")
        qids |= set(find_items(imos, IMO_PROP).values())
    if mmsis:
        print(f"searching Wikidata by MMSI  ({len(mmsis)} values) ...")
        qids |= set(find_items(mmsis, MMSI_PROP).values())
    print(f"  {len(qids)} matching Wikidata items")

    details = entity_details(sorted(qids)) if qids else {}

    image_by_imo: dict[str, object] = {}
    image_by_mmsi: dict[str, object] = {}
    for info in details.values():
        if info["imo"]:
            image_by_imo.setdefault(str(info["imo"]), info["image"])
        if info["mmsi"]:
            image_by_mmsi.setdefault(str(info["mmsi"]), info["image"])

    with_photo: dict[str, object] = {}
    listed_no_photo = 0
    for mmsi, info in by_mmsi.items():
        image = image_by_mmsi.get(mmsi)
        if not image and info["imo"]:
            image = image_by_imo.get(str(info["imo"]))
        if image:
            with_photo[mmsi] = image
        elif mmsi in image_by_mmsi or (info["imo"] and str(info["imo"]) in image_by_imo):
            listed_no_photo += 1

    covered = sum(v["passages"] for m, v in by_mmsi.items() if m in with_photo)

    print()
    print(f"  with a free photograph  {len(with_photo):>5} of {len(mmsis)} vessels "
          f"({len(with_photo) / max(len(mmsis), 1):.1%})")
    print(f"  passages so covered     {covered:>5} of {total_passages} "
          f"({covered / max(total_passages, 1):.1%})")
    print(f"  in Wikidata, no image   {listed_no_photo:>5}")
    print()
    for mmsi, filename in list(with_photo.items())[:12]:
        print(f"    {by_mmsi[mmsi]['name'] or '(unnamed)':<28} {mmsi}  {commons_url(filename)}")


if __name__ == "__main__":
    main()

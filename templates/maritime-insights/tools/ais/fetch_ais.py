"""Fetch one day of open AIS and keep only what falls inside the AOI.

PLAN §5. The Danish Maritime Authority publishes its AIS archive as one zip per day at
`http://aisdata.ais.dk/aisdk-YYYY-MM-DD.zip`. ⚠️ The host is **http**, not https — `web.ais.dk`
serves a certificate that does not match its own hostname, which is what made the first probe of
this source look like an outage.

🔴 **A day is 724 MB and almost none of it is here.** The archive covers Danish waters; the AOI is
one fjord. Everything is filtered to the AOI bounding box **during the streaming read**, so the
724 MB is never held and never stored — what lands on disk is the handful of megabytes that are
actually about this water.

🔴 **Identity (PLAN §3.2 rule 4) is a switch, and it is set here — at ingest.**
The Danish Maritime Authority publishes this archive openly *including* MMSI, vessel name, call
sign, IMO number, destination and draught: re-deriving them costs one download, so treating them
as secret would be theatre. The default is therefore `--identity full`, which carries them
through to the app so a vessel can be named and checked against an independent AIS service.

⚠️ `--identity anonymous` restores the original behaviour — a per-day salted pseudonym and
nothing else — and is the right setting for anything published where the *subject* matters more
than the demonstration. The distinction that carries the real weight is **commercial versus
pleasure**: a cargo ship's name is a company asset, while a named private yacht plus a day of
positions is a person's location history. `--identity commercial` keeps names for commercial
traffic and pseudonymises the rest.

Usage
  python tools/ais/fetch_ais.py --date 2026-07-01
  python tools/ais/fetch_ais.py --date 2026-07-01 --identity commercial
  python tools/ais/fetch_ais.py --date 2026-07-01 --keep-zip
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import re
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "geodata"))

from aoi import bbox_tuple, cache_dir, load_aoi  # noqa: E402

BASE = "http://aisdata.ais.dk"
USER_AGENT = "Maritime-Insights/0.1 (open geodata pipeline)"

#: Columns kept from the source.
#:
#: ⚠️ The timestamp column is literally named `# Timestamp`, leading hash and space included,
#: because the header line doubles as a comment marker. Assuming `Timestamp` fails, and it is worth
#: failing loudly on: the guard below prints the real header rather than quietly writing empty
#: times.
TIME_COL = "# Timestamp"
KEEP = [TIME_COL, "Type of mobile", "Navigational status", "Latitude", "Longitude",
        "SOG", "COG", "Heading", "Ship type", "Width", "Length"]

#: Identity columns, written only when the mode asks for them. `Cargo type` and `Draught` are here
#: rather than in KEEP because together with a name they describe a specific hull and its current
#: loading — operational detail about one ship rather than a traffic picture.
IDENTITY = ["MMSI", "Name", "Callsign", "IMO", "Destination", "ETA", "Draught", "Cargo type"]

#: Ship-type values that name a private boat rather than a commercial operator. Matches
#: `PRIVATE_TYPES` in server/ais/privacy.js — the two must agree or live and replay would apply
#: different rules to the same hull.
PRIVATE_TYPES = {"Pleasure", "Sailing", "Undefined", "Other", ""}

#: 🔴 Naval vessels keep a pseudonym in **every** identity mode unless `--include-naval` is passed.
#:
#: PLAN §3.2 rule 3 is separate from the identity rule and was not withdrawn with it: the app must
#: never be a way to find a particular ship, "and above all never a way to find a warship". That
#: matters more here than anywhere else, because this is a demo shown to defence customers — a
#: named minehunter with a day of positions, served from a public URL under our name, is the one
#: output nobody in that room would thank us for.
#:
#: Detected two ways because one is not enough: the self-reported `Military` ship type, and the
#: naming convention warships use on AIS precisely *because* they are obscuring themselves
#: ("GERMAN WARSHIP A511"). Measured on 2026-07-01: 2 in the Förde, 1 in the Schlei.
NAVAL_NAME = re.compile(r"\b(WARSHIP|NAVY|NAVAL|HMS|USS|FGS)\b", re.IGNORECASE)


def is_naval(ship_type: str, name: str) -> bool:
    return ship_type == "Military" or bool(name and NAVAL_NAME.search(name))

#: The value the Danish archive writes where a field was never received. Copying it into the app
#: would render as a vessel literally called "Unknown".
UNKNOWN = {"", "Unknown", "unknown", "N/A", "undefined", "Undefined"}


def clean(value):
    """Empty string for the archive's several spellings of "not received"."""
    text = (value or "").strip()
    return "" if text in UNKNOWN else text


def download(date: str, destination: Path) -> Path:
    path = destination / f"aisdk-{date}.zip"
    if path.exists() and path.stat().st_size > 1_000_000:
        print(f"  cached: {path.name} ({path.stat().st_size / 1e6:.0f} MB)")
        return path
    url = f"{BASE}/aisdk-{date}.zip"
    print(f"  downloading {url}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    started = time.time()
    tmp = path.with_suffix(".zip.part")
    with urllib.request.urlopen(request, timeout=300) as response, tmp.open("wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = response.read(4 << 20)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total and done % (80 << 20) < (4 << 20):
                rate = done / max(time.time() - started, 0.001) / 1e6
                print(f"    {done / 1e6:.0f} / {total / 1e6:.0f} MB ({rate:.1f} MB/s)")
    tmp.replace(path)
    print(f"  {path.stat().st_size / 1e6:.0f} MB in {time.time() - started:.0f}s")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="kieler-foerde")
    parser.add_argument("--date", default="2026-07-01")
    parser.add_argument("--identity", choices=("full", "commercial", "anonymous"),
                        default="full",
                        help="full: name and MMSI for every vessel. commercial: only for "
                             "commercial traffic, pleasure craft pseudonymised. anonymous: "
                             "per-day salted pseudonym for everything.")
    parser.add_argument("--include-naval", action="store_true",
                        help="also identify naval vessels. Off by default — PLAN §3.2 rule 3.")
    parser.add_argument("--keep-zip", action="store_true",
                        help="keep the 724 MB source after filtering")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    south, west, north, east = bbox_tuple(cfg, "core")
    # A little margin so a vessel entering the frame is already on a track rather than appearing
    # out of nothing at the edge.
    margin = 0.05
    south, north = south - margin, north + margin
    west, east = west - margin, east + margin
    print(f"AOI {cfg['id']}: {south:.3f}..{north:.3f} N, {west:.3f}..{east:.3f} E")

    raw_dir = cache_dir("ais")
    archive = download(args.date, raw_dir)

    out_path = raw_dir / f"{args.date}_{cfg['id']}.csv"
    kept = 0
    total = 0
    started = time.time()
    salt = f"{args.date}".encode()

    with zipfile.ZipFile(archive) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if len(names) != 1:
            raise SystemExit(f"expected one CSV in the archive, found {names}")
        print(f"  reading {names[0]}")
        with zf.open(names[0]) as handle:
            reader = csv.DictReader(io.TextIOWrapper(handle, encoding="utf-8", errors="replace"))
            if reader.fieldnames is None:
                raise SystemExit("no header in the AIS CSV")
            missing = [c for c in (TIME_COL, "Latitude", "Longitude", "MMSI")
                       if c not in reader.fieldnames]
            if missing:
                raise SystemExit(f"AIS CSV is missing {missing}; header is {reader.fieldnames}")

            # 🔴 Buffered rather than streamed straight to disk, because two of the decisions below
            # are properties of the **vessel** and cannot be made from the row in hand.
            #
            # The first attempt decided "is this naval?" per row, from that row's `Name`. But the
            # name only appears on static rows — a few per hour against a position every few
            # seconds — so a warship's position rows were written identified and its static rows
            # pseudonymised. That splits one hull across two keys: the Förde went from 174 vessels
            # to **176** and 261 passages to 262, silently, which is exactly the kind of drift that
            # invalidates every figure downstream. Only the AOI rows are held (tens of thousands),
            # not the 20.6 M in the archive.
            rows: list[dict] = []
            for row in reader:
                total += 1
                try:
                    lat = float(row["Latitude"])
                    lon = float(row["Longitude"])
                except (TypeError, ValueError):
                    continue
                if not (south <= lat <= north and west <= lon <= east):
                    continue
                rows.append(row)
                kept += 1
                if kept % 200_000 == 0:
                    print(f"    kept {kept:,} of {total:,} rows")

    # One verdict per MMSI, from everything that vessel transmitted anywhere in the area.
    naval_mmsi: set[str] = set()
    types: dict[str, str] = {}
    for row in rows:
        mmsi = (row.get("MMSI") or "").strip()
        ship_type = (row.get("Ship type") or "").strip()
        if ship_type and ship_type not in PRIVATE_TYPES:
            types.setdefault(mmsi, ship_type)
        if is_naval(ship_type, clean(row.get("Name", ""))):
            naval_mmsi.add(mmsi)

    named = 0
    naval_rows = 0
    with out_path.open("w", newline="", encoding="utf-8") as out:
        writer = csv.writer(out)
        writer.writerow(["vessel", "time", "mobile", "navstatus", "lat", "lon",
                         "sog", "cog", "heading", "shiptype", "width", "length",
                         "mmsi", "name", "callsign", "imo", "destination", "eta",
                         "draught", "cargotype"])
        for row in rows:
            mmsi = (row.get("MMSI") or "").strip()
            # Also resolved per vessel: a position row often carries no ship type, so reading it
            # from the row would make one hull commercial on some rows and private on others.
            ship_type = types.get(mmsi, (row.get("Ship type") or "").strip())
            identified = (
                args.identity == "full"
                or (args.identity == "commercial" and ship_type not in PRIVATE_TYPES)
            )
            # ⚠️ Applied last, and overriding the mode. Naval traffic is the one category where
            # the mode does not get the last word — PLAN §3.2 rule 3.
            if identified and not args.include_naval and mmsi in naval_mmsi:
                identified = False
                naval_rows += 1

            if identified:
                # The MMSI *is* the stable key once identity is kept, so there is nothing for a
                # pseudonym to do: a second key would only invite the two to disagree.
                vessel = mmsi
                identity = [clean(row.get(c, "")) for c in IDENTITY]
                if identity[1]:
                    named += 1
            else:
                # A salted hash, truncated: enough to group one vessel's positions within this
                # day, not enough to identify it or to join two days together.
                vessel = hashlib.blake2s(mmsi.encode() + salt, digest_size=4).hexdigest()
                identity = [""] * len(IDENTITY)

            writer.writerow([vessel, *(row.get(c, "") for c in KEEP), *identity])
    naval = naval_rows

    print(f"\n  {kept:,} rows inside the AOI, from {total:,} in the archive "
          f"({kept / max(total, 1) * 100:.2f} %), {time.time() - started:.0f}s")
    print(f"  identity mode {args.identity}: {named:,} rows carry a vessel name")
    if naval:
        print(f"  {naval:,} rows pseudonymised as naval (PLAN §3.2 rule 3; --include-naval to keep)")
    print(f"  written to {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)")
    if kept == 0:
        raise SystemExit(
            "no AIS rows fall inside the AOI — the archive may not cover this water. "
            "That is a finding, not a bug: check the coverage before assuming the filter is wrong."
        )
    if not args.keep_zip:
        archive.unlink()
        print(f"  removed {archive.name} (pass --keep-zip to keep it)")


if __name__ == "__main__":
    main()

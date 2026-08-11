"""Phase-4 spike — is there anything actually flying over the Nebelhorn, and can we hear it?

PLAN §5.3 makes this the day-one gate: the relay, the live layer and the RTI ingestion all rest on
three unverified assumptions, and it is much cheaper to test them with a socket than with an
architecture. The questions, in the order that matters:

  1. Is APRS-IS reachable at all from this machine, on the port OGN documents?
  2. Does the login handshake work read-only (`pass -1`), and does the range filter take?
  3. Does **FANET** traffic — what paraglider instruments transmit — actually appear over
     Oberstdorf, or is the coverage claim wishful?
  4. What is the message rate? That sets the relay's fan-out budget and the RTI ingestion cost.

Read-only. Sends a login line and nothing else, ever.

Usage
  python tools/ogn/spike.py                 # 90 s listen, 30 km around the Nebelhorn
  python tools/ogn/spike.py --seconds 30
"""

from __future__ import annotations

import argparse
import json
import re
import socket
import sys
import time
from collections import Counter
from pathlib import Path

APRS_HOST = "aprs.glidernet.org"
APRS_PORT_FILTERED = 14580

# Nebelhorn summit. A 30 km radius covers the whole two-tier AOI and then some, deliberately: the
# question here is "is there traffic and are we receiving it", not "is it inside the core bbox".
CENTRE_LAT = 47.4218727
CENTRE_LON = 10.3423461
RADIUS_KM = 30

# OGN position lines look like:
#   FLRDDA5BA>APRS,qAS,LFMX:/160829h4415.41N/00600.03E'342/049/A=005524 !W26! id0ADDA5BA -454fpm
# The leading token before '>' is the source; the ':' splits header from payload.
POSITION_RE = re.compile(
    r"^(?P<src>[A-Za-z0-9\-]+)>(?P<dst>[A-Za-z0-9\-]+),(?P<path>[^:]*):"
    r"/(?P<time>\d{6})h"
    r"(?P<lat>\d{4}\.\d{2})(?P<ns>[NS])"
    r"(?P<symtab>.)"
    r"(?P<lon>\d{5}\.\d{2})(?P<ew>[EW])"
    r"(?P<symcode>.)"
    r"(?P<course>\d{3})/(?P<speed>\d{3})"
    r"/A=(?P<alt>-?\d{6})"
    r"(?P<rest>.*)$"
)

ID_RE = re.compile(r"id([0-9A-Fa-f]{2})([0-9A-Fa-f]{6})")

# Bits 2-5 of the id byte. Only the ones that matter here are named; the rest are noise for a
# paragliding app but are counted so the spike reports honestly.
AIRCRAFT_TYPE = {
    0: "unknown",
    1: "glider",
    2: "tow plane",
    3: "helicopter",
    4: "parachute",
    5: "drop plane",
    6: "hang glider",
    7: "paraglider",
    8: "powered aircraft",
    9: "jet",
    10: "UFO",
    11: "balloon",
    12: "airship",
    13: "UAV",
    15: "static object",
}

ADDRESS_TYPE = {0: "random", 1: "ICAO", 2: "FLARM", 3: "OGN"}


def dm_to_deg(value: str, hemi: str) -> float:
    """APRS packs latitude as ddmm.mm and longitude as dddmm.mm."""
    dot = value.index(".")
    deg = int(value[: dot - 2])
    minutes = float(value[dot - 2 :])
    dec = deg + minutes / 60.0
    return -dec if hemi in ("S", "W") else dec


def classify(source: str, dest: str) -> str:
    """What kind of transmitter is this? The source prefix is the honest signal."""
    if source.startswith("FLR"):
        return "FLARM"
    if source.startswith("FNT"):
        return "FANET"
    if source.startswith("OGN"):
        return "OGN tracker"
    if source.startswith("ICA"):
        return "ICAO"
    if source.startswith("PAW"):
        return "PilotAware"
    if "OGNSDR" in dest or source.endswith("SDR"):
        return "receiver"
    return f"other ({source[:3]})"


def run(seconds: int, out_path: Path | None) -> int:
    print(f"connecting to {APRS_HOST}:{APRS_PORT_FILTERED} …")
    try:
        sock = socket.create_connection((APRS_HOST, APRS_PORT_FILTERED), timeout=20)
    except OSError as exc:
        print(f"\n❌ cannot reach APRS-IS: {exc}")
        print("   Either the network blocks the port, or the host is wrong. Everything in phase 4")
        print("   downstream of the relay depends on this, so stop here and resolve it.")
        return 2

    sock.settimeout(5)
    reader = sock.makefile("r", encoding="utf-8", errors="replace")

    banner = reader.readline().strip()
    print(f"  server: {banner}")

    # Read-only login. `pass -1` is the documented anonymous form; the filter asks the server to
    # send only what is within RADIUS_KM of the summit, so the rate we measure is the rate the
    # relay would actually carry rather than the whole of Europe.
    login = (
        f"user NOCALL pass -1 vers Gleitschirm-Insights-spike 0.1 "
        f"filter r/{CENTRE_LAT:.4f}/{CENTRE_LON:.4f}/{RADIUS_KM}\r\n"
    )
    sock.sendall(login.encode("ascii"))
    print(f"  login sent, filter r/{CENTRE_LAT:.4f}/{CENTRE_LON:.4f}/{RADIUS_KM}")

    verdict = reader.readline().strip()
    print(f"  server: {verdict}")

    deadline = time.time() + seconds
    lines = 0
    positions = 0
    kinds: Counter[str] = Counter()
    craft: Counter[str] = Counter()
    devices: dict[str, dict] = {}
    no_track = 0
    samples: list[str] = []
    raw: list[str] = []

    print(f"\nlistening {seconds} s …\n")
    while time.time() < deadline:
        try:
            line = reader.readline()
        except socket.timeout:
            continue
        except OSError as exc:
            print(f"  stream error: {exc}")
            break
        if not line:
            print("  stream closed by server")
            break

        line = line.rstrip("\r\n")
        lines += 1
        if line.startswith("#"):
            continue  # keepalive / server comment

        raw.append(line)
        match = POSITION_RE.match(line)
        if not match:
            continue

        source = match.group("src")
        kind = classify(source, match.group("dst"))
        kinds[kind] += 1

        # Receiver status beacons are not aircraft; they would inflate the rate and mislead the
        # fan-out budget.
        if kind == "receiver":
            continue

        positions += 1
        lat = dm_to_deg(match.group("lat"), match.group("ns"))
        lon = dm_to_deg(match.group("lon"), match.group("ew"))
        alt_m = int(match.group("alt")) * 0.3048

        rest = match.group("rest")
        aircraft = "unknown"
        addr = "?"
        device_id = source
        id_match = ID_RE.search(rest)
        if id_match:
            flags = int(id_match.group(1), 16)
            device_id = id_match.group(2)
            aircraft = AIRCRAFT_TYPE.get((flags >> 2) & 0x0F, f"type {(flags >> 2) & 0x0F}")
            addr = ADDRESS_TYPE.get(flags & 0x03, "?")
            if flags & 0x40 or flags & 0x80:
                no_track += 1

        craft[aircraft] += 1
        devices.setdefault(
            device_id,
            {"kind": kind, "aircraft": aircraft, "addr": addr, "fixes": 0, "alt_min": 1e9, "alt_max": -1e9},
        )
        d = devices[device_id]
        d["fixes"] += 1
        d["alt_min"] = min(d["alt_min"], alt_m)
        d["alt_max"] = max(d["alt_max"], alt_m)

        if len(samples) < 6:
            samples.append(f"{source:12s} {kind:12s} {aircraft:12s} {lat:.4f},{lon:.4f} {alt_m:6.0f} m")

    sock.close()

    elapsed = seconds
    print("=" * 78)
    print(f"{lines} lines in {elapsed} s   ({lines / elapsed:.1f} lines/s)")
    print(f"{positions} aircraft position reports   ({positions / elapsed:.2f}/s)")
    print(f"{len(devices)} distinct aircraft")
    print()
    print("by transmitter:")
    for k, v in kinds.most_common():
        print(f"  {k:16s} {v:5d}")
    print()
    print("by aircraft type:")
    for k, v in craft.most_common():
        print(f"  {k:16s} {v:5d}")
    if no_track:
        print(f"\n⚠️  {no_track} reports carried stealth/no-track flags — the relay must drop these.")
    if samples:
        print("\nsample fixes:")
        for s in samples:
            print(f"  {s}")

    if devices:
        print("\naircraft seen:")
        for dev, d in sorted(devices.items(), key=lambda kv: -kv[1]["fixes"])[:20]:
            print(
                f"  {dev:10s} {d['kind']:12s} {d['aircraft']:12s} "
                f"{d['fixes']:3d} fixes  {d['alt_min']:5.0f}–{d['alt_max']:5.0f} m"
            )

    print()
    fanet = kinds.get("FANET", 0)
    paragliders = craft.get("paraglider", 0) + craft.get("hang glider", 0)
    if positions == 0:
        print("🟡 VERDICT: connection works, but nothing was flying in range during the window.")
        print("   That is a real answer, not a failure — it is exactly why decision 15 makes the")
        print("   Mode B fallback first-class. Re-run on a good afternoon to measure the rate.")
    elif fanet or paragliders:
        print(f"✅ VERDICT: FANET/paraglider traffic confirmed over the Nebelhorn "
              f"({fanet} FANET reports, {paragliders} free-flight fixes).")
        print("   The relay is worth building and Mode C has something to show.")
    else:
        print("🟡 VERDICT: traffic present, but no FANET/free-flight — only powered/FLARM.")
        print("   Mode C works, but on a paragliding app it may show mostly airliners. Weigh that")
        print("   before investing in the live layer.")

    if out_path and raw:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text("\n".join(raw), encoding="utf-8")
        print(f"\nraw stream → {out_path}  ({len(raw)} lines)")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=int, default=90)
    parser.add_argument("--out", type=Path, default=None, help="write the raw stream for offline parsing")
    args = parser.parse_args()
    return run(args.seconds, args.out)


if __name__ == "__main__":
    sys.exit(main())

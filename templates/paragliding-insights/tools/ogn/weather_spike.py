"""Phase-9a spike — is there live wind over these sites, and is OGN a source for it?

PLAN §5.10, decision 27. Mode F wants wind at the launches, and there is a very tempting answer:
`server/ogn/relay.js` already holds an APRS-IS connection, FANET+ weather stations are common at
Alpine launches, and the relay's parser **already sees those beacons and throws them away** — it
drops anything without a device id, and a ground station has none. One parser change and the data
would apparently be free.

This spike exists because "apparently free" is how a feature gets built on a source that cannot
carry it. The questions:

  1. How many weather stations actually report inside each AOI?
  2. **Where** are they? A station is only useful if it is at or near the launch — wind 15 km away
     over a different valley is not this valley's wind.
  3. How often do they beacon?
  4. What exactly is in the payload, byte for byte, before anyone decodes it from memory?

Measured 2026-07-30, and the answer was no: ONE reporting station across a 70 km radius covering
both AOIs, sitting inside neither. Kept in the repo because phase 9a has to ask the same question
of whatever source replaces it, and because the result should be re-checkable rather than believed.

⚠️ Three encoding traps live in this payload, and two of them decode to plausible numbers:
  * wind speed and gust are in MILES PER HOUR — not knots, not m/s;
  * `h00` means 100 % humidity, not 0 %, by APRS convention;
  * `t146` cannot be 146 °F. Tenths of a degree Celsius gives 14.6 °C, which is plausible for the
    altitude and season — but plausible is not documented, and `hbas_sc` in §5.5 is what happens
    when a plausible decode ships. This tool prints the RAW comment for that reason.

Read-only. Sends a login line and nothing else, ever.

Usage
  python tools/ogn/weather_spike.py                              # 90 s, both AOIs covered
  python tools/ogn/weather_spike.py --aoi oberstdorf --radius 40
  python tools/ogn/weather_spike.py --lat 47.5 --lon 10.52 --radius 70 --seconds 90
"""

from __future__ import annotations

import argparse
import json
import re
import socket
import time
from pathlib import Path

APRS_HOST = "aprs.glidernet.org"
APRS_PORT_FILTERED = 14580

ROOT = Path(__file__).resolve().parents[2]

# Centre of the two shipped AOIs, so a 70 km radius covers both at once.
DEFAULT_LAT = 47.50
DEFAULT_LON = 10.52
DEFAULT_RADIUS_KM = 70

# An APRS weather station carries the underscore symbol code, and puts wind in the comment as
# ddd/sssgggg immediately after it. Both are checked: a station may use a different symbol, and a
# station may carry the symbol while reporting nothing at all (".../...g...t..." is a real payload
# seen near the Tegelberg — online, and measuring nothing).
POSITION_RE = re.compile(
    r"^(?P<src>[A-Za-z0-9\-]+)>(?P<dst>[A-Za-z0-9\-]+),(?P<path>[^:]*):"
    r"[/!=@]?(?:\d{6}h)?"
    r"(?P<lat>\d{4}\.\d{2})(?P<ns>[NS])"
    r"(?P<symtab>.)"
    r"(?P<lon>\d{5}\.\d{2})(?P<ew>[EW])"
    r"(?P<symcode>.)"
    r"(?P<rest>.*)$"
)

WIND_RE = re.compile(r"^(?P<dir>\d{3})/(?P<speed>\d{3})g(?P<gust>\d{3})")

MPH_TO_MS = 0.44704


def dm_to_deg(value: str, hemi: str) -> float:
    """APRS degrees-minutes to decimal degrees."""
    cut = 2 if hemi in "NS" else 3
    deg = int(value[:cut])
    minutes = float(value[cut:])
    dec = deg + minutes / 60.0
    return -dec if hemi in "SW" else dec


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import asin, cos, radians, sin, sqrt

    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * 6371.0088 * asin(sqrt(a))


def aoi_centre(aoi: str) -> tuple[float, float, str]:
    """Centre of a shipped AOI's core, read from its config rather than restated here."""
    path = ROOT / "config" / "aoi" / f"{aoi}.json"
    if not path.is_file():
        available = sorted(p.stem for p in (ROOT / "config" / "aoi").glob("*.json"))
        raise SystemExit(f"unknown AOI {aoi!r} — available: {', '.join(available)}")
    cfg = json.loads(path.read_text(encoding="utf-8"))
    box = cfg["bbox"]
    return (
        (box["south"] + box["north"]) / 2,
        (box["west"] + box["east"]) / 2,
        cfg.get("site", {}).get("name", {}).get("de", aoi),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", help="centre on a shipped AOI instead of --lat/--lon")
    parser.add_argument("--lat", type=float, default=DEFAULT_LAT)
    parser.add_argument("--lon", type=float, default=DEFAULT_LON)
    parser.add_argument("--radius", type=float, default=DEFAULT_RADIUS_KM)
    parser.add_argument("--seconds", type=int, default=90)
    args = parser.parse_args()

    lat, lon, label = args.lat, args.lon, "both AOIs"
    if args.aoi:
        lat, lon, label = aoi_centre(args.aoi)

    print(f"{label}: r/{lat:.4f}/{lon:.4f}/{args.radius:.0f} km, listening {args.seconds}s\n")

    stations: dict[str, dict] = {}
    lines = 0
    positions = 0

    sock = socket.create_connection((APRS_HOST, APRS_PORT_FILTERED), timeout=20)
    sock.sendall(
        f"user GSWXSPIKE pass -1 vers gs-weather-spike 1.0 "
        f"filter r/{lat:.4f}/{lon:.4f}/{args.radius:.0f}\r\n".encode()
    )

    deadline = time.time() + args.seconds
    buffer = b""
    try:
        while time.time() < deadline:
            sock.settimeout(max(1.0, deadline - time.time()))
            try:
                chunk = sock.recv(8192)
            except socket.timeout:
                break
            if not chunk:
                break
            buffer += chunk
            *complete, buffer = buffer.split(b"\n")
            for raw in complete:
                line = raw.decode("latin-1").strip()
                if not line or line.startswith("#"):
                    continue
                lines += 1
                match = POSITION_RE.match(line)
                if not match:
                    continue
                positions += 1

                g = match.groupdict()
                rest = g["rest"]
                wind = WIND_RE.match(rest)
                if g["symcode"] != "_" and not wind:
                    continue

                call = g["src"]
                entry = stations.setdefault(
                    call,
                    {"count": 0, "raw": [], "lat": None, "lon": None, "wind": None},
                )
                entry["count"] += 1
                entry["lat"] = dm_to_deg(g["lat"], g["ns"])
                entry["lon"] = dm_to_deg(g["lon"], g["ew"])
                if len(entry["raw"]) < 3:
                    entry["raw"].append(rest[:72])
                if wind:
                    entry["wind"] = {
                        "dirDeg": int(wind["dir"]),
                        "speedMs": int(wind["speed"]) * MPH_TO_MS,
                        "gustMs": int(wind["gust"]) * MPH_TO_MS,
                    }
    finally:
        sock.close()

    print(f"lines {lines}, position packets {positions}, weather stations {len(stations)}\n")
    if not stations:
        print("  none — OGN carries no usable wind here. See PLAN §5.10.")
        return

    for call, s in sorted(stations.items(), key=lambda kv: -kv[1]["count"]):
        where = f"{s['lat']:.4f},{s['lon']:.4f}"
        away = haversine_km(lat, lon, s["lat"], s["lon"])
        if s["wind"]:
            w = (
                f"wind {s['wind']['dirDeg']:3d}° "
                f"{s['wind']['speedMs']:.1f} m/s gust {s['wind']['gustMs']:.1f} m/s"
            )
        else:
            w = "reporting NOTHING (no wind field)"
        print(f"  {call:<12} n={s['count']:<3} {where}  {away:5.1f} km from centre   {w}")
        # Raw, deliberately: every decoded field above is an interpretation, and the traps in this
        # payload are documented at the top of this file.
        for sample in s["raw"]:
            print(f"      raw: {sample}")


if __name__ == "__main__":
    main()

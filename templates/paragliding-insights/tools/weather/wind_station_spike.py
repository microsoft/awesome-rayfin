"""Phase-9a spike — is there a LICENSED wind station near either launch?

PLAN §5.10, decision 27, open question 8. Mode F wants wind AT the launches, and the two obvious
sources both fail, in ways only a measurement shows:

  * **OGN** is ruled out horizontally — `tools/ogn/weather_spike.py` found ONE reporting station in
    a 70 km radius spanning both AOIs, and it sits inside neither.
  * **Holfuy** is the right kind of source but cannot even be SURVEYED by a script: its terms
    forbid collecting weather data or site content automatically without a granted API key, so
    "does a station exist there" and "may we use it" are the same question, and it is a human one.
  * **DWD** needs no permission at all — it is already a source here (§5.5) under GeoNutzV — so the
    only open question is geometric: is a station anywhere near a launch?

This answers that last one. Measured 2026-08-01: the nearest DWD stations are 1 414 m and 907 m
BELOW the two launches, i.e. on the valley floor. Kept in the repo because the answer changes the
moment DWD commissions a station, and because §5.10 quotes these numbers.

⚠️ Distance alone is the wrong test, which is the point of printing the height. Oberstdorf is 5.6 km
from the Nebelhorn launch and looks excellent until you notice it is 806 m up a 2 220 m mountain.
Valley wind is not launch wind, and showing one as the other is exactly the plausible-but-wrong
figure §2.2 exists to prevent.

Read-only: fetches one published station-description file and measures distances.

Usage
  python tools/weather/wind_station_spike.py
"""

from __future__ import annotations

import io
import math
import urllib.request

# 10-minute wind observations, "now" (rolling recent) — the fastest cadence DWD publishes openly.
STATIONS_URL = (
    "https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/"
    "10_minutes/wind/now/zehn_now_ff_Beschreibung_Stationen.txt"
)

# The launches, resolved from OpenStreetMap in earlier phases rather than recalled (§4.2), with the
# elevation the app itself samples from the generated heightmap.
SITES = {
    "Nebelhorn launch (2220 m)": (47.4218727, 10.3423461, 2220),
    "Tegelberg Bergstation (1715 m)": (47.5596223, 10.7789855, 1715),
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * 6371.0088 * math.asin(math.sqrt(a))


def main() -> None:
    request = urllib.request.Request(
        STATIONS_URL, headers={"User-Agent": "gleitschirm-insights/0.2"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    text = raw.decode("latin-1")
    print(f"DWD 10-minute wind station list: {len(raw) / 1024:.0f} KB")

    stations = []
    for line in io.StringIO(text).readlines()[2:]:
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) < 7:
            continue
        try:
            station_id = parts[0]
            height_m = float(parts[3])
            lat = float(parts[4])
            lon = float(parts[5])
        except ValueError:
            continue
        name = " ".join(parts[6:-1]) if len(parts) > 7 else parts[6]
        stations.append((station_id, name, lat, lon, height_m))

    print(f"stations parsed: {len(stations)}\n")

    for site, (lat, lon, launch_m) in SITES.items():
        ranked = sorted(stations, key=lambda s: haversine_km(lat, lon, s[2], s[3]))[:6]
        print(f"=== {site}  ({lat:.4f}, {lon:.4f}) ===")
        print(f"  {'dist':>8}  {'height':>7}  {'vs launch':>10}  station")
        for station_id, name, s_lat, s_lon, height in ranked:
            distance = haversine_km(lat, lon, s_lat, s_lon)
            delta = height - launch_m
            print(f"  {distance:6.1f} km  {height:6.0f} m  {delta:+9.0f} m  {station_id} {name}")
        print()

    print("A station is only useful here if BOTH columns are small. Distance alone is the trap.")


if __name__ == "__main__":
    main()

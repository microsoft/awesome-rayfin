"""Which ICON-D2 parameters exist, on which grid, and which ones a pilot actually cares about.

Follow-up to `spike_icond2.py`. Two things it turned up that need settling before a harvest can be
written:

  1. `hbas_con` is not published under that name, and **cloud base is the number a paraglider pilot
     wants above all others** — "Basis heute 2 900 m" is the headline of a good day.
  2. The example file came back as `icosahedral`, not `regular-lat-lon`. The native ICON grid is
     unstructured and needs a separate grid definition to place its values; a regular lat-lon
     product can be clipped to a bbox with array arithmetic. Which grids exist per parameter
     decides how hard the notebook is.

Usage
  python tools/weather/probe_params.py
"""

from __future__ import annotations

import concurrent.futures
import re
import urllib.request

BASE = "https://opendata.dwd.de/weather/nwp/icon-d2/grib"
USER_AGENT = "Gleitschirm-Insights/0.1 (open data pipeline; +https://opendata.dwd.de)"

# Candidates for the numbers a soaring forecast is made of.
INTERESTING = [
    "cape_ml", "cape_con", "cin_ml",       # thermal strength
    "hbas_con", "htop_con", "ceiling",     # convective cloud base and top
    "hzerocl", "clcl", "clcm", "clct",     # freezing level, cloud layers
    "t_2m", "td_2m", "u_10m", "v_10m",     # surface
    "asob_s", "aswdir_s",                  # radiation — what drives the thermals
    "w_so", "tot_prec", "vmax_10m",
    "u", "v", "t", "w", "fi", "relhum",    # profile parameters
    "p", "qv", "hhl",
]


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - fixed host
        return response.read().decode("utf-8", "replace")


def main() -> None:
    run = sorted(set(re.findall(r'href="(\d\d)/"', fetch(f"{BASE}/"))))[0]
    params = sorted(set(re.findall(r'href="([a-z0-9_]+)/"', fetch(f"{BASE}/{run}/"))))

    print(f"{len(params)} parameters in the {run}Z run\n")

    def describe(param: str) -> tuple[str, str, str] | None:
        if param not in params:
            return None
        files = re.findall(r'href="([^"]+\.grib2\.bz2)"', fetch(f"{BASE}/{run}/{param}/"))
        if not files:
            return None
        grids = set()
        kinds = set()
        for name in files:
            if "regular-lat-lon" in name:
                grids.add("regular-lat-lon")
            elif "icosahedral" in name:
                grids.add("icosahedral")
            for kind in ("single-level", "pressure-level", "model-level", "time-invariant"):
                if kind in name:
                    kinds.add(kind)
        # Levels, for the parameters that have them.
        levels = sorted({m.group(1) for f in files if (m := re.search(r"_(\d{3,4})_[a-z]", f))})
        return (
            ", ".join(sorted(grids)),
            ", ".join(sorted(kinds)),
            f"{len(files)} files" + (f", {len(levels)} levels" if len(levels) > 6 else ""),
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(describe, INTERESTING))

    print(f"{'parameter':<12}{'grid':<34}{'kind':<18}{'files'}")
    print("-" * 82)
    for param, result in zip(INTERESTING, results):
        if result is None:
            print(f"{param:<12}{'— not published —':<34}")
            continue
        grid, kind, count = result
        print(f"{param:<12}{grid:<34}{kind:<18}{count}")

    print("\nAll published parameters:")
    for i in range(0, len(params), 8):
        print("  " + "  ".join(f"{p:<12}" for p in params[i : i + 8]))


if __name__ == "__main__":
    main()

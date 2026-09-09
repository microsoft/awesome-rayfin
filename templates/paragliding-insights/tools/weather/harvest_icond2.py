"""Harvest ICON-D2 over the AOI — PLAN §5.5 track 2, phase 5.

DWD publishes ICON-D2 as a rolling ~24-hour window, never an archive. So there is no way to fetch
the wind over the Nebelhorn for April 2021, and no amount of engineering will invent one — §2.2.6
forbids trying. What *is* possible is to start keeping it: from the first run harvested, this
project has an archive, and it grows by a day every day.

⚠️ **The parameter set is the design.** `spike_icond2.py` measured the naive harvest — 20 model
levels × 5 parameters × 49 steps — at **23.9 GB/day**, which is a bill rather than a demo. This
takes the ten single-level parameters a soaring day is actually made of, plus a coarse wind profile
from five pressure levels three-hourly, over the flyable window only: **181 MB/day, 250 files**.
132× cheaper, and it answers more of the questions a pilot asks.

`hbas_sc` is the one that matters most — the base of shallow convection, which is cumulus base,
which is *"Basis heute 2 900 m"*. PLAN §5.5 guessed at `hbas_con`; DWD does not publish that.

What lands is a tidy long table, one row per parameter per forecast step, holding the AOI's mean,
minimum and maximum. The full grid is not kept: the AOI is ~1/9000 of the ICON-D2 domain and a
single-cell value over a mountain is noise, so the spread across the box is more honest than a
point sample pretending to be a station reading.

Usage
  python tools/weather/harvest_icond2.py --dry-run
  python tools/weather/harvest_icond2.py
  python tools/weather/harvest_icond2.py --max-steps 3        # quick check
"""

from __future__ import annotations

import argparse
import bz2
import concurrent.futures
import csv
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

BASE = "https://opendata.dwd.de/weather/nwp/icon-d2/grib"
USER_AGENT = "Gleitschirm-Insights/0.1 (open data pipeline; +https://opendata.dwd.de)"
ROOT = Path(__file__).resolve().parents[2]

# ── What to harvest ────────────────────────────────────────────────────────────
# Ten single-level parameters, hourly over the flyable window. These are what decides whether a day
# is worth driving to the mountain for.
SINGLE_LEVEL = {
    "hbas_sc": "Wolkenbasis (Basis flacher Konvektion)",
    "htop_sc": "Wolkenobergrenze",
    "cape_ml": "CAPE (Thermikstärke)",
    "cin_ml": "CIN (Auslösetemperatur-Sperre)",
    "clct": "Gesamtbedeckung",
    "t_2m": "Temperatur 2 m",
    "u_10m": "Wind Ost-Komponente 10 m",
    "v_10m": "Wind Nord-Komponente 10 m",
    "vmax_10m": "Böen 10 m",
    "hzerocl": "Nullgradgrenze",
}

# A coarse wind profile. Five levels from the valley floor to well above the summit, three-hourly:
# enough to see whether the wind backs or veers with height, which is what decides a flight, and
# nowhere near the per-level cost of a model-level harvest.
#
# ⚠️ These are the levels DWD **actually publishes** — 1000, 975, 950, 850, 700, 600, 500, 400, 300,
# 250, 200 hPa. An obvious-looking set (1000/950/900/850/700) quietly 404s on 900, which the harvest
# survives but which silently costs a level in the middle of the range that matters most here.
# Roughly: 1000 ≈ valley floor, 950 ≈ 550 m, 850 ≈ 1500 m (launch), 700 ≈ 3000 m (above the ceiling).
PRESSURE_LEVELS = [1000, 975, 950, 850, 700]
PRESSURE_PARAMS = {"u": "Wind Ost-Komponente", "v": "Wind Nord-Komponente", "t": "Temperatur"}

# ICON-D2 forecasts 48 h. A soaring day is over by early evening, and a run harvested at 03Z that
# reaches 15 h covers it — so the window is where the budget goes, not the tail.
FLYABLE_STEPS = range(0, 16)
PROFILE_STEPS = range(0, 16, 3)

# ⚠️ **Parameters where zero means "not there", not "at ground level".**
#
# Caught by reading the first harvest rather than by trusting it: `hbas_sc` came back with a mean of
# **113 m** over the AOI and a maximum of 3 234 m. The mean was not a cloud base — it was mostly
# cells with no shallow convection at all, reported as 0 and then averaged in as though the cloud
# base were on the deck. Mode D would have announced *"Basis heute 113 m"* on a day with cumulus at
# 3 200 m, which is precisely the kind of confidently-wrong number §2.2.6 exists to prevent.
#
# So for these, the mean is taken over the cells where the parameter is actually defined, and the
# fraction of the AOI that had any is carried alongside as `coverage`. Two thirds of the box under
# cumulus at 2 800 m is a different day from a single cell at 2 800 m, and the table now says which.
ZERO_MEANS_ABSENT = {"hbas_sc", "htop_sc"}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310 - fixed host
        return response.read()


def latest_run() -> tuple[str, datetime]:
    """The most recent run that is actually complete enough to read.

    ⚠️ Not simply "the newest directory". DWD publishes a run's files as they are produced, so the
    newest directory is usually a run still being written — half its steps are missing and the
    harvest silently lands a partial day. Stepping back one run costs three hours of freshness and
    removes a whole class of intermittent gap.
    """
    listing = fetch(f"{BASE}/").decode("utf-8", "replace")
    runs = sorted(set(re.findall(r'href="(\d\d)/"', listing)))
    if not runs:
        raise SystemExit("no runs published — the layout has changed")

    now = datetime.now(timezone.utc)
    # Runs are 00, 03, … 21. Take the one before the most recent boundary.
    hour = (now.hour // 3) * 3 - 3
    when = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(hours=hour)
    if hour < 0:
        when = now.replace(hour=21, minute=0, second=0, microsecond=0) - timedelta(days=1)
    return f"{when.hour:02d}", when


def grib_name(run_stamp: str, kind: str, param: str, step: int, level: int | None) -> str:
    stem = f"icon-d2_germany_regular-lat-lon_{kind}_{run_stamp}_{step:03d}"
    if level is None:
        return f"{stem}_2d_{param}.grib2.bz2"
    return f"{stem}_{level}_{param}.grib2.bz2"


def read_grib(blob: bytes, bbox: dict, parameter: str) -> tuple[float, float, float, int, float] | None:
    """Mean, min, max, cell count and coverage of one GRIB2 message inside the AOI.

    eccodes directly rather than cfgrib/xarray: this needs three arrays and a boolean mask, and the
    xarray stack would be a large dependency to express `values[mask].mean()`.

    ⚠️ **Decoded from memory, and never from more than one thread.** Both of those are scars:

    * `codes_new_from_message` avoids a temp file, because on Windows eccodes keeps the handle open
      past `codes_release` and the unlink fails with a sharing violation.
    * The eccodes C library is **not thread-safe**. Decoding on six worker threads produced
      `No final 7777 in message!` on files that were provably intact — one had been checked by hand,
      magic `GRIB`, tail `7777`. It was not corrupt data; it was two threads inside the parser.
      Downloads still run in parallel, because that part is I/O and is where the time goes.
    """
    import eccodes  # imported here so --dry-run works without it

    raw = bz2.decompress(blob)

    # ⚠️ An eccodes assertion failure **aborts the process**, taking a scheduled harvest with it, so
    # a malformed message has to be rejected before it is handed over rather than after.
    if not raw.startswith(b"GRIB") or not raw.rstrip().endswith(b"7777"):
        return None

    gid = eccodes.codes_new_from_message(raw)
    try:
        lats = eccodes.codes_get_array(gid, "latitudes")
        lons = eccodes.codes_get_array(gid, "longitudes")
        values = eccodes.codes_get_array(gid, "values")
        missing = eccodes.codes_get_double(gid, "missingValue")
    finally:
        eccodes.codes_release(gid)

    mask = (
        (lons >= bbox["west"])
        & (lons <= bbox["east"])
        & (lats >= bbox["south"])
        & (lats <= bbox["north"])
        & (values != missing)
    )
    inside = values[mask]
    if inside.size == 0:
        return None

    # For the convection parameters, zero means "no cumulus here" and must not be averaged in as an
    # altitude. See ZERO_MEANS_ABSENT.
    present = inside[inside > 0] if parameter in ZERO_MEANS_ABSENT else inside
    coverage = float(present.size / inside.size)
    if present.size == 0:
        # Honest zero: nothing was there. Reported rather than dropped, because "no cumulus at 17Z"
        # is a fact about the day and an absent row would look like a failed download.
        return 0.0, 0.0, 0.0, int(inside.size), 0.0

    return (
        float(np.mean(present)),
        float(np.min(present)),
        float(np.max(present)),
        int(inside.size),
        coverage,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="oberstdorf")
    parser.add_argument("--out", type=Path, default=Path("data/curated"))
    parser.add_argument("--max-steps", type=int, default=None, help="shorten the window, for a quick check")
    parser.add_argument("--dry-run", action="store_true", help="list what would be fetched, fetch nothing")
    args = parser.parse_args()

    config = json.loads((ROOT / "config" / "aoi" / f"{args.aoi}.json").read_text(encoding="utf-8"))
    bbox = config["shell"]

    run_hour, run_when = latest_run()
    run_stamp = f"{run_when:%Y%m%d}{run_hour}"
    print(f"run {run_stamp}  ·  AOI {args.aoi} {bbox['west']}–{bbox['east']}E {bbox['south']}–{bbox['north']}N")

    steps = list(FLYABLE_STEPS)
    profile_steps = list(PROFILE_STEPS)
    if args.max_steps:
        steps = steps[: args.max_steps]
        profile_steps = [s for s in profile_steps if s in steps]

    jobs: list[tuple[str, str, int, int | None, str]] = []
    for param in SINGLE_LEVEL:
        for step in steps:
            jobs.append((param, "single-level", step, None, f"{BASE}/{run_hour}/{param}/{grib_name(run_stamp, 'single-level', param, step, None)}"))
    for param in PRESSURE_PARAMS:
        for level in PRESSURE_LEVELS:
            for step in profile_steps:
                jobs.append((param, "pressure-level", step, level, f"{BASE}/{run_hour}/{param}/{grib_name(run_stamp, 'pressure-level', param, step, level)}"))

    print(f"{len(jobs)} files to fetch")
    if args.dry_run:
        for job in jobs[:5]:
            print(f"  {job[4]}")
        print(f"  … and {len(jobs) - 5} more")
        return

    rows: list[dict] = []
    failures = 0

    def download(job: tuple[str, str, int, int | None, str]) -> tuple[tuple, bytes | None]:
        try:
            return job, fetch(job[4])
        except urllib.error.HTTPError as exc:
            # A missing file is normal near the head of a run and must not fail the harvest — the
            # archive is built from what arrives, and a gap is recorded by absence rather than by
            # a fabricated value.
            print(f"  · {exc.code} {job[0]} {job[1]} step {job[2]:03d} level {job[3]}")
            return job, None
        except OSError as exc:
            print(f"  · {exc} {job[0]} step {job[2]:03d}")
            return job, None

    # Download in parallel — that is where the wall clock goes — and decode serially, because
    # eccodes is not thread-safe. See `read_grib`.
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for job, blob in pool.map(download, jobs):
            param, kind, step, level, _ = job
            if blob is None:
                failures += 1
                continue
            stats = read_grib(blob, bbox, param)
            if stats is None:
                failures += 1
                continue
            mean, low, high, cells, coverage = stats
            rows.append(
                {
                    "run_ts": f"{run_when:%Y-%m-%dT%H:00:00Z}",
                    "valid_ts": f"{run_when + timedelta(hours=step):%Y-%m-%dT%H:00:00Z}",
                    "step_h": step,
                    "parameter": param,
                    "level_hpa": level if level is not None else "",
                    "aoi": args.aoi,
                    "mean": round(mean, 3),
                    "min": round(low, 3),
                    "max": round(high, 3),
                    "cells": cells,
                    "coverage": round(coverage, 4),
                }
            )

    if not rows:
        raise SystemExit("nothing harvested")

    rows.sort(key=lambda r: (r["parameter"], str(r["level_hpa"]), r["step_h"]))
    args.out.mkdir(parents=True, exist_ok=True)
    target = args.out / "weather.csv"

    # Append across runs: the point of this table is that it accumulates.
    existing: list[dict] = []
    if target.exists():
        with target.open(encoding="utf-8", newline="") as handle:
            existing = [r for r in csv.DictReader(handle) if r["run_ts"] != rows[0]["run_ts"]]

    with target.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(existing)
        writer.writerows(rows)

    print(f"\n{len(rows)} rows harvested, {failures} unavailable → {target} ({len(existing) + len(rows)} total)")

    base = [r for r in rows if r["parameter"] == "hbas_sc" and r["coverage"] > 0.02]
    if base:
        best = max(base, key=lambda r: r["mean"])
        print(
            f"  cloud base peaks at {best['mean']:.0f} m mean "
            f"({best['max']:.0f} m max) over {best['coverage'] * 100:.0f}% of the AOI"
            f" at {best['valid_ts']}"
        )
    else:
        print("  no shallow convection in the AOI during this window — a real answer, not a gap")


if __name__ == "__main__":
    sys.exit(main())

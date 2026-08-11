"""Phase-5 spike — what does harvesting ICON-D2 actually cost?

PLAN §5.5 flags this as the thing to measure **before** scheduling anything, and the reason is
specific: the *stored* volume of an AOI subset is trivial (~1–3 MB/day), but ICON-D2 is published
as one compressed GRIB2 file per parameter, per level, per forecast step. Pulling 20 model levels ×
5 parameters × 24 steps means ~2 400 downloads a day to keep a few megabytes. The transfer is the
cost, not the storage, and a scheduled Pipeline that quietly moves tens of gigabytes a day is not a
demo, it is a bill.

So this measures the real thing: it discovers what DWD is publishing right now, HEAD-probes actual
file sizes, and prices several harvest strategies against each other. Nothing is downloaded.

Usage
  python tools/weather/spike_icond2.py
"""

from __future__ import annotations

import concurrent.futures
import re
import urllib.error
import urllib.request

BASE = "https://opendata.dwd.de/weather/nwp/icon-d2/grib"
USER_AGENT = "Gleitschirm-Insights/0.1 (open data pipeline; +https://opendata.dwd.de)"

# ICON-D2 runs every three hours and forecasts 48 h hourly.
RUNS_PER_DAY = 8

# The parameters a paragliding day is actually made of. Wind aloft is the obvious one; the rest is
# what tells you whether the day works at all.
#
# ⚠️ `hbas_sc` — **base of shallow convection** — is the cloud base, and it is the single number a
# pilot wants ("Basis heute 2 900 m"). PLAN §5.5 guessed at `hbas_con`, which DWD does not publish;
# the convective parameters are named for *shallow* convection, which is precisely the cumulus a
# thermal day is made of. Found by listing the 129 published parameters rather than by guessing
# twice — see `probe_params.py`.
PARAGLIDING_SINGLE = [
    "hbas_sc",    # cloud base
    "htop_sc",    # cloud top
    "cape_ml",    # thermal strength
    "cin_ml",     # inhibition — whether it triggers at all
    "clct",       # total cloud — overdevelopment
    "t_2m",
    "u_10m",
    "v_10m",
    "vmax_10m",   # gusts — flyability
    "hzerocl",    # freezing level
]
PARAGLIDING_PRESSURE = ["u", "v", "t"]


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - fixed host
        return response.read().decode("utf-8", "replace")


def size_of(url: str) -> int:
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            return int(response.headers.get("Content-Length", 0))
    except (urllib.error.HTTPError, OSError):
        return 0


def listing(url: str, pattern: str) -> list[str]:
    return sorted(set(re.findall(pattern, fetch(url))))


def mb(value: float) -> str:
    return f"{value / 1e6:,.1f} MB"


def gb(value: float) -> str:
    return f"{value / 1e9:,.2f} GB"


def main() -> None:
    runs = listing(f"{BASE}/", r'href="(\d\d)/"')
    if not runs:
        raise SystemExit("no runs listed — the layout has changed")
    run = runs[0]
    print(f"runs published: {', '.join(runs)}   probing {run}Z\n")

    params = listing(f"{BASE}/{run}/", r'href="([a-z0-9_]+)/"')
    print(f"{len(params)} parameters available")

    have_single = [p for p in PARAGLIDING_SINGLE if p in params]
    missing = [p for p in PARAGLIDING_SINGLE if p not in params]
    print(f"  paragliding single-level present: {', '.join(have_single)}")
    if missing:
        print(f"  ⚠️ not published under these names: {', '.join(missing)}")

    # Sample one parameter's directory to learn the filename grammar and the step count.
    sample_param = have_single[0] if have_single else params[0]
    files = listing(f"{BASE}/{run}/{sample_param}/", r'href="([^"]+\.grib2\.bz2)"')
    steps = sorted({m.group(1) for f in files if (m := re.search(r"_(\d{3})_", f))})
    print(f"  forecast steps: {len(steps)} ({steps[0]}…{steps[-1]})")
    print(f"  example: {files[0]}")

    # ── Measure real file sizes ────────────────────────────────────────────
    print("\nmeasuring actual file sizes …")
    probes: dict[str, int] = {}

    def probe(param: str, kind: str) -> None:
        found = listing(f"{BASE}/{run}/{param}/", r'href="([^"]+\.grib2\.bz2)"')
        if not found:
            return
        # A mid-range step: step 000 is often smaller than a developed forecast.
        pick = found[min(6, len(found) - 1)]
        probes[f"{kind}:{param}"] = size_of(f"{BASE}/{run}/{param}/{pick}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda p: probe(p, "single"), have_single))
        list(pool.map(lambda p: probe(p, "level"), [p for p in PARAGLIDING_PRESSURE if p in params]))

    for key, size in sorted(probes.items()):
        print(f"  {key:<20} {mb(size)}")

    single_avg = sum(v for k, v in probes.items() if k.startswith("single:")) / max(
        1, len([k for k in probes if k.startswith("single:")])
    )
    level_avg = sum(v for k, v in probes.items() if k.startswith("level:")) / max(
        1, len([k for k in probes if k.startswith("level:")])
    )
    n_steps = len(steps)

    print(f"\n  mean single-level file: {mb(single_avg)}")
    print(f"  mean level file:        {mb(level_avg)}   (one parameter, one level, one step)")

    # ── Price the strategies ───────────────────────────────────────────────
    # ⚠️ A level file on DWD covers ONE level, so a wind profile multiplies by the level count. That
    # multiplication is the whole reason this spike exists.
    print("\n" + "=" * 76)
    print(f"{'strategy':<44}{'files/run':>10}{'per run':>11}{'per day':>11}")
    print("=" * 76)

    def row(label: str, files_per_run: int, bytes_per_run: float) -> None:
        print(
            f"{label:<44}{files_per_run:>10,}{mb(bytes_per_run):>11}"
            f"{gb(bytes_per_run * RUNS_PER_DAY):>11}"
        )

    # What PLAN §5.5 feared.
    row("A  20 model levels × 5 params × all steps", 20 * 5 * n_steps, 20 * 5 * n_steps * level_avg)

    # Wind profile from pressure levels, every step, every run.
    row("B  8 pressure levels × u,v,t × all steps", 8 * 3 * n_steps, 8 * 3 * n_steps * level_avg)

    # The flyable window only: steps 0–15 h covers a whole day of soaring from one 00Z run.
    flyable = min(16, n_steps)
    row("C  B, but only the flyable window (0–15 h)", 8 * 3 * flyable, 8 * 3 * flyable * level_avg)

    # Single-level convection parameters — the ones that say whether a day works.
    row(f"D  {len(have_single)} single-level params × all steps", len(have_single) * n_steps, len(have_single) * n_steps * single_avg)

    # The recommendation: convection params plus a coarse wind profile, flyable window, one run/day.
    recommended_files = len(have_single) * flyable + 5 * 3 * (flyable // 3 + 1)
    recommended_bytes = len(have_single) * flyable * single_avg + 5 * 3 * (flyable // 3 + 1) * level_avg
    print("-" * 76)
    print(
        f"{'E  RECOMMENDED — D + 5 levels × u,v,t 3-hourly':<44}"
        f"{recommended_files:>10,}{mb(recommended_bytes):>11}{gb(recommended_bytes):>11}"
    )
    print("   (one run per day, so per-day equals per-run)")
    print("=" * 76)

    print(
        "\nNote: these are compressed transfer sizes for the WHOLE ICON-D2 domain. The AOI is about"
        "\n0.2° × 0.13°, roughly 1/9000 of it, so what is *kept* after clipping is a rounding error"
        "\neither way. The number that matters is the download, and it is the level count that drives"
        "\nit — which is why the recommendation spends its budget on convection parameters and takes"
        "\nthe wind profile coarse."
    )


if __name__ == "__main__":
    main()

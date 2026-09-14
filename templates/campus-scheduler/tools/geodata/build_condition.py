"""Generate the Sanierungsstau model — PLAN Phase 7.

⚠️ **EVERY NUMBER THIS PRODUCES IS INVENTED.** No German university publishes its renovation
backlog per building, and quietly inventing one for a named real university is the single most
reputationally dangerous thing this app could do. So it is not quiet: the output is stamped
`"provenance": "synthetic"`, the UI badges it permanently, and this file is the rule that produced
every figure. A reader who wants to know where €47 m came from can follow it here and re-run it.

What is nevertheless *measured*, and worth keeping separate in your head:

  * **footprint area** — from the LoD2 mesh, as half the summed absolute XZ-projected area of its
    triangles. For a closed solid that is exactly roof + floor, and walls project to zero, so the
    halving gives the footprint without needing the ground polygon.
  * **height and storey count** — from the mesh and the measured ground elevation.

Everything downstream of those two — the Zustandsnote, the cost per square metre, the usage
intensity, the energy figure, the heritage flag, the budget and the decay — is drawn from the
seeded generator configured in `config/aoi/<id>.json`. Same seed, same numbers, every run.

The distribution is deliberately unflattering. German university building stock is widely
discussed as skewing to grades 3–4, and a demo that showed a healthy estate would be both less
useful and less honest about why the conversation exists.

⚠️ **BUILDING AGE IS NOT AN INPUT, AND THAT IS A MEASUREMENT, NOT AN OVERSIGHT.**
Campus-Insights' PLAN §Phase 7 lists "baseline from OSM `start_date`" under *Original plan*, and
the generator that shipped never used it. Asked again on 2026-08-03, and the answer is that age is
not available to use:

  * CityGML `bldg:yearOfConstruction` — **0 of 1 483** Tübingen buildings and **0 of 2 279** at
    Garching. Neither the LGL nor the LDBV publishes it. What BW does carry is
    `Grundrissaktualitaet`, which dates the SURVEY, not the building.
  * OpenStreetMap `start_date` / `building:start_date` / `year_of_construction` — **53 of 6 034
    (0.9 %)** in the Tübingen core, **8 of 304 (2.6 %)** at Garching. A heritage or historic tag
    appears on 0.3 %.

That is the same coverage class as `building:colour`, which this project already rejected as
unusable (see PLAN §5.11). Deriving a Zustandsnote from age at 0.9 % coverage would mean inventing
the age for the other 99.1 % and then presenting the result as if it were grounded — a worse lie
than the honest draw below, because it would look researched. If a real Baualter list ever arrives
from a Bauamt, it belongs here as a genuine baseline; until then the grade is a distribution and
says so.

⚠️ **THIS FILE WAS DROPPED IN THE ENGINE FORK AND HAD TO BE BROUGHT BACK.** Campus-Scheduler
shipped Tübingen's `condition.json` as an asset copied from Campus-Insights with no generator
behind it, so the one lens that site has could not be regenerated — and the copy had been computed
against a mesh that still contained `lod2TerrainIntersection` slivers, which the footprint maths
below is not valid for (see the note on halving).

Output (public/terrain/<aoi>/):
  condition.json   per-building grade, floor area, cost and per-scenario renovation year

Usage
  python tools/geodata/build_condition.py --aoi tuebingen
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct

import numpy as np

from aoi import load_aoi, terrain_dir

#: Metres of storey height used to turn a measured building height into a floor count.
STOREY_HEIGHT_M = 3.2

#: Yearly probability that an un-renovated building loses a grade, by its current grade. Buildings
#: already in poor condition decay faster, which is the whole argument for acting early.
DECAY_BY_GRADE = {1: 0.010, 2: 0.020, 3: 0.035, 4: 0.045, 5: 0.0}


def stream(seed: int, key: str) -> np.random.Generator:
    """A named, independent random stream.

    Deriving each stream from the seed *and* a name means adding a new synthetic attribute later
    does not shift the values of the existing ones — the Zustandsnoten stay put when an energy
    model is added beside them. Without this, every figure in the demo changes whenever the
    generator grows, and screenshots stop matching the app.
    """
    digest = hashlib.sha256(f"{seed}:{key}".encode()).digest()
    return np.random.default_rng(int.from_bytes(digest[:8], "big"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="tuebingen")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    condition_cfg = cfg.get("condition")
    if not condition_cfg:
        raise SystemExit(f"AOI '{cfg['id']}' declares no `condition` block — nothing to generate")

    out_dir = terrain_dir(cfg)
    meta_path = out_dir / "buildings_lod2.json"
    if not meta_path.exists():
        raise SystemExit(f"{meta_path} not found — run build_lod2_mesh.py first")

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    buildings = meta["buildings"]

    # ⚠️ REFUSE A MESH THE FOOTPRINT MATHS IS NOT VALID FOR. Halving the summed |XZ| area only
    # gives the footprint if the solid holds exactly two horizontal sheets, roof and ground. A
    # build made before surfaces were split by CityGML semantics also fan-triangulates
    # `lod2TerrainIntersection`, a third sheet at ground level, and every figure downstream comes
    # out ~1.5x too large. That is not a hypothesis: Tübingen's shipped condition.json claimed
    # 882.9 ha of BGF and a EUR 7.37 bn backlog, and the same generator on the corrected mesh says
    # 579.9 ha and EUR 4.83 bn — a ratio of 1.523 against the 1.5 the artefact predicts.
    # `roofVertexStart` is written only by the semantic build, so its absence is the tell.
    if buildings and "roofVertexStart" not in buildings[0]:
        raise SystemExit(
            f"{meta_path} was built before roof and wall surfaces were separated, so its solids "
            "carry a terrain-intersection sheet and the footprint would come out ~1.5x too large "
            "— re-run tools/geodata/build_lod2_mesh.py first"
        )

    quant = meta["quantisation"]
    xz_scale = float(quant["xzScaleM"])
    y_scale = float(quant["yScaleM"])
    y_offset = float(quant["yOffsetM"])

    payload = (out_dir / "buildings_lod2.bin").read_bytes()
    n = int(meta["vertexCount"])
    qx = np.frombuffer(payload, dtype="<i2", count=n, offset=0).astype(np.float64) * xz_scale
    qy = np.frombuffer(payload, dtype="<u2", count=n, offset=n * 2).astype(np.float64)
    qz = np.frombuffer(payload, dtype="<i2", count=n, offset=n * 4).astype(np.float64) * xz_scale
    ys = y_offset + qy * y_scale

    count = len(buildings)
    print(f"{count} buildings, {n:,} vertices")

    # ── measured geometry ───────────────────────────────────────────────────
    footprint = np.zeros(count)
    height = np.zeros(count)
    for i, b in enumerate(buildings):
        start, length = int(b["vertexStart"]), int(b["vertexCount"])
        x = qx[start : start + length]
        y = ys[start : start + length]
        z = qz[start : start + length]
        # Shoelace per triangle in the XZ plane; walls contribute ~0, roof and floor cancel signs,
        # so half the absolute sum is the footprint.
        #
        # ⚠️ THAT HALVING ASSUMES THE MESH HOLDS EXACTLY TWO HORIZONTAL SHEETS. It did not when
        # this AOI's `condition.json` was first written: the old build fan-triangulated
        # `lod2TerrainIntersection` as well, a THIRD horizontal ring at ground level, so every
        # building's footprint — and with it its BGF, its cost and the entire backlog — came out
        # inflated. Re-run this after any change to build_lod2_mesh.py, and treat a large jump in
        # `totalBgfM2` as the mesh changing shape rather than as the estate changing size.
        ax, az = x[0::3], z[0::3]
        bx, bz = x[1::3], z[1::3]
        cx, cz = x[2::3], z[2::3]
        area = np.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) * 0.5
        footprint[i] = area.sum() * 0.5
        height[i] = max(float(y.max()) - float(b["groundElevM"]), 2.5)

    storeys = np.maximum(1, np.rint(height / STOREY_HEIGHT_M)).astype(int)
    bgf = footprint * storeys
    print(f"measured: footprint {footprint.sum() / 1e4:.1f} ha, BGF {bgf.sum() / 1e4:.1f} ha")

    # ── synthetic attributes ────────────────────────────────────────────────
    seed = int(condition_cfg["seed"])
    grades_scale = list(condition_cfg["gradeScale"])
    distribution = np.array(condition_cfg["gradeDistribution"], dtype=float)
    distribution = distribution / distribution.sum()

    grade = stream(seed, "zustandsnote").choice(grades_scale, size=count, p=distribution)
    intensity = stream(seed, "nutzungsintensitaet").random(count)
    energy = stream(seed, "energiekennwert").random(count)
    heritage = (stream(seed, "denkmalschutz").random(count) < 0.22).astype(int)

    cost_by_grade = {int(k): float(v) for k, v in condition_cfg["costPerM2ByGrade"].items()}
    cost = np.array([bgf[i] * cost_by_grade[int(grade[i])] for i in range(count)])

    weights = condition_cfg["priorityWeights"]
    priority = (
        weights["condition"] * ((grade - 1) / 4.0)
        + weights["usageIntensity"] * intensity
        + weights["energy"] * energy
        + weights["heritage"] * heritage
    )

    print(f"synthetic: backlog EUR {cost.sum() / 1e6:.1f} m, {int(heritage.sum())} listed")

    # ── scenarios ───────────────────────────────────────────────────────────
    from_year = int(condition_cfg["horizonYears"]["from"])
    to_year = int(condition_cfg["horizonYears"]["to"])
    years = list(range(from_year, to_year + 1))
    budget = float(condition_cfg.get("annualBudgetEur") or cost.sum() * 0.04)

    decay_rng = stream(seed, "verfall")
    # One decay draw per building per year, fixed up front so every scenario decays identically —
    # otherwise the scenarios differ by luck as well as by policy and cannot be compared.
    decay_rolls = decay_rng.random((len(years), count))

    scenarios: dict[str, dict] = {}
    for name in condition_cfg["scenarios"]:
        current = grade.astype(float).copy()
        renovated_year = np.zeros(count, dtype=int)
        curve = []
        cumulative = 0.0

        # `gleichverteilt` works through the stock in a fixed arbitrary order rather than by need;
        # `priorisiert` works by the priority score. That contrast is the point of the lens.
        order = np.argsort(-priority) if name == "priorisiert" else np.arange(count)
        pointer = 0

        for index, year in enumerate(years):
            spent = 0.0
            if name != "nichtstun":
                while pointer < count and spent < budget:
                    target = int(order[pointer])
                    if renovated_year[target]:
                        pointer += 1
                        continue
                    price = bgf[target] * cost_by_grade[int(round(current[target]))]
                    if price <= 0:
                        pointer += 1
                        continue
                    if spent + price > budget and spent > 0:
                        break
                    spent += price
                    current[target] = 1
                    renovated_year[target] = year
                    pointer += 1

            # Everything not yet renovated keeps ageing.
            for g, probability in DECAY_BY_GRADE.items():
                ageing = (np.rint(current) == g) & (renovated_year == 0)
                current[ageing & (decay_rolls[index] < probability)] += 1
            current = np.clip(current, 1, 5)

            backlog = float(
                sum(bgf[i] * cost_by_grade[int(round(current[i]))] for i in range(count))
            )
            cumulative += spent
            poor = np.rint(current) >= 4
            # ⚠️ Three different answers to "how bad is it", because they do not agree and the
            # disagreement is the point of the lens.
            #
            # A headcount flatters whichever policy renovates the most BUILDINGS, which is always
            # the one that picks the cheapest. Floor area asks how much of the estate is affected.
            # The intensity-weighted share asks how much of the estate people are actually IN —
            # which is the only one of the three that reflects why anyone prioritises rather than
            # spreading the money evenly.
            curve.append(
                {
                    "year": year,
                    "backlogEur": round(backlog),
                    "spentEur": round(spent),
                    "cumulativeEur": round(cumulative),
                    "sharePoor": round(float(poor.mean()), 4),
                    "poorBgfM2": round(float(bgf[poor].sum())),
                    "poorWeighted": round(
                        float((bgf * intensity)[poor].sum() / (bgf * intensity).sum()), 4
                    ),
                    "renovated": int((renovated_year > 0).sum()),
                }
            )

        scenarios[name] = {
            "renovatedYear": renovated_year.tolist(),
            "curve": curve,
        }
        last = curve[-1]
        print(
            f"  {name:<15} {last['renovated']:>5} renovated, "
            f"backlog EUR {last['backlogEur'] / 1e6:>6.1f} m, "
            f"{last['sharePoor']:.1%} of buildings and {last['poorWeighted']:.1%} of used floor "
            f"area at grade 4+"
        )

    (out_dir / "condition.json").write_text(
        json.dumps(
            {
                "aoi": cfg["id"],
                "provenance": "synthetic",
                "syntheticWarning": (
                    "⚠️ ALL condition, cost and scenario figures are INVENTED by "
                    "tools/geodata/build_condition.py from the seeded generator in "
                    "config/aoi/<id>.json. They are NOT a statement about the real University of "
                    "Tübingen, which publishes no such data. Only floor area and storey count are "
                    "derived from measured LoD2 geometry."
                ),
                "seed": seed,
                "buildingCount": count,
                "gradeDistribution": distribution.round(4).tolist(),
                "costPerM2ByGrade": cost_by_grade,
                "priorityWeights": weights,
                "annualBudgetEur": round(budget),
                "years": years,
                "totalBgfM2": round(float(bgf.sum())),
                "totalBacklogEur": round(float(cost.sum())),
                "grade": grade.astype(int).tolist(),
                "bgfM2": np.rint(bgf).astype(int).tolist(),
                "costEur": np.rint(cost).astype(int).tolist(),
                "priority": np.round(priority, 3).tolist(),
                "heritage": heritage.tolist(),
                "scenarios": scenarios,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    size = (out_dir / "condition.json").stat().st_size
    print(f"\nwrote {out_dir / 'condition.json'} ({size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()

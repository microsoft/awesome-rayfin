"""Generate the university registry: the top N by enrolment, plus the campuses already built.

Source: DESTATIS GENESIS (CC-BY), WS 2024/25, via the extract Hochschul-Insights already carries.
Attribution: Statistisches Bundesamt (Destatis), Hochschulstatistik.

Usage
  python tools/data/top_universities.py                 # writes config/universities.json
  python tools/data/top_universities.py --top 30 --check-only

⚠️ RANKING BY `Hochschule_Code` IS WRONG AND LOOKS FINE. DESTATIS issues one code PER SITE, so TUM
appears three times (München 24 705, Garching 23 067, Weihenstephan 4 895) and ranks 24th and 30th
when as one institution it is FIRST. Neither obvious grouping key is sufficient:

  * `Parent_University` is populated only for private chains (IU, Fresenius) — empty for every
    public university.
  * the `(siehe HS1310)` / `(2001-2016 HS1630)` cross-reference appears on SOME sites only;
    Garching and Straubing carry none.

The key that works is the **5-character code prefix** (`HS163*`). It is verified rather than
trusted: any group whose member names disagree is reported, and 17 of 427 flagged groups were all
checked to be genuinely one institution — DESTATIS abbreviates inconsistently ("TU München" vs
"Technische Universität München"), which is exactly what the check is meant to surface.

⚠️ ONLINE PROVIDERS ARE EXCLUDED, AND THE LARGEST ENROLMENT IN GERMANY IS ONE. IU Internationale
Hochschule has 123 509 students over 21 registered sites and would rank first; Fernuniversität
Hagen has 63 410. Their students are overwhelmingly not on a campus, so including them would fill
the twin with buildings nobody attends. They are recorded in the output under `excluded` rather
than dropped, because both DO have physical sites and the decision is meant to be revisitable per
site.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

#: The Hochschul-Insights extract of DESTATIS GENESIS. A sibling checkout, so it is a default
#: rather than a hard dependency — `--source` overrides it.
DEFAULT_SOURCE = (
    ROOT.parent / "Hochschul-Insights" / "webapp" / "studierende-race" / "tools" / "data"
)

SEM = "Studierende[Wintersemester]"
CODE = "Hochschulen[Hochschule_Code]"
NAME = "Hochschulen[Hochschule]"
CITY = "Hochschulen[Stadt]"
LAND = "Hochschulen[Bundesland]"

#: Distance / online providers, written against the DESTATIS spellings, which are abbreviated —
#: "IU Internationale Hochschule" is recorded as "IU Int. H Erfurt in Erfurt (Priv. FH)", so a
#: regex for the marketing name misses the largest enrolment in the country.
REMOTE = re.compile(
    r"\bIU\b|Int\. H |Fernuni|Fern-?Hoch|Fernhoch|AKAD|Euro-?FH|Wilhelm B[üu]chner|"
    r"DIPLOMA|PFH |Allensbach|Hamburger Fern|Fresenius|SRH Fern|APOLLON|HFH",
    re.I,
)

#: Campuses already modelled, with the DESTATIS code prefix they correspond to. These are pinned
#: into the registry WHATEVER THEY RANK: OTH Regensburg is a Fachhochschule and does not reach the
#: top 30, but it is the site the planner demo actually opens on, and dropping it because a
#: national ranking does not favour it would delete the product's flagship.
#:
#: ⚠️ EVERY PREFIX HERE WAS LOOKED UP IN THE DATA, NOT GUESSED. My first attempt guessed them and
#: two were wrong: `HS1750` does not exist, and `HS126` is Universität KONSTANZ — so the generator
#: pinned Konstanz while reporting it as Tübingen. A prefix that resolves to a plausible-looking
#: university is exactly the kind of error that survives review, which is why `--check-only` prints
#: what each pin resolved to and the run fails on a prefix that matches nothing.
BUILT = {
    "oth-regensburg": {"prefix": "HS726", "label": "OTH Regensburg (FH)"},
    "lmu-muenchen": {"prefix": "HS132", "label": "LMU München"},
    "garching": {"prefix": "HS163", "label": "TUM"},
    "tuebingen": {"prefix": "HS127", "label": "Universität Tübingen"},
}


def stem(name: str) -> str:
    """A crude institution stem, used only to flag suspected over-merges."""
    head = re.split(r"\s+i[nm]\s+", name)[0]
    return re.sub(r"[^a-zäöüß ]", "", head.lower()).strip()[:14]


def load(source: Path, semester: str | None) -> tuple[list[dict], dict[str, tuple], str]:
    stud = json.loads((source / "hi_stud.json").read_text(encoding="utf-8"))
    coords = json.loads((source / "hi_coords.json").read_text(encoding="utf-8"))
    sems = sorted({r.get(SEM) for r in stud if r.get(SEM)})
    chosen = semester or sems[-1]
    rows = [r for r in stud if r.get(SEM) == chosen]
    pos = {c[CODE]: (c["[lat]"], c["[lon]"]) for c in coords}
    return rows, pos, chosen


def group(rows: list[dict], pos: dict[str, tuple]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for r in rows:
        key = r[CODE][:5]
        g = out.setdefault(key, {"key": key, "students": 0.0, "sites": []})
        g["students"] += r.get("[total]") or 0
        lat, lon = pos.get(r[CODE], (None, None))
        g["sites"].append(
            {
                "code": r[CODE],
                "name": r[NAME],
                "city": r.get(CITY),
                "land": r.get(LAND),
                "students": r.get("[total]") or 0,
                "lat": lat,
                "lon": lon,
            }
        )
    for g in out.values():
        g["sites"].sort(key=lambda s: -s["students"])
        g["name"] = g["sites"][0]["name"]
        g["land"] = g["sites"][0]["land"]
        g["students"] = round(g["students"])
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    ap.add_argument("--top", type=int, default=30)
    ap.add_argument("--semester", default=None)
    ap.add_argument("--out", type=Path, default=ROOT / "config" / "universities.json")
    ap.add_argument("--check-only", action="store_true")
    args = ap.parse_args()

    if not (args.source / "hi_stud.json").exists():
        raise SystemExit(
            f"{args.source / 'hi_stud.json'} not found. Pass --source pointing at the "
            "Hochschul-Insights extract (webapp/studierende-race/tools/data)."
        )

    rows, pos, semester = load(args.source, args.semester)
    groups = group(rows, pos)

    suspect = [g for g in groups.values() if len({stem(s["name"]) for s in g["sites"]}) > 1]

    ranked = sorted(groups.values(), key=lambda g: -g["students"])
    campus = [g for g in ranked if not REMOTE.search(g["name"])]
    excluded = [g for g in ranked if REMOTE.search(g["name"])]

    top = campus[: args.top]
    chosen_keys = {g["key"] for g in top}

    # Pin the built campuses in whatever they rank.
    pinned = []
    for aoi, meta in BUILT.items():
        g = groups.get(meta["prefix"])
        if not g:
            raise SystemExit(
                f"built AOI {aoi!r}: no DESTATIS group for prefix {meta['prefix']!r}. "
                "Look the code up in hi_stud.json rather than guessing it — a prefix that "
                "resolves to the WRONG university fails silently."
            )
        # ⚠️ The pin must be checked against what it actually resolved to. `HS126` looked right for
        # Tübingen and is Konstanz; the generator reported "Tübingen" from its own label while
        # writing Konstanz's sites.
        head = re.sub(r"[^a-zäöüß]", "", meta["label"].split()[-1].lower())
        if head and head not in re.sub(r"[^a-zäöüß]", "", g["name"].lower()):
            raise SystemExit(
                f"built AOI {aoi!r}: prefix {meta['prefix']!r} resolves to {g['name']!r}, "
                f"which does not look like {meta['label']!r}. Check the code."
            )
        g = dict(g)
        g["aoi"] = aoi
        g["tier"] = "a"
        if g["key"] not in chosen_keys:
            pinned.append(g)
        else:
            for t in top:
                if t["key"] == g["key"]:
                    t["aoi"] = aoi
                    t["tier"] = "a"

    for g in top:
        g.setdefault("tier", "b")
        g.setdefault("aoi", None)

    entries = sorted(top + pinned, key=lambda g: -g["students"])
    rank_by_students = {g["key"]: i + 1 for i, g in enumerate(sorted(campus, key=lambda x: -x["students"]))}
    for g in entries:
        g["rank"] = rank_by_students.get(g["key"])

    print(f"semester: {semester}")
    print(f"institutions after grouping: {len(groups)}   suspected over-merges: {len(suspect)}")
    print(f"excluded as distance/online: {len(excluded)} (largest {excluded[0]['students']:,} — {excluded[0]['name'][:40]})")
    print(f"entries: {len(entries)}  (top {args.top} plus {len(pinned)} pinned built campus(es))")
    print(f"campus sites: {sum(len(g['sites']) for g in entries)}")
    print(f"states: {len({g['land'] for g in entries})}")
    tiers = {}
    for g in entries:
        tiers[g["tier"]] = tiers.get(g["tier"], 0) + 1
    print(f"tiers: {tiers}")

    missing_geo = [s for g in entries for s in g["sites"] if s["lat"] is None]
    if missing_geo:
        print(f"⚠️  sites without a coordinate: {len(missing_geo)}")

    for g in pinned:
        print(f"  pinned (outside top {args.top}): {g['name'][:44]} — rank {g['rank']}, {g['students']:,}")

    payload = {
        "$comment": (
            "Generated by tools/data/top_universities.py from DESTATIS GENESIS (CC-BY) via the "
            "Hochschul-Insights extract. Do not hand-edit — re-run the script."
        ),
        "source": "Statistisches Bundesamt (Destatis), Hochschulstatistik",
        "semester": semester,
        "grouping": "5-character DESTATIS Hochschule_Code prefix (one code per site)",
        "excludedRule": "distance/online providers, see REMOTE in the generator",
        "excluded": [
            {"name": g["name"], "students": g["students"], "sites": len(g["sites"])}
            for g in excluded[:10]
        ],
        "universities": entries,
    }

    if args.check_only:
        print("\n--check-only: nothing written")
        return
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()

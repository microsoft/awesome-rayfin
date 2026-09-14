"""Build the national university registry from the DESTATIS enrolment extract.

The national twin (PLAN §21, §22) needs one row per INSTITUTION with its sites, its enrolment and
the tier of geodata it can support. This derives that from the DESTATIS GENESIS extract that
`Hochschul-Insights` already carries, so the figures are real, licensed (CC-BY) and re-derivable
rather than typed out of a web page.

    python tools/data/build_university_registry.py            # writes config/universities.json
    python tools/data/build_university_registry.py --top 30   # only the largest N
    python tools/data/build_university_registry.py --include-online

    # the national top 30, PLUS the ten largest in each state the pipeline can build
    python tools/data/build_university_registry.py \
        --also-states Bayern Baden-Württemberg --also-top 10

⚠️ RANKING BY `Hochschule_Code` IS WRONG, AND WRONG IN A WAY THAT LOOKS FINE. DESTATIS issues one
code PER SITE. Ranked naively, TU München appears three separate times — München 24 705, Garching
23 067, Weihenstephan 4 895 — placing 24th and 30th, when as one institution it is FIRST. Three
grouping keys were tried and only the third works:

  * `Parent_University` is populated ONLY for private chains (IU, Fresenius) and empty for every
    public university.
  * The `(siehe HS1310)` cross-reference in the name is present on SOME sites only — Garching and
    Straubing carry none.
  * The 5-character code prefix (`HS163*`) groups all five TUM sites, both LMU sites, both FAU
    sites. This is what is used.

⚠️ AND THE PREFIX RULE IS VERIFIED, NOT TRUSTED. Any group whose member names disagree beyond
DESTATIS's own abbreviation noise is REPORTED as a suspected over-merge rather than silently
accepted, because a wrong merge would add one university's students to another's and change the
ranking. 17 of 427 groups flag; all 17 are genuinely one institution ("TU München" vs "Technische
Universität München"), which is exactly what the check is for — it surfaces the judgement instead
of hiding it.

⚠️ ONLINE PROVIDERS ARE EXCLUDED BY DEFAULT, AND THE LARGEST ENROLMENT IN GERMANY IS ONE. IU
Internationale Hochschule is ~123 500 students across 21 registered sites and would rank first;
Fernuniversität Hagen is ~63 400. Their students are overwhelmingly not on a campus, so ranking by
enrolment alone would fill a campus twin with buildings nobody attends. They are FLAGGED rather
than deleted (`online: true`), because both do have physical sites and the decision is reversible
per site rather than per institution.

⚠️ THE COORDINATES IN THIS FILE ARE CITY CENTROIDS AND MUST NOT BE USED TO CENTRE AN AOI. DESTATIS
publishes one point per institution, repeated for every site, so it LOOKS like a per-site position
and is not. Measured against the four campuses that already have a hand-built bbox: Tübingen 0.18
km out, LMU 0.69 km, OTH 1.22 km, and **Garching 16.07 km** — all five TUM sites carry the identical
point in central München. A 2 km box generated from these would put Garching's campus outside its
own AOI. The registry therefore publishes `cityPoint` under a name that says what it is, and campus
geometry comes from OpenStreetMap (`find_campus_areas.py`).
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
HI = ROOT.parent / "Hochschul-Insights" / "webapp" / "studierende-race" / "tools" / "data"
STUD = HI / "hi_stud.json"
COORDS = HI / "hi_coords.json"
OUT = ROOT / "config" / "universities.json"

CODE = "Hochschulen[Hochschule_Code]"
NAME = "Hochschulen[Hochschule]"
CITY = "Hochschulen[Stadt]"
LAND = "Hochschulen[Bundesland]"
PARENT = "Hochschulen[Parent_University]"
TERM = "Studierende[Wintersemester]"
TOTAL = "[total]"

# Providers whose teaching is overwhelmingly not on a campus. Matched on the institution name
# because the DESTATIS extract carries no delivery-mode field.
#
# ⚠️ WRITTEN FOLDED, because that is what they are compared against. The first version listed
# "iu internationale hochschule" and DESTATIS spells it "IU Int. H Erfurt", so the largest
# enrolment in Germany sailed through the filter and ranked first.
ONLINE_PATTERNS = (
    "fernuniversitat",
    "fernuni",
    "iu int",
    "internationale hochschule (iu)",
    "wilhelm buchner",
    "apollon",
    "euro-fh",
    "hochschule fur angewandtes management",
    # ⚠️ `fernuni` DOES NOT CATCH `Fernhochschule`, and the national top 30 hid that. Both gaps
    # only surfaced once the registry was extended per state: SRH Fernhochschule Riedlingen
    # (9 282) and AKAD (6 633) are far too small to rank nationally, and both are distance
    # providers that would have been drawn on a CAMPUS map as places to walk into.
    "fernhochschule",
    # `akad h` rather than `akad`, which is a substring of `akademie` — Filmakademie,
    # Kunstakademie and Musikakademie are campuses, and this list must not swallow them.
    "akad h",
)

# The AOIs that already exist, keyed by a FOLDED name fragment. Tier A means photoreal geodata is
# already built; everything else starts at tier B.
#
# ⚠️ FOLDED ON BOTH SIDES. The first version wrote these with umlauts and compared them against
# `fold(name)`, which strips diacritics — so nothing matched and all four built universities were
# reported as tier B. Same class of bug as the `find_teacher` umlaut fix: a normaliser applied to
# one side only is worse than none, because it silently changes what is reachable.
#
# ⚠️ AND EVERY FRAGMENT MUST IDENTIFY ONE INSTITUTION, NOT A FAMILY OF THEM. The first version
# carried the bare word "ostbayerische", which matched **OTH Amberg-Weiden** — a different
# university, 80 km away — and handed it OTH Regensburg's photoreal AOI. It would have rendered
# Regensburg's campus under Amberg's name. `assert_unique_aoi` below is what stops the next one.
TIER_A = {
    "tu munchen": "garching",
    "technische universitat munchen": "garching",
    "universitat munchen": "lmu-muenchen",
    "ludwig-maximilians": "lmu-muenchen",
    "universitat tubingen": "tuebingen",
    "eberhard karls": "tuebingen",
    "th regensburg": "oth-regensburg",
    "oth regensburg": "oth-regensburg",
    "hochschule regensburg": "oth-regensburg",
    # ── added for the top-ten-by-students set (PLAN §37) ──────────────────────────────────
    # ⚠️ `erlangen-nurnberg`, not `erlangen`. The bare city would also match the Evangelische
    # Hochschule Nürnberg and TH Nürnberg Georg Simon Ohm, which are different institutions in the
    # same two cities — the OTH Amberg-Weiden mistake wearing different clothes.
    "u erlangen-nurnberg": "fau-erlangen",
    "friedrich-alexander": "fau-erlangen",
    # ⚠️ `universitat koln`, not `koln`. Köln has a TH, a Sporthochschule, a Kunsthochschule and a
    # Musikhochschule; the bare city name would hand one of them the Universität's campus.
    "universitat koln": "koeln",
    "universitat zu koln": "koeln",
    # ⚠️ `technische hochschule aachen`, not `aachen`, and not the bare `rwth` either without it:
    # Fachhochschule Aachen is a different institution in the same city and sits inside the same
    # OSM box. DESTATIS calls RWTH "Technische Hochschule Aachen".
    "technische hochschule aachen": "aachen",
    "rwth": "aachen",
    # ⚠️ `universitat munster`, not `munster` — Fachhochschule Münster shares the city and even has
    # a library inside this AOI's core box.
    "universitat munster": "muenster",
}


def fold(text: str) -> str:
    """Lower-case, strip diacritics, collapse whitespace — for comparing DESTATIS's own spellings."""
    out = unicodedata.normalize("NFKD", text or "")
    out = "".join(c for c in out if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", out).strip().lower()


def clean_name(raw: str) -> str:
    """DESTATIS names carry the city and a parenthetical history: strip both, keep the institution.

    ``U Kassel in Kassel (ab 1999 ohne Kunsthochschule)`` -> ``U Kassel``
    """
    name = re.sub(r"\s*\([^)]*\)\s*$", "", raw or "").strip()
    name = re.sub(r"\s+in\s+[^,]+$", "", name).strip()
    return name or (raw or "").strip()


def significant_words(name: str) -> set[str]:
    """Words that identify an institution, ignoring the ones every German university shares."""
    stop = {
        "u", "uni", "universitat", "universitaet", "technische", "th", "tu", "hs", "hochschule",
        "fachhochschule", "fh", "der", "die", "das", "und", "fur", "fuer", "von", "zu", "am", "an",
        "in", "des", "im", "angewandte", "angewandten", "wissenschaften",
    }
    words = re.findall(r"[a-z0-9]+", fold(name))
    return {w for w in words if w not in stop and len(w) > 2}


def load_rows() -> list[dict[str, Any]]:
    if not STUD.exists():
        raise SystemExit(
            f"DESTATIS extract not found at {STUD}\n"
            "It lives in the Hochschul-Insights repo; clone it beside this one."
        )
    return json.load(STUD.open(encoding="utf-8"))


def latest_term(rows: list[dict[str, Any]]) -> str:
    return max(str(r.get(TERM, "")) for r in rows)


def build(
    top: int | None,
    include_online: bool,
    also_states: list[str] | None = None,
    also_top: int = 0,
) -> dict[str, Any]:
    rows = load_rows()
    term = latest_term(rows)
    current = [r for r in rows if str(r.get(TERM, "")) == term]

    coords: dict[str, tuple[float, float]] = {}
    if COORDS.exists():
        for c in json.load(COORDS.open(encoding="utf-8")):
            code = c.get(CODE)
            lat, lon = c.get("[lat]"), c.get("[lon]")
            if code and lat is not None and lon is not None:
                coords[code] = (float(lat), float(lon))

    # Group by the 5-character code prefix — the only key that holds all of one institution.
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in current:
        code = str(r.get(CODE) or "")
        if len(code) < 5:
            continue
        groups[code[:5]].append(r)

    universities: list[dict[str, Any]] = []
    suspected: list[dict[str, Any]] = []

    for prefix, members in groups.items():
        sites = []
        for m in members:
            code = str(m[CODE])
            total = int(m.get(TOTAL) or 0)
            lat_lon = coords.get(code)
            sites.append({
                "code": code,
                "name": clean_name(str(m.get(NAME) or "")),
                "city": str(m.get(CITY) or ""),
                "state": str(m.get(LAND) or ""),
                "students": total,
                # ⚠️ NOT a campus position — see the module docstring.
                "cityPoint": {"lat": lat_lon[0], "lon": lat_lon[1]} if lat_lon else None,
            })
        sites.sort(key=lambda s: -s["students"])

        # The institution takes the name of its largest site, which is the one DESTATIS spells out.
        head = sites[0]
        folded = fold(head["name"])

        # ⚠️ The over-merge check: do the members even look like the same institution?
        shared = set.intersection(*(significant_words(s["name"]) for s in sites)) if len(sites) > 1 else set()
        if len(sites) > 1 and not shared:
            suspected.append({"prefix": prefix, "names": [s["name"] for s in sites]})

        online = any(p in folded for p in ONLINE_PATTERNS)
        aoi = next((a for frag, a in TIER_A.items() if frag in folded), None)

        universities.append({
            "id": prefix,
            "name": head["name"],
            "city": head["city"],
            "state": head["state"],
            "students": sum(s["students"] for s in sites),
            "siteCount": len(sites),
            "sites": sites,
            "online": online,
            "tier": "a" if aoi else "b",
            "aoi": aoi,
        })

    ranked = [u for u in universities if include_online or not u["online"]]
    ranked.sort(key=lambda u: -u["students"])
    if top:
        # ⚠️ THE ALREADY-BUILT UNIVERSITIES ARE KEPT WHATEVER THEIR RANK. OTH Regensburg is the
        # reference customer and about 8 000 students — nowhere near the top 30 — so a plain
        # `[:top]` drops the one university the whole product was designed around, and the twin
        # would ship without the campus it is demonstrated on.
        head = ranked[:top]
        have = {u["id"] for u in head}
        head += [u for u in ranked if u["tier"] == "a" and u["id"] not in have]
        have |= {u["id"] for u in head}

        # ⚠️ A SECOND AXIS, BECAUSE ENROLMENT RANK AND BUILDABILITY ARE UNRELATED. The national top
        # 30 is the right list for a map of who exists, and the wrong one for deciding what can
        # actually be BUILT: the photoreal pipeline has fetchers for exactly two survey
        # authorities, Bayern's LDBV and Baden-Württemberg's LGL, so of that top 30 only nine
        # universities sit in a state whose terrain, orthophoto and LoD2 buildings can be
        # downloaded at all. Ranking nationally therefore fills the registry with universities
        # the pipeline cannot serve while leaving out Regensburg, Augsburg, KIT and Stuttgart,
        # which it can.
        #
        # So states are named explicitly rather than inferred. When a fetcher exists for another
        # Land, adding it here is the whole change — and until one does, this list is an honest
        # statement of the pipeline's reach rather than an accident of the enrolment table.
        for state in also_states or []:
            pool = [u for u in ranked if u["state"] == state and u["id"] not in have]
            take = pool[:also_top] if also_top else pool
            head += take
            have |= {u["id"] for u in take}

        head.sort(key=lambda u: -u["students"])
        ranked = head

    return {
        "$provenance": {
            "source": "DESTATIS GENESIS via Hochschul-Insights (hi_stud.json, hi_coords.json)",
            "licence": "CC-BY (Statistisches Bundesamt)",
            "term": term,
            "grouping": "5-character Hochschule_Code prefix; DESTATIS issues one code per SITE",
            "coordinates": "cityPoint is a CITY CENTROID per institution, NOT a campus position — "
                           "measured up to 16.07 km from the campus (Garching). Campus geometry "
                           "comes from OpenStreetMap via find_campus_areas.py.",
            "onlineExcluded": not include_online,
            "generatedBy": "tools/data/build_university_registry.py",
        },
        "suspectedOverMerge": suspected,
        "universities": ranked,
    }


def assert_unique_aoi(universities: list[dict[str, Any]]) -> None:
    """Refuse to write a registry in which one built AOI is claimed by two institutions.

    ⚠️ A LOOSE FRAGMENT IS SILENT. "ostbayerische" matched both OTH Regensburg and OTH
    Amberg-Weiden, and the only visible symptom was a tier-A count of 5 where 4 belong — a number
    nobody would look at twice. An AOI carries one university's terrain, buildings and rooms, so
    two claimants means one of them would be shown somebody else's campus under its own name. That
    is the single worst thing this project can render, and it stops the build.
    """
    claims: dict[str, list[str]] = defaultdict(list)
    for u in universities:
        if u["aoi"]:
            claims[u["aoi"]].append(u["name"])
    clashes = {a: names for a, names in claims.items() if len(names) > 1}
    if clashes:
        lines = "\n".join(f"  {a}: {' | '.join(n)}" for a, n in clashes.items())
        raise SystemExit(
            "TIER_A fragments are ambiguous — one AOI is claimed by several institutions:\n"
            f"{lines}\n"
            "Make the fragment name ONE university. Nothing was written."
        )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    # ⚠️ THE DEFAULTS ARE THE SHIPPED CONFIGURATION, AND THAT IS THE WHOLE POINT.
    #
    # They used to be `--top 30`, no states, no cap — which is NOT how config/universities.json was
    # generated. Re-running the documented command therefore produced a DIFFERENT file: 31
    # universities instead of 51, silently dropping Bamberg, Bayreuth, Passau, Konstanz, Mannheim,
    # Ulm and Hohenheim from the national map. It was caught only by diffing the regenerated index
    # against the committed one; nothing failed, and the result looked entirely plausible.
    #
    # A generated artefact whose generating command is not recorded is a file nobody can safely
    # regenerate. So the recipe lives here, in the defaults, rather than in someone's memory.
    ap.add_argument("--top", type=int, default=30, help="keep only the largest N (0 = all)")
    ap.add_argument("--include-online", action="store_true", help="keep distance/online providers")
    ap.add_argument(
        "--also-states",
        nargs="*",
        default=["Bayern", "Baden-Württemberg", "Nordrhein-Westfalen"],
        metavar="STATE",
        help="additionally keep universities in these Bundeslaender, whatever their national rank "
             "(the states the geodata pipeline has fetchers for). ⚠️ KEEP THIS IN STEP WITH "
             "pipeline.py: Nordrhein-Westfalen joined the list when fetch_nrw.py landed, and a "
             "state with a fetcher that is missing here is a state whose universities cannot be "
             "reached from the map.",
    )
    ap.add_argument(
        "--also-top",
        type=int,
        default=10,
        help="cap --also-states at the largest N per state (0 = all)",
    )
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    reg = build(args.top or None, args.include_online, args.also_states, args.also_top)
    assert_unique_aoi(reg["universities"])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(reg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    unis = reg["universities"]
    # ⚠️ `relative_to` THREW ON AN --out OUTSIDE THE REPO, after the file had already been written.
    # The run looked like a failure and had in fact succeeded, which is the worst of both.
    try:
        shown = args.out.relative_to(ROOT)
    except ValueError:
        shown = args.out
    print(f"{shown}: {len(unis)} universities, term {reg['$provenance']['term']}")
    print(f"  sites: {sum(u['siteCount'] for u in unis)}   "
          f"states: {len({s['state'] for u in unis for s in u['sites']})}")
    tier = {"a": 0, "b": 0}
    for u in unis:
        tier[u["tier"]] += 1
    print(f"  tier A (photoreal, already built): {tier['a']}   tier B (to build): {tier['b']}")
    if reg["suspectedOverMerge"]:
        print(f"  ⚠️ {len(reg['suspectedOverMerge'])} suspected over-merges — check them:")
        for s in reg["suspectedOverMerge"][:10]:
            print(f"       {s['prefix']}: {' | '.join(s['names'][:4])}")
    print()
    for i, u in enumerate(unis[:30], 1):
        mark = "A" if u["tier"] == "a" else " "
        print(f"  {i:2}. {mark} {u['name'][:44]:<44} {u['students']:>7,} {u['siteCount']:>2} site(s)  {u['state'][:20]}")


if __name__ == "__main__":
    main()

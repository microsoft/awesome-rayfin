"""Find each university's real campus areas in OpenStreetMap, or refuse to guess.

The national twin (PLAN §21, §22) needs a bounding box per campus. The registry cannot supply one:
DESTATIS publishes a CITY CENTROID per institution and it is up to **16 km** from the campus
(§22.7). So the geometry has to come from OSM, and this is the tool that looks for it.

    python tools/geodata/find_campus_areas.py --university HS163      # one, by registry id
    python tools/geodata/find_campus_areas.py --all                   # every tier-B university
    python tools/geodata/find_campus_areas.py --all --review          # print what needs a human

⚠️ THE PREVIOUS ATTEMPT FOUND SECONDARY SCHOOLS AND CALLED THEM CAMPUSES (§22.8). Measured then:
TU Garching and Köln resolved correctly; **Universität Hamburg** matched *Katholische Schule
Harburg* and *HAW Hamburg*, and **Ruhr-Universität Bochum** matched NOTHING and the unfiltered
fallback offered a Gesamtschule. Two distinct faults, and only one of them was the query:

  1. A substring match on "Universität Hamburg" reduces to the token "hambur", which every school
     in Hamburg carries. **A university named after its city cannot be found by its city name.**
  2. When nothing matched, the code returned the largest nearby education area anyway.

⚠️ SO THE CITY TOKEN IS NOT EVIDENCE, AND A FALLBACK THAT RETURNS SOMETHING PLAUSIBLE IS WORSE
THAN AN EMPTY RESULT. This tool scores each candidate on evidence that actually discriminates, and
where the evidence is weak it returns `needsReview` with the candidates attached rather than a
decision. That is the same rule the solver already follows for an ambiguous surname (§20): a
question beats a confident wrong answer, and 31 confirmations are affordable once.

Evidence, strongest first:

  * `wikidata` / `wikipedia` on the area — an identifier, not a guess
  * `operator` naming the institution
  * `name` sharing a DISCRIMINATING token (the city name is excluded on purpose)
  * `amenity=university` over `landuse=education`, which also covers schools

⚠️ AND A UNIVERSITY IS OFTEN SEVERAL CAMPUSES, NOT ONE BOX. Bochum is one block; Köln, Hamburg and
the Berlin universities are threaded through their cities, so a bounding box of everything the
university owns would be most of the city. Accepted areas are therefore CLUSTERED by distance and
each cluster is offered as its own candidate campus.

Writes `config/campus-candidates.json`. Nothing downstream may consume a candidate that has not
been confirmed — `--confirm` moves one into `config/campus-sites.json`, which is what the tier-B
pipeline reads.
"""

from __future__ import annotations

import argparse
import difflib
import json
import math
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from overpass_client import overpass  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "config" / "universities.json"
CANDIDATES = ROOT / "config" / "campus-candidates.json"
CONFIRMED = ROOT / "config" / "campus-sites.json"

# Words that identify nothing: every German university carries them.
STOP = {
    "u", "uni", "universitat", "universitaet", "universitat", "technische", "technischen", "th",
    "tu", "hs", "hochschule", "fachhochschule", "fh", "der", "die", "das", "und", "fur", "fuer",
    "von", "zu", "am", "an", "in", "des", "im", "angewandte", "angewandten", "wissenschaften",
    "gesamthochschule", "staatliche", "private", "priv", "int", "internationale", "deutsche",
}

#: Tokens that survive `STOP` but are still shared by many institutions.
#:
#: ⚠️ SHARED IS NOT WORTHLESS, WHICH IS WHY THESE ARE DEMOTED RATHER THAN DELETED. `management`
#: genuinely is part of FOM's name and `padagogische` is the ONLY word separating Pädagogische
#: Hochschule Ludwigsburg from Evangelische Hochschule Ludwigsburg — a false positive closed one
#: commit ago. Putting either in `STOP` would erase real evidence and reopen that.
#:
#: What they cannot do is carry an acceptance on their own. `Hauptabteilung V - Gebäude und
#: Technik` is a facilities department; it was accepted for Hochschule Technik und Wirtschaft
#: Karlsruhe on the strength of the word *Technik* alone, scoring 5 against a threshold of 4. At
#: the reduced weight it scores 3 and is refused, while every legitimate match measured kept
#: enough other evidence to stay above the line (PH Ludwigsburg 9→6, FOM 6→4 and 7→4).
#:
#: MEASURED, NOT GUESSED: each appears in at least five of the 420 universities in the DESTATIS
#: extract, counted with the same `tokens()` this module matches with. The number is in the
#: comment so the next reader can re-derive it rather than trust it.
#:
#: ⚠️ CITY NAMES ARE DELIBERATELY EXCLUDED even though they are the most common tokens of all
#: (berlin 38, hamburg 17, münchen 12). `discriminating()` already removes a university's own city
#: and every query is scoped to one city, so demoting them would punish exactly one case — U
#: Erlangen-Nürnberg, searched in Erlangen, whose only token is `nurnberg`.
GENERIC_TOKENS = {
    "akademie",      # 6      "app",  5  (DESTATIS abbreviation fragments)
    "app", "appl", "applied", "bildenden", "business",
    "evangelische",  # 7
    "finanzen", "kath", "kirchenmusik",
    "kunste",        # 13
    "management",    # 6
    "musik",         # 19
    "off",           # 7      (from "H f.d. öff. D.")
    "padagogische",  # 6
    "polizei",       # 8
    "school",        # 12
    "sciences", "srh", "techn",
    "technik",       # 9
    "theater",
    "theologische",  # 7
    "university",    # 10
    "verw", "verwaltung",
    "wirtschaft",    # 11
}

#: What a token hit is worth. A shared token still counts — it just cannot reach the acceptance
#: threshold of 4 without structural support, which is the difference between "this building is
#: named after the institution" and "this building has the word Technik in it".
OPERATOR_TOKEN_SCORE = 5
NAME_TOKEN_SCORE = 4
GENERIC_TOKEN_SCORE = 2

# A campus cluster is capped so one university's estate cannot become a city-sized box.
CLUSTER_LINK_M = 900.0     # areas closer than this belong to the same campus
MAX_CAMPUS_KM = 6.0        # a cluster wider than this is reported, never silently accepted
MIN_CAMPUS_M2 = 8_000.0    # smaller than this is a single building, not a campus


def fold(text: str) -> str:
    out = unicodedata.normalize("NFKD", text or "")
    out = "".join(c for c in out if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", out).strip().lower()


def tokens(name: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", fold(name)) if w not in STOP and len(w) > 2}


def discriminating(uni_name: str, city: str) -> set[str]:
    """The tokens that identify THIS university and are not just its city.

    ⚠️ This is the whole Hamburg fix. `Universität Hamburg` in Hamburg has no discriminating token
    at all, so name matching is refused for it and only `wikidata` / `operator` count. That is the
    correct answer: the name genuinely does not distinguish it from anything else in the city.
    """
    return tokens(uni_name) - tokens(city)


def similarity(a: str, b: str) -> float:
    """How alike are two institution names, as whole strings?

    ⚠️ THIS IS WHAT FINDS A UNIVERSITY NAMED AFTER ITS OWN CITY. `discriminating()` correctly
    reports that "Universität Hamburg" in Hamburg has no identifying token — every word in it is
    either generic or the city — and the first version of this tool therefore refused to match it
    on its name at all, which threw away the strongest evidence available: the area is *called*
    Universität Hamburg.

    Token overlap and whole-string similarity fail in opposite directions, which is why both are
    used. Overlap is blind here; similarity is not: "universitat hamburg" against the OSM area
    "universitat hamburg" scores 1.00, and against "katholische schule harburg" — the school the
    earlier substring matcher proposed — it scores far below the threshold. Neither alone is
    enough, and neither is allowed to accept an area on its own (see `score`).
    """
    return difflib.SequenceMatcher(None, fold(a), fold(b)).ratio()


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def ring_of(el: dict[str, Any]) -> list[tuple[float, float]]:
    if el.get("type") == "node":
        return [(el["lat"], el["lon"])]
    geom = el.get("geometry") or []
    if geom:
        return [(g["lat"], g["lon"]) for g in geom]
    members = el.get("members") or []
    pts: list[tuple[float, float]] = []
    for m in members:
        for g in m.get("geometry") or []:
            pts.append((g["lat"], g["lon"]))
    return pts


def bbox_of(points: list[tuple[float, float]]) -> dict[str, float]:
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    return {"minLat": min(lats), "maxLat": max(lats), "minLon": min(lons), "maxLon": max(lons)}


def bbox_size_km(b: dict[str, float]) -> tuple[float, float]:
    mid = (b["minLat"] + b["maxLat"]) / 2
    h = haversine_m((b["minLat"], b["minLon"]), (b["maxLat"], b["minLon"])) / 1000
    w = haversine_m((mid, b["minLon"]), (mid, b["maxLon"])) / 1000
    return w, h


def area_m2(b: dict[str, float]) -> float:
    w, h = bbox_size_km(b)
    return w * h * 1_000_000


def query_city(city: str) -> list[dict[str, Any]]:
    """Every plausible university area in one city.

    Scoped by city because a Germany-wide regex over `amenity=university` times out, and the
    registry already knows the city.
    """
    q = f"""
    [out:json][timeout:180];
    area["name"="{city}"]["boundary"="administrative"]->.city;
    (
      way["amenity"="university"](area.city);
      relation["amenity"="university"](area.city);
      way["amenity"="college"](area.city);
      relation["amenity"="college"](area.city);
      way["landuse"="education"](area.city);
      relation["landuse"="education"](area.city);
      way["building"="university"](area.city);
      relation["building"="university"](area.city);
    );
    out geom tags;
    """
    return (overpass(q) or {}).get("elements", [])


# ⚠️ 0.85, AND THE MARGIN IS NARROWER THAN IT LOOKS. Measured against Hamburg, the hardest city in
# the registry: "Universität Hamburg" scores 0.78 against **Technische Universität Hamburg**, 0.79
# against **HafenCity Universität Hamburg** and 0.78 against Technologiezentrum
# Hamburg-Finkenwerder — three different institutions, all of which a 0.75 threshold accepted as
# campuses of the wrong university. It scores 0.88 against "Ruhr-Universität Bochum", which IS the
# right institution under DESTATIS's abbreviated name. So the usable window is 0.79–0.88 and 0.85
# sits in it. Anything looser re-imports the §22.8 bug in a subtler form: not a school this time,
# but the technical university next door.
NAME_SIMILARITY_MIN = 0.85


#: The name on the ground, where DESTATIS uses a different one.
#:
#: ⚠️ WHY A TABLE AND NOT A STRING RULE. Ten of the top 30 matched nothing at all, and every one
#: is the same thing: German universities are named after a person, DESTATIS lists the short form,
#: and OpenStreetMap carries the legal name. "Universität Göttingen" and
#: "Georg-August-Universität Göttingen" share no discriminating token and score 0.62 on
#: similarity, so the tool correctly said it had no evidence — the name it was given simply is not
#: the name anyone uses.
#:
#: ⚠️ THE OBVIOUS FIX IS WRONG. A substring rule would catch all ten: "Georg-August-Universität
#: Göttingen" contains "Universität Göttingen". It would also match **"HafenCity Universität
#: Hamburg"** for "Universität Hamburg" — a different university, and precisely the false positive
#: that raising the similarity threshold removed. Containment cannot tell a longer legal name from
#: a neighbouring institution's; only knowing which is which can.
#:
#: So each line below is a FACT about an institution, checkable in one search, and it adds a name
#: to match against rather than loosening any threshold. An alias earns nothing on its own: it
#: still has to clear `NAME_SIMILARITY_MIN` or contribute a discriminating token, and the
#: structural tags still only add to a name match.
#: ⚠️ THE IDS ARE THE DANGEROUS PART, NOT THE NAMES. Written from memory, this table had
#: `HS102: ["RWTH Aachen"]` — and HS102 is **Universität Hamburg**; Aachen is HS148. Every key
#: below is now copied from `config/universities.json`, because an alias on the wrong id is a
#: machine for producing exactly the false matches the similarity threshold exists to prevent.
ALIASES: dict[str, list[str]] = {
    "HS148": ["RWTH Aachen", "Rheinisch-Westfälische Technische Hochschule Aachen"],
    "HS116": ["Goethe-Universität Frankfurt am Main"],
    "HS103": ["Georg-August-Universität Göttingen"],
    "HS145": ["Gottfried Wilhelm Leibniz Universität Hannover", "Leibniz Universität Hannover"],
    "HS100": ["Christian-Albrechts-Universität zu Kiel"],
    "HS117": ["Justus-Liebig-Universität Gießen"],
    "HS124": ["Albert-Ludwigs-Universität Freiburg"],
    "HS110": ["Heinrich-Heine-Universität Düsseldorf"],
    "HS122": ["Johannes Gutenberg-Universität Mainz"],
    # ⚠️ Dresden and Dortmund are NOT a naming problem. DESTATIS already calls them "Technische
    # Universität Dresden" / "Dortmund", which is what OSM carries — an alias repeating the
    # registry name buys nothing, and the guard in `test_campus_aliases.py` says so. Their zero
    # match therefore has a different cause and needs its own look; only the genuinely different
    # short form is listed here.
    "HS037": ["TU Dresden"],
    "HS113": ["TU Dortmund"],
    "HS111": ["Universität zu Köln"],
}


def names_for(uni: dict[str, Any]) -> list[str]:
    """Every name this university is plausibly written under. Registry name first."""
    return [uni["name"], *ALIASES.get(uni["id"], [])]


#: The town the campus is actually IN, where DESTATIS records a different one.
#:
#: ⚠️ A WRONG CITY IS INVISIBLE, WHICH IS WHY THIS IS SEPARATE FROM `ALIASES`. Every search is
#: scoped to one city (`query_city`), so if the city is wrong the query runs against the wrong
#: place and comes back nearly empty — and the tool then reports "nothing matched — no area in this
#: city names or operates for this university", which points the reader squarely at NAMING. The
#: name was never the problem. An alias would have been added, it would have changed nothing, and
#: the real fault would still be there.
#:
#: Universität Hohenheim is the case that found this: DESTATIS lists Ostfildern, the campus is
#: Schloss Hohenheim in **Stuttgart**, and the Ostfildern search returned **2 areas** against 15
#: for the next-sparsest university in the registry. Two areas is not a city with a university in
#: it, and `too_few_areas()` below now says so instead of blaming the name.
#:
#: Same rule as `ALIASES`: each line is a checkable fact about one institution, the key is copied
#: from `config/universities.json`, and it changes only WHERE the tool looks — never what counts
#: as evidence once it is looking in the right place.
CITY_OVERRIDES: dict[str, tuple[str, str]] = {
    "HS180": (
        "Stuttgart",
        "DESTATIS records Ostfildern; the campus is Schloss Hohenheim in Stuttgart-Hohenheim. "
        "The Ostfildern search saw 2 areas.",
    ),
}

#: Below this, a city search has not found a city with a university in it. The registry's sparsest
#: legitimate entry saw 15 areas (TH Deggendorf); Hohenheim's wrong-city search saw 2. Set at 8 so
#: it sits clear of both — this is a diagnosis, not a rejection, and it never changes what matches.
TOO_FEW_AREAS = 8


def city_for(uni: dict[str, Any]) -> str:
    """Where to look. The registry's city unless it is known to be wrong."""
    override = CITY_OVERRIDES.get(uni["id"])
    return override[0] if override else uni["sites"][0]["city"]


#: How much of a name has to be left after the city is removed before a whole-string ratio means
#: anything. "TH Deggendorf" leaves "th" — two characters against a ten-character city — so a ratio
#: against "VHS Deggendorf" is measuring the town. "Universität Hamburg" leaves "universitat",
#: eleven characters, and there the ratio is measuring the institution. Six sits between them.
MIN_NON_CITY_CHARS = 6


def non_city_core(name: str, city: str) -> str:
    """What is left of a name once its city is taken out of it."""
    core = fold(name)
    for part in fold(city).split():
        core = core.replace(part, " ")
    return re.sub(r"[^a-z0-9]+", "", core)


def similarity_evidence(uni_name: str, city: str, other: str) -> float:
    """Whole-name similarity, but only where it is evidence about the INSTITUTION.

    ⚠️ THE RATIO HAPPILY MEASURES THE CITY, AND TWICE IT DID. Both were accepted at a threshold
    chosen to prevent exactly this:

      * `VHS Deggendorf` scored **0.889** against `TH Deggendorf` — a Volkshochschule handed to a
        Technische Hochschule. The city is 77 % of the registry name, so almost all of that ratio
        is the word "Deggendorf".
      * `Evangelische Hochschule Ludwigsburg` scored **0.857** against `Pädagogische Hochschule
        Ludwigsburg` — two genuinely different universities in one town, sharing everything except
        the one word that tells them apart.

    Both then collected `wikidata` (+6) on top and finished on 11, comfortably above the
    acceptance threshold. They only failed to ship because their clusters were too small; a bigger
    one would have put another institution's buildings on the map under this university's name.

    So two conditions, and both are deliberately narrow so that the three cases whole-name
    similarity exists for keep working:

      1. If there is barely any name left once the city is removed, the remainder must match
         EXACTLY. "TU Dresden" leaves "tu", which is far too little to judge a partial ratio on —
         but TU Dresden's buildings carry `operator=TU Dresden`, an identity rather than a
         resemblance, and refusing that outright cost the university 39 of its areas. "TH
         Deggendorf" and "VHS Deggendorf" leave "th" and "vhs", which are not the same, and that
         is the difference between an abbreviation matching itself and two unrelated ones.
      2. If BOTH names carry a distinguishing word and those words disagree, the names are naming
         different institutions and no ratio should overrule that.

    Checked against the cases that motivated the rule in the first place:
      `Universität Hamburg` vs `Universität Hamburg`         → 1.00, kept (neither side distinguishes)
      `Universität Bochum` vs `Ruhr-Universität Bochum`      → 0.88, kept (only one side does)
      `Universität Hamburg` vs `HafenCity Universität Hamburg` → 0.79, still below the threshold
      `TU Dresden` vs `TU Dresden` (operator)                → 1.00, kept (identical remainder)
    """
    if not other:
        return 0.0
    mine_core = non_city_core(uni_name, city)
    if len(mine_core) < MIN_NON_CITY_CHARS and mine_core != non_city_core(other, city):
        return 0.0
    mine = discriminating(uni_name, city)
    theirs = discriminating(other, city)
    if mine and theirs and not (mine & theirs):
        return 0.0
    return similarity(uni_name, other)


def score(el: dict[str, Any], disc: set[str], uni_names: list[str], city: str) -> tuple[int, list[str]]:
    """How strongly does this area claim to belong to THIS university?

    Two independent kinds of name evidence, because they fail in opposite directions:

      * a DISCRIMINATING TOKEN ("ruhr", "humboldt", "scholl") identifies the institution even when
        the rest of the name is worded differently — but a university named after its city has no
        such token at all;
      * WHOLE-NAME SIMILARITY handles exactly that case, and is useless when OSM spells the name
        completely differently from DESTATIS.

    ⚠️ ONE OF THE TWO IS REQUIRED, AND STRUCTURE ALONE IS NEVER ENOUGH. An earlier version said so
    in prose and then let the arithmetic contradict it: `wikidata` (+1), `amenity=university` (+2)
    and `building=university` (+1) summed to exactly the acceptance threshold, so **HAW Hamburg**
    — a different university that is tagged like any other — was accepted for Universität Hamburg
    with no name evidence whatsoever. Structural tags now only ADD to a name match; without one the
    area scores nothing, whatever else it carries.
    """
    tags = el.get("tags") or {}
    name = tags.get("name", "")
    operator = tags.get("operator", "")

    sim = max(
        max(similarity_evidence(n, city, name), similarity_evidence(n, city, operator))
        for n in uni_names
    )
    token_hit = bool(disc and (tokens(name) & disc or tokens(operator) & disc))
    if not token_hit and sim < NAME_SIMILARITY_MIN:
        return 0, []

    why: list[str] = []
    s = 0

    if tags.get("wikidata") or tags.get("wikipedia"):
        s += 6
        why.append("wikidata+name")

    op = tokens(operator)
    op_hits = op & disc if disc else set()
    if op_hits:
        # A hit on a token only this university uses is strong; one on a token eleven universities
        # share is not, and the evidence string says which so a reviewer can tell them apart.
        specific = op_hits - GENERIC_TOKENS
        s += OPERATOR_TOKEN_SCORE if specific else GENERIC_TOKEN_SCORE
        why.append(f"operator{'' if specific else '-generic'}:{sorted(op_hits)}")

    nm = tokens(name)
    nm_hits = nm & disc if disc else set()
    if nm_hits:
        specific = nm_hits - GENERIC_TOKENS
        s += NAME_TOKEN_SCORE if specific else GENERIC_TOKEN_SCORE
        why.append(f"name{'' if specific else '-generic'}:{sorted(nm_hits)}")
    elif sim >= NAME_SIMILARITY_MIN:
        # The city-named case. Scored just below a discriminating token, because a high ratio is
        # weaker evidence than a word only this university uses.
        s += 3
        why.append(f"nameSimilarity:{sim:.2f}")

    if tags.get("amenity") in ("university", "college"):
        s += 2
        why.append("amenity=university")
    elif tags.get("landuse") == "education":
        # ⚠️ Deliberately NOT evidence on its own: landuse=education is schools and kindergartens
        # too, and trusting it is exactly how a Gesamtschule became a campus.
        why.append("landuse=education(weak)")

    if tags.get("building") == "university":
        s += 1
        why.append("building=university")

    return s, why


def cluster(areas: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group accepted areas into campuses by single-link distance."""
    remaining = list(areas)
    out: list[list[dict[str, Any]]] = []
    while remaining:
        group = [remaining.pop()]
        changed = True
        while changed:
            changed = False
            for cand in list(remaining):
                if any(haversine_m(cand["centre"], g["centre"]) <= CLUSTER_LINK_M for g in group):
                    group.append(cand)
                    remaining.remove(cand)
                    changed = True
        out.append(group)
    out.sort(key=lambda g: -sum(a["areaM2"] for a in g))
    return out


def find(uni: dict[str, Any], city: str) -> dict[str, Any]:
    # The eponym is itself a discriminating token: "georg", "august", "rwth", "goethe" identify
    # the institution far more sharply than the city-plus-generic name DESTATIS records.
    uni_names = names_for(uni)
    disc: set[str] = set()
    for n in uni_names:
        disc |= discriminating(n, city)
    elements = query_city(city)

    scored: list[dict[str, Any]] = []
    for el in elements:
        pts = ring_of(el)
        if len(pts) < 3:
            continue
        s, why = score(el, disc, uni_names, city)
        if s < 4:                      # below this, nothing said it is THIS university
            continue
        b = bbox_of(pts)
        scored.append({
            "osmId": f"{el['type']}/{el['id']}",
            "name": (el.get("tags") or {}).get("name"),
            "operator": (el.get("tags") or {}).get("operator"),
            "score": s,
            "evidence": why,
            "bbox": b,
            "areaM2": round(area_m2(b)),
            "centre": ((b["minLat"] + b["maxLat"]) / 2, (b["minLon"] + b["maxLon"]) / 2),
        })

    campuses: list[dict[str, Any]] = []
    for group in cluster(scored):
        pts: list[tuple[float, float]] = []
        for a in group:
            pts += [(a["bbox"]["minLat"], a["bbox"]["minLon"]), (a["bbox"]["maxLat"], a["bbox"]["maxLon"])]
        b = bbox_of(pts)
        w, h = bbox_size_km(b)
        campuses.append({
            "bbox": b,
            "widthKm": round(w, 2),
            "heightKm": round(h, 2),
            "areaCount": len(group),
            "areas": [{k: a[k] for k in ("osmId", "name", "operator", "score", "evidence")} for a in group[:8]],
            "tooWide": w > MAX_CAMPUS_KM or h > MAX_CAMPUS_KM,
            "tooSmall": area_m2(b) < MIN_CAMPUS_M2,
        })

    usable = [c for c in campuses if not c["tooWide"] and not c["tooSmall"]]
    return {
        "id": uni["id"],
        "name": uni["name"],
        "city": city,
        "discriminatingTokens": sorted(disc),
        "elementsSeen": len(elements),
        "accepted": len(scored),
        "campuses": campuses,
        # ⚠️ NO FALLBACK. If nothing scored, this is empty and says so — it does not offer the
        # largest education area in the city, which is how a Gesamtschule got proposed last time.
        #
        # ⚠️ AND "NO DISCRIMINATING TOKEN" IS NO LONGER A REASON TO GIVE UP. It was, and that was
        # too strict: K\u00f6ln, Hamburg and Bochum are all named after their cities, all three resolved
        # to nothing, and all three are perfectly findable by whole-name similarity. A tool that
        # refuses the three biggest cases is as useless as one that guesses.
        "needsReview": not usable or any(c["tooWide"] for c in campuses),
        "reviewReason": (
            # ⚠️ LOOK AT THE SEARCH BEFORE BLAMING THE NAME. If the city query returned almost
            # nothing, the tool was looking in the wrong place and no alias will ever fix it — see
            # `CITY_OVERRIDES`. Reporting this as a naming failure sent the last investigation
            # after the name for a fault that was entirely in the location.
            f"only {len(elements)} areas exist in {city} at all — the search looked in the wrong "
            "place, or this is not where the campus is; check the city before the name"
            if not scored and len(elements) < TOO_FEW_AREAS
            else "nothing matched — no area in this city names or operates for this university"
            if not scored
            else "a cluster is wider than the campus ceiling — several sites, or a bad match"
            if any(c["tooWide"] for c in campuses)
            else "" if usable else "every cluster was rejected as too small"
        ),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--university", help="registry id, e.g. HS163")
    ap.add_argument("--all", action="store_true", help="every tier-B university in the registry")
    ap.add_argument("--review", action="store_true", help="print only what needs a human")
    ap.add_argument("--redo", action="store_true",
                    help="with --all, re-query universities that already resolved")
    ap.add_argument("--limit", type=int, default=0, help="stop after N universities")
    args = ap.parse_args()

    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    unis = reg["universities"]
    if args.university:
        unis = [u for u in unis if u["id"] == args.university]
        if not unis:
            raise SystemExit(f"no university {args.university} in the registry")
    elif args.all:
        unis = [u for u in unis if u["tier"] == "b"]
    else:
        raise SystemExit("give --university <id> or --all")
    if args.limit:
        unis = unis[: args.limit]

    existing = json.loads(CANDIDATES.read_text(encoding="utf-8")) if CANDIDATES.exists() else {}
    results: dict[str, Any] = existing.get("results", {})

    def save() -> None:
        CANDIDATES.write_text(
            json.dumps({"$note": "CANDIDATES — nothing here is confirmed. "
                                 "See find_campus_areas.py.",
                        "results": results}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    # ⚠️ SKIP WHAT IS ALREADY ANSWERED, unless asked to redo it. Overpass is free, shared and
    # rate-limits hard, and a 30-university batch WILL need re-running after a 504 — re-asking for
    # the ones that already succeeded is how the next run gets throttled too.
    #
    # ⚠️ "ANSWERED" MEANS RESOLVED, NOT MERELY PRESENT. The first version skipped anything without
    # an `error` key, which silently included all 12 entries flagged `needsReview` — so the run
    # after adding the alias table skipped every university the aliases were written for and
    # reported the identical 12 failures. A re-run exists precisely for the unresolved ones.
    def resolved(uid: str) -> bool:
        got = results.get(uid)
        return bool(got) and not got.get("error") and not got.get("needsReview")

    if args.all and not args.redo:
        before = len(unis)
        unis = [u for u in unis if not resolved(u["id"])]
        if before != len(unis):
            print(f"skipping {before - len(unis)} already resolved — use --redo to force")

    for i, u in enumerate(unis, 1):
        city = city_for(u)
        note = " (registry says " + u["sites"][0]["city"] + ")" if u["id"] in CITY_OVERRIDES else ""
        print(f"[{i}/{len(unis)}] {u['name']} ({city}){note} ", end="", flush=True)
        try:
            r = find(u, city)
        except Exception as exc:                      # noqa: BLE001 - reported, never fatal
            print(f"FAILED: {exc}")
            results[u["id"]] = {"id": u["id"], "name": u["name"], "city": city, "error": str(exc)}
            save()
            continue
        results[u["id"]] = r
        # ⚠️ WRITTEN AFTER EVERY UNIVERSITY, not at the end. The first batch was interrupted by
        # Overpass 504s partway through and lost every result it had already paid for — the same
        # mistake PHOENIX's road-graph builder records, made again here.
        save()
        ok = [c for c in r["campuses"] if not c["tooWide"] and not c["tooSmall"]]
        flag = "⚠ review" if r["needsReview"] else "ok"
        print(f"{r['elementsSeen']:>4} areas -> {r['accepted']:>3} accepted -> "
              f"{len(ok)} campus(es)  {flag}")
        time.sleep(1.0)                               # be polite to Overpass

    save()

    need = [r for r in results.values() if r.get("needsReview") or r.get("error")]
    print()
    print(f"{CANDIDATES.relative_to(ROOT)}: {len(results)} universities, "
          f"{len(results) - len(need)} resolved, {len(need)} need review")
    if args.review or need:
        for r in need:
            print(f"  ⚠ {r['name']}: {r.get('error') or r.get('reviewReason')}")


if __name__ == "__main__":
    main()

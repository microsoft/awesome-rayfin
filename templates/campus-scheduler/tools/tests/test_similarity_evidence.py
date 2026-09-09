"""Whole-name similarity must be evidence about the institution, not about the town.

Run: `python tools/tests/test_similarity_evidence.py` (a script, not pytest — PLAN §19).

⚠️ THIS GUARDS THE WORST FAILURE THIS TOOL CAN HAVE. Matching nothing is visible and gets
reviewed; matching the WRONG university is invisible and ships. Two of these were live in the
candidate data — accepted, scored 11, and saved only by their cluster being too small to pass the
size floor. A larger cluster would have drawn another institution's buildings on the national map
under this university's name.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "geodata"))

from find_campus_areas import (  # noqa: E402
    MIN_NON_CITY_CHARS,
    NAME_SIMILARITY_MIN,
    names_for,
    non_city_core,
    similarity,
    similarity_evidence,
)

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)


print("whole-name similarity is about the institution, not the town\n")

# ── The two that were actually accepted in the shipped candidate data ─────────────────────────
vhs = similarity_evidence("TH Deggendorf", "Deggendorf", "VHS Deggendorf")
check(
    "a Volkshochschule is not a Technische Hochschule",
    vhs < NAME_SIMILARITY_MIN,
    f"raw ratio {similarity('TH Deggendorf', 'VHS Deggendorf'):.3f} → evidence {vhs:.3f}",
)

evang = similarity_evidence(
    "Pädagogische Hochschule Ludwigsburg", "Ludwigsburg", "Evangelische Hochschule Ludwigsburg"
)
check(
    "two different universities in one town are not each other",
    evang < NAME_SIMILARITY_MIN,
    f"raw ratio {similarity('Pädagogische Hochschule Ludwigsburg', 'Evangelische Hochschule Ludwigsburg'):.3f}"
    f" → evidence {evang:.3f}",
)

# ── The three cases whole-name similarity EXISTS for must keep working ────────────────────────
# ⚠️ These are the reason the rule cannot simply be "raise the threshold". Each is a university
# named after its own city, which has no discriminating token and can be found no other way.
hamburg = similarity_evidence("Universität Hamburg", "Hamburg", "Universität Hamburg")
check("a university named after its city still matches itself",
      hamburg >= NAME_SIMILARITY_MIN, f"{hamburg:.3f}")

bochum = similarity_evidence("Universität Bochum", "Bochum", "Ruhr-Universität Bochum")
check("and still matches its own longer legal name",
      bochum >= NAME_SIMILARITY_MIN, f"{bochum:.3f}")

koeln = similarity_evidence("Universität Köln", "Köln", "Universität zu Köln")
check("and tolerates a 'zu' it does not carry itself",
      koeln >= NAME_SIMILARITY_MIN, f"{koeln:.3f}")

# ── And the neighbours that must still be refused ─────────────────────────────────────────────
hafen = similarity_evidence("Universität Hamburg", "Hamburg", "HafenCity Universität Hamburg")
check("HafenCity is still not Universität Hamburg",
      hafen < NAME_SIMILARITY_MIN, f"{hafen:.3f}")

tuhh = similarity_evidence("Universität Hamburg", "Hamburg", "Technische Universität Hamburg")
check("nor is the technical university next door",
      tuhh < NAME_SIMILARITY_MIN, f"{tuhh:.3f}")

# ── The mechanics, stated so a future edit cannot quietly undo them ───────────────────────────
check("a name that is mostly its city has too little left to compare",
      len(non_city_core("TH Deggendorf", "Deggendorf")) < MIN_NON_CITY_CHARS,
      f"core={non_city_core('TH Deggendorf', 'Deggendorf')!r}")

check("a name with real substance beyond its city does not",
      len(non_city_core("Universität Hamburg", "Hamburg")) >= MIN_NON_CITY_CHARS,
      f"core={non_city_core('Universität Hamburg', 'Hamburg')!r}")
# ⚠️ AN ABBREVIATION MATCHING ITSELF IS AN IDENTITY, NOT A RESEMBLANCE, and the first version of
# this rule missed that. TU Dresden's buildings carry `operator=TU Dresden`; refusing every short
# name outright took 39 areas off a university that was resolving correctly. The regression check
# at the bottom is what caught it.
dresden = similarity_evidence("TU Dresden", "Dresden", "TU Dresden")
check("a short name still matches itself exactly",
      dresden >= NAME_SIMILARITY_MIN, f"{dresden:.3f}")

# ⚠️ `HTW Dresden` IS THE HOCHSCHULE FÜR TECHNIK UND WIRTSCHAFT, a different university whose
# buildings were being accepted for TU Dresden at 0.857 — `tu` and `htw` are unrelated
# abbreviations that merely look alike as strings. Chosen over an invented "VHS Dresden" because
# that scored below the threshold anyway, so it passed with the guard removed: a check that cannot
# fail is decoration.
htw = similarity_evidence("TU Dresden", "Dresden", "HTW Dresden")
check("one abbreviation is not another that looks like it",
      htw < NAME_SIMILARITY_MIN,
      f"raw ratio {similarity('TU Dresden', 'HTW Dresden'):.3f} → evidence {htw:.3f}")
check("an empty other-name is never evidence",
      similarity_evidence("Universität Hamburg", "Hamburg", "") == 0.0)

# ── Nothing currently resolved may become UNFINDABLE ──────────────────────────────────────────
# ⚠️ THE QUESTION IS NOT "DOES EVERY AREA SURVIVE", AND ASKING THAT WAS WRONG. The guard exists to
# remove areas, so counting removals as regressions argues for loosening a rule that is working.
# It flagged TU Dresden twice: first because the check ignored aliases (a false alarm, fixed), and
# then because the guard had correctly dropped two buildings whose operator is **HTW Dresden** —
# the Hochschule für Technik und Wirtschaft, a different university, scoring 0.857 against the
# alias "TU Dresden" purely because `tu` and `htw` look alike as strings. That is a third false
# positive found by the rule, not damage done by it.
#
# What would be a real regression is a university that had evidence and now has none at all.
cand = json.loads((ROOT / "config" / "campus-candidates.json").read_text("utf-8"))["results"]
registry = {u["id"]: u for u in
            json.loads((ROOT / "config" / "universities.json").read_text("utf-8"))["universities"]}

unfindable: list[str] = []
dropped: list[str] = []
for uid, entry in cand.items():
    city = entry.get("city") or ""
    uni = registry.get(uid)
    names = names_for(uni) if uni else [entry.get("name", "")]

    kept = 0
    for campus in entry.get("campuses", []):
        if campus.get("tooSmall") or campus.get("tooWide"):
            continue
        for area in campus.get("areas", []):
            ev = area.get("evidence") or []
            if any(e.startswith(("name:", "operator:", "wikidata")) and not e.startswith("wikidata+name")
                   for e in ev):
                kept += 1
                continue
            if any(e.startswith(("name:", "operator:")) for e in ev):
                kept += 1                 # a token carried it; the guard cannot touch it
                continue
            best = max(
                max(similarity_evidence(n, city, area.get("name") or ""),
                    similarity_evidence(n, city, area.get("operator") or ""))
                for n in names
            )
            if best >= NAME_SIMILARITY_MIN:
                kept += 1
            else:
                dropped.append(f"{uid} {area.get('name')!r} (operator {area.get('operator')!r})")

    had_any = any(
        c.get("areas") for c in entry.get("campuses", [])
        if not c.get("tooSmall") and not c.get("tooWide")
    )
    if had_any and kept == 0:
        unfindable.append(f"{uid} {registry.get(uid, {}).get('name', '?')}")

check("no university that resolves today becomes unfindable", not unfindable,
      "; ".join(unfindable))

# Not an assertion — a finding. Each of these is an area the rule now refuses, and each one is
# worth a human glance the first time it appears.
print(f"\n  ({len(dropped)} area(s) no longer accepted on similarity alone)")
for d in dropped[:8]:
    print(f"     - {d}")

print()
if FAILURES:
    print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
    raise SystemExit(1)
print("ok — a ratio can no longer hand one university another one's campus")

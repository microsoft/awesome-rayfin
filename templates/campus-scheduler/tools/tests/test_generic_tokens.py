"""A token many institutions share cannot carry an acceptance on its own.

Run: `python tools/tests/test_generic_tokens.py` (a script, not pytest — PLAN §19).

⚠️ THE FAILURE THIS PREVENTS IS A FACILITIES DEPARTMENT BECOMING A CAMPUS. `Hauptabteilung V -
Gebäude und Technik` was accepted for Hochschule Technik und Wirtschaft Karlsruhe because it
contains the word *Technik*, scoring exactly 5 against a threshold of 4. The same shape put
`VHS Deggendorf` and `HTW Dresden` on other universities — see PLAN §35 — and this is the last of
that family.

⚠️ AND THE OPPOSITE MISTAKE IS JUST AS EASY. Deleting these tokens instead of demoting them would
strip `padagogische` from Pädagogische Hochschule Ludwigsburg — the one word separating it from
Evangelische Hochschule Ludwigsburg — and reopen a false positive closed one commit earlier. Both
directions are asserted below.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "geodata"))

from find_campus_areas import (  # noqa: E402
    GENERIC_TOKEN_SCORE,
    GENERIC_TOKENS,
    NAME_TOKEN_SCORE,
    OPERATOR_TOKEN_SCORE,
    STOP,
    discriminating,
    score,
    tokens,
)

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)


def area(name: str = "", operator: str = "", **tags):
    return {"type": "way", "id": 1, "tags": {"name": name, "operator": operator, **tags}}


print("a shared token is weak evidence, not free evidence\n")

# ── The acceptance threshold in find() is 4. These are the arithmetic facts that matter. ──────
check("a generic token alone cannot reach the acceptance threshold",
      GENERIC_TOKEN_SCORE < 4, f"{GENERIC_TOKEN_SCORE} < 4")
check("a specific token can, from either field",
      NAME_TOKEN_SCORE >= 4 and OPERATOR_TOKEN_SCORE >= 4,
      f"name={NAME_TOKEN_SCORE} operator={OPERATOR_TOKEN_SCORE}")

# ── The real false positive ───────────────────────────────────────────────────────────────────
karlsruhe = discriminating("Hochschule Technik und Wirtschaft Karlsruhe", "Karlsruhe")
s, why = score(
    area("Hauptabteilung V - Gebäude und Technik", building="university"),
    karlsruhe,
    ["Hochschule Technik und Wirtschaft Karlsruhe"],
    "Karlsruhe",
)
check("a facilities department is not a campus of Hochschule Technik und Wirtschaft",
      s < 4, f"score {s} {why}")

# ── And the legitimate matches that must survive ──────────────────────────────────────────────
# ⚠️ FOM's own name really does contain "Management". Demotion must not cost it its campus: with
# amenity=university it lands exactly on the threshold, which is the intended behaviour.
fom = discriminating("Priv. FH für Ökon. u. Management Essen", "Essen")
s, why = score(
    area("FOM Hochschule für Oekonomie & Management", amenity="university"),
    fom,
    ["Priv. FH für Ökon. u. Management Essen"],
    "Essen",
)
check("FOM's own name still matches FOM", s >= 4, f"score {s} {why}")

ludwigsburg = discriminating("Pädagogische Hochschule Ludwigsburg", "Ludwigsburg")
check("padagogische is kept as evidence rather than deleted",
      "padagogische" in ludwigsburg and "padagogische" not in STOP,
      f"disc={sorted(ludwigsburg)}")

s, why = score(
    area("Gebäude 1a", operator="Pädagogische Hochschule Ludwigsburg", building="university"),
    ludwigsburg,
    ["Pädagogische Hochschule Ludwigsburg"],
    "Ludwigsburg",
)
check("and a PH Ludwigsburg building is still accepted", s >= 4, f"score {s} {why}")

# ⚠️ The neighbour it must still be told apart from. This is the §35 case, re-asserted here
# because demotion is exactly the change that could quietly undo it.
s, why = score(
    area("Evangelische Hochschule Ludwigsburg", amenity="university", wikidata="Q1"),
    ludwigsburg,
    ["Pädagogische Hochschule Ludwigsburg"],
    "Ludwigsburg",
)
check("and Evangelische Hochschule Ludwigsburg is still refused", s < 4, f"score {s} {why}")

# ── The list itself has to stay honest ────────────────────────────────────────────────────────
check("nothing is in both STOP and GENERIC_TOKENS",
      not (STOP & GENERIC_TOKENS), f"{sorted(STOP & GENERIC_TOKENS)}")
check("every generic token survives tokenisation",
      all(tokens(t) == {t} for t in GENERIC_TOKENS),
      f"{sorted(t for t in GENERIC_TOKENS if tokens(t) != {t})}")

# ⚠️ A city name here would punish the one university whose only token is another city's name.
registry = json.loads((ROOT / "config" / "universities.json").read_text("utf-8"))["universities"]
cities = set()
for u in registry:
    cities |= tokens(u.get("city") or "")
    for site in u.get("sites") or []:
        cities |= tokens(site.get("city") or "")
check("no city name is treated as a generic token",
      not (GENERIC_TOKENS & cities), f"{sorted(GENERIC_TOKENS & cities)}")

# ── No shipped university may lose its last piece of evidence ─────────────────────────────────
cand = json.loads((ROOT / "config" / "campus-candidates.json").read_text("utf-8"))["results"]
stranded = []
for u in registry:
    uid = u["id"]
    entry = cand.get(uid) or {}
    city = entry.get("city") or u.get("city") or ""
    disc = discriminating(u["name"], city)
    resolved = any(
        not c.get("tooSmall") and not c.get("tooWide") for c in entry.get("campuses", [])
    )
    # A university whose every token is generic AND which has no other route is worth naming.
    if resolved and disc and disc <= GENERIC_TOKENS:
        stranded.append(f"{uid} {u['name']} ({sorted(disc)})")
check("no resolved university is left with only generic tokens", not stranded,
      "; ".join(stranded))

print()
if FAILURES:
    print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
    raise SystemExit(1)
print("ok — a shared word supports a match, it does not make one")

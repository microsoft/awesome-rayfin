"""Alias keys must name the university they claim to.

Run: `python tools/tests/test_campus_aliases.py` (a script, not pytest — PLAN §19).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "geodata"))

from find_campus_areas import ALIASES, CITY_OVERRIDES, city_for, fold, names_for  # noqa: E402

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)


registry = json.loads((ROOT / "config" / "universities.json").read_text("utf-8"))
by_id = {u["id"]: u for u in registry["universities"]}

check("every alias key exists in the registry",
      all(uid in by_id for uid in ALIASES),
      f"unknown: {sorted(set(ALIASES) - set(by_id))}")

# ⚠️ THE CHECK THAT MATTERS. Written from memory this table had HS102 -> "RWTH Aachen", and HS102
# is Universität Hamburg. An alias on the wrong id is a machine for manufacturing exactly the
# false matches the similarity threshold exists to prevent — and it would look like a SUCCESS,
# because the tool would confidently accept Aachen's campuses for Hamburg.
#
# A German university's alias is its legal name, so it must share the CITY with the registry
# entry. That is cheap to check and catches a transposed id immediately.
mismatched = []
for uid, aliases in ALIASES.items():
    uni = by_id.get(uid)
    if not uni:
        continue
    city = fold(uni["sites"][0]["city"])
    # "Frankfurt am Main" vs "Frankfurt": compare on the first word of the city.
    stem = city.split()[0]
    for alias in aliases:
        if stem not in fold(alias):
            mismatched.append((uid, uni["name"], alias, uni["sites"][0]["city"]))

check("every alias names the city its university is in", not mismatched,
      "; ".join(f"{u} ({n}) -> {a!r} but city is {c}" for u, n, a, c in mismatched))

check("names_for always starts with the registry name",
      all(names_for(u)[0] == u["name"] for u in registry["universities"]))

check("a university with no alias gets exactly one name",
      all(len(names_for(u)) == 1 for u in registry["universities"] if u["id"] not in ALIASES))

# An alias that merely repeats the registry name buys nothing and hides a typo.
useless = [(uid, a) for uid, aliases in ALIASES.items() for a in aliases
           if uid in by_id and fold(a) == fold(by_id[uid]["name"])]
check("no alias just repeats the registry name", not useless, str(useless))

# ── City overrides ───────────────────────────────────────────────────────────────────────────
# ⚠️ SAME HAZARD AS THE ALIASES, ONE STEP EARLIER. An alias on the wrong id makes the tool match
# the wrong university; a CITY on the wrong id makes it search the wrong town, which is worse
# because the failure is silent: the query comes back nearly empty and the tool blames the name.
check("every city override names a university in the registry",
      all(uid in by_id for uid in CITY_OVERRIDES),
      f"unknown: {sorted(set(CITY_OVERRIDES) - set(by_id))}")

check("every city override actually changes the city",
      all(fold(city) != fold(by_id[uid]["sites"][0]["city"])
          for uid, (city, _) in CITY_OVERRIDES.items() if uid in by_id),
      "an override equal to the registry city is a no-op that hides a typo")

# The reason is not decoration. This table moves the search somewhere the registry disagrees with,
# so the next reader has to be able to check the claim without re-deriving it.
check("every city override carries a reason",
      all(len(why) > 20 for _, why in CITY_OVERRIDES.values()))

check("city_for returns the override where there is one, the registry city otherwise",
      all(city_for(u) == (CITY_OVERRIDES[u["id"]][0] if u["id"] in CITY_OVERRIDES
                          else u["sites"][0]["city"])
          for u in registry["universities"]))

print()
if FAILURES:
    print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
    raise SystemExit(1)
print("ok — every alias and city override belongs to the university it is filed under")

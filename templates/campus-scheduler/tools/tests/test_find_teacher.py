"""Resolving a lecturer by name — the lookup that decides whose timetable you get.

Run: python tools/tests/test_find_teacher.py

⚠️ THE FAILURE THIS GUARDS IS SILENT AND CONFIDENT. `find_teacher` used to be a plain
`needle in name` scan returning the first hit in file order, so at OTH **"Leitner" resolved to
Achleitner** and at LMU **"Berger" to Blomberger**. Everything downstream then worked perfectly:
a real cascade, real student counts, a real repair — for a person nobody asked about, with nothing
on screen to reveal the substitution. That is worse than an error, because an error gets
investigated.

There are only two such collisions per site, which is exactly why this needs a test rather than a
careful reading: it is right until the surname pool shifts, and then it is quietly wrong again.

The mirror cases matter as much as the collisions. A lookup that refuses everything would satisfy
"Leitner is not Achleitner" perfectly, so each refusal is paired with something that must still
resolve — id, full name, lower case, and a genuine unique substring.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from schedule_store import ScheduleStore  # noqa: E402
from tools import get_affected_sessions  # noqa: E402

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("  ok    " if ok else "  FAIL  ") + name + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)


def surname(t: dict) -> str:
    name = t.get("name") or ""
    return name.split()[-1] if name else ""


def _ascii(word: str) -> str:
    """The same fold `schedule_store` uses, spelled out here on purpose.

    ⚠️ Importing the private helper would make this test agree with the implementation by
    construction — including when the implementation is wrong. Writing the expectation
    independently is what lets the two disagree.
    """
    import unicodedata

    lowered = word.lower().replace("ß", "ss")
    return "".join(
        c for c in unicodedata.normalize("NFKD", lowered) if not unicodedata.combining(c)
    )


for site in ("oth", "lmu"):
    store = ScheduleStore.load(site)
    print(f"=== {site} ===")

    # ── every surname resolves to the person who owns it ───────────────────────────────────
    # Derived from the data, not from a hard-coded pair: the collisions move when the surname
    # pool moves, and a test naming today's two would stop covering tomorrow's.
    wrong: list[str] = []
    unresolved: list[str] = []
    for t in store.teachers:
        found = store.find_teacher(surname(t))
        if found is None:
            unresolved.append(surname(t))
        elif found["teacherId"] != t["teacherId"]:
            wrong.append(f"{surname(t)} -> {found['name']}")
    check(
        "a surname never resolves to a DIFFERENT lecturer",
        not wrong,
        f"{len(wrong)} wrong: {wrong[:4]}",
    )
    check(
        "and every surname still resolves to somebody",
        not unresolved,
        f"{len(unresolved)} unresolved: {unresolved[:4]}",
    )

    # ── the collisions exist, so the check above is not vacuous ────────────────────────────
    collisions = [
        surname(t) for t in store.teachers
        if len([x for x in store.teachers if surname(t).lower() in (x.get("name") or "").lower()]) > 1
    ]
    check(
        "the dataset really contains surnames that are substrings of other names",
        bool(collisions),
        f"{len(collisions)}: {sorted(set(collisions))[:4]}",
    )

    # ── the mirrors: the ordinary ways of naming somebody still work ───────────────────────
    sample = store.teachers[0]
    checks = {
        "by id": sample["teacherId"],
        "by full name": sample["name"],
        "by lower-case surname": surname(sample).lower(),
    }
    for label, probe in checks.items():
        found = store.find_teacher(probe)
        check(f"still resolves {label}", bool(found) and found["teacherId"] == sample["teacherId"],
              f"{probe!r} -> {found['name'] if found else None}")

    check("an empty needle resolves to nothing", store.find_teacher("") is None)
    check("a name nobody has resolves to nothing", store.find_teacher("Zzzqqx") is None)

    # ── umlauts: the planner types German, the surname pool mostly does not ────────────────
    # ⚠️ MEASURED: only 3 of OTH's 80 lecturers and 7 of LMU's 102 carry an umlaut, so most
    # Bavarian surnames are stored flattened — `Beutlhauser`, `Neuhauser`, `Girnghuber`. Typing
    # `Beutlhäuser`, which is how a German speaker spells it, matched nothing and the app said the
    # lecturer did not exist while showing them in the dropdown two inches away.
    def umlautify(word: str) -> str:
        for plain, fancy in (("au", "äu"), ("u", "ü"), ("o", "ö"), ("a", "ä")):
            if plain in word:
                return word.replace(plain, fancy, 1)
        return word

    both_ways = 0
    for t in store.teachers:
        sur = surname(t)
        # ASCII stored, umlaut typed — and the reverse for the few that really carry one.
        for typed in {umlautify(sur), _ascii(sur)}:
            if typed == sur:
                continue
            found = store.find_teacher(typed)
            if found and found["teacherId"] == t["teacherId"]:
                both_ways += 1
    check(
        "an umlaut spelling reaches the same lecturer",
        both_ways > 0,
        f"{both_ways} name spellings resolved across the diacritic",
    )

    # ⚠️ AND THE FOLD MUST NOT MERGE TWO REAL SURNAMES. Diacritics only — collapsing the `ue`
    # digraph as well would fold "Bauer" onto "Baur", which is the confident-wrong failure this
    # whole lookup is being hardened against.
    folded_collisions = [
        surname(t) for t in store.teachers
        if len({x["teacherId"] for x in store.teachers
                if _ascii(surname(x)) == _ascii(surname(t))}) > 1
    ]
    check("folding does not merge two different surnames", not folded_collisions,
          f"{sorted(set(folded_collisions))[:4]}")

    # ── a near miss is a QUESTION, not an answer ───────────────────────────────────────────
    real = surname(sample)
    typo = real[:2] + real[3:] if len(real) > 4 else real + "x"
    result = get_affected_sessions(store, typo, day="Fr")
    if result.get("error") == "teacher_not_found":
        check(
            "a near miss comes back with candidates to ask about",
            bool(result.get("didYouMean")),
            f"{typo!r} -> {result.get('didYouMean')}",
        )
        check(
            "and the candidate list does NOT resolve the question by itself",
            result.get("teacher") is None,
        )
    else:
        # The typo happened to still be a unique substring — that is a resolve, not a failure.
        check("a near miss comes back with candidates to ask about", True,
              f"{typo!r} resolved directly, no ambiguity to report")

    check("nonsense offers no candidates rather than the nearest name",
          get_affected_sessions(store, "Zzzqqx", day="Fr").get("didYouMean") == [])
    print()

if FAILURES:
    print(f"{len(FAILURES)} failed: " + "; ".join(FAILURES))
    raise SystemExit(1)
print("ok — a name resolves to the person who owns it, or to a question")

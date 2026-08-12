#!/usr/bin/env python3
"""Refuse to publish a tree that still carries data we were not given the right to redistribute.

    python tools/verify_publishable.py                 # this working copy
    python tools/verify_publishable.py --root <dir>    # a staged template folder
    python tools/verify_publishable.py --census        # print every match, allowlisted or not

WHY THIS EXISTS AND WHY IT IS SO BLUNT
--------------------------------------
`tools/check_release.mjs` answers "is the switch set correctly and does the disk agree?". It reads
a known list of paths. This answers the different and harder question: "is there anything in this
tree we do not know about?" — so it opens EVERY FILE AS BYTES.

⚠️ NO EXTENSION ALLOWLIST AND NO FOLDER SKIPPING BEYOND THE FOUR DECLARED BELOW, both of which it
prints. Narrower versions of this idea have passed in this codebase's history while the withheld
name was still on screen: a `.json`-only scan misses a `.bin` sidecar and a compiled bundle; a
"source files only" scan misses generated assets, and generated assets are exactly where a name
re-enters after someone fixes the generator's output instead of the generator. GLSL is a string
inside the bundle, so shader comments ship too.

TWO CHECKS, DELIBERATELY DIFFERENT IN KIND
------------------------------------------
1. DATA — paths and content stamps that ARE the restricted material. Any hit is a hard failure and
   there is no allowlist, because nothing here is ever acceptable in a published tree.

2. NAMES — a byte census for the words, judged against a PATH allowlist with a reason for each
   entry. This one must not be a hard "the word must not appear": under
   `release.json navigatumData: "synthetic"` the TUM campus deliberately still ships, so its name
   is all over the source, the configs and the tests, and a scan that failed on the word would
   have to be switched off — which is how a check becomes decoration. What it catches instead is a
   NEW file carrying the name that nobody has looked at. That is the realistic leak.

⚠️ AN EMPTY SCAN MUST NEVER REPORT SUCCESS. If the walk finds no files at all — a mistyped
`--root`, a folder that does not exist — this exits non-zero. A rewrite of a sibling script once
examined nothing and said so approvingly.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from fnmatch import fnmatch
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# Skipped, and printed so the skip is a statement rather than a silence.
#
# ⚠️ THE REAL SKIP LIST IS GIT'S, NOT THIS ONE. `data/` holds 1.5 GB of GeoTIFFs and API caches;
# scanning it is impractical, and skipping it by name would be exactly the narrowing this file's
# docstring warns about. So the question is not asked as "is this directory boring?" but as
# "could this file ever be committed?", and it is asked of `git check-ignore` rather than of a
# list somebody has to remember to update. A file git refuses to track cannot reach a published
# tree; a file git would track is scanned, whatever it is. The paths below are only the fallback
# for a tree that is not a git repository at all.
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "test-results", "playwright-report", "dist"}

UNPUBLISHED_TREES = ["data", "public/terrain"]

# ---------------------------------------------------------------------------------------------
# CHECK 1 — the data itself. No allowlist. Any hit fails.
# ---------------------------------------------------------------------------------------------

FORBIDDEN_PATHS = [
    ("data/tum", "the TUM planner dataset, derived from TUMonline bookings"),
    ("data/raw/navigatum", "raw NavigaTUM API responses and the calendar snapshot"),
    ("data/oth-real", "OTH Regensburg's own Untis GPU export, sent privately for an evaluation"),
    ("public/terrain/garching/flows.json", "pedestrian flows routed from real TUM bookings"),
    ("public/terrain/garching/flows.bin", "pedestrian flows routed from real TUM bookings"),
    ("dist/terrain/garching/flows.json", "built copy of the same"),
    ("dist/terrain/garching/flows.bin", "built copy of the same"),
]

# Files whose acceptability depends on what they were built FROM, not on their name. A rooms.json
# from an internal build carries real TUMonline bookings and is byte-indistinguishable by filename
# from a synthetic one; only the stamp inside it can tell them apart.
STAMPED = [
    ("public/terrain/garching/rooms.json", "semantics", "synthetic"),
    ("dist/terrain/garching/rooms.json", "semantics", "synthetic"),
]

# ---------------------------------------------------------------------------------------------
# CHECK 2 — the names.
# ---------------------------------------------------------------------------------------------

PATTERNS = {
    "tum": re.compile(
        rb"NavigaTUM|navigatum|TUMonline|tumonline|\bTUM\b|Garching|"
        rb"Technische Universit(?:\xc3\xa4|ae|a)t M(?:\xc3\xbc|ue|u)nchen",
    ),
    "customer": re.compile(rb"oth-real|othreal|OTHREAL|Untis|UNTIS|GPU00[125]|Zeitw(?:\xc3\xbc|ue)nsche"),
    # ⚠️ NAMED INDIVIDUALS AT THE CUSTOMER.
    #
    # This class exists because the check above was not enough and I watched it not be enough. The
    # `customer` pattern DID flag `config/academic/oth.json`, and a blanket `config/` allowlist
    # entry — reasoned rather than read — waved it through. Inside was a `$source` line naming a
    # professor at the university, their timetable file, and their Untis short code, in a tracked
    # config file bound for a public gallery. The same worked example sat in a tool docstring.
    #
    # There is no general detector for "this is a real person", so this is an enumerated list of
    # the people whose names reached us. **Add to it whenever a new one does.**
    #
    # ⚠️ SURNAMES ONLY, AFTER A FIRST VERSION THAT WAS TOO BROAD. It also matched `StVP` and
    # `Stundenverteilungsplan`, which are a standard German university form and identify nobody —
    # three benign hits, and a check that cries wolf is a check that gets an allowlist entry
    # written for it in a hurry, which is the failure this whole class exists to undo.
    "customer_people": re.compile(rb"Andorfer|Biersack"),
    # ⚠️ NOT A LICENCE QUESTION, AND THAT IS WHY IT IS A SEPARATE CLASS. None of these is a
    # secret — a workspace id is useless to anyone without access to it. They are simply one
    # tenant's coordinates, and a template that carries them points every clone at one deployment
    # and one person's sign-in. This class also catches the two documents that are the real reason
    # it exists: an internal build log and a customer's own requirement capture, which name their
    # staff and describe their internal process, and which no gallery template has any business
    # shipping.
    "internal": re.compile(
        rb"fc3a8969|5249380b|522a9b89|4d41d56f|MngEnvMCAP|webapp\.fabricapps\.net|"
        rb"alkorn@|azurecontainerapps\.io",
    ),
}

# ⚠️ PATH PREFIXES, WITH A REASON EACH. A prefix rather than an exact path because these are whole
# areas of the repository whose relationship to the restricted sources is already understood; an
# exact-path list would fail on every rename and would be silenced by whoever hit it next.
ALLOWED = {
    "tum": [
        ("config/", "configuration: the AOI, its campus outlines, the national index and the "
                    "OpenStreetMap operator tags on buildings that really are TUM's — the site "
                    "ships under `navigatumData: synthetic`, so it is named"),
        ("src/", "app source: the site ships, so it is named, labelled and translated"),
        ("e2e/", "end-to-end tests, which assert what the site does and does not offer"),
        ("tools/", "the pipeline and its fetchers — SOURCE for a public API, not its data"),
        ("server/", "the backend's per-site facts and prompts"),
        ("fabric/", "semantic-model definitions: TMDL column DESCRIPTIONS naming where a figure "
                    "comes from. Attribution, and the model ships with no rows in it"),
        ("docs/", "documentation"),
        ("README.md", "names the sites the template ships"),
        ("NOTICE.md", "attribution — naming the source is the whole point of the file"),
        ("AGENTS.md", "contributor guidance about exactly this restriction"),
        (".dockerignore", "build-context allowlist, which names the datasets"),
        (".templateignore", "the publication boundary, which has to name what it excludes"),
        ("Dockerfile", "backend image"),
        ("package.json", "scripts"),
        ("vite.config.ts", "a comment about which assets the release switch withholds"),
    ],
    "customer": [
        # ⚠️ NOT A BLANKET `config/` ENTRY ANY MORE. That is precisely what hid a professor's name
        # in `config/academic/oth.json`: the scan flagged the file, the allowlist covered the whole
        # directory with a reason I had reasoned rather than read, and the leak passed. One line
        # per file, so a NEW customer mention in configuration has to be looked at.
        ("config/release.json", "the switch that withholds it, and explains itself"),
        ("config/academic/oth.json", "the block scheme their own form disproved our assumption "
                                     "about — a published fact about how they teach, no rows"),
        ("config/aoi/oth-regensburg.json", "names the backend the switch substitutes"),
        ("config/aoi/lmu-muenchen.json", "a note on where a room-code pattern was derived from"),
        ("src/", "the substitution, its backend registry, the WebUntis integration panel, and "
                 "comments recording what went wrong when the site ids disagreed"),
        ("e2e/", "tests pinned to the GENERATED site, which is why they name the other one"),
        ("tools/", "the readers — our code, run against files we do not ship — and the gates"),
        ("server/", "site registry, prompts, and the WebUntis connection seam"),
        ("README.md", "says the real export exists and is not included"),
        ("NOTICE.md", "states what is withheld and why — the point of the file"),
        (".templateignore", "the publication boundary, which has to name what it excludes"),
        (".dockerignore", "build-context allowlist"),
        ("Dockerfile", "backend image"),
    ],
    # ⚠️ DELIBERATELY EMPTY, AND IT SHOULD STAY THAT WAY. A named person at a customer has no
    # reason to appear anywhere in a public template, so there is nothing to justify. If this list
    # ever grows an entry, the entry is the thing to argue about.
    "customer_people": [
        ("tools/verify_publishable.py", "this file, which has to spell the names out to find them"),
    ],
    "internal": [
        ("tools/verify_publishable.py", "this file, which has to spell the patterns out"),
        ("tools/verify_deploy.mjs", "the post-deploy verifier, which knows what a Fabric host looks like"),
        ("e2e/site-guard.spec.ts", "matches the Azure Container Apps domain to tell which host a "
                                  "request went to — a public suffix, not anybody's address"),
    ],
}


def allowed_for(kind: str, rel: str) -> str | None:
    for prefix, why in ALLOWED[kind]:
        if rel == prefix or rel.startswith(prefix.rstrip("/") + "/") or (
            prefix.endswith("/") and rel.startswith(prefix)
        ):
            return why
    return None


def git_publishable(root: Path) -> list[Path] | None:
    """Every file git would carry into a clone: tracked, plus untracked-and-not-ignored.

    `None` if git cannot answer, which is not the same as "nothing" and must not be read as it.

    ⚠️ ASKED THE POSITIVE WAY ROUND, AFTER GETTING IT WRONG THE OTHER WAY. The first version
    asked `check-ignore` which files to SKIP and treated an empty answer as "nothing is ignored",
    so a query that failed to return read as a tree with no ignores at all — it went on to read
    1.5 GB of GeoTIFFs and reported every cached Overpass response as an unreviewed leak. Asking
    for the files that CAN be published fails the other way: if git says nothing, the caller below
    refuses rather than proceeding on a short list. **A query that returns nothing must never be
    the reason a check passes.**
    """
    import subprocess

    try:
        proc = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-c", "-o", "--exclude-standard", "-z"],
            capture_output=True,
        )
    except OSError:
        return None
    if proc.returncode != 0:
        return None
    rels = [r for r in proc.stdout.decode("utf-8", "surrogateescape").split("\0") if r]
    if not rels:
        return None
    return [root / r for r in rels]


def template_removed(root: Path) -> list[str]:
    """Path prefixes `.templateignore` keeps out of the published template.

    ⚠️ THE SECOND HALF OF "COULD THIS BE PUBLISHED?", AND LEAVING IT OUT MADE THE TOOL CRY WOLF.
    Asking git alone answers "could this be committed?", which is not the same question: the build
    log, the customer's requirement capture and the internal deployment notes are all committed on
    purpose and all excluded from the template on purpose. Scanning them produced two failures on
    every run of the source repository for content that is doing exactly what it should.

    A check that fails when nothing is wrong gets an allowlist entry written for it in a hurry —
    which is precisely how a professor's name got waved through in the first place.
    """
    f = root / ".templateignore"
    if not f.exists():
        return []
    return [
        line.strip().rstrip("/")
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def walk(root: Path) -> list[Path]:
    out: list[Path] = []
    for path in root.rglob("*"):
        rel = path.relative_to(root).as_posix()
        if any(part in SKIP_DIRS for part in Path(rel).parts):
            continue
        if path.is_file():
            out.append(path)
    return out


def prove_excluded(root: Path) -> list[str]:
    """Fallback for a tree git cannot speak for: show the two big trees are excluded by name.

    ⚠️ ONLY REACHED WHEN GIT CANNOT ANSWER. Skipping a directory because it is "obviously" not
    published is what an assertion is for: if `.templateignore` is missing, or someone drops the
    `/data/` line while adding a committed sample dataset, the skip silently becomes a hole.
    """
    problems: list[str] = []
    for name in (".gitignore", ".templateignore"):
        f = root / name
        if not f.exists():
            problems.append(
                f"{name} is missing, so the unscanned trees ({', '.join(UNPUBLISHED_TREES)}) "
                "have nothing keeping them out of a published copy"
            )
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        for tree in UNPUBLISHED_TREES:
            # Accept `data/`, `/data/`, `public/terrain/` — anchored or not, trailing slash or not.
            if not re.search(rf"^\s*/?{re.escape(tree)}/?\s*$", text, re.MULTILINE):
                problems.append(f"{name} does not exclude {tree}/ — it was skipped on trust")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=str(REPO), help="tree to check (default: this repository)")
    ap.add_argument("--census", action="store_true", help="print every match, including allowlisted ones")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"FAIL — --root {root} is not a directory.")
        return 2

    print(f"Scanning {root}")

    problems: list[str] = []

    print("\n0. Which files could reach a clone at all")
    from_git = git_publishable(root)
    git_answered = from_git is not None
    if from_git is None:
        print("  git could not answer — falling back to a filesystem walk, and proving the skip")
        print(f"  skipping directories named: {', '.join(sorted(SKIP_DIRS))}")
        skip_rel = {Path(p).as_posix() for p in UNPUBLISHED_TREES}
        files = [
            f for f in walk(root)
            if not any(
                (r := f.relative_to(root).as_posix()) == s or r.startswith(s + "/")
                for s in skip_rel
            )
        ]
        skip_problems = prove_excluded(root)
        problems.extend(skip_problems)
        for p in skip_problems:
            print(f"  x {p}")
        if not skip_problems:
            print(f"  ok .gitignore and .templateignore both exclude {', '.join(UNPUBLISHED_TREES)}")
    else:
        files = from_git
        print(f"  git: {len(files)} tracked-or-untracked-but-not-ignored file(s).")
        print("  Anything git will not carry cannot be published, so it is out of scope here;")
        print("  everything git WILL carry is read below, whatever it is.")

    files = [f for f in files if f.is_file()]

    removed = template_removed(root)
    if removed:
        def in_template(f: Path) -> bool:
            rel = f.relative_to(root).as_posix()
            return not any(
                rel == r or rel.startswith(r + "/") or Path(rel).name == r or fnmatch(rel, r)
                for r in removed
            )

        before = len(files)
        files = [f for f in files if in_template(f)]
        print(f"  .templateignore removes {before - len(files)} more — they never reach the template.")

    print(f"\n  {len(files)} file(s) to read, as BYTES (no extension filter)")
    if not files:
        # A scan that examined nothing must not congratulate itself.
        print("\nFAIL — nothing to scan. Wrong --root, or git answered with an empty list.")
        return 2

    print("\n1. Restricted data")
    data_problems: list[str] = []

    publishable = {f.relative_to(root).as_posix() for f in files}

    def would_ship(rel: str) -> bool:
        """Is this path, or anything under it, in the set git would carry?

        ⚠️ PRESENT AND PUBLISHABLE ARE DIFFERENT QUESTIONS, and conflating them made this check
        useless in the one place it runs most: a developer's working copy legitimately holds
        `data/tum/` and `data/oth-real/`, because that is where the internal demo is built from.
        Failing on their existence made the tool cry wolf on every run, and a check that always
        fails is one nobody reads. What must fail is a restricted path that git WOULD carry —
        which is exactly what a staged template folder full of untracked files would look like.

        ⚠️ WITHOUT GIT THE ANSWER IS YES. The distinction above is only available because
        something authoritative drew it. In the fallback there is nothing to prove a path is
        excluded, and "I could not check" must not resolve to "it is fine" — that is the same
        fail-open bias the release switch refuses.
        """
        if not git_answered:
            return True
        return rel in publishable or any(p.startswith(rel.rstrip("/") + "/") for p in publishable)

    for rel, why in FORBIDDEN_PATHS:
        if not (root / rel).exists():
            continue
        if would_ship(rel):
            data_problems.append(f"{rel} would be published — {why}")
            print(f"  x {rel}  (git would carry it)")
        else:
            print(f"  · {rel} is on disk but git will not carry it — local build only")
    for rel, key, want in STAMPED:
        f = root / rel
        if not f.exists():
            continue
        try:
            stamp = json.loads(f.read_text(encoding="utf-8")).get(key)
        except Exception:
            stamp = None
        if stamp == want:
            print(f"  ok {rel}  ({key}={stamp!r})")
        elif would_ship(rel):
            data_problems.append(f"{rel} would be published with {key}={stamp!r}, not {want!r}")
            print(f"  x {rel}  ({key}={stamp!r}, git would carry it)")
        else:
            print(f"  · {rel} is a real-data build ({key}={stamp!r}) but git will not carry it")
    problems.extend(data_problems)
    if not data_problems:
        print("  ok nothing restricted would be published")

    print("\n2. Name census")
    unreviewed: dict[str, list[tuple[str, str]]] = {k: [] for k in PATTERNS}
    seen = {k: 0 for k in PATTERNS}
    for path in files:
        rel = path.relative_to(root).as_posix()
        try:
            blob = path.read_bytes()
        except OSError as exc:
            problems.append(f"{rel} could not be read ({exc}) — an unreadable file is not a clean one")
            continue
        for kind, pattern in PATTERNS.items():
            hits = pattern.findall(blob)
            if not hits:
                continue
            seen[kind] += 1
            why = allowed_for(kind, rel)
            sample = hits[0].decode("utf-8", "replace")
            if why is None:
                unreviewed[kind].append((rel, sample))
            elif args.census:
                print(f"  · {kind:8} {rel}  ({len(hits)}x, e.g. {sample!r}) — {why}")

    for kind in PATTERNS:
        n = len(unreviewed[kind])
        print(f"  {kind:8} {seen[kind]} file(s) mention it, {n} not covered by the allowlist")
        for rel, sample in unreviewed[kind]:
            print(f"      x {rel}  (e.g. {sample!r})")
            problems.append(
                f"{rel} mentions '{sample}' and no allowlist entry covers it. "
                f"Read it: either it is fine and belongs in ALLOWED['{kind}'] with a reason, "
                f"or it is a leak."
            )

    print()
    if problems:
        print(f"FAIL — {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("OK — nothing restricted, and every mention is one somebody has justified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

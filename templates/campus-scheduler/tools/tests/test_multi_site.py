"""One backend, many universities: does it answer as the RIGHT one, and refuse the wrong one?

The risk of merging three containers into one is not that it fails — it is that it succeeds with
the wrong university's data and nothing says so.
"""

import sys
from pathlib import Path

# ⚠️ RESOLVED FROM THIS FILE, NOT FROM THE WORKING DIRECTORY. This was `sys.path.insert(0,
# "server")`, so the test only loaded when it happened to be run from the repo root — anywhere
# else it died on `ModuleNotFoundError: No module named 'app'` before a single assertion ran.
# A test that cannot load is indistinguishable from one that passes unless somebody reads the
# summary, which is the same trap `theme.test.ts` documents on the TypeScript side. Sixteen of
# the eighteen guards here already resolve from `__file__`; this one now agrees with them.
#
# The three that legitimately still say "server" spawn a SUBPROCESS with `cwd=ROOT`, because
# `SCHEDULER_SITE` is read at import and each site needs its own process. Those are correct.
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

import app as api  # noqa: E402

FAIL: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("  ok    " if ok else "  FAIL  ") + name + (f" — {detail}" if detail else ""))
    if not ok:
        FAIL.append(name)


c = TestClient(api.app)
H = {"X-App-Key": api.APP_KEY} if api.APP_KEY else {}

print("one process, three universities\n")

expected = {
    "oth": "OTH Regensburg",
    "lmu": "LMU München",
    "tum": "TUM Garching",
}
summaries = {}
for site, label in expected.items():
    r = c.get(f"/api/plan/summary?site={site}", headers=H)
    d = r.json()
    summaries[site] = d
    check(
        f"{site}: summary is served as {label}",
        r.status_code == 200 and d.get("site") == site and d.get("siteLabel") == label,
        f"{d.get('site')} / {d.get('siteLabel')}",
    )

# The mirror: the three must be genuinely DIFFERENT, or one store is being served three times.
check(
    "the three universities are not the same data",
    len({summaries[s]["sessions"] for s in expected}) == 3,
    ", ".join(f"{s}={summaries[s]['sessions']}" for s in expected),
)

# Default: a request that names no site behaves exactly as the single-site deployment did.
d = c.get("/api/plan/summary", headers=H).json()
check("no site named falls back to the deployment default", d.get("site") == api.store.site, d.get("site"))

# An unknown university must be refused, not silently answered with the default.
r = c.get("/api/plan/summary?site=harvard", headers=H)
check("an unknown university is refused", r.status_code == 400, f"HTTP {r.status_code}")

# Suggestions and calendar must follow the same site.
r = c.get("/api/calendar/suggestions?scope=teacher&site=lmu", headers=H)
subs = r.json().get("subjects", [])
r2 = c.get("/api/calendar/suggestions?scope=teacher&site=oth", headers=H)
subs2 = r2.json().get("subjects", [])
check(
    "suggestions differ per university",
    bool(subs) and bool(subs2) and subs != subs2,
    f"lmu={len(subs)} oth={len(subs2)}",
)

# Drafts must be scoped: a draft made for one university must not appear for another.
import proposals  # noqa: E402
from schedule_store import store_for  # noqa: E402

pid = proposals.register([{"option": 1, "moves": [], "sessionsMoved": 0}], site="oth")
res = proposals.apply(store_for("oth"), pid, 1, "probe@example.com")
check("a draft can be created for oth", "draftId" in res, str(res)[:80])

oth_drafts = c.get("/api/drafts?site=oth", headers=H).json()["drafts"]
lmu_drafts = c.get("/api/drafts?site=lmu", headers=H).json()["drafts"]
check("the draft shows for oth", any(d["draftId"] == res.get("draftId") for d in oth_drafts))
check(
    "the draft does NOT show for lmu",
    not any(d["draftId"] == res.get("draftId") for d in lmu_drafts),
    f"lmu sees {len(lmu_drafts)}",
)

# And applying one university's proposal against another's plan is refused outright.
wrong = proposals.apply(store_for("lmu"), pid, 1, "probe@example.com")
check(
    "applying oth's proposal to lmu is refused",
    wrong.get("error") == "wrong_site",
    str(wrong)[:100],
)

print()
if FAIL:
    print(f"{len(FAIL)} failed: " + "; ".join(FAIL))
    raise SystemExit(1)
print("one backend serves each university as itself, and refuses the others")

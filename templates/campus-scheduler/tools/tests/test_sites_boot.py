"""Every registered site must actually START. Run: python tools/tests/test_sites_boot.py

⚠️ THIS EXISTS BECAUSE REGISTERING A SITE IN ONE PLACE LOOKED LIKE REGISTERING IT. `tum` was added
to `schedule_store._SYNTH_DIRS` and not to `foundry._SITE_FACTS`, so `app.py` raised `KeyError:
'tum'` at IMPORT. The container therefore never started, the startup probe failed 1 434 times, and
the platform reported only "ProbeFailed" with no replica alive to read a log from — which is
indistinguishable from a slow cold start until you try it locally. Twenty minutes of retrying a 504
is the cost of not having this test.
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Importing app.py is the real check: it is what the container runs, and it is where the failure was.
PROBE = """
import sys
sys.path.insert(0, "server")
import app  # noqa: F401
from schedule_store import ScheduleStore, SITE, SITE_LABEL
from foundry import SYSTEM_PROMPT
store = ScheduleStore.load()
assert store.sessions, "no sessions"
assert SITE_LABEL, "no site label"
# The assistant must greet the planner as THIS university, not as whichever one was first.
assert SITE_LABEL.split()[0] in SYSTEM_PROMPT, f"prompt does not name {SITE_LABEL}"
print(f"{SITE}|{SITE_LABEL}|{len(store.sessions)}|{len(store.rooms)}")
"""

SITES = ["oth", "lmu", "tum"]
failures: list[str] = []

for site in SITES:
    env = {**os.environ, "SCHEDULER_SITE": site, "PYTHONIOENCODING": "utf-8"}
    r = subprocess.run([sys.executable, "-c", PROBE], cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8", env=env)
    if r.returncode != 0:
        failures.append(site)
        tail = (r.stderr or "").strip().splitlines()[-3:]
        print(f"  FAIL  {site} does not boot")
        for line in tail:
            print(f"        {line}")
        continue
    line = [x for x in (r.stdout or "").splitlines() if "|" in x][-1]
    site_id, label, sessions, rooms = line.split("|")
    print(f"  ok    {site_id} boots as {label} — {sessions} sessions, {rooms} rooms")

if failures:
    print(f"\n{len(failures)} site(s) cannot start: {', '.join(failures)}")
    raise SystemExit(1)
print("\nok — every registered site starts the app the container actually runs")

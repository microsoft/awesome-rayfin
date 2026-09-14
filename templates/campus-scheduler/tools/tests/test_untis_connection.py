"""Guard: the Untis connection test must never claim a connection it did not make.

⚠️ THIS IS THE ONLY THING PROTECTING A SENTENCE SOMEBODY WILL SAY TO A CUSTOMER. "Only the
configuration is missing" is checkable exactly to the extent that pressing the button performs a
real request and reports a real outcome. A test that returned "connected" for a filled-in form
would be worse than no feature: it would be a confident false answer, and this repo has shipped
that shape before (the agent reporting "keine konfliktfreie Umplanung" from a call it made wrong).

Run: python tools/tests/test_untis_connection.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

import untis  # noqa: E402

FAILURES: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(label)


print("the Untis connection test tells the truth\n")

# ── Nothing configured is not a failure, and must not read as one ────────────────────────────
blank = untis.UntisConfig()
res = untis.test_connection(blank)
check("an empty configuration reports 'unconfigured', not an error",
      res["state"] == "unconfigured" and res["ok"] is False, res["state"])
check("and it names what is missing rather than saying 'invalid'",
      set(res.get("missing", [])) == {"server", "school", "username", "password"},
      str(res.get("missing")))

partial = untis.UntisConfig(server="example.webuntis.com", school="demo")
res = untis.test_connection(partial)
check("a half-filled configuration is still 'unconfigured'",
      res["state"] == "unconfigured" and set(res["missing"]) == {"username", "password"},
      str(res.get("missing")))

# ── SSRF: the backend must refuse to be pointed at itself or at a private network ─────────────
# ⚠️ Each of these is a real place a naive fetch would go. 169.254.169.254 is the cloud instance
# metadata service; on a Container App that is a credential endpoint.
for host, why in [
    ("http://webuntis.example.com", "plain http"),
    ("https://127.0.0.1", "loopback"),
    ("https://localhost", "loopback by name"),
    ("https://169.254.169.254", "cloud instance metadata"),
    ("https://10.0.0.5", "private range"),
    ("https://192.168.1.10", "private range"),
    ("https://user:pw@webuntis.example.com", "credentials in the URL"),
]:
    cfg = untis.UntisConfig(server=host, school="s", username="u", password="p")
    res = untis.test_connection(cfg)
    check(f"refuses {why}: {host}", res["state"] == "blocked" and res["ok"] is False,
          f"{res['state']}: {res['message']}")

# A public hostname that does not exist must be reported as such, not as "blocked" nor "connected".
cfg = untis.UntisConfig(
    server="no-such-host-campus-scheduler-test.invalid", school="s", username="u", password="p"
)
res = untis.test_connection(cfg)
check("a hostname that does not resolve is reported, not guessed",
      res["ok"] is False and res["state"] in {"blocked", "unreachable"},
      f"{res['state']}: {res['message']}")

# ── The endpoint is ours, not the caller's ───────────────────────────────────────────────────
endpoint = untis._safe_endpoint("https://example.com/anything/else?x=1")
check("the JSON-RPC path is fixed by us, not taken from the input",
      endpoint == "https://example.com/WebUntis/jsonrpc.do", endpoint)
check("a bare hostname is accepted and made https",
      untis._safe_endpoint("example.com") == "https://example.com/WebUntis/jsonrpc.do")

# ── Nothing anywhere returns the password ────────────────────────────────────────────────────
cfg = untis.UntisConfig(server="example.com", school="s", username="u", password="hunter2")
public = cfg.public()
check("the public view carries no password, only whether one is set",
      "password" not in public and public["passwordSet"] is True, str(public))
check("no test result contains the password",
      all("hunter2" not in str(untis.test_connection(c))
          for c in (cfg, untis.UntisConfig(server="https://127.0.0.1", school="s",
                                           username="u", password="hunter2"))))

# ── Write-back is described, not implemented ─────────────────────────────────────────────────
wb = untis.writeback_readiness()
check("write-back reports itself as not implemented", wb["implemented"] is False)
check("and still says what it would require", len(wb["requires"]) >= 3)

# ── A real server: honest about what it is talking to ────────────────────────────────────────
# example.com is reachable and is emphatically not WebUntis. The point is that a server which
# answers must NOT be reported as connected — only an actual WebUntis session may say that.
live = untis.UntisConfig(server="example.com", school="s", username="u", password="p")
res = untis.test_connection(live)
check("a reachable server that is not WebUntis is never 'connected'",
      res["ok"] is False and res["state"] in {"http-error", "unreachable", "rejected"},
      f"{res['state']}: {res['message'][:70]}")

print()
if FAILURES:
    print(f"{len(FAILURES)} failed: {'; '.join(FAILURES)}")
    sys.exit(1)
print("ok — configured is never reported as connected, and the target is never trusted")

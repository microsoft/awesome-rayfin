"""Phase-6 spike — can this app mint a realtime voice session at all?

Phases 4 and 5 both turned on a gate that took minutes to run and would have cost hours to skip, so
phase 6 gets one too. Three things have to be true before a single line of assistant UI is worth
writing:

  1. An Azure AI Foundry resource with a **realtime** deployment is reachable.
  2. A token this machine can actually obtain is accepted \u2014 no key in a file, no key in the browser.
  3. The `client_secrets` endpoint returns an **ephemeral** secret, which is the whole security
     model: the browser gets a short-lived secret and opens WebRTC straight to Foundry, and the
     real credential never leaves the server.

\u26a0\ufe0f No new Azure resource is created. `aif-flutinsights-swc` belongs to the sibling project this one
was scaffolded from and already carries a `gpt-voice` (gpt-realtime-2) deployment; realtime is
billed per use, so reusing it costs nothing until somebody speaks.

Usage
  python tools/voice/spike_realtime.py
"""

from __future__ import annotations

import json
import subprocess
import urllib.error
import urllib.request

AZ = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"

# The sibling project's Foundry resource. Realtime lives on the cognitiveservices host even when the
# project endpoint is a services.ai.azure.com one.
ENDPOINT = "https://aif-flutinsights-swc.cognitiveservices.azure.com"
REALTIME_DEPLOYMENT = "gpt-voice"
CHAT_DEPLOYMENT = "gpt-chat"

# ⚠️ Measured, not assumed. This is the audience the Cognitive Services data plane accepts; the
# Fabric and Kusto audiences from phases 4 and 5 are unrelated and do not work here.
RESOURCE = "https://cognitiveservices.azure.com"

# The voice the German locale uses. PLAN §14 Q5: one switch drives the interface language *and* the
# assistant voice, so the spike checks the one the app will actually ask for.
VOICE = "marin"


def token() -> str:
    result = subprocess.run(
        [AZ, "account", "get-access-token", "--resource", RESOURCE, "--query", "accessToken", "-o", "tsv"],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def post(url: str, bearer: str, body: dict) -> tuple[int, dict | str]:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {bearer}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - fixed host
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def main() -> None:
    print(f"endpoint  {ENDPOINT}")
    print(f"realtime  {REALTIME_DEPLOYMENT}")

    try:
        bearer = token()
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"could not get a token for {RESOURCE}: {exc.stderr[:300]}")
    print(f"token     acquired for {RESOURCE} ({len(bearer)} chars)\n")

    url = f"{ENDPOINT}/openai/v1/realtime/client_secrets"
    body = {
        "expires_after": {"anchor": "created_at", "seconds": 600},
        "session": {
            "type": "realtime",
            "model": REALTIME_DEPLOYMENT,
            "audio": {"output": {"voice": VOICE}},
        },
    }

    status, payload = post(url, bearer, body)
    print(f"POST {url}\n  -> {status}")

    if status not in (200, 201):
        print(f"\n{str(payload)[:1200]}")
        raise SystemExit(
            "\n\u274c the realtime handshake failed. Everything in phase 6 downstream of this depends on it,"
            "\n   so stop here rather than building an assistant against an endpoint that will not answer."
        )

    secret = payload.get("value") or (payload.get("client_secret") or {}).get("value")
    expires = payload.get("expires_at") or (payload.get("client_secret") or {}).get("expires_at")
    session = payload.get("session") or {}

    print(f"  ephemeral secret: {'yes' if secret else 'NO'} ({len(secret) if secret else 0} chars)")
    print(f"  expires_at:       {expires}")
    print(f"  session model:    {session.get('model')}")
    voice = ((session.get('audio') or {}).get('output') or {}).get('voice')
    print(f"  session voice:    {voice}")

    print(f"\n  browser would then POST its SDP offer to:")
    print(f"    {ENDPOINT}/openai/v1/realtime/calls")

    if secret:
        print(
            "\n\u2705 VERDICT: realtime is reachable and the ephemeral-secret flow works."
            "\n   The browser can hold a 10-minute secret and never sees a key."
        )
    else:
        print("\n\U0001f7e1 VERDICT: the endpoint answered but returned no secret \u2014 inspect the payload above.")


if __name__ == "__main__":
    main()

"""Phase 4 — push the relay's spooled fixes into the Eventhouse.

The relay writes NDJSON to disk (`node server/ogn/relay.js --spool data/live`) and this uploads it.
That split is deliberate and is explained in `relay.js`: the relay's whole job is to hold an
anonymous socket open and enforce the privacy rules, and giving it an Azure credential would couple
the live map's uptime to a cloud token it has no other use for. The spool is also a buffer — if
Fabric is unreachable, the live map carries on and the history catches up later.

⚠️ The ingestion token audience is **`https://kusto.kusto.windows.net`**, not
`https://kusto.fabric.microsoft.com`. The latter reads like the obvious choice for a Fabric
Eventhouse and is not a resource principal in the tenant at all — it fails with AADSTS500011.
Measured 2026-07-29; see the header of `setup_eventhouse.py`.

Usage
  python tools/fabric/ingest_live.py --ingest-uri https://ingest-xxx.z0.kusto.fabric.microsoft.com
  python tools/fabric/ingest_live.py --ingest-uri ... --spool data/live --follow
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from setup_lakehouse import request, token_for

KUSTO_RESOURCE = "https://kusto.kusto.windows.net"
DATABASE = "GleitschirmInsightsLive"
TABLE = "LiveFix"
MAPPING = "LiveFixMapping"

# Streaming ingestion caps a single request at 4 MB; this stays well inside it while still being
# few enough requests to be cheap. A busy afternoon over this AOI produces roughly 6 fixes/s, so a
# batch of 500 is about a minute and a half of traffic.
BATCH = 500

# Where the read position is remembered, so re-running does not re-ingest the whole day. Kept beside
# the spool rather than in the repo: it is state, not source.
CURSOR_NAME = ".ingest-cursor.json"


def load_cursor(spool: Path) -> dict[str, int]:
    path = spool / CURSOR_NAME
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_cursor(spool: Path, cursor: dict[str, int]) -> None:
    (spool / CURSOR_NAME).write_text(json.dumps(cursor, indent=2), encoding="utf-8")


def ingest(token: str, ingest_uri: str, rows: list[str]) -> None:
    """One streaming-ingest call. The body is newline-delimited JSON, which is what the spool holds."""
    url = (
        f"{ingest_uri}/v1/rest/ingest/{DATABASE}/{TABLE}"
        f"?streamFormat=json&mappingName={MAPPING}"
    )
    body = "\n".join(rows).encode("utf-8")
    status, payload, _ = request("POST", url, token, raw=body)
    if status not in (200, 204):
        raise SystemExit(f"ingestion failed: {status} {str(payload)[:400]}")


def pump(spool: Path, ingest_uri: str, token: str) -> int:
    """Send everything not yet sent. Returns the number of rows ingested."""
    cursor = load_cursor(spool)
    sent = 0

    for file in sorted(spool.glob("live-*.ndjson")):
        start = cursor.get(file.name, 0)
        lines = file.read_text(encoding="utf-8").splitlines()
        pending = lines[start:]
        if not pending:
            continue

        for index in range(0, len(pending), BATCH):
            batch = pending[index : index + BATCH]
            ingest(token, ingest_uri, batch)
            sent += len(batch)
            # The cursor advances per batch rather than per file, so an interruption costs at most
            # one batch of duplicates instead of a whole day of them.
            cursor[file.name] = start + index + len(batch)
            save_cursor(spool, cursor)

        print(f"  {file.name}: +{len(pending)} rows")

    return sent


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ingest-uri", required=True, help="ingestionServiceUri from setup_eventhouse.py")
    parser.add_argument("--spool", type=Path, default=Path("data/live"))
    parser.add_argument("--follow", action="store_true", help="keep watching the spool")
    parser.add_argument("--interval", type=int, default=60)
    args = parser.parse_args()

    if not args.spool.exists():
        raise SystemExit(f"no spool at {args.spool} — run the relay with --spool first")

    ingest_uri = args.ingest_uri.rstrip("/")
    token = token_for(KUSTO_RESOURCE)
    issued = time.time()

    while True:
        # Tokens last an hour; a --follow run outlives that, so it is refreshed on a timer rather
        # than only on a 401 — a 401 mid-batch would mean re-sending rows.
        if time.time() - issued > 45 * 60:
            token = token_for(KUSTO_RESOURCE)
            issued = time.time()

        sent = pump(args.spool, ingest_uri, token)
        print(f"{sent} rows ingested" if sent else "nothing new")

        if not args.follow:
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    main()

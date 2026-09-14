"""Step 2 - apply DatabaseSchema.kql to the KQL database.

The schema file is a sequence of control commands (`.create-merge table`, `.create-or-alter
function`, `.create-or-alter materialized-view`, `.alter table ... policy update`). They are sent
one at a time because the management endpoint takes a single command per request.

Every command is idempotent, so re-running this step is safe.

Note the token audience: `https://kusto.fabric.microsoft.com` is not registered in every tenant.
The *cluster URI* is used as the resource instead.
"""

import json
import re

from _fabric import REPO, call, need

SCHEMA = REPO / "fabric" / "eventhouse" / "DatabaseSchema.kql"


def split_commands(text: str) -> list[str]:
    without_comments = "\n".join(
        line for line in text.splitlines() if not line.strip().startswith("//")
    )
    # A new command always starts at the beginning of a line with a dot.
    parts = re.split(r"(?m)^(?=\.)", without_comments)
    return [part.strip() for part in parts if part.strip()]


def main() -> None:
    cluster = need("kusto_cluster")
    database = need("kql_database_name")

    commands = split_commands(SCHEMA.read_text(encoding="utf-8"))
    print(f"applying {len(commands)} commands to {database}")

    failures = 0
    for index, command in enumerate(commands):
        status, _headers, body = call(
            "POST",
            f"{cluster}/v1/rest/mgmt",
            {"db": database, "csl": command},
            resource=cluster,
        )
        headline = command.splitlines()[0][:88]
        if status == 200:
            print(f"  [{index}] ok   {headline}")
        else:
            failures += 1
            print(f"  [{index}] FAIL {status} {headline}")
            print("        " + json.dumps(body)[:400])

    if failures:
        raise SystemExit(f"{failures} command(s) failed")
    print("schema applied")


if __name__ == "__main__":
    main()

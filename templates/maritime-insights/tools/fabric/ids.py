"""Fabric deployment identifiers, read from the environment.

🔴 **These are never hard-coded.** This repo ships as a public template, and a workspace id baked
into source is two bugs at once: it publishes one tenant's identifiers to everybody who clones it,
and it points every clone's writes at a lakehouse its author does not own. The failure mode of the
second is the worse one — the scripts here `write_deltalake(...)` and `POST` semantic models, so a
wrong id is a write, not a read.

Set these before running anything in `tools/fabric/`:

```powershell
$env:FABRIC_WORKSPACE_ID = "<workspace guid>"
$env:FABRIC_LAKEHOUSE_ID = "<lakehouse guid>"
$env:FABRIC_MODEL_ID     = "<semantic model guid>"   # only the verify scripts need this
```

Each getter raises with the variable name rather than returning a placeholder: a missing id must
stop the run, because the alternative is a request that succeeds against the wrong thing.
"""
from __future__ import annotations

import os


def _require(name: str, purpose: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(
            f"{name} is not set.\n"
            f"  It identifies {purpose}.\n"
            f'  PowerShell:  $env:{name} = "<guid>"\n'
            f"  bash:        export {name}=<guid>\n"
            "  See tools/fabric/ids.py and docs/phase6-semantic-model.md."
        )
    return value


def workspace_id() -> str:
    return _require("FABRIC_WORKSPACE_ID", "the Fabric workspace the items live in")


def lakehouse_id() -> str:
    return _require("FABRIC_LAKEHOUSE_ID", "the lakehouse the Delta tables are written to")


def model_id() -> str:
    return _require("FABRIC_MODEL_ID", "the semantic model the DAX checks are run against")

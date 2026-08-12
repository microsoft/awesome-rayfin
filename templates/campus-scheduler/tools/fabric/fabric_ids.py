"""Where the Fabric items live — read from the environment, never from a literal.

⚠️ THESE USED TO BE FOUR COPIES OF ONE TENANT'S GUIDS, WRITTEN INTO THE SOURCE.

That is fine in a private repository and wrong in a template: a clone would carry a workspace id
and a lakehouse id belonging to somebody else's Fabric capacity, and the scripts would either fail
with an authorisation error that reads as a broken tool, or — for anyone who happened to have
access — write into the wrong workspace.

None of these values is a secret. A workspace id is useless without permission on it. The reason
they do not belong here is simply that they are one deployment's coordinates, and a template has
no deployment.

Set them once per shell:

    $env:FABRIC_WORKSPACE_ID = "<workspace guid>"
    $env:FABRIC_LAKEHOUSE_ID = "<lakehouse guid>"     # after setup_lakehouse.py has created it
    $env:FABRIC_FOLDER_ID    = "<folder guid>"        # optional; omit to create at the root

⚠️ A MISSING VALUE RAISES, IT DOES NOT DEFAULT. A default that "usually works" is how a script
that writes Delta tables ends up writing them somewhere nobody meant, and the write succeeds.
"""
from __future__ import annotations

import os

_HINT = (
    "Set it to the id of the Fabric item you want this script to work on. "
    "`az rest --url https://api.fabric.microsoft.com/v1/workspaces` lists the workspaces you "
    "can reach; `.../workspaces/<id>/items` lists what is in one."
)


def _required(name: str, what: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is not set — {what}.\n{_HINT}")
    return value


def workspace_id() -> str:
    return _required("FABRIC_WORKSPACE_ID", "the workspace these items live in")


def lakehouse_id() -> str:
    return _required("FABRIC_LAKEHOUSE_ID", "the lakehouse to read or write")


def folder_id() -> str | None:
    """Optional. `None` means "create at the workspace root", which is a valid answer."""
    return os.getenv("FABRIC_FOLDER_ID", "").strip() or None

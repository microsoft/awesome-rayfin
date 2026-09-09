"""Step 4 - create (or update) the producer notebook.

The notebook resolves the Eventstream connection string at run time from
`GET /eventstreams/{id}/sources/{sourceId}/connection` using its own identity, so it holds no
secret. It does need to know *which* eventstream, and those two ids are patched into the source
here rather than being committed as literals.
"""

import re

from _fabric import (
    FABRIC_API,
    NAMES,
    REPO,
    call,
    create_item,
    fail,
    find_item,
    inline_part,
    lro,
    need,
    save_state,
    workspace,
)

NOTEBOOK = REPO / "fabric" / "notebook" / "notebook-content.py"


def patched_source() -> bytes:
    source = NOTEBOOK.read_text(encoding="utf-8")
    replacements = {
        "EVENTSTREAM_ITEM_ID": need("eventstream_id"),
        "EVENTSTREAM_SOURCE_ID": need("eventstream_source_id"),
    }
    for constant, value in replacements.items():
        source, count = re.subn(
            rf'^{constant}\s*=\s*"[^"]*"',
            f'{constant} = "{value}"',
            source,
            count=1,
            flags=re.MULTILINE,
        )
        if count != 1:
            fail("patch notebook", 0, {"error": f"could not find {constant} assignment"})
    return source.encode("utf-8")


def main() -> None:
    name = NAMES["notebook"]()
    definition = {
        "format": "fabricGitSource",
        "parts": [inline_part("notebook-content.py", patched_source())],
    }

    existing = find_item("notebooks", name)
    if existing:
        notebook_id = existing["id"]
        status, headers, body = call(
            "POST",
            f"{FABRIC_API}/workspaces/{workspace()}/notebooks/{notebook_id}/updateDefinition",
            {"definition": definition},
        )
        status, body = lro(status, headers, body)
        if status not in (200, 201, 204):
            fail("update notebook", status, body)
        print(f"updated notebook '{name}': {notebook_id}")
    else:
        created = create_item("notebooks", {
            "displayName": name,
            "description": "Polls the public HSL GTFS-RT feeds and pushes events to the Eventstream.",
            "definition": definition,
        })
        notebook_id = created["id"]
        print(f"created notebook '{name}': {notebook_id}")

    save_state(notebook_id=notebook_id)


if __name__ == "__main__":
    main()

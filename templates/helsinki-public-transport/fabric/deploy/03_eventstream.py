"""Step 3 - create the Eventstream and wire it to the Eventhouse.

`fabric/eventstream/eventstream.json` is a template: the node ids and the Eventhouse coordinates
are placeholders that get filled in here. Fresh GUIDs are minted for the source, stream and
destination nodes so two deployments never collide.

The source id is recorded because the producer notebook uses it to resolve the custom-endpoint
connection string at run time - that is how the notebook stays free of secrets.
"""

import json
import uuid

from _fabric import (
    FABRIC_API,
    NAMES,
    REPO,
    call,
    create_item,
    fail,
    find_item,
    inline_part,
    need,
    save_state,
    workspace,
)

DEFINITION = REPO / "fabric" / "eventstream" / "eventstream.json"
PROPERTIES = REPO / "fabric" / "eventstream" / "eventstreamProperties.json"


def main() -> None:
    name = NAMES["eventstream"]()

    existing = find_item("eventstreams", name)
    if existing:
        eventstream_id = existing["id"]
        print(f"eventstream '{name}' already exists: {eventstream_id}")
    else:
        source_id = str(uuid.uuid4())
        template = DEFINITION.read_text(encoding="utf-8")
        filled = (
            template
            .replace("__SOURCE_ID__", source_id)
            .replace("__STREAM_ID__", str(uuid.uuid4()))
            .replace("__DESTINATION_ID__", str(uuid.uuid4()))
            .replace("__WORKSPACE_ID__", workspace())
            .replace("__KQL_DATABASE_ID__", need("kql_database_id"))
            .replace("__KQL_DATABASE_NAME__", need("kql_database_name"))
        )
        if "__" in filled:
            fail("fill eventstream template", 0, {"error": "unresolved placeholder", "body": filled})

        created = create_item("eventstreams", {
            "displayName": name,
            "description": "Custom endpoint fed by the HSL GTFS-RT producer notebook.",
            "definition": {"parts": [
                inline_part("eventstream.json", filled.encode("utf-8")),
                inline_part("eventstreamProperties.json", PROPERTIES.read_bytes()),
            ]},
        })
        eventstream_id = created["id"]
        print(f"created eventstream '{name}': {eventstream_id}")

    # Read the topology back rather than trusting the id we sent.
    status, _headers, topology = call(
        "GET", f"{FABRIC_API}/workspaces/{workspace()}/eventstreams/{eventstream_id}/topology"
    )
    if status != 200:
        fail("read eventstream topology", status, topology)

    sources = topology.get("sources", [])
    if not sources:
        fail("read eventstream topology", status, topology)
    source_id = sources[0]["id"]

    save_state(eventstream_id=eventstream_id, eventstream_source_id=source_id)
    print(json.dumps({
        "eventstream_id": eventstream_id,
        "source_id": source_id,
        "nodes": {
            "sources": [s.get("status") for s in sources],
            "destinations": [d.get("status") for d in topology.get("destinations", [])],
        },
    }, indent=2))


if __name__ == "__main__":
    main()

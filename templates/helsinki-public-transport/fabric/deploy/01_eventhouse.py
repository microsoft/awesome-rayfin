"""Step 1 - create the Eventhouse and record its KQL database and cluster URI.

Creating an Eventhouse implicitly creates a KQL database with the same name. Both ids and the
query URI are needed by every later step, so they are written to .state.json here.
"""

import json

from _fabric import (
    FABRIC_API,
    NAMES,
    call,
    create_item,
    fail,
    find_item,
    save_state,
    workspace,
)


def main() -> None:
    name = NAMES["eventhouse"]()

    existing = find_item("eventhouses", name)
    if existing:
        eventhouse_id = existing["id"]
        print(f"eventhouse '{name}' already exists: {eventhouse_id}")
    else:
        created = create_item("eventhouses", {"displayName": name})
        eventhouse_id = created["id"]
        print(f"created eventhouse '{name}': {eventhouse_id}")

    status, _headers, body = call(
        "GET", f"{FABRIC_API}/workspaces/{workspace()}/eventhouses/{eventhouse_id}"
    )
    if status != 200:
        fail("read eventhouse", status, body)

    properties = body.get("properties", {})
    query_uri = properties.get("queryServiceUri")
    database_ids = properties.get("databasesItemIds") or []
    if not query_uri or not database_ids:
        fail("read eventhouse", status, body)

    # The database created alongside the eventhouse carries the same display name.
    database_id = database_ids[0]
    status, _headers, databases = call(
        "GET", f"{FABRIC_API}/workspaces/{workspace()}/kqlDatabases"
    )
    if status == 200:
        for database in databases.get("value", []):
            if database.get("displayName") == name:
                database_id = database["id"]
                break

    save_state(
        eventhouse_id=eventhouse_id,
        kql_database_id=database_id,
        kql_database_name=name,
        kusto_cluster=query_uri,
    )
    print(json.dumps({
        "kql_database_id": database_id,
        "kusto_cluster": query_uri,
    }, indent=2))


if __name__ == "__main__":
    main()

"""Step 5 - create the DirectQuery semantic model.

Every table partition is an `AzureDataExplorer.Contents(<cluster>, <database>, <kql>)` expression.
The committed TMDL points at whichever cluster it was last exported from, so both arguments are
rewritten to the Eventhouse created in step 1.

`.platform` is deliberately not uploaded - Fabric assigns item metadata itself, and sending a
stale logicalId makes the create fail.
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

MODEL_DIR = REPO / "fabric" / "semantic-model"
SOURCE_PATTERN = re.compile(r'(AzureDataExplorer\.Contents\(")([^"]+)("\s*,\s*")([^"]+)(")')


def repointed_parts() -> list[dict]:
    cluster = need("kusto_cluster")
    database = need("kql_database_id")

    parts = []
    rewritten = 0
    for path in sorted(MODEL_DIR.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(MODEL_DIR).as_posix()
        if relative == ".platform":
            continue
        data = path.read_bytes()
        if relative.endswith((".tmdl", ".json", ".pbism")):
            text = data.decode("utf-8")
            text, count = SOURCE_PATTERN.subn(
                lambda m: f"{m.group(1)}{cluster}{m.group(3)}{database}{m.group(5)}", text
            )
            rewritten += count
            data = text.encode("utf-8")
        parts.append(inline_part(relative, data))

    if rewritten == 0:
        fail("repoint semantic model", 0, {
            "error": "no AzureDataExplorer.Contents(...) partitions found - check the TMDL"
        })
    print(f"repointed {rewritten} partition(s) to {cluster} / {database}")
    return parts


def main() -> None:
    name = NAMES["model"]()
    definition = {"parts": repointed_parts()}

    existing = find_item("semanticModels", name)
    if existing:
        model_id = existing["id"]
        status, headers, body = call(
            "POST",
            f"{FABRIC_API}/workspaces/{workspace()}/semanticModels/{model_id}/updateDefinition",
            {"definition": definition},
        )
        status, body = lro(status, headers, body)
        if status not in (200, 201, 204):
            fail("update semantic model", status, body)
        print(f"updated semantic model '{name}': {model_id}")
    else:
        created = create_item("semanticModels", {
            "displayName": name,
            "description": "DirectQuery over the HSL Eventhouse - live Helsinki transit positions.",
            "definition": definition,
        })
        model_id = created["id"]
        print(f"created semantic model '{name}': {model_id}")

    save_state(semantic_model_id=model_id)
    print("\nSet VITE_PBI_DATASET_ID (and the app's DATASET_ID default) to:", model_id)


if __name__ == "__main__":
    main()

"""Step 6 - bind credentials to the model's Kusto datasource.

This is the step that is easy to forget and breaks everything: without it `executeQueries`
returns HTTP 400 `DatasetExecuteQueriesError` and the app shows zeros with no useful message.

Three things have to happen, in order:

  1. Take ownership of the dataset, otherwise the datasource endpoints are not reachable.
  2. PATCH the gateway datasource with a *real* Kusto access token. An empty `credentialData`
     array is rejected with `DM_GWPipeline_Gateway_DataSourceAccessError`.
  3. PATCH again with `useEndUserOAuth2Credentials: true` so every app user queries the
     Eventhouse under their own identity - nothing stored can then expire.
"""

import json

from _fabric import (
    POWERBI_API,
    POWERBI_RESOURCE,
    call,
    fail,
    need,
    save_state,
    token,
    workspace,
)


def main() -> None:
    model_id = need("semantic_model_id")
    cluster = need("kusto_cluster")

    status, _headers, body = call(
        "POST",
        f"{POWERBI_API}/groups/{workspace()}/datasets/{model_id}/Default.TakeOver",
        {},
        resource=POWERBI_RESOURCE,
    )
    print(f"takeover: HTTP {status}")
    if status not in (200, 202, 204):
        fail("take over dataset", status, body)

    status, _headers, body = call(
        "GET",
        f"{POWERBI_API}/groups/{workspace()}/datasets/{model_id}/datasources",
        resource=POWERBI_RESOURCE,
    )
    if status != 200 or not body.get("value"):
        fail("list datasources", status, body)

    datasource = body["value"][0]
    gateway_id = datasource["gatewayId"]
    datasource_id = datasource["datasourceId"]
    print(f"datasource: gateway={gateway_id} id={datasource_id}")
    print("  " + json.dumps(datasource.get("connectionDetails", {})))

    # A token for the cluster itself - the audience https://kusto.fabric.microsoft.com is not
    # registered in every tenant.
    kusto_token = token(cluster)
    url = f"{POWERBI_API}/gateways/{gateway_id}/datasources/{datasource_id}"

    steps = [
        ("seed with a real Kusto token", {
            "credentialType": "OAuth2",
            "credentials": json.dumps(
                {"credentialData": [{"name": "accessToken", "value": kusto_token}]}
            ),
            "encryptedConnection": "Encrypted",
            "encryptionAlgorithm": "None",
            "privacyLevel": "Organizational",
            "useEndUserOAuth2Credentials": False,
        }),
        ("switch to end-user SSO", {
            "credentialType": "OAuth2",
            "credentials": json.dumps(
                {"credentialData": [{"name": "accessToken", "value": kusto_token}]}
            ),
            "encryptedConnection": "Encrypted",
            "encryptionAlgorithm": "None",
            "privacyLevel": "Organizational",
            "useEndUserOAuth2Credentials": True,
        }),
    ]

    for label, details in steps:
        status, _headers, body = call(
            "PATCH", url, {"credentialDetails": details}, resource=POWERBI_RESOURCE
        )
        print(f"{label}: HTTP {status}")
        if status not in (200, 204):
            fail(label, status, body)

    status, _headers, body = call("GET", url, resource=POWERBI_RESOURCE)
    print("\nfinal credentialType:", body.get("credentialType"))

    save_state(gateway_id=gateway_id, datasource_id=datasource_id)


if __name__ == "__main__":
    main()

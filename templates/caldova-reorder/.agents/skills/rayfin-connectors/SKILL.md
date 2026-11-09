---
name: rayfin-connectors
description: "Use for Rayfin connectors that wire existing Fabric SQL data sources (Lakehouse, Warehouse, SQL Database) into an app as GraphQL-backed entities. Triggers: rayfin connector, rayfin up connector apply, connectors:, fabric-sqlanalytics, fabric-warehouse, fabric-sqldatabase, kusto, kql, eventhouse, workspaceId, itemId, operations:, AppConnectorsSchema, ConnectorsSchema, rayfin/connectors/, metadata.json, connector @role policy, connector claims.sub filter, connector claims.email filter, ConnectorsRayfinClient, rayfin-client.ts, client.connectors, connectorConfig, GraphQLBackedConnector, RestrictedDataApi, schema.ts aggregate, generate entities from metadata, add a use case on specific entities, wire connector into client, call a connector from the SDK, rayfin connector inspect, inspect connector data, sample connector rows, fabric-semanticmodel, --entity, --query, DAX EVALUATE, read-only sample query, rayfin connector search, discover connectable sources, find fabric sources to add, --all-workspaces, --workspace-id, connector search interactive picker, rayfin connector invoke, invoke a connector operation, run executeQuery, --input, --file, RAYFIN_FEATURE_FLAGS, resultSetRowCountLimit, limit rows, row limit, cap rows, too many rows, overflow"
metadata:
  author: microsoft
  version: 0.5.1
rayfin-managed: true
---
# Rayfin Connectors

Bring an existing Fabric SQL data source (Lakehouse, Warehouse, SQL Database) into a Rayfin app as typed, GraphQL-backed entities. Covers the three day-one connector types, the lifecycle commands, generating entity files from a discovered schema, and scoping the surface with YAML `operations:` and `@role(...)`.

## When to Use a Connector

Use a connector when the user wants the app to read or write **existing** SQL data already living in a Fabric workspace (a Lakehouse, Warehouse, or SQL Database).

Do **not** use a connector when the user is creating a brand-new data model owned by the Rayfin app — those entities go under `rayfin/data/` and are managed via `rayfin up db apply`, not `rayfin connector add`.

**Routing note:** `@role` and `@entity` also appear in the base `rayfin` skill for owned `rayfin/data/` models. This skill applies only when those decorators are used inside `rayfin/connectors/` files, or when the context is connector-level RLS policies and entity generation from a Fabric source.

Connectors are cloud-only on day-one.
`rayfin dev` parses the `connectors:` block but does not wire it; verifying connector behavior requires `rayfin up`.

**Prerequisite — the `connector` command group is feature-flagged.**
`rayfin connector ...` is only registered when `RAYFIN_FEATURE_FLAGS` contains `connectors`.
Without it the commands do not exist and the CLI reports an unknown command.

**Two categories — decide first.**

- **Category A — GraphQL-backed entities.** Types `fabric-sqlanalytics`, `fabric-warehouse`, and `fabric-sqldatabase` surface Fabric SQL as typed entities with read/create/update/delete operations and `@role` row-level security.
  Use the [Step 1–8 workflow](#workflow).
- **Category B — function-bridge operations.** Type `kusto` (Fabric KQL Database) surfaces a platform-owned function as the named operations `executeQuery` (a KQL query) and `executeCommand` (a Kusto management/control command); type `fabric-semanticmodel` (DAX) surfaces `executeQuery`. Both run as the signed-in user.
  Do not generate entities, `@role` policies, or `metadata.json` entities.
  Use the [Category B section](#category-b--function-bridge-connectors) below and skip Steps 4–6.

## Connector Type Matrix

| Type | Display | Operations the type _can_ support | Auth modes | Required config | Notes |
|---|---|---|---|---|---|
| `fabric-sqlanalytics` | Lakehouse SQL endpoint | `read` | `delegated`, `application` | `workspaceId`, `itemId` | Read-only at the host. |
| `fabric-warehouse` | Warehouse | `read`, `create`, `update`, `delete` | `delegated`, `application` | `workspaceId`, `itemId` | Full CRUD. |
| `fabric-sqldatabase` | SQL Database | `read`, `create`, `update`, `delete` | `delegated`, `application` | `workspaceId`, `itemId` | Full CRUD. |
| `fabric-semanticmodel` | Fabric semantic model | `executeQuery` | `delegated` | `workspaceId`, `itemId` | Category B function bridge for DAX; adapter version `1`. |
| `kusto` | Fabric KQL Database | `executeQuery`, `executeCommand` | `delegated` | `workspaceId`, `itemId` | Category B function bridge for KQL queries and management commands; adapter version `1`. |

The validator rejects any `operations:` entry not in the connector type's allowlist.
The Lakehouse read-only restriction is enforced server-side.

## Category B — Function-Bridge Connectors

A Category B connector is a named-operation surface backed by a small, platform-owned function (UDF).
The Builder never writes or sees the function code.
The Builder declares the connector and calls a typed method; the Fabric app backend injects connector configuration and delegated authentication before forwarding to the function.
There are no GraphQL entities, so do not generate entity files, `@role` policies, or `metadata.json` entities for these connector types.

### Add the connector

```bash
rayfin connector add \
  --type kusto \
  --workspace-id <ws-id> \
  --item-id <kql-database-item-id> \
  --name telemetry
```

`--item-id` identifies the Fabric item to query: a KQL Database for `kusto`.
Omit `--name` to derive the connector name from the Fabric item's display name.
The CLI verifies the item, writes the `rayfin.yml` entry, and scaffolds `rayfin/connectors/<name>/schema.ts`.
The Kusto cluster query endpoint and database are resolved server-side from `(workspaceId, itemId)` at call time.
Never write a cluster URI or database name to YAML, and never send either value from app code.

### Resulting rayfin.yml

```yaml
connectors:
  - name: telemetry
    type: kusto
    version: '1'
    config:
      workspaceId: <ws-id>
      itemId: <kql-database-item-id>
    auth:
      type: delegated
    operations:
      - name: executeQuery
      - name: executeCommand
```

The `config` block is the single source of truth for what to query and is not sent on the client wire.
Category B connectors are pinned to an adapter version.
`kusto` allows `executeQuery` and `executeCommand`; `fabric-semanticmodel` allows `executeQuery`. In every case `auth.type` must be `delegated`.
Delegated authentication uses the signed-in user's identity through the on-behalf-of flow.

### Typed schema

The CLI-generated `rayfin/connectors/telemetry/schema.ts` exports both the typed marker and the runtime connector configuration:

```ts
import type { ConnectorConfig } from '@microsoft/rayfin-connectors';
import type { Kusto } from '@microsoft/rayfin-connector-kusto';

export type TelemetrySchema = Kusto<'executeQuery' | 'executeCommand'>;

export const connectorConfig = {
  connector: 'kusto',
} as const satisfies ConnectorConfig;
```

Install both imported packages as direct dependencies so the generated file resolves under strict package managers:

```bash
npm install @microsoft/rayfin-connector-kusto @microsoft/rayfin-connectors
```

### Wire into the aggregate schema and client

Use the same `AppConnectorsSchema` and `ConnectorsRayfinClient` wiring pattern as Step 8, but do not add entity re-exports or a `GraphQLBackedConnector`.
Import the generated `<Name>Schema` type and `connectorConfig` value, key both maps by the exact `rayfin.yml` connector name, and pass the config through the client's `connectors` option:

```ts
import { ConnectorsRayfinClient } from '@microsoft/rayfin-client/experimental';
import {
  type TelemetrySchema,
  connectorConfig as telemetryConfig,
} from '../../rayfin/connectors/telemetry/schema';

type AppConnectorsSchema = {
  telemetry: TelemetrySchema;
};

const client = new ConnectorsRayfinClient<
  Record<string, never>,
  Record<string, never>,
  AppConnectorsSchema
>({
  baseUrl: import.meta.env.VITE_RAYFIN_API_URL,
  publishableKey: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
  connectors: {
    telemetry: telemetryConfig,
  },
});
```

### Call it from app code

Correlation ids are not part of the response body (the connector function relays
the Kusto bytes untouched), so generate the `clientRequestId` yourself and pass
the same value to both `executeQuery` and `toQueryResult`:

```ts
const clientRequestId = `KPC.rayfin_kusto_v1;${crypto.randomUUID()}`;

const response = await client.connectors.telemetry.executeQuery({
  query: 'StormEvents | summarize count() by State | top 10 by count_',
  clientRequestId,
});
```

Optionally normalize the raw Kusto v1 `{ Tables }` document into a discriminated
result that preserves every returned Kusto table:

```ts
import { toQueryResult } from '@microsoft/rayfin-connector-kusto';

const result = toQueryResult(response, { clientRequestId });
if (result.status === 'success') {
  renderTables(result.tables);
} else {
  showError(result.error.code, result.error.message);
}
```

Successful results contain `tables` plus the `clientRequestId` you passed in
(empty when you pass none) and an optional `activityId`; correlation is never on
the wire.
Each table contains named typed `columns` and row-major `rows`.
Error results contain `error.message` and an optional `error.code`.

#### Management commands (`kusto`)

`executeCommand` runs a Kusto management (control) command — the command text
starts with a leading dot. It returns the same native Kusto v1 `{ Tables }`
document as `executeQuery`, so normalize it with `toQueryResult` the same way,
and pass a matching `clientRequestId` to correlate end to end:

```ts
const clientRequestId = `KPC.rayfin_kusto_v1;${crypto.randomUUID()}`;

const databases = await client.connectors.telemetry.executeCommand({
  command: '.show databases',
  clientRequestId,
});

const result = toQueryResult(databases, { clientRequestId });
```

#### Limiting rows (`fabric-semanticmodel`)

`executeQuery` on `fabric-semanticmodel` accepts an optional `resultSetRowCountLimit`. There is no default. Omit it and every row comes back, so ask the user for a bound rather than inventing one.

Prefer it over wrapping the DAX in `TOPN` when the user wants a guard rather than a deliberately ranked subset. Exceeding it fails the query with an `'overflow'` error, so a truncated result announces itself, where a `TOPN` returns a complete-looking partial answer.

Run `rayfin docs search "resultSetRowCountLimit"` for version-locked details, since this behavior is owned by the connector package rather than this skill.

### Verify

`rayfin dev` parses `connectors:` but does not wire Category B calls.
A real `executeQuery` requires `rayfin up`.

## Workflow

The Step 1–8 workflow below is for **Category A** GraphQL entity connectors.
For **Category B** (`kusto` and `fabric-semanticmodel`), use the Category B section above and skip Steps 4–6 for entity files, `@role`, and row-level security.

For any connector task, walk these steps in order.
Stop and ask the user when the next step needs information you don't already have.

### Step 1 — Add the connector

```bash
rayfin connector add --type <type> --workspace-id <ws-id> --item-id <item-id> [--name <name>] [--operations <ops>]
```

The CLI verifies the Fabric item, derives a connector `name` from the item's display name (override with `--name`), writes the entry to `rayfin.yml`, scaffolds `rayfin/connectors/<name>/schema.ts`, and runs schema discovery.

Either way, `rayfin/connectors/<name>/metadata.json` is written so a subset of entities can be generated later.

Options for `connector add`:

| Flag | Required | Purpose |
|---|---|---|
| `--type <type>` | yes | One of `fabric-sqlanalytics`, `fabric-warehouse`, `fabric-sqldatabase`. |
| `--workspace-id <id>` | yes (Fabric) | Fabric workspace ID. Must be a literal — `${VAR}` placeholders are rejected. |
| `--item-id <id>` | yes (Fabric) | Fabric item/artifact ID. Must be a literal. |
| `--name <name>` | no | Connector name. Derived from the item display name when omitted. |
| `--operations <ops>` | no | Comma-separated subset of the type's allowed operations (e.g. `read,update`). Narrows the emitted `operations:` at add-time. Omit for all allowed operations. Each value must be in the type's catalog allowlist. |
| `-y, --yes` | no | Auto-accept overwrite/confirmation prompts (non-interactive). |
| `-v, --verbose` | no | Verbose diagnostics. |

Prefer `--operations` to scope the connector at add-time instead of hand-editing
YAML afterwards (see Step 3); the [CLI Quick Reference](#cli-quick-reference) has a worked example.

### Step 2 — Confirm the user's operation scope

`connector add` writes **every** operation the catalog allows for the type.
Before doing anything else, confirm what the user actually needs and narrow `rayfin.yml` accordingly.

| User intent | Operations to keep |
|---|---|
| Read-only, analytics, dashboard, "browse" | `read` |
| Append-only log or event capture | `read`, `create` |
| Users edit existing rows but cannot add new ones | `read`, `update` |
| Full CRUD app | `read`, `create`, `update`, `delete` |

If the user's intent is ambiguous, ask explicitly — for example: "Should the app be allowed to create, update, or delete `<entity>`, or only read it?".

Also ask whether rows are scoped per-user (e.g. an `owner_id` / `tenant_id` / `created_by` column suggests row-level security — see Step 6).

### Step 3 — Narrow `operations:` in `rayfin.yml`

If you already scoped the connector with `--operations` at add-time (Step 1),
the YAML already lists only those operations — skip ahead. Otherwise, edit the
connector entry to list only the operations the user needs.
Operations are objects, not bare strings:

```yaml
connectors:
  - name: inventory
    type: fabric-warehouse
    config:
      workspaceId: ${WS_ID}
      itemId: ${ITEM_ID}
    auth:
      type: delegated
    operations:
      - name: read
      - name: update     # removed 'create' and 'delete' per user scope
```

Rules:

- You can narrow below the catalog default; you cannot widen above it.
- There is no `all` meta-operation — list every action explicitly.
- The host validator (`ConnectorsSettingsValidator`) rejects unknown or duplicate names at `rayfin up` time.

### Step 4 — Generate entity files (you, not the CLI)

`rayfin connector add` writes `rayfin/connectors/<name>/metadata.json` and a
placeholder `schema.ts`, then stops. The per-table entity `.ts` files are
**produced by you** by reading `metadata.json` and following the contract in
[Entity Generation Contract](#entity-generation-contract). The CLI does not
emit them.

What to do, in order, for every connector-add flow:

1. Read `rayfin/connectors/<name>/metadata.json` (shape: `SchemaMetadata` —
   see [metadata.json Reference](#metadatajson-reference)).
2. Pick the tables in scope:
   - **Full set** — every table under `schemas[].tables[]`.
   - **Subset** — only the tables the user named. Filter
     `schemas[].tables[]` by `tableName` before generating.
3. For each surviving table, write a file at
   `rayfin/connectors/<name>/<EntityName>.ts` following the
   [Entity Generation Contract](#entity-generation-contract) exactly. The
   contract covers naming (including cross-connector name-collision
   disambiguation — scan the other `rayfin/connectors/*/` directories first,
   see [§1](#1-file-name-and-class-name)), type mapping, nullable handling,
   relationships, primary-key declaration (single or composite),
   synthetic-PK fallback, and import-line composition.
4. Overwrite the placeholder `rayfin/connectors/<name>/schema.ts` with the
   aggregate per [Step 7](#step-7--update-the-aggregate-connector-schema).
5. Surface every warning the contract emits (no-FK-metadata notes, unknown SQL
   types). Don't drop them silently.

When the user asks for a refresh ("regenerate everything"), re-do the same flow
against the existing `metadata.json` — only re-run `rayfin connector remove`
and `rayfin connector add` when the _source schema_ changed and you need fresh
metadata (see [metadata.json Reference](#metadatajson-reference)).

### Step 5 — Scope `@role(...)` on entities

The YAML `operations:` controls which actions reach the source.
The entity-level `@role(...)` decorator controls which roles can perform which actions on that entity.

The entity's `actions` list **must be a subset** of the YAML `operations:` for that connector.
The host's settings validator does not catch the mismatch today — DAB will fail at `rayfin up connector apply` time.
Always narrow YAML first, then add `@role(...)` to entities (full alignment rule: [Step 7](#step-7--update-the-aggregate-connector-schema)).

Example: a `fabric-warehouse` connector with `operations: [read, update]` and an `Order` entity locked to read-only:

```ts
import { entity, int, text, decimal, Source } from '@microsoft/rayfin-core/experimental';
import { role } from '@microsoft/rayfin-core';

@role('authenticated', ['read'])
@entity()
export class Order extends Source({ schema: 'dbo', table: 'Order', primaryKey: ['orderId'] }) {
  @int({ column: 'OrderID' }) orderId!: number;
  @text() customerEmail!: string;
  @decimal({ precision: 18, scale: 2 }) total!: number;
}
```

Legal `actions`: `'read' | 'create' | 'update' | 'delete' | '*'`.
Stack multiple `@role(...)` decorators to give different roles different actions on the same entity.

### Step 6 — Add row-level policies (optional)

Use a `policy` callback on `@role(...)` for row-level security.
Policies use the typed `claims` / `item` DSL — never raw SQL strings.

```ts
@role('authenticated', ['read', 'update'], {
  policy: (claims, item) => claims.sub.eq(item.owner_id),
})
@entity()
export class Todo extends Source({ schema: 'dbo', table: 'Todo', primaryKey: ['id'] }) {
  @uuid() id!: string;
  @uuid() owner_id!: string;
  @text() body?: string;
}
```

DSL surface: `claims.sub | email | role`, `item.<columnName>`, `.eq(...)`, `.and(...)`, `.or(...)`.
Use any claim the same way — e.g. `claims.email.eq(item.user_email)`.
`RoleDeclarationOptions` also accepts `include` and `exclude` arrays for field-level allow/block lists.

When to prompt the user: inspect `metadata.json` for columns named `owner_id`, `user_id`, `tenant_id`, `created_by`, etc.
If you see one, ask: "Should `<column>` restrict rows so each authenticated user only sees their own?".

### Step 7 — Update the aggregate connector schema

**Install the connector packages first.** `rayfin connector add` scaffolds files but installs nothing, and the aggregate `schema.ts` imports two packages a fresh app does not yet declare. Add both as direct dependencies before writing the file, or the Step 8 type-check fails with `Cannot find module`:

```bash
npm install @microsoft/rayfin-connector-fabric-graphql @microsoft/rayfin-connectors
```

- `@microsoft/rayfin-connector-fabric-graphql` — provides `GraphQLBackedConnector` (not a dependency of `@microsoft/rayfin-client`, so it is always missing on a fresh app).
- `@microsoft/rayfin-connectors` — provides `ConnectorConfig`. It ships transitively under `@microsoft/rayfin-client`, but declare it directly so strict resolvers (pnpm) do not treat it as a phantom dependency.

Match the version line already used by `@microsoft/rayfin-client` in the app's `package.json` (both are `1.x`). Even though both imports are `import type`, TypeScript still needs the packages present at compile time.

The aggregate `rayfin/connectors/<name>/schema.ts` is what the app imports from.
The CLI leaves a placeholder there; overwrite it so it exports **three** things:

1. **Entity re-exports** — re-export every entity class you generated for this connector.
2. **`<Name>Schema` (type)** — a `GraphQLBackedConnector<TSchema, typeof connectorConfig>` marker from `@microsoft/rayfin-connector-fabric-graphql`. `TSchema` maps each in-scope entity name to its class via `typeof`; the second argument is `typeof connectorConfig` (the config value below, declared `as const satisfies ConnectorConfig`), from which the marker derives both the CRUD operation union and the dialect. This is the typed surface that makes `client.connectors.<name>.<Entity>.select(...)` strongly typed and gates CRUD methods to the declared operations at compile time.
3. **`connectorConfig` (value)** — a `ConnectorConfig` from `@microsoft/rayfin-connectors` carrying the runtime `connector` type, the same `operations` allow-list, and an **`entities` map** (each in-scope entity class keyed by its entity name). The runtime routes on `connector`, gates CRUD verbs by `operations`, and reads `entities` so `create` / `update` / `delete` can return the **full row** — including server-generated columns the caller never sent (see [Writes](#writes--gated-by-operations-and-shaped-by-dialect)). **Always include `entities`** in a generated connector's config, keyed exactly as in `TSchema` and covering every entity there — it is a required part of the contract: `create` / `update` / `delete` and no-selection reads depend on it to shape and return the full row. Include it for every dialect so the config is complete and correct.

`GraphQLBackedConnector<TSchema, typeof connectorConfig>` **is** the published typed marker for Category A SQL connectors — use it (see Rules for the full marker contract).

**Single source of truth for operations.**
For one connector, the `connectorConfig.operations` array here (which the marker reads via `typeof connectorConfig`), the YAML `operations:` (Step 3), and every entity `@role(...)` action (Step 5) must all describe the same verb set.
Narrow YAML first, then mirror it into the marker, the config, and the decorators.

**Subset rule.**
In subset mode (Step 4), include in `TSchema` **only** the entities you actually generated.
Never reference an entity class you did not generate — the `typeof` lookup and its import would dangle.

```ts
// rayfin/connectors/inventory/schema.ts
import type { GraphQLBackedConnector } from '@microsoft/rayfin-connector-fabric-graphql';
import type { ConnectorConfig } from '@microsoft/rayfin-connectors';

import { Order } from './Order.js';
import { Customer } from './Customer.js';

// 1. Re-export the generated entities.
export { Order } from './Order.js';
export { Customer } from './Customer.js';

// 2. Runtime routing/gating config. Consumed by the `connectors` client option
//    and, via `typeof connectorConfig`, by the marker below. Use `as const
//    satisfies` (not a `: ConnectorConfig` annotation) so the `connector` and
//    `operations` literals survive — the marker reads them to derive the
//    permitted operations and the dialect (which selects the mutation return
//    type: `DbOperationResult` for Fabric Warehouse, the entity row otherwise).
//    `entities` maps each in-scope entity class by name so create/update/delete
//    return the full row (SQL Database); include every entity in `TSchema`.
export const connectorConfig = {
  connector: 'fabric-warehouse',
  operations: ['read', 'update'],
  entities: { Order, Customer },
} as const satisfies ConnectorConfig;

// 3. Typed marker — entity map + the connector config. Consumed by
//    AppConnectorsSchema.
export type InventorySchema = GraphQLBackedConnector<
  { Order: typeof Order; Customer: typeof Customer },
  typeof connectorConfig
>;
```

The `<Name>Schema` name is the PascalCase connector name plus `Schema` (connector `inventory` → `InventorySchema`).
For a read-only Lakehouse (`fabric-sqlanalytics`), `operations` is `['read']` (reads only; it never writes).

### Step 8 — Wire connectors into the app client (`rayfin-client.ts`)

Declaring and deploying a connector does not make it callable from app code.
The Builder must expose it through a `ConnectorsRayfinClient` so it shows up as
`client.connectors.<name>`.

`ConnectorsRayfinClient` is **experimental** — import it only from the
`@microsoft/rayfin-client/experimental` subpath, never the stable
`@microsoft/rayfin-client` entry.

Each `schema.ts` exports the `<Name>Schema` type and the `connectorConfig` value
(both defined in [Step 7](#step-7--update-the-aggregate-connector-schema)). The
`<Name>Schema` type goes into `AppConnectorsSchema` so `client.connectors.<name>`
is typed; the `connectorConfig` value goes into the `connectors` option so the
runtime knows which client to build.

The connector **key must be identical** in three places: the `name` in `rayfin.yml`,
the property in `AppConnectorsSchema`, and the property in the `connectors` option.

Create or update `src/lib/rayfin-client.ts`. One import pair per connector (alias the value — every `schema.ts` exports it as `connectorConfig`); map each connector key to its `<Name>Schema` type in `AppConnectorsSchema` and to its config value in the `connectors:` option. Each `<Name>Schema` already carries the connector's config (via `typeof connectorConfig` in Step 7), so the dialect types the entity mutation returns — Fabric Warehouse mutations return `DbOperationResult`, others the entity row — with nothing extra to wrap here:

```ts
import { ConnectorsRayfinClient } from '@microsoft/rayfin-client/experimental';
import { ProductDbSchema, connectorConfig as productDbConfig } from '../../rayfin/connectors/productDb/schema';
import { InventorySchema, connectorConfig as inventoryConfig } from '../../rayfin/connectors/inventory/schema';

type AppConnectorsSchema = {
  productDb: ProductDbSchema;
  inventory: InventorySchema;
};

export function getRayfinClient() {
  // Type params are <DataSchema, FunctionsSchema, ConnectorsSchema> — set the
  // unused slots to Record<string, never>, or pass real schema types if the app
  // also has a data model / functions.
  return new ConnectorsRayfinClient<Record<string, never>, Record<string, never>, AppConnectorsSchema>({
    baseUrl: import.meta.env.VITE_RAYFIN_API_URL,
    publishableKey: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
    authStorage: true,
    connectors: {
      productDb: productDbConfig,
      inventory: inventoryConfig,
    },
  });
}
```

Once wired, each connector is reached through `client.connectors.<name>`, which
exposes entities narrowed to the connector's `operations`:

```ts
const created = await getRayfinClient().connectors.productDb.Colors.create({
  id: crypto.randomUUID(),
  name: 'Crimson',
  hexCode: '#DC143C',
});
```

**Write results on Fabric Warehouse.** Fabric Warehouse (DWSQL) has no T-SQL
`OUTPUT` clause, so it cannot read the written row back. `create` / `update` /
`delete` on a `fabric-warehouse` connector therefore resolve to
`DbOperationResult { result: string }` instead of the entity row; every other
write dialect (`fabric-sqldatabase`) returns the written row. So `created` above
is the written row on SQL Database and a `DbOperationResult` status object on a
warehouse — `result` is `"success"` on a successful write, while a failed write
throws a GraphQL error rather than returning a `"failure"` result.

**Querying connector entities.** Reach entities through `client.connectors.<name>.<Entity>`. Reads use the query chain `.select()` → `.where()` → `.orderBy()` → `.execute()`, plus `findByKey` (pass a key object with all composite parts **and** a required scalar-only `select`) and pagination. The connector's `operations:` gate the surface, and the dialect shapes write returns — see [Reading & writing connector entities](#reading--writing-connector-entities-per-dialect) for the full per-dialect matrix. For aggregation, `groupBy`, or year/quarter/month time-bucketing, use `search_docs(...)` / `rayfin docs`.

Verify: type-check the project (`tsc --noEmit` or the app build) — a mismatch between
a connector key in `AppConnectorsSchema` and the `connectors` option surfaces here —
and confirm each connector key matches its `name` in `rayfin.yml`.

## Reading & writing connector entities (per dialect)

Once wired (Step 8), each Category A entity is reached through
`client.connectors.<name>.<Entity>`. What the surface exposes depends on two
things: the connector's `operations:` (which gate the verbs) and the connector
**type/dialect** (which shapes what writes return). This section is the
Builder-facing usage reference for the three GraphQL-backed types.

### Reads (all three dialects)

Reads work identically on Lakehouse, Warehouse, and SQL Database — the read
surface is the same; only writes differ.

```ts
// Query chain: select -> where -> orderBy -> execute
const orders = await client.connectors.inventory.Order
  .select(['orderId', 'customerEmail', 'total'])
  .where({ total: { gt: 100 } })
  .orderBy({ total: 'desc' })
  .execute();

// By-key read. Pass a key OBJECT (all parts of the composite PK) AND a
// required scalar-only `select`. The result is Pick<Row, selected> | null —
// only the columns you name are fetched and present on the type.
const order = await client.connectors.inventory.Order.findByKey(
  { orderId: 'o-1' },
  ['orderId', 'customerEmail', 'total'],
);
order?.total; // present and typed; unselected columns are absent, not `undefined`

const lineItem = await client.connectors.sales.OrderItem.findByKey(
  { orderId: 'o-1', productId: 'p-9' }, // both parts of the composite PK required
  ['orderId', 'productId', 'quantity'],
);
```

`findByKey` takes two arguments: the key object and a **required** `select` of
scalar columns; it returns `Pick<Row, selected> | null`. Relationships cannot be
selected via `findByKey` — read them through the query chain (`select`/`where`).
A composite key requires **all** its parts in the key object; omitting one is a
compile error (the by-key `where` shape is an exact `Pick` over the declared key
— see the [composite-PK contract](#2-composite-pk-tables--declare-the-key)).

### Reading related columns (foreign-key relationships)

`select` can pull columns from a related entity — a `@one` (forward FK) or `@many` (reverse FK) navigation field — by naming them as a **dotted path**.
The builder expands each path into the nested selection the server expects (`category { ... }`, or an `items { ... }` connection for a `@many` hop) and unwraps the response so the related row(s) sit inline on the result.

```ts
// Given the canonical Product entity (§11): @one category, @many orderItems.
const products = await client.connectors.inventory.Product
  .select(['name', 'category.name', 'orderItems.quantity'])
  .where({ stock: { gt: 0 } })
  .execute();

products[0].category.name;          // @one  — related row inline
products[0].orderItems[0].quantity; // @many — related rows inline (unwrapped)

// Paths nest to arbitrary depth, hopping across entities.
await client.connectors.inventory.Product
  .select(['name', 'orderItems.order.customerEmail'])
  .execute();
```

- **Name related columns as a dotted path** (`category.name`), never the bare relationship (`category`) — a navigation field is not a selectable leaf and is a compile error.
- **Each path is validated segment-by-segment** against the schema, so a wrong hop (`category.nope`) fails to compile; depth is unbounded.
- **`findByKey` cannot select relationships** — it is scalar-only (above). Read related data through the `select`/`where` query chain.

> **Self-referencing foreign keys are not supported currently.** A relationship
> that points back at its own entity (an FK from a table to itself) cannot be
> queried through — do not select a dotted path across a self-relationship.

### Writes — gated by `operations:` and shaped by dialect

`create` / `update` / `delete` exist only when the connector's `operations:`
(and the entity `@role(...)`) allow them, and what they **return** is fixed by
the connector's dialect:

| Connector type | Dialect | `create`/`update`/`delete` return | Notes |
|---|---|---|---|
| `fabric-sqlanalytics` (Lakehouse) | — | **not available** | Read-only at the host; only `select`/`findByKey`/query chain exist. Writes are a compile error. |
| `fabric-sqldatabase` (SQL Database) | row-returning | the **full entity row** | Full CRUD; reads the whole row back after the write — **every** column, including server-generated ones (identity, defaults, computed) the caller did not send. Requires the `entities` map in `connectorConfig` (Step 7). |
| `fabric-warehouse` (Warehouse) | no `OUTPUT` clause | `DbOperationResult { result: string }` | Full CRUD, but DWSQL cannot read the row back, so mutations resolve to a status object, not the row. On success `result` is the string `"success"`; a failed write surfaces as a thrown GraphQL error, not a `DbOperationResult`. |

```ts
// SQL Database (fabric-sqldatabase) — mutation returns the full row, with every
// server-generated column filled in by the database.
const created = await client.connectors.orders.Order.create({
  quantity: 3,          // supply only the columns you own…
  unitPrice: 19.99,
});
created.id;             // server-assigned identity — returned, though never sent
created.createdUtc;     // server default (SYSUTCDATETIME()) — returned
created.lineTotal;      // computed (quantity * unitPrice) — returned

// Warehouse (fabric-warehouse) — mutation returns DbOperationResult, NOT the row
const result = await client.connectors.inventory.Order.update(
  { orderId: 'o-1' },          // key object (all composite parts)
  { total: 250 },              // partial update
);
result.result;                 // "success" — status string, not the row; a
                               // failed write throws a GraphQL error instead

// Delete by key (both dialects) — full composite key required
await client.connectors.sales.OrderItem.delete({ orderId: 'o-1', productId: 'p-9' });

// Lakehouse (fabric-sqlanalytics) — writes do not exist
client.connectors.analytics.Sales.create({ /* ... */ }); // compile error: read-only
```

**Server-generated columns.** These are the columns marked `AutoGenerated<T>`
on the entity (see [§4a](#4a-server-generated-columns--autogeneratedt)) —
`IDENTITY`, any `DEFAULT` (`newid()`, `newsequentialid()`, `sysutcdatetime()`,
a sequence), and computed (`AS (...)`) columns. They are **optional** on
`create` / `update` and come back populated in the returned row. Most cannot be
written: passing an `IDENTITY` or computed value is **rejected** by the database
(not silently ignored), and rowversion / temporal columns are server-maintained.
The one exception is a plain `DEFAULT` column — omit it to get the default, or
pass a value to override it. Send only the columns the caller owns; treat
identity / computed / rowversion / temporal as read-back-only.

By-key **`update`/`delete`** take the same full key object as `findByKey`; a
keyless entity (`primaryKey` omitted or `[]`) exposes **no** `findByKey` /
`update` / `delete` at all — it is read-only regardless of the connector type,
because there is no key to address a row by (see the
[composite-PK contract](#2-composite-pk-tables--declare-the-key)).

### Quick decision guide

- **Lakehouse (`fabric-sqlanalytics`)** → reads only. Model entities, `select`,
  `findByKey`, query chain. No `@role` write actions, no `create`/`update`/`delete`.
- **SQL Database (`fabric-sqldatabase`)** → full CRUD; mutations hand back the
  full row (all columns, server-generated ones included), so you can render the
  created/updated record directly.
- **Warehouse (`fabric-warehouse`)** → full CRUD; mutations hand back a
  `DbOperationResult`, so re-query with `findByKey`/`select` if you need the
  persisted values.

## Connector Command Reference (`inspect`, `search`, `invoke`)

Full reference docs for each connector command live in the Rayfin guide. Read
them straight off disk from
`node_modules/@microsoft/rayfin-guide/assets/docs/<path below>`, or fetch them
with `rayfin docs get --module guide --path '<path below>'` — or `get_doc` with
`module: "guide"` via MCP (if already installed):

| Command | What it does | Doc path |
|---|---|---|
| `rayfin connector search [query]` | Discover Fabric sources (warehouses, SQL databases, Lakehouses, semantic models, KQL databases) the signed-in identity can add, before you know workspace/item IDs. Scope, filtering, `interactive`/`plain`/`--json` output modes. | `cli/connectors/search.md` |
| `rayfin connector add` | Declare a connector in `rayfin.yml`, scaffold `rayfin/connectors/<name>/`, and run schema discovery. Flags, `--operations` scoping, Category B specifics. | `cli/connectors/add.md` |
| `rayfin connector inspect` | Run one read-only sample query against a source before writing app code. Selector x query-mode pairs, entity resolution, SQL/DAX validation, error mapping. | `cli/connectors/inspect.md` |
| `rayfin connector invoke <name> <operation>` | Run one named operation against a configured connector — the loop for exercising [Category B](#category-b--function-bridge-connectors) connectors. Payload input, transports, token handling, output contract. | `cli/connectors/invoke.md` |
| — | Category overview, where connector state lives, deployment. | `cli/connectors/index.md` |

Key facts worth knowing without fetching a doc:

- `connector inspect` supports the three Category A SQL types plus
  `fabric-semanticmodel` (DAX). `kusto` is **not** supported — it errors with
  `Unsupported connector type: kusto`.
- `connector invoke` on `fabric-semanticmodel` calls Fabric/Power BI **directly
  under the developer's identity**, so it works with or without `rayfin up`.
  Every other type (including `kusto`) POSTs to the deployed item and requires a
  prior `rayfin up`.
- `connector invoke` takes exactly one of `--input '<json>'` or `--file <path>`,
  and `--file` must resolve inside the project root.
- `connector invoke` on `fabric-semanticmodel` returns an already-normalised
  result, because that connector normalises inside its `invoke` middleware. Do
  not apply `toQueryResult` to it again. The exact shape is owned by the
  connector package and released with it, so read `cli/connectors/invoke.md`
  rather than assuming the field names.
- A resolved `connector invoke` call is **not** automatically a success — a
  connector that normalises reports failure as `status: 'error'` on the output,
  while one that returns the raw service envelope reports it as
  `status: 'Failed'`. The CLI converts either into a non-zero exit.

Read the matching doc before answering detailed questions about flags, output
shape, or error messages — do not guess.

## Worked Example — Add a Use Case on Specific Entities

Concrete subset path. The user already ran `rayfin connector add` for a `fabric-warehouse` connector named `sales` and says _"I just need users to read and update orders and their line items."_

- **Scope + narrow (Steps 2–3).** Operations are `read`, `update`; set `operations:` on the `sales` entry to just those.
- **Generate the subset (Step 4).** Filter `metadata.json` to `Order` and `OrderItem`, write both per the contract. Drop any `@one(() => Customer, ...)` to an out-of-scope table (no dangling import — Subset rule, Step 7).
- **Roles + aggregate (Steps 5, 7).** `@role('authenticated', ['read', 'update'])` on both; aggregate `SalesSchema = GraphQLBackedConnector<{ Order: typeof Order; OrderItem: typeof OrderItem }, typeof connectorConfig>`, with `connectorConfig` declared `as const satisfies ConnectorConfig` and `operations: ['read', 'update']`.
- **Wire + verify (Step 8).** Add `sales` to `AppConnectorsSchema` and the `connectors` option. Type-check: `client.connectors.sales.Order.create(...)` is now a compile error (only `read`/`update` exist) — the proof the scope took effect. Deploy with `rayfin up`.

## Entity Generation Contract

When you generate `rayfin/connectors/<name>/<EntityName>.ts` from
`metadata.json`, follow this contract end-to-end. This is the source of
truth — the CLI itself does not emit entity files.

### 1. File name and class name

- `className = pascalCase(table.tableName)` (e.g. `product_category` →
  `ProductCategory`, `OrderItem` → `OrderItem`).
- **Pluralization is allowed, but must be idempotent — never double-pluralize.**
  The class name and the `@entity` name come from `table.tableName`, transformed to PascalCase.
  Pluralizing a **singular** table name is fine (`Order` → `Orders`, `Category` → `Categories`).
  But first check whether the name is **already plural**: if the source table is already plural (`Orders`, `Categories`, `sales_line_items`), keep it exactly as-is (`Orders`, `Categories`, `SalesLineItems`) — do **not** add another plural suffix (`Orders` → `Orderses`, `Categories` → `Categorieses`).
  Applying pluralization to an already-plural name is a no-op.
  Whatever name you settle on, the `@entity` name and the `client.connectors.<name>.<Entity>` access path must stay consistent with it so the mapping holds at query time.
- File name is `<className>.ts`. One file per table; no nesting.
- **Cross-connector uniqueness — disambiguate only on collision.**
  GraphQL type names are **global** across every connector in the app: the `@entity` name defaults to the class name, so two connectors that each produce an entity with the same name (e.g. both have a `product` table → `Product`) collide at `rayfin up connector apply` time even when they point at different physical tables.
  Before finalizing a name, scan every **other** `rayfin/connectors/*/` directory (the entity `.ts` files already generated there) **and** the entities you have already generated for the current connector (two schemas in one connector can also share a table name) for a class / `@entity` name that matches the one you are about to write.
  If — and only if — the base name is already taken, prefix it with the connector's source database name (PascalCased, from `metadata.json` `source`) to disambiguate: `Product` → `SalesDbProduct`.
  Disambiguation is required even when the colliding entities refer to the same physical source table; entity-name ownership, not source-table identity, determines whether a collision exists.
  If that database name is itself shared across the colliding connectors, fall back to the PascalCased connector name (the `rayfin.yml` `name`, which the host guarantees unique) as the prefix instead.
  **Never** rename a name that does not collide, and **never** blanket-prefix every entity — disambiguate only the colliding name(s), leaving all others exactly as Contract §1 derives them.
  When you rename an entity, the same disambiguated name must be used everywhere it appears: the class name, the file name (`<className>.ts`), the `@entity` name, the `TSchema` key and re-export in [Step 7](#step-7--update-the-aggregate-connector-schema), and the `client.connectors.<name>.<Entity>` access path — keep all five in sync.
  Surface a one-line note to the user for each rename (`Entity 'Product' from connector '<other>' already exists; generated as 'SalesDbProduct' to avoid a GraphQL type collision.`).

### 2. Composite-PK tables — declare the key

If `table.primaryKeyColumns.length > 1`, emit the entity and declare the
composite key on `Source(...)`, listing every key column — as its TypeScript
property name — in `table.primaryKeyColumns` (`ORDINAL_POSITION`) order. Keep
one property per key column and preserve each SQL column name with `column:`
when it differs.

```ts
export class OrderItem extends Source({
  schema: 'dbo',
  table: 'OrderItem',
  primaryKey: ['orderId', 'productId'],
}) {
  @uuid({ column: 'OrderID' }) orderId!: string;
  @uuid({ column: 'ProductID' }) productId!: string;
  @int() quantity!: number;
}
```

Every key part is then required in the by-key methods
(`findByKey`/`update`/`delete`). Omitting `primaryKey` makes the entity
keyless (no by-key methods), so a keyed table must always declare it.

### 3. Primary-key column

- **Declared single PK**: `pkColumnName = table.primaryKeyColumns[0]`.
- **No PK** (synthetic-PK fallback): pick the first **non-nullable** column
  in `table.columns`; if every column is nullable, pick the first column.
  Record the reason (`first non-nullable column` /
  `all columns are nullable; first column selected`) — you emit the banner
  comment in step 8.
- **Empty table** (zero columns): treat as no PK; no synthetic id.

Declare the PK on `Source({ ..., primaryKey: [...] })`, listing the key's
TypeScript property name(s). The property name and datatype are up to you —
any column works — and the on-disk SQL column name is preserved via the
`column:` option (see step 5). For a composite key, follow section 2.

### 4. SQL type → decorator mapping

Look up `column.dataType` (case-insensitive) in this table:

| SQL type family | Decorator | TS type |
|---|---|---|
| `int`, `bigint`, `smallint`, `tinyint` | `@int()` | `number` |
| `decimal`, `numeric`, `money`, `smallmoney`, `float`, `real` | `@decimal({ precision, scale })` | `number` |
| `bit` | `@boolean()` | `boolean` |
| `date`, `datetime`, `datetime2`, `smalldatetime`, `datetimeoffset`, `time` | `@date()` | `Date` |
| `uniqueidentifier` | `@uuid()` | `string` |
| `varchar`, `nvarchar`, `char`, `nchar`, `text`, `ntext` | `@text()` | `string` |
| Anything else (`geography`, `hierarchyid`, `xml`, vector, …) | `@text()` + warning | `string` |

For the fallback case, emit a warning:

> Unknown SQL type `<dataType>` for `<table>.<column>`; falling back to `@text()`.

### 4a. Server-generated columns → `AutoGenerated<T>`

`metadata.json` flags the columns the database fills in. On each column, check
for these server-generation markers:

- `identity` — an `IDENTITY(seed, increment)` key.
- `default` — a column `DEFAULT` (e.g. `newid()`, `newsequentialid()`,
  `sysutcdatetime()`, `NEXT VALUE FOR <seq>`, `((0))`).
- `computed` — a computed column (`AS (<expr>)`).
- `serverManaged` — a column the server maintains with no user-facing
  expression: `'rowversion'` (a rowversion/timestamp column) or
  `'temporalRowStart'` / `'temporalRowEnd'` (a temporal `GENERATED ALWAYS AS ROW
  START/END` period column).

If **any** of these is present, the column is server-generated: wrap its TS type
from §4 in `AutoGenerated<…>` (`number` → `AutoGenerated<number>`, `Date` →
`AutoGenerated<Date>`). The decorator and its `column:` option are unchanged;
do **not** emit a `default:` option — the marker is type-only and the connector
never writes these columns.

`AutoGenerated<T>` makes the column **optional on create/update input** and read
back as plain `T` in the returned row. Nullability is unchanged: a non-null
server-generated column still uses `!:` (the marker wraps the non-null base
type); a nullable one uses `?:`.

**Optional on input does not mean "accepts a value".** For most server-generated
columns, passing a value is not merely ignored — the database **rejects** the
write:

- `identity` — inserting an explicit value fails (`Cannot insert explicit value
  for identity column … when IDENTITY_INSERT is OFF`). Never send it.
- `computed` — a computed column cannot be written; setting it is a server error.
- `serverManaged` (rowversion / temporal period columns) — server-maintained;
  writing them is rejected.
- plain `default` — the one exception: omit it and the server supplies the
  default; passing a value is accepted and overrides it (not rejected).

So: omit every `AutoGenerated` column on `create`, and never include
`identity` / `computed` / `serverManaged` columns on `update`.

```ts
@int({ column: 'Id' })
id!: AutoGenerated<number>;         // IDENTITY — omit on write, server assigns

@uuid({ column: 'PublicId' })
publicId!: AutoGenerated<string>;   // DEFAULT newid()

@decimal({ optional: true, column: 'LineTotal', precision: 28, scale: 2 })
lineTotal?: AutoGenerated<number>;  // computed: AS ([Quantity] * [UnitPrice])

@text({ column: 'RowVer' })
rowVer!: AutoGenerated<string>;     // rowversion (serverManaged) — read-back-only
```

### 5. Field-level decorator options

For every column, the decorator option object is built in this order
(omit keys you don't need):

1. `optional: true` — if `column.isNullable` is true.
2. `column: '<columnName>'` — when the SQL column name differs from the
   TS property name (i.e. when `propName !== columnName`). Single-quote
   the value; escape embedded `'` as `\\'`.
3. **Text only:** `max: <maxLength>` — when `decorator === 'text'` and
   `column.maxLength > 0`.
4. **Decimal only:** `precision: <p>, scale: <s>` — when
   `decorator === 'decimal'` and both `precision` and `scale` are present
   in metadata.
5. **Integer:** do **not** emit `min`/`max` based on SQL precision; those
   are value bounds, not storage capacity. Plain `@int()` is correct.

If the option object is empty, emit `@text()` rather than `@text({})`.

Property name itself is always `camelCase(column.columnName)` — the PK is
not special-cased or renamed to `id`. Any column name and any datatype can
be a primary key.

Nullable columns use `?:`; non-nullable use `!:`.

### 6. Global-type shadow rule

If `pascalCase(table.tableName) === tsType` for some column (e.g. a table
named `Date` with a `datetime2` column), the unqualified `Date` in the
annotation will resolve to the entity class, not the global. Render the
type as `globalThis.Date` (or whatever the global is) in that one field
annotation only. All other fields keep their bare type.

### 7. Relationships — `@one` and `@many`

Forward (`@one`) and reverse (`@many`) relationships are emitted from
foreign-key metadata.

**`@one` — one per FK on this table:**

For each entry in `table.foreignKeys`:

- `fieldName = camelCase(singularize(fk.referencedTableName))`.
- `sourceFields = [camelCase(fk.columnName)]`.
- `targetFields = [camelCase(fk.referencedColumnName)]` — the referenced
  table's PK property.
- Emit:

  ```ts
  @one(() => <ReferencedClass>, { sourceFields: ['<src>'], targetFields: ['<tgt>'] })
  <fieldName>!: <ReferencedClass>;
  ```

If `fk.referencedTableSchema.fk.referencedTableName` is not in the table
index (FK to an unknown table), skip this relationship and emit a warning:

> Foreign key `<table>.<column>` references unknown table
> `<refSchema>.<refTable>`; relationship skipped.

In **subset mode** (Step 4), apply the same skip when the referenced table
exists in `metadata.json` but is **not** in the set you are generating: omit
the `@one` and its sibling import, and warn that the relationship was dropped
because the target is out of scope. Never import a `./<Class>.js` file you
did not write.

**`@many` — reverse-direction relationships pointing AT this table:**

Build a reverse-FK index across all tables: every FK from
`otherTable.<col>` to `<thisTable>.<refCol>` becomes a `@many` on
`<thisTable>`.

- `fieldName = camelCase(pluralize(otherTable.tableName))` — `pluralize` is
  idempotent, so an already-plural table (`Orders`) stays `orders`, never
  `orderses`.
- `sourceFields = [camelCase(fk.referencedColumnName)]` — THIS table's PK
  property.
- `targetFields = [camelCase(fk.columnName)]` — the OTHER table's FK column.
- Emit:

  ```ts
  @many(() => <OtherClass>, { sourceFields: ['<src>'], targetFields: ['<tgt>'] })
  <fieldName>!: <OtherClass>[];
  ```

In **subset mode**, only emit a `@many` when the other table is also being
generated; otherwise skip it, since a reverse relationship to an ungenerated
sibling would dangle.

`singularize` / `pluralize` are the same simplified rules the generator
uses:

- `singularize`: `ies → y` (length > 3); `xes|ses|ches|shes → drop -es`;
  `<non-s>s → drop trailing -s`; else unchanged.
- `pluralize` (idempotent — never double-pluralizes): if the name is already
  plural (ends in `s`, `es`, or `ies`), return it unchanged; otherwise
  `<non-vowel>y → -ies`; `x|z|ch|sh → +es`; else `+s`.

### 8. Synthetic-PK banner

When the table had no `primaryKeyColumns` and you fell back to a
synthetic id (step 3), emit this header **immediately after** the
`// @generated` line and **before** the `import`:

```text
//
// WARNING: No primary key found on this source table.
//
// Rayfin requires a primary key for GraphQL identity, mutations, and
// relationships. The column `<columnName>` (<reason>) has been
// declared as the primary key as a fallback.
//
// Risk: if duplicate values exist in this column, queries by key may
// return unstable rows and update/delete mutations may affect multiple
// rows. To remove this fallback, add a PRIMARY KEY constraint on the
// source table, then `rayfin connector remove <name>` and re-add it.
```

`<reason>` is `first non-nullable column` or
`all columns are nullable; first column selected`.

### 9. No-FK-metadata note

When `table.foreignKeys === undefined` (Lakehouse / no constraints) AND
no reverse FKs point at this table, also emit one warning to the user:

> No FK metadata available for `<tableName>`; relationships omitted.

The entity file itself still generates — just without `@one`/`@many`.

### 10. Imports

Build the import line deterministically:

- Always include `entity` and `Source`.
- Then append, in this exact order, any decorator names actually used in
  the file: `boolean`, `date`, `decimal`, `int`, `text`, `uuid`, `one`,
  `many`. Skip any not used.
- All from `@microsoft/rayfin-core/experimental`.
- If any column is server-generated (§4a), also add a type-only import:
  `import type { AutoGenerated } from '@microsoft/rayfin-core/experimental';`.
- For every relationship target that is a **different** class, add a
  sibling import: `import { <SiblingClass> } from './<SiblingClass>.js';`.
  Sibling imports are alphabetised. Self-references (`@one(() => Foo)`
  inside `Foo.ts`) get no sibling import.
- In subset mode, only relationships that survived the §7 subset skip
  contribute sibling imports — so every `./<Class>.js` import always points
  at a file you generated.

### 11. Example (canonical shape)

```ts
// @generated — do not edit.

import { entity, uuid, text, int, date, one, many, Source } from '@microsoft/rayfin-core/experimental';
import type { AutoGenerated } from '@microsoft/rayfin-core/experimental';
import { Category } from './Category.js';
import { OrderItem } from './OrderItem.js';

@entity()
export class Product extends Source({ schema: 'dbo', table: 'Product', primaryKey: ['productId'] }) {
  @uuid({ column: 'ProductID' })
  productId!: string;

  @text()
  name!: string;

  @int()
  stock!: number;

  // DEFAULT sysutcdatetime() — server-generated (metadata `default`), so
  // AutoGenerated: optional on write, read back in the returned row.
  @date({ column: 'CreatedUtc' })
  createdUtc!: AutoGenerated<Date>;

  @one(() => Category, { sourceFields: ['categoryId'], targetFields: ['categoryId'] })
  category!: Category;

  @many(() => OrderItem, { sourceFields: ['productId'], targetFields: ['productId'] })
  orderItems!: OrderItem[];
}
```

## metadata.json Reference

Path: `rayfin/connectors/<name>/metadata.json`.
Written by `connector add`; never edit by hand. It is regenerated only by
`rayfin connector remove <name>` followed by `rayfin connector add ...`.

Top-level: `SchemaMetadata { source, connector, connectionString, discoveredAt, schemas[] }`.
Each schema entry: `{ schemaName, tables[] }`.
Each table: `{ tableName, columns[], foreignKeys?, primaryKeyColumns? }`.
Columns carry `columnName`, `dataType`, `isNullable`, and optional `maxLength` / `precision` / `scale`.
Server-generated columns additionally carry `identity` (`{ seed, increment }`), `default` (the SQL default expression), `computed` (the `AS (...)` expression), `serverManaged` (`'rowversion'` / `'temporalRowStart'` / `'temporalRowEnd'`), and `datePrecision` — see [§4a](#4a-server-generated-columns--autogeneratedt).
Foreign keys carry `constraintName`, `columnName`, and the `referencedTableSchema` / `referencedTableName` / `referencedColumnName` triple.

Full TypeScript interfaces live in the CLI source at `packages/tools/cli/src/services/schema-discovery.ts`.

`primaryKeyColumns` is populated for single-column **and** composite PKs,
in `ORDINAL_POSITION` (declared key) order.

## Rules & Anti-Patterns

- The `rayfin.yml` `connectors:` block is an **array** of entries with `name` and `type` fields. Never write the legacy map shape.
- `rayfin connector add` discovers schema only when `workspaceId` and `itemId` are literal strings — `${VAR}` placeholders are rejected.
- The typed marker for Category A SQL connectors is `GraphQLBackedConnector<TSchema, typeof connectorConfig>` from `@microsoft/rayfin-connector-fabric-graphql`. Use it in the aggregate `schema.ts`; never invent per-type names like `FabricWarehouse` / `FabricSqlAnalytics` (they do not exist), and never leave `schema.ts` as bare re-exports — Step 8's import of `<Name>Schema` and `connectorConfig` would fail.
- In subset mode, list in `<Name>Schema`'s `TSchema` **only** entities you actually generated — a `typeof` reference to an ungenerated class dangles.
- Keep the verb set identical across three places: `connectorConfig.operations` (which the marker reads via `typeof connectorConfig`), the YAML `operations:`, and each entity `@role(...)` action. Narrow YAML first; never widen above the type's catalog allowlist.
- Policies use the typed `claims` / `item` DSL from `@microsoft/rayfin-core` — never raw SQL or DAB-policy strings like `"@claims.sub eq @item.owner_id"`.
- Default to the **narrowest** operations the user described — do not assume full CRUD for a read-only ask.
- **Never double-pluralize an entity/class name.**
  Entity names come from `table.tableName`, PascalCased (Contract §1).
  Pluralizing a singular table name is allowed (`Order` → `Orders`), but an already-plural table (`Orders`, `Categories`) must stay unchanged — never `Orders` → `Orderses`.
  Pluralization must be a no-op on names that are already plural.
- **GraphQL type names are global across connectors — disambiguate duplicates, do not blanket-prefix.**
  Two connectors whose source tables yield the same entity name (e.g. both `Product`) collide at `rayfin up connector apply` time (Contract §1).
  Before naming an entity, scan the other `rayfin/connectors/*/` directories; whenever another connector already owns the name, prefix the source database name (`SalesDbProduct`), even if both entities refer to the same physical source table.
  Never rename entities that do not collide, and never prefix every entity by default.
- When the user asks for one entity, read `metadata.json` and filter — do not regenerate every table.
- Never edit `metadata.json` or `dab-config.json` by hand — both are regenerated.
- Connectors do not run under `rayfin dev` — test via `rayfin up` and `rayfin up connector apply` against a deployed environment.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `rayfin up` fails with "does not support operation" | YAML `operations:` contains a name not in the type's catalog allowlist | Remove the offending op or change the connector type. |
| `rayfin up connector apply` fails on a role action | Entity `@role(...)` includes an action not in the YAML `operations:` | Narrow the decorator to match YAML. |
| `rayfin up connector apply` fails with a duplicate / redefined GraphQL type (e.g. `Product`) | Two connectors generated an entity with the same name — GraphQL type names are global regardless of whether the physical source table is shared (Contract §1) | Disambiguate the colliding entity by prefixing its source database name (`SalesDbProduct`); update the class, file name, `@entity` name, `TSchema` key, and `client.connectors.<name>.<Entity>` path together, then re-apply. |
| `rayfin connector add` errors with "literal IDs required" | `--workspace-id` or `--item-id` was a `${VAR}` placeholder | Pass literal values, or set the var and re-run. |
| `rayfin connector add` writes the YAML entry but no entity files | Expected — the CLI never emits entity `.ts` files (see [Step 4](#step-4--generate-entity-files-you-not-the-cli)). | Generate them from `metadata.json` per the contract. If `metadata.json` is also missing, schema discovery failed — fix credentials/connectivity, then `rayfin connector remove <name>` + re-add. |
| `Property '<name>' does not exist on connectors` | Connector key in `AppConnectorsSchema` does not match the key in the `connectors` option (or was omitted) | Use the same key — the `rayfin.yml` `name` — in all three places. |
| A CRUD method is missing from autocomplete on a connector | Expected: the `<Name>Schema` type narrows methods to the connector's `operations` | Widen the allow-list via `rayfin connector add --operations` (or edit the connector), then re-import. |
| Import of `ConnectorsRayfinClient` fails to resolve | Imported from the stable `@microsoft/rayfin-client` entry | Import from `@microsoft/rayfin-client/experimental`. |
| `Cannot find module '@microsoft/rayfin-connector-fabric-graphql'` (or `@microsoft/rayfin-connectors`) | The connector packages were never installed — `connector add` does not add them | `npm install @microsoft/rayfin-connector-fabric-graphql @microsoft/rayfin-connectors` (see [Step 7](#step-7--update-the-aggregate-connector-schema)). |
| Local `rayfin dev` ignores the connector | Day-one limitation — connectors are cloud-only | Exercise via `rayfin up` against a deployed environment. |
| `connector inspect` fails with "must be a single statement" / "blocked keyword" / "must start with SELECT\|EVALUATE" | The `--query` file (or `--entity`-built query) isn't read-only, or has more than one statement | Rewrite as a single read-only `SELECT`/`WITH` (SQL) or `EVALUATE` (DAX) statement — `connector inspect` never allows writes. |
| `connector inspect --entity <name>` throws "exists in multiple schemas" | The unqualified entity name matches tables in more than one schema | Re-run with a schema-qualified `--entity <schema>.<table>` per the error's suggestion. |
| `connector inspect --query <path>` rejects the file | Path resolves outside the project root, or isn't a `.sql`/`.dax` file | Move the file under the project (e.g. `rayfin/queries/`) and use a `.sql`/`.dax` extension. |
| `connector inspect` errors with "Unsupported connector type" | Connector type is `kusto` | Not supported by `connector inspect` today; there is no ad-hoc query path for Kusto connectors yet. |
| `connector search` fails with "workspace scope is required" | No `--workspace-id`/`--all-workspaces`, and no deployments found for the current project | Pass `--workspace-id <id>` or `--all-workspaces`. |
| `connector search --all-workspaces` fails with "--type is required" | `--all-workspaces` needs a server-side `--type` filter to bound the scan | Add `--type <type>` (comma-separated for multiple). |
| `connector search` interactive picker reports "You don't have the required permission" | The pre-flight access check on the picked source failed | Pick a different source, or ask a workspace admin for access, then retry. |

## CLI Quick Reference

Full option details for `connector add` are in [Step 1](#step-1--add-the-connector). Flags in `[brackets]` are optional.

```bash
# Add: --type required; --workspace-id/--item-id required for Fabric types.
rayfin connector add --type <type> --workspace-id <ws> --item-id <item> \
  [--name <name>] [--operations read,create,update,delete] [--yes] [--verbose]

# Scope operations at add-time (preferred over editing YAML afterwards)
rayfin connector add --type fabric-warehouse --workspace-id <ws> --item-id <item> --operations read,update

rayfin connector list [--verbose] [--json]

# Removes the rayfin.yml entry AND the rayfin/connectors/<name>/ directory.
# Re-add after remove to refresh metadata, then regenerate entity files yourself.
rayfin connector remove <name> [--yes]

rayfin up                                              # deploy connectors to the cloud
rayfin up connector apply [--name <name>] [--verbose] [--json]   # re-apply DAB config

# Inspect (read-only sample query): one selector + one query mode.
# Full reference: get_doc module "guide", path "cli/connectors/inspect.md"
rayfin connector inspect --name <name> --entity <table> [--rows <n>] [--verbose] [--json]
rayfin connector inspect --name <name> --query <path.sql|path.dax> [--rows <n>]
rayfin connector inspect --workspace-id <ws> --item-id <item> --type <type> --entity <table>
rayfin connector inspect --url <fabric-portal-url> --query <path.dax>

# Search (discover connectable sources).
# Full reference: get_doc module "guide", path "cli/connectors/search.md"
rayfin connector search [query] --workspace-id <ws-id>
rayfin connector search --all-workspaces --type <type>[,<type>...]
rayfin connector search --workspace-id <ws-id> --json --limit <n>

# Invoke (run one named operation): exactly one of --input / --file.
# Full reference: get_doc module "guide", path "cli/connectors/invoke.md"
rayfin connector invoke <name> <operation> --input '<json>' [--verbose] [--json]
rayfin connector invoke <name> <operation> --file <path-inside-project>
```

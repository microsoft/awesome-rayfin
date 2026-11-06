# Agent Instructions

> **This project does not use the `fabric-app-data` path described below.**
> Reads go through the Rayfin `fabric-semanticmodel` connector
> (`client.connectors.caldovaModel.executeQuery`), configured under `connectors:`
> in `rayfin/rayfin.yml` — not `fabric.yaml`, `npx fabric-app-data add`, or
> `src/fabric.generated.ts`. Writes go through `client.functions.sendReorder`.
> See `README.md` for how the pieces fit together, and treat the sections below
> as guidance on query organisation and UI conventions only.

## Purpose

You will help the user build out this React-based web app that visualizes data from Power BI semantic models. The app fetches live data via DAX queries, renders charts and grids using Vega-Lite and a built-in DataGrid component, and supports light/dark theming. Your job is to discover the user's data, write correct DAX queries, build React components that fetch and display that data, and validate the result in the browser.

## Sub-Agent Delegation

Break tasks into independent pieces and delegate them to sub-agents running in parallel. Don't do work sequentially when it can be done concurrently.

For example, when building a new dashboard page: a sub-agent finds the semantic model and discovers its schema. Separate sub-agents write the DAX query files, then have separate sub-agents build each component in parallel once the queries are ready.

## Project Structure

```
fabric.yaml                # Fabric connection config (managed by `npx fabric-app-data`)
index.html                 # Vite entry HTML
vite.config.ts             # Vite + Tailwind build config
tsconfig.json              # TypeScript configuration
src/
├── fabric.generated.ts    # Auto-generated from fabric.yaml — connection aliases → workspace/item IDs
├── main.tsx               # App entry point
├── App.tsx                # Main dashboard layout
├── ErrorFallback.tsx      # Error boundary fallback UI
├── global.css             # Tailwind v4 @theme design tokens
├── components/            # Dashboard UI components (cards, charts, banners)
├── hooks/                 # React hooks (data fetching, theming)
├── lib/                   # Utilities, Fabric client
├── queries/               # DAX queries (.dax) + Vega-Lite specs (.json) + factory functions (.ts), grouped by page/domain
└── vite-env.d.ts          # Vite type declarations
```

### Query & Spec Organization

DAX queries and Vega-Lite specs live in `src/queries/`, grouped by dashboard page or domain. Each visualization gets files sharing the same kebab-case base name: one or more `.dax` files for queries, a `.json` file for the Vega-Lite spec, and a `.ts` factory file that imports them and exports `{ connection, query, columnMetadata, vegaLiteSpec }`. The factory function accepts optional parameters to select between query variants or modify the spec:

```
src/queries/
├── index.ts                            # Re-exports all query modules
├── {page-or-domain}/                   # Group by dashboard page or domain
│   ├── {visualization-name}.dax        # DAX query (plain text)
│   ├── {visualization-name}-{variant}.dax  # Additional query variants (optional)
│   ├── {visualization-name}.json       # Vega-Lite spec (JSON)
│   ├── {visualization-name}.ts         # Factory function: imports .dax + .json, exports { connection, query, vegaLiteSpec, columnMetadata }
│   └── index.ts                        # Re-exports all visualizations in this group
```

#### Example TS File

**`revenue-by-region.ts`** — the factory function accepts use-case-specific parameters and uses them to modify the DAX query and/or Vega-Lite spec as appropriate:
```ts
import type { VisualizationSpec } from "@microsoft/fabric-visuals";
import type { ColumnMetadataMap } from "@/lib/to-data-table";
import baseQuery from "./revenue-by-region.dax?raw";
import spec from "./revenue-by-region.json";

const connection = "{connection-alias}";  // from fabric.yaml

/** Column metadata keyed by original DAX column name. */
const columnMetadata: ColumnMetadataMap = {
  "Products[Region]": { name: "ProductsRegion", displayName: "Region" },
  "[Total Revenue]": { name: "Total Revenue", displayName: "Total Revenue", format: "$#,0.00" },
};

interface RevenueByRegionParams {
  /** Filter to specific product categories (modifies the DAX query). */
  categories?: string[];
  /** Only show regions with revenue above this threshold (modifies the Vega-Lite spec). */
  minRevenue?: number;
}

export function revenueByRegion(params?: RevenueByRegionParams) {
  let query = baseQuery;
  let vegaLiteSpec = spec; // Should clone if modifying

  if (params?.categories?.length) {
    // make changes to the DAX query to filter by the specified categories and update the query variable
  }

  if (params?.minRevenue != null) {
    // Clone spec and append a client-side filter transform to the Vega-Lite spec
  }

  return { connection, query, columnMetadata, vegaLiteSpec };
}
```

The parameters, their types, and how they modify the query or spec are **entirely use-case-specific**. Some visualizations may need no parameters at all; others may accept date ranges, top-N limits, grouping dimensions, or string search terms. The factory function is the single place that translates caller intent into DAX and/or Vega-Lite modifications.

#### Query variants with multiple `.dax` files

When a parameter changes the **structure** of the query (e.g. different GROUP BY columns, different aggregations), use separate `.dax` files for each variant. The factory function selects the right one:

```
revenue-trend/
  revenue-trend-yearly.dax
  revenue-trend-quarterly.dax
  revenue-trend-monthly.dax
  revenue-trend.json
  revenue-trend.ts
```

```ts
import yearlyQuery from "./revenue-trend-yearly.dax?raw";
import quarterlyQuery from "./revenue-trend-quarterly.dax?raw";
import monthlyQuery from "./revenue-trend-monthly.dax?raw";

type Granularity = "yearly" | "quarterly" | "monthly";

const queryByGranularity: Record<Granularity, string> = {
  yearly: yearlyQuery,
  quarterly: quarterlyQuery,
  monthly: monthlyQuery,
};

export function revenueTrend(params?: { granularity?: Granularity }) {
  const query = queryByGranularity[params?.granularity ?? "monthly"];
  return { connection, query, columnMetadata, vegaLiteSpec };
}
```

#### Column Metadata

Capture column metadata in the barrel `.ts` file as a `columnMetadata: ColumnMetadataMap` constant (import `ColumnMetadataMap` from `@/lib/to-data-table`). The dictionary **must be keyed by the exact column name from the CLI query output** (the `name` field in `table.columns`). Do not guess or clean these keys — copy them verbatim from the query result. Each value is a `ColumnDef` (from `@microsoft/fabric-visuals-core`) containing:
  - `name` — a cleaned-up identifier derived from the original column name by removing `.`, `[`, `]`, `\`, `"`, and `'` characters. E.g., `"Products[Region]"` → `"ProductsRegion"`, `"[Total Revenue]"` → `"Total Revenue"` — to be used when building visual specs.
  - `displayName` — a human-readable label sourced from the semantic model schema (e.g., `"Region"`, `"Total Revenue"`). Used for axis titles, grid headers, and tooltips.
  - `format` — a VBA/ECMA-376 format string for number/date formatting (e.g., `#,##0.00`, `0.00%`, and `mm/dd/yyyy`). Omit for text type columns.

**Example workflow:** Run `npx fabric-app-data query myModel --query '<DAX>'`, observe the output columns are `[SalesPersonID]` and `[Name]`, then use those exact strings as metadata keys:
```ts
export const columnMetadata: ColumnMetadataMap = {
  "[SalesPersonID]": { name: "SalesPersonID", displayName: "Sales Person ID" },
  "[Name]": { name: "Name", displayName: "Name" },
};
```

#### Key rules

- **All DAX lives in `.dax` files.** Never inline full DAX query strings in `.ts` factory files. If a parameter changes the query structure, create a separate `.dax` file for each variant and select the right one in the factory function. Small modifications — such as replacing filter value placeholders, wrapping the query with `CALCULATETABLE` to apply filters, or substituting a column reference — are acceptable in `.ts`, but the base query must always come from a `.dax` import.
- **Name files after the visualization they drive.** Use kebab-case base names (e.g., `revenue-by-region.dax`, `revenue-by-region.json`, `revenue-by-region.ts`). Variant `.dax` files append a suffix (e.g., `revenue-trend-yearly.dax`, `revenue-trend-quarterly.dax`).
- **Use `.dax` for queries.** Plain-text DAX files keep queries readable and diff-friendly. Import them with Vite's `?raw` suffix.
- **Use `.json` for specs.** JSON files get free schema validation in editors and are importable as modules by default in Vite.
- **Barrel `.ts` exports a factory function.** The function name is the camelCase version of the kebab-case file name (e.g., `revenueByRegion` for `revenue-by-region.ts`). It accepts optional parameters (typed per use case) and returns `{ connection, query, columnMetadata, vegaLiteSpec }`.
- **Group by page/domain.** Use subfolders when the dashboard has multiple pages or logical sections. For simple single-page dashboards, a flat structure under `src/queries/` is fine.
- **Re-export via `index.ts`.** Each subfolder and the root `src/queries/index.ts` should re-export all modules for clean imports.

## Testing & Spec Files

See the [app-validation](.agents/skills/app-validation/SKILL.md) skill for when and how to write spec files.

## Key Conventions

See the [app-design](.agents/skills/app-design/SKILL.md) skill for styling conventions, UI token rules, theming, and component standards.

## Recommended Workflow

Recommend following these steps when building or modifying the dashboard unless the user instructs otherwise.

The workflow has three distinct phases:
- **Authoring phase** (Steps 1–3): You explore data and validate queries using the Fabric CLI `execute` command (backed by the same SDK used at runtime). No app code is written yet.
- **Design phase** (Step 4): You design the web app UX before writing any runtime code. This requires the [app-design skill](.agents/skills/app-design/SKILL.md). You create theming tokens in `src/global.css` according to the theming direction and plan how to cohesively apply them across components.
- **App code phase** (Steps 5–7): You write React components that fetch data at runtime using the Fabric SDK.

### 1. Ask the user for a semantic model

**Local `.pbix` files are not supported.** This app connects to semantic models published to the Power BI Service (cloud), not to local `.pbix` files on disk. If the user provides a local file path (e.g., `C:\...\Model.pbix`), **do not** attempt to open, upload, or search for it. Instead:
1. Inform the user that local `.pbix` files are not supported — only models published to the Power BI Service can be used.
2. Ask the user whether they would like to:
   - **Search the Power BI Service** for a semantic model by name — run the Fabric CLI `search` command on their behalf, or
   - **Provide a specific online model** directly (workspace ID + dataset ID, or a Power BI / Fabric URL).

Once the user confirms a published semantic model, read the [schema-discovery](.agents/skills/schema-discovery/SKILL.md) skill to progressively discover schema metadata as needed — do not fetch the full schema upfront.

Once the model is identified, register it as a connection using the Fabric CLI (see the [fabric-cli](.agents/skills/fabric-cli/SKILL.md) skill for full command reference). Choose the path that matches the input the user gave you:

```bash
# Path A — user gave a Power BI / Fabric URL
npx fabric-app-data add semanticModel <alias> --from-url "<Power BI or Fabric URL>"

# Path B — user wants you to search by name
#  1. Discover candidates. --json is recommended so you can reason over
#     displayName, workspaceName, description, and ids without parsing tables.
npx fabric-app-data search "<name>" --json
#  2. Review the results. If more than one could match, confirm the right one
#     with the user (e.g. two same-named models in different workspaces).
#  3. Register the chosen row by copying its workspaceId + itemId into `add`:
npx fabric-app-data add semanticModel <alias> -w <workspaceId> -i <itemId>

# Path C — user gave explicit IDs
npx fabric-app-data add semanticModel <alias> -w <workspaceId> -i <itemId>

# Finally — regenerate the typed config
npx fabric-app-data generate -o src/fabric.generated.ts
```

### 2. Ensure query execution is available

Before any data work, verify you can execute DAX queries using the Fabric CLI `execute` command. This uses the same SDK pipeline as the running app — ensuring identical results between authoring and runtime.

**Prerequisites:**
- Azure CLI installed and signed in (`az login`)
- A semantic model registered via `fabric-app-data add` (see Step 1)

Test with: `npx fabric-app-data query <alias> --query "EVALUATE ROW(\"test\", 1)"`

### 3. Write and test DAX queries (authoring phase)

Follow the [dax-authoring](.agents/skills/dax-authoring/SKILL.md) skill to write and test DAX queries. The skill covers DAX syntax rules, query patterns, time intelligence, and an iterative test workflow. Use the [schema-discovery](.agents/skills/schema-discovery/SKILL.md) skill to progressively discover model metadata as needed.

Use `npx fabric-app-data query <alias> --query '<DAX>'` to test queries. This runs the query through the same SDK pipeline used at runtime, so the results (column names, data types, row structure) are identical to what the app will produce. If a `--query` command fails due to shell escaping issues with special characters, write the query to a `.dax` file and retry with `--file` instead.

Iterate on queries until they return the expected columns and data shape.

**Tip:** Delegate query exploration to a sub-agent. It can discover the schema, draft queries, and test them in parallel while you plan the component structure.

Once queries are validated, **promote them to the app** following the [Query & Spec Organization](#query--spec-organization) conventions above:
1. Save each query as a `.dax` file in `src/queries/` following the naming and grouping conventions.
2. **Capture column metadata** — copy the exact column names from the query output as dictionary keys in a `columnMetadata: ColumnMetadataMap` constant. See the conventions above for the full format and rules.
3. Create the corresponding `.json` Vega-Lite spec — refer to [visuals](.agents/skills/visuals/SKILL.md). Use the cleaned `name` values from the metadata for Vega-Lite field encodings (they are already free of characters that require escaping). Use `displayName` values for axis titles, legend labels, and tooltip headers. Use `format` values for axis/tooltip formatting.
4. Create the barrel `.ts` file with a **factory function** that returns `{ connection, query, columnMetadata, vegaLiteSpec }`.

### 4. UX Design for the app

Principles for overall aesthetics, theming, layout, and accessibility requirements are outlined in [app-design](.agents/skills/app-design/SKILL.md) skill - refer to it before creating or modifying any UI component, layout, page, or style.

### 5. Build components with data (app code phase)

Use the `useSemanticModelQuery` hook from `src/hooks/use-semantic-model-query.ts` — components call the factory functions from `src/queries/` and destructure `{ connection, query, columnMetadata, vegaLiteSpec }` from the result.

Use `toDataTable()` from `src/lib/to-data-table.ts` to convert the SDK's `QueryTable` (from `data.table`) into a `DataTable` by merging it with the `columnMetadata` from the factory function result. This applies everywhere the data is consumed like rendering in `VegaVisual` or `DataGrid` (pass the `DataTable` via their `data` prop), displaying values in custom components, or any other usage.

`VegaVisual` and `DataGrid` components should call factory functions for query + spec + columnMetadata — never define specs inline in component files. Refer to the [visuals](.agents/skills/visuals/SKILL.md) skill when building them.

`App.tsx` ships rendering a placeholder `EmptyStatePreview`. Before building the real dashboard, replace `<EmptyStatePreview />` with your components, remove its import, and delete the now-unused `src/EmptyStatePreview.tsx` and `src/empty-state-preview-world-map.png`.

#### Example

```tsx
import { revenueByRegion } from "@/queries/sales/revenue-by-region";
import { useSemanticModelQuery } from "@/hooks/use-semantic-model-query";
import { toDataTable } from "@/lib/to-data-table";
import { VegaVisual, useCssTheme } from "@microsoft/fabric-visuals";
import { DataGrid } from "@microsoft/fabric-datagrid";

function RevenueByRegionChart() {
  const theme = useCssTheme();
  const { connection, query, columnMetadata, vegaLiteSpec } = revenueByRegion({
    categories: ["Category A"],
  });

  const { data, isLoading, error } = useSemanticModelQuery({
    connection,
    query,
  });

  if (isLoading) return <LoadingSpinner />;

  // The SDK never throws — errors are returned in the result status.
  // Check data.status to handle query failures (auth errors, invalid DAX, etc.).
  if (data?.status === "error") {
    return <ErrorMessage message={data.error.message} />;
  }

  if (data?.status !== "success") return null;

  // Convert the SDK's QueryTable into a DataTable enriched with column metadata.
  // toDataTable merges data.table with columnMetadata so that display names,
  // format strings, and cleaned field names are available to visuals.
  const dataTable = toDataTable(data.table, columnMetadata);

  // Pass the DataTable to VegaVisual (chart) or DataGrid (table) via the data prop.
  return (
    <div>
      <VegaVisual spec={vegaLiteSpec} data={dataTable} theme={theme} />
      <DataGrid data={dataTable} theme={theme} />
    </div>
  );
}
```

**Caching:** Query results are cached automatically by the SDK's built-in LRU cache. Subsequent calls with the same connection + query return cached data instantly. To force a fresh fetch, pass `bypassCache: true` to `useSemanticModelQuery`. To programmatically clear the cache (e.g., after a known data refresh), call `clearQueryCache("salesModel")` for a specific model or `clearQueryCache()` for all models.

**Error handling:** The SDK never throws on query failures — errors are returned as `data.status === "error"` with details in `data.error.message` (e.g., `"401 Unauthorized"`, invalid DAX syntax). Check `data.status` before accessing `data.table`. Network-level errors that prevent the SDK call itself are surfaced via the `error` field returned by the hook.

For deeper details on the SDK client, caching internals, and advanced query options, refer to the [fabric-sdk](.agents/skills/fabric-sdk/SKILL.md) skill.

### 6. Final validation

Follow the [app-validation](.agents/skills/app-validation/SKILL.md) skill (what to check, performance rules, Fabric portal embed flow) together with the [playwright-cli](.agents/skills/playwright-cli/SKILL.md) skill (the tool itself) to validate the app in the browser. Fix any issues before considering the task complete. The app can **only** be ran and validated with the Fabric portal embed flow, app-validation skill covers how to do this with the right browser flags and auth setup.

## Critical Rules

1. **NEVER use mock, fake, or hardcoded data.** All data must come from a real source. If unsure where data should come from, stop and ask the user before writing any code.
2. **Never store data in memory or local storage.** Fetch on demand from the real source.
3. **Do not assume a data source.** Always confirm with the user first.
4. **Never guess query result schema (e.g. column names).** Always run the query with `npx fabric-app-data query` first and use the exact column names from the output as metadata keys. The CLI output is identical to what the app receives at runtime.
5. **Do not use any data source without explicit user consent.** If any required data has not already been provided or consented to by the user, **stop and ask the user** before using any additional data sources. This includes (but is not limited to) additional Power BI semantic models and non-Power BI external sources (web search, web APIs, public datasets, scraped web content, or any non-Power BI data). Never silently supplement user-provided data with additional sources.
6. **Do not ask the user to describe the data schema.** Use DAX INFO functions via `fabric-app-data query` to discover metadata progressively. Refer to the [schema-discovery](.agents/skills/schema-discovery/SKILL.md) skill for discovery query patterns.
7. **ALWAYS run browser validation after UI changes.** Read the [app-validation](.agents/skills/app-validation/SKILL.md) skill. Do NOT skip any validation steps in favor of brevity.

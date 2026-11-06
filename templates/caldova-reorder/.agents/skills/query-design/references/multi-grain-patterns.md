# Multi-Grain Patterns

When a component needs data at multiple grains, return each metric at the grain where DAX must evaluate it. DataGrid body rows and a grand total can share one flagged result table; unrelated datasets such as a monthly trend and YTD annotation should use separate queries.

## Contents

- [File organization](#file-organization) — keep rollups together and independent result tables in separate query files
- [DataGrid grand-total query](#datagrid-grand-total-query) — return flagged body and optional grand-total rows in one table
- [Rendering in DataGrid](#rendering-in-datagrid) — split the result into body and grand-total `DataTable`s
- [Independent query organization and wiring](#independent-query-organization-and-wiring) — connect multiple factories and hook calls
- [Rendering in VegaVisual](#rendering-in-vegavisual) — use separate queries for independently consumed datasets
- [Consistency rules](#consistency-rules) — keep measures, filters, metadata, and row classification aligned

## File organization

Follow the template’s [Query & Spec Organization](../../../../AGENTS.md#query--spec-organization) conventions.

- **DataGrid body and grand total:** Use one `.dax` file and one factory. The query returns both as flagged rows.
- **Independent datasets:** Use one `.dax` file and factory per result table. Keep the shared Vega-Lite spec with the primary visualization factory and re-export every factory through the appropriate barrel.

## DataGrid grand-total query

Use `ROLLUPADDISSUBTOTAL` to evaluate every metric at both the body grain and grand-total grain in one DAX query. Wrap all current body grouping columns in `ROLLUPGROUP` so they roll up as one unit and do not produce intermediate subtotal rows.

### Basic flagged rollup

This starter emits body rows and, when at least one total expression is non-BLANK, one flagged grand-total row:

```dax
EVALUATE
  SUMMARIZECOLUMNS(
    ROLLUPADDISSUBTOTAL(
      ROLLUPGROUP(
        'Region'[Name],
        'Product'[Category]
      ),
      "IsGrandTotal"
    ),
    "Revenue", [Total Revenue],
    "Customer Count", DISTINCTCOUNT('Sales'[Customer Key])
  )
ORDER BY 'Region'[Name], 'Product'[Category]
```

### Flagged-rollup scaffold

Replace each `<placeholder>` before running this query:

```dax
DEFINE
  // Application/page filter: constrains body and grand-total evaluation.
  VAR _BodyFilter =
    TREATAS({<body-filter-values>}, '<FilterDimension>'[<FilterColumn>])

  // Current local DataGrid selection: constrains only the grand total.
  VAR _GrandTotalFilter =
    TREATAS({<selected-values>}, '<GridDimension>'[<GridColumn>])

  // Maximum number of body rows to return.
  VAR _MaxBodyRows = 500

  VAR _RollupResult =
    SUMMARIZECOLUMNS(
      ROLLUPADDISSUBTOTAL(
        _GrandTotalFilter,
        ROLLUPGROUP(
          '<Dimension1>'[<Column1>],
          '<Dimension2>'[<Column2>]
        ),
        "IsGrandTotal"
      ),
      _BodyFilter,
      "<MetricAlias>", [<Measure>]
    )

  VAR _ResultLimit =
    _MaxBodyRows
      + COUNTROWS(FILTER(_RollupResult, [IsGrandTotal] = TRUE()))

  // Prioritize the total inside TOPN so payload limiting cannot discard it.
  VAR _LimitedResult =
    TOPN(
      _ResultLimit,
      _RollupResult,
      [IsGrandTotal], DESC,
      [<MetricAlias>], DESC,
      '<Dimension1>'[<Column1>], ASC,
      '<Dimension2>'[<Column2>], ASC
    )

EVALUATE _LimitedResult
ORDER BY
  [<MetricAlias>] DESC,
  '<Dimension1>'[<Column1>] ASC,
  '<Dimension2>'[<Column2>] ASC
```

`_BodyFilter` is a regular `SUMMARIZECOLUMNS` filter, so it constrains both body and grand-total evaluation. Add one variable per application or page filter and pass each one as a `SUMMARIZECOLUMNS` filter argument. `_GrandTotalFilter` is the optional first argument to `ROLLUPADDISSUBTOTAL`; it updates the total for DataGrid's current local selection without removing body rows that DataGrid still needs for client-side filtering. When no local grid filter is active, omit `_GrandTotalFilter` and that argument.

For multiple local grid filters, create one `TREATAS` table per known filterable column and combine them with `CROSSJOIN` for the `grandtotalFilter`. The factory must map column IDs to known DAX columns and escape values; never interpolate arbitrary IDs.

`_ResultLimit` adds one slot only when the grand-total row exists. `TOPN` ranks that row first internally so it survives the limit while returning no more than `_MaxBodyRows` body rows. Because `TOPN` does not guarantee output order, the final `ORDER BY` makes body-row order deterministic for testing and debugging; DataGrid still owns user-facing sorting. Include every body dimension after the metric in both sort lists to break ties deterministically.

When present, the row where `IsGrandTotal` is `TRUE` contains all grand-total column values. Each expression is evaluated again without the body grouping context; DAX does not add the body-row results. For example, the grand-total `Customer Count` is a distinct count across the locally selected regions rather than a sum of their per-region distinct counts. If every grand-total expression evaluates to `BLANK` under the current filters, `SUMMARIZECOLUMNS` omits the row.

Copy the semantic model's format strings into the query factory's `columnMetadata`. Do not add metadata for the rollup flag because `toRollupDataTables()` removes it:

```typescript
const columnMetadata: ColumnMetadataMap = {
  "'Region'[Name]": { name: "RegionName", displayName: "Region" },
  "[Revenue]": { name: "Revenue", displayName: "Revenue", format: "$#,##0.00" },
  "[Customer Count]": { name: "Customer Count", displayName: "Customer Count", format: "#,##0" },
};
```

Test the query with the Fabric CLI. Verify that the flag values are booleans, and copy the exact returned rollup flag name into the conversion options rather than assuming its serialized form.

## Rendering in DataGrid

DataGrid filtering is enabled by default. Derive the rollup query from grid filter state so the body and grand-total rows are evaluated under the same filters:

```tsx
import type { CellValue } from "@microsoft/fabric-datagrid";
import { toRollupDataTables } from "@/lib/to-data-table";

const [gridFilters, setGridFilters] = useState<Record<string, CellValue[]>>({});
const { connection, query, columnMetadata } = revenueByRegion({ filters: gridFilters });
const result = useSemanticModelQuery({ connection, query });

if (result.error) return <ErrorMessage message={result.error.message} />;
if (!result.data && result.isLoading) return <LoadingSpinner />;
if (result.data?.status === "error") {
  return <ErrorMessage message={result.data.error.message} />;
}
if (result.data?.status !== "success") return null;

const { bodyTable, grandTotalTable } = toRollupDataTables(
  result.data.table,
  columnMetadata,
  { rollupFlagColumns: ["[IsGrandTotal]"] },
);

<DataGrid
  data={bodyTable}
  grandTotals={{ position: "bottom", data: grandTotalTable }}
  onFilterChange={(columnId, selectedValues) =>
    setGridFilters((current) => ({ ...current, [columnId]: selectedValues }))
  }
  theme={theme}
/>
```

`toRollupDataTables()` treats rows where all configured rollup flags are `FALSE` as body rows and rows where all flags are `TRUE` as the provided grand total. It rejects multiple grand-total rows and intermediate subtotal rows until DataGrid has an explicit subtotal API. The array-based flag contract leaves room to classify additional rollup levels when that support is added.

Changing `gridFilters` re-executes the combined query, but the hook retains the previous result during the request so DataGrid can keep filtering the complete body table locally. The new response replaces the provided grand total. Always pass `grandTotalTable` through `grandTotals.data` so DataGrid treats it as authoritative; omitting `data` selects client-computed mode. Conversion failures are query-authoring errors and intentionally surface for malformed totals.

DataGrid owns grand-total rendering; do not append the total to body rows or use `cellRenderer` for it.

## Independent query organization and wiring

Use separate queries when a consumer needs independently shaped result tables rather than classified rows from one shared result. Give each result its own `.dax` file and factory output (`connection`, `query`, and `columnMetadata`), and keep the shared Vega-Lite spec with the visualization factory. Follow the template's [Query & Spec Organization](../../../../AGENTS.md#query--spec-organization) conventions for file names, variants, and barrel exports.

Call each factory with the same shared inputs, then execute each returned query with its own hook call:

```typescript
const detailConfig = revenueByRegion(params);
const summaryConfig = revenueSummary(params);

const detail = useSemanticModelQuery({
  connection: detailConfig.connection,
  query: detailConfig.query,
});
const summary = useSemanticModelQuery({
  connection: summaryConfig.connection,
  query: summaryConfig.query,
});
```

Each `useSemanticModelQuery` invocation is a separate SDK round trip with its own cache, loading state, and error state. When the tables form a matched set, replace the rendered set only after every request has succeeded and none is still loading; surface a failure from any request instead of combining fresh and stale results.

## Rendering in VegaVisual

Convert each successful result with its own metadata, then pass the `DataTable`s as named datasets:

```typescript
const detailTable = toDataTable(detail.data.table, detailConfig.columnMetadata);
const summaryTable = toDataTable(summary.data.table, summaryConfig.columnMetadata);
```

```tsx
<VegaVisual
  spec={detailConfig.vegaLiteSpec}
  data={{ detail: detailTable, summary: summaryTable }}
  theme={theme}
/>
```

See the visuals skill's [multi-data input](../../visuals/references/multi-data-input.md) reference for named dataset binding, overlays, reference lines, axis spines, and compatible field contracts. For a baseline plus selected-subset overlay, follow [Highlight queries](highlight-queries.md) for query generation and synchronization.

## Consistency rules

- Use one `EVALUATE` per DAX query; the Execute Queries transport supports one result table per query.
- For DataGrid grand totals, keep body and total expressions in one `SUMMARIZECOLUMNS` and split its flagged rows in TypeScript.
- Apply application filters to every row and local DataGrid filters through `ROLLUPADDISSUBTOTAL`'s `grandtotalFilter`; DataGrid continues filtering the complete body table locally.
- Keep output aliases and metadata names aligned; the body and grand-total `DataTable`s use the same format metadata.
- Validate that the query never returns multiple flagged grand-total rows.
- Pass the same model connection and shared filter parameters to every related query factory so tables do not drift.
- Keep shared field aliases, types, and encoded keys compatible across independently queried tables. Cross-highlight baseline and subset queries must also share grouping columns, measures, and row keys as described in [Highlight queries](highlight-queries.md).

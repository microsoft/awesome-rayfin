# Anti-Patterns and Corrections

## Contents

1. [UNION to mix grains](#anti-pattern-1-union-to-mix-grains) — manually combining body rows + a total row
2. [FORMAT() for display labels](#anti-pattern-2-format-for-display-labels) — converting numbers to formatted strings in DAX
3. [Stringified dates](#anti-pattern-3-stringified-dates) — turning dates into month-name strings in DAX
4. [Complex DAX for dimension completeness](#anti-pattern-4-complex-dax-for-dimension-completeness) — GENERATE/CROSSJOIN to force-include empty dimension members
5. [Decorative text in DAX](#anti-pattern-5-decorative-text-in-dax) — emoji, prefixes, concatenated UI strings
6. [SELECTCOLUMNS for friendly names](#anti-pattern-6-selectcolumns-for-friendly-names) — wrapping queries solely for renaming
7. [Converting BLANK to placeholder values](#anti-pattern-7-converting-blank-to-placeholder-values) — replacing BLANK with `0` / `""` / `"N/A"` in DAX

## Anti-Pattern 1: UNION to mix grains

**Problem:** `UNION` manually combines body rows and a total row without a standard grain discriminator.

```dax
// ❌ Avoid
DEFINE
  VAR RegionBreakdown =
    SUMMARIZECOLUMNS('Region'[Name], "Revenue", [Total Revenue])
  VAR AllRegions =
    ROW("Region[Name]", "All regions", "Revenue", CALCULATE([Total Revenue], ALL('Region')))

EVALUATE
  UNION(AllRegions, RegionBreakdown)
```

**Fix — flagged rollup:** Use `ROLLUPADDISSUBTOTAL` so DAX evaluates the same expressions at the body and grand-total grains. Return one result table, split it with `toRollupDataTables()`, and pass the returned `grandTotalTable` through `grandTotals.data`. See [Multi-grain patterns](multi-grain-patterns.md) for the filter-aware query and wiring.

**Alternative — DataGrid-computed SUM or COUNT:** Choose this when the user requests computed totals or a rollup query is infeasible, but only for additive sums or a count of fetched leaf rows. Omit `grandTotals.data` and set `defaultAggregation` in the body metadata.

```typescript
// ✅ Factory metadata: DataGrid computed totals currently support only sum and count
export const columnMetadata: ColumnMetadataMap = {
  "'Region'[Name]": { name: "RegionName", displayName: "Region" },
  "[Revenue]": {
    name: "Revenue",
    displayName: "Revenue",
    format: "$#,##0.00",
    defaultAggregation: "sum",
  },
};
```

```tsx
const bodyTable = toDataTable(body.data.table, columnMetadata);

<DataGrid
  data={bodyTable}
  grandTotals={{ position: "bottom" }}
  theme={theme}
/>
```

> **Rule of thumb:** Never sum grouped `DISTINCTCOUNT`, ratios, averages, or other non-additive results. Let the rollup query evaluate them at grand-total context, and never append the resulting total to the body data.

## Anti-Pattern 2: FORMAT() for display labels

**Problem:** Converting numbers/dates to formatted strings in DAX.

```dax
// ❌ Avoid — produces text that cannot be sorted or charted
EVALUATE
  SUMMARIZECOLUMNS('Calendar'[Month], "Revenue", FORMAT([Total Revenue], "$#,##0"))
```

**Fix:** Return raw values. Format via `columnMetadata` or Vega-Lite spec.

```dax
// ✅ DAX: raw numeric value
EVALUATE
  SUMMARIZECOLUMNS('Calendar'[Month], "Revenue", [Total Revenue])
ORDER BY 'Calendar'[Month]
```

```typescript
// ✅ Factory file: declare format in metadata (VBA/ECMA-376 format string)
export const columnMetadata: ColumnMetadataMap = {
  "'Calendar'[Month]": { name: "CalendarMonth", displayName: "Month" },
  "[Revenue]":         { name: "Revenue", displayName: "Revenue", format: "$#,##0.00" },
};
```

## Anti-Pattern 3: Stringified dates

**Problem:** `FORMAT()` to turn dates into month-name strings.

```dax
// ❌ Avoid — text values lose sort order and date semantics
EVALUATE
  SUMMARIZECOLUMNS("Month Label", FORMAT('Calendar'[Date], "MMM YYYY"), "Sales", [Total Sales])
```

**Fix:** Return sortable date. Let Vega-Lite format it.

```dax
// ✅ DAX: return the date
EVALUATE
  SUMMARIZECOLUMNS('Calendar'[Date], "Sales", [Total Sales])
ORDER BY 'Calendar'[Date]
```

```json
{
  "encoding": {
    "x": { "field": "CalendarDate", "type": "temporal", "axis": { "format": "%b %Y", "title": "Month" } }
  }
}
```

## Anti-Pattern 4: Complex DAX for dimension completeness

**Problem:** Elaborate `GENERATE` / `CROSSJOIN` / `ADDMISSINGITEMS` to include dimension members with no data.

```dax
// ❌ Avoid — hard to read, test, and maintain
EVALUATE
  VAR AllRegions = ALL('Region'[Name])
  VAR WithSales = SUMMARIZECOLUMNS('Region'[Name], "Sales", [Total Sales])
  RETURN NATURALLEFTOUTERJOIN(AllRegions, WithSales)
```

**Fix:** Two simple queries, stitched in TypeScript.

```dax
// ✅ Query 1: detail data (only regions with sales)
EVALUATE SUMMARIZECOLUMNS('Region'[Name], "Sales", [Total Sales])
ORDER BY 'Region'[Name]
```

```dax
// ✅ Query 2: complete dimension list
EVALUATE ALL('Region'[Name])
ORDER BY 'Region'[Name]
```

```typescript
// ✅ TypeScript: merge into a DataTable
const detailTable = toDataTable(detail.data.table, detailMeta);
const dimsTable = toDataTable(dims.data.table, dimsMeta);
const salesMap = new Map(detailTable.rows.map(r => [r[0], r[1]]));
const filledRows = dimsTable.rows.map(r => [r[0], salesMap.get(r[0] as string) ?? 0]);
const filledTable: DataTable = { columns: detailTable.columns, rows: filledRows };
```

**Alternative — Vega-Lite lookup transform:** Pass both tables to VegaVisual and join in the spec:

```tsx
<VegaVisual spec={vegaLiteSpec} data={{ regions: dimsTable, sales: detailTable }} theme={theme} />
```

```json
{
  "data": { "name": "regions" },
  "transform": [
    { "lookup": "RegionName", "from": { "data": { "name": "sales" }, "key": "RegionName", "fields": ["Sales"] } },
    { "calculate": "datum.Sales ?? 0", "as": "Sales" }
  ],
  "mark": "bar",
  "encoding": { "x": { "field": "RegionName" }, "y": { "field": "Sales", "type": "quantitative" } }
}
```

> **Cardinality guardrail:** This pattern is for bounded axis dimensions (categories, regions, statuses) — not high-cardinality dimensions like customers or transaction IDs.

## Anti-Pattern 5: Decorative text in DAX

**Problem:** Emoji, prefixes, or concatenated UI strings in DAX results.

```dax
// ❌ Avoid — presentation logic in the data layer
EVALUATE
  SUMMARIZECOLUMNS("Status", "✅ " & 'Order'[Status], "Count", COUNTROWS('Order'))
```

**Fix:** Return raw data. Decorate via DataGrid `cellRenderer`.

```dax
// ✅ DAX: raw status values
EVALUATE SUMMARIZECOLUMNS('Order'[Status], "Count", COUNTROWS('Order'))
ORDER BY 'Order'[Status]
```

```tsx
// ✅ DataGrid: decorate via cellRenderer
const columns: GridColumnDef[] = [
  {
    id: "OrderStatus",
    header: "Status",
    cellRenderer: (value) => (
      <span>{value === "Complete" ? "✅" : "⏳"} {value as string}</span>
    ),
  },
  { id: "Count", header: "Count" },
];

<DataGrid columns={columns} data={dataTable} theme={theme} />
```

## Anti-Pattern 6: SELECTCOLUMNS for friendly names

**Problem:** Wrapping a query in SELECTCOLUMNS solely to rename columns. Adds complexity, breaks `ORDER BY` references, duplicates `columnMetadata`.

```dax
// ❌ Avoid — SELECTCOLUMNS used only for renaming
DEFINE
  VAR _Core = SUMMARIZECOLUMNS('Region'[Region Name], 'Product'[Category], "Total Revenue", [Total Revenue])
EVALUATE
  SELECTCOLUMNS(_Core, "Region", 'Region'[Region Name], "Category", 'Product'[Category], "Revenue", [Total Revenue])
```

**Fix:** Let DAX return natural column names. Map in `columnMetadata`.

```dax
// ✅ Natural column names
EVALUATE
  SUMMARIZECOLUMNS('Region'[Region Name], 'Product'[Category], "Total Revenue", [Total Revenue])
ORDER BY 'Region'[Region Name], 'Product'[Category]
```

```typescript
// ✅ Factory file: columnMetadata maps query schema → presentation
export const columnMetadata: ColumnMetadataMap = {
  "'Region'[Region Name]": { name: "RegionRegion Name", displayName: "Region" },
  "'Product'[Category]":   { name: "ProductCategory",   displayName: "Category" },
  "[Total Revenue]":       { name: "Total Revenue",     displayName: "Revenue", format: "$#,##0.00" },
};
```

The `columnMetadata` provides: `name` (cleaned identifier for Vega-Lite field references), `displayName` (human-readable caption for headers/axes), `format` (VBA/ECMA-376 format string for rendering — same syntax as the model's `FormatString`).

> **When SELECTCOLUMNS is appropriate:** Use it to project a subset of columns, compute derived columns (`RELATED(...)`), or reshape table structure — not as a cosmetic renaming layer.

## Anti-Pattern 7: Converting BLANK to placeholder values

**Problem:** Replacing BLANK with `0` / `""` / `"N/A"` in DAX. `SUMMARIZECOLUMNS` auto-eliminates rows where all measures are BLANK. Converting BLANK to non-BLANK defeats this, causing result set explosion.

```dax
// ❌ Avoid — alternate value 0 defeats BLANK elimination
EVALUATE
  SUMMARIZECOLUMNS(
    'Product'[Category], 'Calendar'[Year],
    "YoY Change", DIVIDE([Sales This Year] - [Sales Last Year], [Sales Last Year], 0),
    "Sales", IF(ISBLANK([Total Sales]), 0, [Total Sales])
  )
```

**Fix:** Let BLANKs flow through. Handle at the component layer.

```dax
// ✅ DAX: let BLANK remain BLANK — minimal result set
EVALUATE
  SUMMARIZECOLUMNS(
    'Product'[Category], 'Calendar'[Year],
    "YoY Change", DIVIDE([Sales This Year] - [Sales Last Year], [Sales Last Year]),
    "Sales", [Total Sales]
  )
ORDER BY 'Product'[Category], 'Calendar'[Year]
```

```tsx
// ✅ DataGrid: cellRenderer handles null values
const columns: GridColumnDef[] = [
  { id: "ProductCategory", header: "Category" },
  { id: "CalendarYear", header: "Year" },
  {
    id: "YoY Change",
    header: "YoY Change",
    cellRenderer: (value) =>
      value == null ? <span className="text-muted-foreground">—</span>
                    : <span>{`${((value as number) * 100).toFixed(1)}%`}</span>,
  },
  {
    id: "Sales",
    header: "Sales",
    cellRenderer: (value) =>
      value == null ? <span className="text-muted-foreground">N/A</span> : undefined,
  },
];
```

VegaVisual handles nulls natively — missing values become gaps in line charts or absent bars. No special handling needed unless you want custom tooltip/label behavior via Vega-Lite `condition` or `calculate` transforms.

> **Key insight:** `SUMMARIZECOLUMNS` skips rows where all measures are BLANK but not where they are `0` or `""`. Every BLANK-to-value conversion is a potential row-count multiplier. Use `DIVIDE(num, den)` without a third argument (defaults to BLANK).

/**
 * Pure Vega-Lite spec builders for the official-chart engine (`engine="fabric"`).
 *
 * These functions map this template's `BarDatum[]` model onto the official Fabric
 * charting substrate: a row-major `DataTable` (fed to `<VegaVisual data>`) plus a
 * Vega-Lite `TopLevelSpec`. They are intentionally free of any runtime dependency
 * on `vega`/`vega-lite`/`@microsoft/fabric-visuals` — `TopLevelSpec`, `DataTable`
 * and `ColumnDef` are pulled in with `import type` only and erased at build time —
 * so the builders can be unit-tested under the node-only test runner (no jsdom, no
 * Vega runtime) and carry ZERO weight until the lazy `fabric-chart` chunk loads.
 *
 * Fidelity note: Vega renders standard, host-consistent SVG marks. We tune the
 * specs toward this template's look where the grammar allows it (rounded bar tops,
 * a filled area under the line, an inner-radius donut, on-theme colors resolved
 * from CSS and passed in as `accent`/`palette`), but the bespoke gradient glow,
 * entrance motion and rAF cursor tooltips of the custom charts are deliberately
 * not reproduced here — the custom engine remains the default for that polish.
 */
import type { TopLevelSpec } from "vega-lite";
import type { DataTable, ColumnDef } from "@microsoft/fabric-visuals-core";
import type { DataPointSelection } from "@microsoft/fabric-visuals-core";
import type { BarDatum } from "./bar-chart";

export type FabricChartVariant = "bar" | "line" | "donut";

export interface FabricChartSpecOptions {
  /** Currency/unit prefix applied to axis + tooltip numeric formatting (e.g. "$"). */
  valuePrefix?: string;
  /** Concrete accent color (resolved from CSS) for single-series bar/line marks. */
  accent?: string;
  /** Concrete categorical palette (resolved from CSS) for donut segments. */
  palette?: string[];
}

/** Column names used across every generated spec + DataTable. */
export const LABEL_FIELD = "label";
export const VALUE_FIELD = "value";

const VEGA_LITE_SCHEMA = "https://vega.github.io/schema/vega-lite/v6.json";

/** Empty inline data placeholder. `<VegaVisual data>` injects the real row-major
 *  DataTable as the anonymous top-level `spec.data`, overriding this — but Vega-Lite's
 *  `TopLevelSpec` type requires the `data` key to be present, so we set an empty one. */
const EMPTY_DATA = { values: [] as unknown[] };

/** Default on-theme accent when a concrete color can't be resolved (matches the
 *  light-theme brand / chart-1 blue). */
export const DEFAULT_ACCENT = "#0f6cbd";

/** SI-suffixed numeric axis format with an optional currency prefix (e.g. "$~s"). */
function axisFormat(valuePrefix: string): string {
  return `${valuePrefix}~s`;
}

/** Grouped-digit tooltip format with an optional currency prefix (e.g. "$,.0f"). */
function tooltipFormat(valuePrefix: string): string {
  return `${valuePrefix},.0f`;
}

/**
 * Map a `BarDatum[]` into the official row-major `DataTable` consumed by
 * `<VegaVisual data>`. A single table is injected as the anonymous top-level
 * `spec.data`, so the specs reference the fields by name (`label`, `value`).
 */
export function toChartData(data: BarDatum[], valuePrefix = ""): DataTable {
  const valueColumn: ColumnDef = valuePrefix === "$"
    ? { name: VALUE_FIELD, displayName: "Value", format: "$#,##0" }
    : { name: VALUE_FIELD, displayName: "Value" };
  return {
    columns: [{ name: LABEL_FIELD, displayName: "Category" }, valueColumn],
    rows: data.map((d) => [d.label, d.value]),
  };
}

/** Vertical bar chart — rounded tops, on-theme solid fill, zero-based axis. */
export function buildBarSpec(opts: FabricChartSpecOptions = {}): TopLevelSpec {
  const { valuePrefix = "", accent = DEFAULT_ACCENT } = opts;
  return {
    $schema: VEGA_LITE_SCHEMA,
    width: "container",
    height: "container",
    data: EMPTY_DATA,
    mark: { type: "bar", cornerRadiusEnd: 6, fill: accent },
    encoding: {
      x: { field: LABEL_FIELD, type: "nominal", sort: null, axis: { labelAngle: 0, title: null } },
      y: { field: VALUE_FIELD, type: "quantitative", axis: { format: axisFormat(valuePrefix), title: null } },
      tooltip: [
        { field: LABEL_FIELD, type: "nominal", title: "Category" },
        { field: VALUE_FIELD, type: "quantitative", title: "Value", format: tooltipFormat(valuePrefix) },
      ],
    },
  };
}

/** Area + line chart — filled area under an on-theme line with filled points. */
export function buildLineSpec(opts: FabricChartSpecOptions = {}): TopLevelSpec {
  const { valuePrefix = "", accent = DEFAULT_ACCENT } = opts;
  return {
    $schema: VEGA_LITE_SCHEMA,
    width: "container",
    height: "container",
    data: EMPTY_DATA,
    encoding: {
      x: { field: LABEL_FIELD, type: "nominal", sort: null, axis: { labelAngle: 0, title: null } },
      y: { field: VALUE_FIELD, type: "quantitative", axis: { format: axisFormat(valuePrefix), title: null } },
    },
    layer: [
      { mark: { type: "area", line: false, color: accent, opacity: 0.16 } },
      {
        mark: { type: "line", color: accent, strokeWidth: 2, point: { filled: true, size: 55, color: accent } },
        encoding: {
          tooltip: [
            { field: LABEL_FIELD, type: "nominal", title: "Category" },
            { field: VALUE_FIELD, type: "quantitative", title: "Value", format: tooltipFormat(valuePrefix) },
          ],
        },
      },
    ],
  };
}

/** Donut / share chart — inner-radius arc, categorical on-theme palette. */
export function buildDonutSpec(opts: FabricChartSpecOptions = {}): TopLevelSpec {
  const { valuePrefix = "", palette } = opts;
  const color: Record<string, unknown> = { field: LABEL_FIELD, type: "nominal", legend: { title: null } };
  if (palette && palette.length > 0) color.scale = { range: palette };
  return {
    $schema: VEGA_LITE_SCHEMA,
    width: "container",
    height: "container",
    data: EMPTY_DATA,
    mark: { type: "arc", innerRadius: 58, cornerRadius: 2, padAngle: 0.012 },
    encoding: {
      theta: { field: VALUE_FIELD, type: "quantitative", stack: true },
      color,
      tooltip: [
        { field: LABEL_FIELD, type: "nominal", title: "Category" },
        { field: VALUE_FIELD, type: "quantitative", title: "Value", format: tooltipFormat(valuePrefix) },
      ],
    },
  } as TopLevelSpec;
}

/** Build the spec for a given chart variant. */
export function buildChartSpec(variant: FabricChartVariant, opts: FabricChartSpecOptions = {}): TopLevelSpec {
  switch (variant) {
    case "bar":
      return buildBarSpec(opts);
    case "line":
      return buildLineSpec(opts);
    case "donut":
      return buildDonutSpec(opts);
  }
}

/**
 * Resolve an official `select` interaction back to a `BarDatum` index, by matching
 * the first `set` predicate on the `label` field against the chart's data. Returns
 * -1 when the selection carries no label predicate or the value isn't present
 * (e.g. a cleared selection or a numeric range brush). Pure — used to derive the
 * convenience `onSelect(datum, index)` callback from the raw interaction stream.
 */
export function selectionToIndex(selection: DataPointSelection, data: BarDatum[]): number {
  for (const predicate of selection.predicates) {
    if (predicate.type === "set" && predicate.name === LABEL_FIELD) {
      const value = predicate.values[0];
      const index = data.findIndex((d) => d.label === value);
      if (index !== -1) return index;
    }
  }
  return -1;
}

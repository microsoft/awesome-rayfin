import type { ReactNode } from "react";
import type { IconType, FeatureId } from "../feature-registry";
import type { DataTable } from "../lib/types";
import type { DataQuery, DataSource } from "../data/data-source";
import type { UseDataQueryResult } from "../data/use-data-query";
import type { KpiCardProps } from "../kpi-card";
import type { BarDatum } from "../features/bar-chart";
import type { Insight } from "../features/intelligence-rail";
import type { InsightOptions } from "../lib/insights";
import type { PeriodValue, Granularity, PeriodPresetId } from "../lib/period";
import type { SelectionHost } from "../lib/selection-bus";
import type { DaxColumnMap } from "../lib/dax-pushdown";

/** What every page render fn receives — the resolved table plus the live query handle. */
export interface PageContext {
  table: DataTable;
  query: UseDataQueryResult;
  /** The active global period + granularity, when a `period` config is present. */
  period?: PeriodValue;
}

export type MetricFn = (table: DataTable) => KpiCardProps[];

export interface ChartSpec {
  data: BarDatum[];
  title?: string;
  hint?: string;
  valuePrefix?: string;
  /** Optional leading icon for the visual frame header. */
  icon?: IconType;
  /** Chart family — each renders from the same {label,value}[] shape. Default "bar". */
  type?: "bar" | "line" | "donut";
  /** Rendering engine. "fabric" routes to the official Vega VegaVisual (native selection
   *  round-trip into the semantic model); "custom" (default) keeps the bespoke SVG chart. */
  engine?: "custom" | "fabric";
  /** When set, clicking a segment cross-filters the whole page on this column. */
  filterColumn?: string;
}
export type ChartFn = (table: DataTable) => ChartSpec;
/** Render several standardized visuals on one overview page (responsive grid). */
export type ChartsFn = (table: DataTable) => ChartSpec[];

/**
 * Per-page capability contract. A page that renders its own local dataset (e.g. the
 * FP&A boards) shouldn't display the global dimension filters, shell row count or
 * model-derived resting insights — none of those describe what's actually on screen.
 * Declaring a `scope` lets the shell suppress exactly the affordances that don't apply,
 * so every control the user sees is honest and live. All fields default to the
 * fully-global behaviour, so pages that omit `scope` are unchanged.
 */
export interface PageScope {
  /** Global dimension filters (segment/region/…). `"global"` shows & applies them;
   *  `"none"` hides them (the page ignores global filtering). Default `"global"`. */
  dimensions?: "global" | "none";
  /** Global period control. `"global"` pins & applies it; `"none"` hides it. Default `"global"`. */
  period?: "global" | "none";
  /** Show the live "N rows" count in the context header. Default `true`. */
  showRowCount?: boolean;
  /** Surface the "refreshing snapshot" revalidation banner. Default `true`. */
  standardRefresh?: boolean;
  /** Emit the model-derived resting insights into the rail. Local pages that compute
   *  their own facts set `"off"` to avoid mismatched insights (click-drill still works).
   *  Default `"on"`. */
  baseInsights?: "on" | "off";
  /** A short scope note shown in the context header when the dimension filters are
   *  suppressed (e.g. "Global filters don't apply to this view"). */
  note?: string;
}

interface BasePage {
  id: string;
  label: string;
  /** Optional one-line description shown under the page title. */
  description?: string;
  icon?: IconType;
  /** Optional nav section header — consecutive pages sharing a group render under it. */
  group?: string;
  /** Per-page capability contract — which shared shell affordances apply here. */
  scope?: PageScope;
}

/**
 * Standardized page kinds. Pick a kind and the runtime renders the matching
 * org-standard surface (with data-state handling + lazy code-splitting) for you.
 * `custom` is the escape hatch for app-specific UI.
 */
export type PageDef =
  | (BasePage & { kind: "overview"; metrics: MetricFn; chart?: ChartFn; charts?: ChartsFn })
  | (BasePage & { kind: "grid"; gridEngine?: "custom" | "fabric" })
  | (BasePage & { kind: "pivot" })
  | (BasePage & { kind: "gallery" })
  | (BasePage & { kind: "tables" })
  | (BasePage & { kind: "catalog" })
  | (BasePage & { kind: "custom"; render: (ctx: PageContext) => ReactNode });

/** Optional per-app brand. The shell/chrome stays standardized; only the accent
 *  color and logo mark change — uniform layout, your identity. */
export interface BrandConfig {
  /** Primary accent color (any CSS color). Drives buttons, links, charts, focus rings. */
  primary?: string;
  /** Secondary accent used in the gradient logo mark. Defaults to primary. */
  accent?: string;
  /** Short mark text (1–3 chars/emoji) shown in the brand badge. */
  logoText?: string;
}

/** Export governance — classification stamped on files + an audit callback. */
export interface GovernanceConfig {
  /** e.g. "Microsoft Confidential". Stamped onto every export and shown in the header. */
  classification?: string;
  /** Fired after each successful export — route to your telemetry/audit log.
   *  `copy` covers clipboard copies (a real data-exfiltration surface). */
  onExport?: (evt: { format: "copy" | "csv" | "excel" | "pptx"; rows: number; filename: string }) => void;
}

/** A column promoted to a first-class, URL-persisted page filter. */
export interface FilterColumnDef {
  /** Column key to filter on. */
  column: string;
  /** Display label (defaults to the column's label). */
  label?: string;
  /**
   * Pin this filter to the always-visible top bar. Unpinned filters live only in
   * the "More filters" drawer. Defaults to `false` (drawer-only).
   */
  pinned?: boolean;
  /**
   * Section heading this filter is grouped under inside the drawer
   * (e.g. "Time", "Geography", "Product", "Segment"). Defaults to "Filters".
   */
  group?: string;
}

/**
 * The whole app, declared. Point `dataSource` at your semantic model, write one
 * `query`, opt into `features`, list `pages` — `createFabricStandardApp` returns a
 * complete, standardized React app component.
 */
export interface FabricStandardAppConfig {
  appName: string;
  subtitle?: string;
  version?: string;
  dataSource: DataSource;
  query: DataQuery;
  /** Catalog opt-ins. Drives header export menu, the right-rail, the catalog page, etc. */
  features: FeatureId[];
  pages: PageDef[];
  /** Model-derived insights for the intelligence rail (only used if "intelligence" is enabled).
   *  Omit to use the built-in deterministic generator (see `insightOptions`). */
  insights?: (table: DataTable) => Insight[];
  /** Tune the built-in auto-insight generator (which column is the measure/category).
   *  Ignored when `insights` is provided. */
  insightOptions?: InsightOptions;
  brand?: BrandConfig;
  governance?: GovernanceConfig;
  /** Optional working Help link shown in the footer. Omit to hide it. */
  helpHref?: string;
  /** Left-hand footer label. Defaults to `appName` so it stays vendor-neutral. */
  footerLabel?: string;
  /** Columns promoted to first-class, URL-persisted page filters (with cross-filtering). */
  filters?: FilterColumnDef[];
  /** Global period + granularity control, pinned into the filter bar. */
  period?: PeriodConfig;
  /** Workspace selection round-trip transport. A Fabric Apps Analytics host supplies this
   *  so a cross-filter here fans to sibling items on the same semantic model (and vice
   *  versa). Omit for standalone/dev — selection then stays in-app. */
  selectionHost?: SelectionHost;
  /**
   * DAX selection pushdown (A2). Map filter-column keys to their DAX column references
   * (e.g. `{ segment: "Segment[Segment]", year: { ref: "Calendar[Year]", numeric: true } }`)
   * to fold the active selection into the `query` so the **semantic model** filters the
   * data (via `CALCULATETABLE`), rather than filtering the fetched table in the browser.
   * Mapped columns are pushed down and dropped from client-side filtering; unmapped columns
   * (and the period control) stay client-side. Omit for pure client-side filtering (default).
   */
  pushdown?: DaxColumnMap;
}

/**
 * A global time-scope control rendered in the filter bar. When `column` names a
 * date column, the selected preset filters every page's rows; otherwise the
 * control is scope-only (URL-persisted, drives labels) until a date column exists.
 */
export interface PeriodConfig {
  /** Date column to filter on. Omit for a scope-only control (no row filtering). */
  column?: string;
  defaultPreset?: PeriodPresetId;
  defaultGranularity?: Granularity;
  /** Which grains to offer (defaults to day/week/month/quarter). */
  granularities?: Granularity[];
  /** Which presets to offer (defaults to all). */
  presets?: PeriodPresetId[];
}

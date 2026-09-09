import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { Search, RefreshCw, ShieldCheck, Link2, Palette, Presentation, FilterX, Info, MousePointerClick } from "lucide-react";
import { FabricAppShell } from "../fabric-app-shell";
import { useUrlState } from "../hooks/use-url-state";
import { FilterControls } from "../features/filter-controls";
import { type FilterDef } from "../features/filter-bar";
import { applyFilters, decodeFilters, encodeFilters, distinctValues, countActive } from "../lib/filters";
import { pushdownQuery, pushableColumns } from "../lib/dax-pushdown";
import { decodePeriod, encodePeriod, filterByPeriod, DEFAULT_PERIOD, type PeriodValue } from "../lib/period";
import { PeriodControl } from "../features/period-control";
import { Tooltip } from "../primitives";
import { KpiCard } from "../kpi-card";
import { ExportMenu } from "../features/export-menu";
import { VisualDrillRail } from "../features/visual-drill-rail";
import { visualSelectionStore } from "../lib/visual-selection";
import { chartCaptureRegistry } from "../lib/chart-capture";
import { CommandPalette, type Command } from "../features/command-palette";
import { Toaster } from "../features/toaster";
import { toast } from "../lib/toast";
import { useCommandPalette } from "../hooks/use-command-palette";
import { QueryBoundary, LoadingState } from "../components/states";
import { useDataQuery } from "../data/use-data-query";
import { SelectionProvider } from "../hooks/use-selection";
import { filtersToSelections, selectionsToFilters } from "../lib/interaction";
import type { InteractionEvent, DataPointSelection } from "../data/fabric-interop";
import { generateInsights } from "../lib/insights";
import { applyThemeMode } from "../lib/theme";
import { formatSignedPercent } from "../lib/format";
import { VisualFrame } from "../features/visual-frame";
import { VisualExports } from "../features/visual-exports";
import type { DataTable } from "../lib/types";
import type { DeckKpi, DeckChartSpec } from "../lib/deck";
import type { FabricStandardAppConfig, PageContext, PageDef, ChartSpec } from "./page-types";

/**
 * Heavy/optional surfaces are dynamically imported so each becomes its OWN chunk.
 * A page's code only downloads when a user first opens it — the catalog opt-in and
 * the performance budget are the same mechanism.
 */
const LazyGrid = lazy(() => import("../features/data-grid").then((m) => ({ default: m.DataGrid })));
const LazyPivot = lazy(() => import("../features/pivot-table").then((m) => ({ default: m.PivotTable })));
const LazyBar = lazy(() => import("../features/bar-chart").then((m) => ({ default: m.BarChart })));
const LazyLine = lazy(() => import("../features/line-chart").then((m) => ({ default: m.LineChart })));
const LazyDonut = lazy(() => import("../features/donut-chart").then((m) => ({ default: m.DonutChart })));
const LazyCatalog = lazy(() => import("../features/feature-gallery").then((m) => ({ default: m.FeatureGallery })));
const LazyGallery = lazy(() => import("../features/visuals-gallery").then((m) => ({ default: m.VisualsGallery })));
const LazyFinanceTables = lazy(() => import("../features/finance-tables-gallery").then((m) => ({ default: m.FinanceTablesGallery })));
const LazyDeckBuilder = lazy(() => import("../features/deck-builder").then((m) => ({ default: m.DeckBuilder })));

const EMPTY: DataTable = { columns: [], rows: [] };

/** Stable id under which the active overview page's PRIMARY chart publishes its
 *  live Vega view, so the Deck Builder can snapshot exactly that visual. The deck
 *  snapshots `charts[0]`, matching the chart it renders from `deckChart`. */
const DECK_CHART_CAPTURE_ID = "__deck-chart";

/** Compact relative-time label for the refresh status tooltip. */
function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** Eagerly fetch a page's lazy chunk on hover/focus intent so the first open is
 *  instant. Imports are memoized by the bundler, so repeated calls are free. */
const PREFETCH: Record<string, () => Promise<unknown>> = {
  grid: () => import("../features/data-grid"),
  pivot: () => import("../features/pivot-table"),
  catalog: () => import("../features/feature-gallery"),
  gallery: () => import("../features/visuals-gallery"),
  tables: () => import("../features/finance-tables-gallery"),
  overview: () =>
    Promise.all([
      import("../features/bar-chart"),
      import("../features/line-chart"),
      import("../features/donut-chart"),
    ]),
};

interface RenderCtx extends PageContext {
  isEmpty: boolean;
  features: string[];
  valuePrefix?: string;
  onCrossFilter?: (column: string, value: string) => void;
  /** Fold a fabric visual's official interaction batch into the page filters. */
  onFabricInteraction?: (events: InteractionEvent[]) => void;
  classification?: string;
  onExport?: (evt: { format: "copy" | "csv" | "excel" | "pptx"; rows: number; filename: string }) => void;
}

function ChartBody({
  chart,
  onSelect,
  onInteraction,
  captureId,
}: {
  chart: ChartSpec;
  onSelect?: (datum: { label: string; value: number }) => void;
  onInteraction?: (events: InteractionEvent[]) => void;
  captureId?: string;
}) {
  const handle = chart.filterColumn && onSelect ? (d: { label: string; value: number }) => onSelect(d) : undefined;
  // The fabric engine cross-filters via the official onInteraction event (predicates),
  // not the {label,value} onSelect shape — wire it only when this chart is a filter source.
  const fabric = chart.engine === "fabric" && chart.filterColumn ? onInteraction : undefined;
  // Only fabric charts have a live Vega view to snapshot; passing captureId to the
  // custom SVG charts is harmless (ignored), so the deck simply falls back to native.
  const capture = chart.engine === "fabric" ? captureId : undefined;
  const common = { engine: chart.engine, onInteraction: fabric, captureId: capture } as const;
  if (chart.type === "line") return <LazyLine data={chart.data} valuePrefix={chart.valuePrefix} onSelect={handle} {...common} />;
  if (chart.type === "donut") return <LazyDonut data={chart.data} valuePrefix={chart.valuePrefix} onSelect={handle} {...common} />;
  return <LazyBar data={chart.data} valuePrefix={chart.valuePrefix} onSelect={handle} {...common} />;
}

function renderPage(page: PageDef, ctx: RenderCtx): ReactNode {
  switch (page.kind) {
    case "overview": {
      const cards = page.metrics(ctx.table);
      const charts: ChartSpec[] = page.charts
        ? page.charts(ctx.table)
        : page.chart
          ? [page.chart(ctx.table)]
          : [];
      return (
        <QueryBoundary query={ctx.query} empty={ctx.isEmpty}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((m, i) => (
              <KpiCard key={m.label} {...m} delayMs={i * 70} />
            ))}
          </div>
          {charts.length ? (
            <div className={"mt-6 grid gap-5 " + (charts.length > 1 ? "lg:grid-cols-2" : "grid-cols-1")}>
              {charts.map((c, i) => (
                <VisualFrame
                  key={c.title ?? i}
                  title={c.title ?? "Visual"}
                  hint={c.hint}
                  icon={c.icon}
                  delayMs={i * 80}
                  actions={ctx.features.includes("exports") ? <VisualExports title={c.title ?? "Visual"} data={c.data} /> : undefined}
                >
                  <ChartBody
                    chart={c}
                    onSelect={c.filterColumn ? (d) => ctx.onCrossFilter?.(c.filterColumn!, d.label) : undefined}
                    onInteraction={ctx.onFabricInteraction}
                    captureId={i === 0 ? DECK_CHART_CAPTURE_ID : undefined}
                  />
                </VisualFrame>
              ))}
            </div>
          ) : null}
        </QueryBoundary>
      );
    }
    case "grid":
      return (
        <QueryBoundary query={ctx.query} empty={ctx.isEmpty}>
          <LazyGrid table={ctx.table} engine={page.gridEngine} />
        </QueryBoundary>
      );
    case "pivot":
      return (
        <QueryBoundary query={ctx.query} empty={ctx.isEmpty}>
          <LazyPivot table={ctx.table} />
        </QueryBoundary>
      );
    case "catalog":
      return <LazyCatalog enabled={ctx.features} />;
    case "gallery":
      return (
        <QueryBoundary query={ctx.query} empty={ctx.isEmpty}>
          <LazyGallery table={ctx.table} valuePrefix={ctx.valuePrefix} />
        </QueryBoundary>
      );
    case "tables":
      return (
        <QueryBoundary query={ctx.query} empty={ctx.isEmpty}>
          <LazyFinanceTables
            table={ctx.table}
            valuePrefix={ctx.valuePrefix}
            classification={ctx.classification}
            onExport={ctx.onExport}
          />
        </QueryBoundary>
      );
    case "custom":
      return page.render({ table: ctx.table, query: ctx.query, period: ctx.period });
  }
}

/**
 * Turn one declarative config into a complete, standardized Fabric app component.
 * The runtime owns the chrome, nav, command palette, exports, intelligence rail,
 * data-state handling, and per-feature code-splitting — apps just declare intent.
 */
export function createFabricStandardApp(config: FabricStandardAppConfig) {
  const filename = config.appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export";

  return function FabricStandardApp() {
    const [active, setActive] = useUrlState("view", config.pages[0]?.id ?? "");
    const [filterParam, setFilterParam] = useUrlState("filters", "");
    const [periodParam, setPeriodParam] = useUrlState("period", "");
    const [deckOpen, setDeckOpen] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<number | null>(null);
    // Stable filter-option domains captured while unfiltered (see filterDefs; matters for pushdown).
    const optionDomainsRef = useRef<Record<string, string[]>>({});
    const palette = useCommandPalette();
    const filters = useMemo(() => decodeFilters(filterParam), [filterParam]);
    // DAX pushdown (A2): when `config.pushdown` maps filter columns to DAX column refs,
    // fold the active selection into the query so the semantic model filters at the source.
    // The query id changes with the selection, so useDataQuery's SWR cache re-runs it.
    // Pushed columns are then dropped from client-side filtering below.
    const pushCols = useMemo(
      () => (config.pushdown ? pushableColumns(filters, config.pushdown) : []),
      [filters],
    );
    const effectiveQuery = useMemo(
      () => (config.pushdown && pushCols.length ? pushdownQuery(config.query, filters, config.pushdown) : config.query),
      [filters, pushCols],
    );
    const q = useDataQuery(config.dataSource, effectiveQuery);
    const rawTable = q.data ?? EMPTY;

    const periodDefault = useMemo<PeriodValue>(
      () =>
        config.period
          ? {
              preset: config.period.defaultPreset ?? DEFAULT_PERIOD.preset,
              granularity: config.period.defaultGranularity ?? DEFAULT_PERIOD.granularity,
            }
          : DEFAULT_PERIOD,
      [],
    );
    const period = useMemo(() => decodePeriod(periodParam, periodDefault), [periodParam, periodDefault]);
    const setPeriod = (next: PeriodValue) => {
      const enc = encodePeriod(next);
      setPeriodParam(enc === encodePeriod(periodDefault) ? "" : enc);
    };

    const table = useMemo(() => {
      // Columns pushed down to the model are already filtered server-side — exclude them
      // client-side (a grouped-away dimension would otherwise filter to zero rows here).
      const clientFilters = pushCols.length
        ? Object.fromEntries(Object.entries(filters).filter(([k]) => !pushCols.includes(k)))
        : filters;
      const filtered = applyFilters(rawTable, clientFilters);
      return config.period?.column ? filterByPeriod(filtered, config.period.column, period) : filtered;
    }, [rawTable, filters, period, pushCols]);
    const isEmpty = !q.loading && !q.error && table.rows.length === 0;

    const setFilter = useCallback(
      (column: string, value: string) => {
        const next = { ...filters };
        if (value === "" || value == null) delete next[column];
        else next[column] = value;
        setFilterParam(encodeFilters(next));
      },
      [filters, setFilterParam],
    );
    const clearFilters = useCallback(() => setFilterParam(""), [setFilterParam]);

    // Selection ↔ filter bridge (A1). The URL-persisted filter state stays canonical;
    // `selections` is its projection into the official DataPointSelection[] the workspace
    // host speaks. A fabric visual's onInteraction and any incoming host selection both
    // fold back onto the current filters (merge; a clear resets them), so cross-filter is
    // one round-trip whether it originates from a chart click, a dropdown, or a sibling item.
    const selections = useMemo<DataPointSelection[]>(() => filtersToSelections(filters), [filters]);
    const onSelectionsChange = useCallback(
      (next: DataPointSelection[]) => {
        const event: InteractionEvent = next.length
          ? { action: "select", selections: next }
          : { action: "clear" };
        setFilterParam(encodeFilters(selectionsToFilters([event], filters)));
      },
      [filters, setFilterParam],
    );
    const onFabricInteraction = useCallback(
      (events: InteractionEvent[]) => {
        setFilterParam(encodeFilters(selectionsToFilters(events, filters)));
      },
      [filters, setFilterParam],
    );

    const filterDefs = useMemo<FilterDef[]>(() => {
      if (!config.filters?.length) return [];
      // Filter option domains come from the UNFILTERED result. Without pushdown, rawTable is
      // already unfiltered so live distincts are the full domain. WITH pushdown, rawTable is
      // server-filtered, which would collapse a column's own options — so capture each domain
      // once while nothing is pushed and reuse it, keeping every selection changeable.
      const capturing = pushCols.length === 0;
      return config.filters.map((f) => {
        const live = distinctValues(rawTable, f.column);
        if (capturing || !optionDomainsRef.current[f.column]?.length) {
          if (capturing) optionDomainsRef.current[f.column] = live;
        }
        const options = pushCols.length ? optionDomainsRef.current[f.column] ?? live : live;
        return {
          id: f.column,
          label: f.label ?? rawTable.columns.find((c) => c.key === f.column)?.label ?? f.column,
          options,
          pinned: f.pinned,
          group: f.group,
        };
      });
    }, [rawTable, pushCols]);
    const activeFilterCount = countActive(filters);

    useEffect(() => {
      if (!q.loading && !q.revalidating && q.data) setLastUpdated(Date.now());
    }, [q.loading, q.revalidating, q.data]);

    // Drop any visual drill-down selection when navigating between pages so the
    // rail never shows a stale datum from a different view.
    useEffect(() => {
      visualSelectionStore.clear();
    }, [active]);

    const page = config.pages.find((p) => p.id === active) ?? config.pages[0];
    const hasExports = config.features.includes("exports");
    const hasIntel = config.features.includes("intelligence");
    const hasPalette = config.features.includes("command-palette");

    // Per-page capability contract. Pages that render their own local dataset declare a
    // `scope` so the shell suppresses the global affordances that don't describe them —
    // dimension filters, the shell row count, the revalidation banner and the resting rail
    // insights. Everything defaults to the fully-global behaviour.
    const scope = page.scope ?? {};
    const showDimensionFilters = scope.dimensions !== "none" && filterDefs.length > 0;
    const showPeriod = scope.period !== "none" && Boolean(config.period);
    const showRowCount = scope.showRowCount !== false;
    const showRevalidation = scope.standardRefresh !== false;

    const insights = useMemo(
      () => {
        if (!hasIntel) return [];
        return config.insights ? config.insights(table) : generateInsights(table, config.insightOptions);
      },
      [hasIntel, table],
    );

    // Snapshot the active overview page's KPIs + chart for the Deck Builder, so a
    // generated deck mirrors exactly what's on screen.
    const overviewPage = page && page.kind === "overview" ? page : undefined;
    const deckKpis = useMemo<DeckKpi[]>(() => {
      if (!overviewPage) return [];
      return overviewPage.metrics(table).map((m) => {
        const ratio = m.deltaRatio;
        const up = ratio != null ? ratio >= 0 : !m.delta?.trim().startsWith("-");
        const delta = ratio != null ? `${formatSignedPercent(ratio)} YoY` : m.delta;
        return { label: m.label, value: m.value, delta, up, estimated: m.estimated };
      });
    }, [overviewPage, table]);
    const deckChart = useMemo<DeckChartSpec | undefined>(() => {
      if (!overviewPage) return undefined;
      const c = overviewPage.charts ? overviewPage.charts(table)[0] : overviewPage.chart?.(table);
      if (!c || !c.data.length) return undefined;
      return { title: c.title ?? overviewPage.label, type: c.type ?? "bar", data: c.data, valuePrefix: c.valuePrefix };
    }, [overviewPage, table]);

    const commands: Command[] = useMemo(
      () => {
        const list: Command[] = config.pages.map((p) => ({
          id: p.id,
          label: `Go to ${p.label}`,
          icon: p.icon,
          group: "Views",
          keywords: ["open", "navigate", p.kind],
          run: () => setActive(p.id),
        }));
        list.push({
          id: "__refresh",
          label: "Refresh data",
          icon: RefreshCw,
          group: "Actions",
          keywords: ["reload", "revalidate", "update"],
          run: () => q.refetch(),
        });
        list.push({
          id: "__copylink",
          label: "Copy link to this view",
          icon: Link2,
          group: "Actions",
          keywords: ["share", "url", "deep link", "permalink"],
          run: () => {
            navigator.clipboard
              .writeText(window.location.href)
              .then(() => toast("Link copied to clipboard", "success"))
              .catch(() => toast("Couldn't copy link", "error"));
          },
        });
        list.push({
          id: "__theme",
          label: "Toggle light / dark theme",
          icon: Palette,
          group: "Actions",
          keywords: ["dark", "light", "appearance", "color"],
          run: () => {
            const isDark = document.documentElement.classList.contains("dark");
            applyThemeMode(isDark ? "light" : "dark");
          },
        });
        if (hasExports) {
          list.push({
            id: "__deck",
            label: "Open deck builder",
            icon: Presentation,
            group: "Actions",
            keywords: ["powerpoint", "pptx", "slides", "presentation", "export"],
            run: () => setDeckOpen(true),
          });
        }
        if (activeFilterCount) {
          list.push({
            id: "__clearfilters",
            label: `Clear all filters (${activeFilterCount})`,
            icon: FilterX,
            group: "Actions",
            keywords: ["reset", "remove filters"],
            run: () => clearFilters(),
          });
        }
        return list;
      },
      [q, hasExports, activeFilterCount, clearFilters, setActive],
    );

    // Memoize the page subtree so unrelated app-state changes (opening the deck
    // builder, command palette, toasts, "last updated" ticks) don't recompute the
    // page's metric/chart specs or re-render the memoized leaf visuals. It only
    // rebuilds when the inputs that actually shape the page change. Combined with
    // React.memo on the leaf charts, a filter change no longer re-renders the world.
    const pageContent = useMemo(
      () =>
        page
          ? renderPage(page, {
              table,
              query: q,
              period,
              isEmpty,
              features: config.features,
              valuePrefix: config.insightOptions?.valuePrefix ?? "$",
              onCrossFilter: setFilter,
              onFabricInteraction,
              classification: config.governance?.classification,
              onExport: config.governance?.onExport,
            })
          : null,
      // `q` is captured but only its loading/error/refetch influence renderPage.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [page, table, period, isEmpty, q.loading, q.error, q.refetch, setFilter, onFabricInteraction],
    );

    if (!page) return null;

    const brandStyle = config.brand
      ? ({
          "--color-primary": config.brand.primary,
          "--color-ring": config.brand.primary,
          "--color-brand": config.brand.accent ?? config.brand.primary,
          "--color-brand-foreground": config.brand.accent ?? config.brand.primary,
        } as CSSProperties)
      : undefined;

    const brandMark = config.brand?.logoText ? (
      <span className="text-sm font-bold">{config.brand.logoText}</span>
    ) : undefined;

    const classification = config.governance?.classification;

    return (
      <SelectionProvider
        selections={selections}
        onSelectionsChange={onSelectionsChange}
        host={config.selectionHost}
      >
        <div style={brandStyle}>
        <FabricAppShell
          appName={config.appName}
          subtitle={config.subtitle}
          dataSourceLabel={config.dataSource.label}
          version={config.version}
          brandMark={brandMark}
          navItems={config.pages.map((p) => ({ id: p.id, label: p.label, icon: p.icon, group: p.group }))}
          activeNavId={active}
          onNavChange={setActive}
          helpHref={config.helpHref}
          footerLabel={config.footerLabel}
          navFilterThreshold={99}
          onNavIntent={(id) => {
            const target = config.pages.find((p) => p.id === id);
            if (target) PREFETCH[target.kind]?.();
          }}
          headerActions={
            <>
              {classification ? (
                <span className="hidden items-center gap-1 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] text-muted-foreground md:inline-flex">
                  <ShieldCheck size={12} aria-hidden="true" /> {classification}
                </span>
              ) : null}
              {hasPalette ? (
                <button
                  onClick={() => palette.setOpen(true)}
                  className="flex items-center gap-2 rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Search size={15} aria-hidden="true" />
                  <span className="hidden sm:inline">Search</span>
                  <kbd className="rounded border border-border px-1 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
                </button>
              ) : null}
              <Tooltip content={q.loading || q.revalidating ? "Refreshing data…" : lastUpdated ? `Updated ${relTime(lastUpdated)}` : "Refresh data"}>
                <button
                  onClick={() => q.refetch()}
                  disabled={q.loading || q.revalidating}
                  aria-label="Refresh data"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary/60 text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
                >
                  <RefreshCw size={15} className={q.loading || q.revalidating ? "animate-spin" : ""} aria-hidden="true" />
                </button>
              </Tooltip>
              {hasExports ? (
                <ExportMenu
                  table={table}
                  title={config.appName}
                  filename={filename}
                  classification={classification}
                  onBuildDeck={() => setDeckOpen(true)}
                  onExport={(e) => {
                    config.governance?.onExport?.(e);
                    toast(`Exported ${e.rows} rows → ${e.format.toUpperCase()}`, "success");
                  }}
                />
              ) : null}
            </>
          }
          rightRail={
            hasIntel && (insights.length || q.loading || scope.baseInsights === "off") ? (
              <VisualDrillRail
                baseInsights={scope.baseInsights === "off" ? [] : insights}
                loading={q.loading}
                restingPrompt={
                  scope.baseInsights === "off" ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <MousePointerClick size={13} className="text-primary" aria-hidden="true" /> Explore this view
                      </div>
                      <p className="text-[13px] leading-relaxed text-muted-foreground">
                        Click any KPI, statement line, bar or bridge step to open a deterministic deep-dive — its drivers,
                        variance vs plan, and how it trends.
                      </p>
                      <ul className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
                          Variance vs Budget, Prior year &amp; Forecast
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
                          Composition &amp; contribution to the total
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
                          Trend and simple anomaly flags
                        </li>
                      </ul>
                    </div>
                  ) : undefined
                }
                onAction={(action) => {
                  if (action.targetView) setActive(action.targetView);
                }}
              />
            ) : undefined
          }
        >
          {hasPalette ? (
            <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} commands={commands} />
          ) : null}
          <div className="page-enter flex flex-col gap-4">
            {showRevalidation && q.revalidating ? (
              <div
                role="status"
                className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground"
              >
                <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                Refreshing data — showing the last loaded snapshot.
              </div>
            ) : null}

            {/* Context header — one responsive strip: identity on the left, live controls on
                the right. On wide screens they share a row; controls wrap beneath on smaller
                widths. Pages that suppress the global filters show a concise scope note here
                instead, so the user always knows what does and doesn't drive the view. */}
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border/60 pb-2">
              <div className="flex min-w-0 items-baseline gap-x-3">
                <h1 className="shrink-0 text-500 font-semibold leading-tight tracking-tight">{page.label}</h1>
                {page.description ? (
                  <p className="hidden min-w-0 truncate text-200 text-muted-foreground md:block md:max-w-[42ch] lg:max-w-[68ch]">
                    {page.description}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {showDimensionFilters || showPeriod ? (
                  <FilterControls
                    filters={showDimensionFilters ? filterDefs : []}
                    value={filters}
                    onChange={setFilter}
                    onClearAll={clearFilters}
                    resultCount={showDimensionFilters ? table.rows.length : undefined}
                    totalCount={showDimensionFilters ? rawTable.rows.length : undefined}
                    periodControl={
                      showPeriod ? (
                        <PeriodControl
                          value={period}
                          onChange={setPeriod}
                          granularities={config.period!.granularities}
                          presets={config.period!.presets}
                        />
                      ) : undefined
                    }
                  />
                ) : null}
                {scope.dimensions === "none" && scope.note ? (
                  <span className="inline-flex max-w-[52ch] items-center gap-1.5 text-100 leading-snug text-muted-foreground">
                    <Info size={13} className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0">{scope.note}</span>
                  </span>
                ) : null}
                {showRowCount && !q.loading ? (
                  <span className="shrink-0 text-100 tabular-nums text-muted-foreground">
                    {table.rows.length.toLocaleString()} rows
                  </span>
                ) : null}
              </div>
            </div>

            <Suspense fallback={<LoadingState label={`Loading ${page.label}…`} />}>
              {pageContent}
            </Suspense>
          </div>
        </FabricAppShell>
        {hasExports && deckOpen ? (
          <Suspense fallback={null}>
            <LazyDeckBuilder
              open={deckOpen}
              onClose={() => setDeckOpen(false)}
              reportTitle={config.appName}
              pageLabel={page.label}
              source={config.dataSource.label}
              classification={classification}
              accent={config.brand?.primary}
              kpis={deckKpis}
              chart={deckChart}
              insights={insights}
              table={table}
              filename={filename}
              captureChartImage={() => chartCaptureRegistry.capture(DECK_CHART_CAPTURE_ID)}
              onGenerated={(slides) => {
                config.governance?.onExport?.({ format: "pptx", rows: table.rows.length, filename });
                toast(`Deck built · ${slides} slide${slides === 1 ? "" : "s"}`, "success");
              }}
            />
          </Suspense>
        ) : null}
        <Toaster />
        </div>
      </SelectionProvider>
    );
  };
}

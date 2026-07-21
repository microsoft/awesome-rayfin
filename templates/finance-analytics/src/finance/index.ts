// Shell + primitives
export { FabricAppShell } from "./fabric-app-shell";
export type { FabricAppShellProps, NavItem } from "./fabric-app-shell";
export { KpiCard } from "./kpi-card";
export type { KpiCardProps } from "./kpi-card";

// Headless UI primitives (Tooltip, Select, Portal, positioning)
export { Portal, Tooltip, CursorTooltip, Select, computePosition } from "./primitives";
export type {
  SelectOption, SelectProps, Side, Align, AnchorRect, PositionOptions, PositionResult,
} from "./primitives";

// Feature catalog
export { FEATURES, defineFabricApp, isEnabled } from "./feature-registry";
export type {
  FeatureDescriptor, FeatureCategory, FeatureStatus, PerfCost, FeatureId, FabricAppConfig, IconType,
} from "./feature-registry";
export { FeatureGallery } from "./features/feature-gallery";
export type { FeatureGalleryProps } from "./features/feature-gallery";

// Standardized features
export { ExportMenu } from "./features/export-menu";
export type { ExportMenuProps } from "./features/export-menu";
export { DataGrid } from "./features/data-grid";
export type { DataGridProps } from "./features/data-grid";
export { PivotTable } from "./features/pivot-table";
export type { PivotTableProps } from "./features/pivot-table";
export { BarChart } from "./features/bar-chart";
export type { BarChartProps, BarDatum } from "./features/bar-chart";
export { LineChart } from "./features/line-chart";
export type { LineChartProps } from "./features/line-chart";
export { DonutChart } from "./features/donut-chart";
export type { DonutChartProps } from "./features/donut-chart";
export { VarianceBar } from "./features/variance-bar";
export type { VarianceBarProps, VarianceDatum } from "./features/variance-bar";
export { MultiLineChart } from "./features/multi-line-chart";
export type { MultiLineChartProps, LineSeries, LineStyle } from "./features/multi-line-chart";
export { StackedBar } from "./features/stacked-bar";
export type { StackedBarProps, StackSeries } from "./features/stacked-bar";
export { WaterfallChart } from "./features/waterfall-chart";
export type { WaterfallChartProps, WaterfallStep, WaterfallKind } from "./features/waterfall-chart";
export { SankeyChart } from "./features/sankey-chart";
export type { SankeyChartProps, SankeyNode, SankeyLink } from "./features/sankey-chart";
export { HeatmapChart } from "./features/heatmap-chart";
export type { HeatmapChartProps } from "./features/heatmap-chart";
export { BulletChart } from "./features/bullet-chart";
export type { BulletChartProps, BulletDatum } from "./features/bullet-chart";
export { ComboChart } from "./features/combo-chart";
export type { ComboChartProps } from "./features/combo-chart";
export { TornadoChart } from "./features/tornado-chart";
export type { TornadoChartProps, TornadoDatum } from "./features/tornado-chart";
// Charts → official Vega VegaVisual spec builders. The public surface is the opt-in
// `engine="fabric"` prop on BarChart / LineChart / DonutChart; the spec builders and
// lazy VegaVisual wrapper live in the async `fabric-chart` chunk, so only their types
// are surfaced here (value re-export would pull the Vega graph onto the initial chunk).
export type {
  FabricChartVariant,
  FabricChartSpecOptions,
} from "./features/fabric-chart.specs";
export { VisualsGallery } from "./features/visuals-gallery";
export type { VisualsGalleryProps } from "./features/visuals-gallery";

// Finance data tables — condensed FP&A tables with copy-to-Excel + export
export { VarianceTable } from "./features/variance-table";
export type { VarianceTableProps } from "./features/variance-table";
export { TimeSeriesTable } from "./features/time-series-table";
export type { TimeSeriesTableProps } from "./features/time-series-table";
export { ContributionTable } from "./features/contribution-table";
export type { ContributionTableProps } from "./features/contribution-table";
export { KpiScorecardTable } from "./features/kpi-scorecard-table";
export type { KpiScorecardTableProps } from "./features/kpi-scorecard-table";
export { AgingTable } from "./features/aging-table";
export type { AgingTableProps } from "./features/aging-table";
export { FinanceTablesGallery } from "./features/finance-tables-gallery";
export type { FinanceTablesGalleryProps } from "./features/finance-tables-gallery";
// Finance tables → official DataGrid column/row builders. The public surface is the
// opt-in `engine="fabric"` prop on VarianceTable / TimeSeriesTable; the builders below
// are kept type-only at the barrel so they don't inflate the initial chunk (they live
// in the lazy finance-tables gallery graph). Import from the subpath for advanced use.
export type {
  FinanceGridModel,
  VarianceGridOptions,
  TimeSeriesGridOptions,
} from "./features/finance-grid-columns";
export { TableActions } from "./features/table-actions";
export type { TableActionsProps, TableExportFormat } from "./features/table-actions";
export {
  computeVariance, varianceToDataTable,
  computeTimeSeries, timeSeriesToDataTable,
  computeContribution, contributionToDataTable,
  computeScorecard, scorecardToDataTable,
  computeAging, agingToDataTable, agingBucketLabels, DEFAULT_AGING_BUCKETS,
} from "./lib/finance-tables";
export type {
  Favorability,
  VarianceInput, VarianceRow, VarianceDelta, VarianceTableOptions,
  TimeSeriesInput, TimeSeriesRow, TrailingWindow, TimeSeriesOptions, TimeSeriesTableOptions,
  ContributionInput, ContributionRow, ContributionOptions, ContributionTableOptions,
  ScorecardInput, ScorecardRow, ScorecardStatus, ScorecardTableOptions,
  AgingInput, AgingRow, AgingTableOptions,
} from "./lib/finance-tables";
export { copyTable, copyText, tableToTsv, tableToHtml } from "./lib/clipboard";
export { Sparkline } from "./features/sparkline";
export type { SparklineProps } from "./features/sparkline";
export { VisualFrame } from "./features/visual-frame";
export type { VisualFrameProps } from "./features/visual-frame";
export { VisualExports } from "./features/visual-exports";
export type { VisualExportsProps } from "./features/visual-exports";
export { IntelligenceRail } from "./features/intelligence-rail";
export type { IntelligenceRailProps, Insight, InsightTone, InsightAction } from "./features/intelligence-rail";
export { VisualDrillRail } from "./features/visual-drill-rail";
export type { VisualDrillRailProps } from "./features/visual-drill-rail";
export { visualSelectionStore, useVisualSelection } from "./lib/visual-selection";
export type { VisualSelection } from "./lib/visual-selection";
export { CommandPalette } from "./features/command-palette";
export type { CommandPaletteProps, Command } from "./features/command-palette";
export { FilterBar } from "./features/filter-bar";
export type { FilterBarProps, FilterDef } from "./features/filter-bar";
export { FilterControls } from "./features/filter-controls";
export type { FilterControlsProps } from "./features/filter-controls";
export { PeriodControl } from "./features/period-control";
export type { PeriodControlProps } from "./features/period-control";
export { WhatIfPanel } from "./features/whatif-panel";
export type { WhatIfPanelProps, WhatIfDriver } from "./features/whatif-panel";
export { useCommandPalette } from "./hooks/use-command-palette";
export { useFocusTrap } from "./hooks/use-focus-trap";
export { useUrlState } from "./hooks/use-url-state";

// Data layer — object-row DataTable that every feature consumes
export type { DataSource, DataQuery } from "./data/data-source";
export { staticDataSource, fetchQueries } from "./data/data-source";
// Fabric-native live path: bridge the Rayfin SDK's positional QueryTable → DataTable
export { fabricDataSource, fabricQueryToDataTable } from "./data/fabric-data-source";
export type {
  FabricDataSourceOptions,
  FabricColumnMeta,
  FabricColumnMetaMap,
  FabricQueryTable,
  FabricQueryColumn,
  FabricQueryResult,
  FabricClientLike,
  FabricSemanticModel,
} from "./data/fabric-data-source";
// Fabric interop seam — lossless converters to/from the official (positional) Fabric
// Analytics DataTable consumed by VegaVisual + @microsoft/fabric-datagrid.
export { fromFabricTable, toFabricTable, fabricQueryToFabricTable } from "./data/fabric-interop";
export type {
  FabricDataTable,
  FabricColumnDef,
  DataPointSelection,
  DataPointPredicate,
  SetPredicate,
  RangePredicate,
  InteractionEvent,
  SelectInteractionEvent,
  ClearInteractionEvent,
  InteractionEventCallback,
  VisualTheme,
} from "./data/fabric-interop";
// Interaction adapter — fold official onInteraction events into our canonical filters.
export {
  filtersToSelections,
  selectionsToFilters,
  selectionsMatch,
  applySelections,
  eventToSelections,
  eventsToSelections,
  selectionListsMatch,
} from "./lib/interaction";
// Selection bus (A1) — cross-visual + cross-item host round-trip for DataPointSelection.
export { createLocalSelectionBus, localSelectionBus } from "./lib/selection-bus";
export type { SelectionHost } from "./lib/selection-bus";
export { SelectionProvider, useSelection } from "./hooks/use-selection";
export type { SelectionContextValue, SelectionProviderProps } from "./hooks/use-selection";
// DAX selection pushdown (A2) — fold active filters into the query so the model filters at source.
export {
  pushdownQuery,
  pushableColumns,
  filtersToDaxFilters,
  daxColumnFilter,
  daxLiteral,
  escapeDaxString,
  wrapEvaluateWithFilters,
} from "./lib/dax-pushdown";
export type { DaxColumnMap, DaxColumnRef } from "./lib/dax-pushdown";
export {
  composeEvaluate,
  composeQuery,
  composerSignature,
  composeColumnMeta,
  scaffoldOverviewSpec,
} from "./lib/dax-composer";
export type {
  DaxDimension,
  DaxMeasure,
  DaxComposerFilter,
  DaxOrderBy,
  DaxComposerSpec,
  ModelMeasure,
  ModelDimension,
  ModelSchema,
  ScaffoldOptions,
} from "./lib/dax-composer";
export { useDataQuery } from "./data/use-data-query";
export type { UseDataQueryResult, UseDataQueryOptions } from "./data/use-data-query";
export { QueryCache, InFlightRegistry } from "./data/query-cache";
export type { QueryCacheOptions } from "./data/query-cache";
export { Skeleton, LoadingState, ErrorState, EmptyState, QueryBoundary, BarChartSkeleton, LineChartSkeleton, DonutChartSkeleton } from "./components/states";
export type { QueryBoundaryProps } from "./components/states";
export { AnimatedNumber } from "./components/animated-number";
export type { AnimatedNumberProps } from "./components/animated-number";

// Config-driven runtime — declare a config, get a complete standardized app
export { createFabricStandardApp } from "./app/fabric-standard-app";
export type {
  FabricStandardAppConfig, PageDef, PageContext, MetricFn, ChartFn, ChartSpec,
  BrandConfig, GovernanceConfig, FilterColumnDef, PeriodConfig,
} from "./app/page-types";

// Intelligence — deterministic, source-cited insight generation (no LLM required)
export { generateInsights } from "./lib/insights";
export type { InsightOptions } from "./lib/insights";
export { overviewInsights } from "./lib/overview-insights";
export { concentration } from "./lib/concentration";
export type { Concentration, RankedShare } from "./lib/concentration";
export { forecastAccuracy, confidenceBand } from "./lib/forecast";
export type { ForecastAccuracy, Band } from "./lib/forecast";
export {
  explain, narrate, growthDeltas, trendStrength, streaks, robustAnomaly,
  levelShift, percentileRank, contribution, variance, paceToGoal,
  scorecard, resolveDirection,
} from "./lib/insights-kernel";
export type { ExplainInput, ExplainSection, ExplainFact, FactTone, Scorecard, Directionality } from "./lib/insights-kernel";
export { ExplainPanel } from "./features/explain-panel";
export type { ExplainPanelProps } from "./features/explain-panel";
export { applyFilters, distinctValues, encodeFilters, decodeFilters, countActive } from "./lib/filters";
export type { FilterState } from "./lib/filters";
export {
  PERIOD_PRESETS,
  GRANULARITIES,
  DEFAULT_PERIOD,
  resolvePeriodRange,
  filterByPeriod,
  periodSummary,
  encodePeriod,
  decodePeriod,
} from "./lib/period";
export type { Granularity, PeriodPresetId, PeriodValue } from "./lib/period";

// Notifications
export { Toaster } from "./features/toaster";
export { toast, useToasts, dismissToast } from "./lib/toast";
export type { ToastItem, ToastTone } from "./lib/toast";

// PowerPoint deck builder — branded, multi-slide decks with native editable charts
export { DeckBuilder } from "./features/deck-builder";
export type { DeckBuilderProps } from "./features/deck-builder";
export { buildDeck } from "./lib/deck";
export type { DeckSpec, DeckSections, DeckKpi, DeckChartSpec, DeckInsight, DeckTheme } from "./lib/deck";
export { DECK_TEMPLATES, estimateDeckSlides } from "./lib/deck-templates";
export type { DeckTemplate } from "./lib/deck-templates";

// Chart image capture — snapshot a live Fabric (Vega) visual into a deck slide.
export { captureImage, chartCaptureRegistry } from "./lib/chart-capture";
export type { CaptureView, CaptureOptions, ViewGetter } from "./lib/chart-capture";

// Data utilities
export { exportCsv, exportExcel, exportPptx } from "./lib/export";
export { buildXlsx } from "./lib/xlsx";
export type { SheetInput } from "./lib/xlsx";
export { MICROCOPY } from "./lib/microcopy";
export type { MicrocopyKey } from "./lib/microcopy";
export { InfoHint } from "./components/info-hint";
export type { InfoHintProps } from "./components/info-hint";
export {
  applyThemeMode,
  readThemeMode,
  resolveDark,
  watchSystemTheme,
  THEME_INIT_SNIPPET,
  THEME_STORAGE_KEY,
} from "./lib/theme";
export type { ThemeMode } from "./lib/theme";
// Visual theme bridge — feed the app's own palette to the official Fabric visuals.
export { useVisualTheme, readVisualTheme, visualThemeChanged, CSS_VAR_BY_THEME_KEY } from "./lib/visual-theme";
export {
  applyDensity,
  readDensity,
  DENSITY_INIT_SNIPPET,
  DENSITY_STORAGE_KEY,
} from "./lib/density";
export type { Density } from "./lib/density";
export { focusRing, surface, btn, field, chip } from "./lib/recipes";
export type { Elevation, ButtonVariant, ButtonSize } from "./lib/recipes";
export { pivot, buildPivot, measureLabel } from "./lib/pivot";
export type {
  PivotConfig, PivotResult, Aggregation,
  PivotBuilderConfig, PivotBuilderResult, PivotMeasure, PivotNode,
} from "./lib/pivot";
export { formatNumber, formatCompact, formatSignedCompact, formatSignedPercent } from "./lib/format";
export { formatCell } from "./lib/format-string";
export { numericColumns, categoryColumns } from "./lib/types";
export type { DataTable, Column, CellValue } from "./lib/types";

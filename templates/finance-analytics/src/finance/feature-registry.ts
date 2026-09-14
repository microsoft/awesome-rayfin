import type { ComponentType } from "react";
import {
  Palette, Download, Table2, ListTree, BarChart3, Sparkles, Command, SlidersHorizontal, LayoutGrid, Bell, ShieldCheck, Sheet,
} from "lucide-react";

export type IconType = ComponentType<{ size?: number; className?: string }>;
export type FeatureCategory = "Visualization" | "Export" | "Intelligence" | "Interaction" | "Data";
export type FeatureStatus = "stable" | "preview";
/** minimal = always loaded chrome; light = small client cost; lazy-heavy = code-split, loads on use. */
export type PerfCost = "minimal" | "light" | "lazy-heavy";

export interface FeatureDescriptor {
  id: string;
  name: string;
  description: string;
  category: FeatureCategory;
  status: FeatureStatus;
  perfCost: PerfCost;
  icon: IconType;
  docs?: string;
}

/** THE CATALOG — single source of truth for the gallery UI and enablement.
 *  `as const satisfies` keeps each `id` a string LITERAL so `FeatureId` is a strict
 *  union (typos in a consumer's `features` array fail to compile) while still
 *  validating every entry against `FeatureDescriptor`.
 *  Add a feature here and it appears in the gallery automatically. */
export const FEATURES = [
  { id: "theming", name: "Theming (Dark / Light)", description: "Standardized org palette with one-click dark/light switch. Built into the shell.", category: "Visualization", status: "stable", perfCost: "minimal", icon: Palette },
  { id: "kpi-cards", name: "KPI Cards", description: "Consistent headline-metric cards with deltas and trend coloring.", category: "Visualization", status: "stable", perfCost: "minimal", icon: LayoutGrid },
  { id: "charts", name: "Chart Kit", description: "Dependency-free SVG chart family — bar, area/line, and donut. Matches the org palette, zero chart-library weight.", category: "Visualization", status: "stable", perfCost: "light", icon: BarChart3 },
  { id: "exports", name: "Exports", description: "CSV, Excel, and PowerPoint deck builder. PowerPoint lazy-loads only when used.", category: "Export", status: "stable", perfCost: "lazy-heavy", icon: Download },
  { id: "data-grid", name: "Data Grid", description: "Sortable, standardized table for detail views.", category: "Data", status: "stable", perfCost: "light", icon: Table2 },
  { id: "pivot", name: "Pivot", description: "Interactive client-side pivot with row/column dims and aggregations.", category: "Data", status: "stable", perfCost: "light", icon: ListTree },
  { id: "finance-tables", name: "Finance Tables", description: "Condensed FP&A tables — variance (VTF/VTB/VTPY), time-series with trailing windows, aging schedule, contribution/Pareto and KPI scorecard. One-click copy-to-Excel plus CSV/Excel/PowerPoint from every table.", category: "Data", status: "stable", perfCost: "lazy-heavy", icon: Sheet },
  { id: "intelligence", name: "Intelligence Rail", description: "Right-pane insights surface for model-derived narratives and Q&A.", category: "Intelligence", status: "preview", perfCost: "light", icon: Sparkles },
  { id: "command-palette", name: "Command Palette", description: "Ctrl/⌘+K quick navigation and actions across the app.", category: "Interaction", status: "stable", perfCost: "minimal", icon: Command },
  { id: "notifications", name: "Toasts", description: "Standardized non-blocking notifications (export complete, refresh, errors).", category: "Interaction", status: "stable", perfCost: "minimal", icon: Bell },
  { id: "governance", name: "Export Governance", description: "Sensitivity-label stamping on exports plus an audit hook for telemetry.", category: "Export", status: "stable", perfCost: "minimal", icon: ShieldCheck },
  { id: "filter-bar", name: "Filter Bar", description: "Standardized controlled filters with a consistent look.", category: "Interaction", status: "stable", perfCost: "minimal", icon: SlidersHorizontal },
] as const satisfies readonly FeatureDescriptor[];

export type FeatureId = (typeof FEATURES)[number]["id"];

export interface FabricAppConfig {
  appName: string;
  subtitle?: string;
  dataSourceLabel?: string;
  version?: string;
  /** Opt in to standardized features from the catalog. Only enabled features ship. */
  features: FeatureId[];
}

/** Declarative app definition. Point at your model, pick features, done. */
export function defineFabricApp(config: FabricAppConfig): FabricAppConfig {
  return config;
}

export function isEnabled(config: FabricAppConfig, id: FeatureId): boolean {
  return config.features.includes(id);
}

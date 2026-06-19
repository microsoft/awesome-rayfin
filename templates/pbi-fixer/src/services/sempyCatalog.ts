// WS-P — Sempy Runner catalog.
//
// Hand-curated subset of semantic-link / semantic-link-labs functions
// most useful for PBI / model administration. Each entry drives the
// Sempy Runner builder: typed params (workspace / report / dataset /
// lakehouse) auto-bind from the connection bar, the rest render as
// generic inputs. Functions whose params don't fit at all still work
// — every param shows up as a free-text input.
//
// Catalog grows over time; safe to extend without touching the page.

export type SempyParamKind =
  | "workspace"
  | "report"
  | "dataset"
  | "lakehouse"
  | "text"
  | "multiline"
  | "bool"
  | "number";

export interface SempyParam {
  name: string;
  kind: SempyParamKind;
  required?: boolean;
  default?: string | number | boolean;
  /** Short helper text shown below the input. */
  hint?: string;
}

export type SempyCategory =
  | "Workspace"
  | "Capacity"
  | "Model"
  | "Report"
  | "Refresh"
  | "Vertipaq"
  | "Lakehouse"
  | "DirectLake"
  | "Git"
  | "Notebook"
  | "Deployment"
  | "Admin"
  | "Misc";

export interface SempyFunction {
  id: string;
  /** Module to import — `sempy_labs` or `sempy.fabric`. */
  module: "sempy_labs" | "sempy.fabric" | "sempy_labs.report" | "sempy_labs.lakehouse" | "sempy_labs.tom" | "sempy_labs.directlake" | "sempy_labs.admin" | "sempy_labs.migration";
  /** Alias used in the generated code (e.g. `labs`, `fabric`). */
  alias: string;
  name: string;
  description: string;
  category: SempyCategory;
  /** Optional finer grouping inside a category (drives 2nd dropdown). */
  subcategory?: string;
  params: SempyParam[];
  returnsDataFrame: boolean;
  docUrl?: string;
}

export const SEMPY_CATALOG: SempyFunction[] = [
  // ── Workspace ──────────────────────────────────────────────────
  {
    id: "list_workspaces",
    module: "sempy.fabric",
    alias: "fabric",
    name: "list_workspaces",
    description: "List all Fabric workspaces the user can access.",
    category: "Workspace",
    subcategory: "Listing",
    params: [],
    returnsDataFrame: true,
    docUrl: "https://learn.microsoft.com/python/api/semantic-link-sempy/sempy.fabric",
  },
  {
    id: "list_items",
    module: "sempy.fabric",
    alias: "fabric",
    name: "list_items",
    description: "List all items in a workspace (reports, semantic models, lakehouses, …).",
    category: "Workspace",
    subcategory: "Listing",
    params: [
      { name: "workspace", kind: "workspace", required: false },
      { name: "type", kind: "text", required: false, hint: "Optional filter, e.g. \"Report\" or \"SemanticModel\"." },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_reports",
    module: "sempy.fabric",
    alias: "fabric",
    name: "list_reports",
    description: "List all Power BI reports in a workspace.",
    category: "Workspace",
    subcategory: "Listing",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },
  {
    id: "list_datasets",
    module: "sempy.fabric",
    alias: "fabric",
    name: "list_datasets",
    description: "List all semantic models in a workspace.",
    category: "Workspace",
    subcategory: "Listing",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },
  {
    id: "list_capacities",
    module: "sempy_labs",
    alias: "labs",
    name: "list_capacities",
    description: "List all Fabric capacities in the tenant.",
    category: "Capacity",
    subcategory: "Listing",
    params: [],
    returnsDataFrame: true,
  },
  {
    id: "list_dashboards",
    module: "sempy.fabric",
    alias: "fabric",
    name: "list_dashboards",
    description: "List Power BI dashboards in a workspace.",
    category: "Workspace",
    subcategory: "Listing",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },

  // ── Model (semantic) ───────────────────────────────────────────
  {
    id: "list_tables",
    module: "sempy.fabric",
    alias: "fabric",
    name: "list_tables",
    description: "List tables in a semantic model.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_columns",
    module: "sempy.fabric",
    alias: "fabric",
    name: "list_columns",
    description: "List columns in a semantic model.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_measures",
    module: "sempy.fabric",
    alias: "fabric",
    name: "list_measures",
    description: "List measures (with DAX) in a semantic model.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_relationships",
    module: "sempy.fabric",
    alias: "fabric",
    name: "list_relationships",
    description: "List relationships in a semantic model.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_calculation_groups",
    module: "sempy_labs",
    alias: "labs",
    name: "list_calculation_groups",
    description: "List calculation groups defined on a semantic model.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_translations",
    module: "sempy_labs",
    alias: "labs",
    name: "list_translations",
    description: "List culture translations on a semantic model.",
    category: "Model",
    subcategory: "Translations",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_perspectives",
    module: "sempy_labs",
    alias: "labs",
    name: "list_perspectives",
    description: "List perspectives on a semantic model.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "evaluate_dax",
    module: "sempy.fabric",
    alias: "fabric",
    name: "evaluate_dax",
    description: "Run a DAX query against a semantic model and return rows as a DataFrame.",
    category: "Model",
    subcategory: "DAX",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "dax_string", kind: "multiline", required: true, hint: "Full DAX, e.g. EVALUATE INFO.MEASURES()" },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "run_model_bpa",
    module: "sempy_labs",
    alias: "labs",
    name: "run_model_bpa",
    description: "Run Best Practice Analyzer on a semantic model.",
    category: "Model",
    subcategory: "BPA",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
      { name: "extended", kind: "bool", required: false, default: false, hint: "Include vertipaq metrics in evaluation." },
    ],
    returnsDataFrame: true,
  },
  {
    id: "deploy_semantic_model",
    module: "sempy_labs",
    alias: "labs",
    name: "deploy_semantic_model",
    description: "Deploy a semantic model to a target workspace.",
    category: "Model",
    subcategory: "Deployment",
    params: [
      { name: "source_dataset", kind: "dataset", required: true },
      { name: "source_workspace", kind: "workspace", required: false },
      { name: "target_dataset", kind: "text", required: true },
      { name: "target_workspace", kind: "text", required: false },
      { name: "refresh_target_dataset", kind: "bool", required: false, default: true },
    ],
    returnsDataFrame: false,
  },

  // ── Report ─────────────────────────────────────────────────────
  {
    id: "list_report_pages",
    module: "sempy_labs",
    alias: "labs",
    name: "list_report_pages",
    description: "List pages defined in a Power BI report (PBIR).",
    category: "Report",
    subcategory: "Inventory",
    params: [
      { name: "report", kind: "report", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_report_visuals",
    module: "sempy_labs",
    alias: "labs",
    name: "list_report_visuals",
    description: "List all visuals in a Power BI report with page/position/type.",
    category: "Report",
    subcategory: "Inventory",
    params: [
      { name: "report", kind: "report", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "report_rebind",
    module: "sempy_labs",
    alias: "labs",
    name: "report_rebind",
    description: "Rebind a report to a different semantic model.",
    category: "Report",
    subcategory: "Operations",
    params: [
      { name: "report", kind: "report", required: true },
      { name: "dataset", kind: "dataset", required: true, hint: "Target semantic model name." },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "export_report",
    module: "sempy_labs",
    alias: "labs",
    name: "export_report",
    description: "Export a report (PNG / PDF / PPTX / …) via the Power BI Export API.",
    category: "Report",
    subcategory: "Operations",
    params: [
      { name: "report", kind: "report", required: true },
      { name: "export_format", kind: "text", required: true, default: "PNG", hint: "PNG | PDF | PPTX | DOCX | …" },
      { name: "file_name", kind: "text", required: false },
      { name: "page_name", kind: "text", required: false, hint: "Optional single page to export." },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "clone_report",
    module: "sempy_labs",
    alias: "labs",
    name: "clone_report",
    description: "Clone a report into a new report (same workspace by default).",
    category: "Report",
    subcategory: "Operations",
    params: [
      { name: "report", kind: "report", required: true },
      { name: "cloned_report", kind: "text", required: true, hint: "Name of the new report." },
      { name: "workspace", kind: "workspace", required: false },
      { name: "target_workspace", kind: "text", required: false },
      { name: "target_dataset", kind: "text", required: false },
    ],
    returnsDataFrame: false,
  },

  // ── Refresh ────────────────────────────────────────────────────
  {
    id: "refresh_semantic_model",
    module: "sempy_labs",
    alias: "labs",
    name: "refresh_semantic_model",
    description: "Trigger a refresh of a semantic model (with optional refresh_type).",
    category: "Refresh",
    subcategory: "Trigger",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
      { name: "refresh_type", kind: "text", required: false, default: "full", hint: "full | clearValues | calculate | dataOnly | …" },
    ],
    returnsDataFrame: false,
  },
  {
    id: "list_refresh_history",
    module: "sempy_labs",
    alias: "labs",
    name: "get_semantic_model_refresh_history",
    description: "Get the refresh history of a semantic model.",
    category: "Refresh",
    subcategory: "History",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "cancel_dataset_refresh",
    module: "sempy_labs",
    alias: "labs",
    name: "cancel_dataset_refresh",
    description: "Cancel an in-progress semantic model refresh.",
    category: "Refresh",
    subcategory: "Trigger",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
      { name: "request_id", kind: "text", required: false },
    ],
    returnsDataFrame: false,
  },

  // ── Vertipaq / Performance ─────────────────────────────────────
  {
    id: "vertipaq_analyzer",
    module: "sempy_labs",
    alias: "labs",
    name: "vertipaq_analyzer",
    description: "Run Vertipaq Analyzer and return per-table / per-column storage metrics.",
    category: "Vertipaq",
    subcategory: "Metrics",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
      { name: "export", kind: "text", required: false, hint: "zip | table | …" },
    ],
    returnsDataFrame: true,
  },
  {
    id: "get_semantic_model_size",
    module: "sempy_labs",
    alias: "labs",
    name: "get_semantic_model_size",
    description: "Return the total in-memory size of a semantic model.",
    category: "Vertipaq",
    subcategory: "Metrics",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "model_calc_dependencies",
    module: "sempy_labs",
    alias: "labs",
    name: "get_model_calc_dependencies",
    description: "Show DAX calculation dependencies between measures / columns.",
    category: "Vertipaq",
    subcategory: "Dependencies",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },

  // ── Lakehouse ──────────────────────────────────────────────────
  {
    id: "list_lakehouses",
    module: "sempy_labs",
    alias: "labs",
    name: "list_lakehouses",
    description: "List lakehouses in a workspace.",
    category: "Lakehouse",
    subcategory: "Listing",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },
  {
    id: "get_lakehouse_tables",
    module: "sempy_labs",
    alias: "labs",
    name: "get_lakehouse_tables",
    description: "List Delta tables inside a lakehouse with size / row count.",
    category: "Lakehouse",
    subcategory: "Listing",
    params: [
      { name: "lakehouse", kind: "lakehouse", required: false },
      { name: "workspace", kind: "workspace", required: false },
      { name: "extended", kind: "bool", required: false, default: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_warehouses",
    module: "sempy_labs",
    alias: "labs",
    name: "list_warehouses",
    description: "List warehouses in a workspace.",
    category: "Lakehouse",
    subcategory: "Listing",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },

  // ── Misc / utility ─────────────────────────────────────────────
  {
    id: "list_apps",
    module: "sempy_labs",
    alias: "labs",
    name: "list_apps",
    description: "List Power BI apps in the tenant.",
    category: "Misc",
    subcategory: "Apps",
    params: [],
    returnsDataFrame: true,
  },
  {
    id: "list_dataflows",
    module: "sempy_labs",
    alias: "labs",
    name: "list_dataflows",
    description: "List dataflows in a workspace.",
    category: "Misc",
    subcategory: "Dataflows",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },
  {
    id: "list_pipelines",
    module: "sempy_labs",
    alias: "labs",
    name: "list_data_pipelines",
    description: "List data pipelines in a workspace.",
    category: "Misc",
    subcategory: "Pipelines",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },

  // ── v0.117 — expanded coverage ────────────────────────────────

  // Workspace · Lifecycle
  {
    id: "create_workspace",
    module: "sempy_labs",
    alias: "labs",
    name: "create_workspace",
    description: "Create a new Fabric workspace.",
    category: "Workspace",
    subcategory: "Lifecycle",
    params: [
      { name: "workspace", kind: "text", required: true, hint: "Name of the new workspace." },
      { name: "capacity", kind: "text", required: false, hint: "Capacity name or id to assign." },
      { name: "description", kind: "text", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "delete_workspace",
    module: "sempy_labs",
    alias: "labs",
    name: "delete_workspace",
    description: "Delete a Fabric workspace.",
    category: "Workspace",
    subcategory: "Lifecycle",
    params: [{ name: "workspace", kind: "workspace", required: true }],
    returnsDataFrame: false,
  },
  {
    id: "update_workspace",
    module: "sempy_labs",
    alias: "labs",
    name: "update_workspace",
    description: "Update workspace name / description.",
    category: "Workspace",
    subcategory: "Lifecycle",
    params: [
      { name: "workspace", kind: "workspace", required: true },
      { name: "name", kind: "text", required: false },
      { name: "description", kind: "text", required: false },
    ],
    returnsDataFrame: false,
  },

  // Workspace · Capacity binding
  {
    id: "assign_workspace_to_capacity",
    module: "sempy_labs",
    alias: "labs",
    name: "assign_workspace_to_capacity",
    description: "Assign a workspace to a Fabric capacity.",
    category: "Workspace",
    subcategory: "Capacity binding",
    params: [
      { name: "capacity", kind: "text", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "unassign_workspace_from_capacity",
    module: "sempy_labs",
    alias: "labs",
    name: "unassign_workspace_from_capacity",
    description: "Remove a workspace from its capacity (back to shared).",
    category: "Workspace",
    subcategory: "Capacity binding",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: false,
  },

  // Workspace · Access
  {
    id: "list_workspace_users",
    module: "sempy_labs",
    alias: "labs",
    name: "list_workspace_users",
    description: "List users / groups with access to a workspace.",
    category: "Workspace",
    subcategory: "Access",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },
  {
    id: "add_user_to_workspace",
    module: "sempy_labs",
    alias: "labs",
    name: "add_user_to_workspace",
    description: "Add a user / group to a workspace with a role.",
    category: "Workspace",
    subcategory: "Access",
    params: [
      { name: "email_address", kind: "text", required: true },
      { name: "role_name", kind: "text", required: true, hint: "Admin | Member | Contributor | Viewer" },
      { name: "principal_type", kind: "text", required: false, default: "User", hint: "User | Group | App" },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "delete_user_from_workspace",
    module: "sempy_labs",
    alias: "labs",
    name: "delete_user_from_workspace",
    description: "Remove a user from a workspace.",
    category: "Workspace",
    subcategory: "Access",
    params: [
      { name: "email_address", kind: "text", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "list_workspace_role_assignments",
    module: "sempy_labs",
    alias: "labs",
    name: "list_workspace_role_assignments",
    description: "List role assignments on a workspace.",
    category: "Workspace",
    subcategory: "Access",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },

  // Capacity
  {
    id: "list_capacity_users",
    module: "sempy_labs",
    alias: "labs",
    name: "list_capacity_users",
    description: "List capacity admins / contributors.",
    category: "Capacity",
    subcategory: "Access",
    params: [{ name: "capacity", kind: "text", required: true }],
    returnsDataFrame: true,
  },
  {
    id: "list_skus",
    module: "sempy_labs",
    alias: "labs",
    name: "list_skus",
    description: "List available Fabric SKUs.",
    category: "Capacity",
    subcategory: "Listing",
    params: [],
    returnsDataFrame: true,
  },

  // Model · Inventory (extra)
  {
    id: "list_partitions",
    module: "sempy.fabric",
    alias: "fabric",
    name: "list_partitions",
    description: "List partitions of every table in a semantic model.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_hierarchies",
    module: "sempy.fabric",
    alias: "fabric",
    name: "list_hierarchies",
    description: "List hierarchies in a semantic model.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_kpis",
    module: "sempy_labs",
    alias: "labs",
    name: "list_kpis",
    description: "List KPI measures in a semantic model.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_aggregations",
    module: "sempy_labs",
    alias: "labs",
    name: "list_aggregations",
    description: "List user-defined aggregations on a semantic model.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_calculation_items",
    module: "sempy_labs",
    alias: "labs",
    name: "list_calculation_items",
    description: "List calculation items in a calculation group.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_semantic_model_objects",
    module: "sempy_labs",
    alias: "labs",
    name: "list_semantic_model_objects",
    description: "List every TOM object (tables, columns, measures, …) in a semantic model.",
    category: "Model",
    subcategory: "Inventory",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },

  // Model · DAX (extra)
  {
    id: "evaluate_dax_impersonation",
    module: "sempy_labs",
    alias: "labs",
    name: "evaluate_dax_impersonation",
    description: "Run DAX as another user (RLS impersonation).",
    category: "Model",
    subcategory: "DAX",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "dax_query", kind: "multiline", required: true },
      { name: "user_name", kind: "text", required: false, hint: "EffectiveUserName for RLS." },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "format_dax",
    module: "sempy_labs",
    alias: "labs",
    name: "format_dax",
    description: "Format DAX expressions in a semantic model using DaxFormatter.",
    category: "Model",
    subcategory: "DAX",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "get_measure_dependencies",
    module: "sempy_labs",
    alias: "labs",
    name: "get_measure_dependencies",
    description: "Get upstream dependencies for a single measure.",
    category: "Model",
    subcategory: "DAX",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "measure_name", kind: "text", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },

  // Model · BPA (extra)
  {
    id: "run_model_bpa_bulk",
    module: "sempy_labs",
    alias: "labs",
    name: "run_model_bpa_bulk",
    description: "Run Best Practice Analyzer across every semantic model in a workspace.",
    category: "Model",
    subcategory: "BPA",
    params: [
      { name: "workspace", kind: "workspace", required: false },
      { name: "extended", kind: "bool", required: false, default: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "model_bpa_rules",
    module: "sempy_labs",
    alias: "labs",
    name: "model_bpa_rules",
    description: "Return the active Best Practice Analyzer ruleset.",
    category: "Model",
    subcategory: "BPA",
    params: [],
    returnsDataFrame: true,
  },
  {
    id: "create_model_bpa_semantic_model",
    module: "sempy_labs",
    alias: "labs",
    name: "create_model_bpa_semantic_model",
    description: "Create the Model BPA semantic model in a workspace (for Power BI dashboarding).",
    category: "Model",
    subcategory: "BPA",
    params: [
      { name: "dataset", kind: "text", required: false, default: "ModelBPA", hint: "Name of the model to create / update." },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },

  // Model · Translations
  {
    id: "translate_semantic_model",
    module: "sempy_labs",
    alias: "labs",
    name: "translate_semantic_model",
    description: "Auto-translate captions / descriptions of a semantic model into target cultures (Azure AI Translator).",
    category: "Model",
    subcategory: "Translations",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "languages", kind: "text", required: true, hint: 'Comma-separated culture codes, e.g. "de-DE,fr-FR".' },
      { name: "exclude_characters", kind: "text", required: false, hint: "Characters to ignore when translating." },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
    docUrl: "https://semantic-link-labs.readthedocs.io/en/stable/sempy_labs.html#sempy_labs.translate_semantic_model",
  },

  // Model · Security
  {
    id: "list_roles",
    module: "sempy_labs",
    alias: "labs",
    name: "list_roles",
    description: "List security roles defined on a semantic model.",
    category: "Model",
    subcategory: "Security",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_row_level_security_permissions",
    module: "sempy_labs",
    alias: "labs",
    name: "list_row_level_security_permissions",
    description: "List RLS filter expressions on a semantic model.",
    category: "Model",
    subcategory: "Security",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_object_level_security",
    module: "sempy_labs",
    alias: "labs",
    name: "list_object_level_security",
    description: "List OLS rules (column / table) on a semantic model.",
    category: "Model",
    subcategory: "Security",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },

  // Model · Backup
  {
    id: "backup_semantic_model",
    module: "sempy_labs",
    alias: "labs",
    name: "backup_semantic_model",
    description: "Back up a semantic model to ADLS Gen2.",
    category: "Model",
    subcategory: "Backup",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "file_path", kind: "text", required: true, hint: "ADLS path inside the linked storage." },
      { name: "allow_overwrite", kind: "bool", required: false, default: true },
      { name: "apply_compression", kind: "bool", required: false, default: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "restore_semantic_model",
    module: "sempy_labs",
    alias: "labs",
    name: "restore_semantic_model",
    description: "Restore a semantic model from a previous backup.",
    category: "Model",
    subcategory: "Backup",
    params: [
      { name: "dataset", kind: "text", required: true, hint: "Target model name." },
      { name: "file_path", kind: "text", required: true },
      { name: "allow_overwrite", kind: "bool", required: false, default: false },
      { name: "ignore_incompatibilities", kind: "bool", required: false, default: true },
      { name: "force_restore", kind: "bool", required: false, default: false },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },

  // Model · Definition
  {
    id: "get_semantic_model_bim",
    module: "sempy_labs",
    alias: "labs",
    name: "get_semantic_model_bim",
    description: "Return the model.bim of a semantic model (optionally save to lakehouse).",
    category: "Model",
    subcategory: "Definition",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
      { name: "save_to_file_name", kind: "text", required: false },
      { name: "lakehouse_workspace", kind: "text", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "create_semantic_model_from_bim",
    module: "sempy_labs",
    alias: "labs",
    name: "create_semantic_model_from_bim",
    description: "Create a semantic model from a model.bim payload.",
    category: "Model",
    subcategory: "Definition",
    params: [
      { name: "dataset", kind: "text", required: true, hint: "Name of the new model." },
      { name: "bim_file", kind: "multiline", required: true, hint: "model.bim JSON or path." },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "update_semantic_model_from_bim",
    module: "sempy_labs",
    alias: "labs",
    name: "update_semantic_model_from_bim",
    description: "Update an existing semantic model from a model.bim payload.",
    category: "Model",
    subcategory: "Definition",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "bim_file", kind: "multiline", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },

  // Refresh · Schedule
  {
    id: "get_semantic_model_refresh_schedule",
    module: "sempy_labs",
    alias: "labs",
    name: "get_semantic_model_refresh_schedule",
    description: "Get the scheduled refresh configuration of a semantic model.",
    category: "Refresh",
    subcategory: "Schedule",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "enable_qso",
    module: "sempy_labs",
    alias: "labs",
    name: "set_qso",
    description: "Enable / configure Query Scale-Out on a semantic model.",
    category: "Refresh",
    subcategory: "Schedule",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "auto_sync", kind: "bool", required: false, default: true },
      { name: "max_read_only_replicas", kind: "number", required: false, default: -1 },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },

  // Vertipaq · Metrics (extra)
  {
    id: "import_vertipaq_analyzer",
    module: "sempy_labs",
    alias: "labs",
    name: "import_vertipaq_analyzer",
    description: "Load a previously saved Vertipaq Analyzer .vpax file.",
    category: "Vertipaq",
    subcategory: "Metrics",
    params: [
      { name: "folder_path", kind: "text", required: true },
      { name: "file_name", kind: "text", required: true },
    ],
    returnsDataFrame: true,
  },
  {
    id: "vertipaq_analyzer_html",
    module: "sempy_labs",
    alias: "labs",
    name: "vertipaq_analyzer",
    description: "Render Vertipaq Analyzer report as HTML in the notebook.",
    category: "Vertipaq",
    subcategory: "Metrics",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
      { name: "export", kind: "text", required: false, default: "table" },
    ],
    returnsDataFrame: false,
  },

  // Report · Definition
  {
    id: "get_report_json",
    module: "sempy_labs",
    alias: "labs",
    name: "get_report_json",
    description: "Return the report.json definition of a Power BI report.",
    category: "Report",
    subcategory: "Definition",
    params: [
      { name: "report", kind: "report", required: true },
      { name: "workspace", kind: "workspace", required: false },
      { name: "save_to_file_name", kind: "text", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "create_report_from_reportjson",
    module: "sempy_labs",
    alias: "labs",
    name: "create_report_from_reportjson",
    description: "Create a Power BI report from a report.json payload.",
    category: "Report",
    subcategory: "Definition",
    params: [
      { name: "report", kind: "text", required: true, hint: "Name of the new report." },
      { name: "dataset", kind: "dataset", required: true, hint: "Bound semantic model." },
      { name: "report_json", kind: "multiline", required: true },
      { name: "theme_json", kind: "multiline", required: false },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "update_report_from_reportjson",
    module: "sempy_labs",
    alias: "labs",
    name: "update_report_from_reportjson",
    description: "Update an existing report from a report.json payload.",
    category: "Report",
    subcategory: "Definition",
    params: [
      { name: "report", kind: "report", required: true },
      { name: "report_json", kind: "multiline", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },

  // Report · Operations (extra)
  {
    id: "report_rebind_all",
    module: "sempy_labs",
    alias: "labs",
    name: "report_rebind_all",
    description: "Rebind every report in a workspace from one semantic model to another.",
    category: "Report",
    subcategory: "Operations",
    params: [
      { name: "dataset", kind: "dataset", required: true, hint: "Source semantic model." },
      { name: "new_dataset", kind: "text", required: true, hint: "Target semantic model name." },
      { name: "workspace", kind: "workspace", required: false },
      { name: "new_dataset_workspace", kind: "text", required: false },
    ],
    returnsDataFrame: false,
  },

  // Report · Translations
  {
    id: "translate_report_titles",
    module: "sempy_labs",
    alias: "labs",
    name: "translate_report_titles",
    description: "Auto-translate report titles into target languages.",
    category: "Report",
    subcategory: "Translations",
    params: [
      { name: "report", kind: "report", required: true },
      { name: "languages", kind: "text", required: true, hint: 'Comma-separated culture codes, e.g. "de-DE,fr-FR".' },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },

  // Lakehouse · Lifecycle
  {
    id: "create_lakehouse",
    module: "sempy_labs",
    alias: "labs",
    name: "create_lakehouse",
    description: "Create a new lakehouse in a workspace.",
    category: "Lakehouse",
    subcategory: "Lifecycle",
    params: [
      { name: "name", kind: "text", required: true },
      { name: "description", kind: "text", required: false },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "delete_lakehouse",
    module: "sempy_labs",
    alias: "labs",
    name: "delete_lakehouse",
    description: "Delete a lakehouse.",
    category: "Lakehouse",
    subcategory: "Lifecycle",
    params: [
      { name: "lakehouse", kind: "lakehouse", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },

  // Lakehouse · Shortcuts
  {
    id: "list_shortcuts",
    module: "sempy_labs",
    alias: "labs",
    name: "list_shortcuts",
    description: "List OneLake shortcuts in a lakehouse.",
    category: "Lakehouse",
    subcategory: "Shortcuts",
    params: [
      { name: "lakehouse", kind: "lakehouse", required: false },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "create_shortcut_onelake",
    module: "sempy_labs",
    alias: "labs",
    name: "create_shortcut_onelake",
    description: "Create a OneLake-to-OneLake shortcut to a Delta table.",
    category: "Lakehouse",
    subcategory: "Shortcuts",
    params: [
      { name: "table_name", kind: "text", required: true },
      { name: "source_lakehouse", kind: "text", required: true },
      { name: "source_workspace", kind: "text", required: true },
      { name: "destination_lakehouse", kind: "lakehouse", required: false },
      { name: "destination_workspace", kind: "workspace", required: false },
      { name: "shortcut_name", kind: "text", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "delete_shortcut",
    module: "sempy_labs",
    alias: "labs",
    name: "delete_shortcut",
    description: "Delete a OneLake shortcut.",
    category: "Lakehouse",
    subcategory: "Shortcuts",
    params: [
      { name: "shortcut_name", kind: "text", required: true },
      { name: "lakehouse", kind: "lakehouse", required: false },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },

  // Lakehouse · Maintenance
  {
    id: "optimize_lakehouse_tables",
    module: "sempy_labs",
    alias: "labs",
    name: "optimize_lakehouse_tables",
    description: "Run OPTIMIZE on Delta tables in a lakehouse.",
    category: "Lakehouse",
    subcategory: "Maintenance",
    params: [
      { name: "tables", kind: "text", required: false, hint: "Comma-separated names; empty = all tables." },
      { name: "lakehouse", kind: "lakehouse", required: false },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "vacuum_lakehouse_tables",
    module: "sempy_labs",
    alias: "labs",
    name: "vacuum_lakehouse_tables",
    description: "Run VACUUM on Delta tables in a lakehouse.",
    category: "Lakehouse",
    subcategory: "Maintenance",
    params: [
      { name: "tables", kind: "text", required: false },
      { name: "retain_n_hours", kind: "number", required: false, default: 168 },
      { name: "lakehouse", kind: "lakehouse", required: false },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "run_table_maintenance",
    module: "sempy_labs",
    alias: "labs",
    name: "run_table_maintenance",
    description: "Run combined OPTIMIZE + VACUUM via the Lakehouse maintenance API.",
    category: "Lakehouse",
    subcategory: "Maintenance",
    params: [
      { name: "table_name", kind: "text", required: true },
      { name: "optimize", kind: "bool", required: false, default: true },
      { name: "vacuum", kind: "bool", required: false, default: true },
      { name: "retention_period", kind: "text", required: false, default: "7.00:00:00" },
      { name: "lakehouse", kind: "lakehouse", required: false },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },

  // DirectLake
  {
    id: "generate_direct_lake_semantic_model",
    module: "sempy_labs.directlake",
    alias: "directlake",
    name: "generate_direct_lake_semantic_model",
    description: "Generate a Direct Lake semantic model on top of a lakehouse.",
    category: "DirectLake",
    subcategory: "Lifecycle",
    params: [
      { name: "dataset", kind: "text", required: true },
      { name: "lakehouse_tables", kind: "text", required: true, hint: "Comma-separated lakehouse tables." },
      { name: "workspace", kind: "workspace", required: false },
      { name: "lakehouse", kind: "lakehouse", required: false },
      { name: "lakehouse_workspace", kind: "text", required: false },
      { name: "overwrite", kind: "bool", required: false, default: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "update_direct_lake_partition_entity",
    module: "sempy_labs.directlake",
    alias: "directlake",
    name: "update_direct_lake_partition_entity",
    description: "Repoint Direct Lake table partitions to a different lakehouse table.",
    category: "DirectLake",
    subcategory: "Lifecycle",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "table_name", kind: "text", required: true },
      { name: "entity_name", kind: "text", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "direct_lake_schema_compare",
    module: "sempy_labs.directlake",
    alias: "directlake",
    name: "direct_lake_schema_compare",
    description: "Compare Direct Lake model schema to source lakehouse table schema.",
    category: "DirectLake",
    subcategory: "Schema",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "direct_lake_schema_sync",
    module: "sempy_labs.directlake",
    alias: "directlake",
    name: "direct_lake_schema_sync",
    description: "Sync Direct Lake model schema with source lakehouse columns.",
    category: "DirectLake",
    subcategory: "Schema",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
      { name: "add_to_model", kind: "bool", required: false, default: true },
    ],
    returnsDataFrame: false,
  },
  {
    id: "get_direct_lake_lakehouse",
    module: "sempy_labs.directlake",
    alias: "directlake",
    name: "get_direct_lake_lakehouse",
    description: "Return the lakehouse a Direct Lake model is bound to.",
    category: "DirectLake",
    subcategory: "Schema",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "check_fallback_reason",
    module: "sempy_labs.directlake",
    alias: "directlake",
    name: "check_fallback_reason",
    description: "Show why a Direct Lake query fell back to DirectQuery.",
    category: "DirectLake",
    subcategory: "Diagnostics",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },
  {
    id: "list_direct_lake_model_calc_tables",
    module: "sempy_labs.directlake",
    alias: "directlake",
    name: "list_direct_lake_model_calc_tables",
    description: "List calculated tables / columns that disable Direct Lake mode.",
    category: "DirectLake",
    subcategory: "Diagnostics",
    params: [
      { name: "dataset", kind: "dataset", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: true,
  },

  // Git
  {
    id: "connect_workspace_to_git",
    module: "sempy_labs",
    alias: "labs",
    name: "connect_workspace_to_git",
    description: "Connect a workspace to a Git repository.",
    category: "Git",
    subcategory: "Connection",
    params: [
      { name: "organization_name", kind: "text", required: true },
      { name: "project_name", kind: "text", required: true },
      { name: "repository_name", kind: "text", required: true },
      { name: "branch_name", kind: "text", required: true },
      { name: "directory_name", kind: "text", required: true, hint: "Folder inside the repo." },
      { name: "git_provider_type", kind: "text", required: false, default: "AzureDevOps" },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "disconnect_workspace_from_git",
    module: "sempy_labs",
    alias: "labs",
    name: "disconnect_workspace_from_git",
    description: "Disconnect a workspace from Git.",
    category: "Git",
    subcategory: "Connection",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: false,
  },
  {
    id: "initialize_git_connection",
    module: "sempy_labs",
    alias: "labs",
    name: "initialize_git_connection",
    description: "Initialize the connection between a workspace and Git after connect.",
    category: "Git",
    subcategory: "Connection",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: false,
  },
  {
    id: "commit_to_git",
    module: "sempy_labs",
    alias: "labs",
    name: "commit_to_git",
    description: "Commit pending workspace changes to Git.",
    category: "Git",
    subcategory: "Sync",
    params: [
      { name: "comment", kind: "text", required: true },
      { name: "item_ids", kind: "text", required: false, hint: "Comma-separated item ids; empty = all." },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "update_from_git",
    module: "sempy_labs",
    alias: "labs",
    name: "update_from_git",
    description: "Pull latest changes from Git into the workspace.",
    category: "Git",
    subcategory: "Sync",
    params: [
      { name: "remote_commit_hash", kind: "text", required: false },
      { name: "conflict_resolution_policy", kind: "text", required: false, default: "PreferRemote" },
      { name: "allow_override_items", kind: "bool", required: false, default: false },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "get_git_status",
    module: "sempy_labs",
    alias: "labs",
    name: "get_git_status",
    description: "Return Git status (changed items, head commit) for the workspace.",
    category: "Git",
    subcategory: "Sync",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },
  {
    id: "get_git_connection",
    module: "sempy_labs",
    alias: "labs",
    name: "get_git_connection",
    description: "Get current Git connection details for a workspace.",
    category: "Git",
    subcategory: "Connection",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: false,
  },

  // Notebook
  {
    id: "list_notebooks",
    module: "sempy_labs",
    alias: "labs",
    name: "list_notebooks",
    description: "List notebooks in a workspace.",
    category: "Notebook",
    subcategory: "Lifecycle",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },
  {
    id: "create_notebook",
    module: "sempy_labs",
    alias: "labs",
    name: "create_notebook",
    description: "Create a new Fabric notebook (from .ipynb / .py payload).",
    category: "Notebook",
    subcategory: "Lifecycle",
    params: [
      { name: "name", kind: "text", required: true },
      { name: "notebook_content", kind: "multiline", required: true, hint: ".ipynb JSON or path." },
      { name: "type", kind: "text", required: false, default: "ipynb", hint: "ipynb | py" },
      { name: "description", kind: "text", required: false },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "update_notebook_definition",
    module: "sempy_labs",
    alias: "labs",
    name: "update_notebook_definition",
    description: "Replace a notebook's definition with new content.",
    category: "Notebook",
    subcategory: "Lifecycle",
    params: [
      { name: "name", kind: "text", required: true },
      { name: "notebook_content", kind: "multiline", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },
  {
    id: "get_notebook_definition",
    module: "sempy_labs",
    alias: "labs",
    name: "get_notebook_definition",
    description: "Return the source of a Fabric notebook.",
    category: "Notebook",
    subcategory: "Lifecycle",
    params: [
      { name: "notebook_name", kind: "text", required: true },
      { name: "workspace", kind: "workspace", required: false },
      { name: "decode", kind: "bool", required: false, default: true },
    ],
    returnsDataFrame: false,
  },
  {
    id: "run_notebook_job",
    module: "sempy_labs",
    alias: "labs",
    name: "run_notebook_job",
    description: "Run a Fabric notebook as a job.",
    category: "Notebook",
    subcategory: "Execution",
    params: [
      { name: "notebook_name", kind: "text", required: true },
      { name: "workspace", kind: "workspace", required: false },
    ],
    returnsDataFrame: false,
  },

  // Deployment Pipelines
  {
    id: "list_deployment_pipelines",
    module: "sempy_labs",
    alias: "labs",
    name: "list_deployment_pipelines",
    description: "List deployment pipelines in the tenant.",
    category: "Deployment",
    subcategory: "Pipelines",
    params: [],
    returnsDataFrame: true,
  },
  {
    id: "list_deployment_pipeline_stages",
    module: "sempy_labs",
    alias: "labs",
    name: "list_deployment_pipeline_stages",
    description: "List stages of a deployment pipeline.",
    category: "Deployment",
    subcategory: "Pipelines",
    params: [{ name: "deployment_pipeline", kind: "text", required: true }],
    returnsDataFrame: true,
  },
  {
    id: "list_deployment_pipeline_stage_items",
    module: "sempy_labs",
    alias: "labs",
    name: "list_deployment_pipeline_stage_items",
    description: "List items in a specific stage of a deployment pipeline.",
    category: "Deployment",
    subcategory: "Pipelines",
    params: [
      { name: "deployment_pipeline", kind: "text", required: true },
      { name: "stage_name", kind: "text", required: true },
    ],
    returnsDataFrame: true,
  },
  {
    id: "deploy_to_stage",
    module: "sempy_labs",
    alias: "labs",
    name: "deploy_to_stage",
    description: "Deploy items from one pipeline stage to the next.",
    category: "Deployment",
    subcategory: "Pipelines",
    params: [
      { name: "deployment_pipeline", kind: "text", required: true },
      { name: "source_stage", kind: "text", required: true },
      { name: "items", kind: "text", required: false, hint: "Comma-separated item ids; empty = all." },
      { name: "note", kind: "text", required: false },
    ],
    returnsDataFrame: false,
  },

  // Admin
  {
    id: "list_tenant_settings",
    module: "sempy_labs.admin",
    alias: "admin",
    name: "list_tenant_settings",
    description: "List Power BI / Fabric tenant settings (requires Fabric admin).",
    category: "Admin",
    subcategory: "Tenant",
    params: [],
    returnsDataFrame: true,
  },
  {
    id: "scan_workspaces",
    module: "sempy_labs.admin",
    alias: "admin",
    name: "scan_workspaces",
    description: "Run the Power BI metadata scanner across workspaces.",
    category: "Admin",
    subcategory: "Tenant",
    params: [
      { name: "workspace", kind: "text", required: false, hint: "Comma-separated workspace ids; empty = all." },
      { name: "data_source_details", kind: "bool", required: false, default: true },
      { name: "dataset_schema", kind: "bool", required: false, default: true },
      { name: "dataset_expressions", kind: "bool", required: false, default: true },
      { name: "lineage", kind: "bool", required: false, default: true },
      { name: "artifact_users", kind: "bool", required: false, default: true },
    ],
    returnsDataFrame: false,
  },
  {
    id: "list_capacities_admin",
    module: "sempy_labs.admin",
    alias: "admin",
    name: "list_capacities",
    description: "Admin view of all capacities (requires Fabric admin).",
    category: "Admin",
    subcategory: "Tenant",
    params: [],
    returnsDataFrame: true,
  },

  // Misc · extra
  {
    id: "list_dataflow_storage_accounts",
    module: "sempy_labs",
    alias: "labs",
    name: "list_dataflow_storage_accounts",
    description: "List dataflow storage accounts (BYOSA) in the tenant.",
    category: "Misc",
    subcategory: "Dataflows",
    params: [],
    returnsDataFrame: true,
  },
  {
    id: "list_subscriptions",
    module: "sempy_labs",
    alias: "labs",
    name: "list_subscriptions",
    description: "List Power BI report / dashboard email subscriptions.",
    category: "Misc",
    subcategory: "Subscriptions",
    params: [{ name: "workspace", kind: "workspace", required: false }],
    returnsDataFrame: true,
  },
];

/* -------------------------------------------------------------------- */
/* Code generation                                                      */
/* -------------------------------------------------------------------- */

export interface SempyArgValues {
  /** Map of param name → value as the user entered it. Empty / undefined
   *  values are skipped (so the call uses the function's own default). */
  [paramName: string]: string | number | boolean | undefined;
}

/** Render a Python literal for a single value. Strings get triple-quoted
 *  if they contain newlines so multi-line DAX stays readable. */
function pyRepr(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (value.includes("\n")) {
    // Triple-quoted, escape any internal triple quotes.
    const safe = value.replace(/"""/g, '\\"\\"\\"');
    return `"""${safe}"""`;
  }
  // Single-line string — escape backslashes + double quotes.
  const safe = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${safe}"`;
}

/** Build a Python call snippet for the given function + values. */
export function generateSempyCode(fn: SempyFunction, values: SempyArgValues): string {
  const importLine = `import ${fn.module}${fn.alias && fn.alias !== fn.module ? ` as ${fn.alias}` : ""}`;
  const callPrefix = fn.alias && fn.alias !== fn.module ? `${fn.alias}.${fn.name}` : `${fn.module}.${fn.name}`;

  const args: string[] = [];
  for (const p of fn.params) {
    const raw = values[p.name];
    const isEmpty =
      raw === undefined ||
      raw === null ||
      (typeof raw === "string" && raw.trim() === "");
    if (isEmpty) {
      // For required params, still emit so the user sees the slot.
      if (p.required) {
        args.push(`    ${p.name}=${pyRepr("")},  # TODO: required`);
      }
      continue;
    }
    let v: string | number | boolean = raw as any;
    if (p.kind === "number" && typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n)) v = n;
    }
    if (p.kind === "bool" && typeof v === "string") {
      v = v === "true" || v === "True" || v === "1";
    }
    args.push(`    ${p.name}=${pyRepr(v)},`);
  }

  const callBlock = args.length
    ? `${callPrefix}(\n${args.join("\n")}\n)`
    : `${callPrefix}()`;

  const lines = [
    `# ${fn.module}.${fn.name}`,
    `# ${fn.description}`,
    importLine,
    "",
    `result = ${callBlock}`,
  ];
  if (fn.returnsDataFrame) {
    lines.push("display(result)");
  } else {
    lines.push("print(result)");
  }
  return lines.join("\n");
}

/** Wrap the snippet into a Jupyter notebook (.ipynb v4) JSON string. */
/**
 * Python that runs the generated snippet, captures its `result` variable
 * (always assigned by {@link generateSempyCode}) **or the full traceback**
 * and returns it to the calling app as the notebook's *exit value*. Fabric
 * surfaces this in the `exitValue` field of the Get-Item-Job-Instance
 * response, so the Sempy **Runner** can render the result — or the error —
 * inline without the user opening the notebook.
 *
 * The snippet is embedded as base64 and run via `exec(...)` inside a
 * `try/except`. This is the crucial bit: if the snippet raises, we still
 * call `notebook.exit(...)` with the traceback, so the Spark session
 * finishes cleanly (job state `Completed`) instead of a raised exception
 * cancelling the session and surfacing as an opaque proxy 500. The exit
 * value is always a JSON object `{"ok": bool, "result"|"error": str}`.
 *
 * Only injected on the run path (never on the "create + open" path) so
 * opened notebooks stay clean for interactive Run-All.
 */
function buildRunCaptureCell(code: string, needsSempyLabs: boolean): string {
  // base64 (UTF-8 safe) so the embedded snippet can contain any quoting —
  // triple-quoted DAX, backslashes, etc. — without delimiter clashes.
  const b64 = btoa(unescape(encodeURIComponent(code)));
  // `semantic-link-labs` is NOT preinstalled in the Fabric Spark runtime, so
  // sempy_labs snippets need a pip install first. A separate `%pip install`
  // cell cancels the whole Spark session if it fails (opaque proxy 500), so
  // instead we install INSIDE the try/except — same interpreter via
  // `sys.executable -m pip`, then `invalidate_caches()` — so an install
  // failure is captured as a traceback like any other error.
  const installLines = needsSempyLabs
    ? [
        "    try:",
        "        import sempy_labs as _probe  # noqa: F401",
        "    except ImportError:",
        "        import subprocess as _sp, sys as _sys, importlib as _il",
        '        _sp.check_call([_sys.executable, "-m", "pip", "install", "-q", "semantic-link-labs"])',
        "        _il.invalidate_caches()",
      ]
    : [];
  return [
    "# Power BI Fixer · Sempy Runner — run the generated snippet, capture the",
    "# result (or the full traceback) and return it to the app as the exit value.",
    "import base64 as _b64, json as _json, traceback as _tb",
    "import notebookutils",
    "",
    `_USER_CODE = _b64.b64decode("${b64}").decode("utf-8")`,
    "_err = None",
    "_payload = None",
    "try:",
    ...installLines,
    '    exec(compile(_USER_CODE, "<sempy-runner>", "exec"), globals())',
    '    _payload = globals().get("result")',
    "except Exception:",
    "    _err = _tb.format_exc()",
    "",
    "if _err is not None:",
    '    _exit_value = _json.dumps({"ok": False, "error": _err})[:60000]',
    "else:",
    "    try:",
    "        import pandas as _pd",
    "        if isinstance(_payload, _pd.DataFrame):",
    '            _s = _payload.to_json(orient="records")',
    "        elif isinstance(_payload, str):",
    "            _s = _payload",
    "        else:",
    "            _s = _json.dumps(_payload, default=str)",
    "    except Exception:",
    "        _s = str(_payload)",
    '    _exit_value = _json.dumps({"ok": True, "result": _s})[:60000]',
    "",
    "# exit() must be a top-level statement (never inside try/except) to take",
    "# effect — see notebookutils docs. Keep it as the final line of the cell.",
    "notebookutils.notebook.exit(_exit_value)",
  ].join("\n");
}

export function codeToNotebookJson(
  code: string,
  title: string,
  opts?: { captureExit?: boolean },
): string {
  // v0.112 — Fabric Spark ships `sempy` (semantic-link) preinstalled but NOT
  // `sempy_labs` (semantic-link-labs). When the generated snippet imports
  // sempy_labs (any submodule), prepend a `%pip install` cell so Run-All
  // works on a fresh session without the user having to add the install
  // themselves.
  const needsSempyLabs = /^\s*import\s+sempy_labs\b|^\s*from\s+sempy_labs\b/m.test(code);
  const toSource = (text: string) =>
    text.split("\n").map((l, i, a) => (i === a.length - 1 ? l : l + "\n"));
  const cells: Array<Record<string, unknown>> = [
    {
      cell_type: "markdown",
      metadata: {},
      source: [`# ${title}`, "", "Generated by **Power BI Fixer · Sempy Runner**.", "", "Click **Run all** to execute."],
    },
  ];
  // On the run path the install is folded into the capture cell (inside its
  // try/except) so a failed install surfaces as a traceback instead of
  // cancelling the Spark session. The separate `%pip` cell is only added on
  // the create + open path, where interactive Run-All handles magics fine.
  if (needsSempyLabs && !opts?.captureExit) {
    cells.push({
      cell_type: "code",
      metadata: {},
      execution_count: null,
      outputs: [],
      source: toSource("# Install semantic-link-labs (not preinstalled in Fabric Spark)\n%pip install semantic-link-labs --quiet"),
    });
  }
  if (opts?.captureExit) {
    // Run path: a single wrapped cell that exec's the snippet inside a
    // try/except and always calls `notebook.exit(...)` — so a failing call
    // returns its traceback inline instead of cancelling the Spark session.
    cells.push({
      cell_type: "code",
      metadata: {},
      execution_count: null,
      outputs: [],
      source: toSource(buildRunCaptureCell(code, needsSempyLabs)),
    });
  } else {
    // Create + open path: a clean, readable snippet for interactive Run-All.
    cells.push({
      cell_type: "code",
      metadata: {},
      execution_count: null,
      outputs: [],
      source: toSource(code),
    });
  }
  const nb = {
    cells,
    metadata: {
      kernelspec: { display_name: "Synapse PySpark", language: "python", name: "synapse_pyspark" },
      language_info: { name: "python" },
      microsoft: { language: "python" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return JSON.stringify(nb, null, 2);
}

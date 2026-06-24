// Faithful TS port of `sempy_labs.report._report_bpa_rules`. Public types only.
//
// Each rule is evaluated against a report "object" of a particular *scope*
// (Page, Visual, Custom Visual, a Filter, or a Report-Level Measure). Rules are
// written as predicates over a light scope object that exposes the few fields
// the Python expressions read (e.g. `df["Height"] > 720`).
//
// The "Valid Semantic Model Object" rule from the source is intentionally
// omitted here: it requires resolving every report reference against the live
// semantic model, which the in-browser PBIR pass cannot do.

export type ReportBpaSeverity = 'Error' | 'Warning' | 'Info';

export type ReportBpaScope =
  | 'Custom Visual'
  | 'Page'
  | 'Visual'
  | 'Report Filter'
  | 'Page Filter'
  | 'Visual Filter'
  | 'Report Level Measure';

export interface ReportBpaRule {
  category: string;
  scope: ReportBpaScope | ReportBpaScope[];
  severity: ReportBpaSeverity;
  name: string;
  description: string;
  url?: string;
  /** Returns true when the object violates the rule. */
  predicate: (obj: ReportScopeObj) => boolean;
}

export interface ReportBpaViolation {
  category: string;
  ruleName: string;
  severity: ReportBpaSeverity;
  description: string;
  url?: string;
  /** Display label for the scope ("Page", "Visual Filter", …). */
  objectType: string;
  /** Human-readable path: page name, "page / visual", filter field, … */
  objectName: string;
}

/* ------------------------------------------------------------------ *
 * Extracted report objects (PBIR-derived)
 * ------------------------------------------------------------------ */

export interface PageObj {
  __scope: 'Page';
  name: string;
  displayName: string;
  height: number;
  width: number;
  visibleVisualCount: number;
}

export interface VisualObj {
  __scope: 'Visual';
  page: string;
  pageDisplay: string;
  name: string;
  visualType: string;
  objectCount: number;
  showItemsWithNoData: boolean;
  isCustomVisual: boolean;
}

export interface CustomVisualObj {
  __scope: 'Custom Visual';
  name: string;
  usedInReport: boolean;
}

export interface FilterObj {
  __scope: 'Report Filter' | 'Page Filter' | 'Visual Filter';
  label: string;
  /** "Measure" | "Column" | "Aggregation" | "Unknown". */
  objectType: string;
  /** Raw filter type, e.g. "TopN" | "Categorical" | "Advanced". */
  filterType: string;
}

export interface ReportLevelMeasureObj {
  __scope: 'Report Level Measure';
  name: string;
  table: string;
}

export type ReportScopeObj =
  | PageObj
  | VisualObj
  | CustomVisualObj
  | FilterObj
  | ReportLevelMeasureObj;

export interface ReportModel {
  pages: PageObj[];
  visuals: VisualObj[];
  customVisuals: CustomVisualObj[];
  filters: FilterObj[];
  reportLevelMeasures: ReportLevelMeasureObj[];
}

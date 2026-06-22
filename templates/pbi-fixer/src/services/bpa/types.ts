/* eslint-disable @typescript-eslint/no-explicit-any */
// Faithful TS port of `sempy_labs._model_bpa_rules`. Public types only.
//
// Each rule is evaluated against an "object" of a particular *scope*
// (Table, Column, Measure, …). Rules are written as predicates against
// the captured `ScopeObj` and a `TomContext` shim that exposes the
// model-wide helpers Python's `tom.*` API provides.

export type BpaSeverity = "Error" | "Warning" | "Info";

export type BpaScope =
  | "Model"
  | "Table"
  | "Column"
  | "Measure"
  | "Hierarchy"
  | "Partition"
  | "Relationship"
  | "Calculation Item"
  | "Calculated Table"
  | "Calculated Column"
  | "Row Level Security";

export interface BpaRule {
  category: string;
  scope: BpaScope | BpaScope[];
  severity: BpaSeverity;
  name: string;
  description: string;
  url?: string;
  /** Returns true when the object violates the rule. */
  predicate: (obj: any, ctx: import("./engine").TomContext) => boolean;
}

export interface BpaViolation {
  category: string;
  ruleName: string;
  severity: BpaSeverity;
  description: string;
  url?: string;
  /** Display label for the scope ("Table", "Calculation Item", …). */
  objectType: string;
  /** Human-readable path: "TableName"[ "[ColumnName]" | "[Measure]" ]. */
  objectName: string;
}

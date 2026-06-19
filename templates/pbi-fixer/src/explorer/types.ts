// Shared types for the Model and Report explorers.
// Ported from the standalone "TS PBI Fixer" rewrite.

// --------------------------------------------------------------------------- //
// Model
// --------------------------------------------------------------------------- //
export interface ColumnInfo {
  dataType: string;
  isHidden: boolean;
  expression: string | null;
  type: string;
  summarizeBy: string;
  displayFolder: string;
  isKey: boolean;
  dataCategory: string;
  sortByColumn: string;
  encodingHint: string;
  isNullable: boolean;
}

export interface MeasureInfo {
  expression: string;
  formatString: string;
  description: string;
  displayFolder: string;
  isHidden: boolean;
}

export interface HierarchyInfo {
  levels: string[];
}

export interface CalcItemInfo {
  expression: string;
  ordinal: number;
}

export interface PartitionInfo {
  name: string;
  sourceType: string;
  expression: string;
}

export interface RelationshipInfo {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  crossFilter: string;
  isActive: boolean;
  multiplicity: string;
  securityFiltering: string;
  relyOnRri: boolean;
}

export interface TableInfo {
  description: string;
  isHidden: boolean;
  type: 'Table' | 'CalculationGroup' | 'CalculatedTable';
  columns: Record<string, ColumnInfo>;
  measures: Record<string, MeasureInfo>;
  hierarchies: Record<string, HierarchyInfo>;
  calcItems: Record<string, CalcItemInfo>;
  partitions: PartitionInfo[];
}

export interface ModelProperties {
  compatibilityLevel: string;
  defaultMode: string;
}

export interface ModelData {
  tables: Record<string, TableInfo>;
  relationships: RelationshipInfo[];
  perspectives: string[];
  modelProperties: ModelProperties;
  datasetName?: string;
}

// --------------------------------------------------------------------------- //
// Report
// --------------------------------------------------------------------------- //
export interface VisualInfo {
  type: string;
  displayType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hidden: boolean;
  title: string;
}

export interface PageInfo {
  displayName: string;
  width: number;
  height: number;
  hidden: boolean;
  visualCount: number;
  ordinal: number;
  visuals: Record<string, VisualInfo>;
}

export interface VisualObjectRef {
  table: string;
  object: string;
  type: 'Measure' | 'Column';
}

export interface ReportData {
  pages: Record<string, PageInfo>;
  format: string;
  reportId: string;
  workspaceId: string;
  visualObjects?: Record<string, VisualObjectRef[]>;
}

// --------------------------------------------------------------------------- //
// Tree
// --------------------------------------------------------------------------- //
export interface TreeItem {
  indent: number;
  icon: string;
  label: string;
  key: string;
}

export interface TreeBuildResult {
  options: string[];
  keyMap: Record<string, string>;
  iconMap: Record<string, string>;
}

export interface ScanResult {
  [key: string]: number;
}

// modelDiagram — build an ER-diagram model (nodes + edges) from a semantic
// model and persist hand-placed table positions (PKG-15 · D3).
//
// The diagram is a pure client-side view over the model loaded via
// `loadModelData`. Each table becomes a node; each relationship becomes an
// edge. Tables are auto-laid-out on a grid the first time and the user can
// drag them around; positions are persisted to localStorage keyed by dataset
// so they survive reloads.

import { loadModelData } from './fabricRest';
import type { ModelData } from '@/explorer/types';

export interface DiagramNode {
  table: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Columns shown inside the node box (relationship + key columns first). */
  rows: string[];
  /** Columns that participate in a relationship or are flagged as key. */
  keyColumns: Set<string>;
  type: 'Table' | 'CalculationGroup' | 'CalculatedTable';
  hidden: boolean;
}

export interface DiagramEdge {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  isActive: boolean;
  bothDirections: boolean;
  /** 'one' | 'many' on the *from* side. */
  fromCard: 'one' | 'many';
  /** 'one' | 'many' on the *to* side. */
  toCard: 'one' | 'many';
}

export interface DiagramModel {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  tableCount: number;
  relCount: number;
}

export type PositionMap = Record<string, { x: number; y: number }>;

// ── layout constants ──────────────────────────────────────────────────────
const NODE_WIDTH = 200;
const HEADER_H = 30;
const ROW_H = 18;
const BODY_PAD = 8;
const MAX_ROWS = 8;
const GAP_X = 70;
const GAP_Y = 50;

function nodeHeight(rowCount: number): number {
  return HEADER_H + Math.max(1, rowCount) * ROW_H + BODY_PAD;
}

function cardOf(raw: string): 'one' | 'many' {
  return /many/i.test(raw) ? 'many' : 'one';
}

/** Build the diagram (nodes + edges) from raw model data, auto-laying the
 *  tables out on a square-ish grid. Persisted positions are merged in later. */
export function buildDiagram(model: ModelData): DiagramModel {
  const tableNames = Object.keys(model.tables);

  // Which columns participate in a relationship (per table)?
  const relCols = new Map<string, Set<string>>();
  const touch = (table: string, col: string) => {
    if (!relCols.has(table)) relCols.set(table, new Set());
    relCols.get(table)!.add(col);
  };
  for (const r of model.relationships) {
    touch(r.fromTable, r.fromColumn);
    touch(r.toTable, r.toColumn);
  }

  // ── nodes ──
  const nodes: DiagramNode[] = tableNames.map((name) => {
    const t = model.tables[name];
    const keyCols = new Set<string>();
    const related = relCols.get(name) ?? new Set<string>();
    for (const c of related) keyCols.add(c);
    for (const [cName, c] of Object.entries(t.columns)) {
      if (/^RowNumber-/i.test(cName)) continue;
      if (c.isKey) keyCols.add(cName);
    }
    // Show relationship/key columns first, then a few remaining columns.
    const ordered: string[] = [];
    for (const c of keyCols) ordered.push(c);
    for (const cName of Object.keys(t.columns)) {
      if (/^RowNumber-/i.test(cName)) continue;
      if (keyCols.has(cName)) continue;
      ordered.push(cName);
    }
    const rows = ordered.slice(0, MAX_ROWS);
    const hiddenExtra = ordered.length - rows.length;
    if (hiddenExtra > 0) rows.push(`… +${hiddenExtra} more`);
    return {
      table: name,
      x: 0,
      y: 0,
      width: NODE_WIDTH,
      height: nodeHeight(rows.length),
      rows,
      keyColumns: keyCols,
      type: t.type,
      hidden: t.isHidden,
    };
  });

  // ── grid auto-layout ──
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const maxH = nodes.reduce((m, n) => Math.max(m, n.height), HEADER_H);
  const cellW = NODE_WIDTH + GAP_X;
  const cellH = maxH + GAP_Y;
  nodes.forEach((n, i) => {
    n.x = (i % cols) * cellW + 20;
    n.y = Math.floor(i / cols) * cellH + 20;
  });

  // ── edges ──
  const edges: DiagramEdge[] = model.relationships.map((r, i) => {
    const [fromRaw, toRaw] = (r.multiplicity || '').split(':');
    return {
      id: `${r.fromTable}|${r.fromColumn}->${r.toTable}|${r.toColumn}#${i}`,
      fromTable: r.fromTable,
      fromColumn: r.fromColumn,
      toTable: r.toTable,
      toColumn: r.toColumn,
      isActive: r.isActive,
      bothDirections: /both/i.test(r.crossFilter),
      fromCard: cardOf(fromRaw ?? 'many'),
      toCard: cardOf(toRaw ?? 'one'),
    };
  });

  return { nodes, edges, tableCount: nodes.length, relCount: edges.length };
}

/** Load the model and build the ER diagram in one call. */
export async function loadDiagramModel(
  workspaceId: string,
  datasetId: string,
  datasetName: string
): Promise<DiagramModel> {
  const model = await loadModelData(workspaceId, datasetId, datasetName);
  return buildDiagram(model);
}

// ── position persistence (localStorage) ───────────────────────────────────
const POS_PREFIX = 'pbifixer.diagram.';

export function loadPositions(datasetId: string): PositionMap {
  if (!datasetId) return {};
  try {
    const raw = localStorage.getItem(POS_PREFIX + datasetId);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PositionMap) : {};
  } catch {
    return {};
  }
}

export function savePositions(datasetId: string, positions: PositionMap): void {
  if (!datasetId) return;
  try {
    localStorage.setItem(POS_PREFIX + datasetId, JSON.stringify(positions));
  } catch {
    /* storage full / unavailable — positions just won't persist */
  }
}

export function clearPositions(datasetId: string): void {
  if (!datasetId) return;
  try {
    localStorage.removeItem(POS_PREFIX + datasetId);
  } catch {
    /* ignore */
  }
}

/** Apply persisted positions onto freshly-built nodes (mutates + returns). */
export function applyPositions(nodes: DiagramNode[], positions: PositionMap): DiagramNode[] {
  for (const n of nodes) {
    const p = positions[n.table];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      n.x = p.x;
      n.y = p.y;
    }
  }
  return nodes;
}

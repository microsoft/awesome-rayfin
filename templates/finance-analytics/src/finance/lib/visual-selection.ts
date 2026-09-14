import { useSyncExternalStore } from "react";
import type { Insight } from "../features/intelligence-rail";
import type { ExplainInput } from "./insights-kernel";

/**
 * A datum a user "double-clicked into" on a visual. Any chart can raise one; the
 * intelligence rail listens and drills into it. Carrying its own derived insights
 * keeps the mechanism fully generic — the rail renders whatever the visual explains.
 */
export interface VisualSelection {
  /** Which visual raised the selection (rail sub-header, e.g. "Variance to budget"). */
  visual: string;
  /** Human label of the selected datum (e.g. "EMEA" or "March"). */
  label: string;
  /** Optional headline value shown next to the label. */
  value?: string;
  /** Drill-down insights derived from the selected datum. */
  insights: Insight[];
  /** Optional structured input for the deterministic "explain this number" panel. */
  explain?: ExplainInput;
}

/**
 * Immutable navigation context for stepping through the siblings of a selection
 * (e.g. every row of a statement). Stored alongside the active selection as ONE
 * atomic snapshot so prev/next can never desync from what's on screen.
 */
export interface VisualNavigation {
  /** All sibling selections in display order (own copy — callers may mutate theirs). */
  items: VisualSelection[];
  /** Index of the active selection within `items`. */
  index: number;
  /** Identifies the sibling set; a new scope replaces (never navigates) the old one. */
  scopeKey: string;
}

interface Snapshot {
  selection: VisualSelection | null;
  navigation: VisualNavigation | null;
}

const EMPTY: Snapshot = { selection: null, navigation: null };
let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** A single datum with no sibling context. */
function selectOnly(sel: VisualSelection) {
  snapshot = { selection: sel, navigation: null };
  emit();
}

/**
 * Select `items[index]` and remember the whole sibling set so the rail can offer
 * prev/next. `items` is cloned so later mutation of the caller's array can't corrupt
 * navigation. Out-of-range indices fall back to a context-free selection.
 */
function selectAt(items: VisualSelection[], index: number, scopeKey: string) {
  if (!Array.isArray(items) || index < 0 || index >= items.length) {
    if (items?.[index]) selectOnly(items[index]);
    return;
  }
  const clone = items.slice();
  snapshot = { selection: clone[index], navigation: { items: clone, index, scopeKey } };
  emit();
}

/** Move `delta` positions within the current sibling set. No-ops at the bounds. */
function step(delta: number) {
  const nav = snapshot.navigation;
  if (!nav) return;
  const next = nav.index + delta;
  if (next < 0 || next >= nav.items.length) return;
  snapshot = { selection: nav.items[next], navigation: { ...nav, index: next } };
  emit();
}

/**
 * Module-singleton selection channel. Shared by value across lazy chunks (the
 * gallery loads on demand; the rail lives in the app shell) because both import
 * the same module path — Vite dedupes it to one instance.
 */
export const visualSelectionStore = {
  /** Select a lone datum (clears any sibling navigation). */
  select(sel: VisualSelection) {
    selectOnly(sel);
  },
  selectAt,
  step,
  clear() {
    if (snapshot !== EMPTY) {
      snapshot = EMPTY;
      emit();
    }
  },
  /** Stable snapshot reference (never a fresh object) for useSyncExternalStore. */
  getSnapshot(): Snapshot {
    return snapshot;
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

const serverSnapshot: Snapshot = EMPTY;

/** React binding for the selection channel. Server snapshot is always empty. */
export function useVisualSelection() {
  const snap = useSyncExternalStore(
    visualSelectionStore.subscribe,
    visualSelectionStore.getSnapshot,
    () => serverSnapshot,
  );
  return {
    selection: snap.selection,
    navigation: snap.navigation,
    select: visualSelectionStore.select,
    selectAt: visualSelectionStore.selectAt,
    step: visualSelectionStore.step,
    clear: visualSelectionStore.clear,
  };
}

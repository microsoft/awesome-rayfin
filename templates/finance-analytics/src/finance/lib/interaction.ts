/**
 * Interaction adapter — translates between the official Fabric interaction contract
 * (`onInteraction` emits `InteractionEvent[]` carrying set/range predicates) and this
 * package's canonical, host-owned filter state (`FilterState`).
 *
 * The Fabric substrate is explicitly host-driven: a visual reports a selection via
 * `onInteraction`, and the host decides whether to treat it as a cross-filter by
 * re-passing a filtered/highlighted `DataTable`. So OUR filter state stays canonical
 * and an incoming `InteractionEvent` is just an **input event** we fold in. This module
 * is the typed, tested seam for that fold — plus the reverse projection so our active
 * filters can be expressed as official selections (e.g. to drive a visual's highlight).
 *
 * Runtime-dependency-free: the official types are `import type` only, and
 * `selectionsMatch` is reimplemented here mirroring the `@microsoft/fabric-visuals-core`
 * semantics (structural, order-independent over a selection's predicates).
 */

import type { CellValue, DataTable } from "./types";
import type { FilterState } from "./filters";
import type {
  DataPointPredicate,
  DataPointSelection,
  InteractionEvent,
  SetPredicate,
} from "../data/fabric-interop";

/**
 * Project our active `FilterState` into official set-predicate selections — one
 * selection per active column, each a single-value `SetPredicate`. Useful for driving
 * a visual's highlight/selection state from the host's canonical filters.
 */
export function filtersToSelections(active: FilterState): DataPointSelection[] {
  return Object.entries(active)
    .filter(([, v]) => v !== "" && v != null)
    .map(([name, value]) => ({
      predicates: [{ type: "set", name, values: [value] } satisfies SetPredicate],
    }));
}

/**
 * Fold an official `InteractionEvent` stream into a next `FilterState`, merged onto
 * `base`. A `'clear'` event resets to an empty state; a `'select'` event applies each
 * `SetPredicate` as a single-value column filter (first value wins, since `FilterState`
 * is exact-match single-value per column).
 *
 * `RangePredicate`s are intentionally skipped — our exact-match `FilterState` can't
 * represent a range losslessly. Range-driven cross-filtering is handled at the visual
 * boundary by re-passing a range-filtered official `DataTable`, not by mutating filters.
 */
export function selectionsToFilters(events: InteractionEvent[], base: FilterState = {}): FilterState {
  let next: FilterState = { ...base };
  for (const ev of events) {
    if (ev.action === "clear") {
      next = {};
      continue;
    }
    for (const sel of ev.selections) {
      for (const p of sel.predicates) {
        if (p.type !== "set") continue;
        if (!p.name || p.values.length === 0) continue;
        const first = p.values[0];
        if (first == null) continue;
        next[p.name] = String(first);
      }
    }
  }
  return next;
}

/**
 * Extract the canonical `DataPointSelection[]` an official `InteractionEvent` expresses.
 * A `'clear'` event yields an empty selection (the "nothing selected" state); a
 * `'select'` event yields its `selections` verbatim. This is the selection-space analog
 * of {@link selectionsToFilters} — used to fold a fabric visual's `onInteraction` into
 * the app's selection state without projecting through exact-match filters (so range
 * predicates survive the round-trip to the host).
 */
export function eventToSelections(event: InteractionEvent): DataPointSelection[] {
  return event.action === "clear" ? [] : event.selections;
}

/**
 * Reduce an official `InteractionEvent[]` batch (the shape `onInteraction` delivers) to
 * the net selection it expresses: a `'clear'` resets, a `'select'` replaces, last event
 * wins. The array analog of {@link eventToSelections}, used by the SelectionProvider to
 * accept a visual's raw interaction callback.
 */
export function eventsToSelections(events: InteractionEvent[]): DataPointSelection[] {
  return events.reduce<DataPointSelection[]>((_acc, e) => eventToSelections(e), []);
}

/**
 * Order-independent structural equality of two selection *lists* — pairwise
 * {@link selectionsMatch} up to ordering. Powers the selection bus echo-guard so a
 * value received from the host isn't republished (which would loop between items).
 */
export function selectionListsMatch(a: DataPointSelection[], b: DataPointSelection[]): boolean {
  if (a.length !== b.length) return false;
  const remaining = b.slice();
  for (const sa of a) {
    const idx = remaining.findIndex((sb) => selectionsMatch(sa, sb));
    if (idx < 0) return false;
    remaining.splice(idx, 1);
  }
  return true;
}

/**
 * Value equality mirroring `@microsoft/fabric-visuals-core`'s internal `valuesEqual`:
 * `Date`s compare by timestamp (so two equal dates from different emissions match),
 * everything else by strict `===`. Deliberately NOT `Object.is` — the official function
 * uses `===`, so `NaN`/`-0` are treated exactly as the SDK treats them.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/**
 * Order-independent structural equality of two predicates — a faithful port of the
 * official `predicatesMatch`. `set` values compare as true sets (mutual containment via
 * {@link valuesEqual}, so duplicates collapse); `range` bounds compare via `valuesEqual`
 * (Date-aware). This keeps the echo-guard byte-consistent with what the host considers
 * "the same selection".
 */
function predicatesEqual(a: DataPointPredicate, b: DataPointPredicate): boolean {
  if (a.type !== b.type || a.name !== b.name) return false;
  if (a.type === "set" && b.type === "set") {
    const aInB = a.values.every((v) => b.values.some((u) => valuesEqual(v, u)));
    const bInA = b.values.every((v) => a.values.some((u) => valuesEqual(v, u)));
    return aInB && bInA;
  }
  if (a.type === "range" && b.type === "range") {
    return valuesEqual(a.min, b.min) && valuesEqual(a.max, b.max);
  }
  return false;
}

/**
 * Structural, order-independent equality of two selections — reimplements the official
 * `@microsoft/fabric-visuals-core` `selectionsMatch` so this package needs no runtime
 * dependency on the SDK. Two selections match when they have the same predicates,
 * regardless of predicate order.
 */
export function selectionsMatch(a: DataPointSelection, b: DataPointSelection): boolean {
  if (a.predicates.length !== b.predicates.length) return false;
  const remaining = b.predicates.slice();
  for (const pa of a.predicates) {
    const idx = remaining.findIndex((pb) => predicatesEqual(pa, pb));
    if (idx < 0) return false;
    remaining.splice(idx, 1);
  }
  return true;
}

function cmp(a: unknown, b: unknown): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return null;
}

/** Does one row satisfy a single predicate? */
function predicateMatches(row: Record<string, CellValue>, p: DataPointPredicate): boolean {
  const cell = row[p.name];
  if (p.type === "set") {
    return p.values.some((v) => String(v) === String(cell ?? ""));
  }
  // range
  if (cell == null) return false;
  if (p.min != null) {
    const d = cmp(cell, p.min);
    if (d == null || d < 0) return false;
  }
  if (p.max != null) {
    const d = cmp(cell, p.max);
    if (d == null || d > 0) return false;
  }
  return true;
}

/**
 * Apply official selections to our object-row `DataTable`, powering host-owned
 * cross-filter when a visual's `onInteraction` selection is treated as a data filter.
 * Semantics match the official contract: predicates within a selection are conjunctive
 * (AND); multiple selections are disjunctive (OR). An empty selection array is a no-op
 * (returns the table unchanged).
 */
export function applySelections(table: DataTable, selections: DataPointSelection[]): DataTable {
  if (!selections.length) return table;
  return {
    columns: table.columns,
    rows: table.rows.filter((row) =>
      selections.some((sel) => sel.predicates.every((p) => predicateMatches(row, p))),
    ),
  };
}

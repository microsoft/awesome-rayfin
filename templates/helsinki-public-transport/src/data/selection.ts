/**
 * Which vehicles are being compared, and which of them the detail panel is showing.
 *
 * Kept as a pure module because the interesting behaviour is all in the edge cases: closing the
 * active tab, re-selecting something already open, and running into the cap.
 */

/** Tracks are polled per vehicle, so the selection has to stay small. */
export const MAX_TRACKED_VEHICLES = 5;

export interface Selection {
  /** Selected vehicle ids, in the order they were added - this is the tab order. */
  ids: string[];
  /** The tab the detail panel is showing. Always a member of {@link ids}, or null when empty. */
  activeId: string | null;
}

export const EMPTY_SELECTION: Selection = { ids: [], activeId: null };

/** The tab to fall back to once `removedIndex` disappears: the one before it, else the new first. */
function neighbour(ids: string[], removedIndex: number): string | null {
  if (ids.length === 0) return null;
  return ids[Math.min(Math.max(removedIndex - 1, 0), ids.length - 1)];
}

/**
 * Apply a click.
 *
 * - `id === null` clears everything (clicking empty map).
 * - `additive` (ctrl/cmd/shift-click) toggles the vehicle in or out of the comparison.
 * - a plain click on something already selected just activates its tab, rather than
 *   collapsing the comparison the user has built up.
 */
export function applySelect(current: Selection, id: string | null, additive = false): Selection {
  if (id === null) return EMPTY_SELECTION;

  const index = current.ids.indexOf(id);

  if (additive) {
    if (index !== -1) {
      const ids = current.ids.filter((existing) => existing !== id);
      return {
        ids,
        activeId: current.activeId === id ? neighbour(ids, index) : current.activeId,
      };
    }
    // At the cap, ignore the addition rather than silently evicting a track the user is reading.
    if (current.ids.length >= MAX_TRACKED_VEHICLES) return current;
    return { ids: [...current.ids, id], activeId: id };
  }

  if (index !== -1) return { ...current, activeId: id };
  return { ids: [id], activeId: id };
}

/** Close one tab from the tab strip. */
export function closeTab(current: Selection, id: string): Selection {
  const index = current.ids.indexOf(id);
  if (index === -1) return current;
  const ids = current.ids.filter((existing) => existing !== id);
  return {
    ids,
    activeId: current.activeId === id ? neighbour(ids, index) : current.activeId,
  };
}

/** Activate an already-selected vehicle. */
export function activate(current: Selection, id: string): Selection {
  return current.ids.includes(id) ? { ...current, activeId: id } : current;
}

/** Drop vehicles that are no longer reported by the feed. */
export function pruneSelection(current: Selection, knownIds: Set<string>): Selection {
  if (current.ids.every((id) => knownIds.has(id))) return current;
  const ids = current.ids.filter((id) => knownIds.has(id));
  const activeId =
    current.activeId && ids.includes(current.activeId) ? current.activeId : (ids[0] ?? null);
  return { ids, activeId };
}

/** Stable colour index for a vehicle, so a track keeps its colour as other tabs close. */
export function colorIndex(selection: Selection, id: string): number {
  const index = selection.ids.indexOf(id);
  return index === -1 ? 0 : index;
}

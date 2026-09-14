/**
 * Selection bus — the host round-trip channel for cross-*item* selection in a Fabric
 * workspace. A Fabric Apps Analytics app is one item among many wired to the same
 * semantic model; when a user clicks a bar here, the workspace host can fan that
 * selection to sibling items (and vice-versa) so the whole page cross-filters as one.
 *
 * The official substrate expresses a selection as `DataPointSelection[]` (set/range
 * predicates). This module is the transport for that value — a tiny publish/subscribe
 * channel. The real Fabric host implements {@link SelectionHost} and bridges to the
 * workspace's shared selection state; standalone/dev builds fall back to
 * {@link localSelectionBus}, an in-memory singleton that still fans selection across
 * this app's own lazy chunks (they import the same module path, so Vite dedupes it to
 * one instance — the exact pattern `visualSelectionStore` already relies on).
 *
 * Runtime-dependency-free: `DataPointSelection` is `import type` only, so this adds no
 * weight and needs no SDK present to build or test.
 */

import type { DataPointSelection } from "../data/fabric-interop";

/**
 * The cross-item selection transport a host provides. `publish` pushes THIS app's
 * current selection out to the workspace; `subscribe` receives selections pushed in by
 * sibling items. Implementations must not echo a publisher's own value back to it
 * synchronously — the {@link SelectionProvider} also guards against echoes structurally,
 * so a well-behaved host and the provider together never loop.
 */
export interface SelectionHost {
  /** Broadcast the current selection to other workspace items. */
  publish(selections: DataPointSelection[]): void;
  /** Observe selections broadcast by other items. Returns an unsubscribe fn. */
  subscribe(listener: (selections: DataPointSelection[]) => void): () => void;
}

/**
 * Create an in-memory {@link SelectionHost}. Every subscriber except the publisher is
 * notified on `publish` (the publisher is skipped by reference so a component never
 * receives an echo of the value it just sent). Used as the default when no host is
 * supplied — cross-item round-trip is a no-op, but cross-chunk fan-out within this app
 * still works.
 */
export function createLocalSelectionBus(): SelectionHost {
  const listeners = new Set<(selections: DataPointSelection[]) => void>();
  return {
    publish(selections) {
      // Copy so a listener that unsubscribes mid-loop can't mutate the live set.
      for (const l of [...listeners]) l(selections);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Process-wide default bus. Shared by value across lazy chunks because they import the
 * same module path (Vite dedupes it to one instance). Real hosts pass their own
 * `SelectionHost` via config and this is never touched.
 */
export const localSelectionBus: SelectionHost = createLocalSelectionBus();

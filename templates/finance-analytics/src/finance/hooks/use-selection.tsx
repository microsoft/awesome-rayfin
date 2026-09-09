/**
 * SelectionProvider — the app-level selection hub. It holds the current
 * `DataPointSelection[]` (the official cross-filter value), lets any nested visual read
 * it or dispatch a new one via {@link useSelection}, and round-trips it to the workspace
 * host so sibling items cross-filter in lock-step.
 *
 * State stays *controlled*: the host app owns the canonical selection (in this template,
 * projected from URL-persisted filter state) and passes it in as `selections` with an
 * `onSelectionsChange` writer. The provider adds exactly two things on top: (1) a typed
 * `applyInteraction` that folds an official `InteractionEvent` from a fabric visual into
 * that state, and (2) the {@link SelectionHost} round-trip with a structural echo-guard
 * so a selection received from the host is never republished back into a loop.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { eventsToSelections, selectionListsMatch } from "../lib/interaction";
import { localSelectionBus, type SelectionHost } from "../lib/selection-bus";
import type { DataPointSelection, InteractionEvent } from "../data/fabric-interop";

/** What {@link useSelection} exposes to any visual under the provider. */
export interface SelectionContextValue {
  /** The current cross-filter selection (empty ⇒ nothing selected). */
  selections: DataPointSelection[];
  /** Fold a fabric visual's official `onInteraction` batch into the selection. */
  applyInteraction: (events: InteractionEvent[]) => void;
  /** Replace the selection wholesale. */
  setSelections: (next: DataPointSelection[]) => void;
  /** Clear the selection (equivalent to `setSelections([])`). */
  clear: () => void;
}

const noop = () => {};
const EMPTY: DataPointSelection[] = [];

/**
 * Default value so a visual calling {@link useSelection} outside a provider degrades to
 * an inert "no selection" hub rather than throwing — a standalone chart just never
 * cross-filters.
 */
const SelectionContext = createContext<SelectionContextValue>({
  selections: EMPTY,
  applyInteraction: noop,
  setSelections: noop,
  clear: noop,
});

export interface SelectionProviderProps {
  /** Canonical selection, owned by the host app (e.g. derived from filter state). */
  selections: DataPointSelection[];
  /** Writer invoked whenever a visual or the host changes the selection. */
  onSelectionsChange: (next: DataPointSelection[]) => void;
  /** Workspace round-trip transport. Omit to use the in-process {@link localSelectionBus}. */
  host?: SelectionHost;
  children: ReactNode;
}

/**
 * Provide the selection hub and keep it in sync with the workspace {@link SelectionHost}.
 */
export function SelectionProvider({
  selections,
  onSelectionsChange,
  host = localSelectionBus,
  children,
}: SelectionProviderProps) {
  // Keep the freshest values reachable from the (stable) subscription closure.
  const selectionsRef = useRef(selections);
  selectionsRef.current = selections;
  const onChangeRef = useRef(onSelectionsChange);
  onChangeRef.current = onSelectionsChange;
  // The last value we accepted FROM the host — used to suppress republishing it.
  const lastReceivedRef = useRef<DataPointSelection[] | null>(null);

  // Subscribe once: fold selections pushed by sibling items into our state, unless we
  // are already in sync (structural compare) — that guards the receive side of the loop.
  useEffect(() => {
    return host.subscribe((incoming) => {
      if (selectionListsMatch(incoming, selectionsRef.current)) return;
      lastReceivedRef.current = incoming;
      onChangeRef.current(incoming);
    });
  }, [host]);

  // Publish our selection outward — but skip the publish when this exact value is the
  // one the host just handed us, so an incoming selection doesn't bounce straight back.
  useEffect(() => {
    if (lastReceivedRef.current && selectionListsMatch(selections, lastReceivedRef.current)) {
      lastReceivedRef.current = null;
      return;
    }
    host.publish(selections);
  }, [host, selections]);

  const value = useMemo<SelectionContextValue>(() => {
    const setSelections = (next: DataPointSelection[]) => onSelectionsChange(next);
    return {
      selections,
      setSelections,
      clear: () => onSelectionsChange([]),
      applyInteraction: (events) => onSelectionsChange(eventsToSelections(events)),
    };
  }, [selections, onSelectionsChange]);

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** Read the current selection hub. Safe to call outside a provider (inert default). */
export function useSelection(): SelectionContextValue {
  return useContext(SelectionContext);
}

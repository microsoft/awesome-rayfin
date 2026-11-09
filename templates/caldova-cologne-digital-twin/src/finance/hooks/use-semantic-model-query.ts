// The cockpit's `useSemanticModelQuery`, answered from the baked finance snapshot (SOURCE.md).
//
// Same interface as the original (connection, query -> data / isLoading / error / refetch), so the ported
// pages, the dwg pages and the vendor visuals are unchanged. No connector, no Rayfin client, no IndexedDB
// cache: the snapshot is one static file, precached by the twin's service worker for stages without WiFi.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { answer, loadFinanceSnapshot, type SemanticModelQueryResult } from '@finance/lib/snapshot';

interface UseSemanticModelQueryOptions {
  /** Kept for the original call sites (connector name `guv`); the snapshot has one source. */
  connection: string;
  /** DAX query text, exactly as the page builds it. Empty = idle. */
  query: string;
}

interface UseSemanticModelQueryResult {
  data: SemanticModelQueryResult | undefined;
  isLoading: boolean;
  error: Error | undefined;
  refetch: () => Promise<void>;
}

interface State {
  query: string;
  data: SemanticModelQueryResult | undefined;
  isLoading: boolean;
  error: Error | undefined;
}

export function useSemanticModelQuery({ connection, query }: UseSemanticModelQueryOptions): UseSemanticModelQueryResult {
  const active = Boolean(connection && query);
  const [state, setState] = useState<State>(() => ({ query, data: undefined, isLoading: active, error: undefined }));

  // Input changes reset during render (as the original), not from the effect.
  if (state.query !== query) {
    setState({ query, data: active ? state.data : undefined, isLoading: active, error: undefined });
  }

  const run = useCallback(async () => {
    if (!active) return;
    try {
      const snapshot = await loadFinanceSnapshot();
      const data = answer(snapshot, query);
      setState((s) => (s.query === query ? { query, data, isLoading: false, error: undefined } : s));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState((s) => (s.query === query ? { query, data: undefined, isLoading: false, error } : s));
    }
  }, [active, query]);

  useEffect(() => {
    void run();
  }, [run]);

  const refetch = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: active, error: undefined }));
    await run();
  }, [run, active]);

  // Stable identity: consumers memoise on the result object (cube, GuV model).
  return useMemo(
    () => ({ data: state.data, isLoading: state.isLoading, error: state.error, refetch }),
    [state.data, state.isLoading, state.error, refetch]
  );
}

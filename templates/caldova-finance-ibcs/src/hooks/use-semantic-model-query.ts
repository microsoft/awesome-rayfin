// The `useSemanticModelQuery` the generated dwg layer (src/dwg) imports, answered from the baked snapshot.
//
// Same interface as the connector's hook (connection, query -> data / isLoading / error / refetch), so the
// generated files stay untouched. No connector, no Rayfin client: the snapshot is one static file.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { answer, loadDwgSnapshot, type SemanticModelQueryResult } from '@/services/dwgSnapshot';

interface Options {
  /** The connector name the generated pages pass; the snapshot has one source. */
  connection: string;
  /** DAX query text, exactly as the page builds it. Empty = idle. */
  query: string;
}

interface Result {
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

export function useSemanticModelQuery({ connection, query }: Options): Result {
  const active = Boolean(connection && query);
  const [state, setState] = useState<State>(() => ({ query, data: undefined, isLoading: active, error: undefined }));

  // A new query resets during render, not from the effect.
  if (state.query !== query) {
    setState({ query, data: active ? state.data : undefined, isLoading: active, error: undefined });
  }

  const run = useCallback(async () => {
    if (!active) return;
    try {
      const data = answer(await loadDwgSnapshot(), query);
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

  return useMemo(
    () => ({ data: state.data, isLoading: state.isLoading, error: state.error, refetch }),
    [state.data, state.isLoading, state.error, refetch]
  );
}

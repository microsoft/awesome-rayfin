import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Polls a fetch function at the given interval.
 * Returns the latest data, a loading flag, error, and a manual refresh function.
 */
export function usePolling<T>(
  fetchFn: () => Promise<T>,
  intervalMs: number,
  enabled = true
): { data: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  const doFetch = useCallback(async () => {
    try {
      const result = await fetchRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    doFetch();
    const id = setInterval(doFetch, intervalMs);
    return () => clearInterval(id);
  }, [doFetch, intervalMs, enabled]);

  return { data, loading, error, refresh: doFetch };
}

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { DaxRow } from '@/data/model';
import {
  NeedsPowerBiSignIn,
  getTransport,
  needsPowerBiSignIn,
  runDax,
  subscribeToGateway,
} from '@/services/daxGateway';

export interface DaxQueryState {
  rows: DaxRow[];
  loading: boolean;
  error: string | null;
  /** True when the query cannot run until the user signs in to Power BI. */
  needsSignIn: boolean;
  /** Wall-clock time of the last successful response. */
  updatedAt: number | null;
  refetch: () => void;
}

/**
 * Run a DAX query, optionally on a timer.
 *
 * Polling is scheduled *after* each response rather than on a fixed interval, so a slow round
 * trip can never stack up overlapping requests against the Eventhouse. Transport selection
 * (Rayfin connector vs direct Power BI) is handled by the gateway.
 */
export function useDaxQuery(query: string | null, intervalMs = 0): DaxQueryState {
  const [rows, setRows] = useState<DaxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-run as soon as the gateway changes state - e.g. right after an interactive sign-in.
  const gatewayVersion = useSyncExternalStore(
    subscribeToGateway,
    () => `${getTransport() ?? 'auto'}:${needsPowerBiSignIn() ? 'anon' : 'auth'}`,
  );

  useEffect(() => {
    if (!query) {
      setRows([]);
      setError(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const result = await runDax(query);
        if (cancelled) return;
        setRows(result);
        setError(null);
        setNeedsSignIn(false);
        setUpdatedAt(Date.now());
      } catch (e) {
        if (cancelled) return;
        if (e instanceof NeedsPowerBiSignIn) {
          setNeedsSignIn(true);
          setError(null);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          // Keep polling while waiting for sign-in, but back off so the UI is not busy.
          if (intervalMs > 0) {
            timer.current = setTimeout(run, needsPowerBiSignIn() ? 5000 : intervalMs);
          }
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, intervalMs, nonce, gatewayVersion]);

  return { rows, loading, error, needsSignIn, updatedAt, refetch };
}

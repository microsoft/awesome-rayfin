import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { forecastWithAdjustments } from '@/domain/engine';
import { adjustableIds, effectiveAdjustments, frozenIdsFor, isSignedOff, latestSignOff } from '@/domain/lock';
import type { NewAdjustment, NewComment, NewSignOff, RecordStore, Records, SignOffRecord } from '@/domain/records';
import { periodMonths, type Period, type PeriodMode } from '@/domain/statements';
import type { Snapshot, Statement, Values } from '@/domain/types';
import { useAuth } from '@/hooks/AuthContext';
import { loadSnapshot } from '@/services/snapshot';
import { isController, storeFor } from '@/services/bootstrap';

export type CurrentCode = 'AC' | 'FC' | 'AC&FC';
export type Comparison = 'PL' | 'PY';

/** A line the user picked: opens the action drawer. */
export interface Selection {
  statement: Statement;
  accountId: string;
}

interface FinanceValue {
  snapshot: Snapshot;
  records: Records;
  /** AC up to the cut-off, then the forecast with every effective adjustment applied. */
  current: Values['FC'];
  period: Period;
  setMonth(month: string): void;
  setMode(mode: PeriodMode): void;
  comparison: Comparison;
  setComparison(c: Comparison): void;
  /** How the current column is labelled for the period: AC, FC, or AC&FC (YTD across the cut-off). */
  currentCode: CurrentCode;
  selection: Selection | null;
  select(s: Selection | null): void;
  /** The close the app works in (the snapshot's cut-off) and its state. */
  close: { period: string; signedOff: boolean; latest?: SignOffRecord };
  canSignOff: boolean;
  /** Re-read the records (before every write, and when the drawer opens). */
  refresh(): Promise<Records>;
  addAdjustment(a: Omit<NewAdjustment, 'period'>): Promise<void>;
  addComment(c: NewComment): Promise<void>;
  setClose(action: NewSignOff['action'], note?: string): Promise<void>;
  busy: boolean;
  error: string | null;
  clearError(): void;
}

const FinanceContext = createContext<FinanceValue | undefined>(undefined);

/** Raised in the UI when the close was signed off between opening the drawer and saving. */
export class CloseSignedOffError extends Error {
  constructor() {
    super('This close was signed off in the meantime. Ask a controller to reopen it.');
    this.name = 'CloseSignedOffError';
  }
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const store: RecordStore | null = useMemo(() => (user ? storeFor(user) : null), [user]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [records, setRecords] = useState<Records | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState<string | null>(null);
  const [mode, setMode] = useState<PeriodMode>('YTD');
  const [comparison, setComparison] = useState<Comparison>('PL');
  const [selection, select] = useState<Selection | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSnapshot()
      .then((s) => {
        if (cancelled) return;
        setSnapshot(s);
        setMonth(s.meta.cutoff);
      })
      .catch((e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!store) throw new Error('not signed in');
    const r = await store.readAll();
    setRecords(r);
    return r;
  }, [store]);

  useEffect(() => {
    if (!store) return;
    refresh().catch((e: unknown) => setLoadError(`The records could not be read: ${e instanceof Error ? e.message : String(e)}`));
  }, [store, refresh]);

  const current = useMemo(() => {
    if (!snapshot || !records) return null;
    return forecastWithAdjustments(snapshot, effectiveAdjustments(records.adjustments, records.signOffs, snapshot.meta.cutoff, adjustableIds(snapshot)));
  }, [snapshot, records]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo<FinanceValue | null>(() => {
    if (!snapshot || !records || !current || !month || !store || !user) return null;
    const cutoff = snapshot.meta.cutoff;
    const period = { month, mode };
    const ms = periodMonths(period);
    const currentCode: CurrentCode = ms.every((m) => m <= cutoff) ? 'AC' : ms.every((m) => m > cutoff) ? 'FC' : 'AC&FC';
    const ensureOpen = async () => {
      const fresh = await refresh();
      if (isSignedOff(fresh.signOffs, cutoff)) throw new CloseSignedOffError();
    };
    return {
      snapshot,
      records,
      current,
      period,
      setMonth,
      setMode,
      comparison,
      setComparison,
      currentCode,
      selection,
      select,
      close: { period: cutoff, signedOff: isSignedOff(records.signOffs, cutoff), latest: latestSignOff(records.signOffs, cutoff) },
      canSignOff: isController(user),
      refresh,
      busy,
      error,
      clearError: () => setError(null),
      addAdjustment: (a) =>
        run(async () => {
          await ensureOpen();
          await store.addAdjustment({ ...a, period: cutoff });
          await refresh();
        }),
      addComment: (c) =>
        run(async () => {
          await store.addComment(c);
          await refresh();
        }),
      setClose: (action, note) =>
        run(async () => {
          // Freeze what applies right now, from fresh records: an adjustment saved a moment ago is included.
          const fresh = await refresh();
          const frozenIds = action === 'sign-off' ? frozenIdsFor(fresh.adjustments, fresh.signOffs, cutoff, adjustableIds(snapshot)) : undefined;
          await store.addSignOff({ month: cutoff, action, note, frozenIds });
          await refresh();
        }),
    };
  }, [snapshot, records, current, month, mode, comparison, selection, store, user, refresh, busy, error, run]);

  if (loadError) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="font-semibold">The statements could not be loaded.</p>
          <p className="mt-2 text-sm text-muted">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!value) return <div className="grid h-full place-items-center text-muted">Loading the statements…</div>;
  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance(): FinanceValue {
  const v = useContext(FinanceContext);
  if (!v) throw new Error('useFinance must be used within a FinanceProvider');
  return v;
}

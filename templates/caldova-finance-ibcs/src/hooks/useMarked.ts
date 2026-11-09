import { useMemo } from 'react';

import type { Statement } from '@/domain/types';

import { useFinance } from './FinanceContext';

/**
 * Lines of a statement that carry a comment for the selected month, or (P&L) an adjustment in this close,
 * including the parents of such lines so a marker stays visible when the block is collapsed.
 */
export function useMarked(statement: Statement): ReadonlySet<string> {
  const { snapshot, records, period } = useFinance();
  return useMemo(() => {
    const ids = new Set<string>();
    for (const c of records.comments) if (c.statement === statement && c.month === period.month) ids.add(c.accountId);
    if (statement === 'PL') for (const a of records.adjustments) if (a.period === snapshot.meta.cutoff) ids.add(a.accountId);
    const parent = new Map(snapshot.accounts.map((a) => [a.id, a.parentId]));
    for (const id of [...ids]) for (let p = parent.get(id); p; p = parent.get(p)) ids.add(p);
    return ids;
  }, [records, snapshot, statement, period.month]);
}

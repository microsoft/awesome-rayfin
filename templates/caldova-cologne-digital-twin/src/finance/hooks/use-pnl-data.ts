import { useMemo } from 'react';

import { useSemanticModelQuery } from '@finance/hooks/use-semantic-model-query';
import type { KontoRow, KontoWert } from '@finance/lib/pnl/engine';
import {
  parseJahre,
  parseKonten,
  parseMonate,
  parseWerte,
  type JahrInfo,
  type MonatsWert,
} from '@finance/lib/pnl/data';
import { jahre, konten, kontowerte, monatsverlauf } from '@finance/queries/guv';

export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: T };

type QueryResult = ReturnType<typeof useSemanticModelQuery>;

function friendly(message: string): string {
  if (/401|403|forbidden|permission|unauthori/i.test(message))
    return 'No access to the finance data (snapshot of the semantic model "caldova-cologne-finance").';
  if (/capacity|429|throttl/i.test(message))
    return 'The Fabric capacity is busy right now. Please reload in a few minutes.';
  return message;
}

function unwrap<T>(q: QueryResult, parse: (t: { columns: { name: string }[]; rows: unknown[][] }) => T): Loadable<T> {
  if (q.error) return { status: 'error', message: friendly(q.error.message) };
  if (q.data?.status === 'error') return { status: 'error', message: friendly(q.data.error.message) };
  if (q.data?.status === 'success') return { status: 'ready', value: parse(q.data.table) };
  return { status: 'loading' };
}

export interface PnlData {
  konten: KontoRow[];
  werte: Map<string, KontoWert>;
  monate: MonatsWert[];
}

/** Account tree (once) plus values and monthly trend of the selected year. */
export function usePnlData(year: number | null) {
  const kq = konten();
  const yq = jahre();
  const wq = kontowerte(year ?? 0);
  const mq = monatsverlauf(year ?? 0);

  const kRes = useSemanticModelQuery(kq);
  const yRes = useSemanticModelQuery(yq);
  const wRes = useSemanticModelQuery({ connection: wq.connection, query: year ? wq.query : '' });
  const mRes = useSemanticModelQuery({ connection: mq.connection, query: year ? mq.query : '' });

  const years: Loadable<JahrInfo[]> = useMemo(() => unwrap(yRes, parseJahre), [yRes]);
  const data: Loadable<PnlData> = useMemo(() => {
    const k = unwrap(kRes, parseKonten);
    const w = unwrap(wRes, parseWerte);
    const m = unwrap(mRes, parseMonate);
    for (const x of [k, w, m]) if (x.status === 'error') return x;
    if (k.status === 'ready' && w.status === 'ready' && m.status === 'ready')
      return { status: 'ready', value: { konten: k.value, werte: w.value, monate: m.value } };
    return { status: 'loading' };
  }, [kRes, wRes, mRes]);

  return { years, data, refetch: () => Promise.all([kRes.refetch(), wRes.refetch(), mRes.refetch()]) };
}

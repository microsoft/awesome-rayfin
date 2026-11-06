import { useMemo } from 'react';

import { useSemanticModelQuery } from '@finance/hooks/use-semantic-model-query';
import type { Cube } from '@finance/lib/cockpit/cube';
import { buildCube } from '@finance/lib/cockpit/load';
import { cockpitQueries, connection } from '@finance/queries/cockpit';

export type CubeState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; cube: Cube };

function friendly(message: string): string {
  if (/401|403|forbidden|permission|unauthori/i.test(message))
    return 'No access to the finance data (snapshot of the semantic model "caldova-cologne-finance").';
  if (/capacity|429|throttl/i.test(message)) return 'The Fabric capacity is busy right now. Please reload in a few minutes.';
  return message;
}

/** Loads the six cockpit queries in parallel and builds the cube once. */
export function useCockpitData() {
  const info = useSemanticModelQuery({ connection, query: cockpitQueries.info });
  const kpis = useSemanticModelQuery({ connection, query: cockpitQueries.kpis });
  const maerkte = useSemanticModelQuery({ connection, query: cockpitQueries.maerkte });
  const produkte = useSemanticModelQuery({ connection, query: cockpitQueries.produkte });
  const szenarien = useSemanticModelQuery({ connection, query: cockpitQueries.szenarien });
  const wuerfel = useSemanticModelQuery({ connection, query: cockpitQueries.wuerfel });
  const vorjahr = useSemanticModelQuery({ connection, query: cockpitQueries.vorjahr });

  const all = [info, kpis, maerkte, produkte, szenarien, wuerfel, vorjahr];
  const done = all.filter((q) => q.data?.status === 'success').length;

  const state: CubeState = useMemo(() => {
    for (const q of [info, kpis, maerkte, produkte, szenarien, wuerfel, vorjahr]) {
      if (q.error) return { status: 'error', message: friendly(q.error.message) };
      if (q.data?.status === 'error') return { status: 'error', message: friendly(q.data.error.message) };
    }
    if (
      info.data?.status === 'success' &&
      kpis.data?.status === 'success' &&
      maerkte.data?.status === 'success' &&
      produkte.data?.status === 'success' &&
      wuerfel.data?.status === 'success' &&
      vorjahr.data?.status === 'success'
    ) {
      try {
        return {
          status: 'ready',
          cube: buildCube({
            info: info.data.table,
            kpis: kpis.data.table,
            maerkte: maerkte.data.table,
            produkte: produkte.data.table,
            wuerfel: wuerfel.data.table,
            vorjahr: vorjahr.data.table,
            szenarien: szenarien.data?.status === 'success' ? szenarien.data.table : undefined,
          }),
        };
      } catch (e) {
        return { status: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    }
    return { status: 'loading' };
  }, [info, kpis, maerkte, produkte, szenarien, wuerfel, vorjahr]);

  const refetch = () => Promise.all(all.map((q) => q.refetch()));
  return { state, progress: { done, total: all.length }, refetch };
}

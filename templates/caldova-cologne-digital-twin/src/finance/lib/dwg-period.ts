// Narrows a generated DWG page spec (Michael's P&L visual) to one year up to the
// last closed month, with a matching period line. The generated spec stays untouched.

import type { DwgPageSpec } from '@finance/dwg/dwg-page';
import { monthLabel } from '@finance/lib/pnl/format';

/** The statement spec for one year up to the last closed month (YTD). */
export function withPeriod(page: DwgPageSpec, year: number, lastMonth: number): DwgPageSpec {
  const months = Array.from({ length: Math.max(1, Math.min(12, lastMonth)) }, (_, i) => i + 1);
  const period = `Jan..${monthLabel(`${year}-${String(months.length).padStart(2, '0')}`)} ${year} (YTD), FY outlook`;
  return {
    ...page,
    filters: [
      { column: "'Calender'[Year]", values: [year] },
      { column: "'Calender'[Month]", values: months },
    ],
    tiles: page.tiles.map((t) => {
      const objects = { ...(t.objects ?? {}) } as Record<string, Record<string, unknown>>;
      objects.titleBlock = { ...(objects.titleBlock ?? {}), periodLine: period };
      return { ...t, objects: objects as DwgPageSpec['tiles'][number]['objects'] };
    }),
  };
}

// Which slice of the year the original P&L visual shows, and the exact queries it sends for it.
//
// The visual reads actuals only (dwg contract), so it shows January up to the selected month,
// capped at the year's last closed month: YTD for the income statement and the cash flow, the month end for the
// balance sheet (stock rows take the last period). The query manifest (tools/dwg-queries.ts) bakes every slice
// the app can ask for with these same functions, so a baked answer and the page's query cannot drift apart.
import { daxQuery } from '@/vendor/dwg-visuals/dwg-visuals.js';
import { tileFilters, type DwgPageSpec } from '@/dwg/dwg-page';
import { page as balance } from '@/dwg/pages/balance-sheet';
import { page as cashFlow } from '@/dwg/pages/cash-flow';
import { page as income } from '@/dwg/pages/income-statement';
import { monthLabel } from '@/domain/format';
import type { Month } from '@/domain/types';

export type StatementId = 'PL' | 'BS' | 'CF';
export const DWG_PAGES: Record<StatementId, DwgPageSpec> = { PL: income, BS: balance, CF: cashFlow };

export interface DwgSlice {
  year: number;
  /** Last month shown, 1..12 */
  lastMonth: number;
}

/** The slice for a selected month: its year, up to the month but never past that year's last closed month. */
export function dwgSlice(months: Month[], selected: string): DwgSlice | null {
  const year = Number(selected.slice(0, 4));
  const closed = months.filter((m) => m.year === year && m.closed).map((m) => m.monthNo);
  if (!closed.length) return null;
  return { year, lastMonth: Math.min(Number(selected.slice(5, 7)), Math.max(...closed)) };
}

/** Every slice the month picker can lead to: per year with a closed month, January .. each closed month. */
export function allSlices(months: Month[]): DwgSlice[] {
  const out: DwgSlice[] = [];
  for (const year of [...new Set(months.map((m) => m.year))].sort()) {
    const last = Math.max(0, ...months.filter((m) => m.year === year && m.closed).map((m) => m.monthNo));
    for (let m = 1; m <= last; m++) out.push({ year, lastMonth: m });
  }
  return out;
}

/** The page spec narrowed to the slice, with a matching period line in the visual's title block. */
export function withSlice(page: DwgPageSpec, id: StatementId, { year, lastMonth }: DwgSlice): DwgPageSpec {
  const end = monthLabel(`${year}-${String(lastMonth).padStart(2, '0')}`);
  const period = id === 'BS' ? `${end} month end vs previous year` : `Jan to ${end} (YTD)`;
  return {
    ...page,
    filters: [
      { column: "'Calendar'[Year]", values: [year] },
      { column: "'Calendar'[Month]", values: Array.from({ length: lastMonth }, (_, i) => i + 1) },
    ],
    tiles: page.tiles.map((t) => {
      const objects = { ...(t.objects ?? {}) } as Record<string, Record<string, unknown>>;
      objects.titleBlock = { ...(objects.titleBlock ?? {}), periodLine: period };
      return { ...t, objects: objects as DwgPageSpec['tiles'][number]['objects'] };
    }),
  };
}

/** The queries DwgPage sends for a narrowed spec: one per tile, no cross-filter selection. */
export function sliceQueries(spec: DwgPageSpec): { tile: string; query: string }[] {
  return spec.tiles.map((tile) => ({
    tile: tile.id,
    query: daxQuery(tile.visual, tile.bindings, {
      filters: tileFilters(spec, tile.id, null, []),
      sortBy: tile.sortBy,
      showItemsWithNoData: tile.showItemsWithNoData,
    }).query,
  }));
}

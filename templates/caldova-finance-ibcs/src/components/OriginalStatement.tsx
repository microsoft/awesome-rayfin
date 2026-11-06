// The statement as Michael Tenner's original P&L Statement byDatenWG visual draws it (dwg cli).
// Rendered through the generated src/dwg layer; only a copy of the page spec gets the selected year and months.
// The visual answers from the model's values baked at deploy, so it shows recorded actuals: no forecast
// adjustments, no comments, no drawer. Sized to fit the panel, never scrolling the page.
import { useMemo } from 'react';

import { DwgPage } from '@/dwg/DwgPage';
import { pageHeight, pageRegion, type DwgPageSpec } from '@/dwg/dwg-page';
import { DWG_PAGES, dwgSlice, withSlice, type StatementId } from '@/domain/dwgPeriod';
import { monthLabel } from '@/domain/format';
import { useFinance } from '@/hooks/FinanceContext';
import { useSize } from '@/hooks/useSize';

const TILE_STYLE = { border: 'none', padding: 0, background: 'transparent' };

function withFont(page: DwgPageSpec, fontPreset: 'hd' | 'fullhd'): DwgPageSpec {
  return {
    ...page,
    tiles: page.tiles.map((t) => {
      const objects = { ...(t.objects ?? {}) } as Record<string, Record<string, unknown>>;
      objects.style = { ...(objects.style ?? {}), fontPreset };
      return { ...t, objects: objects as DwgPageSpec['tiles'][number]['objects'] };
    }),
  };
}

export function OriginalStatement({ statement }: { statement: StatementId }) {
  const { snapshot, period } = useFinance();
  const [ref, size] = useSize<HTMLDivElement>();
  const slice = dwgSlice(snapshot.months, period.month);
  const base = useMemo(() => (slice ? withSlice(DWG_PAGES[statement], statement, slice) : null), [statement, slice?.year, slice?.lastMonth]); // eslint-disable-line react-hooks/exhaustive-deps
  const region = useMemo(() => (base ? pageRegion(base, true) : null), [base]);

  // Width-bound by default; on a short screen the height decides, so the visual never scrolls the page.
  const ratio = base && region ? pageHeight(base, 1000, region) / 1000 : 1;
  const width = Math.floor(Math.min(size.width, size.height / ratio));
  // The spec is laid out for a Full HD stage; below that, the visual's HD font preset keeps whole statements in view.
  const font = width < 1400 ? 'hd' : 'fullhd';
  const spec = useMemo(() => (base ? withFont(base, font) : null), [base, font]);
  const shown = slice ? `${monthLabel(`${slice.year}-${String(slice.lastMonth).padStart(2, '0')}`)}` : '';

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
      <p className="text-[12px] text-muted">
        P&L Statement byDatenWG, Michael Tenner's original visual (MIT) via dwg cli · {statement === 'BS' ? `${shown} month end` : `January to ${shown}`}
        {slice && `${slice.year}-${String(slice.lastMonth).padStart(2, '0')}` < period.month && ' (last closed month; the visual shows actuals only)'} · model
        values baked {new Date(snapshot.meta.bakedAt).toLocaleDateString('en-GB')}, without forecast adjustments
      </p>
      <div ref={ref} className="min-h-0 overflow-hidden">
        {!spec || !region ? (
          <p className="text-[13px] text-muted">No closed month in {period.month.slice(0, 4)}: the original visual shows actuals only.</p>
        ) : (
          width > 0 && (
            <div style={{ width }}>
              <DwgPage
                key={`${statement}-${slice?.year}-${slice?.lastMonth}`}
                page={spec}
                connection="statements"
                isDark={false}
                region={region}
                chipStyle={{ minHeight: 0 }}
                tileStyle={TILE_STYLE}
              />
            </div>
          )
        )}
      </div>
    </div>
  );
}

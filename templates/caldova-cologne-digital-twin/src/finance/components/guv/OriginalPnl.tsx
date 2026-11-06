// Michael's original P&L Statement byDatenWG inside the P&L tile of P&L & Simulation
// (formerly the pages P&L statement and P&L tree; the visual has its own statement
// and tree view). Rendered through the generated src/dwg layer, which stays untouched:
// only a copy of the page spec gets the page's year, the closed months and the user's
// variance palette. The visual shows YTD actuals with its own full-year outlook.

import { useMemo, type ReactNode } from 'react';

import { DwgPage } from '@finance/dwg/DwgPage';
import { pageRegion } from '@finance/dwg/dwg-page';
import { page as statement } from '@finance/dwg/pages/guv-statement';
import { useShell } from '@finance/hooks/shell.context';
import { useTheme } from '@finance/hooks/theme.context';
import { withPalette } from '@finance/lib/dwg-palette';
import { withPeriod } from '@finance/lib/dwg-period';
import { monthLabel } from '@finance/lib/pnl/format';

export function OriginalPnl({ year, lastActual, toolbar }: { year: number; lastActual: string; toolbar: ReactNode }) {
  const { palette } = useShell();
  const { isDark } = useTheme();
  const lastMonth = Number(lastActual.slice(5, 7)) || 12;
  const spec = useMemo(() => withPalette(withPeriod(statement, year, lastMonth), palette, isDark), [year, lastMonth, palette, isDark]);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-200 border-b border-border px-400 py-300">
        <div>
          <h2 className="font-heading text-400 font-semibold">Income statement</h2>
          <p className="text-200 text-muted-foreground">
            P&L Statement byDatenWG (original code) · Jan..{monthLabel(`${year}-${String(lastMonth).padStart(2, '0')}`)} {year} with outlook · model values, without forecast adjustments and simulation
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-200">{toolbar}</div>
      </div>
      <div className="px-300 pb-300">
        {/* Caldova: the spec sits on the Full HD pixel grid (header and footer zones); only its content zone
            is drawn here, so there is no empty header band above the visual. */}
        <DwgPage key={`${year}-${lastMonth}-${palette}`} page={spec} connection="guv" isDark={isDark} region={pageRegion(spec, true)} chipStyle={{ minHeight: 0 }} />
      </div>
    </div>
  );
}

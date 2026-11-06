// Applies the user's variance palette to the style settings of the original
// P&L visual in a generated DWG page spec (the spec itself stays untouched).
// The same colours as global.css, so all pages share one notation.

import type { DwgPageSpec } from '@finance/dwg/dwg-page';
import type { PaletteId } from '@finance/lib/palette';

const COLORS: Record<PaletteId, { light: [string, string]; dark: [string, string] }> = {
  ibcs: { light: ['#5DBB2C', '#C0392B'], dark: ['#7FCF55', '#E4635F'] },
  cvd: { light: ['#1F6FB5', '#C0392B'], dark: ['#5AA0E0', '#E4635F'] },
  teal: { light: ['#117865', '#C0392B'], dark: ['#3AA58F', '#E4635F'] },
};

/** Power BI fill value as the visual reads it from its objects. */
const fill = (color: string) => ({ solid: { color } });

export function withPalette(page: DwgPageSpec, palette: PaletteId, isDark: boolean): DwgPageSpec {
  return {
    ...page,
    tiles: page.tiles.map((t) => {
      const objects = { ...(t.objects ?? {}) } as Record<string, Record<string, unknown>>;
      const style = { ...(objects.style ?? {}) };
      // Explicit colours in every mode, so the visual never falls back to its own constants.
      const [good, bad] = COLORS[palette][isDark ? 'dark' : 'light'];
      style.colorMode = palette === 'teal' ? 'teal' : 'ibcs';
      style.goodColor = fill(good);
      style.badColor = fill(bad);
      objects.style = style;
      return { ...t, objects: objects as DwgPageSpec['tiles'][number]['objects'] };
    }),
  };
}

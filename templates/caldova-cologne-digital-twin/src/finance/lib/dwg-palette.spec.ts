// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { DwgPageSpec } from '@finance/dwg/dwg-page';

import { withPalette } from './dwg-palette';

const page = { name: 'p', width: 1, height: 1, background: '#fff', filters: [], tiles: [{ id: 't', visual: 'pnl', rect: [0, 0, 1, 1], bindings: {}, objects: { style: { colorMode: 'teal', density: 'compact' } } }] } as unknown as DwgPageSpec;
const style = (p: DwgPageSpec) => (p.tiles[0].objects as Record<string, Record<string, unknown>>).style;

describe('withPalette', () => {
  it('passes explicit colours in every palette and keeps other settings', () => {
    expect(style(withPalette(page, 'cvd', false))).toMatchObject({ colorMode: 'ibcs', density: 'compact', goodColor: { solid: { color: '#1F6FB5' } } });
    expect(style(withPalette(page, 'ibcs', true)).goodColor).toEqual({ solid: { color: '#7FCF55' } });
    expect(style(withPalette(page, 'ibcs', false)).goodColor).toEqual({ solid: { color: '#5DBB2C' } });
    expect(style(withPalette(page, 'teal', false))).toMatchObject({ colorMode: 'teal', goodColor: { solid: { color: '#117865' } }, badColor: { solid: { color: '#C0392B' } } });
  });
  it('does not mutate the generated spec', () => {
    withPalette(page, 'cvd', false);
    expect(style(page)).toEqual({ colorMode: 'teal', density: 'compact' });
  });
});

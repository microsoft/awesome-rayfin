// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCatalogue } from '../cockpit/kpis';
import { buildCube, type QueryTableLike } from '../cockpit/load';
import { buildCockpitDeck } from './pptx';

const insp = resolve(__dirname, '../../../../../inspection');
const names = ['info', 'kpis', 'maerkte', 'produkte', 'wuerfel', 'vorjahr', 'szenarien'] as const;
const has = names.every((n) => existsSync(resolve(insp, `${n}.result.json`)));
const read = (n: string): QueryTableLike => JSON.parse(readFileSync(resolve(insp, `${n}.result.json`), 'utf8')).result.table;

describe.skipIf(!has)('PowerPoint export', () => {
  it('produces a valid pptx (zip) with two slides from the real model export', async () => {
    const cube = buildCube({ info: read('info'), kpis: read('kpis'), maerkte: read('maerkte'), produkte: read('produkte'), wuerfel: read('wuerfel'), vorjahr: read('vorjahr'), szenarien: read('szenarien') });
    const catalogue = buildCatalogue(cube);
    const pptx = await buildCockpitDeck({
      cube,
      catalogue,
      kpi: catalogue.find((k) => k.id === 'Revenue')!,
      months: [1, 2, 3, 4, 5, 6, 7, 8],
      filter: { markets: null, products: null },
      choice: { plan: 'PL1', fc: 'FC3' },
      ref: 'PL',
      periodLabel: 'Jan..Aug 2026',
      filterLabel: '',
      colors: { good: '#5dbb2c', bad: '#c0392b' },
    });
    const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(buf.toString('latin1')).toContain('ppt/slides/slide2.xml');
    expect(buf.length).toBeGreaterThan(20_000);
  });
});

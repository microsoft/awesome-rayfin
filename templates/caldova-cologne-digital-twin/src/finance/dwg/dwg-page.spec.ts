// dwg: tests of the page helpers. Written by `dwg app page`, replaced on every run; patched by tools/finance/dwg-english.mjs.
import { describe, expect, it } from 'vitest';

import { daxQuery } from '../vendor/dwg-visuals/dwg-visuals.js';
import {
  combineFilters,
  findPage,
  formatSlicerValue,
  isEmptyValue,
  MIN_STAGE_WIDTH,
  navGroups,
  normColumn,
  pageHeight,
  pageId,
  pageLabel,
  pageRegion,
  RESOLUTION_WIDTH,
  sameValues,
  selectionFilters,
  selectionLabel,
  slicerDefaults,
  slicerFilters,
  slicerQuery,
  slicerValues,
  stageScale,
  stagePage,
  tileBox,
  tileFilters,
  toggleSlicerValue,
  withoutHeaders,
  type DwgAppSpec,
  type DwgPageSpec,
  type DwgSlicerSpec,
} from './dwg-page';

const page: DwgPageSpec = {
  name: 'Test',
  width: 1920,
  height: 1080,
  filters: [{ column: "'Calender'[Year]", values: [2026] }],
  tiles: [
    { id: 'a', visual: 'chartkitchen', rect: [0, 0, 960, 540], bindings: { category: "'Calender'[Month Name Short]", actual: "'Sales Demo'[AC]" } },
    { id: 'b', visual: 'chartkitchen', rect: [960, 0, 960, 540], bindings: { category: "'Sales Demo'[Country]", actual: "'Sales Demo'[AC]" } },
  ],
};

describe('dwg-page', () => {
  it('turns a selection into TREATAS filters per column', () => {
    const f = selectionFilters({ tile: 'a', keys: [{ 'Calender[Month Name Short]': 'Mar' }, { 'Calender[Month Name Short]': 'Apr' }] });
    expect(f).toEqual([{ column: "'Calender'[Month Name Short]", values: ['Mar', 'Apr'] }]);
  });

  it('filters only the other tiles, page filters apply everywhere', () => {
    const sel = { tile: 'a', keys: [{ 'Calender[Month Name Short]': 'Mar' }] };
    expect(tileFilters(page, 'a', sel)).toHaveLength(1);
    expect(tileFilters(page, 'b', sel)).toHaveLength(2);
    const q = daxQuery('chartkitchen', page.tiles[1].bindings, { filters: tileFilters(page, 'b', sel) });
    expect(q.query).toContain(`TREATAS({"Mar"}, 'Calender'[Month Name Short])`);
    expect(q.query).toContain(`TREATAS({2026}, 'Calender'[Year])`);
  });

  it('applies a tile\'s own filters to that tile only', () => {
    const p: DwgPageSpec = {
      ...page,
      tiles: [page.tiles[0], { ...page.tiles[1], filters: [{ column: "'Sales Demo'[Country]", values: ['DE', 'AT'] }] }],
    };
    expect(tileFilters(p, 'a', null)).toHaveLength(1);
    expect(tileFilters(p, 'b', null)).toEqual([...page.filters!, { column: "'Sales Demo'[Country]", values: ['DE', 'AT'] }]);
    const sel = { tile: 'a', keys: [{ 'Calender[Month Name Short]': 'Mar' }] };
    expect(tileFilters(p, 'b', sel)).toHaveLength(3);
  });

  it('labels the filter chip', () => {
    expect(selectionLabel({ tile: 'a', keys: [{ 'Sales Demo[Country]': 'DE' }] })).toBe('Country: DE');
    expect(selectionLabel(null)).toBe('');
  });

  it('scales tiles like Power BI and stacks them on narrow screens', () => {
    expect(tileBox(page.tiles[1], page, 960)).toEqual({ position: 'absolute', left: 480, top: 0, width: 480, height: 270 });
    expect(tileBox(page.tiles[1], page, 600).position).toBe('relative');
  });

  it('shows only the content area without frame zones in fluid mode', () => {
    const framed: DwgPageSpec = {
      ...page,
      zones: {
        header: { x: 0, y: 0, w: 1920, h: 96 },
        filter: { x: 0, y: 96, w: 300, h: 948 },
        footer: { x: 0, y: 1044, w: 1920, h: 36 },
        content: { x: 327, y: 123, w: 1566, h: 894 },
      },
    };
    const region = pageRegion(framed, true);
    expect(region).toEqual({ x: 300, y: 96, w: 1620, h: 948 });
    expect(pageRegion(framed)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    const tile = { ...page.tiles[0], rect: [327, 123, 1566, 134] as [number, number, number, number] };
    // 1620 page pixels on 1215 screen pixels: scale 3/4
    expect(tileBox(tile, framed, 1215, 900, region)).toEqual({ position: 'absolute', left: 20.25, top: 20.25, width: 1174.5, height: 100.5 });
    expect(pageHeight(framed, 1215, region)).toBe(711);
  });

  it('transfers a Full HD page pixel-exact into the HD grid (pixelgrid)', () => {
    const chrome = {
      header: { on: true, h: 64 },
      filter: { on: true, side: 'left' as const, w: 200 },
      footer: { on: true, h: 24 },
    };
    const fhd: DwgPageSpec = {
      ...page,
      zones: {
        header: { x: 0, y: 0, w: 1920, h: 96 },
        filter: { x: 0, y: 96, w: 300, h: 948 },
        footer: { x: 0, y: 1044, w: 1920, h: 36 },
        content: { x: 327, y: 123, w: 1566, h: 894 },
      },
      tiles: [
        { ...page.tiles[0], rect: [327, 123, 1566, 134] },
        { ...page.tiles[1], rect: [327, 275, 1566, 742] },
      ],
    };
    const hd = stagePage(fhd, 1280, chrome);
    expect([hd.width, hd.height]).toEqual([1280, 720]);
    expect(hd.zones?.content).toEqual({ x: 218, y: 80, w: 1044, h: 600 });
    expect(hd.tiles.map((t) => t.rect)).toEqual([
      [218, 80, 1044, 90],
      [218, 182, 1044, 498],
    ]);
    expect(stagePage(fhd, 1920, chrome)).toBe(fhd);
  });

  it('scales the stage uniformly, with a minimum factor instead of shrinking further', () => {
    expect(RESOLUTION_WIDTH).toEqual({ fullhd: 1920, hd: 1280 });
    expect(stageScale(1920, 1920)).toBe(1);
    expect(stageScale(1440, 1920)).toBe(0.75);
    expect(stageScale(1000, 1920)).toBe(MIN_STAGE_WIDTH / 1920);
    expect(stageScale(1440, 1280)).toBe(1.125);
    expect(stageScale(5000, 1920)).toBe(2);
  });

  it('hides the visuals\' title blocks and toolbars without losing other objects', () => {
    const ck = withoutHeaders('chartkitchen', { chart: { orientation: 'cards' }, ibcsTitle: { kpi: 'Revenue' } });
    expect(ck).toEqual({
      chart: { orientation: 'cards', chartButtons: false, cumulativeButton: false },
      ibcsTitle: { kpi: 'Revenue', show: false },
    });
    expect(withoutHeaders('pnl', { titleBlock: { measureLine: 'P&L' } })).toEqual({
      titleBlock: { measureLine: 'P&L', show: false },
      toolbar: { show: false },
    });
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
  });
});

const slicers: DwgSlicerSpec[] = [
  { column: "'Calender'[Year]", label: 'Year', default: [2026] },
  { column: "'Sales Demo'[Country]", label: 'Country', multi: true },
  { column: "'Calender'[Month Name Short]", label: 'Month', multi: true, sortBy: "'Calender'[Month]" },
];

describe('dwg-page · Slicer', () => {
  it('starts with the defaults, "all" does not filter', () => {
    const state = slicerDefaults(slicers);
    expect(state).toEqual({ "'Calender'[Year]": [2026], "'Sales Demo'[Country]": [], "'Calender'[Month Name Short]": [] });
    expect(slicerFilters(slicers, state)).toEqual([{ column: "'Calender'[Year]", values: [2026] }]);
  });

  it('single select replaces, multi-select toggles', () => {
    expect(toggleSlicerValue(slicers[0], [2026], 2025)).toEqual([2025]);
    expect(toggleSlicerValue(slicers[0], [2026], 2026)).toEqual([]);
    expect(toggleSlicerValue(slicers[1], ['DE'], 'AT')).toEqual(['DE', 'AT']);
    expect(toggleSlicerValue(slicers[1], ['DE', 'AT'], 'DE')).toEqual(['AT']);
    expect(sameValues(['DE', 'AT'], ['AT', 'DE'])).toBe(true);
    expect(sameValues([2026], ['2026'])).toBe(false);
  });

  it('slicers apply to every tile, together with cross-filter and page filter', () => {
    const extra = slicerFilters(slicers, { ...slicerDefaults(slicers), "'Sales Demo'[Country]": ['DE', 'AT'] });
    const sel = { tile: 'a', keys: [{ 'Calender[Month Name Short]': 'Mar' }] };
    // page filter and slicer on the same column (Year): one TREATAS list, intersection
    expect(tileFilters(page, 'a', sel, extra)).toEqual([
      { column: "'Calender'[Year]", values: [2026] },
      { column: "'Sales Demo'[Country]", values: ['DE', 'AT'] },
    ]);
    const q = daxQuery('chartkitchen', page.tiles[1].bindings, { filters: tileFilters(page, 'b', sel, extra) });
    expect(q.query).toContain(`TREATAS({"DE", "AT"}, 'Sales Demo'[Country])`);
    expect(q.query).toContain(`TREATAS({"Mar"}, 'Calender'[Month Name Short])`);
    expect(q.query.match(/'Calender'\[Year\]\)/g)).toHaveLength(1);
  });

  it('an empty intersection filters on BLANK', () => {
    expect(combineFilters([{ column: "'Calender'[Year]", values: [2025] }], [{ column: 'Calender[Year]', values: [2026] }])).toEqual([
      { column: "'Calender'[Year]", values: [null] },
    ]);
    expect(normColumn('Calender[Year]')).toBe("'Calender'[Year]");
  });

  it('queries the value list with DAX and reads it from the result', () => {
    expect(slicerQuery(slicers[0])).toBe("EVALUATE\nSUMMARIZECOLUMNS('Calender'[Year])\nORDER BY 'Calender'[Year]");
    expect(slicerQuery(slicers[2])).toBe(
      "EVALUATE\nSUMMARIZECOLUMNS('Calender'[Month Name Short], 'Calender'[Month])\nORDER BY 'Calender'[Month], 'Calender'[Month Name Short]"
    );
    expect(() => slicerQuery({ column: 'Year', label: 'Year' })).toThrow(/not a column reference/);
    const table = {
      columns: [{ name: 'Calender[Month Name Short]' }, { name: 'Calender[Month]' }],
      rows: [['Jan', 1], ['Feb', 2], ['Feb', 2]],
    };
    expect(slicerValues(table, slicers[2])).toEqual(['Jan', 'Feb']);
  });

  it('shows values en-GB, years without thousands separator', () => {
    expect(formatSlicerValue(2026)).toBe('2026');
    expect(formatSlicerValue(1234.5)).toBe('1,234.5');
    expect(formatSlicerValue('2026-03-01T00:00:00')).toBe('01/03/2026');
    expect(formatSlicerValue(null)).toBe('(blank)');
  });
});

describe('dwg-page · Navigation', () => {
  const p = (name: string, template?: string, group?: string): DwgPageSpec => ({ ...page, name, template, group });
  const app: DwgAppSpec = {
    name: 'Showcase',
    slicers,
    resolution: 'fullhd',
    visualHeaders: false,
    pages: [p('Cards', 'C01', 'ChartKitchen · Overview'), p('Columns', 'C03', 'ChartKitchen · Trend'), p('Line', 'C04', 'ChartKitchen · Trend'), p('C13 Table', 'C13', 'ChartKitchen · Overview'), p('No group')],
  };

  it('assigns pages to groups in the order of first appearance', () => {
    expect(navGroups(app.pages).map((g) => [g.group, g.pages.map(pageId)])).toEqual([
      ['ChartKitchen · Overview', ['c01', 'c13']],
      ['ChartKitchen · Trend', ['c03', 'c04']],
      ['Pages', ['no-group']],
    ]);
  });

  it('labels pages with the template id without doubling it', () => {
    expect(pageLabel(app.pages[1])).toBe('C03 Columns');
    expect(pageLabel(app.pages[3])).toBe('C13 Table');
    expect(pageLabel(app.pages[4])).toBe('No group');
  });

  it('finds the page for the link, else the first', () => {
    expect(findPage(app, '#c04').name).toBe('Line');
    expect(findPage(app, '#no-group').name).toBe('No group');
    expect(findPage(app, '#missing').name).toBe('Cards');
    expect(findPage(app, '').name).toBe('Cards');
  });
});

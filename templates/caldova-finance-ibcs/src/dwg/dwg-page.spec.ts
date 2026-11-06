// dwg: Tests der Seiten-Hilfsfunktionen. Von `dwg app page` geschrieben, wird bei jedem Lauf ersetzt.
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
  it('macht aus einer Auswahl TREATAS-Filter je Spalte', () => {
    const f = selectionFilters({ tile: 'a', keys: [{ 'Calender[Month Name Short]': 'Mär' }, { 'Calender[Month Name Short]': 'Apr' }] });
    expect(f).toEqual([{ column: "'Calender'[Month Name Short]", values: ['Mär', 'Apr'] }]);
  });

  it('filtert nur die anderen Kacheln, die Seitenfilter gelten überall', () => {
    const sel = { tile: 'a', keys: [{ 'Calender[Month Name Short]': 'Mär' }] };
    expect(tileFilters(page, 'a', sel)).toHaveLength(1);
    expect(tileFilters(page, 'b', sel)).toHaveLength(2);
    const q = daxQuery('chartkitchen', page.tiles[1].bindings, { filters: tileFilters(page, 'b', sel) });
    expect(q.query).toContain(`TREATAS({"Mär"}, 'Calender'[Month Name Short])`);
    expect(q.query).toContain(`TREATAS({2026}, 'Calender'[Year])`);
  });

  it('nimmt eigene Kachelfilter nur in diese Kachel mit', () => {
    const p: DwgPageSpec = {
      ...page,
      tiles: [page.tiles[0], { ...page.tiles[1], filters: [{ column: "'Sales Demo'[Country]", values: ['DE', 'AT'] }] }],
    };
    expect(tileFilters(p, 'a', null)).toHaveLength(1);
    expect(tileFilters(p, 'b', null)).toEqual([...page.filters!, { column: "'Sales Demo'[Country]", values: ['DE', 'AT'] }]);
    const sel = { tile: 'a', keys: [{ 'Calender[Month Name Short]': 'Mär' }] };
    expect(tileFilters(p, 'b', sel)).toHaveLength(3);
  });

  it('beschriftet den Filter-Chip', () => {
    expect(selectionLabel({ tile: 'a', keys: [{ 'Sales Demo[Country]': 'DE' }] })).toBe('Country: DE');
    expect(selectionLabel(null)).toBe('');
  });

  it('skaliert Kacheln wie Power BI und stapelt sie auf schmalen Bildschirmen', () => {
    expect(tileBox(page.tiles[1], page, 960)).toEqual({ position: 'absolute', left: 480, top: 0, width: 480, height: 270 });
    expect(tileBox(page.tiles[1], page, 600).position).toBe('relative');
  });

  it('zeigt im fließenden Modus nur den Inhaltsbereich ohne Rahmen-Zonen', () => {
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
    // 1620 Seitenpixel auf 1215 Bildschirmpixel: Maßstab 3/4
    expect(tileBox(tile, framed, 1215, 900, region)).toEqual({ position: 'absolute', left: 20.25, top: 20.25, width: 1174.5, height: 100.5 });
    expect(pageHeight(framed, 1215, region)).toBe(711);
  });

  it('überträgt eine Full-HD-Seite pixelgenau ins HD-Raster (pixelgrid)', () => {
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

  it('skaliert die Bühne gleichmäßig, mit Mindestfaktor statt weiter zu schrumpfen', () => {
    expect(RESOLUTION_WIDTH).toEqual({ fullhd: 1920, hd: 1280 });
    expect(stageScale(1920, 1920)).toBe(1);
    expect(stageScale(1440, 1920)).toBe(0.75);
    expect(stageScale(1000, 1920)).toBe(MIN_STAGE_WIDTH / 1920);
    expect(stageScale(1440, 1280)).toBe(1.125);
    expect(stageScale(5000, 1920)).toBe(2);
  });

  it('blendet Titelblöcke und Bedienleisten der Visuals aus, ohne andere Objekte zu verlieren', () => {
    const ck = withoutHeaders('chartkitchen', { chart: { orientation: 'cards' }, ibcsTitle: { kpi: 'Umsatz' } });
    expect(ck).toEqual({
      chart: { orientation: 'cards', chartButtons: false, cumulativeButton: false },
      ibcsTitle: { kpi: 'Umsatz', show: false },
    });
    expect(withoutHeaders('pnl', { titleBlock: { measureLine: 'GuV' } })).toEqual({
      titleBlock: { measureLine: 'GuV', show: false },
      toolbar: { show: false },
    });
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
  });
});

const slicers: DwgSlicerSpec[] = [
  { column: "'Calender'[Year]", label: 'Jahr', default: [2026] },
  { column: "'Sales Demo'[Country]", label: 'Land', multi: true },
  { column: "'Calender'[Month Name Short]", label: 'Monat', multi: true, sortBy: "'Calender'[Month]" },
];

describe('dwg-page · Slicer', () => {
  it('startet mit den Standardwerten, „alle“ filtert nicht', () => {
    const state = slicerDefaults(slicers);
    expect(state).toEqual({ "'Calender'[Year]": [2026], "'Sales Demo'[Country]": [], "'Calender'[Month Name Short]": [] });
    expect(slicerFilters(slicers, state)).toEqual([{ column: "'Calender'[Year]", values: [2026] }]);
  });

  it('Einfachauswahl ersetzt, Mehrfachauswahl schaltet um', () => {
    expect(toggleSlicerValue(slicers[0], [2026], 2025)).toEqual([2025]);
    expect(toggleSlicerValue(slicers[0], [2026], 2026)).toEqual([]);
    expect(toggleSlicerValue(slicers[1], ['DE'], 'AT')).toEqual(['DE', 'AT']);
    expect(toggleSlicerValue(slicers[1], ['DE', 'AT'], 'DE')).toEqual(['AT']);
    expect(sameValues(['DE', 'AT'], ['AT', 'DE'])).toBe(true);
    expect(sameValues([2026], ['2026'])).toBe(false);
  });

  it('Slicer gelten für alle Kacheln, zusammen mit Querfilter und Seitenfilter', () => {
    const extra = slicerFilters(slicers, { ...slicerDefaults(slicers), "'Sales Demo'[Country]": ['DE', 'AT'] });
    const sel = { tile: 'a', keys: [{ 'Calender[Month Name Short]': 'Mär' }] };
    // Seitenfilter und Slicer auf dieselbe Spalte (Year): eine TREATAS-Liste, Schnittmenge
    expect(tileFilters(page, 'a', sel, extra)).toEqual([
      { column: "'Calender'[Year]", values: [2026] },
      { column: "'Sales Demo'[Country]", values: ['DE', 'AT'] },
    ]);
    const q = daxQuery('chartkitchen', page.tiles[1].bindings, { filters: tileFilters(page, 'b', sel, extra) });
    expect(q.query).toContain(`TREATAS({"DE", "AT"}, 'Sales Demo'[Country])`);
    expect(q.query).toContain(`TREATAS({"Mär"}, 'Calender'[Month Name Short])`);
    expect(q.query.match(/'Calender'\[Year\]\)/g)).toHaveLength(1);
  });

  it('Schnittmenge ohne Treffer filtert auf BLANK', () => {
    expect(combineFilters([{ column: "'Calender'[Year]", values: [2025] }], [{ column: 'Calender[Year]', values: [2026] }])).toEqual([
      { column: "'Calender'[Year]", values: [null] },
    ]);
    expect(normColumn('Calender[Year]')).toBe("'Calender'[Year]");
  });

  it('fragt die Werteliste per DAX ab und liest sie aus dem Ergebnis', () => {
    expect(slicerQuery(slicers[0])).toBe("EVALUATE\nSUMMARIZECOLUMNS('Calender'[Year])\nORDER BY 'Calender'[Year]");
    expect(slicerQuery(slicers[2])).toBe(
      "EVALUATE\nSUMMARIZECOLUMNS('Calender'[Month Name Short], 'Calender'[Month])\nORDER BY 'Calender'[Month], 'Calender'[Month Name Short]"
    );
    expect(() => slicerQuery({ column: 'Jahr', label: 'Jahr' })).toThrow(/keine Spaltenreferenz/);
    const table = {
      columns: [{ name: 'Calender[Month Name Short]' }, { name: 'Calender[Month]' }],
      rows: [['Jan', 1], ['Feb', 2], ['Feb', 2]],
    };
    expect(slicerValues(table, slicers[2])).toEqual(['Jan', 'Feb']);
  });

  it('zeigt Werte deutsch an, Jahre ohne Tausenderpunkt', () => {
    expect(formatSlicerValue(2026)).toBe('2026');
    expect(formatSlicerValue(1234.5)).toBe('1.234,5');
    expect(formatSlicerValue('2026-03-01T00:00:00')).toBe('01.03.2026');
    expect(formatSlicerValue(new Date(2026, 2, 1))).toBe('01.03.2026');
    expect(formatSlicerValue(null)).toBe('(leer)');
  });

  it('Datum aus Slicer (ISO-Text) und Klick (Date) ergeben dieselbe Schnittmenge und DATE-Literale', () => {
    const datum = "'Kalender'[Datum]";
    const types = { [datum]: 'dateTime', "'Kunde'[Code]": 'string' };
    const table = { columns: [{ name: 'Kalender[Datum]' }], rows: [['2026-02-01T00:00:00'], ['2026-03-01T00:00:00']] };
    const values = slicerValues(table, { column: datum, label: 'Monat' }, 'dateTime');
    expect(values.every((v) => v instanceof Date)).toBe(true);
    const slicer = slicerFilters([{ column: datum, label: 'Monat' }], { [datum]: values }, types);
    const click = selectionFilters({ tile: 'a', keys: [{ 'Kalender[Datum]': new Date(2026, 2, 1) }] });
    const both = combineFilters(slicer, click);
    expect(both).toHaveLength(1);
    expect(both[0].values).toHaveLength(1);
    const q = daxQuery('chartkitchen', { category: "'Kunde'[Code]", actual: '[AC]' }, { filters: both });
    expect(q.query).toContain(`TREATAS({DATE(2026, 3, 1)}, 'Kalender'[Datum])`);
    // Startauswahl der Spec als ISO-Text wird Date, wie die Werteliste
    expect(slicerDefaults([{ column: datum, label: 'Monat', default: ['2026-03-01'] }], types)[datum][0]).toBeInstanceOf(Date);
    // Textspalte mit datumsähnlichen Werten bleibt Text
    const page2: DwgPageSpec = { ...page, filters: [{ column: "'Kunde'[Code]", values: ['2026-01-01'] }], columnTypes: types };
    expect(daxQuery('chartkitchen', { category: "'Kunde'[Code]", actual: '[AC]' }, { filters: tileFilters(page2, 'a', null) }).query).toContain(
      `TREATAS({"2026-01-01"}, 'Kunde'[Code])`
    );
  });
});

describe('dwg-page · Navigation', () => {
  const p = (name: string, template?: string, group?: string): DwgPageSpec => ({ ...page, name, template, group });
  const app: DwgAppSpec = {
    name: 'Showcase',
    slicers,
    resolution: 'fullhd',
    visualHeaders: false,
    pages: [p('Karten', 'C01', 'ChartKitchen · Überblick'), p('Säulen', 'C03', 'ChartKitchen · Zeitverlauf'), p('Linie', 'C04', 'ChartKitchen · Zeitverlauf'), p('C13 Tabelle', 'C13', 'ChartKitchen · Überblick'), p('Ohne Gruppe')],
  };

  it('ordnet Seiten Gruppen zu, in der Reihenfolge des ersten Auftretens', () => {
    expect(navGroups(app.pages).map((g) => [g.group, g.pages.map(pageId)])).toEqual([
      ['ChartKitchen · Überblick', ['c01', 'c13']],
      ['ChartKitchen · Zeitverlauf', ['c03', 'c04']],
      ['Seiten', ['ohne-gruppe']],
    ]);
  });

  it('beschriftet Seiten mit Template-Kennung, ohne sie zu verdoppeln', () => {
    expect(pageLabel(app.pages[1])).toBe('C03 Säulen');
    expect(pageLabel(app.pages[3])).toBe('C13 Tabelle');
    expect(pageLabel(app.pages[4])).toBe('Ohne Gruppe');
  });

  it('findet die Seite zum Link, sonst die erste', () => {
    expect(findPage(app, '#c04').name).toBe('Linie');
    expect(findPage(app, '#ohne-gruppe').name).toBe('Ohne Gruppe');
    expect(findPage(app, '#gibtsnicht').name).toBe('Karten');
    expect(findPage(app, '').name).toBe('Karten');
  });
});

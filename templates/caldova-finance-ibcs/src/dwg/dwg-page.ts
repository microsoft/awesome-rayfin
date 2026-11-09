// dwg: Typen und reine Hilfsfunktionen für Seiten aus einer App-Spec.
// Von `dwg app page` geschrieben, wird bei jedem Lauf ersetzt.

import {
  col,
  filterValue,
  isoDate,
  valueKey,
  type Bindings,
  type DaxColumnType,
  type DaxFilter,
  type DaxValue,
  type SelectionKey,
  type VisualKind,
  type VisualObjects,
} from '../vendor/dwg-visuals/dwg-visuals.js';
import { transfer, zones as gridZones, type Chrome, type Zones } from '../vendor/dwg-pixelgrid/pixelgrid.js';

export interface DwgTileSpec {
  id: string;
  visual: VisualKind;
  /** x, y, Breite, Höhe in Seitenpixeln (wie in Power BI) */
  rect: [number, number, number, number];
  title?: string;
  subtitle?: string;
  bindings: Bindings;
  /** feste Filter nur dieser Kachel (wie Visual-Filter in Power BI), zusätzlich zu den Seitenfiltern */
  filters?: DaxFilter[];
  objects?: VisualObjects;
  sortBy?: Record<string, string>;
  showItemsWithNoData?: boolean;
  displayNames?: Record<string, string>;
  /** Formatstring je Ergebnisspalte, z. B. { "[actual]": "0.0 %" } (nur App; Power BI nimmt den Formatstring des Measures) */
  formats?: Record<string, string>;
}

export interface DwgPageSpec {
  name: string;
  width: number;
  height: number;
  /** Kennung in der Navigation und im Link (#id); sonst Template-Kennung bzw. Name */
  id?: string;
  /** Template-Kennung, z. B. „C03“; steht in Navigation und Seitentitel vor dem Namen */
  template?: string;
  /** Gruppe in der Navigation oben, z. B. „ChartKitchen · Zeitverlauf“ */
  group?: string;
  /** Erklärtext über den Kacheln: welche Frage die Seite beantwortet */
  description?: string;
  background?: string;
  filters?: DaxFilter[];
  /**
   * Datentyp je Spalte der Seite aus dem TMDL (`dwg app page --model`), Schlüssel `'Tabelle'[Spalte]`. Abfrage-
   * ergebnisse tragen keine Typen; ohne Eintrag gilt ISO-Text als Datum.
   */
  columnTypes?: Record<string, DaxColumnType>;
  /** Rahmen-Zonen in Seitenpixeln (Pixelraster wie MockupKitchen, vom Generator gerechnet) */
  zones?: DwgZones;
  tiles: DwgTileSpec[];
}

export interface DwgBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Kopf (Seitentitel, Erklärtext), Filter-Panel links, Fußleiste, Inhalt (Kacheln) */
export interface DwgZones {
  header: DwgBox;
  filter?: DwgBox;
  footer: DwgBox;
  content: DwgBox;
}

/** fullhd/hd: Seite in 1920 bzw. 1280 px aufbauen und als Ganzes skalieren; responsive: nur Kacheln skalieren */
export type DwgResolution = 'fullhd' | 'hd' | 'responsive';

/** Slicer im Filter-Panel; gilt für alle Seiten der App. */
export interface DwgSlicerSpec {
  /** Spalte mit Tabelle: `'Kalender'[Jahr]` */
  column: string;
  label: string;
  /** Startauswahl; leer oder fehlt = alle Werte */
  default?: DaxValue[];
  /** Mehrfachauswahl (Standard: Einfachauswahl) */
  multi?: boolean;
  /** Sortierspalte der Werteliste, z. B. Monatsname nach Monatsnummer */
  sortBy?: string;
  /** leere Werte („(leer)“) in der Liste zeigen; Standard: ausgeblendet */
  showEmpty?: boolean;
}

/** Ganze App aus einer Spec: Slicer, Seiten in Navigationsreihenfolge. */
export interface DwgAppSpec {
  name: string;
  about?: string;
  /** Fußtext, z. B. Datenhinweis und Markenhinweis */
  footer?: string;
  /** Auflösungsmodus beim Start (in der Shell umschaltbar) */
  resolution: DwgResolution;
  /** Titelblöcke und Bedienleisten der Visuals zeigen (Standard: aus, Seitentitel steht darüber) */
  visualHeaders: boolean;
  /** Chrome-Zonen für das Pixelraster (layout/pixelgrid.mjs); damit rechnet die Shell andere Auflösungen exakt */
  chrome?: Chrome;
  slicers: DwgSlicerSpec[];
  /** Datentyp je Slicer-Spalte aus dem TMDL (`--model`), wie `DwgPageSpec.columnTypes` */
  columnTypes?: Record<string, DaxColumnType>;
  pages: DwgPageSpec[];
}

export interface DwgSelection {
  tile: string;
  keys: SelectionKey[];
}

/** Auswahl je Slicer, Schlüssel ist `slicer.column`; leere Liste = alle */
export type DwgSlicerState = Record<string, DaxValue[]>;

/** `Kalender[Monat]` → ['Kalender', 'Monat']; Measure-Spalten (`[actual]`) → null */
function splitColumn(name: string): [string, string] | null {
  const m = /^(.+)\[(.+)\]$/.exec(name);
  return m ? [m[1], m[2]] : null;
}

/** `Kalender[Jahr]`, `'Kalender'[Jahr]` → `'Kalender'[Jahr]` (eine Schreibweise je Spalte) */
export function normColumn(ref: string): string {
  const m = /^\s*(?:'((?:[^']|'')+)'|([^'[\]]+?))\s*\[((?:[^\]]|\]\])+)\]\s*$/.exec(ref);
  if (!m) return ref.trim();
  const table = m[1] != null ? m[1].replace(/''/g, "'") : m[2].trim();
  return col(table, m[3].replace(/\]\]/g, ']'));
}

/** Datentyp einer Spalte aus `columnTypes` (Schlüssel in beliebiger Schreibweise der Spalte). */
export function columnType(types: Record<string, DaxColumnType> | undefined, ref: string): DaxColumnType | undefined {
  if (!types) return undefined;
  const want = normColumn(ref);
  return types[want] ?? Object.entries(types).find(([k]) => normColumn(k) === want)?.[1];
}

/** Filter mit dem Datentyp ihrer Spalte versehen (sofern bekannt) */
function withTypes(list: DaxFilter[] | undefined, types: Record<string, DaxColumnType> | undefined): DaxFilter[] {
  return (list ?? []).map((f) => {
    const type = f.type ?? columnType(types, f.column);
    return type ? { ...f, type } : f;
  });
}

/**
 * Filterlisten zusammenführen: eine TREATAS-Liste je Spalte, mehrere Filter auf dieselbe Spalte
 * ergeben die Schnittmenge (wie in Power BI: Slicer und Querfilter gelten gemeinsam). Bleibt nichts
 * übrig, filtert die Spalte auf BLANK, die Kachel zeigt dann keine Daten. Werte laufen durch filterValue:
 * ein Datum aus dem Slicer (ISO-Text) und eines aus dem Klick (Date) sind derselbe Wert.
 */
export function combineFilters(...lists: (DaxFilter[] | undefined)[]): DaxFilter[] {
  const byColumn = new Map<string, { values: DaxValue[]; type?: DaxColumnType }>();
  for (const list of lists) {
    for (const f of list ?? []) {
      const column = normColumn(f.column);
      const prev = byColumn.get(column);
      const type = prev?.type ?? f.type;
      const values = f.values.map((v) => filterValue(v, type));
      if (!prev) {
        byColumn.set(column, { values, type });
        continue;
      }
      const keep = new Set(values.map((v) => valueKey(v, type)));
      const both = prev.values.map((v) => filterValue(v, type)).filter((v) => keep.has(valueKey(v, type)));
      byColumn.set(column, { values: both.length ? both : [null], type });
    }
  }
  return [...byColumn].map(([column, { values, type }]) => (type ? { column, values, type } : { column, values }));
}

/** Auswahl in einer Kachel → TREATAS-Filter für die anderen Kacheln (eine Liste je Spalte). */
export function selectionFilters(sel: DwgSelection | null): DaxFilter[] {
  if (!sel) return [];
  const byColumn = new Map<string, DaxValue[]>();
  for (const key of sel.keys) {
    for (const [name, value] of Object.entries(key)) {
      const parts = splitColumn(name);
      if (!parts) continue;
      const ref = col(parts[0], parts[1]);
      const list = byColumn.get(ref) ?? [];
      // Date-Werte sind je Zeile eigene Objekte: über den Schlüssel vergleichen
      if (!list.some((v) => valueKey(v) === valueKey(value))) list.push(value as DaxValue);
      byColumn.set(ref, list);
    }
  }
  return [...byColumn].map(([column, values]) => ({ column, values }));
}

/** Text für den Filter-Chip: erste Spalte der Auswahl mit bis zu drei Werten. */
export function selectionLabel(sel: DwgSelection | null): string {
  if (!sel || !sel.keys.length) return '';
  const [name] = Object.keys(sel.keys[0]);
  const parts = name ? splitColumn(name) : null;
  if (!parts) return '';
  const values = [...new Set(sel.keys.map((k) => (k[name] == null ? '(leer)' : formatSlicerValue(k[name] as DaxValue))))];
  const more = values.length > 3 ? ` +${values.length - 3}` : '';
  return `${parts[1]}: ${values.slice(0, 3).join(', ')}${more}`;
}

/**
 * Filter einer Kachel: Seitenfilter, eigene Kachelfilter, Filter von außen (Slicer im Filter-Panel)
 * und die Auswahl aus einer anderen Kachel.
 */
export function tileFilters(
  page: DwgPageSpec,
  tileId: string,
  sel: DwgSelection | null,
  extra: DaxFilter[] = []
): DaxFilter[] {
  const own = page.tiles.find((t) => t.id === tileId)?.filters;
  const cross = sel && sel.tile !== tileId ? selectionFilters(sel) : [];
  const t = page.columnTypes;
  return combineFilters(withTypes(page.filters, t), withTypes(own, t), withTypes(extra, t), withTypes(cross, t));
}

/** Sichtbarer Seitenbereich (Standard: ganze Seite), z. B. ohne Kopf, Filter-Panel und Fußleiste */
export function pageRegion(page: DwgPageSpec, withoutFrame = false): DwgBox {
  const z = page.zones;
  if (!withoutFrame || !z) return { x: 0, y: 0, w: page.width, h: page.height };
  const x = z.filter ? z.filter.x + z.filter.w : 0;
  return { x, y: z.header.y + z.header.h, w: page.width - x, h: z.footer.y - (z.header.y + z.header.h) };
}

/**
 * Position wie in Power BI („An Breite anpassen“): der Seitenbereich `region` füllt die Breite; unter
 * `narrowBelow` untereinander.
 */
export function tileBox(
  tile: DwgTileSpec,
  page: DwgPageSpec,
  width: number,
  narrowBelow = 900,
  region: DwgBox = pageRegion(page)
): { position: 'absolute' | 'relative'; left?: number; top?: number; width: number; height: number } {
  const [x, y, w, h] = tile.rect;
  if (width > 0 && width < narrowBelow) {
    return { position: 'relative', width, height: Math.round(Math.max(260, (h * width) / w / 1.6)) };
  }
  const s = width / region.w;
  return { position: 'absolute', left: (x - region.x) * s, top: (y - region.y) * s, width: w * s, height: h * s };
}

/** Höhe der Kachelfläche bei gegebener Breite (gleicher Maßstab wie `tileBox`). */
export function pageHeight(page: DwgPageSpec, width: number, region: DwgBox = pageRegion(page)): number {
  return width ? (region.h * width) / region.w : region.h;
}

/** Basisbreite je Auflösungsmodus; die Seite wird dort aufgebaut und als Ganzes skaliert */
export const RESOLUTION_WIDTH: Record<Exclude<DwgResolution, 'responsive'>, number> = { fullhd: 1920, hd: 1280 };

/** Kleinste angezeigte Seitenbreite; darunter scrollt die Seite waagerecht statt weiter zu schrumpfen */
export const MIN_STAGE_WIDTH = 1152;

/** Skalierung der Bühne: Basisbreite auf die verfügbare Breite, nicht unter MIN_STAGE_WIDTH, höchstens 2 */
export function stageScale(available: number, base: number): number {
  return Math.min(2, Math.max(MIN_STAGE_WIDTH / base, available / base));
}

const pick = (z: Zones): DwgZones => ({ header: z.header!, ...(z.filter ? { filter: z.filter } : {}), footer: z.footer!, content: z.content });

/**
 * Seite in einer anderen Basisbreite (z. B. HD 1280 statt Full HD 1920): Zonen aus dem Pixelraster dieser Breite,
 * Kacheln über das Raster übertragen (pixelgenau, Zwischenraum dort genau g) bzw. proportional, wenn sie nicht auf
 * dem Raster liegen. Ohne Chrome oder Zonen: alles mit dem Faktor skaliert.
 */
export function stagePage(page: DwgPageSpec, base: number, chrome?: Chrome): DwgPageSpec {
  if (base === page.width) return page;
  const f = base / page.width;
  const height = Math.round(page.height * f);
  if (chrome?.header && chrome.footer && page.zones) {
    const from = gridZones({ w: page.width, h: page.height }, chrome);
    const to = gridZones({ w: base, h: height }, chrome);
    return { ...page, width: base, height, zones: pick(to), tiles: page.tiles.map((t) => ({ ...t, rect: transfer(t.rect, from, to) })) };
  }
  const r = (b: DwgBox): DwgBox => ({ x: Math.round(b.x * f), y: Math.round(b.y * f), w: Math.round(b.w * f), h: Math.round(b.h * f) });
  const z = page.zones;
  return {
    ...page,
    width: base,
    height,
    zones: z && { header: r(z.header), ...(z.filter ? { filter: r(z.filter) } : {}), footer: r(z.footer), content: r(z.content) },
    tiles: page.tiles.map((t) => ({ ...t, rect: t.rect.map((v) => Math.round(v * f)) as DwgTileSpec['rect'] })),
  };
}

/** Titelblöcke und Bedienleisten der Visuals aus (Laufzeit-Override, keine neue Abfrage) */
export function withoutHeaders(visual: VisualKind, objects: VisualObjects = {}): VisualObjects {
  const off: VisualObjects =
    visual === 'pnl'
      ? { titleBlock: { show: false }, toolbar: { show: false } }
      : { ibcsTitle: { show: false }, chart: { chartButtons: false, cumulativeButton: false } };
  const out: VisualObjects = { ...objects };
  for (const [k, v] of Object.entries(off)) out[k] = { ...objects[k], ...v };
  return out;
}

/** Leerer Slicer-Wert (BLANK oder Leertext), Anzeige „(leer)“ */
export const isEmptyValue = (v: DaxValue) => v === null || v === '';

/** „C03 Säulen im Zeitverlauf“: Template-Kennung vor dem Namen, ohne sie zu verdoppeln. */
export function pageLabel(page: DwgPageSpec): string {
  const t = page.template?.trim();
  return t && !page.name.trim().toLowerCase().startsWith(t.toLowerCase()) ? `${t} ${page.name}` : page.name;
}

function slugOf(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'seite'
  );
}

/** Kennung für Navigation und Link: `id`, sonst Template-Kennung, sonst Name. */
export function pageId(page: DwgPageSpec): string {
  return slugOf(page.id ?? page.template ?? page.name);
}

/** Seite zum Link (`#c03`), sonst die erste. */
export function findPage(app: DwgAppSpec, hash: string): DwgPageSpec {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  return app.pages.find((p) => pageId(p) === id) ?? app.pages[0];
}

/** Gruppen der Navigation in der Reihenfolge ihres ersten Auftretens. */
export function navGroups(pages: DwgPageSpec[]): { group: string; pages: DwgPageSpec[] }[] {
  const out: { group: string; pages: DwgPageSpec[] }[] = [];
  for (const p of pages) {
    const group = p.group?.trim() || 'Seiten';
    const g = out.find((x) => x.group === group);
    if (g) g.pages.push(p);
    else out.push({ group, pages: [p] });
  }
  return out;
}

/** Startauswahl aller Slicer; Datumswerte der Spec (ISO-Text) als Date wie die Werteliste. */
export function slicerDefaults(slicers: DwgSlicerSpec[], types?: Record<string, DaxColumnType>): DwgSlicerState {
  return Object.fromEntries(
    slicers.map((s) => [s.column, (s.default ?? []).map((v) => filterValue(v, columnType(types, s.column)))])
  );
}

/** Slicer-Auswahl → TREATAS-Filter für alle Kacheln; „alle“ (leere Auswahl) filtert nicht. */
export function slicerFilters(
  slicers: DwgSlicerSpec[],
  state: DwgSlicerState,
  types?: Record<string, DaxColumnType>
): DaxFilter[] {
  return slicers
    .map((s) => {
      const type = columnType(types, s.column);
      return { column: normColumn(s.column), values: state[s.column] ?? [], ...(type ? { type } : {}) };
    })
    .filter((f) => f.values.length > 0);
}

/** Wert als Text für `data-value` und Tests: Datum als ISO-Text (`2026-03-01T00:00:00`). */
export const valueText = (v: DaxValue) => (v instanceof Date ? isoDate(v) : String(v));

/** Wert an- oder abwählen. Einfachauswahl: genau ein Wert, erneuter Klick hebt ihn auf (alle). */
export function toggleSlicerValue(slicer: DwgSlicerSpec, current: DaxValue[], value: DaxValue): DaxValue[] {
  const has = current.some((v) => valueKey(v) === valueKey(value));
  if (!slicer.multi) return has && current.length === 1 ? [] : [value];
  return has ? current.filter((v) => valueKey(v) !== valueKey(value)) : [...current, value];
}

export function sameValues(a: DaxValue[], b: DaxValue[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map((v) => valueKey(v)));
  return b.every((v) => keys.has(valueKey(v)));
}

/** Werteliste eines Slicers aus dem Modell, sortiert wie `sortBy` (sonst nach Wert). */
export function slicerQuery(slicer: DwgSlicerSpec): string {
  const c = normColumn(slicer.column);
  const sort = slicer.sortBy ? normColumn(slicer.sortBy) : null;
  if (!/^'.+'\[.+\]$/.test(c) || (sort && !/^'.+'\[.+\]$/.test(sort))) {
    throw new Error(`Slicer „${slicer.label}“: "${slicer.column}" ist keine Spaltenreferenz ('Tabelle'[Spalte]).`);
  }
  const cols = sort && sort !== c ? `${c}, ${sort}` : c;
  return `EVALUATE\nSUMMARIZECOLUMNS(${cols})\nORDER BY ${sort && sort !== c ? `${sort}, ` : ''}${c}`;
}

/**
 * Werte aus dem Abfrageergebnis (Spalte `Tabelle[Spalte]`, sonst die erste), ohne Doppelte. Datumswerte
 * (ISO-Text vom Konnektor) werden Date, wie im Visual; `type` ist der Datentyp der Spalte, wenn bekannt.
 */
export function slicerValues(
  table: { columns: { name: string }[]; rows: unknown[][] },
  slicer: DwgSlicerSpec,
  type?: DaxColumnType
): DaxValue[] {
  const m = /^'((?:[^']|'')+)'\[(.+)\]$/.exec(normColumn(slicer.column));
  const want = m ? `${m[1].replace(/''/g, "'")}[${m[2]}]` : '';
  const i = Math.max(0, table.columns.findIndex((c) => c.name === want));
  const seen = new Set<string>();
  const out: DaxValue[] = [];
  for (const r of table.rows) {
    const v = filterValue(r[i], type);
    if (seen.has(valueKey(v))) continue;
    seen.add(valueKey(v));
    out.push(v);
  }
  return out;
}

/** Anzeige eines Slicer-Werts: Jahre ohne Tausenderpunkt, Datum deutsch, leer als „(leer)“. */
export function formatSlicerValue(v: DaxValue): string {
  if (v === null || v === '') return '(leer)';
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nein';
  if (v instanceof Date) return v.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toLocaleString('de-DE');
  const d = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.0+)?Z?)?$/.exec(v);
  return d ? `${d[3]}.${d[2]}.${d[1]}` : v;
}

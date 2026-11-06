// dwg: types and pure helpers for pages of an app spec.
// Written by `dwg app page`, replaced on every run; patched by tools/finance/dwg-english.mjs.

import {
  col,
  type Bindings,
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
  /** x, y, width, height in page pixels (as in Power BI) */
  rect: [number, number, number, number];
  title?: string;
  subtitle?: string;
  bindings: Bindings;
  /** fixed filters of this tile only (like visual filters in Power BI), on top of the page filters */
  filters?: DaxFilter[];
  objects?: VisualObjects;
  sortBy?: Record<string, string>;
  showItemsWithNoData?: boolean;
  displayNames?: Record<string, string>;
  /** format string per result column, e.g. { "[actual]": "0.0 %" } (app only; Power BI uses the measure's format string) */
  formats?: Record<string, string>;
}

export interface DwgPageSpec {
  name: string;
  width: number;
  height: number;
  /** id in the navigation and the link (#id); otherwise template id or name */
  id?: string;
  /** template id, e.g. "C03"; shown before the name in the navigation and the page title */
  template?: string;
  /** group in the top navigation, e.g. "ChartKitchen · Trend" */
  group?: string;
  /** explanation above the tiles: which question the page answers */
  description?: string;
  background?: string;
  filters?: DaxFilter[];
  /** frame zones in page pixels (pixel grid like MockupKitchen, computed by the generator) */
  zones?: DwgZones;
  tiles: DwgTileSpec[];
}

export interface DwgBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** header (page title, explanation), filter panel on the left, footer, content (tiles) */
export interface DwgZones {
  header: DwgBox;
  filter?: DwgBox;
  footer: DwgBox;
  content: DwgBox;
}

/** fullhd/hd: build the page at 1920 or 1280 px and scale it as a whole; responsive: scale the tiles only */
export type DwgResolution = 'fullhd' | 'hd' | 'responsive';

/** slicer in the filter panel; applies to every page of the app. */
export interface DwgSlicerSpec {
  /** column with table: `'Calender'[Year]` */
  column: string;
  label: string;
  /** initial selection; empty or missing = all values */
  default?: DaxValue[];
  /** multi-select (default: single select) */
  multi?: boolean;
  /** sort column of the value list, e.g. month name by month number */
  sortBy?: string;
  /** show empty values ("(blank)") in the list; default: hidden */
  showEmpty?: boolean;
}

/** whole app from one spec: slicers, pages in navigation order. */
export interface DwgAppSpec {
  name: string;
  about?: string;
  /** footer text, e.g. data note and brand note */
  footer?: string;
  /** resolution mode at start (switchable in the shell) */
  resolution: DwgResolution;
  /** show the visuals' title blocks and toolbars (default: off, the page title sits above) */
  visualHeaders: boolean;
  /** chrome zones for the pixel grid (dwg/layout/pixelgrid.mjs); lets the shell compute other resolutions exactly */
  chrome?: Chrome;
  slicers: DwgSlicerSpec[];
  pages: DwgPageSpec[];
}

export interface DwgSelection {
  tile: string;
  keys: SelectionKey[];
}

/** selection per slicer, keyed by `slicer.column`; empty list = all */
export type DwgSlicerState = Record<string, DaxValue[]>;

/** `Calender[Month]` → ['Calender', 'Month']; measure columns (`[actual]`) → null */
function splitColumn(name: string): [string, string] | null {
  const m = /^(.+)\[(.+)\]$/.exec(name);
  return m ? [m[1], m[2]] : null;
}

/** `Calender[Year]`, `'Calender'[Year]` → `'Calender'[Year]` (one spelling per column) */
export function normColumn(ref: string): string {
  const m = /^\s*(?:'((?:[^']|'')+)'|([^'[\]]+?))\s*\[((?:[^\]]|\]\])+)\]\s*$/.exec(ref);
  if (!m) return ref.trim();
  const table = m[1] != null ? m[1].replace(/''/g, "'") : m[2].trim();
  return col(table, m[3].replace(/\]\]/g, ']'));
}

const valueKey = (v: DaxValue) => (v instanceof Date ? `d:${v.toISOString()}` : `${typeof v}:${String(v)}`);

/**
 * Merge filter lists: one TREATAS list per column, several filters on the same column give the
 * intersection (as in Power BI: slicers and cross-filters apply together). If nothing is left, the
 * column filters on BLANK and the tile shows no data.
 */
export function combineFilters(...lists: (DaxFilter[] | undefined)[]): DaxFilter[] {
  const byColumn = new Map<string, DaxValue[]>();
  for (const list of lists) {
    for (const f of list ?? []) {
      const column = normColumn(f.column);
      const prev = byColumn.get(column);
      if (!prev) {
        byColumn.set(column, [...f.values]);
        continue;
      }
      const keep = new Set(f.values.map(valueKey));
      const both = prev.filter((v) => keep.has(valueKey(v)));
      byColumn.set(column, both.length ? both : [null]);
    }
  }
  return [...byColumn].map(([column, values]) => ({ column, values }));
}

/** selection in one tile → TREATAS filters for the other tiles (one list per column). */
export function selectionFilters(sel: DwgSelection | null): DaxFilter[] {
  if (!sel) return [];
  const byColumn = new Map<string, DaxValue[]>();
  for (const key of sel.keys) {
    for (const [name, value] of Object.entries(key)) {
      const parts = splitColumn(name);
      if (!parts) continue;
      const ref = col(parts[0], parts[1]);
      const list = byColumn.get(ref) ?? [];
      if (!list.includes(value as DaxValue)) list.push(value as DaxValue);
      byColumn.set(ref, list);
    }
  }
  return [...byColumn].map(([column, values]) => ({ column, values }));
}

/** text of the filter chip: first column of the selection with up to three values. */
export function selectionLabel(sel: DwgSelection | null): string {
  if (!sel || !sel.keys.length) return '';
  const [name] = Object.keys(sel.keys[0]);
  const parts = name ? splitColumn(name) : null;
  if (!parts) return '';
  const values = [...new Set(sel.keys.map((k) => String(k[name] ?? '(blank)')))];
  const more = values.length > 3 ? ` +${values.length - 3}` : '';
  return `${parts[1]}: ${values.slice(0, 3).join(', ')}${more}`;
}

/**
 * Filters of a tile: page filters, its own tile filters, filters from outside (slicers in the filter
 * panel) and the selection from another tile.
 */
export function tileFilters(
  page: DwgPageSpec,
  tileId: string,
  sel: DwgSelection | null,
  extra: DaxFilter[] = []
): DaxFilter[] {
  const own = page.tiles.find((t) => t.id === tileId)?.filters;
  const cross = sel && sel.tile !== tileId ? selectionFilters(sel) : [];
  return combineFilters(page.filters, own, extra, cross);
}

/** visible page region (default: whole page), e.g. without header, filter panel and footer */
export function pageRegion(page: DwgPageSpec, withoutFrame = false): DwgBox {
  const z = page.zones;
  if (!withoutFrame || !z) return { x: 0, y: 0, w: page.width, h: page.height };
  const x = z.filter ? z.filter.x + z.filter.w : 0;
  return { x, y: z.header.y + z.header.h, w: page.width - x, h: z.footer.y - (z.header.y + z.header.h) };
}

/**
 * Position as in Power BI ("Fit to width"): the page region `region` fills the width; below
 * `narrowBelow` the tiles stack.
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

/** height of the tile area at a given width (same scale as `tileBox`). */
export function pageHeight(page: DwgPageSpec, width: number, region: DwgBox = pageRegion(page)): number {
  return width ? (region.h * width) / region.w : region.h;
}

/** base width per resolution mode; the page is built there and scaled as a whole */
export const RESOLUTION_WIDTH: Record<Exclude<DwgResolution, 'responsive'>, number> = { fullhd: 1920, hd: 1280 };

/** smallest page width shown; below it the page scrolls horizontally instead of shrinking further */
export const MIN_STAGE_WIDTH = 1152;

/** stage scale: base width to the available width, not below MIN_STAGE_WIDTH, at most 2 */
export function stageScale(available: number, base: number): number {
  return Math.min(2, Math.max(MIN_STAGE_WIDTH / base, available / base));
}

const pick = (z: Zones): DwgZones => ({ header: z.header!, ...(z.filter ? { filter: z.filter } : {}), footer: z.footer!, content: z.content });

/**
 * Page at another base width (e.g. HD 1280 instead of Full HD 1920): zones from that width's pixel grid,
 * tiles transferred through the grid (pixel-exact, gap exactly g there) or proportionally when they are not
 * on the grid. Without chrome or zones: everything scaled by the factor.
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

/** visuals' title blocks and toolbars off (runtime override, no new query) */
export function withoutHeaders(visual: VisualKind, objects: VisualObjects = {}): VisualObjects {
  const off: VisualObjects =
    visual === 'pnl'
      ? { titleBlock: { show: false }, toolbar: { show: false } }
      : { ibcsTitle: { show: false }, chart: { chartButtons: false, cumulativeButton: false } };
  const out: VisualObjects = { ...objects };
  for (const [k, v] of Object.entries(off)) out[k] = { ...objects[k], ...v };
  return out;
}

/** empty slicer value (BLANK or empty text), shown as "(blank)" */
export const isEmptyValue = (v: DaxValue) => v === null || v === '';

/** "C03 Columns over time": template id before the name, without doubling it. */
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
      .replace(/^-|-$/g, '') || 'page'
  );
}

/** id for navigation and link: `id`, else template id, else name. */
export function pageId(page: DwgPageSpec): string {
  return slugOf(page.id ?? page.template ?? page.name);
}

/** page for the link (`#c03`), else the first. */
export function findPage(app: DwgAppSpec, hash: string): DwgPageSpec {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  return app.pages.find((p) => pageId(p) === id) ?? app.pages[0];
}

/** navigation groups in the order of their first appearance. */
export function navGroups(pages: DwgPageSpec[]): { group: string; pages: DwgPageSpec[] }[] {
  const out: { group: string; pages: DwgPageSpec[] }[] = [];
  for (const p of pages) {
    const group = p.group?.trim() || 'Pages';
    const g = out.find((x) => x.group === group);
    if (g) g.pages.push(p);
    else out.push({ group, pages: [p] });
  }
  return out;
}

/** initial selection of every slicer. */
export function slicerDefaults(slicers: DwgSlicerSpec[]): DwgSlicerState {
  return Object.fromEntries(slicers.map((s) => [s.column, [...(s.default ?? [])]]));
}

/** slicer selection → TREATAS filters for every tile; "all" (empty selection) does not filter. */
export function slicerFilters(slicers: DwgSlicerSpec[], state: DwgSlicerState): DaxFilter[] {
  return slicers
    .map((s) => ({ column: normColumn(s.column), values: state[s.column] ?? [] }))
    .filter((f) => f.values.length > 0);
}

/** select or deselect a value. Single select: exactly one value, clicking it again clears it (all). */
export function toggleSlicerValue(slicer: DwgSlicerSpec, current: DaxValue[], value: DaxValue): DaxValue[] {
  const has = current.some((v) => valueKey(v) === valueKey(value));
  if (!slicer.multi) return has && current.length === 1 ? [] : [value];
  return has ? current.filter((v) => valueKey(v) !== valueKey(value)) : [...current, value];
}

export function sameValues(a: DaxValue[], b: DaxValue[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(valueKey));
  return b.every((v) => keys.has(valueKey(v)));
}

/** value list of a slicer from the model, sorted like `sortBy` (else by value). */
export function slicerQuery(slicer: DwgSlicerSpec): string {
  const c = normColumn(slicer.column);
  const sort = slicer.sortBy ? normColumn(slicer.sortBy) : null;
  if (!/^'.+'\[.+\]$/.test(c) || (sort && !/^'.+'\[.+\]$/.test(sort))) {
    throw new Error(`Slicer "${slicer.label}": "${slicer.column}" is not a column reference ('Table'[Column]).`);
  }
  const cols = sort && sort !== c ? `${c}, ${sort}` : c;
  return `EVALUATE\nSUMMARIZECOLUMNS(${cols})\nORDER BY ${sort && sort !== c ? `${sort}, ` : ''}${c}`;
}

/** values from the query result (column `Table[Column]`, else the first), without duplicates. */
export function slicerValues(
  table: { columns: { name: string }[]; rows: unknown[][] },
  slicer: DwgSlicerSpec
): DaxValue[] {
  const m = /^'((?:[^']|'')+)'\[(.+)\]$/.exec(normColumn(slicer.column));
  const want = m ? `${m[1].replace(/''/g, "'")}[${m[2]}]` : '';
  const i = Math.max(0, table.columns.findIndex((c) => c.name === want));
  const seen = new Set<string>();
  const out: DaxValue[] = [];
  for (const r of table.rows) {
    const v = (r[i] ?? null) as DaxValue;
    if (seen.has(valueKey(v))) continue;
    seen.add(valueKey(v));
    out.push(v);
  }
  return out;
}

/** display of a slicer value: years without thousands separator, dates en-GB, empty as "(blank)". */
export function formatSlicerValue(v: DaxValue): string {
  if (v === null || v === '') return '(blank)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v instanceof Date) return v.toLocaleDateString('en-GB');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toLocaleString('en-GB');
  const d = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.0+)?Z?)?$/.exec(v);
  return d ? `${d[3]}/${d[2]}/${d[1]}` : v;
}

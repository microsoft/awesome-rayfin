// Typen zu pixelgrid.js (MockupKitchen). Die dwg cli übernimmt Datei und Typen mit `dwg mockup build`
// (dwg/layout/pixelgrid.mjs + pixelgrid.d.ts, in Apps als vendor/dwg-pixelgrid/pixelgrid.js + pixelgrid.d.ts).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Rect = [number, number, number, number];
/** Bruch [Zähler, Nenner], ganze Zahl oder { n, d } */
export type Frac = [number, number] | number | { n: number | bigint; d: number | bigint };

export interface Chrome {
  header?: { on: boolean; h: number };
  nav?: { on: boolean; w: number };
  filter?: { on: boolean; side: 'left' | 'right' | 'top' | 'burger'; w: number; topH?: number };
  footer?: { on: boolean; h: number };
}

export interface Zones {
  k: number;
  g: number;
  m0: number;
  n: number;
  header?: Box;
  nav?: Box;
  filter?: Box;
  footer?: Box;
  /** Fläche zwischen den Chrome-Zonen */
  area: Box;
  content: Box;
  margins: { l: number; r: number; t: number; b: number };
  /** Schritt je Achse (Inhalt + g), durch n teilbar */
  pitch: { x: number; y: number };
  /** Schritt in beiden Achsen durch n teilbar (sonst ±1 px) */
  exact: boolean;
}

/** Zonen ohne Raster (fester Rand wie MockupKitchen bis 0.6.2) */
export interface LegacyZones {
  header?: Box;
  nav?: Box;
  filter?: Box;
  footer?: Box;
  area: Box;
  content: Box;
}

export interface LayoutLeaf<N = unknown> {
  node: N;
  rect: Box;
  /** Lage im Pitch-Raum: x = [Anfang, Ende], y = [Anfang, Ende] als [Zähler, Nenner] */
  cell: { x: [[number, number], [number, number]]; y: [[number, number], [number, number]] };
}

export interface PixelBlock {
  mode: 'lattice';
  n: number;
  pitchX: number;
  pitchY: number;
  gutter: number;
  margins: { l: number; r: number; t: number; b: number };
  exact: boolean;
}

export declare const SPACING: { margin: number; gutter: number };
export declare const MOCKUP_CHROME: Chrome;
export declare const DWG_CHROME: Chrome;
export declare function clamp(v: number, lo: number, hi: number): number;
export declare function R(x: number): number;
export declare function kOf(width: number): number;
export declare function frac(n: number | bigint, d?: number | bigint): { n: bigint; d: bigint };
export declare function line(num: number, den: number, P: number): number;
export declare function solveMargins(span: number, m0: number, g: number, n?: number): { mL: number; mR: number; P: number };
export declare function lattice(area: Box, k: number, opts?: { margin?: number; gutter?: number; n?: number }): Omit<Zones, 'header' | 'nav' | 'filter' | 'footer'>;
export declare function zones(canvas: { w: number; h: number }, chrome?: Chrome, opts?: { margin?: number; gutter?: number; n?: number }): Zones;
export declare function zones(canvas: { w: number; h: number }, chrome: Chrome, opts: { legacy: true; margin?: number }): LegacyZones;
export declare function place(z: Zones, a: number, b: number, c: number, d: number, den?: number): Rect;
export declare function placeFrac(z: Zones, x0: Frac, x1: Frac, y0: Frac, y1: Frac): Box;
export declare function spans(weights: number[], from?: number, to?: number): Array<[number, number]>;
export declare function cellOf(z: Zones, rect: Rect, den?: number): { a: number; b: number; c: number; d: number; den: number } | null;
export declare function transfer(rect: Rect, from: Zones, to: Zones): Rect;
export declare function slicerStack(z: Zones, count: number, height?: number): Rect[];
export declare function inside(z: Zones, rect: Rect): boolean;
export declare function layout<N = unknown>(tree: unknown, z: Zones): { leaves: LayoutLeaf<N>[]; gutters: unknown[] };
export declare function lines(z: Zones, axis: 'x' | 'y'): number[];
export declare function pixelBlock(z: Zones): PixelBlock;

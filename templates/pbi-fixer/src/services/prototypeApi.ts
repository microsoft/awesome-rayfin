// Reverse Prototype — turn an existing PBI report (PBIR) into a portable,
// editable layout document, then export it as PBIR-lite JSON, an Excalidraw
// scene, or an SVG that drag-drops into Figma.
//
// Adapted from the Fabric Developer Hub "Reverse Prototype" feature. Driven by
// the parsed `ReportData` (pages + visuals with position / size / type / title)
// the Report Explorer already loads through the fabric_proxy UDF — no extra
// network calls or auth plumbing.
//
// Field bindings are intentionally NOT extracted: the per-visual query.json
// holds projections in DAX form and mapping them back to a stable
// table[column] reference requires resolving against the model. Out of scope;
// the user can re-bind in the target canvas.

import type { ReportData } from '@/explorer/types';
import { triggerDownload, type DownloadResult } from '@/services/download';

export type VisualType =
  | 'card'
  | 'table'
  | 'matrix'
  | 'barChart'
  | 'columnChart'
  | 'lineChart'
  | 'pieChart'
  | 'slicer';

export interface FieldRef {
  role: string;
  tableName: string;
  propertyName: string;
  kind: 'column' | 'measure';
}

export interface PrototypeVisual {
  id: string;
  type: VisualType;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fields: FieldRef[];
}

export interface PrototypePage {
  id: string;
  name: string;
  width: number;
  height: number;
  visuals: PrototypeVisual[];
}

export interface PrototypeDocument {
  version: 'pbir-skeleton/1.0';
  reportName: string;
  datasetName?: string;
  datasetId?: string;
  workspaceId?: string;
  pages: PrototypePage[];
}

/** Map a Power BI native visual type to the PrototypeDocument enum. */
export function mapPbiVisualType(pbiType: string): VisualType {
  const t = (pbiType || '').toLowerCase();
  if (t.includes('multirowcard') || t === 'card' || t === 'cardvisual') return 'card';
  if (t.includes('matrix') || t.includes('pivot')) return 'matrix';
  if (t === 'tableex' || t === 'table' || t.includes('tablevisual')) return 'table';
  if (t.includes('bar')) return 'barChart';
  if (t.includes('column')) return 'columnChart';
  if (t.includes('line') || t.includes('area')) return 'lineChart';
  if (t.includes('pie') || t.includes('donut')) return 'pieChart';
  if (t.includes('slicer')) return 'slicer';
  return 'card';
}

/** Build a PrototypeDocument from a parsed PBI ReportData (PBIR). */
export function reportToPrototypeDocument(
  report: ReportData,
  reportName: string,
  opts: { includeHidden?: boolean } = {}
): PrototypeDocument {
  const includeHidden = opts.includeHidden ?? false;

  const pageEntries = Object.entries(report.pages)
    .filter(([, pg]) => includeHidden || !pg.hidden)
    .sort(([, a], [, b]) => (a.ordinal ?? 9999) - (b.ordinal ?? 9999));

  const pages: PrototypePage[] = pageEntries.map(([pageId, pg]) => {
    const visuals: PrototypeVisual[] = Object.entries(pg.visuals)
      .filter(([, v]) => includeHidden || !v.hidden)
      .map(([visualId, v]) => {
        const mapped = mapPbiVisualType(v.type);
        const title = (v.title && v.title.trim()) || (v.type ? `[${v.type}]` : visualId);
        return {
          id: visualId,
          type: mapped,
          title,
          x: v.x ?? 0,
          y: v.y ?? 0,
          width: v.width ?? 200,
          height: v.height ?? 150,
          fields: [],
        } as PrototypeVisual;
      });

    return {
      id: pageId,
      name: pg.displayName || pageId,
      width: pg.width || 1280,
      height: pg.height || 720,
      visuals,
    };
  });

  return {
    version: 'pbir-skeleton/1.0',
    reportName: reportName || 'Reverse-prototype',
    workspaceId: report.workspaceId,
    pages,
  };
}

/** Convert an in-memory Prototype document to a PBIR-lite JSON string. */
export function exportPrototypeToPbir(doc: PrototypeDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** Trigger a browser download of JSON content. */
export function downloadJson(filename: string, content: string): DownloadResult {
  return downloadText(filename, content, 'application/json');
}

/** Generic single-blob downloader (text content). */
export function downloadText(filename: string, content: string, mime: string): DownloadResult {
  return triggerDownload(filename, new Blob([content], { type: mime }));
}

/* ------------------------------------------------------------------ */
/* Shared visual palette                                              */
/* ------------------------------------------------------------------ */

const VISUAL_FILL: Record<VisualType, string> = {
  card: '#dbeafe',
  table: '#fef3c7',
  matrix: '#fde68a',
  barChart: '#bbf7d0',
  columnChart: '#a7f3d0',
  lineChart: '#bae6fd',
  pieChart: '#fbcfe8',
  slicer: '#e9d5ff',
};

export const PROTOTYPE_VISUAL_FILL: Record<string, string> = VISUAL_FILL;

/* ------------------------------------------------------------------ */
/* Excalidraw export                                                  */
/* ------------------------------------------------------------------ */
//
// Native Excalidraw scene — drop the .excalidraw file onto excalidraw.com
// (File ▸ Open) and it imports as editable shapes. Each page becomes a
// labelled frame, each visual a rectangle + title + type tag. Pages are
// stacked vertically with a gap so they don't overlap.

interface ExcalidrawElementBase {
  id: string;
  type: 'rectangle' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: 'solid' | 'hachure' | 'cross-hatch';
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: null | string;
  roundness: { type: number } | null;
  seed: number;
  versionNonce: number;
  isDeleted: false;
  boundElements: null;
  updated: number;
  link: null;
  locked: false;
}

interface ExcalidrawText extends ExcalidrawElementBase {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: number;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  baseline: number;
  containerId: null;
  originalText: string;
  lineHeight: number;
  autoResize: boolean;
}

interface ExcalidrawRect extends ExcalidrawElementBase {
  type: 'rectangle';
}

type ExcalidrawElement = ExcalidrawRect | ExcalidrawText;

interface ExcalidrawScene {
  type: 'excalidraw';
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: {
    gridSize: number | null;
    viewBackgroundColor: string;
  };
  files: Record<string, never>;
}

let excalidrawSeed = 1;
function nextSeed(): number {
  excalidrawSeed = (excalidrawSeed * 9301 + 49297) % 233280;
  return excalidrawSeed;
}

function makeRect(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string
): ExcalidrawRect {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: stroke,
    backgroundColor: fill,
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: nextSeed(),
    versionNonce: nextSeed(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

function makeText(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  fontSize: number,
  color: string,
  align: 'left' | 'center' = 'left'
): ExcalidrawText {
  return {
    id,
    type: 'text',
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: color,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: nextSeed(),
    versionNonce: nextSeed(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    text,
    fontSize,
    fontFamily: 3,
    textAlign: align,
    verticalAlign: 'top',
    baseline: Math.round(fontSize * 0.85),
    containerId: null,
    originalText: text,
    lineHeight: 1.25,
    autoResize: true,
  };
}

/** Build an Excalidraw scene from the Prototype document. */
export function exportPrototypeToExcalidraw(doc: PrototypeDocument): string {
  excalidrawSeed = 1;
  const elements: ExcalidrawElement[] = [];
  const PAGE_GAP = 60;
  const HEADER_H = 28;
  let cursorY = 0;
  let counter = 0;
  const newId = () => `el-${++counter}`;

  for (const page of doc.pages) {
    const pageX = 0;
    const pageY = cursorY;
    elements.push(makeText(newId(), pageX, pageY, page.width, HEADER_H, page.name, 20, '#1f2937'));
    elements.push(
      makeRect(newId(), pageX, pageY + HEADER_H, page.width, page.height, '#ffffff', '#94a3b8')
    );
    for (const v of page.visuals) {
      const vx = pageX + v.x;
      const vy = pageY + HEADER_H + v.y;
      const fill = VISUAL_FILL[v.type] || '#e5e7eb';
      elements.push(makeRect(newId(), vx, vy, v.width, v.height, fill, '#475569'));
      elements.push(makeText(newId(), vx + 8, vy + 6, v.width - 16, 22, v.title || v.type, 14, '#0f172a'));
      elements.push(makeText(newId(), vx + 8, vy + 28, v.width - 16, 16, v.type, 11, '#475569'));
    }
    cursorY += HEADER_H + page.height + PAGE_GAP;
  }

  const scene: ExcalidrawScene = {
    type: 'excalidraw',
    version: 2,
    source: 'https://app.powerbi.com',
    elements,
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    files: {},
  };
  return JSON.stringify(scene, null, 2);
}

/* ------------------------------------------------------------------ */
/* Figma export (SVG)                                                 */
/* ------------------------------------------------------------------ */
//
// Figma has no public open scene format. The cleanest interop path is SVG:
// drag-drop the .svg onto a Figma canvas and Figma imports each `<g>` as a
// frame and each `<rect>` / `<text>` as an editable layer.

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Build an SVG (Figma-importable) from the Prototype document. */
export function exportPrototypeToSvg(doc: PrototypeDocument): string {
  const PAGE_GAP = 60;
  const HEADER_H = 28;
  const totalW = Math.max(800, ...doc.pages.map((p) => p.width));
  const totalH = doc.pages.reduce((acc, p) => acc + HEADER_H + p.height + PAGE_GAP, PAGE_GAP);

  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" font-family="Segoe UI, Helvetica, Arial, sans-serif">`
  );
  out.push(`<title>${escapeXml(doc.reportName)}</title>`);
  out.push(`<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#ffffff"/>`);

  let cursorY = PAGE_GAP / 2;
  for (const page of doc.pages) {
    out.push(`<g id="${escapeXml(page.id)}" data-name="${escapeXml(page.name)}">`);
    out.push(
      `<text x="0" y="${cursorY + 20}" font-size="20" font-weight="600" fill="#1f2937">${escapeXml(page.name)}</text>`
    );
    const frameY = cursorY + HEADER_H;
    out.push(
      `<rect x="0" y="${frameY}" width="${page.width}" height="${page.height}" fill="#ffffff" stroke="#94a3b8" stroke-width="1" rx="6"/>`
    );
    for (const v of page.visuals) {
      const vx = v.x;
      const vy = frameY + v.y;
      const fill = VISUAL_FILL[v.type] || '#e5e7eb';
      out.push(`<g id="${escapeXml(v.id)}" data-name="${escapeXml(v.title || v.type)}">`);
      out.push(
        `<rect x="${vx}" y="${vy}" width="${v.width}" height="${v.height}" fill="${fill}" stroke="#475569" stroke-width="1" rx="4"/>`
      );
      out.push(
        `<text x="${vx + 8}" y="${vy + 22}" font-size="14" font-weight="600" fill="#0f172a">${escapeXml(v.title || v.type)}</text>`
      );
      out.push(
        `<text x="${vx + 8}" y="${vy + 40}" font-size="11" fill="#475569">${escapeXml(v.type)}</text>`
      );
      out.push(`</g>`);
    }
    out.push(`</g>`);
    cursorY += HEADER_H + page.height + PAGE_GAP;
  }
  out.push(`</svg>`);
  return out.join('\n');
}

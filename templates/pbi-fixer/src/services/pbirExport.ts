// Real, deployable PBIR/PBIP export for the Forward & Reverse Prototype features.
//
// The "PBIR-lite" export (exportPrototypeToPbir) is a single JSON blob — handy
// for inspection, but NOT something Power BI Desktop or a Fabric workspace can
// open. This module emits a *real* PBIP project: a proper `definition.pbir`,
// `report.json`, one `page.json` per page and one `visual.json` per visual
// (the enhanced report format, PBIR), bundled next to a minimal empty
// SemanticModel and a `.pbip` entry point, all packed into a single ZIP the
// browser can download.
//
// Unzip the download and open the `.pbip` in Power BI Desktop, or import the
// `<name>.Report` parts into a Fabric workspace (the part layout matches the
// Fabric Report item definition used by the Workspace Editor).
//
// Field bindings are intentionally NOT emitted (the prototype is a wireframe —
// see prototypeApi.ts). Visuals render as empty containers at the right size
// and position, ready to be re-bound against a model in the target tool.

import type { PrototypeDocument, PrototypePage, PrototypeVisual, VisualType } from './prototypeApi';

/* ------------------------------------------------------------------ */
/* Schema URLs (versions taken from a real PBIR export — docTemplate)  */
/* ------------------------------------------------------------------ */

const SCHEMA = {
  pbir: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/1.0.0/schema.json',
  report: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/2.0.0/schema.json',
  pagesMetadata:
    'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json',
  page: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json',
  visual:
    'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.10.0/schema.json',
  platform: 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json',
  pbip: 'https://developer.microsoft.com/json-schemas/fabric/item/pbip/1.0.0/schema.json',
  pbism: 'https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json',
} as const;

/** Map the prototype's coarse visual enum to a native PBIR visualType name. */
const PBIR_VISUAL_TYPE: Record<VisualType, string> = {
  card: 'card',
  table: 'tableEx',
  matrix: 'pivotTable',
  barChart: 'clusteredBarChart',
  columnChart: 'clusteredColumnChart',
  lineChart: 'lineChart',
  pieChart: 'pieChart',
  slicer: 'slicer',
};

/* ------------------------------------------------------------------ */
/* Small id / string helpers                                           */
/* ------------------------------------------------------------------ */

/** RFC-4122 v4 GUID (crypto-backed when available). */
function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

/** A fresh 20-hex-char name in the style Power BI generates for pages/visuals. */
function hexName(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const b = new Uint8Array(10);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 10; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** PBIR string literal: wrap in single quotes, double any embedded quote. */
function literal(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Filesystem-safe project name. */
function safeProjectName(name: string): string {
  const cleaned = (name || 'prototype').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'prototype';
}

/* ------------------------------------------------------------------ */
/* PBIR part builders                                                  */
/* ------------------------------------------------------------------ */

function buildVisualJson(v: PrototypeVisual, name: string, z: number): string {
  const visual: Record<string, unknown> = {
    visualType: PBIR_VISUAL_TYPE[v.type] ?? 'card',
  };
  const title = (v.title || '').trim();
  if (title) {
    visual.visualContainerObjects = {
      title: [{ properties: { text: { expr: { Literal: { Value: literal(title) } } } } }],
    };
  }
  const doc = {
    $schema: SCHEMA.visual,
    name,
    position: {
      x: round(v.x),
      y: round(v.y),
      z,
      width: round(Math.max(1, v.width)),
      height: round(Math.max(1, v.height)),
      tabOrder: z,
    },
    visual,
  };
  return JSON.stringify(doc, null, 2);
}

function buildPageJson(page: PrototypePage, name: string): string {
  const doc = {
    $schema: SCHEMA.page,
    name,
    displayName: page.name || name,
    displayOption: 'FitToPage',
    height: round(page.height || 720),
    width: round(page.width || 1280),
  };
  return JSON.stringify(doc, null, 2);
}

function buildReportJson(): string {
  return JSON.stringify(
    {
      $schema: SCHEMA.report,
      themeCollection: { baseTheme: { name: 'CY24SU10' } },
    },
    null,
    2
  );
}

function buildPagesJson(pageNames: string[]): string {
  return JSON.stringify(
    {
      $schema: SCHEMA.pagesMetadata,
      pageOrder: pageNames,
      activePageName: pageNames[0] ?? '',
    },
    null,
    2
  );
}

function buildDefinitionPbir(modelFolder: string): string {
  return JSON.stringify(
    {
      $schema: SCHEMA.pbir,
      version: '1.0',
      datasetReference: {
        byPath: { path: `../${modelFolder}` },
        byConnection: null,
      },
    },
    null,
    2
  );
}

function buildPlatform(type: 'Report' | 'SemanticModel', displayName: string): string {
  return JSON.stringify(
    {
      $schema: SCHEMA.platform,
      metadata: { type, displayName },
      config: { version: '2.0', logicalId: uuid() },
    },
    null,
    2
  );
}

/* Minimal, empty SemanticModel so the .pbip opens stand-alone in Desktop.    */
/* The wireframe has no field bindings, so an empty model is sufficient.       */
function buildModelParts(displayName: string): Record<string, string> {
  const pbism = JSON.stringify({ $schema: SCHEMA.pbism, version: '4.2', settings: {} }, null, 2);
  const database = 'database\n\tcompatibilityLevel: 1567\n';
  const model =
    `model Model\n` +
    `\tculture: en-US\n` +
    `\tdefaultPowerBIDataSourceVersion: powerBI_V3\n` +
    `\tsourceQueryCulture: en-US\n\n` +
    `annotation PBI_QueryOrder = []\n`;
  return {
    'definition.pbism': pbism,
    '.platform': buildPlatform('SemanticModel', displayName),
    'definition/database.tmdl': database,
    'definition/model.tmdl': model,
  };
}

function round(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Bundle assembly                                                     */
/* ------------------------------------------------------------------ */

/**
 * Build the complete PBIP project file set for a prototype document.
 * Returns a flat map of `relative/path` → text content, ready to zip.
 */
export function buildPbipBundle(doc: PrototypeDocument): Record<string, string> {
  const project = safeProjectName(doc.reportName);
  const reportFolder = `${project}.Report`;
  const modelFolder = `${project}.SemanticModel`;
  const files: Record<string, string> = {};

  // ── Report item ──────────────────────────────────────────────────
  const pageNames: string[] = [];
  doc.pages.forEach((page) => {
    const pageName = hexName();
    pageNames.push(pageName);
    files[`${reportFolder}/definition/pages/${pageName}/page.json`] = buildPageJson(page, pageName);
    page.visuals.forEach((v, vi) => {
      const visualName = hexName();
      files[`${reportFolder}/definition/pages/${pageName}/visuals/${visualName}/visual.json`] = buildVisualJson(
        v,
        visualName,
        1000 + vi
      );
    });
  });
  files[`${reportFolder}/definition.pbir`] = buildDefinitionPbir(modelFolder);
  files[`${reportFolder}/.platform`] = buildPlatform('Report', doc.reportName || project);
  files[`${reportFolder}/definition/report.json`] = buildReportJson();
  files[`${reportFolder}/definition/pages/pages.json`] = buildPagesJson(pageNames);

  // ── Semantic model item (minimal, empty) ─────────────────────────
  const modelParts = buildModelParts(doc.datasetName || project);
  for (const [rel, content] of Object.entries(modelParts)) {
    files[`${modelFolder}/${rel}`] = content;
  }

  // ── PBIP entry point ─────────────────────────────────────────────
  files[`${project}.pbip`] = JSON.stringify(
    {
      $schema: SCHEMA.pbip,
      version: '1.0',
      artifacts: [{ report: { path: reportFolder } }],
      settings: { enableAutoRecovery: true },
    },
    null,
    2
  );

  return files;
}

/* ------------------------------------------------------------------ */
/* Dependency-free ZIP writer (store / no compression)                 */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Pack a path→text map into a STORED (uncompressed) ZIP. */
export function zipStore(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const entries = Object.entries(files).map(([name, content]) => ({
    nameBytes: enc.encode(name),
    data: enc.encode(content),
  }));

  const chunks: number[] = [];
  const central: number[] = [];
  let offset = 0;

  const u16 = (a: number[], v: number) => {
    a.push(v & 0xff, (v >>> 8) & 0xff);
  };
  const u32 = (a: number[], v: number) => {
    a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  };
  const bytes = (a: number[], b: Uint8Array) => {
    for (let i = 0; i < b.length; i++) a.push(b[i]);
  };

  const MOD_DATE = 0x0021; // 1980-01-01
  const MOD_TIME = 0x0000;
  const FLAGS = 0x0800; // UTF-8 filenames

  for (const e of entries) {
    const crc = crc32(e.data);
    const size = e.data.length;

    // Local file header
    u32(chunks, 0x04034b50);
    u16(chunks, 20);
    u16(chunks, FLAGS);
    u16(chunks, 0); // method: store
    u16(chunks, MOD_TIME);
    u16(chunks, MOD_DATE);
    u32(chunks, crc);
    u32(chunks, size);
    u32(chunks, size);
    u16(chunks, e.nameBytes.length);
    u16(chunks, 0); // extra len
    bytes(chunks, e.nameBytes);
    bytes(chunks, e.data);

    // Central directory header
    u32(central, 0x02014b50);
    u16(central, 20); // version made by
    u16(central, 20); // version needed
    u16(central, FLAGS);
    u16(central, 0); // method
    u16(central, MOD_TIME);
    u16(central, MOD_DATE);
    u32(central, crc);
    u32(central, size);
    u32(central, size);
    u16(central, e.nameBytes.length);
    u16(central, 0); // extra
    u16(central, 0); // comment
    u16(central, 0); // disk start
    u16(central, 0); // internal attrs
    u32(central, 0); // external attrs
    u32(central, offset); // local header offset
    bytes(central, e.nameBytes);

    offset += 30 + e.nameBytes.length + size;
  }

  const centralOffset = offset;
  const centralSize = central.length;

  const end: number[] = [];
  u32(end, 0x06054b50);
  u16(end, 0); // disk number
  u16(end, 0); // disk with CD
  u16(end, entries.length);
  u16(end, entries.length);
  u32(end, centralSize);
  u32(end, centralOffset);
  u16(end, 0); // comment len

  const out = new Uint8Array(chunks.length + central.length + end.length);
  out.set(chunks, 0);
  out.set(central, chunks.length);
  out.set(end, chunks.length + central.length);
  return out;
}

/* ------------------------------------------------------------------ */
/* Public entry point + download                                       */
/* ------------------------------------------------------------------ */

/** Build the PBIP project ZIP bytes for a prototype document. */
export function exportPrototypeToPbipZip(doc: PrototypeDocument): Uint8Array {
  return zipStore(buildPbipBundle(doc));
}

/** Trigger a browser download of raw bytes. */
export function downloadBytes(filename: string, data: Uint8Array, mime: string): void {
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const blob = new Blob([ab], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Build + download a deployable PBIP project ZIP. Returns the byte size. */
export function downloadPrototypePbip(doc: PrototypeDocument, baseName: string): number {
  const zip = exportPrototypeToPbipZip(doc);
  downloadBytes(`${baseName}.pbip.zip`, zip, 'application/zip');
  return zip.byteLength;
}

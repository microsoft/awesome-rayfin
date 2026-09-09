/**
 * Zero-dependency OOXML (.xlsx) writer.
 *
 * Produces a genuine spreadsheet workbook (a ZIP of XML parts) so Excel opens
 * it cleanly — no "the file format and extension don't match" warning that the
 * legacy HTML-table `.xls` trick triggers. Uses the ZIP "store" method (no
 * compression) which Excel accepts, keeping the implementation tiny and correct.
 */

import type { CellValue } from "./types";

const enc = new TextEncoder();

// --- CRC32 (table-based) ---------------------------------------------------
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

// --- XML helpers -----------------------------------------------------------
function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Neutralize formula-injection for text cells that begin with a trigger char. */
function deFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function colRef(index: number): string {
  let n = index + 1;
  let ref = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    ref = String.fromCharCode(65 + rem) + ref;
    n = Math.floor((n - 1) / 26);
  }
  return ref;
}

function cellXml(value: CellValue, col: number, row: number): string {
  const ref = `${colRef(col)}${row}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  const text = value == null ? "" : deFormula(String(value));
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
}

// --- ZIP (store method) ----------------------------------------------------
interface ZipEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  offset: number;
}

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

function zip(files: { name: string; content: string }[]): Blob {
  const parts: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const f of files) {
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const nameBytes = enc.encode(f.name);
    const header = [
      ...u32(0x04034b50), // local file header signature
      ...u16(20), // version needed
      ...u16(0), // flags
      ...u16(0), // method: store
      ...u16(0), // mod time
      ...u16(0), // mod date
      ...u32(crc),
      ...u32(data.length), // compressed size
      ...u32(data.length), // uncompressed size
      ...u16(nameBytes.length),
      ...u16(0), // extra len
    ];
    const headerBytes = Uint8Array.from(header);
    entries.push({ name: f.name, data, crc, offset });
    parts.push(headerBytes, nameBytes, data);
    offset += headerBytes.length + nameBytes.length + data.length;
  }

  const centralStart = offset;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const central = [
      ...u32(0x02014b50), // central dir signature
      ...u16(20), // version made by
      ...u16(20), // version needed
      ...u16(0), // flags
      ...u16(0), // method
      ...u16(0), // mod time
      ...u16(0), // mod date
      ...u32(e.crc),
      ...u32(e.data.length),
      ...u32(e.data.length),
      ...u16(nameBytes.length),
      ...u16(0), // extra len
      ...u16(0), // comment len
      ...u16(0), // disk number
      ...u16(0), // internal attrs
      ...u32(0), // external attrs
      ...u32(e.offset),
    ];
    const centralBytes = Uint8Array.from(central);
    parts.push(centralBytes, nameBytes);
    offset += centralBytes.length + nameBytes.length;
  }

  const end = Uint8Array.from([
    ...u32(0x06054b50), // end of central dir signature
    ...u16(0), // disk
    ...u16(0), // disk with central dir
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(offset - centralStart), // central dir size
    ...u32(centralStart), // central dir offset
    ...u16(0), // comment len
  ]);
  parts.push(end);

  return new Blob(parts as BlobPart[], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// --- Public builder --------------------------------------------------------
export interface SheetInput {
  columns: { key: string; label: string }[];
  rows: Record<string, CellValue>[];
  classification?: string;
  sheetName?: string;
}

/** Build a real .xlsx workbook Blob from a table. */
export function buildXlsx(input: SheetInput): Blob {
  const { columns, rows } = input;
  const sheetName = (input.sheetName ?? "Sheet1").slice(0, 31).replace(/[[\]*/\\?:]/g, " ");

  const bodyRows: string[] = [];
  let r = 1;
  if (input.classification) {
    bodyRows.push(`<row r="${r}">${cellXml(`Classification: ${input.classification}`, 0, r)}</row>`);
    r++;
  }
  bodyRows.push(
    `<row r="${r}">${columns.map((c, i) => cellXml(c.label, i, r)).join("")}</row>`,
  );
  r++;
  for (const row of rows) {
    bodyRows.push(
      `<row r="${r}">${columns.map((c, i) => cellXml(row[c.key], i, r)).join("")}</row>`,
    );
    r++;
  }

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${bodyRows.join("")}</sheetData></worksheet>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`;

  return zip([
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: rootRels },
    { name: "xl/workbook.xml", content: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRels },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml },
  ]);
}

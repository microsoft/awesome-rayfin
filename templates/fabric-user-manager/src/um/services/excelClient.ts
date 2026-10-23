/**
 * Page-side entry to the Excel worker. The Excel library is loaded only when
 * a sheet is actually read or written, and only inside the worker.
 */
import type { ExcelRequest, ExcelResponse } from './excel.worker';
import type { TextTable, WriteOptions } from './sheetCodec';

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (r: ExcelResponse) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./excel.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ExcelResponse>) => {
      const entry = waiting.get(event.data.id);
      if (!entry) return;
      waiting.delete(event.data.id);
      entry.resolve(event.data);
    };
    worker.onerror = () => stopWorker('worker-failed');
  }
  return worker;
}

type RequestBody = { op: 'read'; buffer: ArrayBuffer } | { op: 'write'; options: WriteOptions };

/** A workbook that takes longer than this is abandoned and its worker is stopped. */
export const EXCEL_TIMEOUT_MS = 20_000;

function stopWorker(reason: string): void {
  for (const entry of waiting.values()) entry.reject(new Error(reason));
  waiting.clear();
  worker?.terminate();
  worker = null;
}

function call(body: RequestBody, transfer: Transferable[] = []): Promise<ExcelResponse> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    // An uploaded workbook is untrusted. One that expands enormously or never
    // finishes parsing must not leave the page waiting forever.
    const timer = setTimeout(() => {
      if (waiting.has(id)) stopWorker('timeout');
    }, EXCEL_TIMEOUT_MS);
    waiting.set(id, {
      resolve: (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    getWorker().postMessage({ id, ...body } as ExcelRequest, transfer);
  });
}

export async function readSheet(file: Blob): Promise<TextTable> {
  const buffer = await file.arrayBuffer();
  const response = await call({ op: 'read', buffer }, [buffer]);
  if (!response.ok) throw new Error(response.code);
  if (!response.table) throw new Error('failed');
  return response.table;
}

export async function writeSheet(options: WriteOptions): Promise<Blob> {
  const response = await call({ op: 'write', options });
  if (!response.ok) throw new Error(response.code);
  if (!response.buffer) throw new Error('failed');
  return new Blob([response.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Hand a generated file to the browser's download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/// <reference lib="webworker" />
/**
 * Web worker around the Excel codec. A worker has no DOM, no session storage
 * and no MSAL cache, so a malicious workbook or a flaw in the Excel library
 * cannot reach a token from here.
 */
import { readWorkbook, writeWorkbook, type TextTable, type WriteOptions } from './sheetCodec';

export type ExcelRequest =
  | { id: number; op: 'read'; buffer: ArrayBuffer }
  | { id: number; op: 'write'; options: WriteOptions };

export type ExcelResponse =
  | { id: number; ok: true; table?: TextTable; buffer?: ArrayBuffer }
  | { id: number; ok: false; code: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<ExcelRequest>) => {
  const request = event.data;
  try {
    if (request.op === 'read') {
      const table = await readWorkbook(request.buffer);
      scope.postMessage({ id: request.id, ok: true, table } satisfies ExcelResponse);
    } else {
      const buffer = await writeWorkbook(request.options);
      scope.postMessage({ id: request.id, ok: true, buffer } satisfies ExcelResponse, [buffer]);
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : 'failed';
    scope.postMessage({ id: request.id, ok: false, code } satisfies ExcelResponse);
  }
};

import type { DataTable, CellValue } from "./types";

/**
 * Rich, Excel-friendly clipboard for {@link DataTable}s.
 *
 * The whole point of this module is a *native paste into Excel*. When you copy a
 * table we place TWO representations on the clipboard at once:
 *
 *   - `text/html` — a real `<table>` so Excel (and Word, Outlook, Google Sheets)
 *     drops each cell into its own column/row, with numeric cells right-aligned
 *     and kept as raw numbers (no "$1.2M" strings) so formulas keep working.
 *   - `text/plain` — tab-separated values, the universal fallback that pastes
 *     into a plain editor, terminal, or spreadsheet just as cleanly.
 *
 * Consumers should hand us the *raw numeric* {@link DataTable} (not the
 * on-screen formatted strings) so the pasted cells are live numbers.
 */

/** Guard against CSV/paste formula injection (=, +, -, @, tab/CR leading). */
function deFormula(value: CellValue): CellValue {
  if (typeof value !== "string") return value;
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function cellToText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  return String(deFormula(value));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Tab-separated text. Newlines/tabs inside a cell are collapsed to spaces so
 *  the row/column grid can't be corrupted by embedded control characters. */
export function tableToTsv(table: DataTable): string {
  const header = table.columns.map((c) => c.label).join("\t");
  const body = table.rows.map((row) =>
    table.columns
      .map((c) => cellToText(row[c.key]).replace(/[\t\r\n]+/g, " "))
      .join("\t"),
  );
  return [header, ...body].join("\r\n");
}

/** A minimal, style-light `<table>` Excel understands. Numeric columns are
 *  right-aligned and carry the raw number so pasted cells stay computable. */
export function tableToHtml(table: DataTable): string {
  const head = table.columns
    .map(
      (c) =>
        `<th style="text-align:${c.numeric ? "right" : "left"};border:1px solid #ddd;padding:4px 8px;background:#f3f4f6;font-weight:600">${escapeHtml(c.label)}</th>`,
    )
    .join("");

  const body = table.rows
    .map((row) => {
      const cells = table.columns
        .map((c) => {
          const raw = row[c.key];
          const text = escapeHtml(cellToText(raw));
          const align = c.numeric ? "right" : "left";
          // `data-type`/`sdnum` hint Excel to keep numbers numeric.
          const numAttr =
            c.numeric && typeof raw === "number" ? ` data-excelnumberformat="General"` : "";
          return `<td style="text-align:${align};border:1px solid #ddd;padding:4px 8px"${numAttr}>${text}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:12px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * Place both clipboard representations onto a `copy` event's `clipboardData`.
 *
 * Exported for unit testing — this is the payload-shaping step shared by the
 * synchronous copy-event path. Given a `DataTransfer` (or a null one, when the
 * event exposes none), it writes the rich HTML table and the TSV fallback.
 */
export function writeClipboardPayload(
  data: Pick<DataTransfer, "setData"> | null | undefined,
  html: string,
  tsv: string,
): void {
  if (!data) return;
  data.setData("text/html", html);
  data.setData("text/plain", tsv);
}

/**
 * Synchronous copy via a `copy`-event listener + `execCommand("copy")`.
 *
 * This is the ONLY path that works when the page is embedded in a cross-origin
 * iframe that withholds the async Clipboard API's `clipboard-write` permission —
 * e.g. a Rayfin item hosted inside the Fabric portal. Because it runs entirely
 * inside the current user gesture (no `await` before the write), the browser
 * honours it where `navigator.clipboard.write*` silently rejects.
 *
 * Returns `true` only when `execCommand` reports the copy succeeded. Outside a
 * user gesture (or where `document`/`execCommand` is unavailable) it returns
 * `false` so callers fall back to the async API.
 */
function copyViaCopyEvent(html: string, tsv: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const onCopy = (event: Event) => {
    const e = event as ClipboardEvent;
    // Replace the hidden textarea's plain-text default with our rich payload.
    e.preventDefault();
    writeClipboardPayload(e.clipboardData, html, tsv);
  };

  let ta: HTMLTextAreaElement | undefined;
  const previousFocus = document.activeElement as HTMLElement | null;
  try {
    document.addEventListener("copy", onCopy, true);

    // `execCommand("copy")` only dispatches a `copy` event when there is a
    // selection; a hidden, focused, pre-seeded textarea provides one (and
    // seeds the TSV as a safety net if the listener somehow doesn't run).
    ta = document.createElement("textarea");
    ta.value = tsv;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();

    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", onCopy, true);
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
    // Restore focus so we don't steal it from the button that triggered us.
    if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus({ preventScroll: true });
    }
  }
}

/**
 * Copy a {@link DataTable} to the clipboard as rich HTML + plain TSV.
 * Resolves `true` on success.
 *
 * Order matters: we try the SYNCHRONOUS copy-event path FIRST. The async
 * Clipboard API is blocked inside cross-origin iframes without a
 * `clipboard-write` permissions-policy grant (the Fabric portal embeds items in
 * exactly such an iframe), so leading with `navigator.clipboard.write` would
 * silently no-op in-portal. `execCommand` runs inside the click gesture and is
 * honoured there. The async API is the secondary path for programmatic calls
 * (no gesture) and engines without `execCommand`.
 */
export async function copyTable(table: DataTable): Promise<boolean> {
  const tsv = tableToTsv(table);
  const html = tableToHtml(table);

  // 1) Synchronous, iframe-safe path (rich HTML + TSV in one gesture).
  if (copyViaCopyEvent(html, tsv)) return true;

  // 2) Async Clipboard API — richer where permitted; used when there is no
  //    active gesture or `execCommand` is unavailable. May reject in a
  //    restricted iframe; that's expected and handled.
  try {
    const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    const CI = typeof ClipboardItem !== "undefined" ? ClipboardItem : undefined;
    if (clip && "write" in clip && CI) {
      await clip.write([
        new CI({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([tsv], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    if (clip?.writeText) {
      await clip.writeText(tsv);
      return true;
    }
  } catch {
    // fall through to the legacy plain-text path
  }

  // 3) Plain-text-only synchronous fallback (older engines).
  return copyTextFallback(tsv);
}

/** Copy raw text (already TSV/CSV). Exposed for callers that only need plain text. */
export async function copyText(text: string): Promise<boolean> {
  // Synchronous, iframe-safe path first (same rationale as copyTable).
  if (copyTextFallback(text)) return true;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore — nothing more we can do
  }
  return false;
}

function copyTextFallback(text: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

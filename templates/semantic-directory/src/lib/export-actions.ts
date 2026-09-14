//-----------------------------------------------------------------------
// Semantic Directory — client-side file download helpers.
//
// Turns an in-memory string into a downloaded file via a transient object URL.
// Used by the data-dictionary export (CSV / Markdown) so a steward gets a real
// file with one click, no server round-trip.
//-----------------------------------------------------------------------

import type { CatalogModel } from "@/catalog/model/types";
import {
    buildDataDictionary,
    dictionaryToCsv,
    dictionaryToMarkdown,
} from "@/catalog/export/data-dictionary";

export type DictionaryFormat = "csv" | "md";

/** Trigger a browser download of `content` as `filename`. */
export function downloadTextFile(filename: string, content: string, mime: string): void {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the download has a chance to start.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Slugify a model name into a safe filename stem. */
function slug(name: string): string {
    return (
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60) || "semantic-model"
    );
}

/**
 * Build the data dictionary and download it in the requested format. Returns
 * the entity count so callers can surface a small confirmation if they like.
 */
export function exportDataDictionary(
    catalog: CatalogModel,
    format: DictionaryFormat,
    modelName: string,
): void {
    const dict = buildDataDictionary(catalog, { modelName });
    const stem = `${slug(modelName)}-dictionary`;
    if (format === "csv") {
        downloadTextFile(`${stem}.csv`, dictionaryToCsv(dict), "text/csv");
    } else {
        downloadTextFile(`${stem}.md`, dictionaryToMarkdown(dict), "text/markdown");
    }
}

//-----------------------------------------------------------------------
// Semantic Directory — enrichment overlay loader.
//
// The enrichment file (catalog.enrichment.json) is a curated overlay merged
// on top of the LIVE model metadata at runtime. It is keyed by normalized
// entity keys (see key helpers in ../model/types) so new/renamed model
// objects fall back gracefully to "needs description".
//-----------------------------------------------------------------------

import raw from "./catalog.enrichment.json";
import type { EnrichmentEntry, EnrichmentFile } from "../model/types";

/** Light runtime shape validation — keeps a malformed edit from crashing the app. */
function coerce(input: unknown): EnrichmentFile {
    const file = (input ?? {}) as Partial<EnrichmentFile>;
    return {
        version: typeof file.version === "number" ? file.version : 1,
        synonyms: isRecord(file.synonyms) ? file.synonyms : {},
        measures: cleanEntries(file.measures),
        columns: cleanEntries(file.columns),
        tables: cleanEntries(file.tables),
    };
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanEntries(
    input: unknown,
): Record<string, EnrichmentEntry> {
    if (!isRecord(input)) return {};
    const out: Record<string, EnrichmentEntry> = {};
    for (const [key, value] of Object.entries(input)) {
        if (isRecord(value)) out[key] = value as EnrichmentEntry;
    }
    return out;
}

/** The validated, frozen enrichment overlay. */
export const enrichment: EnrichmentFile = coerce(raw);

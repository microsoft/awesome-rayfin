//-----------------------------------------------------------------------
// Semantic Directory — deterministic match evidence.
//
// Explains WHY a search hit matched, using only facts we can prove: we check
// the raw query tokens against the entity's own indexed fields (name, synonyms,
// live values, table, topic, tags, description) and report the first one or two
// that literally contain a token. Nothing is inferred — if no field literally
// matches (a fuzzy/prefix hit, or a global-synonym fold), we fall back to a
// neutral "Matched searchable text" that is always true and never overclaims.
// No AI: every label maps to a substring check you can re-run by hand.
//-----------------------------------------------------------------------

import type { ColumnMeta, MeasureMeta, TableMeta } from "../model/types";

type Entity = MeasureMeta | ColumnMeta | TableMeta;

export type EvidenceKind =
    | "name"
    | "value"
    | "synonym"
    | "table"
    | "topic"
    | "tag"
    | "description"
    | "text";

/** One provable reason a hit matched. */
export interface MatchEvidence {
    kind: EvidenceKind;
    /** Short chip label, e.g. `Synonym “units sold”`. */
    label: string;
}

/** Split a raw query into lowercased, comparable tokens (letters/digits runs). */
export function queryTokens(query: string): string[] {
    const raw = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    // De-duplicate while preserving order; drop 1-char noise.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of raw) {
        if (t.length < 2 || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}

function contains(haystack: string | undefined, tokens: string[]): boolean {
    if (!haystack) return false;
    const h = haystack.toLowerCase();
    return tokens.some((t) => h.includes(t));
}

/** The subset of `tokens` that appear as substrings of `haystack`. */
function tokensIn(haystack: string | undefined, tokens: string[]): string[] {
    if (!haystack) return [];
    const h = haystack.toLowerCase();
    return tokens.filter((t) => h.includes(t));
}

/** The first list item literally containing any token, or undefined. */
function firstContaining(list: string[] | undefined, tokens: string[]): string | undefined {
    return list?.find((s) => {
        const low = s.toLowerCase();
        return tokens.some((t) => low.includes(t));
    });
}

const MAX_EVIDENCE = 2;

/** A candidate reason, tagged with which query tokens it accounts for. */
interface Candidate extends MatchEvidence {
    covers: string[];
}

/**
 * Derive up to two provable match reasons for an entity given a query.
 *
 * Candidates are gathered in specificity order (name/value read best, then
 * synonyms, structural fields, and finally free-text description). When more
 * than two match, we prefer the set that explains the MOST distinct query
 * tokens — so a two-word search shows a reason for each word rather than two
 * reasons for the same word — breaking ties by specificity.
 */
export function deriveMatchEvidence(query: string, entity: Entity): MatchEvidence[] {
    const tokens = queryTokens(query);
    if (!tokens.length) return [];

    const cands: Candidate[] = [];

    // Name (technical or display) — the most expected reason.
    const nameTokens = [...new Set([...tokensIn(entity.displayName, tokens), ...tokensIn(entity.name, tokens)])];
    if (nameTokens.length) cands.push({ kind: "name", label: "Name match", covers: nameTokens });

    // A real data value (column members pulled live) — high-signal and specific.
    if (entity.kind === "column") {
        const v = firstContaining(entity.liveValues, tokens);
        if (v) cands.push({ kind: "value", label: `Value “${v}”`, covers: tokensIn(v, tokens) });
    }

    // Business synonym / alternate term.
    const syn = firstContaining(entity.synonyms, tokens);
    if (syn) cands.push({ kind: "synonym", label: `Synonym “${syn}”`, covers: tokensIn(syn, tokens) });

    // Home table (measures & columns only; a table's own name is already "Name").
    if (entity.kind !== "table" && contains(entity.table, tokens)) {
        cands.push({ kind: "table", label: `Table ${entity.table}`, covers: tokensIn(entity.table, tokens) });
    }

    // Business topic / section.
    if (entity.topic && contains(entity.topic, tokens)) {
        cands.push({ kind: "topic", label: `Topic ${entity.topic}`, covers: tokensIn(entity.topic, tokens) });
    }

    // Free-form tag.
    const tag = firstContaining(entity.tags, tokens);
    if (tag) cands.push({ kind: "tag", label: `Tag “${tag}”`, covers: tokensIn(tag, tokens) });

    // Description text — least specific, so it comes last.
    if (contains(entity.description, tokens)) {
        const covers = tokensIn(entity.description, tokens);
        cands.push({ kind: "description", label: `Description mentions “${covers[0]}”`, covers });
    }

    // Nothing literal matched (fuzzy/prefix hit, or a folded global synonym).
    // Report a neutral truth rather than guess a specific field.
    if (!cands.length) return [{ kind: "text", label: "Matched searchable text" }];

    // Pass 1: take candidates (in specificity order) that add NEW token coverage.
    const chosen: Candidate[] = [];
    const covered = new Set<string>();
    for (const c of cands) {
        if (chosen.length >= MAX_EVIDENCE) break;
        if (c.covers.some((t) => !covered.has(t))) {
            chosen.push(c);
            c.covers.forEach((t) => covered.add(t));
        }
    }
    // Pass 2: fill any remaining slot with the next reason by specificity.
    for (const c of cands) {
        if (chosen.length >= MAX_EVIDENCE) break;
        if (!chosen.includes(c)) chosen.push(c);
    }

    return chosen.map(({ kind, label }) => ({ kind, label }));
}

/** A run of text, flagged if it matches a query token (for <mark> highlighting). */
export interface HighlightPart {
    text: string;
    hit: boolean;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split `text` into parts, flagging spans that match any query token so the UI
 * can highlight exactly what the user typed — deterministic, case-insensitive.
 */
export function highlightParts(text: string, tokens: string[]): HighlightPart[] {
    if (!text) return [];
    if (!tokens.length) return [{ text, hit: false }];
    // Longest tokens first so an overlapping pair (e.g. "sale","sales") marks
    // the fullest span rather than leaving a trailing character unmatched.
    const ordered = [...tokens].sort((a, b) => b.length - a.length);
    const alt = ordered.map(escapeRegExp).join("|");
    const splitter = new RegExp(`(${alt})`, "gi");
    const isHit = new RegExp(`^(?:${alt})$`, "i");
    const out: HighlightPart[] = [];
    for (const piece of text.split(splitter)) {
        if (!piece) continue;
        out.push({ text: piece, hit: isHit.test(piece) });
    }
    return out;
}

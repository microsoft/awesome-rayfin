//-----------------------------------------------------------------------
// Semantic Directory — client-side search index (MiniSearch).
//
// Builds one fuzzy, prefix-matching index across measures, columns, and tables.
// Enrichment synonyms and business topics are folded into each document's
// searchable text so a user can search in business language
// ("units sold", "total sales") rather than technical measure names.
//-----------------------------------------------------------------------

import MiniSearch, { type SearchResult } from "minisearch";
import type { CatalogModel, EntityKind } from "../model/types";

export interface SearchDoc {
    id: string;
    kind: EntityKind;
    name: string;
    displayName: string;
    table: string;
    topic: string;
    description: string;
    synonyms: string;
    tags: string;
    emoji: string;
}

export interface CatalogSearchHit extends SearchDoc {
    score: number;
}

/** A built search index plus the docs it was built from (for substring fallback). */
export interface CatalogSearchIndex {
    index: MiniSearch<SearchDoc>;
    docs: SearchDoc[];
}

/**
 * Split a compound identifier into searchable sub-terms.
 * "isActiveCustomer" -> ["isactivecustomer", "is", "active", "customer"]
 * "NetRevenueUSD" -> ["netrevenueusd", "net", "revenue", "usd"]
 * Keeps letter+digit tokens intact ("ME5" stays "me5"), so a whole-token
 * query still matches.
 */
export function splitIdentifier(term: string): string[] {
    const whole = term.toLowerCase();
    const parts = term
        // camelCase / PascalCase boundary: fooBar -> foo Bar
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        // acronym boundary: HTTPServer -> HTTP Server
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        // digit -> letter boundary: ME5Flag -> ME5 Flag (keeps ME5 intact)
        .replace(/([0-9])([A-Za-z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .map((p) => p.toLowerCase())
        .filter(Boolean);
    return Array.from(new Set([whole, ...parts]));
}

function toDocs(catalog: CatalogModel): SearchDoc[] {
    const docs: SearchDoc[] = [];
    const push = (
        kind: EntityKind,
        id: string,
        name: string,
        displayName: string,
        table: string,
        topic: string | undefined,
        description: string | undefined,
        synonyms: string[],
        tags: string[],
        emoji: string | undefined,
    ) => {
        docs.push({
            id,
            kind,
            name,
            displayName,
            table,
            topic: topic ?? "",
            description: description ?? "",
            synonyms: synonyms.join(" "),
            tags: tags.join(" "),
            emoji: emoji ?? "",
        });
    };

    for (const m of catalog.measures) {
        if (m.isHidden) continue;
        push("measure", m.key, m.name, m.displayName, m.table, m.topic,
            m.description, m.synonyms, m.tags, m.emoji);
    }
    for (const c of catalog.columns) {
        if (c.isHidden) continue;
        // Index dimension-like columns, plus any column that carries live member
        // values (so value search reaches it even if the bundled schema didn't
        // flag it as a slice field).
        if (!c.isDimensionLike && !c.liveValues?.length) continue;
        push("column", c.key, c.name, c.displayName, c.table, c.topic,
            c.description, [...c.synonyms, ...(c.liveValues ?? [])], c.tags, c.emoji);
    }
    for (const t of catalog.tables) {
        if (t.isHidden) continue;
        push("table", t.key, t.name, t.displayName, t.name, t.topic,
            t.description, t.synonyms, t.tags, t.emoji);
    }
    // Fold global business synonyms into the searchable text of the entity they
    // point to. A user searching a dimension value ("Contoso", "West") or other
    // mapped value then lands directly on the right dimension — precisely and
    // typo-tolerantly (prefix + fuzzy) — instead of relying on query expansion
    // alone.
    if (catalog.synonyms) {
        const byColumn = new Map<string, SearchDoc>();
        const byTable = new Map<string, SearchDoc>();
        for (const d of docs) {
            if (d.kind === "column") {
                byColumn.set(`${d.table.toLowerCase()}[${d.name.toLowerCase()}]`, d);
            } else if (d.kind === "table") {
                byTable.set(d.name.toLowerCase(), d);
            }
        }
        for (const [term, hint] of Object.entries(catalog.synonyms)) {
            if (!hint?.field) continue;
            const parsed = /^([^[]+?)\s*(?:\[([^\]]+)\])?$/.exec(hint.field.trim());
            if (!parsed) continue;
            const table = parsed[1].trim().toLowerCase();
            const column = parsed[2]?.trim().toLowerCase();
            const target = column
                ? byColumn.get(`${table}[${column}]`)
                : byTable.get(table);
            if (!target) continue;
            const extra = [term, ...(hint.values ?? [])].join(" ");
            target.synonyms = target.synonyms ? `${target.synonyms} ${extra}` : extra;
        }
    }
    return docs;
}

/** Field boosts — names and synonyms matter most, descriptions least. */
const BOOSTS = {
    displayName: 4,
    name: 3,
    synonyms: 3,
    topic: 2,
    tags: 2,
    table: 1.5,
    description: 1,
} as const;

export function buildSearchIndex(catalog: CatalogModel): CatalogSearchIndex {
    const index = new MiniSearch<SearchDoc>({
        idField: "id",
        fields: Object.keys(BOOSTS),
        storeFields: [
            "kind", "name", "displayName", "table", "topic",
            "description", "synonyms", "tags", "emoji",
        ],
        // Expand compound identifiers into their sub-parts at BOTH index and
        // query time, so a fragment inside a camelCase/acronym name still hits
        // (e.g. "Revenue" or "USD" finds a `NetRevenueUSD` column).
        processTerm: (term) => splitIdentifier(term),
        searchOptions: {
            boost: BOOSTS,
            prefix: true,
            fuzzy: 0.2,
            combineWith: "AND",
        },
    });
    const docs = toDocs(catalog);
    index.addAll(docs);
    return { index, docs };
}

/** Flattened, lowercased searchable text for a doc (substring fallback only). */
function docHaystack(d: SearchDoc): string {
    return [d.name, d.displayName, d.table, d.topic, d.description, d.synonyms, d.tags]
        .join(" ")
        .toLowerCase();
}

/**
 * Last-resort scan: return any doc whose searchable text contains the raw
 * lowercased query as a substring. Catches mid-token fragments that neither
 * token nor prefix/fuzzy matching can reach.
 */
function substringScan(docs: SearchDoc[], query: string): SearchDoc[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return docs.filter((d) => docHaystack(d).includes(q));
}

function toHit(d: SearchDoc, score: number): CatalogSearchHit {
    return {
        id: d.id,
        kind: d.kind,
        name: d.name,
        displayName: d.displayName,
        table: d.table,
        topic: d.topic,
        description: d.description,
        synonyms: d.synonyms,
        tags: d.tags,
        emoji: d.emoji,
        score,
    };
}

export function search(
    catalogIndex: CatalogSearchIndex,
    query: string,
    limit = 50,
): CatalogSearchHit[] {
    const { index, docs } = catalogIndex;
    const q = query.trim();
    if (!q) return [];
    // Precise first: require all terms (AND). If that finds nothing — common for
    // natural phrases with stopwords ("wide world importers") or typos — fall
    // back to ANY term (OR) so the user always gets the closest matches instead
    // of a dead end. Boosts + fuzzy still rank the best hit to the top.
    let results = index.search(q) as (SearchResult & SearchDoc)[];
    if (results.length === 0) {
        results = index.search(q, { combineWith: "OR" }) as (SearchResult & SearchDoc)[];
    }
    // Still nothing? A mid-token fragment (e.g. "ctiveCu") can miss token/prefix
    // matching entirely — sweep the docs for a raw substring so search never
    // dead-ends when the text plainly contains the query.
    if (results.length === 0) {
        return substringScan(docs, q).slice(0, limit).map((d) => toHit(d, 0));
    }
    return results.slice(0, limit).map((r) => toHit(r, r.score));
}

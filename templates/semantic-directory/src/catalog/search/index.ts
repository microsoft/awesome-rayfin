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

export function buildSearchIndex(catalog: CatalogModel): MiniSearch<SearchDoc> {
    const index = new MiniSearch<SearchDoc>({
        idField: "id",
        fields: Object.keys(BOOSTS),
        storeFields: [
            "kind", "name", "displayName", "table", "topic",
            "description", "synonyms", "tags", "emoji",
        ],
        searchOptions: {
            boost: BOOSTS,
            prefix: true,
            fuzzy: 0.2,
            combineWith: "AND",
        },
    });
    index.addAll(toDocs(catalog));
    return index;
}

export function search(
    index: MiniSearch<SearchDoc>,
    query: string,
    limit = 50,
): CatalogSearchHit[] {
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
    return results.slice(0, limit).map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        displayName: r.displayName,
        table: r.table,
        topic: r.topic,
        description: r.description,
        synonyms: r.synonyms,
        tags: r.tags,
        emoji: r.emoji,
        score: r.score,
    }));
}

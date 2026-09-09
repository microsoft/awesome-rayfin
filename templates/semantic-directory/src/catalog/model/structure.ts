//-----------------------------------------------------------------------
// Semantic Directory — model-agnostic structural derivation.
//
// applyStructure() stamps purely-derivable, model-independent structure onto
// the catalog so the app works against ANY semantic model with zero curation:
//   • ontology class per table (fact / dimension / bridge / measure-host / …),
//     inferred from relationship participation + light name heuristics
//   • hubRank — how many tables join INTO a dimension (star-schema centrality)
//   • directLake — detected from the table's storage mode
//
// Deterministic + offline. No hardcoded model specifics.
//-----------------------------------------------------------------------

import type { CatalogModel, OntologyClass, RelationshipMeta } from "./types";
import { normName } from "./types";

const SECURITY_HINTS = ["security", "rls", "_rls", "useraccess", "permission"];
const OPERATIONAL_HINTS = [
    "config",
    "parameter",
    "measure selector",
    "kpi list",
    "calc group",
    "field parameter",
];

/** A table's participation summary across all model relationships. */
interface Participation {
    /** # relationships where this table is on the "many" side (points to a dim). */
    manyCount: number;
    /** Distinct tables that join INTO this table (i.e. it is the "one" side). */
    joinedInBy: Set<string>;
}

function isMany(cardinality: string): boolean {
    return cardinality.toLowerCase().startsWith("many");
}

/** Build per-table relationship participation, keyed by normalized name. */
function buildParticipation(relationships: RelationshipMeta[]): Map<string, Participation> {
    const map = new Map<string, Participation>();
    const get = (name: string): Participation => {
        const key = normName(name);
        let p = map.get(key);
        if (!p) {
            p = { manyCount: 0, joinedInBy: new Set() };
            map.set(key, p);
        }
        return p;
    };
    for (const r of relationships) {
        const from = get(r.fromTable);
        const to = get(r.toTable);
        // Tabular convention: the "many" endpoint is the fact-like side, the
        // "one" endpoint is the dimension-like side it joins into.
        if (isMany(r.fromCardinality)) {
            from.manyCount += 1;
            to.joinedInBy.add(normName(r.fromTable));
        }
        if (isMany(r.toCardinality)) {
            to.manyCount += 1;
            from.joinedInBy.add(normName(r.toTable));
        }
    }
    return map;
}

function classifyTable(
    name: string,
    columnCount: number,
    measureCount: number,
    participation: Participation | undefined,
): OntologyClass {
    const lower = name.toLowerCase();
    const manyCount = participation?.manyCount ?? 0;
    const joinedIn = participation?.joinedInBy.size ?? 0;

    // A table that holds measures but no real columns is a measures container.
    if (measureCount > 0 && columnCount <= 1) return "measure-host";
    if (lower.includes("bridge")) return "bridge";
    if (SECURITY_HINTS.some((h) => lower.includes(h))) return "security";
    if (OPERATIONAL_HINTS.some((h) => lower.includes(h))) return "operational";
    // Relationship-driven: points to dimensions and nothing joins into it → fact.
    if (manyCount > 0 && joinedIn === 0) return "fact";
    // Something joins into it → dimension (a hub other tables filter by).
    if (joinedIn > 0) return "dimension";
    // Name fallback for isolated tables.
    if (/\bfact\b/.test(lower)) return "fact";
    if (/\bdim\b|dimension/.test(lower)) return "dimension";
    return "dimension";
}

/**
 * Stamp model-agnostic structure (ontology, hubRank, directLake) onto the
 * catalog. Mutates tables in place; safe to call once per build.
 */
export function applyStructure(catalog: CatalogModel): void {
    const participation = buildParticipation(catalog.relationships);

    for (const t of catalog.tables) {
        const p = participation.get(normName(t.name));
        t.ontology = classifyTable(t.name, t.columnCount, t.measureCount, p);
        const joinedIn = p?.joinedInBy.size ?? 0;
        if (t.ontology === "dimension" && joinedIn > 0) t.hubRank = joinedIn;
        t.directLake = (t.storageMode ?? "").toLowerCase().includes("directlake");
    }
}

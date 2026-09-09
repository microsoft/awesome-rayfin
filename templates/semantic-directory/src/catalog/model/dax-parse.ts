//-----------------------------------------------------------------------
// Semantic Directory — DAX dependency parser.
//
// Extracts the real dependency graph from a measure's DAX expression:
//   - measure refs   →  bare  [Measure]        (no table qualifier)
//   - column refs    →  'Table'[Col] | Table[Col]
//   - table refs     →  the tables behind those column refs + bare table
//                       arguments to iterators (FILTER/ALL/…)
//
// Deterministic, offline, explainable — every edge traces to a token in the
// DAX. This is what makes the "built from" / lineage story possible without AI.
//
// DAX convention this relies on: a bracketed name WITHOUT a preceding table
// qualifier is a measure reference; a bracketed name WITH one is a column.
//-----------------------------------------------------------------------

/** Normalize a name for matching (mirror of model/types.normName). */
function norm(name: string): string {
    return name.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface DaxRefs {
    /** Normalized names of referenced measures (resolved against knownMeasures). */
    measures: string[];
    /** Fully-qualified column refs as `'Table'[Column]`. */
    columns: string[];
    /** Distinct table names referenced (from column refs + bare table args). */
    tables: string[];
    /** Bracketed bare refs that matched no known measure (unresolved). */
    unresolved: string[];
}

// Qualified column ref:  'Table Name'[Col]  |  TableName[Col]
const QUALIFIED = /(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))\[([^\]]+)\]/g;
// Any bracketed token (used for bare measure detection on the residual string).
const BRACKET = /\[([^\]]+)\]/g;
// Bare table argument to an iterator, e.g. FILTER(Sales_Fact, …)
// or quoted 'Calendar'. Captures identifiers that are known table names.
const BARE_TABLE = /(?:^|[(,]\s*)(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))(?=\s*[,)])/g;

/**
 * Parse a DAX expression into its dependency refs.
 *
 * @param expression  the measure DAX
 * @param knownMeasures  set of normalized measure names (to classify bare refs)
 * @param knownTables    optional set of normalized table names (to keep bare
 *                       table args to real tables only)
 */
export function parseDax(
    expression: string | null | undefined,
    knownMeasures: Set<string>,
    knownTables?: Set<string>,
): DaxRefs {
    if (!expression) {
        return { measures: [], columns: [], tables: [], unresolved: [] };
    }

    const columns = new Set<string>();
    const tables = new Set<string>();
    const rawTableNames = new Map<string, string>(); // norm -> original

    // --- Pass 1: qualified column refs ---
    let residual = expression;
    QUALIFIED.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = QUALIFIED.exec(expression)) !== null) {
        const table = (m[1] ?? m[2]).trim();
        const col = m[3].trim();
        columns.add(`'${table}'[${col}]`);
        tables.add(table);
        rawTableNames.set(norm(table), table);
    }
    // blank out qualified refs so they don't pollute the bare-measure pass
    residual = expression.replace(QUALIFIED, "  ");

    // --- Pass 2: bare measure refs on the residual ---
    const measures = new Set<string>();
    const unresolved = new Set<string>();
    BRACKET.lastIndex = 0;
    let b: RegExpExecArray | null;
    while ((b = BRACKET.exec(residual)) !== null) {
        const name = b[1].trim();
        const key = norm(name);
        if (knownMeasures.has(key)) measures.add(key);
        else unresolved.add(name);
    }

    // --- Pass 3: bare table arguments to iterators (FILTER, ALL, VALUES…) ---
    BARE_TABLE.lastIndex = 0;
    let t: RegExpExecArray | null;
    while ((t = BARE_TABLE.exec(expression)) !== null) {
        const name = (t[1] ?? t[2]).trim();
        const key = norm(name);
        if (!knownTables || knownTables.has(key)) {
            if (knownTables?.has(key) || rawTableNames.has(key)) {
                tables.add(rawTableNames.get(key) ?? name);
            }
        }
    }

    return {
        measures: [...measures].sort(),
        columns: [...columns].sort(),
        tables: [...tables].sort((a, b) => a.localeCompare(b)),
        unresolved: [...unresolved].sort(),
    };
}

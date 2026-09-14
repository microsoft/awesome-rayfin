//-----------------------------------------------------------------------
// Semantic Directory — friendly DAX "recipe".
//
// Turns a measure's DAX into a plain-English summary a user can read:
// what it aggregates, whether it's currency-aware, whether it uses time
// intelligence, and the building blocks it's made from (child measures +
// the columns/tables it reads). 100% deterministic pattern detection — no AI,
// every badge traces to a token in the expression.
//-----------------------------------------------------------------------

import type { CatalogModel, MeasureMeta } from "./types";
import { normName } from "./types";
import { memoByCatalog, memoByCatalogKey } from "../memo";

export interface DaxRecipe {
    /** Short plain-English badges describing what the measure does. */
    traits: string[];
    /** Child measures this is built from (display names). */
    childMeasures: { key: string; name: string }[];
    /** Columns it reads, grouped by table. */
    columnsByTable: { table: string; columns: string[] }[];
    /** True when there's a DAX expression to explain at all. */
    hasDax: boolean;
}

interface Pattern {
    label: string;
    test: RegExp;
}

// Ordered so the most meaningful traits surface first.
const PATTERNS: Pattern[] = [
    { label: "Currency-aware (US$ / Constant $)", test: /\[Default Currency\]|Constant Dollar|AmountCD\b/i },
    { label: "Quarter-to-date", test: /QTD|ReportingQTD/i },
    { label: "Year-to-date", test: /\bYTD\b|ReportingYTD/i },
    { label: "Time intelligence", test: /'Calendar'|FiscalMonth|FiscalQuarter|DATESYTD|DATESQTD|TOTALYTD|SAMEPERIODLASTYEAR/i },
    { label: "Prior-year comparison", test: /SAMEPERIODLASTYEAR|PARALLELPERIOD|Prior Year|\bPY\b/i },
    { label: "Variance calc", test: /\bVTT\b|\bVTF\b|\bVTB\b|Variance/i },
    { label: "Filtered aggregation", test: /\bCALCULATE\s*\(/i },
    { label: "Row-by-row iteration", test: /\bSUMX\s*\(|\bAVERAGEX\s*\(|\bFILTER\s*\(/i },
    { label: "Ratio / division", test: /\bDIVIDE\s*\(|\/\s*\[/ },
    { label: "Conditional logic", test: /\bIF\s*\(|\bSWITCH\s*\(/i },
];

const AGG_PATTERNS: Pattern[] = [
    { label: "Sums a column", test: /\bSUM\s*\(/i },
    { label: "Averages a column", test: /\bAVERAGE\s*\(/i },
    { label: "Counts rows", test: /\bCOUNT(ROWS|A|X)?\s*\(/i },
    { label: "Min / max", test: /\bMIN\s*\(|\bMAX\s*\(/i },
];

/** Plain-English, user-friendly explanation for each trait label above. */
export const TRAIT_HELP: Record<string, string> = {
    "Currency-aware (US$ / Constant $)": "Reports in US dollars or constant currency, so trends aren't distorted by exchange-rate swings.",
    "Quarter-to-date": "Adds up everything from the start of the quarter through the current day.",
    "Year-to-date": "Adds up everything from the start of the fiscal year through today.",
    "Time intelligence": "Uses the calendar to compare or accumulate figures across periods.",
    "Prior-year comparison": "Lines the number up against the same period last year.",
    "Variance calc": "Measures the gap — actual vs. target, forecast, or budget.",
    "Filtered aggregation": "Totals the data after narrowing it to a specific slice.",
    "Row-by-row iteration": "Calculates per row, then combines — used for weighted or ratio math.",
    "Ratio / division": "Divides one number by another (a rate, share, or average).",
    "Conditional logic": "Changes the result based on a condition.",
    "Sums a column": "Adds up the values in a column.",
    "Averages a column": "Takes the average of a column's values.",
    "Counts rows": "Counts how many rows match.",
    "Min / max": "Takes the smallest or largest value.",
};

/** Build a friendly recipe for a measure from its parsed deps + DAX text. */
/** Normalized measure-name → measure lookup, built once per catalog. */
const measureByNormName = memoByCatalog(
    (catalog: CatalogModel) =>
        new Map(catalog.measures.map((m) => [normName(m.name), m])),
);

export const explainDax = memoByCatalogKey(
    (catalog: CatalogModel, measure: MeasureMeta): DaxRecipe => {
        const dax = measure.dax ?? "";
        const hasDax = dax.trim().length > 0;

        const traits: string[] = [];
        for (const p of AGG_PATTERNS) if (p.test.test(dax)) { traits.push(p.label); break; }
        for (const p of PATTERNS) if (p.test.test(dax)) traits.push(p.label);

        // Child measures (resolve normalized names back to display names).
        const byKey = measureByNormName(catalog);
        const childMeasures = (measure.dependsOnMeasures ?? [])
            .map((k) => {
                const child = byKey.get(k);
                return child ? { key: child.key, name: child.displayName || child.name } : undefined;
            })
            .filter((x): x is { key: string; name: string } => !!x)
            .sort((a, b) => a.name.localeCompare(b.name));

        // Columns grouped by table.
        const grouped = new Map<string, Set<string>>();
        for (const ref of measure.dependsOnColumns ?? []) {
            const m = ref.match(/^'([^']+)'\[([^\]]+)\]$/);
            if (!m) continue;
            const [, table, col] = m;
            if (!grouped.has(table)) grouped.set(table, new Set());
            grouped.get(table)!.add(col);
        }
        const columnsByTable = [...grouped.entries()]
            .map(([table, cols]) => ({ table, columns: [...cols].sort() }))
            .sort((a, b) => b.columns.length - a.columns.length || a.table.localeCompare(b.table));

        return { traits: dedupe(traits), childMeasures, columnsByTable, hasDax };
    },
    (measure: MeasureMeta) => measure.key,
);

function dedupe(values: string[]): string[] {
    return Array.from(new Set(values));
}

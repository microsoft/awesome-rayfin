//-----------------------------------------------------------------------
// Semantic Directory — metadata row parsing helper.
//-----------------------------------------------------------------------

import type { QueryTable } from "@microsoft/fabric-app-data";

/**
 * Converts an SDK `QueryTable` (column defs + positional rows) into an array
 * of plain objects keyed by the column name with any surrounding DAX brackets
 * stripped (e.g. `"[Measure]"` -> `Measure`).
 *
 * This is the metadata-catalog counterpart to `toDataTable` (which targets
 * visuals). Here we want typed records, not a chart-ready DataTable.
 */
export function rowsToObjects<T = Record<string, unknown>>(
    table: QueryTable,
): T[] {
    const keys = table.columns.map((c) => stripBrackets(c.name));
    return table.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < keys.length; i++) {
            obj[keys[i]] = row[i];
        }
        return obj as T;
    });
}

/** Strip a single pair of surrounding square brackets from a DAX column name. */
export function stripBrackets(name: string): string {
    const m = /^\[(.*)\]$/.exec(name);
    return m ? m[1] : name;
}

/** Coerce a nullable DAX string cell to a trimmed string or undefined. */
export function str(value: unknown): string | undefined {
    if (value == null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
}

/** Coerce a DAX boolean cell (true/false/1/0/"True") to a boolean. */
export function bool(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value.toLowerCase() === "true";
    return false;
}

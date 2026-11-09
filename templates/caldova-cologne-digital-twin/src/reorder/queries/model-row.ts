/** A row as the semantic model returns it, keyed by fully-qualified column name. */
export type ModelRow = Record<string, unknown>;

export function textOf(value: unknown): string {
    return typeof value === "string" ? value : String(value ?? "");
}

export function numberOf(value: unknown): number {
    return typeof value === "number" ? value : Number(value ?? 0);
}

export function dateOf(value: unknown): Date {
    const text = textOf(value);

    // The model returns datetimes without an offset (`2026-06-14T00:00:00.000`)
    // and documents them as UTC. JavaScript reads an offset-less datetime as
    // local time, so a reorder sent at 14:52 in a UTC+2 room would otherwise
    // render as 12:52 — two hours in the past, on the row the demo pauses on.
    const isNakedDateTime = /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(text);

    return new Date(isNakedDateTime ? `${text}Z` : text);
}

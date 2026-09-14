//-----------------------------------------------------------------------
// Semantic Directory — kind badge (measure / dimension / table).
//-----------------------------------------------------------------------

import type { EntityKind } from "@/catalog/model/types";

const LABELS: Record<EntityKind, string> = {
    measure: "Measure",
    column: "Dimension",
    table: "Table",
};

const STYLES: Record<EntityKind, string> = {
    measure: "border-[color:var(--hue-measure)]/35 bg-[var(--hue-measure-soft)] text-foreground",
    column: "border-[color:var(--hue-column)]/35 bg-[var(--hue-column-soft)] text-foreground",
    table: "border-[color:var(--hue-table)]/35 bg-[var(--hue-table-soft)] text-foreground",
};

export function KindBadge({ kind }: { kind: EntityKind }) {
    return (
        <span
            className={`inline-flex items-center rounded-full border px-s py-xxs text-100 font-semibold uppercase tracking-wide ${STYLES[kind]}`}
        >
            {LABELS[kind]}
        </span>
    );
}

/** Neutral badge for a table's ontology role (Fact / Dimension / Bridge…). */
export function OntologyBadge({ label }: { label: string }) {
    return (
        <span className="inline-flex items-center rounded-full border border-border bg-secondary px-s py-xxs text-100 font-semibold text-muted-foreground">
            {label}
        </span>
    );
}

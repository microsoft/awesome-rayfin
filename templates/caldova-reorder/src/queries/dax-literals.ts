/**
 * Quote a value as a DAX string literal.
 *
 * The product-detail queries interpolate a sku and a store id into their DAX.
 * Those values come from the model rather than from a user, but a query that is
 * assembled by concatenation still has to close its own literals — a stray
 * quotation mark would otherwise change the meaning of the query rather than
 * fail it. DAX escapes a quote by doubling it.
 */
export function daxString(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Fill `{{name}}` placeholders in a query with escaped DAX literals.
 *
 * Every value goes through {@link daxString}, so callers cannot accidentally
 * interpolate a bare value.
 */
export function withParameters(query: string, parameters: Record<string, string>): string {
    return Object.entries(parameters).reduce(
        (filled, [name, value]) => filled.replaceAll(`{{${name}}}`, daxString(value)),
        query,
    );
}

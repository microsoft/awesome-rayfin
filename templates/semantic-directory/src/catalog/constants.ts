//-----------------------------------------------------------------------
// Semantic Directory — short-token vocabulary constants.
//
// Short business terms (acronyms, shorthand) that people type but that fall
// under the default 4-character typeahead threshold. When the query *exactly*
// matches one of these, the typeahead fires early so shorthand like "YTD" or
// "SKU" still feels instant. Extend this list with the shorthand your own
// model's users type.
//-----------------------------------------------------------------------

/** Known short tokens that should trigger typeahead at < 4 chars. */
export const SHORT_TOKENS: readonly string[] = [
    "ytd",
    "qtd",
    "mtd",
    "sku",
    "id",
];

/** Default number of typeahead rows shown under the search bar. */
export const TYPEAHEAD_LIMIT = 8;

/** Default character threshold before the typeahead opens. */
export const TYPEAHEAD_MIN_CHARS = 4;

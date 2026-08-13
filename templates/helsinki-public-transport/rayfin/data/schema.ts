/**
 * Rayfin data schema.
 *
 * This app stores nothing of its own: every reading comes from the Real-Time Intelligence stack
 * in Fabric and is queried with DAX against the semantic model, so the Rayfin data service is
 * switched off in `rayfin/rayfin.yml` and the schema is deliberately empty.
 *
 * Add entities here if you extend the app with state that belongs to the app rather than to the
 * Eventhouse - saved views, annotations, a watchlist of vehicles.
 */
export type DataAppSchema = Record<string, never>;

export const schema = [];

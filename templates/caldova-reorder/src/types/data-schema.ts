import type { RestockRequest } from "../../rayfin/data/RestockRequest";

/**
 * Entities behind the Rayfin data API.
 *
 * The app never writes these directly — reorders go through the `sendReorder`
 * function so that purchasing is called and the request is recorded together.
 */
export type AppSchema = {
    RestockRequest: RestockRequest;
};

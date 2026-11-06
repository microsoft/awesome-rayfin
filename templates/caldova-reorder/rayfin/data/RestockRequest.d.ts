/**
 * A reorder a regional manager sent to purchasing.
 *
 * Caldova's semantic model reads this table, so a request a manager sends here
 * shows up in the app, the regional dashboard and analytics as one number.
 * `requested_by` and `requested_at` are what make a request traceable.
 */
export declare class RestockRequest {
    id: string;
    store_id: string;
    sku: string;
    qty: number;
    /** Who asked for the restock, as the signed-in user. */
    requested_by: string;
    /** The requester's directory object id, so the request traces to an identity. */
    requested_by_id: string;
    /** When the request was made, in UTC. */
    requested_at: Date;
    status: 'submitted' | 'fulfilled';
    note?: string;
}

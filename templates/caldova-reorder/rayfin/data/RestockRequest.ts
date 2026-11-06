import { entity, role, uuid, text, int, date, set } from '@microsoft/rayfin-core';

/**
 * A reorder a regional manager sent to purchasing.
 *
 * Caldova's semantic model reads this table, so a request a manager sends here
 * shows up in the app, the regional dashboard and analytics as one number.
 * `requested_by` and `requested_at` are what make a request traceable.
 */
@entity()
// No database policy on any action, deliberately.
//
// `create` cannot carry one: an INSERT has no WHERE clause for Data API Builder
// to attach a policy to, so declaring one fails every write.
//
// `read` and `delete` could, but the policy would have to match on `claims.sub`,
// and the Fabric-brokered session token does not carry that claim — Data API
// Builder applies read rules to the row a mutation returns, so an unevaluable
// policy breaks the write too.
//
// `delete` is therefore wider at the data layer than it looks: any signed-in
// user could delete a row through the data API. It exists for the demo reset,
// which deletes only the caller's own reorders — that ownership check lives in
// `resetDemoReorders`, not here, because here it cannot.
//
// Neither is a gap for the paths this app actually uses. Reorders are only ever
// written by the `sendReorder` function, which takes the requester from the
// signed-in identity rather than from the caller, so a reorder cannot be
// attributed to somebody else. And what a manager *sees* is scoped by the
// semantic model's own `RegionalManager` row-level security, which is where that
// rule belongs.
@role('authenticated', ['create', 'read', 'delete'])
export class RestockRequest {
  @uuid() id!: string;
  @text({ max: 32 }) store_id!: string;
  @text({ max: 32 }) sku!: string;
  @int() qty!: number;

  /** Who asked for the restock, as the signed-in user. */
  @text({ max: 200 }) requested_by!: string;

  /**
   * The requester's directory object id, so the request traces to an identity.
   *
   * Sized generously on purpose. The Fabric-brokered session token's subject
   * claim is not a GUID — the observed value is 198 characters — so the obvious
   * 64 is far too small, and even 200 leaves no margin for an identity of a
   * slightly different shape. An overflow here fails the write with a database
   * error rather than anything a reader could act on.
   */
  @text({ max: 400 }) requested_by_id!: string;

  /** When the request was made, in UTC. */
  @date() requested_at!: Date;

  @set('submitted', 'fulfilled') status!: 'submitted' | 'fulfilled';

  @text({ max: 400, optional: true }) note?: string;
}

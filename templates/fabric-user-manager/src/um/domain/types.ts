/**
 * Fabric User Manager: shared domain types.
 *
 * The chain is Person -> Entra group -> (workspace role | Org App audience |
 * model role). Everything here describes the second and first hop as *read*
 * state. Nothing in this folder performs a change.
 */

/** The three tabs. `ModelRole` covers both RLS and OLS roles. */
export type TargetKind = 'Workspace' | 'Audience' | 'ModelRole';
export const TARGET_KINDS: readonly TargetKind[] = ['Workspace', 'Audience', 'ModelRole'];

export const WORKSPACE_ROLES = ['Viewer', 'Contributor', 'Member', 'Admin'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Roles whose groups are changed by app admins only. */
export const HIGH_ROLES: readonly WorkspaceRole[] = ['Member', 'Admin'];

/**
 * How the app knows about a binding.
 *
 * - `read`: a platform API stated it (workspace role assignments).
 * - `inferred`: derived from a platform API that does not state it directly
 *   (who an audience is shared with, worked out from an item's access list).
 * - `attested`: an admin recorded it.
 *
 * Only `read` may be shown as fact.
 */
export type Provenance = 'read' | 'attested' | 'inferred';

export interface Binding {
  groupId: string;
  kind: TargetKind;
  /** Workspace, Org App or semantic model id. Absent for typed-in rows. */
  scopeId?: string;
  scopeName: string;
  /** Workspace role, audience name or model role name. */
  label: string;
  provenance: Provenance;
}

/** Stable identity of a binding, for diffing and React keys. */
export function bindingKey(b: Pick<Binding, 'groupId' | 'kind' | 'scopeId' | 'scopeName' | 'label'>): string {
  return [b.groupId.toLowerCase(), b.kind, (b.scopeId ?? b.scopeName).toLowerCase(), b.label.toLowerCase()].join('|');
}

/**
 * A value that may be unreadable. "Not readable" must never collapse into an
 * empty list: an empty table still looks like an answer.
 */
export type Readable<T> =
  | { state: 'ok'; value: T }
  | { state: 'not-readable'; reason: NotReadableReason; detail?: string };

export type NotReadableReason =
  | 'access-denied'
  | 'no-route'
  | 'limit'
  | 'rate-limited'
  | 'failed'
  | 'function-unavailable';

export const ok = <T>(value: T): Readable<T> => ({ state: 'ok', value });
export const notReadable = <T>(reason: NotReadableReason, detail?: string): Readable<T> => ({
  state: 'not-readable',
  reason,
  detail,
});

/** Group facts as Graph returned them. `undefined` means "Graph did not say". */
export interface GroupFacts {
  id: string;
  displayName: string;
  description?: string | null;
  securityEnabled?: boolean;
  mailEnabled?: boolean;
  groupTypes?: string[];
  isAssignableToRole?: boolean | null;
  onPremisesSyncEnabled?: boolean | null;
  membershipRule?: string | null;
}

export type DirectoryObjectType = 'user' | 'group' | 'servicePrincipal' | 'device' | 'other';

export interface DirectoryMember {
  id: string;
  type: DirectoryObjectType;
  displayName?: string;
  userPrincipalName?: string;
  /** `Member` or `Guest` for users, when Graph returned it. */
  userType?: string;
  accountEnabled?: boolean;
}

/** The acting identity. Always taken from Graph `/me`, never from the app session. */
export interface GraphIdentity {
  objectId: string;
  userPrincipalName: string;
  displayName: string;
  mail?: string | null;
}

export type FabricPrincipalType = 'User' | 'Group' | 'ServicePrincipal' | 'ServicePrincipalProfile' | 'EntireTenant' | 'Other';

export interface RoleAssignment {
  id: string;
  principalId: string;
  principalType: FabricPrincipalType;
  principalName?: string;
  role: string;
}

export interface FabricWorkspace {
  id: string;
  displayName: string;
  type?: string;
}

export type FabricItemType = 'OrgApp' | 'OrgAppAudience' | 'SemanticModel';
export const FABRIC_ITEM_TYPES: readonly FabricItemType[] = ['OrgApp', 'OrgAppAudience', 'SemanticModel'];

export interface FabricItem {
  id: string;
  displayName: string;
  type: string;
  workspaceId: string;
}

/** One access entry of an item, as the Fabric administrator API lists it. */
export interface ItemAccess {
  principalId: string;
  principalType: FabricPrincipalType;
  principalName?: string;
  permissions: string[];
}

/** A group the app admins activated for owner management. Stored in the app database. */
export interface ManagedGroup {
  id: string;
  groupId: string;
  /** Name read from Graph at activation. Informational; live name wins when readable. */
  nameSnapshot: string;
  requestable: boolean;
  description: string;
  /** Upper limit for a review date, in days. 0 means no limit. */
  maxDays: number;
  active: boolean;
  version: number;
  activatedByOid: string;
  activatedByUpn: string;
  activatedAt: string;
  updatedAt: string;
  /** Editable fields before the last import, JSON, for rollback. */
  previousJson?: string;
  importId?: string;
}

export const GUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function isGuid(value: unknown): value is string {
  return typeof value === 'string' && GUID.test(value) && !/^0{8}(-0{4}){3}-0{12}$/.test(value);
}

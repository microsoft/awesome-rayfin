/**
 * The two read gateways of the Fabric User Manager and their live
 * implementations.
 *
 * - `DirectoryGateway`: Microsoft Graph, called from the browser with the
 *   signed-in person's own delegated token.
 * - `FabricGateway`: the app's backend function, because the Fabric API
 *   cannot be called from a browser.
 *
 * Both are interfaces so the whole app runs against fixtures (`mock.ts`) and
 * every view is testable without a tenant.
 */
import type { FabricOpRequest, FabricOpResult } from './fabricOps';

import { shapeIdentity } from '@/um/domain/identity';
import {
  isGuid,
  notReadable,
  ok,
  type DirectoryMember,
  type DirectoryObjectType,
  type FabricItem,
  type FabricItemType,
  type FabricPrincipalType,
  type FabricWorkspace,
  type GraphIdentity,
  type GroupFacts,
  type ItemAccess,
  type Readable,
  type RoleAssignment,
} from '@/um/domain/types';

import type { NamedGroup } from '@/um/domain/groupCreate';

import { getGraphToken, type ScopeSet, type TokenOptions } from './graphAuth';
import { graphGetAll, graphGetOne, type GraphFetch } from './graphRead';

export interface DirectoryGateway {
  /** The acting identity, from Graph `/me`. Throws when no token can be had. */
  me(options?: TokenOptions): Promise<GraphIdentity>;
  /** Ids of groups the signed-in person is a direct member of. */
  myGroupIds(): Promise<Readable<string[]>>;
  /** Ids of groups the signed-in person is in, directly or through other groups. */
  myTransitiveGroupIds(): Promise<Readable<string[]>>;
  /** Ids of groups the signed-in person owns. */
  myOwnedGroupIds(): Promise<Readable<string[]>>;
  getGroup(groupId: string, options?: TokenOptions): Promise<Readable<GroupFacts>>;
  listOwners(groupId: string, options?: TokenOptions): Promise<Readable<DirectoryMember[]>>;
  listMembers(groupId: string, options?: TokenOptions): Promise<Readable<DirectoryMember[]>>;
  /** Resolve one user by user principal name or object id. `null` when none. */
  findUser(query: string, options?: TokenOptions): Promise<Readable<DirectoryMember | null>>;
  /** Groups that carry exactly this display name, each with its mail alias. */
  findGroupsByName(displayName: string): Promise<Readable<NamedGroup[]>>;
  /**
   * Resolve one user for a member change, including type and enabled state.
   * Uses the permission set of member changes, which must already be held.
   */
  resolveUser(query: string): Promise<Readable<DirectoryMember | null>>;
}

export interface FabricGateway {
  listWorkspaces(): Promise<Readable<FabricWorkspace[]>>;
  listRoleAssignments(workspaceId: string): Promise<Readable<RoleAssignment[]>>;
  listItems(workspaceId: string, itemType: FabricItemType): Promise<Readable<FabricItem[]>>;
  /** Everyone with access to one item. Needs a Fabric administrator. */
  listItemAccess(workspaceId: string, itemId: string): Promise<Readable<ItemAccess[]>>;
}

const MEMBER_SELECT = '$select=id,displayName,userPrincipalName,userType,accountEnabled';
const GROUP_SELECT =
  '$select=id,displayName,description,securityEnabled,mailEnabled,groupTypes,isAssignableToRole,onPremisesSyncEnabled,membershipRule';

function objectType(raw: Record<string, unknown>): DirectoryObjectType {
  const type = String(raw['@odata.type'] ?? '').replace('#microsoft.graph.', '');
  if (type === 'user' || type === 'group' || type === 'servicePrincipal' || type === 'device') return type;
  // `/users/{id}` returns no `@odata.type`; a userPrincipalName marks a user.
  if (!type && typeof raw.userPrincipalName === 'string') return 'user';
  return 'other';
}

export function shapeMember(raw: Record<string, unknown>): DirectoryMember | null {
  if (!isGuid(raw.id)) return null;
  return {
    id: raw.id.toLowerCase(),
    type: objectType(raw),
    displayName: typeof raw.displayName === 'string' ? raw.displayName : undefined,
    userPrincipalName: typeof raw.userPrincipalName === 'string' ? raw.userPrincipalName : undefined,
    userType: typeof raw.userType === 'string' ? raw.userType : undefined,
    accountEnabled: typeof raw.accountEnabled === 'boolean' ? raw.accountEnabled : undefined,
  };
}

export function shapeGroup(raw: Record<string, unknown>): GroupFacts | null {
  if (!isGuid(raw.id) || typeof raw.displayName !== 'string') return null;
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  const nullableBool = (v: unknown) => (typeof v === 'boolean' || v === null ? (v as boolean | null) : undefined);
  return {
    id: raw.id.toLowerCase(),
    displayName: raw.displayName,
    description: typeof raw.description === 'string' ? raw.description : null,
    securityEnabled: bool(raw.securityEnabled),
    mailEnabled: bool(raw.mailEnabled),
    groupTypes: Array.isArray(raw.groupTypes) ? raw.groupTypes.filter((t): t is string => typeof t === 'string') : undefined,
    isAssignableToRole: nullableBool(raw.isAssignableToRole),
    onPremisesSyncEnabled: nullableBool(raw.onPremisesSyncEnabled),
    membershipRule: typeof raw.membershipRule === 'string' || raw.membershipRule === null ? (raw.membershipRule as string | null) : undefined,
  };
}

function ids(list: Readable<Record<string, unknown>[]>): Readable<string[]> {
  if (list.state !== 'ok') return list;
  return ok(list.value.map((g) => g.id).filter(isGuid).map((id) => id.toLowerCase()));
}

function members(list: Readable<Record<string, unknown>[]>): Readable<DirectoryMember[]> {
  if (list.state !== 'ok') return list;
  return ok(list.value.map(shapeMember).filter((m): m is DirectoryMember => m !== null));
}

/** No token without a click: the read did not happen, which is not the same as empty. */
const SIGN_IN: Readable<never> = { state: 'not-readable', reason: 'access-denied', detail: 'sign-in' };
const USER_PRINCIPAL_NAME = /^[^\s/\\?#%'"<>]{1,113}@[^\s/\\?#%'"<>@]{1,255}$/;

export type TokenProvider = (scopeSet: ScopeSet, options?: TokenOptions) => Promise<string>;

/** Graph with the signed-in person's own token. GET only. */
export class GraphDirectoryGateway implements DirectoryGateway {
  constructor(
    private readonly tokens: TokenProvider = getGraphToken,
    private readonly fetcher: GraphFetch = (url, init) => fetch(url, init)
  ) {}

  /** A token, or `null` when one needs a click first. Reads then say "not readable". */
  private async token(scopeSet: ScopeSet, options?: TokenOptions): Promise<string | null> {
    try {
      return await this.tokens(scopeSet, options);
    } catch {
      return null;
    }
  }

  async me(options?: TokenOptions): Promise<GraphIdentity> {
    const token = await this.tokens('base', options);
    const raw = await graphGetOne('/me?$select=id,userPrincipalName,displayName,mail', token, this.fetcher);
    const identity = raw.state === 'ok' ? shapeIdentity(raw.value) : null;
    if (!identity) throw new Error('Graph did not return an identity for this token.');
    return identity;
  }

  async myGroupIds(): Promise<Readable<string[]>> {
    const token = await this.token('base');
    if (!token) return SIGN_IN;
    return ids(await graphGetAll('/me/memberOf/microsoft.graph.group?$select=id&$top=999', token, this.fetcher));
  }

  async myTransitiveGroupIds(): Promise<Readable<string[]>> {
    const token = await this.token('base');
    if (!token) return SIGN_IN;
    return ids(await graphGetAll('/me/transitiveMemberOf/microsoft.graph.group?$select=id&$top=999', token, this.fetcher));
  }

  async myOwnedGroupIds(): Promise<Readable<string[]>> {
    const token = await this.token('base');
    if (!token) return SIGN_IN;
    return ids(await graphGetAll('/me/ownedObjects/microsoft.graph.group?$select=id&$top=999', token, this.fetcher));
  }

  async getGroup(groupId: string, options?: TokenOptions): Promise<Readable<GroupFacts>> {
    if (!isGuid(groupId)) return notReadable('failed', 'bad-id');
    const token = await this.token('directory', options);
    if (!token) return SIGN_IN;
    const raw = await graphGetOne(`/groups/${groupId.toLowerCase()}?${GROUP_SELECT}`, token, this.fetcher);
    if (raw.state !== 'ok') return raw;
    const shaped = shapeGroup(raw.value);
    return shaped ? ok(shaped) : notReadable('failed', 'shape');
  }

  async listOwners(groupId: string, options?: TokenOptions): Promise<Readable<DirectoryMember[]>> {
    if (!isGuid(groupId)) return notReadable('failed', 'bad-id');
    const token = await this.token('directory', options);
    if (!token) return SIGN_IN;
    return members(await graphGetAll(`/groups/${groupId.toLowerCase()}/owners?${MEMBER_SELECT}&$top=999`, token, this.fetcher));
  }

  async listMembers(groupId: string, options?: TokenOptions): Promise<Readable<DirectoryMember[]>> {
    if (!isGuid(groupId)) return notReadable('failed', 'bad-id');
    const token = await this.token('directory', options);
    if (!token) return SIGN_IN;
    return members(await graphGetAll(`/groups/${groupId.toLowerCase()}/members?${MEMBER_SELECT}&$top=999`, token, this.fetcher));
  }

  resolveUser(query: string): Promise<Readable<DirectoryMember | null>> {
    return this.lookUp(query, 'memberChange');
  }

  async findGroupsByName(displayName: string): Promise<Readable<NamedGroup[]>> {
    const name = displayName.trim();
    if (name.length === 0 || name.length > 256) return notReadable('failed', 'bad-name');
    const token = await this.token('directory');
    if (!token) return SIGN_IN;
    // A quote inside an OData string is written twice; the whole value is then encoded for the address.
    const filter = encodeURIComponent(`displayName eq '${name.replace(/'/g, "''")}'`);
    const raw = await graphGetAll(`/groups?$filter=${filter}&$select=id,displayName,mailNickname&$top=20`, token, this.fetcher);
    if (raw.state !== 'ok') return raw;
    return ok(
      raw.value
        .filter((g) => isGuid(g.id) && typeof g.displayName === 'string')
        .map((g) => ({ id: String(g.id).toLowerCase(), displayName: String(g.displayName), mailNickname: typeof g.mailNickname === 'string' ? g.mailNickname : undefined }))
    );
  }

  findUser(query: string, options?: TokenOptions): Promise<Readable<DirectoryMember | null>> {
    return this.lookUp(query, 'directory', options);
  }

  private async lookUp(query: string, scopeSet: ScopeSet, options?: TokenOptions): Promise<Readable<DirectoryMember | null>> {
    const q = query.trim();
    // Only an object id or something shaped like a user principal name is
    // sent to Graph, so nothing unexpected can reach the URL path.
    if (!isGuid(q) && !USER_PRINCIPAL_NAME.test(q)) return ok(null);
    const token = await this.token(scopeSet, options);
    if (!token) return SIGN_IN;
    const raw = await graphGetOne(`/users/${encodeURIComponent(q)}?${MEMBER_SELECT}`, token, this.fetcher);
    if (raw.state !== 'ok') return raw.detail === '404' ? ok(null) : raw;
    const shaped = shapeMember(raw.value);
    return ok(shaped ? { ...shaped, type: 'user' } : null);
  }
}

const PRINCIPAL_TYPES: readonly FabricPrincipalType[] = ['User', 'Group', 'ServicePrincipal', 'ServicePrincipalProfile', 'EntireTenant'];

function principalType(value: string): FabricPrincipalType {
  return (PRINCIPAL_TYPES as readonly string[]).includes(value) ? (value as FabricPrincipalType) : 'Other';
}

function fromOp<T>(result: FabricOpResult, map: (value: unknown[]) => T): Readable<T> {
  if (result.ok) return ok(map(result.value as unknown[]));
  if (result.code === 'ACCESS_DENIED') return notReadable('access-denied');
  // No token without a click: the read did not happen.
  if (result.code === 'AUTH_UNAVAILABLE') return notReadable('access-denied', 'sign-in');
  if (result.code === 'LIMIT_EXCEEDED') return notReadable('limit');
  if (result.code === 'RATE_LIMITED') return notReadable('rate-limited');
  return notReadable('failed', result.code);
}

export type FabricOpInvoker = (request: FabricOpRequest) => Promise<FabricOpResult>;

/** Fabric through the closed operation list in `fabricOps.ts`. */
export class OpFabricGateway implements FabricGateway {
  constructor(private readonly invoke: FabricOpInvoker) {}

  private async run(request: FabricOpRequest): Promise<FabricOpResult> {
    try {
      return await this.invoke(request);
    } catch {
      return { ok: false, code: 'READ_FAILED' };
    }
  }

  async listWorkspaces(): Promise<Readable<FabricWorkspace[]>> {
    return fromOp(await this.run({ op: 'listWorkspaces' }), (v) => v as FabricWorkspace[]);
  }

  async listRoleAssignments(workspaceId: string): Promise<Readable<RoleAssignment[]>> {
    return fromOp(await this.run({ op: 'listRoleAssignments', workspaceId }), (v) =>
      (v as { id: string; principalId: string; principalType: string; principalName: string; role: string }[]).map((r) => ({
        ...r,
        principalType: principalType(r.principalType),
      }))
    );
  }

  async listItems(workspaceId: string, itemType: FabricItemType): Promise<Readable<FabricItem[]>> {
    return fromOp(await this.run({ op: 'listItems', workspaceId, itemType }), (v) => v as FabricItem[]);
  }

  async listItemAccess(workspaceId: string, itemId: string): Promise<Readable<ItemAccess[]>> {
    return fromOp(await this.run({ op: 'listItemAccess', workspaceId, itemId }), (v) =>
      (v as { principalId: string; principalType: string; principalName: string; permissions: string[] }[]).map((r) => ({
        ...r,
        principalType: principalType(r.principalType),
      }))
    );
  }
}

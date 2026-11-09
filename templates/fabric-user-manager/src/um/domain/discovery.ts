/**
 * Discovery: turn what Fabric and Graph returned into bindings and findings
 * Pure, so the honesty rules are testable offline:
 *
 * - "Not readable" never becomes "empty".
 * - Findings report; they change nothing.
 * - A group bound to the workspace Admin or Member role is a finding unless
 *   every owner is an app admin, because an owner can grant that role in
 *   Entra without this app. When owners or the admin list cannot be read,
 *   that is its own finding, not silence.
 */
import { assessGroup, countMembers, type IneligibleReason } from './eligibility';
import {
  HIGH_ROLES,
  bindingKey,
  type Binding,
  type DirectoryMember,
  type FabricItem,
  type FabricWorkspace,
  type GroupFacts,
  type ItemAccess,
  type Readable,
  type RoleAssignment,
  type WorkspaceRole,
} from './types';

export interface WorkspaceDiscovery {
  workspace: FabricWorkspace;
  roleAssignments: Readable<RoleAssignment[]>;
  orgApps: Readable<FabricItem[]>;
  audiences: Readable<FabricItem[]>;
  models: Readable<FabricItem[]>;
  /** Access list per audience item id. Absent when recipients were not read. */
  audienceAccess?: Record<string, Readable<ItemAccess[]>>;
}

export interface GroupDiscovery {
  facts: Readable<GroupFacts>;
  owners: Readable<DirectoryMember[]>;
  members: Readable<DirectoryMember[]>;
}

export interface DiscoveryInput {
  observedAt: string;
  workspaces: Readable<FabricWorkspace[]>;
  perWorkspace: WorkspaceDiscovery[];
  /** Keyed by lower-case group id. */
  groups: Record<string, GroupDiscovery>;
  /** Object ids of the app admin group's members. */
  appAdminIds: Readable<string[]>;
  /** Workspaces left out because of the discovery bound. Never silently dropped. */
  workspacesSkipped?: number;
  /** Bound groups whose facts were not fetched because of the bound. */
  groupsSkipped?: number;
  /** Audiences whose sharing was not read because of the bound. */
  audiencesSkipped?: number;
}

export type Finding =
  | { type: 'direct-user'; workspaceId: string; workspaceName: string; role: string; principalId: string; principalName: string }
  | { type: 'service-principal'; workspaceId: string; workspaceName: string; role: string; principalId: string; principalName: string }
  | { type: 'tenant-wide'; workspaceId: string; workspaceName: string; role: string }
  | { type: 'audience-direct'; workspaceName: string; audience: string; principalName: string }
  | { type: 'ineligible-group'; groupId: string; groupName: string; reasons: IneligibleReason[] }
  | { type: 'multi-bound'; groupId: string; groupName: string; count: number }
  | { type: 'nested-group'; groupId: string; groupName: string; count: number }
  | { type: 'no-owner'; groupId: string; groupName: string }
  | { type: 'high-role-owner'; groupId: string; groupName: string; workspaceName: string; role: string; ownerNames: string[] }
  | { type: 'high-role-unknown'; groupId: string; groupName: string; workspaceName: string; role: string };

export type FindingType = Finding['type'];

export interface DiscoveredGroup {
  groupId: string;
  /** Live name when Graph could be read, else the name Fabric showed. */
  name: string;
  facts: Readable<GroupFacts>;
  owners: Readable<DirectoryMember[]>;
  members: Readable<DirectoryMember[]>;
  eligible: boolean | 'unknown';
  ineligibleReasons: IneligibleReason[];
  bindings: Binding[];
}

export interface DiscoveryResult {
  observedAt: string;
  workspaces: Readable<FabricWorkspace[]>;
  perWorkspace: WorkspaceDiscovery[];
  groups: DiscoveredGroup[];
  bindings: Binding[];
  findings: Finding[];
  coverage: {
    workspaces: number;
    rolesReadable: number;
    rolesNotReadable: number;
    workspacesSkipped: number;
    groupsSkipped: number;
    /** Audiences whose recipients were read, and those where that failed. */
    audiencesRead: number;
    audiencesNotReadable: number;
    audiencesSkipped: number;
  };
}

/**
 * Who an item is shared with beyond the workspace roles.
 *
 * The access list mixes inherited and direct access and does not say which is
 * which. A principal that holds a workspace role accounts for one entry; any
 * further entry of the same principal, and every entry of a principal without
 * a workspace role, is a direct share.
 */
export function directRecipients(access: readonly ItemAccess[], roleHolderIds: ReadonlySet<string>): ItemAccess[] {
  const seen = new Map<string, number>();
  const direct: ItemAccess[] = [];
  for (const entry of access) {
    const id = entry.principalId.toLowerCase();
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    const inherited = roleHolderIds.has(id) ? 1 : 0;
    // Report each principal once, at its first direct entry.
    if (count === inherited + 1) direct.push(entry);
  }
  return direct;
}

function isHighRole(role: string): role is WorkspaceRole {
  return (HIGH_ROLES as readonly string[]).includes(role);
}

export function buildDiscovery(input: DiscoveryInput): DiscoveryResult {
  const findings: Finding[] = [];
  const bindings: Binding[] = [];
  const fabricNames = new Map<string, string>();
  let rolesReadable = 0;
  let rolesNotReadable = 0;

  for (const ws of input.perWorkspace) {
    const { workspace } = ws;
    if (ws.roleAssignments.state !== 'ok') {
      rolesNotReadable += 1;
      continue;
    }
    rolesReadable += 1;
    for (const assignment of ws.roleAssignments.value) {
      const base = { workspaceId: workspace.id, workspaceName: workspace.displayName, role: assignment.role };
      switch (assignment.principalType) {
        case 'Group':
          if (assignment.principalName) fabricNames.set(assignment.principalId, assignment.principalName);
          bindings.push({
            groupId: assignment.principalId,
            kind: 'Workspace',
            scopeId: workspace.id,
            scopeName: workspace.displayName,
            label: assignment.role,
            provenance: 'read',
          });
          break;
        case 'User':
          findings.push({ type: 'direct-user', ...base, principalId: assignment.principalId, principalName: assignment.principalName ?? '' });
          break;
        case 'EntireTenant':
          findings.push({ type: 'tenant-wide', ...base });
          break;
        default:
          findings.push({ type: 'service-principal', ...base, principalId: assignment.principalId, principalName: assignment.principalName ?? '' });
      }
    }
  }

  // Audiences: groups an audience is shared with become read bindings.
  let audiencesRead = 0;
  let audiencesNotReadable = 0;
  for (const ws of input.perWorkspace) {
    if (!ws.audienceAccess || ws.audiences.state !== 'ok') continue;
    for (const audience of ws.audiences.value) {
      const access = ws.audienceAccess[audience.id];
      // Without the workspace roles, inherited and direct access cannot be told apart.
      if (!access || access.state !== 'ok' || ws.roleAssignments.state !== 'ok') {
        if (access) audiencesNotReadable += 1;
        continue;
      }
      audiencesRead += 1;
      const roleHolders = new Set(ws.roleAssignments.value.map((a) => a.principalId.toLowerCase()));
      for (const entry of directRecipients(access.value, roleHolders)) {
        if (entry.principalType === 'Group') {
          if (entry.principalName) fabricNames.set(entry.principalId, entry.principalName);
          bindings.push({
            groupId: entry.principalId,
            kind: 'Audience',
            scopeId: audience.id,
            scopeName: ws.workspace.displayName,
            label: audience.displayName,
            // Fabric lists who has access, not who was shared to. This is derived.
            provenance: 'inferred',
          });
        } else {
          findings.push({
            type: 'audience-direct',
            workspaceName: ws.workspace.displayName,
            audience: audience.displayName,
            principalName: entry.principalName || entry.principalId,
          });
        }
      }
    }
  }

  const byGroup = new Map<string, Binding[]>();
  for (const binding of bindings) {
    const list = byGroup.get(binding.groupId) ?? [];
    list.push(binding);
    byGroup.set(binding.groupId, list);
  }

  const adminIds = input.appAdminIds.state === 'ok' ? new Set(input.appAdminIds.value.map((id) => id.toLowerCase())) : null;

  const groups: DiscoveredGroup[] = [];
  for (const [groupId, groupBindings] of byGroup) {
    const discovered = input.groups[groupId.toLowerCase()];
    const facts: Readable<GroupFacts> = discovered?.facts ?? { state: 'not-readable', reason: 'no-route' };
    const owners: Readable<DirectoryMember[]> = discovered?.owners ?? { state: 'not-readable', reason: 'no-route' };
    const members: Readable<DirectoryMember[]> = discovered?.members ?? { state: 'not-readable', reason: 'no-route' };
    const name = facts.state === 'ok' ? facts.value.displayName : (fabricNames.get(groupId) ?? groupId);

    let eligible: boolean | 'unknown' = 'unknown';
    let reasons: IneligibleReason[] = [];
    if (facts.state === 'ok') {
      const assessment = assessGroup(facts.value);
      eligible = assessment.eligible;
      reasons = assessment.reasons;
      if (!assessment.eligible) {
        findings.push({ type: 'ineligible-group', groupId, groupName: name, reasons });
      }
    }

    if (groupBindings.length > 1) {
      findings.push({ type: 'multi-bound', groupId, groupName: name, count: groupBindings.length });
    }
    if (members.state === 'ok') {
      const nested = countMembers(members.value).nestedGroups;
      if (nested > 0) findings.push({ type: 'nested-group', groupId, groupName: name, count: nested });
    }
    if (owners.state === 'ok' && owners.value.length === 0) {
      findings.push({ type: 'no-owner', groupId, groupName: name });
    }

    for (const binding of groupBindings) {
      if (!isHighRole(binding.label)) continue;
      const common = { groupId, groupName: name, workspaceName: binding.scopeName, role: binding.label };
      if (owners.state !== 'ok' || !adminIds) {
        findings.push({ type: 'high-role-unknown', ...common });
        continue;
      }
      const outsiders = owners.value.filter((o) => !adminIds.has(o.id.toLowerCase()));
      if (outsiders.length > 0) {
        findings.push({
          type: 'high-role-owner',
          ...common,
          ownerNames: outsiders.map((o) => o.userPrincipalName || o.displayName || o.id),
        });
      }
    }

    groups.push({ groupId, name, facts, owners, members, eligible, ineligibleReasons: reasons, bindings: groupBindings });
  }

  groups.sort((a, b) => a.name.localeCompare(b.name));

  return {
    observedAt: input.observedAt,
    workspaces: input.workspaces,
    perWorkspace: input.perWorkspace,
    groups,
    bindings,
    findings,
    coverage: {
      workspaces: input.perWorkspace.length,
      rolesReadable,
      rolesNotReadable,
      workspacesSkipped: input.workspacesSkipped ?? 0,
      groupsSkipped: input.groupsSkipped ?? 0,
      audiencesRead,
      audiencesNotReadable,
      audiencesSkipped: input.audiencesSkipped ?? 0,
    },
  };
}

/** True when a group is bound to the workspace Admin or Member role. */
export function isHighRoleGroup(bindings: readonly Binding[]): boolean {
  return bindings.some((b) => b.kind === 'Workspace' && isHighRole(b.label));
}

/** Audience item ids whose sharing was actually worked out in this discovery. */
export function audiencesWorkedOut(result: Pick<DiscoveryResult, 'perWorkspace'>): Set<string> {
  const ids = new Set<string>();
  for (const ws of result.perWorkspace) {
    if (ws.roleAssignments.state !== 'ok') continue;
    for (const [id, access] of Object.entries(ws.audienceAccess ?? {})) if (access.state === 'ok') ids.add(id.toLowerCase());
  }
  return ids;
}

const PROVENANCE_RANK: Record<Binding['provenance'], number> = { attested: 0, inferred: 1, read: 2 };

/**
 * Merge read and stored bindings of one group. For the same access, what a
 * platform stated wins over what was derived, and both win over what an admin
 * confirmed, whatever order they arrive in. Between equals, the fresh read wins.
 */
export function mergeBindings(read: readonly Binding[], stored: readonly Binding[]): Binding[] {
  const merged = new Map<string, Binding>();
  for (const b of [...stored, ...read]) {
    const key = bindingKey(b);
    const have = merged.get(key);
    if (!have || PROVENANCE_RANK[b.provenance] >= PROVENANCE_RANK[have.provenance]) merged.set(key, b);
  }
  return [...merged.values()];
}

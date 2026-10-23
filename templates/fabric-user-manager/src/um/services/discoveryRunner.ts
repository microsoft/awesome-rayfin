/**
 * Runs discovery for an app admin.
 *
 * Reads only, bounded in workspaces, groups and parallelism, with the
 * signed-in admin's own reach. The result stays in the browser
 * session; only the bindings of activated groups are stored afterwards.
 */
import { buildDiscovery, type DiscoveryResult, type GroupDiscovery, type WorkspaceDiscovery } from '@/um/domain/discovery';
import { notReadable, ok, type FabricWorkspace, type Readable } from '@/um/domain/types';

import type { DirectoryGateway, FabricGateway } from './gateways';

export const DISCOVERY_LIMITS = { workspaces: 200, groups: 300, parallel: 4, audiences: 60 } as const;

async function pool<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

export interface DiscoveryOptions {
  adminGroupId?: string;
  /** App admins named individually in the build. */
  adminUserIds?: readonly string[];
  /**
   * Also read who each audience is shared with. A Fabric administrator API,
   * limited to 200 calls per hour, so it is bounded and only run on request.
   */
  audienceRecipients?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Who counts as an app admin for the owner check: the people named in the
 * build plus the members of the admin group. If a configured group cannot be
 * read, the answer is "not readable", not the shorter list.
 */
export async function resolveAppAdminIds(directory: DirectoryGateway, options: DiscoveryOptions): Promise<Readable<string[]>> {
  const named = [...(options.adminUserIds ?? [])];
  if (!options.adminGroupId) return named.length > 0 ? ok(named) : notReadable('no-route');
  const members = await directory.listMembers(options.adminGroupId);
  return members.state === 'ok' ? ok([...named, ...members.value.map((m) => m.id)]) : members;
}

export async function runDiscovery(
  fabric: FabricGateway,
  directory: DirectoryGateway,
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  const observedAt = new Date().toISOString();
  const workspaces = await fabric.listWorkspaces();

  const all: FabricWorkspace[] = workspaces.state === 'ok' ? workspaces.value : [];
  const selected = [...all].sort((a, b) => a.displayName.localeCompare(b.displayName)).slice(0, DISCOVERY_LIMITS.workspaces);
  let done = 0;

  const perWorkspace: WorkspaceDiscovery[] = await pool(selected, DISCOVERY_LIMITS.parallel, async (workspace) => {
    const [roleAssignments, orgApps, audiences, models] = await Promise.all([
      fabric.listRoleAssignments(workspace.id),
      fabric.listItems(workspace.id, 'OrgApp'),
      fabric.listItems(workspace.id, 'OrgAppAudience'),
      fabric.listItems(workspace.id, 'SemanticModel'),
    ]);
    done += 1;
    options.onProgress?.(done, selected.length);
    return { workspace, roleAssignments, orgApps, audiences, models };
  });

  let audiencesSkipped = 0;
  if (options.audienceRecipients) {
    const allAudiences = perWorkspace.flatMap((ws) => (ws.audiences.state === 'ok' ? ws.audiences.value.map((item) => ({ ws, item })) : []));
    const targets = allAudiences.slice(0, DISCOVERY_LIMITS.audiences);
    audiencesSkipped = allAudiences.length - targets.length;
    for (const ws of perWorkspace) ws.audienceAccess = {};
    await pool(targets, 2, async ({ ws, item }) => {
      ws.audienceAccess![item.id] = await fabric.listItemAccess(ws.workspace.id, item.id);
    });
  }

  const groupIds = new Set<string>();
  for (const ws of perWorkspace) {
    if (ws.roleAssignments.state === 'ok') {
      for (const a of ws.roleAssignments.value) if (a.principalType === 'Group') groupIds.add(a.principalId.toLowerCase());
    }
    for (const access of Object.values(ws.audienceAccess ?? {})) {
      if (access.state !== 'ok') continue;
      for (const entry of access.value) if (entry.principalType === 'Group') groupIds.add(entry.principalId.toLowerCase());
    }
  }
  const selectedGroups = [...groupIds].slice(0, DISCOVERY_LIMITS.groups);

  const groups: Record<string, GroupDiscovery> = {};
  await pool(selectedGroups, DISCOVERY_LIMITS.parallel, async (groupId) => {
    const [facts, owners, members] = await Promise.all([
      directory.getGroup(groupId),
      directory.listOwners(groupId),
      directory.listMembers(groupId),
    ]);
    groups[groupId] = { facts, owners, members };
  });

  const appAdminIds = await resolveAppAdminIds(directory, options);

  return buildDiscovery({
    observedAt,
    workspaces,
    perWorkspace,
    groups,
    appAdminIds,
    workspacesSkipped: all.length - selected.length,
    groupsSkipped: groupIds.size - selectedGroups.length,
    audiencesSkipped,
  });
}

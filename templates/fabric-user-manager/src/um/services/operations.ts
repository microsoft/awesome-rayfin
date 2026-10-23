/**
 * Changes to the app's own records: activation, edits, import, rollback and
 * keeping the stored bindings of activated groups current.
 *
 * None of this touches Entra or Fabric. Every operation writes one log entry
 * with the acting Graph identity.
 */
import { checkActivation, checkEditable, type ActivationError, type ActivationInput } from '@/um/domain/activation';
import { audiencesWorkedOut, isHighRoleGroup, type DiscoveryResult } from '@/um/domain/discovery';
import type { GuidedAction, GuidedPlan } from '@/um/domain/guidedStep';
import { editableOf, type EditableFields, type ImportPlan } from '@/um/domain/sheet';
import { bindingKey, type Binding, type DirectoryMember, type GraphIdentity, type GroupFacts, type ManagedGroup, type Readable } from '@/um/domain/types';

import { boundedJson, parseRollbackPoint, rollbackPointOf, type UmStore } from './store';

export interface OperationDeps {
  store: UmStore;
  actor: GraphIdentity;
}

export class RefusedError extends Error {
  constructor(readonly errors: ActivationError[]) {
    super('refused');
    this.name = 'RefusedError';
  }
}

async function log(deps: OperationDeps, action: Parameters<UmStore['audit']>[0]['action'], outcome: 'ok' | 'refused' | 'failed', groupId: string | undefined, detail: unknown) {
  try {
    await deps.store.audit({
      actorOid: deps.actor.objectId,
      actorUpn: deps.actor.userPrincipalName,
      action,
      groupId,
      outcome,
      detail: boundedJson(detail),
    });
  } catch {
    // The log is advisory. Losing an entry must not undo or hide the change;
    // the caller's own result still tells the person what happened.
  }
}

export async function activateGroup(
  deps: OperationDeps,
  input: ActivationInput,
  context: {
    facts: Readable<GroupFacts>;
    managed: readonly ManagedGroup[];
    readBindings: readonly Binding[];
    /** What an admin states the group is for, when it cannot be read (activation by ID). */
    attestedBindings?: readonly Binding[];
    /** The admin confirmed that the group holds no workspace Member or Admin role anywhere. */
    noHighRoleConfirmed?: boolean;
    /** The app admin group of this build; it can never be activated. */
    adminGroupId?: string;
    /** The group's owners as read live, to remember where a request notice goes. */
    owners?: Readable<DirectoryMember[]>;
  }
): Promise<ManagedGroup> {
  const groupId = input.groupId.toLowerCase();
  const attested = (context.attestedBindings ?? []).map((b) => ({ ...b, groupId, provenance: 'attested' as const }));
  // A stated Member or Admin role counts exactly like a read one.
  const highRole = isHighRoleGroup([...context.readBindings, ...attested]);
  // The facts must be about this very group; eligibility of another group proves nothing.
  const facts: Readable<GroupFacts> =
    context.facts.state === 'ok' && context.facts.value.id.toLowerCase() !== groupId ? { state: 'not-readable', reason: 'failed', detail: 'wrong-group' } : context.facts;
  const check = checkActivation(input, {
    facts,
    alreadyManaged: context.managed.some((g) => g.groupId.toLowerCase() === groupId),
    highRole,
    adminGroupId: context.adminGroupId,
  });
  if (!check.ok) {
    await log(deps, 'activate', 'refused', groupId, { errors: check.errors });
    throw new RefusedError(check.errors);
  }
  const name = facts.state === 'ok' ? facts.value.displayName : groupId;
  const created = await deps.store.activate({ ...input, groupId, nameSnapshot: name }, deps.actor);
  await deps.store.setBindings(groupId, 'read', context.readBindings, deps.actor);
  if (attested.length > 0) await deps.store.setBindings(groupId, 'attested', attested, deps.actor);
  if (context.owners?.state === 'ok') await deps.store.setContact(groupId, contactOf(context.owners.value), deps.actor).catch(() => undefined);
  await log(deps, 'activate', 'ok', groupId, {
    after: editableOf(created),
    read: context.readBindings.length,
    attested: attested.map((b) => `${b.kind}|${b.scopeName}|${b.label}`),
    noHighRoleConfirmed: context.noHighRoleConfirmed === true,
  });
  return created;
}

export async function saveFields(deps: OperationDeps, group: ManagedGroup, fields: EditableFields, highRole: boolean): Promise<ManagedGroup> {
  const errors = checkEditable(fields, highRole);
  if (errors.length > 0) {
    await log(deps, 'edit', 'refused', group.groupId, { errors });
    throw new RefusedError(errors);
  }
  const before = editableOf(group);
  // An edit made by hand ends the possibility of undoing an earlier import
  // for this group: the undo must never overwrite a later decision.
  const updated = await deps.store.updateFields(group, fields, 'clear');
  const action = before.active && !fields.active ? 'deactivate' : !before.active && fields.active ? 'reactivate' : 'edit';
  await log(deps, action, 'ok', group.groupId, { before, after: fields });
  return updated;
}

/** Apply a validated import. Each touched group remembers its previous state. */
export async function applyImport(
  deps: OperationDeps,
  plan: ImportPlan,
  groups: readonly ManagedGroup[],
  bindings: readonly Binding[]
): Promise<{ importId: string; applied: number }> {
  if (!plan.ok) throw new Error('The import has errors and cannot be applied.');
  const importId = crypto.randomUUID();
  let applied = 0;
  for (const change of plan.changes) {
    const group = groups.find((g) => g.groupId.toLowerCase() === change.groupId.toLowerCase());
    if (!group) continue;
    const point = rollbackPointOf(group, bindings);
    await deps.store.updateFields(group, change.after, { previousJson: boundedJson(point), importId });
    if (change.attestedAdded.length > 0 || change.attestedRemoved.length > 0) {
      const removed = new Set(change.attestedRemoved.map((b) => `${b.kind}|${b.scopeName}|${b.label}`.toLowerCase()));
      const next = [
        ...point.attested.filter((b) => !removed.has(`${b.kind}|${b.scopeName}|${b.label}`.toLowerCase())),
        ...change.attestedAdded,
      ];
      await deps.store.setBindings(group.groupId, 'attested', next, deps.actor);
    }
    applied += 1;
    await log(deps, 'import', 'ok', group.groupId, { importId, before: change.before, after: change.after, added: change.attestedAdded.length, removed: change.attestedRemoved.length });
  }
  return { importId, applied };
}

/**
 * Undo an import for every group it touched, as long as that group was not
 * changed since. A group that was edited, deactivated or imported again
 * afterwards is skipped, and so is one whose previous state is no longer
 * allowed (a Member or Admin group must not become requestable again).
 */
export async function rollbackImport(
  deps: OperationDeps,
  importId: string,
  groups: readonly ManagedGroup[],
  highRoleGroupIds: ReadonlySet<string>
): Promise<{ restored: number; skipped: number }> {
  let restored = 0;
  let skipped = 0;
  for (const group of groups.filter((g) => g.importId === importId)) {
    const point = parseRollbackPoint(group.previousJson);
    const stillAsImported = !!point && group.version === point.versionAfter;
    const allowed = !!point && checkEditable(point.fields, highRoleGroupIds.has(group.groupId.toLowerCase())).length === 0;
    if (!point || !stillAsImported || !allowed) {
      skipped += 1;
      await log(deps, 'rollback', 'refused', group.groupId, { importId, reason: !point ? 'no-point' : !stillAsImported ? 'changed-since' : 'not-allowed' });
      continue;
    }
    await deps.store.updateFields(group, point.fields, 'clear');
    await deps.store.setBindings(group.groupId, 'attested', point.attested, deps.actor);
    restored += 1;
    await log(deps, 'rollback', 'ok', group.groupId, { importId, after: point.fields });
  }
  return { restored, skipped };
}

/**
 * After a discovery, bring the stored bindings of activated groups up to date:
 * `read` ones (workspace roles) and `inferred` ones (audience sharing).
 *
 * A stored binding is replaced only if its workspace or audience was actually
 * read this time. One that could not be read, or was not asked for, is kept:
 * "not readable" must not be stored as "gone".
 */
export async function syncReadBindings(
  deps: OperationDeps,
  managed: readonly ManagedGroup[],
  stored: readonly Binding[],
  discovery: DiscoveryResult
): Promise<number> {
  const scopesRead = {
    read: new Set(discovery.perWorkspace.filter((w) => w.roleAssignments.state === 'ok').map((w) => w.workspace.id.toLowerCase())),
    inferred: audiencesWorkedOut(discovery),
  };
  let changed = 0;
  for (const group of managed) {
    const id = group.groupId.toLowerCase();
    let groupChanged = false;
    for (const provenance of ['read', 'inferred'] as const) {
      const seen = discovery.bindings.filter((b) => b.groupId.toLowerCase() === id && b.provenance === provenance);
      const kept = stored.filter(
        (b) => b.groupId.toLowerCase() === id && b.provenance === provenance && !(b.scopeId && scopesRead[provenance].has(b.scopeId.toLowerCase()))
      );
      const unique = new Map([...kept, ...seen].map((b) => [bindingKey(b), b]));
      if (await deps.store.setBindings(id, provenance, [...unique.values()], deps.actor)) groupChanged = true;
    }
    if (groupChanged) {
      changed += 1;
      await log(deps, 'bindings', 'ok', id, { seen: discovery.bindings.filter((b) => b.groupId.toLowerCase() === id).length });
    }
  }
  return changed;
}

/** Mail addresses of a group's owners, for the request notice only. */
export function contactOf(owners: readonly DirectoryMember[]): string {
  return owners
    .map((o) => o.userPrincipalName ?? '')
    .filter((upn) => upn.includes('@') && !upn.includes('#'))
    .slice(0, 10)
    .join(';');
}

/**
 * Keep the notice addresses of activated groups current from owners that
 * were read live. Never used to decide who may approve.
 */
export async function refreshContacts(deps: OperationDeps, managed: readonly ManagedGroup[], discovery: DiscoveryResult): Promise<void> {
  for (const group of managed) {
    const found = discovery.groups.find((g) => g.groupId.toLowerCase() === group.groupId.toLowerCase());
    if (!found || found.owners.state !== 'ok') continue;
    await deps.store.setContact(group.groupId, contactOf(found.owners.value), deps.actor).catch(() => undefined);
  }
}

/**
 * Record what an admin confirmed after a guided step in Fabric: one access
 * added to, or taken from, the group's confirmed entries. This changes the
 * app's record only; nothing is sent to Fabric.
 */
export async function recordGuided(deps: OperationDeps, plan: GuidedPlan, action: GuidedAction): Promise<void> {
  if (!plan.ok) {
    await log(deps, 'bindings', 'refused', plan.binding.groupId, { guided: action, refusals: plan.refusals });
    throw new Error('refused');
  }
  await deps.store.setBindings(plan.binding.groupId, 'attested', plan.next, deps.actor);
  await log(deps, 'bindings', 'ok', plan.binding.groupId, { guided: action, kind: plan.binding.kind, scopeId: plan.binding.scopeId, label: plan.binding.label, confirmedEntries: plan.next.length });
}

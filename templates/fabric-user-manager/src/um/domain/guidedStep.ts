/**
 * Guided steps for the two things the app cannot do itself:
 * sharing an Org App audience with a group, and putting a group into a role
 * of a semantic model. Pure.
 *
 * The app shows the steps and the exact names to pick, links into Fabric, and
 * afterwards records what the admin confirms. That record is "confirmed by an
 * admin", never a fact: only a read from Fabric may be shown as fact. For
 * audiences the sharing can be read again by a Fabric administrator, which
 * then replaces the confirmation with what Fabric says.
 */
import { bindingKey, isGuid, type Binding, type ManagedGroup } from './types';

export type GuidedKind = 'Audience' | 'ModelRole';
export type GuidedAction = 'add' | 'remove';

export interface GuidedTarget {
  kind: GuidedKind;
  workspaceId: string;
  workspaceName: string;
  /** The audience or the semantic model. */
  itemId: string;
  itemName: string;
}

export const ROLE_NAME_MAX = 120;

/** The workspace in Fabric, in the app's tenant. The item is named in the steps. */
export function workspaceLink(tenantId: string | undefined, workspaceId: string): string | null {
  if (!isGuid(workspaceId)) return null;
  const base = `https://app.fabric.microsoft.com/groups/${workspaceId.toLowerCase()}/list`;
  return isGuid(tenantId) ? `${base}?ctid=${tenantId.toLowerCase()}` : base;
}

/** The binding a confirmed step stands for. Same identity as discovery would give it. */
export function guidedBinding(target: GuidedTarget, groupId: string, roleName: string): Binding {
  return target.kind === 'Audience'
    ? { groupId: groupId.toLowerCase(), kind: 'Audience', scopeId: target.itemId, scopeName: target.workspaceName, label: target.itemName, provenance: 'attested' }
    : { groupId: groupId.toLowerCase(), kind: 'ModelRole', scopeId: target.itemId, scopeName: target.itemName, label: roleName.trim(), provenance: 'attested' };
}

export type GuidedRefusal = 'not-app-admin' | 'group-not-activated' | 'role-name-missing' | 'role-name-too-long' | 'not-confirmed' | 'already-recorded' | 'not-recorded';

export interface GuidedPlan {
  ok: boolean;
  refusals: GuidedRefusal[];
  binding: Binding;
  /** The group's confirmed entries after this step. */
  next: Binding[];
}

/**
 * May this confirmation be recorded? `attested` are the entries an admin
 * already confirmed for this group.
 */
export function planGuided(
  input: { target: GuidedTarget; action: GuidedAction; group: ManagedGroup | undefined; roleName: string; confirmed: boolean },
  context: { isAppAdmin: boolean; attested: readonly Binding[] }
): GuidedPlan {
  const refusals: GuidedRefusal[] = [];
  const groupId = input.group?.groupId ?? '';
  const binding = guidedBinding(input.target, groupId, input.roleName);
  if (!context.isAppAdmin) refusals.push('not-app-admin');
  // Only groups the app manages carry records.
  if (!input.group || !input.group.active) refusals.push('group-not-activated');
  if (input.target.kind === 'ModelRole') {
    if (binding.label.length === 0) refusals.push('role-name-missing');
    else if (binding.label.length > ROLE_NAME_MAX) refusals.push('role-name-too-long');
  }
  // The admin states that the step was done in Fabric. Without that, nothing is recorded.
  if (!input.confirmed) refusals.push('not-confirmed');

  const key = bindingKey(binding);
  const mine = context.attested.filter((b) => b.groupId.toLowerCase() === groupId.toLowerCase());
  const has = mine.some((b) => bindingKey(b) === key);
  if (input.action === 'add' && has) refusals.push('already-recorded');
  if (input.action === 'remove' && !has) refusals.push('not-recorded');

  const next = input.action === 'add' ? [...mine, binding] : mine.filter((b) => bindingKey(b) !== key);
  return { ok: refusals.length === 0, refusals, binding, next };
}

/** For an audience: does what Fabric says now agree with what was just done? `null` when it was not read. */
export function seenInFabric(action: GuidedAction, binding: Binding, read: readonly Binding[] | null): boolean | null {
  if (read === null) return null;
  const key = bindingKey(binding);
  const present = read.some((b) => bindingKey(b) === key);
  return action === 'add' ? present : !present;
}

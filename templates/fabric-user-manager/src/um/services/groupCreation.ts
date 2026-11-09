/**
 * Creating one security group.
 *
 * The same order as every other change: read live, decide, record the intent,
 * send exactly one request, record the outcome, read again. Creating is not
 * repeatable: a second request would make a second group. An unclear answer is
 * therefore never retried; the group is looked for by its name instead.
 */
import {
  mailNicknameFor,
  planGroupCreate,
  sameGroupPlan,
  type GroupCreateContext,
  type GroupCreatePlan,
  type GroupCreateRefusal,
  type GroupCreateRequest,
  type PreviewedGroup,
} from '@/um/domain/groupCreate';
import { isGuid, notReadable, ok, type DirectoryMember, type GraphIdentity, type Readable } from '@/um/domain/types';

import { resolveAppAdminIds } from './discoveryRunner';
import type { DirectoryGateway } from './gateways';
import type { CreateOutcome, NewGroup } from './graphGroupCreate';
import { boundedJson, type AuditEntry, type UmStore } from './store';

/** Setting: creating groups is switched on. Advisory; the build flag is the real off state. */
export const SETTING_GROUP_CREATION = 'um.changes.groups';

/** Sends the one create request. Graph in a deployment, fixtures in the demo. */
export interface GroupCreator {
  /** `actorObjectId` is the person shown and logged as acting; the creator refuses if its token belongs to someone else. */
  create(group: NewGroup, actorObjectId: string): Promise<CreateOutcome>;
}

export interface GroupCreateDeps {
  store: UmStore;
  directory: DirectoryGateway;
  creator: GroupCreator;
  actor: GraphIdentity;
  isAppAdmin: boolean;
  armed: boolean;
  adminGroupId?: string;
  adminUserIds: readonly string[];
}

export type GroupCreateResult =
  | { status: 'refused'; refusals: GroupCreateRefusal[] }
  /**
   * `creatorIsOwner` is `null` when the owners could not be read back.
   * `sameNameNow` is how many groups carry the name after the creation, `null` when that could not be read.
   */
  | { status: 'done'; groupId: string; displayName: string; creatorIsOwner: boolean | null; sameNameNow: number | null }
  | { status: 'failed'; code: Exclude<CreateOutcome, { ok: true }>['code'] };

async function readLive(deps: GroupCreateDeps, request: GroupCreateRequest): Promise<Pick<GroupCreateContext, 'sameName' | 'owners' | 'appAdminIds'>> {
  const actorId = deps.actor.objectId.toLowerCase();
  const ownerIds = [...new Set(request.ownerIds.map((id) => id.trim().toLowerCase()).filter((id) => id !== actorId))];
  const [sameName, appAdminIds, found] = await Promise.all([
    deps.directory.findGroupsByName(request.displayName.trim().replace(/\s+/g, ' ')),
    resolveAppAdminIds(deps.directory, { adminGroupId: deps.adminGroupId, adminUserIds: deps.adminUserIds }),
    // Only object ids are looked up, one by one, in the order they were given.
    Promise.all(ownerIds.map((id) => (isGuid(id) ? deps.directory.findUser(id) : Promise.resolve(ok<DirectoryMember | null>(null))))),
  ]);
  // One unreadable lookup makes the whole list unreadable: a gap must not look like "nobody".
  let owners: Readable<(DirectoryMember | null)[]> = ok(found.map((f) => (f.state === 'ok' ? f.value : null)));
  for (const f of found) if (f.state !== 'ok') owners = notReadable(f.reason);
  return { sameName, owners, appAdminIds };
}

function contextOf(deps: GroupCreateDeps, live: Awaited<ReturnType<typeof readLive>>, armed: boolean): GroupCreateContext {
  return { armed, isAppAdmin: deps.isAppAdmin, actor: deps.actor, ...live };
}

/** What would happen, from live reads. Sends nothing and logs nothing. */
export async function previewGroup(deps: GroupCreateDeps, request: GroupCreateRequest): Promise<GroupCreatePlan> {
  return planGroupCreate(request, contextOf(deps, await readLive(deps, request), deps.armed));
}

/**
 * `shown` is the plan the admin saw and confirmed. If a fresh read gives a
 * different one, nothing is sent.
 */
export async function performGroupCreate(deps: GroupCreateDeps, request: GroupCreateRequest, shown: PreviewedGroup): Promise<GroupCreateResult> {
  const changeId = crypto.randomUUID();
  const log = async (outcome: AuditEntry['outcome'], detail: unknown, groupId?: string): Promise<boolean> => {
    try {
      await deps.store.audit({ action: 'group-create', outcome, groupId, actorOid: deps.actor.objectId, actorUpn: deps.actor.userPrincipalName, detail: boundedJson(detail) });
      return true;
    } catch {
      return false;
    }
  };

  // The switch as stored right now. Unreadable means off.
  const armedNow = deps.armed && (await deps.store.getSetting(SETTING_GROUP_CREATION).catch(() => undefined)) === true;
  const plan = planGroupCreate(request, contextOf(deps, await readLive(deps, request), armedNow));
  // The alias carries a random tail of this attempt. It is how the group is told from another of the same name.
  const mailNickname = mailNicknameFor(plan.displayName, changeId);
  // The name is the group's own and is not personal data; owners are object ids only.
  const about = { changeId, name: plan.displayName, alias: mailNickname, ownerIds: plan.ownerIds };
  if (!plan.ok) {
    await log('refused', { ...about, refusals: plan.refusals });
    return { status: 'refused', refusals: plan.refusals };
  }
  if (!sameGroupPlan(shown, plan)) {
    await log('refused', { ...about, refusals: ['changed-since-preview'] });
    return { status: 'refused', refusals: ['changed-since-preview'] };
  }

  // No intent on record, no group.
  if (!(await log('pending', about))) return { status: 'refused', refusals: ['log-unavailable'] };

  const group: NewGroup = {
    displayName: plan.displayName,
    description: plan.description,
    mailNickname,
    ownerIds: plan.ownerIds,
  };
  const outcome = await deps.creator.create(group, deps.actor.objectId);

  let groupId: string | null = outcome.ok ? outcome.id : null;
  if (!outcome.ok) {
    if (outcome.code !== 'uncertain') {
      await log('failed', { ...about, result: outcome.code, status: outcome.status });
      return { status: 'failed', code: outcome.code };
    }
    // No clear answer. Look, do not guess, and do not send again. Only a group
    // that carries this attempt's alias is ours: one with the same name may be
    // someone else's. Finding nothing proves nothing either, since a new group
    // can take a while to show up in a search. So the intent stays open, and
    // is settled later from a fresh look.
    const now = await deps.directory.findGroupsByName(plan.displayName);
    const ours = now.state === 'ok' ? now.value.find((x) => x.mailNickname === mailNickname) : undefined;
    if (!ours) return { status: 'failed', code: 'uncertain' };
    groupId = ours.id.toLowerCase();
  }

  const owners = await deps.directory.listOwners(groupId!);
  const creatorIsOwner = owners.state === 'ok' ? owners.value.some((o) => o.id.toLowerCase() === deps.actor.objectId.toLowerCase()) : null;
  // The name check before the creation is best effort: Entra allows two groups with one name.
  const after = await deps.directory.findGroupsByName(plan.displayName);
  const sameNameNow = after.state === 'ok' ? Math.max(after.value.length, 1) : null;
  await log('ok', { ...about, result: outcome.ok ? 'created' : 'found-after-unclear-answer', creatorIsOwner, sameNameNow }, groupId!);
  return { status: 'done', groupId: groupId!, displayName: plan.displayName, creatorIsOwner, sameNameNow };
}

/** Groups created here that the app does not manage yet: created, and not activated. */
export function createdNotActivated(entries: readonly AuditEntry[], managedIds: readonly string[]): { groupId: string; name: string; at: string }[] {
  const managed = new Set(managedIds.map((id) => id.toLowerCase()));
  const seen = new Set<string>();
  const out: { groupId: string; name: string; at: string }[] = [];
  for (const entry of entries) {
    if (entry.action !== 'group-create' || entry.outcome !== 'ok' || !entry.groupId) continue;
    const id = entry.groupId.toLowerCase();
    if (managed.has(id) || seen.has(id)) continue;
    seen.add(id);
    let name = id;
    try {
      const detail = entry.detail ? (JSON.parse(entry.detail) as { name?: unknown }) : {};
      if (typeof detail.name === 'string') name = detail.name;
    } catch {
      /* the id will do */
    }
    out.push({ groupId: id, name, at: entry.at });
  }
  return out;
}

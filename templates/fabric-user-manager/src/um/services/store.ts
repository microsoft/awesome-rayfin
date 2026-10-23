/**
 * The Fabric User Manager's own records: activated groups, their known
 * bindings and the app's log.
 *
 * These records are written from the browser and are therefore advisory
 * Nothing here is an authorization decision: Entra and
 * Fabric decide every real change, and no member list is ever stored.
 *
 * Two implementations: Rayfin data (SQL) for a deployment, memory for the
 * offline demo and for tests.
 */
import type { AccessRequest, RequestStatus } from '@/um/domain/accessRequest';
import { editableOf, type EditableFields } from '@/um/domain/sheet';
import { bindingKey, type Binding, type GraphIdentity, type ManagedGroup, type TargetKind } from '@/um/domain/types';
import { getRayfinClient } from '@/services/rayfinClient';

import { loadConfigValue, saveConfigValue } from './configStore';

export interface AuditEntry {
  id: string;
  at: string;
  actorOid: string;
  actorUpn: string;
  action: 'activate' | 'deactivate' | 'reactivate' | 'edit' | 'import' | 'rollback' | 'bindings' | 'switch' | 'member-add' | 'member-remove' | 'reconcile' | 'binding-add' | 'binding-change' | 'binding-remove' | 'group-create';
  groupId?: string;
  /** `pending` is an intent written before a change; an outcome entry follows it. */
  outcome: 'ok' | 'refused' | 'failed' | 'pending';
  detail?: string;
}

/** Setting: member changes are switched on. Advisory; the build flag is the real off state. */
export const SETTING_MEMBER_CHANGES = 'um.changes.members';

export interface NewRequest {
  groupId: string;
  reason: string;
  reviewOn?: string;
  rowVersion: number;
  accessFingerprint: string;
}

/** The request is no longer pending, or a pending one already exists. */
export class RequestStateError extends Error {
  constructor(readonly code: 'not-pending' | 'duplicate') {
    super(code);
    this.name = 'RequestStateError';
  }
}

export interface ReviewDate {
  groupId: string;
  userId: string;
  /** `YYYY-MM-DD`. A reminder, not an expiry. */
  reviewOn: string;
}

export interface NewManagedGroup {
  groupId: string;
  nameSnapshot: string;
  requestable: boolean;
  description: string;
  maxDays: number;
}

/** The group is already activated. Checked again in the store, not only in the page. */
export class AlreadyActivatedError extends Error {
  constructor() {
    super('The group is already activated.');
    this.name = 'AlreadyActivatedError';
  }
}

/** The row changed since it was read. The caller reloads and shows the diff again. */
export class VersionConflictError extends Error {
  constructor() {
    super('The group was changed by someone else.');
    this.name = 'VersionConflictError';
  }
}

export interface UmStore {
  /** False when the app database cannot be reached. The UI must say so. */
  load(): Promise<{ reachable: boolean; groups: ManagedGroup[]; bindings: Binding[] }>;
  activate(input: NewManagedGroup, actor: GraphIdentity): Promise<ManagedGroup>;
  /** Update editable fields. `rollbackPoint` records the state before an import. */
  updateFields(
    group: ManagedGroup,
    fields: EditableFields,
    rollbackPoint?: { previousJson: string; importId: string } | 'clear'
  ): Promise<ManagedGroup>;
  /** Replace the stored bindings of one group for one provenance. Returns true when anything changed. */
  setBindings(groupId: string, provenance: Binding['provenance'], next: readonly Binding[], actor: GraphIdentity): Promise<boolean>;
  audit(entry: Omit<AuditEntry, 'id' | 'at'>): Promise<void>;
  listAudit(groupId?: string): Promise<AuditEntry[]>;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown, by: string): Promise<boolean>;
  listRequests(): Promise<AccessRequest[]>;
  /** Files a request as pending. Refuses a second pending request of the same person for the same group. */
  createRequest(input: NewRequest, actor: GraphIdentity): Promise<AccessRequest>;
  /** Ends a request. Throws when it is no longer pending. */
  decideRequest(id: string, status: Exclude<RequestStatus, 'Pending'>, actor: GraphIdentity, note?: string): Promise<AccessRequest>;
  /** Mail addresses for the request notice of one group, separated by `;`. Empty when none. */
  getContact(groupId: string): Promise<string>;
  setContact(groupId: string, mails: string, actor: GraphIdentity): Promise<void>;
  listReviewDates(): Promise<ReviewDate[]>;
  /** Set or, with `null`, clear the review date of one membership. */
  setReviewDate(groupId: string, userId: string, isoDate: string | null, actor: GraphIdentity): Promise<void>;
}

const DETAIL_MAX = 4000;

export function boundedJson(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length <= DETAIL_MAX ? text : JSON.stringify({ truncated: true, length: text.length });
}

export function memberKey(groupId: string, userId: string): string {
  return `${groupId.toLowerCase()}|${userId.toLowerCase()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sameBindingSet(a: readonly Binding[], b: readonly Binding[]): boolean {
  const keys = new Set(a.map(bindingKey));
  return a.length === b.length && b.every((x) => keys.has(bindingKey(x)));
}

/* ───────────────────────────── memory ───────────────────────────── */

export class MemoryUmStore implements UmStore {
  private groups: ManagedGroup[] = [];
  private bindings: Binding[] = [];
  private log: AuditEntry[] = [];
  private counter = 0;

  constructor(seed?: { groups?: ManagedGroup[]; bindings?: Binding[] }) {
    this.groups = seed?.groups ? [...seed.groups] : [];
    this.bindings = seed?.bindings ? [...seed.bindings] : [];
  }

  private nextId(): string {
    this.counter += 1;
    return `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`;
  }

  async load() {
    return { reachable: true, groups: [...this.groups], bindings: [...this.bindings] };
  }

  async activate(input: NewManagedGroup, actor: GraphIdentity): Promise<ManagedGroup> {
    if (this.groups.some((g) => g.groupId === input.groupId.toLowerCase())) throw new AlreadyActivatedError();
    const at = nowIso();
    const group: ManagedGroup = {
      id: this.nextId(),
      groupId: input.groupId.toLowerCase(),
      nameSnapshot: input.nameSnapshot,
      requestable: input.requestable,
      description: input.description,
      maxDays: input.maxDays,
      active: true,
      version: 1,
      activatedByOid: actor.objectId,
      activatedByUpn: actor.userPrincipalName,
      activatedAt: at,
      updatedAt: at,
    };
    this.groups.push(group);
    return group;
  }

  async updateFields(group: ManagedGroup, fields: EditableFields, rollbackPoint?: { previousJson: string; importId: string } | 'clear') {
    const index = this.groups.findIndex((g) => g.id === group.id);
    if (index < 0 || this.groups[index].version !== group.version) throw new VersionConflictError();
    const next: ManagedGroup = { ...this.groups[index], ...fields, version: group.version + 1, updatedAt: nowIso() };
    if (rollbackPoint === 'clear') {
      next.previousJson = undefined;
      next.importId = undefined;
    } else if (rollbackPoint) {
      next.previousJson = rollbackPoint.previousJson;
      next.importId = rollbackPoint.importId;
    }
    this.groups[index] = next;
    return next;
  }

  async setBindings(groupId: string, provenance: Binding['provenance'], next: readonly Binding[]) {
    const id = groupId.toLowerCase();
    const current = this.bindings.filter((b) => b.groupId.toLowerCase() === id && b.provenance === provenance);
    if (sameBindingSet(current, next)) return false;
    this.bindings = [
      ...this.bindings.filter((b) => !(b.groupId.toLowerCase() === id && b.provenance === provenance)),
      ...next.map((b) => ({ ...b, groupId: id, provenance })),
    ];
    return true;
  }

  async audit(entry: Omit<AuditEntry, 'id' | 'at'>) {
    this.log.push({ ...entry, id: this.nextId(), at: nowIso() });
  }

  async listAudit(groupId?: string) {
    const all = groupId ? this.log.filter((e) => e.groupId === groupId.toLowerCase()) : this.log;
    return [...all].reverse();
  }

  private requests: AccessRequest[] = [];
  private contacts = new Map<string, string>();

  async listRequests() {
    return [...this.requests];
  }

  async createRequest(input: NewRequest, actor: GraphIdentity) {
    const groupId = input.groupId.toLowerCase();
    if (this.requests.some((r) => r.status === 'Pending' && r.groupId === groupId && r.requesterOid === actor.objectId)) {
      throw new RequestStateError('duplicate');
    }
    const request: AccessRequest = {
      id: this.nextId(),
      groupId,
      requesterOid: actor.objectId,
      requesterUpn: actor.userPrincipalName,
      requesterName: actor.displayName,
      reason: input.reason,
      reviewOn: input.reviewOn,
      rowVersion: input.rowVersion,
      accessFingerprint: input.accessFingerprint,
      status: 'Pending',
      createdAt: nowIso(),
    };
    this.requests.push(request);
    return request;
  }

  async decideRequest(id: string, status: Exclude<RequestStatus, 'Pending'>, actor: GraphIdentity, note?: string) {
    const index = this.requests.findIndex((r) => r.id === id);
    if (index < 0 || this.requests[index].status !== 'Pending') throw new RequestStateError('not-pending');
    const next = { ...this.requests[index], status, decidedByOid: actor.objectId, decidedAt: nowIso(), decisionNote: note || undefined };
    this.requests[index] = next;
    return next;
  }

  async getContact(groupId: string) {
    return this.contacts.get(groupId.toLowerCase()) ?? '';
  }

  async setContact(groupId: string, mails: string) {
    this.contacts.set(groupId.toLowerCase(), mails);
  }

  private settings = new Map<string, unknown>();
  private reviews = new Map<string, ReviewDate>();

  async getSetting(key: string) {
    return this.settings.get(key);
  }

  async setSetting(key: string, value: unknown) {
    this.settings.set(key, value);
    return true;
  }

  async listReviewDates() {
    return [...this.reviews.values()];
  }

  async setReviewDate(groupId: string, userId: string, isoDate: string | null) {
    const key = memberKey(groupId, userId);
    if (isoDate === null) this.reviews.delete(key);
    else this.reviews.set(key, { groupId: groupId.toLowerCase(), userId: userId.toLowerCase(), reviewOn: isoDate });
  }

  /** Offline demo only: everything this store holds, as plain data that survives JSON. */
  snapshot(): MemorySnapshot {
    return {
      groups: this.groups,
      bindings: this.bindings,
      log: this.log,
      counter: this.counter,
      requests: this.requests,
      contacts: [...this.contacts],
      settings: [...this.settings],
      reviews: [...this.reviews],
    };
  }

  /** Offline demo only: takes over what `snapshot` gave. Made-up data from the same tab, so it is not checked field by field. */
  restore(saved: MemorySnapshot) {
    this.groups = [...saved.groups];
    this.bindings = [...saved.bindings];
    this.log = [...saved.log];
    this.counter = saved.counter;
    this.requests = [...saved.requests];
    this.contacts = new Map(saved.contacts);
    this.settings = new Map(saved.settings);
    this.reviews = new Map(saved.reviews);
  }
}

export interface MemorySnapshot {
  groups: ManagedGroup[];
  bindings: Binding[];
  log: AuditEntry[];
  counter: number;
  requests: AccessRequest[];
  contacts: [string, string][];
  settings: [string, unknown][];
  reviews: [string, ReviewDate][];
}

/* ───────────────────────────── Rayfin ───────────────────────────── */

export const PAGE_LIMITS = { size: 200, pages: 100 } as const;

export interface Page<T> {
  items: T[];
  endCursor?: string | null;
  hasNextPage: boolean;
}

/**
 * Read a whole table page by page. A plain list query returns only the first
 * page of the data service (100 rows by default), which would silently hide
 * activated groups and bindings. A table that does not end within the bound
 * throws: an incomplete list must never be used as if it were complete.
 */
export async function readAllPages<T>(fetchPage: (cursor: string | undefined) => Promise<Page<T>>): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMITS.pages; page++) {
    const result = await fetchPage(cursor);
    all.push(...result.items);
    if (!result.hasNextPage) return all;
    if (!result.endCursor || seen.has(result.endCursor)) throw new Error('paging-failed');
    seen.add(result.endCursor);
    cursor = result.endCursor;
  }
  throw new Error('paging-limit');
}

interface GroupRow {
  id: string;
  group_id: string;
  name_snapshot: string;
  requestable: boolean;
  description?: string | null;
  max_days: number;
  active: boolean;
  version: number;
  activated_by_oid: string;
  activated_by_upn: string;
  activated_at: Date | string;
  updated_at: Date | string;
  previous_json?: string | null;
  import_id?: string | null;
}

interface BindingRow {
  id: string;
  group_id: string;
  target_kind: string;
  scope_id?: string | null;
  scope_name: string;
  label: string;
  provenance: string;
}

interface AuditRow {
  id: string;
  at: Date | string;
  actor_oid: string;
  actor_upn: string;
  action: string;
  group_id?: string | null;
  outcome: string;
  detail?: string | null;
}

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : String(value));

/**
 * A text field as text. The data client converts stored texts on the way
 * out: "true" and "false" become booleans, and anything shaped like an ISO
 * date becomes a `Date`. A description that reads "true" or a review date
 * must still arrive here as the text that was stored.
 */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value);
}

/** A stored `YYYY-MM-DD`, whether it arrives as text or was turned into a date. */
function dayText(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return text(value).slice(0, 10);
}

function toGroup(row: GroupRow): ManagedGroup {
  return {
    id: row.id,
    groupId: row.group_id.toLowerCase(),
    nameSnapshot: text(row.name_snapshot),
    requestable: !!row.requestable,
    description: text(row.description),
    maxDays: Number(row.max_days) || 0,
    active: !!row.active,
    version: Number(row.version) || 1,
    activatedByOid: row.activated_by_oid,
    activatedByUpn: row.activated_by_upn,
    activatedAt: iso(row.activated_at),
    updatedAt: iso(row.updated_at),
    previousJson: row.previous_json ?? undefined,
    importId: row.import_id ?? undefined,
  };
}

interface RequestRow {
  id: string;
  group_id: string;
  requester_oid: string;
  requester_upn: string;
  requester_name: string;
  reason: string;
  review_on?: string | null;
  row_version: number;
  access_fingerprint: string;
  status: string;
  created_at: Date | string;
  decided_by_oid?: string | null;
  decided_at?: Date | string | null;
  decision_note?: string | null;
}

const STATUSES: readonly RequestStatus[] = ['Pending', 'Approved', 'Denied', 'Withdrawn'];

function toRequest(row: RequestRow): AccessRequest {
  return {
    id: row.id,
    groupId: row.group_id.toLowerCase(),
    requesterOid: row.requester_oid.toLowerCase(),
    requesterUpn: row.requester_upn,
    requesterName: text(row.requester_name),
    reason: text(row.reason),
    reviewOn: dayText(row.review_on),
    rowVersion: Number(row.row_version) || 0,
    accessFingerprint: row.access_fingerprint,
    // An unknown status is treated as closed, never as open.
    status: (STATUSES as readonly string[]).includes(row.status) ? (row.status as RequestStatus) : 'Denied',
    createdAt: iso(row.created_at),
    decidedByOid: row.decided_by_oid ?? undefined,
    decidedAt: row.decided_at ? iso(row.decided_at) : undefined,
    decisionNote: row.decision_note === null || row.decision_note === undefined ? undefined : text(row.decision_note),
  };
}

const KINDS: readonly TargetKind[] = ['Workspace', 'Audience', 'ModelRole'];

/** The chainable query surface of the data client that paging needs. */
interface PagedQuery {
  where(conditions: Record<string, unknown>): PagedQuery;
  orderBy(order: Record<string, 'asc' | 'desc'>): PagedQuery;
  first(count: number): PagedQuery;
  after(cursor: string): PagedQuery;
  executePaginated(): Promise<unknown>;
}
interface PagedEntity {
  select(fields: readonly string[]): PagedQuery;
}

const FIELDS = {
  UmManagedGroup: [
    'id',
    'group_id',
    'name_snapshot',
    'requestable',
    'description',
    'max_days',
    'active',
    'version',
    'activated_by_oid',
    'activated_by_upn',
    'activated_at',
    'updated_at',
    'previous_json',
    'import_id',
  ],
  UmBinding: ['id', 'group_id', 'target_kind', 'scope_id', 'scope_name', 'label', 'provenance'],
  UmAudit: ['id', 'at', 'actor_oid', 'actor_upn', 'action', 'group_id', 'outcome', 'detail'],
  UmReviewDate: ['id', 'member_key', 'group_id', 'user_id', 'review_on'],
  UmRequest: [
    'id',
    'group_id',
    'requester_oid',
    'requester_upn',
    'requester_name',
    'reason',
    'review_on',
    'row_version',
    'access_fingerprint',
    'status',
    'created_at',
    'decided_by_oid',
    'decided_at',
    'decision_note',
  ],
  UmGroupContact: ['id', 'group_id', 'mails'],
} as const;

function toBinding(row: BindingRow): Binding | null {
  if (!(KINDS as readonly string[]).includes(row.target_kind)) return null;
  return {
    groupId: row.group_id.toLowerCase(),
    kind: row.target_kind as TargetKind,
    scopeId: row.scope_id ?? undefined,
    scopeName: text(row.scope_name),
    label: text(row.label),
    // Anything unknown is the weakest claim, never the strongest.
    provenance: row.provenance === 'read' ? 'read' : row.provenance === 'inferred' ? 'inferred' : 'attested',
  };
}

export class RayfinUmStore implements UmStore {
  private data() {
    return getRayfinClient().data;
  }

  /** Every row of one table, optionally filtered. Throws when the table cannot be read to its end. */
  private all<R>(entity: keyof typeof FIELDS, where?: Record<string, unknown>): Promise<R[]> {
    const client = this.data()[entity] as unknown as PagedEntity;
    return readAllPages<R>(async (cursor) => {
      let query = client.select(FIELDS[entity]).orderBy({ id: 'asc' }).first(PAGE_LIMITS.size);
      if (where) query = query.where(where);
      if (cursor) query = query.after(cursor);
      return (await query.executePaginated()) as Page<R>;
    });
  }

  /**
   * One row with all its fields, or `null`. The data client's own `findById`
   * returns only the id, and the answer to a write only what was written, so
   * neither can be used to look at a row.
   */
  private async byId<R>(entity: keyof typeof FIELDS, id: string): Promise<R | null> {
    return (await this.all<R>(entity, { id: { eq: id } }))[0] ?? null;
  }

  async load() {
    try {
      const [groups, bindings] = await Promise.all([this.all<GroupRow>('UmManagedGroup'), this.all<BindingRow>('UmBinding')]);
      return {
        reachable: true,
        groups: groups.map(toGroup),
        bindings: bindings.map(toBinding).filter((b): b is Binding => b !== null),
      };
    } catch {
      // Unreachable, or not readable to the end: both mean "do not trust an empty list".
      return { reachable: false, groups: [], bindings: [] };
    }
  }

  async activate(input: NewManagedGroup, actor: GraphIdentity): Promise<ManagedGroup> {
    // The list in the page can be stale. Ask the database again right before
    // the insert; the unique constraint on `group_id` is the last line.
    const existing = await this.all<GroupRow>('UmManagedGroup', { group_id: { eq: input.groupId.toLowerCase() } });
    if (existing.length > 0) throw new AlreadyActivatedError();
    const at = new Date();
    const created = await this.data().UmManagedGroup.create({
      group_id: input.groupId.toLowerCase(),
      name_snapshot: input.nameSnapshot.slice(0, 256),
      requestable: input.requestable,
      description: input.description,
      max_days: input.maxDays,
      active: true,
      version: 1,
      activated_by_oid: actor.objectId,
      activated_by_upn: actor.userPrincipalName.slice(0, 256),
      activated_at: at,
      updated_at: at,
    });
    const stored = await this.byId<GroupRow>('UmManagedGroup', (created as unknown as { id: string }).id);
    if (!stored) throw new Error('activated-not-readable');
    return toGroup(stored);
  }

  async updateFields(group: ManagedGroup, fields: EditableFields, rollbackPoint?: { previousJson: string; importId: string } | 'clear') {
    // Read-then-write, not atomic: two admins saving at the same moment can
    // still overwrite each other. The version only catches the common case.
    const current = await this.byId<GroupRow>('UmManagedGroup', group.id);
    if (!current || Number(current.version) !== group.version) throw new VersionConflictError();
    const patch: Record<string, unknown> = {
      requestable: fields.requestable,
      description: fields.description,
      max_days: fields.maxDays,
      active: fields.active,
      version: group.version + 1,
      updated_at: new Date(),
    };
    if (rollbackPoint === 'clear') {
      patch.previous_json = null;
      patch.import_id = null;
    } else if (rollbackPoint) {
      patch.previous_json = rollbackPoint.previousJson;
      patch.import_id = rollbackPoint.importId;
    }
    await this.data().UmManagedGroup.update({ id: group.id }, patch as never);
    const stored = await this.byId<GroupRow>('UmManagedGroup', group.id);
    if (!stored) throw new Error('updated-not-readable');
    return toGroup(stored);
  }

  async setBindings(groupId: string, provenance: Binding['provenance'], next: readonly Binding[], actor: GraphIdentity) {
    const id = groupId.toLowerCase();
    const rows = (await this.all<BindingRow>('UmBinding', { group_id: { eq: id } })).filter((r) => r.provenance === provenance);
    const current = rows.map(toBinding).filter((b): b is Binding => b !== null);
    if (sameBindingSet(current, next)) return false;

    const nextKeys = new Set(next.map(bindingKey));
    const currentKeys = new Set(current.map(bindingKey));
    for (const row of rows) {
      const binding = toBinding(row);
      if (!binding || !nextKeys.has(bindingKey(binding))) await this.data().UmBinding.delete({ id: row.id });
    }
    const at = new Date();
    for (const binding of next) {
      if (currentKeys.has(bindingKey(binding))) continue;
      await this.data().UmBinding.create({
        group_id: id,
        target_kind: binding.kind,
        scope_id: binding.scopeId,
        scope_name: binding.scopeName.slice(0, 256),
        label: binding.label.slice(0, 256),
        provenance,
        recorded_by_upn: actor.userPrincipalName.slice(0, 256),
        recorded_at: at,
      });
    }
    return true;
  }

  async audit(entry: Omit<AuditEntry, 'id' | 'at'>) {
    await this.data().UmAudit.create({
      at: new Date(),
      actor_oid: entry.actorOid,
      actor_upn: entry.actorUpn.slice(0, 256),
      action: entry.action,
      group_id: entry.groupId?.toLowerCase(),
      outcome: entry.outcome,
      detail: entry.detail?.slice(0, DETAIL_MAX),
    });
  }

  async listAudit(groupId?: string) {
    const rows = await this.all<AuditRow>('UmAudit', groupId ? { group_id: { eq: groupId.toLowerCase() } } : undefined);
    return rows
      .map((r) => ({
        id: r.id,
        at: iso(r.at),
        actorOid: r.actor_oid,
        actorUpn: r.actor_upn,
        action: r.action as AuditEntry['action'],
        groupId: r.group_id ?? undefined,
        outcome: r.outcome as AuditEntry['outcome'],
        detail: r.detail ?? undefined,
      }))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  async listRequests() {
    return (await this.all<RequestRow>('UmRequest')).map(toRequest).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createRequest(input: NewRequest, actor: GraphIdentity) {
    const groupId = input.groupId.toLowerCase();
    const mine = await this.all<RequestRow>('UmRequest', { group_id: { eq: groupId } });
    if (mine.some((r) => r.status === 'Pending' && r.requester_oid.toLowerCase() === actor.objectId)) throw new RequestStateError('duplicate');
    const created = await this.data().UmRequest.create({
      group_id: groupId,
      requester_oid: actor.objectId,
      requester_upn: actor.userPrincipalName.slice(0, 256),
      requester_name: actor.displayName.slice(0, 256),
      reason: input.reason.slice(0, 1000),
      review_on: input.reviewOn,
      row_version: input.rowVersion,
      access_fingerprint: input.accessFingerprint.slice(0, 64),
      status: 'Pending',
      created_at: new Date(),
    });
    const stored = await this.byId<RequestRow>('UmRequest', (created as unknown as { id: string }).id);
    if (!stored) throw new Error('request-not-readable');
    return toRequest(stored);
  }

  async decideRequest(id: string, status: Exclude<RequestStatus, 'Pending'>, actor: GraphIdentity, note?: string) {
    // Read-then-write, not atomic: two people deciding in the same second can
    // both pass. The member change underneath is idempotent, so the effect is
    // at most one membership and two log lines.
    const current = await this.byId<RequestRow>('UmRequest', id);
    if (!current || current.status !== 'Pending') throw new RequestStateError('not-pending');
    await this.data().UmRequest.update({ id }, {
      status,
      decided_by_oid: actor.objectId,
      decided_at: new Date(),
      decision_note: note ? note.slice(0, 500) : undefined,
    } as never);
    const stored = await this.byId<RequestRow>('UmRequest', id);
    if (!stored) throw new Error('request-not-readable');
    return toRequest(stored);
  }

  async getContact(groupId: string) {
    const rows = await this.all<{ mails: string }>('UmGroupContact', { group_id: { eq: groupId.toLowerCase() } });
    return rows[0]?.mails ?? '';
  }

  async setContact(groupId: string, mails: string, actor: GraphIdentity) {
    const id = groupId.toLowerCase();
    const rows = await this.all<{ id: string; mails: string }>('UmGroupContact', { group_id: { eq: id } });
    const values = { mails: mails.slice(0, 1000), updated_by_upn: actor.userPrincipalName.slice(0, 256), updated_at: new Date() };
    if (rows.length > 0) {
      if (rows[0].mails !== values.mails) await this.data().UmGroupContact.update({ id: rows[0].id }, values as never);
    } else {
      await this.data().UmGroupContact.create({ group_id: id, ...values });
    }
  }

  getSetting(key: string) {
    return loadConfigValue(key);
  }

  setSetting(key: string, value: unknown, by: string) {
    return saveConfigValue(key, value, by);
  }

  async listReviewDates() {
    const rows = await this.all<{ group_id: string; user_id: string; review_on: Date | string }>('UmReviewDate');
    return rows.map((r) => ({ groupId: r.group_id.toLowerCase(), userId: r.user_id.toLowerCase(), reviewOn: iso(r.review_on).slice(0, 10) }));
  }

  async setReviewDate(groupId: string, userId: string, isoDate: string | null, actor: GraphIdentity) {
    const key = memberKey(groupId, userId);
    const existing = await this.all<{ id: string }>('UmReviewDate', { member_key: { eq: key } });
    if (isoDate === null) {
      for (const row of existing) await this.data().UmReviewDate.delete({ id: row.id });
      return;
    }
    const values = { review_on: new Date(`${isoDate}T00:00:00Z`), set_by_upn: actor.userPrincipalName.slice(0, 256), set_at: new Date() };
    if (existing.length > 0) await this.data().UmReviewDate.update({ id: existing[0].id }, values as never);
    else await this.data().UmReviewDate.create({ member_key: key, group_id: groupId.toLowerCase(), user_id: userId.toLowerCase(), ...values });
  }
}

/** The state to restore when an import is rolled back. */
export interface RollbackPoint {
  fields: EditableFields;
  attested: Binding[];
  /** The row version right after the import. An undo applies only while the row still has it. */
  versionAfter: number;
}

export function rollbackPointOf(group: ManagedGroup, bindings: readonly Binding[]): RollbackPoint {
  return {
    fields: editableOf(group),
    attested: bindings.filter((b) => b.groupId.toLowerCase() === group.groupId.toLowerCase() && b.provenance === 'attested'),
    versionAfter: group.version + 1,
  };
}

export function parseRollbackPoint(json: string | undefined): RollbackPoint | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<RollbackPoint>;
    if (!parsed.fields || !Array.isArray(parsed.attested) || typeof parsed.versionAfter !== 'number') return null;
    return { fields: parsed.fields, attested: parsed.attested, versionAfter: parsed.versionAfter };
  } catch {
    return null;
  }
}

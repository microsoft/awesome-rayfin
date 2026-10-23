/**
 * The optional Excel sheet.
 *
 * Export lists every activated group with its bindings. Import is for bulk
 * edits of the editable columns and for attested bindings of targets that
 * cannot be discovered (audiences, model roles). It never activates a group,
 * never records a workspace binding (those come from discovery only) and
 * always produces a diff first.
 *
 * Pure: the Excel library lives in `services/sheetCodec.ts`.
 */
import { LIMITS, checkEditable } from './activation';
import { bindingKey, isGuid, type Binding, type ManagedGroup, type TargetKind } from './types';

export const SHEET_NAME = 'Groups';

export const SHEET_COLUMNS = [
  'Group ID',
  'Group name',
  'Target',
  'Scope name',
  'Scope ID',
  'Label',
  'Source',
  'Requestable',
  'Description',
  'Max days',
  'Active',
] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];
export type SheetRow = Record<SheetColumn, string>;

const TARGET_LABEL: Record<TargetKind, string> = { Workspace: 'Workspace', Audience: 'Audience', ModelRole: 'Model role' };
const TARGET_FROM_LABEL: Record<string, TargetKind> = {
  workspace: 'Workspace',
  audience: 'Audience',
  'model role': 'ModelRole',
  rls: 'ModelRole',
  ols: 'ModelRole',
};

const SOURCE_LABEL = { read: 'Read', inferred: 'Derived', attested: 'Attested' } as const;

export const YES = 'Yes';
export const NO = 'No';

function yesNo(value: boolean): string {
  return value ? YES : NO;
}

function parseYesNo(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (['yes', 'ja', 'true', '1'].includes(v)) return true;
  if (['no', 'nein', 'false', '0', ''].includes(v)) return false;
  return null;
}

/** One line per group and binding; a group without bindings still gets a line. */
export function toSheetRows(groups: readonly ManagedGroup[], bindings: readonly Binding[]): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const group of [...groups].sort((a, b) => a.nameSnapshot.localeCompare(b.nameSnapshot))) {
    const own = bindings.filter((b) => b.groupId.toLowerCase() === group.groupId.toLowerCase());
    const lines: (Binding | null)[] = own.length > 0 ? own : [null];
    for (const binding of lines) {
      rows.push({
        'Group ID': group.groupId,
        'Group name': group.nameSnapshot,
        Target: binding ? TARGET_LABEL[binding.kind] : '',
        'Scope name': binding?.scopeName ?? '',
        'Scope ID': binding?.scopeId ?? '',
        Label: binding?.label ?? '',
        Source: binding ? SOURCE_LABEL[binding.provenance] : '',
        Requestable: yesNo(group.requestable),
        Description: group.description,
        'Max days': String(group.maxDays),
        Active: yesNo(group.active),
      });
    }
  }
  return rows;
}

export type SheetIssue =
  | 'missing-columns'
  | 'bad-group-id'
  | 'not-activated'
  | 'conflicting-lines'
  | 'bad-yes-no'
  | 'bad-max-days'
  | 'description-too-long'
  | 'high-role-requestable'
  | 'workspace-binding-not-importable'
  | 'incomplete-binding'
  | 'unknown-target'
  | 'text-too-long';

export interface SheetError {
  line: number;
  issue: SheetIssue;
  detail?: string;
}

export interface EditableFields {
  requestable: boolean;
  description: string;
  maxDays: number;
  active: boolean;
}

export interface GroupChange {
  groupId: string;
  name: string;
  before: EditableFields;
  after: EditableFields;
  fieldsChanged: (keyof EditableFields)[];
  attestedAdded: Binding[];
  attestedRemoved: Binding[];
}

export interface ImportPlan {
  ok: boolean;
  errors: SheetError[];
  changes: GroupChange[];
  /** Activated groups that the sheet does not mention. They are left alone. */
  untouched: number;
}

export function editableOf(group: ManagedGroup): EditableFields {
  return { requestable: group.requestable, description: group.description, maxDays: group.maxDays, active: group.active };
}

export interface ImportContext {
  groups: readonly ManagedGroup[];
  /** Stored bindings (read and attested) of activated groups. */
  bindings: readonly Binding[];
  /** Lower-case ids of groups bound to the workspace Member or Admin role. */
  highRoleGroupIds: ReadonlySet<string>;
}

/**
 * Compare an imported sheet with the current state. Any error blocks the
 * whole import: a half-applied sheet is worse than a rejected one.
 */
export function planImport(header: readonly string[], rows: readonly SheetRow[], context: ImportContext): ImportPlan {
  const errors: SheetError[] = [];
  const missing = SHEET_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { ok: false, errors: [{ line: 1, issue: 'missing-columns', detail: missing.join(', ') }], changes: [], untouched: context.groups.length };
  }

  const byId = new Map(context.groups.map((g) => [g.groupId.toLowerCase(), g]));
  interface Pending {
    line: number;
    fields: EditableFields;
    attested: Binding[];
  }
  const pending = new Map<string, Pending>();

  rows.forEach((row, index) => {
    const line = index + 2; // header is line 1
    const rawId = row['Group ID'].trim();
    if (!rawId && SHEET_COLUMNS.every((c) => !row[c].trim())) return; // blank line
    if (!isGuid(rawId)) return void errors.push({ line, issue: 'bad-group-id', detail: rawId });
    const id = rawId.toLowerCase();
    const group = byId.get(id);
    if (!group) return void errors.push({ line, issue: 'not-activated', detail: rawId });

    const requestable = parseYesNo(row.Requestable);
    const active = row.Active.trim() === '' ? true : parseYesNo(row.Active);
    if (requestable === null || active === null) return void errors.push({ line, issue: 'bad-yes-no' });
    const maxDaysText = row['Max days'].trim();
    const maxDays = maxDaysText === '' ? 0 : Number(maxDaysText);
    const fields: EditableFields = { requestable, description: row.Description.trim(), maxDays, active };

    for (const issue of checkEditable(fields, context.highRoleGroupIds.has(id))) {
      if (issue === 'bad-max-days' || issue === 'description-too-long' || issue === 'high-role-requestable') {
        errors.push({ line, issue });
      }
    }

    const existing = pending.get(id);
    if (existing && JSON.stringify(existing.fields) !== JSON.stringify(fields)) {
      return void errors.push({ line, issue: 'conflicting-lines', detail: `line ${existing.line}` });
    }
    const entry = existing ?? { line, fields, attested: [] };
    pending.set(id, entry);

    const targetText = row.Target.trim();
    const source = row.Source.trim().toLowerCase();
    if (!targetText) return;
    const kind = TARGET_FROM_LABEL[targetText.toLowerCase()];
    if (!kind) return void errors.push({ line, issue: 'unknown-target', detail: targetText });
    if (source === 'read' || source === 'derived') return; // informational, comes from discovery
    if (kind === 'Workspace') return void errors.push({ line, issue: 'workspace-binding-not-importable' });
    const scopeName = row['Scope name'].trim();
    const label = row.Label.trim();
    if (!scopeName || !label) return void errors.push({ line, issue: 'incomplete-binding' });
    if (scopeName.length > LIMITS.name || label.length > LIMITS.name) return void errors.push({ line, issue: 'text-too-long' });
    const scopeId = row['Scope ID'].trim();
    const binding: Binding = { groupId: id, kind, scopeId: isGuid(scopeId) ? scopeId.toLowerCase() : undefined, scopeName, label, provenance: 'attested' };
    // The same line twice is one binding, not two.
    if (!entry.attested.some((b) => bindingKey(b) === bindingKey(binding))) entry.attested.push(binding);
  });

  if (errors.length > 0) return { ok: false, errors, changes: [], untouched: context.groups.length };

  const changes: GroupChange[] = [];
  for (const [id, entry] of pending) {
    const group = byId.get(id)!;
    const before = editableOf(group);
    const fieldsChanged = (Object.keys(before) as (keyof EditableFields)[]).filter((k) => before[k] !== entry.fields[k]);
    const currentAttested = context.bindings.filter((b) => b.groupId.toLowerCase() === id && b.provenance === 'attested');
    const currentKeys = new Set(currentAttested.map(bindingKey));
    const nextKeys = new Set(entry.attested.map(bindingKey));
    const attestedAdded = entry.attested.filter((b) => !currentKeys.has(bindingKey(b)));
    const attestedRemoved = currentAttested.filter((b) => !nextKeys.has(bindingKey(b)));
    if (fieldsChanged.length || attestedAdded.length || attestedRemoved.length) {
      changes.push({ groupId: group.groupId, name: group.nameSnapshot, before, after: entry.fields, fieldsChanged, attestedAdded, attestedRemoved });
    }
  }

  return { ok: true, errors: [], changes, untouched: context.groups.length - pending.size };
}

/** One line per group and member, for access reviews. */
export const MEMBER_EXPORT_COLUMNS = ['Group name', 'Group ID', 'Access', 'Member', 'User principal name', 'Type'] as const;
export type MemberExportRow = Record<(typeof MEMBER_EXPORT_COLUMNS)[number], string>;

export function describeBindings(bindings: readonly Binding[]): string {
  return bindings
    .map((b) => `${TARGET_LABEL[b.kind]}: ${b.scopeName} / ${b.label}${b.provenance === 'read' ? '' : ` (${SOURCE_LABEL[b.provenance].toLowerCase()})`}`)
    .join('; ');
}

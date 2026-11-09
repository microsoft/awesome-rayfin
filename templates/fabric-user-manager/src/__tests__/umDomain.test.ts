// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { readUmEnv, missingForGraph } from '@/um/config/umEnv';
import { checkActivation, rowAccess } from '@/um/domain/activation';
import { buildDiscovery, mergeBindings, type DiscoveryInput } from '@/um/domain/discovery';
import { assessGroup, countMembers } from '@/um/domain/eligibility';
import { compareWithSession, shapeIdentity } from '@/um/domain/identity';
import { SHEET_COLUMNS, planImport, toSheetRows, type SheetRow } from '@/um/domain/sheet';
import { buildRows, memberExportRows, personMatches, rowsForKind } from '@/um/domain/views';
import { notReadable, ok, type Binding, type DirectoryMember, type GroupFacts, type ManagedGroup } from '@/um/domain/types';

const g = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WS1 = g(101);
const WS2 = g(102);
const ADMIN = g(201);
const OWNER = g(202);

const security = (id: string, name: string, over: Partial<GroupFacts> = {}): GroupFacts => ({
  id,
  displayName: name,
  securityEnabled: true,
  mailEnabled: false,
  groupTypes: [],
  isAssignableToRole: null,
  onPremisesSyncEnabled: null,
  membershipRule: null,
  ...over,
});
const person = (id: string, name: string, over: Partial<DirectoryMember> = {}): DirectoryMember => ({ id, type: 'user', displayName: name, userPrincipalName: `${name}@x.example`, userType: 'Member', ...over });
const managed = (n: number, groupId: string, over: Partial<ManagedGroup> = {}): ManagedGroup => ({
  id: g(900 + n),
  groupId,
  nameSnapshot: `Group ${n}`,
  requestable: false,
  description: '',
  maxDays: 0,
  active: true,
  version: 1,
  activatedByOid: ADMIN,
  activatedByUpn: 'admin@x.example',
  activatedAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('build values', () => {
  it('reads named admins from the build, ignoring what is not an object id', () => {
    const env = readUmEnv({ VITE_UM_ADMIN_USER_IDS: ` ${g(7).toUpperCase()}, someone@x.example ;${g(8)}` });
    expect(env.adminUserIds).toEqual([g(7), g(8)]);
    expect(readUmEnv({}).adminUserIds).toEqual([]);
  });

  it('reads build values without throwing and names what is missing', () => {
    const env = readUmEnv({ VITE_FABRIC_TENANT_ID: g(1), VITE_UM_ADMIN_GROUP_ID: 'not-a-guid' });
    expect(env.adminGroupId).toBeUndefined();
    expect(env.mock).toBe(false);
    expect(missingForGraph(env)).toEqual(['VITE_UM_CLIENT_ID']);
    // Its own registration wins over the Hub's when the build names one.
    expect(readUmEnv({ VITE_UM_CLIENT_ID: g(3), VITE_FABRIC_SPA_CLIENT_ID: g(4) }).clientId).toBe(g(3));
    expect(readUmEnv({ VITE_FABRIC_SPA_CLIENT_ID: g(4) }).clientId).toBe(g(4));
  });
});

describe('identity comes from Graph, the session can only warn', () => {
  it('shapes /me and refuses an answer without an object id', () => {
    expect(shapeIdentity({ id: g(1).toUpperCase(), userPrincipalName: 'a@x.example' })?.objectId).toBe(g(1));
    expect(shapeIdentity({ userPrincipalName: 'a@x.example' })).toBeNull();
    expect(shapeIdentity({ id: 'a@x.example', userPrincipalName: 'a@x.example' })).toBeNull();
  });

  it('never treats a name match as more than a match, and reports a mismatch', () => {
    const me = { objectId: g(1), userPrincipalName: 'Anna@x.example', displayName: 'Anna', mail: 'anna.alias@x.example' };
    expect(compareWithSession(me, 'anna@X.example')).toBe('match');
    expect(compareWithSession(me, 'anna.alias@x.example')).toBe('match');
    expect(compareWithSession(me, 'ben@x.example')).toBe('mismatch');
    expect(compareWithSession(me, undefined)).toBe('unknown');
  });
});

describe('group eligibility', () => {
  it('admits only cloud security groups with assigned membership', () => {
    expect(assessGroup(security(g(1), 'ok'))).toEqual({ eligible: true, reasons: [] });
    expect(assessGroup(security(g(1), 'x', { mailEnabled: true })).reasons).toEqual(['mail-enabled']);
    expect(assessGroup(security(g(1), 'x', { groupTypes: ['DynamicMembership'] })).reasons).toEqual(['dynamic']);
    expect(assessGroup(security(g(1), 'x', { membershipRule: 'user.department -eq "x"' })).reasons).toEqual(['dynamic']);
    expect(assessGroup(security(g(1), 'x', { isAssignableToRole: true })).reasons).toEqual(['role-assignable']);
    expect(assessGroup(security(g(1), 'x', { onPremisesSyncEnabled: true })).reasons).toEqual(['synced']);
    expect(assessGroup(security(g(1), 'x', { securityEnabled: false })).reasons).toEqual(['not-security']);
  });

  it('treats a property Graph did not return as unknown, never as eligible', () => {
    expect(assessGroup({ id: g(1), displayName: 'x' })).toEqual({ eligible: false, reasons: ['unknown-properties'] });
    expect(assessGroup(security(g(1), 'x', { isAssignableToRole: undefined })).eligible).toBe(false);
  });

  it('counts guests, nested groups and service principals instead of dropping them', () => {
    expect(
      countMembers([person(g(1), 'a'), person(g(2), 'b', { userType: 'Guest' }), { id: g(3), type: 'group' }, { id: g(4), type: 'servicePrincipal' }, { id: g(5), type: 'device' }])
    ).toEqual({ users: 1, guests: 1, nestedGroups: 1, servicePrincipals: 1, other: 1 });
  });
});

function input(over: Partial<DiscoveryInput> = {}): DiscoveryInput {
  return {
    observedAt: '2026-10-10T00:00:00.000Z',
    workspaces: ok([
      { id: WS1, displayName: 'Sales' },
      { id: WS2, displayName: 'HR' },
    ]),
    perWorkspace: [
      {
        workspace: { id: WS1, displayName: 'Sales' },
        roleAssignments: ok([
          { id: g(1), principalId: g(11), principalType: 'Group', principalName: 'Viewers', role: 'Viewer' },
          { id: g(2), principalId: g(12), principalType: 'Group', principalName: 'Members', role: 'Member' },
          { id: g(3), principalId: g(13), principalType: 'User', principalName: 'Uwe', role: 'Contributor' },
          { id: g(4), principalId: g(14), principalType: 'ServicePrincipal', principalName: 'sp', role: 'Member' },
          { id: g(5), principalId: g(15), principalType: 'EntireTenant', role: 'Viewer' },
        ]),
        orgApps: ok([]),
        audiences: ok([]),
        models: ok([]),
      },
      { workspace: { id: WS2, displayName: 'HR' }, roleAssignments: notReadable('access-denied'), orgApps: notReadable('access-denied'), audiences: notReadable('access-denied'), models: notReadable('access-denied') },
    ],
    groups: {
      [g(11)]: { facts: ok(security(g(11), 'FAB-Sales-Viewer')), owners: ok([person(OWNER, 'owner')]), members: ok([person(g(31), 'a'), { id: g(32), type: 'group' }]) },
      [g(12)]: { facts: ok(security(g(12), 'FAB-Sales-Member')), owners: ok([person(OWNER, 'owner'), person(ADMIN, 'admin')]), members: ok([]) },
    },
    appAdminIds: ok([ADMIN]),
    ...over,
  };
}

describe('discovery', () => {
  it('keeps "not readable" apart from "empty"', () => {
    const result = buildDiscovery(input());
    expect(result.coverage).toMatchObject({ workspaces: 2, rolesReadable: 1, rolesNotReadable: 1 });
    expect(result.perWorkspace[1].roleAssignments.state).toBe('not-readable');
    expect(result.bindings.every((b) => b.scopeId === WS1)).toBe(true);
  });

  it('turns group assignments into read bindings and everything else into findings', () => {
    const result = buildDiscovery(input());
    expect(result.bindings.map((b) => `${b.label}:${b.provenance}`)).toEqual(['Viewer:read', 'Member:read']);
    expect(result.findings.map((f) => f.type)).toEqual(expect.arrayContaining(['direct-user', 'service-principal', 'tenant-wide', 'nested-group']));
    expect(result.groups.find((x) => x.groupId === g(11))?.name).toBe('FAB-Sales-Viewer');
  });

  it('reports a Member or Admin group that has an owner who is not an app admin', () => {
    const finding = buildDiscovery(input()).findings.find((f) => f.type === 'high-role-owner');
    expect(finding).toMatchObject({ groupId: g(12), role: 'Member', ownerNames: ['owner@x.example'] });
    // The Viewer group has the same non-admin owner and is not a finding.
    expect(buildDiscovery(input()).findings.filter((f) => f.type === 'high-role-owner')).toHaveLength(1);
  });

  it('reports high-role groups whose owners or admin list could not be checked, instead of staying silent', () => {
    const noAdmins = buildDiscovery(input({ appAdminIds: notReadable('no-route') }));
    expect(noAdmins.findings.some((f) => f.type === 'high-role-unknown' && f.groupId === g(12))).toBe(true);
    const noOwners = buildDiscovery(input({ groups: {} }));
    expect(noOwners.findings.some((f) => f.type === 'high-role-unknown')).toBe(true);
    expect(noOwners.groups.every((x) => x.eligible === 'unknown')).toBe(true);
  });

  it('lets a read binding replace the same attested one', () => {
    const attested: Binding = { groupId: g(11), kind: 'Workspace', scopeId: WS1, scopeName: 'Sales', label: 'Viewer', provenance: 'attested' };
    const read: Binding = { ...attested, provenance: 'read' };
    expect(mergeBindings([read], [attested])).toEqual([read]);
    // Whatever the order: what a platform stated beats what was derived, and both beat a confirmation.
    const inferred = { ...read, provenance: 'inferred' as const };
    expect(mergeBindings([], [inferred, attested])).toEqual([inferred]);
    expect(mergeBindings([], [attested, inferred])).toEqual([inferred]);
    expect(mergeBindings([attested], [read])).toEqual([read]);
  });
});

describe('activation and what a viewer is offered', () => {
  const base = { groupId: g(11), requestable: true, description: 'x', maxDays: 30 };

  it('activates an eligible, readable, not yet activated group', () => {
    expect(checkActivation(base, { facts: ok(security(g(11), 'x')), alreadyManaged: false, highRole: false })).toEqual({ ok: true, errors: [] });
  });

  it('refuses unreadable, ineligible, duplicate and requestable high-role groups', () => {
    expect(checkActivation(base, { facts: notReadable('access-denied'), alreadyManaged: false, highRole: false }).errors).toEqual(['group-not-readable']);
    expect(checkActivation(base, { facts: ok(security(g(11), 'x', { mailEnabled: true })), alreadyManaged: false, highRole: false }).errors).toEqual([{ ineligible: ['mail-enabled'] }]);
    expect(checkActivation(base, { facts: ok(security(g(11), 'x')), alreadyManaged: true, highRole: false }).errors).toEqual(['already-activated']);
    expect(checkActivation(base, { facts: ok(security(g(11), 'x')), alreadyManaged: false, highRole: true }).errors).toEqual(['high-role-requestable']);
    expect(checkActivation({ ...base, maxDays: -1 }, { facts: ok(security(g(11), 'x')), alreadyManaged: false, highRole: false }).errors).toEqual(['bad-max-days']);
  });

  it('gives Member and Admin groups to app admins only', () => {
    const row = managed(1, g(12), { requestable: true });
    const none = { isAppAdmin: false, isOwner: false, isMember: false };
    expect(rowAccess(row, { ...none, isOwner: true }, false)).toBe('manage');
    expect(rowAccess(row, { ...none, isOwner: true }, true)).toBe('hidden');
    expect(rowAccess(row, none, true)).toBe('hidden');
    expect(rowAccess(row, { ...none, isMember: true }, true)).toBe('request-view');
    expect(rowAccess(row, { ...none, isAppAdmin: true }, true)).toBe('manage');
  });

  it('hides inactive and non-requestable groups from people with no relation', () => {
    const none = { isAppAdmin: false, isOwner: false, isMember: false };
    expect(rowAccess(managed(1, g(11)), none, false)).toBe('hidden');
    expect(rowAccess(managed(1, g(11), { requestable: true }), none, false)).toBe('request-view');
    expect(rowAccess(managed(1, g(11), { requestable: true, active: false }), { ...none, isOwner: true }, false)).toBe('hidden');
  });
});

describe('views', () => {
  const groups = [managed(1, g(11), { requestable: true }), managed(2, g(12)), managed(3, g(13))];
  const bindings: Binding[] = [
    { groupId: g(11), kind: 'Workspace', scopeId: WS1, scopeName: 'Sales', label: 'Viewer', provenance: 'read' },
    { groupId: g(12), kind: 'Audience', scopeName: 'Sales App', label: 'Management', provenance: 'attested' },
    { groupId: g(13), kind: 'ModelRole', scopeName: 'Sales Model', label: 'DACH', provenance: 'attested' },
  ];

  it('puts a group on the tab of its binding kind', () => {
    const rows = buildRows(groups, bindings, [], { isAppAdmin: true, ownedGroupIds: [], memberGroupIds: [] });
    expect(rowsForKind(rows, 'Workspace').map((r) => r.group.groupId)).toEqual([g(11)]);
    expect(rowsForKind(rows, 'Audience').map((r) => r.group.groupId)).toEqual([g(12)]);
    expect(rowsForKind(rows, 'ModelRole').map((r) => r.group.groupId)).toEqual([g(13)]);
  });

  it('person lookup consults only groups the viewer manages', () => {
    const rows = buildRows(groups, bindings, [], { isAppAdmin: false, ownedGroupIds: [g(12)], memberGroupIds: [] });
    const members = { [g(11)]: ok([person(g(50), 'p')]), [g(12)]: ok([person(g(50), 'p')]), [g(13)]: ok([person(g(50), 'p')]) };
    const matches = personMatches(g(50), rows, members);
    // g(11) is only requestable for this viewer and g(13) is hidden: neither is reported.
    expect(matches.map((m) => [m.row.group.groupId, m.state])).toEqual([[g(12), 'member']]);
  });

  it('says "not readable" for a group whose members could not be read', () => {
    const rows = buildRows(groups, bindings, [], { isAppAdmin: true, ownedGroupIds: [], memberGroupIds: [] });
    const matches = personMatches(g(50), rows, { [g(11)]: notReadable('access-denied'), [g(12)]: ok([]) });
    expect(matches.map((m) => m.state)).toEqual(['not-readable', 'not-member', 'not-readable']);
    const exported = memberExportRows(rows, { [g(11)]: notReadable('access-denied'), [g(12)]: ok([]), [g(13)]: ok([person(g(50), 'p', { userType: 'Guest' })]) });
    expect(exported.map((r) => r.Member)).toEqual(['NOT READABLE', '(no members)', 'p']);
    expect(exported[2].Type).toBe('Guest');
    expect(exported[1].Access).toContain('(attested)');
  });
});

describe('optional sheet import', () => {
  const groups = [managed(1, g(11), { requestable: true, description: 'old' }), managed(2, g(12))];
  const bindings: Binding[] = [
    { groupId: g(11), kind: 'Workspace', scopeId: WS1, scopeName: 'Sales', label: 'Viewer', provenance: 'read' },
    { groupId: g(12), kind: 'Audience', scopeName: 'Sales App', label: 'Management', provenance: 'attested' },
  ];
  const context = { groups, bindings, highRoleGroupIds: new Set<string>() };
  const header = [...SHEET_COLUMNS];
  const line = (over: Partial<SheetRow>): SheetRow => ({ ...(Object.fromEntries(SHEET_COLUMNS.map((c) => [c, ''])) as SheetRow), Requestable: 'No', Active: 'Yes', 'Max days': '0', ...over });

  it('round-trips an export without proposing a change', () => {
    const plan = planImport(header, toSheetRows(groups, bindings), context);
    expect(plan).toMatchObject({ ok: true, changes: [], untouched: 0 });
  });

  it('diffs editable fields and attested bindings, and leaves unmentioned groups alone', () => {
    const plan = planImport(
      header,
      [line({ 'Group ID': g(12), Requestable: 'Yes', Description: 'new', Target: 'Model role', 'Scope name': 'Sales Model', Label: 'DACH' })],
      context
    );
    expect(plan.ok).toBe(true);
    expect(plan.untouched).toBe(1);
    expect(plan.changes[0].fieldsChanged).toEqual(['requestable', 'description']);
    expect(plan.changes[0].attestedAdded.map((b) => `${b.kind}:${b.label}:${b.provenance}`)).toEqual(['ModelRole:DACH:attested']);
    expect(plan.changes[0].attestedRemoved.map((b) => b.label)).toEqual(['Management']);
  });

  it('never activates a group and never accepts a workspace binding', () => {
    expect(planImport(header, [line({ 'Group ID': g(99) })], context).errors[0].issue).toBe('not-activated');
    expect(planImport(header, [line({ 'Group ID': g(11), Target: 'Workspace', 'Scope name': 'Finance', Label: 'Admin' })], context).errors[0].issue).toBe('workspace-binding-not-importable');
  });

  it('rejects the whole sheet on any error', () => {
    const plan = planImport(header, [line({ 'Group ID': g(11), Description: 'fine' }), line({ 'Group ID': g(12), Requestable: 'maybe' })], context);
    expect(plan).toMatchObject({ ok: false, changes: [] });
    expect(planImport(['Group ID'], [], context).errors[0].issue).toBe('missing-columns');
    expect(planImport(header, [line({ 'Group ID': g(11), Requestable: 'Yes' })], { ...context, highRoleGroupIds: new Set([g(11)]) }).errors[0].issue).toBe('high-role-requestable');
    expect(planImport(header, [line({ 'Group ID': g(11), Description: 'a' }), line({ 'Group ID': g(11), Description: 'b' })], context).errors[0].issue).toBe('conflicting-lines');
  });
});

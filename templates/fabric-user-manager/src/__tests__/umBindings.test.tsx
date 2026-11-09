import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/hooks/AuthContext';
import { I18nProvider } from '@/i18n';
import { UmLayout } from '@/um/components/UmLayout';
import { planBinding, samePlan, type BindingContext, type BindingRequest } from '@/um/domain/bindingChange';
import { UM_PATHS } from '@/um/domain/profile';
import { notReadable, ok, type DirectoryMember, type GroupFacts, type RoleAssignment } from '@/um/domain/types';
import { UmProvider } from '@/um/hooks/UmContext';
import { SETTING_BINDING_CHANGES, performBinding, previewBinding, type BindingDeps, type BindingResult } from '@/um/services/bindingChanges';
import { reconcilePending, RECONCILE_MIN_AGE_MS } from '@/um/services/memberChanges';
import { FABRIC_API_ORIGIN } from '@/um/services/fabricOps';
import { roleRequest, writeRole, type RoleChange } from '@/um/services/fabricWrite';
import type { DirectoryGateway, FabricGateway } from '@/um/services/gateways';
import { OfflineAuthService } from '@/um/services/offlineAuth';
import { createUmServices } from '@/um/services/services';
import { MemoryUmStore } from '@/um/services/store';
import { umRouteElements } from '@/um/UmRoutes';

vi.mock('@/um/services/excelClient', () => ({ readSheet: vi.fn(), writeSheet: vi.fn(async () => new Blob()), downloadBlob: vi.fn() }));

const g = (n: number) => `cdcdcdcd-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WS = g(1);
const GROUP = g(2);
const ACTOR = { objectId: g(10), userPrincipalName: 'admin@x.example', displayName: 'Admin' };
const facts: GroupFacts = { id: GROUP, displayName: 'FAB-Sales-Viewer', securityEnabled: true, mailEnabled: false, groupTypes: [], isAssignableToRole: null, onPremisesSyncEnabled: null, membershipRule: null };
const person = (n: number): DirectoryMember => ({ id: g(n), type: 'user', displayName: `P${n}`, userPrincipalName: `p${n}@x.example` });
const assign = (n: number, principalId: string, principalType: RoleAssignment['principalType'], role: string): RoleAssignment => ({ id: g(n), principalId, principalType, role });
const otherAdmin = assign(60, ACTOR.objectId, 'User', 'Admin');

const context = (over: Partial<BindingContext> = {}): BindingContext => ({
  armed: true,
  isAppAdmin: true,
  actor: ACTOR,
  appAdminIds: ok([ACTOR.objectId]),
  assignments: ok([otherAdmin]),
  facts: ok(facts),
  owners: ok([person(10)]),
  members: ok([person(30), person(31)]),
  actorGroupIds: ok([]),
  workspaceName: ok('Sales Reporting'),
  ...over,
});
const req = (over: Partial<BindingRequest> = {}): BindingRequest => ({ action: 'add', workspaceId: WS, groupId: GROUP, role: 'Viewer', ...over });

describe('deciding a binding change', () => {
  it('lets an app admin give a group a low role without further ceremony', () => {
    const plan = planBinding(req(), context());
    expect(plan).toMatchObject({ ok: true, refusals: [], effective: 'add', toRole: 'Viewer', affectedMembers: 2, needsConfirmation: false });
  });

  it('turns an add for an already bound group into a change, and the same role into nothing to do', () => {
    const bound = context({ assignments: ok([otherAdmin, assign(61, GROUP, 'Group', 'Viewer')]) });
    expect(planBinding(req({ role: 'Contributor' }), bound)).toMatchObject({ ok: true, effective: 'change', fromRole: 'Viewer', toRole: 'Contributor', assignmentId: g(61) });
    expect(planBinding(req({ role: 'Viewer' }), bound)).toMatchObject({ ok: true, noop: 'same-role' });
  });

  it.each([
    ['switched off', req(), context({ armed: false }), 'not-armed'],
    ['not an app admin', req(), context({ isAppAdmin: false }), 'not-app-admin'],
    ['roles not readable', req(), context({ assignments: notReadable('access-denied') }), 'roles-not-readable'],
    ['unknown role', req({ role: 'Owner' }), context(), 'bad-role'],
    ['group not readable', req(), context({ facts: notReadable('access-denied') }), 'group-not-readable'],
    ['mail-enabled group', req(), context({ facts: ok({ ...facts, mailEnabled: true }) }), 'group-ineligible'],
    ['the app admin group', req(), context({ adminGroupId: GROUP }), 'app-admin-group'],
    ['change without a binding', req({ action: 'change', role: 'Member' }), context(), 'no-binding'],
    ['remove without a binding', req({ action: 'remove', confirmation: 'Sales Reporting' }), context(), 'no-binding'],
  ] as const)('refuses: %s', (_name, request, ctx, refusal) => {
    const plan = planBinding(request, ctx);
    expect(plan.ok).toBe(false);
    expect(plan.refusals).toContain(refusal);
  });

  it('gives Member or Admin only to a group whose owners are all app admins', () => {
    const outsider = context({ owners: ok([person(10), person(11)]) });
    expect(planBinding(req({ role: 'Member' }), outsider).refusals).toEqual(['owners-not-admins']);
    expect(planBinding(req({ role: 'Viewer' }), outsider).ok).toBe(true);
    // Owners or the admin list unknown is not the same as fine.
    expect(planBinding(req({ role: 'Member' }), context({ owners: notReadable('access-denied') })).refusals).toEqual(['owners-not-readable']);
    expect(planBinding(req({ role: 'Member' }), context({ appAdminIds: notReadable('no-route') })).refusals).toEqual(['owners-not-readable']);
    // A group without owners cannot be extended by an owner.
    expect(planBinding(req({ role: 'Member' }), context({ owners: ok([]) })).ok).toBe(true);
  });

  it('asks for the typed workspace name before granting Admin or removing a binding', () => {
    expect(planBinding(req({ role: 'Admin' }), context())).toMatchObject({ ok: false, refusals: ['confirmation-missing'], needsConfirmation: true });
    expect(planBinding(req({ role: 'Admin', confirmation: 'Finance Reporting' }), context()).refusals).toEqual(['confirmation-missing']);
    expect(planBinding(req({ role: 'Admin', confirmation: ' sales reporting ' }), context()).ok).toBe(true);
    const bound = context({ assignments: ok([otherAdmin, assign(61, GROUP, 'Group', 'Viewer')]) });
    expect(planBinding(req({ action: 'remove' }), bound).refusals).toEqual(['confirmation-missing']);
    expect(planBinding(req({ action: 'remove', confirmation: 'Sales Reporting' }), bound)).toMatchObject({ ok: true, effective: 'remove', fromRole: 'Viewer' });
    // The name is the one Fabric returns now. If it cannot be read, there is nothing to confirm against.
    expect(planBinding(req({ action: 'remove', confirmation: 'Sales Reporting' }), { ...bound, workspaceName: ok('Sales Reporting 2027') }).refusals).toEqual(['confirmation-missing']);
    expect(planBinding(req({ action: 'remove', confirmation: 'Sales Reporting' }), { ...bound, workspaceName: notReadable('failed') }).refusals).toEqual(['workspace-not-readable']);
    // A low role needs no name, so an unreadable workspace list does not block it.
    expect(planBinding(req(), context({ workspaceName: notReadable('failed') })).ok).toBe(true);
  });

  it('does not remove or lower the last Admin of a workspace', () => {
    const only = context({ assignments: ok([assign(61, GROUP, 'Group', 'Admin')]) });
    expect(planBinding(req({ action: 'remove', confirmation: 'Sales Reporting' }), only).refusals).toEqual(['last-admin']);
    expect(planBinding(req({ action: 'change', role: 'Member', confirmation: 'Sales Reporting' }), only).refusals).toEqual(['last-admin']);
    // Another person is Admin by name: allowed.
    const two = context({ assignments: ok([otherAdmin, assign(61, GROUP, 'Group', 'Admin')]) });
    expect(planBinding(req({ action: 'remove', confirmation: 'Sales Reporting' }), two).ok).toBe(true);
    // Another group or a service principal as the only other Admin does not count: the group may be empty.
    const groupOnly = context({ assignments: ok([assign(63, g(98), 'Group', 'Admin'), assign(64, g(97), 'ServicePrincipal', 'Admin'), assign(61, GROUP, 'Group', 'Admin')]) });
    expect(planBinding(req({ action: 'remove', confirmation: 'Sales Reporting' }), groupOnly).refusals).toEqual(['last-admin']);
  });

  it('compares what was shown with what is true now', () => {
    const shown = { effective: 'change', assignmentId: g(61), fromRole: 'Viewer', toRole: 'Contributor', affectedMembers: 2 } as const;
    expect(samePlan(shown, { ...shown, assignmentId: g(61).toUpperCase() })).toBe(true);
    expect(samePlan(shown, { ...shown, affectedMembers: 40 })).toBe(false);
    expect(samePlan(shown, { ...shown, fromRole: 'Admin' })).toBe(false);
    expect(samePlan(shown, { ...shown, assignmentId: g(62) })).toBe(false);
    expect(samePlan(shown, { ...shown, affectedMembers: null })).toBe(false);
  });

  it('does not let the acting person remove their own last Admin path', () => {
    const viaGroupOnly = context({ assignments: ok([assign(62, g(99), 'User', 'Admin'), assign(61, GROUP, 'Group', 'Admin')]), actorGroupIds: ok([GROUP]) });
    expect(planBinding(req({ action: 'remove', confirmation: 'Sales Reporting' }), viaGroupOnly).refusals).toEqual(['own-admin-path']);
    // Unknown memberships: it cannot be ruled out, so it is refused.
    const unknown = context({ assignments: ok([assign(62, g(99), 'User', 'Admin'), assign(61, GROUP, 'Group', 'Admin')]), actorGroupIds: notReadable('access-denied') });
    expect(planBinding(req({ action: 'remove', confirmation: 'Sales Reporting' }), unknown).refusals).toEqual(['own-admin-path']);
    // With a direct Admin assignment of their own it is fine.
    const direct = context({ assignments: ok([otherAdmin, assign(61, GROUP, 'Group', 'Admin')]), actorGroupIds: ok([GROUP]) });
    expect(planBinding(req({ action: 'remove', confirmation: 'Sales Reporting' }), direct).ok).toBe(true);
  });
});

describe('the three Fabric writes', () => {
  const base = `${FABRIC_API_ORIGIN}/v1/workspaces/${WS}/roleAssignments`;

  it('builds exactly one request per change, and an add always names a group', () => {
    expect(roleRequest({ action: 'add', workspaceId: WS.toUpperCase(), groupId: GROUP, role: 'Viewer' })).toEqual({ method: 'POST', url: base, body: JSON.stringify({ principal: { id: GROUP, type: 'Group' }, role: 'Viewer' }) });
    expect(roleRequest({ action: 'change', workspaceId: WS, assignmentId: g(61), role: 'Member' })).toEqual({ method: 'PATCH', url: `${base}/${g(61)}`, body: JSON.stringify({ role: 'Member' }) });
    expect(roleRequest({ action: 'remove', workspaceId: WS, assignmentId: g(61) })).toEqual({ method: 'DELETE', url: `${base}/${g(61)}` });
  });

  it.each([
    [{ action: 'add', workspaceId: 'x', groupId: GROUP, role: 'Viewer' }],
    [{ action: 'add', workspaceId: WS, groupId: `${GROUP}/../x`, role: 'Viewer' }],
    [{ action: 'add', workspaceId: WS, groupId: GROUP, role: 'Owner' }],
    [{ action: 'change', workspaceId: WS, assignmentId: 'x', role: 'Viewer' }],
    [{ action: 'remove', workspaceId: WS, assignmentId: '' }],
    [{ action: 'delete-workspace', workspaceId: WS }],
  ])('sends nothing for %j', async (change) => {
    expect(roleRequest(change as RoleChange)).toBeNull();
    const fetcher = vi.fn();
    expect(await writeRole(change as RoleChange, 't', fetcher)).toEqual({ ok: false, code: 'bad-request' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends once, follows no redirect, and tells unclear from failed', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 201 }));
    expect(await writeRole({ action: 'add', workspaceId: WS, groupId: GROUP, role: 'Viewer' }, 'tok', fetcher)).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual', headers: { Authorization: 'Bearer tok' } });
    const answer = (status: number) => async () => new Response(null, { status });
    const change: RoleChange = { action: 'remove', workspaceId: WS, assignmentId: g(61) };
    expect(await writeRole(change, 't', answer(403))).toEqual({ ok: false, code: 'denied', status: 403 });
    expect(await writeRole(change, 't', answer(404))).toEqual({ ok: false, code: 'not-found', status: 404 });
    expect(await writeRole(change, 't', answer(409))).toEqual({ ok: false, code: 'conflict', status: 409 });
    expect(await writeRole(change, 't', answer(429))).toEqual({ ok: false, code: 'rate-limited', status: 429 });
    expect(await writeRole(change, 't', answer(502))).toEqual({ ok: false, code: 'uncertain', status: 502 });
    expect(await writeRole(change, 't', answer(400))).toEqual({ ok: false, code: 'failed', status: 400 });
    expect(await writeRole(change, 't', async () => Promise.reject(new Error('offline')))).toEqual({ ok: false, code: 'uncertain' });
  });
});

/** Look, then confirm what was shown: the way the dialog does it. */
async function lookAndSend(d: BindingDeps, request: BindingRequest): Promise<BindingResult> {
  return performBinding(d, request, (await previewBinding(d, request)).plan);
}

function deps(state: { assignments: RoleAssignment[]; members?: DirectoryMember[] }, over: Partial<BindingDeps> = {}): BindingDeps & { store: MemoryUmStore; sent: RoleChange[] } {
  const sent: RoleChange[] = [];
  const store = new MemoryUmStore();
  void store.setSetting(SETTING_BINDING_CHANGES, true);
  const directory: DirectoryGateway = {
    me: async () => ACTOR,
    myGroupIds: async () => ok([]),
    myTransitiveGroupIds: async () => ok([]),
    myOwnedGroupIds: async () => ok([]),
    getGroup: async () => ok(facts),
    listOwners: async () => ok([person(10)]),
    listMembers: async () => ok(state.members ?? [person(30)]),
    findUser: async () => ok(null),
    findGroupsByName: async () => ok([]),
    resolveUser: async () => ok(null),
  };
  const fabric: FabricGateway = {
    listWorkspaces: async () => ok([{ id: WS, displayName: 'Sales Reporting' }]),
    listRoleAssignments: async () => ok(state.assignments),
    listItems: async () => ok([]),
    listItemAccess: async () => ok([]),
  };
  return {
    store,
    directory,
    fabric,
    writer: {
      write: async (change) => {
        sent.push(change);
        if (change.action === 'add') state.assignments = [...state.assignments, assign(61, change.groupId, 'Group', change.role)];
        if (change.action === 'remove') state.assignments = state.assignments.filter((a) => a.id !== change.assignmentId);
        if (change.action === 'change') state.assignments = state.assignments.map((a) => (a.id === change.assignmentId ? { ...a, role: change.role } : a));
        return { ok: true };
      },
    },
    actor: ACTOR,
    isAppAdmin: true,
    armed: true,
    adminUserIds: [ACTOR.objectId],
    sent,
    ...over,
  } as BindingDeps & { store: MemoryUmStore; sent: RoleChange[] };
}

describe('carrying out a binding change', () => {
  it('logs the intent, sends one write, and confirms from a fresh read', async () => {
    const state = { assignments: [otherAdmin] };
    const d = deps(state);
    expect(await lookAndSend(d, req())).toEqual({ status: 'done', confirmed: true });
    expect(d.sent).toEqual([{ action: 'add', workspaceId: WS, groupId: GROUP, role: 'Viewer' }]);
    const log = await d.store.listAudit();
    expect(log.map((e) => `${e.action}:${e.outcome}`)).toEqual(['binding-add:ok', 'binding-add:pending']);
    expect(JSON.parse(log[0].detail!)).toMatchObject({ result: 'confirmed', toRole: 'Viewer', members: 1 });
  });

  it('sends nothing when refused, switched off in the store, or not recordable', async () => {
    const notAdmin = deps({ assignments: [otherAdmin] }, { isAppAdmin: false });
    expect(await lookAndSend(notAdmin, req())).toEqual({ status: 'refused', refusals: ['not-app-admin'] });

    const off = deps({ assignments: [otherAdmin] });
    await off.store.setSetting(SETTING_BINDING_CHANGES, false);
    expect(await lookAndSend(off, req())).toEqual({ status: 'refused', refusals: ['not-armed'] });

    const noLog = deps({ assignments: [otherAdmin] });
    noLog.store.audit = async () => {
      throw new Error('unreachable');
    };
    expect(await lookAndSend(noLog, req())).toEqual({ status: 'refused', refusals: ['log-unavailable'] });
    expect([...notAdmin.sent, ...off.sent, ...noLog.sent]).toEqual([]);
  });

  it('uses the live assignment for a removal and never retries an unclear answer', async () => {
    const state = { assignments: [otherAdmin, assign(61, GROUP, 'Group', 'Viewer')] };
    const d = deps(state);
    expect(await lookAndSend(d, req({ action: 'remove', confirmation: 'Sales Reporting' }))).toEqual({ status: 'done', confirmed: true });
    expect(d.sent).toEqual([{ action: 'remove', workspaceId: WS, assignmentId: g(61) }]);

    const unclear = deps({ assignments: [otherAdmin] });
    const write = vi.fn(async () => ({ ok: false as const, code: 'uncertain' as const, status: 502 }));
    unclear.writer = { write };
    expect(await lookAndSend(unclear, req())).toEqual({ status: 'failed', code: 'uncertain' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await unclear.store.listAudit())[0].detail!).result).toBe('unclear-not-applied');
  });

  it('sends nothing when the group or the binding changed after the admin looked', async () => {
    const state = { assignments: [otherAdmin], members: [person(30)] };
    const d = deps(state);
    const shown = (await previewBinding(d, req())).plan;
    expect(shown.affectedMembers).toBe(1);
    // Forty people joined the group in the meantime.
    state.members = Array.from({ length: 41 }, (_, i) => person(100 + i));
    expect(await performBinding(d, req(), shown)).toEqual({ status: 'refused', refusals: ['changed-since-preview'] });
    // Someone else bound the group in the meantime: the add would now be a change.
    state.members = [person(30)];
    state.assignments = [otherAdmin, assign(61, GROUP, 'Group', 'Contributor')];
    expect(await performBinding(d, req(), shown)).toEqual({ status: 'refused', refusals: ['changed-since-preview'] });
    expect(d.sent).toEqual([]);
    expect((await d.store.listAudit()).map((e) => e.outcome)).toEqual(['refused', 'refused']);
  });

  it('leaves an unreadable outcome open and settles it later from what the workspace shows', async () => {
    const state = { assignments: [otherAdmin] };
    const d = deps(state);
    const shown = (await previewBinding(d, req())).plan;
    // The write gets no clear answer, and the roles cannot be read afterwards either.
    let reads = 0;
    d.fabric = { ...d.fabric, listRoleAssignments: async () => (++reads > 1 ? notReadable('failed') : ok(state.assignments)) };
    d.writer = {
      write: async () => {
        state.assignments = [otherAdmin, assign(61, GROUP, 'Group', 'Viewer')];
        return { ok: false, code: 'uncertain' };
      },
    };
    expect(await performBinding(d, req(), shown)).toEqual({ status: 'failed', code: 'uncertain' });
    expect((await d.store.listAudit()).map((e) => `${e.action}:${e.outcome}`)).toEqual(['binding-add:pending']);

    // Later, someone looks: the group does hold the role now.
    const later = Date.now() + RECONCILE_MIN_AGE_MS + 1;
    const fabric = { listRoleAssignments: async () => ok(state.assignments) };
    expect(await reconcilePending({ store: d.store, directory: d.directory, fabric, actor: ACTOR }, await d.store.listAudit(), later)).toBe(1);
    const closing = (await d.store.listAudit())[0];
    expect(closing).toMatchObject({ action: 'reconcile', outcome: 'ok' });
    expect(JSON.parse(closing.detail!)).toMatchObject({ intent: 'binding-add', toRole: 'Viewer', result: 'state-present-now' });
    expect(await reconcilePending({ store: d.store, directory: d.directory, fabric, actor: ACTOR }, await d.store.listAudit(), later)).toBe(0);
  });

  it('reports nothing to do without a write or a log entry', async () => {
    const d = deps({ assignments: [otherAdmin, assign(61, GROUP, 'Group', 'Viewer')] });
    expect(await lookAndSend(d, req())).toEqual({ status: 'noop' });
    expect(d.sent).toEqual([]);
    expect(await d.store.listAudit()).toEqual([]);
  });
});

describe('binding changes in the Workspaces tab', () => {
  it('are offered to an app admin only when switched on, and need the typed name for a removal', async () => {
    const search = '?as=admin';
    const services = createUmServices({ mock: true, adminUserIds: [] }, search);
    await services.store.setSetting(SETTING_BINDING_CHANGES, true, 'test');
    render(
      <I18nProvider initialLocale="en">
        <AuthProvider authService={new OfflineAuthService(search)}>
          <MemoryRouter initialEntries={[UM_PATHS.workspaces]}>
            <UmProvider services={services}>
              <Routes>
                <Route element={<UmLayout />}>{umRouteElements()}</Route>
              </Routes>
            </UmProvider>
          </MemoryRouter>
        </AuthProvider>
      </I18nProvider>
    );
    await screen.findByText('Discovered');
    const row = await waitFor(() => screen.getAllByRole('row').find((r) => within(r).queryAllByRole('cell')[0]?.textContent === 'FAB-Sales-Contributor')!);
    await userEvent.click(within(row).getByRole('button', { name: 'Remove binding' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Show what this does' }));
    await within(row).findByText('FAB-Sales-Contributor loses the role Contributor in Sales Reporting.');
    expect(within(row).getByText('All 1 direct members of the group lose this path at once.')).toBeInTheDocument();
    const confirm = within(row).getByRole('button', { name: 'Remove the binding now' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(row).getByRole('textbox'), 'Sales Reporting');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(screen.getAllByRole('row').some((r) => within(r).queryAllByRole('cell')[0]?.textContent === 'FAB-Sales-Contributor')).toBe(false), { timeout: 5000 });
    expect((await services.store.listAudit()).filter((e) => e.action === 'binding-remove').map((e) => e.outcome)).toEqual(['ok', 'pending']);
  }, 20_000);
});

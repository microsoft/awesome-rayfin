import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/hooks/AuthContext';
import { I18nProvider } from '@/i18n';
import { UmLayout } from '@/um/components/UmLayout';
import { mailNicknameFor, planGroupCreate, sameGroupPlan, suggestGroupName, type GroupCreateContext, type GroupCreateRequest } from '@/um/domain/groupCreate';
import { guidedBinding, planGuided, seenInFabric, workspaceLink, type GuidedTarget } from '@/um/domain/guidedStep';
import { UM_PATHS } from '@/um/domain/profile';
import { bindingKey, notReadable, ok, type Binding, type DirectoryMember, type ManagedGroup } from '@/um/domain/types';
import { UmProvider } from '@/um/hooks/UmContext';
import type { DirectoryGateway } from '@/um/services/gateways';
import { CREATE_GROUP_URL, createGroup, groupBody, type NewGroup } from '@/um/services/graphGroupCreate';
import { SETTING_GROUP_CREATION, createdNotActivated, performGroupCreate, previewGroup, type GroupCreateDeps } from '@/um/services/groupCreation';
import { RECONCILE_MIN_AGE_MS, reconcilePending } from '@/um/services/memberChanges';
import { OfflineAuthService } from '@/um/services/offlineAuth';
import { recordGuided } from '@/um/services/operations';
import { createUmServices } from '@/um/services/services';
import { MemoryUmStore } from '@/um/services/store';
import { umRouteElements } from '@/um/UmRoutes';

vi.mock('@/um/services/excelClient', () => ({ readSheet: vi.fn(), writeSheet: vi.fn(async () => new Blob()), downloadBlob: vi.fn() }));

const g = (n: number) => `efefefef-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACTOR = { objectId: g(10), userPrincipalName: 'admin@x.example', displayName: 'Admin' };
const person = (n: number, over: Partial<DirectoryMember> = {}): DirectoryMember => ({ id: g(n), type: 'user', displayName: `P${n}`, userPrincipalName: `p${n}@x.example`, userType: 'Member', accountEnabled: true, ...over });

const context = (over: Partial<GroupCreateContext> = {}): GroupCreateContext => ({
  armed: true,
  isAppAdmin: true,
  actor: ACTOR,
  sameName: ok([]),
  owners: ok([]),
  appAdminIds: ok([ACTOR.objectId]),
  ...over,
});
const req = (over: Partial<GroupCreateRequest> = {}): GroupCreateRequest => ({ displayName: 'FAB-Sales-Viewer', description: 'Read access', ownerIds: [], ...over });

describe('naming a new group', () => {
  it('suggests FAB-<Scope>-<Role> and leaves the choice to the admin', () => {
    expect(suggestGroupName('Sales Reporting', 'Viewer')).toBe('FAB-Sales-Reporting-Viewer');
    expect(suggestGroupName('  Finanzen & Controlling ', 'Region Süd')).toBe('FAB-Finanzen-Controlling-Region-Süd');
    expect(suggestGroupName('', 'Viewer')).toBe('FAB-Viewer');
  });

  it('derives a mail alias Entra accepts', () => {
    expect(mailNicknameFor('FAB-Sales-Viewer', 'ab12cd34-ffff')).toBe('FAB-Sales-Viewer-ab12cd34');
    expect(mailNicknameFor('Größe Süd', 'x')).toMatch(/^[A-Za-z0-9-]{1,64}$/);
    expect(mailNicknameFor('---', 'abc')).toBe('group-abc');
  });
});

describe('deciding the creation of a group', () => {
  it('lets an app admin create an empty group they own', () => {
    expect(planGroupCreate(req(), context())).toMatchObject({ ok: true, refusals: [], warnings: [], displayName: 'FAB-Sales-Viewer', ownerIds: [] });
  });

  it.each([
    ['switched off', req(), context({ armed: false }), 'not-armed'],
    ['not an app admin', req(), context({ isAppAdmin: false }), 'not-app-admin'],
    ['name too short', req({ displayName: 'ab' }), context(), 'bad-name'],
    ['name with a quote', req({ displayName: "FAB-Sales' or 1 eq 1" }), context(), 'bad-name'],
    ['description too long', req({ description: 'x'.repeat(1001) }), context(), 'description-too-long'],
    ['existing names unknown', req(), context({ sameName: notReadable('access-denied') }), 'names-not-readable'],
    ['name taken', req(), context({ sameName: ok([{ id: g(1), displayName: 'fab-sales-viewer' }]) }), 'name-exists'],
    ['owners unreadable', req({ ownerIds: [g(20)] }), context({ owners: notReadable('failed') }), 'owners-not-readable'],
    ['owner not found', req({ ownerIds: [g(20)] }), context({ owners: ok([null]) }), 'owner-unknown'],
    ['answer about someone else', req({ ownerIds: [g(20)] }), context({ owners: ok([person(21)]) }), 'owner-unknown'],
    ['owner is a group', req({ ownerIds: [g(20)] }), context({ owners: ok([person(20, { type: 'group' })]) }), 'owner-not-a-person'],
    ['owner disabled', req({ ownerIds: [g(20)] }), context({ owners: ok([person(20, { accountEnabled: false })]) }), 'owner-disabled'],
    ['owner is no object id', req({ ownerIds: ['someone@x.example'] }), context(), 'too-many-owners'],
  ] as const)('refuses: %s', (_name, request, ctx, refusal) => {
    const plan = planGroupCreate(request, ctx);
    expect(plan.ok).toBe(false);
    expect(plan.refusals).toContain(refusal);
  });

  it('names the creator once, and flags owners who are not app admins or are guests', () => {
    const plan = planGroupCreate(req({ ownerIds: [ACTOR.objectId.toUpperCase(), g(20), g(20), g(21)] }), context({ owners: ok([person(20), person(21, { userType: 'Guest' })]) }));
    expect(plan).toMatchObject({ ok: true, ownerIds: [g(20), g(21)] });
    expect(plan.warnings.sort()).toEqual(['owner-guest', 'owner-not-app-admin']);
    const admins = planGroupCreate(req({ ownerIds: [g(20)] }), context({ owners: ok([person(20)]), appAdminIds: ok([ACTOR.objectId, g(20)]) }));
    expect(admins.warnings).toEqual([]);
    expect(planGroupCreate(req({ ownerIds: [g(20)] }), context({ owners: ok([person(20)]), appAdminIds: notReadable('no-route') })).warnings).toEqual(['admins-not-readable']);
  });

  it('compares what was shown with what is true now', () => {
    const shown = { displayName: 'FAB-Sales-Viewer', description: 'Read access', ownerIds: [g(20)] };
    expect(sameGroupPlan(shown, { ...shown })).toBe(true);
    expect(sameGroupPlan(shown, { ...shown, ownerIds: [] })).toBe(false);
    expect(sameGroupPlan(shown, { ...shown, displayName: 'FAB-Sales-Admin' })).toBe(false);
  });
});

describe('the one request that creates a group', () => {
  const group: NewGroup = { displayName: 'FAB-Sales-Viewer', description: 'Read access', mailNickname: 'FAB-Sales-Viewer-ab12', ownerIds: [g(20).toUpperCase()] };

  it('builds a plain security group: no mail, no rule, never assignable to roles', () => {
    expect(JSON.parse(groupBody(group)!)).toEqual({
      displayName: 'FAB-Sales-Viewer',
      description: 'Read access',
      mailEnabled: false,
      mailNickname: 'FAB-Sales-Viewer-ab12',
      securityEnabled: true,
      'owners@odata.bind': [`https://graph.microsoft.com/v1.0/users/${g(20)}`],
    });
    expect(JSON.parse(groupBody({ ...group, description: '', ownerIds: [] })!)).toEqual({ displayName: 'FAB-Sales-Viewer', mailEnabled: false, mailNickname: 'FAB-Sales-Viewer-ab12', securityEnabled: true });
  });

  it.each([
    [{ ...group, displayName: 'ab' }],
    [{ ...group, displayName: ' FAB-Sales-Viewer' }],
    [{ ...group, mailNickname: 'has space' }],
    [{ ...group, displayName: "FAB' or 1 eq 1" }],
    [{ ...group, description: 'bell\u0007' }],
    [{ ...group, ownerIds: ['someone@x.example'] }],
    [{ ...group, ownerIds: Array.from({ length: 11 }, (_, i) => g(100 + i)) }],
  ])('sends nothing for %j', async (bad) => {
    expect(groupBody(bad)).toBeNull();
    const fetcher = vi.fn();
    expect(await createGroup(bad, 't', fetcher)).toEqual({ ok: false, code: 'bad-request' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends once to the fixed address, follows no redirect, and tells unclear from failed', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: g(77).toUpperCase() }), { status: 201 }));
    expect(await createGroup(group, 'tok', fetcher)).toEqual({ ok: true, id: g(77) });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(CREATE_GROUP_URL);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual', headers: { Authorization: 'Bearer tok' } });
    const answer = (status: number, body = '{}') => async () => new Response(status === 204 ? null : body, { status });
    // Created, but without an id that can be used: the caller must look.
    expect(await createGroup(group, 't', answer(201, '{"id":"nope"}'))).toEqual({ ok: false, code: 'uncertain', status: 201 });
    expect(await createGroup(group, 't', answer(403))).toEqual({ ok: false, code: 'denied', status: 403 });
    expect(await createGroup(group, 't', answer(429))).toEqual({ ok: false, code: 'rate-limited', status: 429 });
    expect(await createGroup(group, 't', answer(503))).toEqual({ ok: false, code: 'uncertain', status: 503 });
    expect(await createGroup(group, 't', answer(400))).toEqual({ ok: false, code: 'failed', status: 400 });
    expect(await createGroup(group, 't', async () => Promise.reject(new Error('offline')))).toEqual({ ok: false, code: 'uncertain' });
  });
});

type Named = { id: string; displayName: string; mailNickname?: string };

function deps(state: { groups: Named[]; owners?: DirectoryMember[] }, over: Partial<GroupCreateDeps> = {}): GroupCreateDeps & { store: MemoryUmStore; sent: NewGroup[] } {
  const sent: NewGroup[] = [];
  const store = new MemoryUmStore();
  void store.setSetting(SETTING_GROUP_CREATION, true);
  const directory: DirectoryGateway = {
    me: async () => ACTOR,
    myGroupIds: async () => ok([]),
    myTransitiveGroupIds: async () => ok([]),
    myOwnedGroupIds: async () => ok([]),
    getGroup: async () => notReadable('failed'),
    listOwners: async () => ok(state.owners ?? [person(10)]),
    listMembers: async () => ok([]),
    findUser: async (query) => ok(query === g(20) ? person(20) : null),
    findGroupsByName: async (name) => ok(state.groups.filter((x) => x.displayName.toLowerCase() === name.toLowerCase())),
    resolveUser: async () => ok(null),
  };
  return {
    store,
    directory,
    creator: {
      create: async (group) => {
        sent.push(group);
        state.groups = [...state.groups, { id: g(77), displayName: group.displayName, mailNickname: group.mailNickname }];
        return { ok: true, id: g(77) };
      },
    },
    actor: ACTOR,
    isAppAdmin: true,
    armed: true,
    adminUserIds: [ACTOR.objectId],
    sent,
    ...over,
  } as GroupCreateDeps & { store: MemoryUmStore; sent: NewGroup[] };
}

describe('creating a group', () => {
  it('logs the intent, sends one request, and reads the owners back', async () => {
    const d = deps({ groups: [] });
    const request = req({ ownerIds: [g(20)] });
    const shown = await previewGroup(d, request);
    expect(shown).toMatchObject({ ok: true, ownerIds: [g(20)], warnings: ['owner-not-app-admin'] });
    expect(await performGroupCreate(d, request, shown)).toEqual({ status: 'done', groupId: g(77), displayName: 'FAB-Sales-Viewer', creatorIsOwner: true, sameNameNow: 1 });
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]).toMatchObject({ displayName: 'FAB-Sales-Viewer', ownerIds: [g(20)] });
    const log = await d.store.listAudit();
    expect(log.map((e) => `${e.action}:${e.outcome}`)).toEqual(['group-create:ok', 'group-create:pending']);
    expect(log[0].groupId).toBe(g(77));
    expect(createdNotActivated(log, [])).toEqual([{ groupId: g(77), name: 'FAB-Sales-Viewer', at: log[0].at }]);
    expect(createdNotActivated(log, [g(77).toUpperCase()])).toEqual([]);
  });

  it('says so when Entra does not list the creator as an owner', async () => {
    const d = deps({ groups: [], owners: [person(20)] });
    const shown = await previewGroup(d, req());
    expect(await performGroupCreate(d, req(), shown)).toMatchObject({ status: 'done', creatorIsOwner: false });
  });

  it('sends nothing when refused, switched off in the store, not recordable, or changed since the admin looked', async () => {
    const notAdmin = deps({ groups: [] }, { isAppAdmin: false });
    expect(await performGroupCreate(notAdmin, req(), await previewGroup(notAdmin, req()))).toEqual({ status: 'refused', refusals: ['not-app-admin'] });

    const off = deps({ groups: [] });
    const shownOff = await previewGroup(off, req());
    await off.store.setSetting(SETTING_GROUP_CREATION, false);
    expect(await performGroupCreate(off, req(), shownOff)).toEqual({ status: 'refused', refusals: ['not-armed'] });

    const noLog = deps({ groups: [] });
    const shownNoLog = await previewGroup(noLog, req());
    noLog.store.audit = async () => {
      throw new Error('unreachable');
    };
    expect(await performGroupCreate(noLog, req(), shownNoLog)).toEqual({ status: 'refused', refusals: ['log-unavailable'] });

    const changed = deps({ groups: [] });
    const shown = await previewGroup(changed, req({ ownerIds: [g(20)] }));
    // The same click, but the request now names nobody: not what was confirmed.
    expect(await performGroupCreate(changed, req(), shown)).toEqual({ status: 'refused', refusals: ['changed-since-preview'] });

    const taken = deps({ groups: [] });
    const shownTaken = await previewGroup(taken, req());
    taken.directory = { ...taken.directory, findGroupsByName: async () => ok([{ id: g(5), displayName: 'FAB-Sales-Viewer' }]) };
    expect(await performGroupCreate(taken, req(), shownTaken)).toEqual({ status: 'refused', refusals: ['name-exists'] });

    expect([...notAdmin.sent, ...off.sent, ...noLog.sent, ...changed.sent, ...taken.sent]).toEqual([]);
  });

  it('never sends twice: after an unclear answer it looks for the group of this very attempt', async () => {
    // The group does exist afterwards, with the alias of this attempt: reported as created.
    const state = { groups: [] as Named[] };
    const found = deps(state);
    const create = vi.fn(async (group: NewGroup) => {
      state.groups = [{ id: g(88), displayName: group.displayName, mailNickname: group.mailNickname }];
      return { ok: false as const, code: 'uncertain' as const };
    });
    found.creator = { create };
    expect(await performGroupCreate(found, req(), await previewGroup(found, req()))).toMatchObject({ status: 'done', groupId: g(88) });
    expect(create).toHaveBeenCalledTimes(1);

    // A group of the same name that someone else made in the meantime is not taken for ours.
    const other = { groups: [] as Named[] };
    const foreign = deps(other);
    foreign.creator = {
      create: async (group) => {
        other.groups = [{ id: g(55), displayName: group.displayName, mailNickname: 'someone-elses-alias' }];
        return { ok: false, code: 'uncertain' };
      },
    };
    expect(await performGroupCreate(foreign, req(), await previewGroup(foreign, req()))).toEqual({ status: 'failed', code: 'uncertain' });

    // Nothing found proves nothing (a new group can take a while to show up): the intent stays open.
    const missing = deps({ groups: [] });
    missing.creator = { create: async () => ({ ok: false, code: 'uncertain', status: 502 }) };
    expect(await performGroupCreate(missing, req(), await previewGroup(missing, req()))).toEqual({ status: 'failed', code: 'uncertain' });
    expect((await missing.store.listAudit()).map((e) => e.outcome)).toEqual(['pending']);
    expect((await foreign.store.listAudit()).map((e) => e.outcome)).toEqual(['pending']);
  });

  it('warns when a second group of the same name exists after the creation', async () => {
    const state = { groups: [] as Named[] };
    const d = deps(state);
    const shown = await previewGroup(d, req());
    d.creator = {
      create: async (group) => {
        // Two admins at the same moment: Entra allows the same name twice.
        state.groups = [
          { id: g(77), displayName: group.displayName, mailNickname: group.mailNickname },
          { id: g(78), displayName: group.displayName, mailNickname: 'the-other-one' },
        ];
        return { ok: true, id: g(77) };
      },
    };
    expect(await performGroupCreate(d, req(), shown)).toMatchObject({ status: 'done', groupId: g(77), sameNameNow: 2 });
  });

  it('leaves an unreadable outcome open and settles it later by looking for the name', async () => {
    const state = { groups: [] as Named[] };
    const d = deps(state);
    const shown = await previewGroup(d, req());
    let looks = 0;
    const real = d.directory.findGroupsByName;
    d.directory = { ...d.directory, findGroupsByName: async (name) => (++looks === 2 ? notReadable('failed') : real(name)) };
    d.creator = {
      create: async (group) => {
        state.groups = [{ id: g(88), displayName: group.displayName, mailNickname: group.mailNickname }];
        return { ok: false, code: 'uncertain' };
      },
    };
    expect(await performGroupCreate(d, req(), shown)).toEqual({ status: 'failed', code: 'uncertain' });
    expect((await d.store.listAudit()).map((e) => `${e.action}:${e.outcome}`)).toEqual(['group-create:pending']);

    const later = Date.now() + RECONCILE_MIN_AGE_MS + 1;
    expect(await reconcilePending({ store: d.store, directory: d.directory, actor: ACTOR }, await d.store.listAudit(), later)).toBe(1);
    const closing = (await d.store.listAudit())[0];
    expect(closing).toMatchObject({ action: 'reconcile', outcome: 'ok', groupId: g(88) });
    expect(JSON.parse(closing.detail!)).toMatchObject({ intent: 'group-create', name: 'FAB-Sales-Viewer', result: 'state-present-now' });
  });
});

describe('guided steps in Fabric', () => {
  const audience: GuidedTarget = { kind: 'Audience', workspaceId: g(1), workspaceName: 'Sales', itemId: g(2), itemName: 'Management' };
  const model: GuidedTarget = { kind: 'ModelRole', workspaceId: g(1), workspaceName: 'Sales', itemId: g(3), itemName: 'Sales Model' };
  const group: ManagedGroup = { id: g(90), groupId: g(40), nameSnapshot: 'APP-Sales-Management', requestable: false, description: '', maxDays: 0, active: true, version: 1, activatedByOid: g(10), activatedByUpn: 'a@x.example', activatedAt: 'now', updatedAt: 'now' };

  it('links to the workspace in the tenant of the app', () => {
    expect(workspaceLink(g(9), g(1).toUpperCase())).toBe(`https://app.fabric.microsoft.com/groups/${g(1)}/list?ctid=${g(9)}`);
    expect(workspaceLink(undefined, g(1))).toBe(`https://app.fabric.microsoft.com/groups/${g(1)}/list`);
    expect(workspaceLink(g(9), 'x/../y')).toBeNull();
  });

  it('gives a confirmed step the same identity a read from Fabric would have', () => {
    const confirmed = guidedBinding(audience, g(40), '');
    const read: Binding = { groupId: g(40), kind: 'Audience', scopeId: g(2), scopeName: 'Sales', label: 'Management', provenance: 'inferred' };
    expect(bindingKey(confirmed)).toBe(bindingKey(read));
    expect(confirmed.provenance).toBe('attested');
    expect(guidedBinding(model, g(40), ' Region DACH ')).toMatchObject({ kind: 'ModelRole', scopeId: g(3), scopeName: 'Sales Model', label: 'Region DACH' });
  });

  it('records only what an app admin confirmed, for an activated group', () => {
    const base = { target: model, action: 'add' as const, group, roleName: 'Region DACH', confirmed: true };
    const ctx = { isAppAdmin: true, attested: [] as Binding[] };
    expect(planGuided(base, ctx)).toMatchObject({ ok: true, next: [{ label: 'Region DACH', provenance: 'attested' }] });
    expect(planGuided({ ...base, confirmed: false }, ctx).refusals).toEqual(['not-confirmed']);
    expect(planGuided({ ...base, roleName: ' ' }, ctx).refusals).toEqual(['role-name-missing']);
    expect(planGuided({ ...base, group: undefined }, ctx).refusals).toContain('group-not-activated');
    expect(planGuided({ ...base, group: { ...group, active: false } }, ctx).refusals).toEqual(['group-not-activated']);
    expect(planGuided(base, { ...ctx, isAppAdmin: false }).refusals).toEqual(['not-app-admin']);
    const has = { isAppAdmin: true, attested: [guidedBinding(model, g(40), 'Region DACH'), guidedBinding(audience, g(41), '')] };
    expect(planGuided(base, has).refusals).toEqual(['already-recorded']);
    // Taking it off the record leaves the group's other entries, and other groups' entries, alone.
    expect(planGuided({ ...base, action: 'remove' }, has)).toMatchObject({ ok: true, next: [] });
    expect(planGuided({ ...base, action: 'remove' }, ctx).refusals).toEqual(['not-recorded']);
  });

  it('says whether Fabric shows the same, and nothing when it was not read', () => {
    const b = guidedBinding(audience, g(40), '');
    const read: Binding = { ...b, provenance: 'inferred' };
    expect(seenInFabric('add', b, null)).toBeNull();
    expect(seenInFabric('add', b, [read])).toBe(true);
    expect(seenInFabric('add', b, [])).toBe(false);
    expect(seenInFabric('remove', b, [])).toBe(true);
  });

  it('writes the confirmation to the record of the group and to the log', async () => {
    const store = new MemoryUmStore({ groups: [group] });
    const opDeps = { store, actor: ACTOR };
    const plan = planGuided({ target: audience, action: 'add', group, roleName: '', confirmed: true }, { isAppAdmin: true, attested: [] });
    await recordGuided(opDeps, plan, 'add');
    expect((await store.load()).bindings).toEqual([{ groupId: g(40), kind: 'Audience', scopeId: g(2), scopeName: 'Sales', label: 'Management', provenance: 'attested' }]);
    expect((await store.listAudit())[0]).toMatchObject({ action: 'bindings', outcome: 'ok', groupId: g(40) });
    const refused = planGuided({ target: audience, action: 'add', group, roleName: '', confirmed: false }, { isAppAdmin: true, attested: [] });
    await expect(recordGuided(opDeps, refused, 'add')).rejects.toThrow();
    expect((await store.load()).bindings).toHaveLength(1);
  });
});

function renderApp(path: string) {
  const search = '?as=admin';
  const services = createUmServices({ mock: true, adminUserIds: [] }, search);
  render(
    <I18nProvider initialLocale="en">
      <AuthProvider authService={new OfflineAuthService(search)}>
        <MemoryRouter initialEntries={[path]}>
          <UmProvider services={services}>
            <Routes>
              <Route element={<UmLayout />}>{umRouteElements()}</Route>
            </Routes>
          </UmProvider>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>
  );
  return services;
}

describe('phase 8 in the views', () => {
  it('offers group creation only when switched on, shows what it does, and lists the new group as not activated', async () => {
    const services = renderApp(UM_PATHS.setup);
    await screen.findByRole('heading', { name: 'Permissions' });
    expect(screen.queryByRole('heading', { name: 'Create a group' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch group creation on' }));
    const section = (await screen.findByRole('heading', { name: 'Create a group' })).closest('section')!;

    await userEvent.type(within(section).getByLabelText('What it is for (workspace, app or model)'), 'Marketing Reports');
    await userEvent.type(within(section).getByLabelText('Role or audience'), 'Viewer');
    await userEvent.click(within(section).getByRole('button', { name: 'Suggest a name' }));
    expect(within(section).getByLabelText('Name of the group')).toHaveValue('FAB-Marketing-Reports-Viewer');
    await userEvent.click(within(section).getByRole('button', { name: 'Show what this does' }));
    await within(section).findByText('A new security group named "FAB-Marketing-Reports-Viewer" is created in Entra.');
    await userEvent.click(within(section).getByRole('button', { name: 'Create the group now' }));
    await within(section).findByText(/The group "FAB-Marketing-Reports-Viewer" was created\. Object ID:/);
    expect(await within(section).findByText('Created here and not activated yet')).toBeInTheDocument();
    expect((await services.store.listAudit()).filter((e) => e.action === 'group-create').map((e) => e.outcome)).toEqual(['ok', 'pending']);

    // A second group with the same name is refused before anything is sent.
    await userEvent.type(within(section).getByLabelText('Name of the group'), 'FAB-Marketing-Reports-Viewer');
    await userEvent.click(within(section).getByRole('button', { name: 'Show what this does' }));
    expect(await within(section).findByText(/A group with this name exists already/)).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Create the group now' })).not.toBeInTheDocument();
  }, 30_000);

  it('records a guided model role step for an activated group as confirmed by an admin', async () => {
    const services = renderApp(UM_PATHS.modelRoles);
    await screen.findByText('Discovered');
    const open = await waitFor(() => screen.getAllByRole('button', { name: 'Group in a model role (guided)' })[0]);
    const row = open.closest('tr')!;
    await userEvent.click(open);
    const record = within(row).getByRole('button', { name: 'Record this' });
    expect(record).toBeDisabled();
    await userEvent.selectOptions(within(row).getByLabelText('Group'), 'RLS-Sales-DACH');
    await userEvent.type(within(row).getByLabelText('Name of the role in the model'), 'Region Nord');
    await userEvent.click(within(row).getByRole('checkbox'));
    expect(record).toBeEnabled();
    await userEvent.click(record);
    await within(row).findByText('Recorded as confirmed by you.');
    const stored = (await services.store.load()).bindings.filter((b) => b.kind === 'ModelRole' && b.label === 'Region Nord');
    expect(stored).toHaveLength(1);
    expect(stored[0].provenance).toBe('attested');
  }, 30_000);
});

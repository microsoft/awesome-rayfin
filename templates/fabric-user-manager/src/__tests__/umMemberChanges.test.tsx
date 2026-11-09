import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ts from 'typescript';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/hooks/AuthContext';
import { I18nProvider } from '@/i18n';
import { UmLayout } from '@/um/components/UmLayout';
import { BULK_LIMIT, checkReviewDate, parseBulk, planChange, type ChangeContext } from '@/um/domain/memberChange';
import { checkActivation } from '@/um/domain/activation';
import { UM_PATHS } from '@/um/domain/profile';
import { notReadable, ok, type Binding, type DirectoryMember, type GroupFacts, type ManagedGroup } from '@/um/domain/types';
import type { RowView } from '@/um/domain/views';
import { UmProvider } from '@/um/hooks/UmContext';
import type { DirectoryGateway } from '@/um/services/gateways';
import { GRAPH_BASE } from '@/um/services/graphRead';
import { memberRef, writeMember } from '@/um/services/graphWrite';
import { RECONCILE_MIN_AGE_MS, performChange, reconcilePending, unresolvedIntents, type ChangeDeps, type MemberWriter } from '@/um/services/memberChanges';
import { OfflineAuthService } from '@/um/services/offlineAuth';
import { createUmServices } from '@/um/services/services';
import { MemoryUmStore, SETTING_MEMBER_CHANGES } from '@/um/services/store';
import { umRouteElements } from '@/um/UmRoutes';

vi.mock('@/um/services/excelClient', () => ({ readSheet: vi.fn(), writeSheet: vi.fn(async () => new Blob()), downloadBlob: vi.fn() }));

const g = (n: number) => `ffffffff-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GROUP = g(1);
const ACTOR = { objectId: g(10), userPrincipalName: 'owner@x.example', displayName: 'Owner' };
const person = (n: number, over: Partial<DirectoryMember> = {}): DirectoryMember => ({ id: g(n), type: 'user', displayName: `P${n}`, userPrincipalName: `p${n}@x.example`, userType: 'Member', accountEnabled: true, ...over });
const facts: GroupFacts = { id: GROUP, displayName: 'FAB-Sales-Viewer', securityEnabled: true, mailEnabled: false, groupTypes: [], isAssignableToRole: null, onPremisesSyncEnabled: null, membershipRule: null };
const managed: ManagedGroup = { id: g(90), groupId: GROUP, nameSnapshot: 'FAB-Sales-Viewer', requestable: true, description: '', maxDays: 30, active: true, version: 1, activatedByOid: g(11), activatedByUpn: 'a@x.example', activatedAt: 'now', updatedAt: 'now' };
const binding = (label: string): Binding => ({ groupId: GROUP, kind: 'Workspace', scopeId: g(50), scopeName: 'Sales', label, provenance: 'read' });
const rowOf = (over: Partial<RowView> = {}): RowView => ({ group: managed, bindings: [binding('Viewer')], highRole: false, access: 'manage', isOwner: true, isMember: false, ...over });

const context = (over: Partial<ChangeContext> = {}): ChangeContext => ({
  armed: true,
  row: rowOf(),
  facts: ok(facts),
  owners: ok([person(10)]),
  members: ok([person(20)]),
  actor: ACTOR,
  isAppAdmin: false,
  ...over,
});
const add = (user: DirectoryMember) => ({ action: 'add' as const, groupId: GROUP, user });
const remove = (user: DirectoryMember) => ({ action: 'remove' as const, groupId: GROUP, user });

describe('deciding a member change', () => {
  it('allows an owner to add an enabled member user and to remove a member', () => {
    expect(planChange(add(person(30)), context())).toEqual({ ok: true, refusals: [], noop: undefined });
    expect(planChange(remove(person(20)), context())).toEqual({ ok: true, refusals: [], noop: undefined });
  });

  it('reports nothing to do instead of sending a change', () => {
    expect(planChange(add(person(20)), context()).noop).toBe('already-member');
    expect(planChange(remove(person(30)), context()).noop).toBe('not-member');
  });

  it.each([
    ['switched off', context({ armed: false }), 'not-armed'],
    ['no activated group', context({ row: undefined }), 'not-activated'],
    ['inactive group', context({ row: rowOf({ group: { ...managed, active: false } }) }), 'inactive'],
    ['unreadable group', context({ facts: notReadable('access-denied') }), 'group-not-readable'],
    ['facts of another group', context({ facts: ok({ ...facts, id: g(2) }) }), 'group-not-readable'],
    ['mail-enabled group', context({ facts: ok({ ...facts, mailEnabled: true }) }), 'group-ineligible'],
    ['unreadable owners', context({ owners: notReadable('access-denied') }), 'owners-not-readable'],
    ['not an owner in Entra', context({ owners: ok([person(11)]) }), 'not-owner'],
    ['Member or Admin group', context({ row: rowOf({ highRole: true }) }), 'high-role-admin-only'],
    ['unreadable members', context({ members: notReadable('limit') }), 'members-not-readable'],
  ] as const)('refuses: %s', (_name, ctx, refusal) => {
    const plan = planChange(add(person(30)), ctx);
    expect(plan.ok).toBe(false);
    expect(plan.refusals).toContain(refusal);
  });

  it('trusts live owners, not the stored row: an owner flag without Entra ownership is refused', () => {
    expect(planChange(add(person(30)), context({ row: rowOf({ isOwner: true }), owners: ok([]) })).refusals).toEqual(['not-owner']);
  });

  it('lets an app admin act without being an owner, also on Member and Admin groups', () => {
    const ctx = context({ isAppAdmin: true, owners: notReadable('access-denied'), row: rowOf({ highRole: true }) });
    expect(planChange(add(person(30)), ctx).ok).toBe(true);
  });

  it('never lets anyone add themselves, and adds only enabled member users', () => {
    expect(planChange(add(person(10)), context({ isAppAdmin: true })).refusals).toEqual(['self-add']);
    expect(planChange(add(person(30, { userType: 'Guest' })), context()).refusals).toEqual(['guest']);
    expect(planChange(add(person(30, { accountEnabled: false })), context()).refusals).toEqual(['disabled']);
    // What Graph did not say is unknown, and unknown is refused.
    expect(planChange(add(person(30, { userType: undefined })), context()).refusals).toEqual(['user-unknown']);
    expect(planChange(add(person(30, { accountEnabled: undefined })), context()).refusals).toEqual(['user-unknown']);
    expect(planChange(add({ id: g(30), type: 'group' }), context()).refusals).toEqual(['not-a-user']);
    expect(planChange(add({ id: g(30), type: 'servicePrincipal' }), context()).refusals).toEqual(['not-a-user']);
  });

  it('removes guests and disabled accounts, but does not empty a workspace Admin group', () => {
    const guest = person(20, { userType: 'Guest', accountEnabled: false });
    expect(planChange(remove(guest), context({ members: ok([guest]) })).ok).toBe(true);
    const adminRow = rowOf({ bindings: [binding('Admin')], highRole: true });
    const last = planChange(remove(person(20)), context({ isAppAdmin: true, row: adminRow, members: ok([person(20)]) }));
    expect(last.refusals).toEqual(['last-admin-member']);
    expect(planChange(remove(person(20)), context({ isAppAdmin: true, row: adminRow, members: ok([person(20), person(21)]) })).ok).toBe(true);
  });

  it('reads a pasted list, drops what is not an address, and caps it', () => {
    expect(parseBulk('a@x.example, B@x.example;a@X.example\n not-an-address c@x.example').names).toEqual(['a@x.example', 'B@x.example', 'c@x.example']);
    const many = Array.from({ length: BULK_LIMIT + 7 }, (_, i) => `u${i}@x.example`).join(' ');
    expect(parseBulk(many)).toMatchObject({ overLimit: 7 });
    expect(parseBulk(many).names).toHaveLength(BULK_LIMIT);
  });

  it('accepts a review date only in the future and within the limit of the group', () => {
    const today = new Date('2026-10-10T08:00:00Z');
    expect(checkReviewDate('2026-10-11', 30, today)).toBe('ok');
    expect(checkReviewDate('2026-10-10', 30, today)).toBe('past');
    expect(checkReviewDate('2026-12-31', 30, today)).toBe('too-far');
    expect(checkReviewDate('2027-12-31', 0, today)).toBe('ok');
    expect(checkReviewDate('31.12.2026', 0, today)).toBe('invalid');
  });
});

describe('the two Graph writes', () => {
  it('builds exactly one add and one remove request from two object ids', () => {
    expect(memberRef('add', GROUP.toUpperCase(), g(30))).toEqual({
      method: 'POST',
      url: `${GRAPH_BASE}/groups/${GROUP}/members/$ref`,
      body: JSON.stringify({ '@odata.id': `${GRAPH_BASE}/directoryObjects/${g(30)}` }),
    });
    expect(memberRef('remove', GROUP, g(30))).toEqual({ method: 'DELETE', url: `${GRAPH_BASE}/groups/${GROUP}/members/${g(30)}/$ref` });
  });

  it('never addresses the directory object itself: the remove path always ends in the reference link', () => {
    const request = memberRef('remove', GROUP, g(30))!;
    expect(request.url.endsWith('/$ref')).toBe(true);
    expect(request.url).not.toMatch(/\/users\//);
    expect(request.body).toBeUndefined();
  });

  it.each([['not-a-guid', g(30)], [GROUP, `${g(30)}/$ref/../..`], [GROUP, 'p30@x.example'], ['', '']])('sends nothing for %s / %s', async (group, user) => {
    expect(memberRef('remove', group, user)).toBeNull();
    const fetcher = vi.fn();
    expect(await writeMember('remove', group, user, 't', fetcher)).toEqual({ ok: false, code: 'bad-request' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends one request with the token as a header and maps the answers', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    expect(await writeMember('add', GROUP, g(30), 'tok', fetcher)).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' } });

    const answer = (status: number, body = '') => async () => new Response(body, { status });
    expect(await writeMember('add', GROUP, g(30), 't', answer(403))).toEqual({ ok: false, code: 'denied', status: 403 });
    expect(await writeMember('add', GROUP, g(30), 't', answer(429))).toEqual({ ok: false, code: 'rate-limited', status: 429 });
    expect(await writeMember('add', GROUP, g(30), 't', answer(400, 'One or more added object references already exist'))).toEqual({ ok: false, code: 'already-member', status: 400 });
    expect(await writeMember('add', GROUP, g(30), 't', answer(400, 'Bad request'))).toEqual({ ok: false, code: 'failed', status: 400 });
    expect(await writeMember('remove', GROUP, g(30), 't', answer(404))).toEqual({ ok: false, code: 'not-member', status: 404 });
    // No answer, or a server error: the change may have been applied. That is not "failed".
    expect(await writeMember('remove', GROUP, g(30), 't', async () => Promise.reject(new Error('offline')))).toEqual({ ok: false, code: 'uncertain' });
    expect(await writeMember('add', GROUP, g(30), 't', answer(503))).toEqual({ ok: false, code: 'uncertain', status: 503 });
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('the write file itself', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../um/services/graphWrite.ts'), 'utf8');
  const tree = ts.createSourceFile('graphWrite.ts', source, ts.ScriptTarget.ES2022, true);

  it('exports exactly the two functions and sends through exactly one call', () => {
    const exported: string[] = [];
    const methods: string[] = [];
    const imports: string[] = [];
    let fetchCalls = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) exported.push(node.name.text);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'method' && ts.isStringLiteral(node.initializer)) methods.push(node.initializer.text);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 'fetch' || node.expression.text === 'fetcher')) fetchCalls += 1;
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(exported.sort()).toEqual(['memberRef', 'writeMember']);
    expect(methods.sort()).toEqual(['DELETE', 'POST']);
    expect(imports.sort()).toEqual(['./graphRead', '@/um/domain/types']);
    // One real send (`fetcher(...)`) plus the default that forwards to `fetch`.
    expect(fetchCalls).toBe(2);
    // In the code itself, comments aside, no other verb and no batch endpoint is named.
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/PATCH|PUT\b|\$batch/);
  });

  it('can only ever produce the two intended URLs', () => {
    const hex = '0123456789abcdef';
    const id = (seed: number) => {
      let out = '';
      for (let i = 0; i < 32; i++) out += hex[(seed * 7 + i * 13 + seed * i) % 16];
      return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
    };
    const addUrl = /^https:\/\/graph\.microsoft\.com\/v1\.0\/groups\/[0-9a-f-]{36}\/members\/\$ref$/;
    const removeUrl = /^https:\/\/graph\.microsoft\.com\/v1\.0\/groups\/[0-9a-f-]{36}\/members\/[0-9a-f-]{36}\/\$ref$/;
    for (let i = 1; i <= 200; i++) {
      expect(memberRef('add', id(i), id(i + 500))!.url).toMatch(addUrl);
      expect(memberRef('remove', id(i).toUpperCase(), id(i + 500))!.url).toMatch(removeUrl);
    }
    for (const bad of ['', 'x', `${id(1)} `, `${id(1)}?x=1`, `${id(1)}/owners`, '../' + id(1), id(1).replace(/-/g, '')]) {
      expect(memberRef('add', bad, id(2))).toBeNull();
      expect(memberRef('remove', id(2), bad)).toBeNull();
    }
  });
});

function directory(state: { members: DirectoryMember[]; owners?: DirectoryMember[]; visibleAfterWrite?: boolean }): DirectoryGateway {
  return {
    me: async () => ACTOR,
    myGroupIds: async () => ok([]),
    myTransitiveGroupIds: async () => ok([]),
    myOwnedGroupIds: async () => ok([GROUP]),
    getGroup: async () => ok(facts),
    listOwners: async () => ok(state.owners ?? [person(10)]),
    listMembers: async () => ok(state.members),
    findUser: async () => ok(null),
    findGroupsByName: async () => ok([]),
    resolveUser: async () => ok(null),
  };
}

function deps(over: Partial<ChangeDeps> & { state: { members: DirectoryMember[]; owners?: DirectoryMember[] } }): ChangeDeps & { store: MemoryUmStore; sent: string[]; actorSeen: string[] } {
  const sent: string[] = [];
  const actorSeen: string[] = [];
  const writer: MemberWriter = {
    write: async (action, groupId, userId, actorObjectId) => {
      sent.push(`${action}:${groupId}:${userId}`);
      actorSeen.push(actorObjectId);
      if (action === 'add') over.state.members = [...over.state.members, person(Number(userId.slice(-2)))];
      else over.state.members = over.state.members.filter((m) => m.id !== userId);
      return { ok: true };
    },
  };
  const store = new MemoryUmStore();
  void store.setSetting(SETTING_MEMBER_CHANGES, true);
  return { store, directory: directory(over.state), writer, actor: ACTOR, isAppAdmin: false, armed: true, sent, actorSeen, ...over } as unknown as ChangeDeps & { store: MemoryUmStore; sent: string[]; actorSeen: string[] };
}

describe('carrying out a member change', () => {
  it('logs the intent, sends one write, logs the outcome and reads back', async () => {
    const state = { members: [person(20)] };
    const d = deps({ state });
    d.directory = { ...directory(state), listMembers: async () => ok(state.members) };
    expect(await performChange(d, add(person(30)), rowOf())).toEqual({ status: 'done', confirmed: true });
    expect(d.sent).toEqual([`add:${GROUP}:${g(30)}`]);
    const log = await d.store.listAudit();
    expect(log.map((e) => `${e.action}:${e.outcome}`)).toEqual(['member-add:ok', 'member-add:pending']);
    expect(log.every((e) => e.actorOid === ACTOR.objectId)).toBe(true);
    expect(JSON.parse(log[0].detail!)).toMatchObject({ result: 'confirmed', userId: g(30) });
    // The log is readable by every signed-in user: object ids only, no names.
    expect(log.map((e) => e.detail).join(' ')).not.toMatch(/P30|p30@|FAB-Sales/);
    expect(unresolvedIntents(log, Date.now() + RECONCILE_MIN_AGE_MS)).toEqual([]);
    // The writer is told who is acting, so it can refuse a token of someone else.
    expect(d.actorSeen).toEqual([ACTOR.objectId]);
  });

  it('sends nothing when refused, and logs the refusal', async () => {
    const d = deps({ state: { members: [], owners: [person(11)] } });
    expect(await performChange(d, add(person(30)), rowOf())).toEqual({ status: 'refused', refusals: ['not-owner'] });
    expect(d.sent).toEqual([]);
    expect((await d.store.listAudit()).map((e) => e.outcome)).toEqual(['refused']);
  });

  it('sends nothing when switched off or when there is nothing to do', async () => {
    const off = deps({ state: { members: [] }, armed: false });
    expect((await performChange(off, add(person(30)), rowOf())).status).toBe('refused');
    const same = deps({ state: { members: [person(30)] } });
    expect(await performChange(same, add(person(30)), rowOf())).toEqual({ status: 'noop', noop: 'already-member' });
    expect([...off.sent, ...same.sent]).toEqual([]);
  });

  it('obeys the switch as stored right now, not as the page remembers it', async () => {
    const d = deps({ state: { members: [] } });
    await d.store.setSetting(SETTING_MEMBER_CHANGES, false);
    expect(await performChange(d, add(person(30)), rowOf())).toEqual({ status: 'refused', refusals: ['not-armed'] });
    expect(d.sent).toEqual([]);
  });

  it('makes no change it cannot put on record first', async () => {
    const d = deps({ state: { members: [] } });
    d.store.audit = async () => {
      throw new Error('database unreachable');
    };
    expect(await performChange(d, add(person(30)), rowOf())).toEqual({ status: 'refused', refusals: ['log-unavailable'] });
    expect(d.sent).toEqual([]);
  });

  it('looks instead of guessing when Entra gives no clear answer', async () => {
    // The answer was lost but the member is there: say so, do not report a failure.
    const applied = deps({ state: { members: [person(30)] } });
    applied.directory = { ...applied.directory, listMembers: vi.fn().mockResolvedValueOnce(ok([])).mockResolvedValue(ok([person(30)])) };
    applied.writer = { write: async () => ({ ok: false, code: 'uncertain' }) };
    expect(await performChange(applied, add(person(30)), rowOf())).toEqual({ status: 'done', confirmed: true });
    expect(JSON.parse((await applied.store.listAudit())[0].detail!).result).toBe('confirmed-after-unclear-answer');

    // The answer was lost and the member is not there: unclear, never retried.
    const lost = deps({ state: { members: [] } });
    const write = vi.fn(async () => ({ ok: false as const, code: 'uncertain' as const, status: 503 }));
    lost.writer = { write };
    expect(await performChange(lost, add(person(30)), rowOf())).toEqual({ status: 'failed', code: 'uncertain' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await lost.store.listAudit())[0].detail!).result).toBe('unclear-not-applied');
  });

  it('does not claim a change that someone else already made', async () => {
    const d = deps({ state: { members: [] } });
    d.writer = { write: async () => ({ ok: false, code: 'already-member', status: 400 }) };
    expect(await performChange(d, add(person(30)), rowOf())).toEqual({ status: 'noop', noop: 'already-member' });
    expect(JSON.parse((await d.store.listAudit())[0].detail!)).toMatchObject({ result: 'nothing-changed', state: 'already-member' });
  });

  it('never manages the group of app admins', async () => {
    const d = deps({ state: { members: [] }, isAppAdmin: true, adminGroupId: GROUP });
    expect(await performChange(d, add(person(30)), rowOf())).toEqual({ status: 'refused', refusals: ['app-admin-group'] });
    expect(d.sent).toEqual([]);
    expect(checkActivation({ groupId: GROUP, requestable: false, description: '', maxDays: 0 }, { facts: ok(facts), alreadyManaged: false, highRole: false, adminGroupId: GROUP.toUpperCase() }).errors).toEqual(['app-admin-group']);
  });

  it('reports a write Entra refused as failed, and "not visible yet" honestly', async () => {
    const denied = deps({ state: { members: [] } });
    denied.writer = { write: async () => ({ ok: false, code: 'denied', status: 403 }) };
    expect(await performChange(denied, add(person(30)), rowOf())).toEqual({ status: 'failed', code: 'denied' });
    expect((await denied.store.listAudit()).map((e) => e.outcome)).toEqual(['failed', 'pending']);

    const slow = deps({ state: { members: [] } });
    slow.writer = { write: async () => ({ ok: true }) };
    expect(await performChange(slow, add(person(30)), rowOf())).toEqual({ status: 'done', confirmed: false });
    expect(JSON.parse((await slow.store.listAudit())[0].detail!).result).toBe('accepted-not-visible');
  });

  it('closes an old intent that never got an outcome, as its own kind of entry', async () => {
    const state = { members: [person(30)] };
    const d = deps({ state });
    await d.store.audit({ action: 'member-add', outcome: 'pending', groupId: GROUP, actorOid: g(77), actorUpn: 'gone@x.example', detail: JSON.stringify({ changeId: 'c1', userId: g(30) }) });
    await d.store.audit({ action: 'member-remove', outcome: 'pending', groupId: GROUP, actorOid: g(77), actorUpn: 'gone@x.example', detail: JSON.stringify({ changeId: 'c2', userId: g(30) }) });
    const before = await d.store.listAudit();

    // Fresh intents may still be in flight in another tab: they are left alone.
    expect(unresolvedIntents(before)).toEqual([]);
    expect(await reconcilePending(d, before)).toBe(0);

    const later = Date.now() + RECONCILE_MIN_AGE_MS + 1000;
    expect(unresolvedIntents(before, later)).toHaveLength(2);
    expect(await reconcilePending(d, before, later)).toBe(2);
    const after = await d.store.listAudit();
    expect(unresolvedIntents(after, later)).toEqual([]);
    // The add is visible, the removal is not. Neither entry claims who made the change.
    const closing = after.filter((e) => e.action === 'reconcile');
    expect(closing.map((e) => `${JSON.parse(e.detail!).intent}:${e.outcome}:${JSON.parse(e.detail!).intentByOid}`).sort()).toEqual([`member-add:ok:${g(77)}`, `member-remove:failed:${g(77)}`]);
    expect(closing.every((e) => e.actorOid === ACTOR.objectId)).toBe(true);
  });
});

function renderApp(persona: 'admin' | 'owner', armed: boolean) {
  const search = `?as=${persona}`;
  const services = createUmServices({ mock: true, adminUserIds: [] }, search);
  if (armed) void services.store.setSetting(SETTING_MEMBER_CHANGES, true, 'test');
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
  return services;
}

describe('member changes in the group view', () => {
  it('stay read-only until switched on', async () => {
    renderApp('owner', false);
    await screen.findByRole('heading', { name: 'FAB-Sales-Viewer' });
    await userEvent.click(screen.getByRole('button', { name: 'Show members' }));
    await screen.findByText('Anna Analyst');
    expect(screen.getByText(/Read-only here/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add people' })).not.toBeInTheDocument();
  });

  it('checks first, shows what the person gets, then adds and removes', async () => {
    const services = renderApp('owner', true);
    await screen.findByRole('heading', { name: 'FAB-Sales-Viewer' });
    await userEvent.click(screen.getByRole('button', { name: 'Show members' }));
    await screen.findByRole('textbox', { name: 'Add people' });

    await userEvent.click(screen.getByRole('textbox', { name: 'Add people' }));
    await userEvent.paste(
      'uwe.user@contoso.example anna.analyst@contoso.example gina_partner.example#EXT#@contoso.example nobody@contoso.example olivia.owner@contoso.example'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    // Each name is looked up and judged from live reads, one after the other.
    expect(await screen.findByText('You cannot add yourself.', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Can be added')).toBeInTheDocument();
    expect(screen.getByText('Already a member')).toBeInTheDocument();
    expect(screen.getByText('Guests are not added here.')).toBeInTheDocument();
    expect(screen.getByText('No such user')).toBeInTheDocument();
    expect(screen.getByText('Each person added gets:')).toBeInTheDocument();
    // Nothing was sent by checking.
    expect((await services.store.listAudit()).filter((e) => e.action === 'member-add')).toEqual([]);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add now (1)' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Add now (1)' }));
    expect(await screen.findByText('Added and confirmed', undefined, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Uwe User').length).toBeGreaterThan(1));
    expect((await services.store.listAudit()).filter((e) => e.action === 'member-add').map((e) => e.outcome)).toEqual(['ok', 'pending']);

    const row = screen.getAllByRole('row').find((r) => within(r).queryAllByRole('cell')[0]?.textContent === 'Uwe User')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    await within(row).findByText(/Remove Uwe User from FAB-Sales-Viewer\?/);
    expect(within(row).getByText('Other paths, for example through another group, may remain.')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Remove now' }));
    await waitFor(() => expect(screen.getAllByRole('row').some((r) => within(r).queryAllByRole('cell')[0]?.textContent === 'Uwe User')).toBe(false));
    expect((await services.store.listAudit()).filter((e) => e.action === 'member-remove').map((e) => e.outcome)).toEqual(['ok', 'pending']);
  }, 20_000);

  it('lets only an app admin switch member changes, in Setup', async () => {
    const services = renderApp('admin', false);
    await screen.findByText('Discovered');
    await userEvent.click(screen.getByRole('link', { name: /Setup/ }));
    await screen.findByText('Member changes');
    await userEvent.click(screen.getByRole('button', { name: 'Switch member changes on' }));
    await screen.findByRole('button', { name: 'Switch member changes off' });
    expect(await services.store.getSetting(SETTING_MEMBER_CHANGES)).toBe(true);
    expect((await services.store.listAudit())[0]).toMatchObject({ action: 'switch', outcome: 'ok' });
  });
});

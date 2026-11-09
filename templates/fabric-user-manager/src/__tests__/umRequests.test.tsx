import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/hooks/AuthContext';
import { I18nProvider } from '@/i18n';
import { UmLayout } from '@/um/components/UmLayout';
import { accessFingerprint, canWithdraw, checkDecision, checkRequest, noticeRecipients, sameDomainOnly, sameRequester, type AccessRequest } from '@/um/domain/accessRequest';
import { UM_PATHS } from '@/um/domain/profile';
import { ok, type Binding, type DirectoryMember, type GroupFacts, type ManagedGroup } from '@/um/domain/types';
import type { RowView } from '@/um/domain/views';
import { UmProvider } from '@/um/hooks/UmContext';
import { approveRequest, denyRequest, submitRequest, withdrawRequest, type RequestDeps } from '@/um/services/accessRequests';
import type { DirectoryGateway } from '@/um/services/gateways';
import { SEND_MAIL_URL, sendNotice } from '@/um/services/graphMail';
import type { ChangeDeps } from '@/um/services/memberChanges';
import { MockNoticeSender } from '@/um/services/mock';
import { OfflineAuthService } from '@/um/services/offlineAuth';
import { createUmServices } from '@/um/services/services';
import { MemoryUmStore, SETTING_MEMBER_CHANGES } from '@/um/services/store';
import { umRouteElements } from '@/um/UmRoutes';

vi.mock('@/um/services/excelClient', () => ({ readSheet: vi.fn(), writeSheet: vi.fn(async () => new Blob()), downloadBlob: vi.fn() }));

const g = (n: number) => `abababab-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GROUP = g(1);
const REQUESTER = { objectId: g(20), userPrincipalName: 'uwe@x.example', displayName: 'Uwe User' };
const OWNER = { objectId: g(10), userPrincipalName: 'olivia@x.example', displayName: 'Olivia Owner' };
const managed: ManagedGroup = { id: g(90), groupId: GROUP, nameSnapshot: 'FAB-Sales-Viewer', requestable: true, description: '', maxDays: 30, active: true, version: 3, activatedByOid: g(11), activatedByUpn: 'a@x.example', activatedAt: 'now', updatedAt: 'now' };
const binding = (label: string): Binding => ({ groupId: GROUP, kind: 'Workspace', scopeId: g(50), scopeName: 'Sales', label, provenance: 'read' });
const rowOf = (over: Partial<RowView> = {}): RowView => ({ group: managed, bindings: [binding('Viewer')], highRole: false, access: 'request-view', isOwner: false, isMember: false, ...over });
const today = new Date('2026-10-10T08:00:00Z');
const facts: GroupFacts = { id: GROUP, displayName: 'FAB-Sales-Viewer', securityEnabled: true, mailEnabled: false, groupTypes: [], isAssignableToRole: null, onPremisesSyncEnabled: null, membershipRule: null };
const asMember = (id: string, over: Partial<DirectoryMember> = {}): DirectoryMember => ({ id, type: 'user', displayName: 'Uwe User', userPrincipalName: 'uwe@x.example', userType: 'Member', accountEnabled: true, ...over });

describe('asking for access', () => {
  const ctx = { requesterOid: REQUESTER.objectId, pending: [] as AccessRequest[], today };
  const good = { reason: 'I work on the sales reports.' };

  it('needs a requestable group, a reason, and a sensible review date', () => {
    expect(checkRequest(rowOf(), good, ctx)).toEqual([]);
    expect(checkRequest(rowOf(), { reason: 'short' }, ctx)).toEqual(['reason-too-short']);
    expect(checkRequest(rowOf(), { ...good, reviewOn: '2026-10-09' }, ctx)).toEqual(['review-past']);
    expect(checkRequest(rowOf(), { ...good, reviewOn: '2027-10-09' }, ctx)).toEqual(['review-too-far']);
    expect(checkRequest(rowOf(), { ...good, reviewOn: '2026-10-20' }, ctx)).toEqual([]);
  });

  it('refuses groups that are not open, Member and Admin groups, members and a second request', () => {
    expect(checkRequest(undefined, good, ctx)).toEqual(['not-requestable']);
    expect(checkRequest(rowOf({ group: { ...managed, requestable: false } }), good, ctx)).toEqual(['not-requestable']);
    expect(checkRequest(rowOf({ group: { ...managed, active: false } }), good, ctx)).toEqual(['not-requestable']);
    expect(checkRequest(rowOf({ highRole: true }), good, ctx)).toEqual(['not-requestable']);
    // Nothing is known about what the group opens: nobody could say what is being asked for.
    expect(checkRequest(rowOf({ bindings: [] }), good, ctx)).toEqual(['not-requestable']);
    expect(checkRequest(rowOf({ isMember: true }), good, ctx)).toEqual(['already-member']);
    const pending = [{ groupId: GROUP, requesterOid: REQUESTER.objectId, status: 'Pending' } as AccessRequest];
    expect(checkRequest(rowOf(), good, { ...ctx, pending })).toEqual(['already-pending']);
    // Someone else's pending request does not block.
    expect(checkRequest(rowOf(), good, { ...ctx, pending: [{ ...pending[0], requesterOid: g(21) }] })).toEqual([]);
  });

  it('marks what the group opened, so a later change is noticed', () => {
    const a = accessFingerprint(rowOf());
    expect(accessFingerprint(rowOf({ bindings: [binding('Viewer')] }))).toBe(a);
    expect(accessFingerprint(rowOf({ bindings: [binding('Contributor')] }))).not.toBe(a);
    expect(accessFingerprint(rowOf({ bindings: [binding('Viewer'), { ...binding('Viewer'), scopeId: g(51), scopeName: 'Finance' }] }))).not.toBe(a);
  });
});

describe('deciding a request', () => {
  const request: AccessRequest = { id: g(70), groupId: GROUP, requesterOid: REQUESTER.objectId, requesterUpn: REQUESTER.userPrincipalName, requesterName: REQUESTER.displayName, reason: 'because', rowVersion: 3, accessFingerprint: accessFingerprint(rowOf()), status: 'Pending', createdAt: 'now' };
  const manage = rowOf({ access: 'manage', isOwner: true });

  it('lets a manager of the group decide, and nobody their own request', () => {
    expect(checkDecision(request, 'approve', { actorOid: OWNER.objectId, row: manage })).toEqual([]);
    expect(checkDecision(request, 'approve', { actorOid: REQUESTER.objectId, row: manage })).toEqual(['own-request']);
    expect(checkDecision(request, 'deny', { actorOid: REQUESTER.objectId, row: manage })).toEqual(['own-request']);
    expect(checkDecision(request, 'approve', { actorOid: OWNER.objectId, row: rowOf() })).toEqual(['not-manager']);
    expect(checkDecision({ ...request, status: 'Denied' }, 'approve', { actorOid: OWNER.objectId, row: manage })).toEqual(['not-pending']);
  });

  it('refuses to approve when the group changed after the request, but still allows denying', () => {
    const edited = { ...manage, group: { ...managed, version: 4 } };
    expect(checkDecision(request, 'approve', { actorOid: OWNER.objectId, row: edited })).toEqual(['group-changed']);
    const nowAdmin = { ...manage, bindings: [binding('Admin')], highRole: true };
    expect(checkDecision(request, 'approve', { actorOid: OWNER.objectId, row: nowAdmin })).toEqual(['group-changed', 'not-requestable-anymore']);
    expect(checkDecision(request, 'deny', { actorOid: OWNER.objectId, row: edited })).toEqual([]);
  });

  it('lets only the requester withdraw, and only while pending', () => {
    expect(canWithdraw(request, REQUESTER.objectId)).toBe(true);
    expect(canWithdraw(request, OWNER.objectId)).toBe(false);
    expect(canWithdraw({ ...request, status: 'Approved' }, REQUESTER.objectId)).toBe(false);
  });
});

describe('the notice to the owners', () => {
  it('goes to at most ten plausible, distinct addresses', () => {
    expect(noticeRecipients('a@x.example; A@x.example, not-an-address  b@x.example;<c@x.example>')).toEqual(['a@x.example', 'b@x.example']);
    expect(noticeRecipients(Array.from({ length: 15 }, (_, i) => `u${i}@x.example`).join(';'))).toHaveLength(10);
    expect(noticeRecipients('')).toEqual([]);
  });

  it('is one plain-text message through one fixed address', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 202 }));
    const outcome = await sendNotice({ to: 'olivia@x.example;ben@x.example', subject: 'Access request:\r\nBcc: evil@x.example', body: '<b>hello</b>' }, 'tok', fetcher);
    expect(outcome).toEqual({ ok: true, recipients: 2 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(SEND_MAIL_URL);
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string);
    expect(sent.message.body).toEqual({ contentType: 'Text', content: '<b>hello</b>' });
    // A line break in a name cannot add a header.
    expect(sent.message.subject).toBe('Access request: Bcc: evil@x.example');
    expect(sent.message.toRecipients.map((r: { emailAddress: { address: string } }) => r.emailAddress.address)).toEqual(['olivia@x.example', 'ben@x.example']);
    expect(Object.keys(sent.message).sort()).toEqual(['body', 'subject', 'toRecipients']);
  });

  it('sends nothing without a recipient and reports a refusal', async () => {
    const fetcher = vi.fn();
    expect(await sendNotice({ to: 'nobody', subject: 's', body: 'b' }, 't', fetcher)).toEqual({ ok: false, code: 'no-recipients' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await sendNotice({ to: 'a@x.example', subject: 's', body: 'b' }, 't', async () => new Response(null, { status: 403 }))).toEqual({ ok: false, code: 'denied' });
  });
});

function requestDeps(store: MemoryUmStore, sender: MockNoticeSender | null): RequestDeps {
  return { store, actor: REQUESTER, sender, appUrl: 'https://app.example/um' };
}

function changeDeps(store: MemoryUmStore, state: { members: DirectoryMember[] }, over: Partial<ChangeDeps> = {}): ChangeDeps & { sent: string[] } {
  const sent: string[] = [];
  const directory: DirectoryGateway = {
    me: async () => OWNER,
    myGroupIds: async () => ok([]),
    myTransitiveGroupIds: async () => ok([]),
    myOwnedGroupIds: async () => ok([GROUP]),
    getGroup: async () => ok(facts),
    listOwners: async () => ok([asMember(OWNER.objectId)]),
    listMembers: async () => ok(state.members),
    findUser: async () => ok(null),
    findGroupsByName: async () => ok([]),
    resolveUser: async (query) => ok(query === REQUESTER.objectId ? asMember(REQUESTER.objectId) : null),
  };
  return {
    store,
    directory,
    writer: {
      write: async (action, _group, userId) => {
        sent.push(`${action}:${userId}`);
        state.members = [...state.members, asMember(userId)];
        return { ok: true };
      },
    },
    actor: OWNER,
    isAppAdmin: false,
    armed: true,
    sent,
    ...over,
  } as ChangeDeps & { sent: string[] };
}

describe('request flow', () => {
  it('files a request, tells the owners, and refuses a duplicate', async () => {
    const store = new MemoryUmStore({ groups: [managed] });
    await store.setContact(GROUP, 'olivia@x.example');
    const sender = new MockNoticeSender();
    const result = await submitRequest(requestDeps(store, sender), rowOf(), { reason: 'I work on the sales reports.', reviewOn: '2026-10-20' }, today);
    expect(result).toMatchObject({ status: 'submitted', notice: 'sent', request: { status: 'Pending', requesterOid: REQUESTER.objectId, rowVersion: 3, reviewOn: '2026-10-20' } });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({ to: 'olivia@x.example', subject: 'Access request: FAB-Sales-Viewer' });
    expect(sender.sent[0].body).toContain('Nothing has been changed.');
    expect(sender.sent[0].body).toContain('https://app.example/um');

    expect(await submitRequest(requestDeps(store, sender), rowOf(), { reason: 'I work on the sales reports.' }, today)).toEqual({ status: 'refused', refusals: ['already-pending'] });
    expect(sender.sent).toHaveLength(1);
  });

  it('still files the request when no owner address is known or the mail fails', async () => {
    const store = new MemoryUmStore({ groups: [managed] });
    const none = await submitRequest(requestDeps(store, new MockNoticeSender()), rowOf(), { reason: 'I work on the sales reports.' }, today);
    expect(none).toMatchObject({ status: 'submitted', notice: 'no-recipients' });
    const other = new MemoryUmStore({ groups: [managed] });
    await other.setContact(GROUP, 'olivia@x.example');
    const failing = { sent: [], send: async () => ({ ok: false as const, code: 'denied' as const }) } as unknown as MockNoticeSender;
    expect(await submitRequest(requestDeps(other, failing), rowOf(), { reason: 'I work on the sales reports.' }, today)).toMatchObject({ status: 'submitted', notice: 'not-sent' });
  });

  it('approves by adding the requester through the member change, with the approver as actor', async () => {
    const store = new MemoryUmStore({ groups: [managed] });
    await store.setSetting(SETTING_MEMBER_CHANGES, true);
    const filed = await submitRequest(requestDeps(store, null), rowOf(), { reason: 'I work on the sales reports.', reviewOn: '2026-10-20' }, today);
    if (filed.status !== 'submitted') throw new Error('not submitted');
    const state = { members: [] as DirectoryMember[] };
    const deps = changeDeps(store, state);
    const result = await approveRequest(deps, filed.request, rowOf({ access: 'manage', isOwner: true }));
    expect(result).toMatchObject({ status: 'approved', change: { status: 'done', confirmed: true } });
    expect(deps.sent).toEqual([`add:${REQUESTER.objectId}`]);
    const stored = (await store.listRequests())[0];
    expect(stored).toMatchObject({ status: 'Approved', decidedByOid: OWNER.objectId });
    expect(await store.listReviewDates()).toEqual([{ groupId: GROUP, userId: REQUESTER.objectId, reviewOn: '2026-10-20' }]);
    // The change is logged under the approver, not the requester.
    expect((await store.listAudit()).filter((e) => e.action === 'member-add').every((e) => e.actorOid === OWNER.objectId)).toBe(true);
  });

  it('keeps the request open when the member change is refused, and never lets the requester approve', async () => {
    const store = new MemoryUmStore({ groups: [managed] });
    await store.setSetting(SETTING_MEMBER_CHANGES, true);
    const filed = await submitRequest(requestDeps(store, null), rowOf(), { reason: 'I work on the sales reports.' }, today);
    if (filed.status !== 'submitted') throw new Error('not submitted');
    const row = rowOf({ access: 'manage', isOwner: true });

    // The approver is not an owner in Entra right now: the member change refuses.
    const notOwner = changeDeps(store, { members: [] });
    notOwner.directory = { ...notOwner.directory, listOwners: async () => ok([]) };
    expect(await approveRequest(notOwner, filed.request, row)).toMatchObject({ status: 'not-approved', change: { status: 'refused', refusals: ['not-owner'] } });
    expect((await store.listRequests())[0].status).toBe('Pending');

    const self = changeDeps(store, { members: [] }, { actor: REQUESTER });
    expect(await approveRequest(self, filed.request, row)).toEqual({ status: 'refused', refusals: ['own-request'] });
    expect([...notOwner.sent, ...self.sent]).toEqual([]);
  });

  it('uses the stored request, so an edited copy on the page cannot change who is added', async () => {
    const store = new MemoryUmStore({ groups: [managed] });
    await store.setSetting(SETTING_MEMBER_CHANGES, true);
    const filed = await submitRequest(requestDeps(store, null), rowOf(), { reason: 'I work on the sales reports.' }, today);
    if (filed.status !== 'submitted') throw new Error('not submitted');
    const deps = changeDeps(store, { members: [] });
    const tampered = { ...filed.request, requesterOid: g(66) };
    await approveRequest(deps, tampered, rowOf({ access: 'manage', isOwner: true }));
    expect(deps.sent).toEqual([`add:${REQUESTER.objectId}`]);
  });

  it('adds nobody when the directory names someone else for the request than the request does', async () => {
    const store = new MemoryUmStore({ groups: [managed] });
    await store.setSetting(SETTING_MEMBER_CHANGES, true);
    // Written from a browser: the object id of one person, the name and address of another.
    const forged = await store.createRequest(
      { groupId: GROUP, reason: 'I work on the sales reports.', rowVersion: 3, accessFingerprint: accessFingerprint(rowOf()) },
      { objectId: REQUESTER.objectId, userPrincipalName: 'carla.cfo@x.example', displayName: 'Carla CFO' }
    );
    const deps = changeDeps(store, { members: [] });
    const row = rowOf({ access: 'manage', isOwner: true });
    expect(await approveRequest(deps, forged, row)).toEqual({ status: 'refused', refusals: ['requester-mismatch'] });
    expect(deps.sent).toEqual([]);
    expect((await store.listRequests())[0].status).toBe('Pending');
    expect(sameRequester({ requesterUpn: 'Uwe@X.example', requesterName: 'Uwe User' }, { userPrincipalName: 'uwe@x.example', displayName: 'Uwe User' })).toBe(true);
    expect(sameRequester({ requesterUpn: 'uwe@x.example', requesterName: 'Carla CFO' }, { userPrincipalName: 'uwe@x.example', displayName: 'Uwe User' })).toBe(false);
    expect(sameRequester({ requesterUpn: 'uwe@x.example', requesterName: 'Uwe User' }, {})).toBe(false);
  });

  it('decides on the group as stored now, not as the page remembers it', async () => {
    const store = new MemoryUmStore({ groups: [managed] });
    await store.setSetting(SETTING_MEMBER_CHANGES, true);
    const filed = await submitRequest(requestDeps(store, null), rowOf(), { reason: 'I work on the sales reports.' }, today);
    if (filed.status !== 'submitted') throw new Error('not submitted');
    const row = rowOf({ access: 'manage', isOwner: true });
    // An admin closed the group for requests after the owner's page was loaded.
    await store.updateFields(managed, { requestable: false, description: '', maxDays: 30, active: true });
    const deps = changeDeps(store, { members: [] });
    expect(await approveRequest(deps, filed.request, row)).toEqual({ status: 'refused', refusals: ['group-changed'] });
    expect(deps.sent).toEqual([]);
  });

  it('tells the owners the directory names, and from stored addresses only those in the own domain', async () => {
    // Stored addresses are writable by everyone: an outside one is dropped.
    const store = new MemoryUmStore({ groups: [managed] });
    await store.setContact(GROUP, 'olivia@x.example;collector@evil.example');
    const sender = new MockNoticeSender();
    await submitRequest(requestDeps(store, sender), rowOf(), { reason: 'I work on the sales reports.' }, today);
    expect(sender.sent[0].to).toBe('olivia@x.example');
    expect(sameDomainOnly('a@evil.example', 'uwe@x.example')).toBe('');
    expect(sameDomainOnly('a@x.example', 'no-domain')).toBe('');

    // When the requester can read the owners, those are used and the table is not.
    const live = new MemoryUmStore({ groups: [managed] });
    await live.setContact(GROUP, 'stale@x.example');
    const liveSender = new MockNoticeSender();
    const directory = { listOwners: async () => ok([asMember(OWNER.objectId, { userPrincipalName: 'olivia@x.example' })]) };
    await submitRequest({ ...requestDeps(live, liveSender), directory }, rowOf(), { reason: 'I work on the sales reports.' }, today);
    expect(liveSender.sent[0].to).toBe('olivia@x.example');
  });

  it('denies with a note, withdraws only by the requester, and decides only once', async () => {
    const store = new MemoryUmStore({ groups: [managed] });
    const filed = await submitRequest(requestDeps(store, null), rowOf(), { reason: 'I work on the sales reports.' }, today);
    if (filed.status !== 'submitted') throw new Error('not submitted');
    const row = rowOf({ access: 'manage', isOwner: true });
    expect(await withdrawRequest({ store, actor: OWNER }, filed.request)).toBe(false);
    expect(await denyRequest({ store, actor: OWNER }, filed.request, row, ' not this quarter ')).toEqual({ status: 'denied' });
    expect((await store.listRequests())[0]).toMatchObject({ status: 'Denied', decisionNote: 'not this quarter' });
    expect(await denyRequest({ store, actor: OWNER }, filed.request, row, '')).toEqual({ status: 'refused', refusals: ['not-pending'] });
    expect(await withdrawRequest({ store, actor: REQUESTER }, filed.request)).toBe(false);
  });
});

function renderApp(
  persona: 'owner' | 'user',
  services = createUmServices({ mock: true, adminUserIds: [] }, `?as=${persona}`),
  locale: 'en' | 'de' = 'en'
) {
  const search = `?as=${persona}`;
  void services.store.setSetting(SETTING_MEMBER_CHANGES, true, 'test');
  render(
    <I18nProvider initialLocale={locale}>
      <AuthProvider authService={new OfflineAuthService(search)}>
        <MemoryRouter initialEntries={[`${UM_PATHS.workspaces}${search}`]}>
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

describe('requests in the views', () => {
  it('states the confirmation in German as one sentence', async () => {
    renderApp('user', undefined, 'de');
    await screen.findByRole('heading', { name: 'FAB-Sales-Viewer' });
    await userEvent.click(screen.getByRole('button', { name: 'Zugriff anfragen' }));
    const guide = screen.getByRole('link', { name: 'Power BI-Leitfaden (öffnet in einem neuen Tab)' });
    expect(guide.closest('p')).toHaveTextContent('Mit dem Senden dieser Anfrage bestätigen Sie, den Power BI-Leitfaden ↗ (öffnet in einem neuen Tab) gelesen zu haben.');
  });

  it('lets a user ask for a requestable group and withdraw again', async () => {
    const services = renderApp('user');
    await screen.findByRole('heading', { name: 'FAB-Sales-Viewer' });
    await userEvent.click(screen.getByRole('button', { name: 'Request access' }));
    // Sending is the confirmation: the form says so and links the guide in a tab of its own.
    const guide = screen.getByRole('link', { name: 'Power BI Guidelines (opens in a new tab)' });
    expect(guide.closest('p')).toHaveTextContent('By sending this request you confirm that you have read the Power BI Guidelines ↗ (opens in a new tab).');
    // The demo person travels with the link, or the new tab would open as somebody else.
    expect(guide).toHaveAttribute('href', `${UM_PATHS.guidelines}?as=user`);
    expect(guide).toHaveAttribute('target', '_blank');
    expect(guide).toHaveAttribute('rel', 'noreferrer');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Please give a reason of at least 10 characters.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Why do you need this access?'), 'I work on the sales reports.');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/Your request was sent\./)).toBeInTheDocument();
    await screen.findByText(/is waiting for an owner/);
    expect((await services.store.listRequests())[0]).toMatchObject({ status: 'Pending', reason: 'I work on the sales reports.' });

    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText('Your request was withdrawn.')).toBeInTheDocument();
    expect((await services.store.listRequests())[0].status).toBe('Withdrawn');
  }, 20_000);

  it('shows an owner the waiting request with a count on the tab, and adds the person on approval', async () => {
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=owner');
    const requester = { objectId: '11111111-0000-4000-8000-' + '000000000003', userPrincipalName: 'uwe.user@contoso.example', displayName: 'Uwe User' };
    const { groups, bindings } = await services.store.load();
    const viewer = groups.find((x) => x.nameSnapshot === 'FAB-Sales-Viewer')!;
    const row: RowView = { group: viewer, bindings: bindings.filter((b) => b.groupId === viewer.groupId), highRole: false, access: 'request-view', isOwner: false, isMember: false };
    await services.store.createRequest({ groupId: viewer.groupId, reason: 'I work on the sales reports.', rowVersion: viewer.version, accessFingerprint: accessFingerprint(row) }, requester);

    renderApp('owner', services);
    await screen.findByText('Requests waiting for a decision');
    expect(screen.getByTitle('1 requests waiting')).toHaveTextContent('1');
    expect(screen.getByText('I work on the sales reports.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve and add' }));
    await waitFor(async () => expect((await services.store.listRequests())[0].status).toBe('Approved'), { timeout: 5000 });
    await waitFor(() => expect(screen.queryByText('Requests waiting for a decision')).not.toBeInTheDocument());
    expect((await services.store.listAudit()).filter((e) => e.action === 'member-add').map((e) => e.outcome)).toEqual(['ok', 'pending']);
  }, 20_000);
});

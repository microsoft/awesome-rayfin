import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/hooks/AuthContext';
import { I18nProvider } from '@/i18n';
import { UmLayout } from '@/um/components/UmLayout';
import { buildDiscovery, directRecipients } from '@/um/domain/discovery';
import { UM_PATHS } from '@/um/domain/profile';
import { notReadable, ok, type ItemAccess } from '@/um/domain/types';
import { UmProvider } from '@/um/hooks/UmContext';
import { runDiscovery } from '@/um/services/discoveryRunner';
import { syncReadBindings } from '@/um/services/operations';
import { MemoryUmStore } from '@/um/services/store';
import { FABRIC_API_ORIGIN, parseRequest, pathFor, runFabricOp } from '@/um/services/fabricOps';
import { OpFabricGateway } from '@/um/services/gateways';
import { MOCK_ADMIN_GROUP_ID, MockDirectoryGateway, MockFabricGateway } from '@/um/services/mock';
import { OfflineAuthService } from '@/um/services/offlineAuth';
import { createUmServices } from '@/um/services/services';
import { umRouteElements } from '@/um/UmRoutes';

vi.mock('@/um/services/excelClient', () => ({ readSheet: vi.fn(), writeSheet: vi.fn(async () => new Blob()), downloadBlob: vi.fn() }));

const g = (n: number) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WS = g(1);
const ITEM = g(2);
const TOKEN = 'header.payload.signature';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const entry = (id: string, type: ItemAccess['principalType'], name = '', permissions = ['Read']): ItemAccess => ({ principalId: id, principalType: type, principalName: name, permissions });

/** Workspace and audience discovery from the browser, with the caller's own token. */
describe('item access operation', () => {
  it('is a fixed administrator path built from two validated ids', () => {
    expect(parseRequest({ op: 'listItemAccess', workspaceId: WS, itemId: ITEM })).toEqual({ op: 'listItemAccess', workspaceId: WS, itemId: ITEM });
    expect(pathFor({ op: 'listItemAccess', workspaceId: WS, itemId: ITEM })).toBe(`/v1/admin/workspaces/${WS}/items/${ITEM}/users`);
    expect(parseRequest({ op: 'listItemAccess', workspaceId: WS, itemId: `${ITEM}/../..` })).toBeNull();
    expect(parseRequest({ op: 'listItemAccess', workspaceId: WS })).toBeNull();
    expect(parseRequest({ op: 'listItemAccess', workspaceId: WS, itemId: ITEM, userId: g(9) })).toBeNull();
  });

  it('reads the access list with GET and keeps repeated principals', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      json({
        accessDetails: [
          { principal: { id: g(10), type: 'Group', displayName: 'Readers' }, itemAccessDetails: { type: 'OrgAppAudience', permissions: ['Read'], additionalPermissions: [] } },
          { principal: { id: g(10), type: 'Group', displayName: 'Readers' }, itemAccessDetails: { type: 'OrgAppAudience', permissions: ['Read', 'ReShare'], additionalPermissions: ['Extra'] } },
        ],
      })
    );
    const result = await runFabricOp(TOKEN, { op: 'listItemAccess', workspaceId: WS, itemId: ITEM }, fetcher as never);
    expect(result).toMatchObject({ ok: true, value: [{ principalId: g(10), permissions: ['Read'] }, { principalId: g(10), permissions: ['Read', 'ReShare', 'Extra'] }] });
    expect(fetcher.mock.calls[0][0]).toBe(`${FABRIC_API_ORIGIN}/v1/admin/workspaces/${WS}/items/${ITEM}/users`);
    expect(fetcher.mock.calls[0][1].method).toBe('GET');
  });

  it('rejects a malformed access list and reports a refusal as access denied', async () => {
    const run = (body: unknown, status = 200) => runFabricOp(TOKEN, { op: 'listItemAccess', workspaceId: WS, itemId: ITEM }, (async () => json(body, status)) as never);
    expect(await run({ value: [] })).toEqual({ ok: false, code: 'INVALID_RESPONSE' });
    expect(await run({ accessDetails: [{ principal: { id: 'x', type: 'Group' }, itemAccessDetails: {} }] })).toEqual({ ok: false, code: 'INVALID_RESPONSE' });
    expect(await run({}, 403)).toEqual({ ok: false, code: 'ACCESS_DENIED' });
    expect(await run({}, 429)).toEqual({ ok: false, code: 'RATE_LIMITED' });
  });
});

describe('gateway without a token', () => {
  it('reports "not readable, sign-in" instead of an empty list', async () => {
    const gateway = new OpFabricGateway((request) => runFabricOp(undefined, request));
    expect(await gateway.listWorkspaces()).toEqual(notReadable('access-denied', 'sign-in'));
    expect(await gateway.listItemAccess(WS, ITEM)).toEqual(notReadable('access-denied', 'sign-in'));
  });
});

describe('who an audience is shared with', () => {
  const roles = new Set([g(20), g(21)]);

  it('counts one entry of a workspace role holder as inherited and everything else as a direct share', () => {
    const access = [entry(g(20), 'User'), entry(g(21), 'Group'), entry(g(21), 'Group'), entry(g(30), 'Group'), entry(g(31), 'User'), entry(g(30), 'Group')];
    expect(directRecipients(access, roles).map((e) => e.principalId)).toEqual([g(21), g(30), g(31)]);
    expect(directRecipients([entry(g(20), 'User')], roles)).toEqual([]);
  });

  const audience = { id: ITEM, displayName: 'Management', type: 'OrgAppAudience', workspaceId: WS };
  const base = {
    observedAt: 'now',
    workspaces: ok([{ id: WS, displayName: 'Sales' }]),
    groups: {},
    appAdminIds: ok<string[]>([]),
  };

  it('turns a shared group into a read binding and a shared person into a finding', () => {
    const result = buildDiscovery({
      ...base,
      perWorkspace: [
        {
          workspace: { id: WS, displayName: 'Sales' },
          roleAssignments: ok([{ id: g(40), principalId: g(20), principalType: 'User', role: 'Admin' }]),
          orgApps: ok([]),
          audiences: ok([audience]),
          models: ok([]),
          audienceAccess: { [ITEM]: ok([entry(g(20), 'User'), entry(g(30), 'Group', 'APP-Management'), entry(g(31), 'User', 'Ben')]) },
        },
      ],
    });
    expect(result.bindings).toEqual([{ groupId: g(30), kind: 'Audience', scopeId: ITEM, scopeName: 'Sales', label: 'Management', provenance: 'inferred' }]);
    expect(result.findings).toContainEqual({ type: 'audience-direct', workspaceName: 'Sales', audience: 'Management', principalName: 'Ben' });
    expect(result.coverage).toMatchObject({ audiencesRead: 1, audiencesNotReadable: 0 });
  });

  it('derives nothing when the access list or the workspace roles could not be read', () => {
    const ws = { workspace: { id: WS, displayName: 'Sales' }, orgApps: ok([]), audiences: ok([audience]), models: ok([]) };
    const noAccess = buildDiscovery({ ...base, perWorkspace: [{ ...ws, roleAssignments: ok([]), audienceAccess: { [ITEM]: notReadable('access-denied') } }] });
    expect(noAccess.bindings).toEqual([]);
    expect(noAccess.coverage).toMatchObject({ audiencesRead: 0, audiencesNotReadable: 1 });
    // Without the roles, everyone in the list would look like a direct share.
    const noRoles = buildDiscovery({ ...base, perWorkspace: [{ ...ws, roleAssignments: notReadable('access-denied'), audienceAccess: { [ITEM]: ok([entry(g(30), 'Group')]) } }] });
    expect(noRoles.bindings).toEqual([]);
    expect(noRoles.coverage.audiencesNotReadable).toBe(1);
  });

  it('reads recipients only on request', async () => {
    const fabric = new MockFabricGateway();
    const spy = vi.spyOn(fabric, 'listItemAccess');
    const plain = await runDiscovery(fabric, new MockDirectoryGateway('admin'), { adminGroupId: MOCK_ADMIN_GROUP_ID });
    expect(spy).not.toHaveBeenCalled();
    expect(plain.bindings.some((b) => b.kind === 'Audience')).toBe(false);

    const withSharing = await runDiscovery(fabric, new MockDirectoryGateway('admin'), { adminGroupId: MOCK_ADMIN_GROUP_ID, audienceRecipients: true });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(withSharing.bindings.filter((b) => b.kind === 'Audience').map((b) => b.label)).toEqual(['Management']);
    expect(withSharing.groups.find((x) => x.name === 'APP-Sales-Management')?.eligible).toBe(true);
    expect(withSharing.findings.some((f) => f.type === 'audience-direct' && f.principalName === 'Ben Berater')).toBe(true);
  });
});

describe('stored audience sharing of activated groups', () => {
  const actor = { objectId: g(90), userPrincipalName: 'admin@x.example', displayName: 'Admin' };
  const audience = { id: ITEM, displayName: 'Management', type: 'OrgAppAudience', workspaceId: WS };
  const role = { id: g(40), principalId: g(20), principalType: 'User' as const, role: 'Admin' };
  const ws = { workspace: { id: WS, displayName: 'Sales' }, roleAssignments: ok([role]), orgApps: ok([]), audiences: ok([audience]), models: ok([]) };
  const input = { observedAt: 'now', workspaces: ok([{ id: WS, displayName: 'Sales' }]), groups: {}, appAdminIds: ok<string[]>([]) };
  const group = {
    id: g(70), groupId: g(30), nameSnapshot: 'APP-Management', requestable: false, description: '', maxDays: 0, active: true, version: 1,
    activatedByOid: g(90), activatedByUpn: 'admin@x.example', activatedAt: 'now', updatedAt: 'now',
  };

  it('is stored when read, kept when not asked for, and removed when the share is gone', async () => {
    const store = new MemoryUmStore({ groups: [group] });
    const shared = buildDiscovery({ ...input, perWorkspace: [{ ...ws, audienceAccess: { [ITEM]: ok([entry(g(20), 'User'), entry(g(30), 'Group')]) } }] });
    await syncReadBindings({ store, actor }, [group], [], shared);
    expect((await store.load()).bindings).toEqual([{ groupId: g(30), kind: 'Audience', scopeId: ITEM, scopeName: 'Sales', label: 'Management', provenance: 'inferred' }]);

    // A discovery that did not read sharing must not drop it, nor store it twice.
    const plain = buildDiscovery({ ...input, perWorkspace: [ws] });
    expect(await syncReadBindings({ store, actor }, [group], (await store.load()).bindings, plain)).toBe(0);
    expect(await syncReadBindings({ store, actor }, [group], (await store.load()).bindings, shared)).toBe(0);
    expect((await store.load()).bindings).toHaveLength(1);

    // Sharing was read again and the group is no longer in the list.
    const revoked = buildDiscovery({ ...input, perWorkspace: [{ ...ws, audienceAccess: { [ITEM]: ok([entry(g(20), 'User')]) } }] });
    expect(await syncReadBindings({ store, actor }, [group], (await store.load()).bindings, revoked)).toBe(1);
    expect((await store.load()).bindings).toEqual([]);
  });

  it('counts audiences left out by the bound', async () => {
    const fabric = new MockFabricGateway();
    const result = await runDiscovery(fabric, new MockDirectoryGateway('admin'), { adminGroupId: MOCK_ADMIN_GROUP_ID, audienceRecipients: true });
    expect(result.coverage.audiencesSkipped).toBe(0);
    expect(buildDiscovery({ ...input, perWorkspace: [ws], audiencesSkipped: 7 }).coverage.audiencesSkipped).toBe(7);
  });
});

describe('Audiences tab for an app admin', () => {
  it('lists audiences first and shows sharing only after it was read', async () => {
    const search = '?as=admin';
    render(
      <I18nProvider initialLocale="en">
        <AuthProvider authService={new OfflineAuthService(search)}>
          <MemoryRouter initialEntries={[UM_PATHS.audiences]}>
            <UmProvider services={createUmServices({ mock: true, adminUserIds: [] }, search)}>
              <Routes>
                <Route element={<UmLayout />}>{umRouteElements()}</Route>
              </Routes>
            </UmProvider>
          </MemoryRouter>
        </AuthProvider>
      </I18nProvider>
    );
    await waitFor(() => expect(screen.getAllByText('Sharing not read yet.').length).toBe(2));
    await userEvent.click(screen.getByRole('button', { name: 'Read who audiences are shared with' }));
    await waitFor(() => expect(screen.getByText('Sharing read for 2 audiences, not readable for 0.')).toBeInTheDocument());

    // The audience appears in the item list and in the sharing table; the sharing table comes last.
    const management = screen.getAllByRole('row').filter((r) => within(r).queryAllByRole('cell')[1]?.textContent === 'Management').pop()!;
    expect(within(management).getByText('APP-Sales-Management')).toBeInTheDocument();
    expect(within(management).getByText('Activated')).toBeInTheDocument();
    const allSales = screen.getAllByRole('row').filter((r) => within(r).queryAllByRole('cell')[1]?.textContent === 'All Sales').pop()!;
    expect(within(allSales).getByText('Not shared with a group beyond the workspace roles.')).toBeInTheDocument();
    // The group now also carries a binding that was read, next to the recorded one.
    expect(screen.getByText('Audience: Sales Reporting / Management · derived, not stated by Fabric')).toBeInTheDocument();
  });
});

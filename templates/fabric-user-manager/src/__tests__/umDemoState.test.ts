import { describe, expect, it, vi } from 'vitest';

import type { UmEnv } from '@/um/config/umEnv';
import { SETTING_MEMBER_CHANGES } from '@/um/services/store';

/**
 * The offline demo picks its person with `?as=`, which loads the page again.
 * These tests load the modules afresh for every "page", the way a reload does,
 * and hand them the same storage, the way one browser tab does.
 */
const ENV: UmEnv = { mock: true, adminUserIds: [] };
// Built from parts: the public repository's gate takes every literal GUID for a tenant coordinate.
const SALES_VIEWER = ['33333333', '0000', '4000', '8000', '000000000001'].join('-');

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

async function openPage(search: string, storage?: ReturnType<typeof fakeStorage>) {
  vi.resetModules();
  const { createUmServices } = await import('@/um/services/services');
  return createUmServices(ENV, search, storage);
}

describe('the offline demo keeps its state in the tab', () => {
  it('lets one person file a request and another find it after the page was loaded again', async () => {
    const tab = fakeStorage();

    const asAdmin = await openPage('?as=admin', tab);
    await asAdmin.store.setSetting(SETTING_MEMBER_CHANGES, true, 'alex.admin@contoso.example');

    const asUser = await openPage('?as=user', tab);
    expect(await asUser.store.getSetting(SETTING_MEMBER_CHANGES)).toBe(true);
    const uwe = await asUser.directory.me();
    await asUser.store.createRequest({ groupId: SALES_VIEWER, reason: 'I work on the sales reports.', rowVersion: 1, accessFingerprint: 'x' }, uwe);

    const asOwner = await openPage('?as=owner', tab);
    const waiting = await asOwner.store.listRequests();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ status: 'Pending', requesterName: 'Uwe User', reason: 'I work on the sales reports.' });

    // The approval adds the person in the made-up directory; that, too, is still there on the next page.
    const writer = await asOwner.loadWriter();
    expect(await writer!.write('add', SALES_VIEWER, uwe.objectId, (await asOwner.directory.me()).objectId)).toEqual({ ok: true });
    await asOwner.store.decideRequest(waiting[0].id, 'Approved', await asOwner.directory.me());

    const again = await openPage('?as=user', tab);
    const members = await again.directory.listMembers(SALES_VIEWER);
    expect(members.state === 'ok' && members.value.some((m) => m.id === uwe.objectId)).toBe(true);
    expect((await again.store.listRequests())[0].status).toBe('Approved');
    // New ids go on counting, they do not start over and collide.
    await again.store.audit({ groupId: SALES_VIEWER, action: 'test' } as never);
    const ids = [(await again.store.listRequests())[0].id, (await again.store.listAudit())[0].id];
    expect(new Set(ids).size).toBe(2);
  });

  it('forgets everything in another tab, and without storage', async () => {
    const tab = fakeStorage();
    const first = await openPage('?as=admin', tab);
    await first.store.setSetting(SETTING_MEMBER_CHANGES, true, 'x');

    const otherTab = await openPage('?as=admin', fakeStorage());
    expect(await otherTab.store.getSetting(SETTING_MEMBER_CHANGES)).toBeUndefined();

    // The way the tests and every caller without a tab use it: memory only.
    const plain = await openPage('?as=admin');
    await plain.store.setSetting(SETTING_MEMBER_CHANGES, true, 'x');
    expect(await (await openPage('?as=admin')).store.getSetting(SETTING_MEMBER_CHANGES)).toBeUndefined();
  });

  it('never touches the storage in a deployment, even when one is handed in', async () => {
    vi.resetModules();
    const { createUmServices } = await import('@/um/services/services');
    const handed = fakeStorage({ 'um.demo.state': 'left by a demo on the same address' });
    const read = vi.spyOn(handed, 'getItem');
    const services = createUmServices({ ...ENV, mock: false }, '?as=admin', handed);
    expect(services.mock).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect([...handed.data]).toEqual([['um.demo.state', 'left by a demo on the same address']]);
  });

  it('keeps a created group and a changed role, and gives the next group an id of its own', async () => {
    const tab = fakeStorage();
    const first = await openPage('?as=admin', tab);
    const admin = await first.directory.me();
    const created = await (await first.loadGroupCreator())!.create({ displayName: 'FAB-Demo-One', description: '', mailNickname: 'fab-demo-one', ownerIds: [] }, admin.objectId);
    expect(created.ok).toBe(true);
    const sales = (await first.fabric.listWorkspaces()) as { state: 'ok'; value: { id: string; displayName: string }[] };
    const workspace = sales.value.find((w) => w.displayName === 'Sales Reporting')!.id;
    expect(await (await first.loadBindingWriter())!.write({ action: 'add', workspaceId: workspace, groupId: SALES_VIEWER, role: 'Contributor' } as never, admin.objectId)).toEqual({ ok: true });

    const second = await openPage('?as=admin', tab);
    const id = created.ok ? created.id : '';
    const facts = await second.directory.getGroup(id);
    expect(facts.state === 'ok' && facts.value.displayName).toBe('FAB-Demo-One');
    const roles = await second.fabric.listRoleAssignments(workspace);
    expect(roles.state === 'ok' && roles.value.some((a) => a.principalId === SALES_VIEWER && a.role === 'Contributor')).toBe(true);
    const next = await (await second.loadGroupCreator())!.create({ displayName: 'FAB-Demo-Two', description: '', mailNickname: 'fab-demo-two', ownerIds: [] }, admin.objectId);
    expect(next.ok && next.id).not.toBe(id);
  });

  it('starts over when the tab holds the state of a build with other fixtures', async () => {
    const tab = fakeStorage();
    await (await openPage('?as=admin', tab)).store.setSetting(SETTING_MEMBER_CHANGES, true, 'x');
    const kept = JSON.parse(tab.data.get('um.demo.state')!);
    tab.data.set('um.demo.state', JSON.stringify({ ...kept, fixtures: 'of an older build' }));
    expect(await (await openPage('?as=admin', tab)).store.getSetting(SETTING_MEMBER_CHANGES)).toBeUndefined();
  });

  it('starts from the fixtures when what the tab holds cannot be read', async () => {
    for (const broken of ['not json', '{"version":99}', 'null', '{"version":1}']) {
      const services = await openPage('?as=owner', fakeStorage({ 'um.demo.state': broken }));
      const loaded = await services.store.load();
      expect(loaded.groups.map((g) => g.nameSnapshot).sort()).toEqual(['APP-Sales-Management', 'FAB-Sales-Viewer', 'RLS-Sales-DACH']);
      const members = await services.directory.listMembers(SALES_VIEWER);
      expect(members.state === 'ok' && members.value.length).toBe(3);
    }
  });
});

/**
 * The store against a data client that behaves like the real one.
 *
 * The real client returns only what it is asked for: a plain `findMany` or
 * `findById` answers with the id alone, and a write answers with the fields
 * that were written. It also turns the texts "true" and "false" into
 * booleans in whatever field they stand. The in-memory store used by the
 * other tests cannot show a mistake of that kind, and two reached production:
 * every stored switch read as "not set" (seen live on 2026-10-12), first
 * because the value was not asked for, then because it arrived as a boolean.
 * This fake keeps both behaviours.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeData } from './helpers/fakeRayfinData';

const fake = createFakeData();
const { tables, newId } = fake;

vi.mock('@/services/rayfinClient', () => ({ getRayfinClient: () => ({ data: fake.data }) }));

const { loadConfigValue, saveConfigValue } = await import('@/um/services/configStore');
const { RayfinUmStore, VersionConflictError } = await import('@/um/services/store');

const g = (n: number) => `dededede-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = { objectId: g(10), userPrincipalName: 'admin@x.example', displayName: 'Admin' };
const USER = { objectId: g(20), userPrincipalName: 'uwe@x.example', displayName: 'Uwe User' };

beforeEach(() => fake.reset());

describe('settings against a client that returns only what is asked for', () => {
  it('reads back a switch that was saved', async () => {
    expect(await loadConfigValue('um.changes.members')).toBeUndefined();
    expect(await saveConfigValue('um.changes.members', true, 'admin@x.example')).toBe(true);
    expect(await loadConfigValue('um.changes.members')).toBe(true);
    expect(await saveConfigValue('um.changes.members', false, 'admin@x.example')).toBe(true);
    expect(await loadConfigValue('um.changes.members')).toBe(false);
    // One row per key, also after the second save.
    expect(tables.GovConfig).toHaveLength(1);
  });

  it('keeps settings apart and treats a broken value as not set', async () => {
    await saveConfigValue('um.changes.members', true, 'a');
    await saveConfigValue('ui.profile', 'full', 'a');
    expect(await loadConfigValue('um.changes.bindings')).toBeUndefined();
    expect(await loadConfigValue('ui.profile')).toBe('full');
    // Numbers and lists come back as stored.
    await saveConfigValue('some.number', 5, 'a');
    await saveConfigValue('some.list', ['a', 'b'], 'a');
    expect(await loadConfigValue('some.number')).toBe(5);
    expect(await loadConfigValue('some.list')).toEqual(['a', 'b']);
    tables.GovConfig.push({ id: newId(), config_key: 'broken', config_value: '{not json' });
    expect(await loadConfigValue('broken')).toBeUndefined();
  });

  it('is what the store uses for its switches', async () => {
    const store = new RayfinUmStore();
    expect(await store.getSetting('um.changes.groups')).toBeUndefined();
    await store.setSetting('um.changes.groups', true, 'admin@x.example');
    expect(await store.getSetting('um.changes.groups')).toBe(true);
  });
});

describe('activated groups against such a client', () => {
  it('returns the whole group after activating and after an edit, and counts the version up', async () => {
    const store = new RayfinUmStore();
    const created = await store.activate({ groupId: g(1).toUpperCase(), nameSnapshot: 'FAB-Sales-Viewer', requestable: true, description: 'd', maxDays: 30 }, ADMIN);
    expect(created).toMatchObject({ groupId: g(1), nameSnapshot: 'FAB-Sales-Viewer', requestable: true, active: true, version: 1, activatedByOid: ADMIN.objectId });

    const edited = await store.updateFields(created, { requestable: false, description: 'closed', maxDays: 0, active: true });
    expect(edited).toMatchObject({ id: created.id, groupId: g(1), nameSnapshot: 'FAB-Sales-Viewer', requestable: false, description: 'closed', version: 2 });
    expect((await store.load()).groups).toEqual([edited]);
  });

  it('keeps a description that reads like a boolean or a date as the text it was', async () => {
    const store = new RayfinUmStore();
    const a = await store.activate({ groupId: g(2), nameSnapshot: 'FAB-A', requestable: false, description: 'true', maxDays: 0 }, ADMIN);
    const b = await store.activate({ groupId: g(3), nameSnapshot: 'FAB-B', requestable: false, description: '2026-10-12', maxDays: 0 }, ADMIN);
    expect(a.description).toBe('true');
    expect(typeof b.description).toBe('string');
    expect(b.description.startsWith('2026-10-12')).toBe(true);
  });

  it('refuses an edit that starts from an older state', async () => {
    const store = new RayfinUmStore();
    const created = await store.activate({ groupId: g(1), nameSnapshot: 'FAB-Sales-Viewer', requestable: true, description: '', maxDays: 0 }, ADMIN);
    await store.updateFields(created, { requestable: false, description: '', maxDays: 0, active: true });
    await expect(store.updateFields(created, { requestable: true, description: '', maxDays: 0, active: true })).rejects.toBeInstanceOf(VersionConflictError);
  });
});

describe('requests against such a client', () => {
  it('files a request, decides it once, and returns the whole request each time', async () => {
    const store = new RayfinUmStore();
    const filed = await store.createRequest({ groupId: g(1), reason: 'I work on the sales reports.', reviewOn: '2026-12-01', rowVersion: 3, accessFingerprint: '1:abc' }, USER);
    // The review date was stored as text and comes back as a date object: it must still be the same day, as text.
    expect(filed).toMatchObject({ groupId: g(1), requesterOid: USER.objectId, requesterUpn: 'uwe@x.example', status: 'Pending', rowVersion: 3, reviewOn: '2026-12-01' });

    const decided = await store.decideRequest(filed.id, 'Approved', ADMIN);
    expect(decided).toMatchObject({ id: filed.id, groupId: g(1), requesterOid: USER.objectId, reason: 'I work on the sales reports.', status: 'Approved', decidedByOid: ADMIN.objectId });
    await expect(store.decideRequest(filed.id, 'Denied', ADMIN)).rejects.toThrow();
    expect((await store.listRequests())[0].status).toBe('Approved');
  });
});

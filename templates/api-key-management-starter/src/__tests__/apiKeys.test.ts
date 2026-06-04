import { beforeEach, describe, expect, it, vi } from 'vitest';

let store: Array<Record<string, unknown>> = [];

const mockClient = {
  data: {
    ApiKey: {
      select: () => ({
        orderBy: () => ({
          execute: vi.fn(async () => [...store]),
        }),
      }),
      create: vi.fn(async (data: Record<string, unknown>) => {
        const item = { ...data, id: crypto.randomUUID() };
        store.push(item);
        return item;
      }),
      update: vi.fn(async (where: { id: string }, updates: Record<string, unknown>) => {
        const item = store.find((entry) => entry.id === where.id);
        if (item) Object.assign(item, updates);
      }),
    },
  },
  auth: {
    getSession: () => ({
      isAuthenticated: true,
      user: { id: 'user-1', email: 'dev@contoso.com' },
    }),
  },
};

vi.mock('@/services/rayfinClient', () => ({
  getRayfinClient: () => mockClient,
}));

vi.mock('@/services/keyGenerator', () => ({
  generateApiKey: () => ({
    rawKey: 'rk_live_demo_public_demo_secret',
    prefix: 'rk_live_demo',
    publicId: 'demo',
  }),
}));

vi.mock('@/services/keyHashing', () => ({
  hashApiKey: async () => 'hashed-key',
}));

import { createApiKey, getApiKeys, revokeApiKey } from '@/services/apiKeys';

describe('apiKeys service', () => {
  beforeEach(() => {
    store = [];
  });

  it('creates, lists, and revokes keys', async () => {
    expect(await getApiKeys()).toEqual([]);

    const created = await createApiKey('demo');
    expect(created.rawKey).toContain('rk_live_demo');
    expect(created.record.label).toBe('demo');

    const list = await getApiKeys();
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe('active');

    await revokeApiKey(list[0]?.id as string);
    const revoked = await getApiKeys();
    expect(revoked[0]?.status).toBe('revoked');
  });
});

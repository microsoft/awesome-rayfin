import { describe, expect, it, vi, beforeEach } from 'vitest';

// In-memory store used by the mock client
let store: Array<Record<string, unknown>> = [];

const mockClient = {
  data: {
    Todo: {
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
      update: vi.fn(
        async (
          where: { id: string },
          updates: Record<string, unknown>
        ) => {
          const item = store.find((t) => t.id === where.id);
          if (item) Object.assign(item, updates);
        }
      ),
      findById: vi.fn(async (id: string) => store.find((t) => t.id === id)),
      delete: vi.fn(async (where: { id: string }) => {
        store = store.filter((t) => t.id !== where.id);
      }),
    },
  },
  auth: {
    getSession: () => ({
      isAuthenticated: true,
      user: { id: 'u1', email: 'dev@contoso.com' },
    }),
  },
};

vi.mock('@/services/rayfinClient', () => ({
  getRayfinClient: () => mockClient,
}));

import { createTodo, deleteTodo, getTodos, updateTodo } from '@/services/todos';

describe('todos service', () => {
  beforeEach(() => {
    store = [];
  });

  it('creates, lists, updates, and deletes todos', async () => {
    expect(await getTodos()).toEqual([]);

    const created = await createTodo('write tests');
    expect(created.title).toBe('write tests');
    expect(created.isCompleted).toBe(false);

    const list = await getTodos();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);

    await updateTodo(created.id, { isCompleted: true });
    const updated = await getTodos();
    expect(updated[0]?.isCompleted).toBe(true);

    await deleteTodo(created.id);
    expect(await getTodos()).toEqual([]);
  });
});

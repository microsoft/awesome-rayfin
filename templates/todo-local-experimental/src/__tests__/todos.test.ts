import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/rayfinClient', () => ({
  isLocalBackend: () => true,
  getRayfinClient: vi.fn(),
}));

import { createTodo, deleteTodo, getTodos, updateTodo } from '@/services/todos';

describe('todos service (in-memory mode)', () => {
  beforeEach(async () => {
    // Drain any in-memory state left over from a previous test.
    for (const todo of await getTodos()) {
      await deleteTodo(todo.id);
    }
  });

  it('creates, lists, updates, and deletes todos', async () => {
    expect(await getTodos()).toEqual([]);

    const created = await createTodo('write tests');
    expect(created.title).toBe('write tests');
    expect(created.isCompleted).toBe(false);

    const list = await getTodos();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);

    const updated = await updateTodo(created.id, { isCompleted: true });
    expect(updated.isCompleted).toBe(true);

    await deleteTodo(created.id);
    expect(await getTodos()).toEqual([]);
  });
});

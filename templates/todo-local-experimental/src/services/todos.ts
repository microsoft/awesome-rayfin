import { AuthError } from '@microsoft/rayfin-client';

import { getGlobalSessionExpiredHandler } from '@/hooks/AuthContext';

import { getRayfinClient } from './rayfinClient';

export interface TodoItem {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt: Date;
}

/** Re-throw the error after triggering session expiry if it's an auth error. */
function handleError(err: unknown): never {
  const isAuthError =
    err instanceof AuthError ||
    (err instanceof Error && 'status' in err && (err as { status: number }).status === 401);

  if (isAuthError) {
    const handler = getGlobalSessionExpiredHandler();
    if (handler) handler();
  }
  throw err;
}

export async function getTodos(): Promise<TodoItem[]> {
  try {
    const client = getRayfinClient();
    const results = await client.data.Todo.select([
      'id',
      'title',
      'isCompleted',
      'createdAt',
    ])
      .orderBy({ createdAt: 'desc' })
      .execute();
    return results as TodoItem[];
  } catch (err) {
    handleError(err);
  }
}

export async function createTodo(title: string): Promise<TodoItem> {
  try {
    const client = getRayfinClient();
    const session = client.auth.getSession();
    if (!session.isAuthenticated || !session.user) {
      throw new Error('Cannot create todo: user is not authenticated.');
    }
    const todo = await client.data.Todo.create({
      title,
      isCompleted: false,
      createdAt: new Date(),
      user_id: session.user.id,
    });
    return todo as TodoItem;
  } catch (err) {
    handleError(err);
  }
}

export async function updateTodo(
  id: string,
  updates: Partial<Pick<TodoItem, 'title' | 'isCompleted'>>
): Promise<TodoItem> {
  try {
    const client = getRayfinClient();
    await client.data.Todo.update({ id }, updates);
    const todo = await client.data.Todo.findById(id);
    return todo as TodoItem;
  } catch (err) {
    handleError(err);
  }
}

export async function deleteTodo(id: string): Promise<void> {
  try {
    const client = getRayfinClient();
    await client.data.Todo.delete({ id });
  } catch (err) {
    handleError(err);
  }
}

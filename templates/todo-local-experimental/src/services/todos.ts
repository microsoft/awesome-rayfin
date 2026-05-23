import { getRayfinClient } from './rayfinClient';

export interface TodoItem {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt: Date;
}

export async function getTodos(): Promise<TodoItem[]> {
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
}

export async function createTodo(title: string): Promise<TodoItem> {
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
}

export async function updateTodo(
  id: string,
  updates: Partial<Pick<TodoItem, 'title' | 'isCompleted'>>
): Promise<TodoItem> {
  const client = getRayfinClient();
  await client.data.Todo.update({ id }, updates);
  const todo = await client.data.Todo.findById(id);
  return todo as TodoItem;
}

export async function deleteTodo(id: string): Promise<void> {
  const client = getRayfinClient();
  await client.data.Todo.delete({ id });
}

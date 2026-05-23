import { getRayfinClient, isLocalBackend } from './rayfinClient';

export interface TodoItem {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt: Date;
}

// Local-dev fallback: when no Fabric backend is configured, keep todos in
// memory so the sample is fully functional without a database.
let inMemoryTodos: TodoItem[] = [];

export async function getTodos(): Promise<TodoItem[]> {
  if (isLocalBackend()) {
    return [...inMemoryTodos].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

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
  if (isLocalBackend()) {
    const todo: TodoItem = {
      id: crypto.randomUUID(),
      title,
      isCompleted: false,
      createdAt: new Date(),
    };
    inMemoryTodos.push(todo);
    return todo;
  }

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
  if (isLocalBackend()) {
    const todo = inMemoryTodos.find((t) => t.id === id);
    if (!todo) throw new Error('Todo not found');
    Object.assign(todo, updates);
    return { ...todo };
  }

  const client = getRayfinClient();
  await client.data.Todo.update({ id }, updates);
  const todo = await client.data.Todo.findById(id);
  return todo as TodoItem;
}

export async function deleteTodo(id: string): Promise<void> {
  if (isLocalBackend()) {
    inMemoryTodos = inMemoryTodos.filter((t) => t.id !== id);
    return;
  }

  const client = getRayfinClient();
  await client.data.Todo.delete({ id });
}

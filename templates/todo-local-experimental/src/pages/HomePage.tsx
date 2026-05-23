import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/AuthContext';
import {
  createTodo,
  deleteTodo,
  getTodos,
  updateTodo,
  type TodoItem,
} from '@/services/todos';

export function HomePage() {
  const { signOut, user } = useAuth();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchTodos = useCallback(async () => {
    const data = await getTodos();
    setTodos(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchTodos();
  }, [fetchTodos]);

  const handleAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTodoTitle.trim();
    if (!title) return;
    setNewTodoTitle('');
    await createTodo(title);
    await fetchTodos();
  };

  const handleToggle = async (id: string, isCompleted: boolean) => {
    await updateTodo(id, { isCompleted: !isCompleted });
    await fetchTodos();
  };

  const handleDelete = async (id: string) => {
    await deleteTodo(id);
    await fetchTodos();
  };

  const pending = todos.filter((t) => !t.isCompleted);
  const completed = todos.filter((t) => t.isCompleted);

  return (
    <div className="bg-gray-50 min-h-screen">
      <header className="flex items-center justify-between px-8 py-5 bg-white border-b border-gray-200">
        <h1 className="text-xl font-bold text-gray-900">Todo App</h1>
        <div className="flex items-center gap-4">
          {user?.email && (
            <span className="text-sm text-gray-600" title={user.email}>
              {user.email}
            </span>
          )}
          <button
            onClick={() => void signOut()}
            className="text-gray-400 hover:text-gray-600 transition-colors text-sm"
            aria-label="Sign out"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-10">
        <form
          onSubmit={(e) => void handleAddTodo(e)}
          className="flex gap-3 mb-8"
        >
          <input
            type="text"
            value={newTodoTitle}
            onChange={(e) => setNewTodoTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!newTodoTitle.trim()}
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-40"
          >
            Add
          </button>
        </form>

        {loading ? (
          <p className="text-center text-gray-400 text-sm">Loading...</p>
        ) : todos.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">
              No todos yet. Add one above!
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {pending.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                  To Do ({pending.length})
                </h2>
                <ul className="space-y-2">
                  {pending.map((todo) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  ))}
                </ul>
              </section>
            )}

            {completed.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                  Completed ({completed.length})
                </h2>
                <ul className="space-y-2">
                  {completed.map((todo) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function TodoRow({
  todo,
  onToggle,
  onDelete,
}: {
  todo: TodoItem;
  onToggle: (id: string, isCompleted: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <li className="group flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm border border-gray-100">
      <button
        onClick={() => onToggle(todo.id, todo.isCompleted)}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          todo.isCompleted
            ? 'border-blue-500 bg-blue-500 text-white'
            : 'border-gray-300 hover:border-blue-400'
        }`}
        aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
      >
        {todo.isCompleted && (
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </button>
      <span
        className={`flex-1 text-sm ${
          todo.isCompleted ? 'text-gray-400 line-through' : 'text-gray-900'
        }`}
      >
        {todo.title}
      </span>
      <button
        onClick={() => onDelete(todo.id)}
        className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
        aria-label="Delete todo"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </li>
  );
}

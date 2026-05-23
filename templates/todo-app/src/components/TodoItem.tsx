import { Todo } from '../../rayfin/data/Todo';

import { CategoryBadge } from './CategoryBadge';

interface TodoItemProps {
  todo: Todo;
  onUpdate: (
    id: string,
    updates: Partial<Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>>
  ) => Promise<Todo>;
  onDelete: (id: string) => Promise<void>;
}

export function TodoItem({ todo, onUpdate, onDelete }: TodoItemProps) {
  const handleToggleComplete = () => {
    onUpdate(todo.id, { isCompleted: !todo.isCompleted });
  };

  const handleDelete = () => {
    onDelete(todo.id);
  };

  const priorityColors = {
    low: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    high: 'bg-red-100 text-red-800',
  };

  return (
    <div className="flex items-center space-x-3 p-4 bg-white rounded-lg shadow border">
      <input
        type="checkbox"
        checked={todo.isCompleted}
        onChange={handleToggleComplete}
        className="h-4 w-4"
      />
      <div className="flex-1 min-w-0">
        <div
          className={`text-sm font-medium ${todo.isCompleted ? 'text-gray-500 line-through' : 'text-gray-900'}`}
        >
          {todo.Title}
        </div>
        {todo.description && (
          <div
            className={`text-sm ${todo.isCompleted ? 'text-gray-400' : 'text-gray-600'}`}
          >
            {todo.description}
          </div>
        )}
        <div className="flex items-center space-x-2 mt-1">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${priorityColors[todo.priority]}`}
          >
            {todo.priority}
          </span>
          {todo.category && (
            <CategoryBadge category={todo.category} size="sm" />
          )}
          {todo.dueDate && (
            <span className="text-xs text-gray-500">
              Due: {new Date(todo.dueDate).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={handleDelete}
        className="bg-transparent border-0 text-red-600 hover:text-red-800 text-sm font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
      >
        Delete
      </button>
    </div>
  );
}

import { useState } from 'react';

import { useCategories } from '../hooks/useCategories';
import { useTodos, TodoFilters } from '../hooks/useTodos';

import { CategoryFilter } from './CategoryFilter';
import { TodoForm } from './TodoForm';
import { TodoItem } from './TodoItem';

export function TodoList() {
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState<TodoFilters>({
    categoryIds: [],
    includeUncategorized: false,
  });

  const {
    todos,
    allTodos,
    loading,
    error,
    createTodo,
    updateTodo,
    deleteTodo,
    removeCategoryFromTodos,
  } = useTodos(filters);
  const { categories, refreshCategories } = useCategories();

  // Handle cleanup when a category is deleted (called by TodoForm)
  const handleCategoryDeleted = async (categoryId: string) => {
    await removeCategoryFromTodos(categoryId);

    // Remove deleted category from active filters
    setFilters((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.filter((id) => id !== categoryId),
    }));
  };

  // Handle category changes (created, updated, deleted) - refresh category list
  const handleCategoryChanged = () => {
    refreshCategories();
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="text-gray-500">Loading todos...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">My Todos</h2>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Add Todo
        </button>
      </div>

      {showForm && (
        <TodoForm
          onSubmit={createTodo}
          onCancel={() => setShowForm(false)}
          onCategoryDeleted={handleCategoryDeleted}
          onCategoryChanged={handleCategoryChanged}
        />
      )}

      <CategoryFilter
        categories={categories}
        allTodos={allTodos}
        filters={filters}
        onFiltersChange={setFilters}
      />

      {todos.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-500 text-lg">No todos yet</div>
          <div className="text-gray-400 text-sm mt-2">
            Click "Add Todo" to create your first task
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {todos.map((todo) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              onUpdate={updateTodo}
              onDelete={deleteTodo}
            />
          ))}
        </div>
      )}

      {todos.length > 0 && (
        <div className="text-center text-sm text-gray-500 pt-4">
          {todos.filter((t) => !t.isCompleted).length} of {todos.length} todos
          remaining
        </div>
      )}
    </div>
  );
}

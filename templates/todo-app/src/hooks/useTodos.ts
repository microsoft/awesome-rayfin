import { useState, useEffect, useCallback, useMemo } from 'react';

import { Todo } from '../../rayfin/data/Todo';
import { ServiceContainer } from '../services/ServiceContainer';

import { useAuth } from './useAuth';

export interface TodoFilters {
  categoryIds: string[];
  includeUncategorized: boolean;
}

export function useTodos(filters?: TodoFilters) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user, isAuthenticated } = useAuth();
  const todoService = ServiceContainer.create().todoService;

  const fetchTodos = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setTodos([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await todoService.getTodos();
      setTodos(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch todos';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user, todoService]);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  // Filter todos based on category filters
  const filteredTodos = useMemo(() => {
    if (
      !filters ||
      (filters.categoryIds.length === 0 && !filters.includeUncategorized)
    ) {
      return todos;
    }

    return todos.filter((todo) => {
      // Check if todo has a category and if it's in the selected categories
      if (todo.category && filters.categoryIds.includes(todo.category.id)) {
        return true;
      }

      // Check if todo is uncategorized and we want to include uncategorized todos
      if (!todo.category && filters.includeUncategorized) {
        return true;
      }

      return false;
    });
  }, [todos, filters]);

  const createTodo = useCallback(
    async (todo: Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>) => {
      try {
        const newTodo = await todoService.createTodo(todo);
        setTodos((prev) => [...prev, newTodo]);
        return newTodo;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to create todo';
        setError(message);
        throw err;
      }
    },
    [todoService]
  );

  const updateTodo = useCallback(
    async (
      id: string,
      updates: Partial<Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>>
    ) => {
      try {
        const updatedTodo = await todoService.updateTodo(id, updates);
        setTodos((prev) =>
          prev.map((todo) => (todo.id === id ? updatedTodo : todo))
        );
        return updatedTodo;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update todo';
        setError(message);
        throw err;
      }
    },
    [todoService]
  );

  const deleteTodo = useCallback(
    async (id: string) => {
      try {
        await todoService.deleteTodo(id);
        setTodos((prev) => prev.filter((todo) => todo.id !== id));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to delete todo';
        setError(message);
        throw err;
      }
    },
    [todoService]
  );

  // Function to remove category from todos when category is deleted
  const removeCategoryFromTodos = useCallback(
    async (categoryId: string) => {
      const todosToUpdate = todos.filter(
        (todo) => todo.category?.id === categoryId
      );

      for (const todo of todosToUpdate) {
        try {
          await updateTodo(todo.id, { category: undefined });
        } catch (err) {
          console.error('Failed to remove category from todo:', todo.id, err);
        }
      }
    },
    [todos, updateTodo]
  );

  return {
    todos: filteredTodos,
    allTodos: todos,
    loading,
    error,
    createTodo,
    updateTodo,
    deleteTodo,
    removeCategoryFromTodos,
    refetch: fetchTodos,
  };
}

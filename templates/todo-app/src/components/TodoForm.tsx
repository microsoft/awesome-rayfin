import { getFieldConstraints, toStandardSchema } from '@microsoft/rayfin-core';
import { useMemo, useState } from 'react';

import { Category } from '../../rayfin/data/Category';
import { Todo } from '../../rayfin/data/Todo';
import { useAuth } from '../hooks/useAuth';
import { useCategories } from '../hooks/useCategories';

import { CategoryManager } from './CategoryManager';

interface TodoFormProps {
  onSubmit: (
    todo: Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<Todo>;
  onCancel: () => void;
  onCategoryDeleted?: (categoryId: string) => void;
  onCategoryChanged?: () => void; // Notify parent when categories change
}

export function TodoForm({
  onSubmit,
  onCancel,
  onCategoryDeleted,
  onCategoryChanged,
}: TodoFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<
    Category | undefined
  >();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { user } = useAuth();
  const { categories, createCategory, updateCategory, deleteCategory } =
    useCategories();

  // Build a Standard Schema validator from the @entity()-decorated Todo.
  // We omit the fields the service owns (id + timestamps) so the validated
  // value lines up with the createTodo signature exactly.
  const todoInputSchema = useMemo(
    () =>
      toStandardSchema(Todo, {
        omit: ['createdAt', 'updatedAt'] as const,
      }),
    []
  );

  const titleConstraints = getFieldConstraints(Todo, 'Title');
  const titleMaxLength =
    titleConstraints?.type === 'string' ? titleConstraints.max : undefined;

  const handleCategoryCreate = async (category: {
    name: string;
    color?: string;
  }): Promise<Category> => {
    if (!user)
      throw new Error('User must be authenticated to create categories');

    const categoryData: Omit<Category, 'id' | 'Id'> = {
      name: category.name,
      color: category.color || '#3B82F6', // Default color
      user_id: user.Id,
    };

    const newCategory = await createCategory(categoryData);
    onCategoryChanged?.(); // Notify parent that categories changed
    return newCategory;
  };

  const handleCategoryUpdate = async (
    id: string,
    updates: { name?: string; color?: string }
  ): Promise<Category> => {
    const updatedCategory = await updateCategory(id, updates);
    onCategoryChanged?.(); // Notify parent that categories changed
    return updatedCategory;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) throw new Error('User must be authenticated to create todos');

    const candidate = {
      Title: title.trim(),
      description: description.trim() || undefined,
      isCompleted: false,
      priority,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      user_id: user.Id,
      category: selectedCategory,
      percentComplete: 0,
    };

    const result = todoInputSchema.validate(candidate);
    if (result.issues) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.issues) {
        const key = String(issue.path?.[0] ?? '_');
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    setLoading(true);
    try {
      await onSubmit(result.value);

      // Reset form
      setTitle('');
      setDescription('');
      setPriority('medium');
      setDueDate('');
      setSelectedCategory(undefined);
      onCancel();
    } catch (err) {
      // Error handled by parent
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryDelete = async (categoryId: string) => {
    await deleteCategory(categoryId);
    // Notify parent component about the deletion so it can clean up todos
    onCategoryDeleted?.(categoryId);
    onCategoryChanged?.(); // Notify parent that categories changed

    // Clear selected category if it was the deleted one
    if (selectedCategory?.id === categoryId) {
      setSelectedCategory(undefined);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow border">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Add New Todo</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700"
          >
            Title *
            {titleMaxLength !== undefined && (
              <span className="ml-2 text-xs text-gray-500">
                ({title.length}/{titleMaxLength})
              </span>
            )}
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
          {errors.Title && (
            <p className="mt-1 text-sm text-red-600">{errors.Title}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-gray-700"
          >
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="priority"
            className="block text-sm font-medium text-gray-700"
          >
            Priority
          </label>
          <select
            id="priority"
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as 'low' | 'medium' | 'high')
            }
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <div>
          <CategoryManager
            categories={categories}
            selectedCategory={selectedCategory}
            onCategorySelect={setSelectedCategory}
            onCategoryCreate={handleCategoryCreate}
            onCategoryUpdate={handleCategoryUpdate}
            onCategoryDelete={handleCategoryDelete}
            disabled={loading}
          />
        </div>

        <div>
          <label
            htmlFor="dueDate"
            className="block text-sm font-medium text-gray-700"
          >
            Due Date
          </label>
          <input
            id="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="flex space-x-3">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? 'Adding...' : 'Add Todo'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

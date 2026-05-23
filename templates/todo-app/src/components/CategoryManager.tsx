import { useState, useRef, useEffect } from 'react';

import { Category } from '../../rayfin/data/Category';

import { CategoryBadge } from './CategoryBadge';

interface CategoryManagerProps {
  categories: Category[];
  selectedCategory?: Category;
  onCategorySelect: (category: Category | undefined) => void;
  onCategoryCreate: (category: {
    name: string;
    color?: string;
  }) => Promise<Category>;
  onCategoryUpdate: (
    id: string,
    updates: { name?: string; color?: string }
  ) => Promise<Category>;
  onCategoryDelete: (id: string) => Promise<void>;
  disabled?: boolean;
}

export function CategoryManager({
  categories,
  selectedCategory,
  onCategorySelect,
  onCategoryCreate,
  onCategoryUpdate,
  onCategoryDelete,
  disabled = false,
}: CategoryManagerProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [selectedColor, setSelectedColor] = useState('#3B82F6');

  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Predefined color options
  const colorOptions = [
    '#3B82F6', // Blue
    '#10B981', // Green
    '#8B5CF6', // Purple
    '#EF4444', // Red
    '#F59E0B', // Amber
    '#06B6D4', // Cyan
    '#84CC16', // Lime
    '#EC4899', // Pink
  ];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
        setIsCreating(false);
        setEditingId(null);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when creating or editing
  useEffect(() => {
    if ((isCreating || editingId) && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating, editingId]);

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;

    try {
      const newCategory = await onCategoryCreate({
        name: newCategoryName.trim(),
        color: selectedColor,
      });
      onCategorySelect(newCategory);
      setNewCategoryName('');
      setIsCreating(false);
      setShowDropdown(false);
    } catch (err) {
      console.error('Failed to create category:', err);
    }
  };

  const handleUpdateCategory = async (id: string) => {
    if (!editingName.trim()) return;

    try {
      const updatedCategory = await onCategoryUpdate(id, {
        name: editingName.trim(),
      });
      if (selectedCategory?.id === id) {
        onCategorySelect(updatedCategory);
      }
      setEditingId(null);
      setEditingName('');
    } catch (err) {
      console.error('Failed to update category:', err);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (
      !confirm(
        'Are you sure you want to delete this category? Todos in this category will become uncategorized.'
      )
    ) {
      return;
    }

    try {
      await onCategoryDelete(id);
      if (selectedCategory?.id === id) {
        onCategorySelect(undefined);
      }
    } catch (err) {
      console.error('Failed to delete category:', err);
    }
  };

  const startEditing = (category: Category) => {
    setEditingId(category.id);
    setEditingName(category.name);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Category
      </label>

      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={disabled}
        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm flex items-center justify-between hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ border: '1px solid #000' }}
      >
        <div className="flex items-center">
          {selectedCategory ? (
            <CategoryBadge category={selectedCategory} size="sm" />
          ) : (
            <span className="text-gray-500">Select a category...</span>
          )}
        </div>
        <svg
          className="w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {showDropdown && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
          {/* No category option */}
          <button
            type="button"
            onClick={() => {
              onCategorySelect(undefined);
              setShowDropdown(false);
            }}
            className="w-full px-3 py-2 text-left hover:bg-gray-50 focus:outline-none focus:bg-gray-50 border-b border-gray-100"
          >
            <span className="text-gray-700 font-medium">No category</span>
          </button>

          {/* Existing categories */}
          {categories.map((category) => (
            <div key={category.id} className="flex items-center group">
              {editingId === category.id ? (
                <div className="flex-1 p-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleUpdateCategory(category.id);
                      } else if (e.key === 'Escape') {
                        setEditingId(null);
                        setEditingName('');
                      }
                    }}
                    onBlur={() => handleUpdateCategory(category.id)}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onCategorySelect(category);
                      setShowDropdown(false);
                    }}
                    className="flex-1 px-3 py-2 text-left hover:bg-gray-50 focus:outline-none focus:bg-gray-50"
                  >
                    <CategoryBadge category={category} size="sm" />
                  </button>
                  <div className="opacity-0 group-hover:opacity-100 flex px-2">
                    <button
                      type="button"
                      onClick={() => startEditing(category)}
                      className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
                      title="Rename category"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(category.id)}
                      className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-red-600"
                      title="Delete category"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          {/* Create new category */}
          <div className="border-t border-gray-100">
            {isCreating ? (
              <div className="p-3 space-y-3">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Category name"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateCategory();
                    } else if (e.key === 'Escape') {
                      setIsCreating(false);
                      setNewCategoryName('');
                    }
                  }}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <div className="flex flex-wrap gap-1">
                  {colorOptions.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${selectedColor === color ? 'border-gray-400' : 'border-gray-200'}`}
                      style={{ backgroundColor: color }}
                      title={`Select color ${color}`}
                    >
                      {selectedColor === color && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={handleCreateCategory}
                    disabled={!newCategoryName.trim()}
                    className="flex-1 px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setNewCategoryName('');
                    }}
                    className="flex-1 px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className="w-full px-3 py-2 text-left text-blue-600 hover:bg-blue-50 focus:outline-none focus:bg-blue-50"
              >
                <span className="text-sm">+ Create new category</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

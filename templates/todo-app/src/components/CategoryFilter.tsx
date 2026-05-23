import { useState } from 'react';

import { Category } from '../../rayfin/data/Category';
import { TodoFilters } from '../hooks/useTodos';

import { CategoryBadge } from './CategoryBadge';

interface CategoryFilterProps {
  categories: Category[];
  allTodos: any[]; // All todos for counting purposes
  filters: TodoFilters;
  onFiltersChange: (filters: TodoFilters) => void;
}

export function CategoryFilter({
  categories,
  allTodos,
  filters,
  onFiltersChange,
}: CategoryFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Count todos per category
  const getCategoryCount = (categoryId: string) => {
    return allTodos.filter((todo) => todo.category?.id === categoryId).length;
  };

  const getUncategorizedCount = () => {
    return allTodos.filter((todo) => !todo.category).length;
  };

  const handleCategoryToggle = (categoryId: string) => {
    const newCategoryIds = filters.categoryIds.includes(categoryId)
      ? filters.categoryIds.filter((id) => id !== categoryId)
      : [...filters.categoryIds, categoryId];

    onFiltersChange({
      ...filters,
      categoryIds: newCategoryIds,
    });
  };

  const handleUncategorizedToggle = () => {
    onFiltersChange({
      ...filters,
      includeUncategorized: !filters.includeUncategorized,
    });
  };

  const handleSelectAll = () => {
    onFiltersChange({
      categoryIds: categories.map((c) => c.id),
      includeUncategorized: true,
    });
  };

  const handleClearAll = () => {
    onFiltersChange({
      categoryIds: [],
      includeUncategorized: false,
    });
  };

  const activeFilterCount =
    filters.categoryIds.length + (filters.includeUncategorized ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <h3 className="text-sm font-medium text-gray-900">
            Filter by Category
          </h3>
          {hasActiveFilters && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              {activeFilterCount} active
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {hasActiveFilters && (
            <button
              onClick={handleClearAll}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Clear all
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-400 hover:text-gray-600 focus:outline-none"
          >
            <svg
              className={`w-5 h-5 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
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
        </div>
      </div>

      {/* Show active filters when collapsed */}
      {!isExpanded && hasActiveFilters && (
        <div className="mt-3 flex flex-wrap gap-2">
          {filters.categoryIds.map((categoryId) => {
            const category = categories.find((c) => c.id === categoryId);
            if (!category) return null;
            return (
              <CategoryBadge
                key={categoryId}
                category={category}
                size="sm"
                showRemove
                onRemove={() => handleCategoryToggle(categoryId)}
              />
            );
          })}
          {filters.includeUncategorized && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-800">
              Uncategorized
              <button
                onClick={handleUncategorizedToggle}
                className="ml-1.5 hover:opacity-75 focus:outline-none"
              >
                <svg
                  className="w-3 h-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </span>
          )}
        </div>
      )}

      {/* Expanded filter options */}
      {isExpanded && (
        <div className="mt-4 space-y-3">
          <div className="flex justify-between">
            <button
              onClick={handleSelectAll}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              Select all
            </button>
            <button
              onClick={handleClearAll}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Clear all
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {/* Categories */}
            {categories.map((category) => {
              const count = getCategoryCount(category.id);
              const isSelected = filters.categoryIds.includes(category.id);

              return (
                <label
                  key={category.id}
                  className="flex items-center space-x-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleCategoryToggle(category.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <CategoryBadge category={category} size="sm" />
                  <span className="text-sm text-gray-500">({count})</span>
                </label>
              );
            })}

            {/* Uncategorized */}
            <label className="flex items-center space-x-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.includeUncategorized}
                onChange={handleUncategorizedToggle}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-800">
                Uncategorized
              </span>
              <span className="text-sm text-gray-500">
                ({getUncategorizedCount()})
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

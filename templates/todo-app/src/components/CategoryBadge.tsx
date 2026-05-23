import { Category } from '../../rayfin/data/Category';

interface CategoryBadgeProps {
  category: Category;
  size?: 'sm' | 'md';
  showRemove?: boolean;
  onRemove?: () => void;
  className?: string;
}

export function CategoryBadge({
  category,
  size = 'sm',
  showRemove = false,
  onRemove,
  className = '',
}: CategoryBadgeProps) {
  const sizeClasses = {
    sm: 'px-2.5 py-0.5 text-xs font-medium', // Match priority badge styling
    md: 'px-3 py-1.5 text-sm',
  };

  const textColor = getContrastColor(category.color);

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${sizeClasses[size]} ${className}`}
      style={{
        backgroundColor: category.color,
        color: textColor,
      }}
    >
      {category.name}
      {showRemove && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-1.5 hover:opacity-75 focus:outline-none"
          aria-label={`Remove ${category.name} category`}
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </span>
  );
}

// Utility function to determine if text should be light or dark based on background color
function getContrastColor(hexColor: string): string {
  // Convert hex to RGB
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black or white based on luminance
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

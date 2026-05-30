import { useDarkMode } from '@/hooks/useDarkMode';

export function DarkModeToggle() {
  const { theme, setTheme } = useDarkMode();

  const options = [
    { value: 'light' as const, label: '☀️', title: 'Light mode' },
    { value: 'dark' as const, label: '🌙', title: 'Dark mode' },
    { value: 'system' as const, label: '💻', title: 'System preference' },
  ];

  return (
    <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          title={opt.title}
          className={`px-2 py-1 rounded-md text-xs transition-colors ${
            theme === opt.value
              ? 'bg-white dark:bg-gray-500 shadow-sm'
              : 'hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

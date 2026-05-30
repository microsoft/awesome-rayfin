export interface SlideTheme {
  name: string;
  backgroundColor: string;
  textColor: string;
  headingColor: string;
  accentColor: string;
  fontFamily: string;
  codeBackground: string;
  codeColor: string;
}

export const DEFAULT_THEME: SlideTheme = {
  name: 'Light',
  backgroundColor: '#ffffff',
  textColor: '#1f2937',
  headingColor: '#111827',
  accentColor: '#2563eb',
  fontFamily: 'Inter, system-ui, sans-serif',
  codeBackground: '#1f2937',
  codeColor: '#86efac',
};

export const THEME_PRESETS: SlideTheme[] = [
  DEFAULT_THEME,
  {
    name: 'Dark',
    backgroundColor: '#111827',
    textColor: '#e5e7eb',
    headingColor: '#f9fafb',
    accentColor: '#60a5fa',
    fontFamily: 'Inter, system-ui, sans-serif',
    codeBackground: '#000000',
    codeColor: '#86efac',
  },
  {
    name: 'Ocean',
    backgroundColor: '#0c4a6e',
    textColor: '#e0f2fe',
    headingColor: '#ffffff',
    accentColor: '#38bdf8',
    fontFamily: 'Inter, system-ui, sans-serif',
    codeBackground: '#082f49',
    codeColor: '#67e8f9',
  },
  {
    name: 'Warm',
    backgroundColor: '#fef3c7',
    textColor: '#451a03',
    headingColor: '#78350f',
    accentColor: '#d97706',
    fontFamily: 'Georgia, serif',
    codeBackground: '#451a03',
    codeColor: '#fde68a',
  },
  {
    name: 'Forest',
    backgroundColor: '#064e3b',
    textColor: '#d1fae5',
    headingColor: '#ecfdf5',
    accentColor: '#34d399',
    fontFamily: 'Inter, system-ui, sans-serif',
    codeBackground: '#022c22',
    codeColor: '#6ee7b7',
  },
  {
    name: 'Minimal',
    backgroundColor: '#fafafa',
    textColor: '#525252',
    headingColor: '#171717',
    accentColor: '#737373',
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    codeBackground: '#262626',
    codeColor: '#d4d4d4',
  },
  {
    name: 'Corporate',
    backgroundColor: '#1e3a5f',
    textColor: '#e2e8f0',
    headingColor: '#ffffff',
    accentColor: '#f59e0b',
    fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
    codeBackground: '#0f172a',
    codeColor: '#93c5fd',
  },
];

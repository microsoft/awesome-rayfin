// Shared theme constants + tree icons. Mirrors _ui_components.py.
import { tokens } from '@fluentui/react-components';

export const FONT_FAMILY = '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
// Theme-aware tokens (CSS variables) so light/dark mode both render correctly.
export const BORDER_COLOR = tokens.colorNeutralStroke2;
export const ICON_ACCENT = '#2563eb';
export const GRAY_COLOR = tokens.colorNeutralForeground3;
export const SECTION_BG = tokens.colorNeutralBackground2;
// Surface for cards/panels/sticky headers (pure white in light, dark in dark).
export const PANEL_BG = tokens.colorNeutralBackground1;
// Primary foreground for headings/labels that must stay high-contrast.
export const TEXT_PRIMARY = tokens.colorNeutralForeground1;
// Neutral hover background that works in both themes.
export const HOVER_BG = tokens.colorNeutralBackground1Hover;

// Unicode icons for tree nodes.
export const ICONS: Record<string, string> = {
  table: '\u{1F4C1}', // folder
  column: '\u{1F4CF}', // ruler
  measure: '\u{1F4D0}', // triangle ruler
  hierarchy: '\u{1F517}', // link
  calc_group: '\u{1F4CA}', // bar chart
  calc_item: '\u2022', // bullet
  model: '\u{1F4C4}', // page
  report: '\u{1F4CA}', // bar chart
  page: '\u{1F4C4}', // page
  visual: '\u{1F441}', // eye
  partition: '\u{1F4CE}', // paperclip
  folder: '\u{1F4C2}', // open folder
  relationship: '\u2194', // left-right arrow
};

// Collapse / expand markers.
export const EXPANDED = '\u25BC'; // ▼
export const COLLAPSED = '\u25B6'; // ▶

// Indentation per level (4 non-breaking spaces).
export const INDENT = '\u00A0\u00A0\u00A0\u00A0';

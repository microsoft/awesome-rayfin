// Tree-building utilities. Mirrors build_tree_items from _ui_components.py.

import type { TreeItem, TreeBuildResult, TableInfo } from './types';
import { ICONS, INDENT } from './theme';

// Icon keys whose row renders a Fluent SVG instead of a unicode glyph.
const SVG_ICON_KEYS = new Set(['page', 'table']);

export function buildTreeItems(items: TreeItem[]): TreeBuildResult {
  const options: string[] = [];
  const keyMap: Record<string, string> = {};
  const iconMap: Record<string, string> = {};
  const seen: Record<string, number> = {};

  for (const { indent, icon: iconKey, label, key } of items) {
    const useSvg = SVG_ICON_KEYS.has(iconKey);
    const icon = useSvg ? '' : (ICONS[iconKey] ?? iconKey);
    const prefix = icon ? `${icon} ` : '';
    let formatted = `${INDENT.repeat(indent)}${prefix}${label}`;

    if (keyMap[formatted] !== undefined) {
      const count = (seen[formatted] ?? 1) + 1;
      seen[formatted] = count;
      formatted += '\u200b'.repeat(count);
    }

    options.push(formatted);
    keyMap[formatted] = key;
    iconMap[formatted] = iconKey;
  }

  return { options, keyMap, iconMap };
}

/** Filter tree options, keeping parent nodes above any match. */
export function filterTreeOptions(allOptions: string[], query: string): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return allOptions;

  const matched = new Set<number>();
  for (let i = 0; i < allOptions.length; i++) {
    if (allOptions[i].toLowerCase().includes(q)) {
      matched.add(i);
      let curIndent = allOptions[i].length - allOptions[i].trimStart().length;
      for (let j = i - 1; j >= 0; j--) {
        const pIndent = allOptions[j].length - allOptions[j].trimStart().length;
        if (pIndent < curIndent) {
          matched.add(j);
          curIndent = pIndent;
          if (pIndent === 0) break;
        }
      }
    }
  }

  return Array.from(matched)
    .sort((a, b) => a - b)
    .map((i) => allOptions[i]);
}

/** Total child count for a table (columns + measures + hierarchies + calcItems). */
export function tableSummary(t: TableInfo): number {
  return (
    Object.keys(t.columns ?? {}).length +
    Object.keys(t.measures ?? {}).length +
    Object.keys(t.hierarchies ?? {}).length +
    Object.keys(t.calcItems ?? {}).length
  );
}

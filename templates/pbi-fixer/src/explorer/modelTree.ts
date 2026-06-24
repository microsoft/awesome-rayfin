// Model tree builder + preview/DAX resolvers.
// Ported from _model_explorer.py (via the TS PBI Fixer rewrite).

import type { ModelData, TreeItem, TreeBuildResult, ScanResult } from './types';
import { EXPANDED, COLLAPSED } from './theme';
import { buildTreeItems, tableSummary } from './treeUtils';

function countUnder(folders: Record<string, string[]>, prefix: string): number {
  let total = 0;
  for (const [fp, items] of Object.entries(folders)) {
    const fpNorm = fp.replace(/\//g, '\\');
    if (fpNorm === prefix || fpNorm.startsWith(prefix + '\\')) {
      total += items.length;
    }
  }
  return total;
}

function buildMeasuresWithFolders(
  measures: Record<string, { displayFolder?: string }>,
  tableKey: string,
  baseIndent: number,
  expanded: Set<string>,
  pendingChanges: Set<string>
): TreeItem[] {
  const items: TreeItem[] = [];
  const folders: Record<string, string[]> = {};
  const noFolder: string[] = [];

  for (const mn of Object.keys(measures).sort()) {
    const df = measures[mn].displayFolder ?? '';
    if (df) (folders[df] ??= []).push(mn);
    else noFolder.push(mn);
  }

  for (const mn of noFolder) {
    const mk = `measure:${tableKey}:${mn}`;
    const pfx = pendingChanges.has(mk) ? '\u270f ' : '';
    items.push({ indent: baseIndent, icon: 'measure', label: `${pfx}${mn}`, key: mk });
  }

  const emittedFolders = new Set<string>();
  for (const folderPath of Object.keys(folders).sort()) {
    const parts = folderPath.replace(/\//g, '\\').split('\\');
    for (let depth = 0; depth < parts.length; depth++) {
      const ancestor = parts.slice(0, depth + 1).join('\\');
      if (!emittedFolders.has(ancestor)) {
        emittedFolders.add(ancestor);
        const folderKey = `folder:${tableKey}:${ancestor}`;
        const marker = expanded.has(folderKey) ? EXPANDED : COLLAPSED;
        const count = countUnder(folders, ancestor);
        items.push({
          indent: baseIndent + depth,
          icon: 'folder',
          label: `${marker} ${parts[depth]}  [${count}]`,
          key: folderKey,
        });
      }
    }

    let allExpanded = true;
    for (let depth = 0; depth < parts.length; depth++) {
      const ancestor = parts.slice(0, depth + 1).join('\\');
      if (!expanded.has(`folder:${tableKey}:${ancestor}`)) {
        allExpanded = false;
        break;
      }
    }
    if (allExpanded) {
      for (const mn of folders[folderPath].sort()) {
        const mk = `measure:${tableKey}:${mn}`;
        const pfx = pendingChanges.has(mk) ? '\u270f ' : '';
        items.push({ indent: baseIndent + parts.length, icon: 'measure', label: `${pfx}${mn}`, key: mk });
      }
    }
  }

  return items;
}

function buildColumnsWithFolders(
  columns: Record<string, { displayFolder?: string; dataType?: string; isHidden?: boolean }>,
  tableKey: string,
  baseIndent: number,
  expanded: Set<string>,
  pendingChanges: Set<string>
): TreeItem[] {
  const items: TreeItem[] = [];
  const folders: Record<string, string[]> = {};
  const noFolder: string[] = [];

  for (const cn of Object.keys(columns).sort()) {
    const df = columns[cn].displayFolder ?? '';
    if (df) {
      const firstFolder = df.split(';')[0].trim();
      (folders[firstFolder] ??= []).push(cn);
    } else {
      noFolder.push(cn);
    }
  }

  for (const cn of noFolder) {
    const c = columns[cn];
    const hidden = c.isHidden ? ' (hidden)' : '';
    const ck = `column:${tableKey}:${cn}`;
    const pfx = pendingChanges.has(ck) ? '\u270f ' : '';
    items.push({
      indent: baseIndent,
      icon: 'column',
      label: `${pfx}${cn} [${c.dataType ?? ''}]${hidden}`,
      key: ck,
    });
  }

  const emittedFolders = new Set<string>();
  for (const folderPath of Object.keys(folders).sort()) {
    const parts = folderPath.replace(/\//g, '\\').split('\\');
    for (let depth = 0; depth < parts.length; depth++) {
      const ancestor = parts.slice(0, depth + 1).join('\\');
      if (!emittedFolders.has(ancestor)) {
        emittedFolders.add(ancestor);
        const folderKey = `colfolder:${tableKey}:${ancestor}`;
        const marker = expanded.has(folderKey) ? EXPANDED : COLLAPSED;
        const count = countUnder(folders, ancestor);
        items.push({
          indent: baseIndent + depth,
          icon: 'folder',
          label: `${marker} ${parts[depth]}  [${count}]`,
          key: folderKey,
        });
      }
    }

    let allExpanded = true;
    for (let depth = 0; depth < parts.length; depth++) {
      const ancestor = parts.slice(0, depth + 1).join('\\');
      if (!expanded.has(`colfolder:${tableKey}:${ancestor}`)) {
        allExpanded = false;
        break;
      }
    }
    if (allExpanded) {
      for (const cn of folders[folderPath].sort()) {
        const c = columns[cn];
        const hidden = c.isHidden ? ' (hidden)' : '';
        const ck = `column:${tableKey}:${cn}`;
        const pfx = pendingChanges.has(ck) ? '\u270f ' : '';
        items.push({
          indent: baseIndent + parts.length,
          icon: 'column',
          label: `${pfx}${cn} [${c.dataType ?? ''}]${hidden}`,
          key: ck,
        });
      }
    }
  }

  return items;
}

// Separator used to namespace tree-node keys (and the expanded/pending sets)
// by model id, so several models can share one tree without their table /
// measure / column keys colliding.
export const MODEL_KEY_SEP = '\u241f';

// Build the raw tree items for a single model (without the buildTreeItems
// formatting pass). Kept separate so buildMultiModelTree can prefix the keys.
export function buildModelTreeItems(
  modelData: ModelData,
  expandedNodes: Set<string>,
  pendingChanges: Set<string> = new Set()
): TreeItem[] {
  const items: TreeItem[] = [];

  const dsName = modelData.datasetName ?? 'Model';
  const props = modelData.modelProperties ?? { compatibilityLevel: '', defaultMode: '' };
  const compat = props.compatibilityLevel ?? '';
  const mode = props.defaultMode ?? '';
  const propStr = compat ? ` (${mode}, CL ${compat})` : '';
  const tCount = Object.keys(modelData.tables ?? {}).length;
  const isModelExp = expandedNodes.has(dsName);
  const marker = isModelExp ? EXPANDED : COLLAPSED;

  items.push({
    indent: 0,
    icon: 'model',
    label: `${marker} ${dsName}${propStr}  [${tCount} tables]`,
    key: `model:${dsName}`,
  });

  if (isModelExp) {
    for (const tName of Object.keys(modelData.tables).sort()) {
      const t = modelData.tables[tName];
      const icon = t.type === 'CalculationGroup' ? 'calc_group' : 'table';
      const isExpanded = expandedNodes.has(tName);
      const tMarker = isExpanded ? EXPANDED : COLLAPSED;
      const suffix = t.isHidden ? ' (hidden)' : '';
      const summary = tableSummary(t);

      items.push({
        indent: 1,
        icon,
        label: `${tMarker} ${tName}${suffix}  [${summary}]`,
        key: `table:${tName}`,
      });

      if (!isExpanded) continue;

      items.push(...buildMeasuresWithFolders(t.measures, tName, 2, expandedNodes, pendingChanges));
      items.push(...buildColumnsWithFolders(t.columns, tName, 2, expandedNodes, pendingChanges));

      for (const hn of Object.keys(t.hierarchies).sort()) {
        const lvlStr = t.hierarchies[hn].levels.join(' \u2192 ');
        items.push({ indent: 2, icon: 'hierarchy', label: `${hn}  (${lvlStr})`, key: `hierarchy:${tName}:${hn}` });
      }

      for (const ciName of Object.keys(t.calcItems).sort(
        (a, b) => (t.calcItems[a].ordinal ?? 0) - (t.calcItems[b].ordinal ?? 0)
      )) {
        items.push({ indent: 2, icon: 'calc_item', label: ciName, key: `calc_item:${tName}:${ciName}` });
      }

      for (const pt of t.partitions ?? []) {
        items.push({ indent: 2, icon: 'partition', label: `${pt.name} (${pt.sourceType})`, key: `partition:${tName}:${pt.name}` });
      }
    }

    const rels = modelData.relationships ?? [];
    if (rels.length > 0) {
      const relKey = 'rels:_single';
      const isRelsExp = expandedNodes.has(relKey);
      items.push({
        indent: 1,
        icon: 'relationship',
        label: `${isRelsExp ? EXPANDED : COLLAPSED} Relationships  [${rels.length}]`,
        key: relKey,
      });
      if (isRelsExp) {
        rels.forEach((rel, i) => {
          const active = rel.isActive ? '' : ' (inactive)';
          items.push({
            indent: 2,
            icon: 'relationship',
            label: `${rel.fromTable}[${rel.fromColumn}] \u2194 ${rel.toTable}[${rel.toColumn}]${active}`,
            key: `rel:_single:${i}`,
          });
        });
      }
    }

    const persps = modelData.perspectives ?? [];
    if (persps.length > 0) {
      items.push({ indent: 1, icon: 'folder', label: `Perspectives  [${persps.length}]`, key: 'persps:_single' });
      for (const pname of persps.slice().sort()) {
        items.push({ indent: 2, icon: 'calc_item', label: pname, key: `persp:_single:${pname}` });
      }
    }
  }

  return items;
}

export function buildModelTree(
  modelData: ModelData,
  expandedNodes: Set<string>,
  _scanResults: ScanResult = {},
  pendingChanges: Set<string> = new Set()
): TreeBuildResult {
  return buildTreeItems(buildModelTreeItems(modelData, expandedNodes, pendingChanges));
}

// Build one combined tree across several models. Each model's node keys are
// prefixed with `<modelId>\u241f` so they stay unique across models; the
// expanded / pending sets are stored with the same prefix and scoped per model.
export function buildMultiModelTree(
  models: { id: string; data: ModelData }[],
  expandedNodes: Set<string>,
  pendingChanges: Set<string> = new Set()
): TreeBuildResult {
  const allItems: TreeItem[] = [];
  for (const { id, data } of models) {
    const prefix = id + MODEL_KEY_SEP;
    const scopedExpanded = new Set<string>();
    for (const e of expandedNodes) if (e.startsWith(prefix)) scopedExpanded.add(e.slice(prefix.length));
    const scopedPending = new Set<string>();
    for (const p of pendingChanges) if (p.startsWith(prefix)) scopedPending.add(p.slice(prefix.length));
    for (const it of buildModelTreeItems(data, scopedExpanded, scopedPending)) {
      allItems.push({ ...it, key: prefix + it.key });
    }
  }
  return buildTreeItems(allItems);
}

export function getModelPreviewText(modelData: ModelData, key: string): string {
  const parts = key.split(':');
  const nodeType = parts[0];
  const tableName = parts[1] ?? '';
  const objectName = parts.length > 2 ? parts.slice(2).join(':') : '';

  if (nodeType === 'rels') return '';

  if (nodeType === 'model') {
    const props = modelData.modelProperties ?? {};
    return Object.entries(props)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  }

  if (nodeType === 'partition') {
    const t = modelData.tables[tableName];
    return t?.partitions?.find((p) => p.name === objectName)?.expression ?? '';
  }

  if (nodeType === 'rel') {
    const idx = parseInt(parts[2] ?? '-1', 10);
    const rels = modelData.relationships ?? [];
    if (idx >= 0 && idx < rels.length) {
      const r = rels[idx];
      return [
        `From: '${r.fromTable}'[${r.fromColumn}]`,
        `To:   '${r.toTable}'[${r.toColumn}]`,
        `Multiplicity: ${r.multiplicity}`,
        `Cross-filter: ${r.crossFilter}`,
        `Security filtering: ${r.securityFiltering}`,
        `Active: ${r.isActive}`,
        `Rely on RRI: ${r.relyOnRri}`,
      ].join('\n');
    }
    return '';
  }

  if (nodeType === 'measure') return modelData.tables[tableName]?.measures[objectName]?.expression ?? '';
  if (nodeType === 'column') return modelData.tables[tableName]?.columns[objectName]?.expression ?? '';
  if (nodeType === 'calc_item') return modelData.tables[tableName]?.calcItems[objectName]?.expression ?? '';

  // For a table node, surface only the actual M (Power Query) expression of its
  // import partition. Direct Lake / entity partitions carry no M, so the box
  // stays empty for those.
  if (nodeType === 'table') {
    const t = modelData.tables[tableName];
    const p = t?.partitions?.find((part) => part.expression && part.expression.trim() !== '');
    return p?.expression ?? '';
  }

  return '';
}

export function getDaxReference(key: string): string {
  const parts = key.split(':');
  const tableName = parts[1] ?? '';
  const objectName = parts.length > 2 ? parts.slice(2).join(':') : '';
  if (parts[0] === 'measure') return `[${objectName}]`;
  if (parts[0] === 'column') return `'${tableName}'[${objectName}]`;
  return '';
}

// Org app builder — auto-create a Fabric org app from a workspace's reports,
// grouping them into topic-based audiences (with or without AI).
//
// Builds on the same server-side `fabric_proxy` UDF used elsewhere: an org app
// and each audience are plain definition-backed Fabric items created through the
// generic Create Item REST call (`POST /workspaces/{id}/items` with a base64
// `definition.json`). No bespoke proxy change is required.
//
// Structure produced:
//   • one OrgApp item containing an Overview element plus one section per topic,
//     each section holding the topic's reports as item elements;
//   • one OrgAppAudience item per topic — each audience shows only its own
//     section/reports (every other section + report is hidden), so consumers get
//     a tab per topic.
//
// Three grouping strategies feed the topics:
//   • 'folder' — one topic per workspace folder (root reports → "General").
//   • 'name'   — group by a shared leading name token; singletons → "General".
//   • AI       — delegates grouping to GitHub Copilot via the shared
//                `github_tidy_workspace` UDF (same one the cleanup feature uses).

import { getGithubToken } from './githubAuth';
import { GithubAuthRequiredError } from './mCommenter';
import { udf } from './udfClient';
import { groupsFromAssignments } from './workspaceCleanup';
import type { WorkspaceItem } from './workspaceEditor';

/** Report-like item types that can be packaged into an org app. */
export const ORG_APP_REPORT_TYPES = new Set<string>(['Report', 'PaginatedReport']);

export function isOrgAppReport(type: string): boolean {
  return ORG_APP_REPORT_TYPES.has(type);
}

export type TopicMode = 'folder' | 'name';

export interface TopicGroup {
  /** Topic / audience name. */
  topic: string;
  reports: WorkspaceItem[];
}

export interface OrgAppStepResult {
  /** App or audience name. */
  name: string;
  ok: boolean;
  detail?: string;
}

export interface CreateOrgAppOutcome {
  appId?: string;
  results: OrgAppStepResult[];
}

const ORG_APP_SCHEMA =
  'https://developer.microsoft.com/json-schemas/fabric/item/orgapp/definition/orgAppDefinition/2.0.0/schema.json';
const ORG_APP_AUDIENCE_SCHEMA =
  'https://developer.microsoft.com/json-schemas/fabric/item/orgappaudience/definition/orgAppAudienceDefinition/1.0.0/schema.json';

function b64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function uuid(): string {
  return crypto.randomUUID();
}

// ── Topic grouping (non-AI) ────────────────────────────────────────────────

function sortTopics(map: Map<string, WorkspaceItem[]>): TopicGroup[] {
  return [...map.entries()]
    .map(([topic, reports]) => ({ topic, reports }))
    .sort((a, b) => a.topic.localeCompare(b.topic, undefined, { sensitivity: 'base' }));
}

/** One topic per workspace folder; reports at the root fall into "General". */
function planByFolder(reports: WorkspaceItem[]): TopicGroup[] {
  const map = new Map<string, WorkspaceItem[]>();
  for (const r of reports) {
    const leaf = (r.folderPath || '').split(' / ').filter(Boolean).pop();
    const key = leaf || 'General';
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return sortTopics(map);
}

/** Leading name token, e.g. "Sales - Monthly" → "Sales", "fin_budget" → "fin". */
function leadingToken(name: string): string {
  const trimmed = (name || '').trim();
  const token = trimmed.split(/\s*[-_\s]\s*/)[0]?.trim();
  return token || trimmed || 'General';
}

/** Group reports by a shared leading name token; singletons go to "General". */
function planByName(reports: WorkspaceItem[]): TopicGroup[] {
  const buckets = new Map<string, { label: string; reports: WorkspaceItem[] }>();
  for (const r of reports) {
    const token = leadingToken(r.displayName);
    const key = token.toLowerCase();
    const b = buckets.get(key) ?? { label: token, reports: [] };
    b.reports.push(r);
    buckets.set(key, b);
  }
  const map = new Map<string, WorkspaceItem[]>();
  for (const b of buckets.values()) {
    if (b.reports.length >= 2) {
      map.set(b.label, b.reports);
    } else {
      const other = map.get('General') ?? [];
      other.push(...b.reports);
      map.set('General', other);
    }
  }
  return sortTopics(map);
}

/** Compute a non-AI topic plan for the given reports. */
export function planTopics(reports: WorkspaceItem[], mode: TopicMode): TopicGroup[] {
  return mode === 'name' ? planByName(reports) : planByFolder(reports);
}

/**
 * AI-authored topic plan. Reuses the shared `github_tidy_workspace` UDF (the same
 * one the workspace-cleanup feature uses) to group reports by subject, then maps
 * each returned folder name to an audience topic. Requires a GitHub sign-in
 * (throws {@link GithubAuthRequiredError} when no token is held).
 */
export async function buildAiTopicPlan(reports: WorkspaceItem[]): Promise<TopicGroup[]> {
  const token = getGithubToken();
  if (!token) throw new GithubAuthRequiredError();
  if (reports.length === 0) return [];
  const { assignments } = await udf.githubTidyWorkspace(
    token,
    reports.map((r) => ({ id: r.id, name: r.displayName, type: r.type }))
  );
  return groupsFromAssignments(reports, assignments ?? []).map((g) => ({
    topic: g.folder,
    reports: g.items,
  }));
}

// ── Definition building ────────────────────────────────────────────────────

interface ReportElement {
  elementId: string;
  itemId: string;
  itemType: string;
  folderObjectId?: string;
  displayName: string;
}

interface BuiltSection {
  topic: string;
  sectionElementId: string;
  reports: ReportElement[];
}

interface BuiltApp {
  definition: Record<string, unknown>;
  overviewElementId: string;
  sections: BuiltSection[];
}

/** Build the OrgApp `definition.json` (Overview + one section per topic). */
function buildOrgAppDefinition(appName: string, topics: TopicGroup[]): BuiltApp {
  const overviewElementId = uuid();
  const sections: BuiltSection[] = topics.map((t) => ({
    topic: t.topic,
    sectionElementId: uuid(),
    reports: t.reports.map((r) => ({
      elementId: uuid(),
      itemId: r.id,
      itemType: r.type,
      folderObjectId: r.folderId,
      displayName: r.displayName,
    })),
  }));

  const elements: unknown[] = [
    {
      elementType: 'overview',
      elementId: overviewElementId,
      displayName: 'Overview',
      header: {
        title: appName,
        body: 'Reports organised by topic. Use the audience tabs to switch topics.',
        showTheme: true,
      },
      isHidden: false,
    },
    ...sections.map((s) => ({
      elementType: 'section',
      elementId: s.sectionElementId,
      displayName: s.topic,
      elements: s.reports.map((r) => {
        const el: Record<string, unknown> = {
          elementType: 'item',
          elementId: r.elementId,
          itemId: r.itemId,
          itemType: r.itemType,
          displayName: r.displayName,
          isHidden: false,
        };
        if (r.folderObjectId) el.folderObjectId = r.folderObjectId;
        return el;
      }),
    })),
  ];

  const definition: Record<string, unknown> = {
    $schema: ORG_APP_SCHEMA,
    settings: {
      experienceSettings: { navigationPane: { isHidden: false, isCollapsed: false } },
      audienceSettings: { hideAudienceTabs: false, hideAllTab: false },
    },
    elements,
  };

  return { definition, overviewElementId, sections };
}

/**
 * Build an OrgAppAudience `definition.json` for the topic at `topicIndex`: the
 * matching section + its reports are visible, every other section + report is
 * hidden, so the audience surfaces exactly one topic.
 */
function buildAudienceDefinition(
  parentAppId: string,
  built: BuiltApp,
  topicIndex: number
): Record<string, unknown> {
  const elementReferences: unknown[] = [
    { elementId: built.overviewElementId, isElementHidden: false },
  ];

  built.sections.forEach((s, i) => {
    const hidden = i !== topicIndex;
    // Section itself (app-only structural element).
    elementReferences.push({ elementId: s.sectionElementId, isElementHidden: hidden });
    // Its reports (workspace content references).
    for (const r of s.reports) {
      const ref: Record<string, unknown> = {
        elementId: r.elementId,
        itemType: r.itemType,
        isElementHidden: hidden,
        itemId: r.itemId,
      };
      if (r.folderObjectId) ref.folderObjectId = r.folderObjectId;
      elementReferences.push(ref);
    }
  });

  return {
    $schema: ORG_APP_AUDIENCE_SCHEMA,
    parentAppId,
    settings: { hasAccessToHiddenContent: false, tabOrder: topicIndex + 1 },
    elementReferences,
  };
}

// ── Create ─────────────────────────────────────────────────────────────────

function createItemFromDefinition(
  workspaceId: string,
  displayName: string,
  type: string,
  definition: Record<string, unknown>
): Promise<{ id: string }> {
  return udf.fabricProxy<{ id: string }>('fabric', `/workspaces/${workspaceId}/items`, 'POST', {
    displayName,
    type,
    definition: {
      parts: [
        {
          path: 'definition.json',
          payload: b64(JSON.stringify(definition)),
          payloadType: 'InlineBase64',
        },
      ],
    },
  });
}

/**
 * Create the org app and one audience per topic. The org app is created first;
 * if that fails the run stops. Each audience is then created independently so a
 * single failure doesn't abort the rest. Returns the new app id (when created)
 * and a per-step result list.
 */
export async function createOrgApp(
  workspaceId: string,
  appName: string,
  topics: TopicGroup[]
): Promise<CreateOrgAppOutcome> {
  const results: OrgAppStepResult[] = [];
  const name = (appName || '').trim() || 'Org app';
  const usable = topics.filter((t) => t.topic.trim() && t.reports.length > 0);
  const built = buildOrgAppDefinition(name, usable);

  let appId: string;
  try {
    const created = await createItemFromDefinition(workspaceId, name, 'OrgApp', built.definition);
    appId = created.id;
    results.push({ name, ok: true, detail: 'Org app created' });
  } catch (e: unknown) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    return { results };
  }

  for (let i = 0; i < usable.length; i++) {
    const topic = usable[i];
    const count = topic.reports.length;
    try {
      const def = buildAudienceDefinition(appId, built, i);
      await createItemFromDefinition(workspaceId, topic.topic.trim(), 'OrgAppAudience', def);
      results.push({
        name: topic.topic.trim(),
        ok: true,
        detail: `Audience · ${count} report${count === 1 ? '' : 's'}`,
      });
    } catch (e: unknown) {
      results.push({
        name: topic.topic.trim(),
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { appId, results };
}

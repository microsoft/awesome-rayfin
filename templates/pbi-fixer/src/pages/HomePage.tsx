import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  FluentProvider,
  webLightTheme,
  webDarkTheme,
  TabList,
  Tab,
  Combobox,
  Option,
  OptionGroup,
  Button,
  Switch,
  Spinner,
  Card,
  Text,
  mergeClasses,
  makeStyles,
  shorthands,
  tokens,
  MessageBar,
  MessageBarBody,
  MessageBarActions,
  type SelectTabData,
  type SelectTabEvent,
} from '@fluentui/react-components';
import {
  PlugConnected20Regular,
  Database20Regular,
  DocumentBulletList20Regular,
  DocumentText20Regular,
  Wrench20Regular,
  Broom20Regular,
  ArrowImport20Regular,
  ArrowExport20Regular,
  ShieldCheckmark20Regular,
  ChartMultiple20Regular,
  Sparkle20Regular,
  Rocket20Regular,
  PulseSquare20Regular,
  Apps20Regular,
  PlayCircle20Regular,
  FolderSwap20Regular,
  Options20Regular,
  ArrowSync20Regular,
  Eye20Regular,
  Organization20Regular,
  DatabaseArrowRight20Regular,
  BookInformation20Regular,
  WeatherMoon20Regular,
  WeatherSunny20Regular,
  SignOut20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  ChevronDown16Regular,
  ChevronRight16Regular,
  Info20Regular,
  History20Regular,
  Code20Regular,
  Gauge20Regular,
  Globe20Regular,
} from '@fluentui/react-icons';

import { useAuth } from '@/hooks/AuthContext';
import { udf, type FixerResult, type NamedItem } from '@/services/udfClient';
import { listReportModelPairs, loadModelData, type ReportModelPair } from '@/services/fabricRest';
import { runModelBpa } from '@/services/modelBpaApi';
import { applyModelBpaFix } from '@/services/modelBpaFix';
import { MODEL_BPA_RULES } from '@/services/bpa/rules';
import { logFix, saveSnapshot, recordScan, setCurrentUser } from '@/services/historyService';
import { analyzeModelsParallel, formatBytes, type ModelMemorySummary } from '@/services/memoryApi';
import {
  scanIbcsOrientation,
  applyIbcsOrientation,
  type IbcsScanResult,
  type IbcsFixResult,
} from '@/services/ibcsVisualFix';
import { signInToPbi, PbiSignInRequiredError } from '@/services/fabricAuth';
import { ICON_ACCENT, GRAY_COLOR, BORDER_COLOR } from '@/explorer/theme';
import { ModelExplorer, type ModelViewTab } from '@/components/explorer/ModelExplorer';
import { ReportExplorer } from '@/components/explorer/ReportExplorer';

// Heavier, rarely-the-first-view tabs are code-split and loaded on first visit
// so the initial app shell (Model / Report explorers) stays small.
const ForwardPrototype = lazy(() =>
  import('@/components/explorer/ForwardPrototype').then((m) => ({ default: m.ForwardPrototype }))
);
const ReversePrototype = lazy(() =>
  import('@/components/explorer/ReversePrototype').then((m) => ({ default: m.ReversePrototype }))
);
const UnusedCleanup = lazy(() =>
  import('@/components/explorer/UnusedCleanup').then((m) => ({ default: m.UnusedCleanup }))
);
const IbcsTools = lazy(() =>
  import('@/components/explorer/IbcsTools').then((m) => ({ default: m.IbcsTools }))
);
const IbcsChartFix = lazy(() =>
  import('@/components/explorer/IbcsChartFix').then((m) => ({ default: m.IbcsChartFix }))
);
const ReportStructFix = lazy(() =>
  import('@/components/explorer/ReportStructFix').then((m) => ({ default: m.ReportStructFix }))
);
const ReportBpa = lazy(() =>
  import('@/components/explorer/ReportBpa').then((m) => ({ default: m.ReportBpa }))
);
const LandingPage = lazy(() =>
  import('@/components/explorer/LandingPage').then((m) => ({ default: m.LandingPage }))
);
const DescriptionsTab = lazy(() =>
  import('@/components/explorer/DescriptionsTab').then((m) => ({ default: m.DescriptionsTab }))
);
const FieldParameters = lazy(() =>
  import('@/components/explorer/FieldParameters').then((m) => ({ default: m.FieldParameters }))
);
const RefreshTools = lazy(() =>
  import('@/components/explorer/RefreshTools').then((m) => ({ default: m.RefreshTools }))
);
const PerspectivesEditor = lazy(() =>
  import('@/components/explorer/PerspectivesEditor').then((m) => ({ default: m.PerspectivesEditor }))
);
const ModelDiagram = lazy(() =>
  import('@/components/explorer/ModelDiagram').then((m) => ({ default: m.ModelDiagram }))
);
const HistoryTab = lazy(() =>
  import('@/components/explorer/HistoryTab').then((m) => ({ default: m.HistoryTab }))
);
const MetricViewMigration = lazy(() =>
  import('@/components/explorer/MetricViewMigration').then((m) => ({ default: m.MetricViewMigration }))
);
const TmdlRunner = lazy(() =>
  import('@/components/explorer/TmdlRunner').then((m) => ({ default: m.TmdlRunner }))
);
const ModelDocumentation = lazy(() =>
  import('@/components/explorer/ModelDocumentation').then((m) => ({ default: m.ModelDocumentation }))
);
const JumpstartTab = lazy(() =>
  import('@/components/explorer/JumpstartTab').then((m) => ({ default: m.JumpstartTab }))
);
const MonitoringTab = lazy(() =>
  import('@/components/explorer/MonitoringTab').then((m) => ({ default: m.MonitoringTab }))
);
const RayfinAppsTab = lazy(() =>
  import('@/components/explorer/RayfinAppsTab').then((m) => ({ default: m.RayfinAppsTab }))
);
const SempyRunnerTab = lazy(() =>
  import('@/components/explorer/SempyRunnerTab').then((m) => ({ default: m.SempyRunnerTab }))
);
const WorkspaceEditorTab = lazy(() =>
  import('@/components/explorer/WorkspaceEditorTab').then((m) => ({ default: m.WorkspaceEditorTab }))
);
const AboutTab = lazy(() =>
  import('@/components/explorer/AboutTab').then((m) => ({ default: m.AboutTab }))
);
const GuidelinesTab = lazy(() =>
  import('@/components/explorer/GuidelinesTab').then((m) => ({ default: m.GuidelinesTab }))
);
const DefinitionSource = lazy(() =>
  import('@/components/explorer/DefinitionSource').then((m) => ({ default: m.DefinitionSource }))
);

const FIXERS: { id: string; label: string; description: string }[] = [
  { id: 'Fix_PageSize', label: 'Fix page size', description: 'Set every report page to 1280 x 720.' },
  {
    id: 'Fix_PieChart',
    label: 'Fix pie charts',
    description: 'Convert pie / donut / funnel visuals to bar charts.',
  },
  {
    id: 'Fix_ShowHiddenVisuals',
    label: 'Show hidden visuals',
    description: 'Unhide every hidden visual across all pages.',
  },
  {
    id: 'Fix_ShowHiddenPages',
    label: 'Show hidden pages',
    description: 'Make every hidden report page visible again.',
  },
];

// One entry per selected report in a batch fixer run (scan or apply).
type BatchRun = { pair: ReportModelPair; result?: FixerResult; error?: string };

// One entry per selected model in a batch BPA fixer run (scan or apply).
type ModelFixerResult = {
  scanOnly: boolean;
  total: number;
  fixable: number;
  changed: number;
  findings: { path: string; rule: string; detail?: string }[];
};
type ModelBatchRun = { pair: ReportModelPair; result?: ModelFixerResult; error?: string };

// One entry per selected report in a batch IBCS orientation run (scan or apply).
type IbcsBatchRun = {
  pair: ReportModelPair;
  scan?: IbcsScanResult;
  fix?: IbcsFixResult;
  error?: string;
};

const useStyles = makeStyles({
  shell: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    ...shorthands.padding('10px', '24px'),
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke2),
  },
  brand: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px') },
  main: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.padding('12px', '24px'),
    overflowY: 'auto',
  },
  connectionBar: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    flexShrink: 0,
    ...shorthands.gap('16px'),
    flexWrap: 'wrap',
    ...shorthands.padding('12px', '16px'),
    marginBottom: '10px',
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius('6px'),
  },
  pickerCol: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px'), flex: '1 1 280px', minWidth: '240px', maxWidth: '420px' },
  tabBody: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ...shorthands.padding('8px', '0') },
  // Main tab bar can dock top (default), left, right or bottom.
  tabsRegion: { flex: 1, minHeight: 0, display: 'flex', ...shorthands.gap('12px') },
  tabsRegionBottom: { flexDirection: 'column-reverse' },
  tabsRegionLeft: { flexDirection: 'row' },
  tabsRegionRight: { flexDirection: 'row-reverse' },
  tabListVertical: { flexShrink: 0, overflowY: 'auto', maxHeight: '100%' },
  // Collapsible, grouped vertical navigation (Developer-Hub style) for left/right dock.
  nav: {
    flexShrink: 0,
    width: '212px',
    overflowY: 'auto',
    maxHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('1px'),
    ...shorthands.padding('4px'),
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('6px', '10px'),
    ...shorthands.border('none'),
    ...shorthands.borderRadius('4px'),
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground1,
    fontSize: '13px',
    lineHeight: '18px',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  navItemActive: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontWeight: '600',
    ':hover': { backgroundColor: tokens.colorBrandBackground2Hover },
  },
  navItemIcon: { display: 'flex', flexShrink: 0, color: ICON_ACCENT },
  navItemIconActive: { display: 'flex', flexShrink: 0, color: tokens.colorBrandForeground1 },
  navGroupHeader: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('4px'),
    ...shorthands.padding('6px', '6px'),
    ...shorthands.border('none'),
    ...shorthands.borderRadius('4px'),
    backgroundColor: 'transparent',
    color: GRAY_COLOR,
    fontSize: '13px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    cursor: 'pointer',
    width: '100%',
    marginTop: '6px',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  navGroupChevron: { display: 'flex', flexShrink: 0, color: GRAY_COLOR },
  navSub: { display: 'flex', flexDirection: 'column', ...shorthands.gap('1px'), paddingLeft: '16px' },
  // Subtopic header (tier 2): lighter/smaller than a group header, collapsible.
  navSubtopicHeader: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('4px'),
    ...shorthands.padding('4px', '6px'),
    ...shorthands.border('none'),
    ...shorthands.borderRadius('4px'),
    backgroundColor: 'transparent',
    color: GRAY_COLOR,
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.02em',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    marginTop: '2px',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  navSubtopicChevron: { display: 'flex', flexShrink: 0, color: GRAY_COLOR },
  navSubtopicItems: { display: 'flex', flexDirection: 'column', ...shorthands.gap('1px'), paddingLeft: '12px' },
  // Row pairing an explorer entry with its expand/collapse chevron.
  navParentRow: { display: 'flex', alignItems: 'center' },
  navParentChevron: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...shorthands.border('none'),
    ...shorthands.borderRadius('4px'),
    ...shorthands.padding('4px'),
    backgroundColor: 'transparent',
    color: GRAY_COLOR,
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover, color: tokens.colorNeutralForeground1 },
  },
  navItemGrow: { flexGrow: 1, width: 'auto', minWidth: 0 },
  dockControl: { display: 'flex', alignItems: 'center', ...shorthands.gap('2px') },
  navFooter: { marginTop: 'auto', paddingTop: '8px' },
  // Explorer docking surface: supports both side-by-side and stacked layouts.
  splitWrap: { flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', position: 'relative' },
  splitWrapHorizontal: { flexDirection: 'row' },
  splitWrapVertical: { flexDirection: 'column' },
  splitToolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('8px'), marginBottom: '6px' },
  splitPane: {
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius('6px'),
    backgroundColor: tokens.colorNeutralBackground1,
  },
  paneHead: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('6px'),
    ...shorthands.padding('6px', '10px'),
    fontSize: '12px',
    fontWeight: '700',
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke2),
    flexShrink: 0,
  },
  paneHeadDrag: { cursor: 'grab' },
  paneHeadDragActive: { opacity: 0.7, cursor: 'grabbing' },
  paneBody: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
  splitter: {
    width: '8px',
    flexShrink: 0,
    cursor: 'col-resize',
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ':hover': { backgroundColor: '#eee' },
  },
  splitterVertical: {
    height: '8px',
    width: '100%',
    cursor: 'row-resize',
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ':hover': { backgroundColor: '#eee' },
  },
  splitterGrip: { width: '2px', height: '40px', backgroundColor: BORDER_COLOR, borderRadius: '1px' },
  splitterGripHorizontal: { width: '40px', height: '2px', backgroundColor: BORDER_COLOR, borderRadius: '1px' },
  dropOverlay: {
    position: 'absolute',
    inset: '12px',
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  dropTargets: {
    pointerEvents: 'auto',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    ...shorthands.gap('8px'),
    ...shorthands.padding('8px'),
    ...shorthands.borderRadius('8px'),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
  },
  dropZone: {
    minWidth: '120px',
    textAlign: 'center',
    ...shorthands.padding('8px', '10px'),
    ...shorthands.borderRadius('6px'),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    fontSize: '12px',
    fontWeight: 600,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  dropZoneActive: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
  },
  fixerGrid: { display: 'flex', flexDirection: 'column', ...shorthands.gap('10px') },
  fixerCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shorthands.padding('16px'),
  },
  fixerActions: { display: 'flex', ...shorthands.gap('8px') },
  resultCard: { ...shorthands.padding('16px'), marginTop: '12px' },
  findingList: {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#666',
    ...shorthands.margin('8px', '0', '0', '0'),
  },
});

type TabValue = 'model' | 'report' | 'descriptions' | 'field-parameters' | 'refresh-tools' | 'perspectives' | 'diagram' | 'metric-view' | 'tmdl-runner' | 'documentation' | 'cleanup' | 'forward-prototype' | 'sempy' | 'jumpstart' | 'rayfin-apps' | 'monitoring' | 'workspace-editor' | 'history' | 'guidelines' | 'about';
// Sub-views nested inside the Report Explorer tab. IBCS, Fixers, BPA, Reverse /
// Forward Prototype, Landing / Documentation pages and the PBIR source view all
// live under Report Explorer as sub-tabs so the report explorer stays the anchor
// view and is never lost.
type ReportSub = 'explorer' | 'ibcs' | 'fixers' | 'bpa' | 'reverse' | 'forward' | 'pbir' | 'landing' | 'documentation';

// A nav entry may optionally deep-link into a lens of an already-loaded object:
//  - `sub` opens the Report tab and selects that Report Explorer sub-view.
//  - `modelView` opens the Model tab and selects that Model Explorer lens
//    (Explorer / TMDL / Translations / Memory Analyzer / Model BPA).
type NavItemDef = { value: TabValue; label: string; icon: ReactElement; sub?: ReportSub; modelView?: ModelViewTab };
// A subtopic clusters tool items by intent (verb) and is independently
// collapsible (tier 2). Tier hierarchy: Group (1) › Subtopic (2) › Tool (3).
type NavSubtopicDef = { id: string; label: string; items: NavItemDef[] };
// A group may mix direct tool items (no subtopic expander) with collapsible
// subtopics — e.g. Workspace keeps Sempy Runner / Workspace Editor as direct
// items and only clusters Deploy.
type NavGroupDef = { id: string; label: string; items?: NavItemDef[]; subtopics?: NavSubtopicDef[] };

// Left-nav information architecture (three tiers).
//
// Principle — left nav vs. top tabs:
//  - Left-nav items are distinct *tools/destinations*, grouped (tier 1) and
//    clustered by intent into collapsible subtopics (tier 2). Pure section
//    headers (Model / Report / Workspace) and subtopic headers do not
//    navigate; the tool items under them do.
//  - Top tabs (inside Model/Report Explorer: Explorer · TMDL · Translations ·
//    Memory Analyzer · Model BPA, and the report sub-views) are *lenses on the
//    one already-loaded object*. Some lenses are ALSO surfaced as nav items
//    (e.g. Memory Analyzer, Model BPA, Translations) that deep-link into the
//    lens via `modelView` / `sub`; the lens tabs themselves stay too.
const NAV_GROUPS: NavGroupDef[] = [
  {
    id: 'model',
    label: 'Model',
    subtopics: [
      {
        id: 'explore',
        label: 'Explore',
        items: [
          { value: 'model', modelView: 'explorer', label: 'Model Explorer', icon: <Database20Regular /> },
          { value: 'diagram', label: 'Model Diagram', icon: <Organization20Regular /> },
        ],
      },
      {
        id: 'analyze',
        label: 'Analyze',
        items: [
          { value: 'model', modelView: 'memory', label: 'Memory Analyzer', icon: <Gauge20Regular /> },
          { value: 'model', modelView: 'bpa', label: 'Model BPA', icon: <ShieldCheckmark20Regular /> },
        ],
      },
      {
        id: 'build',
        label: 'Build / Add',
        items: [
          { value: 'refresh-tools', label: 'Add to Model', icon: <ArrowSync20Regular /> },
          { value: 'field-parameters', label: 'Field Parameters', icon: <Options20Regular /> },
          { value: 'metric-view', label: 'Metric View Migration', icon: <DatabaseArrowRight20Regular /> },
          { value: 'model', modelView: 'translations', label: 'Translations', icon: <Globe20Regular /> },
          { value: 'perspectives', label: 'Perspectives', icon: <Eye20Regular /> },
        ],
      },
      {
        id: 'maintain',
        label: 'Maintain',
        items: [
          { value: 'cleanup', label: 'Unused Cleanup', icon: <Broom20Regular /> },
          { value: 'descriptions', label: 'Descriptions', icon: <DocumentText20Regular /> },
        ],
      },
      {
        id: 'source',
        label: 'Source / Advanced',
        items: [
          { value: 'tmdl-runner', label: 'TMDL Runner', icon: <Code20Regular /> },
          { value: 'history', label: 'History & Undo', icon: <History20Regular /> },
        ],
      },
    ],
  },
  {
    id: 'report',
    label: 'Report',
    subtopics: [
      {
        id: 'explore',
        label: 'Explore',
        items: [
          { value: 'report', sub: 'explorer', label: 'Report Explorer', icon: <DocumentBulletList20Regular /> },
          { value: 'report', sub: 'pbir', label: 'PBIR View', icon: <Code20Regular /> },
        ],
      },
      {
        id: 'analyze',
        label: 'Analyze',
        items: [
          { value: 'report', sub: 'bpa', label: 'Report BPA', icon: <ShieldCheckmark20Regular /> },
        ],
      },
      {
        id: 'improve',
        label: 'Improve',
        items: [
          { value: 'report', sub: 'fixers', label: 'Fixers', icon: <Wrench20Regular /> },
          { value: 'report', sub: 'ibcs', label: 'IBCS', icon: <ChartMultiple20Regular /> },
        ],
      },
      {
        id: 'add-page',
        label: 'Add Page',
        items: [
          { value: 'report', sub: 'landing', label: 'Landing Page', icon: <Sparkle20Regular /> },
          { value: 'report', sub: 'documentation', label: 'Add Documentation Page', icon: <BookInformation20Regular /> },
        ],
      },
      {
        id: 'prototype',
        label: 'Prototype',
        items: [
          { value: 'report', sub: 'reverse', label: 'Reverse Prototype', icon: <ArrowImport20Regular /> },
          { value: 'report', sub: 'forward', label: 'Forward Prototype', icon: <ArrowExport20Regular /> },
        ],
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { value: 'sempy', label: 'Sempy Runner', icon: <PlayCircle20Regular /> },
      { value: 'workspace-editor', label: 'Workspace Editor', icon: <FolderSwap20Regular /> },
    ],
    subtopics: [
      {
        id: 'deploy',
        label: 'Deploy',
        items: [
          { value: 'jumpstart', label: 'Jumpstart', icon: <Rocket20Regular /> },
          { value: 'rayfin-apps', label: 'Rayfin Apps', icon: <Apps20Regular /> },
          { value: 'monitoring', label: 'Monitoring', icon: <PulseSquare20Regular /> },
        ],
      },
    ],
  },
];

export function HomePage() {
  const styles = useStyles();
  const { signOut, user } = useAuth();

  const [tab, setTab] = useState<TabValue>('model');
  // Tabs that have been opened at least once. Their explorer stays mounted
  // afterwards (hidden via display:none) so loaded state survives tab switches,
  // while avoiding eager loads/embeds before the tab is first visited.
  const [visited, setVisited] = useState<Set<TabValue>>(() => new Set<TabValue>(['model']));

  // Report Explorer sub-tab (Explorer / IBCS / Fixers). IBCS mounts on first
  // visit and stays mounted (display:none) so its loaded state survives.
  const [reportSub, setReportSub] = useState<ReportSub>('explorer');
  const [reportSubVisited, setReportSubVisited] = useState<Set<ReportSub>>(
    () => new Set<ReportSub>(['explorer'])
  );
  const selectReportSub = useCallback((next: ReportSub) => {
    setReportSub(next);
    setReportSubVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  }, []);

  // Model Explorer lens selection (Explorer / TMDL / Translations / Memory /
  // BPA). Owned here so the left nav can deep-link into a specific lens; the
  // ModelExplorer mirrors user-driven lens changes back via onViewTabChange.
  const [modelView, setModelView] = useState<ModelViewTab>('explorer');

  // Persisted light/dark theme preference for the whole app shell.
  const [dark, setDark] = useState<boolean>(() => {
    try { return localStorage.getItem('pbiFixer.theme') === 'dark'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('pbiFixer.theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark]);

  // Stamp the signed-in user onto history-log rows (DB-1). Set once; the write
  // hooks stay dependency-free so they can fire from anywhere.
  useEffect(() => {
    setCurrentUser(user?.name || user?.email || null);
  }, [user]);

  // Which collapsible nav groups are expanded (vertical dock only). Model and
  // Report start open so their Explorers are visible; Workspace stays collapsed.
  const [navGroupsOpen, setNavGroupsOpen] = useState<Set<string>>(() => {
    try {
      const v = localStorage.getItem('pbiFixer.navGroups.v2');
      if (v) return new Set(JSON.parse(v) as string[]);
    } catch { /* ignore */ }
    return new Set<string>(['model', 'report']);
  });
  useEffect(() => {
    try { localStorage.setItem('pbiFixer.navGroups.v2', JSON.stringify([...navGroupsOpen])); } catch { /* ignore */ }
  }, [navGroupsOpen]);
  const toggleNavGroup = useCallback((id: string) => {
    setNavGroupsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Which collapsible nav subtopics (tier 2) are expanded, keyed
  // `${groupId}:${subtopicId}`. The two anchor Explore clusters start open so
  // the Model/Report Explorers are reachable in one click.
  const [navSubtopicsOpen, setNavSubtopicsOpen] = useState<Set<string>>(() => {
    try {
      const v = localStorage.getItem('pbiFixer.navSubtopics.v1');
      if (v) return new Set(JSON.parse(v) as string[]);
    } catch { /* ignore */ }
    return new Set<string>(['model:explore', 'report:explore']);
  });
  useEffect(() => {
    try { localStorage.setItem('pbiFixer.navSubtopics.v1', JSON.stringify([...navSubtopicsOpen])); } catch { /* ignore */ }
  }, [navSubtopicsOpen]);
  const toggleNavSubtopic = useCallback((key: string) => {
    setNavSubtopicsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const selectTab = useCallback((next: TabValue) => {
    setTab(next);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  }, []);

  // Render one nav tool item (tier 3). Handles the active-state highlight and
  // the deep-link wiring for Report sub-views (`sub`) and Model lenses
  // (`modelView`).
  const renderNavItem = useCallback(
    (it: NavItemDef): ReactElement => {
      const active = it.sub
        ? tab === it.value && reportSub === it.sub
        : it.value === 'model'
          ? tab === 'model' && modelView === (it.modelView ?? 'explorer')
          : tab === it.value;
      return (
        <button
          key={it.sub ?? it.modelView ?? it.value}
          type="button"
          className={mergeClasses(styles.navItem, active && styles.navItemActive)}
          onClick={() => {
            selectTab(it.value);
            if (it.sub) selectReportSub(it.sub);
            if (it.value === 'model') setModelView(it.modelView ?? 'explorer');
          }}
        >
          <span className={active ? styles.navItemIconActive : styles.navItemIcon}>{it.icon}</span>
          {it.label}
        </button>
      );
    },
    [tab, reportSub, modelView, styles, selectTab, selectReportSub]
  );

  const [workspaces, setWorkspaces] = useState<NamedItem[]>([]);
  const [pairs, setPairs] = useState<ReportModelPair[]>([]);
  const [workspaceId, setWorkspaceId] = useState(() => {
    try { return localStorage.getItem('pbiFixer.workspaceId') ?? ''; } catch { return ''; }
  });
  const [pairKeys, setPairKeys] = useState<string[]>([]);
  // Selected pair keys restored from a previous session, re-applied once the
  // pairs for the restored workspace have loaded (and only the ones that still
  // exist). Cleared after the first restore so later workspace switches behave
  // normally (selection reset).
  const restoredPairKeysRef = useRef<string[]>([]);
  useEffect(() => {
    try {
      const v = localStorage.getItem('pbiFixer.pairKeys');
      restoredPairKeysRef.current = v ? (JSON.parse(v) as string[]) : [];
    } catch {
      restoredPairKeysRef.current = [];
    }
  }, []);
  // Persist the connection selection so the app reopens where it was left.
  useEffect(() => {
    try { localStorage.setItem('pbiFixer.workspaceId', workspaceId); } catch { /* ignore */ }
  }, [workspaceId]);
  useEffect(() => {
    try { localStorage.setItem('pbiFixer.pairKeys', JSON.stringify(pairKeys)); } catch { /* ignore */ }
  }, [pairKeys]);
  // Free-text filters typed into the comboboxes.
  const [wsText, setWsText] = useState('');
  const [pairQuery, setPairQuery] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [results, setResults] = useState<BatchRun[]>([]);
  const [modelResults, setModelResults] = useState<ModelBatchRun[]>([]);
  const [memoryResults, setMemoryResults] = useState<ModelMemorySummary[]>([]);
  const [ibcsResults, setIbcsResults] = useState<IbcsBatchRun[]>([]);
  const workspaceName = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.displayName ?? '',
    [workspaces, workspaceId]
  );
  // Keep the workspace input showing the selected name. `wsText` doubles as the
  // free-text filter while searching, so whenever the selected workspace
  // changes — including after a reload, once the workspace list finishes
  // loading — restore the name so the field never appears blank.
  useEffect(() => {
    setWsText(workspaceName);
  }, [workspaceName]);
  // First selected pair drives the single-target tabs (explorers, editors).
  const primaryKey = pairKeys[0] ?? '';
  const selectedPair = useMemo(
    () => pairs.find((p) => p.key === primaryKey) ?? null,
    [pairs, primaryKey]
  );
  const reportId = selectedPair?.reportId ?? '';
  const datasetId = selectedPair?.datasetId ?? '';
  const reportName = selectedPair?.reportId ? selectedPair.name : '';
  const datasetName = selectedPair?.datasetId ? selectedPair.name : '';

  // Every selected report-bearing pair — fixers run across all of these.
  const selectedReportPairs = useMemo(
    () =>
      pairKeys
        .map((k) => pairs.find((p) => p.key === k))
        .filter((p): p is ReportModelPair => !!p && !!p.reportId),
    [pairKeys, pairs]
  );

  // Every selected model-bearing pair — model BPA fixers run across all of these.
  const selectedModelPairs = useMemo(
    () =>
      pairKeys
        .map((k) => pairs.find((p) => p.key === k))
        .filter((p): p is ReportModelPair => !!p && !!p.datasetId),
    [pairKeys, pairs]
  );

  // Models handed to the Model Explorer (all selected ones, loaded into the tree).
  const modelExplorerModels = useMemo(
    () => selectedModelPairs.map((p) => ({ datasetId: p.datasetId as string, datasetName: p.name })),
    [selectedModelPairs]
  );

  // Dropdown display text: the name when one is picked, else "N selected".
  const pairValue =
    pairKeys.length === 0
      ? ''
      : pairKeys.length === 1
        ? selectedPair?.name ?? ''
        : `${pairKeys.length} selected`;
  // Mirror the workspace behaviour for the report/model picker: keep the field
  // showing the current selection summary and only deviate while the user is
  // actively typing a filter. Resyncs whenever the selection changes.
  useEffect(() => {
    setPairQuery(pairValue);
  }, [pairValue]);

  // Workspaces filtered by the typed text. When the input still shows the
  // selected name (not actively searching) we keep the full list available.
  const wsFiltered = useMemo(() => {
    const q = wsText.trim().toLowerCase();
    const effective = q === workspaceName.toLowerCase() ? '' : q;
    if (!effective) return workspaces;
    return workspaces.filter((w) => w.displayName.toLowerCase().includes(effective));
  }, [workspaces, wsText, workspaceName]);

  // Group pairs by display folder for the unified picker. `pairs` is already
  // sorted by folder then name, so each group keeps that order.
  const pairGroups = useMemo(() => {
    const groups = new Map<string, ReportModelPair[]>();
    for (const p of pairs) {
      const g = groups.get(p.folderPath) ?? [];
      g.push(p);
      groups.set(p.folderPath, g);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [pairs]);

  // Folder groups filtered by the typed search text (empty groups dropped).
  // While the field still shows the current selection summary (the user hasn't
  // started typing a new filter) the whole list stays available.
  const pairGroupsFiltered = useMemo(() => {
    const raw = pairQuery.trim().toLowerCase();
    const q = raw === pairValue.toLowerCase() ? '' : raw;
    if (!q) return pairGroups;
    return pairGroups
      .map(
        ([folder, items]) =>
          [folder, items.filter((p) => p.name.toLowerCase().includes(q))] as [string, ReportModelPair[]]
      )
      .filter(([, items]) => items.length > 0);
  }, [pairGroups, pairQuery, pairValue]);

  // Load workspaces. Surfaces a "Sign in to Power BI" gate when a token can't
  // be acquired silently (e.g. first run, or embedded in the Fabric portal
  // iframe where the auth popup must be started from a user gesture).
  const loadWorkspaces = useCallback(async () => {
    setBusy('workspaces');
    setError(null);
    try {
      const ws = await udf.listWorkspaces();
      setWorkspaces(ws);
      setNeedsSignIn(false);
    } catch (e: unknown) {
      if (e instanceof PbiSignInRequiredError) {
        setNeedsSignIn(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(null);
    }
  }, []);

  // Trigger interactive Power BI sign-in from a user gesture, then load.
  const handleSignIn = useCallback(async () => {
    setBusy('workspaces');
    setError(null);
    try {
      await signInToPbi(user?.email);
      setNeedsSignIn(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
      return;
    }
    await loadWorkspaces();
  }, [loadWorkspaces, user?.email]);

  // Load workspaces on mount.
  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  // Load reports + semantic models (folder-aware, merged) when workspace changes.
  useEffect(() => {
    setPairs([]);
    setPairKeys([]);
    if (!workspaceId) return;
    let cancelled = false;
    setBusy('items');
    listReportModelPairs(workspaceId)
      .then((p) => {
        if (cancelled) return;
        setPairs(p);
        // Re-apply a restored selection from a previous session (once).
        if (restoredPairKeysRef.current.length) {
          const valid = restoredPairKeysRef.current.filter((k) => p.some((pp) => pp.key === k));
          restoredPairKeysRef.current = [];
          if (valid.length) setPairKeys(valid);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const run = useCallback(
    async (fixerId: string, scanOnly: boolean) => {
      const targets = selectedReportPairs;
      if (!workspaceId || targets.length === 0) return;
      setError(null);
      setResults([]);
      setBusy(`${fixerId}:${scanOnly ? 'scan' : 'apply'}`);
      const acc: BatchRun[] = [];
      for (const t of targets) {
        try {
          const r = await udf.applyReportFixer(workspaceId, t.reportId as string, fixerId, scanOnly);
          acc.push({ pair: t, result: r });
        } catch (e) {
          acc.push({ pair: t, error: e instanceof Error ? e.message : String(e) });
        }
        setResults([...acc]);
      }
      setBusy(null);
    },
    [workspaceId, selectedReportPairs]
  );

  const canRunFixers = !!workspaceId && selectedReportPairs.length > 0 && !busy;

  // Batch model BPA fixer: for each selected model-bearing pair, load the model,
  // run the Best Practice Analyzer, and (apply mode) write back the deterministic
  // auto-fixes. Mirrors the report-fixer accumulation + per-item result cards.
  const runModelFixers = useCallback(
    async (scanOnly: boolean) => {
      const targets = selectedModelPairs;
      if (!workspaceId || targets.length === 0) return;
      setError(null);
      setModelResults([]);
      setBusy(`model-bpa:${scanOnly ? 'scan' : 'apply'}`);
      const acc: ModelBatchRun[] = [];
      for (const t of targets) {
        try {
          const model = await loadModelData(workspaceId, t.datasetId as string, t.name);
          const findings = runModelBpa(model);
          // DB-3 — record this batch scan for the quality trend (fire-and-forget).
          {
            let e = 0, w = 0, i = 0;
            for (const f of findings) {
              if (f.rule.severity === 'Error') e++;
              else if (f.rule.severity === 'Warning') w++;
              else i++;
            }
            recordScan({
              workspaceId,
              itemKind: 'model',
              itemId: t.datasetId as string,
              itemName: t.name,
              ruleSetVersion: `v${MODEL_BPA_RULES.length}`,
              error: e,
              warning: w,
              info: i,
            });
          }
          const fixable = findings.filter((f) => f.rule.fixKind);
          const detailed: { path: string; rule: string; detail?: string }[] = [];
          let changed = 0;
          if (scanOnly) {
            for (const f of fixable) detailed.push({ path: f.objectPath, rule: f.rule.name });
          } else {
            for (const f of fixable) {
              try {
                const r = await applyModelBpaFix(
                  workspaceId,
                  t.datasetId as string,
                  f.rule.fixKind!,
                  f.objectPath
                );
                changed += r.changed;
                detailed.push({ path: f.objectPath, rule: f.rule.name, detail: r.detail });
                // DB-1/DB-2 — log the fix and capture its undo snapshot off the
                // critical path (fire-and-forget; never blocks the batch).
                const snapId =
                  r.before && r.partPath
                    ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
                    : undefined;
                if (snapId && r.before && r.partPath) {
                  saveSnapshot({
                    id: snapId,
                    workspaceId,
                    itemKind: 'model',
                    itemId: t.datasetId as string,
                    itemName: t.name,
                    fixer: f.rule.fixKind!,
                    partPath: r.partPath,
                    before: r.before,
                  });
                }
                logFix({
                  workspaceId,
                  itemKind: 'model',
                  itemId: t.datasetId as string,
                  itemName: t.name,
                  fixer: f.rule.fixKind!,
                  rule: f.rule.name,
                  objectPath: f.objectPath,
                  result: 'ok',
                  changed: r.changed,
                  message: r.detail,
                  snapshotId: snapId,
                });
              } catch (e) {
                detailed.push({
                  path: f.objectPath,
                  rule: f.rule.name,
                  detail: e instanceof Error ? e.message : String(e),
                });
                logFix({
                  workspaceId,
                  itemKind: 'model',
                  itemId: t.datasetId as string,
                  itemName: t.name,
                  fixer: f.rule.fixKind!,
                  rule: f.rule.name,
                  objectPath: f.objectPath,
                  result: 'fail',
                  changed: 0,
                  message: e instanceof Error ? e.message : String(e),
                });
              }
            }
          }
          acc.push({
            pair: t,
            result: { scanOnly, total: findings.length, fixable: fixable.length, changed, findings: detailed },
          });
        } catch (e) {
          acc.push({ pair: t, error: e instanceof Error ? e.message : String(e) });
        }
        setModelResults([...acc]);
      }
      setBusy(null);
    },
    [workspaceId, selectedModelPairs]
  );

  const canRunModelFixers = !!workspaceId && selectedModelPairs.length > 0 && !busy;

  // Batch memory analysis: footprint summary for every selected model, in
  // parallel. Reuses the same per-model card layout as the BPA batch run.
  const runMemoryBatch = useCallback(async () => {
    if (!workspaceId || selectedModelPairs.length === 0) return;
    setError(null);
    setMemoryResults([]);
    setBusy('memory:scan');
    try {
      const datasets = selectedModelPairs.map((p) => ({ id: p.datasetId as string, name: p.name }));
      const res = await analyzeModelsParallel(workspaceId, datasets);
      setMemoryResults(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [workspaceId, selectedModelPairs]);

  // Batch IBCS orientation: for each selected report, scan (or apply) the
  // time-horizontal / category-vertical rule across its IBCS Multi-Tier visuals.
  const runIbcsBatch = useCallback(
    async (scanOnly: boolean) => {
      if (!workspaceId || selectedReportPairs.length === 0) return;
      setError(null);
      setIbcsResults([]);
      setBusy(`ibcs:${scanOnly ? 'scan' : 'apply'}`);
      const acc: IbcsBatchRun[] = [];
      for (const t of selectedReportPairs) {
        try {
          if (scanOnly) {
            const scan = await scanIbcsOrientation(workspaceId, t.reportId as string);
            acc.push({ pair: t, scan });
          } else {
            const fix = await applyIbcsOrientation(workspaceId, t.reportId as string);
            acc.push({ pair: t, fix });
          }
        } catch (e) {
          acc.push({ pair: t, error: e instanceof Error ? e.message : String(e) });
        }
        setIbcsResults([...acc]);
      }
      setBusy(null);
    },
    [workspaceId, selectedReportPairs]
  );

  const canRunMemoryBatch = !!workspaceId && selectedModelPairs.length > 0 && !busy;
  const canRunIbcsBatch = !!workspaceId && selectedReportPairs.length > 0 && !busy;

  // Fixers panel — rendered inside the Report Explorer "Fixers" sub-tab.
  const renderFixers = () => (
    <>
      <div className={styles.fixerGrid}>
        {FIXERS.map((f) => (
          <Card key={f.id} className={styles.fixerCard}>
            <div>
              <Text weight="semibold">{f.label}</Text>
              <div>
                <Text size={200} style={{ color: '#888' }}>
                  {f.description}
                </Text>
              </div>
            </div>
            <div className={styles.fixerActions}>
              <Button
                appearance="secondary"
                disabled={!canRunFixers}
                onClick={() => void run(f.id, true)}
              >
                {busy === `${f.id}:scan` ? 'Scanning…' : 'Scan'}
              </Button>
              <Button
                appearance="primary"
                disabled={!canRunFixers}
                onClick={() => void run(f.id, false)}
              >
                {busy === `${f.id}:apply` ? 'Applying…' : 'Apply'}
              </Button>
            </div>
          </Card>
        ))}
        <Card className={styles.fixerCard}>
          <div>
            <Text weight="semibold">Model BPA auto-fix</Text>
            <div>
              <Text size={200} style={{ color: '#888' }}>
                Run the Best Practice Analyzer across every selected model and apply the
                safe auto-fixes (summarize-by none, hide foreign keys).
              </Text>
            </div>
          </div>
          <div className={styles.fixerActions}>
            <Button
              appearance="secondary"
              disabled={!canRunModelFixers}
              onClick={() => void runModelFixers(true)}
            >
              {busy === 'model-bpa:scan' ? 'Scanning…' : 'Scan'}
            </Button>
            <Button
              appearance="primary"
              disabled={!canRunModelFixers}
              onClick={() => void runModelFixers(false)}
            >
              {busy === 'model-bpa:apply' ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        </Card>
        <Card className={styles.fixerCard}>
          <div>
            <Text weight="semibold">Memory footprint</Text>
            <div>
              <Text size={200} style={{ color: '#888' }}>
                Analyze the VertiPaq / Direct Lake footprint of every selected model and
                surface the largest columns and optimization findings per model.
              </Text>
            </div>
          </div>
          <div className={styles.fixerActions}>
            <Button
              appearance="secondary"
              disabled={!canRunMemoryBatch}
              onClick={() => void runMemoryBatch()}
            >
              {busy === 'memory:scan' ? 'Analyzing…' : 'Analyze'}
            </Button>
          </div>
        </Card>
        <Card className={styles.fixerCard}>
          <div>
            <Text weight="semibold">IBCS chart orientation</Text>
            <div>
              <Text size={200} style={{ color: '#888' }}>
                Apply the IBCS time-horizontal / category-vertical rule across the IBCS
                Multi-Tier visuals in every selected report.
              </Text>
            </div>
          </div>
          <div className={styles.fixerActions}>
            <Button
              appearance="secondary"
              disabled={!canRunIbcsBatch}
              onClick={() => void runIbcsBatch(true)}
            >
              {busy === 'ibcs:scan' ? 'Scanning…' : 'Scan'}
            </Button>
            <Button
              appearance="primary"
              disabled={!canRunIbcsBatch}
              onClick={() => void runIbcsBatch(false)}
            >
              {busy === 'ibcs:apply' ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        </Card>
      </div>

      {results.map(({ pair, result, error: runError }) => (
        <Card key={pair.key} className={styles.resultCard}>
          <Text weight="semibold">
            {pair.name}
            {result ? ` — ${result.fixerId} — ${result.scanOnly ? 'Scan' : 'Apply'}` : ''}
          </Text>
          {runError ? (
            <div>
              <Text size={300} style={{ color: '#b00' }}>
                {runError}
              </Text>
            </div>
          ) : result ? (
            <>
              <div>
                <Text size={300} style={{ color: '#555' }}>
                  Matched <strong>{result.matched}</strong>
                  {!result.scanOnly && (
                    <>
                      {' · '}Changed <strong>{result.changed}</strong>
                      {' · '}
                      {result.applied ? 'Written back ✓' : 'No changes written'}
                    </>
                  )}
                </Text>
              </div>
              {result.findings.length > 0 && (
                <ul className={styles.findingList}>
                  {result.findings.map((fd, i) => (
                    <li key={i}>
                      {fd.path} — {fd.detail}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </Card>
      ))}

      {memoryResults.map((m) => (
        <Card key={`memory-${m.datasetId}`} className={styles.resultCard}>
          <Text weight="semibold">{m.datasetName} — Memory footprint</Text>
          {m.error ? (
            <div>
              <Text size={300} style={{ color: '#b00' }}>
                {m.error}
              </Text>
            </div>
          ) : (
            <>
              <div>
                <Text size={300} style={{ color: '#555' }}>
                  {m.isDirectLake ? 'Direct Lake' : 'Import'} · Tables{' '}
                  <strong>{m.tableCount}</strong>
                  {' · '}Columns <strong>{m.columnCount}</strong>
                  {' · '}Rows <strong>{m.totalRows.toLocaleString()}</strong>
                  {' · '}
                  {m.hasActualSizes ? 'Size' : 'Est. size'}{' '}
                  <strong>{formatBytes(m.estTotalBytes)}</strong>
                  {' · '}Findings <strong>{m.findingCount}</strong>
                </Text>
              </div>
              <div>
                <Text size={200} style={{ color: '#888' }}>
                  Largest column: {m.topColumn} ({formatBytes(m.topColumnBytes)})
                </Text>
              </div>
            </>
          )}
        </Card>
      ))}

      {ibcsResults.map(({ pair, scan, fix, error: runError }) => (
        <Card key={`ibcs-${pair.key}`} className={styles.resultCard}>
          <Text weight="semibold">
            {pair.name} — IBCS orientation{scan ? ' — Scan' : fix ? ' — Apply' : ''}
          </Text>
          {runError ? (
            <div>
              <Text size={300} style={{ color: '#b00' }}>
                {runError}
              </Text>
            </div>
          ) : scan ? (
            <>
              <div>
                <Text size={300} style={{ color: '#555' }}>
                  IBCS visuals <strong>{scan.ibcsCount}</strong>
                  {' · '}Need change <strong>{scan.needsChange}</strong>
                </Text>
              </div>
              {scan.visuals.filter((v) => v.needsChange).length > 0 && (
                <ul className={styles.findingList}>
                  {scan.visuals
                    .filter((v) => v.needsChange)
                    .map((v, i) => (
                      <li key={i}>
                        {v.category || '(no category)'} — {v.current} → {v.recommended}
                      </li>
                    ))}
                </ul>
              )}
            </>
          ) : fix ? (
            <>
              <div>
                <Text size={300} style={{ color: '#555' }}>
                  Changed <strong>{fix.changed}</strong>
                  {' · '}
                  {fix.changed > 0 ? 'Written back ✓' : 'No changes written'}
                </Text>
              </div>
              {fix.updated.length > 0 && (
                <ul className={styles.findingList}>
                  {fix.updated.map((v, i) => (
                    <li key={i}>
                      {v.category || '(no category)'} — {v.current} → {v.recommended}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </Card>
      ))}

      {modelResults.map(({ pair, result, error: runError }) => (
        <Card key={`model-${pair.key}`} className={styles.resultCard}>
          <Text weight="semibold">
            {pair.name} — Model BPA
            {result ? ` — ${result.scanOnly ? 'Scan' : 'Apply'}` : ''}
          </Text>
          {runError ? (
            <div>
              <Text size={300} style={{ color: '#b00' }}>
                {runError}
              </Text>
            </div>
          ) : result ? (
            <>
              <div>
                <Text size={300} style={{ color: '#555' }}>
                  Findings <strong>{result.total}</strong>
                  {' · '}Auto-fixable <strong>{result.fixable}</strong>
                  {!result.scanOnly && (
                    <>
                      {' · '}Changed <strong>{result.changed}</strong>
                    </>
                  )}
                </Text>
              </div>
              {result.findings.length > 0 && (
                <ul className={styles.findingList}>
                  {result.findings.map((fd, i) => (
                    <li key={i}>
                      {fd.path} — {fd.rule}
                      {fd.detail ? ` — ${fd.detail}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </Card>
      ))}
    </>
  );

  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <div>
              <Text size={500} weight="semibold">
                Power BI Fixer
              </Text>
              <div>
                <Text size={200} style={{ color: '#888' }}>
                  Model &amp; report explorer · server-side fixers on Fabric User Data Functions
                </Text>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch
              checked={dark}
              onChange={(_, d) => setDark(!!d.checked)}
              labelPosition="before"
              label={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {dark ? <WeatherMoon20Regular /> : <WeatherSunny20Regular />}
                  {dark ? 'Dark' : 'Light'}
                </span>
              }
            />
            <Button appearance="subtle" icon={<SignOut20Regular />} onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </header>

        <main className={styles.main}>
          {error && (
            <MessageBar intent="error" style={{ marginBottom: '12px' }}>
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}

          {needsSignIn && (
            <MessageBar intent="warning" style={{ marginBottom: '12px' }}>
              <MessageBarBody>
                Sign in to Power BI to load your workspaces, reports and models. Choose the same
                account you use in the Fabric portal{user?.email ? ` (${user.email})` : ''}.
              </MessageBarBody>
              <MessageBarActions>
                <Button
                  appearance="primary"
                  size="small"
                  icon={<PlugConnected20Regular />}
                  disabled={busy === 'workspaces'}
                  onClick={() => void handleSignIn()}
                >
                  Sign in to Power BI
                </Button>
              </MessageBarActions>
            </MessageBar>
          )}

          <div className={styles.connectionBar}>
            <div className={styles.pickerCol}>
              <Text size={200} weight="semibold">
                Workspace
              </Text>
              <Combobox
                placeholder={busy === 'workspaces' ? 'Loading…' : 'Search a workspace'}
                value={wsText}
                selectedOptions={workspaceId ? [workspaceId] : []}
                onChange={(ev) => setWsText(ev.target.value)}
                onOptionSelect={(_, d) => {
                  setWorkspaceId(d.optionValue ?? '');
                  setWsText(d.optionText ?? '');
                }}
                onBlur={() => setWsText(workspaceName)}
                disabled={busy === 'workspaces'}
              >
                {wsFiltered.length === 0 ? (
                  <Option key="__none" value="__none" text="" disabled>
                    No matches
                  </Option>
                ) : (
                  wsFiltered.map((w) => (
                    <Option key={w.id} value={w.id} text={w.displayName}>
                      {w.displayName}
                    </Option>
                  ))
                )}
              </Combobox>
            </div>

            <div className={styles.pickerCol}>
              <Text size={200} weight="semibold">
                Report / Semantic Model
              </Text>
              <Combobox
                multiselect
                placeholder={busy === 'items' ? 'Loading…' : 'Search report(s) / model(s)'}
                value={pairQuery}
                selectedOptions={pairKeys}
                onChange={(ev) => setPairQuery(ev.target.value)}
                onOptionSelect={(_, d) => {
                  const keys = d.selectedOptions;
                  setPairKeys(keys);
                  const text =
                    keys.length === 0
                      ? ''
                      : keys.length === 1
                        ? pairs.find((p) => p.key === keys[0])?.name ?? ''
                        : `${keys.length} selected`;
                  setPairQuery(text);
                }}
                onBlur={() => setPairQuery(pairValue)}
                disabled={!workspaceId || busy === 'items'}
              >
                {pairGroupsFiltered.length === 0 ? (
                  <Option key="__none" value="__none" text="" disabled>
                    No matches
                  </Option>
                ) : (
                  pairGroupsFiltered.map(([folder, items]) => (
                    <OptionGroup key={folder || '__root'} label={folder || 'Workspace root'}>
                      {items.map((p) => {
                        const tag = !p.datasetId
                          ? ' · report only'
                          : !p.reportId
                            ? ' · model only'
                            : '';
                        return (
                          <Option key={p.key} value={p.key} text={p.name}>
                            {p.name}
                            {tag && <span style={{ color: GRAY_COLOR }}>{tag}</span>}
                          </Option>
                        );
                      })}
                    </OptionGroup>
                  ))
                )}
              </Combobox>
              {pairKeys.length > 1 && (
                <Text size={100} style={{ color: GRAY_COLOR }}>
                  {selectedReportPairs.length} report{selectedReportPairs.length === 1 ? '' : 's'} · {selectedModelPairs.length} model{selectedModelPairs.length === 1 ? '' : 's'} for fixers · explorers use the first
                </Text>
              )}
            </div>

            {busy && <Spinner size="tiny" label="Loading…" />}
          </div>

          <div className={mergeClasses(styles.tabsRegion, styles.tabsRegionLeft)}>
            <div className={styles.nav}>
              {NAV_GROUPS.map((g) => {
                const open = navGroupsOpen.has(g.id);
                return (
                  <div key={g.id}>
                    <button
                      type="button"
                      className={styles.navGroupHeader}
                      onClick={() => toggleNavGroup(g.id)}
                      aria-expanded={open}
                    >
                      <span className={styles.navGroupChevron}>
                        {open ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
                      </span>
                      {g.label}
                    </button>
                    {open && (
                      <div className={styles.navSub}>
                        {g.items?.map(renderNavItem)}
                        {g.subtopics?.map((st) => {
                          const stKey = `${g.id}:${st.id}`;
                          const stOpen = navSubtopicsOpen.has(stKey);
                          return (
                            <div key={st.id}>
                              <button
                                type="button"
                                className={styles.navSubtopicHeader}
                                onClick={() => toggleNavSubtopic(stKey)}
                                aria-expanded={stOpen}
                              >
                                <span className={styles.navSubtopicChevron}>
                                  {stOpen ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                                </span>
                                {st.label}
                              </button>
                              {stOpen && (
                                <div className={styles.navSubtopicItems}>
                                  {st.items.map(renderNavItem)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className={styles.navFooter}>
                <button
                  type="button"
                  className={mergeClasses(styles.navItem, tab === 'guidelines' && styles.navItemActive)}
                  onClick={() => selectTab('guidelines')}
                >
                  <span className={tab === 'guidelines' ? styles.navItemIconActive : styles.navItemIcon}>
                    <BookInformation20Regular />
                  </span>
                  Guidelines
                </button>
                <button
                  type="button"
                  className={mergeClasses(styles.navItem, tab === 'about' && styles.navItemActive)}
                  onClick={() => selectTab('about')}
                >
                  <span className={tab === 'about' ? styles.navItemIconActive : styles.navItemIcon}>
                    <Info20Regular />
                  </span>
                  About
                </button>
              </div>
            </div>

          <div className={styles.tabBody}>
            <Suspense
              fallback={
                <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
                  <Spinner size="small" label="Loading…" />
                </div>
              }
            >
            {/* Model Explorer and Report Explorer are independent tabs. Each
                stays mounted across tab switches so its loaded state (model
                tree, report definition, preview) is never lost; both mount on
                first visit to avoid eager loads/embeds. */}
            {visited.has('model') && (
              <div style={{ display: tab === 'model' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <ModelExplorer
                  workspaceId={workspaceId}
                  models={modelExplorerModels}
                  viewTab={modelView}
                  onViewTabChange={setModelView}
                />
              </div>
            )}

            {/* Report Explorer hosts three sub-views: the explorer itself plus
                IBCS and Fixers (previously top-level tabs). The wrapper stays
                mounted across tab switches so loaded state survives; each
                sub-view mounts on first visit to avoid eager loads/embeds. */}
            {visited.has('report') && (
              <div style={{ display: tab === 'report' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <TabList
                  selectedValue={reportSub}
                  onTabSelect={(_: SelectTabEvent, d: SelectTabData) => selectReportSub(d.value as ReportSub)}
                  style={{ flexShrink: 0, marginBottom: '8px' }}
                >
                  <Tab value="explorer" icon={<DocumentBulletList20Regular />}>
                    Explorer
                  </Tab>
                  <Tab value="ibcs" icon={<ChartMultiple20Regular />}>
                    IBCS
                  </Tab>
                  <Tab value="fixers" icon={<Wrench20Regular />}>
                    Fixers
                  </Tab>
                  <Tab value="bpa" icon={<ShieldCheckmark20Regular />}>
                    BPA
                  </Tab>
                  <Tab value="reverse" icon={<ArrowImport20Regular />}>
                    Reverse Prototype
                  </Tab>
                  <Tab value="forward" icon={<ArrowExport20Regular />}>
                    Forward Prototype
                  </Tab>
                  <Tab value="landing" icon={<Sparkle20Regular />}>
                    Landing Page
                  </Tab>
                  <Tab value="documentation" icon={<BookInformation20Regular />}>
                    Add Documentation Page
                  </Tab>
                  <Tab value="pbir" icon={<Code20Regular />}>
                    PBIR View
                  </Tab>
                </TabList>

                <div style={{ display: reportSub === 'explorer' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  <ReportExplorer
                    workspaceId={workspaceId}
                    reportId={reportId}
                    reportName={reportName}
                    onNavigateToModel={() => {
                      setTab('model');
                      setVisited((prev) => (prev.has('model') ? prev : new Set(prev).add('model')));
                    }}
                  />
                </div>

                {reportSubVisited.has('ibcs') && (
                  <div style={{ display: reportSub === 'ibcs' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <IbcsTools workspaceId={workspaceId} datasetId={datasetId} reportId={reportId} />
                  </div>
                )}

                {reportSub === 'fixers' && (
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto', gap: '16px' }}>
                    <div style={{ flexShrink: 0 }}>
                      <Text weight="semibold">IBCS chart formatting</Text>
                      <div style={{ marginTop: '8px', minHeight: '220px', display: 'flex', flexDirection: 'column' }}>
                        <IbcsChartFix workspaceId={workspaceId} reportId={reportId} reportName={reportName} />
                      </div>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <Text weight="semibold">Report structure</Text>
                      <div style={{ marginTop: '8px', minHeight: '220px', display: 'flex', flexDirection: 'column' }}>
                        <ReportStructFix workspaceId={workspaceId} reportId={reportId} reportName={reportName} datasetId={datasetId} datasetName={datasetName} />
                      </div>
                    </div>
                    {renderFixers()}
                  </div>
                )}

                {reportSubVisited.has('bpa') && (
                  <div style={{ display: reportSub === 'bpa' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <ReportBpa
                      workspaceId={workspaceId}
                      reportId={reportId}
                      reportName={reportName}
                      datasetId={datasetId}
                      datasetName={datasetName}
                    />
                  </div>
                )}

                {reportSubVisited.has('reverse') && (
                  <div style={{ display: reportSub === 'reverse' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <ReversePrototype workspaceId={workspaceId} reportId={reportId} reportName={reportName} />
                  </div>
                )}

                {reportSubVisited.has('forward') && (
                  <div style={{ display: reportSub === 'forward' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <ForwardPrototype workspaceId={workspaceId} datasetId={datasetId} datasetName={datasetName} />
                  </div>
                )}

                {reportSubVisited.has('landing') && (
                  <div style={{ display: reportSub === 'landing' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <LandingPage workspaceId={workspaceId} reportId={reportId} reportName={reportName} datasetId={datasetId} datasetName={datasetName} />
                  </div>
                )}

                {reportSubVisited.has('documentation') && (
                  <div style={{ display: reportSub === 'documentation' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <ModelDocumentation
                      workspaceId={workspaceId}
                      datasetId={datasetId}
                      datasetName={datasetName}
                      reportId={reportId}
                      reportName={reportName}
                    />
                  </div>
                )}

                {reportSubVisited.has('pbir') && (
                  <div style={{ display: reportSub === 'pbir' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <DefinitionSource workspaceId={workspaceId} reportId={reportId} only="report" autoLoad />
                  </div>
                )}
              </div>
            )}

            {visited.has('descriptions') && (
              <div style={{ display: tab === 'descriptions' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <DescriptionsTab workspaceId={workspaceId} datasetId={datasetId} datasetName={datasetName} />
              </div>
            )}

            {visited.has('field-parameters') && (
              <div style={{ display: tab === 'field-parameters' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <FieldParameters workspaceId={workspaceId} datasetId={datasetId} datasetName={datasetName} />
              </div>
            )}

            {visited.has('refresh-tools') && (
              <div style={{ display: tab === 'refresh-tools' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <RefreshTools workspaceId={workspaceId} datasetId={datasetId} datasetName={datasetName} />
              </div>
            )}

            {visited.has('perspectives') && (
              <div style={{ display: tab === 'perspectives' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <PerspectivesEditor workspaceId={workspaceId} datasetId={datasetId} datasetName={datasetName} />
              </div>
            )}
            {visited.has('diagram') && (
              <div style={{ display: tab === 'diagram' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <ModelDiagram workspaceId={workspaceId} datasetId={datasetId} datasetName={datasetName} />
              </div>
            )}
            {visited.has('history') && (
              <div style={{ display: tab === 'history' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <HistoryTab workspaceId={workspaceId} datasetId={datasetId} datasetName={datasetName} />
              </div>
            )}
            {visited.has('metric-view') && (
              <div style={{ display: tab === 'metric-view' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <MetricViewMigration workspaceId={workspaceId} datasetId={datasetId} datasetName={datasetName} />
              </div>
            )}
            {visited.has('tmdl-runner') && (
              <div style={{ display: tab === 'tmdl-runner' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <TmdlRunner workspaceId={workspaceId} datasetId={datasetId} datasetName={datasetName} />
              </div>
            )}
            {visited.has('cleanup') && (
              <div style={{ display: tab === 'cleanup' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <UnusedCleanup workspaceId={workspaceId} datasetId={datasetId} datasetName={datasetName} />
              </div>
            )}

            {visited.has('sempy') && (
              <div style={{ display: tab === 'sempy' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <SempyRunnerTab
                  workspaceId={workspaceId}
                  workspaceName={workspaceName}
                  datasetName={datasetName}
                  reportName={reportName}
                />
              </div>
            )}

            {visited.has('jumpstart') && (
              <div style={{ display: tab === 'jumpstart' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <JumpstartTab workspaceId={workspaceId} workspaceName={workspaceName} dark={dark} />
              </div>
            )}

            {visited.has('rayfin-apps') && (
              <div style={{ display: tab === 'rayfin-apps' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <RayfinAppsTab />
              </div>
            )}

            {visited.has('monitoring') && (
              <div style={{ display: tab === 'monitoring' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <MonitoringTab workspaceId={workspaceId} workspaceName={workspaceName} />
              </div>
            )}

            {visited.has('workspace-editor') && (
              <div style={{ display: tab === 'workspace-editor' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <WorkspaceEditorTab workspaceId={workspaceId} workspaceName={workspaceName} />
              </div>
            )}

            {visited.has('guidelines') && (
              <div style={{ display: tab === 'guidelines' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <GuidelinesTab />
              </div>
            )}
            {visited.has('about') && (
              <div style={{ display: tab === 'about' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <AboutTab />
              </div>
            )}
            </Suspense>
          </div>
          </div>
        </main>
      </div>
    </FluentProvider>
  );
}


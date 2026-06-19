import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Text,
  Badge,
  Dropdown,
  Option,
  MessageBar,
  MessageBarBody,
  Link,
  Tooltip,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import { Open20Regular, Copy20Regular, Checkmark20Regular } from '@fluentui/react-icons';

import {
  RAYFIN_APPS,
  AWESOME_RAYFIN_REPO,
  rayfinAppRepoUrl,
  rayfinDeployCommand,
  rayfinGalleryCommand,
  type RayfinApp,
  type RayfinAppCategory,
} from '@/services/rayfinApps';
import { BORDER_COLOR, SECTION_BG, GRAY_COLOR } from '@/explorer/theme';

const CATEGORY_FILTERS: ('All' | RayfinAppCategory)[] = ['All', 'App', 'Game', 'Tool', 'Starter'];

const CATEGORY_COLOR: Record<RayfinAppCategory, 'brand' | 'success' | 'informative' | 'warning'> = {
  App: 'brand',
  Game: 'success',
  Tool: 'informative',
  Starter: 'warning',
};

const useStyles = makeStyles({
  root: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ...shorthands.gap('12px') },
  intro: { display: 'flex', flexDirection: 'column', ...shorthands.gap('4px') },
  toolbar: { display: 'flex', alignItems: 'center', ...shorthands.gap('10px'), flexWrap: 'wrap' },
  grid: {
    flex: 1,
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gridAutoRows: 'auto',
    alignItems: 'stretch',
    alignContent: 'start',
    ...shorthands.gap('12px'),
    overflowY: 'auto',
    ...shorthands.padding('2px'),
  },
  card: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '440px', ...shorthands.gap('8px'), ...shorthands.padding('14px') },
  cardHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', ...shorthands.gap('8px') },
  tags: { display: 'flex', ...shorthands.gap('6px'), flexWrap: 'wrap', alignItems: 'center' },
  stackTags: { display: 'flex', ...shorthands.gap('4px'), flexWrap: 'wrap' },
  stackTag: {
    fontSize: '11px',
    color: '#555',
    backgroundColor: SECTION_BG,
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('10px'),
    ...shorthands.padding('1px', '8px'),
  },
  desc: { color: '#555', fontSize: '13px' },
  cmd: {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '11.5px',
    whiteSpace: 'pre-wrap',
    color: '#333',
    backgroundColor: SECTION_BG,
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('6px'),
    ...shorthands.padding('8px', '10px'),
    ...shorthands.margin('0'),
  },
  cardActions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...shorthands.gap('8px'), marginTop: 'auto' },
});

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function RayfinAppsTab() {
  const styles = useStyles();
  const [categoryFilter, setCategoryFilter] = useState<'All' | RayfinAppCategory>('All');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [galleryCopied, setGalleryCopied] = useState(false);

  const items = useMemo(
    () => (categoryFilter === 'All' ? RAYFIN_APPS : RAYFIN_APPS.filter((a) => a.category === categoryFilter)),
    [categoryFilter]
  );

  const copyDeploy = useCallback(async (app: RayfinApp) => {
    const ok = await copyText(rayfinDeployCommand(app));
    if (ok) {
      setCopiedSlug(app.slug);
      window.setTimeout(() => setCopiedSlug((s) => (s === app.slug ? null : s)), 2500);
    }
  }, []);

  const copyGallery = useCallback(async () => {
    const ok = await copyText(rayfinGalleryCommand());
    if (ok) {
      setGalleryCopied(true);
      window.setTimeout(() => setGalleryCopied(false), 2500);
    }
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <Text weight="semibold" size={400}>
          Rayfin Apps
        </Text>
        <Text size={200} style={{ color: GRAY_COLOR }}>
          One-click deploy full Fabric apps from the{' '}
          <Link href={AWESOME_RAYFIN_REPO} target="_blank" rel="noreferrer">
            Awesome Rayfin
          </Link>{' '}
          gallery. Each app is scaffolded and deployed with the Rayfin CLI (which runs on your
          machine) — copy its deploy command (workspace + tenant pre-filled from this app) and run
          it in a terminal.
        </Text>
      </div>

      <MessageBar intent="info">
        <MessageBarBody>
          Rayfin apps deploy from the CLI, not from this page (the CLI scaffolds source, builds and
          uploads to Fabric). Use the buttons below to copy a ready-to-run deploy command.
        </MessageBarBody>
      </MessageBar>

      <div className={styles.toolbar}>
        <Text size={200} weight="semibold">
          Category
        </Text>
        <Dropdown
          style={{ minWidth: '160px' }}
          value={categoryFilter}
          selectedOptions={[categoryFilter]}
          onOptionSelect={(_, d) =>
            setCategoryFilter((d.optionValue as 'All' | RayfinAppCategory) ?? 'All')
          }
        >
          {CATEGORY_FILTERS.map((c) => (
            <Option key={c} value={c} text={c}>
              {c}
            </Option>
          ))}
        </Dropdown>
        <Text size={200} style={{ color: GRAY_COLOR }}>
          {items.length} app{items.length === 1 ? '' : 's'}
        </Text>
        <div style={{ flex: 1 }} />
        <Tooltip content="Copy the gallery scaffold command (interactive picker)" relationship="label">
          <Button
            appearance="secondary"
            icon={galleryCopied ? <Checkmark20Regular /> : <Copy20Regular />}
            onClick={() => void copyGallery()}
          >
            {galleryCopied ? 'Copied' : 'Copy gallery command'}
          </Button>
        </Tooltip>
      </div>

      <div className={styles.grid}>
        {items.map((app) => {
          const copied = copiedSlug === app.slug;
          return (
            <Card key={app.slug} className={styles.card}>
              <div className={styles.cardHead}>
                <Text weight="semibold">{app.name}</Text>
                <div className={styles.tags}>
                  <Badge appearance="tint" color={CATEGORY_COLOR[app.category]}>
                    {app.category}
                  </Badge>
                  {app.experimental && (
                    <Badge appearance="outline" color="warning">
                      Experimental
                    </Badge>
                  )}
                </div>
              </div>

              <Text className={styles.desc}>{app.description}</Text>

              <div className={styles.tags}>
                <Badge appearance="outline" color={app.fabricAuth ? 'success' : 'subtle'}>
                  {app.fabricAuth ? 'Fabric auth ✓' : 'Local auth'}
                </Badge>
                <Badge appearance="outline" color={app.fabricData ? 'success' : 'subtle'}>
                  {app.fabricData ? 'Rayfin data ✓' : 'No data model'}
                </Badge>
              </div>

              <div className={styles.stackTags}>
                {app.stack.map((s) => (
                  <span key={s} className={styles.stackTag}>
                    {s}
                  </span>
                ))}
              </div>

              <pre className={styles.cmd}>{rayfinDeployCommand(app)}</pre>

              <div className={styles.cardActions}>
                <Link href={rayfinAppRepoUrl(app.slug)} target="_blank" rel="noreferrer">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Open20Regular fontSize={14} /> View on GitHub
                  </span>
                </Link>
                <Button
                  appearance="primary"
                  icon={copied ? <Checkmark20Regular /> : <Copy20Regular />}
                  onClick={() => void copyDeploy(app)}
                >
                  {copied ? 'Copied' : 'Copy deploy command'}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

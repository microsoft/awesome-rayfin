import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Text,
  Badge,
  Dropdown,
  Option,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarActions,
  Link,
  makeStyles,
  shorthands,
} from '@fluentui/react-components';
import { Rocket20Regular, Open20Regular, ArrowSync20Regular } from '@fluentui/react-icons';

import {
  JUMPSTARTS,
  JUMPSTART_CATALOG_URL,
  jumpstartDocUrl,
  jumpstartImageUrl,
  deployJumpstart,
  type Jumpstart,
  type JumpstartType,
  type JumpstartDeployResult,
} from '@/services/jumpstart';
import { PbiSignInRequiredError } from '@/services/fabricAuth';
import { BORDER_COLOR, SECTION_BG, GRAY_COLOR } from '@/explorer/theme';

interface JumpstartTabProps {
  workspaceId: string;
  workspaceName: string;
  dark?: boolean;
}

const TYPE_FILTERS: ('All' | JumpstartType)[] = ['All', 'Accelerator', 'Demo', 'Tutorial'];

const TYPE_COLOR: Record<JumpstartType, 'brand' | 'success' | 'informative'> = {
  Accelerator: 'brand',
  Demo: 'success',
  Tutorial: 'informative',
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
  card: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '320px', ...shorthands.gap('8px'), ...shorthands.padding('14px') },
  imageBanner: {
    height: '120px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SECTION_BG,
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('6px'),
    ...shorthands.overflow('hidden'),
  },
  image: { maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' },
  cardHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', ...shorthands.gap('8px') },
  tags: { display: 'flex', ...shorthands.gap('6px'), flexWrap: 'wrap', alignItems: 'center' },
  workloadTags: { display: 'flex', ...shorthands.gap('4px'), flexWrap: 'wrap' },
  workloadTag: {
    fontSize: '11px',
    color: '#555',
    backgroundColor: SECTION_BG,
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('10px'),
    ...shorthands.padding('1px', '8px'),
  },
  desc: { color: '#555', fontSize: '13px' },
  cardActions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...shorthands.gap('8px'), marginTop: 'auto' },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
    ...shorthands.padding('6px', '10px'),
    backgroundColor: SECTION_BG,
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('6px'),
  },
});

export function JumpstartTab({ workspaceId, workspaceName, dark }: JumpstartTabProps) {
  const styles = useStyles();
  const [typeFilter, setTypeFilter] = useState<'All' | JumpstartType>('All');
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [deployed, setDeployed] = useState<Record<string, JumpstartDeployResult>>({});
  const [progressMap, setProgressMap] = useState<Record<string, string>>({});
  const [startTimes, setStartTimes] = useState<Record<string, number>>({});
  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});
  const [, setTick] = useState(0);

  const anyBusy = Object.keys(busyMap).length > 0;

  // A single ticking clock re-renders every in-flight card so each shows its own
  // live elapsed-seconds counter. Deploys run in parallel — keyed by slug.
  useEffect(() => {
    if (!anyBusy) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, [anyBusy]);

  const items = useMemo(
    () => (typeFilter === 'All' ? JUMPSTARTS : JUMPSTARTS.filter((j) => j.type === typeFilter)),
    [typeFilter]
  );

  const deploy = useCallback(
    async (js: Jumpstart) => {
      if (!workspaceId) return;
      setBusyMap((prev) => ({ ...prev, [js.slug]: true }));
      setStartTimes((prev) => ({ ...prev, [js.slug]: Date.now() }));
      setProgressMap((prev) => ({ ...prev, [js.slug]: 'Starting…' }));
      setError(null);
      setNeedsSignIn(false);
      try {
        const res = await deployJumpstart(workspaceId, js, (msg) =>
          setProgressMap((prev) => ({ ...prev, [js.slug]: msg }))
        );
        setDeployed((prev) => ({ ...prev, [js.slug]: res }));
      } catch (e: unknown) {
        if (e instanceof PbiSignInRequiredError) setNeedsSignIn(true);
        else setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyMap((prev) => {
          const next = { ...prev };
          delete next[js.slug];
          return next;
        });
        setProgressMap((prev) => {
          const next = { ...prev };
          delete next[js.slug];
          return next;
        });
      }
    },
    [workspaceId]
  );

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <Text weight="semibold" size={400}>
          Fabric Jumpstart
        </Text>
        <Text size={200} style={{ color: GRAY_COLOR }}>
          Deploy a jumpstart into the selected workspace. Each one creates a Fabric notebook that
          installs the solution via the <code>fabric-jumpstart</code> package — open it and run all
          cells to provision the items. Browse the full{' '}
          <Link href={JUMPSTART_CATALOG_URL} target="_blank" rel="noreferrer">
            catalog
          </Link>
          .
        </Text>
      </div>

      {!workspaceId && (
        <MessageBar intent="info">
          <MessageBarBody>Select a workspace above to deploy a jumpstart into it.</MessageBarBody>
        </MessageBar>
      )}

      {needsSignIn && (
        <MessageBar intent="warning">
          <MessageBarBody>
            Sign in to Power BI (top of the page) before deploying — the same account you use in the
            Fabric portal.
          </MessageBarBody>
        </MessageBar>
      )}

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <div className={styles.toolbar}>
        <Text size={200} weight="semibold">
          Type
        </Text>
        <Dropdown
          style={{ minWidth: '160px' }}
          value={typeFilter}
          selectedOptions={[typeFilter]}
          onOptionSelect={(_, d) => setTypeFilter((d.optionValue as 'All' | JumpstartType) ?? 'All')}
        >
          {TYPE_FILTERS.map((t) => (
            <Option key={t} value={t} text={t}>
              {t}
            </Option>
          ))}
        </Dropdown>
        <Text size={200} style={{ color: GRAY_COLOR }}>
          {items.length} jumpstart{items.length === 1 ? '' : 's'}
          {workspaceName ? ` · target: ${workspaceName}` : ''}
        </Text>
        <Button
          appearance="subtle"
          size="small"
          icon={<ArrowSync20Regular />}
          as="a"
          href={JUMPSTART_CATALOG_URL}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: 'auto' }}
        >
          Check for new items
        </Button>
      </div>

      <div className={styles.grid}>
        {items.map((js) => {
          const done = deployed[js.slug];
          const busy = !!busyMap[js.slug];
          const elapsed =
            busy && startTimes[js.slug]
              ? Math.floor((Date.now() - startTimes[js.slug]) / 1000)
              : 0;
          return (
            <Card key={js.slug} className={styles.card}>
              {!imgFailed[js.slug] && (
                <div className={styles.imageBanner}>
                  <img
                    className={styles.image}
                    src={jumpstartImageUrl(js.slug, dark)}
                    alt={`${js.name} architecture diagram`}
                    loading="lazy"
                    onError={() => setImgFailed((prev) => ({ ...prev, [js.slug]: true }))}
                  />
                </div>
              )}
              <div className={styles.cardHead}>
                <Text weight="semibold">{js.name}</Text>
                <div className={styles.tags}>
                  <Badge appearance="tint" color={TYPE_COLOR[js.type]}>
                    {js.type}
                  </Badge>
                  <Badge appearance="outline" color="subtle">
                    {js.difficulty}
                  </Badge>
                </div>
              </div>

              <Text className={styles.desc}>{js.description}</Text>

              <div className={styles.workloadTags}>
                {js.workloads.map((w) => (
                  <span key={w} className={styles.workloadTag}>
                    {w}
                  </span>
                ))}
              </div>

              {busy && (
                <div className={styles.progressRow}>
                  <Spinner size="tiny" />
                  <Text size={200} style={{ color: GRAY_COLOR }}>
                    {progressMap[js.slug] || 'Deploying…'} · {elapsed}s elapsed
                  </Text>
                </div>
              )}

              {done && (
                <MessageBar intent="success">
                  <MessageBarBody>
                    Notebook “{done.notebookName}” created. Open it and run all cells.
                  </MessageBarBody>
                  <MessageBarActions>
                    <Button
                      appearance="transparent"
                      size="small"
                      icon={<Open20Regular />}
                      as="a"
                      href={done.portalUrl}
                      target="_blank"
                    >
                      Open notebook
                    </Button>
                  </MessageBarActions>
                </MessageBar>
              )}

              <div className={styles.cardActions}>
                <Link href={jumpstartDocUrl(js.slug)} target="_blank" rel="noreferrer">
                  Details
                </Link>
                <Button
                  appearance="primary"
                  icon={busy ? <Spinner size="tiny" /> : <Rocket20Regular />}
                  disabled={!workspaceId || busy}
                  onClick={() => void deploy(js)}
                >
                  {busy ? `Deploying… (${elapsed}s)` : done ? 'Deploy again' : 'Deploy'}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

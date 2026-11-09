import { useState } from 'react';

import { useT } from '@/i18n';
import { MEMBER_EXPORT_COLUMNS } from '@/um/domain/sheet';
import { memberExportRows, rowsForKind } from '@/um/domain/views';
import type { TargetKind } from '@/um/domain/types';
import { useUm } from '@/um/hooks/UmContext';
import { downloadBlob, writeSheet } from '@/um/services/excelClient';

import { DiscoveredPanel } from './DiscoveredPanel';
import { GroupCard } from './GroupCard';
import { BindingList, Button, Card, Empty, Notice, Pill, Section } from './parts';
import { RequestBox } from './Requests';

const KEYS = {
  Workspace: { title: 'um.tab.workspaces.title', intro: 'um.tab.workspaces.intro', file: 'workspace-members' },
  Audience: { title: 'um.tab.audiences.title', intro: 'um.tab.audiences.intro', file: 'audience-members' },
  ModelRole: { title: 'um.tab.modelRoles.title', intro: 'um.tab.modelRoles.intro', file: 'model-role-members' },
} as const;

/** One of the three tabs. Read-only in this version. */
export function TargetTab({ kind }: { kind: TargetKind }) {
  const t = useT();
  const { rows, isAppAdmin, graphStatus, loading, loadMembers, members } = useUm();
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  const mine = rowsForKind(rows, kind);
  const manage = mine.filter((r) => r.access === 'manage');
  const available = mine.filter((r) => r.access === 'request-view');
  const keys = KEYS[kind];

  const exportMembers = async () => {
    setExporting(true);
    setExportFailed(false);
    try {
      const loaded = { ...members };
      for (const row of manage) {
        const id = row.group.groupId.toLowerCase();
        if (!loaded[id] || loaded[id].state !== 'ok') loaded[id] = await loadMembers(id, true);
      }
      const blob = await writeSheet({ sheetName: 'Members', columns: MEMBER_EXPORT_COLUMNS, rows: memberExportRows(manage, loaded) });
      downloadBlob(blob, `${keys.file}.xlsx`);
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{t(keys.title)}</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t(keys.intro)}</p>
      </div>

      {graphStatus === 'connected' && !loading && (
        <>
          <Section
            title={t('um.rows.manage.title')}
            actions={
              manage.length > 0 ? (
                <Button onClick={() => void exportMembers()} disabled={exporting}>
                  {exporting ? t('um.export.working') : t('um.export.members')}
                </Button>
              ) : undefined
            }
          >
            {exportFailed && <Notice tone="alert">{t('um.export.failed')}</Notice>}
            {manage.length === 0 ? (
              <Empty>{t('um.rows.manage.empty')}</Empty>
            ) : (
              <div className="space-y-3">
                {manage.map((row) => (
                  <GroupCard key={row.group.id} row={row} />
                ))}
              </div>
            )}
          </Section>

          <Section title={t('um.rows.request.title')}>
            {available.length === 0 ? (
              <Empty>{t('um.rows.request.empty')}</Empty>
            ) : (
              <div className="space-y-3">
                {available.map((row) => (
                  <Card key={row.group.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-semibold text-gray-900">{row.group.nameSnapshot}</h4>
                      <Pill tone={row.isMember ? 'good' : 'neutral'}>{t(row.isMember ? 'um.row.youAreMember' : 'um.row.youAreNotMember')}</Pill>
                    </div>
                    {row.group.description && <p className="mt-1 text-sm text-gray-600">{row.group.description}</p>}
                    <div className="mt-3">
                      <BindingList bindings={row.bindings} />
                    </div>
                    <RequestBox row={row} />
                  </Card>
                ))}
              </div>
            )}
          </Section>

          {isAppAdmin && <DiscoveredPanel kind={kind} />}
        </>
      )}
    </div>
  );
}

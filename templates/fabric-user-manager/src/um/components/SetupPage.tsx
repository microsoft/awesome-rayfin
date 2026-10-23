import { useEffect, useMemo, useRef, useState } from 'react';

import { useT, type Translate } from '@/i18n';
import { isHighRoleGroup, mergeBindings, type Finding } from '@/um/domain/discovery';
import { NO, SHEET_COLUMNS, SHEET_NAME, YES, editableOf, planImport, toSheetRows, type EditableFields, type ImportPlan, type SheetRow } from '@/um/domain/sheet';
import type { Binding, ManagedGroup } from '@/um/domain/types';
import { useUm } from '@/um/hooks/UmContext';
import { downloadBlob, readSheet, writeSheet } from '@/um/services/excelClient';
import { createdNotActivated } from '@/um/services/groupCreation';
import { reconcilePending } from '@/um/services/memberChanges';
import { applyImport, rollbackImport, saveFields } from '@/um/services/operations';
import type { AuditEntry } from '@/um/services/store';

import { ActivateById } from './ActivateById';
import { GrantNotices } from './DiscoveredPanel';
import { GroupCreate } from './GroupCreate';
import { GuidelinesSetupCard } from './GuidelinesSetup';
import { PermissionChecklist } from './Permissions';
import { BindingList, Button, Card, Empty, Notice, Pill, Section } from './parts';
import { failureText } from './text';

function findingText(t: Translate, f: Finding): string {
  switch (f.type) {
    case 'direct-user':
    case 'service-principal':
      return t(`um.finding.${f.type}`, { principal: f.principalName || f.principalId, role: f.role, workspace: f.workspaceName });
    case 'tenant-wide':
      return t('um.finding.tenant-wide', { role: f.role, workspace: f.workspaceName });
    case 'audience-direct':
      return t('um.finding.audience-direct', { principal: f.principalName, audience: f.audience, workspace: f.workspaceName });
    case 'ineligible-group':
      return t('um.finding.ineligible-group', { group: f.groupName, reasons: f.reasons.map((r) => t(`um.inelig.${r}`)).join(', ') });
    case 'multi-bound':
    case 'nested-group':
      return t(`um.finding.${f.type}`, { group: f.groupName, count: f.count });
    case 'no-owner':
      return t('um.finding.no-owner', { group: f.groupName });
    case 'high-role-owner':
      return t('um.finding.high-role-owner', { group: f.groupName, role: f.role, workspace: f.workspaceName, owners: f.ownerNames.join(', ') });
    case 'high-role-unknown':
      return t('um.finding.high-role-unknown', { group: f.groupName, role: f.role, workspace: f.workspaceName });
  }
}

const HIGH_IMPACT: readonly Finding['type'][] = ['high-role-owner', 'high-role-unknown', 'tenant-wide'];

function StatusLine({ label, good, text }: { label: string; good: boolean; text: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="text-sm text-gray-700">{label}</span>
      <Pill tone={good ? 'good' : 'warn'}>{text}</Pill>
    </li>
  );
}

function GroupEditor({ group, bindings }: { group: ManagedGroup; bindings: Binding[] }) {
  const t = useT();
  const { deps, reload } = useUm();
  const highRole = isHighRoleGroup(bindings);
  const [fields, setFields] = useState<EditableFields>(editableOf(group));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'alert'; text: string } | null>(null);
  const dirty = JSON.stringify(fields) !== JSON.stringify(editableOf(group));

  useEffect(() => setFields(editableOf(group)), [group]);

  const save = async () => {
    if (!deps) return;
    setBusy(true);
    setMessage(null);
    try {
      await saveFields(deps, group, fields, highRole);
      await reload();
      setMessage({ tone: 'info', text: t('um.setup.groups.saved') });
    } catch (e) {
      setMessage({ tone: 'alert', text: failureText(t, e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold text-gray-900">{group.nameSnapshot}</h4>
        {!group.active && <Pill>{t('um.row.inactive')}</Pill>}
        {highRole && <Pill tone="alert">{t('um.row.highRole')}</Pill>}
      </div>
      <div className="mt-2">
        <BindingList bindings={bindings} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={fields.requestable} disabled={highRole} onChange={(e) => setFields({ ...fields, requestable: e.target.checked })} />
          {t('um.activate.requestable')}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={fields.active} onChange={(e) => setFields({ ...fields, active: e.target.checked })} />
          {t('um.setup.groups.active')}
        </label>
        <label className="block text-sm text-gray-800 sm:col-span-2">
          {t('um.activate.description')}
          <textarea
            value={fields.description}
            maxLength={1000}
            rows={2}
            onChange={(e) => setFields({ ...fields, description: e.target.value })}
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm text-gray-800">
          {t('um.activate.maxDays')}
          <input
            type="number"
            min={0}
            max={3650}
            value={fields.maxDays}
            onChange={(e) => setFields({ ...fields, maxDays: Number(e.target.value) })}
            className="mt-1 block w-32 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      {message && (
        <div className="mt-3">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      <div className="mt-3">
        <Button primary onClick={() => void save()} disabled={!dirty || busy || !deps}>
          {t('um.setup.groups.save')}
        </Button>
      </div>
    </Card>
  );
}

function SheetSection({ bindingsOf }: { bindingsOf: (groupId: string) => Binding[] }) {
  const t = useT();
  const { deps, managed, storedBindings, reload } = useUm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'alert'; text: string } | null>(null);

  const lastImportId = useMemo(() => {
    const withImport = managed.filter((g) => g.importId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return withImport[0]?.importId;
  }, [managed]);

  const exportSheet = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const all = managed.flatMap((g) => bindingsOf(g.groupId));
      const blob = await writeSheet({
        sheetName: SHEET_NAME,
        columns: SHEET_COLUMNS,
        rows: toSheetRows(managed, all),
        choices: { Requestable: [YES, NO], Active: [YES, NO], Target: ['Audience', 'Model role'], Source: ['Attested'] },
        spareRows: 200,
      });
      downloadBlob(blob, 'fabric-user-manager-groups.xlsx');
    } catch {
      setMessage({ tone: 'alert', text: t('um.export.failed') });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    setPlan(null);
    try {
      const table = await readSheet(file);
      const highRole = new Set(managed.filter((g) => isHighRoleGroup(bindingsOf(g.groupId))).map((g) => g.groupId.toLowerCase()));
      const rows = table.rows.map((r) => Object.fromEntries(SHEET_COLUMNS.map((c) => [c, r[c] ?? ''])) as SheetRow);
      setPlan(planImport(table.header, rows, { groups: managed, bindings: storedBindings, highRoleGroupIds: highRole }));
    } catch (e) {
      const code = e instanceof Error ? e.message : 'failed';
      const known = ['too-large', 'not-a-workbook', 'no-sheet'] as const;
      const key = (known as readonly string[]).includes(code) ? (code as (typeof known)[number]) : 'failed';
      setMessage({ tone: 'alert', text: t(`um.sheet.read.${key}`) });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const apply = async () => {
    if (!deps || !plan?.ok) return;
    setBusy(true);
    try {
      const result = await applyImport(deps, plan, managed, storedBindings);
      await reload();
      setPlan(null);
      setMessage({ tone: 'info', text: t('um.setup.sheet.applied', { count: result.applied }) });
    } catch (e) {
      await reload();
      setMessage({ tone: 'alert', text: failureText(t, e) });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!deps || !lastImportId) return;
    setBusy(true);
    try {
      const highRole = new Set(managed.filter((g) => isHighRoleGroup(bindingsOf(g.groupId))).map((g) => g.groupId.toLowerCase()));
      const result = await rollbackImport(deps, lastImportId, managed, highRole);
      await reload();
      const text = [
        t('um.setup.sheet.rolledBack', { count: result.restored }),
        result.skipped > 0 ? t('um.setup.sheet.rollbackSkipped', { count: result.skipped }) : '',
      ]
        .filter(Boolean)
        .join(' ');
      setMessage({ tone: result.skipped > 0 ? 'alert' : 'info', text });
    } catch (e) {
      await reload();
      setMessage({ tone: 'alert', text: failureText(t, e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={t('um.setup.sheet.title')}
      intro={t('um.setup.sheet.intro')}
      actions={
        <>
          <Button onClick={() => void exportSheet()} disabled={busy}>
            {t('um.setup.sheet.export')}
          </Button>
          <Button onClick={() => fileInput.current?.click()} disabled={busy}>
            {t('um.setup.sheet.import')}
          </Button>
          {lastImportId && (
            <Button onClick={() => void undo()} disabled={busy}>
              {t('um.setup.sheet.rollback')}
            </Button>
          )}
        </>
      }
    >
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx"
        className="hidden"
        aria-label={t('um.setup.sheet.import')}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {plan && !plan.ok && (
        <Notice tone="alert">
          <p className="font-medium">{t('um.setup.sheet.errors')}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {plan.errors.slice(0, 50).map((e, index) => (
              <li key={index}>
                {t('um.setup.sheet.line', { line: e.line, issue: t(`um.sheet.issue.${e.issue}`) })}
                {e.detail ? ` (${e.detail})` : ''}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {plan?.ok && (
        <Card>
          <p className="font-medium text-gray-900">{t('um.setup.sheet.plan.title')}</p>
          {plan.changes.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">{t('um.setup.sheet.plan.noChanges')}</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm text-gray-800">
              {plan.changes.map((c) => (
                <li key={c.groupId}>
                  <span className="font-medium">{c.name}</span>
                  {': '}
                  {[
                    c.fieldsChanged.length > 0 ? t('um.change.fields', { fields: c.fieldsChanged.map((f) => t(`um.field.${f}`)).join(', ') }) : '',
                    c.attestedAdded.length > 0 ? t('um.change.attestedAdded', { count: c.attestedAdded.length }) : '',
                    c.attestedRemoved.length > 0 ? t('um.change.attestedRemoved', { count: c.attestedRemoved.length }) : '',
                  ]
                    .filter(Boolean)
                    .join('; ')}
                </li>
              ))}
            </ul>
          )}
          {plan.untouched > 0 && <p className="mt-2 text-xs text-gray-500">{t('um.setup.sheet.untouched', { count: plan.untouched })}</p>}
          <div className="mt-3 flex gap-2">
            {plan.changes.length > 0 && (
              <Button primary onClick={() => void apply()} disabled={busy || !deps}>
                {t('um.setup.sheet.apply', { count: plan.changes.length })}
              </Button>
            )}
            <Button onClick={() => setPlan(null)} disabled={busy}>
              {t('um.activate.cancel')}
            </Button>
          </div>
        </Card>
      )}
    </Section>
  );
}

/** App admins only: status, findings, activated groups, the optional sheet, the log. */
export function SetupPage() {
  const t = useT();
  const { isAppAdmin, services, identity, storeReachable, managed, storedBindings, discovery, discover, graphStatus, writesInBuild, armed, setArmed, bindingsArmed, setBindingsArmed, groupsArmed, setGroupsArmed } = useUm();
  const [switchFailed, setSwitchFailed] = useState(false);
  const [log, setLog] = useState<AuditEntry[] | null>(null);
  const [created, setCreated] = useState<{ groupId: string; name: string }[]>([]);
  const [logTick, setLogTick] = useState(0);

  const discovered = discovery.result?.bindings;
  const bindingsOf = useMemo(
    () => (groupId: string) => {
      const id = groupId.toLowerCase();
      return mergeBindings(
        (discovered ?? []).filter((b) => b.groupId.toLowerCase() === id),
        storedBindings.filter((b) => b.groupId.toLowerCase() === id)
      );
    },
    [discovered, storedBindings]
  );

  useEffect(() => {
    if (!isAppAdmin) return;
    void (async () => {
      try {
        let entries = await services.store.listAudit();
        // Intents without an outcome are closed against what Entra shows now.
        if (identity && writesInBuild && (await reconcilePending({ store: services.store, directory: services.directory, fabric: services.fabric, actor: identity }, entries)) > 0) {
          entries = await services.store.listAudit();
        }
        setLog(entries.slice(0, 25));
        setCreated(createdNotActivated(entries, managed.map((g) => g.groupId)));
      } catch {
        setLog([]);
      }
    })();
  }, [isAppAdmin, services, managed, storedBindings, identity, writesInBuild, armed, logTick]);

  if (graphStatus !== 'connected') return null;
  if (!isAppAdmin) return <Empty>{t('um.setup.adminOnly')}</Empty>;

  const findings = discovery.result?.findings ?? [];
  const sorted = [...findings].sort((a, b) => Number(HIGH_IMPACT.includes(b.type)) - Number(HIGH_IMPACT.includes(a.type)));

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold text-gray-900">{t('um.setup.title')}</h2>

      <Section title={t('um.setup.status.title')}>
        <Card>
          <ul className="divide-y divide-gray-100">
            <StatusLine label={t('um.setup.status.identity')} good={!!identity} text={identity?.userPrincipalName ?? t('um.setup.status.missing')} />
            <StatusLine
              label={t('um.setup.status.adminGroup')}
              good={!!services.adminGroupId}
              text={services.adminGroupId ? t('um.setup.status.set') : t('um.setup.status.adminNamed', { count: services.adminUserIds.length })}
            />
            <StatusLine label={t('um.setup.status.database')} good={storeReachable} text={t(storeReachable ? 'um.setup.status.reachable' : 'um.setup.status.unreachable')} />
            <StatusLine label={t('um.setup.status.function')} good text={t('um.setup.status.inBuild')} />
            <StatusLine
              label={t('um.setup.status.changes')}
              good={writesInBuild && armed}
              text={t(!writesInBuild ? 'um.setup.status.readOnly' : armed ? 'um.setup.status.changesOn' : 'um.setup.status.changesOff')}
            />
          </ul>
        </Card>
      </Section>

      <PermissionChecklist />

      <Section
        title={t('um.setup.findings.title')}
        intro={t('um.setup.findings.intro')}
        actions={
          <Button onClick={() => void discover()} disabled={discovery.status === 'running'}>
            {discovery.result ? t('um.disc.rerun') : t('um.disc.run')}
          </Button>
        }
      >
        <GrantNotices />
        {discovery.status === 'running' && (
          <p className="text-sm text-gray-600">{t('um.disc.running', { done: discovery.done ?? 0, total: discovery.total ?? 0 })}</p>
        )}
        {!discovery.result && discovery.status !== 'running' && <Empty>{t('um.disc.idle')}</Empty>}
        {discovery.result && sorted.length === 0 && <Empty>{t('um.setup.findings.none')}</Empty>}
        {sorted.length > 0 && (
          <Card>
            <ul className="space-y-2">
              {sorted.map((f, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-gray-800">
                  <Pill tone={HIGH_IMPACT.includes(f.type) ? 'alert' : 'warn'}>{t(`um.finding.label.${f.type}`)}</Pill>
                  <span>{findingText(t, f)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <Section title={t('um.setup.groups.title')} intro={t('um.setup.groups.intro')}>
        {managed.length === 0 ? (
          <Empty>{t('um.setup.groups.none')}</Empty>
        ) : (
          <div className="space-y-3">
            {[...managed]
              .sort((a, b) => a.nameSnapshot.localeCompare(b.nameSnapshot))
              .map((g) => (
                <GroupEditor key={g.id} group={g} bindings={bindingsOf(g.groupId)} />
              ))}
          </div>
        )}
      </Section>

      <Section title={t('um.setup.changes.title')} intro={t(writesInBuild ? 'um.setup.changes.intro' : 'um.setup.changes.notInBuild')}>
        {writesInBuild && (
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone={armed ? 'alert' : 'neutral'}>{t(armed ? 'um.setup.status.changesOn' : 'um.setup.status.changesOff')}</Pill>
            <Button
              onClick={() =>
                void setArmed(!armed).then((ok) => {
                  setSwitchFailed(!ok);
                })
              }
            >
              {t(armed ? 'um.setup.changes.switchOff' : 'um.setup.changes.switchOn')}
            </Button>
          </div>
        )}
        {writesInBuild && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-700">{t('um.setup.bindings.label')}</span>
            <Pill tone={bindingsArmed ? 'alert' : 'neutral'}>{t(bindingsArmed ? 'um.setup.status.changesOn' : 'um.setup.status.changesOff')}</Pill>
            <Button
              onClick={() =>
                void setBindingsArmed(!bindingsArmed).then((ok) => {
                  setSwitchFailed(!ok);
                })
              }
            >
              {t(bindingsArmed ? 'um.setup.bindings.switchOff' : 'um.setup.bindings.switchOn')}
            </Button>
          </div>
        )}
        {writesInBuild && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-700">{t('um.setup.groupCreation.label')}</span>
            <Pill tone={groupsArmed ? 'alert' : 'neutral'}>{t(groupsArmed ? 'um.setup.status.changesOn' : 'um.setup.status.changesOff')}</Pill>
            <Button
              onClick={() =>
                void setGroupsArmed(!groupsArmed).then((ok) => {
                  setSwitchFailed(!ok);
                })
              }
            >
              {t(groupsArmed ? 'um.setup.groupCreation.switchOff' : 'um.setup.groupCreation.switchOn')}
            </Button>
          </div>
        )}
        {switchFailed && <Notice tone="alert">{t('um.setup.switch.failed')}</Notice>}
      </Section>

      <GroupCreate created={created} onDone={() => setLogTick((n) => n + 1)} />
      <ActivateById />
      <SheetSection bindingsOf={bindingsOf} />
      <GuidelinesSetupCard />

      <Section title={t('um.setup.log.title')} intro={t('um.setup.log.advisory')}>
        {!log || log.length === 0 ? (
          <Empty>{t('um.setup.log.none')}</Empty>
        ) : (
          <Card>
            <table className="min-w-full text-sm">
              <tbody>
                {log.map((entry) => (
                  <tr key={entry.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{new Date(entry.at).toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-gray-800">{t(`um.log.action.${entry.action}`)}</td>
                    <td className="px-2 py-1.5 text-gray-600">{managed.find((g) => g.groupId === entry.groupId)?.nameSnapshot ?? entry.groupId ?? ''}</td>
                    <td className="px-2 py-1.5 text-gray-600">{entry.actorUpn}</td>
                    <td className="px-2 py-1.5">
                      <Pill tone={entry.outcome === 'ok' ? 'good' : 'alert'}>{t(`um.log.outcome.${entry.outcome}`)}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>
    </div>
  );
}

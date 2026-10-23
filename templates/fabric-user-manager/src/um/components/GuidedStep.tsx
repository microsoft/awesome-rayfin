import { useState } from 'react';

import { useT } from '@/i18n';
import { ROLE_NAME_MAX, planGuided, workspaceLink, type GuidedAction, type GuidedTarget } from '@/um/domain/guidedStep';
import { useUm } from '@/um/hooks/UmContext';
import { recordGuided } from '@/um/services/operations';

import { Button, Notice } from './parts';

/**
 * One guided step in Fabric: the app shows what to do and where, the admin
 * does it there, and the app records what the admin then confirms. For an
 * audience a Fabric administrator's read can afterwards say whether Fabric
 * shows the same.
 */
export function GuidedStep({ target }: { target: GuidedTarget }) {
  const t = useT();
  const { deps, isAppAdmin, managed, reload, discover, grants, services } = useUm();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<GuidedAction>('add');
  const [groupId, setGroupId] = useState('');
  const [roleName, setRoleName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'warn' | 'alert'; text: string } | null>(null);

  if (!deps || !isAppAdmin) return null;
  const active = managed.filter((g) => g.active);
  const group = active.find((g) => g.groupId === groupId);
  const link = workspaceLink(services.env.tenantId, target.workspaceId);
  const isAudience = target.kind === 'Audience';

  if (!open) {
    return (
      <div className="mt-1">
        <Button onClick={() => setOpen(true)}>{t(isAudience ? 'um.guided.open.audience' : 'um.guided.open.model')}</Button>
        {message && (
          <div className="mt-2">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
      </div>
    );
  }

  const record = async () => {
    setBusy(true);
    // The record as stored now, not as this page remembers it: another admin
    // may have confirmed something for the same group in the meantime.
    const loaded = await deps.store.load().catch(() => null);
    if (!loaded?.reachable) {
      setBusy(false);
      return setMessage({ tone: 'alert', text: t('um.err.generic') });
    }
    const attested = loaded.bindings.filter((b) => b.provenance === 'attested');
    const current = loaded.groups.find((g) => g.groupId === groupId);
    const plan = planGuided({ target, action, group: current, roleName, confirmed }, { isAppAdmin, attested });
    if (!plan.ok) {
      setBusy(false);
      return setMessage({ tone: 'alert', text: plan.refusals.map((r) => t(`um.guided.refusal.${r}`)).join(' ') });
    }
    try {
      await recordGuided(deps, plan, action);
      await reload();
      // A Fabric administrator's read replaces the confirmation with what Fabric says.
      const verified = isAudience && grants.fabricAdmin === true;
      if (verified) await discover(true);
      setMessage({ tone: 'info', text: t(verified ? 'um.guided.recordedRead' : isAudience ? 'um.guided.recordedAudience' : 'um.guided.recordedModel') });
      setOpen(false);
      setConfirmed(false);
      setRoleName('');
    } catch {
      setMessage({ tone: 'alert', text: t('um.err.generic') });
    } finally {
      setBusy(false);
    }
  };

  const field = 'mt-1 block rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm';
  const groupName = group?.nameSnapshot ?? t('um.guided.theGroup');
  const stepParams = { group: groupName, item: target.itemName, workspace: target.workspaceName, role: roleName.trim() || t('um.guided.theRole') };

  return (
    <div className="mt-2 space-y-3 rounded-lg bg-gray-50 p-3 text-left text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-gray-800">
          {t('um.guided.action')}
          <select value={action} onChange={(e) => setAction(e.target.value as GuidedAction)} className={field}>
            <option value="add">{t('um.guided.action.add')}</option>
            <option value="remove">{t('um.guided.action.remove')}</option>
          </select>
        </label>
        <label className="block text-gray-800">
          {t('um.guided.group')}
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={field}>
            <option value="">{t('um.guided.pickGroup')}</option>
            {active.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {g.nameSnapshot}
              </option>
            ))}
          </select>
        </label>
        {!isAudience && (
          <label className="block text-gray-800">
            {t('um.guided.roleName')}
            <input value={roleName} maxLength={ROLE_NAME_MAX} onChange={(e) => setRoleName(e.target.value)} className={`${field} w-56`} />
          </label>
        )}
      </div>
      {active.length === 0 && <Notice tone="warn">{t('um.guided.noGroups')}</Notice>}

      <ol className="list-decimal space-y-1 pl-5 text-gray-800">
        <li>
          {t('um.guided.step.open', stepParams)}{' '}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="font-medium text-blue-700 underline">
              {t('um.guided.openFabric')}
            </a>
          )}
        </li>
        <li>{t(`um.guided.step.${target.kind}.find`, stepParams)}</li>
        <li>{t(`um.guided.step.${target.kind}.${action}`, stepParams)}</li>
        <li>{t('um.guided.step.back')}</li>
      </ol>

      <label className="flex items-start gap-2 text-gray-800">
        <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {t(`um.guided.confirm.${action}`, stepParams)}
      </label>
      <p className="text-xs text-gray-600">{t(isAudience ? 'um.guided.note.audience' : 'um.guided.note.model')}</p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="flex gap-2">
        <Button primary onClick={() => void record()} disabled={busy || !group || !confirmed}>
          {t('um.guided.record')}
        </Button>
        <Button
          onClick={() => {
            setOpen(false);
            setMessage(null);
          }}
          disabled={busy}
        >
          {t('um.activate.cancel')}
        </Button>
      </div>
    </div>
  );
}

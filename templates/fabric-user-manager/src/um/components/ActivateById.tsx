import { useState } from 'react';

import { useT } from '@/i18n';
import { assessGroup } from '@/um/domain/eligibility';
import { LIMITS } from '@/um/domain/activation';
import { TARGET_KINDS, WORKSPACE_ROLES, isGuid, type Binding, type DirectoryMember, type GroupFacts, type Readable, type TargetKind } from '@/um/domain/types';
import { useUm } from '@/um/hooks/UmContext';
import { activateGroup } from '@/um/services/operations';

import { Button, Card, Notice, Pill, Section } from './parts';
import { failureText, reasonKey } from './text';

interface Found {
  facts: GroupFacts;
  owners: Readable<DirectoryMember[]>;
}

/**
 * Activation without discovery: an app admin enters a
 * group's object ID and states what the group is for. The group itself is
 * read live from Entra and checked like any other; what it opens is recorded
 * as attested, never as verified.
 */
export function ActivateById() {
  const t = useT();
  const { deps, managed, services, reload } = useUm();
  const [groupId, setGroupId] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [kind, setKind] = useState<TargetKind>('Workspace');
  const [scopeName, setScopeName] = useState('');
  const [label, setLabel] = useState<string>(WORKSPACE_ROLES[0]);
  const [requestable, setRequestable] = useState(false);
  const [noHighRole, setNoHighRole] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'alert' | 'warn'; text: string } | null>(null);

  const highRole = kind === 'Workspace' && (label === 'Member' || label === 'Admin');
  const eligibility = found ? assessGroup(found.facts) : null;

  const lookup = async () => {
    setFound(null);
    setMessage(null);
    const id = groupId.trim().toLowerCase();
    if (!isGuid(id)) return setMessage({ tone: 'alert', text: t('um.byId.badId') });
    setBusy(true);
    // A click: the directory scope may be requested interactively here.
    const facts = await services.directory.getGroup(id, { interactive: true });
    if (facts.state !== 'ok') {
      setBusy(false);
      return setMessage({ tone: 'warn', text: t('um.byId.notFound', { reason: t(reasonKey(facts.reason)) }) });
    }
    const owners = await services.directory.listOwners(id);
    setFound({ facts: facts.value, owners });
    setDescription(facts.value.description ?? '');
    setBusy(false);
  };

  const changeKind = (next: TargetKind) => {
    setKind(next);
    setLabel(next === 'Workspace' ? WORKSPACE_ROLES[0] : '');
  };

  const activate = async () => {
    if (!deps || !found) return;
    const scope = scopeName.trim();
    const what = label.trim();
    if (!scope || !what || scope.length > LIMITS.name || what.length > LIMITS.name) {
      return setMessage({ tone: 'alert', text: t('um.byId.needBinding') });
    }
    // Stating a lower role than the group really holds is the one unsafe
    // mistake here, so anything below Member needs an explicit confirmation.
    if (!highRole && !noHighRole) return setMessage({ tone: 'alert', text: t('um.byId.needConfirm') });
    setBusy(true);
    setMessage(null);
    const binding: Binding = { groupId: found.facts.id, kind, scopeName: scope, label: what, provenance: 'attested' };
    try {
      await activateGroup(
        deps,
        { groupId: found.facts.id, requestable: requestable && !highRole, description: description.trim(), maxDays: 0 },
        { facts: { state: 'ok', value: found.facts }, managed, readBindings: [], attestedBindings: [binding], noHighRoleConfirmed: !highRole && noHighRole, adminGroupId: services.adminGroupId, owners: found.owners }
      );
      await reload();
      setMessage({ tone: 'info', text: t('um.byId.done', { name: found.facts.displayName }) });
      setFound(null);
      setGroupId('');
      setScopeName('');
      setNoHighRole(false);
    } catch (e) {
      setMessage({ tone: 'alert', text: failureText(t, e) });
    } finally {
      setBusy(false);
    }
  };

  const owners = found?.owners.state === 'ok' ? found.owners.value : null;

  return (
    <Section title={t('um.byId.title')} intro={t('um.byId.intro')}>
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm text-gray-800">
            {t('um.byId.groupId')}
            <input
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="mt-1 block w-80 rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-mono text-sm"
            />
          </label>
          <Button onClick={() => void lookup()} disabled={busy}>
            {t('um.byId.lookup')}
          </Button>
        </div>

        {message && (
          <div className="mt-3">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}

        {found && eligibility && (
          <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-900">{found.facts.displayName}</span>
              {!eligibility.eligible && (
                <Pill tone="warn">
                  {t('um.disc.state.notEligible')}
                  {': '}
                  {eligibility.reasons.map((r) => t(`um.inelig.${r}`)).join(', ')}
                </Pill>
              )}
            </div>
            <p className="text-sm text-gray-600">
              {owners === null
                ? t('um.activate.ownersUnknown')
                : owners.length === 0
                  ? t('um.activate.noOwners')
                  : t('um.activate.owners', { owners: owners.map((o) => o.userPrincipalName || o.displayName || o.id).join(', ') })}
            </p>

            {eligibility.eligible && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-sm text-gray-800">
                    {t('um.byId.kind')}
                    <select
                      value={kind}
                      onChange={(e) => changeKind(e.target.value as TargetKind)}
                      className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
                    >
                      {TARGET_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`um.binding.kind.${k}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm text-gray-800">
                    {t('um.byId.scope')}
                    <input
                      value={scopeName}
                      maxLength={LIMITS.name}
                      onChange={(e) => setScopeName(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
                    />
                  </label>
                  {kind === 'Workspace' ? (
                    <label className="block text-sm text-gray-800">
                      {t('um.byId.labelRole')}
                      <select
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
                      >
                        {WORKSPACE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="block text-sm text-gray-800">
                      {t('um.byId.label')}
                      <input
                        value={label}
                        maxLength={LIMITS.name}
                        onChange={(e) => setLabel(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
                      />
                    </label>
                  )}
                </div>
                {highRole ? (
                  <Notice tone="alert">{t('um.row.highRoleHint')}</Notice>
                ) : (
                  <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input type="checkbox" className="mt-1" checked={noHighRole} onChange={(e) => setNoHighRole(e.target.checked)} />
                    {t('um.byId.confirmNoHighRole')}
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" checked={requestable && !highRole} disabled={highRole} onChange={(e) => setRequestable(e.target.checked)} />
                  {t('um.activate.requestable')}
                </label>
                <label className="block text-sm text-gray-800">
                  {t('um.activate.description')}
                  <textarea
                    value={description}
                    maxLength={LIMITS.description}
                    rows={2}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
                  />
                </label>
                <Button primary onClick={() => void activate()} disabled={busy || !deps}>
                  {t('um.activate.submit')}
                </Button>
              </>
            )}
          </div>
        )}
      </Card>
    </Section>
  );
}

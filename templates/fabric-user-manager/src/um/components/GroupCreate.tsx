import { useState } from 'react';

import { useT } from '@/i18n';
import { GROUP_LIMITS, suggestGroupName, type GroupCreatePlan } from '@/um/domain/groupCreate';
import type { DirectoryMember } from '@/um/domain/types';
import { useUm } from '@/um/hooks/UmContext';
import { performGroupCreate, previewGroup, type GroupCreateResult } from '@/um/services/groupCreation';

import { Button, Card, Notice, Pill, Section } from './parts';
import { grantHint, reasonKey } from './text';

const nameOf = (m: DirectoryMember) => m.userPrincipalName || m.displayName || m.id;

/**
 * Setup: create a new, empty security group. App admins only, and only when
 * switched on. Nothing is bound and nobody is added here; the result is an
 * object ID to bind and activate.
 */
export function GroupCreate({ created, onDone }: { created: { groupId: string; name: string }[]; onDone: () => void }) {
  const t = useT();
  const { groupDeps, groupsArmed, grant, grants, services } = useUm();
  const [scope, setScope] = useState('');
  const [role, setRole] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [owners, setOwners] = useState<DirectoryMember[]>([]);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [plan, setPlan] = useState<GroupCreatePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'warn' | 'alert'; text: string } | null>(null);
  const [result, setResult] = useState<Extract<GroupCreateResult, { status: 'done' }> | null>(null);

  if (!groupDeps || !groupsArmed) return null;
  const request = { displayName: name, description, ownerIds: owners.map((o) => o.id) };
  const edit = () => {
    setPlan(null);
    setResult(null);
    setMessage(null);
  };

  const addOwner = async () => {
    const query = ownerQuery.trim();
    if (!query) return;
    setBusy(true);
    setMessage(null);
    // A click: the permission to read people may be asked for here.
    const found = await services.directory.findUser(query, { interactive: true });
    setBusy(false);
    if (found.state !== 'ok') return setMessage({ tone: 'warn', text: t('um.group.ownerNotReadable', { reason: t(reasonKey(found.reason)) }) });
    const person = found.value;
    if (!person) return setMessage({ tone: 'warn', text: t('um.group.ownerNotFound') });
    if (owners.length >= GROUP_LIMITS.owners) return setMessage({ tone: 'warn', text: t('um.group.refusal.too-many-owners') });
    if (!owners.some((o) => o.id.toLowerCase() === person.id.toLowerCase())) setOwners([...owners, person]);
    setOwnerQuery('');
    edit();
  };

  const look = async () => {
    setBusy(true);
    setMessage(null);
    setResult(null);
    setPlan(await previewGroup(groupDeps, request));
    setBusy(false);
  };

  const create = async () => {
    if (!plan) return;
    setBusy(true);
    // One permission, one sign-in window, asked for by this click.
    if (!grants.groupCreate && !(await grant('groupCreate'))) {
      setBusy(false);
      return setMessage({ tone: 'alert', text: `${t('um.group.grantRefused')} ${grantHint(t, 'groupCreate')}` });
    }
    // The plan that was shown goes along: if a fresh read differs, nothing is sent.
    const outcome = await performGroupCreate(groupDeps, request, plan);
    setBusy(false);
    if (outcome.status === 'done') {
      setResult(outcome);
      setPlan(null);
      setName('');
      setDescription('');
      setOwners([]);
      onDone();
    } else if (outcome.status === 'refused') {
      setPlan(null);
      setMessage({ tone: 'alert', text: outcome.refusals.map((r) => t(`um.group.refusal.${r}`)).join(' ') });
    } else {
      setPlan(null);
      setMessage({ tone: 'alert', text: t(`um.group.failed.${outcome.code}`) });
      onDone();
    }
  };

  const field = 'mt-1 block rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm';

  return (
    <Section title={t('um.group.title')} intro={t('um.group.intro')}>
      <Card>
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm text-gray-800">
              {t('um.group.scope')}
              <input value={scope} onChange={(e) => setScope(e.target.value)} className={`${field} w-56`} />
            </label>
            <label className="block text-sm text-gray-800">
              {t('um.group.role')}
              <input value={role} onChange={(e) => setRole(e.target.value)} className={`${field} w-40`} />
            </label>
            <Button
              onClick={() => {
                setName(suggestGroupName(scope, role));
                edit();
              }}
              disabled={busy || (!scope.trim() && !role.trim())}
            >
              {t('um.group.suggest')}
            </Button>
          </div>
          <label className="block text-sm text-gray-800">
            {t('um.group.name')}
            <input
              value={name}
              maxLength={GROUP_LIMITS.nameMax}
              onChange={(e) => {
                setName(e.target.value);
                edit();
              }}
              className={`${field} w-96 max-w-full`}
            />
          </label>
          <label className="block text-sm text-gray-800">
            {t('um.group.description')}
            <textarea
              value={description}
              rows={2}
              maxLength={GROUP_LIMITS.description}
              onChange={(e) => {
                setDescription(e.target.value);
                edit();
              }}
              className={`${field} w-full`}
            />
          </label>

          <div>
            <p className="text-sm text-gray-800">{t('um.group.owners')}</p>
            <p className="text-xs text-gray-500">{t('um.group.ownersHint')}</p>
            <ul className="mt-1 space-y-1">
              <li className="text-sm text-gray-700">
                {groupDeps.actor.userPrincipalName} <Pill tone="neutral">{t('um.group.you')}</Pill>
              </li>
              {owners.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                  {nameOf(o)}
                  <Button
                    onClick={() => {
                      setOwners(owners.filter((x) => x.id !== o.id));
                      edit();
                    }}
                    disabled={busy}
                  >
                    {t('um.group.removeOwner')}
                  </Button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block text-sm text-gray-800">
                <span className="sr-only">{t('um.group.ownerQuery')}</span>
                <input value={ownerQuery} onChange={(e) => setOwnerQuery(e.target.value)} placeholder={t('um.group.ownerQuery')} className={`${field} w-80 max-w-full`} />
              </label>
              <Button onClick={() => void addOwner()} disabled={busy || !ownerQuery.trim()}>
                {t('um.group.addOwner')}
              </Button>
            </div>
          </div>

          {message && <Notice tone={message.tone}>{message.text}</Notice>}

          {!plan && (
            <Button primary onClick={() => void look()} disabled={busy || name.trim().length === 0}>
              {t('um.bind.preview')}
            </Button>
          )}

          {plan && (
            <div className="space-y-2 rounded-lg border-l-4 border-[#FF0000] bg-white p-3 text-sm ring-1 ring-gray-200">
              <p className="font-medium text-gray-900">{t('um.group.what', { name: plan.displayName })}</p>
              <p className="text-gray-700">{t('um.group.whatOwners', { owners: [groupDeps.actor.userPrincipalName, ...plan.owners.map(nameOf)].join(', ') })}</p>
              <p className="text-gray-700">{t('um.group.whatEmpty')}</p>
              {plan.warnings.map((w) => (
                <Notice key={w} tone="warn">
                  {t(`um.group.warning.${w}`)}
                </Notice>
              ))}
              {plan.refusals.length > 0 && <Notice tone="alert">{plan.refusals.map((r) => t(`um.group.refusal.${r}`)).join(' ')}</Notice>}
              <div className="flex gap-2">
                {plan.ok && (
                  <Button primary onClick={() => void create()} disabled={busy}>
                    {t('um.group.confirm')}
                  </Button>
                )}
                <Button onClick={edit} disabled={busy}>
                  {t('um.activate.cancel')}
                </Button>
              </div>
            </div>
          )}

          {result && (
            <Notice tone={result.creatorIsOwner === false || (result.sameNameNow ?? 1) > 1 ? 'alert' : 'info'}>
              {t('um.group.done', { name: result.displayName })} <span className="font-mono">{result.groupId}</span>{' '}
              {t(result.creatorIsOwner === false ? 'um.group.notOwner' : result.creatorIsOwner === null ? 'um.group.ownerUnknown' : 'um.group.next')}
              {result.sameNameNow !== null && result.sameNameNow > 1 && ` ${t('um.group.duplicateName', { count: result.sameNameNow })}`}
            </Notice>
          )}
        </div>
      </Card>

      {created.length > 0 && (
        <Card>
          <p className="text-sm font-semibold text-gray-900">{t('um.group.created.title')}</p>
          <p className="text-sm text-gray-600">{t('um.group.created.intro')}</p>
          <ul className="mt-2 space-y-1">
            {created.map((g) => (
              <li key={g.groupId} className="text-sm text-gray-800">
                {g.name} <span className="font-mono text-xs text-gray-500">{g.groupId}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}

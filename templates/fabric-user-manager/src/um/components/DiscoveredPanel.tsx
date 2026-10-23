import { useState } from 'react';

import { useT } from '@/i18n';
import { isHighRoleGroup, type DiscoveredGroup, type DiscoveryResult } from '@/um/domain/discovery';
import type { FabricItem, Readable, TargetKind } from '@/um/domain/types';
import { useUm } from '@/um/hooks/UmContext';
import { DISCOVERY_LIMITS } from '@/um/services/discoveryRunner';
import { activateGroup } from '@/um/services/operations';

import { BindGroup, BindingRowActions } from './BindingChanges';
import { GuidedStep } from './GuidedStep';
import { Button, Card, Empty, Notice, Pill, RolePill, Section } from './parts';
import { GrantRefusedNote } from './Permissions';
import { failureText, reasonKey } from './text';

function ActivateForm({ group, onDone }: { group: DiscoveredGroup; onDone: () => void }) {
  const t = useT();
  const { deps, managed, reload, services } = useUm();
  const highRole = isHighRoleGroup(group.bindings);
  const [requestable, setRequestable] = useState(false);
  const [description, setDescription] = useState(group.facts.state === 'ok' ? (group.facts.value.description ?? '') : '');
  const [maxDays, setMaxDays] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!deps) return;
    setBusy(true);
    setError(null);
    try {
      await activateGroup(
        deps,
        { groupId: group.groupId, requestable, description: description.trim(), maxDays: Number(maxDays) },
        { facts: group.facts, managed, readBindings: group.bindings, adminGroupId: services.adminGroupId, owners: group.owners }
      );
      await reload();
      onDone();
    } catch (e) {
      setError(failureText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const owners = group.owners.state === 'ok' ? group.owners.value : null;

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-gray-50 p-3">
      <p className="text-sm font-medium text-gray-900">{t('um.activate.title', { name: group.name })}</p>
      <p className="text-sm text-gray-600">
        {owners === null
          ? t('um.activate.ownersUnknown')
          : owners.length === 0
            ? t('um.activate.noOwners')
            : t('um.activate.owners', { owners: owners.map((o) => o.userPrincipalName || o.displayName || o.id).join(', ') })}
      </p>
      {highRole && <Notice tone="alert">{t('um.row.highRoleHint')}</Notice>}
      <label className="flex items-center gap-2 text-sm text-gray-800">
        <input type="checkbox" checked={requestable} disabled={highRole} onChange={(e) => setRequestable(e.target.checked)} />
        {t('um.activate.requestable')}
      </label>
      <label className="block text-sm text-gray-800">
        {t('um.activate.description')}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={1000}
          className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <label className="block text-sm text-gray-800">
        {t('um.activate.maxDays')}
        <input
          type="number"
          min={0}
          max={3650}
          value={maxDays}
          onChange={(e) => setMaxDays(e.target.value)}
          className="mt-1 block w-32 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      {error && <Notice tone="alert">{error}</Notice>}
      <div className="flex gap-2">
        <Button primary onClick={() => void submit()} disabled={busy || !deps}>
          {t('um.activate.submit')}
        </Button>
        <Button onClick={onDone} disabled={busy}>
          {t('um.activate.cancel')}
        </Button>
      </div>
    </div>
  );
}

function GroupState({ group, activated }: { group: DiscoveredGroup; activated: boolean }) {
  const t = useT();
  if (activated) return <Pill tone="good">{t('um.disc.state.activated')}</Pill>;
  if (group.eligible === 'unknown') return <Pill tone="warn">{t('um.disc.state.unknown')}</Pill>;
  if (!group.eligible) {
    return (
      <Pill tone="warn" title={group.ineligibleReasons.map((r) => t(`um.inelig.${r}`)).join(', ')}>
        {t('um.disc.state.notEligible')}
        {': '}
        {group.ineligibleReasons.map((r) => t(`um.inelig.${r}`)).join(', ')}
      </Pill>
    );
  }
  return null;
}

/** State of one discovered group and, where possible, the way to activate it. */
function GroupActions({ group }: { group: DiscoveredGroup }) {
  const t = useT();
  const { managed } = useUm();
  const [open, setOpen] = useState(false);
  const activated = managed.some((g) => g.groupId.toLowerCase() === group.groupId.toLowerCase());
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <GroupState group={group} activated={activated} />
        {!activated && group.eligible === true && !open && <Button onClick={() => setOpen(true)}>{t('um.disc.activate')}</Button>}
      </div>
      {open && !activated && <ActivateForm group={group} onDone={() => setOpen(false)} />}
    </div>
  );
}

/** Per audience: which groups it is shared with, as far as that was read. */
function AudienceSharing({ result }: { result: DiscoveryResult }) {
  const t = useT();
  const groups = new Map(result.groups.map((g) => [g.groupId.toLowerCase(), g]));
  const rows = result.perWorkspace.flatMap((ws) => (ws.audiences.state === 'ok' ? ws.audiences.value.map((item) => ({ ws, item })) : []));
  if (rows.length === 0) return null;

  return (
    <Card>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
            <th className="px-2 py-1.5 font-medium">{t('um.disc.col.workspace')}</th>
            <th className="px-2 py-1.5 font-medium">{t('um.disc.col.audience')}</th>
            <th className="px-2 py-1.5 font-medium">{t('um.disc.audiences.sharedWith')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ ws, item }) => {
            const access = ws.audienceAccess?.[item.id];
            const bound = result.bindings.filter((b) => b.kind === 'Audience' && b.scopeId === item.id);
            return (
              <tr key={item.id} className="border-b border-gray-50 align-top last:border-0">
                <td className="px-2 py-1.5 text-gray-600">{ws.workspace.displayName}</td>
                <td className="px-2 py-1.5 text-gray-800">{item.displayName}</td>
                <td className="px-2 py-1.5">
                  {!access && <span className="text-gray-500">{t('um.disc.audiences.notRead')}</span>}
                  {access && (access.state !== 'ok' || ws.roleAssignments.state !== 'ok') && (
                    <span className="text-amber-900">
                      {t('um.disc.audiences.notReadable', {
                        reason: t(reasonKey(access.state !== 'ok' ? access.reason : ws.roleAssignments.state !== 'ok' ? ws.roleAssignments.reason : 'failed')),
                      })}
                    </span>
                  )}
                  {access?.state === 'ok' && ws.roleAssignments.state === 'ok' && bound.length === 0 && (
                    <span className="text-gray-500">{t('um.disc.audiences.noGroups')}</span>
                  )}
                  {access?.state === 'ok' && ws.roleAssignments.state === 'ok' && bound.length > 0 && (
                    <ul className="space-y-2">
                      {bound.map((b) => {
                        const group = groups.get(b.groupId.toLowerCase());
                        return (
                          <li key={b.groupId}>
                            <span className="font-medium text-gray-900">{group?.name ?? b.groupId}</span>
                            {group && <GroupActions group={group} />}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <GuidedStep target={{ kind: 'Audience', workspaceId: ws.workspace.id, workspaceName: ws.workspace.displayName, itemId: item.id, itemName: item.displayName }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function WorkspaceRoles({ result }: { result: DiscoveryResult }) {
  const t = useT();
  const { discover } = useUm();
  const groups = new Map(result.groups.map((g) => [g.groupId.toLowerCase(), g]));

  if (result.perWorkspace.length === 0) return <Empty>{t('um.disc.items.none')}</Empty>;

  return (
    <div className="space-y-3">
      {result.perWorkspace.map((ws) => (
        <Card key={ws.workspace.id}>
          <h4 className="font-semibold text-gray-900">{ws.workspace.displayName}</h4>
          {ws.roleAssignments.state !== 'ok' ? (
            <p className="mt-2 text-sm text-amber-900">{t('um.disc.ws.notReadable', { reason: t(reasonKey(ws.roleAssignments.reason)) })}</p>
          ) : (
            <table className="mt-2 w-full table-fixed text-sm">
              {/* The same columns in every workspace, so the eye can run down the page. */}
              <colgroup>
                <col className="w-[32%]" />
                <col className="w-[18%]" />
                <col className="w-[14%]" />
                <col className="w-[36%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                  <th className="px-2 py-1.5 font-medium">{t('um.disc.col.principal')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('um.disc.col.type')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('um.disc.col.role')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('um.disc.col.state')}</th>
                </tr>
              </thead>
              <tbody>
                {ws.roleAssignments.value.map((a) => {
                  const group = a.principalType === 'Group' ? groups.get(a.principalId.toLowerCase()) : undefined;
                  return (
                    <tr key={a.id} className="border-b border-gray-50 align-top last:border-0">
                      <td className="px-2 py-1.5 break-words text-gray-800">{group?.name ?? (a.principalName || a.principalId)}</td>
                      <td className="px-2 py-1.5 text-gray-600">{t(`um.disc.principal.${a.principalType}`)}</td>
                      <td className="px-2 py-1.5">
                        <RolePill role={a.role} />
                      </td>
                      <td className="px-2 py-1.5">
                        {group ? <GroupActions group={group} /> : <Pill tone="warn">{t('um.disc.state.direct')}</Pill>}
                        {a.principalType === 'Group' && <BindingRowActions workspace={ws.workspace} assignment={a} onChanged={() => void discover()} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {ws.roleAssignments.state === 'ok' && <BindGroup workspace={ws.workspace} onChanged={() => void discover()} />}
        </Card>
      ))}
    </div>
  );
}

function ItemList({ result, pick, noteKey }: { result: DiscoveryResult; pick: (ws: DiscoveryResult['perWorkspace'][number]) => Readable<FabricItem[]>[]; noteKey: 'um.disc.audiences.note' | 'um.disc.models.note' }) {
  const t = useT();
  const lines: { workspace: string; workspaceId: string; item: FabricItem }[] = [];
  const unreadable: { workspace: string; reason: string }[] = [];
  for (const ws of result.perWorkspace) {
    for (const list of pick(ws)) {
      if (list.state === 'ok') for (const item of list.value) lines.push({ workspace: ws.workspace.displayName, workspaceId: ws.workspace.id, item });
      else if (!unreadable.some((u) => u.workspace === ws.workspace.displayName)) {
        unreadable.push({ workspace: ws.workspace.displayName, reason: t(reasonKey(list.reason)) });
      }
    }
  }
  return (
    <div className="space-y-3">
      <Notice tone="warn">{t(noteKey)}</Notice>
      {unreadable.map((u) => (
        <p key={u.workspace} className="text-sm text-amber-900">
          {u.workspace}
          {': '}
          {t('um.disc.ws.itemsNotReadable', { reason: u.reason })}
        </p>
      ))}
      {lines.length === 0 ? (
        <Empty>{t('um.disc.items.none')}</Empty>
      ) : (
        <Card>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                <th className="px-2 py-1.5 font-medium">{t('um.disc.col.workspace')}</th>
                <th className="px-2 py-1.5 font-medium">{t('um.disc.col.item')}</th>
                <th className="px-2 py-1.5 font-medium">{t('um.disc.col.kind')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ workspace, workspaceId, item }) => (
                <tr key={item.id} className="border-b border-gray-50 align-top last:border-0">
                  <td className="px-2 py-1.5 text-gray-600">{workspace}</td>
                  <td className="px-2 py-1.5 text-gray-800">
                    {item.displayName}
                    {item.type === 'SemanticModel' && <GuidedStep target={{ kind: 'ModelRole', workspaceId, workspaceName: workspace, itemId: item.id, itemName: item.displayName }} />}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{item.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/**
 * What discovery may not read yet, each with its own button. One permission
 * per click, because a browser allows one sign-in window per click.
 */
export function GrantNotices() {
  const t = useT();
  const { grants, grant, discover, discovery, refused } = useUm();
  const ask = async (set: 'fabric' | 'directory') => {
    if (await grant(set)) await discover();
  };
  return (
    <>
      {grants.fabric === false && (
        <Notice
          tone="warn"
          action={
            <Button primary onClick={() => void ask('fabric')} disabled={discovery.status === 'running'}>
              {t('um.grant.allow')}
            </Button>
          }
        >
          {t('um.grant.fabric')}
        </Notice>
      )}
      {grants.fabric === false && refused.fabric && <GrantRefusedNote set="fabric" />}
      {grants.directory === false && (
        <Notice
          tone="warn"
          action={
            <Button primary onClick={() => void ask('directory')} disabled={discovery.status === 'running'}>
              {t('um.grant.allow')}
            </Button>
          }
        >
          {t('um.grant.directory')}
        </Notice>
      )}
      {grants.directory === false && refused.directory && <GrantRefusedNote set="directory" />}
    </>
  );
}

/** What discovery found for one tab. App admins only. */
export function DiscoveredPanel({ kind }: { kind: TargetKind }) {
  const t = useT();
  const { discovery, discover, grants, grant, refused } = useUm();
  const result = discovery.result;

  const readSharing = async () => {
    // The administrator permission is asked for only here, on request.
    if (grants.fabricAdmin || (await grant('fabricAdmin'))) await discover(true);
  };

  const actions = (
    <Button onClick={() => void discover()} disabled={discovery.status === 'running'}>
      {result ? t('um.disc.rerun') : t('um.disc.run')}
    </Button>
  );

  return (
    <Section title={t('um.disc.title')} intro={t('um.disc.intro')} actions={actions}>
      <GrantNotices />
      {discovery.status === 'running' && (
        <p className="text-sm text-gray-600">{t('um.disc.running', { done: discovery.done ?? 0, total: discovery.total ?? 0 })}</p>
      )}
      {discovery.status === 'error' && <Notice tone="alert">{t('um.disc.error')}</Notice>}
      {discovery.status === 'idle' && !result && <Empty>{t('um.disc.idle')}</Empty>}

      {result && (
        <>
          <p className="text-xs text-gray-500">
            {t('um.disc.observedAt', { time: new Date(result.observedAt).toLocaleString() })}
            {' · '}
            {t('um.disc.coverage', { readable: result.coverage.rolesReadable, total: result.coverage.workspaces })}
          </p>
          {result.workspaces.state !== 'ok' && (
            <Notice tone="warn">{t('um.disc.unavailable', { reason: t(reasonKey(result.workspaces.reason)) })}</Notice>
          )}
          {result.coverage.workspacesSkipped > 0 && (
            <Notice tone="warn">{t('um.disc.skipped', { count: result.coverage.workspacesSkipped, limit: DISCOVERY_LIMITS.workspaces })}</Notice>
          )}
          {result.workspaces.state === 'ok' && kind === 'Workspace' && <WorkspaceRoles result={result} />}
          {result.workspaces.state === 'ok' && kind === 'Audience' && (
            <>
              <ItemList result={result} pick={(ws) => [ws.orgApps, ws.audiences]} noteKey="um.disc.audiences.note" />
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void readSharing()} disabled={discovery.status === 'running'}>
                  {t('um.disc.audiences.read')}
                </Button>
                <span className="text-xs text-gray-500">{t('um.disc.audiences.readHint', { limit: DISCOVERY_LIMITS.audiences })}</span>
              </div>
              {result.coverage.audiencesRead + result.coverage.audiencesNotReadable > 0 && (
                <p className="text-xs text-gray-500">
                  {t('um.disc.audiences.coverage', { read: result.coverage.audiencesRead, failed: result.coverage.audiencesNotReadable })}
                </p>
              )}
              {/* Only after it was asked for here: the Setup checklist also looks at this permission, without asking. */}
              {grants.fabricAdmin === false && refused.fabricAdmin && (
                <>
                  <Notice tone="warn">{t('um.grant.fabricAdminRefused')}</Notice>
                  <GrantRefusedNote set="fabricAdmin" />
                </>
              )}
              {result.coverage.audiencesSkipped > 0 && (
                <Notice tone="warn">{t('um.disc.audiences.skipped', { count: result.coverage.audiencesSkipped, limit: DISCOVERY_LIMITS.audiences })}</Notice>
              )}
              <AudienceSharing result={result} />
            </>
          )}
          {result.workspaces.state === 'ok' && kind === 'ModelRole' && (
            <ItemList result={result} pick={(ws) => [ws.models]} noteKey="um.disc.models.note" />
          )}
        </>
      )}
    </Section>
  );
}

import { useState } from 'react';

import { useT, type Translate } from '@/i18n';
import type { BindingAction, BindingPlan } from '@/um/domain/bindingChange';
import { WORKSPACE_ROLES, isGuid, type FabricWorkspace, type RoleAssignment } from '@/um/domain/types';
import { useUm } from '@/um/hooks/UmContext';
import { performBinding, previewBinding, type BindingPreview, type BindingResult } from '@/um/services/bindingChanges';

import { Button, Notice, Pill } from './parts';
import { grantHint } from './text';

function resultText(t: Translate, result: BindingResult): { tone: 'info' | 'alert'; text: string } {
  switch (result.status) {
    case 'done':
      return { tone: 'info', text: t(result.confirmed ? 'um.bind.done' : 'um.bind.accepted') };
    case 'noop':
      return { tone: 'info', text: t('um.bind.noop') };
    case 'refused':
      return { tone: 'alert', text: result.refusals.map((r) => t(`um.bind.refusal.${r}`)).join(' ') };
    case 'failed':
      return { tone: 'alert', text: t(`um.bind.failed.${result.code}`) };
  }
}

/** What a binding change would do, and the one confirm that sends it. */
function BindingDialog({
  workspace,
  groupId,
  action,
  role,
  onClose,
}: {
  workspace: FabricWorkspace;
  groupId: string;
  action: BindingAction;
  role?: string;
  onClose: (changed: boolean) => void;
}) {
  const t = useT();
  const { bindingDeps, grant, grants } = useUm();
  const [preview, setPreview] = useState<BindingPreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'alert'; text: string } | null>(null);
  const [started, setStarted] = useState(false);

  if (!bindingDeps) return null;
  const request = { action, workspaceId: workspace.id, groupId, role, confirmation };

  const look = async () => {
    setBusy(true);
    setStarted(true);
    // One permission, one sign-in window, asked for by this click.
    if (!grants.fabricWrite && !(await grant('fabricWrite'))) {
      setBusy(false);
      // Back to the start, so the button to look again is there once the permission is granted.
      setStarted(false);
      return setMessage({ tone: 'alert', text: `${t('um.bind.grantRefused')} ${grantHint(t, 'fabricWrite')}` });
    }
    setPreview(await previewBinding(bindingDeps, request));
    setBusy(false);
  };

  const send = async () => {
    if (!preview) return;
    setBusy(true);
    // The plan that was shown goes along: if a fresh read differs, nothing is sent.
    const result = await performBinding(bindingDeps, request, preview.plan);
    setMessage(resultText(t, result));
    setBusy(false);
    if (result.status === 'done') onClose(true);
    // What was shown no longer holds: the admin has to look again.
    if (result.status === 'refused' && result.refusals.includes('changed-since-preview')) {
      setPreview(null);
      setConfirmation('');
      setStarted(false);
    }
  };

  const plan: BindingPlan | undefined = preview?.plan;
  // The typed name is checked again by the plan; here it only enables the button.
  const liveName = preview?.workspaceName ?? null;
  const typed = liveName !== null && confirmation.trim().toLowerCase() === liveName.trim().toLowerCase();
  const blocking = plan ? plan.refusals.filter((r) => r !== 'confirmation-missing') : [];
  const owners = preview?.owners.state === 'ok' ? preview.owners.value : null;

  return (
    <div className="mt-2 space-y-2 rounded-lg border-l-4 border-[#FF0000] bg-white p-3 text-left text-sm ring-1 ring-gray-200">
      {!started && (
        <div className="flex gap-2">
          <Button primary onClick={() => void look()} disabled={busy}>
            {t('um.bind.preview')}
          </Button>
          <Button onClick={() => onClose(false)} disabled={busy}>
            {t('um.activate.cancel')}
          </Button>
        </div>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {plan && preview && (
        <>
          <p className="font-medium text-gray-900">
            {t(`um.bind.what.${plan.effective}`, { group: preview.groupName, workspace: liveName ?? workspace.displayName, from: plan.fromRole ?? '', to: plan.toRole ?? '' })}
          </p>
          <p className="text-gray-700">
            {plan.affectedMembers === null ? t('um.bind.membersUnknown') : t(`um.bind.members.${plan.effective === 'remove' ? 'lose' : 'get'}`, { count: plan.affectedMembers })}
          </p>
          {plan.effective !== 'remove' && (
            <p className="text-gray-700">
              {owners === null
                ? t('um.activate.ownersUnknown')
                : owners.length === 0
                  ? t('um.bind.noOwners')
                  : t('um.bind.owners', { owners: owners.map((o) => o.userPrincipalName || o.displayName || o.id).join(', ') })}
            </p>
          )}
          {plan.toRole && plan.toRole !== 'Viewer' && plan.effective !== 'remove' && <p className="text-gray-700">{t('um.bind.rlsHint')}</p>}
          {plan.effective === 'remove' && <p className="text-xs text-gray-500">{t('um.change.remove.otherPaths')}</p>}
          {plan.noop && <Notice tone="info">{t('um.bind.noop')}</Notice>}
          {blocking.length > 0 && <Notice tone="alert">{blocking.map((r) => t(`um.bind.refusal.${r}`)).join(' ')}</Notice>}
          {blocking.length === 0 && !plan.noop && plan.needsConfirmation && (
            <label className="block text-gray-800">
              {t('um.bind.typeName', { workspace: liveName ?? workspace.displayName })}
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                className="mt-1 block w-72 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
              />
            </label>
          )}
          <div className="flex gap-2">
            {blocking.length === 0 && !plan.noop && (
              <Button primary onClick={() => void send()} disabled={busy || (plan.needsConfirmation && !typed)}>
                {t(`um.bind.confirm.${plan.effective}`)}
              </Button>
            )}
            <Button onClick={() => onClose(false)} disabled={busy}>
              {t('um.activate.cancel')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** On a group's row in a workspace: change its role or remove the binding. */
export function BindingRowActions({ workspace, assignment, onChanged }: { workspace: FabricWorkspace; assignment: RoleAssignment; onChanged: () => void }) {
  const t = useT();
  const { bindingDeps, bindingsArmed } = useUm();
  const [dialog, setDialog] = useState<{ action: BindingAction; role?: string } | null>(null);
  if (!bindingDeps || !bindingsArmed) return null;

  const close = (changed: boolean) => {
    setDialog(null);
    if (changed) onChanged();
  };

  return (
    <div className="mt-2">
      {!dialog && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-600">
            <span className="sr-only">{t('um.bind.changeTo')}</span>
            <select
              value=""
              onChange={(e) => e.target.value && setDialog({ action: 'change', role: e.target.value })}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
            >
              <option value="">{t('um.bind.changeTo')}</option>
              {WORKSPACE_ROLES.filter((r) => r !== assignment.role).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={() => setDialog({ action: 'remove' })}>{t('um.bind.remove')}</Button>
        </div>
      )}
      {dialog && <BindingDialog workspace={workspace} groupId={assignment.principalId} action={dialog.action} role={dialog.role} onClose={close} />}
    </div>
  );
}

/** In a workspace: give a group a role, by the group's object id. */
export function BindGroup({ workspace, onChanged }: { workspace: FabricWorkspace; onChanged: () => void }) {
  const t = useT();
  const { bindingDeps, bindingsArmed } = useUm();
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [role, setRole] = useState<string>(WORKSPACE_ROLES[0]);
  const [ready, setReady] = useState(false);
  if (!bindingDeps || !bindingsArmed) return null;

  const close = (changed: boolean) => {
    setReady(false);
    if (changed) {
      setOpen(false);
      setGroupId('');
      onChanged();
    }
  };
  const valid = isGuid(groupId.trim());

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {!open && <Button onClick={() => setOpen(true)}>{t('um.bind.add')}</Button>}
      {open && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm text-gray-800">
              {t('um.byId.groupId')}
              <input
                value={groupId}
                onChange={(e) => {
                  setGroupId(e.target.value);
                  setReady(false);
                }}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="mt-1 block w-80 rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="block text-sm text-gray-800">
              {t('um.byId.labelRole')}
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setReady(false);
                }}
                className="mt-1 block rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
              >
                {WORKSPACE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            {!ready && (
              <>
                <Button onClick={() => setReady(true)} disabled={!valid}>
                  {t('um.bind.continue')}
                </Button>
                <Button onClick={() => setOpen(false)}>{t('um.activate.cancel')}</Button>
              </>
            )}
          </div>
          {!valid && groupId.trim() !== '' && <Pill tone="warn">{t('um.byId.badId')}</Pill>}
          {ready && valid && <BindingDialog workspace={workspace} groupId={groupId.trim().toLowerCase()} action="add" role={role} onClose={close} />}
        </div>
      )}
    </div>
  );
}

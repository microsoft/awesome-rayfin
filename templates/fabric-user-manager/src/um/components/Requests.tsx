import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useT, type Translate } from '@/i18n';
import { sameRequester, type AccessRequest } from '@/um/domain/accessRequest';
import type { DirectoryMember } from '@/um/domain/types';
import { UM_PATHS } from '@/um/domain/profile';
import type { RowView } from '@/um/domain/views';
import { useUm } from '@/um/hooks/UmContext';
import { approveRequest, denyRequest, submitRequest, withdrawRequest, type DecisionResult } from '@/um/services/accessRequests';
import type { ChangeResult } from '@/um/services/memberChanges';

import { Button, Notice } from './parts';
import { grantHint } from './text';

const day = (iso: string) => new Date(iso).toLocaleDateString();

function changeText(t: Translate, change: ChangeResult): string {
  if (change.status === 'refused') return change.refusals.map((r) => t(`um.change.refusal.${r}`)).join(' ');
  if (change.status === 'failed') return t(`um.change.failed.${change.code}`);
  if (change.status === 'noop') return t(`um.change.state.${change.noop}`);
  return t(change.confirmed ? 'um.change.state.added' : 'um.change.state.accepted');
}

/** On a group the viewer can request: the form, or the state of their own request. */
export function RequestBox({ row }: { row: RowView }) {
  const t = useT();
  const { requestDeps, requests, armed, writesInBuild, reload, grant, grants } = useUm();
  const { search } = useLocation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reviewOn, setReviewOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'alert'; text: string } | null>(null);

  // Requests end in a member change, so they exist only where those do.
  if (!requestDeps || !writesInBuild || !armed) return null;
  const mine = requests.find((r) => r.status === 'Pending' && r.groupId === row.group.groupId.toLowerCase() && r.requesterOid === requestDeps.actor.objectId);
  const canAsk = row.group.requestable && row.group.active && !row.highRole && !row.isMember;

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    // The notice goes out from the requester's own mailbox. If that permission
    // is not given, the request is still filed and the owners see it in the app.
    if (!grants.mail) await grant('mail');
    const result = await submitRequest(requestDeps, row, { reason, reviewOn: reviewOn || undefined }).catch(() => null);
    if (!result) setMessage({ tone: 'alert', text: t('um.err.generic') });
    else if (result.status === 'refused') setMessage({ tone: 'alert', text: result.refusals.map((r) => t(`um.request.refusal.${r}`)).join(' ') });
    else {
      setMessage({ tone: 'info', text: `${t('um.request.submitted')} ${t(`um.request.notice.${result.notice}`)}` });
      setOpen(false);
      setReason('');
      await reload();
    }
    setBusy(false);
  };

  const withdraw = async () => {
    if (!mine) return;
    setBusy(true);
    const ok = await withdrawRequest(requestDeps, mine);
    setMessage(ok ? { tone: 'info', text: t('um.request.withdrawn') } : { tone: 'alert', text: t('um.request.conflict') });
    await reload();
    setBusy(false);
  };

  return (
    <div className="mt-3 space-y-2">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {mine && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
          <span>{t('um.request.mine', { date: day(mine.createdAt) })}</span>
          <Button onClick={() => void withdraw()} disabled={busy}>
            {t('um.request.withdraw')}
          </Button>
        </div>
      )}
      {!mine && canAsk && !open && <Button onClick={() => setOpen(true)}>{t('um.request.open')}</Button>}
      {!mine && canAsk && open && (
        <div className="space-y-3 rounded-lg bg-gray-50 p-3">
          <label className="block text-sm text-gray-800">
            {t('um.request.reason')}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={1000}
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm text-gray-800">
            {t('um.request.reviewDate')}
            <input type="date" value={reviewOn} onChange={(e) => setReviewOn(e.target.value)} className="mt-1 block rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
          </label>
          {/* A statement, not a check: nothing is stored with the request. The guide opens beside the form so the reason is not lost. */}
          <p className="text-sm text-gray-700">
            {t('um.request.confirm.before')}{' '}
            <Link to={{ pathname: UM_PATHS.guidelines, search }} target="_blank" rel="noreferrer" className="font-medium text-blue-700 underline">
              {t('um.request.confirm.link')}
              <span aria-hidden="true">{' ↗'}</span>
              <span className="sr-only">{` (${t('um.gl.external')})`}</span>
            </Link>
            {t('um.request.confirm.after')}
          </p>
          <div className="flex gap-2">
            <Button primary onClick={() => void submit()} disabled={busy}>
              {t('um.request.submit')}
            </Button>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              {t('um.activate.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function decisionText(t: Translate, result: DecisionResult): { tone: 'info' | 'alert'; text: string } {
  switch (result.status) {
    case 'approved':
      return { tone: 'info', text: t(result.change.status === 'noop' ? 'um.request.approvedAlready' : 'um.request.approved') };
    case 'denied':
      return { tone: 'info', text: t('um.request.denied') };
    case 'conflict':
      return { tone: 'alert', text: t('um.request.conflict') };
    case 'refused':
      return { tone: 'alert', text: result.refusals.map((r) => t(`um.request.decision.${r}`)).join(' ') };
    case 'not-approved':
      return { tone: 'alert', text: `${t('um.request.notApproved')} ${changeText(t, result.change)}` };
  }
}

function PendingRequest({ row, request, onChanged }: { row: RowView; request: AccessRequest; onChanged: () => Promise<void> }) {
  const t = useT();
  const { changeDeps, grant, grants, reload } = useUm();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'alert'; text: string } | null>(null);
  // Who the directory names for the object id on the request. `undefined` while unknown.
  const [live, setLive] = useState<DirectoryMember | null | undefined>(undefined);
  const directory = changeDeps?.directory;
  useEffect(() => {
    let current = true;
    void directory
      ?.findUser(request.requesterOid)
      .then((found) => current && setLive(found.state === 'ok' ? found.value : undefined))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [directory, request.requesterOid]);
  if (!changeDeps) return null;
  const mismatch = live !== undefined && (live === null || !sameRequester(request, live));

  const decide = async (approve: boolean) => {
    setBusy(true);
    setMessage(null);
    // Approving adds the person with the approver's own token: one permission, one sign-in window.
    if (approve && !grants.memberChange && !(await grant('memberChange'))) {
      setBusy(false);
      return setMessage({ tone: 'alert', text: `${t('um.change.grantRefused')} ${grantHint(t, 'memberChange')}` });
    }
    const result = approve ? await approveRequest(changeDeps, request, row) : await denyRequest(changeDeps, request, row, note);
    setMessage(decisionText(t, result));
    await reload();
    if (result.status === 'approved') await onChanged();
    setBusy(false);
  };

  return (
    <li className="space-y-2 rounded-lg bg-gray-50 p-3 text-sm">
      <p className="font-medium text-gray-900">{t('um.request.pending.by', { name: request.requesterName, upn: request.requesterUpn, date: day(request.createdAt) })}</p>
      <p className="whitespace-pre-wrap text-gray-700">{request.reason}</p>
      {request.reviewOn && <p className="text-gray-600">{t('um.request.pending.review', { date: request.reviewOn })}</p>}
      {mismatch && (
        <Notice tone="alert">
          {live ? t('um.request.pending.mismatch', { name: live.displayName ?? '', upn: live.userPrincipalName ?? live.id }) : t('um.request.pending.unknownPerson')}
        </Notice>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {request.status === 'Pending' && (
        <div className="flex flex-wrap items-end gap-2">
          <Button primary onClick={() => void decide(true)} disabled={busy || mismatch}>
            {t('um.request.approve')}
          </Button>
          <label className="text-xs text-gray-600">
            <span className="sr-only">{t('um.request.note')}</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder={t('um.request.note')}
              className="block w-64 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <Button onClick={() => void decide(false)} disabled={busy}>
            {t('um.request.deny')}
          </Button>
        </div>
      )}
    </li>
  );
}

/** In a group the viewer manages: the requests that wait for a decision. */
export function PendingRequests({ row, onChanged }: { row: RowView; onChanged: () => Promise<void> }) {
  const t = useT();
  const { requests, changeDeps, armed } = useUm();
  const pending = requests.filter((r) => r.status === 'Pending' && r.groupId === row.group.groupId.toLowerCase());
  if (!changeDeps || !armed || pending.length === 0) return null;
  return (
    <div className="mt-4 space-y-2 border-l-4 border-[#FF0000] pl-3">
      <p className="text-sm font-semibold text-gray-900">{t('um.request.pending.title')}</p>
      <ul className="space-y-2">
        {pending.map((request) => (
          <PendingRequest key={request.id} row={row} request={request} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  );
}

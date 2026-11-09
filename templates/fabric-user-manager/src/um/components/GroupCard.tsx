import { useState } from 'react';

import { useT } from '@/i18n';
import { countMembers } from '@/um/domain/eligibility';
import type { RowView } from '@/um/domain/views';
import type { DirectoryMember } from '@/um/domain/types';
import { useUm } from '@/um/hooks/UmContext';

import { AddMembers, RemoveMember } from './MemberChanges';
import { PendingRequests } from './Requests';
import { BindingList, Button, Card, Notice, Pill } from './parts';
import { reasonKey } from './text';

function memberType(member: DirectoryMember): 'user' | 'guest' | 'group' | 'servicePrincipal' | 'other' {
  if (member.type === 'user') return (member.userType ?? '').toLowerCase() === 'guest' ? 'guest' : 'user';
  if (member.type === 'group' || member.type === 'servicePrincipal') return member.type;
  return 'other';
}

/** One activated group the viewer manages: what it opens, and who is in it. Read-only. */
export function GroupCard({ row }: { row: RowView }) {
  const t = useT();
  const { members, loadMembers, changeDeps, armed, reviewDates, reload: reloadRecords } = useUm();
  const canChange = !!changeDeps && armed && row.group.active;
  const today = new Date().toISOString().slice(0, 10);
  const reviewOf = (userId: string) =>
    reviewDates.find((d) => d.groupId === row.group.groupId.toLowerCase() && d.userId === userId.toLowerCase())?.reviewOn;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = members[row.group.groupId.toLowerCase()];

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (!list) {
      setBusy(true);
      // A click: the directory scope may be requested interactively here.
      await loadMembers(row.group.groupId, true);
      setBusy(false);
    }
  };

  const reload = async () => {
    setBusy(true);
    await loadMembers(row.group.groupId, true);
    setBusy(false);
  };

  /** After a change: the live members again, and the stored review dates. */
  const afterChange = async () => {
    await loadMembers(row.group.groupId, false);
    await reloadRecords();
  };

  const counts = list?.state === 'ok' ? countMembers(list.value) : null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-gray-900">{row.group.nameSnapshot}</h4>
            {row.isOwner && <Pill tone="good">{t('um.row.owner')}</Pill>}
            {row.group.requestable && <Pill tone="info">{t('um.row.requestable')}</Pill>}
            {!row.group.active && <Pill>{t('um.row.inactive')}</Pill>}
            {row.highRole && (
              <Pill tone="alert" title={t('um.row.highRoleHint')}>
                {t('um.row.highRole')}
              </Pill>
            )}
          </div>
          {row.group.description && <p className="mt-1 text-sm text-gray-600">{row.group.description}</p>}
          <p className="mt-1 font-mono text-xs text-gray-400">
            {t('um.row.groupId')}
            {': '}
            {row.group.groupId}
          </p>
        </div>
        <Button onClick={() => void toggle()} disabled={busy}>
          {open ? t('um.members.hide') : t('um.members.show')}
        </Button>
      </div>

      <div className="mt-3">
        <BindingList bindings={row.bindings} />
      </div>

      <PendingRequests row={row} onChanged={afterChange} />

      {open && (
        <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          {busy && <p className="text-sm text-gray-500">{t('um.members.loading')}</p>}

          {!busy && list?.state === 'not-readable' && (
            <Notice tone="warn" action={<Button onClick={() => void reload()}>{t('um.members.reload')}</Button>}>
              {t('um.members.notReadable', { reason: t(reasonKey(list.reason)) })}
            </Notice>
          )}

          {!busy && list?.state === 'ok' && counts && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-gray-600">
                  {t('um.members.summary', {
                    users: counts.users,
                    guests: counts.guests,
                    nested: counts.nestedGroups,
                    other: counts.servicePrincipals + counts.other,
                  })}
                </p>
                <Button onClick={() => void reload()}>{t('um.members.refresh')}</Button>
              </div>
              {counts.nestedGroups > 0 && <Notice tone="warn">{t('um.members.nestedHint')}</Notice>}
              {list.value.length === 0 ? (
                <p className="text-sm text-gray-500">{t('um.members.empty')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                        <th className="px-2 py-1.5 font-medium">{t('um.members.col.name')}</th>
                        <th className="px-2 py-1.5 font-medium">{t('um.members.col.upn')}</th>
                        <th className="px-2 py-1.5 font-medium">{t('um.members.col.type')}</th>
                        <th className="px-2 py-1.5 font-medium">{t('um.members.col.review')}</th>
                        {canChange && <th className="px-2 py-1.5" />}
                      </tr>
                    </thead>
                    <tbody>
                      {list.value.map((m) => {
                        const type = memberType(m);
                        const review = reviewOf(m.id);
                        return (
                          <tr key={m.id} className="border-b border-gray-50 align-top last:border-0">
                            <td className="px-2 py-1.5 text-gray-800">{m.displayName ?? m.id}</td>
                            <td className="px-2 py-1.5 font-mono text-xs text-gray-500">{m.userPrincipalName ?? ''}</td>
                            <td className="px-2 py-1.5">
                              <Pill tone={type === 'user' ? 'neutral' : 'warn'}>{t(`um.members.type.${type}`)}</Pill>
                            </td>
                            <td className="px-2 py-1.5 text-gray-600">
                              {review && (
                                <Pill tone={review < today ? 'alert' : 'neutral'}>
                                  {review}
                                  {review < today && (
                                    <>
                                      {' · '}
                                      {t('um.members.overdue')}
                                    </>
                                  )}
                                </Pill>
                              )}
                            </td>
                            {canChange && <td className="px-2 py-1.5 text-right">{m.type === 'user' && <RemoveMember row={row} member={m} onChanged={afterChange} />}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {canChange ? <AddMembers row={row} onChanged={afterChange} /> : <p className="text-xs text-gray-500">{t('um.members.readOnly')}</p>}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

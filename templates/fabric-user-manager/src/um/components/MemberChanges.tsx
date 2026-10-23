import { useState } from 'react';

import { useT, type Translate } from '@/i18n';
import { BULK_LIMIT, checkReviewDate, parseBulk, type ChangePlan } from '@/um/domain/memberChange';
import type { DirectoryMember } from '@/um/domain/types';
import type { RowView } from '@/um/domain/views';
import { useUm } from '@/um/hooks/UmContext';
import { performChange, previewChange, type ChangeResult } from '@/um/services/memberChanges';

import { BindingList, Button, Notice, Pill } from './parts';
import { grantHint, reasonKey } from './text';

type Line =
  | { name: string; state: 'not-found' }
  | { name: string; state: 'not-readable'; reason: string }
  | { name: string; state: 'planned'; user: DirectoryMember; plan: ChangePlan }
  | { name: string; state: 'result'; user: DirectoryMember; result: ChangeResult }
  | { name: string; state: 'not-sent'; user: DirectoryMember };

/** Answers that would repeat for every remaining person: stop instead of sending them all. */
const STOPS_BULK = new Set(['denied', 'rate-limited', 'actor-mismatch']);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Pause between Graph calls of one bulk action, to stay clear of throttling. */
const PACE_MS = 250;

function planText(t: Translate, plan: ChangePlan): { tone: 'good' | 'warn' | 'neutral'; text: string } {
  if (!plan.ok) return { tone: 'warn', text: plan.refusals.map((r) => t(`um.change.refusal.${r}`)).join(' ') };
  if (plan.noop) return { tone: 'neutral', text: t(`um.change.state.${plan.noop}`) };
  return { tone: 'good', text: t('um.change.state.ready') };
}

function resultText(t: Translate, result: ChangeResult, action: 'add' | 'remove'): { tone: 'good' | 'warn' | 'neutral'; text: string } {
  switch (result.status) {
    case 'done':
      return result.confirmed
        ? { tone: 'good', text: t(action === 'add' ? 'um.change.state.added' : 'um.change.state.removed') }
        : { tone: 'warn', text: t('um.change.state.accepted') };
    case 'noop':
      return { tone: 'neutral', text: t(`um.change.state.${result.noop}`) };
    case 'refused':
      return { tone: 'warn', text: result.refusals.map((r) => t(`um.change.refusal.${r}`)).join(' ') };
    case 'failed':
      return { tone: 'warn', text: t(`um.change.failed.${result.code}`) };
  }
}

/** Add one or many people to one activated group: check first, then confirm. */
export function AddMembers({ row, onChanged }: { row: RowView; onChanged: () => Promise<void> }) {
  const t = useT();
  const { changeDeps, grant, grants, services, store } = useUm();
  const [text, setText] = useState('');
  const [reviewOn, setReviewOn] = useState('');
  const [lines, setLines] = useState<Line[] | null>(null);
  const [overLimit, setOverLimit] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!changeDeps) return null;
  const ready = (lines ?? []).filter((l): l is Extract<Line, { state: 'planned' }> => l.state === 'planned' && l.plan.ok && !l.plan.noop);

  const check = async () => {
    setMessage(null);
    setLines(null);
    const parsed = parseBulk(text);
    setOverLimit(parsed.overLimit);
    if (parsed.names.length === 0) return setMessage(t('um.change.add.none'));
    if (reviewOn) {
      const verdict = checkReviewDate(reviewOn, row.group.maxDays, new Date());
      if (verdict !== 'ok') return setMessage(t(`um.change.review.${verdict}`, { days: row.group.maxDays }));
    }
    setBusy(true);
    // One permission, one sign-in window, asked for by this click.
    if (!grants.memberChange && !(await grant('memberChange'))) {
      setBusy(false);
      return setMessage(`${t('um.change.grantRefused')} ${grantHint(t, 'memberChange')}`);
    }
    const next: Line[] = [];
    for (const [index, name] of parsed.names.entries()) {
      // Paced between lookups, not after the last one.
      if (index > 0) await wait(PACE_MS);
      const user = await services.directory.resolveUser(name);
      if (user.state !== 'ok') next.push({ name, state: 'not-readable', reason: t(reasonKey(user.reason)) });
      else if (!user.value) next.push({ name, state: 'not-found' });
      else next.push({ name, state: 'planned', user: user.value, plan: await previewChange(changeDeps, { action: 'add', groupId: row.group.groupId, user: user.value }, row) });
      setLines([...next]);
    }
    setBusy(false);
  };

  const apply = async () => {
    if (!lines) return;
    setBusy(true);
    const next = [...lines];
    let sent = 0;
    let stopped = false;
    let datesFailed = 0;
    for (let i = 0; i < next.length; i++) {
      const line = next[i];
      if (line.state !== 'planned' || !line.plan.ok || line.plan.noop) continue;
      if (stopped) {
        next[i] = { name: line.name, state: 'not-sent', user: line.user };
        continue;
      }
      if (sent++ > 0) await wait(PACE_MS);
      const result = await performChange(changeDeps, { action: 'add', groupId: row.group.groupId, user: line.user }, row);
      if (result.status === 'done' && reviewOn) {
        await store.setReviewDate(row.group.groupId, line.user.id, reviewOn, changeDeps.actor).catch(() => {
          datesFailed += 1;
        });
      }
      next[i] = { name: line.name, state: 'result', user: line.user, result };
      setLines([...next]);
      if (result.status === 'failed' && STOPS_BULK.has(result.code)) stopped = true;
      if (result.status === 'refused' && (result.refusals.includes('not-armed') || result.refusals.includes('log-unavailable'))) stopped = true;
    }
    setLines([...next]);
    if (datesFailed > 0) setMessage(t('um.change.review.notSaved', { count: datesFailed }));
    await onChanged();
    setText('');
    setBusy(false);
  };

  return (
    <div className="space-y-3 rounded-lg bg-gray-50 p-3">
      <p className="text-sm font-medium text-gray-900">{t('um.change.add.title')}</p>
      <label className="block text-sm text-gray-800">
        <span className="sr-only">{t('um.change.add.title')}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={t('um.change.add.placeholder')}
          className="block w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm text-gray-800">
          {t('um.change.add.reviewDate')}
          <input type="date" value={reviewOn} onChange={(e) => setReviewOn(e.target.value)} className="mt-1 block rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
        </label>
        <Button onClick={() => void check()} disabled={busy || !text.trim()}>
          {busy && !lines ? t('um.change.add.checking') : t('um.change.add.check')}
        </Button>
      </div>

      {message && <Notice tone="alert">{message}</Notice>}
      {overLimit > 0 && <Notice tone="warn">{t('um.change.add.overLimit', { count: overLimit, limit: BULK_LIMIT })}</Notice>}

      {lines && lines.length > 0 && (
        <>
          <div>
            <p className="text-sm text-gray-700">{t('um.change.add.gets')}</p>
            <div className="mt-1">
              <BindingList bindings={row.bindings} />
            </div>
          </div>
          <ul className="space-y-1.5">
            {lines.map((line) => {
              const shown =
                line.state === 'not-found'
                  ? { tone: 'warn' as const, text: t('um.change.state.not-found') }
                  : line.state === 'not-readable'
                    ? { tone: 'warn' as const, text: t('um.change.state.not-readable', { reason: line.reason }) }
                    : line.state === 'planned'
                      ? planText(t, line.plan)
                      : line.state === 'not-sent'
                        ? { tone: 'warn' as const, text: t('um.change.state.not-sent') }
                        : resultText(t, line.result, 'add');
              return (
                <li key={line.name} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-gray-900">{'user' in line ? (line.user.displayName ?? line.name) : line.name}</span>
                  <span className="font-mono text-xs text-gray-500">{line.name}</span>
                  <Pill tone={shown.tone}>{shown.text}</Pill>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-gray-500">{t('um.change.add.propagation')}</p>
          <div className="flex gap-2">
            {ready.length > 0 && (
              <Button primary onClick={() => void apply()} disabled={busy}>
                {t('um.change.add.confirm', { count: ready.length })}
              </Button>
            )}
            <Button onClick={() => setLines(null)} disabled={busy}>
              {t('um.activate.cancel')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Remove one direct member: a preview of what they lose, then one confirm. */
export function RemoveMember({ row, member, onChanged }: { row: RowView; member: DirectoryMember; onChanged: () => Promise<void> }) {
  const t = useT();
  const { changeDeps, grant, grants, store } = useUm();
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'warn' | 'neutral'; text: string } | null>(null);

  if (!changeDeps) return null;
  const request = { action: 'remove' as const, groupId: row.group.groupId, user: member };

  const open = async () => {
    setMessage(null);
    setBusy(true);
    if (!grants.memberChange && !(await grant('memberChange'))) {
      setBusy(false);
      return setMessage({ tone: 'warn', text: `${t('um.change.grantRefused')} ${grantHint(t, 'memberChange')}` });
    }
    setPlan(await previewChange(changeDeps, request, row));
    setBusy(false);
  };

  const confirm = async () => {
    setBusy(true);
    const result = await performChange(changeDeps, request, row);
    // Gone either way: a review date for a membership that no longer exists is noise.
    if (result.status === 'done' || (result.status === 'noop' && result.noop === 'not-member')) {
      await store.setReviewDate(row.group.groupId, member.id, null, changeDeps.actor).catch(() => undefined);
    }
    setMessage(resultText(t, result, 'remove'));
    setPlan(null);
    setBusy(false);
    await onChanged();
  };

  const name = member.displayName ?? member.userPrincipalName ?? member.id;

  return (
    <div className="space-y-2">
      {!plan && (
        <Button onClick={() => void open()} disabled={busy}>
          {t('um.change.remove')}
        </Button>
      )}
      {message && <Pill tone={message.tone}>{message.text}</Pill>}
      {plan && (
        <div className="space-y-2 rounded-lg border-l-4 border-[#FF0000] bg-white p-3 text-left text-sm ring-1 ring-gray-200">
          {plan.ok && !plan.noop ? (
            <>
              <p className="text-gray-900">{t('um.change.remove.confirm', { name, group: row.group.nameSnapshot })}</p>
              <BindingList bindings={row.bindings} />
              <p className="text-xs text-gray-500">{t('um.change.remove.otherPaths')}</p>
            </>
          ) : (
            <p className="text-gray-900">{planText(t, plan).text}</p>
          )}
          <div className="flex gap-2">
            {plan.ok && !plan.noop && (
              <Button primary onClick={() => void confirm()} disabled={busy}>
                {t('um.change.remove.yes')}
              </Button>
            )}
            <Button onClick={() => setPlan(null)} disabled={busy}>
              {t('um.activate.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

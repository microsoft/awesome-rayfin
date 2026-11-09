import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useT } from '@/i18n';
import { personMatches, type PersonMatch } from '@/um/domain/views';
import type { DirectoryMember } from '@/um/domain/types';
import { useUm } from '@/um/hooks/UmContext';

import { BindingList, Button, Card, Empty, Notice, Pill } from './parts';
import { reasonKey } from './text';

type State =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'not-found' }
  | { status: 'not-readable'; reason: string }
  | { status: 'found'; person: DirectoryMember; matches: PersonMatch[] };

/**
 * Where one person is a direct member, across the groups the viewer manages.
 * It consults no other group, so it reveals nothing the viewer could not
 * already see by opening their own groups one by one.
 */
export function PersonPage() {
  const t = useT();
  const [params] = useSearchParams();
  const query = params.get('q')?.trim() ?? '';
  const { rows, services, loadMembers, members, graphStatus } = useUm();
  const [state, setState] = useState<State>({ status: 'idle' });
  const manageable = rows.filter((r) => r.access === 'manage');

  const run = async (interactive: boolean) => {
    if (!query) return;
    setState({ status: 'searching' });
    const person = await services.directory.findUser(query, { interactive });
    if (person.state !== 'ok') return setState({ status: 'not-readable', reason: t(reasonKey(person.reason)) });
    if (!person.value) return setState({ status: 'not-found' });
    const loaded = { ...members };
    for (const row of manageable) {
      const id = row.group.groupId.toLowerCase();
      if (!loaded[id] || loaded[id].state !== 'ok') loaded[id] = await loadMembers(id, interactive);
    }
    setState({ status: 'found', person: person.value, matches: personMatches(person.value.id, manageable, loaded) });
  };

  useEffect(() => {
    // Silent first: if a token needs a click, the button below asks for it.
    if (graphStatus === 'connected') void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, graphStatus]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{t('um.person.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('um.person.intro')}</p>
      </div>

      {!query && <Empty>{t('um.person.needQuery')}</Empty>}
      {query && manageable.length === 0 && <Empty>{t('um.person.none')}</Empty>}
      {state.status === 'searching' && <p className="text-sm text-gray-500">{t('um.person.searching')}</p>}
      {state.status === 'not-found' && <Notice tone="warn">{t('um.person.notFound', { query })}</Notice>}
      {state.status === 'not-readable' && (
        <Notice tone="warn" action={<Button onClick={() => void run(true)}>{t('um.members.reload')}</Button>}>
          {t('um.person.notReadable', { reason: state.reason })}
        </Notice>
      )}

      {state.status === 'found' && (
        <>
          <Card>
            <p className="font-semibold text-gray-900">{state.person.displayName ?? state.person.id}</p>
            <p className="font-mono text-xs text-gray-500">{state.person.userPrincipalName ?? ''}</p>
          </Card>
          {state.matches.length > 0 && (
            <Card>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                    <th className="px-2 py-1.5 font-medium">{t('um.person.col.group')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('um.person.col.access')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('um.person.col.state')}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.matches.map(({ row, state: membership }) => (
                    <tr key={row.group.id} className="border-b border-gray-50 align-top last:border-0">
                      <td className="px-2 py-1.5 text-gray-800">{row.group.nameSnapshot}</td>
                      <td className="px-2 py-1.5">
                        <BindingList bindings={row.bindings} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Pill tone={membership === 'member' ? 'good' : membership === 'not-readable' ? 'warn' : 'neutral'}>
                          {t(`um.person.state.${membership}`)}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-gray-500">{t('um.person.directOnly')}</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';

import { useT } from '@/i18n';
import { PERMISSIONS, permissionState, type PermissionSet, type PermissionState } from '@/um/domain/permissions';
import { useUm } from '@/um/hooks/UmContext';
import type { Probe } from '@/um/services/graphAuth';

import { Button, Card, Notice, Pill, Section } from './parts';
import { grantHint } from './text';

const STATE_TONE: Record<PermissionState, 'neutral' | 'good' | 'warn' | 'alert'> = {
  checking: 'neutral',
  unknown: 'neutral',
  onDemand: 'neutral',
  granted: 'good',
  missing: 'warn',
  admin: 'alert',
};

function ConsentLink() {
  const t = useT();
  const { consentUrl } = useUm();
  if (!consentUrl) return null;
  return (
    <a href={consentUrl} target="_blank" rel="noreferrer" className="font-medium text-blue-700 underline">
      {t('um.perm.adminLink')}
    </a>
  );
}

/** Shown after a permission was asked for and not granted: what is known about why, and who can grant it. */
export function GrantRefusedNote({ set }: { set: PermissionSet }) {
  const t = useT();
  const { refused } = useUm();
  const why = refused[set];
  return (
    <Notice tone="alert">
      {grantHint(t, set, why)} {why !== 'closed' && <ConsentLink />}
    </Notice>
  );
}

/**
 * Setup: every permission the app can ask for, what it is for, and whether
 * this tab holds it.
 *
 * Looking never opens a sign-in window, and it only looks at the permissions
 * that read. The ones that change something are not looked at: that would
 * fetch a token able to change things before anyone started a change. They
 * show what this tab learned from actually asking.
 */
export function PermissionChecklist() {
  const t = useT();
  const { grants, grant, refused, checkGrants, writesInBuild, discover } = useUm();
  const [busy, setBusy] = useState(false);
  const [probes, setProbes] = useState<Partial<Record<PermissionSet, Probe>>>({});
  const looked = useRef(false);

  const look = async () => {
    setBusy(true);
    setProbes(await checkGrants());
    setBusy(false);
  };

  useEffect(() => {
    if (looked.current) return;
    looked.current = true;
    void checkGrants().then(setProbes);
  }, [checkGrants]);

  const allow = async (set: PermissionSet) => {
    setBusy(true);
    // A new read permission changes what discovery can see.
    if ((await grant(set)) && (set === 'fabric' || set === 'directory')) await discover();
    setBusy(false);
  };

  const shown = PERMISSIONS.filter((p) => writesInBuild || !p.writes);
  const stateOf = (set: PermissionSet) => permissionState(PERMISSIONS.find((p) => p.set === set)!, grants[set], probes[set]);
  const adminOpen = shown.some((p) => p.needsAdmin && stateOf(p.set) !== 'granted');

  return (
    <Section
      title={t('um.perm.title')}
      intro={t('um.perm.intro')}
      actions={
        <Button onClick={() => void look()} disabled={busy}>
          {t('um.perm.check')}
        </Button>
      }
    >
      <Card>
        <ul className="divide-y divide-gray-100">
          {shown.map((p) => {
            const state = stateOf(p.set);
            return (
              <li key={p.set} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-gray-900">{t(`um.perm.set.${p.set}`)}</p>
                  <p className="font-mono text-xs text-gray-500">{p.names.join(', ')}</p>
                  {refused[p.set] && state !== 'granted' && <p className="mt-1 text-xs text-gray-700">{grantHint(t, p.set, refused[p.set])}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {p.needsAdmin && state === 'onDemand' && <Pill tone="warn">{t('um.perm.adminMark')}</Pill>}
                  <Pill tone={STATE_TONE[state]}>{t(`um.perm.state.${state}`)}</Pill>
                  {/* Read permissions can be asked for here. The ones that change something are asked for where the change starts. */}
                  {!p.writes && (state === 'missing' || state === 'admin' || state === 'unknown') && (
                    <Button onClick={() => void allow(p.set)} disabled={busy}>
                      {t('um.grant.allow')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      {adminOpen && (
        <Notice tone="warn">
          {t('um.perm.adminNote')} <ConsentLink />
        </Notice>
      )}
    </Section>
  );
}

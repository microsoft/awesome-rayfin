/**
 * Small shared pieces of the Fabric User Manager views.
 *
 * Colour is never the only signal: every state also carries text. Red is the
 * pure semantic red and is reserved for errors and high-impact states.
 */
import type { ReactNode } from 'react';

import { useT } from '@/i18n';
import type { Binding } from '@/um/domain/types';

type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'alert';

const TONES: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700 ring-gray-500/20',
  info: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  warn: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  alert: 'bg-white text-[#FF0000] ring-[#FF0000]',
};

export function Pill({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/**
 * A workspace role. Each role has its own colour, from quiet (Viewer) to
 * strong (Admin), and always its name. Red stays reserved for errors and for
 * findings; a role is neither.
 */
const ROLE_TONES: Record<string, string> = {
  Admin: 'bg-violet-100 text-violet-900 ring-violet-600/30 font-semibold',
  Member: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  Contributor: 'bg-teal-50 text-teal-800 ring-teal-600/20',
  Viewer: 'bg-gray-100 text-gray-700 ring-gray-500/20',
};

export function RolePill({ role }: { role: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ROLE_TONES[role] ?? ROLE_TONES.Viewer}`}>{role}</span>;
}

export function Notice({ tone, children, action }: { tone: 'info' | 'warn' | 'alert'; children: ReactNode; action?: ReactNode }) {
  const style =
    tone === 'alert'
      ? 'border-l-4 border-[#FF0000] bg-white text-gray-900 ring-1 ring-gray-200'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-600/20 ring-inset'
        : 'bg-blue-50 text-blue-900 ring-1 ring-blue-600/20 ring-inset';
  return (
    <div role={tone === 'alert' ? 'alert' : 'status'} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-4 text-sm ${style}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  primary,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
        primary ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

export function Section({ title, intro, actions, children }: { title: string; intro?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          {intro && <p className="mt-1 max-w-3xl text-sm text-gray-600">{intro}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">{children}</p>;
}

/** What a group gives access to. Attested bindings are marked as such, always. */
export function BindingList({ bindings }: { bindings: readonly Binding[] }) {
  const t = useT();
  if (bindings.length === 0) return <Pill tone="warn">{t('um.row.noBindings')}</Pill>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {bindings.map((b, index) => (
        <li key={`${b.kind}:${b.scopeId ?? b.scopeName}:${b.label}:${index}`}>
          <Pill tone={b.provenance === 'read' ? 'info' : 'warn'} title={t(`um.binding.${b.provenance}Hint`)}>
            {t(`um.binding.kind.${b.kind}`)}
            {': '}
            {b.scopeName}
            {' / '}
            {b.label}
            {b.provenance !== 'read' && (
              <>
                {' · '}
                {t(`um.binding.${b.provenance}`)}
              </>
            )}
          </Pill>
        </li>
      ))}
    </ul>
  );
}

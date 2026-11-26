import { type ReactNode } from 'react';
import { Settings, RefreshCw } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';

// ---- Shared UI ----

export function SectionHeader({ icon: Icon, children, action }: { icon?: typeof Settings; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {Icon && <Icon size={16} className="text-[var(--c-accent)]" />}
      <h3 className="text-sm font-semibold text-[var(--c-text-primary)]">{children}</h3>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

export function SettingsRefreshButton({ onClick, retry = false }: { onClick: () => void; retry?: boolean }) {
  const { t } = useLocale();
  return <button type="button" onClick={onClick}
    className="inline-flex items-center gap-1.5 rounded-md border border-[var(--c-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)]">
    <RefreshCw size={13} aria-hidden="true" />
    {retry ? t.desktopReadonlyRetry : t.desktopReadonlyRefresh}
  </button>;
}

export function SettingsReadError({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--c-border)] p-3 text-sm text-[var(--c-text-secondary)]">
    <div role="alert" className="flex-1">{children}</div>
    <SettingsRefreshButton retry onClick={onRetry} />
  </div>;
}

export function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`mb-6 ${className || ''}`}>{children}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4 ${className || ''}`}
    >
      {children}
    </div>
  );
}

export const inputCls = 'w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--c-accent)]';
export const btnPrimary = 'rounded-lg bg-[var(--c-accent)] px-4 py-2 text-sm text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed';
export const btnSecondary = 'rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors';
export const btnDanger = 'rounded-lg border border-red-200 px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors';

import type { ReactNode } from 'react';

/** Shared presentation only. Task answers and permission decisions keep separate owners. */
export function UserDecisionCard({ label, prompt, children, actions }: { label?: string; prompt: ReactNode; children?: ReactNode; actions: ReactNode }) {
  return <section role={label ? 'region' : undefined} aria-label={label} className="rounded-xl border border-[var(--c-accent)]/30 bg-[var(--c-bg-card)] p-4">
    <p className="mb-3 text-sm">{prompt}</p>
    {children}
    <div className="flex flex-wrap gap-2">{actions}</div>
  </section>;
}

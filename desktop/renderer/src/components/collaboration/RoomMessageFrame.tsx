import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
export function RoomMessageFrame({ sender, label, preview, createdAt, children }: {
  sender: string; label?: string; preview?: string; createdAt?: string; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const date = createdAt ? new Date(createdAt) : null;
  const time = date && Number.isFinite(date.getTime()) ? date.toLocaleString() : undefined;
  return <article data-testid="room-message" className="group rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)]">
    {label ? <details open={expanded}>
      <summary onClick={event => { event.preventDefault(); setExpanded(value => !value); }} className="flex cursor-pointer list-none items-start gap-2 rounded-xl px-4 py-3 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden className={`mt-0.5 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium">{label}</span><span>{sender}</span>{time && <time dateTime={createdAt} className="text-[var(--c-text-tertiary)]">{time}</time>}</span>
          {preview && <span className="mt-1 block truncate text-[var(--c-text-tertiary)]">{preview}</span>}
        </span>
      </summary>
      {expanded && <div className="border-t border-[var(--c-border)] p-4">{children}</div>}
    </details> : <div className="p-4"><div className="mb-2 text-xs text-[var(--c-text-tertiary)]">{sender}</div>{children}</div>}
  </article>;
}

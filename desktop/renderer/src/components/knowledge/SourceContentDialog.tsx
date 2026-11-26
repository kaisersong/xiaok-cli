import { useLocale } from '../../contexts/LocaleContext';
import type { KbSourceContent } from './knowledge-types';

export function SourceContentDialog({
  content,
  loading,
  error,
  onClose,
}: {
  content: KbSourceContent | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const title = content?.source.title || t.knowledge.sourceContentTitle;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]" role="presentation" onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="flex max-h-[82vh] w-[720px] flex-col rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] shadow-lg" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--c-border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-[var(--c-text-primary)]">{title}</h3>
            {content && (
              <div className="mt-1 flex items-center gap-2 text-xs text-[var(--c-text-tertiary)]">
                <span>{t.knowledge.chunkCount(content.source.chunkCount)}</span>
                <StatusBadge status={content.source.parseStatus} />
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)]">
            {t.knowledge.close}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-[var(--c-text-secondary)]">{t.knowledge.sourceContentLoading}</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : content?.text.trim() ? (
            <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--c-text-primary)]">{content.text}</pre>
          ) : (
            <p className="text-sm text-[var(--c-text-secondary)]">{t.knowledge.sourceContentEmpty}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLocale();
  switch (status) {
    case 'parsed': return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">{t.knowledge.statusParsed}</span>;
    case 'pending': return <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-700">{t.knowledge.statusPending}</span>;
    case 'parsing': return <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">{t.knowledge.statusParsing}</span>;
    case 'failed': return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">{t.knowledge.statusFailed}</span>;
    default: return null;
  }
}

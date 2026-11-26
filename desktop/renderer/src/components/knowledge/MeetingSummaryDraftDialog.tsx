import { useLocale } from '../../contexts/LocaleContext';
import { formatMeetingSegmentTime } from './meeting-transcription';
import type { MeetingPreviewSegment } from './meeting-transcription';

export function MeetingSummaryDraftDialog({
  title,
  setTitle,
  audioFilePath,
  previewSegments,
  summaryDraft,
  setSummaryDraft,
  draftSaving,
  message,
  onSaveDraft,
  onCancel,
}: {
  title: string;
  setTitle: (value: string) => void;
  audioFilePath: string;
  previewSegments: MeetingPreviewSegment[];
  summaryDraft: string;
  setSummaryDraft: (value: string) => void;
  draftSaving: boolean;
  message: { kind: 'error' | 'success'; text: string } | null;
  onSaveDraft: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]" role="presentation" onClick={onCancel} onKeyDown={event => { if (event.key === 'Escape') onCancel(); }}>
      <div
        className="flex max-h-[86vh] w-[760px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] shadow-lg"
        role="dialog"
        aria-label={t.knowledge.meetingSummaryDraftTitle}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--c-border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-[var(--c-text-primary)]">{t.knowledge.meetingSummaryDraftTitle}</h3>
            <p className="mt-1 truncate text-xs text-[var(--c-text-tertiary)]">{t.knowledge.meetingDraftReady}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={draftSaving} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)] disabled:opacity-50">
            {t.knowledge.cancel}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingRecordingTitleLabel}</span>
            <input
              type="text"
              value={title}
              onChange={event => setTitle(event.target.value)}
              aria-label={t.knowledge.meetingRecordingTitleLabel}
              className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
            />
          </label>

          <label className="flex min-h-[260px] flex-1 flex-col">
            <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingSummaryDraftLabel}</span>
            <textarea
              value={summaryDraft}
              onChange={event => setSummaryDraft(event.target.value)}
              aria-label={t.knowledge.meetingSummaryDraftLabel}
              placeholder={t.knowledge.meetingSummaryDraftPlaceholder}
              className="min-h-0 flex-1 resize-none rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] px-4 py-3 text-sm leading-6 text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)]"
            />
          </label>

          {previewSegments.length > 0 && (
            <div className="max-h-36 overflow-y-auto rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2">
              <p className="mb-2 text-xs text-[var(--c-text-tertiary)]">{t.knowledge.meetingTranscriptPreviewLabel}</p>
              <div className="space-y-1" role="list" aria-label={t.knowledge.meetingTranscriptPreviewLabel}>
                {previewSegments.map((segment, index) => (
                  <div key={`${index}-${segment.start}-${segment.text}`} role="listitem" className="flex items-start gap-2 text-xs leading-5">
                    <span className="w-10 shrink-0 text-right tabular-nums text-[var(--c-text-tertiary)]">{formatMeetingSegmentTime(segment.start)}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[var(--c-text-secondary)]">{segment.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {message && (
            <p className={`text-xs leading-5 ${message.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>
              {message.text}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={draftSaving || !summaryDraft.trim() || !audioFilePath}
              className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {draftSaving ? t.knowledge.meetingSaving : t.knowledge.meetingSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

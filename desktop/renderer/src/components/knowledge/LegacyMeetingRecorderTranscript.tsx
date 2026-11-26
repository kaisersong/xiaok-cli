import { useLocale } from '../../contexts/LocaleContext';
import { formatMeetingSegmentTime } from './meeting-transcription';
import type { MeetingPreviewSegment, MeetingTranscriberModel, MeetingTranscriberLanguage } from './meeting-transcription';

export function LegacyMeetingRecorderTranscript({
  hasSummaryDraft,
  t,
  transcriberModel,
  transcriberLanguage,
  summaryDraft,
  setSummaryDraft,
  previewSegments,
  onSaveDraft,
  draftSaving,
  audioFilePath,
  recording,
  paused,
  processing,
}: {
  hasSummaryDraft: boolean;
  t: ReturnType<typeof useLocale>['t'];
  transcriberModel: MeetingTranscriberModel;
  transcriberLanguage: MeetingTranscriberLanguage;
  summaryDraft: string;
  setSummaryDraft: (value: string) => void;
  previewSegments: MeetingPreviewSegment[];
  onSaveDraft: () => void;
  draftSaving: boolean;
  audioFilePath: string;
  recording: boolean;
  paused: boolean;
  processing: boolean;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium text-[var(--c-text-primary)]">
          {hasSummaryDraft ? t.knowledge.meetingSummaryDraftTitle : t.knowledge.meetingLiveTranscriptTitle}
        </h4>
        <span className="shrink-0 rounded-full border border-[var(--c-border)] px-2 py-0.5 text-[10px] text-[var(--c-text-tertiary)]">
          {transcriberModel} / {transcriberLanguage}
        </span>
      </div>
      {hasSummaryDraft ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <label className="flex min-h-0 flex-1 flex-col">
            <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingSummaryDraftLabel}</span>
            <textarea
              value={summaryDraft}
              onChange={e => setSummaryDraft(e.target.value)}
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
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-4">
          {previewSegments.length > 0 ? (
            <div className="space-y-3" role="list" aria-label={t.knowledge.meetingLiveTranscriptTitle}>
              {previewSegments.map((segment, index) => {
                const active = index === previewSegments.length - 1 && recording && !paused;
                return (
                  <div
                    key={`${index}-${segment.start}-${segment.text}`}
                    role="listitem"
                    data-transcript-line={active ? 'active' : 'complete'}
                    className="flex items-start gap-3"
                  >
                    <span className="mt-2 w-11 shrink-0 text-right text-xs tabular-nums text-[var(--c-text-tertiary)]">
                      {formatMeetingSegmentTime(segment.start)}
                    </span>
                    <div className={`min-w-0 flex-1 ${active ? 'rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 shadow-sm' : 'px-3 py-2'}`}>
                      <p className="whitespace-pre-wrap break-words text-base leading-7 text-[var(--c-text-primary)]">
                        {segment.text}
                      </p>
                    </div>
                  </div>
                );
              })}
              {recording && !paused && !processing && (
                <div className="flex items-center gap-2 pl-14 text-sm text-[var(--c-text-secondary)]">
                  <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
                  <span>{t.knowledge.meetingListening}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-60 flex-col items-center justify-center text-center">
              <span className={`mb-3 h-2.5 w-2.5 rounded-full ${recording && !paused ? 'animate-pulse bg-blue-500' : 'bg-[var(--c-text-tertiary)]'}`} />
              <p className="text-sm text-[var(--c-text-secondary)]">{t.knowledge.meetingTranscriptPreviewEmpty}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

import { useLocale } from '../../contexts/LocaleContext';

export function MeetingImportDialog({
  title,
  setTitle,
  audioFilePath,
  transcript,
  setTranscript,
  saving,
  message,
  onPickAudio,
  onSave,
  onCancel,
}: {
  title: string;
  setTitle: (value: string) => void;
  audioFilePath: string;
  transcript: string;
  setTranscript: (value: string) => void;
  saving: boolean;
  message: { kind: 'error' | 'success'; text: string } | null;
  onPickAudio: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]" role="presentation" onClick={onCancel} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="w-[520px] rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-5 shadow-lg" role="dialog" aria-label={t.knowledge.meetingImportTitle} onClick={e => e.stopPropagation()}>
        <h3 className="mb-4 text-sm font-medium text-[var(--c-text-primary)]">{t.knowledge.meetingImportTitle}</h3>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingTitleLabel}</span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              aria-label={t.knowledge.meetingTitleLabel}
              placeholder={t.knowledge.meetingTitlePlaceholder}
              className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
            />
          </label>
          <div>
            <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingAudioLabel}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onPickAudio} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
                {t.knowledge.meetingPickAudio}
              </button>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--c-text-tertiary)]">
                {audioFilePath || t.knowledge.meetingNoAudioSelected}
              </span>
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingTranscriptLabel}</span>
            <textarea
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              aria-label={t.knowledge.meetingTranscriptLabel}
              placeholder={t.knowledge.meetingTranscriptPlaceholder}
              rows={7}
              className="w-full resize-none rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
            />
          </label>
          {message && (
            <p className={`text-xs ${message.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>
              {message.text}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onCancel} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)]">{t.knowledge.cancel}</button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !audioFilePath || !transcript.trim()}
              className="rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {saving ? t.knowledge.meetingSaving : t.knowledge.meetingSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

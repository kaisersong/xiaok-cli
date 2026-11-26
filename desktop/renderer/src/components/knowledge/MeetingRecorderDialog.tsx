import { useLocale } from '../../contexts/LocaleContext';
import { MEETING_RECORDING_SCENARIO_OPTIONS } from './meeting-transcription';
import type { MeetingPreviewSegment, MeetingTranscriberEngine, MeetingTranscriberModel, MeetingTranscriberLanguage, MeetingRecordingScenario } from './meeting-transcription';

export function MeetingRecorderDialog({
  title,
  setTitle,
  recording,
  paused,
  audioLevels,
  previewSegments,
  transcriberEngine,
  transcriberModel,
  transcriberLanguage,
  scenario,
  setScenario,
  recordingSaving,
  processing,
  message,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onFinishRecording,
  onCancel,
}: {
  title: string;
  setTitle: (value: string) => void;
  recording: boolean;
  paused: boolean;
  audioLevels: number[];
  previewSegments: MeetingPreviewSegment[];
  transcriberEngine: MeetingTranscriberEngine;
  transcriberModel: MeetingTranscriberModel;
  transcriberLanguage: MeetingTranscriberLanguage;
  scenario: MeetingRecordingScenario;
  setScenario: (value: MeetingRecordingScenario) => void;
  recordingSaving: boolean;
  processing: boolean;
  message: { kind: 'error' | 'success'; text: string } | null;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onFinishRecording: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const engineLabels: Record<MeetingTranscriberEngine, string> = {
    'sherpa-onnx-paraformer': t.knowledge.meetingSpeechEngineSherpaOnnxParaformer,
    whisper: t.knowledge.meetingSpeechEngineWhisperFallback,
    'volcengine-asr': t.knowledge.meetingSpeechEngineVolcengineAsr,
    'aliyun-asr': t.knowledge.meetingSpeechEngineAliyunAsr,
  };
  const languageLabels: Record<MeetingTranscriberLanguage, string> = {
    zh: t.knowledge.meetingLanguageZh,
    auto: t.knowledge.meetingLanguageAuto,
    en: t.knowledge.meetingLanguageEn,
  };
  const scenarioLabels: Record<MeetingRecordingScenario, string> = {
    discussion: t.knowledge.meetingScenarioDiscussion,
    meeting: t.knowledge.meetingScenarioMeeting,
    sales: t.knowledge.meetingScenarioSales,
  };
  const latestSegment = previewSegments[previewSegments.length - 1];
  const latestText = latestSegment?.text?.trim() || t.knowledge.meetingTranscriptPreviewEmpty;
  const busy = recordingSaving || processing;
  const statusText = recording
    ? (paused ? t.knowledge.meetingRecordingPaused : t.knowledge.meetingRecording)
    : recordingSaving
      ? t.knowledge.meetingRecordingSaving
      : processing
        ? t.knowledge.meetingTranscribing
        : t.knowledge.meetingRecordingReady;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] shadow-xl"
      role="dialog"
      aria-label={t.knowledge.meetingRecorderTitle}
      onKeyDown={event => { if (event.key === 'Escape' && !recording && !busy) onCancel(); }}
    >
      <div className="border-b border-[var(--c-border)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-[var(--c-text-primary)]">{t.knowledge.meetingRecorderTitle}</h3>
            <p className="mt-1 truncate text-xs text-[var(--c-text-tertiary)]">
              {engineLabels[transcriberEngine]} / {languageLabels[transcriberLanguage]}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={recording || busy}
            className="shrink-0 rounded-md border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-40"
          >
            {t.knowledge.cancel}
          </button>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <label className="block">
          <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingRecordingTitleLabel}</span>
          <input
            type="text"
            value={title}
            onChange={event => setTitle(event.target.value)}
            aria-label={t.knowledge.meetingRecordingTitleLabel}
            disabled={recording || busy}
            className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)] disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingScenarioLabel}</span>
          <select
            value={scenario}
            onChange={event => setScenario(event.target.value as MeetingRecordingScenario)}
            aria-label={t.knowledge.meetingScenarioLabel}
            disabled={recording || busy}
            className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)] disabled:opacity-60"
          >
            {MEETING_RECORDING_SCENARIO_OPTIONS.map(option => (
              <option key={option} value={option}>{scenarioLabels[option]}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2">
          <span className={`h-2.5 w-2.5 rounded-full ${recording && !paused ? 'animate-pulse bg-red-500' : paused ? 'bg-amber-500' : busy ? 'bg-blue-500' : 'bg-[var(--c-text-tertiary)]'}`} />
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--c-text-primary)]">{statusText}</span>
          <span className="shrink-0 text-[11px] text-[var(--c-text-tertiary)]">{transcriberModel}</span>
        </div>

        {recording ? (
          <div className="grid grid-cols-[72px_minmax(0,1fr)_72px] gap-2">
            <button
              type="button"
              onClick={paused ? onResumeRecording : onPauseRecording}
              disabled={busy}
              className="rounded-md border border-[var(--c-border)] px-3 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50"
            >
              {paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause}
            </button>
            <button
              type="button"
              aria-label={t.knowledge.meetingAudioLevelLabel}
              disabled
              className="flex h-10 items-end justify-center gap-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-2 disabled:opacity-100"
            >
              {audioLevels.map((level, index) => {
                const normalized = Math.max(0, Math.min(1, level));
                return (
                  <span
                    key={index}
                    data-audio-level={normalized.toFixed(2)}
                    className={`w-1 shrink-0 rounded-full transition-[height,background-color] duration-100 ${recording && !paused ? 'bg-red-500' : paused ? 'bg-amber-400' : 'bg-[var(--c-border)]'}`}
                    style={{ height: `${Math.max(4, Math.round(4 + Math.sqrt(normalized) * 26))}px` }}
                  />
                );
              })}
            </button>
            <button
              type="button"
              onClick={onFinishRecording}
              disabled={busy}
              className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {t.knowledge.meetingRecordStop}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStartRecording}
            disabled={busy}
            className="w-full rounded-lg bg-[var(--c-accent)] px-4 py-3 text-base font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {recordingSaving ? t.knowledge.meetingRecordingSaving : processing ? t.knowledge.meetingTranscribing : t.knowledge.meetingRecordStart}
          </button>
        )}

        <div>
          <p className="mb-1 text-xs font-medium text-[var(--c-text-secondary)]">{t.knowledge.meetingLatestTranscriptTitle}</p>
          <p className="line-clamp-2 min-h-[40px] rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm leading-5 text-[var(--c-text-primary)]">
            {latestText}
          </p>
        </div>

        {message && (
          <p className={`text-xs leading-5 ${message.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}

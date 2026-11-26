import { useState } from 'react';
import {
  Mic,
  Minimize2,
  Maximize2,
  Pause,
  Play,
  LoaderCircle,
  X,
  Pencil,
  Check,
} from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { MEETING_RECORDING_SCENARIO_OPTIONS, formatMeetingElapsedTime } from './meeting-transcription';
import type { MeetingPreviewSegment, MeetingTranscriberEngine, MeetingTranscriberLanguage, MeetingRecordingScenario } from './meeting-transcription';
import { MeetingAudioWaveform } from './MeetingAudioWaveform';

export function MeetingRecorderWindowSurface({
  title,
  setTitle,
  view,
  recording,
  paused,
  elapsedMs,
  audioLevels,
  previewSegments,
  summaryDraft,
  setSummaryDraft,
  draftTranscript,
  transcriberEngine,
  transcriberLanguage,
  scenario,
  setScenario,
  recordingSaving,
  processing,
  draftSaving,
  message,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onFinishRecording,
  onCompact,
  onExpand,
  onSaveDraft,
  onCancel,
}: {
  title: string;
  setTitle: (value: string) => void;
  view: 'workbench' | 'compact' | 'summary';
  recording: boolean;
  paused: boolean;
  elapsedMs: number;
  audioLevels: number[];
  previewSegments: MeetingPreviewSegment[];
  summaryDraft: string;
  setSummaryDraft: (value: string) => void;
  draftTranscript: string;
  transcriberEngine: MeetingTranscriberEngine;
  transcriberLanguage: MeetingTranscriberLanguage;
  scenario: MeetingRecordingScenario;
  setScenario: (value: MeetingRecordingScenario) => void;
  recordingSaving: boolean;
  processing: boolean;
  draftSaving: boolean;
  message: { kind: 'error' | 'success'; text: string } | null;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onFinishRecording: () => void;
  onCompact: () => void;
  onExpand: () => void;
  onSaveDraft: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [summaryTab, setSummaryTab] = useState<'summary' | 'transcript'>('summary');
  const [summaryEditing, setSummaryEditing] = useState(false);
  const busy = recordingSaving || processing;
  const latestText = previewSegments.at(-1)?.text?.trim() || t.knowledge.meetingTranscriptPreviewEmpty;
  const transcriptText = draftTranscript.trim() || previewSegments.map(segment => segment.text).join('\n');
  const elapsed = formatMeetingElapsedTime(elapsedMs);
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

  if (view === 'compact') {
    return (
      <main
        className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--c-bg-card)] px-5 pb-4 pt-3 text-[var(--c-text-primary)]"
        role="main"
        aria-label={t.knowledge.meetingRecorderTitle}
        data-app-region="drag"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-start gap-3">
          <p className="line-clamp-2 min-h-[52px] min-w-0 flex-1 text-lg leading-7">{latestText}</p>
          <button type="button" onClick={onExpand} aria-label={t.knowledge.meetingRecorderExpand} title={t.knowledge.meetingRecorderExpand} data-app-region="no-drag" className="grid size-8 shrink-0 place-items-center rounded-md text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <Maximize2 size={18} />
          </button>
        </div>
        {message?.kind === 'error' && <p role="alert" className="text-sm text-red-600">{message.text}</p>}
        <div data-testid="meeting-compact-waveform" className="mt-1">
          <MeetingAudioWaveform audioLevels={audioLevels} active={recording} paused={paused} compact />
        </div>
        <div data-testid="meeting-compact-controls" className="grid grid-cols-[80px_1fr_80px] items-center gap-3" style={{ marginTop: 4 }}>
          <span className="text-base tabular-nums text-[var(--c-text-secondary)]">{elapsed}</span>
          <button type="button" onClick={paused ? onResumeRecording : onPauseRecording} aria-label={paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause} title={paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause} data-app-region="no-drag" className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--c-bg-deep)] text-[var(--c-text-primary)] hover:bg-[var(--c-border)]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {paused ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
          </button>
          <button type="button" onClick={onFinishRecording} disabled={busy} data-app-region="no-drag" className="rounded-full bg-[var(--c-bg-deep)] px-4 py-2 text-sm font-medium hover:bg-[var(--c-border)] disabled:opacity-50" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {t.knowledge.meetingRecordStop}
          </button>
        </div>
      </main>
    );
  }

  if (view === 'summary') {
    return (
      <main className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--c-bg-card)] px-14 pb-8 pt-12 text-[var(--c-text-primary)]" role="main" aria-label={t.knowledge.meetingRecorderTitle}>
        <header className="shrink-0 border-b border-[var(--c-border)] pb-5">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <input value={title} onChange={event => setTitle(event.target.value)} aria-label={t.knowledge.meetingRecordingTitleLabel} className="w-full bg-transparent text-3xl font-semibold leading-tight outline-none" />
              <p className="mt-2 text-sm tabular-nums text-[var(--c-text-tertiary)]">{elapsed}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {summaryTab === 'summary' && (
                <button type="button" onClick={() => setSummaryEditing(value => !value)} aria-label={summaryEditing ? t.knowledge.meetingRecorderFinishEditing : t.knowledge.meetingRecorderEditSummary} title={summaryEditing ? t.knowledge.meetingRecorderFinishEditing : t.knowledge.meetingRecorderEditSummary} className="grid size-9 place-items-center rounded-md text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
                  {summaryEditing ? <Check size={19} /> : <Pencil size={18} />}
                </button>
              )}
              <button type="button" onClick={onCancel} disabled={draftSaving} aria-label={t.knowledge.cancel} title={t.knowledge.cancel} className="grid size-9 place-items-center rounded-md text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50">
                <X size={20} />
              </button>
            </div>
          </div>
          <div className="mt-7 flex gap-8" role="tablist">
            <button type="button" role="tab" aria-selected={summaryTab === 'summary'} onClick={() => setSummaryTab('summary')} className={`border-b-2 pb-3 text-base font-medium ${summaryTab === 'summary' ? 'border-[var(--c-text-primary)] text-[var(--c-text-primary)]' : 'border-transparent text-[var(--c-text-tertiary)]'}`}>
              {t.knowledge.meetingRecorderSummaryTab}
            </button>
            <button type="button" role="tab" aria-selected={summaryTab === 'transcript'} onClick={() => setSummaryTab('transcript')} className={`border-b-2 pb-3 text-base font-medium ${summaryTab === 'transcript' ? 'border-[var(--c-text-primary)] text-[var(--c-text-primary)]' : 'border-transparent text-[var(--c-text-tertiary)]'}`}>
              {t.knowledge.meetingRecorderTranscriptTab}
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto py-7">
          {summaryTab === 'summary' ? (summaryEditing ? (
            <textarea value={summaryDraft} onChange={event => setSummaryDraft(event.target.value)} aria-label={t.knowledge.meetingSummaryDraftLabel} className="h-full min-h-[420px] w-full resize-none rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-5 py-4 text-base leading-8 outline-none focus:border-[var(--c-accent)]" />
          ) : (
            <div className="meeting-summary-markdown text-base leading-8">
              <MarkdownRenderer content={summaryDraft} />
            </div>
          )) : (
            <div className="whitespace-pre-wrap text-base leading-8 text-[var(--c-text-secondary)]">{transcriptText || t.knowledge.meetingTranscriptPreviewEmpty}</div>
          )}
        </div>
        {message?.kind === 'error' && <p className="mb-3 text-sm text-red-600">{message.text}</p>}
        <footer className="flex shrink-0 justify-end border-t border-[var(--c-border)] pt-5">
          <button type="button" onClick={onSaveDraft} disabled={draftSaving || !summaryDraft.trim()} className="rounded-md bg-[var(--c-accent)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {draftSaving ? t.knowledge.meetingSaving : t.knowledge.meetingSave}
          </button>
        </footer>
      </main>
    );
  }

  if (busy && !recording) {
    return (
      <main className="flex h-screen w-screen flex-col items-center justify-center bg-[var(--c-bg-card)] px-8 text-center text-[var(--c-text-primary)]" role="main" aria-label={t.knowledge.meetingRecorderTitle}>
        <LoaderCircle size={34} className="animate-spin text-[var(--c-accent)]" />
        <h1 className="mt-6 text-2xl font-semibold">{t.knowledge.meetingRecorderProcessingTitle}</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-[var(--c-text-secondary)]">{t.knowledge.meetingRecorderProcessingHint}</p>
        {message && <p className={`mt-5 text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-[var(--c-text-tertiary)]'}`}>{message.text}</p>}
      </main>
    );
  }

  if (!recording) {
    return (
      <main className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--c-bg-card)] px-14 pb-10 pt-12 text-[var(--c-text-primary)]" role="main" aria-label={t.knowledge.meetingRecorderTitle}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-semibold leading-tight">{t.knowledge.meetingRecorderTitle}</h1>
            <p className="mt-3 text-sm text-[var(--c-text-tertiary)]">{engineLabels[transcriberEngine]} / {languageLabels[transcriberLanguage]}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label={t.knowledge.cancel} title={t.knowledge.cancel} className="grid size-9 place-items-center rounded-md text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
            <X size={20} />
          </button>
        </div>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6">
          <label>
            <span className="mb-2 block text-sm text-[var(--c-text-secondary)]">{t.knowledge.meetingRecordingTitleLabel}</span>
            <input type="text" value={title} onChange={event => setTitle(event.target.value)} aria-label={t.knowledge.meetingRecordingTitleLabel} className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-4 py-3 text-base outline-none focus:border-[var(--c-accent)]" />
          </label>
          <label>
            <span className="mb-2 block text-sm text-[var(--c-text-secondary)]">{t.knowledge.meetingScenarioLabel}</span>
            <select value={scenario} onChange={event => setScenario(event.target.value as MeetingRecordingScenario)} aria-label={t.knowledge.meetingScenarioLabel} className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-4 py-3 text-base outline-none focus:border-[var(--c-accent)]">
              {MEETING_RECORDING_SCENARIO_OPTIONS.map(option => <option key={option} value={option}>{scenarioLabels[option]}</option>)}
            </select>
          </label>
          <button type="button" onClick={onStartRecording} className="mx-auto mt-5 min-w-56 rounded-md bg-[var(--c-accent)] px-8 py-4 text-lg font-medium text-white shadow-sm hover:opacity-90">
            <Mic size={20} className="mr-2 inline" />{t.knowledge.meetingRecordStart}
          </button>
          {message && <p className={`text-center text-sm ${message.kind === 'error' ? 'text-red-600' : 'text-[var(--c-text-secondary)]'}`}>{message.text}</p>}
        </div>
      </main>
    );
  }

  const liveHighlights = previewSegments.slice(-4);
  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--c-bg-card)] pt-10 text-[var(--c-text-primary)]" role="main" aria-label={t.knowledge.meetingRecorderTitle}>
      <header className="flex shrink-0 items-start justify-between border-b border-[var(--c-border)] px-12 pb-5">
        <div className="min-w-0">
          <input value={title} onChange={event => setTitle(event.target.value)} aria-label={t.knowledge.meetingRecordingTitleLabel} className="w-full min-w-[360px] bg-transparent text-2xl font-semibold outline-none" />
          <p className="mt-2 text-sm tabular-nums text-[var(--c-text-tertiary)]">{elapsed} · {paused ? t.knowledge.meetingRecordingPaused : t.knowledge.meetingRecording}</p>
        </div>
        <button type="button" onClick={onCompact} aria-label={t.knowledge.meetingRecorderMinimize} title={t.knowledge.meetingRecorderMinimize} className="grid size-9 place-items-center rounded-md text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">
          <Minimize2 size={19} />
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="flex min-h-0 flex-col border-r border-[var(--c-border)] px-12 py-7">
          <h2 className="shrink-0 text-xl font-semibold">{t.knowledge.meetingRecorderTranscriptTitle}</h2>
          <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-3 text-lg leading-9">
            {previewSegments.length > 0 ? previewSegments.map((segment, index) => (
              <p key={`${segment.start}-${index}`} className="mb-4">{segment.text}</p>
            )) : <p className="text-[var(--c-text-tertiary)]">{t.knowledge.meetingTranscriptPreviewEmpty}</p>}
          </div>
        </section>
        <section className="flex min-h-0 flex-col px-12 py-7">
          <h2 className="shrink-0 text-xl font-semibold">{t.knowledge.meetingRecorderHighlightsTitle}</h2>
          <div className="mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto">
            {liveHighlights.length > 0 ? liveHighlights.map((segment, index) => (
              <div key={`${segment.start}-${index}`} className="rounded-md bg-[var(--c-bg-deep)] px-5 py-4 text-base leading-7">{segment.text}</div>
            )) : <p className="text-sm leading-6 text-[var(--c-text-tertiary)]">{t.knowledge.meetingRecorderHighlightsEmpty}</p>}
          </div>
        </section>
      </div>
      <footer className="grid shrink-0 grid-cols-[90px_minmax(200px,1fr)_56px_90px] items-center gap-5 border-t border-[var(--c-border)] px-12 py-5">
        <span className="text-lg tabular-nums">{elapsed}</span>
        <MeetingAudioWaveform audioLevels={audioLevels} active={recording} paused={paused} />
        <button type="button" onClick={paused ? onResumeRecording : onPauseRecording} aria-label={paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause} title={paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause} className="grid size-12 place-items-center rounded-full bg-[var(--c-bg-deep)] hover:bg-[var(--c-border)]">
          {paused ? <Play size={21} fill="currentColor" /> : <Pause size={21} fill="currentColor" />}
        </button>
        <button type="button" onClick={onFinishRecording} className="rounded-full bg-[var(--c-bg-deep)] px-5 py-2.5 text-sm font-medium hover:bg-[var(--c-border)]">
          {t.knowledge.meetingRecordStop}
        </button>
      </footer>
      {message?.kind === 'error' && <p role="alert" className="absolute bottom-24 left-12 text-sm text-red-600">{message.text}</p>}
    </main>
  );
}

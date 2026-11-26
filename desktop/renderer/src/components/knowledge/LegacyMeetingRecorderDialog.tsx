import { useState, useEffect } from 'react';
import { Download, RotateCcw, Trash2, Settings2 } from 'lucide-react';
import { useLocale } from '../../contexts/LocaleContext';
import { MEETING_SHERPA_ONNX_PARA_MODEL, MEETING_TRANSCRIBER_ENGINE_OPTIONS, MEETING_TRANSCRIBER_MODEL_OPTIONS, MEETING_RECORDING_SCENARIO_OPTIONS, isLocalMeetingTranscriberEngine, meetingTranscriberEngineForModel } from './meeting-transcription';
import type { MeetingPreviewSegment, MeetingModelStatusSnapshot, MeetingModelActionState, MeetingAsrConfigSnapshot, MeetingSaveAsrConfigInput, MeetingTranscriberEngine, MeetingTranscriberModel, MeetingTranscriberLanguage, MeetingRecordingScenario } from './meeting-transcription';
import { LegacyMeetingRecorderTranscript } from './LegacyMeetingRecorderTranscript';

export function LegacyMeetingRecorderDialog({
  title,
  setTitle,
  audioFilePath,
  recording,
  paused,
  audioLevels,
  previewSegments,
  summaryDraft,
  setSummaryDraft,
  transcriberEngine,
  setTranscriberEngine,
  transcriberModel,
  setTranscriberModel,
  transcriberLanguage,
  setTranscriberLanguage,
  asrConfig,
  asrConfigSaving,
  onSaveAsrConfig,
  scenario,
  setScenario,
  modelStatuses,
  modelStatusesLoading,
  modelStatusesError,
  modelAction,
  onRefreshModelStatuses,
  onDownloadModel,
  onUninstallModel,
  recordingSaving,
  processing,
  draftSaving,
  message,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onFinishRecording,
  onSaveDraft,
  onCancel,
}: {
  title: string;
  setTitle: (value: string) => void;
  audioFilePath: string;
  recording: boolean;
  paused: boolean;
  audioLevels: number[];
  previewSegments: MeetingPreviewSegment[];
  summaryDraft: string;
  setSummaryDraft: (value: string) => void;
  transcriberEngine: MeetingTranscriberEngine;
  setTranscriberEngine: (value: MeetingTranscriberEngine) => void;
  transcriberModel: MeetingTranscriberModel;
  setTranscriberModel: (value: MeetingTranscriberModel) => void;
  transcriberLanguage: MeetingTranscriberLanguage;
  setTranscriberLanguage: (value: MeetingTranscriberLanguage) => void;
  asrConfig: MeetingAsrConfigSnapshot | null;
  asrConfigSaving: boolean;
  onSaveAsrConfig: (input: MeetingSaveAsrConfigInput) => Promise<MeetingAsrConfigSnapshot | null>;
  scenario: MeetingRecordingScenario;
  setScenario: (value: MeetingRecordingScenario) => void;
  modelStatuses: MeetingModelStatusSnapshot[];
  modelStatusesLoading: boolean;
  modelStatusesError: string;
  modelAction: MeetingModelActionState | null;
  onRefreshModelStatuses: () => Promise<void>;
  onDownloadModel: (modelId: string) => void;
  onUninstallModel: (modelId: string) => void;
  recordingSaving: boolean;
  processing: boolean;
  draftSaving: boolean;
  message: { kind: 'error' | 'success'; text: string } | null;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onFinishRecording: () => void;
  onSaveDraft: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const ds = t.desktopSettings;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onlineAsrDraft, setOnlineAsrDraft] = useState({
    volcAppKey: '',
    volcAccessKey: '',
    volcEndpoint: '',
    volcResourceId: '',
    aliyunApiKey: '',
    aliyunBaseUrl: '',
  });
  const [onlineAsrSaved, setOnlineAsrSaved] = useState(false);
  const [onlineAsrError, setOnlineAsrError] = useState('');
  const hasSummaryDraft = summaryDraft.trim().length > 0;
  const localTranscriberSelected = isLocalMeetingTranscriberEngine(transcriberEngine);
  const modelStatusById = new Map(modelStatuses.map(model => [model.id, model]));
  const speechEngineName = (engineId?: string) => {
    if (engineId === 'sherpa-onnx-paraformer') return t.knowledge.meetingSpeechEngineSherpaOnnxName;
    if (!engineId || engineId === 'whisper') return t.knowledge.meetingSpeechEngineWhisperName;
    if (engineId === 'volcengine-asr') return t.knowledge.meetingSpeechEngineVolcengineAsr;
    if (engineId === 'aliyun-asr') return t.knowledge.meetingSpeechEngineAliyunAsr;
    return engineId;
  };
  const speechModelName = (modelId: MeetingTranscriberModel) => (
    modelId === MEETING_SHERPA_ONNX_PARA_MODEL
      ? t.knowledge.meetingSpeechModelSherpaOnnxParaformerSmall
      : modelId
  );
  const speechModelOptionLabel = (modelId: MeetingTranscriberModel) => {
    const status = modelStatusById.get(modelId);
    return t.knowledge.meetingSpeechModelOption(
      speechEngineName(status?.engineId),
      speechModelName(modelId),
      status?.sizeLabel,
    );
  };
  const visibleModelOptions = MEETING_TRANSCRIBER_MODEL_OPTIONS.filter(model => (
    meetingTranscriberEngineForModel(model) === transcriberEngine
  ));
  const groupedModelStatuses = [
    {
      id: 'asr',
      title: t.knowledge.meetingSpeechModelsStatusTitle,
      models: modelStatuses.filter(model => (model.capability ?? 'asr') === 'asr'),
    },
    {
      id: 'punctuation',
      title: t.knowledge.meetingPunctuationModelsStatusTitle,
      models: modelStatuses.filter(model => model.capability === 'punctuation'),
    },
  ].filter(group => group.models.length > 0);
  const engineLabels: Record<MeetingTranscriberEngine, string> = {
    'sherpa-onnx-paraformer': t.knowledge.meetingSpeechEngineSherpaOnnxParaformer,
    whisper: t.knowledge.meetingSpeechEngineWhisperFallback,
    'volcengine-asr': t.knowledge.meetingSpeechEngineVolcengineAsr,
    'aliyun-asr': t.knowledge.meetingSpeechEngineAliyunAsr,
  };
  const onlineProviderConfigured = transcriberEngine === 'volcengine-asr'
    ? asrConfig?.volcengine?.configured === true
    : transcriberEngine === 'aliyun-asr'
      ? asrConfig?.aliyun?.configured === true
      : true;
  const onlineProviderName = engineLabels[transcriberEngine];
  const scenarioLabels: Record<MeetingRecordingScenario, string> = {
    discussion: t.knowledge.meetingScenarioDiscussion,
    meeting: t.knowledge.meetingScenarioMeeting,
    sales: t.knowledge.meetingScenarioSales,
  };
  const statusText = recording
    ? (paused ? t.knowledge.meetingRecordingPaused : t.knowledge.meetingRecording)
    : processing
      ? t.knowledge.meetingTranscribing
      : hasSummaryDraft
        ? t.knowledge.meetingDraftReady
        : t.knowledge.meetingRecordingReady;

  useEffect(() => {
    setOnlineAsrDraft(prev => ({
      ...prev,
      volcEndpoint: asrConfig?.volcengine?.endpoint ?? '',
      volcResourceId: asrConfig?.volcengine?.resourceId ?? '',
      aliyunBaseUrl: asrConfig?.aliyun?.baseUrl ?? '',
    }));
  }, [asrConfig]);

  useEffect(() => {
    setOnlineAsrSaved(false);
    setOnlineAsrError('');
  }, [transcriberEngine]);

  const handleSaveOnlineAsrConfig = async () => {
    if (localTranscriberSelected || asrConfigSaving) return;
    setOnlineAsrSaved(false);
    setOnlineAsrError('');
    const input: MeetingSaveAsrConfigInput = transcriberEngine === 'volcengine-asr'
      ? {
          defaultProvider: transcriberEngine,
          volcengine: {
            appKey: onlineAsrDraft.volcAppKey,
            accessKey: onlineAsrDraft.volcAccessKey,
            endpoint: onlineAsrDraft.volcEndpoint,
            resourceId: onlineAsrDraft.volcResourceId,
          },
        }
      : {
          defaultProvider: transcriberEngine,
          aliyun: {
            apiKey: onlineAsrDraft.aliyunApiKey,
            baseUrl: onlineAsrDraft.aliyunBaseUrl,
            model: 'fun-asr',
          },
        };
    try {
      const saved = await onSaveAsrConfig(input);
      if (saved) {
        setOnlineAsrDraft(prev => ({
          ...prev,
          volcAppKey: '',
          volcAccessKey: '',
          aliyunApiKey: '',
        }));
        setOnlineAsrSaved(true);
      }
    } catch (error) {
      setOnlineAsrError(t.knowledge.meetingOnlineAsrSaveFailed(error instanceof Error ? error.message : 'unknown'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]" role="presentation" onClick={onCancel} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="flex max-h-[86vh] w-[920px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] shadow-lg" role="dialog" aria-label={t.knowledge.meetingRecorderTitle} onClick={e => { e.stopPropagation(); setSettingsOpen(false); }} onKeyDown={e => { if (e.key === 'Escape' && settingsOpen) { e.stopPropagation(); setSettingsOpen(false); } }}>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--c-border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-[var(--c-text-primary)]">{t.knowledge.meetingRecorderTitle}</h3>
            <p className="mt-1 truncate text-xs text-[var(--c-text-tertiary)]">{statusText}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => {
                  const next = !settingsOpen;
                  setSettingsOpen(next);
                  if (next) void onRefreshModelStatuses();
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
              >
                <Settings2 size={14} /> {t.knowledge.meetingSettings}
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 w-[420px] max-w-[calc(100vw-48px)] rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4 text-left shadow-lg">
                  <div className="space-y-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingSpeechEngineLabel}</span>
                      <select
                        value={transcriberEngine}
                        onChange={e => setTranscriberEngine(e.target.value as MeetingTranscriberEngine)}
                        aria-label={t.knowledge.meetingSpeechEngineLabel}
                        disabled={recordingSaving || processing}
                        className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                      >
                        {MEETING_TRANSCRIBER_ENGINE_OPTIONS.map(engine => (
                          <option key={engine} value={engine}>{engineLabels[engine]}</option>
                        ))}
                      </select>
                    </label>

                    {localTranscriberSelected && (
                      <label className="block">
                        <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingSpeechModelLabel}</span>
                        <select
                          value={transcriberModel}
                          onChange={e => setTranscriberModel(e.target.value as MeetingTranscriberModel)}
                          aria-label={t.knowledge.meetingSpeechModelLabel}
                          disabled={recordingSaving || processing}
                          className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                        >
                          {visibleModelOptions.map(model => (
                            <option key={model} value={model}>{speechModelOptionLabel(model)}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="block">
                      <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingLanguageLabel}</span>
                      <select
                        value={transcriberLanguage}
                        onChange={e => setTranscriberLanguage(e.target.value as MeetingTranscriberLanguage)}
                        aria-label={t.knowledge.meetingLanguageLabel}
                        disabled={recordingSaving || processing}
                        className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                      >
                        <option value="zh">{t.knowledge.meetingLanguageZh}</option>
                        <option value="auto">{t.knowledge.meetingLanguageAuto}</option>
                        <option value="en">{t.knowledge.meetingLanguageEn}</option>
                      </select>
                    </label>
                    {!localTranscriberSelected && (
                      <div className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium text-[var(--c-text-secondary)]">{t.knowledge.meetingOnlineAsrConfigTitle}</p>
                            <p className={`mt-1 text-xs ${onlineProviderConfigured ? 'text-green-700' : 'text-red-600'}`}>
                              {onlineProviderConfigured
                                ? t.knowledge.meetingOnlineAsrConfigured(onlineProviderName)
                                : t.knowledge.meetingOnlineAsrNotConfigured(onlineProviderName)}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] ${onlineProviderConfigured ? 'bg-green-500/10 text-green-700' : 'bg-[var(--c-bg-deep)] text-[var(--c-text-muted)]'}`}>
                            {onlineProviderConfigured ? ds.meetingAsrConfigured : ds.meetingAsrNotConfigured}
                          </span>
                        </div>
                        {transcriberEngine === 'volcengine-asr' ? (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrAppKey}</span>
                              <input
                                type="password"
                                value={onlineAsrDraft.volcAppKey}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, volcAppKey: e.target.value }))}
                                aria-label={ds.meetingAsrAppKey}
                                placeholder={asrConfig?.volcengine?.appKeyConfigured ? ds.meetingAsrConfigured : ds.meetingAsrAppKey}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrAccessKey}</span>
                              <input
                                type="password"
                                value={onlineAsrDraft.volcAccessKey}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, volcAccessKey: e.target.value }))}
                                aria-label={ds.meetingAsrAccessKey}
                                placeholder={asrConfig?.volcengine?.accessKeyConfigured ? ds.meetingAsrConfigured : ds.meetingAsrAccessKey}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrEndpoint}</span>
                              <input
                                value={onlineAsrDraft.volcEndpoint}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, volcEndpoint: e.target.value }))}
                                aria-label={ds.meetingAsrEndpoint}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrResourceId}</span>
                              <input
                                value={onlineAsrDraft.volcResourceId}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, volcResourceId: e.target.value }))}
                                aria-label={ds.meetingAsrResourceId}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrApiKey}</span>
                              <input
                                type="password"
                                value={onlineAsrDraft.aliyunApiKey}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, aliyunApiKey: e.target.value }))}
                                aria-label={ds.meetingAsrApiKey}
                                placeholder={asrConfig?.aliyun?.apiKeyConfigured ? ds.meetingAsrConfigured : ds.meetingAsrApiKey}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-[var(--c-text-secondary)]">{ds.meetingAsrBaseUrl}</span>
                              <input
                                value={onlineAsrDraft.aliyunBaseUrl}
                                onChange={e => setOnlineAsrDraft(prev => ({ ...prev, aliyunBaseUrl: e.target.value }))}
                                aria-label={ds.meetingAsrBaseUrl}
                                disabled={asrConfigSaving || recordingSaving || processing || recording}
                                className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2.5 py-1.5 text-xs text-[var(--c-text-primary)] outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                              />
                            </label>
                          </div>
                        )}
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            {onlineAsrSaved && <span className="text-xs text-green-700">{ds.meetingAsrSaved}</span>}
                            {onlineAsrError && <span className="text-xs text-red-600">{onlineAsrError}</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSaveOnlineAsrConfig()}
                            disabled={asrConfigSaving || recordingSaving || processing || recording}
                            className="shrink-0 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {asrConfigSaving ? ds.meetingAsrSaving : ds.meetingAsrSave}
                          </button>
                        </div>
                      </div>
                    )}
                    {localTranscriberSelected && (
                    <div className="border-t border-[var(--c-border)] pt-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-[var(--c-text-secondary)]">{t.knowledge.meetingModelDownloadStatusTitle}</p>
                        {modelStatusesLoading && (
                          <span className="text-[11px] text-[var(--c-text-tertiary)]">{t.knowledge.meetingModelStatusLoading}</span>
                        )}
                      </div>
                      {modelStatusesError ? (
                        <p className="text-xs leading-5 text-red-600">{modelStatusesError}</p>
                      ) : groupedModelStatuses.length > 0 ? (
                        <div className="space-y-3">
                          {groupedModelStatuses.map(group => (
                            <div key={group.id} className="space-y-1.5">
                              <p className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{group.title}</p>
                              {group.models.map(model => {
                            const actionRunning = modelAction?.modelId === model.id;
                            const downloading = actionRunning && modelAction.kind === 'download';
                            const statusLabel = downloading
                              ? t.knowledge.meetingModelStatusDownloading
                              : model.status === 'downloaded'
                              ? t.knowledge.meetingModelStatusDownloaded
                              : model.status === 'incomplete'
                                ? t.knowledge.meetingModelStatusIncomplete
                                : model.status === 'corrupt'
                                  ? t.knowledge.meetingModelStatusCorrupt
                                : t.knowledge.meetingModelStatusNotDownloaded;
                            const statusClassName = downloading
                              ? 'border-blue-200 bg-blue-50 text-blue-700'
                              : model.status === 'downloaded'
                              ? 'border-green-200 bg-green-50 text-green-700'
                              : model.status === 'incomplete'
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : model.status === 'corrupt'
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-[var(--c-border)] bg-[var(--c-bg-page)] text-[var(--c-text-tertiary)]';
                            const actionDisabled = recordingSaving || processing || !!modelAction;
                            const actionLabel = model.status === 'downloaded'
                              ? t.knowledge.meetingModelUninstallAria(model.fileName)
                              : model.status === 'incomplete' || model.status === 'corrupt'
                                ? t.knowledge.meetingModelRedownloadAria(model.fileName)
                                : t.knowledge.meetingModelDownloadAria(model.fileName);
                            const actionTitle = model.status === 'downloaded'
                              ? t.knowledge.meetingModelUninstall
                              : model.status === 'incomplete' || model.status === 'corrupt'
                                ? t.knowledge.meetingModelRedownload
                                : t.knowledge.meetingModelDownload;
                            return (
                              <div key={model.id} className="rounded-md border border-[var(--c-border)] px-2.5 py-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-medium text-[var(--c-text-primary)]">{model.fileName}</p>
                                    <p className="mt-0.5 text-[11px] text-[var(--c-text-tertiary)]">{model.sizeLabel}</p>
                                  </div>
                                  <div data-meeting-model-status-row={model.id} className="flex shrink-0 items-center gap-1.5">
                                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClassName}`}>
                                      {statusLabel}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => model.status === 'downloaded' ? onUninstallModel(model.id) : onDownloadModel(model.id)}
                                      disabled={actionDisabled}
                                      aria-label={actionLabel}
                                      title={actionRunning ? t.knowledge.meetingModelActionRunning : actionTitle}
                                      className="inline-flex size-6 items-center justify-center rounded-md border border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50"
                                    >
                                      {model.status === 'downloaded' ? (
                                        <Trash2 size={12} aria-hidden="true" />
                                      ) : model.status === 'incomplete' || model.status === 'corrupt' ? (
                                        <RotateCcw size={12} aria-hidden="true" />
                                      ) : (
                                        <Download size={12} aria-hidden="true" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                                {(model.status === 'incomplete' || model.status === 'corrupt') && model.localSizeLabel && (
                                  <p className="mt-1 text-[11px] text-[var(--c-text-tertiary)]">
                                    {t.knowledge.meetingModelStatusLocalSize(model.localSizeLabel, model.sizeLabel)}
                                  </p>
                                )}
                              </div>
                            );
                              })}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs leading-5 text-[var(--c-text-tertiary)]">{t.knowledge.meetingModelStatusUnavailable}</p>
                      )}
                    </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button type="button" onClick={onCancel} disabled={recordingSaving || processing} className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-sm text-[var(--c-text-secondary)] disabled:opacity-50">
              {t.knowledge.cancel}
            </button>
          </div>
        </div>
        <div className="grid min-h-[520px] min-w-0 grid-cols-[300px_minmax(0,1fr)]">
          <section className="min-w-0 border-r border-[var(--c-border)] p-5">
            <h4 className="mb-4 text-xs font-medium uppercase tracking-wide text-[var(--c-text-tertiary)]">{t.knowledge.meetingControlPanelTitle}</h4>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingRecordingTitleLabel}</span>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  aria-label={t.knowledge.meetingRecordingTitleLabel}
                  placeholder={t.knowledge.meetingTitlePlaceholder}
                  className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)]"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingScenarioLabel}</span>
                <select
                  value={scenario}
                  onChange={e => setScenario(e.target.value as MeetingRecordingScenario)}
                  aria-label={t.knowledge.meetingScenarioLabel}
                  disabled={recordingSaving || processing || recording}
                  className="w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg-page)] px-3 py-2 text-sm outline-none focus:border-[var(--c-accent)] disabled:opacity-50"
                >
                  {MEETING_RECORDING_SCENARIO_OPTIONS.map(option => (
                    <option key={option} value={option}>{scenarioLabels[option]}</option>
                  ))}
                </select>
              </label>

              <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${recording && !paused ? 'animate-pulse bg-red-500' : paused ? 'bg-amber-500' : 'bg-[var(--c-text-tertiary)]'}`} />
                  <span className="min-w-0 truncate text-sm text-[var(--c-text-primary)]">{statusText}</span>
                </div>
                <div aria-label={t.knowledge.meetingAudioLevelLabel} className="mt-3 flex h-8 items-end gap-1 overflow-hidden">
                  {audioLevels.map((level, index) => {
                    const normalized = Math.max(0, Math.min(1, level));
                    return (
                      <span
                        key={index}
                        data-audio-level={normalized.toFixed(2)}
                        className={`w-1 shrink-0 rounded-full transition-[height,background-color] duration-100 ${recording && !paused ? 'bg-red-500' : paused ? 'bg-amber-400' : 'bg-[var(--c-border)]'}`}
                        style={{ height: `${Math.max(4, Math.round(4 + Math.sqrt(normalized) * 28))}px` }}
                      />
                    );
                  })}
                </div>
              </div>

              {hasSummaryDraft ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                  {t.knowledge.meetingDraftReady}
                </div>
              ) : recording ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={paused ? onResumeRecording : onPauseRecording}
                    disabled={recordingSaving || processing}
                    className="rounded-md border border-[var(--c-border)] px-3 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50"
                  >
                    {paused ? t.knowledge.meetingRecordResume : t.knowledge.meetingRecordPause}
                  </button>
                  <button
                    type="button"
                    onClick={onFinishRecording}
                    disabled={recordingSaving || processing}
                    className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {t.knowledge.meetingRecordStop}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onStartRecording}
                  disabled={recordingSaving || processing}
                  className="w-full rounded-lg bg-[var(--c-accent)] px-4 py-3 text-base font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                >
                  {recordingSaving ? t.knowledge.meetingRecordingSaving : t.knowledge.meetingRecordStart}
                </button>
              )}

              {message && (
                <p className={`text-xs leading-5 ${message.kind === 'error' ? 'text-red-600' : 'text-green-700'}`}>
                  {message.text}
                </p>
              )}
            </div>
          </section>

          <LegacyMeetingRecorderTranscript
            hasSummaryDraft={hasSummaryDraft}
            t={t}
            transcriberModel={transcriberModel}
            transcriberLanguage={transcriberLanguage}
            summaryDraft={summaryDraft}
            setSummaryDraft={setSummaryDraft}
            previewSegments={previewSegments}
            onSaveDraft={onSaveDraft}
            draftSaving={draftSaving}
            audioFilePath={audioFilePath}
            recording={recording}
            paused={paused}
            processing={processing}
          />
        </div>
      </div>
    </div>
  );
}

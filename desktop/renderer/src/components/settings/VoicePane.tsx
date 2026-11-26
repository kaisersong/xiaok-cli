import { SecretInput } from '../security/SecretInput';
import { useMeetingModelsReadonly, useMeetingAsrReadonly } from '../../hooks/useMeetingReadonly';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Download,
  Trash2,
  Package,
  Server,
  Mic,
  RotateCcw,
} from 'lucide-react';
import { getDesktopApi } from '../../shared/desktop';
import { useLocale } from '../../contexts/LocaleContext';
import { MEETING_SHERPA_ONNX_PARA_MODEL, MEETING_TRANSCRIBER_ENGINE_OPTIONS, MEETING_TRANSCRIBER_MODEL_OPTIONS, MEETING_TRANSCRIBER_LANGUAGE_OPTIONS, meetingTranscriberEngineForModel, defaultMeetingTranscriberModelForEngine, readStoredMeetingTranscriberEngine, readStoredMeetingTranscriberModel, readStoredMeetingTranscriberLanguage, isLocalMeetingTranscriberEngine } from './voice-meeting-settings';
import type { MeetingTranscriberEngine, MeetingTranscriberModel, MeetingTranscriberLanguage, MeetingAsrConfigSnapshot, MeetingModelStatusSnapshot, MeetingModelActionState } from './voice-meeting-settings';
import { SectionHeader, SettingsRefreshButton, SettingsReadError, Section, Card, inputCls, btnPrimary } from './settings-ui';

export function VoicePane() {
  const { t } = useLocale();
  const ds = t.desktopSettings;
  const desktop = getDesktopApi();
  const [engine, setEngine] = useState<MeetingTranscriberEngine>(readStoredMeetingTranscriberEngine);
  const [model, setModel] = useState<MeetingTranscriberModel>(() => readStoredMeetingTranscriberModel(readStoredMeetingTranscriberEngine()));
  const [language, setLanguage] = useState<MeetingTranscriberLanguage>(readStoredMeetingTranscriberLanguage);
  const modelFacts = useMeetingModelsReadonly(), asrFacts = useMeetingAsrReadonly();
  const asrConfig = asrFacts.data;
  const [asrDraft, setAsrDraft] = useState({
    volcAppKey: '',
    volcAccessKey: '',
    volcEndpoint: '',
    volcResourceId: '',
    aliyunApiKey: '',
    aliyunBaseUrl: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const modelStatuses = modelFacts.data ?? [];
  const modelStatusesLoading = modelFacts.reading;
  const [modelStatusesError, setModelStatusesError] = useState('');
  const [modelAction, setModelAction] = useState<MeetingModelActionState | null>(null);

  // One mounted action owner. Locale changes reproject reasons at render time;
  // they do not cancel an already authorized main-process mutation.
  const actionLifetime = useRef<{ active: boolean; saving: boolean; model: boolean } | null>(null);
  useEffect(() => {
    const owner = { active: true, saving: false, model: false };
    actionLifetime.current = owner;
    return () => { owner.active = false; };
  }, []);

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

  const modelStatusById = new Map(modelStatuses.map(status => [status.id, status]));
  const visibleModelOptions = MEETING_TRANSCRIBER_MODEL_OPTIONS.filter(option => (
    meetingTranscriberEngineForModel(option) === engine
  ));
  const groupedModelStatuses = [
    {
      id: 'asr',
      title: t.knowledge.meetingSpeechModelsStatusTitle,
      models: modelStatuses.filter(item => (item.capability ?? 'asr') === 'asr'),
    },
    {
      id: 'punctuation',
      title: t.knowledge.meetingPunctuationModelsStatusTitle,
      models: modelStatuses.filter(item => item.capability === 'punctuation'),
    },
  ].filter(group => group.models.length > 0);

  const loadMeetingModelStatuses = useCallback(async () => {
    await modelFacts.reload().catch(() => {});
  }, [modelFacts.reload]);
  useEffect(() => {
    const snapshot = asrFacts.data;
    if (!snapshot) return;
      setAsrDraft(prev => ({
        ...prev,
        volcEndpoint: snapshot.volcengine?.endpoint ?? '',
        volcResourceId: snapshot.volcengine?.resourceId ?? '',
        aliyunBaseUrl: snapshot.aliyun?.baseUrl ?? '',
      }));
      const fallback = snapshot.defaultProvider && MEETING_TRANSCRIBER_ENGINE_OPTIONS.includes(snapshot.defaultProvider)
        ? snapshot.defaultProvider
        : 'sherpa-onnx-paraformer';
      const nextEngine = readStoredMeetingTranscriberEngine(fallback);
      const nextModel = readStoredMeetingTranscriberModel(nextEngine);
      const nextLanguage = readStoredMeetingTranscriberLanguage();
      setEngine(nextEngine);
      setModel(nextModel);
      setLanguage(nextLanguage);
  }, [asrFacts.data]);

  const persistTranscriberChoice = (nextEngine: MeetingTranscriberEngine, nextModel: MeetingTranscriberModel, nextLanguage = language) => {
    try {
      localStorage.setItem('meeting-transcriber-engine', nextEngine);
      localStorage.setItem('meeting-transcriber-model', nextModel);
      localStorage.setItem('meeting-transcriber-language', nextLanguage);
    } catch {
      // best effort only
    }
  };

  const updateEngine = (value: MeetingTranscriberEngine) => {
    const nextModel = meetingTranscriberEngineForModel(model) === value ? model : defaultMeetingTranscriberModelForEngine(value);
    setEngine(value);
    setModel(nextModel);
    setSaved(false);
    persistTranscriberChoice(value, nextModel);
  };

  const updateModel = (value: MeetingTranscriberModel) => {
    const nextEngine = meetingTranscriberEngineForModel(value);
    setEngine(nextEngine);
    setModel(value);
    setSaved(false);
    persistTranscriberChoice(nextEngine, value);
  };

  const updateLanguage = (value: MeetingTranscriberLanguage) => {
    setLanguage(value);
    setSaved(false);
    persistTranscriberChoice(engine, model, value);
  };

  const handleSaveMeetingAsrConfig = async () => {
    const owner = actionLifetime.current;
    if (!desktop?.meetingSaveAsrConfig || !owner?.active || owner.saving) return;
    owner.saving = true;
    const current = () => owner.active && actionLifetime.current === owner;
    setSaving(true);
    setSaved(false);
    setSaveError('');
    persistTranscriberChoice(engine, model, language);
    const input = engine === 'volcengine-asr'
      ? {
          defaultProvider: engine,
          volcengine: {
            appKey: asrDraft.volcAppKey,
            accessKey: asrDraft.volcAccessKey,
            endpoint: asrDraft.volcEndpoint,
            resourceId: asrDraft.volcResourceId,
          },
        }
      : engine === 'aliyun-asr'
        ? {
          defaultProvider: engine,
          aliyun: {
              apiKey: asrDraft.aliyunApiKey,
              baseUrl: asrDraft.aliyunBaseUrl,
              model: 'fun-asr',
            },
          }
        : { defaultProvider: engine };
    try {
      const snapshot = await desktop.meetingSaveAsrConfig(input) as MeetingAsrConfigSnapshot;
      if (!current()) return;
      // A read failure remains a read failure. It cannot change this confirmed
      // save into a failure or replace the readonly owner's last-good facts.
      await asrFacts.reload().catch(() => {});
      if (!current()) return;
      setAsrDraft(prev => ({
        ...prev,
        volcAppKey: '',
        volcAccessKey: '',
        aliyunApiKey: '',
        volcEndpoint: snapshot.volcengine?.endpoint ?? prev.volcEndpoint,
        volcResourceId: snapshot.volcengine?.resourceId ?? prev.volcResourceId,
        aliyunBaseUrl: snapshot.aliyun?.baseUrl ?? prev.aliyunBaseUrl,
      }));
      setSaved(true);
    } catch (error) {
      if (current()) setSaveError(error instanceof Error ? error.message : 'unknown');
    } finally {
      owner.saving = false;
      if (current()) setSaving(false);
    }
  };

  const handleDownloadMeetingModel = async (modelId: string) => {
    const owner = actionLifetime.current;
    if (!desktop?.meetingDownloadModel || !owner?.active || owner.model) return;
    owner.model = true;
    const current = () => owner.active && actionLifetime.current === owner;
    setModelAction({ modelId, kind: 'download' });
    setModelStatusesError('');
    try {
      const result = await desktop.meetingDownloadModel(modelId) as { ok?: boolean; reason?: string; error?: string };
      if (!current()) return;
      if (result?.ok === false) setModelStatusesError(result.reason ?? result.error ?? 'unknown');
      await loadMeetingModelStatuses();
      if (!current()) return;
    } catch (error) {
      if (current()) setModelStatusesError(error instanceof Error ? error.message : 'unknown');
    } finally {
      owner.model = false;
      if (current()) setModelAction(null);
    }
  };

  const handleUninstallMeetingModel = async (modelId: string) => {
    const owner = actionLifetime.current;
    if (!desktop?.meetingUninstallModel || !owner?.active || owner.model) return;
    owner.model = true;
    const current = () => owner.active && actionLifetime.current === owner;
    setModelAction({ modelId, kind: 'uninstall' });
    setModelStatusesError('');
    try {
      const result = await desktop.meetingUninstallModel(modelId) as { ok?: boolean; reason?: string; error?: string };
      if (!current()) return;
      if (result?.ok === false) setModelStatusesError(result.reason ?? result.error ?? 'unknown');
      await loadMeetingModelStatuses();
      if (!current()) return;
    } catch (error) {
      if (current()) setModelStatusesError(error instanceof Error ? error.message : 'unknown');
    } finally {
      owner.model = false;
      if (current()) setModelAction(null);
    }
  };

  const renderProviderStatus = (configured?: boolean) => (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${configured ? 'border-green-200 bg-green-50 text-green-700' : 'border-[var(--c-border)] bg-[var(--c-bg-page)] text-[var(--c-text-tertiary)]'}`}>
      {asrConfig === null ? t.meetingAsrReadonlyUnknown : configured ? ds.meetingAsrConfigured : ds.meetingAsrNotConfigured}
    </span>
  );

  const renderModelStatusRow = (item: MeetingModelStatusSnapshot) => {
    const actionRunning = modelAction?.modelId === item.id;
    const downloading = actionRunning && modelAction.kind === 'download';
    const statusLabel = downloading
      ? t.knowledge.meetingModelStatusDownloading
      : item.status === 'downloaded'
        ? t.knowledge.meetingModelStatusDownloaded
        : item.status === 'incomplete'
          ? t.knowledge.meetingModelStatusIncomplete
          : item.status === 'corrupt'
            ? t.knowledge.meetingModelStatusCorrupt
            : t.knowledge.meetingModelStatusNotDownloaded;
    const statusClassName = downloading
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : item.status === 'downloaded'
        ? 'border-green-200 bg-green-50 text-green-700'
        : item.status === 'incomplete'
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : item.status === 'corrupt'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-[var(--c-border)] bg-[var(--c-bg-page)] text-[var(--c-text-tertiary)]';
    const actionLabel = item.status === 'downloaded'
      ? t.knowledge.meetingModelUninstallAria(item.fileName)
      : item.status === 'incomplete' || item.status === 'corrupt'
        ? t.knowledge.meetingModelRedownloadAria(item.fileName)
        : t.knowledge.meetingModelDownloadAria(item.fileName);
    const actionTitle = item.status === 'downloaded'
      ? t.knowledge.meetingModelUninstall
      : item.status === 'incomplete' || item.status === 'corrupt'
        ? t.knowledge.meetingModelRedownload
        : t.knowledge.meetingModelDownload;
    return (
      <div key={item.id} className="rounded-lg border border-[var(--c-border)] px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-[var(--c-text-primary)]">{item.fileName}</p>
            <p className="mt-0.5 text-[11px] text-[var(--c-text-tertiary)]">{item.sizeLabel}</p>
          </div>
          <div data-testid={`voice-model-status-${item.id}`} className="flex shrink-0 items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClassName}`}>
              {statusLabel}
            </span>
            <button
              type="button"
              onClick={() => item.status === 'downloaded' ? void handleUninstallMeetingModel(item.id) : void handleDownloadMeetingModel(item.id)}
              disabled={Boolean(modelAction)}
              aria-label={actionLabel}
              title={actionRunning ? t.knowledge.meetingModelActionRunning : actionTitle}
              className="inline-flex size-7 items-center justify-center rounded-md border border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50"
            >
              {item.status === 'downloaded' ? (
                <Trash2 size={13} aria-hidden="true" />
              ) : item.status === 'incomplete' || item.status === 'corrupt' ? (
                <RotateCcw size={13} aria-hidden="true" />
              ) : (
                <Download size={13} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        {(item.status === 'incomplete' || item.status === 'corrupt') && item.localSizeLabel && (
          <p className="mt-1 text-[11px] text-[var(--c-text-tertiary)]">
            {t.knowledge.meetingModelStatusLocalSize(item.localSizeLabel, item.sizeLabel)}
          </p>
        )}
      </div>
    );
  };

  const modelOptionLabel = (modelId: MeetingTranscriberModel) => {
    const status = modelStatusById.get(modelId);
    const displayModel = modelId === MEETING_SHERPA_ONNX_PARA_MODEL
      ? t.knowledge.meetingSpeechModelSherpaOnnxParaformerSmall
      : modelId;
    return t.knowledge.meetingSpeechModelOption(
      status?.engineId === 'sherpa-onnx-paraformer'
        ? t.knowledge.meetingSpeechEngineSherpaOnnxName
        : t.knowledge.meetingSpeechEngineWhisperName,
      displayModel,
      status?.sizeLabel,
    );
  };

  return (
    <div className="space-y-6">
      {(modelFacts.failed || asrFacts.failed) && <SettingsReadError onRetry={() => { modelFacts.refresh(); asrFacts.refresh(); }}>
        {modelFacts.failed && <p>{t.meetingModelsReadonlyUnavailable}</p>}
        {asrFacts.failed && <p>{t.meetingAsrReadonlyUnavailable}</p>}
      </SettingsReadError>}
      <Section>
        <SectionHeader icon={Mic} action={!modelFacts.failed && !asrFacts.failed && <SettingsRefreshButton onClick={() => { modelFacts.refresh(); asrFacts.refresh(); }} />}>{ds.meetingRecordingSettingsTitle}</SectionHeader>
        <p className="mb-4 text-sm leading-6 text-[var(--c-text-secondary)]">{ds.meetingRecordingSettingsDesc}</p>
        <Card>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{ds.meetingAsrDefaultProvider}</span>
              <select
                value={engine}
                onChange={event => updateEngine(event.target.value as MeetingTranscriberEngine)}
                aria-label={ds.meetingAsrDefaultProvider}
                className={inputCls}
              >
                {MEETING_TRANSCRIBER_ENGINE_OPTIONS.map(option => (
                  <option key={option} value={option}>{engineLabels[option]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingLanguageLabel}</span>
              <select
                value={language}
                onChange={event => updateLanguage(event.target.value as MeetingTranscriberLanguage)}
                aria-label={t.knowledge.meetingLanguageLabel}
                className={inputCls}
              >
                {MEETING_TRANSCRIBER_LANGUAGE_OPTIONS.map(option => (
                  <option key={option} value={option}>{languageLabels[option]}</option>
                ))}
              </select>
            </label>
          </div>
          {isLocalMeetingTranscriberEngine(engine) && (
            <label className="mt-4 block">
              <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{t.knowledge.meetingSpeechModelLabel}</span>
              <select
                value={model}
                onChange={event => updateModel(event.target.value as MeetingTranscriberModel)}
                aria-label={t.knowledge.meetingSpeechModelLabel}
                className={inputCls}
              >
                {visibleModelOptions.map(option => (
                  <option key={option} value={option}>{modelOptionLabel(option)}</option>
                ))}
              </select>
            </label>
          )}
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Package}>{ds.meetingRecordingLocalModelsTitle}</SectionHeader>
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--c-text-secondary)]">{t.knowledge.meetingModelDownloadStatusTitle}</p>
            {modelStatusesLoading && <span className="text-xs text-[var(--c-text-tertiary)]">{t.knowledge.meetingModelStatusLoading}</span>}
          </div>
          {modelStatusesError && <p className="text-xs leading-5 text-red-600">{t.knowledge.meetingModelActionFailed(modelStatusesError)}</p>}
          {groupedModelStatuses.length > 0 ? (
            <div className="space-y-4">
              {groupedModelStatuses.map(group => (
                <div key={group.id} className="space-y-2">
                  <p className="text-xs font-medium text-[var(--c-text-tertiary)]">{group.title}</p>
                  {group.models.map(renderModelStatusRow)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs leading-5 text-[var(--c-text-tertiary)]">{modelFacts.data === null ? t.meetingModelsReadonlyUnknown : t.knowledge.meetingModelStatusUnavailable}</p>
          )}
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Server}>{ds.meetingRecordingOnlineProvidersTitle}</SectionHeader>
        <Card>
          <div className="space-y-5">
            <div className="rounded-lg border border-[var(--c-border)] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-[var(--c-text-primary)]">{ds.meetingAsrVolcengineTitle}</p>
                {renderProviderStatus(asrConfig?.volcengine?.configured)}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{ds.meetingAsrAppKey}</span>
                  <SecretInput
                    value={asrDraft.volcAppKey}
                    onChange={event => setAsrDraft(prev => ({ ...prev, volcAppKey: event.target.value }))}
                    aria-label={`${ds.meetingAsrVolcengineTitle} ${ds.meetingAsrAppKey}`}
                    placeholder={asrConfig?.volcengine?.appKeyConfigured ? ds.meetingAsrConfigured : ds.meetingAsrAppKey}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{ds.meetingAsrAccessKey}</span>
                  <SecretInput
                    value={asrDraft.volcAccessKey}
                    onChange={event => setAsrDraft(prev => ({ ...prev, volcAccessKey: event.target.value }))}
                    aria-label={`${ds.meetingAsrVolcengineTitle} ${ds.meetingAsrAccessKey}`}
                    placeholder={asrConfig?.volcengine?.accessKeyConfigured ? ds.meetingAsrConfigured : ds.meetingAsrAccessKey}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{ds.meetingAsrEndpoint}</span>
                  <input
                    value={asrDraft.volcEndpoint}
                    onChange={event => setAsrDraft(prev => ({ ...prev, volcEndpoint: event.target.value }))}
                    aria-label={`${ds.meetingAsrVolcengineTitle} ${ds.meetingAsrEndpoint}`}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{ds.meetingAsrResourceId}</span>
                  <input
                    value={asrDraft.volcResourceId}
                    onChange={event => setAsrDraft(prev => ({ ...prev, volcResourceId: event.target.value }))}
                    aria-label={`${ds.meetingAsrVolcengineTitle} ${ds.meetingAsrResourceId}`}
                    className={inputCls}
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--c-border)] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-[var(--c-text-primary)]">{ds.meetingAsrAliyunTitle}</p>
                {renderProviderStatus(asrConfig?.aliyun?.configured)}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{ds.meetingAsrApiKey}</span>
                  <SecretInput
                    value={asrDraft.aliyunApiKey}
                    onChange={event => setAsrDraft(prev => ({ ...prev, aliyunApiKey: event.target.value }))}
                    aria-label={`${ds.meetingAsrAliyunTitle} ${ds.meetingAsrApiKey}`}
                    placeholder={asrConfig?.aliyun?.apiKeyConfigured ? ds.meetingAsrConfigured : ds.meetingAsrApiKey}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{ds.meetingAsrBaseUrl}</span>
                  <input
                    value={asrDraft.aliyunBaseUrl}
                    onChange={event => setAsrDraft(prev => ({ ...prev, aliyunBaseUrl: event.target.value }))}
                    aria-label={`${ds.meetingAsrAliyunTitle} ${ds.meetingAsrBaseUrl}`}
                    className={inputCls}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              {saved && <p className="text-xs text-green-700">{ds.meetingAsrSaved}</p>}
              {saveError && <p className="text-xs text-red-600">{t.knowledge.meetingOnlineAsrSaveFailed(saveError)}</p>}
            </div>
            <button type="button" onClick={() => void handleSaveMeetingAsrConfig()} disabled={saving} className={btnPrimary}>
              {saving ? ds.meetingAsrSaving : ds.meetingAsrSave}
            </button>
          </div>
        </Card>
      </Section>
    </div>
  );
}

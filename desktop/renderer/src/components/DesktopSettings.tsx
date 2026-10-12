import { useMeetingModelsReadonly, useMeetingAsrReadonly } from '../hooks/useMeetingReadonly';
import { useChannelReadonly } from '../hooks/useChannelReadonly';
import { MCP_INSTALLS_READONLY_OUTPUT_SCHEMA } from '../../../shared/channel-mcp-readonly-ipc-contract';
import { useSkillListReadonly, useSkillStatsReadonly } from '../hooks/useSkillReadonly';
import type { PluginMcpServerDto, PluginDependencyStatusDto } from '../../../shared/plugin-catalog-ipc-contract';
import {connectorsErrorMessage} from '../lib/connectors-error';
import {scheduledErrorMessage} from '../lib/scheduled-timed-action-error';
import { modelConfigErrorMessage } from '../lib/model-config-error';
import { loopManagementErrorMessage, loopManagementFailureKind } from '../lib/loop-management-errors';
import {LoopArtifactList} from './loops/LoopArtifactList';
import {loopObservationLabel,loopNeedsRevalidation,invalidateLoopObservations} from '../lib/loop-run-observation';
import {LoopPublicationPanel} from './loops/LoopPublicationPanel';
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import * as QRCode from 'qrcode';
import {
  ChevronLeft,
  Settings,
  Cpu,
  Download,
  Palette,
  Database,
  SlidersHorizontal,
  Loader2,
  Check,
  X,
  Plug,
  Puzzle,
  Trash2,
  Plus,
  Edit3,
  Eye,
  EyeOff,
  Globe,
  AlertCircle,
  Info,
  HardDrive,
  Zap,
  Package,
  Languages,
  Brain,
  Camera,
  User,
  Wrench,
  Search,
  Link as LinkIcon,
  Server,
  Copy,
  RefreshCw,
  ExternalLink,
  Smartphone,
  QrCode,
  Mic,
  RotateCcw,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getDesktopApi } from '../shared/desktop';
import { automationFocusTargetId } from '../lib/automation-deep-link';
import { LocalMemoryStatsCard } from './settings/LocalMemoryStatsCard';
import { MemoryModelSettings } from './settings/MemoryModelSettings';
import { McpErrorRemediationBanner } from './settings/McpErrorRemediationBanner';
import { DesktopAppearanceSettings } from './settings/DesktopAppearanceSettings';
import { LocalExecutionAuthorizationCard } from './settings/LocalExecutionAuthorizationCard';
import type {
  DesktopModelConfigSnapshot,
  DesktopRelatedServiceId,
  DesktopRelatedServiceStatus,
  DesktopSaveModelConfigInput,
  DesktopSaveSystemOneConfigInput,
  DesktopSystemOneConfigSnapshot,
  DesktopServiceStatusSnapshot,
  TestProviderConnectionResult,
  DesktopMobilePairingInfo,
  DesktopMobileRelayStatus,
} from '../../../electron/preload-api';
import type {
  ConnectorsConfig,
  ConnectorsConfigSnapshot,
  ConnectorsFetchProvider,
  ConnectorsSearchProvider,
  ConnectorsProviderRuntime,
  EvidenceAnomalyView,
  CreateUserLoopTemplateInputView,
  LoopDefinitionView,
  LoopOutputPreviewView,
  LoopRunView,
  LoopScheduleBindingView,
  LoopTaskResultView,
  RunLoopNowResultView,
  UserLoopTemplateView,
} from '../api/types';
import { useLocale } from '../contexts/LocaleContext';
import type { LocaleStrings } from '../locales/index';
import { useToast } from '../shared';
import { resolveUserLoopStarterTemplates, type UserLoopStarterTemplate } from './loops/userLoopStarterTemplates';
import {
  buildLoopDiagnosticsSummary,
  getLoopAnomalyLogPaths,
  getLoopAnomalySuggestedAction,
  getOpenLoopAnomalies,
} from './settings/loopDiagnostics';

type SettingsTab = 'model' | 'skills' | 'channels' | 'mcp' | 'tools' | 'general' | 'mobile' | 'voice' | 'appearance' | 'data' | 'memory' | 'about';
type MeetingTranscriberEngine = typeof MEETING_TRANSCRIBER_ENGINE_OPTIONS[number];
type MeetingTranscriberModel = typeof MEETING_TRANSCRIBER_MODEL_OPTIONS[number];
type MeetingTranscriberLanguage = typeof MEETING_TRANSCRIBER_LANGUAGE_OPTIONS[number];

interface MeetingAsrConfigSnapshot {
  defaultProvider?: MeetingTranscriberEngine;
  volcengine?: {
    configured?: boolean;
    appKeyConfigured?: boolean;
    accessKeyConfigured?: boolean;
    endpoint?: string;
    resourceId?: string;
  };
  aliyun?: {
    configured?: boolean;
    apiKeyConfigured?: boolean;
    baseUrl?: string;
    model?: string;
  };
}

interface MeetingModelStatusSnapshot {
  id: string;
  capability?: 'asr' | 'punctuation' | 'vad' | 'speaker';
  engineId?: string;
  fileName: string;
  sizeLabel: string;
  downloaded: boolean;
  status: 'downloaded' | 'not_downloaded' | 'incomplete' | 'corrupt';
  localSizeLabel?: string;
}

interface MeetingModelActionState {
  modelId: string;
  kind: 'download' | 'uninstall';
}

const MEETING_SHERPA_ONNX_PARA_MODEL = 'sherpa-onnx-paraformer-zh-small-2024-03-09';
const MEETING_TRANSCRIBER_ENGINE_OPTIONS = ['sherpa-onnx-paraformer', 'whisper', 'volcengine-asr', 'aliyun-asr'] as const;
const MEETING_TRANSCRIBER_MODEL_OPTIONS = [MEETING_SHERPA_ONNX_PARA_MODEL, 'base', 'small', 'medium', 'large', 'turbo'] as const;
const MEETING_TRANSCRIBER_LANGUAGE_OPTIONS = ['zh', 'auto', 'en'] as const;

function meetingTranscriberEngineForModel(model: MeetingTranscriberModel): MeetingTranscriberEngine {
  return model === MEETING_SHERPA_ONNX_PARA_MODEL ? 'sherpa-onnx-paraformer' : 'whisper';
}

function defaultMeetingTranscriberModelForEngine(engine: MeetingTranscriberEngine): MeetingTranscriberModel {
  if (engine === 'sherpa-onnx-paraformer') return MEETING_SHERPA_ONNX_PARA_MODEL;
  if (engine === 'whisper') return 'base';
  return MEETING_SHERPA_ONNX_PARA_MODEL;
}

function readStoredMeetingTranscriberEngine(fallback: MeetingTranscriberEngine = 'sherpa-onnx-paraformer'): MeetingTranscriberEngine {
  try {
    const value = localStorage.getItem('meeting-transcriber-engine');
    if (MEETING_TRANSCRIBER_ENGINE_OPTIONS.includes(value as MeetingTranscriberEngine)) {
      return value as MeetingTranscriberEngine;
    }
  } catch {
    // localStorage is best effort in renderer tests and hardened contexts.
  }
  return fallback;
}

function readStoredMeetingTranscriberModel(engine: MeetingTranscriberEngine): MeetingTranscriberModel {
  try {
    const value = localStorage.getItem('meeting-transcriber-model') as MeetingTranscriberModel | null;
    if (value && MEETING_TRANSCRIBER_MODEL_OPTIONS.includes(value) && meetingTranscriberEngineForModel(value) === engine) {
      return value;
    }
  } catch {
    // best effort only
  }
  return defaultMeetingTranscriberModelForEngine(engine);
}

function readStoredMeetingTranscriberLanguage(): MeetingTranscriberLanguage {
  try {
    const value = localStorage.getItem('meeting-transcriber-language') as MeetingTranscriberLanguage | null;
    if (value && MEETING_TRANSCRIBER_LANGUAGE_OPTIONS.includes(value)) return value;
  } catch {
    // best effort only
  }
  return 'zh';
}

function isLocalMeetingTranscriberEngine(engine: MeetingTranscriberEngine): boolean {
  return engine === 'sherpa-onnx-paraformer' || engine === 'whisper';
}

function normalizeMeetingModelStatuses(value: unknown): MeetingModelStatusSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const fileName = typeof record.fileName === 'string' ? record.fileName : '';
    const sizeLabel = typeof record.sizeLabel === 'string' ? record.sizeLabel : '';
    const rawStatus = typeof record.status === 'string' ? record.status : '';
    const status = rawStatus === 'downloaded' || rawStatus === 'not_downloaded' || rawStatus === 'incomplete' || rawStatus === 'corrupt'
      ? rawStatus
      : undefined;
    if (!id || !fileName || !sizeLabel || !status) return [];
    return [{
      id,
      capability: record.capability === 'punctuation' || record.capability === 'vad' || record.capability === 'speaker'
        ? record.capability
        : 'asr',
      engineId: typeof record.engineId === 'string' ? record.engineId : undefined,
      fileName,
      sizeLabel,
      downloaded: record.downloaded === true,
      status,
      localSizeLabel: typeof record.localSizeLabel === 'string' ? record.localSizeLabel : undefined,
    }];
  });
}

interface NavItem {
  key: SettingsTab;
  icon: typeof Settings;
  label: string;
}

function getNavItems(t: ReturnType<typeof useLocale>['t']): NavItem[] {
  return [
    { key: 'general', icon: SlidersHorizontal, label: t.desktopSettings.navGeneral },
    { key: 'mobile', icon: Smartphone, label: t.desktopSettings.navMobile },
    { key: 'voice', icon: Mic, label: t.desktopSettings.voice },
    { key: 'model', icon: Cpu, label: t.desktopSettings.navModel },
    { key: 'skills', icon: Puzzle, label: t.desktopSettings.navSkills },
    { key: 'channels', icon: Globe, label: t.desktopSettings.navChannels },
    { key: 'mcp', icon: Plug, label: t.desktopSettings.navMcp },
    { key: 'tools', icon: Wrench, label: t.desktopSettings.navTools },
    { key: 'appearance', icon: Palette, label: t.desktopSettings.navAppearance },
    { key: 'data', icon: HardDrive, label: t.desktopSettings.navData },
    { key: 'memory', icon: Brain, label: t.desktopSettings.navMemory },
    { key: 'about', icon: Info, label: t.desktopSettings.navAbout },
  ];
}

interface Props {
  onClose: () => void;
}

export function DesktopSettings({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const { t } = useLocale();
  const navItems = getNavItems(t);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--c-bg-page)]">
      {/* Navigation sidebar */}
      <div
        className="flex w-[200px] shrink-0 flex-col overflow-y-auto"
        style={{ borderRight: '0.5px solid var(--c-border)', paddingTop: 12 }}
      >
        <div className="p-3">
          <button type="button"
            onClick={onClose}
            className="flex h-[36px] w-full items-center gap-2 rounded-lg px-3 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)] transition-colors"
          >
            <ChevronLeft size={16} />
            <span>{t.desktopSettings.back}</span>
          </button>
        </div>
        <div className="px-3">
          <div className="flex flex-col gap-[2px]">
            {navItems.map(({ key, icon: Icon, label }) => {
              const navLabel = label;
              return (
              <button type="button"
                key={key}
                onClick={() => setActiveTab(key)}
                className={[
                  'flex h-[36px] items-center gap-2.5 rounded-lg px-3 text-sm transition-all',
                  activeTab === key
                    ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)]'
                    : 'text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] hover:text-[var(--c-text-primary)]',
                ].join(' ')}
              >
                <Icon size={16} />
                <span>{navLabel}</span>
              </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="px-8 py-6 max-w-[700px]">
          {activeTab === 'model' && <ModelPane />}
          {activeTab === 'skills' && <SkillsPane />}
          {activeTab === 'channels' && <ChannelsPane />}
          {activeTab === 'mcp' && <McpPane />}
          {activeTab === 'tools' && <ToolsPane />}
          {activeTab === 'general' && <GeneralPane />}
          {activeTab === 'mobile' && <MobilePane />}
          {activeTab === 'voice' && <VoicePane />}
          {activeTab === 'appearance' && <DesktopAppearanceSettings />}
          {activeTab === 'data' && <DataPane />}
          {activeTab === 'memory' && <MemoryPane />}
          {activeTab === 'about' && <AboutPane />}
        </div>
      </div>
    </div>
  );
}

// ---- Shared UI ----

function SectionHeader({ icon: Icon, children }: { icon?: typeof Settings; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {Icon && <Icon size={16} className="text-[var(--c-accent)]" />}
      <h3 className="text-sm font-semibold text-[var(--c-text-primary)]">{children}</h3>
    </div>
  );
}

function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`mb-6 ${className || ''}`}>{children}</div>;
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-[var(--c-border)] bg-[var(--c-bg-card)] p-4 ${className || ''}`}
    >
      {children}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--c-accent)]';
const btnPrimary = 'rounded-lg bg-[var(--c-accent)] px-4 py-2 text-sm text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed';
const btnSecondary = 'rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors';
const btnDanger = 'rounded-lg border border-red-200 px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors';

function VoicePane() {
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
    if (!desktop?.meetingSaveAsrConfig || saving) return;
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
      await asrFacts.reload().catch(() => {});
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
      setSaveError(t.knowledge.meetingOnlineAsrSaveFailed(error instanceof Error ? error.message : 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadMeetingModel = async (modelId: string) => {
    if (!desktop?.meetingDownloadModel || modelAction) return;
    setModelAction({ modelId, kind: 'download' });
    setModelStatusesError('');
    try {
      const result = await desktop.meetingDownloadModel(modelId) as { ok?: boolean; reason?: string; error?: string };
      await loadMeetingModelStatuses();
      if (result?.ok === false) {
        setModelStatusesError(t.knowledge.meetingModelActionFailed(result.reason ?? result.error ?? 'unknown'));
      }
      setModelAction(null);
    } catch (error) {
      setModelStatusesError(t.knowledge.meetingModelActionFailed(error instanceof Error ? error.message : 'unknown'));
      setModelAction(null);
    }
  };

  const handleUninstallMeetingModel = async (modelId: string) => {
    if (!desktop?.meetingUninstallModel || modelAction) return;
    setModelAction({ modelId, kind: 'uninstall' });
    setModelStatusesError('');
    try {
      const result = await desktop.meetingUninstallModel(modelId) as { ok?: boolean; reason?: string; error?: string };
      await loadMeetingModelStatuses();
      if (result?.ok === false) {
        setModelStatusesError(t.knowledge.meetingModelActionFailed(result.reason ?? result.error ?? 'unknown'));
      }
      setModelAction(null);
    } catch (error) {
      setModelStatusesError(t.knowledge.meetingModelActionFailed(error instanceof Error ? error.message : 'unknown'));
      setModelAction(null);
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
      {modelFacts.failed && <p role="alert">{t.meetingModelsReadonlyUnavailable}</p>}
      {asrFacts.failed && <p role="alert">{t.meetingAsrReadonlyUnavailable}</p>}
      <button type="button" onClick={() => { modelFacts.refresh(); asrFacts.refresh(); }}>{t.desktopReadonlyRetry}</button>
      <Section>
        <SectionHeader icon={Mic}>{ds.meetingRecordingSettingsTitle}</SectionHeader>
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
          {modelStatusesError && <p className="text-xs leading-5 text-red-600">{modelStatusesError}</p>}
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
                  <input
                    type="password"
                    value={asrDraft.volcAppKey}
                    onChange={event => setAsrDraft(prev => ({ ...prev, volcAppKey: event.target.value }))}
                    aria-label={`${ds.meetingAsrVolcengineTitle} ${ds.meetingAsrAppKey}`}
                    placeholder={asrConfig?.volcengine?.appKeyConfigured ? ds.meetingAsrConfigured : ds.meetingAsrAppKey}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--c-text-secondary)]">{ds.meetingAsrAccessKey}</span>
                  <input
                    type="password"
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
                  <input
                    type="password"
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
              {saveError && <p className="text-xs text-red-600">{saveError}</p>}
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

function MobilePane() {
  const { t } = useLocale();
  const [snapshot, setSnapshot] = useState<{ pairing: DesktopMobilePairingInfo; qrDataUrl: string } | null>(null);
  const pairing = snapshot?.pairing ?? null;
  const qrDataUrl = snapshot?.qrDataUrl ?? '';
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const pairingLifetime = useRef<{ active: boolean; busy: boolean } | null>(null);
  const copyTimer = useRef<number | null>(null);
  // Relay credentials have no refresh grant; these reads never sign in for the user.
  const [relayStatus, setRelayStatus] = useState<DesktopMobileRelayStatus | null>(null);
  const [relayUnavailable, setRelayUnavailable] = useState(false);
  const [relayReading, setRelayReading] = useState(false);
  const relayLifetime = useRef<{ active: boolean; busy: boolean; revision: number } | null>(null);

  const loadRelayStatus = useCallback(async () => {
    const lifetime = relayLifetime.current;
    if (!lifetime?.active || lifetime.busy) return;
    lifetime.busy = true;
    const revision = lifetime.revision;
    setRelayReading(true);
    try {
      const status = await api.getMobileRelayStatus();
      if (lifetime.active && lifetime.revision === revision) {
        setRelayStatus(status);
        setRelayUnavailable(false);
      }
    } catch {
      if (lifetime.active && lifetime.revision === revision) setRelayUnavailable(true);
    } finally {
      lifetime.busy = false;
      if (lifetime.active) setRelayReading(false);
    }
  }, []);

  useEffect(() => {
    const lifetime = { active: true, busy: false, revision: 0 };
    relayLifetime.current = lifetime;
    const off = api.onMobileRelayStatus?.((status) => {
      if (!lifetime.active) return;
      lifetime.revision++;
      setRelayStatus(status);
      setRelayUnavailable(false);
    });
    void loadRelayStatus();
    return () => {
      lifetime.active = false;
      if (relayLifetime.current === lifetime) relayLifetime.current = null;
      off?.();
    };
  }, [loadRelayStatus]);

  const loadPairingInfo = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const lifetime = pairingLifetime.current;
    if (!lifetime?.active || lifetime.busy) return;
    lifetime.busy = true;
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const info = await api.getMobilePairingInfo();
      if (!lifetime.active) return;
      const qr = await QRCode.toDataURL(info.deepLink, {
        errorCorrectionLevel: 'M', margin: 1, width: 220,
        color: { dark: '#111827', light: '#ffffff' },
      });
      if (!lifetime.active) return;
      setSnapshot({ pairing: info, qrDataUrl: qr });
      setCopyStatus('idle');
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    } catch {
      if (lifetime.active) setError(t.desktopSettings.mobilePairingLoadFailed);
    } finally {
      lifetime.busy = false;
      if (lifetime.active) { setLoading(false); setRefreshing(false); }
    }
  }, [t.desktopSettings.mobilePairingLoadFailed]);

  useEffect(() => {
    const lifetime = { active: true, busy: false };
    pairingLifetime.current = lifetime;
    void loadPairingInfo();
    return () => {
      lifetime.active = false;
      if (pairingLifetime.current === lifetime) pairingLifetime.current = null;
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, [loadPairingInfo]);

  const copyPairingLink = useCallback(async () => {
    const lifetime = pairingLifetime.current;
    if (!pairing?.deepLink || !lifetime?.active) return;
    try {
      await navigator.clipboard.writeText(pairing.deepLink);
      if (!lifetime.active) return;
      setCopyStatus('copied');
    } catch {
      if (!lifetime.active) return;
      setCopyStatus('failed');
    }
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => {
      if (lifetime.active) setCopyStatus('idle');
    }, 2500);
  }, [pairing?.deepLink]);

  const [signInBusy, setSignInBusy] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const signInLifetime = useRef<{ active: boolean; busy: boolean } | null>(null);
  useEffect(() => {
    const lifetime = { active: true, busy: false };
    signInLifetime.current = lifetime;
    return () => { lifetime.active = false; if (signInLifetime.current === lifetime) signInLifetime.current = null; };
  }, []);
  const openRelaySignIn = useCallback(async () => {
    const lifetime = signInLifetime.current;
    if (!lifetime?.active || lifetime.busy) return;
    lifetime.busy = true;
    setSignInBusy(true);
    setSignInFailed(false);
    try {
      const result = await api.openMobileRelaySignIn();
      if (lifetime.active) setSignInFailed(!result || typeof result !== 'object' || result.ok !== true || typeof result.url !== 'string' || result.url.length === 0);
    } catch {
      if (lifetime.active) setSignInFailed(true);
    } finally {
      lifetime.busy = false;
      if (lifetime.active) setSignInBusy(false);
    }
  }, []);

  const relayReady = Boolean(pairing?.relayUrl && pairing.relayJwt && pairing.relayRoomSecret);

  return (
    <div className="space-y-6">
      <Section>
        <SectionHeader icon={Smartphone}>{t.desktopSettings.mobilePairingTitle}</SectionHeader>
        {signInFailed && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{t.desktopSettings.mobileRelaySignInFailed}</div>}
        {relayUnavailable && (
          <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <div>{t.desktopSettings.mobileRelayReadUnavailable}</div>
            <button type="button" onClick={() => void loadRelayStatus()} disabled={relayReading} className={`${btnSecondary} mt-2`}>
              {t.desktopSettings.mobileRelayReadRetry}
            </button>
          </div>
        )}
        {relayStatus && relayStatus.credentialState !== 'ok' && (
          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
              relayStatus.requiresUserReauth
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-[var(--c-border)] bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]'
            }`}
          >
            <div className="font-medium">
              {relayStatus.credentialState === 'expired' && t.desktopSettings.mobileRelayStateExpired}
              {relayStatus.credentialState === 'rejected' && t.desktopSettings.mobileRelayStateRejected}
              {relayStatus.credentialState === 'missing' && t.desktopSettings.mobileRelayStateMissing}
              {relayStatus.credentialState === 'unparseable' && t.desktopSettings.mobileRelayStateUnparseable}
            </div>
            {relayStatus.credentialExpiresAt && (
              <div className="mt-1 text-xs opacity-80">
                {t.desktopSettings.mobileRelayExpiredAt}: {new Date(relayStatus.credentialExpiresAt).toLocaleString()}
              </div>
            )}
            <div className="mt-1 text-xs opacity-80">{t.desktopSettings.mobileRelayReauthHint}</div>
            {relayStatus.requiresUserReauth && relayStatus.relayUrl && (
              <button
                type="button"
                onClick={() => { void openRelaySignIn(); }}
                disabled={signInBusy}
                className="mt-2 inline-flex items-center gap-1 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white"
              >
                {t.desktopSettings.mobileRelaySignInAction}
              </button>
            )}
          </div>
        )}
        <Card>
          {error && (
            <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <div>{error}</div>
              {!pairing && <button type="button" onClick={() => void loadPairingInfo('refresh')} disabled={refreshing} className={`${btnSecondary} mt-2`}>{t.desktopSettings.mobilePairingRefresh}</button>}
            </div>
          )}
          {loading && !pairing ? (
            <div className="flex items-center gap-2 text-sm text-[var(--c-text-secondary)]">
              <Loader2 size={14} className="animate-spin" />
              <span>{t.desktopSettings.mobilePairingLoading}</span>
            </div>
          ) : pairing ? (
            <div className="grid gap-5 md:grid-cols-[240px_1fr]">
              <div className="flex flex-col items-center gap-3">
                <div className="flex size-[240px] items-center justify-center rounded-lg border border-[var(--c-border)] bg-white p-3">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt={t.desktopSettings.mobilePairingQrAlt} className="size-full object-contain" />
                  ) : (
                    <QrCode size={64} className="text-[var(--c-text-muted)]" />
                  )}
                </div>
                <div className="flex w-full gap-2">
                  <button type="button" onClick={copyPairingLink} className={`${btnSecondary} flex flex-1 items-center justify-center gap-2 px-3`}>
                    <Copy size={14} />
                    <span>{t.desktopSettings.mobilePairingCopyLink}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadPairingInfo('refresh')}
                    disabled={refreshing}
                    className={`${btnSecondary} flex items-center justify-center px-3`}
                    title={t.desktopSettings.mobilePairingRefresh}
                    aria-label={t.desktopSettings.mobilePairingRefresh}
                  >
                    <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                  </button>
                </div>
                {copyStatus !== 'idle' && (
                  <div className={copyStatus === 'copied' ? 'text-xs text-emerald-600' : 'text-xs text-red-600'}>
                    {copyStatus === 'copied' ? t.desktopSettings.mobilePairingCopied : t.desktopSettings.mobilePairingCopyFailed}
                  </div>
                )}
              </div>
              <div className="min-w-0 space-y-4">
                <div>
                  <div className="text-sm font-medium text-[var(--c-text-primary)]">{t.desktopSettings.mobilePairingScanTitle}</div>
                  <p className="mt-1 text-sm leading-6 text-[var(--c-text-secondary)]">{t.desktopSettings.mobilePairingScanDesc}</p>
                </div>
                <div className="grid gap-2 text-sm">
                  <MobileInfoRow label={t.desktopSettings.mobilePairingDesktopId} value={pairing.desktopId} />
                  <MobileInfoRow label={t.desktopSettings.mobilePairingLanAddress} value={pairing.gatewayURL || t.desktopSettings.mobilePairingNoLanAddress} />
                  <MobileInfoRow label={t.desktopSettings.mobilePairingRelay} value={relayReady ? t.desktopSettings.mobilePairingRelayReady : t.desktopSettings.mobilePairingRelayMissing} tone={relayReady ? 'ok' : 'warn'} />
                  <MobileInfoRow label={t.desktopSettings.mobilePairingReachableCount} value={t.desktopSettings.mobilePairingReachableCountValue(pairing.reachableURLs.length)} />
                </div>
                <div className="rounded-lg bg-[var(--c-bg-deep)] px-3 py-2 text-xs leading-5 text-[var(--c-text-secondary)]">
                  {t.desktopSettings.mobilePairingSecurityNote}
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      </Section>
    </div>
  );
}

function MobileInfoRow({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'ok' | 'warn' }) {
  const toneClass = tone === 'ok'
    ? 'text-emerald-600'
    : tone === 'warn'
      ? 'text-amber-600'
      : 'text-[var(--c-text-primary)]';
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--c-border)] px-3 py-2">
      <span className="shrink-0 text-xs text-[var(--c-text-tertiary)]">{label}</span>
      <span className={`min-w-0 truncate text-right text-xs font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}

// ---- Model Settings ----

const KIMI_K3_CONTEXT_262K = 262_144;
const KIMI_K3_CONTEXT_1M = 1_048_576;
const KIMI_K3_REASONING_EFFORTS = ['low', 'high', 'max'] as const;

type KimiK3ContextLimit = typeof KIMI_K3_CONTEXT_262K | typeof KIMI_K3_CONTEXT_1M;
type KimiK3ReasoningEffort = typeof KIMI_K3_REASONING_EFFORTS[number];
type DesktopModelEntry = DesktopModelConfigSnapshot['models'][number];

function supportsKimiK3RuntimeOptions(model: DesktopModelEntry | undefined): boolean {
  const constraints = model?.runtimeConstraints;
  return Boolean(
    model?.runtimeOptions
    && constraints?.maxContextLimit !== undefined
    && constraints.maxContextLimit >= KIMI_K3_CONTEXT_1M
    && KIMI_K3_REASONING_EFFORTS.every(effort => constraints.reasoningEfforts?.includes(effort)),
  );
}

interface SkillItem {
  name: string;
  aliases: string[];
  description: string;
  source: string;
  tier: string;
}

function ModelPane() {
  const { t } = useLocale();
  const [config, setConfig] = useState<DesktopModelConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, TestProviderConnectionResult>>({});
  const [showAddModel, setShowAddModel] = useState<string>('');
  const [customModelInput, setCustomModelInput] = useState('');
  const [runtimeContextLimit, setRuntimeContextLimit] = useState<KimiK3ContextLimit>(KIMI_K3_CONTEXT_262K);
  const [runtimeReasoningEffort, setRuntimeReasoningEffort] = useState<KimiK3ReasoningEffort>('high');
  const [savingRuntimeOptions, setSavingRuntimeOptions] = useState(false);

  const currentModel = config?.models.find(model => model.id === config.defaultModelId)
    ?? config?.models.find(model => model.isDefault);
  const currentProvider = currentModel
    ? config?.providers.find(provider => provider.id === currentModel.provider)
    : undefined;
  const showKimiK3RuntimeOptions = supportsKimiK3RuntimeOptions(currentModel);
  const modelMutationPending = saving || savingRuntimeOptions;

  useEffect(() => {
    api.getModelConfig()
      .then(c => {
        setConfig(c);
      })
      .catch(e => setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setRuntimeContextLimit(
      currentModel?.runtimeOptions?.contextLimit === KIMI_K3_CONTEXT_1M
        ? KIMI_K3_CONTEXT_1M
        : KIMI_K3_CONTEXT_262K,
    );
    const nextEffort = currentModel?.runtimeOptions?.reasoningEffort;
    setRuntimeReasoningEffort(
      KIMI_K3_REASONING_EFFORTS.find(effort => effort === nextEffort) ?? 'high',
    );
  }, [currentModel?.id, currentModel?.runtimeOptions?.contextLimit, currentModel?.runtimeOptions?.reasoningEffort]);

  const handleSave = async () => {
    if (!selectedProvider || !apiKey.trim() || modelMutationPending) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const input: DesktopSaveModelConfigInput = {
        providerId: selectedProvider,
        apiKey: apiKey.trim(),
      };
      const updated = await api.saveModelConfig(input);
      setConfig(updated);
      setApiKey('');
      setSuccess(t.desktopSettings.apiKeyUpdated(updated.providers.find(p => p.id === selectedProvider)?.label ?? selectedProvider));
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (providerId: string) => {
    if (!providerId) return;
    const providerDefaultModelId = config?.providerProfiles.find(profile => profile.id === providerId)?.defaultModelId;
    const testedModel = config?.models.find(model => (
      model.provider === providerId && model.id === providerDefaultModelId
    )) ?? config?.models.find(model => model.provider === providerId);
    setTesting(prev => ({ ...prev, [providerId]: true }));
    setError('');
    try {
      const result = await api.testProviderConnection({ providerId });
      setTestResults(prev => ({ ...prev, [providerId]: result }));
      if (result.success) {
        setSuccess(t.desktopSettings.connectionSuccessLatency(result.latencyMs ?? 0));
      } else {
        const diagnostic = result.error || t.desktopSettings.connectionFailed;
        const guidance = supportsKimiK3RuntimeOptions(testedModel)
          ? ` ${t.desktopSettings.kimiK3ConnectionErrorAdvice}`
          : '';
        setError(`${diagnostic}${guidance}`);
      }
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setTesting(prev => ({ ...prev, [providerId]: false }));
    }
  };

  const handleAddModel = async (modelId: string) => {
    if (!config || modelMutationPending) return;
    // Find the model across all provider profiles
    let foundModel: { modelId: string; model: string; label: string } | undefined;
    let foundProviderId = '';
    for (const profile of config.providerProfiles) {
      const m = profile.availableModels?.find(am => am.modelId === modelId);
      if (m) { foundModel = m; foundProviderId = profile.id; break; }
    }
    if (!foundModel || !foundProviderId) return;
    setSaving(true);
    setError('');
    try {
      await api.saveModelConfig({
        providerId: foundProviderId,
        modelName: foundModel.model,
        label: foundModel.label,
      });
      const updated = await api.getModelConfig();
      setConfig(updated);
      setSuccess(t.desktopSettings.modelAdded(foundModel.label));
      setShowAddModel('');
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomModel = async (providerId: string, modelName: string) => {
    if (!config || !modelName.trim() || modelMutationPending) return;
    setSaving(true);
    setError('');
    try {
      await api.saveModelConfig({
        providerId,
        modelName: modelName.trim(),
        label: modelName.trim(),
      });
      const updated = await api.getModelConfig();
      setConfig(updated);
      setSuccess(t.desktopSettings.customModelAdded(modelName.trim()));
      setShowAddModel('');
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefaultModel = async (modelId: string) => {
    if (!config || config.defaultModelId === modelId || modelMutationPending) return;
    const model = config.models.find(m => m.id === modelId);
    if (!model) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const updated = await api.saveModelConfig({
        providerId: model.provider,
        modelId,
      });
      setConfig(updated);
      const updatedCurrentModel = updated.models.find(candidate => candidate.id === updated.defaultModelId)
        ?? updated.models.find(candidate => candidate.isDefault);
      const newSessionHint = supportsKimiK3RuntimeOptions(updatedCurrentModel)
        ? ` ${t.desktopSettings.kimiK3NewSessionHint}`
        : '';
      setSuccess(`${t.desktopSettings.modelSwitched(updatedCurrentModel?.label ?? model.label)}${newSessionHint}`);
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRuntimeOptions = async () => {
    if (!currentModel || !showKimiK3RuntimeOptions || modelMutationPending) return;
    setSavingRuntimeOptions(true);
    setError('');
    setSuccess('');
    try {
      const updated = await api.updateModelRuntimeOptions({
        modelId: currentModel.id,
        runtimeOptions: {
          contextLimit: runtimeContextLimit,
          reasoningEffort: runtimeReasoningEffort,
        },
      });
      setConfig(updated);
      setSuccess(`${t.desktopSettings.kimiK3RuntimeOptionsSaved} ${t.desktopSettings.kimiK3NewSessionHint}`);
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSavingRuntimeOptions(false);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    if (modelMutationPending) return;
    if (!confirm(t.desktopSettings.confirmDeleteModel)) return;
    setSaving(true);
    try {
      await api.deleteModel(modelId);
      const updated = await api.getModelConfig();
      setConfig(updated);
      setSuccess(t.desktopSettings.modelDeleted);
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (modelMutationPending) return;
    if (!confirm(t.desktopSettings.confirmDeleteProvider)) return;
    setSaving(true);
    try {
      await api.deleteProvider(providerId);
      const updated = await api.getModelConfig();
      setConfig(updated);
      if (selectedProvider === providerId) {
        setSelectedProvider(updated.providers[0]?.id ?? '');
      }
      setSuccess(t.desktopSettings.providerDeleted);
    } catch (e) {
      setError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--c-text-secondary)]" />
      </div>
    );
  }

  return (
    <>
      <Section>
        <SectionHeader icon={Cpu}>{t.desktopSettings.modelProviders}</SectionHeader>
        {currentModel && (
          <Card className="mb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.currentModel}</div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-[var(--c-text-primary)]">{currentModel.label}</span>
                  <span className="rounded-md bg-[var(--c-bg-deep)] px-2 py-0.5 text-xs text-[var(--c-text-secondary)]">
                    {currentProvider?.label ?? currentModel.provider}
                  </span>
                </div>
                {currentModel.capabilities && currentModel.capabilities.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {currentModel.capabilities.map(capability => (
                      <span key={capability} className="rounded px-1.5 py-0.5 text-[10px] text-[var(--c-text-tertiary)] bg-[var(--c-bg-deep)]">
                        {capability}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {showKimiK3RuntimeOptions && (
              <div className="mt-4 border-t border-[var(--c-border-subtle)] pt-3">
                <div className="text-xs font-medium text-[var(--c-text-primary)]">{t.desktopSettings.kimiK3RuntimeTitle}</div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="desktop-kimi-k3-context-limit" className="mb-1.5 block text-xs text-[var(--c-text-secondary)]">
                      {t.desktopSettings.kimiK3ContextLabel}
                    </label>
                    <select
                      id="desktop-kimi-k3-context-limit"
                      value={runtimeContextLimit}
                      onChange={event => setRuntimeContextLimit(Number(event.target.value) as KimiK3ContextLimit)}
                      disabled={modelMutationPending}
                      className={inputCls}
                    >
                      <option value={KIMI_K3_CONTEXT_262K}>{t.desktopSettings.kimiK3Context262k}</option>
                      <option value={KIMI_K3_CONTEXT_1M}>{t.desktopSettings.kimiK3Context1m}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="desktop-kimi-k3-reasoning-effort" className="mb-1.5 block text-xs text-[var(--c-text-secondary)]">
                      {t.desktopSettings.kimiK3EffortLabel}
                    </label>
                    <select
                      id="desktop-kimi-k3-reasoning-effort"
                      value={runtimeReasoningEffort}
                      onChange={event => setRuntimeReasoningEffort(event.target.value as KimiK3ReasoningEffort)}
                      disabled={modelMutationPending}
                      className={inputCls}
                    >
                      <option value="low">{t.desktopSettings.kimiK3EffortLow}</option>
                      <option value="high">{t.desktopSettings.kimiK3EffortHigh}</option>
                      <option value="max">{t.desktopSettings.kimiK3EffortMax}</option>
                    </select>
                  </div>
                </div>
                <p className="mt-2 text-xs text-[var(--c-text-tertiary)]">{t.desktopSettings.kimiK3AllegrettoHint}</p>
                <button
                  type="button"
                  onClick={() => void handleSaveRuntimeOptions()}
                  disabled={modelMutationPending}
                  className="mt-3 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {savingRuntimeOptions ? `${t.desktopSettings.kimiK3SaveRuntimeOptions}…` : t.desktopSettings.kimiK3SaveRuntimeOptions}
                </button>
              </div>
            )}
          </Card>
        )}
        <div className="flex flex-col gap-3">
          {config?.providers.map(provider => {
            const testResult = testResults[provider.id];
            return (
              <Card key={provider.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{provider.label}</span>
                      {provider.apiKeyConfigured ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-600">
                          <Check size={12} /> {t.desktopSettings.configured}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-xs text-yellow-600">
                          <AlertCircle size={12} /> {t.desktopSettings.notConfigured}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-[var(--c-text-secondary)]">
                      {t.desktopSettings.protocol}: {provider.protocol}
                      {provider.baseUrl && ` · ${provider.baseUrl}`}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      <button type="button"
                        onClick={() => handleTest(provider.id)}
                        disabled={testing[provider.id]}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors disabled:opacity-50"
                      >
                        {testing[provider.id] ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                        {t.desktopSettings.testConnection}
                      </button>
                      <button type="button"
                        onClick={() => { setSelectedProvider(prev => prev === provider.id ? '' : provider.id); setApiKey(''); }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
                      >
                        <Edit3 size={12} /> {provider.apiKeyConfigured ? t.desktopSettings.updateKey : t.desktopSettings.setKey}
                      </button>
                      {testResult && (
                        <span className={`text-xs truncate max-w-[200px] ${testResult.success ? 'text-green-600' : 'text-red-500'}`}>
                          {testResult.success
                            ? t.desktopSettings.latencyMs(testResult.latencyMs ?? 0)
                            : testResult.error}
                        </span>
                      )}
                      {(
                        <button type="button"
                          onClick={() => handleDeleteProvider(provider.id)}
                          disabled={modelMutationPending}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={12} /> {t.desktopSettings.deleteLabel}
                        </button>
                      )}
                    </div>
                    {/* Inline API Key input */}
                    {selectedProvider === provider.id && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="relative flex-1">
                          <input aria-label="sk-..."
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            placeholder="sk-..."
                            className={`${inputCls} pr-10 !py-1.5 text-xs`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)]"
                          >
                            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                        <button type="button"
                          onClick={handleSave}
                          disabled={modelMutationPending || !apiKey.trim()}
                          className="shrink-0 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {saving ? '...' : t.desktopSettings.saveLabel}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {/* Model list */}
                {config?.models && (
                  <div className="mt-3 pt-3 border-t border-[var(--c-border-subtle)]">
                    <div className="text-xs text-[var(--c-text-secondary)] mb-1.5">{t.desktopSettings.configuredModels}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {config.models
                        .filter(m => m.provider === provider.id)
                        .map(m => (
                          <span
                            key={m.id}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                              config.defaultModelId === m.id
                                ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)]'
                                : 'bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]'
                            }`}
                          >
                            {m.label}
                            {config.defaultModelId === m.id && ` ${t.desktopSettings.defaultBadge}`}
                            {config.defaultModelId !== m.id && (
                              <button type="button"
                                onClick={() => void handleSetDefaultModel(m.id)}
                                disabled={modelMutationPending}
                                className="ml-1 rounded px-1 text-[10px] text-[var(--c-accent)] hover:bg-[var(--c-accent)]/10 disabled:opacity-50"
                              >
                                {t.desktopSettings.setAsDefault}
                              </button>
                            )}
                            <button type="button"
                              onClick={() => handleDeleteModel(m.id)}
                              disabled={modelMutationPending}
                              className="ml-1 hover:text-red-500 disabled:opacity-50"
                              title={t.desktopSettings.deleteModel}
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                    </div>
                    {/* Add model from profile's available models */}
                    {(() => {
                      const profile = config.providerProfiles.find(p => p.id === provider.id);
                      const profileModels = profile?.availableModels ?? [];
                      const configuredModels = config.models.filter(m => m.provider === provider.id);
                      const addable = profileModels.filter(m => !configuredModels.some(cm => cm.model === m.model));
                      return (
                        <div className="mt-2">
                          <button type="button"
                            onClick={() => { setShowAddModel(prev => prev === provider.id ? '' : provider.id); setCustomModelInput(''); }}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
                          >
                            <Plus size={12} /> {t.desktopSettings.addModel}
                          </button>
                          {showAddModel === provider.id && (
                            <div className="mt-2 space-y-2">
                              {addable.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {addable.map(m => (
                                    <button type="button"
                                      key={m.modelId}
                                      onClick={() => handleAddModel(m.modelId)}
                                      disabled={modelMutationPending}
                                      className="rounded-md px-2 py-1 text-xs bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] hover:bg-[var(--c-accent)]/10 hover:text-[var(--c-accent)] transition-colors disabled:opacity-50"
                                    >
                                      {m.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={customModelInput}
                                  onChange={e => setCustomModelInput(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter' && customModelInput.trim()) { void handleAddCustomModel(provider.id, customModelInput); setCustomModelInput(''); } }}
                                  placeholder={t.desktopSettings.customModelPlaceholder}
                                  aria-label={t.desktopSettings.customModelPlaceholder}
                                  className="flex-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg)] px-2.5 py-1 text-xs text-[var(--c-text-primary)] placeholder:text-[var(--c-text-tertiary)] outline-none focus:border-[var(--c-accent)]"
                                />
                                <button type="button"
                                  onClick={() => { void handleAddCustomModel(provider.id, customModelInput); setCustomModelInput(''); }}
                                  disabled={modelMutationPending || !customModelInput.trim()}
                                  className="shrink-0 rounded-md bg-[var(--c-accent)] px-3 py-1 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40"
                                >
                                  {t.desktopSettings.addLabel}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </Section>

      {error && !loading && (
        <Section>
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        </Section>
      )}

      {success && (
        <Section>
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-600">
            {success}
          </div>
        </Section>
      )}

      <Section>
        <SectionHeader icon={Plus}>{t.desktopSettings.addModelProvider}</SectionHeader>
        <AddProviderCard
          config={config}
          mutationPending={modelMutationPending}
          onMutationPendingChange={setSaving}
          onAdded={(updated) => {
            setConfig(updated);
            setSuccess(t.desktopSettings.providerAdded);
          }}
          onError={setError}
        />
      </Section>
    </>
  );
}

// ---- Skills ----

// ---- Add Provider Card ----

function AddProviderCard({
  config,
  mutationPending,
  onMutationPendingChange,
  onAdded,
  onError,
}: {
  config: DesktopModelConfigSnapshot | null;
  mutationPending: boolean;
  onMutationPendingChange: (pending: boolean) => void;
  onAdded: (updated: DesktopModelConfigSnapshot) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useLocale();
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customName, setCustomName] = useState('');

  const profiles = config?.providerProfiles ?? [];
  const configuredIds = new Set(config?.providers.map(p => p.id) ?? []);

  const selectedProfile = profiles.find(p => p.id === selectedProfileId);
  const isCustom = selectedProfileId === '__custom__';

  const handleProfileChange = (id: string) => {
    setSelectedProfileId(id);
    if (id === '__custom__') {
      setBaseUrl('');
    } else {
      const profile = profiles.find(p => p.id === id);
      setBaseUrl(profile?.baseUrl ?? '');
    }
    setProviderApiKey('');
  };

  const handleAdd = async () => {
    if (!selectedProfileId || mutationPending) return;
    if (isCustom && !customName.trim()) {
      onError(t.desktopSettings.customNameRequired);
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      onError(t.desktopSettings.customBaseUrlRequired);
      return;
    }
    setSaving(true);
    onMutationPendingChange(true);
    try {
      const providerId = isCustom ? customName.trim().toLowerCase().replace(/\s+/g, '-') : selectedProfileId;
      const updated = await api.saveModelConfig({
        providerId,
        apiKey: providerApiKey.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      onAdded(updated);
      setSelectedProfileId('');
      setBaseUrl('');
      setProviderApiKey('');
      setCustomName('');
    } catch (e) {
      onError(modelConfigErrorMessage(e, { operationUnknown: t.desktopSettings.modelConfigOperationUnknown, inputInvalid: t.desktopSettings.modelConfigInputInvalid, unavailable: t.desktopSettings.modelConfigUnavailable }) ?? (e as Error).message);
    } finally {
      setSaving(false);
      onMutationPendingChange(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="desktop-model-provider-profile" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.desktopSettings.selectProvider}</label>
          <select
            id="desktop-model-provider-profile"
            value={selectedProfileId}
            onChange={e => handleProfileChange(e.target.value)}
            className={inputCls}
          >
            <option value="">{t.desktopSettings.selectProviderPlaceholder}</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.label}{configuredIds.has(p.id) ? ` ${t.desktopSettings.alreadyConfigured}` : ''}
              </option>
            ))}
            <option value="__custom__">{t.desktopSettings.customOpenaiCompatible}</option>
          </select>
        </div>

        {isCustom && (
          <div>
            <label htmlFor="desktop-custom-provider-name" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.desktopSettings.providerName}</label>
            <input
              id="desktop-custom-provider-name"
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              placeholder="my-provider"
              className={inputCls}
            />
          </div>
        )}

        {selectedProfileId && (
          <>
            <div>
              <label htmlFor="desktop-provider-base-url" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.commonBaseUrl}</label>
              <input
                id="desktop-provider-base-url"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="desktop-provider-api-key" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.commonApiKey}</label>
              <div className="relative">
                <input
                  id="desktop-provider-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={providerApiKey}
                  onChange={e => setProviderApiKey(e.target.value)}
                  placeholder="sk-..."
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--c-text-tertiary)] hover:text-[var(--c-text-secondary)]"
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Available models preview */}
            {selectedProfile?.availableModels && selectedProfile.availableModels.length > 0 && (
              <div>
                <div className="block text-xs text-[var(--c-text-secondary)] mb-1.5">{t.desktopSettings.availableModels}</div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedProfile.availableModels.map(m => (
                    <span
                      key={m.modelId}
                      className="inline-flex items-center rounded-md bg-[var(--c-bg-deep)] px-2 py-1 text-xs text-[var(--c-text-secondary)]"
                    >
                      {m.label}
                    </span>
                  ))}
                </div>
                <span className="mt-1 block text-[11px] text-[var(--c-text-muted)]">{t.desktopSettings.defaultModelAfterAdd(selectedProfile.defaultModelLabel)}</span>
              </div>
            )}

            {!isCustom && selectedProfile && (
              <div className="text-[11px] text-[var(--c-text-muted)]">
                {t.desktopSettings.protocol}: {selectedProfile.protocol}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button type="button"
                onClick={handleAdd}
                disabled={saving || mutationPending}
                className={btnPrimary}
              >
                {saving ? t.desktopSettings.addingProvider : t.desktopSettings.addProvider}
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function SkillsPane() {
  const { t } = useLocale();
  const listFacts = useSkillListReadonly(), statFacts = useSkillStatsReadonly();
  const skills = listFacts.data ?? [];
  const loading = listFacts.reading && listFacts.data === null;
  const [installing, setInstalling] = useState(false);
  const [installName, setInstallName] = useState('');
  const [showInstall, setShowInstall] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const statsMap = new Map((statFacts.data ?? []).map(s => [s.skillName, s]));

  const handleInstall = async () => {
    if (!installName.trim()) return;
    setInstalling(true);
    setError('');
    try {
      const result = await api.installSkill(installName.trim());
      if (result.success) {
        setSuccess(result.message);
        setShowInstall(false);
        setInstallName('');
        // Refresh skill list
        listFacts.refresh();
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstall = async (skillName: string) => {
    if (!confirm(t.desktopSettings.confirmUninstallSkill(skillName))) return;
    setInstalling(true);
    setError('');
    try {
      const result = await api.uninstallSkill(skillName);
      if (result.success) {
        setSuccess(result.message);
        // Refresh skill list
        listFacts.refresh();
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  if (loading && !listFacts.failed) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--c-text-secondary)]" />
      </div>
    );
  }

  return (
    <>
      {listFacts.failed && <p role="alert">{t.skillsReadonlyListFailed}</p>}
      {statFacts.failed && <p role="alert">{t.skillsReadonlyStatsFailed}</p>}
      <button type="button" onClick={() => { listFacts.refresh(); statFacts.refresh(); }}>{t.skillsReadonlyRetry}</button>
      <Section>
        <SectionHeader icon={Puzzle}>{listFacts.data === null ? t.skillsReadonlyUnknown : t.desktopSettings.installedSkills(skills.length)}</SectionHeader>
        {/* Status messages */}
        {success && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">
            <Check size={16} />
            {success}
            <button type="button" onClick={() => setSuccess('')} className="ml-auto text-green-600 hover:text-green-700">
              <X size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertCircle size={16} />
            {error}
            <button type="button" onClick={() => setError('')} className="ml-auto text-red-600 hover:text-red-700">
              <X size={14} />
            </button>
          </div>
        )}
        <p className="text-xs text-[var(--c-text-secondary)] mb-4">
          {t.desktopSettings.skillsDesc}
        </p>

        {/* Install button */}
        <button type="button"
          onClick={() => setShowInstall(!showInstall)}
          className="inline-flex items-center gap-2 mb-4 rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
        >
          <Plus size={16} />
          {t.desktopSettings.installSkill}
        </button>

        {/* Install form */}
        {showInstall && (
          <Card className="mb-4">
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="desktop-install-skill-name" className="block text-xs text-[var(--c-text-secondary)] mb-1">{t.desktopSettings.skillName}</label>
                <input
                  id="desktop-install-skill-name"
                  type="text"
                  value={installName}
                  onChange={e => setInstallName(e.target.value)}
                  placeholder={t.desktopSettings.skillNamePlaceholder}
                  className={inputCls}
                />
              </div>
              <div className="text-xs text-[var(--c-text-secondary)]">
                {t.desktopSettings.installCommand} <code className="bg-[var(--c-bg-deep)] px-1.5 py-0.5 rounded">clawhub install {installName || `<${t.desktopSettings.skillNameExample}>`}</code>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleInstall} disabled={installing || !installName.trim()} className={btnPrimary}>
                  {installing ? t.desktopSettings.installing : t.desktopSettings.confirmInstall}
                </button>
                <button type="button" onClick={() => setShowInstall(false)} className={btnSecondary}>{t.desktopSettings.cancelLabel}</button>
              </div>
            </div>
          </Card>
        )}

        <div className="flex flex-col gap-2">
          {listFacts.data !== null && skills.length === 0 ? (
            <Card>
              <div className="flex items-center gap-3 text-sm text-[var(--c-text-secondary)]">
                <Info size={16} />
                {t.desktopSettings.noInstalledSkills} <code className="bg-[var(--c-bg-deep)] px-1.5 py-0.5 rounded">clawhub install &lt;{t.desktopSettings.skillNameExample}&gt;</code> {t.desktopSettings.noInstalledSkillsHint}
              </div>
            </Card>
          ) : (
            skills
              .slice()
              .sort((a, b) => {
                const sa = statsMap.get(a.name);
                const sb = statsMap.get(b.name);
                const ca = sa?.totalCalls ?? 0;
                const cb = sb?.totalCalls ?? 0;
                return cb - ca;
              })
              .map(skill => {
              const stats = statsMap.get(skill.name);
              return (
                <Card key={skill.name}>
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 mt-0.5">
                      <Package size={16} className="text-[var(--c-accent)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono text-[var(--c-accent)]">/{skill.name}</code>
                        <span className="text-xs text-[var(--c-text-tertiary)]">[{skill.tier}]</span>
                        {stats && stats.totalCalls > 0 && (
                          <span className="ml-auto text-xs text-[var(--c-text-tertiary)]">
                            {Number.isFinite(stats.avgDurationMs) ? t.desktopSettings.skillStats(stats.totalCalls, Math.round(stats.avgDurationMs / 1000)) : t.skillsReadonlyMetricUnknown}
                          </span>
                        )}
                      </div>
                      {skill.description && (
                        <p className="mt-1 text-sm text-[var(--c-text-secondary)] line-clamp-2">
                          {skill.description}
                        </p>
                      )}
                      {skill.aliases && skill.aliases.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {skill.aliases.map(a => (
                            <span key={a} className="rounded px-1.5 py-0.5 text-xs bg-[var(--c-bg-deep)] text-[var(--c-text-tertiary)]">
                              {a}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="button"
                      onClick={() => handleUninstall(skill.name)}
                      className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-red-500 transition-colors"
                      title={t.desktopSettings.uninstall}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </Section>

      <Section>
        <SectionHeader>{t.desktopSettings.skillSources}</SectionHeader>
        <Card>
          <div className="text-xs text-[var(--c-text-secondary)]">
            {t.desktopSettings.skillSourcesDesc}
            <div className="mt-2 flex flex-col gap-1 font-mono">
              <code className="bg-[var(--c-bg-deep)] px-2 py-1 rounded">clawhub search &lt;{t.desktopSettings.skillSourcesSearch}&gt;</code>
              <code className="bg-[var(--c-bg-deep)] px-2 py-1 rounded">clawhub install &lt;{t.desktopSettings.skillSourcesInstall}&gt;</code>
              <code className="bg-[var(--c-bg-deep)] px-2 py-1 rounded">clawhub uninstall &lt;{t.desktopSettings.skillSourcesUninstall}&gt;</code>
              <code className="bg-[var(--c-bg-deep)] px-2 py-1 rounded">clawhub list</code>
            </div>
          </div>
        </Card>
      </Section>
    </>
  );
}

// ---- Channels ----

interface ChannelConfig {
  id: string;
  type: string;
  name: string;
  webhookUrl?: string;
  appId?: string;
  appSecret?: string;
  token?: string;
  botToken?: string;
  chatId?: string;
  corpId?: string;
  agentId?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// Channel type specific configuration fields (i18n-aware)
type ChannelTypeConfigMap = Record<string, { label: string; fields: Array<{ key: string; label: string; placeholder: string; required?: boolean }> }>;

function getChannelTypeConfig(ts: ReturnType<typeof useLocale>['t']['desktopSettings']): ChannelTypeConfigMap {
  return {
    yunzhijia: {
      label: ts.channelTypeYunzhijia,
      fields: [
        { key: 'appId', label: 'App ID', placeholder: ts.channelFieldAppId, required: true },
        { key: 'appSecret', label: 'App Secret', placeholder: ts.channelFieldAppSecret, required: true },
        { key: 'token', label: 'Token', placeholder: ts.channelFieldToken },
      ],
    },
    feishu: {
      label: ts.channelTypeFeishu,
      fields: [
        { key: 'appId', label: 'App ID', placeholder: ts.channelFieldFeishuAppId, required: true },
        { key: 'appSecret', label: 'App Secret', placeholder: ts.channelFieldFeishuAppSecret, required: true },
      ],
    },
    discord: {
      label: ts.channelTypeDiscord,
      fields: [
        { key: 'botToken', label: 'Bot Token', placeholder: 'Discord Bot Token', required: true },
        { key: 'chatId', label: 'Channel ID', placeholder: ts.channelFieldDiscordChannelId },
      ],
    },
    weixin: {
      label: ts.channelTypeWeixin,
      fields: [
        { key: 'appId', label: 'App ID', placeholder: ts.channelFieldWeixinAppId, required: true },
        { key: 'appSecret', label: 'App Secret', placeholder: ts.channelFieldAppSecret, required: true },
        { key: 'token', label: 'Token', placeholder: ts.channelFieldWeixinToken },
      ],
    },
    qq: {
      label: ts.channelTypeQQ,
      fields: [
        { key: 'appId', label: 'App ID', placeholder: ts.channelFieldQQAppId, required: true },
        { key: 'appSecret', label: 'App Secret', placeholder: 'App Secret', required: true },
      ],
    },
    telegram: {
      label: ts.channelTypeTelegram,
      fields: [
        { key: 'botToken', label: 'Bot Token', placeholder: 'Telegram Bot Token', required: true },
        { key: 'chatId', label: 'Chat ID', placeholder: ts.channelFieldTelegramChatId },
      ],
    },
  };
}

function ChannelsPane() {
  const channelFacts = useChannelReadonly();
  const channels: ChannelConfig[] = channelFacts.data ?? [];
  const loading = channelFacts.reading && channelFacts.data === null;
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState('yunzhijia');
  const [newName, setNewName] = useState('');
  const [newFields, setNewFields] = useState<Record<string, string>>({});
  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { t } = useLocale();
  const ts = t.desktopSettings;
  const channelTypeConfig = getChannelTypeConfig(ts);

  const load = channelFacts.refresh;

  // Reset fields when type changes
  useEffect(() => {
    setNewFields({});
  }, [newType]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const typeConfig = channelTypeConfig[newType];
    // Check required fields
    for (const field of typeConfig.fields) {
      if (field.required && !newFields[field.key]?.trim()) {
        alert(ts.channelsFieldRequired(field.label));
        return;
      }
    }
    try {
      await api.createChannel({
        type: newType,
        name: newName.trim(),
        ...newFields,
      });
      setNewName('');
      setNewFields({});
      setShowAdd(false);
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(ts.channelsDeleteConfirm)) return;
    try {
      await api.deleteChannel(id);
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleToggle = async (channel: ChannelConfig) => {
    try {
      await api.updateChannel(channel.id, { enabled: !channel.enabled });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--c-text-secondary)]" />
      </div>
    );
  }

  return (
    <>
      {channelFacts.failed && <p role="alert">{t.channelReadonlyUnavailable}</p>}
      <button type="button" onClick={load}>{t.desktopReadonlyRetry}</button>
      <Section>
        <SectionHeader icon={Globe}>{channelFacts.data === null ? t.channelReadonlyUnknown : ts.channelsTitle}</SectionHeader>
        {/* Status messages */}
        {success && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">
            <Check size={16} />
            {success}
            <button type="button" onClick={() => setSuccess('')} className="ml-auto text-green-600 hover:text-green-700">
              <X size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertCircle size={16} />
            {error}
            <button type="button" onClick={() => setError('')} className="ml-auto text-red-600 hover:text-red-700">
              <X size={14} />
            </button>
          </div>
        )}
        <p className="text-xs text-[var(--c-text-secondary)] mb-4">
          {ts.channelsDesc}
        </p>

        {/* Add button */}
        <button type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-2 mb-4 rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
        >
          <Plus size={16} />
          {ts.channelsAdd}
        </button>

        {/* Add form */}
        {showAdd && (
          <Card className="mb-4">
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="desktop-channel-name" className="block text-xs text-[var(--c-text-secondary)] mb-1">{ts.channelsNameLabel}</label>
                <input
                  id="desktop-channel-name"
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={ts.channelsNamePlaceholder}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="desktop-channel-type" className="block text-xs text-[var(--c-text-secondary)] mb-1">{ts.channelsTypeLabel}</label>
                <select
                  id="desktop-channel-type"
                  value={newType}
                  onChange={e => setNewType(e.target.value)}
                  className={inputCls}
                >
                  {Object.entries(channelTypeConfig).map(([type, cfg]) => (
                    <option key={type} value={type}>{cfg.label}</option>
                  ))}
                </select>
              </div>
              {/* Type-specific fields */}
              {channelTypeConfig[newType].fields.map(field => (
                <div key={field.key}>
                  <label htmlFor={`desktop-channel-field-${field.key}`} className="block text-xs text-[var(--c-text-secondary)] mb-1">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  <input aria-label={field.placeholder}
                    id={`desktop-channel-field-${field.key}`}
                    type="text"
                    value={newFields[field.key] || ''}
                    onChange={e => setNewFields(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className={inputCls}
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <button type="button" onClick={handleCreate} className={btnPrimary}>{ts.channelsCreateBtn}</button>
                <button type="button" onClick={() => setShowAdd(false)} className={btnSecondary}>{ts.channelsCancelBtn}</button>
              </div>
            </div>
          </Card>
        )}

        {/* Channel list */}
        <div className="flex flex-col gap-2">
          {channelFacts.data === null ? <p>{t.channelReadonlyUnknown}</p> : channels.length === 0 ? (
            <Card>
              <div className="flex items-center gap-3 text-sm text-[var(--c-text-secondary)]">
                <Info size={16} />
                {ts.channelsEmpty}
              </div>
            </Card>
          ) : (
            channels.map(ch => (
              <Card key={ch.id}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`size-2 rounded-full ${ch.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div>
                      <div className="text-sm font-medium">{ch.name}</div>
                      <div className="text-xs text-[var(--c-text-secondary)]">
                        {channelTypeConfig[ch.type]?.label || ch.type} · {ts.channelsCreatedAt} {new Date(ch.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button"
                      onClick={async () => {
                        setTestingChannel(ch.id);
                        try {
                          const result = await api.testChannel(ch.id);
                          if (result.success) {
                            setSuccess(ts.channelsTestSuccess(result.latencyMs ?? 0));
                          } else {
                            setError(result.error || ts.channelsTestFailed);
                          }
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setTestingChannel(null);
                        }
                      }}
                      disabled={testingChannel === ch.id}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors disabled:opacity-50"
                    >
                      {testingChannel === ch.id ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                      {ts.channelsTestBtn}
                    </button>
                    <button type="button"
                      onClick={() => handleToggle(ch)}
                      className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                        ch.enabled ? 'bg-green-50 text-green-600' : 'bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]'
                      }`}
                    >
                      {ch.enabled ? ts.channelsEnabled : ts.channelsDisabled}
                    </button>
                    <button type="button"
                      onClick={() => handleDelete(ch.id)}
                      className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </Section>
    </>
  );
}

// ---- MCP ----

interface MCPInstallConfig {
  id: string;
  name: string;
  source: string;
  command: string;
  args?: string[];
  enabled: boolean;
  createdAt: number;
}

type PluginDependencyStatus = PluginDependencyStatusDto;

function McpPane() {
  const { t, locale } = useLocale();
  const ts = t.desktopSettings;
  const [installs, setInstalls] = useState<MCPInstallConfig[]>([]);
  const [pluginServers, setPluginServers] = useState<PluginMcpServerDto[]>([]);
  const [dependencies, setDependencies] = useState<PluginDependencyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [dependencyAction, setDependencyAction] = useState('');

  const [installsReady, setInstallsReady] = useState(false), [installsUnavailable, setInstallsUnavailable] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const readGeneration = useRef(0), pendingRead = useRef<number | null>(null), manualReread = useRef(false);
  const load = useCallback((queueIfBusy = true) => {
    if (pendingRead.current !== null) { if (queueIfBusy) manualReread.current = true; return; }
    const generation = ++readGeneration.current;
    pendingRead.current = generation;
    Promise.allSettled([
      (async () => { const raw = await api.listMCPInstalls(); const parsed = MCP_INSTALLS_READONLY_OUTPUT_SCHEMA.safeParse(raw); if (!parsed.success) throw Error('channel_mcp_projection_unavailable'); return parsed.data; })(),
      api.listPluginMcpServers(),
      api.listPluginDependencyStatuses(),
    ]).then(([mcpInstalls, plugins, dependencyStatuses]) => {
      if (generation !== readGeneration.current) return;
      if (mcpInstalls.status === 'fulfilled') { setInstalls(mcpInstalls.value); setInstallsReady(true); }
      setInstallsUnavailable(mcpInstalls.status === 'rejected');
      if (plugins.status === 'fulfilled') setPluginServers(plugins.value);
      if (dependencyStatuses.status === 'fulfilled') setDependencies(dependencyStatuses.value);
      setCatalogUnavailable(plugins.status === 'rejected' || dependencyStatuses.status === 'rejected');
    }).finally(() => {
      if (pendingRead.current === generation) {
        pendingRead.current = null; setLoading(false);
        if (manualReread.current) { manualReread.current = false; load(); }
      }
    });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(false), 2_000);
    return () => { clearInterval(timer); readGeneration.current += 1; pendingRead.current = null; manualReread.current = false; };
  }, [load, locale]);

  const handleCreate = async () => {
    if (!newName.trim() || !newCommand.trim()) return;
    try {
      await api.createMCPInstall({
        name: newName.trim(),
        source: 'npm',
        command: newCommand.trim(),
        args: newArgs.trim() ? newArgs.trim().split(/\s+/) : undefined,
      });
      setNewName('');
      setNewCommand('');
      setNewArgs('');
      setShowAdd(false);
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteMCPInstall(id);
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleInstallDependency = async (dependency: PluginDependencyStatus) => {
    if (!dependency.canInstall) return;
    const confirmed = window.confirm(ts.mcpInstallConfirm(dependency.displayName));
    if (!confirmed) return;
    const actionKey = `${dependency.pluginName}:${dependency.dependencyId}:install`;
    setDependencyAction(actionKey);
    try {
      const result = await api.installPluginDependency({
        pluginName: dependency.pluginName,
        dependencyId: dependency.dependencyId,
        confirmed: true,
      });
      if (!result.success) alert(result.error || ts.mcpInstallFailed);
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDependencyAction('');
    }
  };

  const handleSetupPluginDependency = async (dependency: PluginDependencyStatus) => {
    if (!dependency.canInstall) return;
    const confirmed = window.confirm(ts.mcpSetupConfirm(formatPluginDependencyTitle(dependency), dependency.displayName));
    if (!confirmed) return;
    const actionKey = `${dependency.pluginName}:${dependency.dependencyId}:setup`;
    setDependencyAction(actionKey);
    try {
      const pluginResult = await api.installPlugin(dependency.pluginName);
      if (!pluginResult.success) {
        alert(pluginResult.error || ts.mcpPluginInstallFailed);
        return;
      }
      const result = await api.installPluginDependency({
        pluginName: dependency.pluginName,
        dependencyId: dependency.dependencyId,
        confirmed: true,
      });
      if (!result.success) alert(result.error || ts.mcpInstallFailed);
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDependencyAction('');
    }
  };

  const handleUpdateDependency = async (dependency: PluginDependencyStatus) => {
    if (!dependency.canUpdate) return;
    const confirmed = window.confirm(ts.mcpUpdateConfirm(dependency.displayName));
    if (!confirmed) return;
    const actionKey = `${dependency.pluginName}:${dependency.dependencyId}:update`;
    setDependencyAction(actionKey);
    try {
      const result = await api.updatePluginDependency({
        pluginName: dependency.pluginName,
        dependencyId: dependency.dependencyId,
        confirmed: true,
      });
      if (!result.success) alert(result.error || ts.mcpUpdateFailed);
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDependencyAction('');
    }
  };

  const handleDiagnoseDependency = async (dependency: PluginDependencyStatus) => {
    if (!dependency.canDiagnose) return;
    const actionKey = `${dependency.pluginName}:${dependency.dependencyId}:diagnose`;
    setDependencyAction(actionKey);
    try {
      const result = await api.diagnosePluginDependency({
        pluginName: dependency.pluginName,
        dependencyId: dependency.dependencyId,
      });
      if (!result.success) alert(result.error || ts.mcpDiagnoseFailed);
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDependencyAction('');
    }
  };

  const handleOpenPermissionSettings = async (permission: 'accessibility' | 'screen') => {
    try {
      await api.openPluginDependencyPermissionSettings({ permission });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  // Design v58 §7.2: retry is scoped to one component and never writes desired
  // state, so a disabled CUA cannot be re-enabled by pressing reconnect.
  const handleRetryPluginComponent = async (componentId: string) => {
    const actionKey = 'plugin-mcp:restart';
    setDependencyAction(actionKey);
    try {
      await api.retryPluginComponent({ componentId });
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDependencyAction('');
    }
  };

  const handleEnableComputerUse = async () => {
    const actionKey = 'computer-use:enable';
    setDependencyAction(actionKey);
    try {
      await api.enableComputerUse();
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDependencyAction('');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--c-text-secondary)]" />
      </div>
    );
  }

  return (
    <>
      {installsUnavailable && <p role="alert">{t.mcpInstallsReadonlyUnavailable}</p>}
      <button type="button" onClick={() => load()}>{t.desktopReadonlyRetry}</button>
      {catalogUnavailable && <div role="alert" className="mb-3 text-sm text-red-500">{ts.pluginsCatalogUnavailable}</div>}
      {dependencies.length > 0 && (
        <Section>
          <SectionHeader icon={Package}>{ts.mcpPluginDeps}</SectionHeader>
          <div className="flex flex-col gap-2">
            {dependencies.map(dependency => {
              const pluginInstalled = dependency.pluginInstalled ?? pluginServers.some(server => server.pluginName === dependency.pluginName);
              const dependencyServer = pluginServers.find(server => server.pluginName === dependency.pluginName);
              const statusText = formatPluginDependencyStatus(dependency, dependencyServer, ts);
              const dependencyLayerRows = formatPluginDependencyLayerRows(dependency, pluginInstalled, dependencyServer, ts);
              const isSettingUp = dependencyAction === `${dependency.pluginName}:${dependency.dependencyId}:setup`;
              const isInstalling = dependencyAction === `${dependency.pluginName}:${dependency.dependencyId}:install`;
              const isUpdating = dependencyAction === `${dependency.pluginName}:${dependency.dependencyId}:update`;
              const isDiagnosing = dependencyAction === `${dependency.pluginName}:${dependency.dependencyId}:diagnose`;
              const isRestartingMcp = dependencyAction === 'plugin-mcp:restart';
              const isEnablingComputerUse = dependencyAction === 'computer-use:enable';
              const canReconnectMcp = dependency.state === 'ready' && Boolean(dependencyServer) && dependencyServer?.connected === false;
              const isComputerUse = dependency.pluginName === 'cua-computer-use';
              return (
                <Card key={`${dependency.pluginName}:${dependency.dependencyId}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{formatPluginDependencyTitle(dependency)}</span>
                        <span className={`rounded px-2 py-0.5 text-xs ${pluginDependencyBadgeClass(dependency.state)}`}>
                          {statusText}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--c-text-secondary)]">
                        {dependency.displayName}
                        {dependency.version ? ` · ${dependency.version}` : ''}
                        {dependency.resolvedBinary ? ` · ${dependency.resolvedBinary}` : ''}
                      </div>
                      {dependency.detail && dependency.state !== 'ready' && (
                        <div className="mt-1 line-clamp-2 text-xs text-[var(--c-text-tertiary)]">
                          {dependency.detail}
                        </div>
                      )}
                      <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-[var(--c-text-secondary)] sm:grid-cols-2">
                        {dependencyLayerRows.map(row => (
                          <div key={row.label} className="min-w-0 truncate">
                            {row.label}：{row.value}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {dependency.task && (
                        <button type="button" disabled={dependency.task.state === 'cancelling'}
                          onClick={() => void api.cancelPluginDependencyTask({ pluginName: dependency.pluginName, dependencyId: dependency.dependencyId }).then(() => load()).catch(error => alert(error instanceof Error ? error.message : String(error)))}
                          className="rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs disabled:opacity-50">
                          {dependency.task.state === 'cancelling' ? ts.mcpCancellingTask : ts.mcpCancelTask}
                        </button>
                      )}
                      {dependency.code === 'permission_accessibility_missing' && (
                        <button
                          type="button"
                          onClick={() => void handleOpenPermissionSettings('accessibility')}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                        >
                          <Settings size={12} />
                          {ts.mcpOpenAccessibility}
                        </button>
                      )}
                      {dependency.code === 'permission_screen_missing' && (
                        <button
                          type="button"
                          onClick={() => void handleOpenPermissionSettings('screen')}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                        >
                          <Settings size={12} />
                          {ts.mcpOpenScreenRecording}
                        </button>
                      )}
                      {canReconnectMcp && (
                        <button
                          type="button"
                          disabled={isComputerUse ? isEnablingComputerUse : isRestartingMcp}
                          onClick={() => void (isComputerUse ? handleEnableComputerUse() : handleRetryPluginComponent(dependencyServer?.name ?? ''))}
                          className="inline-flex items-center gap-1 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                        >
                          {(isComputerUse ? isEnablingComputerUse : isRestartingMcp) ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          {isComputerUse ? ts.mcpEnableComputerUse : (dependencyServer?.enabled === false ? ts.mcpConnectMcp : ts.mcpReconnectMcp)}
                        </button>
                      )}
                      {dependency.canInstall && dependency.state === 'missing' && !pluginInstalled && (
                        <button
                          type="button"
                          disabled={isSettingUp}
                          onClick={() => void handleSetupPluginDependency(dependency)}
                          className="inline-flex items-center gap-1 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                        >
                          {isSettingUp ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
                          {ts.mcpInstallAndEnable}
                        </button>
                      )}
                      {dependency.canInstall && dependency.state === 'missing' && pluginInstalled && (
                        <button
                          type="button"
                          disabled={isInstalling}
                          onClick={() => void handleInstallDependency(dependency)}
                          className="inline-flex items-center gap-1 rounded-md bg-[var(--c-accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                        >
                          {isInstalling ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
                          {ts.mcpInstallDriver}
                        </button>
                      )}
                      {dependency.canUpdate && dependency.state !== 'missing' && (
                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => void handleUpdateDependency(dependency)}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50"
                        >
                          {isUpdating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          {ts.mcpUpdate}
                        </button>
                      )}
                      {dependency.canDiagnose && (
                        <button
                          type="button"
                          disabled={isDiagnosing}
                          onClick={() => void handleDiagnoseDependency(dependency)}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] disabled:opacity-50"
                        >
                          {isDiagnosing ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
                          {ts.mcpDiagnose}
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>
      )}

      {pluginServers.length > 0 && (
        <Section>
          <SectionHeader icon={Plug}>{ts.mcpPluginMcpServices}</SectionHeader>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            {ts.mcpPluginMcpServicesDesc}
          </p>
          <div className="flex flex-col gap-2">
            {pluginServers.map(server => (
              <Card key={server.name}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`size-2 rounded-full ${server.connected ? 'bg-green-500' : server.enabled ? 'bg-yellow-500' : 'bg-gray-300'}`} />
                    <div>
                      <div className="text-sm font-medium">{server.name}</div>
                      <div className="text-xs text-[var(--c-text-secondary)]">
                        {server.pluginName} · {server.toolCount} tools
                      </div>
                      {!server.connected && server.lastError && !server.lastErrorDetail?.category && (
                        <div className="mt-1 max-w-[420px] truncate text-xs text-[var(--c-text-tertiary)]">
                          {server.lastError}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${server.connected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {server.connected ? ts.mcpConnected : ts.mcpDisconnected}
                  </span>
                </div>
                {!server.connected && server.lastErrorDetail?.category && (
                  <McpErrorRemediationBanner detail={server.lastErrorDetail} serverName={server.name} />
                )}
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section>
        <SectionHeader icon={Plug}>{ts.mcpServersTitle}</SectionHeader>
        <p className="text-xs text-[var(--c-text-secondary)] mb-4">
          {ts.mcpServersDesc}
        </p>

        <button type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-2 mb-4 rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
        >
          <Plus size={16} />
          {ts.mcpAddServer}
        </button>

        {showAdd && (
          <Card className="mb-4">
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="desktop-mcp-server-name" className="block text-xs text-[var(--c-text-secondary)] mb-1">{ts.mcpNameLabel}</label>
                <input
                  id="desktop-mcp-server-name"
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={ts.mcpNamePlaceholder}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="desktop-mcp-server-command" className="block text-xs text-[var(--c-text-secondary)] mb-1">{ts.mcpCommandLabel}</label>
                <input
                  id="desktop-mcp-server-command"
                  type="text"
                  value={newCommand}
                  onChange={e => setNewCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="desktop-mcp-server-args" className="block text-xs text-[var(--c-text-secondary)] mb-1">{ts.mcpArgsLabel}</label>
                <input
                  id="desktop-mcp-server-args"
                  type="text"
                  value={newArgs}
                  onChange={e => setNewArgs(e.target.value)}
                  placeholder="/path/to/allow"
                  className={inputCls}
                />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleCreate} className={btnPrimary}>{ts.mcpCreateBtn}</button>
                <button type="button" onClick={() => setShowAdd(false)} className={btnSecondary}>{ts.mcpCancelBtn}</button>
              </div>
            </div>
          </Card>
        )}

        <div className="flex flex-col gap-2">
          {!installsReady ? <Card>{t.mcpInstallsReadonlyUnknown}</Card> : installs.length === 0 ? (
            <Card>
              <div className="flex items-center gap-3 text-sm text-[var(--c-text-secondary)]">
                <Info size={16} />
                {ts.mcpEmpty}
              </div>
            </Card>
          ) : (
            installs.map(install => (
              <Card key={install.id}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`size-2 rounded-full ${install.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div>
                      <div className="text-sm font-medium">{install.name}</div>
                      <code className="text-xs text-[var(--c-text-secondary)] font-mono">
                        {install.command}{install.args?.length ? ` ${install.args.join(' ')}` : ''}
                      </code>
                      <div className="text-xs text-[var(--c-text-tertiary)]">
                        {ts.mcpSourceLabel} {install.source} · {ts.mcpCreatedAtLabel} {new Date(install.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <button type="button"
                    onClick={() => handleDelete(install.id)}
                    className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </Card>
            ))
          )}
        </div>
      </Section>
    </>
  );
}

function formatPluginDependencyTitle(dependency: PluginDependencyStatus): string {
  if (dependency.pluginName === 'cua-computer-use') return 'Computer Use for Mac';
  return dependency.pluginName;
}

function formatPluginDependencyStatus(
  dependency: PluginDependencyStatus,
  server: { connected: boolean; toolCount: number } | undefined,
  ts: LocaleStrings['desktopSettings'],
): string {
  if (dependency.code === 'binary_missing') return ts.mcpDepNeedsInstall(dependency.displayName);
  if (dependency.code === 'permission_accessibility_missing') return ts.mcpDepNeedsAccessibility;
  if (dependency.code === 'permission_screen_missing') return ts.mcpDepNeedsScreenRecording;
  if (dependency.code === 'version_too_old') return ts.mcpDepNeedsUpdate;
  if (dependency.pluginName === 'cua-computer-use' && dependency.state === 'ready' && server?.connected === false) return ts.mcpDepNotEnabled;
  if (dependency.state === 'ready') return ts.mcpDepAvailable;
  if (dependency.state === 'unsupported') return ts.mcpDepUnsupported;
  return ts.mcpDepNeedsAttention;
}

function formatPluginDependencyLayerRows(
  dependency: PluginDependencyStatus,
  pluginInstalled: boolean,
  server: { connected: boolean; toolCount: number } | undefined,
  ts: LocaleStrings['desktopSettings'],
): Array<{ label: string; value: string }> {
  return [
    { label: ts.mcpLayerPlugin, value: pluginInstalled ? ts.mcpLayerInstalled : ts.mcpLayerNotInstalled },
    { label: dependency.displayName, value: formatDriverLayerStatus(dependency, ts) },
    { label: ts.mcpLayerPermission, value: formatPermissionLayerStatus(dependency, server, ts) },
    { label: dependency.pluginName === 'cua-computer-use' ? ts.mcpLayerServiceConn : 'MCP', value: formatMcpLayerStatus(dependency, server, ts) },
    { label: ts.mcpLayerTools, value: formatToolLayerStatus(dependency, server, ts) },
  ];
}

function formatDriverLayerStatus(dependency: PluginDependencyStatus, ts: LocaleStrings['desktopSettings']): string {
  if (dependency.state === 'unsupported') return ts.mcpDriverUnsupported;
  if (dependency.code === 'binary_missing') return ts.mcpDriverNotInstalled;
  if (dependency.code === 'version_too_old') return dependency.version ? `${dependency.version}，${ts.mcpDriverNeedsUpdate}` : ts.mcpDriverNeedsUpdate;
  if (dependency.state === 'ready') return dependency.version || ts.mcpLayerInstalled;
  if (dependency.resolvedBinary) return ts.mcpDriverInstalledUnavailable;
  return ts.mcpDriverUnconfirmed;
}

function formatPermissionLayerStatus(
  dependency: PluginDependencyStatus,
  server: { connected: boolean; toolCount: number } | undefined,
  ts: LocaleStrings['desktopSettings'],
): string {
  if (dependency.code === 'permission_accessibility_missing') return ts.mcpPermAccessibilityMissing;
  if (dependency.code === 'permission_screen_missing') return ts.mcpPermScreenMissing;
  if (dependency.pluginName === 'cua-computer-use' && dependency.state === 'ready' && server?.connected === false) return ts.mcpPermVerifyAfterEnable;
  if (dependency.state === 'ready') return ts.mcpPermGranted;
  if (dependency.state === 'missing' || dependency.state === 'unsupported') return ts.mcpPermNotChecked;
  return ts.mcpPermUnconfirmed;
}

function formatMcpLayerStatus(
  dependency: PluginDependencyStatus,
  server: { connected: boolean; toolCount: number } | undefined,
  ts: LocaleStrings['desktopSettings'],
): string {
  if (!dependency.pluginInstalled && dependency.state === 'missing') return ts.mcpLayerNotInstalled;
  if (!server) return ts.mcpLayerNotRegistered;
  return server.connected ? ts.mcpConnected : ts.mcpDisconnected;
}

function formatToolLayerStatus(
  dependency: PluginDependencyStatus,
  server: { connected: boolean; toolCount: number } | undefined,
  ts: LocaleStrings['desktopSettings'],
): string {
  if (dependency.state !== 'ready') return ts.mcpToolUnavailable;
  if (!server) return ts.mcpToolWaitRegister;
  if (!server.connected) return dependency.pluginName === 'cua-computer-use' ? ts.mcpToolWaitEnable : ts.mcpToolMcpDisconnected;
  if (dependency.pluginName === 'cua-computer-use' && server.toolCount === 1) return ts.mcpToolWrapperRegistered;
  if (dependency.pluginName === 'cua-computer-use') return ts.mcpToolRawNotHidden;
  return `${server.toolCount} tools`;
}

function pluginDependencyBadgeClass(state: PluginDependencyStatus['state']): string {
  if (state === 'ready') return 'bg-green-100 text-green-700';
  if (state === 'missing' || state === 'needs_permission') return 'bg-yellow-100 text-yellow-700';
  if (state === 'unsupported') return 'bg-gray-100 text-gray-600';
  return 'bg-red-100 text-red-700';
}

function getOpenLoopAnomalyCount(anomalies: EvidenceAnomalyView[]): number {
  return getOpenLoopAnomalies(anomalies).length;
}

function getLoopRunStatusLabel(status: LoopRunView['status']): string {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  return 'running';
}

function formatLoopRunTime(run: LoopRunView): string {
  const ts = run.finishedAt ?? run.updatedAt ?? run.startedAt;
  return new Date(ts).toLocaleString();
}

function createUserLoopId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `user-loop-${randomId ?? Date.now().toString(36)}`;
}

// ---- Loops ----

export function LoopsPane({ sections = 'all' }: { sections?: 'all' | 'user' | 'diagnostics' }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const locationHash = location.hash;
  const toast = useToast() as {
    addToast?: (message: string, type?: 'success' | 'error') => void;
    show?: (message: string, type?: 'success' | 'error') => void;
  };
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    if (toast.addToast) toast.addToast(message, type);
    else toast.show?.(message, type);
  }, [toast]);
  const [loopDefinitions, setLoopDefinitions] = useState<LoopDefinitionView[]>([]);
  const [userLoopTemplates, setUserLoopTemplates] = useState<UserLoopTemplateView[]>([]);
  const [loopScheduleBindings, setLoopScheduleBindings] = useState<Record<string, LoopScheduleBindingView>>({});
  const [loopRuns, setLoopRuns] = useState<Record<string, LoopRunView[]>>({});
  const [loopAnomalies, setLoopAnomalies] = useState<Record<string, EvidenceAnomalyView[]>>({});
  const [loopRunResults, setLoopRunResults] = useState<Record<string, RunLoopNowResultView | undefined>>({});
  const [loopDiagnosticsLoading, setLoopDiagnosticsLoading] = useState(true);
  const [loopDiagnosticsError, setLoopDiagnosticsError] = useState('');
  const [scheduledBindingsError, setScheduledBindingsError] = useState('');
  const [runningLoopId, setRunningLoopId] = useState<string | null>(null);
  const [loopOutputPreviews, setLoopOutputPreviews] = useState<Record<string, LoopOutputPreviewView | undefined>>({});
  const [loopTaskResults, setLoopTaskResults] = useState<Record<string, LoopTaskResultView | undefined>>({});
  const [previewingLoopId, setPreviewingLoopId] = useState<string | null>(null);
  const [viewingTaskResultLoopId, setViewingTaskResultLoopId] = useState<string | null>(null);
  const [showCreateLoop, setShowCreateLoop] = useState(false);
  const [creatingLoop, setCreatingLoop] = useState(false);
  const [createLoopError, setCreateLoopError] = useState('');
  const [newLoopTitle, setNewLoopTitle] = useState('');
  const [newLoopKind, setNewLoopKind] = useState<'markdown_file' | 'task_completion'>('task_completion');
  const [newLoopPrompt, setNewLoopPrompt] = useState('');
  const [newLoopOutputDirectory, setNewLoopOutputDirectory] = useState('');
  const [newLoopOutputFileName, setNewLoopOutputFileName] = useState('');
  const [editingLoopId, setEditingLoopId] = useState<string | null>(null);
  const [editLoopTitle, setEditLoopTitle] = useState('');
  const [editLoopPrompt, setEditLoopPrompt] = useState('');
  const [editLoopDesc, setEditLoopDesc] = useState('');
  const [editLoopOutputDir, setEditLoopOutputDir] = useState('');
  const [editLoopOutputFile, setEditLoopOutputFile] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const loopLoadGeneration=useRef(0),previewGeneration=useRef(0),taskResultGeneration=useRef(0);
  useEffect(()=>()=>{loopLoadGeneration.current++;previewGeneration.current++;taskResultGeneration.current++;},[]);
  const observationLabel=(run:LoopRunView)=>loopObservationLabel(run,{pending:t.desktopSettings.loopDiagnosticsPublicationPending,verified:at=>t.desktopSettings.loopDiagnosticsVerifiedAt(new Date(at).toLocaleString()),status:getLoopRunStatusLabel});
  const loadLoops = useCallback(async (silent = false) => {
    const generation=++loopLoadGeneration.current;
    previewGeneration.current++;taskResultGeneration.current++;setLoopOutputPreviews({});setLoopTaskResults({});setPreviewingLoopId(null);setViewingTaskResultLoopId(null);
    setLoopRuns(invalidateLoopObservations);
    setLoopRunResults(previous=>Object.fromEntries(Object.entries(previous).filter(([,result])=>result?.status!=='success'&&result?.status!=='already_completed')));

    if (!silent) setLoopDiagnosticsLoading(true);
    setLoopDiagnosticsError('');
    try {
      const [definitions, templates, scheduleBindings] = await Promise.all([
        api.getLoopDefinitions(),
        api.listUserLoopTemplates(),
        api.getLoopScheduleBindings(),
      ]);
      const details = await Promise.all(definitions.map(async (loop) => {
        const [runs, anomalies] = await Promise.all([
          api.getLoopRuns(loop.id),
          api.getEvidenceAnomalies(loop.id).catch(error => {
            if (loopManagementFailureKind(error) === 'unavailable') throw error;
            return [] as EvidenceAnomalyView[];
          }),
        ]);
        return { loop, runs, anomalies };
      }));
      if(generation!==loopLoadGeneration.current)return;
      setLoopDefinitions(definitions);
      setUserLoopTemplates(templates);
      setLoopScheduleBindings(Object.fromEntries(scheduleBindings.map(binding => [binding.loopId, binding])));
      setScheduledBindingsError('');
      setLoopRuns(Object.fromEntries(details.map(item => [item.loop.id, item.runs])));
      setLoopAnomalies(Object.fromEntries(details.map(item => [item.loop.id, item.anomalies])));
      setLoopRunResults(prev => {
        const next = { ...prev };
        for (const loop of definitions) {
          if (!loop.activeRunId && next[loop.id]?.status === 'already_running') {
            delete next[loop.id];
          }
        }
        return next;
      });
    } catch (error) {
      if(generation!==loopLoadGeneration.current)return;
      setLoopRuns(invalidateLoopObservations);
      const scheduledFailure = error instanceof Error && /scheduled_(projection_unavailable|runtime_unavailable|input_invalid)/.test(error.message);
      if (scheduledFailure) setScheduledBindingsError(scheduledErrorMessage(error,t,true));
      setLoopDiagnosticsError(scheduledFailure ? scheduledErrorMessage(error,t,true) : loopManagementErrorMessage(error, t, t.desktopSettings.loopDiagnosticsLoadError));
    } finally {
      if (generation===loopLoadGeneration.current) setLoopDiagnosticsLoading(false);
    }
  }, [t.desktopSettings.loopDiagnosticsLoadError, t.loopOperationResultUnknown, t.loopProjectionUnavailable, t.loopInputInvalid, t.scheduledProjectionUnavailable, t.scheduledOperationUnknown, t.scheduledInputInvalid]);

  useEffect(() => {
    void loadLoops();
  }, [loadLoops]);

  useEffect(() => {
    if (loopDiagnosticsLoading) return;
    const targetId = automationFocusTargetId(locationHash, 'loop');
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px solid var(--c-accent)';
      el.style.outlineOffset = '2px';
      const timer = setTimeout(() => {
        el.style.outline = '';
        el.style.outlineOffset = '';
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [locationHash, loopDiagnosticsLoading]);

  const handleRunLoopNow = async (loopId: string) => {
    if (runningLoopId) return;
    setRunningLoopId(loopId);
    setLoopDiagnosticsError('');
    try {
      const result = await api.runLoopNow(loopId);
      setLoopRunResults(prev => ({ ...prev, [loopId]: result }));
      if (result.status !== 'already_running') {
        await loadLoops(true);
      }
    } catch (error) {
      setLoopDiagnosticsError(loopManagementErrorMessage(error, t, t.desktopSettings.loopDiagnosticsRunFailed));
    } finally {
      setRunningLoopId(null);
    }
  };

  const handleOpenLoopOutputDirectory = async (loopId: string) => {
    try {
      const result = await api.openLoopOutputDirectory(loopId);
      if (!result.ok) {
        showToast(result.message || result.error);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t.desktopSettings.userLoopOutputPreviewUnavailable);
    }
  };

  const handlePreviewLoopOutput = async (loopId: string) => {
    const generation=++previewGeneration.current;setLoopOutputPreviews(previous=>({...previous,[loopId]:undefined}));
    setPreviewingLoopId(loopId);
    try {
      const result = await api.readLoopOutputPreview(loopId);
      if(generation!==previewGeneration.current)return;
      setLoopOutputPreviews(prev => ({ ...prev, [loopId]: result }));
      if (!result.ok) {
        showToast(result.message || t.desktopSettings.userLoopOutputPreviewUnavailable);
      }
    } catch (error) {
      if(generation!==previewGeneration.current)return;
      showToast(error instanceof Error ? error.message : t.desktopSettings.userLoopOutputPreviewUnavailable);
    } finally {
      if(generation===previewGeneration.current)setPreviewingLoopId(null);
    }
  };

  const handleViewLoopTaskResult = async (loopId: string) => {
    const generation=++taskResultGeneration.current;setLoopTaskResults(previous=>({...previous,[loopId]:undefined}));
    setViewingTaskResultLoopId(loopId);
    try {
      const result = await api.readLoopTaskResult(loopId);
      if(generation!==taskResultGeneration.current)return;
      setLoopTaskResults(prev => ({ ...prev, [loopId]: result }));
      if (!result.ok) {
        showToast(result.message || t.desktopSettings.userLoopTaskResultUnavailable);
      }
    } catch (error) {
      if(generation!==taskResultGeneration.current)return;
      showToast(error instanceof Error ? error.message : t.desktopSettings.userLoopTaskResultUnavailable);
    } finally {
      if(generation===taskResultGeneration.current)setViewingTaskResultLoopId(null);
    }
  };

  const handleEditLoop = (template: UserLoopTemplateView, definition?: LoopDefinitionView) => {
    setEditingLoopId(template.loopId);
    setEditLoopTitle(definition?.title ?? '');
    setEditLoopDesc(definition?.description ?? '');
    setEditLoopPrompt(template.prompt ?? '');
    setEditLoopOutputDir(template.outputDirectory ?? '');
    setEditLoopOutputFile(template.outputFileName ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editingLoopId || !editLoopTitle.trim()) return;
    setSavingEdit(true);
    try {
      console.log('[LoopsPane] saving edit', { loopId: editingLoopId, title: editLoopTitle.trim() });
      await api.updateUserLoopTemplate(editingLoopId, {
        title: editLoopTitle.trim(),
        description: editLoopDesc.trim(),
        prompt: editLoopPrompt.trim(),
        outputDirectory: editLoopOutputDir.trim() || undefined,
        outputFileName: editLoopOutputFile.trim() || undefined,
      });
      console.log('[LoopsPane] save edit ok', { loopId: editingLoopId });
      setEditingLoopId(null);
      await loadLoops(true);
    } catch (error) {
      console.error('[LoopsPane] save edit failed', error);
      showToast(loopManagementErrorMessage(error, t, t.desktopSettings.saveLoopFailed));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteLoop = async (loopId: string) => {
    if (!confirm(t.desktopSettings.deleteLoopConfirm)) return;
    try {
      console.log('[LoopsPane] deleting loop', { loopId });
      await api.deleteUserLoopTemplate(loopId);
      console.log('[LoopsPane] delete loop ok', { loopId });
      await loadLoops(true);
    } catch (error) {
      console.error('[LoopsPane] delete loop failed', error);
      showToast(loopManagementErrorMessage(error, t, t.desktopSettings.deleteLoopFailed));
    }
  };

  const handleCopyLoopDiagnostics = async (
    loop: LoopDefinitionView,
    runs: LoopRunView[],
    anomalies: EvidenceAnomalyView[],
  ) => {
    try {
      const summary = buildLoopDiagnosticsSummary({ loop, runs, anomalies, observationLabel,labels:t.desktopSettings.loopDiagnosticsCopyLabels });
      await navigator.clipboard.writeText(summary);
      showToast(t.desktopSettings.loopDiagnosticsCopied, 'success');
    } catch {
      showToast(t.desktopSettings.loopDiagnosticsCopyFailed, 'error');
    }
  };

  const handleOpenLoopSchedules = (loopId: string) => {
    navigate(`/automations/schedules?loopId=${encodeURIComponent(loopId)}`);
  };

  const resetCreateForm = () => {
    setNewLoopTitle('');
    setNewLoopKind('task_completion');
    setNewLoopPrompt('');
    setNewLoopOutputDirectory('');
    setNewLoopOutputFileName('');
    setCreateLoopError('');
  };

  const handleCreateUserLoop = async () => {
    const input = {
      loopId: createUserLoopId(),
      title: newLoopTitle.trim(),
      kind: newLoopKind,
      prompt: newLoopPrompt.trim(),
      ...(newLoopKind === 'markdown_file' ? {
        outputDirectory: newLoopOutputDirectory.trim(),
        outputFileName: newLoopOutputFileName.trim(),
      } : {}),
    } as CreateUserLoopTemplateInputView;
    if (!input.title || !input.prompt) {
      setCreateLoopError(t.desktopSettings.userLoopCreateMissingFields);
      return;
    }
    if (newLoopKind === 'markdown_file' && (!newLoopOutputDirectory.trim() || !newLoopOutputFileName.trim())) {
      setCreateLoopError(t.desktopSettings.userLoopCreateMissingFields);
      return;
    }
    setCreatingLoop(true);
    setCreateLoopError('');
    try {
      await api.createUserLoopTemplate(input);
      resetCreateForm();
      setShowCreateLoop(false);
      showToast(t.desktopSettings.userLoopCreateSuccess, 'success');
      await loadLoops(true);
    } catch (error) {
      setCreateLoopError(loopManagementErrorMessage(error, t, t.desktopSettings.userLoopCreateFailed));
    } finally {
      setCreatingLoop(false);
    }
  };

  const handleCreateFromTemplate = async (template: UserLoopStarterTemplate) => {
    const input = {
      loopId: createUserLoopId(),
      title: template.title,
      kind: template.kind,
      prompt: template.prompt,
      ...(template.kind === 'markdown_file' ? {
        outputDirectory: template.outputDirectory ?? '',
        outputFileName: template.outputFileName ?? 'output.md',
      } : {}),
    } as CreateUserLoopTemplateInputView;
    try {
      console.log('[LoopsPane] creating from template', { templateId: template.templateId });
      await api.createUserLoopTemplate(input);
      showToast(t.desktopSettings.createdFromTemplate(template.title), 'success');
      await loadLoops(true);
    } catch (error) {
      console.error('[LoopsPane] create from template failed', error);
      showToast(loopManagementErrorMessage(error, t, t.desktopSettings.createFromTemplateFailed));
    }
  };

  const definitionById = new Map(loopDefinitions.map(loop => [loop.id, loop]));
  const builtInLoops = loopDefinitions.filter(loop => loop.origin !== 'user_template');
  const userLoops = userLoopTemplates.map(template => ({
    template,
    definition: definitionById.get(template.loopId),
  }));
  const showUserLoops = sections === 'all' || sections === 'user';
  const showDiagnostics = sections === 'all' || sections === 'diagnostics';

  return (
    <>
      {showUserLoops && !showDiagnostics && scheduledBindingsError && <div role="alert" className="mb-3 rounded-md border p-3 text-xs text-[var(--c-status-error-text)]"><p>{scheduledBindingsError}</p><button type="button" onClick={()=>void loadLoops()} className="mt-2 rounded-md border px-2 py-1">{t.scheduledRefreshData}</button></div>}
      {showUserLoops && (
      <Section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionHeader icon={RefreshCw}>{t.desktopSettings.userLoops}</SectionHeader>
          <button
            type="button"
            onClick={() => setShowCreateLoop(true)}
            className={`${btnPrimary} inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5`}
          >
            <Plus size={14} />
            {t.desktopSettings.newLoop}
          </button>
        </div>
        <Card>
          <p className="mb-3 text-xs text-[var(--c-text-secondary)]">
            {t.desktopSettings.userLoopsDesc}
          </p>

          {showCreateLoop ? (
            <div className="mb-4 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3">
              <div className="grid gap-3">
                <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                  {t.desktopSettings.userLoopTitleLabel}
                  <input
                    aria-label={t.desktopSettings.userLoopTitleLabel}
                    type="text"
                    value={newLoopTitle}
                    onChange={(event) => setNewLoopTitle(event.target.value)}
                    className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                  />
                </label>
                <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                  {t.desktopSettings.userLoopKindLabel}
                  <select
                    aria-label={t.desktopSettings.userLoopKindLabel}
                    value={newLoopKind}
                    onChange={(event) => setNewLoopKind(event.target.value as 'markdown_file' | 'task_completion')}
                    className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                  >
                    <option value="task_completion">{t.desktopSettings.userLoopKindTaskCompletion}</option>
                    <option value="markdown_file">{t.desktopSettings.userLoopKindMarkdownFile}</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                  {t.desktopSettings.userLoopPromptLabel}
                  <textarea
                    aria-label={t.desktopSettings.userLoopPromptLabel}
                    value={newLoopPrompt}
                    onChange={(event) => setNewLoopPrompt(event.target.value)}
                    rows={3}
                    className="resize-none rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                  />
                </label>
                {newLoopKind === 'markdown_file' ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                    {t.desktopSettings.userLoopOutputDirectoryLabel}
                    <div className="flex gap-1.5">
                      <input
                        aria-label={t.desktopSettings.userLoopOutputDirectoryLabel}
                        type="text"
                        value={newLoopOutputDirectory}
                        onChange={(event) => setNewLoopOutputDirectory(event.target.value)}
                        className="flex-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const result = await window.xiaokDesktop?.selectDirectory();
                            if (result?.filePath) setNewLoopOutputDirectory(result.filePath);
                          } catch { /* user cancel */ }
                        }}
                        className="shrink-0 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                      >
                        {t.desktopSettings.advancedChooseFolder}
                      </button>
                    </div>
                  </label>
                  <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                    {t.desktopSettings.userLoopOutputFileNameLabel}
                    <input
                      aria-label={t.desktopSettings.userLoopOutputFileNameLabel}
                      type="text"
                      value={newLoopOutputFileName}
                      onChange={(event) => setNewLoopOutputFileName(event.target.value)}
                      className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                    />
                  </label>
                </div> : null}
              </div>
              {createLoopError ? (
                <div className="mt-3 rounded-md border border-[var(--c-status-error-text)]/20 bg-[var(--c-status-error-bg,#fef2f2)] px-3 py-2 text-xs text-[var(--c-status-error-text)]">
                  {createLoopError}
                </div>
              ) : null}
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => { resetCreateForm(); setShowCreateLoop(false); }} className={btnSecondary}>
                  {t.desktopSettings.cancel}
                </button>
                <button type="button" onClick={() => void handleCreateUserLoop()} disabled={creatingLoop} className={btnPrimary}>
                  {creatingLoop ? t.desktopSettings.creatingLoop : t.desktopSettings.createLoop}
                </button>
              </div>
            </div>
          ) : null}

          {loopDiagnosticsLoading && userLoops.length === 0 ? (
            <div className="text-xs text-[var(--c-text-secondary)]">
              {t.desktopSettings.userLoopsLoading}
            </div>
          ) : userLoops.length === 0 && !scheduledBindingsError ? (
            <div>
              <p className="text-xs text-[var(--c-text-secondary)] mb-3">
                {t.desktopSettings.userLoopsEmpty}
              </p>
              <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--c-text-muted)] mb-2">
                {t.desktopSettings.quickStartFromTemplate}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {resolveUserLoopStarterTemplates(t).map(template => (
                  <div
                    key={template.templateId}
                    className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-[var(--c-text-heading)]">{template.title}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${template.category === 'business' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                        {template.category === 'business' ? t.desktopSettings.categoryBusiness : t.desktopSettings.categoryCode}
                      </span>
                    </div>
                    <p className="text-xs leading-5 text-[var(--c-text-secondary)] flex-1">{template.description}</p>
                    {template.scheduleHint && (
                      <p className="text-[10px] text-[var(--c-text-tertiary)]">{template.scheduleHint}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleCreateFromTemplate(template)}
                      className={`${btnSecondary} self-start px-3 py-1 text-xs`}
                    >
                      {t.desktopSettings.useThisTemplate}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {userLoops.map(({ template, definition }) => {
                const loopTitle = definition?.title ?? template.loopId;
                const loopStatus = definition?.status ?? 'active';
                const runs = loopRuns[template.loopId] ?? [];
                const latestRun = runs[0];
                const latestRunFailed = latestRun && (latestRun.status === 'failed' || latestRun.status === 'blocked');
                const isRunning = runningLoopId === template.loopId;
                const isPreviewing = previewingLoopId === template.loopId;
                const isViewingTaskResult = viewingTaskResultLoopId === template.loopId;
                const isMarkdownLoop = template.kind === 'markdown_file';
                const outputPreview = loopOutputPreviews[template.loopId];
                const taskResult = loopTaskResults[template.loopId];
                const scheduleBinding = loopScheduleBindings[template.loopId];
                const runResult = loopRunResults[template.loopId];
                const isAlreadyRunning = !!definition?.activeRunId || runResult?.status === 'already_running';
                const buttonLabel = isRunning
                  ? t.desktopSettings.loopDiagnosticsRunning
                  : isAlreadyRunning
                    ? t.desktopSettings.loopDiagnosticsAlreadyRunning
                    : (runResult?.status==='publication_pending'||loopNeedsRevalidation(latestRun))?t.desktopSettings.loopDiagnosticsPublicationPending:t.desktopSettings.loopDiagnosticsRunNow;
                return (
                  <div key={template.loopId} id={`loop-${template.loopId}`} className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 scroll-mt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--c-text-heading)]">{loopTitle}</div>
                        {definition?.description ? (
                          <div className="mt-0.5 text-xs text-[var(--c-text-secondary)]">{definition.description}</div>
                        ) : null}
                        <div className="mt-2 grid gap-1 break-all text-xs text-[var(--c-text-secondary)]">
                          {isMarkdownLoop ? (
                            <>
                              <div>
                                <span className="text-[var(--c-text-tertiary)]">{t.desktopSettings.userLoopOutputDirectoryLabel}: </span>
                                {template.outputDirectory}
                              </div>
                              <div>
                                <span className="text-[var(--c-text-tertiary)]">{t.desktopSettings.userLoopOutputFileNameLabel}: </span>
                                {template.outputFileName}
                              </div>
                            </>
                          ) : null}
                          {scheduleBinding ? (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <span className="rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[11px] text-[var(--c-text-secondary)]">
                                {scheduleBinding.kind === 'multiple'
                                  ? t.desktopSettings.userLoopScheduleMultiple
                                  : t.desktopSettings.userLoopScheduleSingle}
                              </span>
                              <span>
                                {scheduleBinding.count} {t.automationsSchedules}
                              </span>
                              <span>
                                {scheduleBinding.activeCount} {t.desktopSettings.userLoopScheduleActive}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleOpenLoopSchedules(template.loopId)}
                                className="text-[var(--c-accent)] hover:underline"
                              >
                                {t.desktopSettings.userLoopOpenSchedules}
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => navigate(`/automations/schedules?loopId=${encodeURIComponent(template.loopId)}&create=1&name=${encodeURIComponent(loopTitle)}`)}
                                className="text-[var(--c-accent)] hover:underline text-xs"
                              >
                                {t.desktopSettings.createScheduleForLoop}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[11px] text-[var(--c-text-secondary)]">
                        {loopStatus}
                      </span>
                    </div>
                    <LoopPublicationPanel loopId={template.loopId} runs={runs} onChanged={() => void loadLoops(true)} />
                    {latestRun?.status==='success'&&<div className="mt-2 text-xs text-[var(--c-text-secondary)]">{observationLabel(latestRun)}</div>}
                    {latestRunFailed && (
                      <div className="mt-3 rounded-md border border-red-200 bg-red-50/50 px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-red-700">{latestRun.status === 'blocked' ? t.desktopSettings.lastRunBlocked : t.desktopSettings.lastRunFailed}</span>
                          <span className="text-[10px] text-red-600/70">{new Date(latestRun.startedAt).toLocaleString()}</span>
                        </div>
                        {latestRun.message && (
                          <p className="mt-1 leading-5 text-red-700/90 break-words whitespace-pre-wrap">{latestRun.message}</p>
                        )}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      {isMarkdownLoop ? (
                        <>
                          <button
                            type="button"
                            aria-label={`${t.desktopSettings.userLoopOpenOutputDirectory}: ${loopTitle}`}
                            onClick={() => void handleOpenLoopOutputDirectory(template.loopId)}
                            className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                          >
                            <HardDrive size={14} />
                            {t.desktopSettings.userLoopOpenOutputDirectory}
                          </button>
                          <button
                            type="button"
                            aria-label={`${t.desktopSettings.userLoopPreviewOutputFile}: ${loopTitle}`}
                            onClick={() => void handlePreviewLoopOutput(template.loopId)}
                            disabled={isPreviewing}
                            className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                          >
                            <Eye size={14} />
                            {isPreviewing ? t.desktopSettings.loopDiagnosticsRunning : t.desktopSettings.userLoopPreviewOutputFile}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={`${t.desktopSettings.userLoopViewTaskResult}: ${loopTitle}`}
                          onClick={() => void handleViewLoopTaskResult(template.loopId)}
                          disabled={isViewingTaskResult}
                          className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                        >
                          <Eye size={14} />
                          {isViewingTaskResult ? t.desktopSettings.loopDiagnosticsRunning : t.desktopSettings.userLoopViewTaskResult}
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`run-loop-${template.loopId}`}
                        onClick={() => void handleRunLoopNow(template.loopId)}
                        disabled={isRunning || isAlreadyRunning || loopStatus !== 'active'}
                        className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                      >
                        <RefreshCw size={14} className={isRunning ? 'animate-spin' : ''} />
                        {buttonLabel}
                      </button>
                      <button
                        type="button"
                        aria-label={`edit-loop-${template.loopId}`}
                        onClick={() => handleEditLoop(template, definition)}
                        className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                      >
                        <Edit3 size={14} />
                        {t.commonEdit}
                      </button>
                      <button
                        type="button"
                        aria-label={`delete-loop-${template.loopId}`}
                        onClick={() => void handleDeleteLoop(template.loopId)}
                        className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5 text-red-500 hover:text-red-600`}
                      >
                        <Trash2 size={14} />
                        {t.commonDelete}
                      </button>
                    </div>
                    {isMarkdownLoop ? <p className="mt-2 text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.userLoopWorkspaceNavigationHint}</p> : null}
                    <LoopArtifactList loopId={template.loopId} refreshGeneration={loopLoadGeneration.current}/>
                    {outputPreview ? (
                      <div className="mt-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3">
                        <div className="mb-2 text-xs font-medium text-[var(--c-text-secondary)]">
                          {t.desktopSettings.userLoopOutputPreview}{outputPreview.ok&&outputPreview.origin==='verified_publication'&&outputPreview.checkedAt ? ` · ${t.desktopSettings.loopDiagnosticsVerifiedAt(new Date(outputPreview.checkedAt).toLocaleString())}` : ''}
                        </div>
                        {outputPreview.ok ? (
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--c-bg-deep)] p-3 text-xs leading-5 text-[var(--c-text-primary)]">
                            {outputPreview.content.split(/\r?\n/).map((line, index) => (
                              <span key={`${template.loopId}-preview-${index}`} className="block min-h-[1.25em]">
                                {line || ' '}
                              </span>
                            ))}
                          </pre>
                        ) : (
                          <div className="text-xs text-[var(--c-text-secondary)]">
                            {outputPreview.message || t.desktopSettings.userLoopOutputPreviewUnavailable}
                          </div>
                        )}
                      </div>
                    ) : null}
                    {taskResult ? (
                      <div className="mt-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3">
                        <div className="mb-2 text-xs font-medium text-[var(--c-text-secondary)]">
                          {t.desktopSettings.userLoopTaskResult}{taskResult.ok&&taskResult.origin==='verified_publication'&&taskResult.checkedAt ? ` · ${t.desktopSettings.loopDiagnosticsVerifiedAt(new Date(taskResult.checkedAt).toLocaleString())}` : ''}
                        </div>
                        {taskResult.ok ? (
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--c-bg-deep)] p-3 text-xs leading-5 text-[var(--c-text-primary)]">
                            {taskResult.content.split(/\r?\n/).map((line, index) => (
                              <span key={`${template.loopId}-task-result-${index}`} className="block min-h-[1.25em]">
                                {line || ' '}
                              </span>
                            ))}
                          </pre>
                        ) : (
                          <div className="text-xs text-[var(--c-text-secondary)]">
                            {taskResult.message || t.desktopSettings.userLoopTaskResultUnavailable}
                          </div>
                        )}
                      </div>
                    ) : null}
                    {editingLoopId === template.loopId && (
                      <div className="mt-3 rounded-lg border border-[var(--c-accent)] bg-[var(--c-bg-page)] p-3">
                        <div className="grid gap-2">
                          <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                            {t.desktopSettings.userLoopTitleLabel}
                            <input type="text" value={editLoopTitle} onChange={e => setEditLoopTitle(e.target.value)} className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]" />
                          </label>
                          <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                            {t.desktopSettings.userLoopPromptLabel}
                            <textarea value={editLoopPrompt} onChange={e => setEditLoopPrompt(e.target.value)} rows={14} className="resize-y min-h-[200px] rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)] font-mono" />
                          </label>
                          {template.kind === 'markdown_file' && (
                            <div className="grid grid-cols-2 gap-2">
                              <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                                {t.desktopSettings.userLoopOutputDirectoryLabel}
                                <div className="flex gap-1.5">
                                  <input type="text" value={editLoopOutputDir} onChange={e => setEditLoopOutputDir(e.target.value)} className="flex-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]" />
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        const result = await window.xiaokDesktop?.selectDirectory();
                                        if (result?.filePath) setEditLoopOutputDir(result.filePath);
                                      } catch { /* user cancel */ }
                                    }}
                                    className="shrink-0 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                                  >
                                    {t.desktopSettings.advancedChooseFolder}
                                  </button>
                                </div>
                              </label>
                              <label className="grid gap-1 text-xs text-[var(--c-text-secondary)]">
                                {t.desktopSettings.userLoopOutputFileNameLabel}
                                <input type="text" value={editLoopOutputFile} onChange={e => setEditLoopOutputFile(e.target.value)} className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]" />
                              </label>
                            </div>
                          )}
                          <div className="flex justify-end gap-2 pt-1">
                            <button type="button" onClick={() => setEditingLoopId(null)} className={`${btnSecondary} px-3 py-1.5`}>{t.desktopSettings.loopEditCancel}</button>
                            <button type="button" onClick={() => void handleSaveEdit()} disabled={savingEdit || !editLoopTitle.trim()} className={`${btnPrimary} px-3 py-1.5`}>{savingEdit ? t.desktopSettings.loopEditSaving : t.desktopSettings.loopEditSave}</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </Section>
      )}

      {showDiagnostics && (
      <Section>
        <SectionHeader icon={RefreshCw}>{t.desktopSettings.loopDiagnostics}</SectionHeader>
        <Card>
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="text-xs text-[var(--c-text-secondary)]">
              {t.desktopSettings.loopDiagnosticsDesc}
            </p>
            <button
              type="button"
              onClick={() => void loadLoops()}
              disabled={loopDiagnosticsLoading}
              className={`${btnSecondary} inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5`}
            >
              <RefreshCw size={14} className={loopDiagnosticsLoading ? 'animate-spin' : ''} />
              {t.desktopSettings.loopDiagnosticsRefresh}
            </button>
          </div>

          {loopDiagnosticsError ? (
            <div className="mb-3 rounded-md border border-[var(--c-status-error-text)]/20 bg-[var(--c-status-error-bg,#fef2f2)] px-3 py-2 text-xs text-[var(--c-status-error-text)]">
              {loopDiagnosticsError}
            </div>
          ) : null}

          {loopDiagnosticsLoading && builtInLoops.length === 0 ? (
            <div className="text-xs text-[var(--c-text-secondary)]">
              {t.desktopSettings.loopDiagnosticsLoading}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {builtInLoops.map(loop => {
                const runs = loopRuns[loop.id] ?? [];
                const latestRun = runs[0];
                const anomalies = loopAnomalies[loop.id] ?? [];
                const openAnomalies = getOpenLoopAnomalies(anomalies);
                const visibleAnomalies = openAnomalies.slice(0, 3);
                const openAnomalyCount = getOpenLoopAnomalyCount(anomalies);
                const runResult = loopRunResults[loop.id];
                const isRunning = runningLoopId === loop.id;
                const isAlreadyRunning = !!loop.activeRunId || runResult?.status === 'already_running';
                const buttonLabel = isRunning
                  ? t.desktopSettings.loopDiagnosticsRunning
                  : isAlreadyRunning
                    ? t.desktopSettings.loopDiagnosticsAlreadyRunning
                    : (runResult?.status==='publication_pending'||loopNeedsRevalidation(latestRun))?t.desktopSettings.loopDiagnosticsPublicationPending:t.desktopSettings.loopDiagnosticsRunNow;

                return (
                  <div
                    key={loop.id}
                    className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--c-text-heading)]">
                          {loop.title}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--c-text-secondary)]">
                          {loop.description}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--c-bg-deep)] px-2 py-0.5 text-[11px] text-[var(--c-text-secondary)]">
                        {loop.status}
                      </span>
                    </div>

                    <LoopPublicationPanel loopId={loop.id} runs={runs} onChanged={() => void loadLoops(true)} />
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-[var(--c-bg-card)] p-2">
                        <div className="text-[var(--c-text-tertiary)]">{t.desktopSettings.loopDiagnosticsLastRun}</div>
                        <div className="mt-1 text-[var(--c-text-primary)]">
                          {latestRun
                            ? `${observationLabel(latestRun)} · ${formatLoopRunTime(latestRun)}`
                            : t.desktopSettings.loopDiagnosticsNoRuns}
                        </div>
                      </div>
                      <div className="rounded-md bg-[var(--c-bg-card)] p-2">
                        <div className="text-[var(--c-text-tertiary)]">{t.desktopSettings.loopDiagnosticsOpenAnomalies}</div>
                        <div className="mt-1 font-medium text-[var(--c-text-primary)]">
                          {openAnomalyCount}
                        </div>
                      </div>
                    </div>

                    {latestRun?.message ? (
                      <div className="mt-2 rounded-md bg-[var(--c-bg-card)] p-2 text-xs text-[var(--c-text-secondary)]">
                        {latestRun.message}
                      </div>
                    ) : null}

                    {visibleAnomalies.length > 0 ? (
                      <div className="mt-2 flex flex-col gap-2">
                        {visibleAnomalies.map(anomaly => {
                          const suggestedAction = getLoopAnomalySuggestedAction(anomaly);
                          const logPaths = getLoopAnomalyLogPaths(anomaly);
                          return (
                            <div
                              key={anomaly.id}
                              className="rounded-md bg-[var(--c-bg-card)] p-2 text-xs text-[var(--c-text-secondary)]"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-medium text-[var(--c-text-primary)]">
                                    {anomaly.message}
                                  </div>
                                  <div className="mt-0.5 break-all text-[var(--c-text-tertiary)]">
                                    {anomaly.kind} · {anomaly.ownerKind}/{anomaly.ownerId}
                                  </div>
                                </div>
                                <span className="shrink-0 text-[11px] text-[var(--c-text-tertiary)]">
                                  {anomaly.seenCount}x
                                </span>
                              </div>
                              {suggestedAction ? (
                                <div className="mt-1">
                                  <span className="text-[var(--c-text-tertiary)]">{t.desktopSettings.loopDiagnosticsSuggestedAction}: </span>
                                  {suggestedAction}
                                </div>
                              ) : null}
                              {logPaths.map(logPath => (
                                <div key={logPath} className="mt-1 break-all">
                                  <span className="text-[var(--c-text-tertiary)]">{t.desktopSettings.loopDiagnosticsLogPath}: </span>
                                  {logPath}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        aria-label={`copy-loop-diagnostics-${loop.id}`}
                        onClick={() => void handleCopyLoopDiagnostics(loop, runs, anomalies)}
                        className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                      >
                        <Copy size={14} />
                        {t.desktopSettings.loopDiagnosticsCopy}
                      </button>
                      <button
                        type="button"
                        aria-label={`run-loop-${loop.id}`}
                        onClick={() => void handleRunLoopNow(loop.id)}
                        disabled={isRunning || isAlreadyRunning || loop.status !== 'active'}
                        className={`${btnSecondary} inline-flex items-center gap-1.5 px-3 py-1.5`}
                      >
                        <RefreshCw size={14} className={isRunning ? 'animate-spin' : ''} />
                        {buttonLabel}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </Section>
      )}
    </>
  );
}

// ---- General ----

function GeneralPane() {
  const { locale, setLocale, t } = useLocale();
  const [skillDebug, setSkillDebug] = useState(false);
  const [savingSkillDebug, setSavingSkillDebug] = useState(false);
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(3);
  const [savingConcurrency, setSavingConcurrency] = useState(false);
  const skillConfigSequence = useRef(0);
  const concurrencyConfigSequence = useRef(0);
  const [skillConfigError, setSkillConfigError] = useState<'' | 'load' | 'unknown' | 'save'>('');
  const [concurrencyConfigError, setConcurrencyConfigError] = useState<'' | 'load' | 'unknown' | 'save'>('');
  const [serviceStatus, setServiceStatus] = useState<DesktopServiceStatusSnapshot | null>(null);
  const [serviceStatusLoading, setServiceStatusLoading] = useState(true);
  const [serviceReadUnavailable, setServiceReadUnavailable] = useState(false);
  const [serviceActionUnknown, setServiceActionUnknown] = useState(false);
  const serviceReadLifetime = useRef<{ active: boolean; busy: boolean; queued: boolean } | null>(null);
  const serviceActionLifetime = useRef<{ active: boolean; busy: boolean } | null>(null);
  const [restartingService, setRestartingService] = useState<DesktopRelatedServiceId | null>(null);
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('xiaok_display_name') || '');
  const [avatarUrl, setAvatarUrl] = useState(() => localStorage.getItem('xiaok_avatar_url') || '');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const loadServiceStatus = useCallback(async (mode: 'initial' | 'poll' | 'manual' = 'manual'): Promise<void> => {
    const lifetime = serviceReadLifetime.current;
    if (!lifetime?.active) return;
    if (lifetime.busy) {
      if (mode === 'manual') { lifetime.queued = true; setServiceStatusLoading(true); }
      return;
    }
    lifetime.busy = true;
    if (mode !== 'poll') setServiceStatusLoading(true);
    try {
      do {
        lifetime.queued = false;
        try {
          const snapshot = await api.getServiceStatus();
          if (lifetime.active) { setServiceStatus(snapshot); setServiceReadUnavailable(false); }
        } catch {
          if (lifetime.active) setServiceReadUnavailable(true);
        }
      } while (lifetime.active && lifetime.queued);
    } finally {
      lifetime.busy = false;
      if (lifetime.active) setServiceStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    const lifetime = { active: true, busy: false };
    serviceActionLifetime.current = lifetime;
    return () => {
      lifetime.active = false;
      if (serviceActionLifetime.current === lifetime) serviceActionLifetime.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const sequence = ++skillConfigSequence.current;
    api.getSkillDebugConfig().then(c => {
      if (active && sequence === skillConfigSequence.current) setSkillDebug(c.enabled);
    }).catch(() => {
      if (active && sequence === skillConfigSequence.current) setSkillConfigError('load');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const lifetime = { active: true, busy: false, queued: false };
    serviceReadLifetime.current = lifetime;
    void loadServiceStatus('initial');
    const timer = window.setInterval(() => { void loadServiceStatus('poll'); }, 10_000);
    return () => {
      lifetime.active = false;
      lifetime.queued = false;
      if (serviceReadLifetime.current === lifetime) serviceReadLifetime.current = null;
      window.clearInterval(timer);
    };
  }, [loadServiceStatus, t.desktopSettings.serviceStatusLoadError]);

  const handleSkillDebugToggle = async (enabled: boolean) => {
    const sequence = ++skillConfigSequence.current;
    setSkillConfigError('');
    setSavingSkillDebug(true);
    try {
      const saved = await api.saveSkillDebugConfig({ enabled });
      if (sequence === skillConfigSequence.current) setSkillDebug(saved.enabled);
    } catch (error) {
      if (sequence === skillConfigSequence.current) setSkillConfigError(
        error instanceof Error && (error.message === 'desktop_config_operation_unknown' || error.message.endsWith(': desktop_config_operation_unknown'))
          ? 'unknown' : 'save');
    } finally {
      if (sequence === skillConfigSequence.current) setSavingSkillDebug(false);
    }
  };

  useEffect(() => {
    let active = true;
    const sequence = ++concurrencyConfigSequence.current;
    api.getKswarmConfig().then(c => {
      if (active && sequence === concurrencyConfigSequence.current) setMaxConcurrentTasks(c.maxConcurrentTasks);
    }).catch(() => {
      if (active && sequence === concurrencyConfigSequence.current) setConcurrencyConfigError('load');
    });
    return () => { active = false; };
  }, []);

  const handleConcurrencyChange = async (value: number) => {
    const clamped = Math.max(1, Math.min(10, value));
    const sequence = ++concurrencyConfigSequence.current;
    setConcurrencyConfigError('');
    setSavingConcurrency(true);
    try {
      const saved = await api.saveKswarmConfig({ maxConcurrentTasks: clamped });
      if (sequence === concurrencyConfigSequence.current) setMaxConcurrentTasks(saved.maxConcurrentTasks);
    } catch (error) {
      if (sequence === concurrencyConfigSequence.current) setConcurrencyConfigError(
        error instanceof Error && (error.message === 'desktop_config_operation_unknown' || error.message.endsWith(': desktop_config_operation_unknown'))
          ? 'unknown' : 'save');
    } finally {
      if (sequence === concurrencyConfigSequence.current) setSavingConcurrency(false);
    }
  };

  const handleRestartService = async (serviceId: DesktopRelatedServiceId) => {
    const lifetime = serviceActionLifetime.current;
    if (!lifetime?.active || lifetime.busy) return;
    lifetime.busy = true;
    setRestartingService(serviceId);
    setServiceActionUnknown(false);
    try {
      await api.restartRelatedService(serviceId);
      if (lifetime.active) await loadServiceStatus('manual');
    } catch {
      if (lifetime.active) setServiceActionUnknown(true);
    } finally {
      lifetime.busy = false;
      if (lifetime.active) setRestartingService(null);
    }
  };

  const handleStartEditName = () => {
    setNameInput(displayName);
    setEditingName(true);
  };

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (trimmed) {
      localStorage.setItem('xiaok_display_name', trimmed);
    } else {
      localStorage.removeItem('xiaok_display_name');
    }
    setDisplayName(trimmed);
    setEditingName(false);
    window.dispatchEvent(new Event('xiaok-profile-changed'));
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height, 128);
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        if (dataUrl.length > 140000) {
          alert(t.desktopSettings.avatarTooLarge);
          return;
        }
        localStorage.setItem('xiaok_avatar_url', dataUrl);
        setAvatarUrl(dataUrl);
        window.dispatchEvent(new Event('xiaok-profile-changed'));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const initial = (displayName || '?').charAt(0).toUpperCase();

  return (
    <>
      <Section>
        <SectionHeader icon={User}>{t.desktopSettings.profileTitle}</SectionHeader>
        <Card>
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="relative shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="size-12 rounded-full object-cover" />
              ) : (
                <div
                  className="flex size-12 items-center justify-center rounded-full text-base font-semibold"
                  style={{ background: 'var(--c-avatar-bg, #e2e8f0)', color: 'var(--c-avatar-text, #475569)' }}
                >
                  {initial}
                </div>
              )}
              <label className="absolute -bottom-0.5 -right-0.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-[var(--c-bg-card)] shadow" title={t.desktopSettings.changeAvatar}>
                <Camera size={10} />
                <input aria-label={t.desktopSettings.changeAvatar} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </label>
            </div>
            {/* Name */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input aria-label={t.desktopSettings.enterYourName}
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                    className="min-w-0 flex-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                    placeholder={t.desktopSettings.enterYourName}
                    autoFocus
                  />
                  <button type="button" onClick={handleSaveName} className="text-xs text-[var(--c-accent)]">{t.desktopSettings.save}</button>
                  <button type="button" onClick={() => setEditingName(false)} className="text-xs text-[var(--c-text-tertiary)]">{t.desktopSettings.cancelAction}</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleStartEditName}
                  className="truncate text-left text-sm font-medium text-[var(--c-text-heading)] hover:text-[var(--c-accent)]"
                >
                  {displayName || t.desktopSettings.clickToSetName}
                </button>
              )}
              <span className="text-xs text-[var(--c-text-tertiary)]">{t.desktopSettings.nameCallHint}</span>
            </div>
          </div>
        </Card>
      </Section>
      <Section>
        <SectionHeader icon={SlidersHorizontal}>{t.desktopSettings.languageTitle}</SectionHeader>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            {t.desktopSettings.languageDesc}
          </p>
          <div className="flex gap-3">
            <button type="button"
              onClick={() => setLocale('zh')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm transition-colors border ${
                locale === 'zh'
                  ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)] border-[var(--c-accent)]/30'
                  : 'border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
              }`}
            >
              <div className="font-medium">{t.desktopSettings.langZh}</div>
              <div className="text-xs text-[var(--c-text-tertiary)] mt-0.5">{t.desktopSettings.langZhSub}</div>
            </button>
            <button type="button"
              onClick={() => setLocale('en')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm transition-colors border ${
                locale === 'en'
                  ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)] border-[var(--c-accent)]/30'
                  : 'border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
              }`}
            >
              <div className="font-medium">{t.desktopSettings.langEn}</div>
              <div className="text-xs text-[var(--c-text-tertiary)] mt-0.5">{t.desktopSettings.langEnSub}</div>
            </button>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Server}>{t.desktopSettings.serviceStatusTitle}</SectionHeader>
        <Card>
          <div className="flex flex-col gap-3">
            {serviceStatusLoading && !serviceStatus ? (
              <div className="flex items-center gap-2 text-xs text-[var(--c-text-secondary)]">
                <Loader2 size={14} className="animate-spin" />
                <span>{t.desktopSettings.serviceStatusChecking}</span>
              </div>
            ) : null}
            {serviceStatus?.services.map(service => (
              <ServiceStatusRow
                key={service.id}
                service={service}
                restarting={restartingService === service.id}
                disabled={restartingService !== null}
                onRestart={handleRestartService}
              />
            ))}
            {serviceReadUnavailable || serviceActionUnknown ? (
              <div role="alert" className="rounded-md border border-[var(--c-status-error-text)]/20 bg-[var(--c-status-error-bg,#fef2f2)] px-3 py-2 text-xs text-[var(--c-status-error-text)]">
                {serviceReadUnavailable && <div>{t.desktopSettings.serviceStatusLoadError}</div>}
                {serviceActionUnknown && <div>{t.desktopSettings.serviceRestartUnknown}</div>}
              </div>
            ) : null}
            <button type="button" onClick={() => void loadServiceStatus('manual')} className={`${btnSecondary} self-start`}>
              {serviceStatusLoading ? <Loader2 size={13} className="mr-1 inline animate-spin" aria-hidden="true" /> : null}
              {t.desktopSettings.serviceStatusReadRetry}
            </button>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Cpu}>{t.desktopSettings.taskConcurrencyTitle}</SectionHeader>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            {t.desktopSettings.taskConcurrencyDesc}
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range"
              aria-label={t.desktopSettings.taskConcurrencyAria}
              min={1}
              max={10}
              step={1}
              value={maxConcurrentTasks}
              disabled={savingConcurrency}
              onChange={(e) => handleConcurrencyChange(Number(e.target.value))}
              className="flex-1 accent-[var(--c-accent)]"
            />
            <span className="min-w-[2.5rem] text-center text-sm font-medium text-[var(--c-text-heading)]">
              {maxConcurrentTasks}
            </span>
            {savingConcurrency && <Loader2 size={14} className="animate-spin text-[var(--c-text-tertiary)]" />}
          </div>
          {concurrencyConfigError ? <div role="alert" className="mt-2 text-xs text-[var(--c-status-error-text)]">{concurrencyConfigError === 'load' ? t.desktopSettings.configLoadFailed : concurrencyConfigError === 'unknown' ? t.desktopSettings.configOperationUnknown : t.desktopSettings.configSaveFailed}</div> : null}
          <div className="mt-2 flex justify-between text-[10px] text-[var(--c-text-tertiary)]">
            <span>{t.desktopSettings.taskConcurrencyMin}</span>
            <span>{t.desktopSettings.taskConcurrencyMax}</span>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Zap}>{t.desktopSettings.stageDebugTitle}</SectionHeader>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            {t.desktopSettings.stageDebugDesc}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {savingSkillDebug && <Loader2 size={16} className="animate-spin text-[var(--c-text-tertiary)]" />}
              <span className="text-sm text-[var(--c-text-primary)]">
                {skillDebug ? t.desktopSettings.stageDebugOn : t.desktopSettings.stageDebugOff}
              </span>
            </div>
            <button type="button"
              aria-label={t.desktopSettings.stageDebugToggleAria}
              disabled={savingSkillDebug}
              onClick={() => handleSkillDebugToggle(!skillDebug)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                skillDebug ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-border)]'
              }`}
            >
              <span
                className={`inline-block size-4 transform rounded-full bg-white transition-transform ${
                  skillDebug ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          {skillConfigError ? <div role="alert" className="mt-2 text-xs text-[var(--c-status-error-text)]">{skillConfigError === 'load' ? t.desktopSettings.configLoadFailed : skillConfigError === 'unknown' ? t.desktopSettings.configOperationUnknown : t.desktopSettings.configSaveFailed}</div> : null}
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Info}>{t.desktopSettings.appInfoTitle}</SectionHeader>
        <Card>
          <div className="text-xs text-[var(--c-text-secondary)] space-y-1">
            <div>{t.desktopSettings.appInfoVersion} v{__APP_VERSION__} ({__APP_BUILD__})</div>
            <div>{t.desktopSettings.appInfoBuild}</div>
            <div>{t.desktopSettings.appInfoDataPath}</div>
          </div>
        </Card>
      </Section>
      <LocalExecutionAuthorizationCard />
    </>
  );
}

function ServiceStatusRow({
  service,
  restarting,
  disabled,
  onRestart,
}: {
  service: DesktopRelatedServiceStatus;
  restarting: boolean;
  disabled: boolean;
  onRestart: (serviceId: DesktopRelatedServiceId) => void;
}) {
  const { t } = useLocale();
  const status = getRelatedServiceDisplayStatus(service, t);
  const meta = [
    `:${service.port}`,
    service.pid ? `PID ${service.pid}` : '',
    service.restartCount ? `${t.desktopSettings.serviceRestartCount} ${service.restartCount}` : '',
    service.detail || '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--c-border)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`size-2.5 shrink-0 rounded-full ${status.dotClass}`} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-[var(--c-text-primary)]">{service.label}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${status.badgeClass}`}>
              {status.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-[var(--c-text-tertiary)]">{meta}</div>
          {service.lastError ? (
            <div className="mt-1 truncate text-xs text-[var(--c-status-error-text)]">{service.lastError}</div>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        aria-label={`restart-service-${service.id}`}
        title={`${service.label} ${t.desktopSettings.serviceRestart}`}
        onClick={() => onRestart(service.id)}
        disabled={disabled || restarting}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--c-border)] px-2.5 text-xs text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-deep)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {restarting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        <span>{t.desktopSettings.serviceRestart}</span>
      </button>
    </div>
  );
}

function getRelatedServiceDisplayStatus(service: DesktopRelatedServiceStatus, t: ReturnType<typeof useLocale>['t']): {
  label: string;
  dotClass: string;
  badgeClass: string;
} {
  if (service.reachable && service.running) {
    return {
      label: t.desktopSettings.serviceStatusRunning,
      dotClass: 'bg-[var(--c-status-success-text,#16a34a)]',
      badgeClass: 'bg-[var(--c-status-ok-bg,#dcfce7)] text-[var(--c-status-ok-text,#166534)]',
    };
  }
  if (service.running) {
    return {
      label: t.desktopSettings.serviceStatusAbnormal,
      dotClass: 'bg-[var(--c-status-warning-text,#d97706)]',
      badgeClass: 'bg-[var(--c-status-warning-bg,#fef3c7)] text-[var(--c-status-warning-text,#92400e)]',
    };
  }
  return {
    label: t.desktopSettings.serviceStatusUnavailable,
    dotClass: 'bg-[var(--c-status-error-text,#dc2626)]',
    badgeClass: 'bg-[var(--c-status-error-bg,#fee2e2)] text-[var(--c-status-error-text,#991b1b)]',
  };
}

// ---- Memory ----

function MemoryPane() {
  const { t } = useLocale();
  return (
    <Section>
      <SectionHeader icon={Brain}>{t.desktopSettings.memoryPaneTitle}</SectionHeader>
      <p className="text-xs text-[var(--c-text-secondary)] mb-4">
        {t.desktopSettings.memoryPaneDesc}
      </p>
      <LocalMemoryStatsCard />
      <div className="mt-6">
        <MemoryModelSettings />
      </div>
    </Section>
  );
}
// ---- Data ----

function DataPane() {
  const { t } = useLocale();
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    if (!confirm(t.desktopSettings.clearDataConfirm)) return;
    setClearing(true);
    try {
      // Clear IndexedDB
      const dbReq = indexedDB.deleteDatabase('xiaok-desktop');
      dbReq.onsuccess = () => {
        // Clear localStorage
        localStorage.clear();
        alert(t.desktopSettings.dataCleared);
        window.location.reload();
      };
      dbReq.onerror = () => {
        alert(t.desktopSettings.clearFailed(dbReq.error?.message ?? ''));
        setClearing(false);
      };
    } catch (e) {
      alert((e as Error).message);
      setClearing(false);
    }
  };

  return (
    <>
      <Section>
        <SectionHeader icon={Database}>{t.desktopSettings.localData}</SectionHeader>
        <Card>
          <div className="flex items-start gap-3">
            <Database size={18} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium">{t.desktopSettings.dataStorageLocation}</div>
              <div className="text-xs text-[var(--c-text-secondary)] mt-1">
                {t.desktopSettings.dataStorageIndexedDb}<br />
                {t.desktopSettings.dataStorageLocalStorage}
              </div>
            </div>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={SlidersHorizontal}>{t.desktopSettings.configPath}</SectionHeader>
        <Card>
          <code className="text-sm font-mono text-[var(--c-text-secondary)]">
            ~/.xiaok/config.json
          </code>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Trash2}>{t.desktopSettings.dangerZone}</SectionHeader>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{t.desktopSettings.clearAllData}</div>
              <div className="text-xs text-[var(--c-text-secondary)] mt-1">
                {t.desktopSettings.clearAllDataDesc}
              </div>
            </div>
            <button type="button"
              onClick={handleClear}
              disabled={clearing}
              className={btnDanger}
            >
              {clearing ? t.desktopSettings.clearing : t.desktopSettings.clearData}
            </button>
          </div>
        </Card>
      </Section>
    </>
  );
}

// ---- About ----

function AboutPane() {
  const { t } = useLocale();
  const [updateStatus, setUpdateStatus] = useState<{ checking: boolean; available: boolean; downloading: boolean; downloaded: boolean; installing?: boolean; progress: number; version?: string; error?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [updateReadError, setUpdateReadError] = useState('');
  const updateGeneration = useRef(0);
  const readUpdateFacts = async () => {
    const generation = ++updateGeneration.current;
    try {
      const next = await api.getUpdateStatus();
      if (generation === updateGeneration.current) { setUpdateStatus(next); setUpdateReadError(''); }
    } catch {
      if (generation === updateGeneration.current) setUpdateReadError(t.desktopSettings.updaterProjectionUnavailable);
    }
  };
  useEffect(() => {
    const unsub = api.onUpdateStatus(status => { ++updateGeneration.current; setUpdateStatus(status); setUpdateReadError(''); });
    void readUpdateFacts();
    return () => { ++updateGeneration.current; unsub(); };
    // The subscription belongs to this mounted pane; explicit refresh reads current facts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleCheckUpdate = async () => {
    ++updateGeneration.current;
    setChecking(true);
    try { await api.checkForUpdates(); await readUpdateFacts(); }
    catch { setUpdateReadError(t.desktopSettings.updaterOperationUnknown); }
    finally { setChecking(false); }
  };
  const handleInstallUpdate = async () => {
    ++updateGeneration.current;
    try {
      const result = await api.quitAndInstall();
      if (result?.status === 'rejected_sync' || result?.status === 'pending_error_sticky') setUpdateReadError(t.sidebarUpdateHandoffUnconfirmedHint);
      else if (!result || !['pending', 'already_pending', 'already_handed_off'].includes(result.status)) setUpdateReadError(t.desktopSettings.updaterOperationUnknown);
    } catch { setUpdateReadError(t.desktopSettings.updaterOperationUnknown); }
  };

  return (
    <>
      <Section>
        <SectionHeader icon={Info}>{t.desktopSettings.aboutTitle}</SectionHeader>
        <Card>
          <div className="text-sm">
            <div className="font-medium text-base">xiaok desktop</div>
            <div className="text-xs text-[var(--c-text-secondary)] mt-2">
              {t.desktopSettings.aboutLocalMode}
            </div>
            <div className="text-xs text-[var(--c-text-tertiary)] mt-3">
              {t.desktopSettings.aboutAppDesc}
            </div>
            <a
              href="https://github.com/kaisersong"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[var(--c-accent)] hover:underline mt-3"
            >
              github.com/kaisersong
              <ExternalLink size={11} />
            </a>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Zap}>{t.desktopSettings.softwareUpdate}</SectionHeader>
        <Card>
          {updateReadError && <div role="alert" className="mb-3 text-sm text-red-500"><p>{updateReadError}</p><button type="button" onClick={() => void readUpdateFacts()} className={btnSecondary}>{t.desktopSettings.updaterRefreshData}</button></div>}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">
                {updateReadError && !updateStatus ? t.desktopSettings.updaterProjectionUnavailable : updateStatus?.error && updateStatus.downloaded ? t.sidebarUpdateHandoffUnconfirmed : updateStatus?.installing ? t.desktopSettings.aboutInstalling : updateStatus?.downloaded ? t.desktopSettings.aboutUpdateReady : updateStatus?.downloading ? t.desktopSettings.aboutDownloading : updateStatus?.available ? t.desktopSettings.aboutNewVersion : t.desktopSettings.aboutCurrentVersion}
              </div>
              <div className="text-xs text-[var(--c-text-secondary)] mt-1">
                {updateStatus?.error && updateStatus.downloaded ? t.sidebarUpdateHandoffUnconfirmedHint :
                 updateStatus?.installing ? t.desktopSettings.aboutInstallingVersion(updateStatus.version || '') :
                 updateStatus?.downloaded ? t.desktopSettings.aboutDownloadedVersion(updateStatus.version || '') :
                 updateStatus?.downloading ? t.desktopSettings.aboutDownloadProgress(updateStatus.progress) :
                 updateStatus?.available ? t.desktopSettings.aboutVersionAvailable(updateStatus.version || '') :
                 updateStatus?.checking || checking ? t.desktopSettings.aboutChecking :
                 `v${__APP_VERSION__}`}
              </div>
              {updateStatus?.error && updateStatus.error !== 'update_install_handoff_unconfirmed' && (
                <div className="text-xs text-red-500 mt-1">{updateStatus.error === 'update_install_handoff_unconfirmed' ? t.sidebarUpdateHandoffUnconfirmedHint : updateStatus.error === 'update_install_not_ready' ? t.sidebarUpdateInstallNotReady : t.desktopSettings.updaterOperationUnknown}</div>
              )}
            </div>
            <div className="flex gap-2">
              {updateStatus?.error && updateStatus.downloaded ? (
                <a href="https://github.com/kaisersong/xiaok-cli/releases/latest" target="_blank" rel="noopener noreferrer" className={btnPrimary}>{t.sidebarUpdateGoToGithub}</a>
              ) : updateStatus?.downloaded ? (
                <button type="button" onClick={handleInstallUpdate} disabled={updateStatus.installing} className={btnPrimary}>
                  {updateStatus.installing ? t.desktopSettings.aboutInstallProgress : t.desktopSettings.aboutInstallRestart}
                </button>
              ) : updateStatus?.downloading ? (
                <div className="flex items-center gap-2 text-[var(--c-accent)]">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">{updateStatus.progress}%</span>
                </div>
              ) : (
                <button type="button" onClick={handleCheckUpdate} disabled={checking || updateStatus?.checking} className={btnSecondary}>
                  {checking || updateStatus?.checking ? t.desktopSettings.aboutCheckingUpdates : t.desktopSettings.aboutCheckUpdates}
                </button>
              )}
            </div>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Cpu}>{t.desktopSettings.coreFeatures}</SectionHeader>
        <div className="flex flex-col gap-2">
          <Card>
            <div className="flex items-start gap-3">
              <Zap size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">{t.desktopSettings.featureIntentRecognition}</div>
                <div className="text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.featureIntentRecognitionDesc}</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <SlidersHorizontal size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">{t.desktopSettings.featureToolCalling}</div>
                <div className="text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.featureToolCallingDesc}</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <Puzzle size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">{t.desktopSettings.featureSkillExtension}</div>
                <div className="text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.featureSkillExtensionDesc}</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <Plug size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">{t.desktopSettings.featureMcp}</div>
                <div className="text-xs text-[var(--c-text-secondary)]">{t.desktopSettings.featureMcpDesc}</div>
              </div>
            </div>
          </Card>
        </div>
      </Section>

      <Section>
        <SectionHeader>{t.desktopSettings.supportedProviders}</SectionHeader>
        <Card>
          <div className="flex flex-wrap gap-2">
            {['OpenAI', 'Anthropic', 'DeepSeek', 'Kimi', 'GLM', 'MiniMax', 'Gemini'].map(name => (
              <span key={name} className="rounded-md px-2.5 py-1 text-xs bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]">
                {name}
              </span>
            ))}
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader>{t.desktopSettings.versionInfo}</SectionHeader>
        <Card>
          <div className="text-xs text-[var(--c-text-secondary)]">
            <div>{t.desktopSettings.versionLabel}: v{__APP_VERSION__} ({__APP_BUILD__})</div>
            <div className="mt-1">{t.desktopSettings.buildLabel}: Electron + React</div>
          </div>
        </Card>
      </Section>
    </>
  );
}

// ---- Tools Settings (web search / fetch connectors) ----

const SEARCH_PROVIDERS: Array<{
  key: ConnectorsSearchProvider;
  label: string;
  descKey: 'searchDuckduckgoDesc' | 'searchFirecrawlDesc' | 'searchTavilyDesc' | 'searchBraveDesc';
  notImplemented?: boolean;
}> = [
  { key: 'duckduckgo', label: 'DuckDuckGo', descKey: 'searchDuckduckgoDesc' },
  { key: 'firecrawl', label: 'Firecrawl', descKey: 'searchFirecrawlDesc' },
  { key: 'tavily', label: 'Tavily', descKey: 'searchTavilyDesc' },
  { key: 'brave', label: 'Brave Search', descKey: 'searchBraveDesc' },
];

const FETCH_PROVIDERS: Array<{
  key: ConnectorsFetchProvider;
  label: string;
  descKey: 'fetchBasicDesc' | 'fetchJinaDesc' | 'fetchFirecrawlDesc';
  notImplemented?: boolean;
}> = [
  { key: 'basic', label: 'Basic', descKey: 'fetchBasicDesc' },
  { key: 'jina', label: 'Jina Reader', descKey: 'fetchJinaDesc' },
  { key: 'firecrawl', label: 'Firecrawl', descKey: 'fetchFirecrawlDesc' },
];

function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 12)) + key.slice(-4);
}

function runtimeStateLabel(state: ConnectorsProviderRuntime['runtime_state'], ds: LocaleStrings['desktopSettings']): { text: string; tone: 'ok' | 'warn' | 'err' | 'mute' } {
  switch (state) {
    case 'ready': return { text: ds.connectorStatusReady, tone: 'ok' };
    case 'inactive': return { text: ds.connectorStatusInactive, tone: 'mute' };
    case 'missing_config': return { text: ds.connectorStatusMissingConfig, tone: 'warn' };
    case 'invalid_config': return { text: ds.connectorStatusInvalidConfig, tone: 'err' };
    case 'not_implemented': return { text: ds.connectorStatusNotImplemented, tone: 'mute' };
    case 'decrypt_failed': return { text: ds.connectorStatusDecryptFailed, tone: 'err' };
    default: return { text: state, tone: 'mute' };
  }
}

function RuntimeBadge({ runtime, ds }: { runtime?: ConnectorsProviderRuntime; ds: LocaleStrings['desktopSettings'] }) {
  if (!runtime) return null;
  const { text, tone } = runtimeStateLabel(runtime.runtime_state, ds);
  const toneCls =
    tone === 'ok' ? 'bg-green-50 text-green-600' :
    tone === 'warn' ? 'bg-yellow-50 text-yellow-600' :
    tone === 'err' ? 'bg-red-50 text-red-600' :
    'bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${toneCls}`} title={runtime.runtime_reason || ''}>
      {text}
    </span>
  );
}

interface ApiKeyInputProps {
  ariaLabel: string;
  placeholder: string;
  storedValue: string; // the actual key from draft (may be empty)
  onChange: (newValue: string) => void;
}

function ApiKeyInput({ ariaLabel, placeholder, storedValue, onChange, ds }: ApiKeyInputProps & { ds: LocaleStrings['desktopSettings'] }) {
  const [editing, setEditing] = useState(!storedValue);
  const [editValue, setEditValue] = useState('');

  const startEdit = () => {
    setEditValue('');
    setEditing(true);
  };

  const commitEdit = () => {
    // If user typed nothing new, keep storedValue; otherwise onChange was already called
    setEditing(false);
    if (!editValue.trim() && storedValue) {
      // no-op: keep existing stored value
    }
  };

  const cancelEdit = () => {
    setEditValue('');
    setEditing(false);
  };

  const handleChange = (v: string) => {
    setEditValue(v);
    if (v.trim()) onChange(v.trim());
  };

  if (!editing && storedValue) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <span
          className="flex-1 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-deep)] px-3 py-2 text-sm font-mono text-[var(--c-text-secondary)] select-none"
          aria-label={ariaLabel}
        >
          {maskApiKey(storedValue)}
        </span>
        <button
          type="button"
          onClick={startEdit}
          className="shrink-0 rounded-lg border border-[var(--c-border)] px-3 py-2 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
          aria-label={`edit-${ariaLabel}`}
        >
          {ds.connectorChangeKey}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="password"
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={`flex-1 ${inputCls}`}
        value={editValue}
        autoFocus
        onChange={e => handleChange(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => {
          if (e.key === 'Enter') commitEdit();
          if (e.key === 'Escape') cancelEdit();
        }}
      />
      {storedValue && (
        <button
          type="button"
          onClick={cancelEdit}
          className="shrink-0 rounded-lg border border-[var(--c-border)] px-3 py-2 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
          aria-label={`cancel-edit-${ariaLabel}`}
        >
          {ds.connectorCancelEdit}
        </button>
      )}
    </div>
  );
}

interface TestButtonProps {
  kind: 'search' | 'fetch';
}

function TestButton({ kind, ds }: TestButtonProps & { ds: LocaleStrings['desktopSettings'] }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; latencyMs: number; detail?: string; error?: string } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = await api.testConnectorProvider(kind);
      setResult(r);
    } catch (e) {
      setResult({ success: false, latencyMs: 0, error: connectorsErrorMessage(e, ds) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-3">
      <button
        type="button"
        onClick={handleTest}
        disabled={testing}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors disabled:opacity-50"
        aria-label={`test-${kind}`}
      >
        {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
        {ds.connectorTestConnection}
      </button>
      {result && (
        result.success
          ? <span className="text-xs text-green-600">{result.latencyMs}ms {result.detail ? `· ${result.detail}` : ''}</span>
          : <span className="text-xs text-red-500 truncate max-w-[280px]">{result.error}</span>
      )}
    </div>
  );
}

function SystemOneSection() {
  const { t } = useLocale();
  const ds = t.desktopSettings;
  const [snapshot, setSnapshot] = useState<DesktopSystemOneConfigSnapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSnapshot(await api.getSystemOneConfig());
      setError('');
    } catch (e) {
      // 不把 "xxx is not a function" 这类原始 JS 报错渲染给用户；
      // 细节留在 main 进程日志里，界面只给一句可读的失败提示。
      console.error('[SystemOne] load failed', e);
      setError(ds.systemOneLoadFailed);
    }
  }, [ds.systemOneLoadFailed]);

  useEffect(() => { void load(); }, [load]);

  // Jev 只有这一条写入路径：顶层 config.systemOne，永远不进 providers/models。
  const submit = async (patch: DesktopSaveSystemOneConfigInput) => {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      setSnapshot(await api.saveSystemOneConfig(patch));
      setDraft('');
      setSaved(ds.connectorSaved);
    } catch (e) {
      console.error('[SystemOne] save failed', e);
      setError(ds.systemOneLoadFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section>
      <SectionHeader icon={Brain}>{ds.systemOneTitle}</SectionHeader>
      <div className="text-xs text-[var(--c-text-secondary)] mb-3">{ds.systemOneDesc}</div>
      <Card>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{ds.jevKeyName}</span>
          <span className="text-xs text-[var(--c-text-muted)]">
            {snapshot?.configured && snapshot.apiKeyMasked
              ? ds.jevKeyConfigured(snapshot.apiKeyMasked)
              : ds.jevKeyNotConfigured}
          </span>
          {snapshot?.keySource === 'env' && snapshot.keyEnvVar && (
            <span className="text-xs text-[var(--c-text-muted)]">{ds.jevKeyFromEnv(snapshot.keyEnvVar)}</span>
          )}
        </div>
        <div className="mt-1 text-xs text-[var(--c-text-secondary)]">{ds.jevKeyDesc}</div>
        <div className="mt-2 flex flex-col gap-1 text-xs text-[var(--c-text-secondary)]">
          <div>{ds.jevKeySteps}</div>
          <div>{snapshot ? ds.jevKeyEndpointValue(snapshot.baseUrl) : ds.jevKeyEndpoint}</div>
          <div>{snapshot ? ds.jevKeyModelValue(snapshot.model) : ds.jevKeyModel}</div>
          <div>{ds.jevKeyAuth}</div>
          <div className="text-[var(--c-text-muted)]">{ds.jevKeyIsolationNote}</div>
        </div>
        <input
          className={`${inputCls} mt-2`}
          type="password"
          value={draft}
          placeholder={ds.jevApiKeyPlaceholder}
          aria-label="jev-api-key"
          onChange={e => setDraft(e.target.value)}
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || !draft.trim()}
            onClick={() => { void submit({ apiKey: draft.trim() }); }}
          >
            {busy
              ? <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" />{ds.connectorSaving}</span>
              : ds.jevSaveBtn}
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={busy || snapshot?.keySource !== 'config'}
            title={snapshot?.keySource === 'env' ? ds.jevClearEnvHint : undefined}
            onClick={() => { void submit({ apiKey: '' }); }}
          >
            {ds.jevClearBtn}
          </button>
          {saved && <span className="text-xs text-green-600">{saved}</span>}
          {error && <span className="text-xs text-red-500 truncate max-w-[280px]">{error}</span>}
        </div>
      </Card>
    </Section>
  );
}

function ToolsPane() {
  const { t } = useLocale();
  const ds = t.desktopSettings;
  const labelsRef = useRef(ds);
  labelsRef.current = ds;
  const readGeneration = useRef(0);
  const [readError, setReadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<ConnectorsConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draft, setDraft] = useState<ConnectorsConfig | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const load = useCallback(async () => {
    const generation = ++readGeneration.current;
    setRefreshing(true);
    try {
      const snap = await api.getConnectorsConfig();
      if (generation !== readGeneration.current) return;
      if (!snap) throw Error('connectors_projection_unavailable');
      setSnapshot(snap);
      setDraft(current => current ?? snap.config);
      setReadError('');
    } catch (failure) {
      if (generation === readGeneration.current) setReadError(connectorsErrorMessage(failure, labelsRef.current, true));
    } finally {
      if (generation === readGeneration.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);
  useEffect(() => { void load(); return () => { readGeneration.current++; }; }, [load]);

  const runtimeOf = useCallback((name: string): ConnectorsProviderRuntime | undefined => {
    return snapshot?.providers.find(p => p.provider_name === name);
  }, [snapshot]);

  const handleSave = async () => {
    if (!draft) return;
    const submitted = draft;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const next = await api.saveConnectorsConfig(submitted);
      if (next) {
        // Acknowledged save supersedes reads begun before this commit.
        readGeneration.current++;
        setRefreshing(false);
        setReadError('');
        setSnapshot(next);
        if (draftRef.current === submitted) {
          setDraft(next.config);
          setSuccess(t.desktopSettings.connectorSaved);
        }
      } else {
        setError(t.desktopSettings.connectorSaveFailedNoDesktop);
      }
    } catch (e) {
      setError(connectorsErrorMessage(e, ds));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--c-text-secondary)]" />
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="text-sm text-[var(--c-text-secondary)]">
        {readError || t.desktopSettings.connectorLoadFailed}
        <button type="button" className={btnSecondary} disabled={refreshing} onClick={() => { void load(); }}>{ds.connectorRefreshData}</button>
      </div>
    );
  }

  const search = draft.search;
  const fetchCfg = draft.fetch;

  return (
    <>
      <Section key="connectors-overview">
        <SectionHeader icon={Wrench}>{t.desktopSettings.networkTools}</SectionHeader>
        <div className="text-xs text-[var(--c-text-secondary)] mb-3">
          {t.desktopSettings.networkToolsDesc}
        </div>
        <div aria-live="polite">{readError && <div className="text-xs text-red-500">{readError}</div>}</div>
        <button type="button" className={btnSecondary} disabled={refreshing} onClick={() => { void load(); }}>{ds.connectorRefreshData}</button>
        {snapshot?.loadStatus === 'parse_failed' && (
          <div className="mb-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
            {t.desktopSettings.connectorConfigParseError}
          </div>
        )}
      </Section>

      <Section key="connectors-search">
        <SectionHeader icon={Search}>{t.desktopSettings.searchProviderTitle}</SectionHeader>
        <div className="flex flex-col gap-3">
          {SEARCH_PROVIDERS.map(opt => {
            const checked = search.provider === opt.key;
            const disabled = !!opt.notImplemented;
            const runtime = runtimeOf(`web_search.${opt.key}`);
            return (
              <Card key={opt.key} className={disabled ? 'opacity-60' : ''}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="search-provider"
                    value={opt.key}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => setDraft(d => d ? { ...d, search: { ...d.search, provider: opt.key } } : d)}
                    className="mt-1"
                    aria-label={`search-${opt.key}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{opt.label}</span>
                      <RuntimeBadge runtime={runtime} ds={t.desktopSettings} />
                    </div>
                    <div className="mt-1 text-xs text-[var(--c-text-secondary)]">{t.desktopSettings[opt.descKey]}</div>
                    {checked && opt.key === 'tavily' && (
                      <ApiKeyInput
                        ariaLabel="tavily-api-key"
                        placeholder={t.desktopSettings.tavilyApiKeyPlaceholder}
                        storedValue={search.tavilyApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, search: { ...d.search, tavilyApiKey: v } } : d)}
                        ds={t.desktopSettings}
                      />
                    )}
                    {checked && opt.key === 'brave' && (
                      <ApiKeyInput
                        ariaLabel="brave-api-key"
                        placeholder={t.desktopSettings.braveApiKeyPlaceholder}
                        storedValue={search.braveApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, search: { ...d.search, braveApiKey: v } } : d)}
                        ds={t.desktopSettings}
                      />
                    )}
                    {checked && opt.key === 'firecrawl' && (
                      <ApiKeyInput
                        ariaLabel="firecrawl-search-api-key"
                        placeholder={t.desktopSettings.firecrawlApiKeyPlaceholder}
                        storedValue={search.firecrawlApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, search: { ...d.search, firecrawlApiKey: v } } : d)}
                        ds={t.desktopSettings}
                      />
                    )}
                  </div>
                </label>
              </Card>
            );
          })}
        </div>
        <TestButton kind="search" ds={t.desktopSettings} />
      </Section>

      <Section key="connectors-fetch">
        <SectionHeader icon={LinkIcon}>{t.desktopSettings.fetchProviderTitle}</SectionHeader>
        <div className="flex flex-col gap-3">
          {FETCH_PROVIDERS.map(opt => {
            const checked = fetchCfg.provider === opt.key;
            const disabled = !!opt.notImplemented;
            const runtime = runtimeOf(`web_fetch.${opt.key}`);
            return (
              <Card key={opt.key} className={disabled ? 'opacity-60' : ''}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="fetch-provider"
                    value={opt.key}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => setDraft(d => d ? { ...d, fetch: { ...d.fetch, provider: opt.key } } : d)}
                    className="mt-1"
                    aria-label={`fetch-${opt.key}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{opt.label}</span>
                      <RuntimeBadge runtime={runtime} ds={t.desktopSettings} />
                    </div>
                    <div className="mt-1 text-xs text-[var(--c-text-secondary)]">{t.desktopSettings[opt.descKey]}</div>
                    {checked && opt.key === 'jina' && (
                      <ApiKeyInput
                        ariaLabel="jina-api-key"
                        placeholder={t.desktopSettings.jinaApiKeyPlaceholder}
                        storedValue={fetchCfg.jinaApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, fetch: { ...d.fetch, jinaApiKey: v } } : d)}
                        ds={t.desktopSettings}
                      />
                    )}
                    {checked && opt.key === 'firecrawl' && (
                      <ApiKeyInput
                        ariaLabel="firecrawl-fetch-api-key"
                        placeholder={t.desktopSettings.firecrawlApiKeyPlaceholder}
                        storedValue={fetchCfg.firecrawlApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, fetch: { ...d.fetch, firecrawlApiKey: v } } : d)}
                        ds={t.desktopSettings}
                      />
                    )}
                  </div>
                </label>
              </Card>
            );
          })}
        </div>
        <TestButton kind="fetch" ds={t.desktopSettings} />
      </Section>

      <Section>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={btnPrimary}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" />{t.desktopSettings.connectorSaving}</span> : t.desktopSettings.connectorSaveBtn}
          </button>
          {success && <span className="text-xs text-green-600">{success}</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </Section>

      <SystemOneSection />
    </>
  );
}

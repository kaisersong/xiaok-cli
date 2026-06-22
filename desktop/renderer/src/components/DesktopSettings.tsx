import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  ChevronLeft,
  Settings,
  Cpu,
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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { LocalMemoryStatsCard } from './settings/LocalMemoryStatsCard';
import { MemoryModelSettings } from './settings/MemoryModelSettings';
import { McpErrorRemediationBanner } from './settings/McpErrorRemediationBanner';
import { DesktopAppearanceSettings } from './settings/DesktopAppearanceSettings';
import type {
  DesktopModelConfigSnapshot,
  DesktopRelatedServiceId,
  DesktopRelatedServiceStatus,
  DesktopSaveModelConfigInput,
  DesktopServiceStatusSnapshot,
  TestProviderConnectionResult,
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

type SettingsTab = 'model' | 'skills' | 'channels' | 'mcp' | 'tools' | 'general' | 'appearance' | 'data' | 'memory' | 'about';

interface NavItem {
  key: SettingsTab;
  icon: typeof Settings;
  label: string;
}

function getNavItems(t: ReturnType<typeof useLocale>['t']): NavItem[] {
  return [
    { key: 'general', icon: SlidersHorizontal, label: t.desktopSettings.navGeneral },
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

// ---- Model Settings ----

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

  useEffect(() => {
    api.getModelConfig()
      .then(c => {
        setConfig(c);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!selectedProvider || !apiKey.trim()) return;
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
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (providerId: string) => {
    if (!providerId) return;
    setTesting(prev => ({ ...prev, [providerId]: true }));
    setError('');
    try {
      const result = await api.testProviderConnection({ providerId });
      setTestResults(prev => ({ ...prev, [providerId]: result }));
      if (result.success) {
        setSuccess(t.desktopSettings.connectionSuccessLatency(result.latencyMs ?? 0));
      } else {
        setError(result.error || t.desktopSettings.connectionFailed);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(prev => ({ ...prev, [providerId]: false }));
    }
  };

  const handleAddModel = async (modelId: string) => {
    if (!config) return;
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
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomModel = async (providerId: string, modelName: string) => {
    if (!config || !modelName.trim()) return;
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
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefaultModel = async (modelId: string) => {
    if (!config || config.defaultModelId === modelId) return;
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
      setSuccess(t.desktopSettings.modelSwitched(model.label));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    if (!confirm(t.desktopSettings.confirmDeleteModel)) return;
    try {
      await api.deleteModel(modelId);
      const updated = await api.getModelConfig();
      setConfig(updated);
      setSuccess(t.desktopSettings.modelDeleted);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!confirm(t.desktopSettings.confirmDeleteProvider)) return;
    try {
      await api.deleteProvider(providerId);
      const updated = await api.getModelConfig();
      setConfig(updated);
      if (selectedProvider === providerId && updated.providers.length > 0) {
        setSelectedProvider(updated.providers[0].id);
      }
      setSuccess(t.desktopSettings.providerDeleted);
    } catch (e) {
      setError((e as Error).message);
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
        {(() => {
          const currentModel = config?.models.find(m => m.id === config.defaultModelId) ?? config?.models.find(m => m.isDefault);
          const currentProvider = currentModel ? config?.providers.find(p => p.id === currentModel.provider) : null;
          if (!currentModel) return null;
          return (
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
            </Card>
          );
        })()}
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
                      {provider.type === 'custom' && (
                        <button type="button"
                          onClick={() => handleDeleteProvider(provider.id)}
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
                          disabled={saving || !apiKey.trim()}
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
                                disabled={saving}
                                className="ml-1 rounded px-1 text-[10px] text-[var(--c-accent)] hover:bg-[var(--c-accent)]/10 disabled:opacity-50"
                              >
                                {t.desktopSettings.setAsDefault}
                              </button>
                            )}
                            <button type="button"
                              onClick={() => handleDeleteModel(m.id)}
                              className="ml-1 hover:text-red-500"
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
                                      disabled={saving}
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
                                  disabled={saving || !customModelInput.trim()}
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
  onAdded,
  onError,
}: {
  config: DesktopModelConfigSnapshot | null;
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
    if (!selectedProfileId) return;
    if (isCustom && !customName.trim()) {
      onError(t.desktopSettings.customNameRequired);
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      onError(t.desktopSettings.customBaseUrlRequired);
      return;
    }
    setSaving(true);
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
      onError((e as Error).message);
    } finally {
      setSaving(false);
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
                disabled={saving}
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
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [installName, setInstallName] = useState('');
  const [showInstall, setShowInstall] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [statsMap, setStatsMap] = useState<Map<string, { totalCalls: number; successCount: number; avgDurationMs: number; totalInputTokens: number; totalOutputTokens: number }>>(new Map());

  useEffect(() => {
    api.listSkills()
      .then(setSkills)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.getSkillStats()
      .then(stats => {
        setStatsMap(new Map(stats.map(s => [s.skillName, s])));
      })
      .catch(() => {});
  }, []);

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
        const updated = await api.listSkills();
        setSkills(updated);
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
        const updated = await api.listSkills();
        setSkills(updated);
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstalling(false);
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
        <SectionHeader icon={Puzzle}>{t.desktopSettings.installedSkills(skills.length)}</SectionHeader>
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
          {skills.length === 0 ? (
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
                            {t.desktopSettings.skillStats(stats.totalCalls, Math.round(stats.avgDurationMs / 1000))}
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
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);
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

  const load = () => {
    api.listChannels()
      .then(setChannels)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

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
      <Section>
        <SectionHeader icon={Globe}>{ts.channelsTitle}</SectionHeader>
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
          {channels.length === 0 ? (
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

interface PluginDependencyStatus {
  pluginName: string;
  dependencyId: string;
  displayName: string;
  pluginInstalled?: boolean;
  state: 'ready' | 'missing' | 'needs_permission' | 'degraded' | 'unsupported';
  code: string;
  resolvedBinary?: string;
  version?: string;
  detail?: string;
  canInstall: boolean;
  canUpdate: boolean;
  canDiagnose: boolean;
}

function McpPane() {
  const { t } = useLocale();
  const ts = t.desktopSettings;
  const [installs, setInstalls] = useState<MCPInstallConfig[]>([]);
  const [pluginServers, setPluginServers] = useState<Array<{ name: string; pluginName: string; toolCount: number; connected: boolean; enabled: boolean; lastError?: string; lastErrorDetail?: { category: 'python_version_too_old' | 'python_module_missing' | null; message: string; detectedVersion?: string; requiredVersion?: string; command?: string; missingModule?: string } }>>([]);
  const [dependencies, setDependencies] = useState<PluginDependencyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [dependencyAction, setDependencyAction] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api.listMCPInstalls().catch(() => []),
      api.listPluginMcpServers().catch(() => []),
      api.listPluginDependencyStatuses().catch(() => []),
    ]).then(([mcpInstalls, plugins, dependencyStatuses]) => {
      setInstalls(mcpInstalls);
      setPluginServers(plugins);
      setDependencies(dependencyStatuses);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2_000);
    return () => clearInterval(timer);
  }, [load]);

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

  const handleRestartPluginMcpServers = async () => {
    const actionKey = 'plugin-mcp:restart';
    setDependencyAction(actionKey);
    try {
      await api.restartPluginMcpServers();
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
                          onClick={() => void (isComputerUse ? handleEnableComputerUse() : handleRestartPluginMcpServers())}
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
          {installs.length === 0 ? (
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
  const [runningLoopId, setRunningLoopId] = useState<string | null>(null);
  const [loopOutputPreviews, setLoopOutputPreviews] = useState<Record<string, LoopOutputPreviewView | undefined>>({});
  const [previewingLoopId, setPreviewingLoopId] = useState<string | null>(null);
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
  const loadLoops = useCallback(async (silent = false) => {
    if (!silent) setLoopDiagnosticsLoading(true);
    setLoopDiagnosticsError('');
    try {
      const [definitions, templates, scheduleBindings] = await Promise.all([
        api.getLoopDefinitions(),
        api.listUserLoopTemplates(),
        api.getLoopScheduleBindings().catch(() => [] as LoopScheduleBindingView[]),
      ]);
      const details = await Promise.all(definitions.map(async (loop) => {
        const [runs, anomalies] = await Promise.all([
          api.getLoopRuns(loop.id),
          api.getEvidenceAnomalies(loop.id).catch(() => [] as EvidenceAnomalyView[]),
        ]);
        return { loop, runs, anomalies };
      }));
      setLoopDefinitions(definitions);
      setUserLoopTemplates(templates);
      setLoopScheduleBindings(Object.fromEntries(scheduleBindings.map(binding => [binding.loopId, binding])));
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
      setLoopDiagnosticsError(error instanceof Error ? error.message : t.desktopSettings.loopDiagnosticsLoadError);
    } finally {
      if (!silent) setLoopDiagnosticsLoading(false);
    }
  }, [t.desktopSettings.loopDiagnosticsLoadError]);

  useEffect(() => {
    void loadLoops();
  }, [loadLoops]);

  useEffect(() => {
    if (loopDiagnosticsLoading) return;
    const hash = window.location.hash;
    if (!hash || !hash.startsWith('#loop-')) return;
    const el = document.getElementById(hash.slice(1));
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
  }, [loopDiagnosticsLoading]);

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
      setLoopDiagnosticsError(error instanceof Error ? error.message : t.desktopSettings.loopDiagnosticsRunFailed);
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
    setPreviewingLoopId(loopId);
    try {
      const result = await api.readLoopOutputPreview(loopId);
      setLoopOutputPreviews(prev => ({ ...prev, [loopId]: result }));
      if (!result.ok) {
        showToast(result.message || t.desktopSettings.userLoopOutputPreviewUnavailable);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : t.desktopSettings.userLoopOutputPreviewUnavailable);
    } finally {
      setPreviewingLoopId(null);
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
      showToast(error instanceof Error ? error.message : t.desktopSettings.saveLoopFailed);
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
      showToast(error instanceof Error ? error.message : t.desktopSettings.deleteLoopFailed);
    }
  };

  const handleCopyLoopDiagnostics = async (
    loop: LoopDefinitionView,
    runs: LoopRunView[],
    anomalies: EvidenceAnomalyView[],
  ) => {
    try {
      const summary = buildLoopDiagnosticsSummary({ loop, runs, anomalies });
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
    const input: CreateUserLoopTemplateInputView = {
      loopId: createUserLoopId(),
      title: newLoopTitle.trim(),
      kind: newLoopKind,
      prompt: newLoopPrompt.trim(),
      ...(newLoopKind === 'markdown_file' ? {
        outputDirectory: newLoopOutputDirectory.trim(),
        outputFileName: newLoopOutputFileName.trim(),
      } : {}),
    };
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
      setCreateLoopError(error instanceof Error ? error.message : t.desktopSettings.userLoopCreateFailed);
    } finally {
      setCreatingLoop(false);
    }
  };

  const handleCreateFromTemplate = async (template: UserLoopStarterTemplate) => {
    const input: CreateUserLoopTemplateInputView = {
      loopId: createUserLoopId(),
      title: template.title,
      kind: template.kind,
      prompt: template.prompt,
      ...(template.kind === 'markdown_file' ? {
        outputDirectory: template.outputDirectory ?? '',
        outputFileName: template.outputFileName ?? 'output.md',
      } : {}),
    };
    try {
      console.log('[LoopsPane] creating from template', { templateId: template.templateId });
      await api.createUserLoopTemplate(input);
      showToast(t.desktopSettings.createdFromTemplate(template.title), 'success');
      await loadLoops(true);
    } catch (error) {
      console.error('[LoopsPane] create from template failed', error);
      showToast(error instanceof Error ? error.message : t.desktopSettings.createFromTemplateFailed);
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
                    <input
                      aria-label={t.desktopSettings.userLoopOutputDirectoryLabel}
                      type="text"
                      value={newLoopOutputDirectory}
                      onChange={(event) => setNewLoopOutputDirectory(event.target.value)}
                      className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                    />
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
          ) : userLoops.length === 0 ? (
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
                const outputPreview = loopOutputPreviews[template.loopId];
                const scheduleBinding = loopScheduleBindings[template.loopId];
                const runResult = loopRunResults[template.loopId];
                const isAlreadyRunning = !!definition?.activeRunId || runResult?.status === 'already_running';
                const buttonLabel = isRunning
                  ? t.desktopSettings.loopDiagnosticsRunning
                  : isAlreadyRunning
                    ? t.desktopSettings.loopDiagnosticsAlreadyRunning
                    : t.desktopSettings.loopDiagnosticsRunNow;
                return (
                  <div key={template.loopId} id={`loop-${template.loopId}`} className="rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-page)] p-3 scroll-mt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--c-text-heading)]">{loopTitle}</div>
                        {definition?.description ? (
                          <div className="mt-0.5 text-xs text-[var(--c-text-secondary)]">{definition.description}</div>
                        ) : null}
                        <div className="mt-2 grid gap-1 break-all text-xs text-[var(--c-text-secondary)]">
                          <div>
                            <span className="text-[var(--c-text-tertiary)]">{t.desktopSettings.userLoopOutputDirectoryLabel}: </span>
                            {template.outputDirectory}
                          </div>
                          <div>
                            <span className="text-[var(--c-text-tertiary)]">{t.desktopSettings.userLoopOutputFileNameLabel}: </span>
                            {template.outputFileName}
                          </div>
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
                    {outputPreview ? (
                      <div className="mt-3 rounded-lg border border-[var(--c-border)] bg-[var(--c-bg-card)] p-3">
                        <div className="mb-2 text-xs font-medium text-[var(--c-text-secondary)]">
                          {t.desktopSettings.userLoopOutputPreview}
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
                                <input type="text" value={editLoopOutputDir} onChange={e => setEditLoopOutputDir(e.target.value)} className="rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1.5 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]" />
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
                    : t.desktopSettings.loopDiagnosticsRunNow;

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

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-[var(--c-bg-card)] p-2">
                        <div className="text-[var(--c-text-tertiary)]">{t.desktopSettings.loopDiagnosticsLastRun}</div>
                        <div className="mt-1 text-[var(--c-text-primary)]">
                          {latestRun
                            ? `${getLoopRunStatusLabel(latestRun.status)} · ${formatLoopRunTime(latestRun)}`
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
  const [serviceStatus, setServiceStatus] = useState<DesktopServiceStatusSnapshot | null>(null);
  const [serviceStatusLoading, setServiceStatusLoading] = useState(true);
  const [serviceStatusError, setServiceStatusError] = useState('');
  const [restartingService, setRestartingService] = useState<DesktopRelatedServiceId | null>(null);
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('xiaok_display_name') || '');
  const [avatarUrl, setAvatarUrl] = useState(() => localStorage.getItem('xiaok_avatar_url') || '');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const loadServiceStatus = useCallback(async (silent = false) => {
    if (!silent) setServiceStatusLoading(true);
    setServiceStatusError('');
    try {
      setServiceStatus(await api.getServiceStatus());
    } catch (error) {
      setServiceStatusError(error instanceof Error ? error.message : t.desktopSettings.serviceStatusLoadError);
    } finally {
      if (!silent) setServiceStatusLoading(false);
    }
  }, [t]);

  useEffect(() => {
    api.getSkillDebugConfig().then(c => {
      setSkillDebug(c.enabled);
    });
  }, []);

  useEffect(() => {
    void loadServiceStatus();
    const timer = window.setInterval(() => {
      void loadServiceStatus(true);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [loadServiceStatus]);

  const handleSkillDebugToggle = async (enabled: boolean) => {
    setSkillDebug(enabled);
    setSavingSkillDebug(true);
    try {
      await api.saveSkillDebugConfig({ enabled });
    } finally {
      setSavingSkillDebug(false);
    }
  };

  useEffect(() => {
    api.getKswarmConfig().then(c => {
      setMaxConcurrentTasks(c.maxConcurrentTasks);
    });
  }, []);

  const handleConcurrencyChange = async (value: number) => {
    const clamped = Math.max(1, Math.min(10, value));
    setMaxConcurrentTasks(clamped);
    setSavingConcurrency(true);
    try {
      await api.saveKswarmConfig({ maxConcurrentTasks: clamped });
    } finally {
      setSavingConcurrency(false);
    }
  };

  const handleRestartService = async (serviceId: DesktopRelatedServiceId) => {
    setRestartingService(serviceId);
    setServiceStatusError('');
    try {
      await api.restartRelatedService(serviceId);
      await loadServiceStatus(true);
    } catch (error) {
      setServiceStatusError(error instanceof Error ? error.message : t.desktopSettings.serviceRestartFailed);
    } finally {
      setRestartingService(null);
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
                onRestart={handleRestartService}
              />
            ))}
            {serviceStatusError ? (
              <div className="rounded-md border border-[var(--c-status-error-text)]/20 bg-[var(--c-status-error-bg,#fef2f2)] px-3 py-2 text-xs text-[var(--c-status-error-text)]">
                {serviceStatusError}
              </div>
            ) : null}
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
              onChange={(e) => handleConcurrencyChange(Number(e.target.value))}
              className="flex-1 accent-[var(--c-accent)]"
            />
            <span className="min-w-[2.5rem] text-center text-sm font-medium text-[var(--c-text-heading)]">
              {maxConcurrentTasks}
            </span>
            {savingConcurrency && <Loader2 size={14} className="animate-spin text-[var(--c-text-tertiary)]" />}
          </div>
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
    </>
  );
}

function ServiceStatusRow({
  service,
  restarting,
  onRestart,
}: {
  service: DesktopRelatedServiceStatus;
  restarting: boolean;
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
        disabled={restarting}
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

  useEffect(() => {
    const unsub = api.onUpdateStatus(setUpdateStatus);
    api.getUpdateStatus().then(setUpdateStatus).catch(() => {});
    return unsub;
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      await api.checkForUpdates();
    } finally {
      setChecking(false);
    }
  };

  const handleInstallUpdate = async () => {
    await api.quitAndInstall();
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
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Zap}>{t.desktopSettings.softwareUpdate}</SectionHeader>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">
                {updateStatus?.installing ? t.desktopSettings.aboutInstalling : updateStatus?.downloaded ? t.desktopSettings.aboutUpdateReady : updateStatus?.downloading ? t.desktopSettings.aboutDownloading : updateStatus?.available ? t.desktopSettings.aboutNewVersion : t.desktopSettings.aboutCurrentVersion}
              </div>
              <div className="text-xs text-[var(--c-text-secondary)] mt-1">
                {updateStatus?.installing ? t.desktopSettings.aboutInstallingVersion(updateStatus.version || '') :
                 updateStatus?.downloaded ? t.desktopSettings.aboutDownloadedVersion(updateStatus.version || '') :
                 updateStatus?.downloading ? t.desktopSettings.aboutDownloadProgress(updateStatus.progress) :
                 updateStatus?.available ? t.desktopSettings.aboutVersionAvailable(updateStatus.version || '') :
                 updateStatus?.checking || checking ? t.desktopSettings.aboutChecking :
                 `v${__APP_VERSION__}`}
              </div>
              {updateStatus?.error && (
                <div className="text-xs text-red-500 mt-1">{updateStatus.error}</div>
              )}
            </div>
            <div className="flex gap-2">
              {updateStatus?.downloaded ? (
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
      setResult({ success: false, latencyMs: 0, error: (e as Error).message });
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

function ToolsPane() {
  const { t } = useLocale();
  const [snapshot, setSnapshot] = useState<ConnectorsConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [draft, setDraft] = useState<ConnectorsConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getConnectorsConfig()
      .then(snap => {
        if (cancelled) return;
        setSnapshot(snap);
        if (snap?.config) setDraft(snap.config);
      })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const runtimeOf = useCallback((name: string): ConnectorsProviderRuntime | undefined => {
    return snapshot?.providers.find(p => p.provider_name === name);
  }, [snapshot]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const next = await api.saveConnectorsConfig(draft);
      if (next) {
        setSnapshot(next);
        setDraft(next.config);
        setSuccess(t.desktopSettings.connectorSaved);
      } else {
        setError(t.desktopSettings.connectorSaveFailedNoDesktop);
      }
    } catch (e) {
      setError((e as Error).message);
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
        {t.desktopSettings.connectorLoadFailed}{error && <div className="mt-2 text-red-500">{error}</div>}
      </div>
    );
  }

  const search = draft.search;
  const fetchCfg = draft.fetch;

  return (
    <>
      <Section>
        <SectionHeader icon={Wrench}>{t.desktopSettings.networkTools}</SectionHeader>
        <div className="text-xs text-[var(--c-text-secondary)] mb-3">
          {t.desktopSettings.networkToolsDesc}
        </div>
        {snapshot?.loadStatus === 'parse_failed' && (
          <div className="mb-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
            {t.desktopSettings.connectorConfigParseError}
          </div>
        )}
      </Section>

      <Section>
        <SectionHeader icon={Search}>{t.desktopSettings.searchProviderTitle}</SectionHeader>
        <div className="flex flex-col gap-3">
          {SEARCH_PROVIDERS.map(opt => {
            const checked = search.provider === opt.key;
            const disabled = !!opt.notImplemented;
            const runtime = runtimeOf(opt.key);
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

      <Section>
        <SectionHeader icon={LinkIcon}>{t.desktopSettings.fetchProviderTitle}</SectionHeader>
        <div className="flex flex-col gap-3">
          {FETCH_PROVIDERS.map(opt => {
            const checked = fetchCfg.provider === opt.key;
            const disabled = !!opt.notImplemented;
            const runtime = runtimeOf(opt.key);
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
    </>
  );
}

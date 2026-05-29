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
  RefreshCw,
} from 'lucide-react';
import { api } from '../api';
import { LocalMemoryStatsCard } from './settings/LocalMemoryStatsCard';
import { MemoryModelSettings } from './settings/MemoryModelSettings';
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
} from '../api/types';
import { useLocale } from '../contexts/LocaleContext';

type SettingsTab = 'model' | 'skills' | 'channels' | 'mcp' | 'tools' | 'general' | 'appearance' | 'data' | 'memory' | 'about';

interface NavItem {
  key: SettingsTab;
  icon: typeof Settings;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'general', icon: SlidersHorizontal, label: '通用设置' },
  { key: 'model', icon: Cpu, label: '模型设置' },
  { key: 'skills', icon: Puzzle, label: '技能管理' },
  { key: 'channels', icon: Globe, label: '消息通道' },
  { key: 'mcp', icon: Plug, label: 'MCP 服务器' },
  { key: 'tools', icon: Wrench, label: '工具管理' },
  { key: 'appearance', icon: Palette, label: '外观设置' },
  { key: 'data', icon: HardDrive, label: '数据管理' },
  { key: 'memory', icon: Brain, label: '记忆管理' },
  { key: 'about', icon: Info, label: '关于' },
];

interface Props {
  onClose: () => void;
}

export function DesktopSettings({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

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
            <span>返回</span>
          </button>
        </div>
        <div className="px-3">
          <div className="flex flex-col gap-[2px]">
            {NAV_ITEMS.map(({ key, icon: Icon, label }) => (
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
                <span>{label}</span>
              </button>
            ))}
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
          {activeTab === 'appearance' && <AppearancePane />}
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
      setSuccess(`已更新 ${updated.providers.find(p => p.id === selectedProvider)?.label} 的 API Key`);
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
        setSuccess(`连接成功，延迟 ${result.latencyMs}ms`);
      } else {
        setError(result.error || '连接失败');
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
      setSuccess(`已添加模型 ${foundModel.label}`);
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
      setSuccess(`当前模型已切换为 ${model.label}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    if (!confirm('确定删除此模型配置？')) return;
    try {
      await api.deleteModel(modelId);
      const updated = await api.getModelConfig();
      setConfig(updated);
      setSuccess('模型已删除');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!confirm('确定删除此提供商配置？')) return;
    try {
      await api.deleteProvider(providerId);
      const updated = await api.getModelConfig();
      setConfig(updated);
      if (selectedProvider === providerId && updated.providers.length > 0) {
        setSelectedProvider(updated.providers[0].id);
      }
      setSuccess('提供商已删除');
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
        <SectionHeader icon={Cpu}>模型提供商</SectionHeader>
        {(() => {
          const currentModel = config?.models.find(m => m.id === config.defaultModelId) ?? config?.models.find(m => m.isDefault);
          const currentProvider = currentModel ? config?.providers.find(p => p.id === currentModel.provider) : null;
          if (!currentModel) return null;
          return (
            <Card className="mb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-[var(--c-text-secondary)]">当前使用模型</div>
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
                          <Check size={12} /> 已配置
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-xs text-yellow-600">
                          <AlertCircle size={12} /> 未配置
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-[var(--c-text-secondary)]">
                      协议: {provider.protocol}
                      {provider.baseUrl && ` · ${provider.baseUrl}`}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      <button type="button"
                        onClick={() => handleTest(provider.id)}
                        disabled={testing[provider.id]}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors disabled:opacity-50"
                      >
                        {testing[provider.id] ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                        测试连接
                      </button>
                      <button type="button"
                        onClick={() => { setSelectedProvider(prev => prev === provider.id ? '' : provider.id); setApiKey(''); }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
                      >
                        <Edit3 size={12} /> {provider.apiKeyConfigured ? '更新 Key' : '设置 Key'}
                      </button>
                      {testResult && (
                        <span className={`text-xs truncate max-w-[200px] ${testResult.success ? 'text-green-600' : 'text-red-500'}`}>
                          {testResult.success
                            ? `延迟 ${testResult.latencyMs}ms`
                            : testResult.error}
                        </span>
                      )}
                      {provider.type === 'custom' && (
                        <button type="button"
                          onClick={() => handleDeleteProvider(provider.id)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={12} /> 删除
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
                          {saving ? '...' : '保存'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {/* Model list */}
                {config?.models && (
                  <div className="mt-3 pt-3 border-t border-[var(--c-border-subtle)]">
                    <div className="text-xs text-[var(--c-text-secondary)] mb-1.5">已配置模型</div>
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
                            {config.defaultModelId === m.id && ' (默认)'}
                            {config.defaultModelId !== m.id && (
                              <button type="button"
                                onClick={() => void handleSetDefaultModel(m.id)}
                                disabled={saving}
                                className="ml-1 rounded px-1 text-[10px] text-[var(--c-accent)] hover:bg-[var(--c-accent)]/10 disabled:opacity-50"
                              >
                                设为默认
                              </button>
                            )}
                            <button type="button"
                              onClick={() => handleDeleteModel(m.id)}
                              className="ml-1 hover:text-red-500"
                              title="删除模型"
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
                      if (addable.length === 0) return null;
                      return (
                        <div className="mt-2">
                          <button type="button"
                            onClick={() => setShowAddModel(prev => prev === provider.id ? '' : provider.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
                          >
                            <Plus size={12} /> 添加模型
                          </button>
                          {showAddModel === provider.id && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
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
        <SectionHeader icon={Plus}>添加模型提供商</SectionHeader>
        <AddProviderCard
          config={config}
          onAdded={(updated) => {
            setConfig(updated);
            setSuccess('提供商已添加');
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
      onError('请输入自定义提供商名称');
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      onError('自定义提供商需要 Base URL');
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
          <label htmlFor="desktop-model-provider-profile" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">选择提供商</label>
          <select
            id="desktop-model-provider-profile"
            value={selectedProfileId}
            onChange={e => handleProfileChange(e.target.value)}
            className={inputCls}
          >
            <option value="">— 选择提供商 —</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.label}{configuredIds.has(p.id) ? ' (已配置)' : ''}
              </option>
            ))}
            <option value="__custom__">自定义 (OpenAI 兼容)</option>
          </select>
        </div>

        {isCustom && (
          <div>
            <label htmlFor="desktop-custom-provider-name" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">提供商名称</label>
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
              <label htmlFor="desktop-provider-base-url" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">Base URL</label>
              <input
                id="desktop-provider-base-url"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="desktop-provider-api-key" className="block text-xs text-[var(--c-text-secondary)] mb-1.5">API Key</label>
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
                <div className="block text-xs text-[var(--c-text-secondary)] mb-1.5">可用模型</div>
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
                <span className="mt-1 block text-[11px] text-[var(--c-text-muted)]">添加后默认模型: {selectedProfile.defaultModelLabel}</span>
              </div>
            )}

            {!isCustom && selectedProfile && (
              <div className="text-[11px] text-[var(--c-text-muted)]">
                协议: {selectedProfile.protocol}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button type="button"
                onClick={handleAdd}
                disabled={saving}
                className={btnPrimary}
              >
                {saving ? '添加中...' : '添加提供商'}
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function SkillsPane() {
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
    if (!confirm(`确定卸载技能 "${skillName}"？`)) return;
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
        <SectionHeader icon={Puzzle}>已安装技能 ({skills.length})</SectionHeader>
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
          技能扩展了 xiaok 的能力，可以通过输入 /技能名 来使用。
        </p>

        {/* Install button */}
        <button type="button"
          onClick={() => setShowInstall(!showInstall)}
          className="inline-flex items-center gap-2 mb-4 rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
        >
          <Plus size={16} />
          安装技能
        </button>

        {/* Install form */}
        {showInstall && (
          <Card className="mb-4">
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="desktop-install-skill-name" className="block text-xs text-[var(--c-text-secondary)] mb-1">技能名称</label>
                <input
                  id="desktop-install-skill-name"
                  type="text"
                  value={installName}
                  onChange={e => setInstallName(e.target.value)}
                  placeholder="例如: code-review"
                  className={inputCls}
                />
              </div>
              <div className="text-xs text-[var(--c-text-secondary)]">
                安装命令: <code className="bg-[var(--c-bg-deep)] px-1.5 py-0.5 rounded">clawhub install {installName || '<技能名>'}</code>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleInstall} disabled={installing || !installName.trim()} className={btnPrimary}>
                  {installing ? '安装中...' : '确认安装'}
                </button>
                <button type="button" onClick={() => setShowInstall(false)} className={btnSecondary}>取消</button>
              </div>
            </div>
          </Card>
        )}

        <div className="flex flex-col gap-2">
          {skills.length === 0 ? (
            <Card>
              <div className="flex items-center gap-3 text-sm text-[var(--c-text-secondary)]">
                <Info size={16} />
                暂无已安装的技能。使用 <code className="bg-[var(--c-bg-deep)] px-1.5 py-0.5 rounded">clawhub install &lt;技能名&gt;</code> 安装
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
                            {stats.totalCalls} 次调用 · 平均 {Math.round(stats.avgDurationMs / 1000)}s
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
                      title="卸载"
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
        <SectionHeader>技能来源</SectionHeader>
        <Card>
          <div className="text-xs text-[var(--c-text-secondary)]">
            技能来自 ClawHub 技能市场。使用以下命令管理技能:
            <div className="mt-2 flex flex-col gap-1 font-mono">
              <code className="bg-[var(--c-bg-deep)] px-2 py-1 rounded">clawhub search &lt;关键词&gt;</code>
              <code className="bg-[var(--c-bg-deep)] px-2 py-1 rounded">clawhub install &lt;技能名&gt;</code>
              <code className="bg-[var(--c-bg-deep)] px-2 py-1 rounded">clawhub uninstall &lt;技能名&gt;</code>
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

// Channel type specific configuration fields
const CHANNEL_TYPE_CONFIG: Record<string, { label: string; fields: Array<{ key: string; label: string; placeholder: string; required?: boolean }> }> = {
  yunzhijia: {
    label: '云之家',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: '应用ID', required: true },
      { key: 'appSecret', label: 'App Secret', placeholder: '应用密钥', required: true },
      { key: 'token', label: 'Token', placeholder: '访问令牌' },
    ],
  },
  feishu: {
    label: '飞书',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: '飞书应用ID', required: true },
      { key: 'appSecret', label: 'App Secret', placeholder: '飞书应用密钥', required: true },
    ],
  },
  discord: {
    label: 'Discord',
    fields: [
      { key: 'botToken', label: 'Bot Token', placeholder: 'Discord Bot Token', required: true },
      { key: 'chatId', label: 'Channel ID', placeholder: '频道ID (可选)' },
    ],
  },
  weixin: {
    label: '微信',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: '微信公众号/企业微信AppID', required: true },
      { key: 'appSecret', label: 'App Secret', placeholder: '应用密钥', required: true },
      { key: 'token', label: 'Token', placeholder: '消息推送Token' },
    ],
  },
  qq: {
    label: 'QQ',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: 'QQ机器人AppID', required: true },
      { key: 'appSecret', label: 'App Secret', placeholder: 'App Secret', required: true },
    ],
  },
  telegram: {
    label: 'Telegram',
    fields: [
      { key: 'botToken', label: 'Bot Token', placeholder: 'Telegram Bot Token', required: true },
      { key: 'chatId', label: 'Chat ID', placeholder: '群组/频道ID (可选)' },
    ],
  },
};

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
    const typeConfig = CHANNEL_TYPE_CONFIG[newType];
    // Check required fields
    for (const field of typeConfig.fields) {
      if (field.required && !newFields[field.key]?.trim()) {
        alert(`请填写 ${field.label}`);
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
    if (!confirm('确定删除此通道？')) return;
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
        <SectionHeader icon={Globe}>消息通道</SectionHeader>
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
          配置第三方平台接入，让 xiaok 可以在这些平台上提供服务
        </p>

        {/* Add button */}
        <button type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-2 mb-4 rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
        >
          <Plus size={16} />
          添加通道
        </button>

        {/* Add form */}
        {showAdd && (
          <Card className="mb-4">
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="desktop-channel-name" className="block text-xs text-[var(--c-text-secondary)] mb-1">名称</label>
                <input
                  id="desktop-channel-name"
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="例如: 团队通知"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="desktop-channel-type" className="block text-xs text-[var(--c-text-secondary)] mb-1">类型</label>
                <select
                  id="desktop-channel-type"
                  value={newType}
                  onChange={e => setNewType(e.target.value)}
                  className={inputCls}
                >
                  {Object.entries(CHANNEL_TYPE_CONFIG).map(([type, cfg]) => (
                    <option key={type} value={type}>{cfg.label}</option>
                  ))}
                </select>
              </div>
              {/* Type-specific fields */}
              {CHANNEL_TYPE_CONFIG[newType].fields.map(field => (
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
                <button type="button" onClick={handleCreate} className={btnPrimary}>创建</button>
                <button type="button" onClick={() => setShowAdd(false)} className={btnSecondary}>取消</button>
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
                暂无配置的消息通道
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
                        {CHANNEL_TYPE_CONFIG[ch.type]?.label || ch.type} · 创建: {new Date(ch.createdAt).toLocaleDateString()}
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
                            setSuccess(`连接成功，延迟 ${result.latencyMs}ms`);
                          } else {
                            setError(result.error || '连接失败');
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
                      测试
                    </button>
                    <button type="button"
                      onClick={() => handleToggle(ch)}
                      className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                        ch.enabled ? 'bg-green-50 text-green-600' : 'bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]'
                      }`}
                    >
                      {ch.enabled ? '启用中' : '已禁用'}
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
  const [installs, setInstalls] = useState<MCPInstallConfig[]>([]);
  const [pluginServers, setPluginServers] = useState<Array<{ name: string; pluginName: string; toolCount: number; connected: boolean; enabled: boolean; lastError?: string }>>([]);
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
    const confirmed = window.confirm(`${dependency.displayName} 是本机 macOS 自动化组件。安装前请确认你信任该插件来源。`);
    if (!confirmed) return;
    const actionKey = `${dependency.pluginName}:${dependency.dependencyId}:install`;
    setDependencyAction(actionKey);
    try {
      const result = await api.installPluginDependency({
        pluginName: dependency.pluginName,
        dependencyId: dependency.dependencyId,
        confirmed: true,
      });
      if (!result.success) alert(result.error || '安装失败');
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDependencyAction('');
    }
  };

  const handleSetupPluginDependency = async (dependency: PluginDependencyStatus) => {
    if (!dependency.canInstall) return;
    const confirmed = window.confirm(`${formatPluginDependencyTitle(dependency)} 会安装 xiaok 插件，并从官方来源安装 ${dependency.displayName}。继续？`);
    if (!confirmed) return;
    const actionKey = `${dependency.pluginName}:${dependency.dependencyId}:setup`;
    setDependencyAction(actionKey);
    try {
      const pluginResult = await api.installPlugin(dependency.pluginName);
      if (!pluginResult.success) {
        alert(pluginResult.error || '插件安装失败');
        return;
      }
      const result = await api.installPluginDependency({
        pluginName: dependency.pluginName,
        dependencyId: dependency.dependencyId,
        confirmed: true,
      });
      if (!result.success) alert(result.error || '安装失败');
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDependencyAction('');
    }
  };

  const handleUpdateDependency = async (dependency: PluginDependencyStatus) => {
    if (!dependency.canUpdate) return;
    const confirmed = window.confirm(`更新 ${dependency.displayName} 需要替换本机 driver。继续？`);
    if (!confirmed) return;
    const actionKey = `${dependency.pluginName}:${dependency.dependencyId}:update`;
    setDependencyAction(actionKey);
    try {
      const result = await api.updatePluginDependency({
        pluginName: dependency.pluginName,
        dependencyId: dependency.dependencyId,
        confirmed: true,
      });
      if (!result.success) alert(result.error || '更新失败');
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
      if (!result.success) alert(result.error || '诊断失败');
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
          <SectionHeader icon={Package}>插件依赖</SectionHeader>
          <div className="flex flex-col gap-2">
            {dependencies.map(dependency => {
              const pluginInstalled = dependency.pluginInstalled ?? pluginServers.some(server => server.pluginName === dependency.pluginName);
              const dependencyServer = pluginServers.find(server => server.pluginName === dependency.pluginName);
              const statusText = formatPluginDependencyStatus(dependency, dependencyServer);
              const dependencyLayerRows = formatPluginDependencyLayerRows(dependency, pluginInstalled, dependencyServer);
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
                          打开辅助功能
                        </button>
                      )}
                      {dependency.code === 'permission_screen_missing' && (
                        <button
                          type="button"
                          onClick={() => void handleOpenPermissionSettings('screen')}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-3 py-1.5 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]"
                        >
                          <Settings size={12} />
                          打开屏幕录制
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
                          {isComputerUse ? '启用 Computer Use' : (dependencyServer?.enabled === false ? '连接 MCP' : '重连 MCP')}
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
                          安装并启用
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
                          安装 Driver
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
                          更新
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
                          诊断
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
          <SectionHeader icon={Plug}>插件 MCP 服务</SectionHeader>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            从 ~/.xiaok/plugins/ 自动发现的 MCP 服务器
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
                      {!server.connected && server.lastError && (
                        <div className="mt-1 max-w-[420px] truncate text-xs text-[var(--c-text-tertiary)]">
                          {server.lastError}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${server.connected ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {server.connected ? '已连接' : '未连接'}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section>
        <SectionHeader icon={Plug}>MCP 服务器</SectionHeader>
        <p className="text-xs text-[var(--c-text-secondary)] mb-4">
          通过 Model Context Protocol (MCP) 扩展 xiaok 的工具能力
        </p>

        <button type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-2 mb-4 rounded-lg border border-[var(--c-border)] px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
        >
          <Plus size={16} />
          添加 MCP 服务器
        </button>

        {showAdd && (
          <Card className="mb-4">
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="desktop-mcp-server-name" className="block text-xs text-[var(--c-text-secondary)] mb-1">名称</label>
                <input
                  id="desktop-mcp-server-name"
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="例如: filesystem"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="desktop-mcp-server-command" className="block text-xs text-[var(--c-text-secondary)] mb-1">命令</label>
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
                <label htmlFor="desktop-mcp-server-args" className="block text-xs text-[var(--c-text-secondary)] mb-1">参数 (空格分隔，可选)</label>
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
                <button type="button" onClick={handleCreate} className={btnPrimary}>创建</button>
                <button type="button" onClick={() => setShowAdd(false)} className={btnSecondary}>取消</button>
              </div>
            </div>
          </Card>
        )}

        <div className="flex flex-col gap-2">
          {installs.length === 0 ? (
            <Card>
              <div className="flex items-center gap-3 text-sm text-[var(--c-text-secondary)]">
                <Info size={16} />
                暂无 MCP 服务器配置
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
                        来源: {install.source} · 创建: {new Date(install.createdAt).toLocaleDateString()}
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
  server?: { connected: boolean; toolCount: number },
): string {
  if (dependency.code === 'binary_missing') return `需要安装 ${dependency.displayName}`;
  if (dependency.code === 'permission_accessibility_missing') return '需要辅助功能权限';
  if (dependency.code === 'permission_screen_missing') return '需要屏幕录制权限';
  if (dependency.code === 'version_too_old') return '需要更新 Driver';
  if (dependency.pluginName === 'cua-computer-use' && dependency.state === 'ready' && server?.connected === false) return '未启用';
  if (dependency.state === 'ready') return '可用';
  if (dependency.state === 'unsupported') return '当前平台不支持';
  return '需要处理';
}

function formatPluginDependencyLayerRows(
  dependency: PluginDependencyStatus,
  pluginInstalled: boolean,
  server?: { connected: boolean; toolCount: number },
): Array<{ label: string; value: string }> {
  return [
    { label: '插件', value: pluginInstalled ? '已安装' : '未安装' },
    { label: dependency.displayName, value: formatDriverLayerStatus(dependency) },
    { label: '权限', value: formatPermissionLayerStatus(dependency, server) },
    { label: dependency.pluginName === 'cua-computer-use' ? '服务连接' : 'MCP', value: formatMcpLayerStatus(dependency, server) },
    { label: '工具', value: formatToolLayerStatus(dependency, server) },
  ];
}

function formatDriverLayerStatus(dependency: PluginDependencyStatus): string {
  if (dependency.state === 'unsupported') return '当前平台不支持';
  if (dependency.code === 'binary_missing') return '未安装';
  if (dependency.code === 'version_too_old') return dependency.version ? `${dependency.version}，需要更新` : '需要更新';
  if (dependency.state === 'ready') return dependency.version || '已安装';
  if (dependency.resolvedBinary) return '已安装但不可用';
  return '未确认';
}

function formatPermissionLayerStatus(
  dependency: PluginDependencyStatus,
  server?: { connected: boolean; toolCount: number },
): string {
  if (dependency.code === 'permission_accessibility_missing') return '缺辅助功能权限';
  if (dependency.code === 'permission_screen_missing') return '缺屏幕录制权限';
  if (dependency.pluginName === 'cua-computer-use' && dependency.state === 'ready' && server?.connected === false) return '启用后验证';
  if (dependency.state === 'ready') return '已授权';
  if (dependency.state === 'missing' || dependency.state === 'unsupported') return '未检查';
  return '未确认';
}

function formatMcpLayerStatus(
  dependency: PluginDependencyStatus,
  server?: { connected: boolean; toolCount: number },
): string {
  if (!dependency.pluginInstalled && dependency.state === 'missing') return '未安装';
  if (!server) return '未注册';
  return server.connected ? '已连接' : '未连接';
}

function formatToolLayerStatus(
  dependency: PluginDependencyStatus,
  server?: { connected: boolean; toolCount: number },
): string {
  if (dependency.state !== 'ready') return '不可用';
  if (!server) return '等待注册';
  if (!server.connected) return dependency.pluginName === 'cua-computer-use' ? '等待启用' : 'MCP 未连接';
  if (dependency.pluginName === 'cua-computer-use' && server.toolCount === 1) return 'wrapper 已注册';
  if (dependency.pluginName === 'cua-computer-use') return 'raw tools 未隐藏';
  return `${server.toolCount} tools`;
}

function pluginDependencyBadgeClass(state: PluginDependencyStatus['state']): string {
  if (state === 'ready') return 'bg-green-100 text-green-700';
  if (state === 'missing' || state === 'needs_permission') return 'bg-yellow-100 text-yellow-700';
  if (state === 'unsupported') return 'bg-gray-100 text-gray-600';
  return 'bg-red-100 text-red-700';
}

// ---- General ----

function GeneralPane() {
  const { locale, setLocale, t } = useLocale();
  const [skillDebug, setSkillDebug] = useState(false);
  const [savingSkillDebug, setSavingSkillDebug] = useState(false);
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
      setServiceStatusError(error instanceof Error ? error.message : '服务状态读取失败');
    } finally {
      if (!silent) setServiceStatusLoading(false);
    }
  }, []);

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

  const handleRestartService = async (serviceId: DesktopRelatedServiceId) => {
    setRestartingService(serviceId);
    setServiceStatusError('');
    try {
      await api.restartRelatedService(serviceId);
      await loadServiceStatus(true);
    } catch (error) {
      setServiceStatusError(error instanceof Error ? error.message : '服务重启失败');
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
          alert('头像文件过大，请选择更小的图片');
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
        <SectionHeader icon={User}>个人资料</SectionHeader>
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
              <label className="absolute -bottom-0.5 -right-0.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-[var(--c-bg-card)] shadow" title="更换头像">
                <Camera size={10} />
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </label>
            </div>
            {/* Name */}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input aria-label="输入你的名字"
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                    className="min-w-0 flex-1 rounded-md border border-[var(--c-border)] bg-[var(--c-bg-card)] px-2 py-1 text-sm text-[var(--c-text-heading)] outline-none focus:border-[var(--c-accent)]"
                    placeholder="输入你的名字"
                    autoFocus
                  />
                  <button type="button" onClick={handleSaveName} className="text-xs text-[var(--c-accent)]">保存</button>
                  <button type="button" onClick={() => setEditingName(false)} className="text-xs text-[var(--c-text-tertiary)]">取消</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleStartEditName}
                  className="truncate text-left text-sm font-medium text-[var(--c-text-heading)] hover:text-[var(--c-accent)]"
                >
                  {displayName || '点击设置名字'}
                </button>
              )}
              <span className="text-xs text-[var(--c-text-tertiary)]">小K 回复时会称呼你</span>
            </div>
          </div>
        </Card>
      </Section>
      <Section>
        <SectionHeader icon={SlidersHorizontal}>语言</SectionHeader>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            选择界面显示语言
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
              <div className="font-medium">中文</div>
              <div className="text-xs text-[var(--c-text-tertiary)] mt-0.5">Chinese</div>
            </button>
            <button type="button"
              onClick={() => setLocale('en')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm transition-colors border ${
                locale === 'en'
                  ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)] border-[var(--c-accent)]/30'
                  : 'border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
              }`}
            >
              <div className="font-medium">English</div>
              <div className="text-xs text-[var(--c-text-tertiary)] mt-0.5">英文</div>
            </button>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Server}>服务状态</SectionHeader>
        <Card>
          <div className="flex flex-col gap-3">
            {serviceStatusLoading && !serviceStatus ? (
              <div className="flex items-center gap-2 text-xs text-[var(--c-text-secondary)]">
                <Loader2 size={14} className="animate-spin" />
                <span>检查中</span>
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
        <SectionHeader icon={Zap}>Stage 调试输出</SectionHeader>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            开启后，每次对话都会在任务开始前显示 Stage 分析（意图识别、Context 检查、耗时预估）
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {savingSkillDebug && <Loader2 size={16} className="animate-spin text-[var(--c-text-tertiary)]" />}
              <span className="text-sm text-[var(--c-text-primary)]">
                {skillDebug ? '已开启' : '已关闭'}
              </span>
            </div>
            <button type="button"
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
        <SectionHeader icon={Info}>应用信息</SectionHeader>
        <Card>
          <div className="text-xs text-[var(--c-text-secondary)] space-y-1">
            <div>版本: v{__APP_VERSION__} ({__APP_BUILD__})</div>
            <div>构建: Electron + React</div>
            <div>数据路径: ~/.xiaok/config.json</div>
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
  const status = getRelatedServiceDisplayStatus(service);
  const meta = [
    `:${service.port}`,
    service.pid ? `PID ${service.pid}` : '',
    service.restartCount ? `重启 ${service.restartCount}` : '',
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
        title={`${service.label} 重启`}
        onClick={() => onRestart(service.id)}
        disabled={restarting}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--c-border)] px-2.5 text-xs text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-bg-deep)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {restarting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        <span>重启</span>
      </button>
    </div>
  );
}

function getRelatedServiceDisplayStatus(service: DesktopRelatedServiceStatus): {
  label: string;
  dotClass: string;
  badgeClass: string;
} {
  if (service.reachable && service.running) {
    return {
      label: '运行中',
      dotClass: 'bg-[var(--c-status-success-text,#16a34a)]',
      badgeClass: 'bg-[var(--c-status-ok-bg,#dcfce7)] text-[var(--c-status-ok-text,#166534)]',
    };
  }
  if (service.running) {
    return {
      label: '异常',
      dotClass: 'bg-[var(--c-status-warning-text,#d97706)]',
      badgeClass: 'bg-[var(--c-status-warning-bg,#fef3c7)] text-[var(--c-status-warning-text,#92400e)]',
    };
  }
  return {
    label: '不可用',
    dotClass: 'bg-[var(--c-status-error-text,#dc2626)]',
    badgeClass: 'bg-[var(--c-status-error-bg,#fee2e2)] text-[var(--c-status-error-text,#991b1b)]',
  };
}

// ---- Memory ----

function MemoryPane() {
  return (
    <Section>
      <SectionHeader icon={Brain}>记忆管理</SectionHeader>
      <p className="text-xs text-[var(--c-text-secondary)] mb-4">
        管理你的偏好、工作流和项目知识。新对话会自动加载相关记忆。
      </p>
      <LocalMemoryStatsCard />
      <div className="mt-6">
        <MemoryModelSettings />
      </div>
    </Section>
  );
}
// ---- Appearance ----

function AppearancePane() {
  const [fontSize, setFontSize] = useState<string>('default');
  const [density, setDensity] = useState<string>('default');
  const [themeMode, setThemeMode] = useState<string>('system');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load config on mount
  useEffect(() => {
    api.getAppearanceConfig().then(c => {
      setFontSize(c.fontSize || 'default');
      setDensity(c.density || 'default');
      setThemeMode(c.themeMode || 'system');
    });
  }, []);

  // Save when any setting changes
  const handleSave = async (newConfig: Record<string, string>) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.saveAppearanceConfig(newConfig);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {saved && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-600 flex items-center gap-2">
          <Check size={14} /> 已保存
        </div>
      )}

      <Section>
        <SectionHeader icon={Palette}>字体大小</SectionHeader>
        <div className="flex gap-2">
          {['small', 'default', 'large'].map(size => (
            <button type="button"
              key={size}
              onClick={() => {
                setFontSize(size);
                handleSave({ fontSize: size, density, themeMode });
              }}
              disabled={saving}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                fontSize === size
                  ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)] border border-[var(--c-accent)]/30'
                  : 'border border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
              }`}
            >
              {size === 'default' ? '默认' : size === 'small' ? '小' : '大'}
            </button>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeader>密度</SectionHeader>
        <div className="flex gap-2">
          {['default', 'compact'].map(d => (
            <button type="button"
              key={d}
              onClick={() => {
                setDensity(d);
                handleSave({ fontSize, density: d, themeMode });
              }}
              disabled={saving}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                density === d
                  ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)] border border-[var(--c-accent)]/30'
                  : 'border border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
              }`}
            >
              {d === 'default' ? '舒适' : '紧凑'}
            </button>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeader>主题</SectionHeader>
        <div className="flex gap-2">
          {['light', 'dark', 'system'].map(mode => (
            <button type="button"
              key={mode}
              onClick={() => {
                setThemeMode(mode);
                handleSave({ fontSize, density, themeMode: mode });
              }}
              disabled={saving}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                themeMode === mode
                  ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)] border border-[var(--c-accent)]/30'
                  : 'border border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
              }`}
            >
              {mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

// ---- Data ----

function DataPane() {
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    if (!confirm('确定要清除所有本地数据吗？包括对话历史和设置。')) return;
    setClearing(true);
    try {
      // Clear IndexedDB
      const dbReq = indexedDB.deleteDatabase('xiaok-desktop');
      dbReq.onsuccess = () => {
        // Clear localStorage
        localStorage.clear();
        alert('数据已清除，页面将刷新');
        window.location.reload();
      };
      dbReq.onerror = () => {
        alert('清除失败: ' + dbReq.error?.message);
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
        <SectionHeader icon={Database}>本地数据</SectionHeader>
        <Card>
          <div className="flex items-start gap-3">
            <Database size={18} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium">数据存储位置</div>
              <div className="text-xs text-[var(--c-text-secondary)] mt-1">
                所有对话历史存储在 IndexedDB (xiaok-desktop)<br />
                设置信息存储在 localStorage
              </div>
            </div>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={SlidersHorizontal}>配置路径</SectionHeader>
        <Card>
          <code className="text-sm font-mono text-[var(--c-text-secondary)]">
            ~/.xiaok/config.json
          </code>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Trash2}>危险操作</SectionHeader>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">清除所有数据</div>
              <div className="text-xs text-[var(--c-text-secondary)] mt-1">
                删除所有对话历史、设置和缓存数据
              </div>
            </div>
            <button type="button"
              onClick={handleClear}
              disabled={clearing}
              className={btnDanger}
            >
              {clearing ? '清除中...' : '清除数据'}
            </button>
          </div>
        </Card>
      </Section>
    </>
  );
}

// ---- About ----

function AboutPane() {
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
        <SectionHeader icon={Info}>关于 xiaok</SectionHeader>
        <Card>
          <div className="text-sm">
            <div className="font-medium text-base">xiaok desktop</div>
            <div className="text-xs text-[var(--c-text-secondary)] mt-2">
              本地模式 · 无需登录 · 数据保存在本地
            </div>
            <div className="text-xs text-[var(--c-text-tertiary)] mt-3">
              AI 助手应用，支持多模态意图识别、工具调用和技能扩展
            </div>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Zap}>软件更新</SectionHeader>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">
                {updateStatus?.installing ? '正在安装' : updateStatus?.downloaded ? '更新已就绪' : updateStatus?.downloading ? '正在下载' : updateStatus?.available ? '发现新版本' : '当前版本'}
              </div>
              <div className="text-xs text-[var(--c-text-secondary)] mt-1">
                {updateStatus?.installing ? `正在安装 v${updateStatus.version || '新版本'}，应用将自动重启` :
                 updateStatus?.downloaded ? `v${updateStatus.version || '新版本'} 已下载，点击安装` :
                 updateStatus?.downloading ? `下载进度 ${updateStatus.progress}%` :
                 updateStatus?.available ? `v${updateStatus.version || '新版本'} 可用` :
                 updateStatus?.checking || checking ? '正在检查...' :
                 `v${__APP_VERSION__}`}
              </div>
              {updateStatus?.error && (
                <div className="text-xs text-red-500 mt-1">{updateStatus.error}</div>
              )}
            </div>
            <div className="flex gap-2">
              {updateStatus?.downloaded ? (
                <button type="button" onClick={handleInstallUpdate} disabled={updateStatus.installing} className={btnPrimary}>
                  {updateStatus.installing ? '安装中...' : '安装并重启'}
                </button>
              ) : updateStatus?.downloading ? (
                <div className="flex items-center gap-2 text-[var(--c-accent)]">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">{updateStatus.progress}%</span>
                </div>
              ) : (
                <button type="button" onClick={handleCheckUpdate} disabled={checking || updateStatus?.checking} className={btnSecondary}>
                  {checking || updateStatus?.checking ? '检查中...' : '检查更新'}
                </button>
              )}
            </div>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader icon={Cpu}>核心功能</SectionHeader>
        <div className="flex flex-col gap-2">
          <Card>
            <div className="flex items-start gap-3">
              <Zap size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">意图识别</div>
                <div className="text-xs text-[var(--c-text-secondary)]">智能理解用户意图，分解复杂任务</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <SlidersHorizontal size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">工具调用</div>
                <div className="text-xs text-[var(--c-text-secondary)]">文件操作、命令执行、代码编辑</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <Puzzle size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">技能扩展</div>
                <div className="text-xs text-[var(--c-text-secondary)]">通过技能扩展 AI 能力边界</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="flex items-start gap-3">
              <Plug size={16} className="text-[var(--c-accent)] shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium">MCP 协议</div>
                <div className="text-xs text-[var(--c-text-secondary)]">支持 Model Context Protocol 扩展</div>
              </div>
            </div>
          </Card>
        </div>
      </Section>

      <Section>
        <SectionHeader>支持的 AI 提供商</SectionHeader>
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
        <SectionHeader>版本信息</SectionHeader>
        <Card>
          <div className="text-xs text-[var(--c-text-secondary)]">
            <div>版本: v{__APP_VERSION__} ({__APP_BUILD__})</div>
            <div className="mt-1">构建: Electron + React</div>
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
  description: string;
  notImplemented?: boolean;
}> = [
  { key: 'duckduckgo', label: 'DuckDuckGo', description: '默认，无需 API Key（兜底）' },
  { key: 'tavily', label: 'Tavily', description: '高质量搜索，需要 API Key' },
  { key: 'brave', label: 'Brave Search', description: '注重隐私，需要 API Key' },
];

const FETCH_PROVIDERS: Array<{
  key: ConnectorsFetchProvider;
  label: string;
  description: string;
  notImplemented?: boolean;
}> = [
  { key: 'basic', label: 'Basic', description: '默认，直接 HTTP 抓取（兜底）' },
  { key: 'jina', label: 'Jina Reader', description: '清洗为干净 Markdown，可选 API Key' },
  { key: 'firecrawl', label: 'Firecrawl', description: '高质量爬取（暂未实现）', notImplemented: true },
];

function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 12)) + key.slice(-4);
}

function runtimeStateLabel(state: ConnectorsProviderRuntime['runtime_state']): { text: string; tone: 'ok' | 'warn' | 'err' | 'mute' } {
  switch (state) {
    case 'ready': return { text: '可用', tone: 'ok' };
    case 'inactive': return { text: '未启用', tone: 'mute' };
    case 'missing_config': return { text: '未配置', tone: 'warn' };
    case 'invalid_config': return { text: '配置无效', tone: 'err' };
    case 'not_implemented': return { text: '暂未实现', tone: 'mute' };
    default: return { text: state, tone: 'mute' };
  }
}

function RuntimeBadge({ runtime }: { runtime?: ConnectorsProviderRuntime }) {
  if (!runtime) return null;
  const { text, tone } = runtimeStateLabel(runtime.runtime_state);
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

function ApiKeyInput({ ariaLabel, placeholder, storedValue, onChange }: ApiKeyInputProps) {
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
          更换
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
          取消
        </button>
      )}
    </div>
  );
}

interface TestButtonProps {
  kind: 'search' | 'fetch';
}

function TestButton({ kind }: TestButtonProps) {
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
        测试连接
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
        setSuccess('已保存');
      } else {
        setError('保存失败：桌面端未连接');
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
        无法加载连接器配置。{error && <div className="mt-2 text-red-500">{error}</div>}
      </div>
    );
  }

  const search = draft.search;
  const fetchCfg = draft.fetch;

  return (
    <>
      <Section>
        <SectionHeader icon={Wrench}>网络工具</SectionHeader>
        <div className="text-xs text-[var(--c-text-secondary)] mb-3">
          配置 web_search 与 web_fetch 使用的 provider。切换时自动 fallback 到默认 provider。
        </div>
        {snapshot?.loadStatus === 'parse_failed' && (
          <div className="mb-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
            连接器配置文件格式异常已被备份，已恢复为默认值。
          </div>
        )}
      </Section>

      <Section>
        <SectionHeader icon={Search}>搜索 Provider</SectionHeader>
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
                      <RuntimeBadge runtime={runtime} />
                    </div>
                    <div className="mt-1 text-xs text-[var(--c-text-secondary)]">{opt.description}</div>
                    {checked && opt.key === 'tavily' && (
                      <ApiKeyInput
                        ariaLabel="tavily-api-key"
                        placeholder="Tavily API Key (tvly-...)"
                        storedValue={search.tavilyApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, search: { ...d.search, tavilyApiKey: v } } : d)}
                      />
                    )}
                    {checked && opt.key === 'brave' && (
                      <ApiKeyInput
                        ariaLabel="brave-api-key"
                        placeholder="Brave Search API Key"
                        storedValue={search.braveApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, search: { ...d.search, braveApiKey: v } } : d)}
                      />
                    )}
                  </div>
                </label>
              </Card>
            );
          })}
        </div>
        <TestButton kind="search" />
      </Section>

      <Section>
        <SectionHeader icon={LinkIcon}>抓取 Provider</SectionHeader>
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
                      <RuntimeBadge runtime={runtime} />
                    </div>
                    <div className="mt-1 text-xs text-[var(--c-text-secondary)]">{opt.description}</div>
                    {checked && opt.key === 'jina' && (
                      <ApiKeyInput
                        ariaLabel="jina-api-key"
                        placeholder="Jina API Key (可选，留空走免费额度)"
                        storedValue={fetchCfg.jinaApiKey || ''}
                        onChange={v => setDraft(d => d ? { ...d, fetch: { ...d.fetch, jinaApiKey: v } } : d)}
                      />
                    )}
                  </div>
                </label>
              </Card>
            );
          })}
        </div>
        <TestButton kind="fetch" />
      </Section>

      <Section>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={btnPrimary}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" />保存中</span> : '保存'}
          </button>
          {success && <span className="text-xs text-green-600">{success}</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </Section>
    </>
  );
}

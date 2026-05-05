import { useState, useEffect, type ReactNode } from 'react';
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
} from 'lucide-react';
import { api } from '../api';
import type { DesktopModelConfigSnapshot, DesktopSaveModelConfigInput, TestProviderConnectionResult } from '../../../electron/preload-api';
import { useLanguage } from '../contexts/LanguageContext';

type SettingsTab = 'model' | 'skills' | 'channels' | 'mcp' | 'general' | 'appearance' | 'data' | 'about';

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
  { key: 'appearance', icon: Palette, label: '外观设置' },
  { key: 'data', icon: HardDrive, label: '数据管理' },
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
          <button
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
              <button
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
          {activeTab === 'general' && <GeneralPane />}
          {activeTab === 'appearance' && <AppearancePane />}
          {activeTab === 'data' && <DataPane />}
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
  const [showAddModel, setShowAddModel] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ modelId: string; model: string; label: string; capabilities?: string[] }>>([]);

  useEffect(() => {
    api.getModelConfig()
      .then(c => {
        setConfig(c);
        if (c?.providers?.[0]) setSelectedProvider(c.providers[0].id);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Load available models when provider changes
  useEffect(() => {
    if (selectedProvider) {
      api.listAvailableModelsForProvider(selectedProvider)
        .then(setAvailableModels)
        .catch(() => setAvailableModels([]));
    }
  }, [selectedProvider]);

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

  const handleTest = async () => {
    if (!selectedProvider) return;
    setTesting(prev => ({ ...prev, [selectedProvider]: true }));
    setError('');
    try {
      const result = await api.testProviderConnection({ providerId: selectedProvider });
      setTestResults(prev => ({ ...prev, [selectedProvider]: result }));
      if (result.success) {
        setSuccess(`连接成功，延迟 ${result.latencyMs}ms`);
      } else {
        setError(result.error || '连接失败');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(prev => ({ ...prev, [selectedProvider]: false }));
    }
  };

  const handleAddModel = async (modelId: string) => {
    const modelInfo = availableModels.find(m => m.modelId === modelId);
    if (!modelInfo || !selectedProvider) return;
    setSaving(true);
    setError('');
    try {
      await api.saveModelConfig({
        providerId: selectedProvider,
        modelName: modelInfo.model,
        label: modelInfo.label,
      });
      const updated = await api.getModelConfig();
      setConfig(updated);
      setSuccess(`已添加模型 ${modelInfo.label}`);
      setShowAddModel(false);
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
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        onClick={() => {
                          setSelectedProvider(provider.id);
                          handleTest();
                        }}
                        disabled={testing[provider.id]}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors disabled:opacity-50"
                      >
                        {testing[provider.id] ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                        测试连接
                      </button>
                      {testResult && (
                        <span className={`text-xs ${testResult.success ? 'text-green-600' : 'text-red-500'}`}>
                          {testResult.success
                            ? `延迟 ${testResult.latencyMs}ms`
                            : testResult.error}
                        </span>
                      )}
                      {provider.type === 'custom' && (
                        <button
                          onClick={() => handleDeleteProvider(provider.id)}
                          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={12} /> 删除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {/* Model list */}
                {provider.apiKeyConfigured && config?.models && (
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
                            <button
                              onClick={() => handleDeleteModel(m.id)}
                              className="ml-1 hover:text-red-500"
                              title="删除模型"
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                    </div>
                    {/* Add model from available list */}
                    {availableModels.length > 0 && (
                      <div className="mt-2">
                        <button
                          onClick={() => setShowAddModel(!showAddModel)}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--c-border)] px-2.5 py-1 text-xs text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)] transition-colors"
                        >
                          <Plus size={12} /> 添加模型
                        </button>
                        {showAddModel && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {availableModels
                              .filter(m => !config.models.some(cm => cm.model === m.model && cm.provider === provider.id))
                              .map(m => (
                                <button
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
                    )}
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
        <SectionHeader icon={Zap}>设置 API Key</SectionHeader>
        <Card>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">选择提供商</label>
              <select
                value={selectedProvider}
                onChange={e => setSelectedProvider(e.target.value)}
                className={inputCls}
              >
                {config?.providers.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--c-text-secondary)] mb-1.5">API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
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
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !apiKey.trim()}
                className={btnPrimary}
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={handleTest}
                disabled={testing[selectedProvider] || !selectedProvider}
                className={btnSecondary}
              >
                {testing[selectedProvider] ? '测试中...' : '测试连接'}
              </button>
            </div>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader>添加自定义提供商</SectionHeader>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] mb-3">
            如需添加自定义 OpenAI 兼容 API，请编辑配置文件 ~/.xiaok/config.json
          </p>
          <code className="text-xs font-mono bg-[var(--c-bg-deep)] p-2 rounded block">
{`{
  "providers": {
    "custom-provider": {
      "type": "custom",
      "protocol": "openai_legacy",
      "baseUrl": "https://your-api.com/v1",
      "apiKey": "your-key"
    }
  }
}`}
          </code>
        </Card>
      </Section>
    </>
  );
}

// ---- Skills ----

function SkillsPane() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [installName, setInstallName] = useState('');
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    api.listSkills()
      .then(setSkills)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleInstall = async () => {
    if (!installName.trim()) return;
    setInstalling(true);
    try {
      // Call install skill API (clawhub)
      // This would require an IPC call to the skill installer
      alert(`技能安装功能需要在终端执行: clawhub install ${installName}`);
      setShowInstall(false);
      setInstallName('');
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstall = async (skillName: string) => {
    if (!confirm(`确定卸载技能 "${skillName}"？`)) return;
    try {
      alert(`技能卸载功能需要在终端执行: clawhub uninstall ${skillName}`);
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
        <SectionHeader icon={Puzzle}>已安装技能 ({skills.length})</SectionHeader>
        <p className="text-xs text-[var(--c-text-secondary)] mb-4">
          技能扩展了 xiaok 的能力，可以通过输入 /技能名 来使用。
          技能安装/卸载需要通过 clawhub 命令行工具执行。
        </p>

        {/* Install button */}
        <button
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
                <label className="block text-xs text-[var(--c-text-secondary)] mb-1">技能名称</label>
                <input
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
                <button onClick={handleInstall} disabled={installing || !installName.trim()} className={btnPrimary}>
                  {installing ? '安装中...' : '确认安装'}
                </button>
                <button onClick={() => setShowInstall(false)} className={btnSecondary}>取消</button>
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
            skills.map(skill => (
              <Card key={skill.name}>
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">
                    <Package size={16} className="text-[var(--c-accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-[var(--c-accent)]">/{skill.name}</code>
                      <span className="text-xs text-[var(--c-text-tertiary)]">[{skill.tier}]</span>
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
                  <button
                    onClick={() => handleUninstall(skill.name)}
                    className="rounded-lg p-1.5 text-[var(--c-text-tertiary)] hover:text-red-500 transition-colors"
                    title="卸载"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </Card>
            ))
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
        <p className="text-xs text-[var(--c-text-secondary)] mb-4">
          配置第三方平台接入，让 xiaok 可以在这些平台上提供服务
        </p>

        {/* Add button */}
        <button
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
                <label className="block text-xs text-[var(--c-text-secondary)] mb-1">名称</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="例如: 团队通知"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--c-text-secondary)] mb-1">类型</label>
                <select
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
                  <label className="block text-xs text-[var(--c-text-secondary)] mb-1">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="text"
                    value={newFields[field.key] || ''}
                    onChange={e => setNewFields(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className={inputCls}
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <button onClick={handleCreate} className={btnPrimary}>创建</button>
                <button onClick={() => setShowAdd(false)} className={btnSecondary}>取消</button>
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
                    <div className={`w-2 h-2 rounded-full ${ch.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div>
                      <div className="text-sm font-medium">{ch.name}</div>
                      <div className="text-xs text-[var(--c-text-secondary)]">
                        {CHANNEL_TYPE_CONFIG[ch.type]?.label || ch.type} · 创建: {new Date(ch.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggle(ch)}
                      className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                        ch.enabled ? 'bg-green-50 text-green-600' : 'bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)]'
                      }`}
                    >
                      {ch.enabled ? '启用中' : '已禁用'}
                    </button>
                    <button
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

function McpPane() {
  const [installs, setInstalls] = useState<MCPInstallConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');

  const load = () => {
    api.listMCPInstalls()
      .then(setInstalls)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

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
        <SectionHeader icon={Plug}>MCP 服务器</SectionHeader>
        <p className="text-xs text-[var(--c-text-secondary)] mb-4">
          通过 Model Context Protocol (MCP) 扩展 xiaok 的工具能力
        </p>

        <button
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
                <label className="block text-xs text-[var(--c-text-secondary)] mb-1">名称</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="例如: filesystem"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--c-text-secondary)] mb-1">命令</label>
                <input
                  type="text"
                  value={newCommand}
                  onChange={e => setNewCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--c-text-secondary)] mb-1">参数 (空格分隔，可选)</label>
                <input
                  type="text"
                  value={newArgs}
                  onChange={e => setNewArgs(e.target.value)}
                  placeholder="/path/to/allow"
                  className={inputCls}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreate} className={btnPrimary}>创建</button>
                <button onClick={() => setShowAdd(false)} className={btnSecondary}>取消</button>
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
                    <div className={`w-2 h-2 rounded-full ${install.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
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
                  <button
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

// ---- General ----

function GeneralPane() {
  const { language, setLanguage, t } = useLanguage();
  const [skillDebug, setSkillDebug] = useState(false);
  const [savingSkillDebug, setSavingSkillDebug] = useState(false);

  useEffect(() => {
    api.getSkillDebugConfig().then(c => {
      setSkillDebug(c.enabled);
    });
  }, []);

  const handleSkillDebugToggle = async (enabled: boolean) => {
    setSkillDebug(enabled);
    setSavingSkillDebug(true);
    try {
      await api.saveSkillDebugConfig({ enabled });
    } finally {
      setSavingSkillDebug(false);
    }
  };

  return (
    <>
      <Section>
        <SectionHeader icon={SlidersHorizontal}>语言</SectionHeader>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] mb-4">
            选择界面显示语言
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setLanguage('zh')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm transition-colors border ${
                language === 'zh'
                  ? 'bg-[var(--c-accent)]/10 text-[var(--c-accent)] border-[var(--c-accent)]/30'
                  : 'border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]'
              }`}
            >
              <div className="font-medium">中文</div>
              <div className="text-xs text-[var(--c-text-tertiary)] mt-0.5">Chinese</div>
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={`flex-1 rounded-lg px-4 py-3 text-sm transition-colors border ${
                language === 'en'
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
            <button
              onClick={() => handleSkillDebugToggle(!skillDebug)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                skillDebug ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-border)]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
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
            <div>版本: {__APP_VERSION__}</div>
            <div>构建: Electron + React</div>
            <div>数据路径: ~/.xiaok/config.json</div>
          </div>
        </Card>
      </Section>
    </>
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
            <button
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
            <button
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
            <button
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
            <button
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
  const [updateStatus, setUpdateStatus] = useState<{ checking: boolean; available: boolean; downloading: boolean; downloaded: boolean; progress: number; version?: string; error?: string } | null>(null);
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
                {updateStatus?.downloaded ? '更新已就绪' : updateStatus?.downloading ? '正在下载' : updateStatus?.available ? '发现新版本' : '当前版本'}
              </div>
              <div className="text-xs text-[var(--c-text-secondary)] mt-1">
                {updateStatus?.downloaded ? `v${updateStatus.version || '新版本'} 已下载，点击安装` :
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
                <button onClick={handleInstallUpdate} className={btnPrimary}>
                  安装并重启
                </button>
              ) : updateStatus?.downloading ? (
                <div className="flex items-center gap-2 text-[var(--c-accent)]">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">{updateStatus.progress}%</span>
                </div>
              ) : (
                <button onClick={handleCheckUpdate} disabled={checking || updateStatus?.checking} className={btnSecondary}>
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
            <div>版本: {__APP_VERSION__}</div>
            <div className="mt-1">构建: Electron + React</div>
          </div>
        </Card>
      </Section>
    </>
  );
}
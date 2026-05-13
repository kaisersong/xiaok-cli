/**
 * CreateAgentModal — 2-step wizard to create a new kswarm agent.
 * Runtime = detected local agent platforms. LLM follows platform config.
 *
 * When runtimeType === 'xiaok', provider/model lists come from Desktop's
 * configured model config (IPC), not kswarm's hardcoded /llm/providers.
 */

import { useState, useEffect } from 'react';
import { X, Bot, Crown, Zap } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import { api } from '../../api/bridge';
import type { CreateAgentInput } from '../../hooks/useKSwarmClient';

interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  default: boolean;
}

interface CreateAgentModalProps {
  open: boolean;
  onClose(): void;
}

type AgentType = 'worker' | 'po' | 'all';

interface RuntimeOption {
  type: string;
  displayName: string;
  description: string;
  detected: boolean;
}

interface DesktopProvider {
  id: string;
  label: string;
  apiKeyConfigured: boolean;
}

interface DesktopModel {
  modelId: string;
  model: string;
  label: string;
}

export function CreateAgentModal({ open, onClose }: CreateAgentModalProps) {
  const { createAgent, fetchRuntimes, fetchLlmProviders } = useKSwarm();
  const { t } = useLocale();
  const [step, setStep] = useState<1 | 2>(1);

  const AGENT_TYPES: Array<{ id: AgentType; label: string; desc: string; icon: typeof Bot; roles: string[] }> = [
    { id: 'worker', label: t.projectsAgentTypeWorker, desc: '编码、测试、设计、写作', icon: Bot, roles: ['worker'] },
    { id: 'po', label: t.projectsAgentTypePo, desc: '规划、协调、审核', icon: Crown, roles: ['project_owner'] },
    { id: 'all', label: t.projectsAgentTypeAll, desc: '兼顾管理与执行', icon: Zap, roles: ['project_owner', 'worker'] },
  ];
  const [agentType, setAgentType] = useState<AgentType>('worker');
  const [name, setName] = useState('');
  const [runtimeType, setRuntimeType] = useState('xiaok');
  const [runtimes, setRuntimes] = useState<RuntimeOption[]>([]);
  const [llmProviders, setLlmProviders] = useState<string[]>([]);
  const [desktopProviders, setDesktopProviders] = useState<DesktopProvider[]>([]);
  const [desktopModels, setDesktopModels] = useState<DesktopModel[]>([]);
  const [kswarmModels, setKswarmModels] = useState<ModelInfo[]>([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);

  const isXiaok = runtimeType === 'xiaok';

  // Fetch runtimes, kswarm providers, and desktop providers on open
  useEffect(() => {
    if (!open) return;
    fetchRuntimes().then(r => setRuntimes(r));
    fetchLlmProviders().then(p => setLlmProviders(p));
    api.getModelConfig().then(c => setDesktopProviders(c.providers ?? [])).catch(() => {});
  }, [open, fetchRuntimes, fetchLlmProviders]);

  // Fetch available models when xiaok provider changes
  useEffect(() => {
    if (!isXiaok || !provider) { setDesktopModels([]); return; }
    api.listAvailableModelsForProvider(provider).then(m => setDesktopModels(m ?? [])).catch(() => setDesktopModels([]));
  }, [isXiaok, provider]);

  // Fetch kswarm model catalog when a non-xiaok provider is selected
  useEffect(() => {
    if (isXiaok || !provider) { setKswarmModels([]); return; }
    fetch(`http://127.0.0.1:4400/llm/models?provider=${provider}`)
      .then(r => r.json())
      .then(d => setKswarmModels(d.models ?? []))
      .catch(() => setKswarmModels([]));
  }, [isXiaok, provider]);

  if (!open) return null;

  const reset = () => {
    setStep(1); setAgentType('worker'); setName(''); setRuntimeType('xiaok');
    setProvider(''); setModel(''); setBaseUrl(''); setApiKey(''); setInstructions('');
  };

  const handleClose = () => { reset(); onClose(); };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const roles = AGENT_TYPES.find(t => t.id === agentType)!.roles;
    const input: CreateAgentInput = {
      name: name.trim(),
      roles,
      runtimeType: runtimeType || undefined,
      provider: provider || undefined,
      model: model || undefined,
      baseUrl: (!isXiaok && baseUrl) ? baseUrl : undefined,
      apiKey: (!isXiaok && apiKey) ? apiKey : undefined,
      instructions: instructions || undefined,
    };
    try {
      const result = await createAgent(input);
      if (result) {
        handleClose();
      } else {
        console.error('[CreateAgent] createAgent returned null');
      }
    } catch (err) {
      console.error('[CreateAgent] failed:', err);
    } finally {
      setLoading(false);
    }
  };

  // Build runtime options: xiaok always first, then detected, then rest
  const runtimeOptions = runtimes.length > 0
    ? [
        { type: 'xiaok', displayName: 'xiaok', description: 'xiaok 内置智能体', detected: true },
        ...runtimes.filter(r => r.type !== 'xiaok'),
      ]
    : [{ type: 'xiaok', displayName: 'xiaok', description: 'xiaok 内置智能体', detected: true }];

  // Provider options: xiaok uses Desktop config, others use kswarm /llm/providers
  const providerOptions = isXiaok && desktopProviders.length > 0
    ? [
        { value: '', label: '跟随平台配置' },
        ...desktopProviders.map(p => ({
          value: p.id,
          label: `${p.label}${p.apiKeyConfigured ? '' : ' (未配置 API Key)'}`,
        })),
      ]
    : [
        { value: '', label: '跟随平台配置' },
        ...llmProviders.map(p => ({ value: p, label: p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic (Claude)' : p === 'ollama' ? 'Ollama (本地)' : p })),
      ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/12 backdrop-blur-[2px]" onClick={handleClose} />
      <div className="relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border-[0.5px] border-[var(--c-border-subtle)] bg-[var(--c-bg-page)] p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[var(--c-text-heading)]">
            {step === 1 ? t.projectsAgentTypeTitle : '配置智能体'}
          </h2>
          <button type="button" onClick={handleClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--c-text-muted)] hover:bg-[var(--c-bg-deep)]">
            <X size={16} />
          </button>
        </div>

        {step === 1 ? (
          <div className="flex flex-col gap-3">
            {AGENT_TYPES.map(type => {
              const Icon = type.icon;
              const selected = agentType === type.id;
              return (
                <button key={type.id} type="button" onClick={() => setAgentType(type.id)}
                  className={`flex items-center gap-3 rounded-xl p-4 text-left transition-colors border-[0.5px] ${
                    selected ? 'border-[var(--c-btn-bg)] bg-[var(--c-btn-bg)]/10' : 'border-[var(--c-border-subtle)] hover:bg-[var(--c-bg-deep)]'
                  }`}>
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${selected ? 'bg-[var(--c-btn-bg)]' : 'bg-[var(--c-bg-deep)]'}`}>
                    <Icon size={18} className={selected ? 'text-[var(--c-btn-text)]' : 'text-[var(--c-text-secondary)]'} />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[var(--c-text-primary)]">{type.label}</p>
                    <p className="text-[11px] text-[var(--c-text-muted)]">{type.desc}</p>
                  </div>
                </button>
              );
            })}
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={() => setStep(2)} className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-1.5 text-sm font-medium text-[var(--c-btn-text)] hover:brightness-[1.12]">下一步</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{t.projectsAgentName}</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="例：研究员、编码专家"
                className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none focus:border-[var(--c-input-border-color-focus)]"
                autoFocus />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">本机智能体平台</label>
              <div className="flex flex-wrap gap-1.5">
                {runtimeOptions.map(rt => (
                  <button key={rt.type} type="button" onClick={() => { setRuntimeType(rt.type); setProvider(''); setModel(''); }}
                    className={`rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                      runtimeType === rt.type
                        ? 'bg-[var(--c-btn-bg)] text-[var(--c-btn-text)]'
                        : 'bg-[var(--c-bg-deep)] text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]'
                    }`}>
                    {rt.displayName}
                    {rt.type === 'xiaok' && <span className="ml-1 text-[10px] opacity-70">推荐</span>}
                    {!rt.detected && rt.type !== 'xiaok' && <span className="ml-1 text-[10px] opacity-50">未安装</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="agent-provider" className="text-[11px] font-medium text-[var(--c-text-tertiary)]">LLM 提供商</label>
              <select id="agent-provider" data-testid="provider-select" value={provider} onChange={e => { setProvider(e.target.value); setModel(''); if (!e.target.value) { setBaseUrl(''); setApiKey(''); } }}
                className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-input-border-color-focus)]">
                {providerOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <p className="text-[10px] text-[var(--c-text-muted)]">
                {isXiaok ? '使用 xiaok 设置中已配置的 provider' : '默认跟随平台已配置的 provider，无需手动填写'}
              </p>
            </div>

            {provider && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="agent-model" className="text-[11px] font-medium text-[var(--c-text-tertiary)]">模型</label>
                  {isXiaok && desktopModels.length > 0 ? (
                    <select id="agent-model" data-testid="model-select" value={model} onChange={e => setModel(e.target.value)}
                      className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-input-border-color-focus)]">
                      <option value="">选择模型</option>
                      {desktopModels.map(m => <option key={m.modelId} value={m.model}>{m.label}</option>)}
                    </select>
                  ) : kswarmModels.length > 0 ? (
                    <select id="agent-model" data-testid="model-select" value={model} onChange={e => setModel(e.target.value)}
                      className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none focus:border-[var(--c-input-border-color-focus)]">
                      <option value="">选择模型</option>
                      {kswarmModels.map(m => <option key={m.id} value={m.id}>{m.label}{m.default ? ' (默认)' : ''}</option>)}
                    </select>
                  ) : (
                    <input id="agent-model" data-testid="model-input" type="text" value={model} onChange={e => setModel(e.target.value)}
                      placeholder={provider === 'anthropic' ? 'claude-sonnet-4-20250514' : provider === 'openai' ? 'gpt-4o' : 'llama3'}
                      className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none focus:border-[var(--c-input-border-color-focus)]" />
                  )}
                </div>
                {!isXiaok && (provider === 'openai' || provider === 'ollama') && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="agent-baseurl" className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{t.commonBaseUrl}</label>
                    <input id="agent-baseurl" data-testid="baseurl-input" type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                      placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'}
                      className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none focus:border-[var(--c-input-border-color-focus)]" />
                  </div>
                )}
                {!isXiaok && provider !== 'ollama' && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="agent-apikey" className="text-[11px] font-medium text-[var(--c-text-tertiary)]">{t.commonApiKey}</label>
                    <input id="agent-apikey" data-testid="apikey-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..."
                      className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none focus:border-[var(--c-input-border-color-focus)]" />
                  </div>
                )}
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--c-text-tertiary)]">指令 <span className="text-[var(--c-text-muted)]">(可选)</span></label>
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="系统提示词或行为指令..." rows={2}
                className="rounded-lg border-[0.5px] border-[var(--c-input-border-color)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-placeholder)] outline-none focus:border-[var(--c-input-border-color-focus)] resize-none" />
            </div>

            <div className="mt-2 flex justify-between">
              <button type="button" onClick={() => setStep(1)} className="rounded-lg px-4 py-1.5 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-bg-deep)]">返回</button>
              <button type="button" onClick={handleCreate} disabled={!name.trim() || loading}
                className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-1.5 text-sm font-medium text-[var(--c-btn-text)] hover:brightness-[1.12] disabled:opacity-50">
                {loading ? t.projectsAgentCreating : t.projectsAgentCreate}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

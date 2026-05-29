/**
 * CreateAgentModal — 2-step wizard to create a new kswarm agent.
 * Runtime = detected local agent platforms. xiaok 运行时由桌面端主进程
 * 负责绑定本地 runtime 与平台配置，renderer 不直接拼 provider/apiKey。
 */

import { useState, useEffect } from 'react';
import { X, Bot, Crown, Zap } from 'lucide-react';
import { useKSwarm } from '../../contexts/KSwarmContext';
import { useLocale } from '../../contexts/LocaleContext';
import { api } from '../../api';
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
  const [kswarmModels, setKswarmModels] = useState<ModelInfo[]>([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);

  const isXiaok = runtimeType === 'xiaok';

  // Fetch runtimes and kswarm providers on open.
  useEffect(() => {
    if (!open) return;
    fetchRuntimes().then(r => setRuntimes(r));
    fetchLlmProviders().then(p => setLlmProviders(p));
  }, [open, fetchRuntimes, fetchLlmProviders]);

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
    try {
      const result = isXiaok
        ? await api.createManagedXiaokAgent({
            name: name.trim(),
            roles,
            instructions: instructions || undefined,
          })
        : await createAgent({
            name: name.trim(),
            roles,
            runtimeType: runtimeType || undefined,
            provider: provider || undefined,
            model: model || undefined,
            baseUrl: baseUrl || undefined,
            apiKey: apiKey || undefined,
            instructions: instructions || undefined,
          } satisfies CreateAgentInput);
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

  const providerOptions = [
    { value: '', label: '跟随平台配置' },
    ...llmProviders.map(p => ({ value: p, label: p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic (Claude)' : p === 'ollama' ? 'Ollama (本地)' : p })),
  ];

  return (
    <div
      className="overlay-fade-in fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--c-overlay)' }}
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="modal-enter flex w-full max-w-lg flex-col rounded-[14px] p-6"
        style={{ background: 'var(--c-bg-card)', border: '0.5px solid var(--c-border-subtle)', maxHeight: '80vh', margin: '0 20px', overflowY: 'auto' }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--c-text-heading)]">
            {step === 1 ? t.projectsAgentTypeTitle : '配置智能体'}
          </h2>
          <button type="button" onClick={handleClose} className="flex size-7 items-center justify-center rounded-md text-[var(--c-text-muted)] transition-colors duration-150 hover:bg-[var(--c-bg-sub)] hover:text-[var(--c-text-secondary)]">
            <X size={14} />
          </button>
        </div>

        {step === 1 ? (
          <div className="flex flex-col gap-3">
            {AGENT_TYPES.map(type => {
              const Icon = type.icon;
              const selected = agentType === type.id;
              return (
                <button key={type.id} type="button" onClick={() => setAgentType(type.id)}
                  className={`flex items-center gap-3 rounded-xl p-4 text-left transition-colors border ${
                    selected ? 'border-[var(--c-btn-bg)] bg-[var(--c-btn-bg)]/10' : 'border-[var(--c-border-subtle)] hover:bg-[var(--c-bg-sub)]'
                  }`}>
                  <div className={`flex size-9 items-center justify-center rounded-lg ${selected ? 'bg-[var(--c-btn-bg)]' : 'bg-[var(--c-bg-sub)]'}`}>
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
              <button type="button" onClick={() => setStep(2)} className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-2 text-sm font-medium text-[var(--c-btn-text)] transition-colors duration-150 hover:brightness-[1.08]">下一步</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="create-agent-name" className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.projectsAgentName}</label>
              <input id="create-agent-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="例：研究员、编码专家"
                className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-text-muted)] outline-none transition-colors duration-150 focus:border-[var(--c-border)]"
                autoFocus />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="text-[12px] font-medium text-[var(--c-text-secondary)]">本机智能体平台</div>
              <div className="flex flex-wrap gap-1.5">
                {runtimeOptions.map(rt => (
                  <button key={rt.type} type="button" onClick={() => { setRuntimeType(rt.type); setProvider(''); setModel(''); }}
                    className={`rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150 ${
                      runtimeType === rt.type
                        ? 'bg-[var(--c-btn-bg)] text-[var(--c-btn-text)]'
                        : 'bg-[var(--c-bg-sub)] text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]'
                    }`}>
                    {rt.displayName}
                    {rt.type === 'xiaok' && <span className="ml-1 text-[10px] opacity-70">推荐</span>}
                    {!rt.detected && rt.type !== 'xiaok' && <span className="ml-1 text-[10px] opacity-50">未安装</span>}
                  </button>
                ))}
              </div>
            </div>

            {isXiaok ? (
              <div className="rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-sub)] p-3">
                <p className="text-[12px] font-medium text-[var(--c-text-primary)]">将直接使用 xiaok 当前桌面环境运行</p>
                <p className="mt-1 text-[10px] text-[var(--c-text-muted)]">
                  provider、模型和本地 runtime 由桌面端自动绑定，无需手动填写。
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="agent-provider" className="text-[12px] font-medium text-[var(--c-text-secondary)]">LLM 提供商</label>
                <select id="agent-provider" data-testid="provider-select" value={provider} onChange={e => { setProvider(e.target.value); setModel(''); if (!e.target.value) { setBaseUrl(''); setApiKey(''); } }}
                  className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none transition-colors duration-150 focus:border-[var(--c-border)]">
                  {providerOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <p className="text-[10px] text-[var(--c-text-muted)]">默认跟随平台已配置的 provider，无需手动填写</p>
              </div>
            )}

            {!isXiaok && provider && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="agent-model" className="text-[12px] font-medium text-[var(--c-text-secondary)]">模型</label>
                  {kswarmModels.length > 0 ? (
                    <select id="agent-model" data-testid="model-select" value={model} onChange={e => setModel(e.target.value)}
                      className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] outline-none transition-colors duration-150 focus:border-[var(--c-border)]">
                      <option value="">选择模型</option>
                      {kswarmModels.map(m => <option key={m.id} value={m.id}>{m.label}{m.default ? ' (默认)' : ''}</option>)}
                    </select>
                  ) : (
                    <input id="agent-model" data-testid="model-input" type="text" value={model} onChange={e => setModel(e.target.value)}
                      placeholder={provider === 'anthropic' ? 'claude-sonnet-4-20250514' : provider === 'openai' ? 'gpt-4o' : 'llama3'}
                      className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-text-muted)] outline-none transition-colors duration-150 focus:border-[var(--c-border)]" />
                  )}
                </div>
                {(provider === 'openai' || provider === 'ollama') && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="agent-baseurl" className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.commonBaseUrl}</label>
                    <input id="agent-baseurl" data-testid="baseurl-input" type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                      placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'}
                      className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-text-muted)] outline-none transition-colors duration-150 focus:border-[var(--c-border)]" />
                  </div>
                )}
                {provider !== 'ollama' && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="agent-apikey" className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.commonApiKey}</label>
                    <input id="agent-apikey" data-testid="apikey-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..."
                      className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-text-muted)] outline-none transition-colors duration-150 focus:border-[var(--c-border)]" />
                  </div>
                )}
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="create-agent-instructions" className="text-[12px] font-medium text-[var(--c-text-secondary)]">指令 <span className="text-[var(--c-text-muted)]">(可选)</span></label>
              <textarea id="create-agent-instructions" value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="系统提示词或行为指令..." rows={2}
                className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-text-muted)] outline-none transition-colors duration-150 focus:border-[var(--c-border)] resize-none" />
            </div>

            <div className="mt-3 flex justify-between">
              <button type="button" onClick={() => setStep(1)} className="rounded-lg bg-[var(--c-bg-page)] px-4 py-2 text-sm font-medium text-[var(--c-text-secondary)] transition-colors duration-150 hover:bg-[var(--c-bg-sub)]">返回</button>
              <button type="button" onClick={handleCreate} disabled={!name.trim() || loading}
                className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-2 text-sm font-medium text-[var(--c-btn-text)] transition-colors duration-150 hover:brightness-[1.08] disabled:opacity-50 disabled:pointer-events-none">
                {loading ? t.projectsAgentCreating : t.projectsAgentCreate}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

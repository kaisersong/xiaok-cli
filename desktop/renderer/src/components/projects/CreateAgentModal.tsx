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
  supported?: boolean;
}

export function CreateAgentModal({ open, onClose }: CreateAgentModalProps) {
  const { createAgent, fetchRuntimes } = useKSwarm();
  const { t } = useLocale();
  const [step, setStep] = useState<1 | 2>(1);

  const AGENT_TYPES: Array<{ id: AgentType; label: string; desc: string; icon: typeof Bot; roles: string[] }> = [
    { id: 'worker', label: t.projectsAgentTypeWorker, desc: t.projectsAgentTypeWorkerDesc, icon: Bot, roles: ['worker'] },
    { id: 'po', label: t.projectsAgentTypePo, desc: t.projectsAgentTypePoDesc, icon: Crown, roles: ['project_owner'] },
    { id: 'all', label: t.projectsAgentTypeAll, desc: t.projectsAgentTypeAllDesc, icon: Zap, roles: ['project_owner', 'worker'] },
  ];
  const [agentType, setAgentType] = useState<AgentType>('worker');
  const [name, setName] = useState('');
  const [runtimeType, setRuntimeType] = useState('xiaok');
  const [runtimes, setRuntimes] = useState<RuntimeOption[]>([]);
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);

  const isXiaok = runtimeType === 'xiaok';

  // Fetch server-validated native runtimes on open.
  useEffect(() => {
    if (!open) return;
    fetchRuntimes().then(r => setRuntimes(r));
  }, [open, fetchRuntimes]);

  if (!open) return null;

  const reset = () => {
    setStep(1); setAgentType('worker'); setName(''); setRuntimeType('xiaok');
    setInstructions('');
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
        { type: 'xiaok', displayName: 'xiaok', description: t.projectsAgentXiaokBuiltin, detected: true, supported: true },
        ...runtimes.filter(r => r.type !== 'xiaok'),
      ]
    : [{ type: 'xiaok', displayName: 'xiaok', description: t.projectsAgentXiaokBuiltin, detected: true, supported: true }];

  const selectedRuntime = runtimeOptions.find(runtime => runtime.type === runtimeType);

  return (
    <div
      className="overlay-fade-in fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--c-overlay)' }}
      role="presentation"
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}
    >
      <div
        className="modal-enter flex w-full max-w-lg flex-col rounded-[14px] p-6"
        style={{ background: 'var(--c-bg-card)', border: '0.5px solid var(--c-border-subtle)', maxHeight: '80vh', margin: '0 20px', overflowY: 'auto' }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--c-text-heading)]">
            {step === 1 ? t.projectsAgentTypeTitle : t.projectsAgentConfigTitle}
          </h2>
          <button type="button" aria-label="Close agent modal" onClick={handleClose} className="flex size-7 items-center justify-center rounded-md text-[var(--c-text-muted)] transition-colors duration-150 hover:bg-[var(--c-bg-sub)] hover:text-[var(--c-text-secondary)]">
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
              <button type="button" onClick={() => setStep(2)} className="rounded-lg bg-[var(--c-btn-bg)] px-4 py-2 text-sm font-medium text-[var(--c-btn-text)] transition-colors duration-150 hover:brightness-[1.08]">{t.projectsAgentNextStep}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="create-agent-name" className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.projectsAgentName}</label>
              <input id="create-agent-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t.projectsCreateAgentNamePlaceholder}
                className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-text-muted)] outline-none transition-colors duration-150 focus:border-[var(--c-border)]"
                autoFocus />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.projectsAgentRuntimeTitle}</div>
              <div className="flex flex-wrap gap-1.5">
                {runtimeOptions.map(rt => {
                  const unavailable = rt.type !== 'xiaok' && (!rt.detected || rt.supported === false);
                  return (
                  <button key={rt.type} type="button" disabled={unavailable} onClick={() => setRuntimeType(rt.type)}
                    className={`rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150 ${
                      runtimeType === rt.type
                        ? 'bg-[var(--c-btn-bg)] text-[var(--c-btn-text)]'
                        : unavailable
                          ? 'cursor-not-allowed bg-[var(--c-bg-sub)] text-[var(--c-text-muted)] opacity-60'
                          : 'bg-[var(--c-bg-sub)] text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]'
                    }`}>
                    {rt.displayName}
                    {rt.type === 'xiaok' && <span className="ml-1 text-[10px] opacity-70">{t.projectsAgentRecommended}</span>}
                    {!rt.detected && rt.type !== 'xiaok' && <span className="ml-1 text-[10px] opacity-50">{t.projectsAgentNotInstalled}</span>}
                    {rt.detected && rt.supported === false && <span className="ml-1 text-[10px] opacity-50">{t.projectsAgentNotSupported}</span>}
                  </button>
                  );
                })}
              </div>
            </div>

            {isXiaok ? (
              <div className="rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-sub)] p-3">
                <p className="text-[12px] font-medium text-[var(--c-text-primary)]">{t.projectsAgentXiaokRunDesc}</p>
                <p className="mt-1 text-[10px] text-[var(--c-text-muted)]">
                  {t.projectsAgentXiaokRunSubDesc}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--c-border-subtle)] bg-[var(--c-bg-sub)] p-3">
                <p className="text-[12px] text-[var(--c-text-secondary)]">
                  {t.projectsAgentUsesPlatformConfig(selectedRuntime?.displayName || runtimeType)}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="create-agent-instructions" className="text-[12px] font-medium text-[var(--c-text-secondary)]">{t.projectsAgentInstructionsLabel} <span className="text-[var(--c-text-muted)]">({t.projectsAgentInstructionsOptional})</span></label>
              <textarea id="create-agent-instructions" value={instructions} onChange={e => setInstructions(e.target.value)} placeholder={t.projectsCreateAgentInstructionsPlaceholder} rows={2}
                className="w-full rounded-lg border border-[var(--c-border-subtle)] bg-[var(--c-bg-input)] px-3 py-2 text-sm text-[var(--c-text-primary)] placeholder:text-[var(--c-text-muted)] outline-none transition-colors duration-150 focus:border-[var(--c-border)] resize-none" />
            </div>

            <div className="mt-3 flex justify-between">
              <button type="button" onClick={() => setStep(1)} className="rounded-lg bg-[var(--c-bg-page)] px-4 py-2 text-sm font-medium text-[var(--c-text-secondary)] transition-colors duration-150 hover:bg-[var(--c-bg-sub)]">{t.projectsAgentBack}</button>
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
